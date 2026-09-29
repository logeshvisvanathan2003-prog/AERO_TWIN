# AeroTwin-DT — Technical Documentation

Operating, extending and integrating the digital twin.

---

## 1. Quick start

### 1.1 Ground control station only (no backend)

```bash
cd aero-dt/web
python3 -m http.server 5173
# open http://localhost:5173
```

The dashboard runs the complete twin in the browser: physics model, ML bundle, diagnostics,
simulation, replay and reporting. This is the degraded-mode / offline configuration and needs no
Python at all beyond the static file server.

### 1.2 With the edge service (live telemetry)

```bash
cd aero-dt
pip install -r edge/requirements.txt
python3 edge/edge_service.py            # simulated engine on :8000
# in another shell
cd web && python3 -m http.server 5173
```

Open `http://localhost:5173` — the link indicator switches to **LIVE EDGE · CAN** and every frame
now originates from the edge node, including its edge-computed inference.

Point the dashboard at a remote node: `http://localhost:5173/?edge=192.168.1.40:8000`

### 1.3 With a real engine (SocketCAN)

```bash
sudo ip link set can0 type can bitrate 500000
sudo ip link set up can0
SOURCE=can CAN_IF=can0 python3 edge/edge_service.py
```

---

## 2. Ground control station

| View | Contents |
|---|---|
| **Overview** | interactive 3D twin, 9 KPI tiles, component inspector, active alerts, speed/power, thermal and oil/vibration trends |
| **Health** | 8 sub-system health indices, per-cylinder EGT/CHT balance, measured-vs-twin parameter table with residual and limit, health trend |
| **Diagnostics** | ranked fault findings with evidence and recommended action, anomaly score vs threshold, fault-posterior bars, explainability attributions, event log |
| **Predictive** | RUL with confidence band, degradation-state trends, maintenance advisory, next-action planning |
| **Simulation** | mission scenario selection (standard / hot-day / high-altitude / transients / endurance), altitude-throttle profile, manual flight-condition control, fault injection sliders, four one-click fault presets, ageing-rate control, zero-time overhaul |
| **Replay** | record/scrub/play any mission segment, synchronised charts, CSV export |
| **Reports** | generated mission health report (markdown download) with phase summary, findings, advisories and exceedances |
| **Architecture** | live system architecture, deployed model performance, technology stack |

### 2.1 3D twin controls

| Action | Result |
|---|---|
| drag | orbit · scroll — zoom |
| click a component or its label | selects it; the inspector shows that sub-system's health, live parameters and any active finding |
| **Cutaway** | crankcase and cylinder walls become translucent — pistons, rods and crankshaft visible in motion |
| **Exploded** | components separate along their radial axes for assembly inspection |
| **Thermal** | components are shaded by their live temperature (CHT per cylinder, EGT on the exhaust path) |
| **Labels** | toggles projected hotspot labels; labels turn amber/red when their component has an active finding |

The animation is driven by the live model, not a canned loop: crank/piston motion follows actual
rpm through slider-crank kinematics, the propeller follows the reduction ratio, exhaust particle
flow scales with mass flow and EGT, vibration jitter scales with the measured vibration amplitude,
and a misfire produces a visible flash in the affected cylinder.

---

## 3. Edge service API

Base URL `http://<edge>:8000`

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | liveness, source, link state, frames served, buffer depth, model status |
| GET | `/api/state` | most recent fused frame (telemetry + twin baseline + inference) |
| GET | `/api/history?n=600` | store-and-forward buffer (newest last) |
| POST | `/api/command` | `{"cmd":"inject","mode":"injector_clog","value":0.4}`, `{"cmd":"rate","value":8}`, `{"cmd":"overhaul"}` |
| WS | `/ws/telemetry` | 1 Hz JSON stream; `?backfill=1` replays the buffer on connect |

### 3.1 Frame schema (abridged)

```jsonc
{
  "ts": 1757000000.4, "mission_t": 2431.0, "phase": "CRUISE", "source": "can",
  "rpm": 4103.2, "map_kpa": 58.4, "fuel_flow": 6.85, "egt": 562.1, "cht": 148.7,
  "oil_p": 4.95, "oil_t": 96.2, "coolant_t": 92.0, "vib": 0.82, "vib_1x": 0.45,
  "vib_half": 0.09, "bus_v": 14.1, "inj_act": 20.4, "throttle": 0.62,
  "alt_m": 5200, "oat_c": -9.6, "power_kw": 24.8, "bsfc": 276.0, "misfire": 1.1,
  "cylCHT": [148.7, 149.9, 151.2, 147.8], "cylEGT": [562, 559, 548, 566],
  "twin":  { "rpm": 4101.0, "cht": 146.9, "egt": 558.0, "oil_p": 5.02, "...": 0 },
  "inference": {
    "score": 0.62, "threshold": 0.0592, "anomalous": false,
    "fault": "NOMINAL", "fault_conf": 0.94, "rul_h": 547.2,
    "attrib": [{ "feature": "r_cht", "share": 0.21, "value": 1.8, "deviation": 0.4 }]
  }
}
```

`score` is normalised: **> 1 means the reconstruction error exceeded the trained threshold.**

### 3.2 CAN signal map

`edge/edge_service.py::CAN_MAP` — `{arbitration_id: [(name, start_byte, length, scale, offset, signed)]}`

| ID | Signals |
|---|---|
| `0x180` | rpm, MAP, throttle, injector actuation |
| `0x181` | CHT, EGT, coolant T, oil T |
| `0x182` | oil pressure, fuel flow, bus voltage, vibration |
| `0x183` | altitude, TAS, OAT, misfire counter |

Replace with the airframe DBC during Phase-1 integration; nothing downstream changes.

---

## 4. Model bundle (`web/assets/dt_models.json`)

```jsonc
{
  "schema": "aerotwin-dt/1.0",
  "features": ["rpm", "...", "r_bsfc", "t"],       // 28 dims: 16 raw + 11 residual + hours
  "classes":  ["NOMINAL", "MISFIRE", "..."],       // 8 fault classes
  "norm": { "mean": [...], "std": [...] },         // fixed at export, clipped to ±8
  "resid_alpha": 0.1,                              // EWMA smoothing on residuals
  "autoencoder": { "params": [W0,b0,...], "threshold": 0.0592, "act": "tanh" },
  "classifier":  { "params": [W0,b0,...], "act": "relu",
                   "feature_idx": [0,...,26] },          // engine-hours excluded on purpose
  "rul":         { "params": [W0,b0,...], "scale": 600.0, "act": "relu" },
  "metrics": { "ae_detection": 0.994, "ae_false_alarm": 0.0048,
               "clf_accuracy": 0.772, "clf_balanced_acc": 0.807,
               "rul_mae_h": 58.5, "rul_mae_near_h": 49.2 }
}
```

`params` is a flat `[W0, b0, W1, b1, …]` list — one dense layer per pair, which maps 1:1 onto ONNX
`Gemm` nodes. The same file is read by `web/js/ml-runtime.js` and `edge/edge_service.py`, so the
ground station and the aircraft always compute identical numbers.

### 4.1 Retraining

**Reference (NumPy, no GPU, ~4 min):**

```bash
python3 ml/build_dataset.py 30      # run-to-failure corpus  -> ml/data/engine_runs.csv
python3 ml/train_export.py          # trains + writes web/assets/dt_models.json
```

**Full pipeline (Colab, GPU):** open `ml/AeroTwin_DT_Training.ipynb`, run all. It trains the LSTM
auto-encoder, CNN+GRU classifier and PINN RUL network, distils them into the dense students,
prints the evaluation plots and exports the same `dt_models.json` (plus optional ONNX/INT8
artefacts and a federated-learning demonstration). Drop the downloaded file into `web/assets/` and
set `MODELS=` on the edge node — no code change.

---

## 5. Extending the system

| Task | Where |
|---|---|
| New sensor channel | add to the plant model output, to `RAW` in `ml/build_dataset.py`, and to `RAW_KEYS` in `ml-runtime.js` / `edge_service.py`; retrain |
| New fault mode | add a degradation state in both plant models, map it in `MODE_TO_FAULT`, add an expert rule in `web/js/diagnostics.js`, retrain |
| New 3D component | add geometry in `web/js/twin3d.js` with a `partId`, register a hotspot anchor, reference the same id from the diagnostic rule so findings highlight it |
| Different engine | re-parameterise the `ENGINE` dict (displacement, power, rpm, boost, critical altitude) in both plant models and recalibrate the thermal/vibration gains |
| New mission scenario | extend `mission_profile()` (Python and JS) and the scenario selector in the Simulation view |

---

## 6. Verification performed in this build

- Physics model cross-checked between the Python and JavaScript implementations (same inputs →
  same trajectories within numerical noise).
- Steady-state realism: cruise ≈ 25 kW at 62 % throttle, BSFC ≈ 276 g/kWh, CHT thermostat-governed
  floor 92 °C, take-off CHT ≈ 160 °C, oil pressure 4–5 bar at cruise.
- Models trained and evaluated on **held-out engines** (6 of 30 units never seen in training).
- The fault classifier is trained on class-balanced samples and consumes only the 27 raw+residual
  features — engine hours are excluded so a fault seeded on a zero-timed engine is still diagnosed
  correctly (verified by live injection through the edge node).
- Edge service exercised end-to-end: acquisition → twin → residuals → inference → WebSocket →
  dashboard, including link-loss fallback to the in-browser twin.
- Dashboard verified in an automated browser: all eight views, 3D interaction modes,
  component selection, fault injection, replay scrub and report generation, desktop and mobile.

## 7. Known limitations

- The demonstrator's ground truth is a physics simulation, not a real engine — Phase 1 of the
  roadmap exists precisely to close that gap.
- Fault classification accuracy (77.2 %, 80.7 % macro-recall) is measured across the whole
  trajectory including very early wear where classes overlap physically; the operator UI therefore
  shows the full posterior, not one label.
- Vibration is modelled as order-tracked band amplitudes rather than a full spectrum; a real
  installation should stream FFT bins for bearing-defect frequencies.
- The 3D model is a faithful functional representation of a flat-four turbo-normalised engine, not
  the OEM CAD geometry; a real deployment would import the vendor GLTF and keep the same part ids.
