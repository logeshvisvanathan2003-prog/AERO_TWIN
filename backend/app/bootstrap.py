"""AeroTwin-DT :: first-start seeding (admin account, demo drones, optional demo operators)."""
from __future__ import annotations

from sqlalchemy.orm import Session

from . import auth as A
from . import config as C
from . import models_db as M
from .notify import notify

# tail, name, initial wear (mode -> 0..1) so each demo twin tells a different story
DEMO_DRONES = [
    ("TAIL-01", "Rustom-H Block A", {}),
    ("TAIL-02", "Rustom-H Block B", {"ring_wear": 0.18}),
    ("TAIL-03", "Rustom-H Block C", {"cooling_fouling": 0.28}),
    ("TAIL-04", "AE-115T Prime", {}),
    ("TAIL-05", "Rustom-H Block E", {"injector_clog": 0.35, "oil_degradation": 0.15}),
]
DEMO_HEALTH = {t: h for t, _, h in DEMO_DRONES}


def ensure_admin(db: Session) -> None:
    admin = db.query(M.Operator).filter(M.Operator.login_id == C.ADMIN_LOGIN_ID).first()
    if admin:
        return
    digest, salt = A.hash_password(C.ADMIN_PASSWORD)
    db.add(M.Operator(login_id=C.ADMIN_LOGIN_ID, full_name=C.ADMIN_NAME, designation="Administrator",
                      squadron="DRDO HQ", role="admin", password_hash=digest, password_salt=salt,
                      must_change_password=True, created_by="system"))
    notify(db, "SYSTEM", "info", "Bootstrap administrator created",
           f"Login ID {C.ADMIN_LOGIN_ID}. Password change is enforced at first sign-in.", actor="system")
    db.commit()
    print(f"[bootstrap] admin '{C.ADMIN_LOGIN_ID}' created (change the password at first login)")


def ensure_demo(db: Session) -> None:
    if C.SEED_DEMO_DRONES and db.query(M.Engine).count() == 0:
        for i, (tail, name, _) in enumerate(DEMO_DRONES):
            db.add(M.Engine(tail_number=tail, name=name, asset_code="AE-115T",
                            squadron="1 UAV Squadron", engine_hours=120.0 + 173.0 * i))
        db.commit()
        notify(db, "SYSTEM", "info", "Demo fleet provisioned", f"{len(DEMO_DRONES)} simulated drones registered.", actor="system", commit=True)

    if C.SEED_DEMO_OPERATORS and not db.query(M.Operator).filter(M.Operator.role == "operator").first():
        drones = {d.tail_number: d for d in db.query(M.Engine).all()}
        rows = [("OPR-01", "Flt Lt A. Sharma", ["TAIL-01"]),
                ("OPR-02", "Sqn Ldr R. Iyer", ["TAIL-02", "TAIL-03"]),
                ("OPR-04", "Wg Cdr K. Nair", ["TAIL-04"])]
        for lid, name, tails in rows:
            digest, salt = A.hash_password(C.DEMO_OPERATOR_PASSWORD)
            op = M.Operator(login_id=lid, full_name=name, designation="UAV Operator", role="operator",
                            password_hash=digest, password_salt=salt, must_change_password=False, created_by="system")
            op.drones = [drones[t] for t in tails if t in drones]
            db.add(op)
        db.commit()
        print("[bootstrap] demo operators OPR-01 / OPR-02 / OPR-04 created")
