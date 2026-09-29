# AeroTwin-DT — Deployment Roadmap

From the software demonstrator in this repository to a fleet-deployed, airworthy digital twin.

---

## Phase 0 — Demonstrator (this repository) · complete

| Item | Status |
|---|---|
| Physics-informed engine model (Python + JavaScript, numerically aligned) | done |
| Run-to-failure corpus generator, 30 virtual units / 235 k samples | done |
| Anomaly, fault-classification and PINN-RUL models + export bundle | done |
| Edge service: SocketCAN acquisition, twin, inference, WebSocket, store-and-forward | done |
| Interactive 3D digital twin + 8-view ground control station | done |
| Mission replay, scenario simulation, fault injection, mission reports | done |

**Exit criteria met:** end-to-end demonstration on simulated datasets, with the identical model
bundle executing on the edge node and in the ground station.

---

## Phase 1 — Bench validation (0–3 months)

**Objective:** replace simulated telemetry with a real engine on a dynamometer.

1. **Instrumentation** — per-cylinder CHT and EGT thermocouples, oil pressure/temperature,
   coolant temperature, fuel flow meter, tri-axial accelerometer on the crankcase, bus-voltage tap,
   crank-angle reference for order tracking.
2. **CAN integration** — obtain the engine DBC from the ECU/FADEC vendor; replace the placeholder
   map in `edge/edge_service.py::CAN_MAP`; validate every signal against the bench DAQ.
3. **Model calibration** — fit the plant model to bench data: VE curve, thermal time constants and
   gains, oil-pressure map, vibration baseline. Target: residual RMS below sensor noise across the
   full power sweep.
4. **Seeded-fault campaign** — deliberately induce each of the eight modes (restricted injector,
   blocked radiator core, degraded oil, worn plug, drifted sensor) and record ground truth.
5. **Model retraining** — run the Colab notebook on bench data + simulation (transfer learning:
   pre-train on simulation, fine-tune on bench).

**Exit criteria:** detection rate ≥ 95 % and false alarms ≤ 1 % per flight hour on seeded faults;
RUL MAE ≤ 15 % of remaining life within 200 h of failure.

---

## Phase 2 — Ground and captive-carry integration (3–6 months)

1. Flight-representative edge hardware: NVIDIA Jetson Orin Nano or NXP i.MX8 class, −40…+71 °C,
   DO-160G environmental qualification path, < 10 W continuous.
2. Containerised deployment (`podman`/`systemd` unit) with A/B partitions and signed model bundles.
3. Datalink integration: telemetry multiplexed onto the existing encrypted C2 stream; QoS class
   below flight-critical traffic; verified store-and-forward through deliberate link outages.
4. GCS integration into the existing operator console (kiosk browser or embedded WebView).
5. Cyber: mTLS between edge and ground, signed OTA model updates, read-only edge API, audit log.

**Exit criteria:** 50 ground-run hours with zero missed engine events versus the maintenance log;
CPU headroom > 60 %; end-to-end latency < 2 s.

---

## Phase 3 — Flight trials (6–12 months)

1. **Advisory-only operation** — the twin observes and records; no crew action is taken on its
   output. Compare every advisory against post-flight inspection.
2. Envelope coverage: sea level to service ceiling, hot-and-high, maritime humidity/salt,
   endurance sorties above 20 h, rapid throttle transients.
3. Fleet corpus: accumulate ≥ 2 000 flight hours across ≥ 5 tail numbers.
4. Re-train and re-validate on real flight data; publish per-mode detection statistics.

**Exit criteria:** ≥ 90 % of maintenance findings pre-announced by the twin; false-alarm rate below
1 per 100 flight hours; RUL predictions within ±20 % at the maintenance decision point.

---

## Phase 4 — Operational deployment (12–18 months)

1. **Maintenance-credit transition**: from advisory-only to condition-based maintenance intervals
   agreed with the airworthiness authority. Deterministic limit monitoring stays as the certifiable
   safety layer; ML output feeds maintenance planning, not flight-critical control.
2. Fleet management tier: cross-aircraft health ranking, spares forecasting from aggregated RUL,
   automatic work-order generation from mission health reports.
3. **Federated learning** across tail numbers — weight deltas only, raw mission data never leaves
   the aircraft; FedAvg aggregation and signed re-issue from the ground segment.
4. Continuous verification: shadow-mode evaluation of every new bundle against a frozen regression
   corpus before it is signed for flight.

---

## Phase 5 — Extension (18 months +)

- Additional powerplants (heavy-fuel/diesel piston, rotary, hybrid-electric) by re-parameterising
  the plant model; the analytics layer is powerplant-agnostic.
- Airframe-level twin: propeller, fuel system, generator, thermal management.
- Mission-adaptive autonomy: the twin proposes power settings that maximise endurance within
  remaining-life constraints, feeding the autopilot as an advisory.
- Digital-thread integration with the OEM: as-built configuration, part serial history and
  overhaul records bound to each twin instance.

---

## Certification and assurance posture

| Layer | Assurance approach |
|---|---|
| Limit monitoring / cautions | deterministic, testable, DO-178C-style development |
| Physics twin | verified against bench and flight data; documented residual envelope |
| ML anomaly / RUL | advisory only; EASA/FAA "learning assurance" (W-shaped) process; frozen bundles, versioned data, reproducible training |
| Edge platform | DO-160G environmental, secure boot, signed containers |
| Data governance | on-board retention policy, federated updates, encrypted transport |

---

## Risk register (top items)

| Risk | Mitigation |
|---|---|
| Simulation-to-reality gap in the plant model | Phase-1 calibration campaign; transfer learning; residual-envelope monitoring |
| Class confusion between early-stage faults | severity-gated diagnosis; report top-3 posterior with confidence, not a single label |
| False alarms eroding operator trust | high threshold percentile, EWMA smoothing, persistence counters, explainable attributions |
| Edge compute/thermal budget | INT8 quantised students (< 100 kB), 1 Hz cadence, measured < 2 ms/frame |
| Datalink loss | store-and-forward buffer + full in-browser twin fallback |
| Sensor failure masquerading as engine fault | dedicated SENSOR_DRIFT class + cross-channel physics consistency checks |
