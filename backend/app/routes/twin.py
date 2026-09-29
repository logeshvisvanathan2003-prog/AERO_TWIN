"""Twin / telemetry / fleet API. Every route is scoped to the caller's drone assignment."""
from __future__ import annotations

import asyncio
import json
import math
import secrets
import time
from typing import Optional

import numpy as np
from fastapi import APIRouter, Depends, Header, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse, PlainTextResponse
from sqlalchemy import desc
from sqlalchemy.orm import Session

from .. import auth as A
from .. import config as C
from .. import diagnostics as D
from .. import models_db as M
from ..db import SessionLocal, get_db
from ..notify import notify
from ..runtime import BASE_MODELS, REG, Client, DroneRuntime, broadcast
from ..schemas import Command, FleetActionRequest, MissionSimRequest, WorkOrderUpdate
from ..sim.engine import AeroPistonEngine
from .auth import WS_TICKETS

router = APIRouter(tags=["twin"])


# ----------------------------------------------------------------- helpers
def _scoped_engines(db: Session, op: M.Operator):
    q = db.query(M.Engine).filter(M.Engine.active == True).order_by(M.Engine.tail_number)  # noqa: E712
    allowed = A.allowed_tails(db, op)
    if allowed is not None:
        q = q.filter(M.Engine.tail_number.in_(allowed or {"\0"}))
    return q.all()


def _pick_tail(db: Session, op: M.Operator, tail: Optional[str]) -> str:
    """Resolve + authorise the requested drone (defaults to the caller's first drone)."""
    if not tail:
        rows = _scoped_engines(db, op)
        if not rows:
            raise HTTPException(status_code=404, detail="No drone assigned to this account")
        return rows[0].tail_number
    A.require_tail(db, op, tail)
    if tail not in REG:
        raise HTTPException(status_code=404, detail="No live twin for this drone")
    return tail


def _rt(tail: str) -> DroneRuntime:
    rt = REG.get(tail)
    if not rt:
        raise HTTPException(status_code=404, detail="No live twin for this drone")
    return rt


# ------------------------------------------------------------------- state
@router.get("/api/state")
def state(tail: Optional[str] = None, op: M.Operator = Depends(A.active_user), db: Session = Depends(get_db)):
    t = _pick_tail(db, op, tail)
    return JSONResponse(_rt(t).last)


@router.get("/api/history")
def history(tail: Optional[str] = None, n: int = 600, op: M.Operator = Depends(A.active_user), db: Session = Depends(get_db)):
    t = _pick_tail(db, op, tail)
    return JSONResponse(list(_rt(t).buffer)[-min(n, 3600):])


@router.get("/api/model-meta")
def model_meta(_: M.Operator = Depends(A.active_user)):
    if not BASE_MODELS.ready:
        return {"ready": False}
    return {"ready": True, "features": len(BASE_MODELS.features), "classes": BASE_MODELS.classes,
            "metrics": BASE_MODELS.metrics, "threshold": BASE_MODELS.thr, "rul_scale": BASE_MODELS.rul_scale}


# ---------------------------------------------------------------- commands
@router.post("/api/command")
def command(c: Command, tail: Optional[str] = None, admin: M.Operator = Depends(A.admin_user), db: Session = Depends(get_db)):
    """Mutates the twin (fault injection, time acceleration, pause…). ADMIN ONLY."""
    t = _pick_tail(db, admin, tail)
    rt = _rt(t)
    if rt.source != "simulated" and c.cmd in ("inject", "overhaul", "rate", "noise", "scenario", "auto", "manual", "speed", "pause", "resume"):
        return JSONResponse({"ok": False, "error": "Simulation controls are disabled for a live CAN-fed drone."}, status_code=409)
    res = rt.apply_command(c.cmd, c.model_dump())
    if res.get("ok") and c.cmd in ("inject", "overhaul", "scenario", "auto", "pause", "resume"):
        notify(db, "FLEET", "info", f"{t} — twin command: {c.cmd}", json.dumps({k: v for k, v in c.model_dump().items() if v is not None and k != "cmd"}),
               tail=t, actor=admin.login_id, commit=True)
    return res


# ------------------------------------------------------------------- fleet
def _fleet_row(e: M.Engine) -> dict:
    rt = REG.get(e.tail_number)
    last = rt.last if rt else {}
    inf = last.get("inference", {}) if last else {}
    return {
        "id": e.id, "tail_number": e.tail_number, "name": e.name, "asset_code": e.asset_code, "squadron": e.squadron,
        "engine_hours": round(rt.hours() if rt else (e.engine_hours or 0), 1),
        "health_overall": round(last["health"]["overall"], 1) if last else round(e.health_overall or 0, 1),
        "status": e.status, "status_locked": bool(e.status_locked), "data_source": e.data_source,
        "live": bool(last), "phase": last.get("phase") if last else None,
        "readiness": last.get("readiness", {}).get("state") if last else None,
        "rul_h": round(inf.get("rul_h", 0), 0) if inf else None,
        "faults": len(last.get("faults", [])) if last else 0,
    }


@router.get("/api/fleet")
def fleet(op: M.Operator = Depends(A.active_user), db: Session = Depends(get_db)):
    return [_fleet_row(e) for e in _scoped_engines(db, op)]


ACTION_META = {
    "ground": ("grounded", True, "warn", "Asset grounded by admin order."),
    "clear": ("ready", False, "info", "Asset cleared to mission-ready status by admin."),
    "recall": ("caution", True, "warn", "Recall to base ordered by admin."),
    "schedule_maintenance": (None, None, "info", "Maintenance scheduled by admin."),
}


@router.post("/api/fleet/{engine_id}/action")
def fleet_action(engine_id: int, req: FleetActionRequest, admin: M.Operator = Depends(A.admin_user), db: Session = Depends(get_db)):
    eng = db.get(M.Engine, engine_id)
    if not eng:
        return JSONResponse({"ok": False, "error": "Asset not found."}, status_code=404)
    meta = ACTION_META.get(req.action)
    if not meta:
        return JSONResponse({"ok": False, "error": "Unsupported action."}, status_code=400)
    new_status, lock, sev, default_note = meta
    if new_status:
        eng.status, eng.status_locked = new_status, lock
    if req.action == "schedule_maintenance":
        db.add(M.WorkOrder(engine_id=eng.id, code=f"WO-{secrets.token_hex(3).upper()}", part="general", priority="PLANNED",
                           description=req.note or "Scheduled maintenance requested by admin.", est_hours=2.0,
                           risk_if_delayed="Deferred inspection risk if not actioned."))
    db.add(M.Alert(engine_id=eng.id, code="ADMIN_" + req.action.upper(), severity="warn",
                   title=f"{eng.tail_number} — {req.action.replace('_', ' ').title()}",
                   evidence=req.note or default_note, action=f"Ordered by {admin.full_name} ({admin.login_id})", part="admin"))
    notify(db, "FLEET", sev, f"{eng.tail_number} — {req.action.replace('_', ' ')}", req.note or default_note,
           tail=eng.tail_number, actor=admin.login_id)
    db.commit()
    return {"ok": True, "id": eng.id, "status": eng.status}


# ------------------------------------------------------------------ alerts
def _alert_out(r: M.Alert, tail: str) -> dict:
    return {"id": r.id, "tail_number": tail, "created_at": M.iso(r.created_at), "code": r.code, "severity": r.severity,
            "title": r.title, "evidence": r.evidence, "action": r.action, "part": r.part,
            "acknowledged": r.acknowledged, "acknowledged_by": r.acknowledged_by}


@router.get("/api/alerts")
def alerts(engine_tail: Optional[str] = None, limit: int = 50, op: M.Operator = Depends(A.active_user), db: Session = Depends(get_db)):
    engines = {e.id: e.tail_number for e in _scoped_engines(db, op)}
    if engine_tail:
        A.require_tail(db, op, engine_tail)
        engines = {i: t for i, t in engines.items() if t == engine_tail}
    if not engines:
        return []
    rows = db.query(M.Alert).filter(M.Alert.engine_id.in_(engines.keys())).order_by(desc(M.Alert.created_at)).limit(min(limit, 200)).all()
    return [_alert_out(r, engines[r.engine_id]) for r in rows]


@router.post("/api/alerts/{alert_id}/ack")
def ack_alert(alert_id: int, op: M.Operator = Depends(A.active_user), db: Session = Depends(get_db)):
    row = db.get(M.Alert, alert_id)
    if not row:
        return JSONResponse({"ok": False}, status_code=404)
    A.require_tail(db, op, db.get(M.Engine, row.engine_id).tail_number)
    row.acknowledged = True
    row.acknowledged_by = op.login_id
    db.commit()
    return {"ok": True}


# ------------------------------------------------------------- work orders
@router.get("/api/workorders")
def workorders(tail: Optional[str] = None, limit: int = 50, op: M.Operator = Depends(A.active_user), db: Session = Depends(get_db)):
    engines = {e.id: e.tail_number for e in _scoped_engines(db, op)}
    if tail:
        A.require_tail(db, op, tail)
        engines = {i: t for i, t in engines.items() if t == tail}
    if not engines:
        return []
    rows = db.query(M.WorkOrder).filter(M.WorkOrder.engine_id.in_(engines.keys())).order_by(desc(M.WorkOrder.created_at)).limit(min(limit, 200)).all()
    return [{"id": r.id, "tail_number": engines[r.engine_id], "created_at": M.iso(r.created_at), "code": r.code, "part": r.part,
             "priority": r.priority, "description": r.description, "est_hours": r.est_hours, "status": r.status,
             "risk_if_delayed": r.risk_if_delayed} for r in rows]


@router.patch("/api/workorders/{wo_id}")
def update_workorder(wo_id: int, req: WorkOrderUpdate, admin: M.Operator = Depends(A.admin_user), db: Session = Depends(get_db)):
    if req.status not in ("open", "in_progress", "closed"):
        return JSONResponse({"ok": False, "error": "Invalid status"}, status_code=400)
    wo = db.get(M.WorkOrder, wo_id)
    if not wo:
        return JSONResponse({"ok": False}, status_code=404)
    wo.status = req.status
    tail = db.get(M.Engine, wo.engine_id).tail_number
    notify(db, "MAINTENANCE", "info", f"{tail} — work order {wo.code} {req.status.replace('_', ' ')}", "", tail=tail, actor=admin.login_id)
    db.commit()
    return {"ok": True}


# --------------------------------------------------------- mission reports
@router.get("/api/missions")
def missions(tail: Optional[str] = None, limit: int = 40, op: M.Operator = Depends(A.active_user), db: Session = Depends(get_db)):
    engines = {e.id: e.tail_number for e in _scoped_engines(db, op)}
    if tail:
        A.require_tail(db, op, tail)
        engines = {i: t for i, t in engines.items() if t == tail}
    if not engines:
        return []
    rows = db.query(M.MissionReport).filter(M.MissionReport.engine_id.in_(engines.keys())).order_by(desc(M.MissionReport.id)).limit(min(limit, 200)).all()
    return [{"id": r.id, "tail_number": engines[r.engine_id], "code": r.code, "created_at": M.iso(r.created_at),
             "scenario": r.scenario, "duration_s": r.duration_s, "health_start": r.health_start, "health_end": r.health_end,
             "health_min": r.health_min, "rul_end_h": r.rul_end_h, "verdict": r.verdict,
             "faults": len((r.summary or {}).get("faults", [])), "partial": (r.summary or {}).get("partial", False)} for r in rows]


def _mission_markdown(r: M.MissionReport, tail: str) -> str:
    s = r.summary or {}
    L = [f"# Mission Health Report — {r.code}", "",
         f"Asset: **{tail}** · Scenario: {r.scenario} · Completed: {M.iso(r.created_at)}"
         + (" · *partial sortie (twin started mid-mission)*" if s.get("partial") else ""), "",
         "## Verdict", f"- **{r.verdict}** — health {r.health_start} → {r.health_end} (min {r.health_min}), RUL {s.get('rul_start_h')} → {r.rul_end_h} h", "",
         "## Flight envelope",
         f"- Duration (simulated mission time): {r.duration_s / 3600:.2f} h · max altitude {s.get('max_alt_m')} m",
         f"- Fuel used: {s.get('fuel_kg')} kg · mean throttle {s.get('avg_throttle_pct')}% · mean BSFC {s.get('avg_bsfc')} g/kWh",
         f"- Peaks: CHT {s.get('max_cht')} °C · EGT {s.get('max_egt')} °C · oil temp {s.get('max_oil_t')} °C",
         f"- Minimum oil pressure {s.get('min_oil_p')} bar · peak vibration {s.get('max_vib')} g · peak misfire {s.get('max_misfire_pct')}%", "",
         "## Subsystem health (worst point in sortie)"]
    for k, v in (s.get("subsystem_min") or {}).items():
        L.append(f"- {k}: {v}")
    L += ["", f"## Fault hypotheses observed ({len(s.get('faults', []))})"]
    for f in s.get("faults", []):
        L.append(f"- **{f['title']}** [{f['sev'].upper()}] — {f['frames']} frames → {f['action']}")
    if not s.get("faults"):
        L.append("- None. Engine stayed inside the nominal envelope.")
    if s.get("limit_breaches"):
        L += ["", "## Threshold breaches"] + [f"- {k}: {v} frames" for k, v in s["limit_breaches"].items()]
    return "\n".join(L)


@router.get("/api/missions/{mission_id}/report", response_class=PlainTextResponse)
def mission_report(mission_id: int, op: M.Operator = Depends(A.active_user), db: Session = Depends(get_db)):
    r = db.get(M.MissionReport, mission_id)
    if not r:
        raise HTTPException(status_code=404, detail="Report not found")
    tail = db.get(M.Engine, r.engine_id).tail_number
    A.require_tail(db, op, tail)
    return _mission_markdown(r, tail)


# ------------------------------------------------------- pre-flight simulate
def _throttle_series(profile: str, n_steps: int):
    if profile == "loiter":
        return [0.48 + 0.05 * math.sin(i / 8.0) for i in range(n_steps)]
    if profile == "transients":
        return [float(np.clip(0.55 + 0.35 * math.sin(i / 4.0) + 0.2 * math.sin(i / 1.3), 0.12, 1.0)) for i in range(n_steps)]
    return [0.62] * n_steps


@router.post("/api/mission/simulate")
def mission_simulate(req: MissionSimRequest, op: M.Operator = Depends(A.active_user), db: Session = Depends(get_db)):
    """Non-mutating physics feasibility run, seeded from the chosen drone's CURRENT degradation state."""
    tail = _pick_tail(db, op, req.tail)
    rt = _rt(tail)
    trial = AeroPistonEngine(health=dict(rt.plant.h), seed=123)
    shadow = AeroPistonEngine(seed=123)
    dt_ = 30.0
    n_steps = max(4, int(req.duration_h * 3600 / dt_))
    thr = _throttle_series(req.throttle_profile, n_steps)
    worst_cht = worst_egt = 0.0
    worst_oilp = 99.0
    for i in range(n_steps):
        tm = trial.step(dt_, thr[i], req.altitude_m, req.isa_dev_c, tas_ms=55.0, deg_rate=1.0)
        shadow.step(dt_, thr[i], req.altitude_m, req.isa_dev_c, tas_ms=55.0, deg_rate=0.0)
        worst_cht, worst_egt, worst_oilp = max(worst_cht, tm["cht"]), max(worst_egt, tm["egt"]), min(worst_oilp, tm["oil_p"])
    landing_health = max(15, 100 - trial.h["ring_wear"] * 40 - trial.h["cooling_fouling"] * 25
                         - trial.h["bearing_wear"] * 30 - trial.h["oil_degradation"] * 20)
    derate = max(0.0, (req.altitude_m / 1000) * 3.1 + max(0, req.isa_dev_c) * 0.28)
    feasible = bool(worst_cht < D.LIMITS["cht"]["alarm"] and worst_egt < D.LIMITS["egt"]["alarm"]
                    and worst_oilp > D.LIMITS["oil_p"]["alarm"] and landing_health > 45)
    cap = max(65, round(100 - derate * 0.6))
    result = {"tail": tail, "feasible": feasible, "worst_cht_c": round(worst_cht, 1), "worst_egt_c": round(worst_egt, 1),
              "worst_oil_p_bar": round(worst_oilp, 2), "projected_landing_health": round(landing_health, 1),
              "power_derate_pct": round(derate, 1), "recommended_throttle_cap_pct": cap,
              "post_flight_maintenance": "Routine check" if feasible else "Full inspection required"}
    db.add(M.MissionSimRun(tail_number=tail, run_by=op.login_id, scenario=req.scenario, altitude_m=req.altitude_m,
                           isa_dev_c=req.isa_dev_c, duration_h=req.duration_h, throttle_profile=req.throttle_profile,
                           feasible=feasible, projected_landing_health=landing_health, power_derate_pct=derate,
                           recommended_throttle_cap=cap, result=result))
    db.commit()
    return result


# ------------------------------------------------------------- live report
@router.get("/api/report", response_class=PlainTextResponse)
def report(tail: Optional[str] = None, op: M.Operator = Depends(A.active_user), db: Session = Depends(get_db)):
    t = _pick_tail(db, op, tail)
    rt = _rt(t)
    e = db.query(M.Engine).filter(M.Engine.tail_number == t).first()
    last = rt.last
    h, adv, faults = last.get("health", {}), last.get("advisory", {}), last.get("faults", [])
    lines = [f"# AeroTwin-DT — Live Health Snapshot", "",
             f"Asset: {t} ({e.name or e.asset_code}) · Engine hours: {rt.hours():.1f} · Generated: {time.strftime('%Y-%m-%d %H:%M:%S UTC', time.gmtime())}",
             f"Prepared for: {op.full_name} ({op.login_id})", "", "## Summary",
             f"- Overall health index: {h.get('overall', '—')} / 100",
             f"- Mission readiness: {last.get('readiness', {}).get('state', '—')}",
             f"- Maintenance advisory: {adv.get('level', '—')} — {adv.get('text', '')}",
             f"- Estimated RUL: {last.get('inference', {}).get('rul_h', 0):.0f} h", "", "## Subsystem health indices"]
    lines += [f"- {k}: {v}" for k, v in h.items() if k != "overall"]
    lines += ["", f"## Active fault hypotheses ({len(faults)})"]
    lines += [f"- **{f['title']}** [{f['sev'].upper()}] — {f['evidence']} → {f['action']}" for f in faults]
    if not faults:
        lines.append("- None. Engine within nominal envelope.")
    return "\n".join(lines)


# ------------------------------------------------- CAN edge-gateway ingest
@router.post("/api/ingest/{tail}")
async def ingest(tail: str, payload: dict, x_ingest_key: Optional[str] = Header(default=None)):
    """Edge gateway (SocketCAN/FADEC reader) pushes one measured sample. Auth: shared INGEST_KEY."""
    if not C.INGEST_KEY:
        return JSONResponse({"ok": False, "error": "Ingest disabled (set INGEST_KEY)."}, status_code=503)
    if not x_ingest_key or not secrets.compare_digest(x_ingest_key, C.INGEST_KEY):
        return JSONResponse({"ok": False, "error": "Bad ingest key."}, status_code=401)
    rt = REG.get(tail)
    if not rt or rt.source != "live_can":
        return JSONResponse({"ok": False, "error": "Drone not registered with data_source=live_can."}, status_code=404)
    t_before = rt.t
    frame = rt.ingest(payload)
    await broadcast(rt, frame)
    await schedule_jobs(rt, frame, t_before)
    return {"ok": True, "missing_channels": frame.get("missing_channels", [])}


# ------------------------------------------------------------ job scheduling
_PERSIST_LOCK: Optional[asyncio.Lock] = None


async def schedule_jobs(rt: DroneRuntime, frame: dict, t_before: float) -> None:
    global _PERSIST_LOCK
    from ..persist import run_job
    ev = rt.diff_events(frame)
    mission = rt.sortie_complete(t_before)
    due = rt.frame_count % C.PERSIST_EVERY_N_FRAMES == 0
    if not (due or ev["new_faults"] or ev["new_limits"] or mission):
        return
    if _PERSIST_LOCK is None:
        _PERSIST_LOCK = asyncio.Lock()
    job = {"tail": rt.tail, "frame": frame, "hours": rt.hours(), "persist": due, "mission": mission, **ev}

    async def _run():
        async with _PERSIST_LOCK:
            await asyncio.to_thread(run_job, job)
    asyncio.create_task(_run())


# --------------------------------------------------------------- websocket
@router.websocket("/ws/telemetry")
async def ws_telemetry(ws: WebSocket, tail: str = "", ticket: str = "", backfill: int = 0):
    entry = WS_TICKETS.pop(ticket, None)
    if not entry or entry[1] < time.time():
        await ws.close(code=4401)
        return
    db = SessionLocal()
    try:
        op = db.get(M.Operator, entry[0])
        if not op or not op.active or op.must_change_password:
            await ws.close(code=4401)
            return
        allowed = A.allowed_tails(db, op)
        if not tail and allowed is not None and allowed:
            tail = sorted(allowed)[0]
        if tail not in REG or (allowed is not None and tail not in allowed):
            await ws.close(code=4403)
            return
        uid = op.id
    finally:
        db.close()
    await ws.accept()
    rt = REG[tail]
    client = Client(ws=ws, user_id=uid)
    rt.clients.add(client)
    try:
        if backfill:
            for f in list(rt.buffer)[-300:]:
                await ws.send_text(json.dumps(f))
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        rt.clients.discard(client)
