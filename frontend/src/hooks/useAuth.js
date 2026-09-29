import { useCallback, useEffect, useState } from 'react';
import { api, setUnauthorizedHandler } from '../lib/api.js';

const KEY = 'drdo-operator';

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function useAuth() {
  const [operator, setOperator] = useState(load);

  const persist = useCallback((op) => {
    setOperator(op);
    if (op) localStorage.setItem(KEY, JSON.stringify(op));
    else localStorage.removeItem(KEY);
  }, []);

  // any 401 from the API (expired / revoked / disabled account) signs the user out
  useEffect(() => { setUnauthorizedHandler(() => persist(null)); }, [persist]);

  // validate the cached session on load and keep the profile (role, drone list) fresh
  useEffect(() => {
    if (!operator) return undefined;
    const refresh = () => api.me().then((r) => {
      setOperator((cur) => {
        if (!cur) return cur;
        const next = { ...cur, ...r.operator, token: cur.token };
        localStorage.setItem(KEY, JSON.stringify(next));
        return next;
      });
    }).catch(() => {});
    refresh();
    const iv = setInterval(refresh, 60000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operator?.token]);

  const login = useCallback(async (login_id, password) => {
    const r = await api.login({ login_id, password });
    persist(r.operator);
    return r.operator;
  }, [persist]);

  const changePassword = useCallback(async (current_password, new_password) => {
    const r = await api.changePassword({ current_password, new_password });
    persist(r.operator);
    return r.operator;
  }, [persist]);

  const logout = useCallback(() => {
    api.logout().catch(() => {});
    persist(null);
    location.hash = '';
  }, [persist]);

  return { operator, login, changePassword, logout };
}
