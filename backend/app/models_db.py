"""
AeroTwin-DT :: ORM models

drones (table `engines`)   one row per airframe/engine — the twin's subject
operators                   login accounts (role: admin | operator)
operator_drones             which drones each operator is allowed to see/act on
notifications               admin inbox: alerts, fleet orders, user/security events
alerts / work_orders        per-drone fault alerts + auto-generated maintenance
mission_reports             one summary per completed sortie (mission-wise health report)
telemetry_frames            downsampled telemetry history (pruned)
"""
from __future__ import annotations
import datetime as dt
from sqlalchemy import (
    Column, Integer, Float, String, Boolean, DateTime, JSON, ForeignKey, Text, Table, Index
)
from sqlalchemy.orm import relationship
from .db import Base


def now() -> dt.datetime:
    """Naive UTC (stored as UTC everywhere; serialised with a trailing Z)."""
    return dt.datetime.now(dt.timezone.utc).replace(tzinfo=None)


def iso(t: dt.datetime | None) -> str | None:
    return (t.isoformat(timespec="seconds") + "Z") if t else None


operator_drones = Table(
    "operator_drones", Base.metadata,
    Column("operator_id", Integer, ForeignKey("operators.id", ondelete="CASCADE"), primary_key=True),
    Column("drone_id", Integer, ForeignKey("engines.id", ondelete="CASCADE"), primary_key=True),
)


class Engine(Base):
    """A drone / engine asset (physical or simulated) — the digital twin's subject."""
    __tablename__ = "engines"

    id = Column(Integer, primary_key=True)
    tail_number = Column(String(48), unique=True, nullable=False, index=True)
    name = Column(String(120), default="")
    asset_code = Column(String(32), default="AE-115T")
    squadron = Column(String(64), default="1 UAV Squadron")
    data_source = Column(String(16), default="simulated")     # simulated | live_can
    active = Column(Boolean, default=True)
    notes = Column(Text, default="")
    engine_hours = Column(Float, default=0.0)
    health_overall = Column(Float, default=100.0)
    status = Column(String(16), default="ready")               # ready | caution | grounded
    status_locked = Column(Boolean, default=False)             # admin order overrides twin-derived status
    last_seen = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=now)

    telemetry = relationship("TelemetryFrame", back_populates="engine", cascade="all,delete-orphan", passive_deletes=True)
    alerts = relationship("Alert", back_populates="engine", cascade="all,delete-orphan", passive_deletes=True)
    work_orders = relationship("WorkOrder", back_populates="engine", cascade="all,delete-orphan", passive_deletes=True)
    missions = relationship("MissionReport", back_populates="engine", cascade="all,delete-orphan", passive_deletes=True)
    operators = relationship("Operator", secondary=operator_drones, back_populates="drones")


class Operator(Base):
    """A DRDO user account. Accounts are issued by an admin — no self-registration."""
    __tablename__ = "operators"

    id = Column(Integer, primary_key=True)
    login_id = Column(String(64), unique=True, nullable=False, index=True)
    full_name = Column(String(120), nullable=False)
    designation = Column(String(80), default="")
    squadron = Column(String(64), default="1 UAV Squadron")
    email = Column(String(160), default="")
    phone = Column(String(32), default="")
    role = Column(String(16), default="operator")              # operator | admin
    active = Column(Boolean, default=True)
    password_hash = Column(String(128), nullable=False)
    password_salt = Column(String(32), nullable=False)
    must_change_password = Column(Boolean, default=True)
    token_version = Column(Integer, default=1)                 # bump => every issued token is revoked
    failed_attempts = Column(Integer, default=0)
    locked_until = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=now)
    created_by = Column(String(64), default="")
    last_login = Column(DateTime, nullable=True)

    drones = relationship("Engine", secondary=operator_drones, back_populates="operators")


class Notification(Base):
    """Admin inbox. Everything noteworthy in the system lands here."""
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True)
    created_at = Column(DateTime, default=now, index=True)
    category = Column(String(16), index=True)   # ALERT | MAINTENANCE | FLEET | USER | SECURITY | MISSION | SYSTEM
    severity = Column(String(8), default="info")  # info | warn | alarm
    title = Column(String(200))
    detail = Column(Text, default="")
    tail_number = Column(String(48), nullable=True, index=True)
    actor = Column(String(64), default="")
    read = Column(Boolean, default=False, index=True)
    read_by = Column(String(64), nullable=True)
    read_at = Column(DateTime, nullable=True)


class TelemetryFrame(Base):
    """Downsampled telemetry snapshot (physics + ML inference), persisted."""
    __tablename__ = "telemetry_frames"

    id = Column(Integer, primary_key=True)
    engine_id = Column(Integer, ForeignKey("engines.id", ondelete="CASCADE"), index=True)
    ts = Column(DateTime, default=now, index=True)
    mission_t = Column(Float)
    phase = Column(String(24))

    rpm = Column(Float); throttle = Column(Float); alt_m = Column(Float); oat_c = Column(Float)
    map_kpa = Column(Float); fuel_flow = Column(Float); power_kw = Column(Float); bsfc = Column(Float)
    egt = Column(Float); cht = Column(Float); oil_p = Column(Float); oil_t = Column(Float)
    coolant_t = Column(Float); vib = Column(Float); vib_1x = Column(Float); vib_half = Column(Float)
    bus_v = Column(Float); alt_i = Column(Float); soc = Column(Float)
    misfire = Column(Float)

    cyl_egt = Column(JSON)
    cyl_cht = Column(JSON)
    twin = Column(JSON)
    inference = Column(JSON)
    health = Column(JSON)

    engine = relationship("Engine", back_populates="telemetry")


class Alert(Base):
    __tablename__ = "alerts"

    id = Column(Integer, primary_key=True)
    engine_id = Column(Integer, ForeignKey("engines.id", ondelete="CASCADE"), index=True)
    created_at = Column(DateTime, default=now, index=True)
    code = Column(String(32))
    severity = Column(String(8))       # warn | alarm
    title = Column(String(160))
    evidence = Column(Text)
    action = Column(Text)
    part = Column(String(32))
    acknowledged = Column(Boolean, default=False)
    acknowledged_by = Column(String(64), nullable=True)

    engine = relationship("Engine", back_populates="alerts")


class WorkOrder(Base):
    __tablename__ = "work_orders"

    id = Column(Integer, primary_key=True)
    engine_id = Column(Integer, ForeignKey("engines.id", ondelete="CASCADE"), index=True)
    created_at = Column(DateTime, default=now)
    code = Column(String(24), unique=True)
    part = Column(String(64))
    priority = Column(String(16))       # ROUTINE | PLANNED | PRIORITY | IMMEDIATE
    description = Column(Text)
    est_hours = Column(Float, default=1.0)
    status = Column(String(16), default="open")  # open | in_progress | closed
    risk_if_delayed = Column(Text)

    engine = relationship("Engine", back_populates="work_orders")


class MissionReport(Base):
    """Mission-wise health report, written automatically when a sortie completes."""
    __tablename__ = "mission_reports"

    id = Column(Integer, primary_key=True)
    engine_id = Column(Integer, ForeignKey("engines.id", ondelete="CASCADE"), index=True)
    code = Column(String(40), unique=True)
    created_at = Column(DateTime, default=now, index=True)
    scenario = Column(String(32))
    duration_s = Column(Float)
    health_start = Column(Float); health_end = Column(Float); health_min = Column(Float)
    rul_start_h = Column(Float); rul_end_h = Column(Float)
    verdict = Column(String(24))
    summary = Column(JSON)

    engine = relationship("Engine", back_populates="missions")


class MissionSimRun(Base):
    """A saved pre-flight feasibility check from the Simulation view."""
    __tablename__ = "mission_sim_runs"

    id = Column(Integer, primary_key=True)
    created_at = Column(DateTime, default=now)
    tail_number = Column(String(48), nullable=True)
    run_by = Column(String(64), nullable=True)
    scenario = Column(String(32))
    altitude_m = Column(Float)
    isa_dev_c = Column(Float)
    duration_h = Column(Float)
    throttle_profile = Column(String(32))
    feasible = Column(Boolean)
    projected_landing_health = Column(Float)
    power_derate_pct = Column(Float)
    recommended_throttle_cap = Column(Float)
    result = Column(JSON)


Index("ix_notif_cat_sev", Notification.category, Notification.severity)
