# AeroTwin-DT — Digital Twin & Fleet Command for MALE UAV Aero-Piston Engines

Built against the DRDO problem statement: *"Digital Twin Framework for Aero Piston Engine Health
Monitoring, Predictive Maintenance and Mission Simulation for MALE UAV Applications."*

A live, physics + ML digital twin per drone (RPM, CHT/EGT per cylinder, oil pressure/temperature,
fuel flow, vibration signatures, battery/alternator health, injection timing), fault detection,
RUL estimation, mission-replay and a role-based multi-drone Ground Control Station.

```
frontend/   React + Vite SPA — twin visualisation, fleet command, admin console       → Vercel
backend/    FastAPI — physics plant + ML inference + WebSocket streaming + REST API   → Render
            PostgreSQL via SQLAlchemy                                                  → Neon
tools/      can_gateway.py — reference SocketCAN → REST bridge for a real engine rig
```

## 1. What's implemented against the problem statement

| Expected solution area | Where |
|---|---|
| **A. Digital Twin Core** — virtual engine synced with live data, modular, real-time ingestion | `backend/app/runtime.py` (`DroneRuntime`, one twin per drone), `backend/app/sim/engine.py` (physics plant), `POST /api/ingest/{tail}` for real CAN/FADEC data |
| **B. Health Monitoring** — RPM, CHT, EGT, oil P/T, fuel flow, vibration, battery/alternator, injection timing | `sim/engine.py` (per-cylinder EGT/CHT, oil, fuel, vibration harmonics, bus voltage/current), surfaced live on the **Health** view |
| **C. Fault Detection & Predictive Analytics** — misfire, injector, cooling, lubrication, sensor drift, combustion instability, overheating, vibration | `backend/app/diagnostics.py` (`fault_rules`, threshold `check_limits`) — 8+ rule-based hypotheses with evidence & recommended action, surfaced on **Diagnostics** |
| **D. AI/ML Layer** — anomaly detection, RUL, trend analysis, maintenance recommendations | `backend/app/ml_bundle.py` (autoencoder residual + classifier + RUL regressor, one forked instance per drone so each twin has independent residual-filter state) |
| **E. Simulation & Replay** — historical replay, environment simulation, altitude/endurance/hot-weather/rapid-throttle | **Replay** view (event timeline + scrubber), **Simulation** view (admin: inject faults/scenario; everyone: non-mutating pre-flight feasibility check `POST /api/mission/simulate`) |
| **F. Visualization Dashboard** — real-time health, fault alerts, efficiency trends, maintenance advisory, mission-wise reports | **Overview / Health / Predictive** views, **Reports** (auto-generated Markdown mission-wise health report per completed sortie, downloadable) |

## 2. What was added on top for a deployable GCS

The brief also asked for a proper **admin page with the right admin flow and access
restrictions**, **operator logins for multiple drones**, and a **separate admin notifications
page** — none of that existed in the original UI-only template, so it was built as a full
backend + frontend feature:

* **Role-based accounts** (`operators` table): `admin` / `operator`, created **only** by an
  admin (no self-registration), salted PBKDF2 passwords, forced password change on first
  login, account lockout after repeated failed sign-ins, HMAC-signed bearer tokens that are
  revoked instantly on password reset / role change / disable / drone reassignment (bumping
  `token_version` invalidates every outstanding token and live WebSocket).
* **Multi-drone operator scoping**: an `operator_drones` join table; every REST route and the
  WebSocket stream re-checks `allowed_tails()` on **every call** — an operator cannot read,
  command, or open the live stream of a drone they are not assigned to (`403`), enforced
  server-side, not just hidden in the UI (see `tests/test_api.py`).
* **Admin Console** (`/#/admin`): fleet/operator KPIs, a "needs attention" queue (unread
  alarms, locked accounts, unassigned drones, grounded assets), recent activity feed, and an
  explicit access-policy matrix of what operators can/cannot do.
* **Operators page**: create/edit/disable/delete accounts, assign drones with checkboxes,
  reset password (temporary password shown once), unlock locked accounts.
* **Drones page**: register/edit/disable/delete drones, assign operators, switch a drone
  between `simulated` and `live_can` data source, CAN-gateway wiring instructions.
* **Notifications page** (admin-only, separate from the topbar bell): every alert, work order,
  fleet order, mission completion, account change and security event lands here
  (`notifications` table), filterable by category/severity/drone, mark-read/unread,
  bulk-clear, with toast pop-ups and an unread badge in the sidebar.
* **What operators are explicitly blocked from**: injecting faults / overhaul / changing a
  twin's environment, pause/resume/time-acceleration, grounding/recalling/clearing a drone,
  opening/closing work orders, creating or editing accounts or drones, and the notification
  inbox. They keep full read access to their own drones, can acknowledge alerts, and can run
  the non-mutating pre-flight feasibility simulation.

## 3. Quick start (local)

```bash
docker compose up --build      # Postgres + backend on :8000 (SEED_DEMO_OPERATORS=true)
cd frontend && npm install && npm run dev   # :5173
```
Sign in as `ADMIN` / `Admin@12345` (password change is forced), or a demo operator
`OPR-01` / `OPR-02` / `OPR-04` / `Operator@123`. Create real operator accounts from
**Operators** once signed in as admin.

Backend only, against SQLite, no Docker:
```bash
cd backend && pip install -r requirements.txt
DATABASE_URL=sqlite:///./aerotwin.db SEED_DEMO_OPERATORS=true python -m uvicorn app.main:app --reload
```

Run the automated end-to-end test (auth, roles, scoping, alerts, CAN ingest — no external services):
```bash
cd backend && python tests/test_api.py
```

## 4. Deploying: Vercel (frontend) + Render (backend) + Neon (database)

**Neon** — create a project, copy the pooled connection string (`...neon.tech/...?sslmode=require`).

**Render** — New → Blueprint → this repo (`render.yaml` is included), or manually:
Web Service, root `backend`, build `pip install -r requirements.txt`,
start `uvicorn app.main:app --host 0.0.0.0 --port $PORT`, health check `/health`.
Set env vars: `DATABASE_URL` (Neon string), `SECRET_KEY` (generate), `ADMIN_PASSWORD`,
`CORS_ORIGINS` (your Vercel URL). **Use exactly one worker/instance** — the live twins run
in-process and stream from memory, so horizontal scaling needs a broker (not needed for a
demo/eval fleet of this size). Render free tier sleeps when idle; the first request after a
sleep takes ~30–50 s to wake, which the login screen surfaces to the user.

**Vercel** — New Project → this repo → root `frontend` (Vite is auto-detected,
`vercel.json` is included). Set `VITE_API_BASE` to the Render URL. Redeploy after setting it
(Vite inlines env vars at build time).

After both are live, open the Vercel URL, sign in as `ADMIN`, change the password, then create
real drones and operator accounts from the Admin Console.

## 5. Connecting a real engine rig

Register a drone with data source `live_can`, set `INGEST_KEY` on the backend, then run
`tools/can_gateway.py` on the companion computer next to the SocketCAN interface (or with
`--demo` for a synthetic feed with no hardware). It decodes frames per a DBC-style map you
edit at the top of the file and POSTs 1 Hz samples to `/api/ingest/{tail}`. The backend runs
a healthy "shadow" twin from the same measured operating point so residual-based fault
detection and RUL work identically on real and simulated data.

## 6. Architecture notes

* One `DroneRuntime` per drone = physics plant (`AeroPistonEngine`, degrading) + a healthy
  shadow twin (same inputs, zero degradation) + a private fork of the trained ML bundle. The
  ML bundle's weights are shared read-only across drones; residual-filter state is per-drone.
* A single asyncio loop advances every *simulated* twin at 1 Hz (× configurable time
  acceleration), broadcasts over WebSocket, and hands database writes to a worker thread so
  Neon latency never blocks the twin loop.
* Telemetry is downsampled to Postgres every `PERSIST_EVERY_N_FRAMES` (default 60s of sim
  time) plus immediately on any new fault/limit breach/mission completion, and pruned to the
  most recent `TELEMETRY_KEEP_PER_DRONE` rows per drone — keeps a free-tier Neon database
  small over a long-running demo.
* See **Architecture** in the app itself for the live model bundle metrics (AE detection
  rate, classifier accuracy, RUL MAE) and a component-level system diagram.
