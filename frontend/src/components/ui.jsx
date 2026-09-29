import { useEffect, useState } from 'react';

export function Modal({ title, onClose, children, wide, busy }) {
  useEffect(() => {
    const on = (e) => { if (e.key === 'Escape' && !busy) onClose?.(); };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [onClose, busy]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose?.(); }}>
      <div className={`modal-card modal-lg fade-in ${wide ? 'wide' : ''}`}>
        <div className="modal-head"><h2>{title}</h2><button className="toast-x" onClick={onClose} disabled={busy} aria-label="Close">{'\u00d7'}</button></div>
        {children}
      </div>
    </div>
  );
}

export function Toast({ toast, onDone }) {
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(onDone, 4500);
    return () => clearTimeout(t);
  }, [toast, onDone]);
  if (!toast) return null;
  return <div className={`fleet-toast ${toast.ok ? 'ok' : 'crit'}`}>{toast.text}</div>;
}

export function CopyBox({ label, value }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* ignore */ }
  };
  return (
    <div className="copybox">
      <div className="mini-k">{label}</div>
      <div className="copybox-row"><code className="mono">{value}</code><button className="btn" onClick={copy}>{done ? 'Copied' : 'Copy'}</button></div>
    </div>
  );
}

export function timeAgo(iso) {
  if (!iso) return 'never';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}
