const env = import.meta.env;

export const SHOW_DEMO_LOGINS = env.VITE_SHOW_DEMO_LOGINS !== 'false';

export const DEMO_ACCOUNTS = [
  {
    key: 'admin',
    role: 'ADMINISTRATOR',
    title: 'Admin Console',
    blurb: 'Full control \u2014 all drones, create operator logins, fleet orders, twin commands and the notification inbox.',
    loginId: env.VITE_JURY_ADMIN_ID || 'JURY-ADMIN',
    password: env.VITE_JURY_ADMIN_PASSWORD || 'Jury@Admin2026',
  },
  {
    key: 'operator',
    role: 'OPERATOR',
    title: 'Operator View',
    blurb: 'Restricted \u2014 only the drones assigned to this login; read-only twin, can acknowledge alerts, no admin pages.',
    loginId: env.VITE_JURY_OPERATOR_ID || 'JURY-OPR',
    password: env.VITE_JURY_OPERATOR_PASSWORD || 'Jury@Opr2026',
  },
];
