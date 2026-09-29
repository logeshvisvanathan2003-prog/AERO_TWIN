import { useMemo } from 'react';
import RadarChartCard from '../charts/RadarChartCard.jsx';
import RollingLineChart from '../charts/RollingLineChart.jsx';
import ScatterChartCard from '../charts/ScatterChartCard.jsx';
import { LIMITS } from '../lib/constants.js';
import { fmt, hhmmss } from '../lib/format.js';

const SUB_KEYS = ['combustion', 'fuel', 'cooling', 'lubrication', 'rotating', 'induction', 'electrical', 'sensors'];

const ROWS = [
  ['Engine speed', 'rpm', 0],
  ['Manifold pressure', 'map_kpa', 1],
  ['Cylinder head temp', 'cht', 1],
  ['Exhaust gas temp', 'egt', 0],
  ['Coolant temp', 'coolant_t', 1],
  ['Oil pressure', 'oil_p', 2],
  ['Oil temperature', 'oil_t', 1],
  ['Fuel flow', 'fuel_flow', 2],
  ['Vibration RMS', 'vib', 2],
  ['Vibration 0.5x order', 'vib_half', 3],
  ['Bus voltage', 'bus_v', 2],
  ['Injection timing', 'inj_act', 2],
  ['BSFC', 'bsfc', 0],
];

export default function Health({ frame, history, startHealth }) {
  const win = useMemo(() => history.slice(-180), [history]);
  const labels = useMemo(() => win.map((f) => hhmmss(f.mission_t || 0)), [win]);
  if (!frame) return <div className="card"><p className="muted">{'Waiting for telemetry\u2026'}</p></div>;

  const H = frame.health || {};
  const resid = frame.inference?.resid || {};
  const base = frame.twin || {};

  return (
    <div className="fade-in">
      <div className="grid-2">
        <div className="card">
          <div className="card-head"><h2>Sub-system health indices</h2><span className="mono tiny">physics residual estimator</span></div>
          <RadarChartCard labels={SUB_KEYS} now={SUB_KEYS.map((k) => H[k] ?? 0)} start={SUB_KEYS.map((k) => startHealth?.[k] ?? 100)} />
        </div>
        <div className="card">
          <div className="card-head"><h2>Health index trend</h2></div>
          <RollingLineChart labels={labels} series={[{ label: 'Overall health %', color: 'accent', fill: true }]}
            getters={[win.map((f) => f.health?.overall)]} yOpts={{ suggestedMin: 0, suggestedMax: 100 }} />
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>Monitored parameters</h2><span className="mono tiny">live vs synchronised twin baseline</span></div>
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Parameter</th><th>Measured</th><th>Twin baseline</th><th>Residual</th><th>Limit</th><th>State</th></tr></thead>
            <tbody>
              {ROWS.map(([label, key, d]) => {
                const v = frame[key];
                const b = base[key];
                const res = resid[key] ?? (v != null && b != null ? v - b : null);
                const L = LIMITS[key];
                let state = 'ok';
                if (L && v != null) {
                  if (L.low ? v < L.alarm : v > L.alarm) state = 'crit';
                  else if (L.low ? v < L.warn : v > L.warn) state = 'warn';
                } else if (Math.abs(res || 0) > Math.max(0.15, Math.abs(b || 1) * 0.08)) state = 'warn';
                return (
                  <tr key={key}>
                    <td>{label}</td><td>{fmt(v, d)}</td><td>{fmt(b, d)}</td>
                    <td>{res != null ? `${res >= 0 ? '+' : ''}${fmt(res, d + 1)}` : '\u2014'}</td>
                    <td>{L ? `${L.warn} / ${L.alarm} ${L.unit}` : '\u2014'}</td>
                    <td className={`state-${state}`}>{state.toUpperCase()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>Per-cylinder balance</h2><span className="mono tiny">EGT / CHT scatter identifies the sick cylinder</span></div>
        <ScatterChartCard points={(frame.cylEGT || []).map((e, i) => ({ x: e, y: (frame.cylCHT || [])[i] }))} />
      </div>
    </div>
  );
}
