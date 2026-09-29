"""Admin notification inbox (separate page in the UI). Admin only."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import auth as A
from .. import models_db as M
from ..db import get_db
from ..notify import notif_out
from ..schemas import NotifIds

router = APIRouter(prefix="/api/notifications", tags=["notifications"], dependencies=[Depends(A.admin_user)])


def _filtered(db: Session, category=None, severity=None, tail=None, unread=None, q=None):
    query = db.query(M.Notification)
    if category:
        query = query.filter(M.Notification.category == category.upper())
    if severity:
        query = query.filter(M.Notification.severity == severity)
    if tail:
        query = query.filter(M.Notification.tail_number == tail)
    if unread:
        query = query.filter(M.Notification.read == False)  # noqa: E712
    if q:
        like = f"%{q}%"
        query = query.filter((M.Notification.title.ilike(like)) | (M.Notification.detail.ilike(like)))
    return query


@router.get("")
def list_notifications(category: Optional[str] = None, severity: Optional[str] = None, tail: Optional[str] = None,
                       unread: bool = False, q: Optional[str] = None, limit: int = 100, before_id: Optional[int] = None,
                       db: Session = Depends(get_db)):
    query = _filtered(db, category, severity, tail, unread, q)
    if before_id:
        query = query.filter(M.Notification.id < before_id)
    rows = query.order_by(M.Notification.id.desc()).limit(min(max(limit, 1), 300)).all()
    return [notif_out(n) for n in rows]


@router.get("/summary")
def summary(db: Session = Depends(get_db)):
    unread = db.query(M.Notification.category, M.Notification.severity, func.count(M.Notification.id)) \
        .filter(M.Notification.read == False).group_by(M.Notification.category, M.Notification.severity).all()  # noqa: E712
    by_cat, by_sev, total = {}, {}, 0
    for cat, sev, n in unread:
        by_cat[cat] = by_cat.get(cat, 0) + n
        by_sev[sev] = by_sev.get(sev, 0) + n
        total += n
    latest = db.query(func.max(M.Notification.id)).scalar() or 0
    return {"unread": total, "by_category": by_cat, "by_severity": by_sev, "latest_id": latest}


@router.post("/read")
def mark_read(req: NotifIds, admin: M.Operator = Depends(A.admin_user), db: Session = Depends(get_db)):
    query = db.query(M.Notification).filter(M.Notification.read == False)  # noqa: E712
    if req.ids:
        query = query.filter(M.Notification.id.in_(req.ids))
    elif req.all:
        query = _filtered(db, req.category, req.severity, req.tail, True)
    else:
        return {"ok": True, "updated": 0}
    n = query.update({"read": True, "read_by": admin.login_id, "read_at": M.now()}, synchronize_session=False)
    db.commit()
    return {"ok": True, "updated": n}


@router.post("/unread")
def mark_unread(req: NotifIds, db: Session = Depends(get_db)):
    if not req.ids:
        return {"ok": True, "updated": 0}
    n = db.query(M.Notification).filter(M.Notification.id.in_(req.ids)).update(
        {"read": False, "read_by": None, "read_at": None}, synchronize_session=False)
    db.commit()
    return {"ok": True, "updated": n}


@router.delete("/read")
def clear_read(db: Session = Depends(get_db)):
    n = db.query(M.Notification).filter(M.Notification.read == True).delete(synchronize_session=False)  # noqa: E712
    db.commit()
    return {"ok": True, "deleted": n}
