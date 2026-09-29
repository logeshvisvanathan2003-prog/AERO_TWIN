import { useState } from 'react';

export default function ChangePassword({ operator, onChange, onLogout }) {
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    if (next !== again) { setErr('New passwords do not match.'); return; }
    setBusy(true);
    try { await onChange(cur, next); }
    catch (e2) { setErr(e2?.message || 'Could not change password.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="login-screen">
      <div className="login-shell" style={{ gridTemplateColumns: '1fr', maxWidth: 480 }}>
        <div className="login-formpane">
          <div className="login-org tiny mono" style={{ marginBottom: 6 }}>FIRST SIGN-IN &middot; {operator.login_id}</div>
          <h1 style={{ fontFamily: 'var(--disp)', fontSize: 20, margin: '0 0 6px' }}>Set a new password</h1>
          <p className="muted tiny" style={{ marginBottom: 16 }}>
            Your account was issued with a temporary password. Choose a personal one (8+ characters, letters and digits) to continue.
          </p>
          <form className="login-form" onSubmit={submit}>
            <label><span>Temporary / current password</span>
              <input type="password" value={cur} onChange={(e) => setCur(e.target.value)} required autoFocus autoComplete="current-password" /></label>
            <label><span>New password</span>
              <input type="password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={8} autoComplete="new-password" /></label>
            <label><span>Repeat new password</span>
              <input type="password" value={again} onChange={(e) => setAgain(e.target.value)} required minLength={8} autoComplete="new-password" /></label>
            {err && <div className="login-err">{err}</div>}
            <button className="login-submit" type="submit" disabled={busy}>{busy ? 'Saving\u2026' : 'Save password & continue'}</button>
            <button type="button" className="link-btn" onClick={onLogout} style={{ alignSelf: 'center' }}>Sign out</button>
          </form>
        </div>
      </div>
    </div>
  );
}
