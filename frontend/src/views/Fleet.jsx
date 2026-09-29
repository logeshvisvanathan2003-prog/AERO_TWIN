import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { timeAgo } from '../components/ui.jsx';

function statusClass(s) {
  if (s === 'grounded') return 'crit';
  if (s === 'caution') return 'warn';
  return 'ok';
}

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'ready', label: 'Mission ready' },
  { key: 'caution', label: 'Caution' },
  { key: 'grounded', label: 'Grounded' },
];

const SORTS = [
  { key: 'tail', label: 'Tail number' },
  { key: 'health', label: 'Health (lowest first)' },
  { key: 'hours', label: 'Airframe hours' },
];

const ACTIONS = [
  { key: 'clear', label: 'Clear to mission-ready', tone: '' },
  { key: 'ground', label: 'Ground asset', tone: 'danger' },
  { key: 'recall', label: 'Recall to base', tone: '' },
  { key: 'schedule_maintenance', label: 'Schedule maintenance', tone: '' },
];

export default function Fleet({ operator, onOpenTwin, onChanged }) {
  const isAdmin = operator?.role === 'admin';
  const [fleet, setFleet] = useState([]);
  const [selected, setSelected] = useState(null);
  const [droneAlerts, setDroneAlerts] = useState([]);
  const [wos, setWos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [sortKey, setSortKey] = useState('tail');
  const [pendingAction, setPendingAction] = useState(null); // { key, label, tone }
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);

  const pull = () => api.fleet().then((rows) => { setFleet(rows); setLoading(false); }).catch(() => {});

  useEffect(() => {
    pull();
    const iv = setInterval(pull, 8000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    if (!selected) { setDroneAlerts([]); setWos([]); return; }
    api.engineAlerts(selected.tail_number, 20).then(setDroneAlerts).catch(() => setDroneAlerts([]));
    api.workorders(selected.tail_number, 10).then(setWos).catch(() => setWos([]));
  }, [selected?.id]);

  // keep the open detail card in sync with the latest polled row
  useEffect(() => {
    if (!selected) return;
    const fresh = fleet.find((f) => f.id === selected.id);
    if (fresh && fresh !== selected) setSelected(fresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fleet]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const ready = fleet.filter((f) => f.status === 'ready').length;
  const caution = fleet.filter((f) => f.status === 'caution').length;
  const grounded = fleet.filter((f) => f.status === 'grounded').length;

  const visible = useMemo(() => {
    let rows = fleet;
    if (filter !== 'all') rows = rows.filter((d) => d.status === filter);
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      rows = rows.filter((d) => d.tail_number.toLowerCase().includes(q) || d.asset_code.toLowerCase().includes(q));
    }
    rows = [...rows];
    if (sortKey === 'health') rows.sort((a, b) => a.health_overall - b.health_overall);
    else if (sortKey === 'hours') rows.sort((a, b) => b.engine_hours - a.engine_hours);
    else rows.sort((a, b) => a.tail_number.localeCompare(b.tail_number));
    return rows;
  }, [fleet, filter, query, sortKey]);

  const runAction = async () => {
    if (!pendingAction || !selected) return;
    setBusy(true);
    try {
      const r = await api.fleetAction(selected.id, pendingAction.key, note.trim() || undefined);
      setToast({ ok: true, text: `${selected.tail_number}: ${pendingAction.label.toLowerCase()} recorded.` });
      setPendingAction(null); setNote('');
      await pull(); onChanged?.();
      if (r?.status) setSelected((s) => (s ? { ...s, status: r.status } : s));
    } catch (e) {
      setToast({ ok: false, text: e?.message?.includes('403')
        ? 'Admin authorisation required for this action.'
        : 'Could not reach the GCS backend.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="view active">
      <div className="card">
        <div className="card-head">
          <h2>Fleet command &mdash; {isAdmin ? 'all drones' : 'my assigned drones'}</h2>
          <span className={`mono tiny fleet-access-chip ${isAdmin ? 'admin' : 'operator'}`}>
            {isAdmin ? 'ADMIN ACCESS \u00b7 full fleet control' : 'OPERATOR ACCESS \u00b7 assigned drones, read-only'}
          </span>
        </div>
        <div className="kpis" style={{ marginBottom: 4 }}>
          <div className="kpi"><div className="k">FLEET SIZE</div><div className="v">{fleet.length}<span className="u">units</span></div></div>
          <div className="kpi"><div className="k">MISSION READY</div><div className="v">{ready}</div></div>
          <div className="kpi warn"><div className="k">CAUTION</div><div className="v">{caution}</div></div>
          <div className="kpi crit"><div className="k">GROUNDED</div><div className="v">{grounded}</div></div>
        </div>

        <div className="fleet-toolbar">
          <input
            className="fleet-search" type="text" placeholder="Search tail number or asset code\u2026"
            value={query} onChange={(e) => setQuery(e.target.value)}
          />
          <div className="fleet-filters">
            {FILTERS.map((f) => (
              <button key={f.key} className={`chip ${filter === f.key ? 'active' : ''}`} onClick={() => setFilter(f.key)}>
                {f.label}
              </button>
            ))}
          </div>
          <select className="sel" value={sortKey} onChange={(e) => setSortKey(e.target.value)} title="Sort fleet">
            {SORTS.map((s) => <option key={s.key} value={s.key}>Sort: {s.label}</option>)}
          </select>
        </div>
      </div>

      <div className="fleet-grid">
        {loading && <div className="muted tiny">Loading fleet roster\u2026</div>}
        {!loading && visible.length === 0 && <div className="muted tiny">No assets match this filter.</div>}
        {visible.map((d) => {
          const cls = statusClass(d.status);
          const isPrime = d.live;
          return (
            <button key={d.id} className={`fleet-card ${cls} ${selected?.id === d.id ? 'sel' : ''}`} onClick={() => setSelected(d)}>
              <div className="fleet-card-top">
                <span className="fleet-tail mono">{d.tail_number}</span>
                <span className={`badge ${cls}`}>{d.status.toUpperCase()}</span>
              </div>
              <div className="fleet-health-ring">
                <svg viewBox="0 0 60 60">
                  <circle cx="30" cy="30" r="25" className="ring-bg" />
                  <circle cx="30" cy="30" r="25" className={`ring-fg ${cls}`}
                    strokeDasharray={`${(d.health_overall / 100) * 157} 157`} />
                </svg>
                <span className="fleet-health-num mono">{Math.round(d.health_overall)}%</span>
              </div>
              <div className="fleet-card-meta tiny mono muted">
                <span>{d.phase || d.asset_code}</span>
                <span>{Math.round(d.engine_hours)} h</span>
              </div>
              {isPrime && <span className="fleet-live-chip">{d.data_source === 'live_can' ? 'LIVE CAN' : 'LIVE TWIN'}</span>}
            </button>
          );
        })}
      </div>

      {selected && (
        <div className="card fade-in">
          <div className="card-head">
            <h2>{selected.tail_number} &mdash; asset detail</h2>
            <button className="link-btn" onClick={() => setSelected(null)}>Close</button>
          </div>
          <div className="grid-2">
            <div>
              <div className="kv-row"><span>Asset code</span><span>{selected.asset_code}</span></div>
              <div className="kv-row"><span>Status</span><span className={`state-${statusClass(selected.status)}`}>{selected.status.toUpperCase()}</span></div>
              <div className="kv-row"><span>Overall health</span><span>{selected.health_overall.toFixed(1)}%</span></div>
              <div className="bar"><i className={statusClass(selected.status) === 'ok' ? '' : statusClass(selected.status)} style={{ width: `${selected.health_overall}%` }} /></div>
              <div className="kv-row"><span>Airframe hours</span><span>{selected.engine_hours.toFixed(1)} h</span></div>
              {selected.live && <div className="kv-row"><span>Live readiness</span><span>{selected.readiness} &middot; RUL {selected.rul_h} h</span></div>}
              {selected.status_locked && <div className="tiny state-warn" style={{ marginTop: 6 }}>Status pinned by an admin order &mdash; use &ldquo;Clear to mission-ready&rdquo; to release.</div>}
              <div className="row-btns"><button className="btn primary" onClick={() => onOpenTwin?.(selected.tail_number)}>Open live twin {'\u2192'}</button></div>

              {isAdmin ? (
                <div className="row-btns">
                  {ACTIONS.map((a) => (
                    <button key={a.key} className={`btn ${a.tone}`} onClick={() => { setPendingAction(a); setNote(''); }}>
                      {a.label}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="muted tiny" style={{ marginTop: 10 }}>
                  Fleet actions (grounding, recall, maintenance scheduling) require an admin account.
                </div>
              )}
            </div>
            <div>
              <h2 style={{ marginBottom: 8 }}>Recent alerts</h2>
              <div className="alerts">
                {droneAlerts.length === 0 && <div className="ok-state">No recent findings for this asset.</div>}
                {droneAlerts.map((a) => (
                  <div className={`alert ${a.severity}`} key={a.id}>
                    <div className="t"><span>{a.title}</span><span className="tiny mono muted">{new Date(a.created_at).toLocaleTimeString()}</span></div>
                    <div className="e">{a.evidence}</div>
                    <div className="a">{'\u21b3'} {a.action}</div>
                  </div>
                ))}
              </div>
              <h2 style={{ margin: '14px 0 8px' }}>Work orders</h2>
              <div className="alerts">
                {wos.length === 0 && <div className="muted tiny">None.</div>}
                {wos.map((w) => (
                  <div className="alert" key={w.id}>
                    <div className="t"><span className="mono">{w.code} &middot; {w.priority}</span><span className="tiny mono muted">{timeAgo(w.created_at)}</span></div>
                    <div className="e">{w.description}</div>
                    <div className="row-btns" style={{ marginTop: 6 }}>
                      <span className="tiny muted">status: {w.status.replace('_', ' ')}</span>
                      {isAdmin && w.status !== 'closed' && <button className="btn" onClick={() => api.setWorkorder(w.id, w.status === 'open' ? 'in_progress' : 'closed').then(() => api.workorders(selected.tail_number, 10).then(setWos))}>{w.status === 'open' ? 'Start' : 'Close'}</button>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {pendingAction && (
        <div className="modal-backdrop" onClick={() => !busy && setPendingAction(null)}>
          <div className="modal-card fade-in" onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginBottom: 4 }}>{pendingAction.label}</h2>
            <p className="muted tiny" style={{ marginBottom: 10 }}>
              {selected?.tail_number} &middot; this action is logged to the asset&rsquo;s alert history under your name.
            </p>
            <label className="modal-note-label">
              <span>Note (optional)</span>
              <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason or maintenance detail\u2026" />
            </label>
            <div className="row-btns" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="btn" onClick={() => setPendingAction(null)} disabled={busy}>Cancel</button>
              <button className={`btn ${pendingAction.tone}`} onClick={runAction} disabled={busy}>
                {busy ? 'Submitting\u2026' : `Confirm ${pendingAction.label.toLowerCase()}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className={`fleet-toast ${toast.ok ? 'ok' : 'crit'}`}>{toast.text}</div>
      )}
    </div>
  );
}
