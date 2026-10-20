import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { DEMO_ACCOUNTS, SHOW_DEMO_LOGINS } from '../lib/demo.js';
import '../styles/login-demo.css';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default function Login({ onLogin }) {
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [server, setServer] = useState('checking');
  const alive = useRef(true);

  // Render's free tier sleeps when idle: ping /health until the backend answers.
  useEffect(() => {
    alive.current = true;
    let tries = 0;
    (async () => {
      while (alive.current) {
        try { await api.health(); if (alive.current) setServer('up'); return; }
        catch { tries += 1; if (alive.current) setServer(tries > 24 ? 'down' : 'wait'); await sleep(tries < 5 ? 2500 : 5000); }
      }
    })();
    return () => { alive.current = false; };
  }, []);

  // retry only on network errors (server waking up); wrong passwords are not retried
  const attempt = useCallback(async (id, pw, who) => {
    setErr(''); setBusy(who);
    try {
      for (let i = 0; i < 14; i += 1) {
        try { await onLogin(id, pw); return; }
        catch (e) {
          if (e?.status) throw e;
          await sleep(5000);
        }
      }
      setErr('Could not reach the GCS backend. Please check your connection and try again.');
    } catch (e) {
      setErr(e.message || 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  }, [onLogin]);

  const submit = (e) => { e.preventDefault(); attempt(loginId, password, 'form'); };
  const quick = (acc) => { setLoginId(acc.loginId); setPassword(acc.password); attempt(acc.loginId, acc.password, acc.key); };

  const statusText = server === 'up' ? 'Server online' : 'Connecting to server\u2026';

  return (
    <div className="login-screen">
      <div className="login-aurora" aria-hidden="true" />
      <div className="login-shell">
        <div className="login-brandpane">
          <div className="login-emblem">
            <svg viewBox="0 0 64 64" width="52" height="52" aria-hidden="true">
              <circle cx="32" cy="32" r="26" fill="none" stroke="currentColor" strokeWidth="2.4" />
              <circle cx="32" cy="32" r="4" fill="currentColor" />
              {Array.from({ length: 12 }).map((_, i) => {
                const a = (i * Math.PI * 2) / 12;
                return <line key={i} x1={32 + 8 * Math.cos(a)} y1={32 + 8 * Math.sin(a)} x2={32 + 24 * Math.cos(a)} y2={32 + 24 * Math.sin(a)} stroke="currentColor" strokeWidth="1.3" opacity=".55" />;
              })}
            </svg>
          </div>
          <div className="login-org tiny mono">GOVERNMENT OF INDIA &middot; MINISTRY OF DEFENCE</div>
          <h1>Defence Research &amp; Development Organisation</h1>
          <div className="login-tagline">Unified Autonomous Systems Digital Twin &amp; Fleet Command Console</div>
          <ul className="login-points">
            <li>Live synchronised digital twin per airframe, down to component level</li>
            <li>Real-time fleet-wide health, readiness &amp; predictive maintenance</li>
            <li>Instant alerting on take-off, landing, envelope and malfunction events</li>
            <li>Role-based access &mdash; accounts are issued by the DRDO system administrator</li>
          </ul>
          <div className="login-classified tiny mono">CLASSIFICATION: RESTRICTED &middot; FOR AUTHORISED PERSONNEL ONLY</div>
        </div>

        <div className="login-formpane">
          <div className={`jury-status ${server === 'up' ? 'up' : ''}`}><span className="dot" />{statusText}</div>

          {SHOW_DEMO_LOGINS && (
            <div className="jury-panel">
              <div className="jury-head"><h3>JURY / EVALUATOR ACCESS</h3></div>
              <div className="jury-sub">No setup needed &mdash; pick a role and click to sign in instantly. Try both to see how access differs.</div>
              <div className="jury-cards">
                {DEMO_ACCOUNTS.map((a) => (
                  <button key={a.key} type="button" className={`jury-card ${a.key}`} disabled={!!busy} onClick={() => quick(a)}>
                    <span className="role">{a.role}</span>
                    <span className="ttl">{a.title}</span>
                    <span className="desc">{a.blurb}</span>
                    <span className="jury-cred"><b>ID&nbsp;&nbsp;</b>{a.loginId}<br /><b>PW&nbsp;&nbsp;</b>{a.password}</span>
                    <span className="jury-go">{busy === a.key ? 'Signing in\u2026' : `Sign in as ${a.key === 'admin' ? 'Admin' : 'Operator'} \u2192`}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {SHOW_DEMO_LOGINS && <div className="login-divider">OR SIGN IN MANUALLY</div>}

          <form className="login-form" onSubmit={submit}>
            <label>
              <span>Login ID</span>
              <input value={loginId} onChange={(e) => setLoginId(e.target.value)} placeholder="Operator / service login ID" required autoComplete="username" />
            </label>
            <label>
              <span>Password</span>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter your password" required autoComplete="current-password" />
            </label>

            {err && <div className="login-err">{err}</div>}

            <button className="login-submit" type="submit" disabled={!!busy}>
              {busy === 'form' ? 'Authenticating\u2026' : 'Sign in to Fleet Command'}
            </button>
            <div className="login-hint tiny muted">No account? Ask your DRDO administrator to issue an operator login for your drone(s).</div>
          </form>
        </div>
      </div>
    </div>
  );
}
