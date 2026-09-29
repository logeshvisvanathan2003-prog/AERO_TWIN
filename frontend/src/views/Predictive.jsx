import { useMemo } from 'react';
import Kpis from '../components/Kpis.jsx';
import RollingLineChart from '../charts/RollingLineChart.jsx';
import { HEALTH_KEYS, HEALTH_LABEL } from '../lib/constants.js';
import { fmt, hhmmss } from '../lib/format.js';

const DEG_COLORS = ['accent', 'info', 'warn', 'crit', '#a78bfa', '#f472b6', '#84cc16'];

export default function Predictive({ frame, history }) {
  const win = useMemo(() => history.slice(-180), [history]);
  const labels = useMemo(() => win.map((f) => hhmmss(f.mission_t || 0)), [win]);
  if (!frame) return <div className="card"><p className="muted">{'Waiting for telemetry\u2026'}</p></div>;

  const inf = frame.inference || {};
  const H = frame.health || {};
  const gt = frame.ground_truth_health || {};
  const adv = frame.advisory || { level: '\u2014', text: '' };
  const dom = Object.entries(gt).sort((a, b) => b[1] - a[1])[0] || ['none', 0];
  const rulSeries = win.map((f) => f.inference?.rul_h);
  const sd = Math.max(6, (inf.rul_h || 0) * 0.18);

  const kpis = [
    { k: 'RUL ESTIMATE', v: fmt(inf.rul_h, 0), u: 'h', sev: inf.rul_h < 25 ? 'crit' : inf.rul_h < 80 ? 'warn' : '' },
    { k: 'DOMINANT MODE', v: (HEALTH_LABEL[dom[0]] || dom[0]).split(' ')[0], u: '', d: `${fmt(dom[1] * 100, 1)}% damage accumulated` },
    { k: 'ADVISORY', v: adv.level, u: '', d: `${(frame.faults || []).length} findings`, sev: adv.level === 'IMMEDIATE' ? 'crit' : adv.level === 'PRIORITY' ? 'warn' : '' },
    { k: 'ENGINE HOURS', v: fmt((frame.mission_t || 0) / 3600, 1), u: 'h', d: 'since overhaul' },
    { k: 'ANOMALY SCORE', v: fmt(inf.score, 2), u: '', d: 'threshold 1.00', sev: inf.score > 1 ? 'warn' : '' },
  ];

  return (
    <div className="fade-in">
      <Kpis items={kpis} />
      <div className="grid-2">
        <div className="card">
          <div className="card-head"><h2>Remaining useful life</h2><span className="mono tiny">MLP regressor &middot; 600 h horizon</span></div>
          <RollingLineChart labels={labels}
            series={[
              { label: 'RUL (h)', color: 'accent' },
              { label: '95% upper', color: 'muted', dash: [3, 3] },
              { label: '95% lower', color: 'muted', dash: [3, 3] },
            ]}
            getters={[rulSeries, win.map((f) => (f.inference?.rul_h || 0) + 1.64 * sd), win.map((f) => Math.max(0, (f.inference?.rul_h || 0) - 1.64 * sd))]} />
        </div>
        <div className="card">
          <div className="card-head"><h2>Degradation trends</h2><span className="mono tiny">estimated damage per mode</span></div>
          <RollingLineChart labels={labels}
            series={HEALTH_KEYS.map((k, i) => ({ label: HEALTH_LABEL[k].split(' ')[0], color: DEG_COLORS[i] }))}
            getters={HEALTH_KEYS.map((k) => win.map((f) => Math.round(((f.ground_truth_health || {})[k] || 0) * 100)))}
            yOpts={{ suggestedMin: 0, suggestedMax: 100 }} />
        </div>
      </div>
      <div className="card">
        <div className="card-head"><h2>Maintenance advisory</h2></div>
        <div className="advisory">
          <div className={`adv-level ${adv.level}`}>{adv.level}</div>
          <div>
            <p style={{ margin: '0 0 6px' }}>{adv.text}</p>
            <p className="muted tiny" style={{ margin: 0 }}>
              Basis: RUL {fmt(inf.rul_h, 0)} h &middot; overall health {H.overall}% &middot; {(frame.faults || []).length} active findings &middot; dominant mode {(dom[0] || '').replace(/_/g, ' ')}.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
