import { useState, useMemo, useEffect, useRef } from 'react';
import { api } from '../lib/api.js';
import RollingLineChart from '../charts/RollingLineChart.jsx';
import { HEALTH_KEYS, HEALTH_LABEL, missionProfile, TOTAL_MISSION_S } from '../lib/constants.js';

const SCENARIOS = [
  ['standard', 'Standard ISR sortie'],
  ['high_alt', 'High-altitude ingress'],
  ['hot_day', 'Hot-weather operation (ISA +25)'],
  ['endurance', 'Max-endurance loiter'],
  ['transients', 'Rapid throttle transitions'],
];

const PRESETS = [
  ['Injector fouling', 'injector_clog', 0.55],
  ['Cooling blockage', 'cooling_fouling', 0.6],
  ['Bearing wear', 'bearing_wear', 0.5],
  ['Ignition / misfire', 'ignition_wear', 0.5],
];

export default function Simulation({ sendCommand, frame, isAdmin, tail }) {
  const [pf, setPf] = useState({ altitude_m: 4000, isa_dev_c: 10, duration_h: 10, throttle_profile: 'steady' });
  const [pfRes, setPfRes] = useState(null);
  const [pfBusy, setPfBusy] = useState(false);
  const [pfErr, setPfErr] = useState('');
  const runPf = async () => {
    setPfBusy(true); setPfErr('');
    try { setPfRes(await api.missionSimulate({ ...pf, tail, scenario })); } catch (e) { setPfErr(e.message); } finally { setPfBusy(false); }
  };
  const [scenario, setScenario] = useState('standard');
  const [auto, setAuto] = useState(true);
  const [thr, setThr] = useState(62);
  const [alt, setAlt] = useState(7600);
  const [isaDev, setIsaDev] = useState(0);
  const [tas, setTas] = useState(55);
  const [deg, setDeg] = useState(120);
  const [noise, setNoise] = useState(10);
  const [injectors, setInjectors] = useState(Object.fromEntries(HEALTH_KEYS.map((k) => [k, 0])));
  const synced = useRef(false);

  // The backend is the source of truth and keeps running whether or not this
  // tab is open — so on first arriving frame, pull the *actual* live config
  // into the UI instead of showing hardcoded defaults that don't reflect
  // what the simulation is really doing right now.
  useEffect(() => {
    if (synced.current || !frame) return;
    const sc = frame.sim_config;
    if (!sc) return;
    synced.current = true;
    setAuto(sc.auto);
    setScenario(sc.scenario || 'standard');
    setDeg(sc.deg_rate ?? 120);
    setNoise(Math.round((sc.noise ?? 1) * 10));
    if (sc.manual?.throttle != null) setThr(Math.round(sc.manual.throttle * 100));
    if (sc.manual?.alt_m != null) setAlt(sc.manual.alt_m);
    if (sc.manual?.isa_dev_c != null) setIsaDev(sc.manual.isa_dev_c);
    if (sc.manual?.tas_ms != null) setTas(sc.manual.tas_ms);
    else if (frame.throttle != null && !sc.auto) {
      setThr(Math.round(frame.throttle * 100));
      setAlt(Math.round(frame.alt_m || 0));
    }
    // Fault-injection sliders reflect the plant's ACTUAL current degradation
    // state (already streamed every frame as ground_truth_health) rather
    // than resetting to 0% on every remount regardless of what was injected.
    if (frame.ground_truth_health) {
      setInjectors(Object.fromEntries(
        HEALTH_KEYS.map((k) => [k, Math.round((frame.ground_truth_health[k] || 0) * 100)]),
      ));
    }
  }, [frame]);


  const preview = useMemo(() => {
    const n = 200;
    const labels = []; const thrArr = []; const altArr = [];
    for (let i = 0; i < n; i++) {
      const t = (i / n) * TOTAL_MISSION_S;
      const p = missionProfile(t, scenario);
      labels.push(Math.round(t / 60) + 'm');
      thrArr.push(Math.round(p.throttle * 100));
      altArr.push(Math.round(p.alt_m));
    }
    return { labels, thrArr, altArr };
  }, [scenario]);

  const onScenario = (v) => { setScenario(v); sendCommand({ cmd: 'scenario', scenario: v }); };
  const onAuto = (v) => { setAuto(v); sendCommand({ cmd: 'auto', auto: v }); };
  const onManual = (patch) => sendCommand({ cmd: 'manual', ...patch });
  const onInject = (k, v) => {
    setInjectors((s) => ({ ...s, [k]: v }));
    sendCommand({ cmd: 'inject', mode: k, value: v / 100 });
  };
  const preset = (k, v) => {
    setInjectors((s) => ({ ...s, [k]: Math.round(v * 100) }));
    sendCommand({ cmd: 'inject', mode: k, value: v });
  };
  const overhaul = () => {
    setInjectors(Object.fromEntries(HEALTH_KEYS.map((k) => [k, 0])));
    sendCommand({ cmd: 'overhaul' });
  };

  const lock = !isAdmin;
  return (
    <div className="fade-in">
      {lock && <div className="notice warn" style={{ marginBottom: 12 }}>Read-only: changing the live twin (mission profile, fault injection, environment) is restricted to administrators. You can still run the non-mutating pre-flight feasibility check below.</div>}
      <fieldset disabled={lock} className="plain-fieldset">
      <div className="grid-2">
        <div className="card">
          <div className="card-head"><h2>Mission &amp; environment</h2></div>
          <div className="controls">
            <label className="ctl"><span>Mission profile</span>
              <select value={scenario} onChange={(e) => onScenario(e.target.value)}>
                {SCENARIOS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label className="ctl"><span>Auto-fly mission profile</span>
              <input type="checkbox" checked={auto} onChange={(e) => onAuto(e.target.checked)} />
            </label>
            <label className="ctl"><span>Throttle <b className="mono">{thr}%</b></span>
              <input type="range" min={10} max={100} value={thr}
                onChange={(e) => { setThr(+e.target.value); onManual({ throttle: +e.target.value / 100 }); }} disabled={auto} />
            </label>
            <label className="ctl"><span>Altitude <b className="mono">{alt} m</b></span>
              <input type="range" min={0} max={12000} step={100} value={alt}
                onChange={(e) => { setAlt(+e.target.value); onManual({ alt_m: +e.target.value }); }} disabled={auto} />
            </label>
            <label className="ctl"><span>ISA deviation <b className="mono">{isaDev} {'\u00b0C'}</b></span>
              <input type="range" min={-20} max={40} value={isaDev}
                onChange={(e) => { setIsaDev(+e.target.value); onManual({ isa_dev_c: +e.target.value }); }} />
            </label>
            <label className="ctl"><span>True airspeed <b className="mono">{tas} m/s</b></span>
              <input type="range" min={0} max={80} value={tas}
                onChange={(e) => { setTas(+e.target.value); onManual({ tas_ms: +e.target.value }); }} disabled={auto} />
            </label>
            <label className="ctl"><span>Degradation acceleration <b className="mono">{deg}{'\u00d7'}</b></span>
              <input type="range" min={0} max={600} step={10} value={deg}
                onChange={(e) => { setDeg(+e.target.value); sendCommand({ cmd: 'rate', value: +e.target.value }); }} />
            </label>
            <label className="ctl"><span>Sensor noise <b className="mono">{(noise / 10).toFixed(1)}{'\u00d7'}</b></span>
              <input type="range" min={0} max={40} value={noise}
                onChange={(e) => { setNoise(+e.target.value); sendCommand({ cmd: 'noise', value: +e.target.value / 10 }); }} />
            </label>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h2>Fault injection</h2><span className="mono tiny">seed degradation states into the plant</span></div>
          <div className="controls">
            {HEALTH_KEYS.map((k) => (
              <label className="ctl" key={k}><span>{HEALTH_LABEL[k]} <b className="mono">{injectors[k]}%</b></span>
                <input type="range" min={0} max={100} value={injectors[k]} onChange={(e) => onInject(k, +e.target.value)} />
              </label>
            ))}
          </div>
          <div className="row-btns">
            {PRESETS.map(([label, k, v]) => (
              <button className="btn" key={k} onClick={() => preset(k, v)}>{label}</button>
            ))}
            <button className="btn danger" onClick={overhaul}>Zero-time overhaul</button>
          </div>
        </div>
      </div>

      </fieldset>

      <div className="card">
        <div className="card-head"><h2>Pre-flight feasibility check &mdash; {tail}</h2><span className="mono tiny">runs the physics plant forward from this drone&rsquo;s current wear state; does not alter the live twin</span></div>
        <div className="controls">
          <label className="ctl"><span>Cruise altitude <b className="mono">{pf.altitude_m} m</b></span><input type="range" min={0} max={12000} step={100} value={pf.altitude_m} onChange={(e) => setPf({ ...pf, altitude_m: +e.target.value })} /></label>
          <label className="ctl"><span>ISA deviation <b className="mono">{pf.isa_dev_c} {'\u00b0C'}</b></span><input type="range" min={-20} max={40} value={pf.isa_dev_c} onChange={(e) => setPf({ ...pf, isa_dev_c: +e.target.value })} /></label>
          <label className="ctl"><span>Planned duration <b className="mono">{pf.duration_h} h</b></span><input type="range" min={1} max={30} value={pf.duration_h} onChange={(e) => setPf({ ...pf, duration_h: +e.target.value })} /></label>
          <label className="ctl"><span>Throttle profile</span>
            <select value={pf.throttle_profile} onChange={(e) => setPf({ ...pf, throttle_profile: e.target.value })}>
              <option value="steady">Steady cruise</option><option value="loiter">Loiter</option><option value="transients">Rapid transients</option>
            </select></label>
        </div>
        <div className="row-btns"><button className="btn primary" onClick={runPf} disabled={pfBusy}>{pfBusy ? 'Simulating\u2026' : 'Run feasibility check'}</button></div>
        {pfErr && <div className="login-err" style={{ marginTop: 8 }}>{pfErr}</div>}
        {pfRes && (
          <div style={{ marginTop: 12 }}>
            <div className={`badge ${pfRes.feasible ? 'ok' : 'crit'}`} style={{ display: 'inline-block', marginBottom: 8 }}>{pfRes.feasible ? 'MISSION FEASIBLE' : 'NOT RECOMMENDED'}</div>
            <div className="kv-row"><span>Worst CHT / EGT</span><span>{pfRes.worst_cht_c} / {pfRes.worst_egt_c} {'\u00b0C'}</span></div>
            <div className="kv-row"><span>Minimum oil pressure</span><span>{pfRes.worst_oil_p_bar} bar</span></div>
            <div className="kv-row"><span>Projected landing health</span><span>{pfRes.projected_landing_health}%</span></div>
            <div className="kv-row"><span>Altitude / heat power derate</span><span>{pfRes.power_derate_pct}%</span></div>
            <div className="kv-row"><span>Recommended throttle cap</span><span>{pfRes.recommended_throttle_cap_pct}%</span></div>
            <div className="kv-row"><span>Post-flight</span><span>{pfRes.post_flight_maintenance}</span></div>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-head"><h2>Mission profile preview</h2></div>
        <RollingLineChart labels={preview.labels}
          series={[{ label: 'Throttle %', color: 'accent' }, { label: 'Altitude m', color: 'info', axis: 'y1' }]}
          getters={[preview.thrArr, preview.altArr]} y1Opts={{}} />
      </div>
    </div>
  );
}
