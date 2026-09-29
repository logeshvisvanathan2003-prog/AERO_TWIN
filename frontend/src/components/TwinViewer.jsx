import { useEffect, useRef, useState } from 'react';
import { EngineTwin3D } from '../three/EngineTwin3D.js';

/**
 * Mounts the exact original Three.js engine twin inside a React-managed div.
 * Kept as an imperative class (rather than rewritten declaratively in R3F)
 * on purpose: it is the single physically-simulated source of the 3D
 * kinematics (real crank-slider motion, thermal shading, exhaust particle
 * flow) and a 1:1 port preserves that exactly, frame for frame.
 */
export default function TwinViewer({ frame, faultParts, onSelect, selected, running = true }) {
  const containerRef = useRef(null);
  const overlayRef = useRef(null);
  const twinRef = useRef(null);
  const [mode, setMode] = useState({ cutaway: false, exploded: false, thermal: false, labels: true });

  useEffect(() => {
    if (!containerRef.current || !overlayRef.current) return;
    const twin = new EngineTwin3D(containerRef.current, overlayRef.current, (id, label) => {
      onSelect?.(id, label);
    });
    twinRef.current = twin;
    return () => twin.dispose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { twinRef.current?.update(frame); }, [frame]);
  useEffect(() => { twinRef.current?.setRunning(running); }, [running]);
  useEffect(() => { twinRef.current?.setFaults(faultParts); }, [faultParts]);
  useEffect(() => { if (selected) twinRef.current?.focus(selected); }, [selected]);

  const toggleMode = (key) => {
    const next = key === 'labels' ? !mode.labels
      : { cutaway: false, exploded: false, thermal: false, [key]: !mode[key] };
    const merged = key === 'labels' ? { ...mode, labels: next } : { ...mode, ...next };
    setMode(merged);
    twinRef.current?.setMode(key, key === 'labels' ? merged.labels : merged[key]);
    if (key !== 'labels') {
      ['cutaway', 'exploded', 'thermal'].forEach((k) => {
        if (k !== key) twinRef.current?.setMode(k, false);
      });
    }
  };

  const resetView = () => {
    const t = twinRef.current;
    if (!t) return;
    t.camera.position.set(4.9, 2.7, 5.7);
    t.controls.target.set(0, 0.35, 0);
  };

  return (
    <div className="card twin-card">
      <div className="card-head">
        <h2>Synchronised virtual engine</h2>
        <div className="toolbar">
          <button className={`chip ${mode.cutaway ? 'active' : ''}`} onClick={() => toggleMode('cutaway')}>Cutaway</button>
          <button className={`chip ${mode.exploded ? 'active' : ''}`} onClick={() => toggleMode('exploded')}>Exploded</button>
          <button className={`chip ${mode.thermal ? 'active' : ''}`} onClick={() => toggleMode('thermal')}>Thermal</button>
          <button className={`chip ${mode.labels ? 'active' : ''}`} onClick={() => toggleMode('labels')}>Labels</button>
          <button className="chip" onClick={resetView}>Reset view</button>
        </div>
      </div>
      <div className="twin-wrap">
        <div ref={containerRef} id="twin3d" />
        <div ref={overlayRef} id="twin-overlay" />
        <div className="twin-legend mono tiny">
          drag orbit &middot; scroll / pinch zoom &middot; tap any component to inspect
        </div>
      </div>
    </div>
  );
}
