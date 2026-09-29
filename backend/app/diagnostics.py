"""
AeroTwin-DT :: health indexing, fault reasoning and maintenance advisory
(Python port of the original web/js/diagnostics.js — now server-authoritative
so every client, replay and the fleet view all agree.)

Layer 1 — certifiable threshold monitor (deterministic, ARINC-style limits)
Layer 2 — physics-residual health indices (observable estimation, no truth)
Layer 3 — ML posterior fused with layers 1-2 into an advisory
"""
from __future__ import annotations
from typing import Any, Dict, List

LIMITS = {
    "rpm":       {"warn": 5600, "alarm": 5900, "unit": "rpm", "label": "Engine speed"},
    "cht":       {"warn": 150,  "alarm": 175,  "unit": "\u00b0C", "label": "Cylinder head temp"},
    "egt":       {"warn": 880,  "alarm": 950,  "unit": "\u00b0C", "label": "Exhaust gas temp"},
    "oil_t":     {"warn": 125,  "alarm": 140,  "unit": "\u00b0C", "label": "Oil temperature"},
    "oil_p":     {"warn": 1.8,  "alarm": 1.2,  "unit": "bar", "label": "Oil pressure", "low": True},
    "coolant_t": {"warn": 120,  "alarm": 135,  "unit": "\u00b0C", "label": "Coolant temp"},
    "vib":       {"warn": 2.2,  "alarm": 3.0,  "unit": "g", "label": "Vibration RMS"},
    "bus_v":     {"warn": 12.6, "alarm": 11.8, "unit": "V", "label": "Bus voltage", "low": True},
    "map_kpa":   {"warn": 145,  "alarm": 160,  "unit": "kPa", "label": "Manifold pressure"},
}

SUBSYSTEMS = [
    {"id": "combustion",  "label": "Combustion & ignition", "parts": ["cyl0", "cyl1", "cyl2", "cyl3", "ignition"]},
    {"id": "fuel",        "label": "Fuel & injection",       "parts": ["fuelrail", "injector"]},
    {"id": "cooling",     "label": "Cooling circuit",        "parts": ["radiator", "head"]},
    {"id": "lubrication", "label": "Lubrication",            "parts": ["sump", "oilpump"]},
    {"id": "rotating",    "label": "Rotating assembly",      "parts": ["crankcase", "prop"]},
    {"id": "induction",   "label": "Induction & turbo",      "parts": ["turbo", "intake"]},
    {"id": "electrical",  "label": "Electrical / battery",   "parts": ["alternator", "ecu"]},
    {"id": "sensors",     "label": "Sensor chain",           "parts": ["ecu"]},
]


def _clamp01(x: float) -> float:
    return min(1.0, max(0.0, x))


def _idx(dev: float, scale: float) -> int:
    return round(100 * (1 - _clamp01(abs(dev) / scale)))


def check_limits(tm: Dict[str, Any]) -> List[Dict[str, Any]]:
    out = []
    for k, lim in LIMITS.items():
        v = tm.get(k)
        if v is None:
            continue
        exceeded = v < lim["alarm"] if lim.get("low") else v > lim["alarm"]
        warned = v < lim["warn"] if lim.get("low") else v > lim["warn"]
        if exceeded:
            out.append({"key": k, "sev": "alarm", "label": lim["label"], "value": v, "limit": lim["alarm"], "unit": lim["unit"]})
        elif warned:
            out.append({"key": k, "sev": "warn", "label": lim["label"], "value": v, "limit": lim["warn"], "unit": lim["unit"]})
    return out


def _base_vib(rpm: float) -> float:
    return 0.28 + 0.85 * ((rpm or 1400) / 5800) ** 1.6


def health_indices(resid: Dict[str, float], tm: Dict[str, Any]) -> Dict[str, float]:
    r = resid or {}
    h = {
        "combustion": _idx((r.get("egt", 0)) / 40 + tm.get("misfire", 0) * 6, 6),
        "fuel": _idx((r.get("fuel_flow", 0)) / 0.9 + (r.get("inj_act", 0)) / 1.4, 5),
        "cooling": _idx((r.get("cht", 0)) / 7, 6),
        "lubrication": _idx((r.get("oil_p", 0)) / 0.28 + max(0.0, r.get("oil_t", 0)) / 9, 6),
        "rotating": _idx(max(0.0, (tm.get("vib_1x", 0)) - 0.55 * _base_vib(tm.get("rpm"))) / 0.25, 6),
        "induction": _idx((r.get("bsfc", 0)) / 22, 6),
        "electrical": _idx((r.get("bus_v", 0)) / 0.32 + (1 - (tm.get("soc") or 1)) * 3, 6),
        "sensors": _idx(((r.get("cht", 0)) / 8 - (r.get("egt", 0)) / 60), 6),
    }
    vals = list(h.values())
    h["overall"] = round(min(vals) * 0.6 + (sum(vals) / len(vals)) * 0.4)
    return h


def fault_rules(resid: Dict[str, float], tm: Dict[str, Any], h: Dict[str, float]) -> List[Dict[str, Any]]:
    r = resid or {}
    out: List[Dict[str, Any]] = []

    def add(id_, sev, title, evidence, action, part):
        out.append({"id": id_, "sev": sev, "title": title, "evidence": evidence, "action": action, "part": part})

    misfire = tm.get("misfire", 0) or 0
    if misfire > 0.06:
        add("MISFIRE", "alarm" if misfire > 0.2 else "warn", "Misfire detected",
            f"0.5x vibration order {tm.get('vib_half', 0):.2f} g, misfire index {misfire*100:.0f}%",
            "Inspect plugs/coils on the coolest-EGT cylinder; check injector spray pattern.", "ignition")
    egts = tm.get("cylEGT") or []
    if len(egts) >= 2:
        spread = max(egts) - min(egts)
        if spread > 50:
            worst = min(range(len(egts)), key=lambda i: egts[i])
            add("COMBUSTION_INSTABILITY", "alarm" if spread > 75 else "warn", "Combustion instability",
                f"Cylinder-to-cylinder EGT spread {spread:.0f} \u00b0C (nominal < 45); coolest is cylinder {worst + 1}",
                f"Compare cylinders {worst + 1} vs hottest: check ignition energy, injector balance and mixture; trend the spread over the next 3 sorties.",
                f"cyl{worst}")
    if (r.get("fuel_flow", 0) < -0.55) or (r.get("inj_act", 0) < -0.9):
        add("INJECTOR_FOUL", "warn", "Injector delivery shortfall",
            f"Fuel-flow residual {r.get('fuel_flow', 0):.2f} kg/h vs twin, timing residual {r.get('inj_act', 0):.2f}\u00b0",
            "Schedule injector flow test / ultrasonic clean at next A-check.", "fuelrail")
    if r.get("cht", 0) > 6:
        add("COOLING_DEGRADED", "alarm" if r.get("cht", 0) > 14 else "warn", "Cooling effectiveness loss",
            f"CHT running {r.get('cht', 0):.1f} \u00b0C above synchronised twin at same power/altitude",
            "Inspect radiator core for fouling/blockage; verify coolant charge and duct seals.", "radiator")
    if (r.get("oil_p", 0) < -0.25) or (r.get("oil_t", 0) > 8):
        add("LUBRICATION", "alarm" if r.get("oil_p", 0) < -0.5 else "warn", "Lubrication degradation",
            f"Oil-pressure residual {r.get('oil_p', 0):.2f} bar, oil-temp residual {r.get('oil_t', 0):.1f} \u00b0C",
            "Sample oil for viscosity/metal content; inspect pump relief valve and filter dP.", "sump")
    if (tm.get("vib_1x", 0) or 0) > 0.55 * _base_vib(tm.get("rpm")) + 0.28:
        add("BEARING_WEAR", "warn", "Abnormal 1x vibration growth",
            f"1x order band {tm.get('vib_1x', 0):.2f} g against {0.55*_base_vib(tm.get('rpm')):.2f} g baseline",
            "Trend 1x order; borescope main/rod bearings if growth exceeds 0.1 g / 10 h.", "crankcase")
    if abs((r.get("cht", 0) / 8) - (r.get("egt", 0) / 60)) > 1.1 and h["cooling"] < 92:
        add("SENSOR_DRIFT", "warn", "Probable sensor drift",
            "CHT and EGT residuals inconsistent with a single physical cause",
            "Cross-check probe calibration; compare redundant channel before crediting the fault.", "ecu")
    soc = tm.get("soc") if tm.get("soc") is not None else 1
    if (r.get("bus_v", 0) < -0.3) or (soc < 0.5):
        add("ELECTRICAL", "alarm" if soc < 0.3 else "warn", "Charging system weak",
            f"Bus {tm.get('bus_v', 0):.2f} V, SOC {soc*100:.0f}%",
            "Check alternator belt/regulator and battery internal resistance.", "alternator")
    if tm.get("cht", 0) > LIMITS["cht"]["warn"]:
        add("OVERHEAT", "alarm" if tm.get("cht", 0) > LIMITS["cht"]["alarm"] else "warn", "Overheating trend",
            f"CHT {tm.get('cht', 0):.0f} \u00b0C approaching {LIMITS['cht']['alarm']} \u00b0C limit",
            "Reduce power 10%, increase airspeed for cooling flow, re-evaluate in 3 min.", "head")
    return out


def advisory(rul_h: float, faults: List[Dict[str, Any]], h: Dict[str, float]) -> Dict[str, str]:
    critical = [f for f in faults if f["sev"] == "alarm"]
    level, text = "ROUTINE", "No action required. Continue scheduled 50 h inspection cycle."
    if rul_h < 25 or critical:
        level = "IMMEDIATE"
        text = f"Ground the asset after this sortie. {critical[0]['action'] if critical else 'Investigate dominant degradation mode.'}"
    elif rul_h < 80 or len(faults) >= 2:
        level = "PRIORITY"
        text = f"Raise a work order within {max(5, round(rul_h / 4))} flight hours. {faults[0]['action'] if faults else ''}"
    elif rul_h < 200 or h["overall"] < 88:
        level = "PLANNED"
        text = f"Fold inspection into the next scheduled maintenance window (~{round(rul_h / 2)} h)."
    return {"level": level, "text": text}


def mission_readiness(h: Dict[str, float], rul_h: float, faults: List[Dict[str, Any]]) -> Dict[str, str]:
    alarms = sum(1 for f in faults if f["sev"] == "alarm")
    if alarms or h["overall"] < 60 or rul_h < 15:
        return {"state": "NO-GO", "color": "crit"}
    if faults or h["overall"] < 82 or rul_h < 60:
        return {"state": "GO / RESTRICTED", "color": "warn"}
    return {"state": "GO", "color": "ok"}
