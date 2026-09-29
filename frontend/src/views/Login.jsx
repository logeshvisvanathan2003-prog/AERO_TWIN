import { useEffect, useState } from 'react';
import '../styles/auth.css';

/* Four separate pages, chosen by the URL hash:
     #/operator-login   #/operator-register
     #/admin-login      #/admin-register                                   */
const ROUTE_RE = /^(operator|admin)-(login|register)$/;
const parseRoute = () => {
  const m = location.hash.replace(/^#\/?/, '').match(ROUTE_RE);
  return m ? { role: m[1], tab: m[2] } : { role: 'operator', tab: 'login' };
};

const COPY = {
  operator: {
    title: 'Operator Console',
    points: [
      'Live synchronised digital twin for the drones assigned to you',
      'Real-time health, alerts and predictive-maintenance insight',
      'Acknowledge your alerts and generate mission reports',
      'New operators see drones only after an administrator assigns them',
    ],
  },
  admin: {
    title: 'Administrator Console',
    points: [
      'Full control of operators, drones and fleet-wide orders',
      'Assign drones to operators and review the security audit trail',
      'Twin commands, maintenance scheduling and all fleet data',
      'Administrator registration requires the secret admin registration key',
    ],
  },
};

const pwProblem = (pw) => {
  if ((pw || '').length < 8) return 'Password must be at least 8 characters.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Password must contain both letters and digits.';
  return '';
};

const errText = (e) => (e?.status
  ? e.message
  : 'Could not reach the GCS backend. It may be waking up \u2014 wait ~30 s and try again.');

export default function Login({ onLogin, onRegister }) {
  const [route, setRoute] = useState(parseRoute);
  useEffect(() => {
    const on = () => setRoute(parseRoute());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  const { role, tab } = route;
  const isAdmin = role === 'admin';
  const go = (r, t) => { location.hash = `/${r}-${t}`; };
  const copy = COPY[role];

  return (
    <div className="login-screen">
      <div className="login-aurora" aria-hidden="true" />
      <div className="login-shell">
        <div className="login-brandpane">
          <div className="login-emblem" style={isAdmin ? { color: 'var(--warn)' } : undefined}>
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
          <div className="login-tagline">Unified Autonomous Systems Digital Twin &amp; Fleet Command &mdash; {copy.title}</div>
          <ul className="login-points">
            {copy.points.map((p) => <li key={p}>{p}</li>)}
          </ul>
          <div className="login-classified tiny mono">CLASSIFICATION: RESTRICTED &middot; FOR AUTHORISED PERSONNEL ONLY</div>
        </div>

        <div className="login-formpane">
          {/* 1) which portal? */}
          <div className="auth-portal-label mono">SELECT PORTAL</div>
          <div className="login-role-cards auth-portals">
            <button type="button" className={`login-role-card${!isAdmin ? ' sel' : ''}`} onClick={() => go('operator', tab)}>
              <span className="rc-title">Operator</span>
              <span className="rc-desc">View assigned drones, alerts &amp; reports</span>
            </button>
            <button type="button" className={`login-role-card admin${isAdmin ? ' sel' : ''}`} onClick={() => go('admin', tab)}>
              <span className="rc-title">Administrator</span>
              <span className="rc-desc">Manage operators, drones &amp; fleet</span>
            </button>
          </div>

          {/* 2) sign in or register */}
          <div className="login-tabs">
            <button type="button" className={tab === 'login' ? 'active' : ''} onClick={() => go(role, 'login')}>Sign in</button>
            <button type="button" className={tab === 'register' ? 'active' : ''} onClick={() => go(role, 'register')}>Register</button>
          </div>

          {tab === 'login'
            ? <LoginForm key={`l-${role}`} role={role} onLogin={onLogin} onSwitch={() => go(role, 'register')} />
            : <RegisterForm key={`r-${role}`} role={role} onRegister={onRegister} onSwitch={() => go(role, 'login')} />}
        </div>
      </div>
    </div>
  );
}

function LoginForm({ role, onLogin, onSwitch }) {
  const isAdmin = role === 'admin';
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    try { await onLogin(loginId, password, role); }
    catch (e2) { setErr(errText(e2)); }
    finally { setBusy(false); }
  };

  return (
    <form className="login-form" onSubmit={submit}>
      <label>
        <span>{isAdmin ? 'Administrator login ID' : 'Operator login ID'}</span>
        <input value={loginId} onChange={(e) => setLoginId(e.target.value)} placeholder={isAdmin ? 'e.g. ADMIN' : 'e.g. OPR-01'} required autoFocus autoComplete="username" />
      </label>
      <label>
        <span>Password</span>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter your password" required autoComplete="current-password" />
      </label>
      {err && <div className="login-err">{err}</div>}
      <button className={`login-submit${isAdmin ? ' admin' : ''}`} type="submit" disabled={busy}>
        {busy ? 'Authenticating\u2026' : isAdmin ? 'Sign in as Administrator' : 'Sign in as Operator'}
      </button>
      <div className={`auth-switch${isAdmin ? ' admin' : ''}`}>
        {isAdmin ? 'Need an administrator account? ' : 'New operator? '}
        <button type="button" onClick={onSwitch}>Register here</button>
      </div>
    </form>
  );
}

function RegisterForm({ role, onRegister, onSwitch }) {
  const isAdmin = role === 'admin';
  const [f, setF] = useState({ full_name: '', login_id: '', designation: '', squadron: '', email: '', phone: '', password: '', confirm: '', registration_key: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    const pw = pwProblem(f.password);
    if (pw) return setErr(pw);
    if (f.password !== f.confirm) return setErr('Passwords do not match.');
    setBusy(true);
    try {
      const { confirm, registration_key, ...rest } = f;
      await onRegister(role, isAdmin ? { ...rest, registration_key } : rest);
    } catch (e2) { setErr(errText(e2)); }
    finally { setBusy(false); }
  };

  return (
    <form className="login-form" onSubmit={submit}>
      <div className="auth-scroll">
        <div className="auth-grid">
          {isAdmin && (
            <label className="full">
              <span>Administrator registration key *</span>
              <input type="password" value={f.registration_key} onChange={set('registration_key')} placeholder="Secret key from the system owner" required autoComplete="off" />
            </label>
          )}
          <label className="full"><span>Full name *</span>
            <input value={f.full_name} onChange={set('full_name')} placeholder="Your full name" required maxLength={120} autoFocus /></label>
          <label><span>Login ID *</span>
            <input value={f.login_id} onChange={set('login_id')} placeholder={isAdmin ? 'e.g. ADM-02' : 'e.g. OPR-07'} required maxLength={48} autoComplete="username" /></label>
          <label><span>Designation</span>
            <input value={f.designation} onChange={set('designation')} placeholder={isAdmin ? 'Administrator' : 'UAV Operator'} maxLength={80} /></label>
          <label><span>Squadron</span>
            <input value={f.squadron} onChange={set('squadron')} placeholder={isAdmin ? 'DRDO HQ' : '1 UAV Squadron'} maxLength={64} /></label>
          <label><span>Phone</span>
            <input value={f.phone} onChange={set('phone')} placeholder="Optional" maxLength={32} autoComplete="tel" /></label>
          <label className="full"><span>Email</span>
            <input type="email" value={f.email} onChange={set('email')} placeholder="Optional" maxLength={160} autoComplete="email" /></label>
          <label><span>Password *</span>
            <input type="password" value={f.password} onChange={set('password')} placeholder="8+ chars, letters & digits" required autoComplete="new-password" /></label>
          <label><span>Confirm password *</span>
            <input type="password" value={f.confirm} onChange={set('confirm')} placeholder="Repeat password" required autoComplete="new-password" /></label>
        </div>
      </div>

      {!isAdmin && <div className="auth-note">After registering you can sign in straight away, but you will see no drones until an administrator assigns some to your account.</div>}
      {isAdmin && <div className="auth-note warn">Every administrator registration is logged in the security audit trail.</div>}
      {err && <div className="login-err">{err}</div>}

      <button className={`login-submit${isAdmin ? ' admin' : ''}`} type="submit" disabled={busy}>
        {busy ? 'Creating account\u2026' : isAdmin ? 'Register as Administrator' : 'Register as Operator'}
      </button>
      <div className={`auth-switch${isAdmin ? ' admin' : ''}`}>
        Already registered? <button type="button" onClick={onSwitch}>Sign in</button>
      </div>
    </form>
  );
}