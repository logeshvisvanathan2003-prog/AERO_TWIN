import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { timeAgo } from '../../components/ui.jsx';

const SEV = { alarm: 'crit', warn: 'warn', info: 'ok' };

const MATRIX = [
  ['View live twin, health, diagnostics, RUL', true, 'assigned drones only'],
  ['Replay, mission reports, live snapshot', true, 'assigned drones only'],
  ['Acknowledge alerts', true, 'assigned drones only'],
  ['Pre-flight feasibility simulation (non-mutating)', true, 'assigned drones only'],
  ['Inject faults / overhaul / change environment of a twin', false, ''],
  ['Pause, resume, time-acceleration of a twin', false, ''],
  ['Ground, recall, clear a drone / schedule maintenance', false, ''],
  ['Close or reopen work orders', false, ''],
  ['See other drones, other operators or the notification inbox', false, ''],
  ['Create / edit / disable operators, register drones', false, ''],
];

export default function AdminConsole({ onNavigate }) {
  const [o, setO] = useState(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    const pull = () => api.adminOverview().then((r) => { setO(r); setErr(false); }).catch(() => setErr(true));
    pull(); const iv = setInterval(pull, 8000); return () => clearInterval(iv);
  }, []);

  if (!o) return <div className="card"><p className="muted">{err ? 'Could not reach the backend.' : 'Loading admin console\u2026'}</p></div>;

  const attention = [];
  if (o.notifications.unread_alarms > 0) attention.push(['crit', `${o.notifications.unread_alarms} unread alarm-level notification(s)`, 'notifications']);
  if (o.operators.locked > 0) attention.push(['warn', `${o.operators.locked} operator account(s) locked after failed sign-ins`, 'operators']);
  if (o.drones.unassigned.length) attention.push(['warn', `${o.drones.unassigned.length} drone(s) have no operator: ${o.drones.unassigned.join(', ')}`, 'drones']);
  if (o.drones.grounded > 0) attention.push(['warn', `${o.drones.grounded} drone(s) currently grounded`, 'fleet']);
  if (o.open_work_orders > 0) attention.push(['ok', `${o.open_work_orders} open work order(s)`, 'fleet']);

  return (
    <div className="view active fade-in">
      <div className="kpis">
        <div className="kpi"><div className="k">OPERATORS</div><div className="v">{o.operators.active}<span className="u">/ {o.operators.total} active</span></div><div className="d">{o.operators.admins} admin &middot; {o.operators.online} online now</div></div>
        <div className="kpi"><div className="k">DRONES</div><div className="v">{o.drones.active}<span className="u">/ {o.drones.total}</span></div><div className="d">{o.drones.live_twins} live twins running</div></div>
        <div className={`kpi ${o.drones.grounded ? 'crit' : o.drones.caution ? 'warn' : ''}`}><div className="k">GROUNDED / CAUTION</div><div className="v">{o.drones.grounded}<span className="u">/ {o.drones.caution}</span></div><div className="d">from twin readiness &amp; admin orders</div></div>
        <div className={`kpi ${o.notifications.unread_alarms ? 'crit' : o.notifications.unread ? 'warn' : ''}`}><div className="k">UNREAD NOTIFICATIONS</div><div className="v">{o.notifications.unread}</div><div className="d">{o.notifications.unread_alarms} alarm-level</div></div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-head"><h2>Needs attention</h2></div>
          <div className="alerts">
            {attention.length === 0 && <div className="ok-state">Nothing needs attention.</div>}
            {attention.map(([sev, text, to], i) => (
              <button key={i} className={`attention ${sev}`} onClick={() => onNavigate(to)}><span>{text}</span><span className="tiny">{'\u2192'}</span></button>
            ))}
          </div>
          <div className="row-btns">
            <button className="btn primary" onClick={() => onNavigate('operators')}>Manage operators</button>
            <button className="btn" onClick={() => onNavigate('drones')}>Manage drones</button>
            <button className="btn" onClick={() => onNavigate('notifications')}>Open notifications</button>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h2>Recent activity</h2><button className="link-btn" onClick={() => onNavigate('notifications')}>View all</button></div>
          <div className="alerts">
            {o.recent.length === 0 && <div className="muted tiny">No activity yet.</div>}
            {o.recent.map((n) => (
              <div className={`alert ${n.severity === 'info' ? '' : n.severity}`} key={n.id}>
                <div className="t"><span>{n.title}</span><span className="tiny mono muted">{timeAgo(n.created_at)}</span></div>
                <div className="e">{n.category}{n.actor ? ` \u00b7 by ${n.actor}` : ''}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>Access policy &mdash; what operators can and cannot do</h2><span className="mono tiny">enforced by the backend on every request</span></div>
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>CAPABILITY</th><th>ADMIN</th><th>OPERATOR</th></tr></thead>
            <tbody>
              {MATRIX.map(([cap, opAllowed, scope]) => (
                <tr key={cap}>
                  <td>{cap}</td>
                  <td className="state-ok">{'\u2713'} allowed</td>
                  <td className={opAllowed ? 'state-ok' : 'state-crit'}>{opAllowed ? `\u2713 ${scope}` : '\u2715 blocked'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
