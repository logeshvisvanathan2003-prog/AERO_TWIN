import { useCallback, useEffect, useState } from 'react';
import { api, API_BASE } from '../../lib/api.js';
import { Modal, Toast, timeAgo } from '../../components/ui.jsx';

const EMPTY = { tail_number: '', name: '', asset_code: 'AE-115T', squadron: '1 UAV Squadron', data_source: 'simulated', engine_hours: 0, notes: '', operators: [] };
const cls = (s) => (s === 'grounded' ? 'crit' : s === 'caution' ? 'warn' : 'ok');

export default function Drones() {
  const [rows, setRows] = useState([]);
  const [ops, setOps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [toast, setToast] = useState(null);

  const pull = useCallback(() => Promise.all([api.drones(), api.operators()])
    .then(([d, o]) => { setRows(d); setOps(o.filter((x) => x.role === 'operator')); setLoading(false); }).catch(() => setLoading(false)), []);
  useEffect(() => { pull(); const iv = setInterval(pull, 12000); return () => clearInterval(iv); }, [pull]);

  const set = (k, v) => setForm((f) => ({ ...f, data: { ...f.data, [k]: v } }));
  const toggleOp = (id) => setForm((f) => {
    const has = f.data.operators.includes(id);
    return { ...f, data: { ...f.data, operators: has ? f.data.operators.filter((x) => x !== id) : [...f.data.operators, id] } };
  });

  const save = async (e) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try {
      const d = form.data;
      if (form.mode === 'create') {
        const r = await api.createDrone({ ...d, engine_hours: +d.engine_hours || 0 });
        setToast({ ok: !r.drone.warning, text: r.drone.warning || `${r.drone.tail_number} registered \u2014 live twin started.` });
      } else {
        await api.updateDrone(form.id, { name: d.name, asset_code: d.asset_code, squadron: d.squadron, data_source: d.data_source, engine_hours: +d.engine_hours || 0, notes: d.notes, operators: d.operators });
        setToast({ ok: true, text: `${d.tail_number} updated.` });
      }
      setForm(null); pull();
    } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  };

  const runConfirm = async () => {
    setBusy(true);
    try { await confirm.run(); setConfirm(null); pull(); }
    catch (e) { setToast({ ok: false, text: e.message }); setConfirm(null); }
    finally { setBusy(false); }
  };
  const toggleActive = (d) => setConfirm({ title: d.active ? 'Disable drone' : 'Enable drone', tone: d.active ? 'danger' : '',
    text: d.active ? `${d.tail_number} stops streaming and disappears from every operator's list.` : `Restart the live twin for ${d.tail_number}?`,
    run: async () => { await api.updateDrone(d.id, { active: !d.active }); setToast({ ok: true, text: `${d.tail_number} ${d.active ? 'disabled' : 'enabled'}.` }); } });
  const remove = (d) => setConfirm({ title: 'Delete drone', tone: 'danger',
    text: `Permanently delete ${d.tail_number} with all of its alerts, work orders, mission reports and telemetry history?`,
    run: async () => { await api.deleteDrone(d.id); setToast({ ok: true, text: `${d.tail_number} deleted.` }); } });

  return (
    <div className="view active fade-in">
      <div className="card">
        <div className="card-head">
          <h2>Drone registry &mdash; one live digital twin per airframe</h2>
          <button className="btn primary" onClick={() => { setErr(''); setForm({ mode: 'create', data: { ...EMPTY } }); }}>+ Register drone</button>
        </div>
        <p className="muted tiny" style={{ marginTop: -4 }}>
          Each drone runs its own physics twin, ML inference and alert stream. Assign operators here or from the Operators page.
        </p>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="tbl tbl-admin">
            <thead><tr><th>TAIL</th><th>NAME</th><th>DATA SOURCE</th><th>STATUS</th><th>HEALTH</th><th>HOURS</th><th>OPERATORS</th><th>SEEN</th><th /></tr></thead>
            <tbody>
              {loading && <tr><td colSpan={9} className="muted">Loading{'\u2026'}</td></tr>}
              {rows.map((d) => (
                <tr key={d.id} className={d.active ? '' : 'row-off'}>
                  <td className="mono strong">{d.live_twin && <span className="live-dot" title="live twin running" />}{d.tail_number}</td>
                  <td>{d.name || '\u2014'}<div className="tiny muted">{d.asset_code} &middot; {d.squadron}</div></td>
                  <td><span className={`tag ${d.data_source === 'live_can' ? 'info' : ''}`}>{d.data_source === 'live_can' ? 'LIVE CAN' : 'SIMULATED'}</span></td>
                  <td>{d.active ? <span className={`badge ${cls(d.status)}`} style={{ animation: 'none' }}>{d.status.toUpperCase()}{d.status_locked ? ' \u00b7 ORDER' : ''}</span> : <span className="badge crit" style={{ animation: 'none' }}>DISABLED</span>}</td>
                  <td className="mono">{Math.round(d.health_overall)}%</td>
                  <td className="mono">{d.engine_hours}</td>
                  <td>{d.operators.length ? <div className="chips">{d.operators.map((o) => <span className="tag" key={o}>{o}</span>)}</div> : <span className="state-warn tiny">unassigned</span>}</td>
                  <td className="tiny mono muted">{d.viewers > 0 ? `${d.viewers} viewing` : timeAgo(d.last_seen)}</td>
                  <td className="row-actions">
                    <button className="btn" onClick={() => { setErr(''); setForm({ mode: 'edit', id: d.id, data: { ...d } }); }}>Edit</button>
                    <button className={`btn ${d.active ? 'danger' : ''}`} onClick={() => toggleActive(d)}>{d.active ? 'Disable' : 'Enable'}</button>
                    <button className="btn danger" onClick={() => remove(d)}>Delete</button>
                  </td>
                </tr>
              ))}
              {!loading && rows.length === 0 && <tr><td colSpan={9} className="muted">No drones registered.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>Connecting a real engine (CAN / FADEC)</h2></div>
        <p className="muted tiny" style={{ marginBottom: 8 }}>
          Register the drone with data source <b>LIVE CAN</b>, set <span className="mono">INGEST_KEY</span> on the backend, then run the edge gateway
          (<span className="mono">tools/can_gateway.py</span>) on the companion computer / test-rig PC. It decodes SocketCAN frames and pushes 1 Hz samples to:
        </p>
        <pre className="report mono" style={{ maxHeight: 'none' }}>{`POST ${API_BASE}/api/ingest/<TAIL>\nheader  X-Ingest-Key: <INGEST_KEY>\nbody    {"rpm":4520,"throttle":0.72,"alt_m":3100,"oat_c":6,"cht":141,"egt":790,"oil_p":3.4,"oil_t":96,"fuel_flow":18.2,"vib":1.3,"bus_v":13.8, ...}`}</pre>
      </div>

      {form && (
        <Modal title={form.mode === 'create' ? 'Register drone' : `Edit ${form.data.tail_number}`} onClose={() => setForm(null)} busy={busy} wide>
          <form onSubmit={save} className="form-grid">
            <label className="field"><span>Tail number *</span>
              <input value={form.data.tail_number} onChange={(e) => set('tail_number', e.target.value.toUpperCase())} disabled={form.mode === 'edit'} required placeholder="e.g. TAIL-07" pattern="[A-Za-z0-9][A-Za-z0-9._\-]{1,47}" /></label>
            <label className="field"><span>Name</span><input value={form.data.name} onChange={(e) => set('name', e.target.value)} placeholder="Rustom-H Block F" /></label>
            <label className="field"><span>Engine / asset code</span><input value={form.data.asset_code} onChange={(e) => set('asset_code', e.target.value)} /></label>
            <label className="field"><span>Squadron</span><input value={form.data.squadron} onChange={(e) => set('squadron', e.target.value)} /></label>
            <label className="field"><span>Data source</span>
              <select value={form.data.data_source} onChange={(e) => set('data_source', e.target.value)}>
                <option value="simulated">Simulated twin (demo / test)</option>
                <option value="live_can">Live CAN / FADEC (edge gateway)</option>
              </select></label>
            <label className="field"><span>Engine hours</span><input type="number" min="0" step="0.1" value={form.data.engine_hours} onChange={(e) => set('engine_hours', e.target.value)} /></label>
            <label className="field full"><span>Notes</span><textarea rows={2} value={form.data.notes} onChange={(e) => set('notes', e.target.value)} /></label>
            <div className="field full">
              <span>Assigned operators ({form.data.operators.length})</span>
              <div className="check-list">
                {ops.length === 0 && <span className="muted tiny">No operator accounts yet &mdash; create them on the Operators page.</span>}
                {ops.map((o) => (
                  <label key={o.id} className={`check ${form.data.operators.includes(o.login_id) ? 'on' : ''}`}>
                    <input type="checkbox" checked={form.data.operators.includes(o.login_id)} onChange={() => toggleOp(o.login_id)} />
                    <span className="mono">{o.login_id}</span><span className="tiny muted">{o.full_name}</span>
                  </label>
                ))}
              </div>
            </div>
            {err && <div className="login-err full">{err}</div>}
            <div className="row-btns full" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="btn" onClick={() => setForm(null)} disabled={busy}>Cancel</button>
              <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Saving\u2026' : form.mode === 'create' ? 'Register drone' : 'Save changes'}</button>
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
      <Toast toast={toast} onDone={() => setToast(null)} />
    </div>
  );
}
