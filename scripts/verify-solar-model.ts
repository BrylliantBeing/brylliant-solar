/**
 * Reproduces the test vectors in `solar-calculation/solar-calculator-spec.md` §7
 * against the live engine in `src/constants/solar.ts`.
 *
 * The spec's instruction is to reproduce these exactly before going live, so
 * run this after touching any coefficient, profile or dispatch code:
 *
 *   npm run verify:model
 *
 * Tolerances are a fraction of a kWh — they exist only because the published
 * vectors are rounded to one decimal, not because the model is approximate.
 */

import {
  coefficientB,
  commercialLoadCurves,
  dispatchDay,
  estimate,
  residentialLoadCurve,
  solarCurve,
} from '../src/constants/solar';

let failures = 0;

function check(name: string, got: number, want: number, tol: number) {
  const ok = Math.abs(got - want) <= tol;
  if (!ok) failures++;
  const line = `${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(30)} got ${got.toFixed(3).padStart(10)}   want ${want.toFixed(3).padStart(10)}`;
  console.log(line);
}

// --- §7 residential: typical, 300 kWh/month, yield 3.5, 2:1, 30 days --------
console.log('\nResidential — typical, 300 kWh/month, 3.30 kWp, yield 3.5, 2:1, 30 days');
{
  const days = 30;
  const b = coefficientB('typical', 2.0, 80);
  check('coefficient B', b, 0.03858, 1e-9);
  check('kWp', (300 * b) / 3.5, 3.3, 0.01);

  const load = residentialLoadCurve('typical', 300 / days);
  check('peak load kW', Math.max(...load), 0.765, 0.002);

  const d = dispatchDay(load, solarCurve(3.3, 3.5));
  const self = d.self * days;
  const exported = d.exported * days;
  const imported = d.imported * days;
  check('generation kWh', self + exported, 346.5, 0.5);
  check('self-consumed kWh', self, 132.7, 1.5);
  check('exported kWh', exported, 213.8, 1.5);
  check('imported kWh', imported, 167.3, 1.5);
  check('net billed kWh', imported - exported / 2, 60.4, 2);
  // The invariant the spec says must always hold.
  check('self + import = load', self + imported, 300, 0.01);
}

// --- §7 commercial: 20:1, 3,720 kWh/month, 31 days, 23 working -------------
console.log('\nCommercial — 20:1, 3,720 kWh/month, 32.37 kWp, yield 3.5, 2:1, 31 days, 23 working');
{
  const days = 31;
  const workdays = 23;
  const b = coefficientB('comm20', 2.0, 80);
  check('coefficient B', b, 0.03046, 1e-9);
  check('kWp', (3720 * b) / 3.5, 32.37, 0.01);

  const cm = commercialLoadCurves(3720, 20, days, workdays);
  check('base load kW', cm.baseKw, 0.981, 0.002);
  check('peak load kW', cm.peakKw, 19.62, 0.04);

  const solar = solarCurve(32.37, 3.5);
  const open = dispatchDay(cm.open, solar);
  const shut = dispatchDay(cm.closed, solar);
  const closedDays = days - workdays;
  const self = open.self * workdays + shut.self * closedDays;
  const exported = open.exported * workdays + shut.exported * closedDays;
  const imported = open.imported * workdays + shut.imported * closedDays;
  check('generation kWh', self + exported, 3512.1, 1);
  check('self-consumed kWh', self, 2439.0, 12);
  check('exported kWh', exported, 1073.1, 12);
  check('imported kWh', imported, 1281.0, 12);
  check('net billed kWh', imported - exported / 2, 744.4, 18);
  check('self + import = load', self + imported, 3720, 0.5);
}

// --- §3 sanity: at 1:1 the load shape stops mattering ----------------------
console.log('\nSanity — at 1:1 export every profile must converge');
for (const key of ['typical', 'away', 'home', 'aircon'] as const) {
  check(`B ${key} @ 1:1, 80%`, coefficientB(key, 1.0, 80), 0.02667, 1e-9);
}
for (const key of ['comm10', 'comm15', 'comm20', 'comm30'] as const) {
  check(`B ${key} @ 1:1, 80%`, coefficientB(key, 1.0, 80), 0.02581, 1e-9);
}

// --- the invariant, across the whole input range --------------------------
console.log('\nInvariant — self + import = consumption, across the range');
for (const monthlyKwh of [150, 300, 800, 1500, 3720, 8000]) {
  for (const segment of ['residential', 'commercial'] as const) {
    const r = estimate({ segment, monthlyKwh });
    check(`${segment} ${monthlyKwh} kWh/mo`, r.selfKwh + r.importKwh, monthlyKwh, 0.01);
  }
}

console.log(
  failures === 0
    ? '\nAll checks passed — the engine reproduces the spec.\n'
    : `\n${failures} check(s) FAILED.\n`
);
process.exit(failures === 0 ? 0 : 1);
