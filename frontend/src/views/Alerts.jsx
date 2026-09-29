import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { timeAgo } from '../components/ui.jsx';

export default function Alerts({ drones }) {
  const [tab, setTab] = useState('alerts');
  const [tail, setTail] = useState('');
  const [alerts, setAlerts] = useState([]);
  const [wos, setWos] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => Promise.all([api.alerts(80, tail || undefined), api.workorders(tail || undefined)])
    .then(([a, w]) => { setAlerts(a); setWos(w); setLoading(false); }).catch(() => setLoading(false)), [tail]);
  useEffect(() => { load(); const iv = setInterval(load, 8000); return () => clearInterval(iv); }, [load]);

  const ack = async (a) => { await api.ackAlert(a.id).catch(() => {}); load(); };
  const open = alerts.filter((a) => !a.acknowledged).length;

  return (
    <div className="view active fade-in">
      <div className="card">
        <div className="card-head"><h2>My alerts &amp; maintenance &mdash; assigned drones only</h2><span className="mono tiny">{open} unacknowledged</span></div>
        <div className="fleet-toolbar" style={{ marginTop: 0 }}>
          <div className="fleet-filters">
            <button className={`chip ${tab === 'alerts' ? 'active' : ''}`} onClick={() => setTab('alerts')}>Fault alerts</button>
            <button className={`chip ${tab === 'wo' ? 'active' : ''}`} onClick={() => setTab('wo')}>Work orders ({wos.length})</button>
          </div>
          <select className="sel" value={tail} onChange={(e) => setTail(e.target.value)}>
            <option value="">All my drones</option>{drones.map((d) => <option key={d.id} value={d.tail_number}>{d.tail_number}</option>)}
          </select>
        </div>
      </div>

      <div className="card">
        {loading && <div className="muted tiny">Loading{'\u2026'}</div>}
        {tab === 'alerts' && (
          <div className="alerts">
            {!loading && alerts.length === 0 && <div className="ok-state">No alerts recorded for your drones.</div>}
            {alerts.map((a) => (
              <div className={`alert ${a.severity}`} key={a.id} style={{ opacity: a.acknowledged ? 0.55 : 1 }}>
                <div className="t"><span>{a.tail_number} &mdash; {a.title}</span><span className="tiny mono muted">{timeAgo(a.created_at)}</span></div>
                <div className="e">{a.evidence}</div>
                <div className="a">{'\u21b3'} {a.action}</div>
                <div className="row-btns" style={{ marginTop: 6 }}>
                  {a.acknowledged ? <span className="tiny muted">acknowledged{a.acknowledged_by ? ` by ${a.acknowledged_by}` : ''}</span>
                    : <button className="btn" onClick={() => ack(a)}>Acknowledge</button>}
                </div>
              </div>
            ))}
          </div>
        )}
        {tab === 'wo' && (
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>CODE</th><th>DRONE</th><th>PRIORITY</th><th>TASK</th><th>STATUS</th></tr></thead>
              <tbody>
                {wos.length === 0 && <tr><td colSpan={5} className="muted">No work orders.</td></tr>}
                {wos.map((w) => (
                  <tr key={w.id}><td className="mono">{w.code}</td><td className="mono">{w.tail_number}</td>
                    <td className={w.priority === 'IMMEDIATE' ? 'state-crit' : w.priority === 'PRIORITY' ? 'state-warn' : ''}>{w.priority}</td>
                    <td style={{ fontFamily: 'var(--body)' }}>{w.description}</td><td>{w.status.replace('_', ' ')}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted tiny" style={{ marginTop: 10 }}>Operators can acknowledge alerts; work-order status changes are made by an administrator.</p>
      </div>
    </div>
  );
}
