import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';
import {
  __test, buildSunProfile, calculateComparison, calculateQuote, formatWallTime, HourlyReading, parseOutageCsv,
  parseZamboangaDateTime, QuoteDefaults, SunOutputRow, ZAMBOANGA_DEFAULTS, detectDateOrder,
} from '../src/solarQuoteCalculator';
import { ZAMCELCO_OUTAGES_CSV } from '../src/zamcelcoOutages';

const {
  outageNeedKwh, buildReferenceWeek, parseConsumption, buildSimContext, simulateYear, batteryRuntimeHours,
  runtimeStartHours,
} = __test;
const cfg: QuoteDefaults = { ...ZAMBOANGA_DEFAULTS };
const iso = (s: DateInputLike) => formatWallTime(parseZamboangaDateTime(s));
type DateInputLike = string | number | Date;

/** Hourly readings from a start date for n hours, load(dayIndex, hour). */
function readings(start: string, hours: number, load: (day: number, hour: number) => number): HourlyReading[] {
  const t0 = parseZamboangaDateTime(start);
  return Array.from({ length: hours }, (_, i) => {
    const t = t0 + i * 3600000;
    const ts = formatWallTime(t).replace('T', ' ').slice(0, 16);
    return { timestamp: ts, kWh: load(Math.floor(i / 24), new Date(t).getUTCHours()) };
  });
}

function refFrom(r: HourlyReading[]) {
  return buildReferenceWeek(parseConsumption(r));
}

const sunAll = (perHour: Record<number, number>) =>
  Array.from({ length: 12 }, () => Array.from({ length: 24 }, (_, h) => perHour[h] ?? 0));

// ── Day grouping and reference days ─────────────────────────

test('Sep 1–7 example: every weekday maps to its own calendar day', () => {
  const ref = refFrom(readings('2026-09-01 00:00', 168, () => 1));
  assert.deepEqual(ref.dates, [
    '2026-09-06', '2026-09-07', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05',
  ]);
  assert.deepEqual(ref.fallbackWeekdays, []);
});

test('March 27, 2026 outage uses the Friday (Sep 4) profile', () => {
  // Friday Sep 4 (day index 3) uses 2 kWh/h, every other day 1 kWh/h. No sun.
  const ref = refFrom(readings('2026-09-01 00:00', 168, (d) => (d === 3 ? 2 : 1)));
  const need = outageNeedKwh(
    { start: parseZamboangaDateTime('2026-03-27 16:00'), end: parseZamboangaDateTime('2026-03-27 18:00') },
    ref, sunAll({}), 0, cfg,
  );
  assert.equal(need, 4); // 2 hours × 2 kWh
});

test('With two weeks of data, the higher-consumption Friday is chosen', () => {
  const ref = refFrom(readings('2026-09-01 00:00', 336, (d) => (d === 10 ? 3 : 1))); // Sep 11
  assert.equal(ref.dates[5], '2026-09-11');
});

test('Partial days are never reference days; a weekday with none falls back with a warning', () => {
  const warnings: string[] = [];
  const ref = buildReferenceWeek(parseConsumption(readings('2026-09-01 15:00', 168, () => 1), undefined, warnings));
  assert.equal(ref.dates[2], null); // Tuesday: Sep 1 and Sep 8 are both partial
  assert.deepEqual(ref.fallbackWeekdays, [2]);
});

// ── Battery need per outage ─────────────────────────────────

const flatRef = () => refFrom(readings('2026-09-01 00:00', 168, () => 0.5));

test('Spec example: 1 kWh used, 0.6 kWh generated over 4–6pm → 0.4 kWh', () => {
  const need = outageNeedKwh(
    { start: parseZamboangaDateTime('2026-03-27 16:00'), end: parseZamboangaDateTime('2026-03-27 18:00') },
    flatRef(), sunAll({ 16: 0.3, 17: 0.3 }), 1, cfg,
  );
  assert.ok(Math.abs(need - 0.4) < 1e-9);
});

test('Running balance: surplus refills an earlier drawdown', () => {
  // 12:00 deficit 0.5, 13:00 surplus 0.5, 14:00 deficit 0.5 → deepest point 0.5
  const need = outageNeedKwh(
    { start: parseZamboangaDateTime('2026-03-27 12:00'), end: parseZamboangaDateTime('2026-03-27 15:00') },
    flatRef(), sunAll({ 13: 1 }), 1, cfg,
  );
  assert.ok(Math.abs(need - 0.5) < 1e-9);
});

test('Running balance: surplus before any drawdown is lost (battery already full)', () => {
  // 12:00 surplus 0.5 (nowhere to go), 13:00 and 14:00 deficit 0.5 each → 1.0
  const need = outageNeedKwh(
    { start: parseZamboangaDateTime('2026-03-27 12:00'), end: parseZamboangaDateTime('2026-03-27 15:00') },
    flatRef(), sunAll({ 12: 1 }), 1, cfg,
  );
  assert.ok(Math.abs(need - 1.0) < 1e-9);
});

test('Partial hours are prorated: 4:30–6:00pm at 0.5 kWh/h → 0.75 kWh', () => {
  const need = outageNeedKwh(
    { start: parseZamboangaDateTime('2026-03-27 16:30'), end: parseZamboangaDateTime('2026-03-27 18:00') },
    flatRef(), sunAll({}), 0, cfg,
  );
  assert.ok(Math.abs(need - 0.75) < 1e-9);
});

// ── Date parsing ────────────────────────────────────────────

test('Date formats parse to Zamboanga wall-clock time', () => {
  const want = '2026-09-04T16:00:00';
  for (const s of [
    '2026-09-04 16:00', '2026-09-04T16:00:00', '2026/09/04 4:00 PM', '2026-09-04 04:00:00 pm',
    '4-Sep-2026 16:00', 'Sep 4, 2026 4:00 PM', '04 September 2026 16:00',
    '2026-09-04T08:00:00Z', '2026-09-04T16:00:00+08:00', '2026-09-04T09:00:00+01:00',
  ]) {
    assert.equal(iso(s), want, s);
  }
  assert.equal(formatWallTime(parseZamboangaDateTime('04/09/2026 16:00', 'DMY')), want);
  assert.equal(formatWallTime(parseZamboangaDateTime('09/04/2026 16:00', 'MDY')), want);
  assert.equal(iso(46269 + 16 / 24), want); // Excel serial
  assert.equal(iso('2026-09-03 24:00'), '2026-09-04T00:00:00');
});

test('Ambiguous or invalid dates throw instead of guessing', () => {
  assert.throws(() => parseZamboangaDateTime('04/09/2026 16:00'), /Ambiguous/);
  assert.throws(() => parseZamboangaDateTime('2026-02-30 10:00'), /Invalid calendar date/);
  assert.throws(() => parseZamboangaDateTime('13:00 yesterday'), /Unrecognized/);
  assert.throws(() => parseZamboangaDateTime(46), /not an Excel serial/);
  assert.equal(parseZamboangaDateTime('25/09/2026 16:00'), parseZamboangaDateTime('2026-09-25 16:00'));
});

test('Date order is detected from the whole file', () => {
  assert.equal(detectDateOrder(['01/09/2026', '25/09/2026']), 'DMY');
  assert.equal(detectDateOrder(['09/01/2026', '09/25/2026']), 'MDY');
  assert.equal(detectDateOrder(['01/09/2026', '02/09/2026']), undefined);
  assert.throws(() => detectDateOrder(['25/09/2026', '09/25/2026']), /mix/);
});

// ── Outage CSV ──────────────────────────────────────────────

test('Outage CSV: header, quoting, BOM, day-first detection, bad rows reported, exact location match', () => {
  const csv = '﻿Location,Datetime Start,Datetime End\r\n' +
    'Zamboanga City,05/01/2026 16:00,05/01/2026 18:00\r\n' +       // day-first, settled by next row
    'zamboanga city ,27/03/2026 16:30,27/03/2026 18:00\r\n' +       // case/space differences match
    '"Zamboanga Sibugay, Ipil",27/03/2026 10:00,27/03/2026 12:00\r\n' + // different location
    'Zamboanga City,27/03/2026 16:30,27/03/2026 18:00\r\n' +         // duplicate
    'Zamboanga City,31/02/2026 10:00,31/02/2026 11:00\r\n' +         // impossible date
    'Zamboanga City,27/03/2026 18:00,27/03/2026 17:00\r\n';          // end before start
  const r = parseOutageCsv(csv, { locations: 'Zamboanga City' });
  assert.equal(r.dateOrder, 'DMY');
  assert.deepEqual(r.outages.map((o) => [o.start, o.end]), [
    ['2026-01-05T16:00:00', '2026-01-05T18:00:00'],
    ['2026-03-27T16:30:00', '2026-03-27T18:00:00'],
  ]);
  assert.equal(r.duplicatesRemoved, 1);
  assert.deepEqual(r.skipped.map((s) => s.line), [6, 7]);
  assert.equal(r.locations['Zamboanga Sibugay, Ipil'], 1);
});

test('Outage CSV: a row listing several barangays matches each; outages inside longer ones are dropped', () => {
  const csv = 'Barangays,Datetime Start,Datetime End,ZAMCELCO Description\n' +
    'Baliwasan; Calarian,2026-04-11 05:30,2026-04-11 06:30,isolation\n' +
    'Baliwasan; Calarian,2026-04-11 10:30,2026-04-11 11:30,re-tapping\n' +
    'Baliwasan,2026-04-11 05:30,2026-04-11 11:30,"line work, covers both"\n' +
    'Baliwasan,2026-04-11 17:00,2026-04-12 01:00,rotation group A\n' +
    'Baliwasan,2026-04-12 01:00,2026-04-12 09:00,"rotation group B, back-to-back: kept apart"\n' +
    'Calarian,2026-04-12 09:00,2026-04-12 11:00,other barangay\n' +
    ',2026-04-13 09:00,2026-04-13 10:00,no barangay given\n';
  const r = parseOutageCsv(csv, { locations: 'baliwasan' });
  assert.deepEqual(r.outages.map((o) => [o.start, o.end]), [
    ['2026-04-11T05:30:00', '2026-04-11T11:30:00'],
    ['2026-04-11T17:00:00', '2026-04-12T01:00:00'],
    ['2026-04-12T01:00:00', '2026-04-12T09:00:00'],
  ]);
  assert.equal(r.overlapsRemoved, 2);
  assert.equal(r.lastEnd, '2026-04-12T09:00:00');
  assert.deepEqual(r.locations, { Baliwasan: 5, Calarian: 3 });
  assert.ok(r.warnings.some((w) => w.includes('1 rows name no location')));
  assert.equal(parseOutageCsv(csv, { locations: 'Calarian' }).outages.length, 3);
});

test('Built-in ZAMCELCO list parses cleanly and is current with its CSV', () => {
  const csv = fs.readFileSync(path.join(__dirname, '..', 'src', 'zamcelcoOutages.csv'), 'utf8');
  assert.equal(ZAMCELCO_OUTAGES_CSV, csv, 'Run scripts/buildZamcelcoOutages.ts');
  const r = parseOutageCsv(csv);
  assert.equal(r.skipped.length, 0);
  assert.ok(Object.keys(r.locations).length > 50);
});

test('Outage CSV without a header row uses column order', () => {
  const r = parseOutageCsv('Zamboanga City,2021-06-14 14:00:00,2021-06-14 15:30:00\n');
  assert.equal(r.outages.length, 1);
  assert.equal(r.outages[0].end, '2021-06-14T15:30:00');
});

// ── Sun profile from a real .xlsx ───────────────────────────

/** 5-minute log, 1.6 kW peak bell curve between 06:00 and 18:00. */
function sunRows(days: number, asText: boolean, skip?: (d: number, minute: number) => boolean) {
  const rows: Record<string, unknown>[] = [];
  for (let d = 1; d <= days; d++) {
    for (let m = 0; m < 1440; m += 5) {
      if (skip?.(d, m)) continue;
      const h = m / 60;
      const kw = h > 6 && h < 18 ? 1.6 * Math.sin((Math.PI * (h - 6)) / 12) : 0;
      const time = asText
        ? `2026-09-${String(d).padStart(2, '0')} ${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00`
        : new Date(2026, 8, d, 0, m); // a real Excel date cell
      rows.push({ 'Device Name': 'INV-01', Time: time, 'PV1 Input Power (kW)': Math.round(kw * 1000) / 1000 });
    }
  }
  return rows;
}

function viaXlsx(rows: Record<string, unknown>[]): SunOutputRow[] {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Sheet1');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const back = XLSX.read(buf, { cellDates: false }); // same options as scripts/buildSunProfile.ts
  return XLSX.utils.sheet_to_json<SunOutputRow>(back.Sheets.Sheet1, { raw: true });
}

const TRUE_YIELD = (1.6 * 12 * 2) / Math.PI / 1.95; // ∫ bell curve ÷ 1.95 kWp ≈ 6.268

test('Sun profile: real Excel dates and text dates give the same, correct yield', () => {
  const real = viaXlsx(sunRows(3, false));
  const text = viaXlsx(sunRows(3, true));
  assert.equal(typeof real[0].Time, 'number'); // Excel serial, as SheetJS returns it
  assert.equal(typeof text[0].Time, 'string');
  const a = buildSunProfile(real);
  const b = buildSunProfile(text);
  assert.ok(Math.abs(a.dailyYieldByMonth[8] - TRUE_YIELD) / TRUE_YIELD < 0.01, String(a.dailyYieldByMonth[8]));
  assert.deepEqual(a.dailyYieldByMonth, b.dailyYieldByMonth);
  assert.equal(a.daysUsedByMonth[8], 3);
  assert.equal(a.sampleIntervalMinutes, 5);
});

test('Sun profile: a day with a logger dropout is excluded, not averaged in', () => {
  const rows = viaXlsx(sunRows(3, true, (d, m) => d === 2 && m >= 600 && m < 840)); // Sep 2, 10:00–14:00 missing
  const r = buildSunProfile(rows);
  assert.equal(r.daysUsedByMonth[8], 2);
  assert.equal(r.daysExcluded, 1);
  assert.ok(Math.abs(r.dailyYieldByMonth[8] - TRUE_YIELD) / TRUE_YIELD < 0.01);
});

test('Sun profile: several devices without a deviceName throws', () => {
  const rows = viaXlsx([...sunRows(1, true), ...sunRows(1, true).map((r) => ({ ...r, 'Device Name': 'INV-02' }))]);
  assert.throws(() => buildSunProfile(rows), /Multiple devices/);
  assert.equal(buildSunProfile(rows, { deviceName: 'inv-02' }).daysUsedByMonth[8], 1);
});

// ── Full quote ──────────────────────────────────────────────

const week = () => readings('2026-09-01 00:00', 168, (d, h) => (h >= 18 && h < 23 ? 2.5 : h >= 9 && h < 17 ? 1.2 : 0.6) + d * 0.05);
const realSun = buildSunProfile(viaXlsx(sunRows(3, true))).profile;
const outageLog = [
  { start: '2025-11-14 17:00', end: '2025-11-14 21:00' },
  { start: '2026-02-03 13:00', end: '2026-02-03 15:30' },
  { start: '2026-05-22 19:00', end: '2026-05-23 01:00' },
  { start: '2024-07-08 08:00', end: '2024-07-08 12:00' },
  { start: '2023-03-27 18:30', end: '2023-03-27 20:00' },
];

test('Quote: USD hardware is converted at usdToPhp and the total adds up', () => {
  const q = calculateQuote({ consumption: week(), outages: outageLog, sunProfile: realSun, usdToPhp: 60 });
  const p = q.pricing;
  assert.equal(p.usdToPhp, 60);
  assert.equal(p.usd.panels, Math.round(q.panels.count * 82.2 * 100) / 100);
  assert.equal(p.usd.inverters, q.inverter.count * 720);
  assert.equal(p.usd.batteries, q.battery.units * 980);
  assert.equal(p.panels, Math.round(q.panels.count * 82.2 * 60 * 100) / 100);
  assert.equal(p.inverters, q.inverter.count * 720 * 60);
  assert.equal(p.batteries, q.battery.units * 980 * 60);
  const hardware = (q.panels.count * 82.2 + q.inverter.count * 720 + q.battery.units * 980) * 60;
  assert.ok(Math.abs(p.total - (hardware * 1.4 + 20625 + 1500)) < 0.01);
});

test('Quote: inverters cover the panel count as well as the load', () => {
  // Light evening load: one 12 kW inverter covers the power, but the bill needs many panels.
  const q = calculateQuote({ consumption: week(), outages: outageLog, sunProfile: realSun, inverterMaxPanels: 4 });
  assert.equal(q.inverter.countForLoad, 1);
  assert.equal(q.inverter.countForPanels, Math.ceil(q.panels.count / 4));
  assert.equal(q.inverter.count, Math.max(1, Math.ceil(q.panels.count / 4)));
  assert.ok(q.inverter.count > 1);
  assert.equal(q.inverter.maxPanelsEach, 4);
  // With the default 20 panels each, the same customer needs one inverter.
  const d = calculateQuote({ consumption: week(), outages: outageLog, sunProfile: realSun });
  assert.ok(d.panels.count <= 20);
  assert.equal(d.inverter.count, 1);
});

test('Quote: meets 95%, and one panel fewer would not', () => {
  const q = calculateQuote({ consumption: week(), outages: outageLog, sunProfile: realSun });
  assert.ok(q.bill.reductionPercent >= 95, String(q.bill.reductionPercent));
  const ref = refFrom(week());
  const parsed = outageLog.map((o) => ({ start: parseZamboangaDateTime(o.start), end: parseZamboangaDateTime(o.end) }));
  const ctx = buildSimContext(ref, realSun.monthly, parsed);
  const fewer = simulateYear(ctx, ((q.panels.count - 1) * 720) / 1000, q.battery.installedKwh, q.inverter.totalKw, cfg);
  assert.ok(fewer.billAfter > fewer.baseline * 0.05);
  assert.equal(q.bill.monthly.length, 12);
  assert.equal(q.simulation.start, '2025-09-01T00:00:00');
});

test('Quote: battery is the largest of minimum, outage needs, outage coverage and evening runtime', () => {
  const q = calculateQuote({ consumption: week(), outages: outageLog, sunProfile: realSun });
  const u = q.battery.unitsFor;
  assert.equal(q.battery.requiredKwh, q.battery.needStats.p80);
  assert.equal(u.outageNeeds, Math.ceil(q.battery.requiredKwh / 10 - 1e-9));
  assert.equal(q.battery.units, Math.max(u.minimum, u.outageNeeds, u.outageCoverage!, u.eveningRuntime!));
  assert.equal(q.battery.outagesAnalyzed, 5); // every outage counts, whatever year it was in
  // Needs assume a full battery; in the evening it is not, so coverage asks for more here.
  assert.ok(u.outageCoverage! > u.outageNeeds, JSON.stringify(u));
  assert.equal(q.battery.sizedBy, 'outage coverage');
});

test('Quote: the simulated year covers the outage percentile, and one unit fewer would not', () => {
  const q = calculateQuote({ consumption: week(), outages: outageLog, sunProfile: realSun, minAfterSunsetHours: 0 });
  const { eventsFullyCovered, eventsInSimulatedYear } = q.outageCoverage;
  assert.ok(eventsFullyCovered >= 0.8 * eventsInSimulatedYear);
  const ref = refFrom(week());
  const parsed = outageLog.map((o) => ({ start: parseZamboangaDateTime(o.start), end: parseZamboangaDateTime(o.end) }));
  const ctx = buildSimContext(ref, realSun.monthly, parsed);
  const fewer = simulateYear(ctx, q.panels.systemKw, q.battery.installedKwh - 10, q.inverter.totalKw, cfg);
  assert.ok(fewer.outageEvents - fewer.outageEventsUncovered < 0.8 * fewer.outageEvents);
});

// Heavy evening load (air-con): 8 kWh an hour from 18:00 to 23:00.
const heavyEvenings = () => readings('2026-09-01 00:00', 168, (_d, h) => (h >= 18 && h < 23 ? 8 : h >= 9 && h < 17 ? 1.2 : 0.6));

test('Quote: the battery grows until a typical outage after sunset lasts minAfterSunsetHours', () => {
  const off = calculateQuote({ consumption: heavyEvenings(), sunProfile: realSun, minAfterSunsetHours: 0 });
  const on = calculateQuote({ consumption: heavyEvenings(), sunProfile: realSun, minAfterSunsetHours: 3 });
  assert.ok(off.outageRuntime!.afterSunset.medianHours < 3, JSON.stringify(off.outageRuntime!.afterSunset));
  assert.ok(on.outageRuntime!.afterSunset.medianHours >= 3, JSON.stringify(on.outageRuntime!.afterSunset));
  assert.ok(on.battery.units > off.battery.units);
  assert.equal(on.battery.sizedBy, 'evening runtime');
  assert.equal(on.battery.afterSunsetTargetHours, 3);
  // One unit fewer, with the same panels and inverters, falls short of the target.
  const ref = refFrom(heavyEvenings());
  const ctx = buildSimContext(ref, realSun.monthly, []);
  const kwh = on.battery.installedKwh - 10;
  const trace: number[] = [];
  simulateYear(ctx, on.panels.systemKw, kwh, on.inverter.totalKw, cfg, trace);
  const runtimes: number[] = [];
  for (let day = ctx.start; day < ctx.end; day += 86400000) {
    const at = day + on.outageRuntime!.afterSunset.startHour * 3600000;
    runtimes.push(batteryRuntimeHours(at, trace[(at - ctx.start) / 3600000], ref, realSun.monthly, on.panels.systemKw, kwh, on.inverter.totalKw, cfg));
  }
  runtimes.sort((a, b) => a - b);
  const mid = (runtimes.length - 1) / 2;
  assert.ok((runtimes[Math.floor(mid)] + runtimes[Math.ceil(mid)]) / 2 < 3);
});

test('Quote: a runtime target the battery ceiling cannot reach is warned about, not forced', () => {
  const q = calculateQuote({ consumption: heavyEvenings(), sunProfile: realSun, minAfterSunsetHours: 3, maxBatteryUnits: 1 });
  assert.equal(q.battery.unitsFor.eveningRuntime, null);
  assert.equal(q.battery.units, 1);
  assert.ok(q.warnings.some((w) => w.includes('after sunset')), JSON.stringify(q.warnings));
});

test('Quote: no outage data gives one battery unit and a warning', () => {
  const q = calculateQuote({ consumption: week(), sunProfile: realSun });
  assert.equal(q.battery.units, 1);
  assert.ok(q.warnings.some((w) => w.includes('No outage data')));
});

test('Quote: during an outage nothing is exported, and unmet load is reported', () => {
  const ref = refFrom(week());
  const allDay = [{ start: parseZamboangaDateTime('2026-03-27 00:00'), end: parseZamboangaDateTime('2026-03-29 00:00') }];
  const withOutage = simulateYear(buildSimContext(ref, realSun.monthly, allDay), 10, 10, 12, cfg);
  const without = simulateYear(buildSimContext(ref, realSun.monthly, []), 10, 10, 12, cfg);
  const march = (s: typeof without) => s.monthly.find((m) => m.month === '2026-03')!;
  assert.ok(march(withOutage).exportKwh < march(without).exportKwh);
  assert.ok(withOutage.unmetKwh > 0);
  assert.equal(withOutage.outageEventsUncovered, 1);
});

test('Runtime: battery drains at the load, refills from surplus sun, and the last hour is prorated', () => {
  const ref = refFrom(readings('2026-09-01 00:00', 168, () => 2)); // 2 kWh every hour
  const start = parseZamboangaDateTime('2026-03-27 18:00');
  // No sun: 5 kWh lasts 2.5 hours.
  assert.equal(batteryRuntimeHours(start, 5, ref, sunAll({}), 0, 10, 12, cfg), 2.5);
  // 4 kWp × 1 kWh/kWp at 18:00 covers the load and adds 2 kWh before the battery starts draining.
  assert.equal(batteryRuntimeHours(start, 5, ref, sunAll({ 18: 1 }), 4, 10, 12, cfg), 4.5);
  // Charging stops at full: 9 kWh + 2 kWh surplus caps at 10, then 5 hours of drain.
  assert.equal(batteryRuntimeHours(start, 9, ref, sunAll({ 18: 1 }), 4, 10, 12, cfg), 6);
  // Enough sun every day to refill the battery: runtime hits the one-week cap.
  assert.equal(batteryRuntimeHours(start, 40, ref, sunAll({ 10: 30, 11: 30 }), 1, 50, 60, cfg), 168);
});

test('Runtime: start hours are the peak sun hour and the first dark hour after it', () => {
  assert.deepEqual(runtimeStartHours(sunAll({ 9: 0.4, 10: 0.5, 11: 0.6, 12: 0.5, 13: 0.4, 14: 0.3, 15: 0.2, 16: 0.15, 17: 0.1, 18: 0.001 })), { peak: 11, sunset: 18 });
});

test('Quote: battery lasts longer when the outage starts at peak sun than after sunset', () => {
  const q = calculateQuote({ consumption: week(), outages: outageLog, sunProfile: realSun });
  const { peakSun, afterSunset, maxHours } = q.outageRuntime!;
  assert.equal(maxHours, 168);
  assert.ok(afterSunset.medianHours > 0 && afterSunset.medianHours <= maxHours);
  assert.ok(peakSun.medianHours > afterSunset.medianHours, JSON.stringify(q.outageRuntime));
  assert.ok(peakSun.shortestHours <= peakSun.medianHours);
  assert.ok(afterSunset.medianStartKwh <= q.battery.installedKwh);
});

// ── Grid-tie comparison ─────────────────────────────────────

test('Grid-tie: no batteries, Deye inverters set by the panel count, same bill target', () => {
  const g = calculateQuote({ consumption: heavyEvenings(), outages: outageLog, sunProfile: realSun, systemType: 'grid-tie' });
  assert.equal(g.systemType, 'grid-tie');
  assert.equal(g.battery.units, 0);
  assert.equal(g.pricing.batteries, 0);
  assert.equal(g.inverter.ratingKwEach, 10);
  assert.equal(g.inverter.countForLoad, 0);
  assert.equal(g.inverter.count, Math.ceil(g.panels.count / 20));
  assert.equal(g.pricing.usd.inverters, g.inverter.count * 537);
  assert.ok(g.bill.reductionPercent >= 95);
  assert.equal(g.outageRuntime, null);
  assert.ok(!g.warnings.some((w) => w.includes('No outage data') || w.includes('not fully covered')));
});

test('Grid-tie: no solar during an outage, even at noon; every outage goes unpowered', () => {
  const ref = refFrom(week());
  const noon = [{ start: parseZamboangaDateTime('2026-03-27 10:00'), end: parseZamboangaDateTime('2026-03-27 14:00') }];
  const hybridCtx = buildSimContext(ref, realSun.monthly, noon);
  const gridTieCtx = buildSimContext(ref, realSun.monthly, noon, false);
  const hybrid = simulateYear(hybridCtx, 10, 0, 12, cfg);
  const gridTie = simulateYear(gridTieCtx, 10, 0, 12, cfg);
  assert.equal(hybrid.unmetKwh, 0); // 10 kWp covers the midday load
  assert.ok(Math.abs(gridTie.unmetKwh - 4 * ref.hourly[5][11]) < 1e-9); // Fri, 4 h at the midday load
  assert.equal(gridTie.outageEventsUncovered, 1);
  assert.ok(gridTie.curtailedKwh > hybrid.curtailedKwh);
});

test('Comparison: the hybrid quote carries the grid-tie quote for the same customer', () => {
  const c = calculateComparison({ consumption: heavyEvenings(), outages: outageLog, sunProfile: realSun });
  assert.equal(c.systemType, 'hybrid');
  assert.ok(c.battery.units > 0);
  assert.equal(c.gridTie!.systemType, 'grid-tie');
  assert.equal(c.gridTie!.bill.annualBefore, c.bill.annualBefore);
  // Without a battery, night use is bought at the import rate and paid back at the lower export credit.
  assert.ok(c.gridTie!.panels.count >= c.panels.count, `${c.gridTie!.panels.count} vs ${c.panels.count}`);
  assert.ok(c.gridTie!.pricing.total < c.pricing.total);
});

test('Comparison: a grid-tie system that cannot be sized leaves a warning, not an error', () => {
  const c = calculateComparison({ consumption: heavyEvenings(), outages: outageLog, sunProfile: realSun, maxPanels: 16 }); // hybrid needs 14, grid-tie 18
  assert.equal(c.gridTie, undefined);
  assert.ok(c.warnings.some((w) => w.startsWith('No grid-tie comparison')), JSON.stringify(c.warnings));
});

test('Quote: placeholder sun profile is flagged, the built-in profile is not', () => {
  const q = calculateQuote({ consumption: week(), outages: outageLog, sunProfile: { ...realSun, isPlaceholder: true } });
  assert.ok(q.warnings.some((w) => w.includes('placeholder')));
  const builtIn = calculateQuote({ consumption: week(), outages: outageLog });
  assert.ok(!builtIn.warnings.some((w) => w.includes('placeholder')));
});

test('Quote: bad consumption data is rejected with the row number', () => {
  const bad = week();
  bad[10] = { ...bad[10], kWh: NaN };
  assert.throws(() => calculateQuote({ consumption: bad, sunProfile: realSun }), /row 11/);
  const dup = week();
  dup[11] = { ...dup[10] };
  assert.throws(() => calculateQuote({ consumption: dup, sunProfile: realSun }), /duplicate/);
  assert.throws(() => calculateQuote({ consumption: week().slice(0, 100), sunProfile: realSun }), /168/);
});
