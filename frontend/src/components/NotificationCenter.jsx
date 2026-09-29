import { useEffect, useRef, useState } from 'react';

const KIND_ICON = { takeoff: '\u2708', landing: '\u2b07', speed: '\u26a1', fault: '\u26a0', info: '\u2139' };

/**
 * Watches the live telemetry frame for operationally meaningful events —
 * phase transitions (take-off / landing), envelope limit breaches (speed /
 * RPM over-limit) and diagnostic fault onsets (malfunctions) — and surfaces
 * them as auto-dismissing toast popups plus a persistent bell-icon log.
 */
export default function NotificationCenter({ frame, tailLabel = 'PRIME' }) {
  const [toasts, setToasts] = useState([]);
  const [log, setLog] = useState([]);
  const [open, setOpen] = useState(false);
  const phaseRef = useRef(null);
  const limitKeysRef = useRef(new Set());
  const faultKeysRef = useRef(new Set());
  const idRef = useRef(0);

  const push = (kind, title, detail, sev = 'info') => {
    const id = ++idRef.current;
    const entry = { id, kind, title, detail, sev, t: Date.now() };
    setToasts((ts) => [...ts, entry].slice(-4));
    setLog((l) => [entry, ...l].slice(0, 80));
    // Every toast pops up and auto-dismisses after exactly 4 seconds,
    // regardless of severity — the persistent bell log below still keeps
    // the full history for anything the operator needs to review later.
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 4000);
  };

  useEffect(() => {
    if (!frame) return;

    // --- phase transitions -> take-off / landing -------------------------
    const phase = frame.phase;
    if (phaseRef.current && phase && phase !== phaseRef.current) {
      if (phase === 'TAKEOFF') push('takeoff', `${tailLabel} \u2014 Take-off roll`, 'Throttle up, airframe departing.', 'info');
      if (phaseRef.current === 'TAKEOFF' && phase === 'CLIMB') push('takeoff', `${tailLabel} \u2014 Airborne`, 'Positive rate confirmed, climbing to mission altitude.', 'ok');
      if (phase === 'LANDING') push('landing', `${tailLabel} \u2014 On final approach`, 'Descending for landing.', 'info');
      if (phaseRef.current === 'LANDING' && phase === 'START') push('landing', `${tailLabel} \u2014 Landed / shutdown`, 'Sortie complete, engine spooling down.', 'ok');
    }
    phaseRef.current = phase;

    // --- envelope limit breaches -> speed / rpm over-limit ----------------
    const seenLimits = new Set();
    (frame.limits || []).forEach((l) => {
      seenLimits.add(l.key);
      if (!limitKeysRef.current.has(l.key)) {
        const isSpeed = l.key === 'rpm' || l.key === 'tas_ms';
        push(isSpeed ? 'speed' : 'fault', `${tailLabel} \u2014 ${l.label} limit ${l.sev === 'alarm' ? 'exceeded' : 'warning'}`,
          `${l.value?.toFixed?.(1) ?? l.value} vs limit ${l.limit}`, l.sev === 'alarm' ? 'alarm' : 'warn');
      }
    });
    limitKeysRef.current = seenLimits;

    // --- diagnostic faults -> malfunction --------------------------------
    const seenFaults = new Set();
    (frame.faults || []).forEach((f) => {
      const key = f.id + f.sev;
      seenFaults.add(key);
      if (!faultKeysRef.current.has(key)) {
        push('fault', `${tailLabel} \u2014 ${f.title}`, f.evidence, f.sev === 'alarm' ? 'alarm' : 'warn');
      }
    });
    faultKeysRef.current = seenFaults;
  }, [frame, tailLabel]);

  const unreadCount = log.length;

  return (
    <div className="notif-wrap">
      <button className="notif-bell" onClick={() => setOpen((o) => !o)} title="Notifications">
        <span>{'\uD83D\uDD14'}</span>
        {unreadCount > 0 && <span className="notif-count">{unreadCount > 99 ? '99+' : unreadCount}</span>}
      </button>

      {open && (
        <>
          <div className="notif-backdrop" onClick={() => setOpen(false)} />
          <div className="notif-panel fade-in">
            <div className="notif-panel-head">
              <h2>Activity &amp; alerts</h2>
              <button className="link-btn" onClick={() => setLog([])}>Clear</button>
            </div>
            <div className="notif-panel-list scroll-thin">
              {log.length === 0 && <div className="muted tiny" style={{ padding: '14px 4px' }}>No activity yet this session.</div>}
              {log.map((n) => (
                <div className={`notif-row sev-${n.sev}`} key={n.id}>
                  <span className="notif-ic">{KIND_ICON[n.kind] || KIND_ICON.info}</span>
                  <div className="notif-row-body">
                    <div className="notif-row-title">{n.title}</div>
                    <div className="notif-row-detail">{n.detail}</div>
                  </div>
                  <span className="notif-row-time tiny mono">{new Date(n.t).toLocaleTimeString()}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      <div className="toast-stack">
        {toasts.map((t) => (
          <div className={`toast sev-${t.sev}`} key={t.id}>
            <span className="toast-ic">{KIND_ICON[t.kind] || KIND_ICON.info}</span>
            <div className="toast-body">
              <div className="toast-title">{t.title}</div>
              <div className="toast-detail">{t.detail}</div>
            </div>
            <button className="toast-x" onClick={() => setToasts((ts) => ts.filter((x) => x.id !== t.id))}>{'\u00d7'}</button>
          </div>
        ))}
      </div>
    </div>
  );
}
