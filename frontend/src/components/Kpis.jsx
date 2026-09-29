export default function Kpis({ items }) {
  return (
    <div className="kpis">
      {items.map((it) => (
        <div className={`kpi ${it.sev || ''}`} key={it.k}>
          <div className="k">{it.k}</div>
          <div className="v">{it.v}<span className="u">{it.u}</span></div>
          {it.d && <div className="d">{it.d}</div>}
        </div>
      ))}
    </div>
  );
}
