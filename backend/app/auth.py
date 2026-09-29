"""
AeroTwin-DT :: authentication & role-based access control
==============================================================================
* Accounts are created by an admin only (there is NO public registration).
* Passwords: salted PBKDF2-HMAC-SHA256.
* Sessions: stateless HMAC-signed bearer tokens with expiry. Each token carries
  the account's `token_version`; bumping it (password reset, disable, delete)
  revokes every outstanding token immediately.
* Every request re-loads the account, so a disabled account or a changed drone
  assignment takes effect on the very next call.
* Roles
    admin     full control: users, drones, fleet orders, twin commands, all data
    operator  read-only view of *assigned* drones, may acknowledge their alerts,
              generate their reports and run non-mutating mission feasibility checks
"""
from __future__ import annotations
import base64
import hashlib
import hmac
import json
import re
import secrets
import time
from typing import Optional, Set

from fastapi import Depends, Header, HTTPException
from sqlalchemy.orm import Session

from . import config as C
from . import models_db as M
from .db import get_db

PBKDF2_ITERS = 200_000


# ------------------------------------------------------------------ passwords
def hash_password(password: str, salt: Optional[str] = None) -> tuple[str, str]:
    salt = salt or secrets.token_hex(12)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), PBKDF2_ITERS).hex()
    return digest, salt


def verify_password(password: str, salt: str, digest: str) -> bool:
    check, _ = hash_password(password, salt)
    return hmac.compare_digest(check, digest)


def password_problem(pw: str) -> Optional[str]:
    if len(pw or "") < 8:
        return "Password must be at least 8 characters."
    if not re.search(r"[A-Za-z]", pw) or not re.search(r"\d", pw):
        return "Password must contain both letters and digits."
    return None


def generate_temp_password() -> str:
    alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    core = "".join(secrets.choice(alphabet) for _ in range(9))
    return f"{core}{secrets.randbelow(90) + 10}"      # always letters + digits


# --------------------------------------------------------------------- tokens
def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def _sign(body: str) -> str:
    return _b64(hmac.new(C.SECRET_KEY.encode(), body.encode(), hashlib.sha256).digest())


def make_token(op: M.Operator) -> str:
    payload = {"sub": op.id, "tv": op.token_version, "exp": int(time.time() + C.TOKEN_TTL_HOURS * 3600)}
    body = _b64(json.dumps(payload, separators=(",", ":")).encode())
    return f"{body}.{_sign(body)}"


def parse_token(token: str) -> Optional[dict]:
    try:
        body, sig = token.split(".", 1)
        if not hmac.compare_digest(sig, _sign(body)):
            return None
        payload = json.loads(_unb64(body))
        if payload["exp"] < time.time():
            return None
        return payload
    except Exception:
        return None


def user_from_authorization(db: Session, authorization: Optional[str]) -> Optional[M.Operator]:
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    payload = parse_token(authorization.split(" ", 1)[1].strip())
    if not payload:
        return None
    op = db.get(M.Operator, payload["sub"])
    if not op or not op.active or op.token_version != payload["tv"]:
        return None
    return op


# ---------------------------------------------------------------- dependencies
def current_user(authorization: Optional[str] = Header(default=None), db: Session = Depends(get_db)) -> M.Operator:
    op = user_from_authorization(db, authorization)
    if not op:
        raise HTTPException(status_code=401, detail="Sign in required")
    return op


def active_user(op: M.Operator = Depends(current_user)) -> M.Operator:
    """Like current_user, but blocks accounts that still owe a password change."""
    if op.must_change_password:
        raise HTTPException(status_code=403, detail="Password change required before continuing")
    return op


def admin_user(op: M.Operator = Depends(active_user)) -> M.Operator:
    if op.role != "admin":
        raise HTTPException(status_code=403, detail="Administrator access required")
    return op


# ------------------------------------------------------------------ drone scope
def allowed_tails(db: Session, op: M.Operator) -> Optional[Set[str]]:
    """None => unrestricted (admin). Otherwise the set of tail numbers this operator may access."""
    if op.role == "admin":
        return None
    return {d.tail_number for d in op.drones if d.active}


def require_tail(db: Session, op: M.Operator, tail: str) -> None:
    allowed = allowed_tails(db, op)
    if allowed is not None and tail not in allowed:
        raise HTTPException(status_code=403, detail="You are not assigned to this drone")


def public_profile(op: M.Operator, token: Optional[str] = None) -> dict:
    out = {
        "id": op.id,
        "login_id": op.login_id,
        "full_name": op.full_name,
        "designation": op.designation,
        "squadron": op.squadron,
        "email": op.email,
        "phone": op.phone,
        "role": op.role,
        "must_change_password": bool(op.must_change_password),
        "last_login": M.iso(op.last_login),
        "drones": sorted(d.tail_number for d in op.drones if d.active) if op.role != "admin" else ["*"],
    }
    if token:
        out["token"] = token
    return out