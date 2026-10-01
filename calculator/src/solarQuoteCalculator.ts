// solarQuoteCalculator.ts
// Internal quote model for hybrid solar installations in Zamboanga City.
//
// Pure TypeScript with no dependencies, safe to run in React Native (Hermes).
// Every date is handled as Zamboanga wall-clock time (UTC+8, no daylight saving).
// Dates are parsed by this module's own parser into plain numbers, never through
// Date.parse or the device's timezone, so a quote comes out identical on any device.

import { ZAMBOANGA_SUN_PROFILE } from './zamboangaSunProfile';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

/** A date/time as it arrives from a file: text, an Excel serial number, or a Date. */
export type DateInput = string | number | Date;

/** Order of day and month in numeric dates such as 04/09/2026. */
export type DateOrder = 'MDY' | 'DMY';

export interface HourlyReading {
  /** Start of the hour, Zamboanga local time, e.g. "2026-09-04 16:00" */
  timestamp: DateInput;
  /** Energy consumed during that hour (kWh) */
  kWh: number;
}

export interface OutageEvent {
  location?: string;
  /** Outage start, Zamboanga local time */
  start: DateInput;
  /** Outage end, Zamboanga local time (exclusive) */
  end: DateInput;
}

export interface SunProfile {
  /** kWh produced per kWp of panels: monthly[month 0–11][hour 0–23] */
  monthly: number[][];
  /** Where the numbers came from, shown in the quote */
  source: string;
  /** True for the built-in placeholder, which triggers a warning */
  isPlaceholder?: boolean;
}

/** One row from the operational inverter export (.xlsx) */
export interface SunOutputRow {
  'Device Name'?: string;
  Time: DateInput;
  [column: string]: unknown;
}

export interface QuoteDefaults {
  electricityRate: number;          // PHP/kWh paid on import
  generationCharge: number;         // PHP/kWh credited on export
  panelPrice: number;               // PHP per panel
  panelWatts: number;               // W per panel
  inverterPrice: number;            // PHP per inverter
  inverterKw: number;               // kW per inverter (paralleled)
  batteryPrice: number;             // PHP per battery unit
  batteryUnitKwh: number;           // kWh per battery unit
  laborCost: number;                // PHP per job
  mountingCablingRate: number;      // fraction of (panels + batteries + inverters)
  miscCost: number;                 // PHP per job
  targetReduction: number;          // 0.95 = 95% bill reduction
  batteryReserve: number;           // 0.4 = 40% kept back in normal operation
  outagePercentile: number;         // 0.8 = 80th percentile
  systemLossFactor: number;         // 1 = no losses; ~0.8 = 20% losses
  batteryRoundTripEfficiency: number; // 1 = lossless; ~0.9 typical lithium
  minBatteryUnits: number;          // floor for a hybrid quote
  reserveAppliesDuringOutages: boolean; // true = reserve is never used, even in outages
  creditRollover: boolean;          // unused export credit carries to next month
  maxDcAcRatio: number;             // warn above this panel kW / inverter kW
  maxPanels: number;                // search ceiling for panel sizing
}

export interface CalculatorInput extends Partial<QuoteDefaults> {
  /** REQUIRED: at least 168 hourly readings (1 week). May be longer. */
  consumption: HourlyReading[];
  /** OPTIONAL: outage history, e.g. from scripts/buildOutageHistory.ts */
  outages?: OutageEvent[];
  /** OPTIONAL: defaults to the profile built from your inverter log */
  sunProfile?: SunProfile | number[] | number[][];
  /** OPTIONAL: only needed if consumption timestamps are numeric dates like 04/09/2026 */
  dateOrder?: DateOrder;
}

export interface MonthlyBill {
  month: string;            // "2025-09"
  consumptionKwh: number;
  importKwh: number;
  exportKwh: number;
  billBefore: number;       // PHP, no solar
  billAfter: number;        // PHP, after credits
  creditCarriedOut: number; // PHP of unused credit carried to the next month
}

export interface QuoteResult {
  battery: {
    requiredKwh: number;        // 80th percentile of outage needs
    sizingKwh: number;          // requiredKwh, or requiredKwh / (1 − reserve) if the reserve is untouchable
    units: number;
    installedKwh: number;
    dailyUsableKwh: number;     // installed × (1 − reserve)
    outagesAnalyzed: number;
    outagesSkipped: number;
    needStats: { min: number; median: number; p80: number; max: number };
    /** Date used for each weekday (the highest-consumption complete day) */
    referenceDays: Record<string, string | null>;
  };
  panels: { count: number; wattsEach: number; systemKw: number };
  inverter: {
    count: number;
    ratingKwEach: number;
    totalKw: number;
    peakHourlyLoadKwh: number;
    dcAcRatio: number;
  };
  simulation: {
    start: string;
    end: string;
    sunProfileSource: string;
    sizingIterations: number;
    converged: boolean;
  };
  energy: {
    annualConsumptionKwh: number;
    annualSolarKwh: number;
    annualImportKwh: number;
    annualExportKwh: number;
    annualCurtailedKwh: number;
    exportToImportRatio: number;
  };
  outageCoverage: {
    eventsInSimulatedYear: number;
    eventsFullyCovered: number;
    unmetLoadKwh: number;
  };
  bill: {
    annualBefore: number;
    annualAfter: number;
    reductionPercent: number;
    averageMonthlyBefore: number;
    averageMonthlyAfter: number;
    unusedCreditAtYearEnd: number;
    monthly: MonthlyBill[];
  };
  pricing: {
    panels: number;
    inverters: number;
    batteries: number;
    mountingCabling: number;
    labor: number;
    misc: number;
    total: number;
  };
  /** Problems you should act on */
  warnings: string[];
  /** Informational: how the quote was built */
  notes: string[];
}

// ─────────────────────────────────────────────────────────────
// Defaults & constants
// ─────────────────────────────────────────────────────────────

export const ZAMBOANGA_DEFAULTS: QuoteDefaults = {
  electricityRate: 13.4668,
  generationCharge: 8.47,
  panelPrice: 5173.96,
  panelWatts: 720,
  inverterPrice: 44366.12,
  inverterKw: 12,
  batteryPrice: 61237.75,
  batteryUnitKwh: 10,
  laborCost: 20625,
  mountingCablingRate: 0.4,
  miscCost: 1500,
  targetReduction: 0.95,
  batteryReserve: 0.4,
  outagePercentile: 0.8,
  systemLossFactor: 1,
  batteryRoundTripEfficiency: 1,
  minBatteryUnits: 1,
  reserveAppliesDuringOutages: false,
  creditRollover: true,
  maxDcAcRatio: 1.3,
  maxPanels: 300,
};

const MIN_HOURS = 168;
const MAX_ITERATIONS = 10;
const HOUR_MS = 3600000;
const DAY_MS = 86400000;
const ZAMBOANGA_OFFSET_MIN = 480; // UTC+8
const WEEKDAY_NAMES = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
];

// ─────────────────────────────────────────────────────────────
// Wall-clock time
// A time is stored as "milliseconds of Zamboanga wall-clock time", built with
// Date.UTC and read back with getUTC*. No device timezone is ever involved.
// ─────────────────────────────────────────────────────────────

interface WallParts {
  year: number; month: number; day: number; // month 1–12
  hour: number; minute: number; second: number;
  weekday: number; // 0 = Sunday
}

function wallMs(y: number, mo: number, d: number, h = 0, mi = 0, s = 0): number {
  return Date.UTC(y, mo - 1, d, h, mi, s);
}

function wallParts(ms: number): WallParts {
  const d = new Date(ms);
  return {
    year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(),
    hour: d.getUTCHours(), minute: d.getUTCMinutes(), second: d.getUTCSeconds(),
    weekday: d.getUTCDay(),
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "2026-09-04T16:00:00" — unambiguous, no timezone suffix. */
export function formatWallTime(ms: number): string {
  const p = wallParts(ms);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
}

function dayKey(ms: number): string {
  return formatWallTime(ms).slice(0, 10);
}

// ─────────────────────────────────────────────────────────────
// Date parsing (explicit formats, no Date.parse)
// ─────────────────────────────────────────────────────────────

const MONTH_NAMES: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

const TIME = String.raw`(?:[T\s,]+(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(?:([AaPp])\.?\s*[Mm]\.?)?)?`;
const ZONE = String.raw`\s*(Z|[+-]\d{2}:?\d{2})?`;
const RE_YMD = new RegExp(String.raw`^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})` + TIME + ZONE + '$');
const RE_NUMERIC = new RegExp(String.raw`^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})` + TIME + ZONE + '$');
const RE_D_MON_Y = new RegExp(String.raw`^(\d{1,2})[-\s/.]+([A-Za-z]{3,9})\.?[-\s/.,]+(\d{4}|\d{2})` + TIME + ZONE + '$');
const RE_MON_D_Y = new RegExp(String.raw`^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})` + TIME + ZONE + '$');

function monthFromName(name: string): number | undefined {
  const key = name.toLowerCase();
  return MONTH_NAMES[key] ?? MONTH_NAMES[key.slice(0, 3)];
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function build(
  y: number, mo: number, d: number,
  hStr: string | undefined, miStr: string | undefined, sStr: string | undefined,
  ampm: string | undefined, zone: string | undefined, original: string,
): number {
  if (y < 100) y += 2000;
  let h = hStr ? Number(hStr) : 0;
  const mi = miStr ? Number(miStr) : 0;
  const s = sStr ? Number(sStr) : 0;
  if (ampm) {
    if (h < 1 || h > 12) throw new Error(`Invalid 12-hour time in "${original}"`);
    const pm = ampm.toLowerCase() === 'p';
    if (h === 12) h = pm ? 12 : 0;
    else if (pm) h += 12;
  }
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) {
    throw new Error(`Invalid calendar date in "${original}"`);
  }
  const endOfDay = h === 24 && mi === 0 && s === 0; // "24:00" = next midnight
  if ((h > 23 && !endOfDay) || mi > 59 || s > 59) throw new Error(`Invalid time in "${original}"`);
  let ms = wallMs(y, mo, d, endOfDay ? 0 : h, mi, s) + (endOfDay ? DAY_MS : 0);
  if (zone) {
    // Explicit UTC or offset: convert to Zamboanga wall-clock time.
    let offsetMin = 0;
    if (zone !== 'Z') {
      const sign = zone[0] === '-' ? -1 : 1;
      const digits = zone.slice(1).replace(':', '');
      offsetMin = sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2)));
    }
    ms += (ZAMBOANGA_OFFSET_MIN - offsetMin) * 60000;
  }
  return ms;
}

/**
 * Parses a date/time into Zamboanga wall-clock milliseconds.
 * Accepts:
 *  - text: 2026-09-04 16:00[:00], 2026/09/04 4:00 PM, 09/04/2026 16:00 (needs dateOrder
 *    when the day is 12 or under), 4-Sep-2026 16:00, Sep 4, 2026 4:00 PM,
 *    and ISO strings with Z or +08:00 (converted to Zamboanga time)
 *  - numbers: Excel serial dates (e.g. 46269.6667)
 *  - Date objects: read as local wall-clock time (what SheetJS produces with cellDates)
 * Throws on anything else. It never guesses.
 */
export function parseZamboangaDateTime(value: DateInput, dateOrder?: DateOrder): number {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error('Invalid Date object');
    const ms = wallMs(
      value.getFullYear(), value.getMonth() + 1, value.getDate(),
      value.getHours(), value.getMinutes(), value.getSeconds(),
    ) + value.getMilliseconds();
    return Math.round(ms / 1000) * 1000;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 20000 || value > 2958465) {
      throw new Error(`Number ${value} is not an Excel serial date`);
    }
    // Excel serial: days since 1899-12-30, stored without timezone.
    return Math.round((value - 25569) * 86400) * 1000;
  }
  const text = String(value).trim();
  let m = RE_YMD.exec(text);
  if (m) return build(+m[1], +m[2], +m[3], m[4], m[5], m[6], m[7], m[8], text);

  m = RE_NUMERIC.exec(text);
  if (m) {
    const a = +m[1];
    const b = +m[2];
    let order = dateOrder;
    if (!order) {
      if (a > 12 && b <= 12) order = 'DMY';
      else if (b > 12 && a <= 12) order = 'MDY';
      else if (a === b) order = 'MDY';
      else {
        throw new Error(
          `Ambiguous date "${text}": set dateOrder to 'DMY' (day first) or 'MDY' (month first)`,
        );
      }
    }
    const [mo, d] = order === 'DMY' ? [b, a] : [a, b];
    return build(+m[3], mo, d, m[4], m[5], m[6], m[7], m[8], text);
  }

  m = RE_D_MON_Y.exec(text);
  if (m) {
    const mo = monthFromName(m[2]);
    if (mo) return build(+m[3], mo, +m[1], m[4], m[5], m[6], m[7], m[8], text);
  }
  m = RE_MON_D_Y.exec(text);
  if (m) {
    const mo = monthFromName(m[1]);
    if (mo) return build(+m[3], mo, +m[2], m[4], m[5], m[6], m[7], m[8], text);
  }
  throw new Error(`Unrecognized date/time: "${text}"`);
}

/**
 * Looks across all values in a file and decides whether numeric dates are day-first
 * or month-first. Returns undefined if no value settles it (all days 12 or under).
 * Throws if the file mixes both.
 */
export function detectDateOrder(values: DateInput[]): DateOrder | undefined {
  let dmy = false;
  let mdy = false;
  for (const v of values) {
    if (typeof v !== 'string') continue;
    const m = RE_NUMERIC.exec(v.trim());
    if (!m) continue;
    if (+m[1] > 12) dmy = true;
    if (+m[2] > 12) mdy = true;
  }
  if (dmy && mdy) throw new Error('Dates mix day-first and month-first formats');
  return dmy ? 'DMY' : mdy ? 'MDY' : undefined;
}

// ─────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * p;
  const lower = Math.floor(pos);
  const upper = Math.ceil(pos);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (pos - lower);
}

function median(values: number[]): number {
  return percentile(values, 0.5);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function maxOf(values: number[]): number {
  let m = -Infinity;
  for (const v of values) if (v > m) m = v;
  return m;
}

function normalizeName(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase();
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}

// ─────────────────────────────────────────────────────────────
// Outage CSV parser
// ─────────────────────────────────────────────────────────────

/** RFC 4180 CSV: quoted fields, escaped quotes, commas and newlines inside quotes, BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

export interface OutageParseResult {
  /** Clean events with unambiguous "YYYY-MM-DDTHH:mm:ss" times */
  outages: OutageEvent[];
  /** Rows that could not be used, with the reason (nothing is dropped silently) */
  skipped: { line: number; reason: string; raw: string }[];
  duplicatesRemoved: number;
  /** Row count per location in the whole file, before filtering */
  locations: Record<string, number>;
  dateOrder?: DateOrder;
  firstStart?: string;
  lastEnd?: string;
  warnings: string[];
}

/**
 * Parses the outage history CSV: location, datetime start, datetime end.
 * Works with or without a header row. Location matching ignores case and extra spaces
 * and is exact, so "Zamboanga" does not also match "Zamboanga Sibugay".
 */
export function parseOutageCsv(
  csvText: string,
  options: { locations?: string | string[]; dateOrder?: DateOrder } = {},
): OutageParseResult {
  const rows = parseCsv(csvText);
  const warnings: string[] = [];
  const skipped: OutageParseResult['skipped'] = [];
  if (rows.length === 0) {
    return { outages: [], skipped, duplicatesRemoved: 0, locations: {}, warnings: ['Outage file is empty.'] };
  }

  // Header row: the start column has no digits.
  let locIdx = 0;
  let startIdx = 1;
  let endIdx = 2;
  let firstData = 0;
  if (!/\d/.test(rows[0][1] ?? '')) {
    firstData = 1;
    const headers = rows[0].map(normalizeName);
    const find = (word: string) => headers.findIndex((h) => h.includes(word));
    if (find('start') >= 0 && find('end') >= 0) {
      startIdx = find('start');
      endIdx = find('end');
      locIdx = find('location');
    }
  }
  const dataRows = rows.slice(firstData);

  const dateOrder = options.dateOrder ??
    detectDateOrder(dataRows.flatMap((r) => [r[startIdx], r[endIdx]]).filter((v) => v !== undefined));

  const wanted = options.locations === undefined
    ? undefined
    : new Set((Array.isArray(options.locations) ? options.locations : [options.locations]).map(normalizeName));

  const locations: Record<string, number> = {};
  const seen = new Set<string>();
  let duplicatesRemoved = 0;
  const outages: OutageEvent[] = [];
  let first = Infinity;
  let last = -Infinity;

  dataRows.forEach((r, i) => {
    const line = i + firstData + 1;
    const raw = r.join(',');
    const location = locIdx >= 0 ? (r[locIdx] ?? '').trim() : '';
    if (location) locations[location] = (locations[location] ?? 0) + 1;
    if (wanted && !wanted.has(normalizeName(location))) return;

    const startText = r[startIdx]?.trim();
    const endText = r[endIdx]?.trim();
    if (!startText || !endText) {
      skipped.push({ line, reason: 'Missing start or end', raw });
      return;
    }
    let start: number;
    let end: number;
    try {
      start = parseZamboangaDateTime(startText, dateOrder);
      end = parseZamboangaDateTime(endText, dateOrder);
    } catch (e) {
      skipped.push({ line, reason: (e as Error).message, raw });
      return;
    }
    if (end <= start) {
      skipped.push({ line, reason: 'End is not after start', raw });
      return;
    }
    const key = `${normalizeName(location)}|${start}|${end}`;
    if (seen.has(key)) { duplicatesRemoved++; return; }
    seen.add(key);
    first = Math.min(first, start);
    last = Math.max(last, end);
    outages.push({ location: location || undefined, start: formatWallTime(start), end: formatWallTime(end) });
  });

  if (wanted && outages.length === 0 && skipped.length === 0) {
    warnings.push(
      `No rows matched the location filter. Locations in the file: ${Object.keys(locations).join(', ')}`,
    );
  }
  if (!wanted && Object.keys(locations).length > 1) {
    warnings.push(
      `The file has ${Object.keys(locations).length} locations and no filter was set, so all of them are used.`,
    );
  }
  if (skipped.length > 0) warnings.push(`${skipped.length} outage rows could not be read (see skipped).`);

  return {
    outages, skipped, duplicatesRemoved, locations, dateOrder,
    firstStart: outages.length ? formatWallTime(first) : undefined,
    lastEnd: outages.length ? formatWallTime(last) : undefined,
    warnings,
  };
}

// ─────────────────────────────────────────────────────────────
// Sun profile from the inverter log (.xlsx rows)
// ─────────────────────────────────────────────────────────────

export interface SunProfileBuildOptions {
  deviceName?: string;
  /** Size of the logged system in kWp. Default 3 × 650 W = 1.95 */
  sourceSystemKwp?: number;
  /** Power columns to add together. Default ['PV1 Input Power (kW)'] */
  powerColumns?: string[];
  /** Gaps longer than this are treated as missing data. Default 2 × the logging interval */
  maxGapMinutes?: number;
  /** A day counts only if the log covers this share of 06:00–18:00. Default 0.9 */
  minDaylightCoverage?: number;
  dateOrder?: DateOrder;
}

export interface SunProfileBuildResult {
  profile: SunProfile;
  /** Days used per calendar month (index 0 = January) */
  daysUsedByMonth: number[];
  daysExcluded: number;
  rowsSkipped: number;
  /** Readings with the same timestamp (e.g. overlapping exports), counted once */
  duplicatesMerged: number;
  firstDay: string;
  lastDay: string;
  sampleIntervalMinutes: number;
  /** kWh per kWp per day, per calendar month */
  dailyYieldByMonth: number[];
  warnings: string[];
}

export function buildSunProfile(
  rows: SunOutputRow[],
  options: SunProfileBuildOptions = {},
): SunProfileBuildResult {
  const kwp = options.sourceSystemKwp ?? 1.95;
  const powerColumns = options.powerColumns ?? ['PV1 Input Power (kW)'];
  const minCoverage = options.minDaylightCoverage ?? 0.9;
  const warnings: string[] = [];

  // Device selection
  const devices = [...new Set(rows.map((r) => String(r['Device Name'] ?? '').trim()).filter(Boolean))];
  let selected = rows;
  if (options.deviceName) {
    const want = normalizeName(options.deviceName);
    selected = rows.filter((r) => normalizeName(String(r['Device Name'] ?? '')) === want);
    if (selected.length === 0) {
      throw new Error(`Device "${options.deviceName}" not found. Devices: ${devices.join(', ')}`);
    }
  } else if (devices.length > 1) {
    throw new Error(`Multiple devices found (${devices.join(', ')}). Pass deviceName to choose one.`);
  }

  // Other PV inputs that carry power but are not counted
  const otherPv = new Set<string>();
  for (const r of selected) {
    for (const [k, v] of Object.entries(r)) {
      if (/^PV\d+ .*Power/i.test(k) && !powerColumns.includes(k) && Number(v) > 0) otherPv.add(k);
    }
  }
  if (otherPv.size > 0) {
    warnings.push(
      `Columns ${[...otherPv].join(', ')} also carry power but are not counted. ` +
      'Add them to powerColumns if they belong to the same 1.95 kWp system.',
    );
  }

  const dateOrder = options.dateOrder ?? detectDateOrder(selected.map((r) => r.Time));

  // Parse samples
  let rowsSkipped = 0;
  const parsed: { t: number; kW: number }[] = [];
  for (const r of selected) {
    if (r.Time === undefined || r.Time === null || r.Time === '') { rowsSkipped++; continue; }
    let t: number;
    try { t = parseZamboangaDateTime(r.Time, dateOrder); } catch { rowsSkipped++; continue; }
    let kW = 0;
    let ok = true;
    for (const c of powerColumns) {
      const raw = r[c];
      const v = raw === undefined || raw === null || raw === '' ? NaN : Number(raw);
      if (!Number.isFinite(v)) { ok = false; break; }
      kW += Math.max(0, v);
    }
    if (!ok) { rowsSkipped++; continue; }
    parsed.push({ t, kW });
  }
  if (rowsSkipped > 0) warnings.push(`${rowsSkipped} sun log rows had an unreadable time or power value and were skipped.`);
  parsed.sort((a, b) => a.t - b.t);
  const samples = parsed.filter((s, i) => i === 0 || s.t !== parsed[i - 1].t);
  const duplicatesMerged = parsed.length - samples.length;
  if (samples.length < 2) throw new Error('Not enough sun output readings to build a profile.');

  // Logging interval
  const gaps: number[] = [];
  for (let i = 1; i < samples.length; i++) gaps.push(samples[i].t - samples[i - 1].t);
  const interval = median(gaps);
  const maxGap = options.maxGapMinutes !== undefined ? options.maxGapMinutes * 60000 : 2 * interval;

  // Integrate power over time, split exactly at hour boundaries.
  const days = new Map<string, { month: number; energy: number[]; daylightMs: number }>();
  const dayEntry = (ms: number) => {
    const key = dayKey(ms);
    let e = days.get(key);
    if (!e) {
      e = { month: wallParts(ms).month - 1, energy: new Array(24).fill(0), daylightMs: 0 };
      days.set(key, e);
    }
    return e;
  };
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const gap = i + 1 < samples.length ? samples[i + 1].t - s.t : interval;
    const duration = gap <= maxGap ? gap : interval; // a long gap is missing data, not energy
    let t = s.t;
    const end = s.t + duration;
    while (t < end) {
      const hourEnd = Math.floor(t / HOUR_MS) * HOUR_MS + HOUR_MS;
      const segEnd = Math.min(end, hourEnd);
      const e = dayEntry(t);
      const hour = wallParts(t).hour;
      e.energy[hour] += s.kW * (segEnd - t) / HOUR_MS;
      if (hour >= 6 && hour < 18) e.daylightMs += segEnd - t;
      t = segEnd;
    }
  }

  // Average per month over days with good daylight coverage
  const sums = Array.from({ length: 12 }, () => new Array(24).fill(0));
  const daysUsedByMonth = new Array(12).fill(0);
  let daysExcluded = 0;
  for (const e of days.values()) {
    if (e.daylightMs < minCoverage * 12 * HOUR_MS) { daysExcluded++; continue; }
    daysUsedByMonth[e.month]++;
    e.energy.forEach((kWh, h) => { sums[e.month][h] += kWh; });
  }
  const totalDays = daysUsedByMonth.reduce((a, b) => a + b, 0);
  if (totalDays === 0) throw new Error('No day in the sun log has enough daylight coverage to use.');

  const allMonths = new Array(24).fill(0);
  sums.forEach((row) => row.forEach((v, h) => { allMonths[h] += v; }));
  const overall = allMonths.map((v) => v / totalDays / kwp);

  const missing: string[] = [];
  const monthly = sums.map((row, m) => {
    if (daysUsedByMonth[m] === 0) {
      missing.push(MONTH_LABELS[m]);
      return [...overall];
    }
    return row.map((v) => v / daysUsedByMonth[m] / kwp);
  });
  if (missing.length > 0) {
    warnings.push(`No usable sun data for ${missing.join(', ')}. The all-month average is used for those months.`);
  }
  if (daysExcluded > 0) {
    warnings.push(`${daysExcluded} days were left out because the log covered less than ${minCoverage * 100}% of daylight hours.`);
  }

  const dailyYieldByMonth = monthly.map((row) => round2(row.reduce((a, b) => a + b, 0)));
  const avgYield = overall.reduce((a, b) => a + b, 0);
  if (avgYield < 2.5 || avgYield > 7) {
    warnings.push(
      `Average yield is ${avgYield.toFixed(2)} kWh/kWp/day, outside the usual 3–6 range. ` +
      'Check that power is in kW and that the logged system is 1.95 kWp.',
    );
  }

  return {
    profile: {
      monthly,
      source: `Inverter log, ${totalDays} days, ${kwp} kWp reference system`,
    },
    daysUsedByMonth,
    daysExcluded,
    rowsSkipped,
    duplicatesMerged,
    firstDay: dayKey(samples[0].t),
    lastDay: dayKey(samples[samples.length - 1].t),
    sampleIntervalMinutes: round2(interval / 60000),
    dailyYieldByMonth,
    warnings,
  };
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function normalizeSunProfile(input: CalculatorInput['sunProfile']): SunProfile {
  const src = input ?? ZAMBOANGA_SUN_PROFILE;
  let profile: SunProfile;
  if (Array.isArray(src)) {
    if (src.length === 24 && src.every((v) => typeof v === 'number')) {
      profile = { monthly: Array.from({ length: 12 }, () => [...(src as number[])]), source: '24-hour profile' };
    } else {
      profile = { monthly: src as number[][], source: '12 × 24 profile' };
    }
  } else {
    profile = src;
  }
  const ok = profile.monthly.length === 12 &&
    profile.monthly.every((row) => row.length === 24 && row.every((v) => Number.isFinite(v) && v >= 0));
  if (!ok) throw new Error('sunProfile must be 24 values or 12 months × 24 values, all ≥ 0.');
  return profile;
}

// ─────────────────────────────────────────────────────────────
// Consumption and the reference week
// ─────────────────────────────────────────────────────────────

interface ReferenceWeek {
  /** hourly[weekday][hour] = kWh on the reference day for that weekday */
  hourly: number[][];
  /** Date chosen for each weekday (null where a fallback was used) */
  dates: (string | null)[];
  fallbackWeekdays: number[];
  firstDay: number; // wall ms of the first consumption day
  recordedMonths: number[];
}

function parseConsumption(readings: HourlyReading[], dateOrder?: DateOrder, warnings: string[] = []) {
  if (readings.length < MIN_HOURS) {
    throw new Error(`At least ${MIN_HOURS} hourly readings (1 week) are required; got ${readings.length}.`);
  }
  const order = dateOrder ?? detectDateOrder(readings.map((r) => r.timestamp));
  const byHour = new Map<number, number>();
  readings.forEach((r, i) => {
    let t: number;
    try { t = parseZamboangaDateTime(r.timestamp, order); } catch (e) {
      throw new Error(`Consumption row ${i + 1}: ${(e as Error).message}`);
    }
    if (t % HOUR_MS !== 0) throw new Error(`Consumption row ${i + 1}: timestamp ${formatWallTime(t)} is not on the hour.`);
    if (!Number.isFinite(r.kWh) || r.kWh < 0) throw new Error(`Consumption row ${i + 1}: kWh must be a number ≥ 0.`);
    if (byHour.has(t)) throw new Error(`Consumption row ${i + 1}: duplicate hour ${formatWallTime(t)}.`);
    byHour.set(t, r.kWh);
  });
  const times = [...byHour.keys()].sort((a, b) => a - b);
  const spanHours = (times[times.length - 1] - times[0]) / HOUR_MS + 1;
  if (spanHours > times.length) {
    warnings.push(`${spanHours - times.length} hours are missing from the consumption data. Days with gaps are not used as reference days.`);
  }
  return byHour;
}

/**
 * For each weekday, keeps the complete (24-hour) calendar day with the highest total.
 * Days are grouped by Zamboanga calendar date, midnight to midnight.
 */
function buildReferenceWeek(byHour: Map<number, number>): ReferenceWeek {
  const days = new Map<number, { hours: number[]; count: number; total: number }>();
  for (const [t, kWh] of byHour) {
    const day = Math.floor(t / DAY_MS) * DAY_MS;
    let d = days.get(day);
    if (!d) { d = { hours: new Array(24).fill(0), count: 0, total: 0 }; days.set(day, d); }
    d.hours[wallParts(t).hour] = kWh;
    d.count++;
    d.total += kWh;
  }
  const complete = [...days.entries()].filter(([, d]) => d.count === 24).sort((a, b) => a[0] - b[0]);
  if (complete.length === 0) throw new Error('The consumption data has no complete 24-hour day.');

  const best: ([number, { hours: number[]; total: number }] | null)[] = new Array(7).fill(null);
  let overall = complete[0];
  for (const entry of complete) {
    const wd = wallParts(entry[0]).weekday;
    if (!best[wd] || entry[1].total > best[wd]![1].total) best[wd] = entry;
    if (entry[1].total > overall[1].total) overall = entry;
  }
  const fallbackWeekdays: number[] = [];
  const hourly = best.map((b, wd) => {
    if (b) return b[1].hours;
    fallbackWeekdays.push(wd);
    return overall[1].hours;
  });
  const recordedMonths = [...new Set([...days.keys()].map((d) => wallParts(d).month - 1))];
  return {
    hourly,
    dates: best.map((b) => (b ? dayKey(b[0]) : null)),
    fallbackWeekdays,
    firstDay: Math.min(...days.keys()),
    recordedMonths,
  };
}

// ─────────────────────────────────────────────────────────────
// Battery sizing from outages
// ─────────────────────────────────────────────────────────────

interface ParsedOutage { start: number; end: number }

/**
 * Battery energy one outage needs. Steps through each hour the outage touches
 * (partial hours prorated), using the reference-day load for that weekday and the
 * sun for that month. Surplus solar refills the battery only if it was drawn down
 * earlier in the outage, so the result is the deepest point of the running balance.
 */
function outageNeedKwh(
  o: ParsedOutage, ref: ReferenceWeek, sun: number[][], systemKw: number, cfg: QuoteDefaults,
): number {
  let need = 0;
  let peak = 0;
  for (let t = Math.floor(o.start / HOUR_MS) * HOUR_MS; t < o.end; t += HOUR_MS) {
    const f = (Math.min(t + HOUR_MS, o.end) - Math.max(t, o.start)) / HOUR_MS;
    if (f <= 0) continue;
    const p = wallParts(t);
    const load = ref.hourly[p.weekday][p.hour] * f;
    const gen = systemKw * sun[p.month - 1][p.hour] * cfg.systemLossFactor * f;
    const net = load - gen;
    need = Math.max(0, need + (net > 0 ? net : net * cfg.batteryRoundTripEfficiency));
    peak = Math.max(peak, need);
  }
  return peak;
}

function sizeBattery(
  outages: ParsedOutage[], ref: ReferenceWeek, sun: number[][], systemKw: number, cfg: QuoteDefaults,
) {
  const needs = outages.map((o) => outageNeedKwh(o, ref, sun, systemKw, cfg));
  const requiredKwh = needs.length ? percentile(needs, cfg.outagePercentile) : 0;
  const sizingKwh = cfg.reserveAppliesDuringOutages ? requiredKwh / (1 - cfg.batteryReserve) : requiredKwh;
  const units = Math.max(cfg.minBatteryUnits, Math.ceil(sizingKwh / cfg.batteryUnitKwh - 1e-9));
  return { needs, requiredKwh, sizingKwh, units, installedKwh: units * cfg.batteryUnitKwh };
}

// ─────────────────────────────────────────────────────────────
// One-year simulation and monthly billing
// ─────────────────────────────────────────────────────────────

interface SimHour {
  monthIdx: number;   // 0–11 within the simulated year
  load: number;       // kWh
  sunPerKwp: number;  // kWh per kWp
  outFrac: number;    // share of the hour with the grid down
  outageId: number;   // -1 if none
}

interface SimContext {
  hours: SimHour[];
  monthLabels: string[];
  start: number;
  end: number;
  outageCount: number;
}

/**
 * The simulated year is the 12 calendar months before the month the consumption was
 * recorded. Each hour takes the reference-week load for its weekday, the sun for its
 * month, and any historical outage that fell in it.
 */
function buildSimContext(ref: ReferenceWeek, sun: number[][], outages: ParsedOutage[]): SimContext {
  const first = wallParts(ref.firstDay);
  const end = wallMs(first.year, first.month, 1);
  const start = wallMs(first.year - 1, first.month, 1);
  const monthLabels: string[] = [];
  const hours: SimHour[] = [];
  for (let t = start; t < end; t += HOUR_MS) {
    const p = wallParts(t);
    const label = `${p.year}-${pad(p.month)}`;
    if (monthLabels[monthLabels.length - 1] !== label) monthLabels.push(label);
    hours.push({
      monthIdx: monthLabels.length - 1,
      load: ref.hourly[p.weekday][p.hour],
      sunPerKwp: sun[p.month - 1][p.hour],
      outFrac: 0,
      outageId: -1,
    });
  }
  let outageCount = 0;
  outages.forEach((o, id) => {
    if (o.end <= start || o.start >= end) return;
    outageCount++;
    for (let t = Math.max(start, Math.floor(o.start / HOUR_MS) * HOUR_MS); t < Math.min(o.end, end); t += HOUR_MS) {
      const f = (Math.min(t + HOUR_MS, o.end) - Math.max(t, o.start)) / HOUR_MS;
      if (f <= 0) continue;
      const h = hours[(t - start) / HOUR_MS];
      h.outFrac = Math.min(1, h.outFrac + f);
      h.outageId = id;
    }
  });
  return { hours, monthLabels, start, end, outageCount };
}

interface SimResult {
  monthly: MonthlyBill[];
  loadKwh: number;
  solarKwh: number;
  importKwh: number;
  exportKwh: number;
  curtailedKwh: number;
  unmetKwh: number;
  baseline: number;
  billAfter: number;
  creditLeft: number;
  outageEvents: number;
  outageEventsUncovered: number;
}

function simulateYear(
  ctx: SimContext, systemKw: number, batteryKwh: number, inverterKw: number, cfg: QuoteDefaults,
): SimResult {
  const eff = cfg.batteryRoundTripEfficiency;
  const normalFloor = batteryKwh * cfg.batteryReserve;
  const outageFloor = cfg.reserveAppliesDuringOutages ? normalFloor : 0;
  let soc = normalFloor;

  const n = ctx.monthLabels.length;
  const mImport = new Array(n).fill(0);
  const mExport = new Array(n).fill(0);
  const mLoadUp = new Array(n).fill(0);
  const mLoad = new Array(n).fill(0);
  let solar = 0, curtailed = 0, unmet = 0;
  const uncovered = new Set<number>();

  for (const h of ctx.hours) {
    const gen = systemKw * h.sunPerKwp * cfg.systemLossFactor;
    solar += gen;
    mLoad[h.monthIdx] += h.load;
    // Split the hour into a grid-down part and a grid-up part.
    for (const [share, gridUp] of [[h.outFrac, false], [1 - h.outFrac, true]] as [number, boolean][]) {
      if (share <= 0) continue;
      const load = h.load * share;
      const g = gen * share;
      const limit = inverterKw * share; // inverter power limit for this part of the hour
      if (gridUp) mLoadUp[h.monthIdx] += load;
      if (g >= load) {
        const surplus = g - load;
        const charge = Math.min(surplus, limit, (batteryKwh - soc) / eff);
        soc += charge * eff;
        const rest = surplus - charge;
        if (gridUp) {
          const exp = Math.min(rest, limit);
          mExport[h.monthIdx] += exp;
          curtailed += rest - exp;
        } else {
          curtailed += rest; // grid down: nothing can be exported
        }
      } else {
        const deficit = load - g;
        const floor = gridUp ? normalFloor : outageFloor;
        const discharge = Math.max(0, Math.min(deficit, limit, soc - floor));
        soc -= discharge;
        const rest = deficit - discharge;
        if (gridUp) mImport[h.monthIdx] += rest;
        else if (rest > 1e-9) { unmet += rest; uncovered.add(h.outageId); }
      }
    }
  }

  // Monthly bills with optional credit rollover
  let carry = 0;
  let baseline = 0;
  let billAfter = 0;
  const monthly: MonthlyBill[] = ctx.monthLabels.map((month, i) => {
    const before = mLoadUp[i] * cfg.electricityRate;
    const cost = mImport[i] * cfg.electricityRate;
    const credit = mExport[i] * cfg.generationCharge + (cfg.creditRollover ? carry : 0);
    const bill = Math.max(0, cost - credit);
    carry = Math.max(0, credit - cost);
    baseline += before;
    billAfter += bill;
    return {
      month,
      consumptionKwh: round2(mLoad[i]),
      importKwh: round2(mImport[i]),
      exportKwh: round2(mExport[i]),
      billBefore: round2(before),
      billAfter: round2(bill),
      creditCarriedOut: round2(cfg.creditRollover ? carry : 0),
    };
  });

  return {
    monthly,
    loadKwh: mLoad.reduce((a, b) => a + b, 0),
    solarKwh: solar,
    importKwh: mImport.reduce((a, b) => a + b, 0),
    exportKwh: mExport.reduce((a, b) => a + b, 0),
    curtailedKwh: curtailed,
    unmetKwh: unmet,
    baseline,
    billAfter,
    creditLeft: cfg.creditRollover ? carry : 0,
    outageEvents: ctx.outageCount,
    outageEventsUncovered: uncovered.size,
  };
}

/** Fewest panels whose simulated annual bill is at most (1 − target) of the bill without solar. */
function sizePanels(
  ctx: SimContext, batteryKwh: number, inverterKw: number, cfg: QuoteDefaults,
): number {
  const kw = (count: number) => (count * cfg.panelWatts) / 1000;
  const meets = (count: number) => {
    const sim = simulateYear(ctx, kw(count), batteryKwh, inverterKw, cfg);
    return sim.billAfter <= sim.baseline * (1 - cfg.targetReduction) + 1e-6;
  };
  if (!meets(cfg.maxPanels)) {
    throw new Error(
      `A ${cfg.targetReduction * 100}% reduction cannot be reached with ${cfg.maxPanels} panels. ` +
      'Check the consumption and sun data, or raise maxPanels.',
    );
  }
  let lo = 0;            // known to fail (or zero panels)
  let hi = cfg.maxPanels; // known to meet
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (meets(mid)) hi = mid; else lo = mid;
  }
  return Math.max(1, hi);
}

// ─────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────

export function calculateQuote(input: CalculatorInput): QuoteResult {
  const { consumption, outages: rawOutages = [], sunProfile: sunInput, dateOrder, ...overrides } = input;
  const cfg: QuoteDefaults = { ...ZAMBOANGA_DEFAULTS, ...stripUndefined(overrides) };
  const warnings: string[] = [];
  const notes: string[] = [];

  if (cfg.batteryReserve < 0 || cfg.batteryReserve >= 1) throw new Error('batteryReserve must be between 0 and 1.');
  if (cfg.batteryRoundTripEfficiency <= 0 || cfg.batteryRoundTripEfficiency > 1) {
    throw new Error('batteryRoundTripEfficiency must be above 0 and at most 1.');
  }

  // Sun data
  const sunProfile = normalizeSunProfile(sunInput);
  const sun = sunProfile.monthly;
  if (sunProfile.isPlaceholder) {
    warnings.push('Using the placeholder sun profile. Run scripts/buildSunProfile.ts on your inverter log before quoting.');
  }

  // Consumption → reference week
  const byHour = parseConsumption(consumption, dateOrder, warnings);
  const ref = buildReferenceWeek(byHour);
  if (ref.fallbackWeekdays.length > 0) {
    warnings.push(
      `No complete day for ${ref.fallbackWeekdays.map((d) => WEEKDAY_NAMES[d]).join(', ')}. ` +
      'The highest-consumption complete day is used instead.',
    );
  }

  // Outages
  const outageOrder = detectDateOrder(rawOutages.flatMap((o) => [o.start, o.end]));
  const outages: ParsedOutage[] = [];
  let outagesSkipped = 0;
  for (const o of rawOutages) {
    try {
      const start = parseZamboangaDateTime(o.start, outageOrder);
      const end = parseZamboangaDateTime(o.end, outageOrder);
      if (end > start) outages.push({ start, end }); else outagesSkipped++;
    } catch { outagesSkipped++; }
  }
  if (outagesSkipped > 0) warnings.push(`${outagesSkipped} outage records could not be read and were skipped.`);
  if (outages.length === 0) {
    warnings.push(`No outage data. Battery set to the minimum of ${cfg.minBatteryUnits} unit(s).`);
  }

  // Inverters: peak one-hour consumption, 12 kW units in parallel
  const peakHourlyLoadKwh = maxOf([...byHour.values()]);
  const inverterCount = Math.max(1, Math.ceil(peakHourlyLoadKwh / cfg.inverterKw - 1e-9));
  const inverterTotalKw = inverterCount * cfg.inverterKw;

  // Simulated year
  const ctx = buildSimContext(ref, sun, outages);
  if (outages.length > 0 && ctx.outageCount === 0) {
    warnings.push(
      `No outage in the history falls in the simulated year (${formatWallTime(ctx.start).slice(0, 7)} to ` +
      `${formatWallTime(ctx.end - 1).slice(0, 7)}), so outages are not part of the bill simulation.`,
    );
  }

  // Battery ↔ panel iteration: battery depends on panel output during outages,
  // panel count depends on the battery's daily usable capacity.
  let battery = sizeBattery(outages, ref, sun, 0, cfg);
  let panels = sizePanels(ctx, battery.installedKwh, inverterTotalKw, cfg);
  const seen = new Map<number, number>([[battery.installedKwh, panels]]);
  let converged = false;
  let iterations = 1;
  for (; iterations <= MAX_ITERATIONS; iterations++) {
    const next = sizeBattery(outages, ref, sun, (panels * cfg.panelWatts) / 1000, cfg);
    if (next.installedKwh === battery.installedKwh) { battery = next; converged = true; break; }
    if (seen.has(next.installedKwh)) {
      // Oscillating between sizes: take the larger battery and its panel count.
      const largest = Math.max(battery.installedKwh, next.installedKwh);
      battery = largest === next.installedKwh ? next : battery;
      panels = seen.get(largest)!;
      warnings.push('Battery and panel sizing alternated between two answers; the larger battery was used.');
      converged = true;
      break;
    }
    battery = next;
    panels = sizePanels(ctx, battery.installedKwh, inverterTotalKw, cfg);
    seen.set(battery.installedKwh, panels);
  }
  if (!converged) warnings.push(`Battery and panel sizing did not settle after ${MAX_ITERATIONS} rounds.`);

  const systemKw = (panels * cfg.panelWatts) / 1000;
  const sim = simulateYear(ctx, systemKw, battery.installedKwh, inverterTotalKw, cfg);
  const reductionPercent = sim.baseline > 0 ? (1 - sim.billAfter / sim.baseline) * 100 : 0;

  const dcAcRatio = systemKw / inverterTotalKw;
  if (dcAcRatio > cfg.maxDcAcRatio) {
    warnings.push(
      `Panel capacity is ${dcAcRatio.toFixed(2)}× the inverter capacity (limit ${cfg.maxDcAcRatio}). ` +
      'Check the inverter PV input rating or add an inverter.',
    );
  }
  if (sim.outageEventsUncovered > 0) {
    warnings.push(
      `${sim.outageEventsUncovered} of ${sim.outageEvents} outages in the simulated year were not fully covered ` +
      `(${round2(sim.unmetKwh)} kWh unmet). That is expected near the ${cfg.outagePercentile * 100}th-percentile cut-off.`,
    );
  }

  // Notes
  const recorded = ref.recordedMonths.map((m) => MONTH_LABELS[m]).join(', ');
  notes.push(
    `The consumption recorded in ${recorded} is repeated across the whole year, so seasonal ` +
    'changes in load (e.g. more air-conditioning in April–May) are not captured.',
  );
  notes.push('Billing uses the reference week (the highest-consumption day per weekday), so the "before" bill is an upper estimate.');
  notes.push('Inverters are sized on the highest hourly kWh. Short peaks within an hour can be higher.');
  notes.push(`Battery starts the simulated year at the ${cfg.batteryReserve * 100}% reserve level.`);

  // Pricing
  const panelCost = panels * cfg.panelPrice;
  const inverterCost = inverterCount * cfg.inverterPrice;
  const batteryCost = battery.units * cfg.batteryPrice;
  const mountingCost = cfg.mountingCablingRate * (panelCost + batteryCost + inverterCost);
  const total = panelCost + inverterCost + batteryCost + mountingCost + cfg.laborCost + cfg.miscCost;

  const months = sim.monthly.length;
  const needs = battery.needs;
  return {
    battery: {
      requiredKwh: round2(battery.requiredKwh),
      sizingKwh: round2(battery.sizingKwh),
      units: battery.units,
      installedKwh: battery.installedKwh,
      dailyUsableKwh: round2(battery.installedKwh * (1 - cfg.batteryReserve)),
      outagesAnalyzed: outages.length,
      outagesSkipped,
      needStats: needs.length
        ? {
          min: round2(Math.min(...needs)),
          median: round2(median(needs)),
          p80: round2(percentile(needs, cfg.outagePercentile)),
          max: round2(maxOf(needs)),
        }
        : { min: 0, median: 0, p80: 0, max: 0 },
      referenceDays: Object.fromEntries(WEEKDAY_NAMES.map((name, i) => [name, ref.dates[i]])),
    },
    panels: { count: panels, wattsEach: cfg.panelWatts, systemKw: round2(systemKw) },
    inverter: {
      count: inverterCount,
      ratingKwEach: cfg.inverterKw,
      totalKw: inverterTotalKw,
      peakHourlyLoadKwh: round2(peakHourlyLoadKwh),
      dcAcRatio: round2(dcAcRatio),
    },
    simulation: {
      start: formatWallTime(ctx.start),
      end: formatWallTime(ctx.end),
      sunProfileSource: sunProfile.source,
      sizingIterations: iterations,
      converged,
    },
    energy: {
      annualConsumptionKwh: round2(sim.loadKwh),
      annualSolarKwh: round2(sim.solarKwh),
      annualImportKwh: round2(sim.importKwh),
      annualExportKwh: round2(sim.exportKwh),
      annualCurtailedKwh: round2(sim.curtailedKwh),
      exportToImportRatio: cfg.generationCharge / cfg.electricityRate,
    },
    outageCoverage: {
      eventsInSimulatedYear: sim.outageEvents,
      eventsFullyCovered: sim.outageEvents - sim.outageEventsUncovered,
      unmetLoadKwh: round2(sim.unmetKwh),
    },
    bill: {
      annualBefore: round2(sim.baseline),
      annualAfter: round2(sim.billAfter),
      reductionPercent: round2(reductionPercent),
      averageMonthlyBefore: round2(sim.baseline / months),
      averageMonthlyAfter: round2(sim.billAfter / months),
      unusedCreditAtYearEnd: round2(sim.creditLeft),
      monthly: sim.monthly,
    },
    pricing: {
      panels: round2(panelCost),
      inverters: round2(inverterCost),
      batteries: round2(batteryCost),
      mountingCabling: round2(mountingCost),
      labor: cfg.laborCost,
      misc: cfg.miscCost,
      total: round2(total),
    },
    warnings,
    notes,
  };
}

/** Exposed for unit tests only. Not part of the public API. */
export const __test = {
  outageNeedKwh, buildReferenceWeek, parseConsumption, buildSimContext, simulateYear, sizePanels,
};
