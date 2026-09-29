// Single source of truth for navigation + which role may open which page.
// The backend enforces the same rules on every API call — this only hides what a role cannot use.
export const NAV = [
  { section: 'Monitor', items: [
    ['overview', '\u25c8', 'Overview', ['admin', 'operator']],
    ['health', '\u2764', 'Health', ['admin', 'operator']],
    ['diagnostics', '\u26a0', 'Diagnostics', ['admin', 'operator']],
    ['predictive', '\u25f7', 'Predictive', ['admin', 'operator']],
    ['simulation', '\u27f2', 'Simulation', ['admin', 'operator']],
    ['replay', '\u23ee', 'Replay', ['admin', 'operator']],
  ] },
  { section: 'Fleet', items: [
    ['fleet', '\u2708', 'Fleet', ['admin', 'operator']],
    ['alerts', '\uD83D\uDD14', 'My Alerts', ['operator']],
    ['reports', '\u25a4', 'Reports', ['admin', 'operator']],
  ] },
  { section: 'Administration', items: [
    ['admin', '\u2699', 'Admin Console', ['admin']],
    ['operators', '\u263A', 'Operators', ['admin']],
    ['drones', '\u2726', 'Drones', ['admin']],
    ['notifications', '\u2709', 'Notifications', ['admin']],
  ] },
  { section: 'System', items: [
    ['architecture', '\u2318', 'Architecture', ['admin', 'operator']],
  ] },
];

export const ALL_VIEWS = NAV.flatMap((s) => s.items.map((i) => i[0]));
export const canOpen = (view, role) => NAV.some((s) => s.items.some((i) => i[0] === view && i[3].includes(role)));
export const defaultView = (role) => (role === 'admin' ? 'admin' : 'overview');
