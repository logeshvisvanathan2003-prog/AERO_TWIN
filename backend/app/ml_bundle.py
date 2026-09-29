"""
AeroTwin-DT :: trained-model runtime (pure NumPy — no TF/torch needed to serve)

Loads dt_models.json, which is exported by ml/AeroTwin_DT_Training.ipynb
(Colab) or ml/train_export.py. The bundle stores flat dense-layer weights
per model [W0, b0, W1, b1, ...], which is intentionally ONNX/Gemm-shaped so
this same loader is a drop-in stand-in for an onnxruntime session later.
"""
from __future__ import annotations
import json
from pathlib import Path
from typing import Any, Dict, List, Optional
import numpy as np


class ModelBundle:
    RESID_KEYS = ["rpm", "fuel_flow", "egt", "cht", "oil_p", "oil_t",
                  "vib", "vib_half", "bus_v", "inj_act", "bsfc"]
    RAW_KEYS = ["rpm", "map_kpa", "fuel_flow", "egt", "cht", "oil_p", "oil_t",
                "coolant_t", "vib", "vib_1x", "vib_half", "bus_v", "inj_act",
                "throttle", "alt_m", "oat_c"]

    def __init__(self, path: Path):
        self.ready = False
        self.path = path
        try:
            self.m = json.loads(Path(path).read_text())
        except Exception as exc:
            print(f"[ml_bundle] bundle unavailable ({exc}); serving raw telemetry only")
            return
        self.features: List[str] = self.m["features"]
        self.classes: List[str] = self.m["classes"]
        self.mean = np.array(self.m["norm"]["mean"], dtype=np.float64)
        self.std = np.array(self.m["norm"]["std"], dtype=np.float64)
        self.alpha = float(self.m.get("resid_alpha", 0.1))
        self.thr = float(self.m["autoencoder"]["threshold"])
        self.rul_scale = float(self.m["rul"]["scale"])
        self.metrics = self.m.get("metrics", {})
        self.resid = {k: 0.0 for k in self.RESID_KEYS}
        self.ready = True
        print(f"[ml_bundle] loaded — {len(self.features)} features, "
              f"{len(self.classes)} fault classes, AE threshold {self.thr:.5f}")

    def fork(self) -> "ModelBundle":
        """Cheap per-drone copy: shares the (read-only) weights, owns its residual filter state."""
        import copy
        c = copy.copy(self)
        if self.ready:
            c.resid = {k: 0.0 for k in self.RESID_KEYS}
        return c

    @staticmethod
    def _dense(params: List[Any], x: np.ndarray, act: str, final: Optional[str] = None):
        a = x
        for li in range(0, len(params) - 2, 2):
            a = a @ np.asarray(params[li], dtype=np.float64) + np.asarray(params[li + 1])
            a = np.tanh(a) if act == "tanh" else np.maximum(a, 0.0)
        out = a @ np.asarray(params[-2], dtype=np.float64) + np.asarray(params[-1])
        if final == "softmax":
            e = np.exp(out - out.max())
            return e / e.sum()
        return out

    def featurize(self, tm: Dict[str, Any], base: Dict[str, Any]) -> np.ndarray:
        a = self.alpha
        for k in self.RESID_KEYS:
            d = float(tm.get(k, 0.0)) - float(base.get(k, 0.0))
            self.resid[k] = (1 - a) * self.resid[k] + a * d
        raw = [float(tm.get(k, 0.0)) for k in self.RAW_KEYS]
        res = [self.resid[k] for k in self.RESID_KEYS]
        return np.array(raw + res + [float(tm.get("t", 0.0))], dtype=np.float64)

    def infer(self, tm: Dict[str, Any], base: Dict[str, Any]) -> Dict[str, Any]:
        if not self.ready:
            return {}
        f = self.featurize(tm, base)
        x = np.clip((f - self.mean) / self.std, -8, 8)

        rec = self._dense(self.m["autoencoder"]["params"], x, self.m["autoencoder"]["act"])
        per = (rec - x) ** 2
        err = float(per.mean())
        score = err / self.thr

        order = np.argsort(-per)[:6]
        attrib = [{"feature": self.features[i],
                   "share": float(per[i] / (err * len(per) + 1e-9)),
                   "value": float(f[i]),
                   "deviation": float(x[i] - rec[i])} for i in order]

        ci = self.m["classifier"].get("feature_idx")
        xc = x[ci] if ci else x
        probs = self._dense(self.m["classifier"]["params"], xc, self.m["classifier"]["act"], "softmax")
        rul_n = float(self._dense(self.m["rul"]["params"], x, self.m["rul"]["act"])[0])
        rul_h = min(max(rul_n, 0.0), 1.1) * self.rul_scale
        ranked = sorted(({"cls": c, "p": float(p)} for c, p in zip(self.classes, probs)), key=lambda d: -d["p"])

        return {
            "score": score, "err": err, "threshold": self.thr,
            "anomalous": bool(score > 1.0), "attrib": attrib,
            "probs": ranked, "fault": ranked[0]["cls"], "fault_conf": ranked[0]["p"],
            "rul_h": rul_h,
            "resid": dict(self.resid),
        }
