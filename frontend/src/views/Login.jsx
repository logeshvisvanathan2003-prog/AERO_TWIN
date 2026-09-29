import { useState } from 'react';

export default function Login({ onLogin }) {
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      await onLogin(loginId, password);
    } catch (e2) {
      setErr(e2?.status ? e2.message : 'Could not reach the GCS backend. It may be waking up \u2014 wait ~30 s and try again.');
    } finally {
      setBusy(false);
    }
  };

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
                const x1 = 32 + 8 * Math.cos(a), y1 = 32 + 8 * Math.sin(a);
                const x2 = 32 + 24 * Math.cos(a), y2 = 32 + 24 * Math.sin(a);
                return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="currentColor" strokeWidth="1.3" opacity=".55" />;
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
            <li>Accounts are issued by the DRDO system administrator &mdash; no self-registration</li>
          </ul>
          <div className="login-classified tiny mono">CLASSIFICATION: RESTRICTED &middot; FOR AUTHORISED PERSONNEL ONLY</div>
        </div>

        <div className="login-formpane">
          <div className="login-tabs">
            <button type="button" className="active">Secure sign-in</button>
          </div>

          <form className="login-form" onSubmit={submit}>
            <label>
              <span>Login ID</span>
              <input value={loginId} onChange={(e) => setLoginId(e.target.value)} placeholder="Operator / service login ID" required autoFocus autoComplete="username" />
            </label>
            <label>
              <span>Password</span>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter your password" required autoComplete="current-password" />
            </label>

            {err && <div className="login-err">{err}</div>}

            <button className="login-submit" type="submit" disabled={busy}>
              {busy ? 'Authenticating\u2026' : 'Sign in to Fleet Command'}
            </button>
            <div className="login-hint tiny muted">
              No account? Ask your DRDO administrator to issue an operator login for your drone(s).
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
