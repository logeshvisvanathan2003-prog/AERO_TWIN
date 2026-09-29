"""
AeroTwin-DT :: Physics-informed aero piston engine simulator
============================================================
Reference engine : 4-cylinder horizontally-opposed, liquid/air cooled,
                   turbo-normalised, ~85 kW class (Rotax 914 / P&W class
                   analogue) used on MALE UAV platforms.

The same equations are mirrored 1:1 in  web/js/engine-model.js  so that the
browser Digital Twin, the edge service and the training pipeline all share a
single source of physical truth (this is what makes the twin *synchronised*).

Units: SI unless noted.  RPM in rev/min, temps in degC, pressures in kPa/bar,
fuel flow in kg/h, vibration in g-RMS.
"""
from __future__ import annotations
import math
import numpy as np

# ----------------------------------------------------------------------------
# Engine constants (indigenous MALE-UAV piston engine, "AE-115T")
# ----------------------------------------------------------------------------
ENGINE = dict(
    displacement_l=1.211,      # total swept volume [L]
    cylinders=4,
    idle_rpm=1400.0,
    max_rpm=5800.0,
    max_power_kw=84.5,
    compression_ratio=9.0,
    lhv_mj_kg=43.5,            # lower heating value of AVGAS/MOGAS
    stoich_afr=14.7,
    boost_limit_bar=1.38,      # wastegate limited MAP
    crit_alt_m=4900.0,         # turbo critical altitude
    oil_capacity_l=3.0,
    prop_gear_ratio=2.43,
)
R_AIR = 287.05


# ----------------------------------------------------------------------------
# Atmosphere (ISA + deviation)
# ----------------------------------------------------------------------------
def isa(alt_m: float, isa_dev_c: float = 0.0):
    """Return (static pressure [Pa], static temperature [K], density [kg/m3])."""
    t = 288.15 - 0.0065 * min(alt_m, 11000.0) + isa_dev_c
    p = 101325.0 * (1.0 - 2.25577e-5 * min(alt_m, 11000.0)) ** 5.25588
    rho = p / (R_AIR * t)
    return p, t, rho


# ----------------------------------------------------------------------------
# Health / degradation state vector
# ----------------------------------------------------------------------------
HEALTH_KEYS = [
    "ring_wear",        # blow-by, compression loss
    "injector_clog",    # fuel delivery restriction on cyl #k
    "cooling_fouling",  # radiator/fin fouling -> CHT rise
    "oil_degradation",  # viscosity loss -> oil pressure drop
    "bearing_wear",     # vibration signature growth
    "sensor_drift",     # EGT/CHT probe drift
    "ignition_wear",    # plug/coil erosion -> misfire probability
]


def fresh_health():
    return {k: 0.0 for k in HEALTH_KEYS}


class AeroPistonEngine:
    """Continuous-time engine plant model with first-order thermal dynamics."""

    def __init__(self, health=None, seed: int | None = None):
        self.h = dict(fresh_health()) if health is None else dict(health)
        self.rng = np.random.default_rng(seed)
        self.rpm = ENGINE["idle_rpm"]
        self.cht = 40.0
        self.egt = 200.0
        self.oil_t = 35.0
        self.coolant_t = 40.0
        self.battery_soc = 1.0
        self.hours = 0.0
        self.misfire_latch = 0.0
        # per-unit relative damage rate for each degradation mode (fleet spread)
        self.rate_mult = {k: 1.0 for k in HEALTH_KEYS}

    # -- steady state maps ---------------------------------------------------
    def _map_kpa(self, throttle, p_amb, alt_m):
        """Manifold absolute pressure with turbo-normalisation + wastegate."""
        na = p_amb * (0.32 + 0.68 * throttle)                       # naturally aspirated part
        boost_avail = ENGINE["boost_limit_bar"] * 1e5 * min(1.0, max(0.0, 1.15 - alt_m / (ENGINE["crit_alt_m"] * 1.9)))
        boosted = min(boost_avail, na * (1.0 + 1.05 * throttle))
        return max(28.0, boosted / 1000.0)                          # kPa

    def _vol_eff(self, rpm):
        x = rpm / ENGINE["max_rpm"]
        return 0.78 + 0.30 * x - 0.26 * x * x                       # peaked VE curve

    def step(self, dt, throttle, alt_m, isa_dev_c, tas_ms=45.0, deg_rate=1.0):
        """Advance the plant by dt seconds. Returns a telemetry dict."""
        h = self.h
        p_amb, t_amb_k, rho = isa(alt_m, isa_dev_c)
        t_amb_c = t_amb_k - 273.15

        # --- rotational dynamics (first order lag toward governed RPM) -------
        rpm_cmd = ENGINE["idle_rpm"] + (ENGINE["max_rpm"] - ENGINE["idle_rpm"]) * throttle
        rpm_cmd *= (1.0 - 0.06 * h["ring_wear"])
        tau_rpm = 0.55
        self.rpm += (rpm_cmd - self.rpm) * (1.0 - math.exp(-dt / tau_rpm))
        self.rpm = float(np.clip(self.rpm + self.rng.normal(0, 4.0), 900, 6200))

        # --- charge / breathing ---------------------------------------------
        map_kpa = self._map_kpa(throttle, p_amb, alt_m)
        ve = self._vol_eff(self.rpm) * (1.0 - 0.22 * h["ring_wear"])
        t_intake = t_amb_k + 26.0 * (map_kpa * 1000.0 / p_amb - 1.0)   # post-compressor rise
        m_air = (map_kpa * 1000.0 * ENGINE["displacement_l"] * 1e-3 * ve
                 * (self.rpm / 60.0 / 2.0)) / (R_AIR * t_intake)        # kg/s

        # --- fuelling -------------------------------------------------------
        lam_target = 1.18 - 0.30 * throttle                             # rich at high power
        afr = ENGINE["stoich_afr"] * lam_target
        m_fuel = m_air / afr * (1.0 - 0.35 * h["injector_clog"])
        fuel_flow_kgh = m_fuel * 3600.0

        # --- misfire / combustion stability ---------------------------------
        # fraction of firing events that misfire (rate-based, dt independent)
        p_misfire = 0.0015 + 0.42 * h["ignition_wear"] ** 1.6 + 0.30 * h["injector_clog"] ** 1.8
        p_misfire *= 1.0 + 0.8 * max(0.0, (alt_m - 5500.0) / 6000.0)
        misfire = float(np.clip(p_misfire + self.rng.normal(0, 0.01), 0.0, 1.0))
        tau_m = max(6.0, dt)
        self.misfire_latch = max(misfire, self.misfire_latch * math.exp(-dt / tau_m))
        comb_eff = 0.985 - 0.20 * self.misfire_latch - 0.05 * h["ring_wear"]

        # --- power ----------------------------------------------------------
        eta_th = (1.0 - ENGINE["compression_ratio"] ** -0.36) * 0.56   # ~0.30 BTE, bsfc ~280 g/kWh
        power_kw = m_fuel * ENGINE["lhv_mj_kg"] * 1e3 * eta_th * comb_eff
        power_kw = float(np.clip(power_kw, 0.0, ENGINE["max_power_kw"] * 1.08))
        bsfc = (fuel_flow_kgh / max(power_kw, 1e-3)) * 1000.0           # g/kWh

        # --- exhaust gas temperature ----------------------------------------
        egt_eq = (t_amb_c + 300.0 + 620.0 * (power_kw / ENGINE["max_power_kw"]) ** 0.62
                  - 140.0 * (lam_target - 1.0) + 90.0 * self.misfire_latch)
        self.egt += (egt_eq - self.egt) * (1.0 - math.exp(-dt / 3.5))

        # --- cylinder head temperature (thermal RC network) ------------------
        cooling = (0.50 + 0.50 * min(1.0, tas_ms / 50.0)) * (rho / 1.225) ** 0.35
        cooling *= (1.0 - 0.42 * h["cooling_fouling"])
        cht_eq = t_amb_c + (45.0 + 80.0 * (power_kw / ENGINE["max_power_kw"])) / max(cooling, 0.45)
        cht_eq = max(cht_eq, 92.0)   # thermostat / cowl-flap governed floor
        self.cht += (cht_eq - self.cht) * (1.0 - math.exp(-dt / 26.0))

        # --- oil circuit ------------------------------------------------------
        oil_eq = 0.62 * self.cht + 18.0 + 8.0 * h["oil_degradation"]
        self.oil_t += (oil_eq - self.oil_t) * (1.0 - math.exp(-dt / 55.0))
        visc = math.exp(-0.021 * (self.oil_t - 90.0)) * (1.0 - 0.30 * h["oil_degradation"])
        oil_p = (1.05 + 3.6 * (self.rpm / ENGINE["max_rpm"]) ** 0.85) * min(1.35, max(0.45, visc))
        oil_p *= (1.0 - 0.22 * h["bearing_wear"])
        oil_p = float(max(0.25, oil_p + self.rng.normal(0, 0.02)))       # bar

        # --- coolant ----------------------------------------------------------
        self.coolant_t += ((0.80 * self.cht + 12.0) - self.coolant_t) * (1.0 - math.exp(-dt / 40.0))

        # --- vibration signature ---------------------------------------------
        base_vib = 0.28 + 0.85 * (self.rpm / ENGINE["max_rpm"]) ** 1.6
        vib = (base_vib * (1.0 + 1.9 * h["bearing_wear"])
               + 1.6 * self.misfire_latch + 0.9 * h["ring_wear"] * (self.rpm / 4000.0))
        vib = float(max(0.05, vib + self.rng.normal(0, 0.03)))           # g RMS
        vib_1x = vib * (0.55 + 0.9 * h["bearing_wear"])                  # 1x order band
        vib_half = vib * (0.10 + 1.3 * self.misfire_latch)               # 0.5x -> misfire band

        # --- electrical --------------------------------------------------------
        alt_load = 0.45 + 0.35 * throttle
        alt_v = 13.9 + 0.35 * min(1.0, self.rpm / 2600.0) - 0.9 * h["ignition_wear"]
        alt_i = 18.0 * alt_load * (1.0 - 0.25 * h["ignition_wear"])
        charging = alt_v > 13.2 and self.rpm > 1800
        self.battery_soc = float(np.clip(self.battery_soc + (0.00004 if charging else -0.00012) * dt, 0.05, 1.0))
        bus_v = alt_v if charging else 12.2 + 1.4 * self.battery_soc

        # --- injection timing / ECU ---------------------------------------------
        inj_cmd = 12.0 + 16.0 * (self.rpm / ENGINE["max_rpm"]) - 4.0 * (map_kpa / 140.0)
        inj_act = inj_cmd - 3.5 * h["injector_clog"] + self.rng.normal(0, 0.15)
        inj_pw = 2.2 + 6.0 * throttle * (1.0 + 0.4 * h["injector_clog"])   # ms

        # --- sensor drift (fault injected on the *measurement*) ------------------
        drift = h["sensor_drift"]
        cht_m = self.cht * (1.0 + 0.06 * drift) + self.rng.normal(0, 0.6)
        egt_m = self.egt * (1.0 - 0.05 * drift) + self.rng.normal(0, 4.0)

        # --- degradation progression --------------------------------------------
        stress = (0.35 + 0.65 * (power_kw / ENGINE["max_power_kw"])) * (1.0 + max(0.0, (self.cht - 165.0) / 70.0))
        inc = deg_rate * stress * dt / 3600.0            # equivalent damaging hours
        h["ring_wear"] = min(1.0, h["ring_wear"] + inc * 6.0e-4 * self.rate_mult["ring_wear"])
        h["bearing_wear"] = min(1.0, h["bearing_wear"] + inc * 3.6e-4 * self.rate_mult["bearing_wear"] * (1 + 2 * vib_1x))
        h["cooling_fouling"] = min(1.0, h["cooling_fouling"] + inc * 4.8e-4 * self.rate_mult["cooling_fouling"])
        h["oil_degradation"] = min(1.0, h["oil_degradation"] + inc * 8.5e-4 * self.rate_mult["oil_degradation"])
        h["injector_clog"] = min(1.0, h["injector_clog"] + inc * 5.8e-4 * self.rate_mult["injector_clog"])
        h["ignition_wear"] = min(1.0, h["ignition_wear"] + inc * 7.0e-4 * self.rate_mult["ignition_wear"])
        h["sensor_drift"] = min(1.0, h["sensor_drift"] + inc * 3.0e-4 * self.rate_mult["sensor_drift"])
        self.hours += dt / 3600.0

        # per-cylinder spread (mirrors web/js/engine-model.js — drives the 3D twin
        # and the cylinder-balance view; cylinder 3 carries the misfire)
        _bias = (1.00, 1.03, 0.97, 1.01)
        cyl_egt, cyl_cht = [], []
        for i in range(4):
            sick = self.misfire_latch if i == 2 else 0.15 * self.misfire_latch
            cyl_egt.append(egt_m * _bias[i] - 120.0 * sick + self.rng.normal(0, 3.0))
            cyl_cht.append(cht_m * _bias[i] + 6.0 * sick + self.rng.normal(0, 0.8))

        return dict(
            cylEGT=cyl_egt, cylCHT=cyl_cht,
            t=self.hours, rpm=self.rpm, throttle=throttle, alt_m=alt_m, oat_c=t_amb_c,
            map_kpa=map_kpa, fuel_flow=fuel_flow_kgh, power_kw=power_kw, bsfc=bsfc,
            egt=egt_m, cht=cht_m, oil_p=oil_p, oil_t=self.oil_t, coolant_t=self.coolant_t,
            vib=vib, vib_1x=vib_1x, vib_half=vib_half, bus_v=bus_v, alt_i=alt_i,
            soc=self.battery_soc, inj_cmd=inj_cmd, inj_act=inj_act, inj_pw=inj_pw,
            misfire=self.misfire_latch, lam=lam_target, **{f"h_{k}": h[k] for k in HEALTH_KEYS},
        )


# ----------------------------------------------------------------------------
# Mission profile generator
# ----------------------------------------------------------------------------
MISSION_PHASES = [
    # (name, duration_s, throttle, alt_m, tas)
    ("START",   90,  0.15,   200, 0),
    ("TAXI",   180,  0.22,   200, 8),
    ("TAKEOFF", 120, 0.98,   400, 32),
    ("CLIMB",  1500, 0.88,  5200, 42),
    ("CRUISE", 3600, 0.62,  7600, 58),
    ("LOITER", 7200, 0.48,  7000, 48),
    ("DESCENT", 900, 0.30,  1200, 55),
    ("LANDING", 240, 0.35,   200, 30),
]


def mission_profile(t, scenario="standard"):
    """Return (phase, throttle, alt_m, isa_dev, tas) for mission-elapsed time t [s]."""
    acc = 0.0
    prev = MISSION_PHASES[0]
    for name, dur, thr, alt, tas in MISSION_PHASES:
        if t < acc + dur:
            f = (t - acc) / dur
            alt0 = prev[3]
            alt_i = alt0 + (alt - alt0) * min(1.0, f * 1.6)
            thr_i = thr
            if scenario == "hot_day":
                dev = 25.0
            elif scenario == "high_alt":
                alt_i *= 1.35
                dev = 5.0
            elif scenario == "transients":
                thr_i = np.clip(thr + 0.35 * math.sin(t / 9.0) + 0.2 * math.sin(t / 2.3), 0.12, 1.0)
                dev = 0.0
            else:
                dev = 0.0
            return name, float(thr_i), float(alt_i), dev, tas
        acc += dur
        prev = (name, dur, thr, alt, tas)
    return "LOITER", 0.48, 7000.0, 0.0, 48.0


TOTAL_MISSION_S = sum(p[1] for p in MISSION_PHASES)
