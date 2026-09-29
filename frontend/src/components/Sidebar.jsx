import { NAV } from '../lib/nav.js';

export default function Sidebar({ view, onChange, modelMeta, open, onClose, operator, badges = {} }) {
  const role = operator?.role || 'operator';
  return (
    <>
      {open && <div className="sidebar-drawer-backdrop" onClick={onClose} style={{ display: 'block', position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 20 }} />}
      <nav className="sidebar">
        {NAV.map((sec) => {
          const items = sec.items.filter((i) => i[3].includes(role));
          if (!items.length) return null;
          return (
            <div className="nav-section" key={sec.section}>
              <div className="nav-section-label">{sec.section}</div>
              {items.map(([id, ic, label]) => (
                <button key={id} className={`nav ${view === id ? 'active' : ''}`} onClick={() => { onChange(id); onClose?.(); }}>
                  <span className="ic">{ic}</span><span>{label}</span>
                  {badges[id] > 0 && <span className="nav-badge">{badges[id] > 99 ? '99+' : badges[id]}</span>}
                </button>
              ))}
            </div>
          );
        })}
        <div className="side-foot">
          {operator && (
            <div className="side-operator">
              <div className="mini-k">SIGNED IN AS</div>
              <div className="mono tiny">{operator.full_name || operator.login_id}</div>
              <div className="tiny muted">{operator.role === 'admin' ? 'DRDO Administrator' : `Operator \u00b7 ${operator.squadron || ''}`}</div>
            </div>
          )}
          <div className="mini-k" style={{ marginTop: 10 }}>MODEL BUNDLE</div>
          <div className="mono tiny">{modelMeta || 'loading\u2026'}</div>
        </div>
      </nav>
    </>
  );
}
