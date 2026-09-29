import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';

/** Polls the admin notification inbox: unread counter for the bell + toast popups for new events. */
export function useAdminInbox(enabled, selfLoginId) {
  const [summary, setSummary] = useState({ unread: 0, latest_id: 0, by_severity: {}, by_category: {} });
  const [toasts, setToasts] = useState([]);
  const lastId = useRef(null);
  const alive = useRef(true);

  const dismiss = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const refresh = useCallback(async () => {
    try {
      const s = await api.notifSummary();
      if (!alive.current) return;
      setSummary(s);
      if (lastId.current === null) { lastId.current = s.latest_id; return; }
      if (s.latest_id > lastId.current) {
        const rows = await api.notifications({ limit: 10 });
        const fresh = rows.filter((r) => r.id > lastId.current && r.actor !== selfLoginId).reverse().slice(-4);
        lastId.current = s.latest_id;
        fresh.forEach((n) => {
          setToasts((t) => [...t, n].slice(-4));
          setTimeout(() => dismiss(n.id), 5000);
        });
      }
    } catch { /* transient — next tick retries */ }
  }, [selfLoginId, dismiss]);

  useEffect(() => {
    if (!enabled) return undefined;
    alive.current = true;
    refresh();
    const iv = setInterval(refresh, 6000);
    return () => { alive.current = false; clearInterval(iv); };
  }, [enabled, refresh]);

  return { summary, toasts, dismiss, refresh };
}
