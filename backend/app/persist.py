"""AeroTwin-DT :: database side-effects of the live twins (run in a worker thread)."""
from __future__ import annotations

import datetime as dt
import secrets
from typing import Any, Dict

from sqlalchemy import desc

from . import config as C
from . import models_db as M
from .db import SessionLocal
from .notify import notify


def run_job(job: Dict[str, Any]) -> None:
    """One transaction per job. `job` keys: tail, frame, hours, persist, new_faults, new_limits, mission."""
    tail = job["tail"]
    frame = job["frame"]
    with SessionLocal() as db:
        try:
            eng = db.query(M.Engine).filter(M.Engine.tail_number == tail).first()
            if not eng:
                return
            eng.last_seen = M.now()
            eng.engine_hours = job["hours"]
            eng.health_overall = frame["health"]["overall"]

            if job.get("persist"):
                db.add(M.TelemetryFrame(
                    engine_id=eng.id, mission_t=frame["mission_t"], phase=frame["phase"],
                    rpm=frame.get("rpm"), throttle=frame.get("throttle"), alt_m=frame.get("alt_m"), oat_c=frame.get("oat_c"),
                    map_kpa=frame.get("map_kpa"), fuel_flow=frame.get("fuel_flow"), power_kw=frame.get("power_kw"),
                    bsfc=frame.get("bsfc"), egt=frame.get("egt"), cht=frame.get("cht"), oil_p=frame.get("oil_p"),
                    oil_t=frame.get("oil_t"), coolant_t=frame.get("coolant_t"), vib=frame.get("vib"),
                    vib_1x=frame.get("vib_1x"), vib_half=frame.get("vib_half"), bus_v=frame.get("bus_v"),
                    alt_i=frame.get("alt_i"), soc=frame.get("soc"), misfire=frame.get("misfire"),
                    cyl_egt=frame.get("cylEGT"), cyl_cht=frame.get("cylCHT"), twin=frame.get("twin"),
                    inference=frame.get("inference"), health=frame.get("health"),
                ))
                if not eng.status_locked:      # an admin order (ground / recall) is never silently overwritten
                    state = frame["readiness"]["state"]
                    eng.status = "grounded" if state == "NO-GO" else "caution" if "RESTRICTED" in state else "ready"

            for f in job.get("new_faults", []):
                dup = db.query(M.Alert.id).filter(M.Alert.engine_id == eng.id, M.Alert.code == f["id"],
                                                   M.Alert.acknowledged == False).first()  # noqa: E712
                if dup:
                    continue
                db.add(M.Alert(engine_id=eng.id, code=f["id"], severity=f["sev"], title=f["title"],
                               evidence=f["evidence"], action=f["action"], part=f["part"]))
                notify(db, "ALERT", f["sev"], f"{tail} — {f['title']}", f"{f['evidence']} → {f['action']}", tail=tail)
                if frame["advisory"]["level"] in ("PRIORITY", "IMMEDIATE"):
                    wo = M.WorkOrder(engine_id=eng.id, code=f"WO-{secrets.token_hex(3).upper()}", part=f["part"],
                                     priority=frame["advisory"]["level"], description=f["title"] + " — " + f["action"],
                                     est_hours=1.5, risk_if_delayed=f["evidence"])
                    db.add(wo)
                    notify(db, "MAINTENANCE", "warn", f"{tail} — work order {wo.code} raised",
                           f"{wo.priority}: {wo.description}", tail=tail)

            for l in job.get("new_limits", []):
                notify(db, "ALERT", "alarm", f"{tail} — {l['label']} limit exceeded",
                       f"{l['value']:.1f} {l['unit']} vs alarm limit {l['limit']} {l['unit']}", tail=tail)

            m = job.get("mission")
            if m:
                db.add(M.MissionReport(
                    engine_id=eng.id, code=m["code"], scenario=m["scenario"], duration_s=m["duration_s"],
                    health_start=m["health_start"], health_end=m["health_end"], health_min=m["health_min"],
                    rul_start_h=m["rul_start_h"], rul_end_h=m["rul_end_h"], verdict=m["verdict"], summary=m))
                notify(db, "MISSION", "info" if m["verdict"] == "NOMINAL" else "warn",
                       f"{tail} — sortie {m['code']} complete ({m['verdict']})",
                       f"Health {m['health_start']}→{m['health_end']} · RUL {m['rul_end_h']} h · "
                       f"{len(m['faults'])} fault type(s) observed", tail=tail)
            db.commit()
        except Exception as exc:                        # never let a DB hiccup kill the twin loop
            db.rollback()
            print(f"[persist] {tail}: {exc}")


def prune() -> None:
    """Keep the free-tier database small: cap telemetry per drone and expire old notifications."""
    with SessionLocal() as db:
        try:
            for (eid,) in db.query(M.Engine.id).all():
                cutoff = (db.query(M.TelemetryFrame.id).filter(M.TelemetryFrame.engine_id == eid)
                          .order_by(desc(M.TelemetryFrame.id)).offset(C.TELEMETRY_KEEP_PER_DRONE).limit(1).scalar())
                if cutoff:
                    db.query(M.TelemetryFrame).filter(M.TelemetryFrame.engine_id == eid,
                                                       M.TelemetryFrame.id <= cutoff).delete(synchronize_session=False)
            old = M.now() - dt.timedelta(days=C.NOTIFICATION_RETENTION_DAYS)
            db.query(M.Notification).filter(M.Notification.created_at < old, M.Notification.read == True  # noqa: E712
                                            ).delete(synchronize_session=False)
            db.commit()
        except Exception as exc:
            db.rollback()
            print(f"[prune] {exc}")
