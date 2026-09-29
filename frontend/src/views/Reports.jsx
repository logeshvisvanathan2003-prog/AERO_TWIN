import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { timeAgo } from '../components/ui.jsx';

function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click(); URL.revokeObjectURL(a.href);
}

const vcls = (v) => (v === 'NO-GO' ? 'crit' : v === 'RESTRICTED' ? 'warn' : 'ok');

export default function Reports({ tail, drones }) {
  const [scope, setScope] = useState('current');       // current | all
  const [missions, setMissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState('Select a completed sortie, or generate a live snapshot.');
  const [name, setName] = useState('report');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api.missions(scope === 'current' ? tail : undefined)
    .then((m) => { setMissions(m); setLoading(false); }).catch(() => setLoading(false)), [scope, tail]);
  useEffect(() => { setLoading(true); load(); const iv = setInterval(load, 10000); return () => clearInterval(iv); }, [load]);

  const snapshot = async () => {
    setBusy(true);
    try { setReport(await api.report(tail)); setName(`snapshot_${tail}`); }
    catch (e) { setReport(`Could not generate report: ${e.message}`); }
    finally { setBusy(false); }
  };
  const open = async (m) => {
    try { setReport(await api.missionReport(m.id)); setName(m.code); } catch (e) { setReport(`Could not load report: ${e.message}`); }
  };

  return (
    <div className="fade-in view active">
      <div className="card">
        <div className="card-head">
          <h2>Mission-wise health reports</h2>
          <div className="toolbar">
            {drones.length > 1 && (
              <>
                <button className={`chip ${scope === 'current' ? 'active' : ''}`} onClick={() => setScope('current')}>{tail || 'Selected drone'}</button>
                <button className={`chip ${scope === 'all' ? 'active' : ''}`} onClick={() => setScope('all')}>All my drones</button>
              </>
            )}
          </div>
        </div>
        <p className="muted tiny" style={{ marginTop: -4 }}>A report is written automatically each time a drone completes a sortie (landing). Twin time is accelerated, so sorties complete every few minutes.</p>
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>REPORT</th><th>DRONE</th><th>WHEN</th><th>VERDICT</th><th>HEALTH</th><th>RUL END</th><th>FAULTS</th><th /></tr></thead>
            <tbody>
              {loading && <tr><td colSpan={8} className="muted">Loading{'\u2026'}</td></tr>}
              {!loading && missions.length === 0 && <tr><td colSpan={8} className="muted">No completed sorties yet.</td></tr>}
              {missions.map((m) => (
                <tr key={m.id}>
                  <td className="mono">{m.code}{m.partial ? ' *' : ''}</td><td className="mono">{m.tail_number}</td><td className="tiny mono muted">{timeAgo(m.created_at)}</td>
                  <td className={`state-${vcls(m.verdict)}`}>{m.verdict}</td>
                  <td>{m.health_start} {'\u2192'} {m.health_end}</td><td>{Math.round(m.rul_end_h)} h</td><td>{m.faults}</td>
                  <td><button className="btn" onClick={() => open(m)}>View</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {missions.some((m) => m.partial) && <p className="muted tiny">* partial sortie &mdash; the twin was started mid-mission.</p>}
      </div>

      <div className="card">
        <div className="card-head"><h2>Report viewer</h2>
          <div className="toolbar">
            <button className="chip" onClick={snapshot} disabled={busy || !tail}>{busy ? 'Generating\u2026' : `Live snapshot (${tail || '\u2014'})`}</button>
            <button className="chip" onClick={() => download(`${name}_${Date.now()}.md`, report, 'text/markdown')}>Download .md</button>
          </div>
        </div>
        <pre className="report mono">{report}</pre>
      </div>
    </div>
  );
}
