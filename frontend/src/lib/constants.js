export const PART_SENSORS = {
  crankcase: ['rpm', 'vib', 'vib_1x', 'oil_p'],
  cyl0: ['cylCHT0', 'cylEGT0', 'misfire'], cyl1: ['cylCHT1', 'cylEGT1', 'misfire'],
  cyl2: ['cylCHT2', 'cylEGT2', 'misfire'], cyl3: ['cylCHT3', 'cylEGT3', 'misfire'],
  head: ['cht', 'coolant_t'], ignition: ['misfire', 'vib_half', 'bus_v'],
  injector: ['fuel_flow', 'inj_pw', 'inj_act'], fuelrail: ['fuel_flow', 'inj_pw', 'lam'],
  sump: ['oil_p', 'oil_t'], oilpump: ['oil_p', 'oil_t'],
  turbo: ['map_kpa', 'egt', 'alt_m'], intake: ['map_kpa', 'oat_c'],
  exhaust: ['egt', 'lam'], prop: ['rpm', 'power_kw'], gearbox: ['rpm', 'power_kw', 'vib'],
  alternator: ['bus_v', 'alt_i', 'soc'], ecu: ['inj_cmd', 'inj_act', 'bus_v'],
  radiator: ['coolant_t', 'cht', 'oat_c'],
};

export const PART_SUBSYS = {
  crankcase: 'rotating', prop: 'rotating', gearbox: 'rotating',
  cyl0: 'combustion', cyl1: 'combustion', cyl2: 'combustion', cyl3: 'combustion',
  head: 'cooling', radiator: 'cooling', ignition: 'combustion',
  injector: 'fuel', fuelrail: 'fuel', sump: 'lubrication', oilpump: 'lubrication',
  turbo: 'induction', intake: 'induction', exhaust: 'combustion',
  alternator: 'electrical', ecu: 'sensors',
};

export const UNITS = {
  rpm: 'rpm', cht: '\u00b0C', egt: '\u00b0C', oil_p: 'bar', oil_t: '\u00b0C', coolant_t: '\u00b0C',
  fuel_flow: 'kg/h', power_kw: 'kW', map_kpa: 'kPa', vib: 'g', vib_1x: 'g', vib_half: 'g',
  bus_v: 'V', alt_i: 'A', soc: '%', inj_cmd: '\u00b0 BTDC', inj_act: '\u00b0 BTDC', inj_pw: 'ms',
  misfire: '%', lam: '\u03bb', alt_m: 'm', oat_c: '\u00b0C', bsfc: 'g/kWh', throttle: '%',
};

export const SENSOR_LABEL = {
  rpm: 'Engine speed', cht: 'CHT', egt: 'EGT', oil_p: 'Oil pressure', oil_t: 'Oil temp',
  coolant_t: 'Coolant temp', fuel_flow: 'Fuel flow', power_kw: 'Shaft power',
  map_kpa: 'Manifold pressure', vib: 'Vibration RMS', vib_1x: 'Vibration 1x',
  vib_half: 'Vibration 0.5x', bus_v: 'Bus voltage', alt_i: 'Alternator current',
  soc: 'Battery charge', inj_cmd: 'Injection command', inj_act: 'Injection actual',
  inj_pw: 'Injector pulse width', misfire: 'Misfire index', lam: 'Lambda',
  alt_m: 'Altitude', oat_c: 'Outside air temp', bsfc: 'BSFC', throttle: 'Throttle',
};

export function sensorLabel(k) {
  const m = /^cyl(CHT|EGT)(\d)$/.exec(k);
  if (m) return `Cyl ${+m[2] + 1} ${m[1]}`;
  return SENSOR_LABEL[k] || k;
}

export function val(tm, k) {
  if (!tm) return undefined;
  if (k.startsWith('cylCHT')) return (tm.cylCHT || [])[+k.slice(-1)];
  if (k.startsWith('cylEGT')) return (tm.cylEGT || [])[+k.slice(-1)];
  if (k === 'misfire' || k === 'soc' || k === 'throttle') return tm[k] * 100;
  return tm[k];
}

export const PART_LABELS = {
  crankcase: 'Crankcase / rotating assembly', sump: 'Oil sump & lubrication circuit',
  oilpump: 'Oil pump & pressure regulator', cyl0: 'Cylinder 1', cyl1: 'Cylinder 2',
  cyl2: 'Cylinder 3', cyl3: 'Cylinder 4', head: 'Cylinder heads & CHT probes',
  ignition: 'Ignition system (plugs / coils)', injector: 'Fuel injector',
  gearbox: 'Reduction gearbox (2.43:1)', prop: 'Propeller & hub',
  turbo: 'Turbocharger / wastegate', exhaust: 'Exhaust / EGT probe',
  intake: 'Intake plenum & MAP sensor', fuelrail: 'Fuel rail & injection system',
  alternator: 'Alternator & battery bus', ecu: 'ECU / FADEC & CAN bus node',
  radiator: 'Coolant radiator / cooling ducts',
};

export const HEALTH_KEYS = ['ring_wear', 'injector_clog', 'cooling_fouling',
  'oil_degradation', 'bearing_wear', 'sensor_drift', 'ignition_wear'];

export const HEALTH_LABEL = {
  ring_wear: 'Piston rings / compression',
  injector_clog: 'Fuel injector delivery',
  cooling_fouling: 'Cooling circuit',
  oil_degradation: 'Lubrication oil',
  bearing_wear: 'Bearings / rotating assembly',
  sensor_drift: 'Sensor chain integrity',
  ignition_wear: 'Ignition / combustion',
};

export const LIMITS = {
  rpm: { warn: 5600, alarm: 5900, unit: 'rpm' },
  cht: { warn: 150, alarm: 175, unit: '\u00b0C' },
  egt: { warn: 880, alarm: 950, unit: '\u00b0C' },
  oil_t: { warn: 125, alarm: 140, unit: '\u00b0C' },
  oil_p: { warn: 1.8, alarm: 1.2, unit: 'bar', low: true },
  vib: { warn: 2.2, alarm: 3.0, unit: 'g' },
  bus_v: { warn: 12.6, alarm: 11.8, unit: 'V', low: true },
};

export const MISSION_PHASES = [
  ['START', 90, 0.15, 200, 0], ['TAXI', 180, 0.22, 200, 8], ['TAKEOFF', 120, 0.98, 400, 32],
  ['CLIMB', 1500, 0.88, 5200, 42], ['CRUISE', 3600, 0.62, 7600, 58], ['LOITER', 7200, 0.48, 7000, 48],
  ['DESCENT', 900, 0.30, 1200, 55], ['LANDING', 240, 0.35, 200, 30],
];
export const TOTAL_MISSION_S = MISSION_PHASES.reduce((a, p) => a + p[1], 0);

export function missionProfile(t, scenario = 'standard') {
  let acc = 0;
  for (const [name, dur, thr, alt] of MISSION_PHASES) {
    if (t < acc + dur) {
      const f = (t - acc) / dur;
      let thrI = thr;
      if (scenario === 'transients') {
        thrI = Math.min(1, Math.max(0.12, thr + 0.35 * Math.sin(t / 9) + 0.2 * Math.sin(t / 2.3)));
      }
      return { phase: name, throttle: thrI, alt_m: alt * Math.min(1, f * 1.6 + 0.3) };
    }
    acc += dur;
  }
  return { phase: 'LOITER', throttle: 0.48, alt_m: 7000 };
}
