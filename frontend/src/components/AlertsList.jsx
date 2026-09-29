import { fmt } from '../lib/format.js';

export default function AlertsList({ frame }) {
  if (!frame) return null;
  const items = [...(frame.faults || [])];
  (frame.limits || []).forEach((l) => items.push({
    id: `LIM_${l.key}`, sev: l.sev, title: `${l.label} ${l.sev === 'alarm' ? 'limit exceeded' : 'caution'}`,
    evidence: `${fmt(l.value, 1)} ${l.unit} vs limit ${l.limit} ${l.unit}`,
    action: 'Threshold monitor (certifiable layer).',
  }));

  return (
    <div className="card">
      <div className="card-head"><h2>Active alerts</h2><span className="mono tiny">{items.length} active</span></div>
      <div className="alerts">
        {!items.length && <div className="ok-state">All monitored sub-systems nominal.</div>}
        {items.slice(0, 8).map((f, i) => (
          <div className={`alert ${f.sev}`} key={f.id + i}>
            <div className="t"><span>{f.title}</span><span className="mono tiny">{f.sev.toUpperCase()}</span></div>
            <div className="e">{f.evidence}</div>
            <div className="a">{'\u21b3'} {f.action}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
