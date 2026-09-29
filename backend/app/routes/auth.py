"""Sign-in, sign-out, password change, WebSocket tickets."""
from __future__ import annotations

import secrets
import time
from typing import Dict, Tuple

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from .. import auth as A
from .. import config as C
from .. import models_db as M
from ..db import get_db
from ..notify import notify
from ..schemas import ChangePasswordRequest, LoginRequest

router = APIRouter(prefix="/api/auth", tags=["auth"])

# one-time 60 s tickets so the JWT never has to travel in a WebSocket URL
WS_TICKETS: Dict[str, Tuple[int, float]] = {}


def _dummy_verify(password: str) -> None:
    A.hash_password(password, "0" * 24)          # equalise timing for unknown IDs


@router.post("/login")
def login(req: LoginRequest, db: Session = Depends(get_db)):
    login_id = req.login_id.strip().upper()
    op = db.query(M.Operator).filter(M.Operator.login_id == login_id).first()
    bad = JSONResponse({"ok": False, "error": "Invalid login ID or password."}, status_code=401)

    if not op:
        _dummy_verify(req.password)
        notify(db, "SECURITY", "warn", f"Failed sign-in for unknown ID '{login_id[:40]}'", "", actor=login_id[:40], commit=True)
        return bad
    if op.locked_until and op.locked_until > M.now():
        mins = int((op.locked_until - M.now()).total_seconds() // 60) + 1
        return JSONResponse({"ok": False, "error": f"Account temporarily locked. Try again in {mins} min."}, status_code=423)
    if not op.active:
        return JSONResponse({"ok": False, "error": "This account has been disabled. Contact your administrator."}, status_code=403)

    if not A.verify_password(req.password, op.password_salt, op.password_hash):
        op.failed_attempts = (op.failed_attempts or 0) + 1
        if op.failed_attempts >= C.MAX_FAILED_LOGINS:
            import datetime as dt
            op.locked_until = M.now() + dt.timedelta(minutes=C.LOCKOUT_MINUTES)
            op.failed_attempts = 0
            notify(db, "SECURITY", "alarm", f"Account {op.login_id} locked after repeated failed sign-ins",
                   f"Locked for {C.LOCKOUT_MINUTES} minutes.", actor=op.login_id)
        db.commit()
        return bad

    op.failed_attempts = 0
    op.locked_until = None
    op.last_login = M.now()
    db.commit()
    return {"ok": True, "operator": A.public_profile(op, A.make_token(op))}


@router.post("/logout")
def logout():
    return {"ok": True}       # tokens are stateless; the client discards its copy


@router.get("/me")
def me(op: M.Operator = Depends(A.current_user)):
    return {"ok": True, "operator": A.public_profile(op)}


@router.post("/change-password")
def change_password(req: ChangePasswordRequest, op: M.Operator = Depends(A.current_user), db: Session = Depends(get_db)):
    if not A.verify_password(req.current_password, op.password_salt, op.password_hash):
        return JSONResponse({"ok": False, "error": "Current password is incorrect."}, status_code=400)
    problem = A.password_problem(req.new_password)
    if problem:
        return JSONResponse({"ok": False, "error": problem}, status_code=400)
    if req.new_password == req.current_password:
        return JSONResponse({"ok": False, "error": "New password must differ from the current one."}, status_code=400)
    op.password_hash, op.password_salt = A.hash_password(req.new_password)
    op.must_change_password = False
    op.token_version += 1                                # sign out every other session
    notify(db, "SECURITY", "info", f"{op.login_id} changed their password", "", actor=op.login_id)
    db.commit()
    return {"ok": True, "operator": A.public_profile(op, A.make_token(op))}


@router.post("/ws-ticket")
def ws_ticket(op: M.Operator = Depends(A.active_user)):
    now = time.time()
    for k in [k for k, (_, exp) in WS_TICKETS.items() if exp < now]:
        WS_TICKETS.pop(k, None)
    t = secrets.token_urlsafe(24)
    WS_TICKETS[t] = (op.id, now + 60)
    return {"ticket": t}
