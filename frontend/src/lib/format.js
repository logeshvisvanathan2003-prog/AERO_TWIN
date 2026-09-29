export const fmt = (v, d = 1) => (v == null || Number.isNaN(v) ? '\u2014' : Number(v).toFixed(d));

export const hhmmss = (s) => [Math.floor(s / 3600), Math.floor(s / 60) % 60, Math.floor(s % 60)]
  .map((v) => String(v).padStart(2, '0')).join(':');

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
