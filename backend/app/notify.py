"""AeroTwin-DT :: admin notification helper (writes into the admin inbox)."""
from __future__ import annotations
from typing import Optional
from sqlalchemy.orm import Session
from . import models_db as M


def notify(db: Session, category: str, severity: str, title: str, detail: str = "",
           tail: Optional[str] = None, actor: str = "", commit: bool = False) -> M.Notification:
    n = M.Notification(category=category, severity=severity, title=title[:200], detail=detail,
                       tail_number=tail, actor=actor)
    db.add(n)
    if commit:
        db.commit()
    return n


def notif_out(n: M.Notification) -> dict:
    return {
        "id": n.id, "created_at": M.iso(n.created_at), "category": n.category, "severity": n.severity,
        "title": n.title, "detail": n.detail, "tail_number": n.tail_number, "actor": n.actor,
        "read": bool(n.read), "read_by": n.read_by, "read_at": M.iso(n.read_at),
    }
