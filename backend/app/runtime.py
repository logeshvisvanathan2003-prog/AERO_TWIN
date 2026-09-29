"""
AeroTwin-DT :: per-drone live digital-twin runtime
==============================================================================
Every registered drone owns one DroneRuntime:

  plant   physics-informed engine model (the "physical" engine, degrading)
  shadow  healthy twin fed the identical inputs (physics residual reference)
  models  private fork of the trained ML bundle (own residual filter state)
  buffer  in-memory ring of recent frames (live charts / replay)
  clients websocket subscribers (each already authorised for THIS drone)

Data source
  simulated  the runtime advances its own plant every second (demo / test rig)
  live_can   frames are pushed by the CAN edge gateway via POST /api/ingest/{tail};
             the shadow twin is stepped from the *measured* operating point
"""
from __future__ import annotations

import asyncio
import json
import random
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set

import numpy as np

from . import config as C
from . import diagnostics as D
from .ml_bundle import ModelBundle
from .sim.engine import AeroPistonEngine, mission_profile, TOTAL_MISSION_S, isa

BASE_MODELS = ModelBundle(C.MODELS_PATH)


@dataclass(eq=False)
class Client:
    ws: Any
    user_id: int
    connected_at: float = field(default_factory=time.time)


# user_id -> timestamp; any socket opened before it is closed (assignment / role change, disable, reset)
REVOKED_BEFORE: Dict[int, float] = {}

REG: Dict[str, "DroneRuntime"] = {}


class MissionAcc:
    """Running statistics for the sortie in progress -> mission-wise health report."""

    def __init__(self, t0: float, scenario: str):
        self.t0 = t0
        self.scenario = scenario
        self.partial = (t0 % TOTAL_MISSION_S) > 5.0
        self.n = 0
        self.dur = 0.0
        self.fuel_kg = 0.0
        self.thr_sum = 0.0
        self.bsfc_sum = 0.0
        self.max_cht = 0.0
        self.max_egt = 0.0
        self.max_oil_t = 0.0
        self.min_oil_p = 99.0
        self.max_vib = 0.0
        self.max_misfire = 0.0
        self.max_alt = 0.0
        self.health_start: Optional[float] = None
        self.health_end = 100.0
        self.health_min = 100.0
        self.rul_start: Optional[float] = None
        self.rul_end = 0.0
        self.faults: Dict[str, Dict[str, Any]] = {}
        self.limit_breaches: Dict[str, int] = {}
        self.subsystems_min: Dict[str, float] = {}

    def add(self, f: Dict[str, Any], dt: float):
        self.n += 1
        self.dur += dt
        self.fuel_kg += (f.get("fuel_flow") or 0) * dt / 3600.0
        self.thr_sum += f.get("throttle") or 0
        self.bsfc_sum += f.get("bsfc") or 0
        self.max_cht = max(self.max_cht, f.get("cht") or 0)
        self.max_egt = max(self.max_egt, f.get("egt") or 0)
        self.max_oil_t = max(self.max_oil_t, f.get("oil_t") or 0)
        self.min_oil_p = min(self.min_oil_p, f.get("oil_p") if f.get("oil_p") is not None else 99)
        self.max_vib = max(self.max_vib, f.get("vib") or 0)
        self.max_misfire = max(self.max_misfire, f.get("misfire") or 0)
        self.max_alt = max(self.max_alt, f.get("alt_m") or 0)
        h = f.get("health", {}).get("overall")
        if h is not None:
            if self.health_start is None:
                self.health_start = h
            self.health_end = h
            self.health_min = min(self.health_min, h)
            for k, v in f["health"].items():
                if k != "overall":
                    self.subsystems_min[k] = min(self.subsystems_min.get(k, 100), v)
        rul = (f.get("inference") or {}).get("rul_h")
        if rul is not None:
            if self.rul_start is None:
                self.rul_start = rul
            self.rul_end = rul
        for x in f.get("faults", []):
            e = self.faults.setdefault(x["id"], {"title": x["title"], "sev": x["sev"], "frames": 0, "part": x["part"], "action": x["action"]})
            e["frames"] += 1
            if x["sev"] == "alarm":
                e["sev"] = "alarm"
        for l in f.get("limits", []):
            self.limit_breaches[l["key"]] = self.limit_breaches.get(l["key"], 0) + 1

    def finalize(self, code: str, tail: str) -> Dict[str, Any]:
        n = max(1, self.n)
        alarms = [k for k, v in self.faults.items() if v["sev"] == "alarm"]
        if alarms or self.health_end < 60 or self.rul_end < 15:
            verdict = "NO-GO"
        elif self.faults or self.health_end < 82 or self.rul_end < 60:
            verdict = "RESTRICTED"
        else:
            verdict = "NOMINAL"
        return {
            "code": code, "tail": tail, "scenario": self.scenario, "partial": self.partial,
            "duration_s": round(self.dur, 1), "verdict": verdict,
            "fuel_kg": round(self.fuel_kg, 2), "avg_throttle_pct": round(100 * self.thr_sum / n, 1),
            "avg_bsfc": round(self.bsfc_sum / n, 1), "max_alt_m": round(self.max_alt),
            "max_cht": round(self.max_cht, 1), "max_egt": round(self.max_egt, 1),
            "max_oil_t": round(self.max_oil_t, 1), "min_oil_p": round(self.min_oil_p, 2),
            "max_vib": round(self.max_vib, 2), "max_misfire_pct": round(100 * self.max_misfire, 1),
            "health_start": self.health_start, "health_end": self.health_end, "health_min": self.health_min,
            "rul_start_h": round(self.rul_start or 0, 1), "rul_end_h": round(self.rul_end, 1),
            "subsystem_min": self.subsystems_min,
            "faults": [{"id": k, **v} for k, v in self.faults.items()],
            "limit_breaches": self.limit_breaches,
        }


class DroneRuntime:
    def __init__(self, tail: str, engine_id: int, source: str = "simulated", seed: int = 7,
                 health: Optional[Dict[str, float]] = None, base_hours: float = 0.0,
                 t0: float = 0.0, mission_seq: int = 0):
        self.tail = tail
        self.engine_id = engine_id
        self.source = source
        self.models = BASE_MODELS.fork()
        self.plant = AeroPistonEngine(health=dict(health) if health else None, seed=seed)
        self.shadow = AeroPistonEngine(seed=seed)
        self.t = t0
        self.base_hours = base_hours
        self.scenario = "standard"
        self.deg_rate = 120.0
        self.noise = 1.0
        self.speed = C.DEFAULT_SPEED
        self.auto = True
        self.running = True
        self.manual: Dict[str, float] = {}
        self.buffer: deque = deque(maxlen=C.HISTORY_RING)
        self.clients: Set[Client] = set()
        self.last: Dict[str, Any] = {}
        self.frame_count = 0
        self.active_faults: Set[str] = set()
        self.active_limits: Set[str] = set()
        self.mission_seq = mission_seq
        self.acc = MissionAcc(t0, self.scenario)
        self.last_ingest: Optional[float] = None

    # ---------------------------------------------------------- commands
    def apply_command(self, cmd: str, body: Dict[str, Any]) -> Dict[str, Any]:
        if cmd == "inject" and body.get("mode"):
            if body["mode"] not in self.plant.h:
                return {"ok": False, "error": "unknown degradation mode"}
            self.plant.h[body["mode"]] = float(np.clip(body.get("value") or 0.0, 0, 1))
            return {"ok": True}
        if cmd == "overhaul":
            self.plant = AeroPistonEngine(seed=random.randint(0, 999999))
            self.models.resid = {k: 0.0 for k in self.models.RESID_KEYS} if self.models.ready else {}
            return {"ok": True, "engine": "zero-timed"}
        if cmd == "rate":
            self.deg_rate = float(np.clip(body.get("value") or 0.0, 0, 600)); return {"ok": True, "deg_rate": self.deg_rate}
        if cmd == "noise":
            self.noise = float(np.clip(body.get("value") or 1.0, 0, 4)); return {"ok": True, "noise": self.noise}
        if cmd == "speed":
            v = body.get("speed") or body.get("value") or C.DEFAULT_SPEED
            self.speed = float(np.clip(v, 1, 240)); return {"ok": True, "speed": self.speed}
        if cmd == "scenario":
            self.scenario = body.get("scenario") or "standard"; return {"ok": True, "scenario": self.scenario}
        if cmd == "auto":
            self.auto = bool(body.get("auto")); return {"ok": True, "auto": self.auto}
        if cmd == "manual":
            for k in ("throttle", "alt_m", "isa_dev_c", "tas_ms"):
                if body.get(k) is not None:
                    self.manual[k] = float(body[k])
            return {"ok": True, "manual": self.manual}
        if cmd == "pause":
            self.running = False; return {"ok": True}
        if cmd == "resume":
            self.running = True; return {"ok": True}
        return {"ok": False, "error": "unsupported command"}

    # ------------------------------------------------------------ stepping
    def advance(self) -> Dict[str, Any]:
        """Advance the simulated plant by one 1 Hz tick (× time acceleration) and return the frame."""
        dt = 1.0 * self.speed
        self.t += dt
        phase, thr, alt, isa_dev, tas = mission_profile(self.t % TOTAL_MISSION_S, self.scenario)
        if not self.auto:
            thr = self.manual.get("throttle", thr)
            alt = self.manual.get("alt_m", alt)
            isa_dev = self.manual.get("isa_dev_c", isa_dev)
            tas = self.manual.get("tas_ms", tas)
            phase = "MANUAL"
        tm = self.plant.step(dt, thr, alt, isa_dev, tas, self.deg_rate)
        base = self.shadow.step(dt, thr, alt, isa_dev, tas, 0.0)
        tm["phase"] = phase
        return self.finish(tm, base, dt)

    def ingest(self, raw: Dict[str, Any]) -> Dict[str, Any]:
        """Build a frame from *measured* CAN/ECU data pushed by the edge gateway."""
        now = time.time()
        dt = 1.0 if self.last_ingest is None else float(np.clip(now - self.last_ingest, 0.2, 30.0))
        self.last_ingest = now
        self.t += dt
        alt = float(raw.get("alt_m", 0.0))
        oat = float(raw.get("oat_c", 15.0))
        thr = float(np.clip(raw.get("throttle", 0.5), 0, 1))
        _, t_isa_k, _ = isa(alt, 0.0)
        isa_dev = (oat + 273.15) - t_isa_k
        base = self.shadow.step(dt, thr, alt, isa_dev, float(raw.get("tas_ms", 50.0)), 0.0)
        tm = dict(base)
        missing = [k for k in ModelBundle.RAW_KEYS if k not in raw]
        for k, v in raw.items():
            if isinstance(v, (int, float)) or k in ("cylCHT", "cylEGT"):
                tm[k] = v
        tm["throttle"] = thr
        tm["t"] = self.t
        tm["phase"] = str(raw.get("phase", "LIVE"))[:24]
        frame = self.finish(tm, base, dt)
        frame["missing_channels"] = missing
        return frame

    def finish(self, tm: Dict[str, Any], base: Dict[str, Any], dt: float) -> Dict[str, Any]:
        frame = self.build_frame(tm, base)
        self.frame_count += 1
        self.buffer.append(frame)
        self.last = frame
        self.acc.add(frame, dt)
        return frame

    def build_frame(self, tm: Dict[str, Any], base: Dict[str, Any]) -> Dict[str, Any]:
        inf = self.models.infer(tm, base) if self.models.ready else {}
        resid = inf.get("resid", {}) if inf else {}
        limits = D.check_limits(tm)
        health = D.health_indices(resid, tm)
        faults = D.fault_rules(resid, tm, health)
        rul_h = inf.get("rul_h", 400.0)
        return {
            "tail": self.tail, "source": self.source,
            "ts": time.time(), "mission_t": self.t, "phase": tm.get("phase", "LIVE"),
            **{k: (round(v, 4) if isinstance(v, float) else v) for k, v in tm.items() if not isinstance(v, (list, dict))},
            "cylCHT": [round(float(x), 2) for x in tm.get("cylCHT", [])],
            "cylEGT": [round(float(x), 2) for x in tm.get("cylEGT", [])],
            "twin": {k: round(base[k], 4) for k in ("rpm", "cht", "egt", "oil_p", "oil_t", "vib", "fuel_flow", "bsfc",
                                                  "bus_v", "inj_act", "vib_half") if k in base},
            "ground_truth_health": {k: round(v, 4) for k, v in self.plant.h.items()} if self.source == "simulated" else {},
            "sim_config": {"auto": self.auto, "scenario": self.scenario, "deg_rate": self.deg_rate,
                           "noise": self.noise, "manual": dict(self.manual), "speed": self.speed,
                           "running": self.running},
            "inference": inf, "limits": limits, "health": health, "faults": faults,
            "advisory": D.advisory(rul_h, faults, health),
            "readiness": D.mission_readiness(health, rul_h, faults),
        }

    # ------------------------------------------------------------- events
    def diff_events(self, frame: Dict[str, Any]) -> Dict[str, Any]:
        """New fault onsets / new alarm-level limit breaches since the previous frame."""
        cur = {f["id"]: f for f in frame["faults"]}
        new_faults = [cur[k] for k in cur if k not in self.active_faults]
        self.active_faults = set(cur)
        lim = {l["key"]: l for l in frame["limits"] if l["sev"] == "alarm"}
        new_limits = [lim[k] for k in lim if k not in self.active_limits]
        self.active_limits = set(lim)
        return {"new_faults": new_faults, "new_limits": new_limits}

    def sortie_complete(self, t_before: float) -> Optional[Dict[str, Any]]:
        if int(t_before // TOTAL_MISSION_S) == int(self.t // TOTAL_MISSION_S):
            return None
        self.mission_seq += 1
        code = f"MSN-{self.tail}-{self.mission_seq:04d}"
        summary = self.acc.finalize(code, self.tail)
        self.acc = MissionAcc(self.t, self.scenario)
        return summary

    def hours(self) -> float:
        return self.base_hours + self.t / 3600.0


# ---------------------------------------------------------------- broadcasting
async def broadcast(rt: DroneRuntime, frame: Dict[str, Any]) -> None:
    if not rt.clients:
        return
    payload = json.dumps(frame)
    dead: List[Client] = []
    for c in list(rt.clients):
        if REVOKED_BEFORE.get(c.user_id, 0) > c.connected_at:
            dead.append(c)
            try:
                await c.ws.close(code=4403)
            except Exception:
                pass
            continue
        try:
            await asyncio.wait_for(c.ws.send_text(payload), timeout=3)
        except Exception:
            dead.append(c)
    for c in dead:
        rt.clients.discard(c)


def revoke_user_sockets(user_id: int) -> None:
    REVOKED_BEFORE[user_id] = time.time() + 0.001


def online_user_ids() -> Set[int]:
    return {c.user_id for rt in REG.values() for c in rt.clients}
