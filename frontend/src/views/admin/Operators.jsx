import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api.js';
import { Modal, Toast, CopyBox, timeAgo } from '../../components/ui.jsx';

const EMPTY = { login_id: '', full_name: '', designation: '', squadron: '1 UAV Squadron', email: '', phone: '', role: 'operator', password: '', drones: [] };

function statusOf(o) {
  if (!o.active) return ['disabled', 'crit', 'DISABLED'];
  if (o.locked) return ['locked', 'warn', 'LOCKED'];
  return ['active', 'ok', 'ACTIVE'];
}

export default function Operators({ self }) {
  const [rows, setRows] = useState([]);
  const [drones, setDrones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [form, setForm] = useState(null);           // { mode:'create'|'edit', data, id }
  const [confirm, setConfirm] = useState(null);     // { title, text, tone, run }
  const [secret, setSecret] = useState(null);       // { login_id, password, kind }
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [toast, setToast] = useState(null);

  const pull = useCallback(() => Promise.all([api.operators(), api.drones()])
    .then(([o, d]) => { setRows(o); setDrones(d); setLoading(false); }).catch(() => setLoading(false)), []);
  useEffect(() => { pull(); const iv = setInterval(pull, 15000); return () => clearInterval(iv); }, [pull]);

  const visible = useMemo(() => rows.filter((o) => {
    if (filter === 'operator' && o.role !== 'operator') return false;
    if (filter === 'admin' && o.role !== 'admin') return false;
    if (filter === 'disabled' && o.active) return false;
    if (filter === 'online' && !o.online) return false;
    const q = query.trim().toLowerCase();
    return !q || [o.login_id, o.full_name, o.squadron, o.designation, ...o.drones].join(' ').toLowerCase().includes(q);
  }), [rows, query, filter]);

  const openCreate = () => { setErr(''); setForm({ mode: 'create', data: { ...EMPTY } }); };
  const openEdit = (o) => { setErr(''); setForm({ mode: 'edit', id: o.id, data: { ...o, password: '' } }); };
  const set = (k, v) => setForm((f) => ({ ...f, data: { ...f.data, [k]: v } }));
  const toggleDrone = (t) => setForm((f) => {
    const has = f.data.drones.includes(t);
    return { ...f, data: { ...f.data, drones: has ? f.data.drones.filter((x) => x !== t) : [...f.data.drones, t] } };
  });

  const save = async (e) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try {
      const d = form.data;
      if (form.mode === 'create') {
        const r = await api.createOperator({ ...d, password: d.password || undefined });
        setForm(null);
        setSecret({ login_id: r.operator.login_id, password: r.temporary_password, kind: 'created' });
      } else {
        await api.updateOperator(form.id, { full_name: d.full_name, designation: d.designation, squadron: d.squadron, email: d.email, phone: d.phone, role: d.role, drones: d.drones });
        setForm(null); setToast({ ok: true, text: `${d.login_id} updated.` });
      }
      pull();
    } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  };

  const ask = (title, text, tone, run) => setConfirm({ title, text, tone, run });
  const runConfirm = async () => {
    setBusy(true);
    try { await confirm.run(); setConfirm(null); pull(); }
    catch (e) { setToast({ ok: false, text: e.message }); setConfirm(null); }
    finally { setBusy(false); }
  };

  const doReset = (o) => ask('Reset password', `Issue a new temporary password for ${o.login_id}? Their current sessions are signed out immediately.`, '',
    async () => { const r = await api.resetPassword(o.id); setSecret({ login_id: o.login_id, password: r.temporary_password, kind: 'reset' }); });
  const doToggle = (o) => ask(o.active ? 'Disable account' : 'Enable account',
    o.active ? `${o.login_id} will be signed out and unable to log in until re-enabled.` : `Re-enable ${o.login_id}?`, o.active ? 'danger' : '',
    async () => { await api.updateOperator(o.id, { active: !o.active }); setToast({ ok: true, text: `${o.login_id} ${o.active ? 'disabled' : 'enabled'}.` }); });
  const doDelete = (o) => ask('Delete account', `Permanently delete ${o.login_id} (${o.full_name})? This cannot be undone.`, 'danger',
    async () => { await api.deleteOperator(o.id); setToast({ ok: true, text: `${o.login_id} deleted.` }); });
  const doUnlock = async (o) => { try { await api.unlockOperator(o.id); setToast({ ok: true, text: `${o.login_id} unlocked.` }); pull(); } catch (e) { setToast({ ok: false, text: e.message }); } };

  return (
    <div className="view active fade-in">
      <div className="card">
        <div className="card-head">
          <h2>Operator accounts &mdash; multi-drone access control</h2>
          <button className="btn primary" onClick={openCreate}>+ Create operator login</button>
        </div>
        <p className="muted tiny" style={{ marginTop: -4, marginBottom: 10 }}>
          Operators can only see and act on the drones assigned to them. Accounts are issued here &mdash; there is no self-registration.
        </p>
        <div className="fleet-toolbar">
          <input className="fleet-search" placeholder={'Search login ID, name, squadron or drone\u2026'} value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="fleet-filters">
            {[['all', 'All'], ['operator', 'Operators'], ['admin', 'Admins'], ['online', 'Online'], ['disabled', 'Disabled']].map(([k, l]) => (
              <button key={k} className={`chip ${filter === k ? 'active' : ''}`} onClick={() => setFilter(k)}>{l}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="tbl tbl-admin">
            <thead><tr><th>LOGIN ID</th><th>NAME</th><th>ROLE</th><th>ASSIGNED DRONES</th><th>STATUS</th><th>LAST LOGIN</th><th /></tr></thead>
            <tbody>
              {loading && <tr><td colSpan={7} className="muted">Loading{'\u2026'}</td></tr>}
              {!loading && visible.length === 0 && <tr><td colSpan={7} className="muted">No accounts match.</td></tr>}
              {visible.map((o) => {
                const [, cls, label] = statusOf(o);
                const me = o.id === self.id;
                return (
                  <tr key={o.id}>
                    <td className="mono strong">{o.online && <span className="live-dot" title="online" />}{o.login_id}{me && <span className="tag">YOU</span>}</td>
                    <td>{o.full_name}<div className="tiny muted">{[o.designation, o.squadron].filter(Boolean).join(' \u00b7 ')}</div></td>
                    <td><span className={`role-pill ${o.role}`}>{o.role.toUpperCase()}</span></td>
                    <td>{o.role === 'admin' ? <span className="muted tiny">all drones</span>
                      : o.drones.length ? <div className="chips">{o.drones.map((t) => <span className="tag" key={t}>{t}</span>)}</div>
                        : <span className="state-warn tiny">none assigned</span>}</td>
                    <td><span className={`badge ${cls}`} style={{ animation: 'none' }}>{label}</span>{o.must_change_password && <div className="tiny muted">pwd change pending</div>}</td>
                    <td className="tiny mono muted">{timeAgo(o.last_login)}</td>
                    <td className="row-actions">
                      <button className="btn" onClick={() => openEdit(o)}>Edit</button>
                      <button className="btn" onClick={() => doReset(o)}>Reset pwd</button>
                      {o.locked && <button className="btn" onClick={() => doUnlock(o)}>Unlock</button>}
                      {!me && <button className={`btn ${o.active ? 'danger' : ''}`} onClick={() => doToggle(o)}>{o.active ? 'Disable' : 'Enable'}</button>}
                      {!me && <button className="btn danger" onClick={() => doDelete(o)}>Delete</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {form && (
        <Modal title={form.mode === 'create' ? 'Create operator login' : `Edit ${form.data.login_id}`} onClose={() => setForm(null)} busy={busy} wide>
          <form onSubmit={save} className="form-grid">
            <label className="field"><span>Login ID *</span>
              <input value={form.data.login_id} onChange={(e) => set('login_id', e.target.value.toUpperCase())} disabled={form.mode === 'edit'} required placeholder="e.g. OPR-07" pattern="[A-Za-z0-9][A-Za-z0-9._\-]{1,47}" /></label>
            <label className="field"><span>Full name *</span>
              <input value={form.data.full_name} onChange={(e) => set('full_name', e.target.value)} required /></label>
            <label className="field"><span>Designation</span>
              <input value={form.data.designation} onChange={(e) => set('designation', e.target.value)} placeholder="UAV Operator / Flight Engineer" /></label>
            <label className="field"><span>Squadron / unit</span>
              <input value={form.data.squadron} onChange={(e) => set('squadron', e.target.value)} /></label>
            <label className="field"><span>Email</span>
              <input type="email" value={form.data.email} onChange={(e) => set('email', e.target.value)} /></label>
            <label className="field"><span>Phone</span>
              <input value={form.data.phone} onChange={(e) => set('phone', e.target.value)} /></label>
            <label className="field"><span>Role</span>
              <select value={form.data.role} disabled={form.mode === 'edit' && form.id === self.id} onChange={(e) => set('role', e.target.value)}>
                <option value="operator">Operator (assigned drones only)</option>
                <option value="admin">Administrator (full control)</option>
              </select></label>
            {form.mode === 'create' && (
              <label className="field"><span>Temporary password</span>
                <input value={form.data.password} onChange={(e) => set('password', e.target.value)} placeholder="Leave blank to auto-generate" autoComplete="off" /></label>
            )}
            {form.data.role === 'operator' && (
              <div className="field full">
                <span>Assigned drones ({form.data.drones.length})</span>
                <div className="check-list">
                  {drones.length === 0 && <span className="muted tiny">No drones registered yet.</span>}
                  {drones.map((d) => (
                    <label key={d.id} className={`check ${form.data.drones.includes(d.tail_number) ? 'on' : ''}`}>
                      <input type="checkbox" checked={form.data.drones.includes(d.tail_number)} onChange={() => toggleDrone(d.tail_number)} />
                      <span className="mono">{d.tail_number}</span><span className="tiny muted">{d.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            {form.data.role === 'admin' && form.mode === 'create' && <div className="field full"><div className="notice warn">Administrators can create accounts, control every drone and read all notifications. Grant sparingly.</div></div>}
            {err && <div className="login-err full">{err}</div>}
            <div className="row-btns full" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="btn" onClick={() => setForm(null)} disabled={busy}>Cancel</button>
              <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Saving\u2026' : form.mode === 'create' ? 'Create account' : 'Save changes'}</button>
            </div>
          </form>
        </Modal>
      )}

      {confirm && (
        <Modal title={confirm.title} onClose={() => setConfirm(null)} busy={busy}>
          <p className="muted" style={{ marginBottom: 14 }}>{confirm.text}</p>
          <div className="row-btns" style={{ justifyContent: 'flex-end' }}>
            <button className="btn" onClick={() => setConfirm(null)} disabled={busy}>Cancel</button>
            <button className={`btn ${confirm.tone}`} onClick={runConfirm} disabled={busy}>{busy ? 'Working\u2026' : 'Confirm'}</button>
          </div>
        </Modal>
      )}

      {secret && (
        <Modal title={secret.kind === 'created' ? 'Account created' : 'Password reset'} onClose={() => setSecret(null)}>
          <p className="muted tiny" style={{ marginBottom: 10 }}>
            Hand these credentials to the operator securely. <b>This password is shown only once</b>; they must change it at first sign-in.
          </p>
          <CopyBox label="LOGIN ID" value={secret.login_id} />
          <CopyBox label="TEMPORARY PASSWORD" value={secret.password} />
          <div className="row-btns" style={{ justifyContent: 'flex-end' }}><button className="btn primary" onClick={() => setSecret(null)}>Done</button></div>
        </Modal>
      )}
      <Toast toast={toast} onDone={() => setToast(null)} />
    </div>
  );
}
