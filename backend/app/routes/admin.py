"""Admin console API — users, drones, overview. Every route requires role=admin."""
from __future__ import annotations

import re
from typing import List

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import auth as A
from .. import models_db as M
from ..db import get_db
from ..notify import notify, notif_out
from ..runtime import REG, online_user_ids, revoke_user_sockets
from ..schemas import DroneCreate, DroneUpdate, OperatorCreate, OperatorUpdate
from ..twin_mgmt import drop_runtime, ensure_runtime

router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(A.admin_user)])

ID_RE = re.compile(r"^[A-Z0-9][A-Z0-9._-]{1,47}$")


def err(msg: str, code: int = 400):
    return JSONResponse({"ok": False, "error": msg}, status_code=code)


def operator_out(op: M.Operator, online: set) -> dict:
    return {
        "id": op.id, "login_id": op.login_id, "full_name": op.full_name, "designation": op.designation,
        "squadron": op.squadron, "email": op.email, "phone": op.phone, "role": op.role, "active": bool(op.active),
        "must_change_password": bool(op.must_change_password),
        "locked": bool(op.locked_until and op.locked_until > M.now()),
        "created_at": M.iso(op.created_at), "created_by": op.created_by, "last_login": M.iso(op.last_login),
        "drones": sorted(d.tail_number for d in op.drones), "online": op.id in online,
    }


def drone_out(d: M.Engine) -> dict:
    rt = REG.get(d.tail_number)
    return {
        "id": d.id, "tail_number": d.tail_number, "name": d.name, "asset_code": d.asset_code, "squadron": d.squadron,
        "data_source": d.data_source, "active": bool(d.active), "notes": d.notes,
        "engine_hours": round(d.engine_hours or 0, 1), "health_overall": round(d.health_overall or 0, 1),
        "status": d.status, "status_locked": bool(d.status_locked), "last_seen": M.iso(d.last_seen),
        "operators": sorted(o.login_id for o in d.operators), "live_twin": rt is not None,
        "viewers": len(rt.clients) if rt else 0,
    }


def _resolve_drones(db: Session, tails: List[str]):
    tails = [t.strip() for t in tails if t and t.strip()]
    rows = db.query(M.Engine).filter(M.Engine.tail_number.in_(tails)).all() if tails else []
    missing = set(tails) - {r.tail_number for r in rows}
    return rows, missing


# ------------------------------------------------------------------ overview
@router.get("/overview")
def overview(db: Session = Depends(get_db)):
    ops = db.query(M.Operator).all()
    drones = db.query(M.Engine).all()
    unread = db.query(func.count(M.Notification.id)).filter(M.Notification.read == False).scalar()  # noqa: E712
    alarms = db.query(func.count(M.Notification.id)).filter(M.Notification.read == False, M.Notification.severity == "alarm").scalar()  # noqa: E712
    open_wo = db.query(func.count(M.WorkOrder.id)).filter(M.WorkOrder.status != "closed").scalar()
    recent = db.query(M.Notification).order_by(M.Notification.id.desc()).limit(8).all()
    online = online_user_ids()
    unassigned = [d.tail_number for d in drones if d.active and not d.operators]
    return {
        "operators": {"total": sum(1 for o in ops if o.role == "operator"), "active": sum(1 for o in ops if o.role == "operator" and o.active),
                      "admins": sum(1 for o in ops if o.role == "admin"), "online": len(online),
                      "locked": sum(1 for o in ops if o.locked_until and o.locked_until > M.now())},
        "drones": {"total": len(drones), "active": sum(1 for d in drones if d.active),
                   "grounded": sum(1 for d in drones if d.status == "grounded"),
                   "caution": sum(1 for d in drones if d.status == "caution"), "live_twins": len(REG),
                   "unassigned": unassigned},
        "notifications": {"unread": unread, "unread_alarms": alarms},
        "open_work_orders": open_wo,
        "recent": [notif_out(n) for n in recent],
    }


# ----------------------------------------------------------------- operators
@router.get("/operators")
def list_operators(db: Session = Depends(get_db)):
    online = online_user_ids()
    return [operator_out(o, online) for o in db.query(M.Operator).order_by(M.Operator.role, M.Operator.login_id).all()]


@router.post("/operators")
def create_operator(req: OperatorCreate, admin: M.Operator = Depends(A.admin_user), db: Session = Depends(get_db)):
    login_id = req.login_id.strip().upper()
    if not ID_RE.match(login_id):
        return err("Login ID must be 2-48 chars: letters, digits, dot, dash or underscore.")
    if not req.full_name.strip():
        return err("Full name is required.")
    if req.role not in ("operator", "admin"):
        return err("Role must be operator or admin.")
    if db.query(M.Operator).filter(M.Operator.login_id == login_id).first():
        return err("That login ID already exists.", 409)
    temp = req.password or A.generate_temp_password()
    problem = A.password_problem(temp)
    if problem:
        return err(problem)
    drones, missing = _resolve_drones(db, req.drones)
    if missing:
        return err(f"Unknown drone(s): {', '.join(sorted(missing))}")
    digest, salt = A.hash_password(temp)
    op = M.Operator(login_id=login_id, full_name=req.full_name.strip(), designation=req.designation.strip(),
                    squadron=req.squadron.strip(), email=req.email.strip(), phone=req.phone.strip(), role=req.role,
                    password_hash=digest, password_salt=salt, must_change_password=True, created_by=admin.login_id)
    if req.role == "operator":
        op.drones = drones
    db.add(op)
    notify(db, "USER", "info", f"Account created: {login_id} ({req.role})",
           f"Drones: {', '.join(d.tail_number for d in drones) or 'none'}", actor=admin.login_id)
    db.commit()
    db.refresh(op)
    return {"ok": True, "operator": operator_out(op, set()), "temporary_password": temp}


@router.patch("/operators/{op_id}")
def update_operator(op_id: int, req: OperatorUpdate, admin: M.Operator = Depends(A.admin_user), db: Session = Depends(get_db)):
    op = db.get(M.Operator, op_id)
    if not op:
        return err("Account not found.", 404)
    changes = []
    if op.id == admin.id and (req.active is False or (req.role and req.role != "admin")):
        return err("You cannot disable or demote your own account.")
    if req.role and req.role != op.role:
        if req.role not in ("operator", "admin"):
            return err("Role must be operator or admin.")
        op.role = req.role; changes.append(f"role→{req.role}")
    for f in ("full_name", "designation", "squadron", "email", "phone"):
        v = getattr(req, f)
        if v is not None and v.strip() != getattr(op, f):
            setattr(op, f, v.strip()); changes.append(f)
    if req.active is not None and req.active != op.active:
        op.active = req.active
        op.token_version += 1
        changes.append("enabled" if req.active else "disabled")
    if req.drones is not None:
        drones, missing = _resolve_drones(db, req.drones)
        if missing:
            return err(f"Unknown drone(s): {', '.join(sorted(missing))}")
        if {d.id for d in drones} != {d.id for d in op.drones}:
            op.drones = drones
            changes.append("drone assignment→" + (",".join(d.tail_number for d in drones) or "none"))
    if changes:
        notify(db, "USER", "info", f"Account updated: {op.login_id}", "; ".join(changes), actor=admin.login_id)
    db.commit()
    if changes:
        revoke_user_sockets(op.id)          # live sockets re-authorise against the new scope
    return {"ok": True, "operator": operator_out(op, online_user_ids())}


@router.post("/operators/{op_id}/reset-password")
def reset_password(op_id: int, admin: M.Operator = Depends(A.admin_user), db: Session = Depends(get_db)):
    op = db.get(M.Operator, op_id)
    if not op:
        return err("Account not found.", 404)
    temp = A.generate_temp_password()
    op.password_hash, op.password_salt = A.hash_password(temp)
    op.must_change_password = True
    op.token_version += 1
    op.failed_attempts = 0
    op.locked_until = None
    notify(db, "SECURITY", "warn", f"Password reset for {op.login_id}", "Temporary password issued; change forced at next sign-in.", actor=admin.login_id)
    db.commit()
    revoke_user_sockets(op.id)
    return {"ok": True, "temporary_password": temp}


@router.post("/operators/{op_id}/unlock")
def unlock(op_id: int, admin: M.Operator = Depends(A.admin_user), db: Session = Depends(get_db)):
    op = db.get(M.Operator, op_id)
    if not op:
        return err("Account not found.", 404)
    op.locked_until = None
    op.failed_attempts = 0
    notify(db, "SECURITY", "info", f"Account unlocked: {op.login_id}", "", actor=admin.login_id)
    db.commit()
    return {"ok": True}


@router.delete("/operators/{op_id}")
def delete_operator(op_id: int, admin: M.Operator = Depends(A.admin_user), db: Session = Depends(get_db)):
    op = db.get(M.Operator, op_id)
    if not op:
        return err("Account not found.", 404)
    if op.id == admin.id:
        return err("You cannot delete your own account.")
    if op.role == "admin" and db.query(func.count(M.Operator.id)).filter(M.Operator.role == "admin", M.Operator.active == True).scalar() <= 1:  # noqa: E712
        return err("Cannot delete the last active administrator.")
    login = op.login_id
    revoke_user_sockets(op.id)
    op.drones = []
    db.delete(op)
    notify(db, "USER", "warn", f"Account deleted: {login}", "", actor=admin.login_id)
    db.commit()
    return {"ok": True}


# -------------------------------------------------------------------- drones
@router.get("/drones")
def list_drones(db: Session = Depends(get_db)):
    return [drone_out(d) for d in db.query(M.Engine).order_by(M.Engine.tail_number).all()]


@router.post("/drones")
def create_drone(req: DroneCreate, admin: M.Operator = Depends(A.admin_user), db: Session = Depends(get_db)):
    tail = req.tail_number.strip().upper()
    if not ID_RE.match(tail):
        return err("Tail number must be 2-48 chars: letters, digits, dot, dash or underscore.")
    if req.data_source not in ("simulated", "live_can"):
        return err("Data source must be 'simulated' or 'live_can'.")
    if db.query(M.Engine).filter(M.Engine.tail_number == tail).first():
        return err("That tail number is already registered.", 409)
    ops = db.query(M.Operator).filter(M.Operator.login_id.in_([o.upper() for o in req.operators])).all() if req.operators else []
    d = M.Engine(tail_number=tail, name=req.name.strip(), asset_code=req.asset_code.strip() or "AE-115T",
                 squadron=req.squadron.strip(), data_source=req.data_source, engine_hours=req.engine_hours, notes=req.notes)
    d.operators = [o for o in ops if o.role == "operator"]
    db.add(d)
    notify(db, "FLEET", "info", f"Drone registered: {tail}", f"Source: {req.data_source}", tail=tail, actor=admin.login_id)
    db.commit()
    db.refresh(d)
    rt = ensure_runtime(db, d)
    out = drone_out(d)
    if rt is None:
        out["warning"] = "Live twin limit reached (MAX_LIVE_TWINS) — drone registered without a running twin."
    return {"ok": True, "drone": out}


@router.patch("/drones/{drone_id}")
def update_drone(drone_id: int, req: DroneUpdate, admin: M.Operator = Depends(A.admin_user), db: Session = Depends(get_db)):
    d = db.get(M.Engine, drone_id)
    if not d:
        return err("Drone not found.", 404)
    changes = []
    if req.data_source and req.data_source not in ("simulated", "live_can"):
        return err("Data source must be 'simulated' or 'live_can'.")
    for f in ("name", "asset_code", "squadron", "notes", "engine_hours", "data_source"):
        v = getattr(req, f)
        if v is not None and v != getattr(d, f):
            setattr(d, f, v.strip() if isinstance(v, str) else v); changes.append(f)
    if req.active is not None and req.active != d.active:
        d.active = req.active; changes.append("enabled" if req.active else "disabled")
    affected = set()
    if req.operators is not None:
        ops = db.query(M.Operator).filter(M.Operator.login_id.in_([o.upper() for o in req.operators])).all()
        ops = [o for o in ops if o.role == "operator"]
        if {o.id for o in ops} != {o.id for o in d.operators}:
            affected = {o.id for o in ops} ^ {o.id for o in d.operators}
            d.operators = ops
            changes.append("operators→" + (",".join(o.login_id for o in ops) or "none"))
    if changes:
        notify(db, "FLEET", "info", f"Drone updated: {d.tail_number}", "; ".join(changes), tail=d.tail_number, actor=admin.login_id)
    db.commit()
    for uid in affected:
        revoke_user_sockets(uid)
    if d.active:
        ensure_runtime(db, d)
    else:
        drop_runtime(d.tail_number)
    return {"ok": True, "drone": drone_out(d)}


@router.delete("/drones/{drone_id}")
def delete_drone(drone_id: int, admin: M.Operator = Depends(A.admin_user), db: Session = Depends(get_db)):
    d = db.get(M.Engine, drone_id)
    if not d:
        return err("Drone not found.", 404)
    tail = d.tail_number
    for o in list(d.operators):
        revoke_user_sockets(o.id)
    d.operators = []
    drop_runtime(tail)
    db.delete(d)
    notify(db, "FLEET", "warn", f"Drone removed: {tail}", "All history for this drone was deleted.", actor=admin.login_id)
    db.commit()
    return {"ok": True}
