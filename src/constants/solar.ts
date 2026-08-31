/**
 * Grid-tie sizing and quotation model.
 *
 * Implements `solar-calculation/solar-calculator-spec.md` and its companion
 * `solar-calculator-model.json`: two load models (residential archetypes and a
 * parametric commercial shape), a half-sine generation model, and a 5-minute
 * dispatch loop that splits generation into self-consumed, exported and
 * imported energy.
 *
 * Sizing does not need the simulation — the spec proves kWp is exactly linear
 * in monthly consumption and exactly inverse in yield, so the array comes from
 * a lookup table. The simulation runs anyway because it is cheap (288 steps)
 * and it is what produces the self-consumption and net-billing figures.
 *
 * NO BATTERY. Everything here assumes a grid-tied, net-metered system.
 *
 * Hardware costs are real supplier quotes. Balance-of-system, FX and
 * contingency are benchmarks — replace them with measured costs.
 */

/* ------------------------------------------------------------------ *
 * Constants
 * ------------------------------------------------------------------ */

/** Dispatch resolution. 5 minutes gives 288 steps a day. */
export const INTERVAL_MINUTES = 5;
const STEPS_PER_DAY = (24 * 60) / INTERVAL_MINUTES;
const DT = INTERVAL_MINUTES / 60; // hours per step

/** Zamboanga, July. Half-sine between these bounds. */
export const SUNRISE = 5.73;
export const SUNSET = 18.18;

/**
 * Equivalent peak-hours under the commercial shape S(t) — the area under the
 * piecewise curve. Derived, not assumed: 0.85 + 4.625 + 1.5.
 *
 * The prose in the spec quotes 8.1917 here, which is inconsistent with the
 * shape it defines and with its own commercial test vector; both give 6.975,
 * as does the JSON model file. We use 6.975.
 */
export const COMMERCIAL_PEAK_HOURS = 6.975;

/** Panel DC over inverter AC. */
export const DC_AC_RATIO = 1.2;

export const FX_PHP_PER_USD = 62;

/** Real supplier quotes (USD). */
export const Hardware = {
  panel: { model: 'Jinko 720 Wp', watts: 720, usd: 82.8 },
  inverters: [
    { model: 'Deye SUN-3K-SG04LP1-24', kw: 3, usd: 598 },
    { model: 'Deye SUN-6K-SG04LP1', kw: 6, usd: 730 },
    { model: 'Deye SUN-12K-SG02LP1', kw: 12, usd: 1527 },
  ],
} as const;

export const Model = {
  panelWatts: Hardware.panel.watts,
  /** kWp added per panel. */
  panelKwp: Hardware.panel.watts / 1000,
  /**
   * kWh per kWp per day. 3.5 is the measured figure for the Zamboanga array
   * the model was calibrated against. Everything scales inversely with it, so
   * a wrong yield moves the quote by tens of percent.
   */
  yieldPerKwp: 3.5,
  /** ZAMCELCO retail rate, pesos per kWh. Re-check every billing month. */
  gridRate: 12.0,
  /**
   * kWh exported per 1 kWh credited. 2:1 is the ZAMCELCO net-metering
   * position; 1:1 is full retail credit.
   */
  exportRatio: 2.0,
  /**
   * The only non-volumetric line on the ZAMCELCO invoices analysed: a 5-peso
   * monthly metering retail charge. Every other line moves with kWh, which is
   * why a kWh cut really is a peso cut here. Check the tariff before assuming
   * the same holds elsewhere.
   */
  fixedCharge: 5,
  /** Share of consumption the array is sized to remove, percent. */
  targetPct: 80,
  daysInMonth: 30,
  /** Days a commercial site is open, per week. */
  openDaysPerWeek: 6,
  /** VAT on imported modules. Zero only with a confirmed RA 9513 exemption. */
  vatRate: 0.12,
  /** Added to the whole job. */
  contingency: 0.08,
  /** Balance of system, pesos per kWp. Larger jobs spread fixed cost further. */
  bos: {
    residential: { low: 45000, high: 55000 },
    commercial: { low: 38000, high: 45000 },
  },
} as const;

/* ------------------------------------------------------------------ *
 * Load profiles
 * ------------------------------------------------------------------ */

export type Segment = 'residential' | 'commercial';
export type ResidentialProfile = 'typical' | 'away' | 'home' | 'aircon';
export type PeakBaseRatio = 10 | 15 | 20 | 30;
export type ProfileKey = ResidentialProfile | 'comm10' | 'comm15' | 'comm20' | 'comm30';

/**
 * Relative hourly weights, midnight to 23:00, each sitting at HH:30.
 *
 * Constructed archetypes, not measured data — no public dataset of hourly
 * Philippine household consumption exists. Every one peaks 18:00–21:00, after
 * solar has reached zero. Label them as estimates in the UI.
 */
export const RESIDENTIAL_PROFILES: Record<ResidentialProfile, number[]> = {
  typical: [
    1.1, 1.0, 1.0, 1.0, 1.0, 1.2, 2.2, 2.4, 1.6, 1.4, 1.4, 1.8,
    2.0, 1.7, 1.6, 1.6, 1.7, 2.2, 3.0, 3.4, 3.3, 2.9, 2.3, 1.6,
  ],
  away: [
    1.2, 1.1, 1.1, 1.1, 1.1, 1.3, 2.4, 2.6, 1.2, 0.9, 0.9, 0.9,
    0.9, 0.9, 0.9, 0.9, 1.0, 1.8, 3.2, 3.8, 3.7, 3.2, 2.5, 1.7,
  ],
  home: [
    1.2, 1.1, 1.1, 1.1, 1.1, 1.3, 2.2, 2.3, 2.0, 2.2, 2.4, 2.6,
    2.6, 2.5, 2.6, 2.6, 2.5, 2.6, 3.0, 3.2, 3.1, 2.7, 2.1, 1.5,
  ],
  aircon: [
    2.6, 2.5, 2.5, 2.4, 2.4, 2.3, 2.4, 2.2, 1.5, 1.4, 1.5, 1.8,
    2.0, 2.2, 2.4, 2.5, 2.6, 2.8, 3.4, 3.8, 3.9, 3.6, 3.2, 2.9,
  ],
};

export const RESIDENTIAL_LABELS: Record<ResidentialProfile, { name: string; blurb: string }> = {
  typical: {
    name: 'Typical',
    blurb: 'Someone in and out through the day, big evening peak, aircon at night.',
  },
  away: {
    name: 'Out all day',
    blurb: 'Empty roughly 08:00–17:00. The hardest shape for solar to serve.',
  },
  home: {
    name: 'Home all day',
    blurb: 'Work from home, small children, or a shop under the house.',
  },
  aircon: {
    name: 'Aircon overnight',
    blurb: 'Bedrooms cooled through the night, so the load never really drops.',
  },
};

export const COMMERCIAL_LABELS: Record<PeakBaseRatio, { name: string; blurb: string }> = {
  10: { name: '10 : 1', blurb: 'Poorly shut down — a lot still running after close.' },
  15: { name: '15 : 1', blurb: 'Partial shutdown; chillers or servers stay on.' },
  20: { name: '20 : 1', blurb: 'A normal small office. Use this one if unsure.' },
  30: { name: '30 : 1', blurb: 'Shuts down almost completely at night.' },
};

/**
 * Piecewise shape multiplier applied above the constant base load. The plateau
 * climbs to a 15:00 peak rather than sitting flat, because the Philippines is
 * a cooling climate year-round.
 */
export function commercialShape(t: number): number {
  if (t < 8 || t >= 18) return 0;
  if (t < 10) return (0.85 * (t - 8)) / 2;
  if (t < 15) return 0.85 + (0.15 * (t - 10)) / 5;
  return (18 - t) / 3;
}

/** Midpoint time, in hours, of interval `i`. */
function stepTime(i: number): number {
  return (i + 0.5) * DT;
}

/**
 * Residential load in kW for each 5-minute step of an average day. Linear
 * interpolation between hour centres, wrapping across midnight, scaled so the
 * curve integrates to `dailyKwh`.
 */
export function residentialLoadCurve(profile: ResidentialProfile, dailyKwh: number): number[] {
  const w = RESIDENTIAL_PROFILES[profile];
  const total = w.reduce((a, b) => a + b, 0);
  // Weights sit one hour apart, so the trapezoidal area over 24h is their sum.
  const scale = total > 0 ? dailyKwh / total : 0;
  const out = new Array<number>(STEPS_PER_DAY);
  for (let i = 0; i < STEPS_PER_DAY; i++) {
    const x = stepTime(i) - 0.5;
    const lo = Math.floor(x);
    const f = x - lo;
    const a = w[((lo % 24) + 24) % 24];
    const b = w[(((lo + 1) % 24) + 24) % 24];
    out[i] = (a + (b - a) * f) * scale;
  }
  return out;
}

export type CommercialLoad = { baseKw: number; peakKw: number; open: number[]; closed: number[] };

/**
 * Commercial load. A constant base load runs every hour of every day; on
 * working days the shape rides on top of it up to `peakKw`.
 */
export function commercialLoadCurves(
  monthlyKwh: number,
  ratio: number,
  days: number,
  workdays: number
): CommercialLoad {
  const denom = days * 24 + workdays * COMMERCIAL_PEAK_HOURS * (ratio - 1);
  const baseKw = denom > 0 ? monthlyKwh / denom : 0;
  const peakKw = baseKw * ratio;
  const open = new Array<number>(STEPS_PER_DAY);
  const closed = new Array<number>(STEPS_PER_DAY);
  for (let i = 0; i < STEPS_PER_DAY; i++) {
    open[i] = baseKw + (peakKw - baseKw) * commercialShape(stepTime(i));
    closed[i] = baseKw;
  }
  return { baseKw, peakKw, open, closed };
}

/* ------------------------------------------------------------------ *
 * Generation
 * ------------------------------------------------------------------ */

/**
 * Array output in kW for each step. Half-sine between sunrise and sunset,
 * normalised so the day's energy is exactly `kwp * yield` — only the intraday
 * distribution is an approximation, the daily total is not.
 */
export function solarCurve(kwp: number, yieldPerKwp: number): number[] {
  const raw = new Array<number>(STEPS_PER_DAY);
  let area = 0;
  for (let i = 0; i < STEPS_PER_DAY; i++) {
    const t = stepTime(i);
    const g =
      t >= SUNRISE && t <= SUNSET
        ? Math.sin((Math.PI * (t - SUNRISE)) / (SUNSET - SUNRISE))
        : 0;
    raw[i] = g;
    area += g * DT;
  }
  const scale = area > 0 ? (kwp * yieldPerKwp) / area : 0;
  return raw.map((g) => g * scale);
}

/* ------------------------------------------------------------------ *
 * Dispatch
 * ------------------------------------------------------------------ */

export type DayFlows = { self: number; exported: number; imported: number };

/** One day of load against one day of generation, in kWh. */
export function dispatchDay(load: number[], solar: number[]): DayFlows {
  let self = 0;
  let exported = 0;
  let imported = 0;
  for (let i = 0; i < load.length; i++) {
    const l = load[i];
    const s = solar[i];
    self += Math.min(l, s) * DT;
    exported += Math.max(s - l, 0) * DT;
    imported += Math.max(l - s, 0) * DT;
  }
  return { self, exported, imported };
}

/* ------------------------------------------------------------------ *
 * Sizing coefficients
 * ------------------------------------------------------------------ */

const RATIO_STOPS = [1.0, 1.5, 2.0, 2.5, 3.0] as const;
const TARGET_STOPS = [50, 60, 70, 80, 90] as const;

/** `B`, such that kWp = monthly_kWh * B / yield. Rows are ratio, columns target. */
const COEFFICIENT_B: Record<ProfileKey, number[][]> = {
  typical: [
    [0.01667, 0.02, 0.02333, 0.02667, 0.03],
    [0.01862, 0.02328, 0.02803, 0.03282, 0.03765],
    [0.02031, 0.02623, 0.03234, 0.03858, 0.04494],
    [0.02181, 0.02895, 0.0364, 0.04413, 0.05203],
    [0.02317, 0.03148, 0.04031, 0.04953, 0.05899],
  ],
  away: [
    [0.01667, 0.02, 0.02333, 0.02667, 0.03],
    [0.02037, 0.02511, 0.02988, 0.03468, 0.03951],
    [0.02369, 0.02977, 0.03594, 0.0422, 0.04855],
    [0.02674, 0.03411, 0.04168, 0.04944, 0.05736],
    [0.02957, 0.03823, 0.04722, 0.05653, 0.06603],
  ],
  home: [
    [0.01667, 0.02, 0.02333, 0.02667, 0.03],
    [0.01751, 0.02202, 0.0267, 0.03147, 0.03631],
    [0.01818, 0.02377, 0.02976, 0.03597, 0.04232],
    [0.01874, 0.02534, 0.03262, 0.04028, 0.04815],
    [0.01921, 0.02678, 0.03535, 0.04446, 0.05386],
  ],
  aircon: [
    [0.01667, 0.02, 0.02333, 0.02667, 0.03],
    [0.01933, 0.02404, 0.02884, 0.03369, 0.03858],
    [0.02167, 0.02776, 0.03403, 0.04041, 0.04687],
    [0.02382, 0.03128, 0.03903, 0.04696, 0.055],
    [0.02583, 0.03466, 0.04391, 0.0534, 0.06304],
  ],
  comm10: [
    [0.01613, 0.01935, 0.02258, 0.02581, 0.02903],
    [0.01735, 0.02099, 0.02466, 0.02837, 0.0321],
    [0.01808, 0.02199, 0.02595, 0.02997, 0.03415],
    [0.01857, 0.02266, 0.02683, 0.03108, 0.0359],
    [0.01892, 0.02315, 0.02746, 0.03189, 0.03743],
  ],
  comm15: [
    [0.01613, 0.01935, 0.02258, 0.02581, 0.02903],
    [0.01754, 0.02119, 0.02486, 0.02856, 0.03228],
    [0.01839, 0.02231, 0.02627, 0.03027, 0.03434],
    [0.01896, 0.02306, 0.02722, 0.03145, 0.03576],
    [0.01937, 0.02361, 0.02792, 0.03232, 0.03689],
  ],
  comm20: [
    [0.01613, 0.01935, 0.02258, 0.02581, 0.02903],
    [0.01766, 0.02131, 0.02498, 0.02868, 0.03239],
    [0.01858, 0.0225, 0.02646, 0.03046, 0.03451],
    [0.0192, 0.02331, 0.02747, 0.03168, 0.03597],
    [0.01965, 0.02389, 0.0282, 0.03258, 0.03705],
  ],
  comm30: [
    [0.01613, 0.01935, 0.02258, 0.02581, 0.02903],
    [0.01779, 0.02145, 0.02512, 0.02881, 0.03252],
    [0.0188, 0.02272, 0.02668, 0.03067, 0.03471],
    [0.01948, 0.02359, 0.02774, 0.03195, 0.03622],
    [0.01996, 0.02421, 0.02851, 0.03288, 0.03733],
  ],
};

/**
 * Share of generation used on site at the tabulated 80% target and 2:1 export.
 * Copy only — the live figure on screen comes from the dispatch loop.
 */
export const SELF_SHARE: Record<ProfileKey, number> = {
  typical: 0.3824,
  away: 0.2639,
  home: 0.4826,
  aircon: 0.3197,
  comm10: 0.7221,
  comm15: 0.7048,
  comm20: 0.6944,
  comm30: 0.6826,
};

export function profileKey(
  segment: Segment,
  profile: ResidentialProfile,
  ratio: PeakBaseRatio
): ProfileKey {
  return segment === 'residential' ? profile : (`comm${ratio}` as ProfileKey);
}

/** Position of `v` in a sorted stop list, as index plus fraction, clamped. */
function locate(v: number, stops: readonly number[]): { i: number; f: number } {
  const last = stops.length - 1;
  if (!Number.isFinite(v) || v <= stops[0]) return { i: 0, f: 0 };
  if (v >= stops[last]) return { i: last - 1, f: 1 };
  let i = 0;
  while (i < last - 1 && v >= stops[i + 1]) i++;
  return { i, f: (v - stops[i]) / (stops[i + 1] - stops[i]) };
}

/** Bilinear lookup into the coefficient table. Values off the grid are clamped. */
export function coefficientB(key: ProfileKey, exportRatio: number, targetPct: number): number {
  const table = COEFFICIENT_B[key];
  const r = locate(exportRatio, RATIO_STOPS);
  const c = locate(targetPct, TARGET_STOPS);
  const top = table[r.i][c.i] + (table[r.i][c.i + 1] - table[r.i][c.i]) * c.f;
  const bot = table[r.i + 1][c.i] + (table[r.i + 1][c.i + 1] - table[r.i + 1][c.i]) * c.f;
  return top + (bot - top) * r.f;
}

/* ------------------------------------------------------------------ *
 * The estimate
 * ------------------------------------------------------------------ */

export type CalcInput = {
  segment: Segment;
  /** Residential only. */
  profile: ResidentialProfile;
  /** Commercial only. */
  peakBaseRatio: PeakBaseRatio;
  monthlyKwh: number;
  /** Share of consumption the array is sized to remove, 50–90. */
  targetPct: number;
  yieldPerKwp: number;
  /** kWh exported per 1 kWh credited. 1 means full retail credit. */
  exportRatio: number;
  gridRate: number;
  fixedCharge: number;
  daysInMonth: number;
  /** Commercial only. */
  openDaysPerWeek: number;
};

export type Estimate = {
  /** Before rounding to whole panels. */
  targetKwp: number;
  panels: number;
  installedKwp: number;
  inverterKw: number;
  /** Smallest inverter we stock that covers it, if any. */
  inverterModel: string | null;
  baseKw: number;
  peakKw: number;
  monthlyKwh: number;
  generation: number;
  selfKwh: number;
  exportKwh: number;
  importKwh: number;
  /** import - export / ratio, floored at zero. */
  billedKwh: number;
  selfSharePct: number;
  /** Generation as a share of consumption. */
  productionPct: number;
  /** The reduction the rounded array actually achieves — what to quote. */
  reductionPct: number;
  billBefore: number;
  billAfter: number;
  monthlySaving: number;
  costLow: number;
  costHigh: number;
  paybackLow: number;
  paybackHigh: number;
  /** True when credits cancel imports and the bill sits on the fixed charge. */
  atFloor: boolean;
};

function inverterFor(kw: number): string | null {
  const fit = Hardware.inverters.find((i) => i.kw >= kw - 0.01);
  return fit ? fit.model : null;
}

/** Modules are only 13–18% of the job; the BOS rate is what moves the price. */
export function jobCost(panels: number, installedKwp: number, segment: Segment) {
  const modules = panels * Hardware.panel.usd * FX_PHP_PER_USD * (1 + Model.vatRate);
  const band = Model.bos[segment];
  const withBos = (rate: number) => (modules + installedKwp * rate) * (1 + Model.contingency);
  return { modules, low: withBos(band.low), high: withBos(band.high) };
}

export const DEFAULT_INPUT: CalcInput = {
  segment: 'residential',
  profile: 'typical',
  peakBaseRatio: 20,
  monthlyKwh: 300,
  targetPct: Model.targetPct,
  yieldPerKwp: Model.yieldPerKwp,
  exportRatio: Model.exportRatio,
  gridRate: Model.gridRate,
  fixedCharge: Model.fixedCharge,
  daysInMonth: Model.daysInMonth,
  openDaysPerWeek: Model.openDaysPerWeek,
};

/** Runs sizing, dispatch, billing and cost for one set of inputs. */
export function estimate(input: Partial<CalcInput> = {}): Estimate {
  const c = { ...DEFAULT_INPUT, ...input };
  const monthlyKwh = Math.max(0, c.monthlyKwh);
  const days = Math.max(1, c.daysInMonth);
  const workdays = (days * Math.min(7, Math.max(0, c.openDaysPerWeek))) / 7;
  const key = profileKey(c.segment, c.profile, c.peakBaseRatio);

  // ---- size ----
  const b = coefficientB(key, c.exportRatio, c.targetPct);
  const targetKwp = c.yieldPerKwp > 0 ? (monthlyKwh * b) / c.yieldPerKwp : 0;
  // Round panels up. At residential scale one panel is a large step, so the
  // overshoot is material — which is why we report the achieved reduction
  // below rather than the target that produced this number.
  const panels = Math.max(monthlyKwh > 0 ? 1 : 0, Math.ceil((targetKwp * 1000) / Model.panelWatts));
  const installedKwp = (panels * Model.panelWatts) / 1000;
  const inverterKw = installedKwp / DC_AC_RATIO;

  // ---- dispatch ----
  const solar = solarCurve(installedKwp, c.yieldPerKwp);
  let baseKw = 0;
  let peakKw = 0;
  let self = 0;
  let exported = 0;
  let imported = 0;

  if (c.segment === 'residential') {
    const load = residentialLoadCurve(c.profile, monthlyKwh / days);
    peakKw = Math.max(...load);
    baseKw = Math.min(...load);
    const d = dispatchDay(load, solar);
    self = d.self * days;
    exported = d.exported * days;
    imported = d.imported * days;
  } else {
    const cm = commercialLoadCurves(monthlyKwh, c.peakBaseRatio, days, workdays);
    baseKw = cm.baseKw;
    peakKw = cm.peakKw;
    const open = dispatchDay(cm.open, solar);
    const closed = dispatchDay(cm.closed, solar);
    self = open.self * workdays + closed.self * (days - workdays);
    exported = open.exported * workdays + closed.exported * (days - workdays);
    imported = open.imported * workdays + closed.imported * (days - workdays);
  }

  const generation = installedKwp * c.yieldPerKwp * days;
  const ratio = Math.max(1, c.exportRatio);
  // Self-consumed solar always offsets 1:1; only exports take the haircut.
  const netKwh = imported - exported / ratio;
  const billedKwh = Math.max(0, netKwh);

  // ---- money ----
  const billBefore = monthlyKwh * c.gridRate + c.fixedCharge;
  const billAfter = billedKwh * c.gridRate + c.fixedCharge;
  const monthlySaving = billBefore - billAfter;
  const cost = jobCost(panels, installedKwp, c.segment);
  const annualSaving = monthlySaving * 12;

  return {
    targetKwp,
    panels,
    installedKwp,
    inverterKw,
    inverterModel: inverterFor(inverterKw),
    baseKw,
    peakKw,
    monthlyKwh,
    generation,
    selfKwh: self,
    exportKwh: exported,
    importKwh: imported,
    billedKwh,
    selfSharePct: generation > 0 ? (self / generation) * 100 : 0,
    productionPct: monthlyKwh > 0 ? (generation / monthlyKwh) * 100 : 0,
    reductionPct: monthlyKwh > 0 ? ((monthlyKwh - billedKwh) / monthlyKwh) * 100 : 0,
    billBefore,
    billAfter,
    monthlySaving,
    costLow: cost.low,
    costHigh: cost.high,
    paybackLow: annualSaving > 0 ? cost.low / annualSaving : Infinity,
    paybackHigh: annualSaving > 0 ? cost.high / annualSaving : Infinity,
    atFloor: netKwh <= 0.5,
  };
}

/* ------------------------------------------------------------------ *
 * Formatting
 * ------------------------------------------------------------------ */

export function peso(n: number): string {
  return '₱' + Math.round(n).toLocaleString('en-PH');
}

export function kwh(n: number): string {
  return Math.round(n).toLocaleString('en-PH') + ' kWh';
}

/** A range, collapsed when both ends round to the same figure. */
export function pesoRange(a: number, b: number): string {
  const lo = peso(Math.min(a, b));
  const hi = peso(Math.max(a, b));
  return lo === hi ? lo : lo + ' – ' + hi;
}

export function yearsRange(a: number, b: number): string {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return '—';
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  if (hi > 25) return '25+ yrs';
  return lo.toFixed(1) + ' – ' + hi.toFixed(1) + ' yrs';
}

/** Monthly kWh implied by a peso bill. */
export function kwhFromBill(
  bill: number,
  gridRate: number = Model.gridRate,
  fixedCharge: number = Model.fixedCharge
): number {
  return gridRate > 0 ? Math.max(0, (Math.max(0, bill) - fixedCharge) / gridRate) : 0;
}

export function billFromKwh(
  monthlyKwh: number,
  gridRate: number = Model.gridRate,
  fixedCharge: number = Model.fixedCharge
): number {
  return Math.max(0, monthlyKwh) * gridRate + fixedCharge;
}

/** Which segment a bill of this size is most likely to be. */
export function segmentFor(monthlyKwh: number): Segment {
  return monthlyKwh >= 1500 ? 'commercial' : 'residential';
}

/* ------------------------------------------------------------------ *
 * Packages — marketing copy for the home page, not the calculator
 * ------------------------------------------------------------------ */

export type PackageKey = 'daylight' | 'standard' | 'commercial';

export type SolarPackage = {
  key: PackageKey;
  name: string;
  sizeLabel: string;
  lede: string;
  points: string[];
  bestFor: string;
  accent: 'sun' | 'accent' | 'accentAlt' | 'accentWarm';
  featured?: boolean;
};

export const PACKAGES: SolarPackage[] = [
  {
    key: 'daylight',
    name: 'Daylight',
    sizeLabel: '2.16 kWp · 3 panels',
    lede: 'Covers what runs while the sun is up — fridge, fans, water pump, lights, a laptop or two. Almost nothing exported, so almost every kilowatt-hour earns the full rate.',
    points: [
      'Fastest payback per peso of any tier',
      'Lowest entry cost — the widest door into solar',
      'Rails and inverter sized with headroom, so phase two is a half-day job',
      'Grid-tied: shuts down safely during a brownout',
    ],
    bestFor:
      'Households with a modest bill, anyone testing the water, or a small shop that empties in the evening.',
    accent: 'sun',
  },
  {
    key: 'standard',
    name: 'Standard',
    sizeLabel: '2.9 – 10.1 kWp · 4–14 panels',
    lede: 'Sized to remove about 80% of your bill. Daytime load runs on sun, surplus goes to the grid as credit, and the night draws that credit back down.',
    points: [
      'The default, and what the estimator sizes toward',
      'Cuts the largest and most volatile part of your bill',
      'Net metering registered and filed by us',
      'Grid-tied: shuts down safely during a brownout',
    ],
    bestFor:
      'A family home with aircon, a business run from the house, or any building with steady daytime use.',
    accent: 'accent',
    featured: true,
  },
  {
    key: 'commercial',
    name: 'Commercial',
    sizeLabel: '20 kWp and up · phased install',
    lede: 'Office and retail demand happens while the sun is up, so around seven in ten kilowatt-hours are used on site instead of exported. That is why commercial pays back fastest.',
    points: [
      'Roughly 69% self-consumption — better than any household pattern',
      'The export haircut barely bites, because there is little to export',
      'Installed in phases so trading never stops',
      'Net metering cap raised to 1 MW by the 2026 circular',
    ],
    bestFor:
      'Offices, clinics, groceries, cold storage — anything drawing steadily between 08:00 and 18:00.',
    accent: 'accentWarm',
  },
];

export const PACKAGE_BY_KEY: Record<PackageKey, SolarPackage> = PACKAGES.reduce(
  (acc, p) => ({ ...acc, [p.key]: p }),
  {} as Record<PackageKey, SolarPackage>
);
