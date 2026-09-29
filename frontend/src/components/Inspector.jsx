import { sensorLabel, val, UNITS, PART_SENSORS, PART_SUBSYS, PART_LABELS } from '../lib/constants.js';
import { fmt } from '../lib/format.js';

function unitFor(k) {
  const base = k.replace(/[0-9]/g, '').replace('cylCHT', 'cht').replace('cylEGT', 'egt');
  return UNITS[base] || '';
}

export default function Inspector({ selectedId, frame, health }) {
  if (!selectedId || !frame) {
    return (
      <div className="card">
        <div className="card-head"><h2>Component inspector</h2><span className="mono tiny">{'\u2014'}</span></div>
        <div className="inspector"><p className="muted">Select a component in the 3D twin.</p></div>
      </div>
    );
  }
  const label = PART_LABELS[selectedId] || selectedId;
  const sensors = PART_SENSORS[selectedId] || ['rpm', 'cht'];
  const sub = PART_SUBSYS[selectedId];
  const hv = Math.round(sub ? (health?.[sub] ?? 0) : (health?.overall ?? 0));
  const cls = hv < 70 ? 'crit' : hv < 88 ? 'warn' : '';
  const rel = (frame.faults || []).filter((f) => f.part === selectedId);

  return (
    <div className="card">
      <div className="card-head"><h2>Component inspector</h2><span className="mono tiny">{selectedId}</span></div>
      <div className="inspector" key={selectedId}>
        <div className="insp-title">{label}</div>
        <div className="kv-row"><span>Sub-system health</span><span className={cls ? `state-${cls}` : 'state-ok'}>{hv}%</span></div>
        <div className="bar"><i className={cls} style={{ width: `${hv}%` }} /></div>
        {sensors.map((k) => (
          <div className="kv-row" key={k}><span>{sensorLabel(k)}</span><span>{fmt(val(frame, k), 2)} {unitFor(k)}</span></div>
        ))}
        {rel.length
          ? rel.map((f) => (
            <div className={`alert ${f.sev}`} style={{ marginTop: 8 }} key={f.id}>
              <div className="t"><span>{f.title}</span></div>
              <div className="a">{'\u21b3'} {f.action}</div>
            </div>
          ))
          : <div className="ok-state" style={{ marginTop: 8 }}>No active finding on this component.</div>}
      </div>
    </div>
  );
}
