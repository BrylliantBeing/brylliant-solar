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
  /** How power varies within each hour. Without it, clipping is judged on hourly averages and understated. */
  spread?: SunSpread;
}

/**
 * The logged power samples in each month and hour, sorted and grouped into levels.
 * Clipping happens in clear-sky and cloud-edge peaks that an hourly average hides.
 */
export interface SunSpread {
  /** Share of the time each level stands for; sums to 1 */
  weights: number[];
  /** kW per kWp at each level: levels[month 0–11][hour 0–23][level], lowest first */
  levels: number[][][];
}

/** One row from the operational inverter export (.xlsx) */
export interface SunOutputRow {
  'Device Name'?: string;
  Time: DateInput;
  [column: string]: unknown;
}

/** What an electrical part's quantity grows with */
export type PartBasis = 'job' | 'inverter' | 'string' | 'panel';

/** One line of the electrical parts list, bought locally in PHP */
export interface ElectricalPart {
  name: string;
  /** PHP per unit */
  php: number;
  /** Units per basis, e.g. 4 MC4 pairs per string or 20 m of wire per inverter */
  qty: number;
  per: PartBasis;
  /** Shown after the quantity, e.g. "m"; defaults to a plain count */
  unit?: string;
  /** True until the price comes from a store quote */
  estimate?: boolean;
}

export interface QuoteDefaults {
  electricityRate: number;          // PHP/kWh paid on import
  generationCharge: number;         // PHP/kWh credited on export
  usdToPhp: number;                 // PHP per USD, converts the USD hardware prices
  panelPriceUsd: number;            // USD per panel
  panelWatts: number;               // W per panel
  inverterPriceUsd: number;         // USD per inverter
  inverterKw: number;               // kW per inverter (paralleled)
  inverterMaxPanels: number;        // panels one inverter's PV inputs can take
  inverterChargeKw: number;         // kW one inverter charges the battery with from the panels (DC side)
  batteryPriceUsd: number;          // USD per battery unit
  batteryUnitKwh: number;           // kWh per battery unit
  laborCost: number;                // PHP per job
  mountingPerPanelUsd: number;      // USD of rails and mounts per panel
  pvCableRollUsd: number;           // USD per roll of PV cable
  pvCableRollMeters: number;        // m per roll
  pvCableMetersPerString: number;   // m of PV cable per string (red + black, array to inverter)
  panelsPerString: number;          // panels wired in series per string
  freightPerContainer: number;      // PHP per container, panels and rails
  panelsPerContainer: number;       // panels one container carries; freight is shared per panel
  netMeteringCost: number;          // PHP per job, net-metering application
  electricalParts: ElectricalPart[]; // breakers, wire, earthing, conduit
  miscCost: number;                 // PHP per job
  targetReduction: number;          // 0.95 = 95% bill reduction
  batteryReserve: number;           // 0.4 = 40% kept back in normal operation
  outagePercentile: number;         // 0.8 = 80th percentile
  minAfterSunsetHours: number;      // typical runtime an outage starting after sunset must reach; 0 = off
  systemLossFactor: number;         // 1 = no losses; ~0.8 = 20% losses
  batteryRoundTripEfficiency: number; // 1 = lossless; ~0.9 typical lithium
  minBatteryUnits: number;          // floor for a hybrid quote
  maxBatteryUnits: number;          // search ceiling for battery sizing
  reserveAppliesDuringOutages: boolean; // true = reserve is never used, even in outages
  creditRollover: boolean;          // unused export credit carries to next month
  maxDcAcRatio: number;             // warn above this panel kW / inverter kW
  maxPanels: number;                // search ceiling for panel sizing
  // Grid-tie comparison: these replace the inverter* settings and maxDcAcRatio
  gridTieInverterKw: number;
  gridTieInverterMaxPanels: number;
  gridTieInverterPricePhp: number; // PHP, bought locally rather than priced in USD
  gridTieMaxDcAcRatio: number;
}

/**
 * hybrid: batteries, and the inverter keeps the house running in an outage.
 * grid-tie: no batteries; the inverter shuts down whenever the grid is down (anti-islanding).
 */
export type SystemType = 'hybrid' | 'grid-tie';

export interface CalculatorInput extends Partial<QuoteDefaults> {
  /** REQUIRED: at least 168 hourly readings (1 week). May be longer. */
  consumption: HourlyReading[];
  /** OPTIONAL: outage history, e.g. from scripts/buildOutageHistory.ts */
  outages?: OutageEvent[];
  /** OPTIONAL: defaults to the profile built from your inverter log */
  sunProfile?: SunProfile | number[] | number[][];
  /** OPTIONAL: only needed if consumption timestamps are numeric dates like 04/09/2026 */
  dateOrder?: DateOrder;
  /** OPTIONAL: defaults to hybrid */
  systemType?: SystemType;
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

export interface OutageRuntime {
  /** Hour of day the outage starts, e.g. 11 = 11:00 */
  startHour: number;
  /** Typical hours the battery keeps the load running (median over every day of the simulated year) */
  medianHours: number;
  /** Shortest runtime on any day of the simulated year */
  shortestHours: number;
  /** Median battery charge (kWh) when the outage starts, from normal operation */
  medianStartKwh: number;
}

/** What set the battery size: the largest of these wins */
export type BatterySizedBy = 'none' | 'minimum' | 'outage needs' | 'outage coverage' | 'evening runtime';

export interface QuoteResult {
  /** Missing on quotes saved before grid-tie quotes existed; those are hybrid */
  systemType?: SystemType;
  battery: {
    requiredKwh: number;        // 80th percentile of outage needs, each starting from a full battery
    sizingKwh: number;          // requiredKwh, or requiredKwh / (1 − reserve) if the reserve is untouchable
    units: number;
    /** Units each sizing rule asks for; null if the rule could not be met within maxBatteryUnits */
    unitsFor: {
      minimum: number;
      outageNeeds: number;
      /** Covers outagePercentile of the outages in the simulated year, from the charge normal use leaves */
      outageCoverage: number | null;
      /** Typical after-sunset runtime reaches minAfterSunsetHours */
      eveningRuntime: number | null;
    };
    sizedBy: BatterySizedBy;
    /** minAfterSunsetHours the battery was sized for; 0 = no target */
    afterSunsetTargetHours: number;
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
    maxPanelsEach: number;
    /** Inverters the peak load alone needs */
    countForLoad: number;
    /** Inverters the panel count alone needs */
    countForPanels: number;
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
    /** Solar lost when the grid is down or the battery is full with nowhere to export */
    annualCurtailedKwh: number;
    /** Solar above what the inverters and battery chargers can take. Missing on quotes saved before it existed. */
    annualClippedKwh?: number;
    exportToImportRatio: number;
  };
  outageCoverage: {
    eventsInSimulatedYear: number;
    eventsFullyCovered: number;
    unmetLoadKwh: number;
  };
  /** How long the battery lasts in an outage that starts at a given time of day; null for grid-tie */
  outageRuntime: null | {
    /** Runtimes stop counting here; a value equal to it means "at least this long" */
    maxHours: number;
    /** Outage starts at the hour of highest sun output */
    peakSun: OutageRuntime;
    /** Outage starts once sun output has ended for the day */
    afterSunset: OutageRuntime;
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
  /** PHP, hardware converted from USD at usdToPhp */
  pricing: {
    usdToPhp: number;
    /** Hardware in USD, as the supplier prices it */
    usd: { panels: number; inverters: number; batteries: number; mounting: number; pvCable: number };
    panels: number;
    inverters: number;
    batteries: number;
    /** Rails and mounts */
    mounting: number;
    /** PV cable, bought in whole rolls */
    pvCable: number;
    pvCableRolls: number;
    /** mounting + pvCable */
    mountingCabling: number;
    /** The job's share of container freight, by panel count */
    freight: number;
    /** Sum of electricalParts */
    electrical: number;
    electricalParts: { name: string; quantity: number; unit?: string; php: number; total: number; estimate: boolean }[];
    labor: number;
    netMetering: number;
    misc: number;
    total: number;
  };
  /** Problems you should act on */
  warnings: string[];
  /** Informational: how the quote was built */
  notes: string[];
  /** The same customer on a grid-tie system, from calculateComparison */
  gridTie?: QuoteResult;
}

// ─────────────────────────────────────────────────────────────
// Defaults & constants
// ─────────────────────────────────────────────────────────────

export const ZAMBOANGA_DEFAULTS: QuoteDefaults = {
  electricityRate: 13.4668,
  generationCharge: 8.47,
  usdToPhp: 62.83, // fallback; the app fills in the live rate
  panelPriceUsd: 91.65, // Jinko JKM725N-66HL5-BDV
  panelWatts: 725,
  inverterPriceUsd: 720, // Growatt SPE12000ES
  inverterKw: 12,
  inverterMaxPanels: 20, // 2 strings of 10: 10 × 49.20 V Voc = 492 V, under the 550 V input limit
  inverterChargeKw: 12, // assumed ~250 A at 48 V; confirm against the SPE12000ES datasheet
  batteryPriceUsd: 980,
  batteryUnitKwh: 10,
  laborCost: 20625,
  mountingPerPanelUsd: 25, // US$2,500 of rails and mounts for 100 panels
  pvCableRollUsd: 90,
  pvCableRollMeters: 100,
  pvCableMetersPerString: 40, // assumed ~20 m run from array to inverter, red + black; measure on site
  panelsPerString: 10, // 10 × 49.20 V Voc = 492 V, under the 550 V (hybrid) and 600 V (grid-tie) input limits
  freightPerContainer: 350000, // 20 ft container, forwarder estimate
  panelsPerContainer: 165, // 5 pallets of 33, with rails and hardware
  netMeteringCost: 1500,
  electricalParts: [
    // Estimates for a grid-tie job, 2 strings of 10 × 725 W into one 10 kW inverter. Ratings from the
    // JKM725N (Isc 18.74 A, 35 A series fuse) and HYX-S10K-S2 (45.5 A max AC) datasheets.
    // DC side
    { name: 'DC breaker 2P 32 A 600 V+', php: 425, qty: 1, per: 'string', estimate: true },
    { name: 'DC surge protector Type II 600 V', php: 500, qty: 1, per: 'string', estimate: true },
    { name: 'MC4 pair, home runs', php: 70, qty: 4, per: 'string', estimate: true },
    { name: 'MC4 pair, jumper spares', php: 70, qty: 0.5, per: 'panel', estimate: true },
    { name: 'DC enclosure IP65', php: 650, qty: 1, per: 'inverter', estimate: true },
    // AC side
    { name: 'AC breaker 2P 63 A', php: 375, qty: 1, per: 'inverter', estimate: true },
    { name: 'AC surge protector Type II 275 V', php: 650, qty: 1, per: 'inverter', estimate: true },
    { name: 'AC enclosure', php: 500, qty: 1, per: 'inverter', estimate: true },
    { name: 'House panel breaker 2P 60 A', php: 1150, qty: 1, per: 'inverter', estimate: true },
    { name: '14 mm² THHN, line + neutral', php: 200, qty: 20, per: 'inverter', unit: 'm', estimate: true },
    { name: 'Lockable safety switch 2P 60 A', php: 2750, qty: 1, per: 'job', estimate: true },
    // Earthing
    { name: 'Ground rod 5/8" × 10 ft + clamp', php: 900, qty: 1, per: 'job', estimate: true },
    { name: '8 mm² THHN green', php: 110, qty: 30, per: 'job', unit: 'm', estimate: true },
    { name: 'Earthing clip', php: 20, qty: 1, per: 'panel', estimate: true },
    // Conduit and small parts
    { name: 'Conduit, 3 m length', php: 120, qty: 10, per: 'job', estimate: true },
    { name: 'Conduit fittings and straps', php: 1150, qty: 1, per: 'job', unit: 'lot', estimate: true },
    { name: 'UV cable ties and clips', php: 450, qty: 1, per: 'job', unit: 'lot', estimate: true },
    { name: 'Lugs and heat shrink', php: 450, qty: 1, per: 'job', unit: 'lot', estimate: true },
    { name: 'Warning labels', php: 350, qty: 1, per: 'job', unit: 'set', estimate: true },
  ],
  miscCost: 0,
  targetReduction: 0.95,
  batteryReserve: 0.4,
  outagePercentile: 0.8,
  minAfterSunsetHours: 3,
  systemLossFactor: 0.95, // inverter conversion and AC wiring; the logged sun already includes panel heat and soiling
  batteryRoundTripEfficiency: 0.9, // typical lithium with a hybrid inverter
  minBatteryUnits: 1,
  maxBatteryUnits: 20,
  reserveAppliesDuringOutages: false,
  creditRollover: true,
  maxDcAcRatio: 1.3,
  maxPanels: 300,
  gridTieInverterKw: 10, // HYXiPOWER HYX-S10K-S2, single phase
  // 3 strings: MPPT1 takes 1 (20 A), MPPT2 takes 2 in parallel (32 A; 37.5 A Isc under 40 A). 492 V Voc under 600 V.
  // 27 × 725 W = 19.6 kWp, under the 20 kW max PV input; 28 would be over.
  gridTieInverterMaxPanels: 27,
  gridTieInverterPricePhp: 34003.2,
  gridTieMaxDcAcRatio: 2, // HYXI allows 20 kW of PV on the 10 kW unit
};

const MIN_HOURS = 168;
const MAX_ITERATIONS = 10;
const RUNTIME_CAP_HOURS = 168; // battery runtimes stop counting after a week
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

/** Whole number with thousands separators, without Intl so it reads the same on every device. */
function num0(value: number): string {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
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
  /** Outages dropped because they fall entirely inside a longer one */
  overlapsRemoved: number;
  /** Row count per location (each area of a "A; B" cell) in the whole file, before filtering */
  locations: Record<string, number>;
  dateOrder?: DateOrder;
  firstStart?: string;
  lastEnd?: string;
  warnings: string[];
}

/**
 * Parses the outage history CSV: location, datetime start, datetime end.
 * Works with or without a header row. The location column may be headed "Location" or
 * "Barangays", and a cell may list several areas separated by ";" ("Baliwasan; Calarian");
 * a row is used when any of its areas is wanted. Matching ignores case and extra spaces
 * and is exact, so "Zamboanga" does not also match "Zamboanga Sibugay".
 * An outage entirely inside a longer one is dropped; partial overlaps are kept separate.
 */
export function parseOutageCsv(
  csvText: string,
  options: { locations?: string | string[]; dateOrder?: DateOrder } = {},
): OutageParseResult {
  const rows = parseCsv(csvText);
  const warnings: string[] = [];
  const skipped: OutageParseResult['skipped'] = [];
  if (rows.length === 0) {
    return { outages: [], skipped, duplicatesRemoved: 0, overlapsRemoved: 0, locations: {}, warnings: ['Outage file is empty.'] };
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
      locIdx = find('location') >= 0 ? find('location') : find('barangay');
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
  let noLocation = 0;
  const kept: { areas: string[]; start: number; end: number }[] = [];

  dataRows.forEach((r, i) => {
    const line = i + firstData + 1;
    const raw = r.join(',');
    const location = locIdx >= 0 ? (r[locIdx] ?? '').trim() : '';
    const areas = location.split(';').map((a) => a.trim()).filter(Boolean);
    areas.forEach((a) => { locations[a] = (locations[a] ?? 0) + 1; });
    if (wanted) {
      if (areas.length === 0) noLocation++;
      if (!areas.some((a) => wanted.has(normalizeName(a)))) return;
    }

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
    kept.push({ areas, start, end });
  });

  // An outage entirely inside a longer one adds nothing (isolation and re-tapping inside the
  // morning's line work). Partial overlaps stay separate: in one barangay they are often
  // different rotation groups, and joining them would invent an outage no household had.
  kept.sort((a, b) => a.start - b.start || b.end - a.end);
  const used: typeof kept = [];
  let overlapsRemoved = 0;
  let reach = -Infinity;
  for (const o of kept) {
    if (o.end <= reach) { overlapsRemoved++; continue; }
    used.push(o);
    reach = o.end;
  }
  const outages: OutageEvent[] = used.map((o) => ({
    location: o.areas.length ? o.areas.join('; ') : undefined,
    start: formatWallTime(o.start),
    end: formatWallTime(o.end),
  }));

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
  if (wanted && noLocation > 0) {
    warnings.push(`${noLocation} rows name no location, so they are left out when a location is picked.`);
  }
  if (skipped.length > 0) warnings.push(`${skipped.length} outage rows could not be read (see skipped).`);

  return {
    outages, skipped, duplicatesRemoved, overlapsRemoved, locations, dateOrder,
    firstStart: used.length ? formatWallTime(used[0].start) : undefined,
    lastEnd: used.length ? formatWallTime(reach) : undefined,
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
  const days = new Map<string, { month: number; energy: number[]; power: number[][]; daylightMs: number }>();
  const dayEntry = (ms: number) => {
    const key = dayKey(ms);
    let e = days.get(key);
    if (!e) {
      e = {
        month: wallParts(ms).month - 1,
        energy: new Array(24).fill(0),
        power: Array.from({ length: 24 }, () => []),
        daylightMs: 0,
      };
      days.set(key, e);
    }
    return e;
  };
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    dayEntry(s.t).power[wallParts(s.t).hour].push(s.kW / kwp);
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
  const power = Array.from({ length: 12 }, () => Array.from({ length: 24 }, (): number[] => []));
  const daysUsedByMonth = new Array(12).fill(0);
  let daysExcluded = 0;
  for (const e of days.values()) {
    if (e.daylightMs < minCoverage * 12 * HOUR_MS) { daysExcluded++; continue; }
    daysUsedByMonth[e.month]++;
    e.energy.forEach((kWh, h) => { sums[e.month][h] += kWh; });
    e.power.forEach((kW, h) => { power[e.month][h].push(...kW); });
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
  const overallLevels = Array.from({ length: 24 }, (_, h) => spreadLevels(power.flatMap((month) => month[h])));
  const levels = power.map((month, m) =>
    daysUsedByMonth[m] === 0 ? overallLevels.map((l) => [...l]) : month.map(spreadLevels));
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
      spread: { weights: SPREAD_EDGES.slice(1).map((b, i) => round2(b - SPREAD_EDGES[i])), levels },
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

/** Quantile edges of the sun spread: finer at the top, where the peaks that clip are. */
const SPREAD_EDGES = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.98, 0.99, 1];

/** Mean of the samples between each pair of SPREAD_EDGES, so the weighted levels average to the samples' mean. */
function spreadLevels(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  return SPREAD_EDGES.slice(1).map((b, i) => {
    if (n === 0) return 0;
    const from = Math.min(n - 1, Math.floor(SPREAD_EDGES[i] * n));
    const to = Math.min(n, Math.max(from + 1, Math.floor(b * n)));
    let sum = 0;
    for (let k = from; k < to; k++) sum += sorted[k];
    return sum / (to - from);
  });
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
  const spread = profile.spread;
  if (spread) {
    const k = spread.weights.length;
    const spreadOk = k > 0 && Math.abs(spread.weights.reduce((a, b) => a + b, 0) - 1) < 1e-6 &&
      spread.levels.length === 12 && spread.levels.every((month) => month.length === 24 &&
        month.every((l) => l.length === k && l.every((v) => Number.isFinite(v) && v >= 0)));
    if (!spreadOk) throw new Error('sunProfile.spread must have weights summing to 1 and 12 × 24 levels of the same length.');
  }
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

/** The panels and inverters a battery is sized against. */
interface SizingSystem { ctx: SimContext; systemKw: number; inverterKw: number }

/**
 * Battery units: the most that any rule asks for.
 *  - minimum: cfg.minBatteryUnits
 *  - outage needs: the outagePercentile of historical outage needs, each from a full battery
 *  - outage coverage: the simulated year covers outagePercentile of its outages. Unlike the
 *    needs rule, each outage starts from the charge normal use leaves, which is often far
 *    from full in the evening.
 *  - evening runtime: an outage starting after sunset typically lasts minAfterSunsetHours
 * The last two need the panel system, so the first round (no panels yet) skips them.
 */
function sizeBattery(
  outages: ParsedOutage[], ref: ReferenceWeek, sun: number[][], cfg: QuoteDefaults, system?: SizingSystem,
) {
  const systemKw = system?.systemKw ?? 0;
  const needs = outages.map((o) => outageNeedKwh(o, ref, sun, systemKw, cfg));
  const requiredKwh = needs.length ? percentile(needs, cfg.outagePercentile) : 0;
  const sizingKwh = cfg.reserveAppliesDuringOutages ? requiredKwh / (1 - cfg.batteryReserve) : requiredKwh;
  const unitsFor: QuoteResult['battery']['unitsFor'] = {
    minimum: cfg.minBatteryUnits,
    outageNeeds: Math.ceil(sizingKwh / cfg.batteryUnitKwh - 1e-9),
    outageCoverage: null,
    eveningRuntime: null,
  };
  let units = Math.max(unitsFor.minimum, unitsFor.outageNeeds);

  if (system) {
    const { ctx } = system;
    const wantCoverage = ctx.outageCount > 0;
    const wantRuntime = cfg.minAfterSunsetHours > 0;
    const sunset = runtimeStartHours(sun).sunset;
    // Coverage and runtime both grow with the battery, so the first size that meets each is the answer.
    for (let n = 0; n <= cfg.maxBatteryUnits; n++) {
      const kwh = n * cfg.batteryUnitKwh;
      const socTrace: number[] = [];
      const sim = simulateYear(ctx, system.systemKw, kwh, system.inverterKw, cfg, socTrace);
      if (unitsFor.outageCoverage === null && (!wantCoverage ||
        sim.outageEvents - sim.outageEventsUncovered >= cfg.outagePercentile * sim.outageEvents - 1e-9)) {
        unitsFor.outageCoverage = n;
      }
      if (unitsFor.eveningRuntime === null && (!wantRuntime ||
        outageRuntime(sunset, ctx, socTrace, ref, sun, system.systemKw, kwh, system.inverterKw, cfg).medianHours >=
          cfg.minAfterSunsetHours)) {
        unitsFor.eveningRuntime = n;
      }
      if (unitsFor.outageCoverage !== null && unitsFor.eveningRuntime !== null) break;
    }
    units = Math.max(units, unitsFor.outageCoverage ?? 0, unitsFor.eveningRuntime ?? 0);
  }

  // On a tie, the rule listed last above is named.
  const sizedBy: BatterySizedBy =
    units === unitsFor.eveningRuntime ? 'evening runtime'
      : units === unitsFor.outageCoverage ? 'outage coverage'
        : units === unitsFor.outageNeeds ? 'outage needs'
          : 'minimum';
  return { needs, requiredKwh, sizingKwh, units, unitsFor, sizedBy, installedKwh: units * cfg.batteryUnitKwh };
}

type BatterySizing = Omit<ReturnType<typeof sizeBattery>, 'sizedBy'> & { sizedBy: BatterySizedBy };

/** Grid-tie: nothing to size. */
function noBattery(): BatterySizing {
  return {
    needs: [], requiredKwh: 0, sizingKwh: 0, units: 0, installedKwh: 0, sizedBy: 'none',
    unitsFor: { minimum: 0, outageNeeds: 0, outageCoverage: 0, eveningRuntime: 0 },
  };
}

// ─────────────────────────────────────────────────────────────
// One-year simulation and monthly billing
// ─────────────────────────────────────────────────────────────

interface SimHour {
  monthIdx: number;   // 0–11 within the simulated year
  load: number;       // kWh
  sunPerKwp: number;  // kWh per kWp
  sunLevels: number[]; // kW per kWp within the hour, weighted by SimContext.levelWeights
  sunPeak: number;    // highest of sunLevels
  outFrac: number;    // share of the hour with the grid down
  outageId: number;   // -1 if none
}

interface SimContext {
  hours: SimHour[];
  monthLabels: string[];
  start: number;
  end: number;
  outageCount: number;
  /** false for grid-tie: the inverter shuts down with the grid, so solar is lost during outages */
  solarInOutages: boolean;
  levelWeights: number[];
}

/**
 * The simulated year is the 12 calendar months before the month the consumption was
 * recorded. Each hour takes the reference-week load for its weekday, the sun for its
 * month, and any historical outage that fell in it.
 */
function buildSimContext(
  ref: ReferenceWeek, sun: number[][], outages: ParsedOutage[], solarInOutages = true, spread?: SunSpread,
): SimContext {
  // Without a spread, the hourly average is the only level.
  const levelsFor = (m: number, h: number) => spread ? spread.levels[m][h] : [sun[m][h]];
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
      sunLevels: levelsFor(p.month - 1, p.hour),
      sunPeak: Math.max(...levelsFor(p.month - 1, p.hour)),
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
  return { hours, monthLabels, start, end, outageCount, solarInOutages, levelWeights: spread?.weights ?? [1] };
}

interface SimResult {
  monthly: MonthlyBill[];
  loadKwh: number;
  solarKwh: number;
  importKwh: number;
  exportKwh: number;
  curtailedKwh: number;
  clippedKwh: number;
  unmetKwh: number;
  baseline: number;
  billAfter: number;
  creditLeft: number;
  outageEvents: number;
  outageEventsUncovered: number;
}

/** Battery charging power (kW) of the inverters behind inverterKw. */
function chargeKwFor(inverterKw: number, cfg: QuoteDefaults): number {
  return (inverterKw / cfg.inverterKw) * cfg.inverterChargeKw;
}

/** Share of an hour's solar energy above capKw, from the spread of power within the hour. */
function clippedShare(levels: number[], weights: number[], kwPerLevel: number, capKw: number): number {
  let total = 0;
  let above = 0;
  for (let i = 0; i < levels.length; i++) {
    const kw = levels[i] * kwPerLevel;
    total += weights[i] * kw;
    above += weights[i] * Math.max(0, kw - capKw);
  }
  return total > 0 ? above / total : 0;
}

/**
 * Hour-by-hour energy flow. The panels feed two outputs: the inverters' AC side (house load,
 * battery discharge and export share inverterKw) and the DC battery charger (chargeKwFor).
 * Panel power above both, in the peaks within an hour, is clipped.
 * socTrace, if given, receives the battery charge (kWh) at the start of each hour.
 */
function simulateYear(
  ctx: SimContext, systemKw: number, batteryKwh: number, inverterKw: number, cfg: QuoteDefaults,
  socTrace?: number[],
): SimResult {
  const eff = cfg.batteryRoundTripEfficiency;
  const chargeKw = chargeKwFor(inverterKw, cfg);
  const kwPerLevel = systemKw * cfg.systemLossFactor;
  const normalFloor = batteryKwh * cfg.batteryReserve;
  const outageFloor = cfg.reserveAppliesDuringOutages ? normalFloor : 0;
  let soc = normalFloor;

  const n = ctx.monthLabels.length;
  const mImport = new Array(n).fill(0);
  const mExport = new Array(n).fill(0);
  const mLoadUp = new Array(n).fill(0);
  const mLoad = new Array(n).fill(0);
  let solar = 0, curtailed = 0, clipped = 0, unmet = 0;
  const uncovered = new Set<number>();

  for (const h of ctx.hours) {
    socTrace?.push(soc);
    const gen = systemKw * h.sunPerKwp * cfg.systemLossFactor;
    solar += gen;
    mLoad[h.monthIdx] += h.load;
    // Split the hour into a grid-down part and a grid-up part.
    for (const [share, gridUp] of [[h.outFrac, false], [1 - h.outFrac, true]] as [number, boolean][]) {
      if (share <= 0) continue;
      const load = h.load * share;
      const solarOn = gridUp || ctx.solarInOutages;
      let g = solarOn ? gen * share : 0;
      if (!solarOn) curtailed += gen * share;
      const acLimit = inverterKw * share; // AC energy the inverters can pass in this part of the hour
      const chargeLimit = Math.min(chargeKw * share, Math.max(0, (batteryKwh - soc) / eff));
      const capKw = inverterKw + chargeLimit / share;
      if (g > 0 && kwPerLevel * h.sunPeak > capKw) {
        const clip = g * clippedShare(h.sunLevels, ctx.levelWeights, kwPerLevel, capKw);
        clipped += clip;
        g -= clip;
      }
      if (gridUp) mLoadUp[h.monthIdx] += load;

      const toLoad = Math.min(g, load, acLimit);
      const charge = Math.min(g - toLoad, chargeLimit);
      soc += charge * eff;
      const rest = g - toLoad - charge;
      const acLeft = acLimit - toLoad;
      if (gridUp) {
        const exp = Math.min(rest, acLeft);
        mExport[h.monthIdx] += exp;
        clipped += rest - exp;
      } else {
        curtailed += rest; // grid down: nothing can be exported
      }

      const deficit = load - toLoad;
      if (deficit > 0) {
        const floor = gridUp ? normalFloor : outageFloor;
        const discharge = Math.max(0, Math.min(deficit, acLeft, soc - floor));
        soc -= discharge;
        const short = deficit - discharge;
        if (gridUp) mImport[h.monthIdx] += short;
        else if (short > 1e-9) { unmet += short; uncovered.add(h.outageId); }
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
    clippedKwh: clipped,
    unmetKwh: unmet,
    baseline,
    billAfter,
    creditLeft: cfg.creditRollover ? carry : 0,
    outageEvents: ctx.outageCount,
    outageEventsUncovered: uncovered.size,
  };
}

// ─────────────────────────────────────────────────────────────
// Battery runtime in an outage
// ─────────────────────────────────────────────────────────────

/**
 * Outage start hours from the year-average sun curve: the hour of highest output, and
 * the first hour after it where output drops under 1% of that peak (sunset).
 */
function runtimeStartHours(sun: number[][]): { peak: number; sunset: number } {
  const avg = Array.from({ length: 24 }, (_, h) => sun.reduce((s, row) => s + row[h], 0) / 12);
  const peak = avg.indexOf(maxOf(avg));
  let sunset = peak + 1;
  while (sunset < 23 && avg[sunset] >= 0.01 * avg[peak]) sunset++;
  return { peak, sunset };
}

/**
 * Hours until the load can no longer be met, for an outage starting at startMs with the
 * battery at socKwh. Uses the reference-day load and the month's sun, recharges from
 * surplus solar, and stops at RUNTIME_CAP_HOURS. The last hour is prorated.
 */
function batteryRuntimeHours(
  startMs: number, socKwh: number, ref: ReferenceWeek, sun: number[][],
  systemKw: number, batteryKwh: number, inverterKw: number, cfg: QuoteDefaults,
): number {
  const eff = cfg.batteryRoundTripEfficiency;
  const chargeKw = chargeKwFor(inverterKw, cfg);
  const floor = cfg.reserveAppliesDuringOutages ? batteryKwh * cfg.batteryReserve : 0;
  let soc = socKwh;
  for (let i = 0; i < RUNTIME_CAP_HOURS; i++) {
    const p = wallParts(startMs + i * HOUR_MS);
    const load = ref.hourly[p.weekday][p.hour];
    const gen = systemKw * sun[p.month - 1][p.hour] * cfg.systemLossFactor;
    const toLoad = Math.min(gen, load, inverterKw);
    soc += Math.max(0, Math.min(gen - toLoad, chargeKw, (batteryKwh - soc) / eff)) * eff;
    const deficit = load - toLoad;
    if (deficit <= 0) continue;
    const available = Math.max(0, Math.min(soc - floor, inverterKw - toLoad));
    if (available + 1e-9 < deficit) return i + available / deficit;
    soc -= deficit;
  }
  return RUNTIME_CAP_HOURS;
}

/** Runtime for an outage starting at startHour on every day of the simulated year. */
function outageRuntime(
  startHour: number, ctx: SimContext, socTrace: number[], ref: ReferenceWeek, sun: number[][],
  systemKw: number, batteryKwh: number, inverterKw: number, cfg: QuoteDefaults,
): OutageRuntime {
  const runtimes: number[] = [];
  const socs: number[] = [];
  for (let day = ctx.start; day < ctx.end; day += DAY_MS) {
    const t = day + startHour * HOUR_MS;
    const soc = socTrace[(t - ctx.start) / HOUR_MS];
    socs.push(soc);
    runtimes.push(batteryRuntimeHours(t, soc, ref, sun, systemKw, batteryKwh, inverterKw, cfg));
  }
  return {
    startHour,
    medianHours: round2(median(runtimes)),
    shortestHours: round2(Math.min(...runtimes)),
    medianStartKwh: round2(median(socs)),
  };
}

/** Battery ↔ panel iteration: battery depends on panel output during outages,
 * panel count depends on the battery's daily usable capacity. */
function sizeHybrid(
  outages: ParsedOutage[], ref: ReferenceWeek, sun: number[][], ctx: SimContext, countForLoad: number,
  cfg: QuoteDefaults, warnings: string[],
) {
  const systemFor = (count: number): SizingSystem => ({
    ctx,
    systemKw: (count * cfg.panelWatts) / 1000,
    inverterKw: inverterCountFor(count, countForLoad, cfg) * cfg.inverterKw,
  });
  let battery = sizeBattery(outages, ref, sun, cfg);
  let panels = sizePanels(ctx, battery.installedKwh, countForLoad, cfg);
  const seen = new Map<number, number>([[battery.installedKwh, panels]]);
  let converged = false;
  let iterations = 1;
  for (; iterations <= MAX_ITERATIONS; iterations++) {
    const next = sizeBattery(outages, ref, sun, cfg, systemFor(panels));
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
    panels = sizePanels(ctx, battery.installedKwh, countForLoad, cfg);
    seen.set(battery.installedKwh, panels);
  }
  if (!converged) warnings.push(`Battery and panel sizing did not settle after ${MAX_ITERATIONS} rounds.`);
  if (battery.unitsFor.outageCoverage === null) {
    warnings.push(
      `Even ${cfg.maxBatteryUnits} battery units do not cover ${cfg.outagePercentile * 100}% of the outages in the ` +
      'simulated year. The load during some outages may exceed the inverter capacity.',
    );
  }
  if (battery.unitsFor.eveningRuntime === null) {
    warnings.push(
      `Even ${cfg.maxBatteryUnits} battery units do not keep the load running for ${cfg.minAfterSunsetHours} h ` +
      'after sunset. The evening load may exceed the inverter capacity; consider backing up essential loads only.',
    );
  }

  return { battery: battery as BatterySizing, panels, converged, iterations };
}

function hybridBatteryNotes(cfg: QuoteDefaults, sizedBy: BatterySizedBy): string[] {
  return [
    `Battery starts the simulated year at the ${cfg.batteryReserve * 100}% reserve level.`,
    `The battery is the largest of: the minimum (${cfg.minBatteryUnits}), the ${cfg.outagePercentile * 100}th ` +
      `percentile of outage needs, covering ${cfg.outagePercentile * 100}% of the simulated year's outages, and a ` +
      `typical ${cfg.minAfterSunsetHours} h runtime after sunset. Here it was set by the ${sizedBy} rule.`,
    'Outage runtimes start from the battery charge normal operation leaves at that hour, ' +
      `are repeated on every day of the simulated year, and stop counting at ${RUNTIME_CAP_HOURS} hours.`,
  ];
}

/** Inverters for a panel count: enough for the peak load, and enough PV inputs for every panel. */
function inverterCountFor(panels: number, countForLoad: number, cfg: QuoteDefaults): number {
  return Math.max(countForLoad, Math.ceil(panels / cfg.inverterMaxPanels - 1e-9));
}

/**
 * Fewest panels whose simulated annual bill is at most (1 − target) of the bill without solar.
 * Each candidate is simulated with the inverters it needs, so extra panels bring their own inverter.
 */
function sizePanels(
  ctx: SimContext, batteryKwh: number, countForLoad: number, cfg: QuoteDefaults,
): number {
  const kw = (count: number) => (count * cfg.panelWatts) / 1000;
  const meets = (count: number) => {
    const inverterKw = inverterCountFor(count, countForLoad, cfg) * cfg.inverterKw;
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
  const {
    consumption, outages: rawOutages = [], sunProfile: sunInput, dateOrder, systemType = 'hybrid', ...overrides
  } = input;
  const gridTie = systemType === 'grid-tie';
  const base: QuoteDefaults = { ...ZAMBOANGA_DEFAULTS, ...stripUndefined(overrides) };
  // Grid-tie swaps in its own inverter; everything below reads cfg.inverter*.
  const cfg: QuoteDefaults = gridTie
    ? {
      ...base,
      inverterKw: base.gridTieInverterKw,
      inverterMaxPanels: base.gridTieInverterMaxPanels,
      // Priced in PHP; as USD so the rate converts it back to the same peso price.
      inverterPriceUsd: base.gridTieInverterPricePhp / base.usdToPhp,
      maxDcAcRatio: base.gridTieMaxDcAcRatio,
    }
    : base;
  const warnings: string[] = [];
  const notes: string[] = [];

  if (cfg.batteryReserve < 0 || cfg.batteryReserve >= 1) throw new Error('batteryReserve must be between 0 and 1.');
  if (cfg.batteryRoundTripEfficiency <= 0 || cfg.batteryRoundTripEfficiency > 1) {
    throw new Error('batteryRoundTripEfficiency must be above 0 and at most 1.');
  }
  if (cfg.inverterKw <= 0) throw new Error('inverterKw must be above 0.');
  if (cfg.inverterMaxPanels < 1) throw new Error('inverterMaxPanels must be at least 1.');
  if (!(cfg.inverterChargeKw >= 0)) throw new Error('inverterChargeKw must be at least 0.');
  if (!(cfg.systemLossFactor > 0 && cfg.systemLossFactor <= 1)) throw new Error('systemLossFactor must be above 0 and at most 1.');
  if (cfg.maxBatteryUnits < cfg.minBatteryUnits) throw new Error('maxBatteryUnits must be at least minBatteryUnits.');

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
  if (outages.length === 0 && !gridTie) {
    warnings.push('No outage data. The battery is sized by the minimum units and the after-sunset runtime only.');
  }

  // Inverters for the load: peak one-hour consumption, units in parallel. More may be
  // added once the panel count is known, since each inverter takes a limited number of panels.
  // A grid-tie inverter never carries the house alone (the grid does), so only the panels count.
  const peakHourlyLoadKwh = maxOf([...byHour.values()]);
  const countForLoad = gridTie ? 0 : Math.max(1, Math.ceil(peakHourlyLoadKwh / cfg.inverterKw - 1e-9));

  // Simulated year
  const ctx = buildSimContext(ref, sun, outages, !gridTie, sunProfile.spread);
  if (outages.length > 0 && ctx.outageCount === 0) {
    warnings.push(
      `No outage in the history falls in the simulated year (${formatWallTime(ctx.start).slice(0, 7)} to ` +
      `${formatWallTime(ctx.end - 1).slice(0, 7)}), so outages are not part of the bill simulation.`,
    );
  }

  // Grid-tie: no battery, so panels are sized once. Hybrid: battery and panels depend on each other.
  const sized = gridTie
    ? {
      battery: noBattery(),
      panels: sizePanels(ctx, 0, countForLoad, cfg),
      converged: true,
      iterations: 1,
    }
    : sizeHybrid(outages, ref, sun, ctx, countForLoad, cfg, warnings);
  const { battery, panels, converged, iterations } = sized;

  const systemKw = (panels * cfg.panelWatts) / 1000;
  const countForPanels = Math.ceil(panels / cfg.inverterMaxPanels - 1e-9);
  const inverterCount = inverterCountFor(panels, countForLoad, cfg);
  const inverterTotalKw = inverterCount * cfg.inverterKw;
  const socTrace: number[] = [];
  const sim = simulateYear(ctx, systemKw, battery.installedKwh, inverterTotalKw, cfg, socTrace);
  const reductionPercent = sim.baseline > 0 ? (1 - sim.billAfter / sim.baseline) * 100 : 0;

  const dcAcRatio = systemKw / inverterTotalKw;
  if (dcAcRatio > cfg.maxDcAcRatio) {
    warnings.push(
      `Panel capacity is ${dcAcRatio.toFixed(2)}× the inverter capacity (limit ${cfg.maxDcAcRatio}). ` +
      'Check the inverter PV input rating or add an inverter.',
    );
  }
  if (sim.outageEventsUncovered > 0 && !gridTie) {
    warnings.push(
      `${sim.outageEventsUncovered} of ${sim.outageEvents} outages in the simulated year were not fully covered ` +
      `(${round2(sim.unmetKwh)} kWh unmet). The battery is sized to cover ${cfg.outagePercentile * 100}% of them.`,
    );
  }

  // Battery runtime for an outage at peak sun and just after sunset
  const startHours = runtimeStartHours(sun);
  const runtimeAt = (hour: number) =>
    outageRuntime(hour, ctx, socTrace, ref, sun, systemKw, battery.installedKwh, inverterTotalKw, cfg);

  // Notes
  const recorded = ref.recordedMonths.map((m) => MONTH_LABELS[m]).join(', ');
  notes.push(
    `The consumption recorded in ${recorded} is repeated across the whole year, so seasonal ` +
    'changes in load (e.g. more air-conditioning in April–May) are not captured.',
  );
  notes.push('Billing uses the reference week (the highest-consumption day per weekday), so the "before" bill is an upper estimate.');
  const clippedPercent = sim.solarKwh > 0 ? (sim.clippedKwh / sim.solarKwh) * 100 : 0;
  notes.push(
    `Inverters clip ${num0(sim.clippedKwh)} kWh a year (${clippedPercent.toFixed(1)}% of panel output) at ` +
    `${round2(dcAcRatio)}× panel to inverter capacity` +
    (gridTie ? '.' : `; up to ${round2(chargeKwFor(inverterTotalKw, cfg))} kW more can go straight into the battery.`),
  );
  if (!sunProfile.spread) {
    notes.push(
      'The sun profile has no within-hour spread, so clipping is judged on hourly averages and understated. ' +
      'Rebuild it with scripts/buildSunProfile.ts.',
    );
  }
  if (gridTie) {
    notes.push(
      `Grid-tie: ${cfg.inverterKw} kW inverters taking at most ${cfg.inverterMaxPanels} panels each, set by the ` +
      'panel count. The grid carries the house load, so the inverters do not need to cover it.',
    );
    notes.push(
      'Grid-tie: no battery, and the inverter shuts down whenever the grid is down (anti-islanding), so there ' +
      `is no power during outages, even in full sun. In the simulated year that is ${sim.outageEvents} outages ` +
      `and ${round2(sim.unmetKwh)} kWh of load without power.`,
    );
  } else {
    notes.push(
      `Inverters cover the highest hourly kWh and take at most ${cfg.inverterMaxPanels} panels each ` +
      `(${countForPanels > countForLoad ? 'the panel count' : 'the load'} set the number here). ` +
      'Short peaks within an hour can be higher than the hourly figure.',
    );
    notes.push(...hybridBatteryNotes(cfg, battery.sizedBy));
  }

  // Pricing: supplier hardware in USD, converted to PHP; labour, net metering and misc are already PHP.
  if (!(cfg.usdToPhp > 0)) throw new Error('usdToPhp must be above 0.');
  if (!(cfg.panelsPerString > 0) || !(cfg.pvCableRollMeters > 0) || !(cfg.panelsPerContainer > 0)) {
    throw new Error('panelsPerString, pvCableRollMeters and panelsPerContainer must be above 0.');
  }
  const strings = Math.ceil(panels / cfg.panelsPerString);
  const pvCableRolls = Math.ceil((strings * cfg.pvCableMetersPerString) / cfg.pvCableRollMeters);
  const usd = {
    panels: panels * cfg.panelPriceUsd,
    inverters: inverterCount * cfg.inverterPriceUsd,
    batteries: battery.units * cfg.batteryPriceUsd,
    mounting: panels * cfg.mountingPerPanelUsd,
    pvCable: pvCableRolls * cfg.pvCableRollUsd,
  };
  const panelCost = usd.panels * cfg.usdToPhp;
  const inverterCost = usd.inverters * cfg.usdToPhp;
  const batteryCost = usd.batteries * cfg.usdToPhp;
  const mountingCost = usd.mounting * cfg.usdToPhp;
  const pvCableCost = usd.pvCable * cfg.usdToPhp;
  const freightCost = (panels * cfg.freightPerContainer) / cfg.panelsPerContainer;
  const basisCount: Record<PartBasis, number> = { job: 1, inverter: inverterCount, string: strings, panel: panels };
  const electricalParts = cfg.electricalParts.map((part) => {
    const quantity = Math.ceil(part.qty * basisCount[part.per] - 1e-9);
    return { name: part.name, quantity, unit: part.unit, php: part.php, total: quantity * part.php, estimate: !!part.estimate };
  });
  const electricalCost = electricalParts.reduce((sum, part) => sum + part.total, 0);
  const estimated = electricalParts.filter((part) => part.estimate && part.quantity > 0);
  if (estimated.length) {
    warnings.push(
      `${estimated.length} electrical part${estimated.length === 1 ? ' is' : 's are'} priced from estimates ` +
      `(${num0(estimated.reduce((sum, part) => sum + part.total, 0))} PHP), not store quotes.`,
    );
  }
  const total = panelCost + inverterCost + batteryCost + mountingCost + pvCableCost + freightCost + electricalCost +
    cfg.laborCost + cfg.netMeteringCost + cfg.miscCost;

  const months = sim.monthly.length;
  const needs = battery.needs;
  return {
    systemType,
    battery: {
      requiredKwh: round2(battery.requiredKwh),
      sizingKwh: round2(battery.sizingKwh),
      units: battery.units,
      unitsFor: battery.unitsFor,
      sizedBy: battery.sizedBy,
      afterSunsetTargetHours: gridTie ? 0 : cfg.minAfterSunsetHours,
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
      maxPanelsEach: cfg.inverterMaxPanels,
      countForLoad,
      countForPanels,
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
      annualClippedKwh: round2(sim.clippedKwh),
      exportToImportRatio: cfg.generationCharge / cfg.electricityRate,
    },
    outageCoverage: {
      eventsInSimulatedYear: sim.outageEvents,
      eventsFullyCovered: sim.outageEvents - sim.outageEventsUncovered,
      unmetLoadKwh: round2(sim.unmetKwh),
    },
    outageRuntime: gridTie
      ? null
      : {
        maxHours: RUNTIME_CAP_HOURS,
        peakSun: runtimeAt(startHours.peak),
        afterSunset: runtimeAt(startHours.sunset),
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
      usdToPhp: cfg.usdToPhp,
      usd: {
        panels: round2(usd.panels),
        inverters: round2(usd.inverters),
        batteries: round2(usd.batteries),
        mounting: round2(usd.mounting),
        pvCable: round2(usd.pvCable),
      },
      panels: round2(panelCost),
      inverters: round2(inverterCost),
      batteries: round2(batteryCost),
      mounting: round2(mountingCost),
      pvCable: round2(pvCableCost),
      pvCableRolls,
      mountingCabling: round2(mountingCost + pvCableCost),
      freight: round2(freightCost),
      electrical: round2(electricalCost),
      electricalParts,
      labor: cfg.laborCost,
      netMetering: cfg.netMeteringCost,
      misc: cfg.miscCost,
      total: round2(total),
    },
    warnings,
    notes,
  };
}

/**
 * The hybrid quote with the same customer on a grid-tie system attached as gridTie.
 * If the grid-tie system cannot be sized, the hybrid quote says why and has no gridTie.
 */
export function calculateComparison(input: CalculatorInput): QuoteResult {
  const hybrid = calculateQuote({ ...input, systemType: 'hybrid' });
  try {
    return { ...hybrid, gridTie: calculateQuote({ ...input, systemType: 'grid-tie' }) };
  } catch (e) {
    return { ...hybrid, warnings: [...hybrid.warnings, `No grid-tie comparison: ${(e as Error).message}`] };
  }
}

/** Exposed for unit tests only. Not part of the public API. */
export const __test = {
  outageNeedKwh, buildReferenceWeek, parseConsumption, buildSimContext, simulateYear, sizePanels,
  batteryRuntimeHours, runtimeStartHours, sizeBattery, spreadLevels, clippedShare,
};
