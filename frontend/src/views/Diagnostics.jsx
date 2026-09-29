import { useMemo } from 'react';
import BarChartCard from '../charts/BarChartCard.jsx';
import RollingLineChart from '../charts/RollingLineChart.jsx';
import { hhmmss, fmt } from '../lib/format.js';

export default function Diagnostics({ frame, history }) {
  const win = useMemo(() => history.slice(-180), [history]);
  const labels = useMemo(() => win.map((f) => hhmmss(f.mission_t || 0)), [win]);
  if (!frame) return <div className="card"><p className="muted">{'Waiting for telemetry\u2026'}</p></div>;

  const inf = frame.inference || {};
  const probs = inf.probs || [];
  const attrib = inf.attrib || [];
  const faults = frame.faults || [];
  const top = probs[0];

  const items = faults.length ? faults : [{
    id: 'nominal', title: 'No fault hypothesis active', sev: 'ok',
    evidence: 'All physics residuals inside the healthy envelope.',
    action: 'Continue monitoring; next automatic trend review at +1 h.',
  }];

  return (
    <div className="fade-in">
      <div className="grid-2">
        <div className="card">
          <div className="card-head"><h2>Fault classifier posterior</h2><span className="mono tiny">MLP &middot; 8 classes</span></div>
          <BarChartCard horizontal labels={probs.map((p) => p.cls.replace(/_/g, ' '))} values={probs.map((p) => p.p)}
            colors={probs.map((p) => (p.cls === 'NOMINAL' ? '#2fd07a' : p.p > 0.4 ? '#ff4d5e' : '#ffb020'))} />
        </div>
        <div className="card">
          <div className="card-head"><h2>Explainability (XAI)</h2><span className="mono tiny">reconstruction-error attribution</span></div>
          <BarChartCard horizontal labels={attrib.map((a) => a.feature)} values={attrib.map((a) => +(a.share * 100).toFixed(1))} />
        </div>
      </div>
      <div className="grid-2">
        <div className="card">
          <div className="card-head"><h2>Anomaly score</h2>
            <span className="mono tiny" style={{ color: inf.anomalous ? 'var(--crit)' : 'var(--muted)' }}>
              {inf.anomalous ? `ANOMALOUS \u00b7 score ${fmt(inf.score, 2)}` : `nominal \u00b7 score ${fmt(inf.score, 2)}`}
            </span>
          </div>
          <RollingLineChart labels={labels}
            series={[{ label: 'Score', color: 'accent' }, { label: 'Threshold', color: 'crit', dash: [4, 4] }]}
            getters={[win.map((f) => f.inference?.score), win.map(() => 1)]} />
        </div>
        <div className="card">
          <div className="card-head"><h2>Diagnostic reasoning</h2></div>
          <div className="reasoning">
            {top && (
              <div className="reason">
                <h3>ML posterior &middot; {top.cls.replace(/_/g, ' ')} ({(top.p * 100).toFixed(1)}%)</h3>
                <p>Auto-encoder score {fmt(inf.score, 2)} (threshold 1.00). Leading evidence:{' '}
                  {attrib.slice(0, 3).map((a) => `${a.feature} ${(a.share * 100).toFixed(0)}%`).join(', ')}.</p>
              </div>
            )}
            {items.map((f) => (
              <div className="reason" key={f.id}>
                <h3>{f.title}</h3>
                <p>{f.evidence}</p>
                <p>{'\u21b3'} {f.action}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
