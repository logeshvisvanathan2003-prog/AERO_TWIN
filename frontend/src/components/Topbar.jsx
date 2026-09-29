import { useEffect, useState } from 'react';
import { hhmmss, fmt } from '../lib/format.js';
import NotificationCenter from './NotificationCenter.jsx';

const SPEEDS = [1, 5, 20, 60, 240];

function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem('aerotwin-theme') || 'dark');
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('aerotwin-theme', theme);
  }, [theme]);
  return [theme, setTheme];
}

export default function Topbar({ frame, linkState, drones, tail, onTail, onMenu, operator, onLogout,
  onCommand, inbox, onOpenInbox }) {
  const isAdmin = operator?.role === 'admin';
  const readiness = frame?.readiness || { state: '\u2014', color: 'ok' };
  const [theme, setTheme] = useTheme();
  const cfg = frame?.sim_config;
  const running = cfg?.running ?? true;
  const canControl = isAdmin && frame && frame.source === 'simulated';
  const current = drones.find((d) => d.tail_number === tail);
  const unread = inbox?.summary?.unread || 0;

  return (
    <header className="topbar">
      <div className="brand">
        <button className="mobile-menu-btn btn" onClick={onMenu} aria-label="Menu">{'\u2630'}</button>
        <svg className="logo" viewBox="0 0 40 40" aria-label="DRDO UAS Digital Twin">
          <circle cx="20" cy="20" r="15" fill="none" stroke="currentColor" strokeWidth="2.2" />
          <circle cx="20" cy="20" r="4.4" fill="currentColor" />
          <path d="M20 5v10M20 25v10M5 20h10M25 20h10" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          <path d="M31 9 25 15M9 31l6-6" stroke="currentColor" strokeWidth="1.4" opacity=".55" />
        </svg>
        <div>
          <div className="brand-name">DRDO<span>-UAS</span></div>
          <div className="brand-sub">Digital Twin &amp; Fleet Command &middot; MALE UAV</div>
        </div>
      </div>

      <div className="topstats">
        <div className="tstat"><span className="k">DRONE</span>
          {drones.length > 0 ? (
            <select className="sel drone-select" value={tail || ''} onChange={(e) => onTail(e.target.value)} title="Select drone">
              {drones.map((d) => <option key={d.id} value={d.tail_number}>{d.tail_number}{d.name ? ` \u00b7 ${d.name}` : ''}</option>)}
            </select>
          ) : <span className="v mono">{'\u2014'}</span>}
        </div>
        <div className="tstat"><span className="k">PHASE</span><span className="v mono">{frame?.phase || '\u2014'}</span></div>
        <div className="tstat"><span className="k">MISSION T</span><span className="v mono">{hhmmss(frame?.mission_t || 0)}</span></div>
        <div className="tstat"><span className="k">ENG HOURS</span><span className="v mono">{fmt(current?.engine_hours ?? 0, 1)}</span></div>
        <div className="tstat"><span className="k">LINK</span><span className="v mono">
          {linkState === 'live' && <span className="live-dot" />}
          {linkState === 'live' ? (frame?.source === 'live_can' ? 'CAN LIVE' : 'TWIN LIVE') : String(linkState).toUpperCase()}
        </span></div>
      </div>

      <div className="topright">
        {isAdmin ? (
          <div className="notif-wrap">
            <button className="notif-bell" onClick={onOpenInbox} title="Admin notifications">
              <span>{'\uD83D\uDD14'}</span>
              {unread > 0 && <span className="notif-count">{unread > 99 ? '99+' : unread}</span>}
            </button>
            <div className="toast-stack">
              {(inbox?.toasts || []).map((t) => (
                <div className={`toast sev-${t.severity === 'info' ? 'ok' : t.severity}`} key={t.id}>
                  <span className="toast-ic">{'\uD83D\uDD14'}</span>
                  <div className="toast-body">
                    <div className="toast-title">{t.title}</div>
                    <div className="toast-detail">{t.category} {t.detail ? `\u00b7 ${t.detail.slice(0, 90)}` : ''}</div>
                  </div>
                  <button className="toast-x" onClick={() => inbox.dismiss(t.id)}>{'\u00d7'}</button>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <NotificationCenter frame={frame} tailLabel={tail || ''} />
        )}
        <button className="theme-toggle" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} title="Toggle theme">
          <span className="sun-moon">{theme === 'light' ? '\u2600' : '\u263e'}</span>
          {theme === 'light' ? 'Light' : 'Dark'}
        </button>
        <div className={`badge ${readiness.color}`}>{readiness.state}</div>
        {canControl && (
          <>
            <button className={`btn ${!running ? 'danger' : ''}`} onClick={() => onCommand({ cmd: running ? 'pause' : 'resume' })}>{running ? 'Pause' : 'Resume'}</button>
            <select className="sel" title="Simulation time acceleration (admin)" value={cfg?.speed ?? 20}
              onChange={(e) => onCommand({ cmd: 'speed', speed: +e.target.value })}>
              {SPEEDS.map((s) => <option key={s} value={s}>{s}{'\u00d7'}</option>)}
            </select>
          </>
        )}
        {operator && (
          <div className="operator-chip">
            <span className={`operator-role ${operator.role}`}>{operator.role === 'admin' ? 'ADMIN' : 'OPR'}</span>
            <span className="operator-name mono tiny">{operator.login_id}</span>
            <button className="btn" onClick={onLogout} title="Sign out">Sign out</button>
          </div>
        )}
      </div>
    </header>
  );
}
