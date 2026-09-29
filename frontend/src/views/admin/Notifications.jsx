import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api.js';
import { Toast, timeAgo } from '../../components/ui.jsx';

const CATS = [
  ['', 'All', '\u2317'], ['ALERT', 'Fault alerts', '\u26a0'], ['MAINTENANCE', 'Maintenance', '\ud83d\udee0'],
  ['FLEET', 'Fleet orders', '\u2708'], ['MISSION', 'Missions', '\u25a4'], ['USER', 'Accounts', '\u263a'],
  ['SECURITY', 'Security', '\ud83d\udd12'], ['SYSTEM', 'System', '\u2699'],
];
const ICON = Object.fromEntries(CATS.filter((c) => c[0]).map(([k, , ic]) => [k, ic]));
const SEV_COLOR = { alarm: 'var(--crit)', warn: 'var(--warn)', info: 'var(--ok)' };
const SEV_LABEL = { alarm: 'Alarm', warn: 'Warning', info: 'Info' };
const PAGE = 60;

function dayLabel(iso) {
  const d = new Date(iso), now = new Date();
  const strip = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((strip(now) - strip(d)) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff <= 6) return d.toLocaleDateString(undefined, { weekday: 'long' });
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: diff > 300 ? 'numeric' : undefined });
}

function groupByDay(rows) {
  const out = [];
  let cur = null;
  for (const n of rows) {
    const label = dayLabel(n.created_at);
    if (!cur || cur.label !== label) { cur = { label, rows: [] }; out.push(cur); }
    cur.rows.push(n);
  }
  return out;
}

export default function Notifications({ inbox }) {
  const [cat, setCat] = useState('');
  const [sev, setSev] = useState('');
  const [tail, setTail] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [drones, setDrones] = useState([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState(new Set());
  const [toast, setToast] = useState(null);

  const params = useMemo(() => ({ category: cat, severity: sev, tail, unread: unreadOnly, q: q.trim(), limit: PAGE }), [cat, sev, tail, unreadOnly, q]);

  const load = useCallback(async () => {
    try {
      const r = await api.notifications(params);
      setRows(r); setMore(r.length === PAGE); setLoading(false);
    } catch { setLoading(false); }
  }, [params]);

  useEffect(() => { setLoading(true); const t = setTimeout(load, q ? 250 : 0); return () => clearTimeout(t); }, [load, q]);
  useEffect(() => { const iv = setInterval(load, 8000); return () => clearInterval(iv); }, [load]);
  useEffect(() => { api.drones().then(setDrones).catch(() => {}); }, []);

  const afterChange = () => { load(); inbox.refresh(); };

  const loadMore = async () => {
    const last = rows[rows.length - 1];
    if (!last) return;
    const r = await api.notifications({ ...params, before_id: last.id });
    setRows((x) => [...x, ...r]); setMore(r.length === PAGE);
  };

  const toggleRead = async (n) => { await (n.read ? api.notifUnread([n.id]) : api.notifRead({ ids: [n.id] })); afterChange(); };
  const markSelected = async () => { await api.notifRead({ ids: [...sel] }); setSel(new Set()); afterChange(); };
  const markAll = async () => {
    const r = await api.notifRead({ all: true, category: cat || undefined, severity: sev || undefined, tail: tail || undefined });
    setToast({ ok: true, text: `${r.updated} notification(s) marked as read.` }); afterChange();
  };
  const clearRead = async () => { const r = await api.notifClearRead(); setToast({ ok: true, text: `${r.deleted} read notification(s) cleared.` }); setSel(new Set()); afterChange(); };
  const toggleSel = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectAllVisible = () => setSel((s) => (s.size === rows.length ? new Set() : new Set(rows.map((r) => r.id))));

  const s = inbox.summary;
  const byCat = s.by_category || {};
  const bySev = s.by_severity || {};
  const groups = useMemo(() => groupByDay(rows), [rows]);
  const activeFilterCount = [cat, sev, tail, unreadOnly, q.trim()].filter(Boolean).length;

  return (
    <div className="view active fade-in">
      {/* ---- summary strip ------------------------------------------------ */}
      <div className="kpis">
        <div className="kpi">
          <div className="k">TOTAL UNREAD</div>
          <div className="v">{s.unread}</div>
          <div className="d">across every category</div>
        </div>
        <div className={`kpi ${bySev.alarm ? 'crit' : ''}`}>
          <div className="k">ALARM</div>
          <div className="v">{bySev.alarm || 0}</div>
          <div className="d">needs immediate review</div>
        </div>
        <div className={`kpi ${bySev.warn ? 'warn' : ''}`}>
          <div className="k">WARNING</div>
          <div className="v">{bySev.warn || 0}</div>
          <div className="d">worth a look today</div>
        </div>
        <div className="kpi">
          <div className="k">INFO</div>
          <div className="v">{bySev.info || 0}</div>
          <div className="d">routine / logged events</div>
        </div>
      </div>

      {/* ---- filters -------------------------------------------------------- */}
      <div className="card">
        <div className="card-head">
          <h2>Notifications &mdash; every alert, order and account event</h2>
          <span className="mono tiny muted">auto-refresh 8s</span>
        </div>

        <div className="fleet-filters" style={{ marginBottom: 12 }}>
          {CATS.map(([k, l, ic]) => (
            <button key={k || 'all'} className={`chip ${cat === k ? 'active' : ''}`} onClick={() => setCat(k)}>
              <span style={{ marginRight: 5 }}>{ic}</span>{l}
              {k && byCat[k] ? <span className="chip-badge">{byCat[k]}</span> : null}
            </button>
          ))}
        </div>

        <div className="fleet-toolbar" style={{ marginTop: 0 }}>
          <input className="fleet-search" placeholder={'Search title or detail\u2026'} value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="sel" value={sev} onChange={(e) => setSev(e.target.value)}>
            <option value="">All severities</option><option value="alarm">Alarm</option><option value="warn">Warning</option><option value="info">Info</option>
          </select>
          <select className="sel" value={tail} onChange={(e) => setTail(e.target.value)}>
            <option value="">All drones</option>{drones.map((d) => <option key={d.id} value={d.tail_number}>{d.tail_number}</option>)}
          </select>
          <label className="inline-check"><input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} /> Unread only</label>
          {activeFilterCount > 0 && (
            <button className="link-btn" onClick={() => { setCat(''); setSev(''); setTail(''); setUnreadOnly(false); setQ(''); }}>
              Clear filters ({activeFilterCount})
            </button>
          )}
        </div>

        <div className="row-btns">
          <button className="btn primary" onClick={markAll}>Mark all{cat || sev || tail ? ' (filtered)' : ''} read</button>
          <button className="btn" onClick={markSelected} disabled={!sel.size}>Mark selected read ({sel.size})</button>
          <button className="btn" onClick={selectAllVisible}>{sel.size === rows.length && rows.length ? 'Deselect all' : `Select all (${rows.length})`}</button>
          <button className="btn danger" onClick={clearRead}>Clear read notifications</button>
        </div>
      </div>

      {/* ---- list, grouped by day ------------------------------------------ */}
      <div className="card">
        {loading && <div className="muted tiny">Loading{'\u2026'}</div>}
        {!loading && rows.length === 0 && (
          <div className="ok-state">
            {activeFilterCount ? 'No notifications match these filters.' : 'No notifications yet \u2014 this inbox fills as the fleet reports events.'}
          </div>
        )}

        {groups.map((g) => (
          <div key={g.label} style={{ marginBottom: 18 }}>
            <div className="mini-k" style={{ margin: '4px 0 8px', letterSpacing: '.12em' }}>{g.label.toUpperCase()}</div>
            <div className="notif-page-list">
              {g.rows.map((n) => (
                <div key={n.id} className={`notif-item sev-${n.severity} ${n.read ? 'read' : 'unread'}`}>
                  <input type="checkbox" checked={sel.has(n.id)} onChange={() => toggleSel(n.id)} aria-label="select" style={{ marginTop: 3 }} />
                  <span
                    className="notif-item-ic"
                    title={SEV_LABEL[n.severity]}
                    style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      width: 30, height: 30, borderRadius: 9, flexShrink: 0,
                      background: `color-mix(in srgb, ${SEV_COLOR[n.severity]} 16%, transparent)`,
                      border: `1px solid color-mix(in srgb, ${SEV_COLOR[n.severity]} 45%, transparent)`,
                      color: SEV_COLOR[n.severity], fontSize: 15,
                    }}
                  >
                    {ICON[n.category] || '\u2139'}
                  </span>
                  <div className="notif-item-body">
                    <div className="notif-item-title">
                      {n.title}
                      {!n.read && <span className="dot-unread" title="unread" />}
                    </div>
                    {n.detail && <div className="notif-item-detail">{n.detail}</div>}
                    <div className="notif-item-meta tiny mono">
                      <span className="tag" style={{ color: SEV_COLOR[n.severity], borderColor: `color-mix(in srgb, ${SEV_COLOR[n.severity]} 45%, transparent)` }}>
                        {n.category}
                      </span>
                      {n.tail_number && <span className="tag info">{n.tail_number}</span>}
                      {n.actor && <span>by {n.actor}</span>}
                      <span title={n.created_at}>{timeAgo(n.created_at)}</span>
                      {n.read && n.read_by && <span>read by {n.read_by}</span>}
                    </div>
                  </div>
                  <button className="btn" onClick={() => toggleRead(n)}>{n.read ? 'Mark unread' : 'Mark read'}</button>
                </div>
              ))}
            </div>
          </div>
        ))}

        {more && <div className="row-btns" style={{ justifyContent: 'center' }}><button className="btn" onClick={loadMore}>Load older</button></div>}
      </div>
      <Toast toast={toast} onDone={() => setToast(null)} />
    </div>
  );
}