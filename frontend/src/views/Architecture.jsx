const ARCH = [
  ['Air vehicle / edge', ['ECU / FADEC + engine harness', 'CAN 2.0B @ 500 kbit/s \u2192 SocketCAN', 'ARM edge node (Jetson / i.MX8)', 'ONNX INT8 anomaly + RUL inference', 'Store-and-forward buffer (loss of link)']],
  ['Twin core', ['Physics plant model (thermo + slider-crank)', 'Shadow twin synchronised to live inputs', 'Residual generator (measured \u2212 twin)', 'State estimator & health indexer', 'Degradation & RUL propagator']],
  ['GCS / server', ['FastAPI backend (this build)', 'PostgreSQL telemetry + alert store', 'WebSocket live stream to dashboard', 'Auto work-order generation', 'Mission replay archive']],
  ['Operator layer', ['React + Tailwind HMI dashboard (this app)', '3D interactive engine twin (Three.js)', 'Fault alerts & advisory workflow', 'Mission-wise health reports', 'Maintenance work-order export']],
];

export default function Architecture({ modelMetrics }) {
  const m = modelMetrics || {};
  const perf = {
    'Auto-encoder detection rate': m.ae_detection != null ? `${(m.ae_detection * 100).toFixed(1)} %` : '\u2014',
    'False-alarm rate (healthy)': m.ae_false_alarm != null ? `${(m.ae_false_alarm * 100).toFixed(2)} %` : '\u2014',
    'Fault classifier accuracy': m.clf_accuracy != null ? `${(m.clf_accuracy * 100).toFixed(1)} %` : '\u2014',
    'Fault classifier macro-recall': m.clf_balanced_acc != null ? `${(m.clf_balanced_acc * 100).toFixed(1)} %` : '\u2014',
    'RUL MAE (full horizon)': m.rul_mae_h != null ? `${m.rul_mae_h.toFixed(1)} h` : '\u2014',
    'RUL MAE (<200 h to failure)': m.rul_mae_near_h != null ? `${m.rul_mae_near_h.toFixed(1)} h` : '\u2014',
    'Inference latency (server)': '< 1 ms / frame (NumPy)',
    'Model bundle size': '~85 kB JSON',
  };
  const stack = {
    'Plant model': 'Physics-informed thermodynamic + kinematic (Python)',
    'Backend': 'FastAPI + WebSocket + SQLAlchemy',
    Database: 'PostgreSQL',
    'ML training': 'TensorFlow/Keras (Colab notebook, included)',
    'ML serving': 'Pure NumPy dense-layer runtime (ONNX-shaped)',
    'Frontend': 'React 18 + Vite + Tailwind CSS',
    '3D twin': 'Three.js, procedural engine geometry, real crank-slider kinematics',
    Charts: 'Chart.js 4 via react-chartjs-2',
  };
  return (
    <div className="fade-in">
      <div className="card">
        <div className="card-head"><h2>Digital twin reference architecture</h2><span className="mono tiny">edge &rarr; backend &rarr; dashboard</span></div>
        <div className="arch">
          {ARCH.map(([h, items]) => (
            <div className="arch-col" key={h}>
              <h3>{h}</h3>
              <ul>{items.map((i) => <li key={i}>{i}</li>)}</ul>
            </div>
          ))}
        </div>
      </div>
      <div className="grid-2">
        <div className="card">
          <div className="card-head"><h2>Model performance</h2></div>
          <div className="kv">{Object.entries(perf).map(([k, v]) => <div className="kv-row" key={k}><span>{k}</span><span>{v}</span></div>)}</div>
        </div>
        <div className="card">
          <div className="card-head"><h2>Deployment stack</h2></div>
          <div className="kv">{Object.entries(stack).map(([k, v]) => <div className="kv-row" key={k}><span>{k}</span><span>{v}</span></div>)}</div>
        </div>
      </div>
    </div>
  );
}
