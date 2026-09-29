"""Sign-in (operator / admin portals), self-registration, sign-out, password change, WebSocket tickets."""
from __future__ import annotations

import hmac
import re
import secrets
import time
from typing import Dict, List, Tuple

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from .. import auth as A
from .. import config as C
from .. import models_db as M
from ..db import get_db
from ..notify import notify
from ..schemas import AdminRegisterRequest, ChangePasswordRequest, LoginRequest, RegisterRequest

router = APIRouter(prefix="/api/auth", tags=["auth"])

# one-time 60 s tickets so the JWT never has to travel in a WebSocket URL
WS_TICKETS: Dict[str, Tuple[int, float]] = {}

ID_RE = re.compile(r"^[A-Z0-9][A-Z0-9._-]{1,47}$")
PORTAL_NAME = {"admin": "Administrator", "operator": "Operator"}

# tiny in-memory per-IP throttle for the public registration endpoints
_HITS: Dict[str, List[float]] = {}


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()[:64]
    return (request.client.host if request.client else "unknown")[:64]


def _throttled(bucket: str, ip: str, limit: int, window: int = 3600, record: bool = True) -> bool:
    """True when this IP already used up `limit` hits inside `window` seconds (records a hit unless record=False)."""
    now = time.time()
    key = f"{bucket}:{ip}"
    hits = [t for t in _HITS.get(key, []) if now - t < window]
    if len(hits) >= limit:
        _HITS[key] = hits
        return True
    if record:
        hits.append(now)
    _HITS[key] = hits
    if len(_HITS) > 5000:                                  # keep memory bounded
        for k in [k for k, v in _HITS.items() if not v or now - v[-1] > window]:
            _HITS.pop(k, None)
    return False


def _dummy_verify(password: str) -> None:
    A.hash_password(password, "0" * 24)          # equalise timing for unknown IDs


def _bad(msg: str, code: int = 400) -> JSONResponse:
    return JSONResponse({"ok": False, "error": msg}, status_code=code)


# ------------------------------------------------------------------- sign-in
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

    # correct password, but wrong portal (operator using the admin page or vice-versa)
    if req.portal in PORTAL_NAME and op.role != req.portal:
        right = PORTAL_NAME.get(op.role, "Operator")
        return JSONResponse({"ok": False, "error": f"This is an {right} account. Please use the {right} sign-in page."}, status_code=403)

    op.failed_attempts = 0
    op.locked_until = None
    op.last_login = M.now()
    db.commit()
    return {"ok": True, "operator": A.public_profile(op, A.make_token(op))}


# ------------------------------------------------------------- registration
def _validate_new_account(req: RegisterRequest, db: Session):
    """Shared checks. Returns (login_id, error_response | None)."""
    login_id = req.login_id.strip().upper()
    if not ID_RE.match(login_id):
        return login_id, _bad("Login ID must be 2-48 chars: letters, digits, dot, dash or underscore.")
    if not req.full_name.strip():
        return login_id, _bad("Full name is required.")
    problem = A.password_problem(req.password)
    if problem:
        return login_id, _bad(problem)
    if db.query(M.Operator).filter(M.Operator.login_id == login_id).first():
        return login_id, _bad("That login ID is already taken.", 409)
    return login_id, None


def _create_account(req: RegisterRequest, login_id: str, role: str, db: Session) -> M.Operator:
    digest, salt = A.hash_password(req.password)
    is_admin = role == "admin"
    op = M.Operator(
        login_id=login_id, full_name=req.full_name.strip(),
        designation=req.designation.strip() or ("Administrator" if is_admin else "UAV Operator"),
        squadron=req.squadron.strip() or ("DRDO HQ" if is_admin else "1 UAV Squadron"),
        email=req.email.strip(), phone=req.phone.strip(), role=role,
        password_hash=digest, password_salt=salt,
        must_change_password=False,                     # they just chose their own password
        created_by="self-registration",
    )
    db.add(op)
    return op


@router.post("/register/operator")
def register_operator(req: RegisterRequest, request: Request, db: Session = Depends(get_db)):
    ip = _client_ip(request)
    if _throttled("register", ip, C.REGISTER_MAX_PER_HOUR):
        return _bad("Too many registration attempts. Please try again later.", 429)
    login_id, problem = _validate_new_account(req, db)
    if problem:
        return problem
    op = _create_account(req, login_id, "operator", db)      # no drones: an admin must assign them
    op.last_login = M.now()
    notify(db, "USER", "info", f"New operator self-registered: {login_id}",
           f"{req.full_name.strip()} \u2014 no drones assigned yet. Assign drones under Operators.", actor=login_id)
    db.commit()
    db.refresh(op)
    return {"ok": True, "operator": A.public_profile(op, A.make_token(op))}


@router.post("/register/admin")
def register_admin(req: AdminRegisterRequest, request: Request, db: Session = Depends(get_db)):
    ip = _client_ip(request)
    if not C.ADMIN_REGISTRATION_KEY:
        return _bad("Administrator registration is disabled on this server.", 403)
    if _throttled("admin-key-fail", ip, 5, record=False):          # 5 wrong keys / hour / IP, then locked out
        return _bad("Too many failed attempts. Please try again later.", 429)
    if _throttled("admin-register", ip, C.REGISTER_MAX_PER_HOUR):
        return _bad("Too many registration attempts. Please try again later.", 429)
    if not hmac.compare_digest(req.registration_key.strip().encode(), C.ADMIN_REGISTRATION_KEY.encode()):
        _throttled("admin-key-fail", ip, 5)                        # count this failure
        notify(db, "SECURITY", "alarm", "Administrator registration attempted with a WRONG key",
               f"Requested ID '{req.login_id.strip().upper()[:40]}' from IP {ip}.", actor=req.login_id.strip().upper()[:40], commit=True)
        return _bad("Invalid administrator registration key.", 403)
    login_id, problem = _validate_new_account(req, db)
    if problem:
        return problem
    op = _create_account(req, login_id, "admin", db)
    op.last_login = M.now()
    notify(db, "SECURITY", "warn", f"New ADMINISTRATOR account registered: {login_id}",
           f"{req.full_name.strip()} registered with the admin key from IP {ip}. Disable it under Operators if unexpected.", actor=login_id)
    db.commit()
    db.refresh(op)
    return {"ok": True, "operator": A.public_profile(op, A.make_token(op))}


# ------------------------------------------------------------------ session
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