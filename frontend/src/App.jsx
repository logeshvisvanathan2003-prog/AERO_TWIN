import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Topbar from './components/Topbar.jsx';
import Sidebar from './components/Sidebar.jsx';
import Overview from './views/Overview.jsx';
import Health from './views/Health.jsx';
import Diagnostics from './views/Diagnostics.jsx';
import Predictive from './views/Predictive.jsx';
import Simulation from './views/Simulation.jsx';
import Replay from './views/Replay.jsx';
import Reports from './views/Reports.jsx';
import Architecture from './views/Architecture.jsx';
import Fleet from './views/Fleet.jsx';
import Alerts from './views/Alerts.jsx';
import Login from './views/Login.jsx';
import ChangePassword from './views/ChangePassword.jsx';
import AdminConsole from './views/admin/AdminConsole.jsx';
import Operators from './views/admin/Operators.jsx';
import Drones from './views/admin/Drones.jsx';
import Notifications from './views/admin/Notifications.jsx';
import { useTelemetry } from './hooks/useTelemetry.js';
import { useAuth } from './hooks/useAuth.js';
import { useAdminInbox } from './hooks/useAdminInbox.js';
import { api } from './lib/api.js';
import { ALL_VIEWS, canOpen, defaultView } from './lib/nav.js';

const TWIN_VIEWS = ['overview', 'health', 'diagnostics', 'predictive', 'simulation', 'replay'];
const hashView = () => location.hash.replace(/^#\/?/, '').split('?')[0];

export default function App() {
  const { operator, login, changePassword, logout } = useAuth();
  if (!operator) return <Login onLogin={login} />;
  if (operator.must_change_password) return <ChangePassword operator={operator} onChange={changePassword} onLogout={logout} />;
  return <Shell operator={operator} onLogout={logout} />;
}

function Shell({ operator, onLogout }) {
  const role = operator.role;
  const isAdmin = role === 'admin';

  // ---- routing (hash based, role-guarded) --------------------------------
  const pick = useCallback((h) => (ALL_VIEWS.includes(h) && canOpen(h, role) ? h : defaultView(role)), [role]);
  const [view, setView] = useState(() => pick(hashView()));
  useEffect(() => {
    const on = () => setView(pick(hashView()));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, [pick]);
  useEffect(() => { if (hashView() !== view) window.history.replaceState(null, '', `#/${view}`); }, [view]);
  const navigate = useCallback((v) => { const t = pick(v); location.hash = `/${t}`; setView(t); }, [pick]);

  // ---- drones this account may see ----------------------------------------
  const [drones, setDrones] = useState([]);
  const [dronesLoaded, setDronesLoaded] = useState(false);
  const tailKey = `aerotwin-tail:${operator.id}`;
  const [tail, setTail] = useState(() => localStorage.getItem(tailKey));
  const pullDrones = useCallback(() => api.fleet().then((rows) => { setDrones(rows); setDronesLoaded(true); }).catch(() => {}), []);
  useEffect(() => { pullDrones(); const iv = setInterval(pullDrones, 10000); return () => clearInterval(iv); }, [pullDrones]);
  useEffect(() => {
    if (!dronesLoaded) return;
    if (!drones.length) { if (tail) setTail(null); return; }
    if (!tail || !drones.some((d) => d.tail_number === tail)) setTail(drones[0].tail_number);
  }, [drones, dronesLoaded, tail]);
  const chooseTail = (t) => { setTail(t); localStorage.setItem(tailKey, t); };

  // ---- live twin for the selected drone -----------------------------------
  const { frame, history, linkState, sendCommand } = useTelemetry(tail);
  const inbox = useAdminInbox(isAdmin, operator.login_id);
  const [selectedId, setSelectedId] = useState('cyl0');
  const [menuOpen, setMenuOpen] = useState(false);
  const [modelMeta, setModelMeta] = useState(null);
  const [modelMetrics, setModelMetrics] = useState(null);
  const [startHealth, setStartHealth] = useState(null);
  const [eventLog, setEventLog] = useState([]);
  const seenRef = useRef(new Set());

  useEffect(() => { setStartHealth(null); setEventLog([]); seenRef.current = new Set(); }, [tail]);

  useEffect(() => {
    let cancelled = false; let attempt = 0;
    const tryFetch = () => {
      api.modelMeta().then((m) => {
        if (cancelled) return;
        if (!m.ready) { setModelMeta('model bundle unavailable \u2014 physics layer only'); return; }
        const metrics = m.metrics || {};
        setModelMetrics(metrics);
        const ae = metrics.ae_detection != null ? (metrics.ae_detection * 100).toFixed(0) : '\u2014';
        const clf = metrics.clf_accuracy != null ? (metrics.clf_accuracy * 100).toFixed(0) : '\u2014';
        const rul = metrics.rul_mae_h != null ? metrics.rul_mae_h.toFixed(0) : '\u2014';
        setModelMeta(`AE ${ae}% det \u00b7 CLF ${clf}% \u00b7 RUL \u00b1${rul} h`);
      }).catch(() => {
        if (cancelled) return;
        if (++attempt <= 5) { setModelMeta(`connecting\u2026 (retry ${attempt}/5)`); setTimeout(tryFetch, attempt * 1500); }
        else setModelMeta('backend unreachable');
      });
    };
    tryFetch();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!frame) return;
    if (!startHealth && frame.health) setStartHealth(frame.health);
    (frame.faults || []).forEach((f) => {
      const key = f.id + f.sev;
      if (!seenRef.current.has(key)) {
        seenRef.current.add(key);
        setEventLog((log) => [{ t: frame.mission_t, sev: f.sev, text: `${f.title} \u2014 ${f.evidence}` }, ...log].slice(0, 200));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame]);

  const faultParts = useMemo(() => {
    const m = new Map();
    (frame?.faults || []).forEach((f) => { if (f.part) m.set(f.part, f.sev === 'alarm' ? 'alarm' : 'warn'); });
    return m;
  }, [frame]);

  const openTwin = (t) => { chooseTail(t); navigate('overview'); };

  const needsDrone = TWIN_VIEWS.includes(view);
  const noDrone = dronesLoaded && !drones.length;

  return (
    <div className="app">
      <Topbar frame={frame} linkState={linkState} drones={drones} tail={tail} onTail={chooseTail}
        onMenu={() => setMenuOpen((o) => !o)} operator={operator} onLogout={onLogout}
        onCommand={sendCommand} inbox={inbox} onOpenInbox={() => navigate('notifications')} />
      <Sidebar view={view} onChange={navigate} modelMeta={modelMeta} open={menuOpen} onClose={() => setMenuOpen(false)}
        operator={operator} badges={{ notifications: inbox.summary.unread }} />
      <main className="main">
        {needsDrone && noDrone && (
          <div className="card fade-in">
            <div className="card-head"><h2>No drone available</h2></div>
            <p className="muted">
              {isAdmin ? 'No drones are registered yet. Add one under Drones.' : 'No drone is assigned to your account. Ask your administrator to assign one.'}
            </p>
            {isAdmin && <button className="btn" onClick={() => navigate('drones')}>Open Drones</button>}
          </div>
        )}
        {needsDrone && !noDrone && (
          <>
            {view === 'overview' && <Overview frame={frame} history={history} selectedId={selectedId} onSelect={setSelectedId} faultParts={faultParts} running={frame?.sim_config?.running ?? true} />}
            {view === 'health' && <Health frame={frame} history={history} startHealth={startHealth} />}
            {view === 'diagnostics' && <Diagnostics frame={frame} history={history} />}
            {view === 'predictive' && <Predictive frame={frame} history={history} />}
            {view === 'simulation' && <Simulation key={tail} sendCommand={sendCommand} frame={frame} isAdmin={isAdmin} tail={tail} />}
            {view === 'replay' && <Replay history={history} eventLog={eventLog} />}
          </>
        )}
        {view === 'fleet' && <Fleet operator={operator} onOpenTwin={openTwin} onChanged={pullDrones} />}
        {view === 'alerts' && <Alerts drones={drones} />}
        {view === 'reports' && <Reports tail={tail} drones={drones} />}
        {view === 'architecture' && <Architecture modelMetrics={modelMetrics} />}
        {isAdmin && view === 'admin' && <AdminConsole onNavigate={navigate} />}
        {isAdmin && view === 'operators' && <Operators self={operator} />}
        {isAdmin && view === 'drones' && <Drones />}
        {isAdmin && view === 'notifications' && <Notifications inbox={inbox} />}
      </main>
    </div>
  );
}
