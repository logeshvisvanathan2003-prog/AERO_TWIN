"""
Optional one-off helper: create tables + bootstrap admin (+ demo drones/operators)
against whatever DATABASE_URL points to (e.g. your Neon database) WITHOUT starting the API.

    cd backend && python seed.py
"""
from app.db import Base, SessionLocal, engine, DATABASE_URL
from app.bootstrap import ensure_admin, ensure_demo

if __name__ == "__main__":
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        ensure_admin(db)
        ensure_demo(db)
    print("Database initialised:", DATABASE_URL.render_as_string(hide_password=True))
