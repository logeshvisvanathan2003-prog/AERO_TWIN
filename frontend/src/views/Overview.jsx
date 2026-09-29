import { useMemo } from 'react';
import Kpis from '../components/Kpis.jsx';
import TwinViewer from '../components/TwinViewer.jsx';
import Inspector from '../components/Inspector.jsx';
import AlertsList from '../components/AlertsList.jsx';
import RollingLineChart from '../charts/RollingLineChart.jsx';
import { LIMITS } from '../lib/constants.js';
import { fmt, hhmmss } from '../lib/format.js';

function sev(k, v) {
  const L = LIMITS[k];
  if (!L || v == null) return '';
  if (L.low ? v < L.alarm : v > L.alarm) return 'crit';
  if (L.low ? v < L.warn : v > L.warn) return 'warn';
  return '';
}

export default function Overview({ frame, history, selectedId, onSelect, faultParts, running }) {
  const win = useMemo(() => history.slice(-180), [history]);
  const labels = useMemo(() => win.map((f) => hhmmss(f.mission_t || 0)), [win]);

  if (!frame) {
    return <div className="card"><p className="muted">{'Connecting to backend telemetry\u2026'}</p></div>;
  }

  const H = frame.health || {};
  const inf = frame.inference || {};
  const kpis = [
    { k: 'ENGINE SPEED', v: fmt(frame.rpm, 0), u: 'rpm', d: `${fmt(frame.throttle * 100, 0)}% throttle`, sev: sev('rpm', frame.rpm) },
    { k: 'SHAFT POWER', v: fmt(frame.power_kw, 1), u: 'kW', d: `${fmt(frame.bsfc, 0)} g/kWh` },
    { k: 'CHT', v: fmt(frame.cht, 0), u: '\u00b0C', d: `twin ${fmt(frame.twin?.cht, 0)} \u00b0C`, sev: sev('cht', frame.cht) },
    { k: 'EGT', v: fmt(frame.egt, 0), u: '\u00b0C', d: `\u03bb ${fmt(frame.lam, 2)}`, sev: sev('egt', frame.egt) },
    { k: 'OIL PRESS', v: fmt(frame.oil_p, 2), u: 'bar', d: `${fmt(frame.oil_t, 0)} \u00b0C oil`, sev: sev('oil_p', frame.oil_p) },
    { k: 'FUEL FLOW', v: fmt(frame.fuel_flow, 2), u: 'kg/h', d: `MAP ${fmt(frame.map_kpa, 0)} kPa` },
    { k: 'VIBRATION', v: fmt(frame.vib, 2), u: 'g', d: `1x ${fmt(frame.vib_1x, 2)} \u00b7 0.5x ${fmt(frame.vib_half, 2)}`, sev: sev('vib', frame.vib) },
    { k: 'HEALTH INDEX', v: fmt(H.overall, 0), u: '%', d: `${(frame.faults || []).length} active findings`, sev: H.overall < 70 ? 'crit' : H.overall < 88 ? 'warn' : '' },
    { k: 'RUL', v: inf.rul_h != null ? fmt(inf.rul_h, 0) : '\u2014', u: 'h', d: frame.advisory?.level || '', sev: inf.rul_h < 25 ? 'crit' : inf.rul_h < 80 ? 'warn' : '' },
  ];

  return (
    <div className="fade-in">
      <Kpis items={kpis} />

      <div className="grid-2">
        <TwinViewer frame={frame} faultParts={faultParts} onSelect={onSelect} selected={selectedId} running={running} />
        <div className="stack">
          <Inspector selectedId={selectedId} frame={frame} health={H} />
          <AlertsList frame={frame} />
        </div>
      </div>

      <div className="grid-3">
        <div className="card">
          <div className="card-head"><h2>Speed &amp; power</h2></div>
          <RollingLineChart labels={labels} height={200}
            series={[{ label: 'RPM', color: 'accent' }, { label: 'kW', color: 'info', axis: 'y1' }]}
            getters={[win.map((f) => f.rpm), win.map((f) => f.power_kw)]}
            y1Opts={{}} />
        </div>
        <div className="card">
          <div className="card-head"><h2>Thermal state</h2></div>
          <RollingLineChart labels={labels} height={200}
            series={[{ label: 'CHT', color: 'crit' }, { label: 'EGT', color: 'warn', axis: 'y1' }, { label: 'Coolant', color: 'info' }]}
            getters={[win.map((f) => f.cht), win.map((f) => f.egt), win.map((f) => f.coolant_t)]}
            y1Opts={{}} />
        </div>
        <div className="card">
          <div className="card-head"><h2>Oil &amp; vibration</h2></div>
          <RollingLineChart labels={labels} height={200}
            series={[{ label: 'Oil bar', color: 'accent' }, { label: 'Oil \u00b0C', color: 'info' }, { label: 'Vib g', color: 'crit', axis: 'y1' }]}
            getters={[win.map((f) => f.oil_p), win.map((f) => f.oil_t), win.map((f) => f.vib)]}
            y1Opts={{}} />
        </div>
      </div>
    </div>
  );
}
