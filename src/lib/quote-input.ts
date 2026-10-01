/**
 * Glue between staff-supplied files and calculator/src/solarQuoteCalculator.ts.
 * Pure functions only, so they run the same in the app and under tsx.
 */

import {
  ZAMBOANGA_DEFAULTS,
  parseCsv,
  type HourlyReading,
  type QuoteDefaults,
  type QuoteResult,
} from '@calculator/solarQuoteCalculator';

// ─────────────────────────────────────────────────────────────
// Consumption CSV
// ─────────────────────────────────────────────────────────────

export interface ConsumptionParseResult {
  readings: HourlyReading[];
  /** Rows that were left out, with the reason. Nothing is dropped silently. */
  skipped: { line: number; reason: string }[];
  /** How the columns were read, shown back to staff so a wrong guess is obvious */
  columns: string;
  totalKwh: number;
}

const isNumber = (s: string | undefined) => s !== undefined && s.trim() !== '' && Number.isFinite(toNumber(s));

/** "1,234.5" and " 0.62 " both read as numbers; anything else is NaN. */
function toNumber(s: string): number {
  const clean = s.trim().replace(/,/g, '');
  return clean === '' ? NaN : Number(clean);
}

/** A bare hour such as "7" or "07" becomes "07:00". */
function asTime(s: string): string {
  const t = s.trim();
  return /^\d{1,2}$/.test(t) ? `${t.padStart(2, '0')}:00` : t;
}

/**
 * Reads hourly consumption from a CSV. Accepts, with or without a header row:
 *   timestamp, kWh
 *   date, time (or hour 0–23), kWh
 * With a header, columns are found by name (timestamp/datetime, date, time/hour,
 * kWh/consumption/energy/usage); otherwise by position.
 */
export function parseConsumptionCsv(text: string): ConsumptionParseResult {
  const rows = parseCsv(text);
  const skipped: ConsumptionParseResult['skipped'] = [];
  if (rows.length === 0) return { readings: [], skipped, columns: 'empty file', totalKwh: 0 };

  const hasHeader = !rows[0].some((cell) => isNumber(cell));
  let tsIdx = -1;
  let dateIdx = -1;
  let timeIdx = -1;
  let kwhIdx = -1;

  if (hasHeader) {
    const h = rows[0].map((c) => c.trim().toLowerCase());
    // Meter exports pair each consumption column with a production one; never read production.
    kwhIdx = h.findIndex((c) => /consumption|usage|load/.test(c));
    if (kwhIdx < 0) kwhIdx = h.findIndex((c) => /kwh|energy/.test(c) && !/production|generation|export/.test(c));
    tsIdx = h.findIndex((c) => /timestamp|date ?time|date_time/.test(c));
    if (tsIdx < 0) {
      dateIdx = h.findIndex((c) => /date|day/.test(c));
      timeIdx = h.findIndex((c, i) => i !== dateIdx && /time|hour/.test(c));
      if (dateIdx < 0 || timeIdx < 0) {
        tsIdx = dateIdx >= 0 ? dateIdx : timeIdx >= 0 ? timeIdx : 0;
        dateIdx = timeIdx = -1;
      }
    }
    if (kwhIdx < 0) kwhIdx = h.length - 1;
  } else {
    const width = rows[0].length;
    // date, time, kWh — the middle column is a clock time or a bare hour
    if (width >= 3 && /^\d{1,2}(:\d{2})?(:\d{2})?\s*([AaPp][Mm])?$/.test(rows[0][1].trim())) {
      dateIdx = 0;
      timeIdx = 1;
      kwhIdx = 2;
    } else {
      tsIdx = 0;
      kwhIdx = 1;
    }
  }

  const header = hasHeader ? rows[0] : null;
  const name = (i: number) => (header ? `"${header[i]?.trim()}"` : `column ${i + 1}`);
  const columns =
    (tsIdx >= 0 ? `time from ${name(tsIdx)}` : `date from ${name(dateIdx)} + time from ${name(timeIdx)}`) +
    `, kWh from ${name(kwhIdx)}` +
    (hasHeader ? ', first row is a header' : ', no header row');

  const readings: HourlyReading[] = [];
  let totalKwh = 0;
  rows.slice(hasHeader ? 1 : 0).forEach((r, i) => {
    const line = i + (hasHeader ? 2 : 1);
    const timestamp = tsIdx >= 0 ? r[tsIdx]?.trim() : `${r[dateIdx]?.trim() ?? ''} ${asTime(r[timeIdx] ?? '')}`.trim();
    if (!timestamp) {
      skipped.push({ line, reason: 'No time' });
      return;
    }
    const kWh = toNumber(r[kwhIdx] ?? '');
    if (!Number.isFinite(kWh)) {
      skipped.push({ line, reason: `kWh "${r[kwhIdx] ?? ''}" is not a number` });
      return;
    }
    readings.push({ timestamp, kWh });
    totalKwh += kWh;
  });

  return { readings, skipped, columns, totalKwh };
}

// ─────────────────────────────────────────────────────────────
// Consumption .xlsx
// ─────────────────────────────────────────────────────────────

/** Excel serial date as "YYYY-MM-DD HH:mm", with no timezone applied. */
function serialToText(serial: number): string {
  const d = new Date(Math.round((serial - 25569) * 1440) * 60_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

const csvField = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/**
 * Turns the meter's consumption export into "timestamp,kWh" CSV for
 * parseConsumptionCsv, so it is saved and reloaded like a pasted file.
 * The header is DateTime followed by one consumption/production pair
 * (Phase A, B or C, or Total). The pair is often swapped by a CT clamp fitted
 * the wrong way round, so one column holds the reading and the other 0: every
 * row takes the larger of the two as consumption.
 */
export async function consumptionXlsxToCsv(data: ArrayBuffer): Promise<string> {
  const XLSX = await import('xlsx');
  // cellDates: false keeps real Excel dates as serials, converted above without a timezone.
  const workbook = XLSX.read(data, { type: 'array', cellDates: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error('The workbook has no sheets.');
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });

  const text = (c: unknown) => String(c ?? '').trim();
  const headerRow = grid.findIndex((r) => r.some((c) => /consumption/i.test(text(c))));
  if (headerRow < 0) throw new Error('No consumption column found in the first sheet.');
  const header = grid[headerRow].map(text);
  const timeIdx = header.findIndex((h) => /date ?time|timestamp/i.test(h));
  const kwhIdx = header.findIndex((h) => /consumption/i.test(h));
  const prodIdx = header.findIndex((h) => /production/i.test(h));
  if (timeIdx < 0) throw new Error('No DateTime column found next to the consumption column.');

  const column = prodIdx >= 0 ? `larger of ${header[kwhIdx]} / ${header[prodIdx]}` : header[kwhIdx];
  const lines = [`timestamp,${csvField(column)}`];
  for (const r of grid.slice(headerRow + 1)) {
    const time = r[timeIdx];
    const used = text(r[kwhIdx]);
    const prod = prodIdx >= 0 ? text(r[prodIdx]) : '';
    if (time == null && !used && !prod) continue;
    // A non-numeric cell is passed through so parseConsumptionCsv reports the row.
    const kwh = isNumber(prod) && (!isNumber(used) || toNumber(prod) > toNumber(used)) ? prod : used || prod;
    lines.push(`${csvField(typeof time === 'number' ? serialToText(time) : text(time))},${csvField(kwh)}`);
  }
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────
// Sample data
// ─────────────────────────────────────────────────────────────

/**
 * Two weeks of a plausible air-conditioned household from 7 Sep 2026: low
 * overnight, a midday bump, and an evening peak, with a little day-to-day
 * variation. For trying the calculator, never for a real quote.
 */
export function sampleConsumptionCsv(): string {
  const lines = ['timestamp,kWh'];
  for (let d = 0; d < 14; d++) {
    const date = `2026-09-${String(7 + d).padStart(2, '0')}`;
    const weekend = d % 7 >= 5;
    for (let h = 0; h < 24; h++) {
      let kWh = h < 6 ? 0.55 : h < 9 ? 0.9 : h < 17 ? (weekend ? 1.6 : 1.1) : h < 23 ? 2.4 : 0.8;
      kWh *= 1 + 0.06 * Math.sin(d * 1.7 + h * 0.9);
      lines.push(`${date} ${String(h).padStart(2, '0')}:00,${kWh.toFixed(2)}`);
    }
  }
  return lines.join('\n');
}

/** A handful of Zamboanga-style outages across the year before the sample week. */
export function sampleOutageCsv(): string {
  return [
    'Location,Datetime Start,Datetime End',
    'Zamboanga City,2025-10-14 17:00,2025-10-14 21:00',
    'Zamboanga City,2025-12-03 13:00,2025-12-03 15:30',
    'Zamboanga City,2026-02-22 19:00,2026-02-23 01:00',
    'Zamboanga City,2026-04-08 08:00,2026-04-08 12:00',
    'Zamboanga City,2026-05-27 18:30,2026-05-27 20:00',
    'Zamboanga City,2026-07-11 10:00,2026-07-11 16:00',
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────
// Assumptions
// ─────────────────────────────────────────────────────────────

type NumericKey = { [K in keyof QuoteDefaults]: QuoteDefaults[K] extends number ? K : never }[keyof QuoteDefaults];
type BooleanKey = { [K in keyof QuoteDefaults]: QuoteDefaults[K] extends boolean ? K : never }[keyof QuoteDefaults];

export interface NumberField {
  key: NumericKey;
  label: string;
  unit: string;
  /** Shown value = stored value × scale, e.g. 0.95 is shown as 95 % */
  scale?: number;
  help?: string;
}

export interface ToggleField {
  key: BooleanKey;
  label: string;
  help: string;
}

export const ASSUMPTION_GROUPS: { title: string; numbers: NumberField[]; toggles?: ToggleField[] }[] = [
  {
    title: 'Tariff',
    numbers: [
      { key: 'electricityRate', label: 'Import rate', unit: '₱/kWh' },
      { key: 'generationCharge', label: 'Export credit', unit: '₱/kWh' },
    ],
    toggles: [
      { key: 'creditRollover', label: 'Credit rolls over', help: 'Unused export credit carries to the next month' },
    ],
  },
  {
    title: 'Equipment',
    numbers: [
      { key: 'panelWatts', label: 'Panel rating', unit: 'W' },
      { key: 'panelPrice', label: 'Panel price', unit: '₱ each' },
      { key: 'inverterKw', label: 'Inverter rating', unit: 'kW' },
      { key: 'inverterPrice', label: 'Inverter price', unit: '₱ each' },
      { key: 'batteryUnitKwh', label: 'Battery unit', unit: 'kWh' },
      { key: 'batteryPrice', label: 'Battery price', unit: '₱ each' },
    ],
  },
  {
    title: 'Job costs',
    numbers: [
      { key: 'mountingCablingRate', label: 'Mounting & cabling', unit: '% of hardware', scale: 100 },
      { key: 'laborCost', label: 'Labour', unit: '₱ per job' },
      { key: 'miscCost', label: 'Miscellaneous', unit: '₱ per job' },
    ],
  },
  {
    title: 'Sizing',
    numbers: [
      { key: 'targetReduction', label: 'Bill reduction target', unit: '%', scale: 100 },
      { key: 'batteryReserve', label: 'Battery reserve', unit: '%', scale: 100, help: 'Kept back in normal operation' },
      { key: 'outagePercentile', label: 'Outage percentile', unit: '%', scale: 100, help: 'Battery covers this share of outages' },
      { key: 'minBatteryUnits', label: 'Minimum batteries', unit: 'units' },
      { key: 'systemLossFactor', label: 'Output after losses', unit: '%', scale: 100 },
      { key: 'batteryRoundTripEfficiency', label: 'Battery round trip', unit: '%', scale: 100 },
      { key: 'maxDcAcRatio', label: 'Max DC/AC ratio', unit: '×' },
      { key: 'maxPanels', label: 'Panel search limit', unit: 'panels' },
    ],
    toggles: [
      {
        key: 'reserveAppliesDuringOutages',
        label: 'Reserve kept in outages',
        help: 'On: the reserve is never used, so the battery is sized larger',
      },
    ],
  },
];

export const NUMBER_FIELDS = ASSUMPTION_GROUPS.flatMap((g) => g.numbers);
export const TOGGLE_FIELDS = ASSUMPTION_GROUPS.flatMap((g) => g.toggles ?? []);

/** What a field shows for a stored value, without float noise (0.95 × 100 → "95"). */
export function displayValue(field: NumberField, value: number): string {
  return String(Number((value * (field.scale ?? 1)).toPrecision(12)));
}

export function defaultFieldText(): Record<NumericKey, string> {
  return Object.fromEntries(
    NUMBER_FIELDS.map((f) => [f.key, displayValue(f, ZAMBOANGA_DEFAULTS[f.key])]),
  ) as Record<NumericKey, string>;
}

export function defaultToggles(): Record<BooleanKey, boolean> {
  return Object.fromEntries(TOGGLE_FIELDS.map((f) => [f.key, ZAMBOANGA_DEFAULTS[f.key]])) as Record<
    BooleanKey,
    boolean
  >;
}

/** Field text back to calculator values, or the list of fields that don't parse. */
export function readAssumptions(
  text: Record<NumericKey, string>,
  toggles: Record<BooleanKey, boolean>,
): { values: QuoteDefaults; errors: string[] } {
  const values: QuoteDefaults = { ...ZAMBOANGA_DEFAULTS, ...toggles };
  const errors: string[] = [];
  for (const f of NUMBER_FIELDS) {
    const n = toNumber(text[f.key] ?? '');
    if (!Number.isFinite(n) || n < 0) errors.push(f.label);
    else values[f.key] = n / (f.scale ?? 1);
  }
  return { values, errors };
}

// ─────────────────────────────────────────────────────────────
// Output
// ─────────────────────────────────────────────────────────────

export const peso = (n: number) => '₱' + Math.round(n).toLocaleString('en-PH');
export const num = (n: number, digits = 0) =>
  n.toLocaleString('en-PH', { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** Annual saving and simple payback in years (null when the saving is nil). */
export function payback(q: QuoteResult): { annualSaving: number; years: number | null } {
  const annualSaving = q.bill.annualBefore - q.bill.annualAfter;
  return { annualSaving, years: annualSaving > 0 ? q.pricing.total / annualSaving : null };
}

/** Plain-text summary for pasting into a message or email to the customer. */
export function quoteSummaryText(q: QuoteResult, customer: string): string {
  const { annualSaving, years } = payback(q);
  return [
    `Brylliant Solar — hybrid system quote${customer ? ` for ${customer}` : ''}`,
    '',
    `Panels: ${q.panels.count} × ${q.panels.wattsEach} W (${num(q.panels.systemKw, 2)} kWp)`,
    `Inverter: ${q.inverter.count} × ${q.inverter.ratingKwEach} kW`,
    `Battery: ${q.battery.units} unit${q.battery.units === 1 ? '' : 's'}, ${num(q.battery.installedKwh, 1)} kWh`,
    '',
    `Panels ${peso(q.pricing.panels)}`,
    `Inverters ${peso(q.pricing.inverters)}`,
    `Batteries ${peso(q.pricing.batteries)}`,
    `Mounting & cabling ${peso(q.pricing.mountingCabling)}`,
    `Labour ${peso(q.pricing.labor)}`,
    `Miscellaneous ${peso(q.pricing.misc)}`,
    `Total ${peso(q.pricing.total)}`,
    '',
    `Average monthly bill: ${peso(q.bill.averageMonthlyBefore)} → ${peso(q.bill.averageMonthlyAfter)} (${num(q.bill.reductionPercent, 1)}% lower)`,
    `Estimated saving: ${peso(annualSaving)} a year` +
      (years !== null ? `, simple payback about ${num(years, 1)} years` : ''),
  ].join('\n');
}
