"""
AeroTwin-DT :: database session management (PostgreSQL / Neon via SQLAlchemy)

Works with:
  * local Postgres  (postgresql://user:pass@localhost:5432/aerotwin)
  * Neon serverless (postgresql://user:pass@ep-xxxx.region.aws.neon.tech/db?sslmode=require)
  * SQLite for quick offline tests (sqlite:///./aerotwin.db)
"""
from __future__ import annotations
import os
from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker, declarative_base

load_dotenv()

RAW_URL = os.getenv("DATABASE_URL", "postgresql://aerotwin:aerotwin@localhost:5432/aerotwin").strip()


def normalize_url(raw: str):
    """Accept the URL exactly as Neon / Render / Heroku hand it out."""
    if raw.startswith("postgres://"):
        raw = "postgresql://" + raw[len("postgres://"):]
    url = make_url(raw)
    if url.drivername in ("postgresql", "postgres"):
        url = url.set(drivername="postgresql+psycopg2")
    if url.drivername.startswith("postgresql") and url.host and "neon.tech" in url.host:
        if "sslmode" not in url.query:
            url = url.update_query_dict({"sslmode": "require"})
    return url


DATABASE_URL = normalize_url(RAW_URL)

if DATABASE_URL.drivername.startswith("sqlite"):
    engine = create_engine(DATABASE_URL, future=True, connect_args={"check_same_thread": False})
else:
    engine = create_engine(
        DATABASE_URL, future=True,
        pool_pre_ping=True,      # Neon suspends idle compute -> drop stale connections transparently
        pool_recycle=240,
        pool_size=5, max_overflow=5,
        connect_args={"keepalives": 1, "keepalives_idle": 30, "keepalives_interval": 10, "keepalives_count": 5},
    )

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True, expire_on_commit=False)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()