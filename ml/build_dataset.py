"""
AeroTwin-DT :: run-to-failure dataset builder
=============================================
Generates a NASA-C-MAPSS-style run-to-failure corpus for the AE-115T aero
piston engine using the physics-informed plant model in simulator.py.

Output:
    data/engine_runs.csv   -- full telemetry + health + RUL labels
    data/meta.json         -- feature list, normalisation stats, class map
"""
from __future__ import annotations
import json, math, os, sys
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from simulator import AeroPistonEngine, mission_profile, TOTAL_MISSION_S, HEALTH_KEYS

# --- raw sensor channels + physics-informed residuals (measured - twin) -----
RAW = ["rpm", "map_kpa", "fuel_flow", "egt", "cht", "oil_p", "oil_t",
       "coolant_t", "vib", "vib_1x", "vib_half", "bus_v", "inj_act",
       "throttle", "alt_m", "oat_c"]
RESID = ["r_rpm", "r_fuel_flow", "r_egt", "r_cht", "r_oil_p", "r_oil_t",
         "r_vib", "r_vib_half", "r_bus_v", "r_inj_act", "r_bsfc"]
FEATURES = RAW + RESID + ["t"]        # `t` = hours since last overhaul (known on-wing)

FAULT_CLASSES = ["NOMINAL", "MISFIRE", "INJECTOR_FOUL", "COOLING_DEGRADED",
                 "LUBRICATION", "BEARING_WEAR", "SENSOR_DRIFT", "COMBUSTION_INSTAB"]

FAIL_THRESHOLD = 0.80          # a health channel above this = functional failure


def label_fault(row):
    """Weak-supervision labeller driven by the ground-truth health vector."""
    h = {k: row["h_" + k] for k in HEALTH_KEYS}
    if row["misfire"] > 0.18:
        return "MISFIRE"
    dom, val = max(h.items(), key=lambda kv: kv[1])
    if val < 0.22:
        return "NOMINAL"
    return {
        "injector_clog": "INJECTOR_FOUL",
        "cooling_fouling": "COOLING_DEGRADED",
        "oil_degradation": "LUBRICATION",
        "bearing_wear": "BEARING_WEAR",
        "sensor_drift": "SENSOR_DRIFT",
        "ignition_wear": "COMBUSTION_INSTAB",
        "ring_wear": "COMBUSTION_INSTAB",
    }[dom]


def simulate_unit(unit_id, rng, dt=60.0, sample_every=5, max_hours=2000.0):
    """One engine, flown mission after mission until functional failure."""
    scenario = rng.choice(["standard", "standard", "hot_day", "high_alt", "transients"])
    seed = int(rng.integers(1e6))
    eng = AeroPistonEngine(seed=seed)
    ref = AeroPistonEngine(seed=seed + 1)          # healthy shadow twin (physics baseline)
    # per-unit manufacturing spread
    for k in HEALTH_KEYS:
        eng.h[k] = float(abs(rng.normal(0, 0.015)))
    deg_rate = float(rng.uniform(0.7, 2.2))          # per-unit duty severity
    for k in HEALTH_KEYS:                            # dominant-mode spread across fleet
        eng.rate_mult[k] = float(rng.uniform(0.35, 1.15))
    eng.rate_mult[str(rng.choice(HEALTH_KEYS))] = float(rng.uniform(1.8, 3.2))
    rows, t, i = [], 0.0, 0
    while eng.hours < max_hours:
        phase, thr, alt, dev, tas = mission_profile(t % TOTAL_MISSION_S, scenario)
        r = eng.step(dt, thr, alt, dev, tas, deg_rate=deg_rate)
        b = ref.step(dt, thr, alt, dev, tas, deg_rate=0.0)   # never degrades
        if i % sample_every == 0:
            for key in ["rpm", "fuel_flow", "egt", "cht", "oil_p", "oil_t",
                        "vib", "vib_half", "bus_v", "inj_act", "bsfc"]:
                r["r_" + key] = r[key] - b[key]
            r.pop("cylEGT", None); r.pop("cylCHT", None)   # per-cylinder arrays are
            r["unit"] = unit_id                            # for the 3D twin, not the models
            r["phase"] = phase
            r["scenario"] = scenario
            rows.append(r)
        t += dt
        i += 1
        if max(eng.h.values()) >= FAIL_THRESHOLD:
            break
    df = pd.DataFrame(rows)
    df["RUL"] = df["t"].iloc[-1] - df["t"]            # hours to functional failure
    df["fault"] = df.apply(label_fault, axis=1)
    df["health_index"] = 100.0 * (1.0 - df[[f"h_{k}" for k in HEALTH_KEYS]].max(axis=1) / FAIL_THRESHOLD)
    return df


def main(n_units=40, out_dir=None):
    out_dir = out_dir or os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
    os.makedirs(out_dir, exist_ok=True)
    rng = np.random.default_rng(7)
    frames = [simulate_unit(u, rng) for u in range(n_units)]
    df = pd.concat(frames, ignore_index=True)
    df.to_csv(os.path.join(out_dir, "engine_runs.csv"), index=False)

    healthy = df[df["health_index"] > 88.0]
    meta = dict(
        features=FEATURES,
        fault_classes=FAULT_CLASSES,
        mean=healthy[FEATURES].mean().tolist(),
        std=(healthy[FEATURES].std() + 1e-6).tolist(),
        rul_scale=float(df["RUL"].max()),
        rows=int(len(df)), units=int(n_units),
    )
    with open(os.path.join(out_dir, "meta.json"), "w") as f:
        json.dump(meta, f, indent=2)
    print(f"[dataset] {len(df):,} rows / {n_units} units -> {out_dir}")
    print(df.groupby("fault").size())
    return df, meta


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 40)
