import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateComparison, formatWallTime, parseZamboangaDateTime, HourlyReading, ZAMBOANGA_DEFAULTS,
} from '../src/solarQuoteCalculator';
import {
  fitToCounts, itemsFromQuote, jobTotal, jobWarnings, requiredQty, settingsFor, type JobItem,
} from '../../src/lib/job-items';
import {
  defaultCrew, installPlan, manilaDay, manilaIso, manilaMinutes, planInstall, planSurvey, scheduleWarnings, workingDays,
  type StaffEntry,
} from '../../src/lib/schedule';

/** A week of hourly readings: evening peak, daytime load, low overnight. */
function week(): HourlyReading[] {
  const t0 = parseZamboangaDateTime('2026-09-01 00:00');
  return Array.from({ length: 168 }, (_, i) => {
    const h = i % 24;
    return {
      timestamp: formatWallTime(t0 + i * 3600000).replace('T', ' ').slice(0, 16),
      kWh: h >= 18 && h < 23 ? 2.5 : h >= 9 && h < 17 ? 1.2 : 0.6,
    };
  });
}
const outages = [
  { start: '2025-11-14 17:00', end: '2025-11-14 21:00' },
  { start: '2026-02-03 13:00', end: '2026-02-03 15:30' },
];
const quote = calculateComparison({ consumption: week(), outages });
const values = { ...ZAMBOANGA_DEFAULTS };

/* ---------------- job items ---------------- */

test('Job items from a hybrid quote add up to its total', () => {
  const items = itemsFromQuote(quote, values, 'hybrid');
  assert.ok(Math.abs(jobTotal(items) - quote.pricing.total) < 1, `${jobTotal(items)} vs ${quote.pricing.total}`);
  assert.equal(items.find((i) => i.kind === 'panel')?.qty, quote.panels.count);
  assert.equal(items.find((i) => i.kind === 'battery')?.qty, quote.battery.units);
  assert.ok(items.some((i) => i.category === 'DC side'));
  assert.ok(items.some((i) => i.category === 'Earthing'));
});

test('Job items from the grid-tie comparison add up to its total and carry no batteries', () => {
  const g = quote.gridTie!;
  const items = itemsFromQuote(g, values, 'grid-tie');
  assert.ok(Math.abs(jobTotal(items) - g.pricing.total) < 1);
  assert.equal(items.some((i) => i.kind === 'battery'), false);
});

test('A job straight from the quote has no fit warnings', () => {
  const g = quote.gridTie!;
  const items = itemsFromQuote(g, values, 'grid-tie');
  const warnings = jobWarnings(items, settingsFor(values, 'grid-tie'), 'grid-tie').filter((w) => !w.includes("don't split evenly"));
  assert.deepEqual(warnings, []);
});

/** 100 panels on 4 grid-tie inverters at 22 panels each. */
function hundredOnFour(): JobItem[] {
  const items = itemsFromQuote(quote.gridTie!, values, 'grid-tie');
  return items.map((i) => (i.kind === 'panel' ? { ...i, qty: 100 } : i.kind === 'inverter' ? { ...i, qty: 4 } : i));
}

test('100 panels on 4 inverters at 22 each is warned about, not refused', () => {
  const warnings = jobWarnings(hundredOnFour(), settingsFor(values, 'grid-tie'), 'grid-tie');
  assert.ok(warnings.some((w) => w.startsWith('100 panels need 5 inverters at 22 panels each; the job has 4.')), warnings.join('\n'));
});

test('Scaling parts below what the counts need are flagged, and fitToCounts fixes them', () => {
  const settings = settingsFor(values, 'grid-tie');
  const items = hundredOnFour();
  const mounting = items.find((i) => i.kind === 'mounting')!;
  assert.equal(requiredQty(mounting, items, settings), 100);
  assert.ok(jobWarnings(items, settings, 'grid-tie').some((w) => / short for 100 panels and 4 inverters: .*Rails & mounts, per panel \(\d+ of 100\)/.test(w)));

  const fitted = fitToCounts(items, settings);
  assert.equal(fitted.find((i) => i.kind === 'mounting')!.qty, 100);
  assert.equal(fitted.find((i) => i.kind === 'pvCable')!.qty, Math.ceil((10 * 40) / 100));
  assert.equal(fitted.find((i) => i.kind === 'panel')!.qty, 100, 'panels themselves are left alone');
  assert.ok(!jobWarnings(fitted, settings, 'grid-tie').some((w) => w.includes(' short for ')));
});

test('Batteries on a grid-tie job and none on a hybrid job are warned about', () => {
  const hybrid = itemsFromQuote(quote, values, 'hybrid').map((i) => (i.kind === 'battery' ? { ...i, qty: 0 } : i));
  assert.ok(jobWarnings(hybrid, settingsFor(values, 'hybrid'), 'hybrid').includes('A hybrid job with no batteries.'));
});

/* ---------------- scheduling ---------------- */

test('Install days: 20 panels a day, then one inspection day', () => {
  assert.deepEqual(installPlan(20), { installDays: 1, inspectionDays: 1 });
  assert.deepEqual(installPlan(38), { installDays: 2, inspectionDays: 1 });
  assert.deepEqual(installPlan(41), { installDays: 3, inspectionDays: 1 });
  assert.deepEqual(installPlan(0), { installDays: 1, inspectionDays: 1 });
});

test('Working days skip Sundays', () => {
  // 2026-10-10 is a Saturday
  assert.deepEqual(workingDays('2026-10-10', 3), ['2026-10-10', '2026-10-12', '2026-10-13']);
  assert.deepEqual(workingDays('2026-10-11', 1), ['2026-10-12']);
});

test('Manila times round-trip through UTC', () => {
  const iso = manilaIso('2026-10-12', 9 * 60 + 30);
  assert.equal(iso, '2026-10-12T01:30:00.000Z');
  assert.equal(manilaDay(iso), '2026-10-12');
  assert.equal(manilaMinutes(iso), 570);
  assert.equal(manilaDay('2026-10-11T16:00:00Z'), '2026-10-12', 'midnight Manila is 16:00 UTC the day before');
});

const directory: StaffEntry[] = [
  { username: 'brylle', name: 'Brylle', role: 'owner' },
  { username: 'lead', name: 'Lead', role: 'lead_installer' },
  { username: 'a', name: 'A', role: 'installer' },
  { username: 'b', name: 'B', role: 'installer' },
  { username: 'ee', name: 'EE', role: 'electrician' },
];

test('Default crews: survey 3 people, install lead + 2, inspection the electrical engineer', () => {
  assert.deepEqual(defaultCrew('survey', directory).map((c) => c.username), ['brylle', 'lead', 'ee']);
  assert.deepEqual(defaultCrew('install', directory).map((c) => c.username), ['lead', 'a', 'b']);
  assert.deepEqual(defaultCrew('inspection', directory).map((c) => c.username), ['ee']);
});

test('A survey is a 3-hour block', () => {
  const [s] = planSurvey('2026-10-12', 9 * 60, defaultCrew('survey', directory));
  assert.equal(Date.parse(s.end) - Date.parse(s.start), 3 * 3600000);
});

test('38 panels from Saturday: 2 install days (Sat, Mon) then the inspection on Tuesday', () => {
  const plan = planInstall('2026-10-10', 38, {
    install: defaultCrew('install', directory),
    inspection: defaultCrew('inspection', directory),
  });
  assert.deepEqual(plan.map((e) => [e.kind, manilaDay(e.start)]), [
    ['install', '2026-10-10'],
    ['install', '2026-10-12'],
    ['inspection', '2026-10-13'],
  ]);
  assert.deepEqual(plan[2].staff.map((c) => c.username), ['ee']);
  assert.ok(plan.every((e) => e.allDay));
});

test('Schedule warnings: double-booking, install before permit and survey, survey off the free days', () => {
  const crew = defaultCrew('survey', directory);
  const events = [
    ...planSurvey('2026-10-12', 9 * 60, crew).map((e) => ({ ...e, projectId: 1 })),
    ...planSurvey('2026-10-12', 10 * 60, crew).map((e) => ({ ...e, projectId: 2 })),
    ...planInstall('2026-10-14', 20, { install: defaultCrew('install', directory), inspection: [] }).map((e) => ({ ...e, projectId: 3 })),
  ];
  const warnings = scheduleWarnings(events, {
    customer: (id) => `P${id}`,
    name: (u) => u,
    freeDates: (id) => (id === 1 ? ['2026-10-13'] : []),
    permitApproved: () => null,
    surveyAt: () => null,
  });
  assert.ok(warnings.some((w) => w.startsWith('brylle is double-booked')), warnings.join('\n'));
  assert.ok(warnings.some((w) => w.startsWith("P3: installation on") && w.includes("permit isn't approved")));
  assert.ok(warnings.some((w) => w === 'P3: installation booked with no site survey.'));
  assert.ok(warnings.some((w) => w.startsWith('P1: survey on') && w.includes("free")));
  assert.ok(!warnings.some((w) => w.startsWith('P2: survey')));
});
