"""
AeroTwin-DT :: NumPy reference training + browser model export
=============================================================
Trains the three edge-deployable models on the run-to-failure corpus:

  1. Dense auto-encoder        -> unsupervised anomaly / novelty detection
  2. Fault classifier (MLP)    -> 8-class root-cause diagnosis
  3. RUL regressor (MLP)       -> remaining useful life in engine hours

Everything is pure NumPy (no framework) so the *identical* weights can be
executed by the browser Digital Twin (web/js/ml-runtime.js) and by the edge
service (edge/inference.py). The Colab notebook trains the deeper
LSTM/PINN variants of the same three heads and exports the same JSON schema.
"""
from __future__ import annotations
import json, os, sys
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
sys.path.insert(0, HERE)
from build_dataset import FEATURES, RAW, RESID, FAULT_CLASSES, main as build_main  # noqa


# ---------------------------------------------------------------- utilities
def adam(params):
    return [dict(m=np.zeros_like(p), v=np.zeros_like(p)) for p in params]


def adam_step(params, grads, state, lr=3e-3, t=1, b1=0.9, b2=0.999, eps=1e-8):
    for p, g, s in zip(params, grads, state):
        s["m"] = b1 * s["m"] + (1 - b1) * g
        s["v"] = b2 * s["v"] + (1 - b2) * g * g
        mh = s["m"] / (1 - b1 ** t)
        vh = s["v"] / (1 - b2 ** t)
        p -= lr * mh / (np.sqrt(vh) + eps)


def init(shape, rng):
    return rng.normal(0, np.sqrt(2.0 / shape[0]), shape)


def relu(x):
    return np.maximum(x, 0.0)


def softmax(x):
    e = np.exp(x - x.max(axis=1, keepdims=True))
    return e / e.sum(axis=1, keepdims=True)


# ---------------------------------------------------------------- models
def train_autoencoder(Xh, rng, epochs=60, bs=512, dims=(None, 12, 6)):
    _, h1, h2 = dims
    n_in = Xh.shape[1]
    W1, b1_ = init((n_in, h1), rng), np.zeros(h1)
    W2, b2_ = init((h1, h2), rng), np.zeros(h2)
    W3, b3_ = init((h2, h1), rng), np.zeros(h1)
    W4, b4_ = init((h1, n_in), rng), np.zeros(n_in)
    P = [W1, b1_, W2, b2_, W3, b3_, W4, b4_]
    st, step = adam(P), 0
    for ep in range(epochs):
        idx = rng.permutation(len(Xh))
        for i in range(0, len(idx), bs):
            xb = Xh[idx[i:i + bs]]
            z1 = np.tanh(xb @ W1 + b1_)
            z2 = np.tanh(z1 @ W2 + b2_)
            z3 = np.tanh(z2 @ W3 + b3_)
            out = z3 @ W4 + b4_
            d = (out - xb) * (2.0 / len(xb))
            gW4, gb4 = z3.T @ d, d.sum(0)
            d3 = (d @ W4.T) * (1 - z3 ** 2)
            gW3, gb3 = z2.T @ d3, d3.sum(0)
            d2 = (d3 @ W3.T) * (1 - z2 ** 2)
            gW2, gb2 = z1.T @ d2, d2.sum(0)
            d1 = (d2 @ W2.T) * (1 - z1 ** 2)
            gW1, gb1 = xb.T @ d1, d1.sum(0)
            step += 1
            adam_step(P, [gW1, gb1, gW2, gb2, gW3, gb3, gW4, gb4], st, lr=3e-3, t=step)
    return P


def ae_error(P, X):
    W1, b1_, W2, b2_, W3, b3_, W4, b4_ = P
    z = np.tanh(np.tanh(np.tanh(X @ W1 + b1_) @ W2 + b2_) @ W3 + b3_)
    out = z @ W4 + b4_
    return ((out - X) ** 2).mean(axis=1), out


def train_mlp(X, Y, rng, hidden=(24,), task="clf", epochs=40, bs=512, lr=3e-3):
    dims = [X.shape[1], *hidden, Y.shape[1]]
    P = []
    for a, b in zip(dims[:-1], dims[1:]):
        P += [init((a, b), rng), np.zeros(b)]
    st, step = adam(P), 0
    for ep in range(epochs):
        idx = rng.permutation(len(X))
        for i in range(0, len(idx), bs):
            xb, yb = X[idx[i:i + bs]], Y[idx[i:i + bs]]
            acts, a = [xb], xb
            for li in range(0, len(P) - 2, 2):
                a = relu(a @ P[li] + P[li + 1])
                acts.append(a)
            logits = a @ P[-2] + P[-1]
            if task == "clf":
                probs = softmax(logits)
                d = (probs - yb) / len(xb)
            else:
                d = 2 * (logits - yb) / len(xb)
            grads = [None] * len(P)
            grads[-2], grads[-1] = acts[-1].T @ d, d.sum(0)
            for li in range(len(P) - 4, -1, -2):
                d = (d @ P[li + 2].T) * (acts[li // 2 + 1] > 0)
                grads[li], grads[li + 1] = acts[li // 2].T @ d, d.sum(0)
            step += 1
            adam_step(P, grads, st, lr=lr, t=step)
    return P


def mlp_forward(P, X, task="clf"):
    a = X
    for li in range(0, len(P) - 2, 2):
        a = relu(a @ P[li] + P[li + 1])
    out = a @ P[-2] + P[-1]
    return softmax(out) if task == "clf" else out


# ---------------------------------------------------------------- pipeline
def main():
    csv = os.path.join(DATA, "engine_runs.csv")
    if not os.path.exists(csv):
        build_main(30)
    df = pd.read_csv(csv)
    meta = json.load(open(os.path.join(DATA, "meta.json")))
    # --- EWMA smoothing of the physics residuals (mirrored in the JS runtime)
    ALPHA = 0.1
    df[RESID] = df.groupby("unit")[RESID].transform(lambda x: x.ewm(alpha=ALPHA).mean())
    meta["mean"] = df[FEATURES].mean().tolist()
    meta["std"] = (df[FEATURES].std() + 1e-3).tolist()
    meta["resid_alpha"] = ALPHA
    json.dump(meta, open(os.path.join(DATA, "meta.json"), "w"), indent=2)
    mu, sd = np.array(meta["mean"]), np.array(meta["std"])
    X = np.clip((df[FEATURES].values - mu) / sd, -8, 8).astype(np.float64)

    rng = np.random.default_rng(11)
    units = df["unit"].unique()
    test_units = set(units[::6])
    tr = ~df["unit"].isin(test_units).values
    te = ~tr

    # 1) auto-encoder on healthy training data only
    hi = df["health_index"].values
    healthy = tr & (hi > 92.0)
    AE = train_autoencoder(X[healthy], rng)
    err_h, _ = ae_error(AE, X[healthy])
    thr = float(np.quantile(err_h, 0.995))
    err_all, _ = ae_error(AE, X)
    det = float((err_all[te & (hi < 80.0)] > thr).mean())        # true degraded state
    fpr = float((err_all[te & (hi > 96.0)] > thr).mean())         # genuinely healthy
    print(f"[AE ] threshold={thr:.4f}  detection={det:.1%}  false-alarm={fpr:.2%}")

    # 2) fault classifier
    cls_idx = {c: i for i, c in enumerate(FAULT_CLASSES)}
    y = np.zeros((len(df), len(FAULT_CLASSES)))
    y[np.arange(len(df)), [cls_idx[c] for c in df["fault"]]] = 1
    # The classifier deliberately EXCLUDES the `t` (engine-hours) feature: root cause
    # must be inferred from the physics residuals alone, so an injected fault on a
    # freshly overhauled engine is still classified correctly.
    clf_idx = [FEATURES.index(f) for f in RAW + RESID]
    Xc = X[:, clf_idx]
    # class-balanced resampling — NOMINAL dominates a run-to-failure corpus ~5:1
    ytr_lab = y[tr].argmax(1)
    tr_rows = np.flatnonzero(tr)
    per = int(np.median(np.bincount(ytr_lab, minlength=len(FAULT_CLASSES))[
        np.bincount(ytr_lab, minlength=len(FAULT_CLASSES)) > 0]))
    bal = []
    for c in range(len(FAULT_CLASSES)):
        idx = tr_rows[ytr_lab == c]
        if len(idx) == 0:
            continue
        bal.append(rng.choice(idx, size=per, replace=len(idx) < per))
    bal = np.concatenate(bal)
    rng.shuffle(bal)
    CLF = train_mlp(Xc[bal], y[bal], rng, hidden=(64, 32), task="clf", epochs=60)
    pred = mlp_forward(CLF, Xc[te], "clf").argmax(1)
    true = y[te].argmax(1)
    acc = float((pred == true).mean())
    bal_acc = float(np.mean([(pred[true == c] == c).mean()
                             for c in range(len(FAULT_CLASSES)) if (true == c).any()]))
    print(f"[CLF] test accuracy = {acc:.1%}  |  balanced (macro-recall) = {bal_acc:.1%}")

    # 3) RUL regressor (log-compressed target)
    CAP = 600.0                       # piecewise-linear RUL cap (C-MAPSS practice)
    rul = np.minimum(df["RUL"].values, CAP).reshape(-1, 1)
    rul_n = rul / CAP
    RUL = train_mlp(X[tr], rul_n[tr], rng, hidden=(64, 32), task="reg", epochs=60, lr=2e-3)
    p = mlp_forward(RUL, X[te], "reg")
    hrs = np.clip(p, 0, 1.1) * CAP
    meta["rul_scale"] = CAP
    mae = float(np.abs(hrs - rul[te]).mean())
    near = (rul[te] < 200).ravel()
    mae_near = float(np.abs(hrs[near] - rul[te][near]).mean())
    print(f"[RUL] test MAE = {mae:.1f} h  |  MAE within 200 h of failure = {mae_near:.1f} h  (cap {CAP:.0f} h)")

    def pack(P):
        return [np.round(p, 5).tolist() for p in P]

    bundle = dict(
        schema="aerotwin-dt/1.0", features=FEATURES, classes=FAULT_CLASSES,
        norm=dict(mean=[round(v, 5) for v in meta["mean"]], std=[round(v, 5) for v in meta["std"]]),
        autoencoder=dict(params=pack(AE), threshold=round(thr, 5), act="tanh"),
        classifier=dict(params=pack(CLF), act="relu", feature_idx=clf_idx,
                        features=[FEATURES[i] for i in clf_idx]),
        rul=dict(params=pack(RUL), scale=CAP, act="relu"),
        resid_alpha=ALPHA,
        metrics=dict(ae_detection=det, ae_false_alarm=fpr, clf_accuracy=acc, clf_balanced_acc=bal_acc, rul_mae_h=mae, rul_mae_near_h=mae_near),
        trained_rows=int(tr.sum()),
    )
    out = os.path.join(os.path.dirname(HERE), "web", "assets", "dt_models.json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    json.dump(bundle, open(out, "w"))
    json.dump(bundle, open(os.path.join(DATA, "dt_models.json"), "w"))
    print(f"[export] {out}  ({os.path.getsize(out)/1024:.0f} kB)")


if __name__ == "__main__":
    main()
