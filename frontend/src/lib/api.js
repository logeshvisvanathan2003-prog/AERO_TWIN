// In production (Vercel) set VITE_API_BASE to your Render URL, e.g. https://aerotwin-backend.onrender.com
export const API_BASE = (import.meta.env.VITE_API_BASE || `${location.protocol}//${location.hostname}:8000`).replace(/\/$/, '');
export const WS_BASE = API_BASE.replace(/^http/, 'ws');

const KEY = 'drdo-operator';

export class ApiError extends Error {
  constructor(message, status, data) { super(message); this.status = status; this.data = data; }
}

let onUnauthorized = null;
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

function authHeader() {
  try {
    const raw = localStorage.getItem(KEY);
    const tok = raw ? JSON.parse(raw)?.token : null;
    return tok ? { authorization: `Bearer ${tok}` } : {};
  } catch { return {}; }
}

async function j(path, opts = {}) {
  const { noAuthRedirect, ...init } = opts;
  const r = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...authHeader(), ...(init.headers || {}) },
  });
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await r.json().catch(() => ({})) : await r.text();
  if (!r.ok) {
    if (r.status === 401 && !noAuthRedirect) onUnauthorized?.();
    const msg = (data && (data.error || data.detail)) || `${path} -> ${r.status}`;
    throw new ApiError(typeof msg === 'string' ? msg : JSON.stringify(msg), r.status, data);
  }
  return data;
}

const q = (params) => {
  const s = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '' && v !== false) s.set(k, v === true ? '1' : v); });
  const str = s.toString();
  return str ? `?${str}` : '';
};
const body = (b) => JSON.stringify(b);

export const api = {
  health: () => j('/health', { noAuthRedirect: true }),

  // auth
  login: (b) => j('/api/auth/login', { method: 'POST', body: body(b), noAuthRedirect: true }),
  registerOperator: (b) => j('/api/auth/register/operator', { method: 'POST', body: body(b), noAuthRedirect: true }),
  registerAdmin: (b) => j('/api/auth/register/admin', { method: 'POST', body: body(b), noAuthRedirect: true }),
  logout: () => j('/api/auth/logout', { method: 'POST', noAuthRedirect: true }),
  me: () => j('/api/auth/me'),
  changePassword: (b) => j('/api/auth/change-password', { method: 'POST', body: body(b), noAuthRedirect: true }),
  wsTicket: () => j('/api/auth/ws-ticket', { method: 'POST' }),

  // twin (all scoped server-side to the caller's drones)
  state: (tail) => j(`/api/state${q({ tail })}`),
  history: (tail, n = 600) => j(`/api/history${q({ tail, n })}`),
  modelMeta: () => j('/api/model-meta'),
  command: (b, tail) => j(`/api/command${q({ tail })}`, { method: 'POST', body: body(b) }),
  missionSimulate: (b) => j('/api/mission/simulate', { method: 'POST', body: body(b) }),
  report: (tail) => j(`/api/report${q({ tail })}`),
  missions: (tail) => j(`/api/missions${q({ tail })}`),
  missionReport: (id) => j(`/api/missions/${id}/report`),

  // fleet / alerts / work orders
  fleet: () => j('/api/fleet'),
  fleetAction: (id, action, note) => j(`/api/fleet/${id}/action`, { method: 'POST', body: body({ action, note }) }),
  alerts: (limit = 60, engine_tail) => j(`/api/alerts${q({ limit, engine_tail })}`),
  engineAlerts: (tail, limit = 30) => j(`/api/alerts${q({ engine_tail: tail, limit })}`),
  ackAlert: (id) => j(`/api/alerts/${id}/ack`, { method: 'POST' }),
  workorders: (tail, limit = 50) => j(`/api/workorders${q({ tail, limit })}`),
  setWorkorder: (id, status) => j(`/api/workorders/${id}`, { method: 'PATCH', body: body({ status }) }),

  // admin
  adminOverview: () => j('/api/admin/overview'),
  operators: () => j('/api/admin/operators'),
  createOperator: (b) => j('/api/admin/operators', { method: 'POST', body: body(b) }),
  updateOperator: (id, b) => j(`/api/admin/operators/${id}`, { method: 'PATCH', body: body(b) }),
  resetPassword: (id) => j(`/api/admin/operators/${id}/reset-password`, { method: 'POST' }),
  unlockOperator: (id) => j(`/api/admin/operators/${id}/unlock`, { method: 'POST' }),
  deleteOperator: (id) => j(`/api/admin/operators/${id}`, { method: 'DELETE' }),
  drones: () => j('/api/admin/drones'),
  createDrone: (b) => j('/api/admin/drones', { method: 'POST', body: body(b) }),
  updateDrone: (id, b) => j(`/api/admin/drones/${id}`, { method: 'PATCH', body: body(b) }),
  deleteDrone: (id) => j(`/api/admin/drones/${id}`, { method: 'DELETE' }),

  // admin notification inbox
  notifications: (params = {}) => j(`/api/notifications${q(params)}`),
  notifSummary: () => j('/api/notifications/summary'),
  notifRead: (b) => j('/api/notifications/read', { method: 'POST', body: body(b) }),
  notifUnread: (ids) => j('/api/notifications/unread', { method: 'POST', body: body({ ids }) }),
  notifClearRead: () => j('/api/notifications/read', { method: 'DELETE' }),
};