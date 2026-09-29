import { useState, useRef, useMemo, useEffect } from 'react';
import RollingLineChart from '../charts/RollingLineChart.jsx';
import { hhmmss, fmt } from '../lib/format.js';

function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click(); URL.revokeObjectURL(a.href);
}

export default function Replay({ history, eventLog }) {
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timerRef = useRef(null);
  const n = history.length;

  useEffect(() => { if (n) setIdx(n - 1); }, [n === 1]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!playing) { clearTimeout(timerRef.current); return; }
    timerRef.current = setTimeout(() => {
      setIdx((i) => (i + 3 >= n ? 0 : i + 3));
    }, 60);
    return () => clearTimeout(timerRef.current);
  }, [playing, idx, n]);

  const sub = useMemo(() => {
    const stride = Math.max(1, Math.floor(n / 400));
    return history.filter((_, i) => i % stride === 0);
  }, [history, n]);

  const f = history[idx];

  return (
    <div className="fade-in">
      <div className="card">
        <div className="card-head"><h2>Mission replay</h2>
          <div className="toolbar">
            <button className="chip active">{'\u25cf'} {n} frames buffered</button>
            <button className="chip" onClick={() => setPlaying((p) => !p)}>{playing ? 'Stop' : 'Play'}</button>
            <button className="chip" onClick={() => {
              if (!n) return;
              const cols = Object.keys(history[0]).filter((k) => typeof history[0][k] !== 'object');
              const csv = [cols.join(','), ...history.map((r) => cols.map((c) => r[c]).join(','))].join('\n');
              download(`aerotwin_mission_${Date.now()}.csv`, csv, 'text/csv');
            }}>Export CSV</button>
          </div>
        </div>
        <div className="replay-bar">
          <input type="range" min={0} max={Math.max(0, n - 1)} value={idx} onChange={(e) => setIdx(+e.target.value)} />
          <span className="mono tiny">{n ? idx + 1 : 0} / {n}</span>
        </div>
        <RollingLineChart labels={sub.map((x) => hhmmss(x.mission_t || 0))} height={240}
          series={[
            { label: 'CHT', color: 'crit' }, { label: 'RPM/50', color: 'accent' },
            { label: 'Vib\u00d720', color: 'warn' }, { label: 'Health %', color: 'info', axis: 'y1' },
          ]}
          getters={[
            sub.map((x) => x.cht), sub.map((x) => x.rpm / 50),
            sub.map((x) => x.vib * 20), sub.map((x) => x.health?.overall),
          ]}
          y1Opts={{}} />
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-head"><h2>Frame state</h2></div>
          <div className="kv">
            {f ? Object.entries({
              'Mission time': hhmmss(f.mission_t), Phase: f.phase, RPM: fmt(f.rpm, 0),
              'Power kW': fmt(f.power_kw, 1), 'CHT \u00b0C': fmt(f.cht, 1), 'EGT \u00b0C': fmt(f.egt, 0),
              'Oil bar': fmt(f.oil_p, 2), 'Oil \u00b0C': fmt(f.oil_t, 1), 'Vib g': fmt(f.vib, 2),
              'Fuel kg/h': fmt(f.fuel_flow, 2), 'Altitude m': fmt(f.alt_m, 0),
              'Misfire %': fmt((f.misfire || 0) * 100, 1), 'Health %': fmt(f.health?.overall, 0),
              'RUL h': f.inference?.rul_h != null ? fmt(f.inference.rul_h, 0) : '\u2014',
              Anomaly: f.inference?.score != null ? fmt(f.inference.score, 2) : '\u2014',
            }).map(([k, v]) => <div className="kv-row" key={k}><span>{k}</span><span>{v}</span></div>)
              : <p className="muted">No frame selected.</p>}
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h2>Event log</h2></div>
          <div className="events">
            {eventLog.map((e, i) => (
              <div className={`event ${e.sev}`} key={i}><span className="ts">{hhmmss(e.t)}</span><span>{e.text}</span></div>
            ))}
            {!eventLog.length && <p className="muted">No events logged yet.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
