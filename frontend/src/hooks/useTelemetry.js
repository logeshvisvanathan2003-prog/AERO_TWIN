import { useEffect, useRef, useState, useCallback } from 'react';
import { WS_BASE, api } from '../lib/api.js';

const HISTORY_MAX = 900;

/** Live telemetry for ONE drone. Re-subscribes whenever `tail` changes. */
export function useTelemetry(tail) {
  const [frame, setFrame] = useState(null);
  const [history, setHistory] = useState([]);
  const [linkState, setLinkState] = useState('connecting');
  const tailRef = useRef(tail);
  tailRef.current = tail;

  useEffect(() => {
    setFrame(null); setHistory([]);
    if (!tail) { setLinkState('no drone'); return undefined; }
    setLinkState('connecting');

    let cancelled = false;
    let ws = null;
    let retryTimer = null;
    let buf = [];
    let attempt = 0;

    const flush = () => {
      if (buf.length) { const b = buf; buf = []; setHistory((h) => [...h, ...b].slice(-HISTORY_MAX)); }
    };
    const flushTimer = setInterval(flush, 1000);

    async function connect() {
      if (cancelled) return;
      try {
        const { ticket } = await api.wsTicket();
        if (cancelled) return;
        ws = new WebSocket(`${WS_BASE}/ws/telemetry?tail=${encodeURIComponent(tail)}&ticket=${ticket}&backfill=1`);
      } catch {
        setLinkState('reconnecting');
        retryTimer = setTimeout(connect, Math.min(8000, 1500 * (++attempt)));
        return;
      }
      ws.onopen = () => { attempt = 0; setLinkState('live'); };
      ws.onmessage = (e) => {
        try {
          const f = JSON.parse(e.data);
          if (f.tail && f.tail !== tail) return;
          setFrame(f);
          buf.push(f);
          if (buf.length > 40) flush();
        } catch { /* ignore malformed frame */ }
      };
      ws.onclose = (e) => {
        if (cancelled) return;
        if (e.code === 4403) { setLinkState('access revoked'); return; }
        setLinkState('reconnecting');
        retryTimer = setTimeout(connect, Math.min(8000, 1500 * (++attempt)));
      };
      ws.onerror = () => ws.close();
    }
    connect();

    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
      clearInterval(flushTimer);
      if (ws) { ws.onclose = null; ws.close(); }
    };
  }, [tail]);

  const sendCommand = useCallback((b) => api.command(b, tailRef.current).catch(() => {}), []);

  return { frame, history, linkState, sendCommand };
}
