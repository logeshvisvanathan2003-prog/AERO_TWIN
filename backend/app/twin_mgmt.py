"""AeroTwin-DT :: create / drop live twin runtimes to match the drone registry."""
from __future__ import annotations

import zlib
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from . import config as C
from . import models_db as M
from .bootstrap import DEMO_HEALTH
from .runtime import REG, DroneRuntime
from .sim.engine import TOTAL_MISSION_S, fresh_health


def ensure_runtime(db: Session, eng: M.Engine) -> Optional[DroneRuntime]:
    rt = REG.get(eng.tail_number)
    if rt and rt.source == eng.data_source:
        return rt
    if rt:
        REG.pop(eng.tail_number, None)
    if not eng.active or (len(REG) >= C.MAX_LIVE_TWINS):
        return None
    seq = db.query(func.count(M.MissionReport.id)).filter(M.MissionReport.engine_id == eng.id).scalar() or 0
    h = zlib.crc32(eng.tail_number.encode())
    health = {**fresh_health(), **DEMO_HEALTH.get(eng.tail_number, {})}
    t0 = (h % 97) / 97.0 * TOTAL_MISSION_S if eng.data_source == "simulated" else 0.0
    rt = DroneRuntime(eng.tail_number, eng.id, eng.data_source, seed=h % 10000, health=health,
                      base_hours=eng.engine_hours or 0.0, t0=t0, mission_seq=seq)
    REG[eng.tail_number] = rt
    return rt


def drop_runtime(tail: str) -> None:
    REG.pop(tail, None)


def sync_all(db: Session) -> None:
    for eng in db.query(M.Engine).filter(M.Engine.active == True).all():  # noqa: E712
        ensure_runtime(db, eng)
