# AeroTwin-DT — Digital Twin Architecture Design

**System:** Digital Twin framework for aero piston engines powering MALE (Medium-Altitude
Long-Endurance) UAVs on ISR, maritime surveillance and strategic missions.
**Reference powerplant:** AE-115T — 4-cylinder boxer, 1.211 L, liquid-cooled, turbo-normalised,
84.5 kW @ 5 800 rpm, critical altitude 4 900 m, FADEC-controlled sequential injection.

---

## 1. Why a digital twin

Current practice is threshold-based reactive monitoring: a parameter crosses a red line, a caution
appears, and the crew responds after the fact. Threshold logic cannot see a fault that is still
inside limits, cannot distinguish "hot because it is a 45 °C day at 62 % power" from "hot because
the radiator core is fouled", and provides no time-to-action.

AeroTwin-DT replaces that with a **synchronised virtual engine** — a physics model of the same
powerplant, driven by the same commands and the same atmosphere, running continuously beside the
real one. The difference between the two (the **residual**) is the diagnostic signal:

```
residual r(t) = y_measured(t) − y_twin(t)
```

Residuals are condition-independent by construction: altitude, throttle, OAT and airspeed affect
both engines identically and cancel. Everything downstream — anomaly detection, classification,
RUL, advisories — consumes residuals rather than raw values.

---

## 2. Layered architecture

```
┌───────────────────────────────────────────────── AIR VEHICLE ─────────────────────────────────────────────┐
│  ENGINE + SENSING                     EDGE NODE (Jetson Orin Nano / i.MX8)                                │
│  ┌──────────────────┐                 ┌─────────────────────────────────────────────────────────────┐    │
│  │ ECU / FADEC      │  CAN 2.0B       │ 1. Acquisition   SocketCAN @500 kbit/s → engineering units   │    │
│  │ RPM, MAP, CHT×4  │  500 kbit/s     │ 2. Virtual twin  physics plant model, healthy shadow mode    │    │
│  │ EGT×4, oil p/T   │ ───────────────▶│ 3. Residuals     r = measured − twin, EWMA α = 0.1           │    │
│  │ coolant T, fuel  │                 │ 4. Edge AI       AE anomaly · fault CNN · PINN RUL (INT8)    │    │
│  │ vibration (IMU)  │                 │ 5. Rules         limit monitor + expert fault signatures     │    │
│  │ bus V / alt.     │                 │ 6. Store & fwd   ring buffer, replays after link loss        │    │
│  └──────────────────┘                 └───────────────────────────┬─────────────────────────────────┘    │
└───────────────────────────────────────────────────────────────────┼──────────────────────────────────────┘
                                        encrypted C2 / SATCOM datalink │ WebSocket 1 Hz JSON (TLS + mTLS)
┌───────────────────────────────────────────────────────────────────┼──────────────────── GROUND SEGMENT ──┐
│  GROUND CONTROL STATION (this repository's `web/`)                ▼                                      │
│  ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐    │
│  │ 3D interactive twin · health · diagnostics · predictive · simulation · replay · reports          │    │
│  │ identical model bundle runs in-browser → full capability with the datalink down (degraded mode)  │    │
│  └──────────────────────────────────────────────────────────────────────────────────────────────────┘    │
│  FLEET / CLOUD TIER                                                                                       │
│  run-to-failure corpus · LSTM-AE + CNN-GRU + PINN training (Colab) · FedAvg fleet learning · maintenance  │
└───────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 2.1 Acquisition layer
`edge/edge_service.py` decodes the ECU/FADEC DBC map (IDs `0x180`–`0x183`) from SocketCAN into
engineering units at 1–10 Hz. When no bus is attached (bench, HIL, demonstration) the identical
service runs the physics plant as the signal source, so the whole stack is exercised end-to-end
without hardware.

### 2.2 Virtual engine model (DT core)
`ml/simulator.py` (Python, edge/training) and `web/js/engine-model.js` (JavaScript, GCS) are two
implementations of one model, kept numerically aligned:

| Sub-model | Physics |
|---|---|
| Atmosphere | ISA with ISA-deviation, density-altitude corrected |
| Breathing | manifold pressure with turbo-normalisation + wastegate limit, peaked volumetric-efficiency curve |
| Combustion | air-fuel ratio, λ, LHV-based indicated work, misfire process |
| Mechanical | slider-crank kinematics, torque = P/ω, propeller load |
| Thermal | first-order RC networks for CHT (τ≈26 s), oil (τ≈48 s), coolant (τ≈34 s), EGT (τ≈9 s) |
| Lubrication | pressure vs rpm × viscosity, viscosity vs oil degradation and temperature |
| Vibration | order-tracked 1× (imbalance/bearing) and 0.5× (misfire/combustion) bands |
| Electrical | alternator/bus voltage vs rpm, ignition-system loading, battery SoC |
| Degradation | 7 states: ring wear, injector fouling, cooling fouling, oil degradation, bearing wear, sensor drift, ignition wear |

The twin runs in two instances: **synchronised** (inherits the estimated health state) and
**healthy shadow** (zero degradation) — the shadow is the residual reference.

### 2.3 Analytics layer
1. **Limit monitor** — deterministic, certifiable: rpm, CHT, EGT, oil pressure/temperature,
   coolant, vibration, bus voltage, MAP, each with caution and warning bands.
2. **Expert fault signatures** — physically-derived rules mapping residual patterns to the eight
   named failure modes, each carrying evidence text, a recommended action and the 3D component id
   that gets highlighted in the twin.
3. **Machine learning** — see §3.
4. **Advisory generator** — fuses RUL, active findings and health indices into
   ROUTINE / PLANNED / PRIORITY / IMMEDIATE, plus a mission-readiness verdict (GO / GO-RESTRICTED / NO-GO).

### 2.4 Presentation layer
A single-page ground control station: eight views (overview, health, diagnostics, predictive,
simulation, replay, reports, architecture) built on an interactive 3D engine model with
click-to-inspect components, cutaway/exploded/thermal modes and fault-driven highlighting.

---

## 3. AI/ML layer

| Head | Architecture (training) | Deployed student | Purpose |
|---|---|---|---|
| Anomaly | LSTM auto-encoder, 30×28 window, latent 12 | dense 28-12-6-12-28, tanh | unsupervised novelty; threshold = 99.3rd percentile of healthy error |
| Diagnosis | Conv1D-64 → Conv1D-64 → GRU-48 | dense 48-16-8, relu/softmax | 8-class root cause |
| Prognosis | Conv1D → GRU-64 + PINN loss | dense 64-32-1, relu | remaining useful life (h) |

**Physics-informed loss** on the RUL head:

```
L = MSE(ŷ, y) + λ_mono · mean(relu(ŷ_{t+1} − ŷ_t))      # damage is irreversible
              + λ_deg  · mean(relu(ŷ − (1 − severity)))  # RUL must fall as severity rises
```

**Feature vector (28 dims)** = 16 raw channels + 11 EWMA-smoothed residuals + engine hours.
Normalisation is fixed at export time (mean/std, clipped ±8) so edge and GCS are bit-comparable.

**Explainability** — the per-feature reconstruction error of the auto-encoder is exposed directly
in the dashboard: the operator sees *which* channels drove the anomaly score, not just that the
score rose.

**Measured performance** (held-out engines never seen in training, corpus of 235 150 samples from
30 run-to-failure units):

| Metric | Value |
|---|---|
| Anomaly detection rate | 99.4 % |
| False-alarm rate on healthy data | 0.48 % |
| Fault classification accuracy (8 classes) | 77.2 % |
| Fault classification macro-recall (class-balanced) | 80.7 % |
| RUL mean absolute error | 58.5 h |
| RUL MAE within 200 h of failure | 49.2 h |

Classification accuracy is measured across the *whole* degradation trajectory including
near-nominal early wear where classes are genuinely ambiguous; accuracy rises sharply once
severity exceeds the detection threshold. The numbers are reproduced by
`ml/train_export.py` and printed by the Colab notebook.

---

## 4. Data flow, timing and resilience

| Path | Rate | Budget |
|---|---|---|
| CAN acquisition → engineering units | 10 Hz | < 5 ms |
| Twin step + residuals | 1 Hz | < 3 ms |
| Edge inference (3 dense heads, INT8) | 1 Hz | < 2 ms on ARM A78 |
| Edge → GCS WebSocket frame | 1 Hz | ~1.4 kB/frame (≈ 11 kbit/s) |
| GCS render (3D + charts) | 60 fps | GPU-composited |

**Link loss:** the edge node buffers 7 200 frames (2 h at 1 Hz) and flushes on reconnect
(`/ws/telemetry?backfill=1`). The GCS simultaneously falls back to its in-browser twin, so the
operator keeps a synchronised model, alerting and advisories with no datalink at all.

**Security:** telemetry is carried over the existing encrypted C2 link; the edge exposes only a
read-mostly API; the model bundle is content-hashed and signed before upload; federated learning
ships weight deltas, never raw mission data.

---

## 5. Failure modes covered

| Mode | Primary residual signature | Dashboard action |
|---|---|---|
| Misfire | 0.5× vibration ↑, single-cylinder EGT ↓, bus V ripple | ignition/plug inspection, cylinder highlighted in 3D |
| Injector abnormality | injector actuation ↑, λ lean, EGT ↑, BSFC ↑ | injector flow test / cleaning |
| Cooling degradation | CHT & coolant residual ↑ at constant power | radiator core / duct inspection |
| Lubrication issue | oil pressure ↓, oil temperature ↑, viscosity loss | oil and filter service, sample analysis |
| Bearing wear | 1× vibration ↑, oil pressure ↓, oil temperature ↑ | borescope, vibration spectrum trending |
| Sensor drift / failure | one channel departs the twin while correlated channels do not | sensor calibration / replacement |
| Combustion instability | ring wear, λ scatter, EGT spread, power deficit | compression check, top-end inspection |
| Overheating trend | CHT trend crossing predicted limit before mission end | power/airspeed advisory, mission re-plan |

---

## 6. Repository map

```
aero-dt/
├── web/            Ground control station (3D twin + dashboard, no build step)
│   ├── js/         engine-model · twin3d · ml-runtime · diagnostics · charts · telemetry · app
│   └── assets/     dt_models.json  ← exported model bundle
├── edge/           FastAPI + SocketCAN edge service (WebSocket telemetry, edge inference)
├── ml/             simulator · dataset builder · NumPy training/export · Colab notebook
└── docs/           architecture · deployment roadmap · technical documentation
```
