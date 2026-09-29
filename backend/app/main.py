"""
AeroTwin-DT — Ground Control Station Backend  (FastAPI · PostgreSQL/Neon)
==============================================================================
* One live digital twin per registered drone (physics plant + healthy shadow +
  ML bundle + diagnostics), streamed over an authenticated WebSocket.
* Role-based access: ADMIN manages users/drones/fleet orders/twin commands and
  receives every notification; OPERATORS only see the drones assigned to them.
* Telemetry history, alerts, work orders, mission reports and the admin
  notification inbox persist in PostgreSQL (Neon).

Run locally:   uvicorn app.main:app --reload --port 8000
Production:    uvicorn app.main:app --host 0.0.0.0 --port $PORT      (single worker!)
"""
from __future__ import annotations

import asyncio
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import config as C
from . import models_db as M
from .bootstrap import ensure_admin, ensure_demo
from .db import Base, SessionLocal, engine as db_engine, DATABASE_URL
from .persist import prune
from .routes import admin as admin_routes
from .routes import auth as auth_routes
from .routes import notifications as notif_routes
from .routes import twin as twin_routes
from .runtime import BASE_MODELS, REG, broadcast
from .twin_mgmt import sync_all

STATE = {"link": "boot", "frames": 0, "started": time.time()}


async def acquisition_loop():
    """1 Hz heartbeat: advance every simulated twin, broadcast, queue DB work."""
    STATE["link"] = "up"
    period = 1.0
    last_prune = time.time()
    while True:
        t0 = time.perf_counter()
        for rt in list(REG.values()):
            if rt.source != "simulated" or not rt.running:
                continue
            try:
                t_before = rt.t
                frame = rt.advance()
                STATE["frames"] += 1
                await broadcast(rt, frame)
                await twin_routes.schedule_jobs(rt, frame, t_before)
            except Exception as exc:
                print(f"[loop] {rt.tail}: {exc!r}")
        if time.time() - last_prune > 3600:
            last_prune = time.time()
            asyncio.create_task(asyncio.to_thread(prune))
        await asyncio.sleep(max(0.0, period - (time.perf_counter() - t0)))


@asynccontextmanager
async def lifespan(_app: FastAPI):
    Base.metadata.create_all(bind=db_engine)
    with SessionLocal() as db:
        ensure_admin(db)
        ensure_demo(db)
        sync_all(db)
    if C.SECRET_KEY_IS_EPHEMERAL:
        print("[security] SECRET_KEY not set — using a random key; sessions reset on every restart. Set SECRET_KEY in production.")
    print(f"[twin] {len(REG)} live twin(s) running: {', '.join(REG)}")
    task = asyncio.create_task(acquisition_loop())
    yield
    task.cancel()


app = FastAPI(title="AeroTwin-DT Backend", version="3.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware, allow_origins=C.CORS_ORIGINS, allow_credentials=False,
    allow_methods=["*"], allow_headers=["*"],
)
app.include_router(auth_routes.router)
app.include_router(admin_routes.router)
app.include_router(notif_routes.router)
app.include_router(twin_routes.router)


@app.get("/health")
def health():
    """Unauthenticated liveness probe (Render health-check / uptime pinger). No sensitive data."""
    return {"status": "ok", "link": STATE["link"], "twins": len(REG), "models": BASE_MODELS.ready,
            "uptime_s": round(time.time() - STATE["started"], 1)}


@app.get("/")
def root():
    return {"service": "AeroTwin-DT backend", "docs": "/docs", "health": "/health"}


if __name__ == "__main__":
    import os
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8000")))
