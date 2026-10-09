/**
 * The public estimate, run through the same calculator staff quote with.
 *
 * The internal calculator wants a week of hourly meter readings; the public
 * page only has a bill and a description of the building. So the week is
 * synthesised from the load shapes in constants/solar.ts, scaled to the bill,
 * and everything else is left at ZAMBOANGA_DEFAULTS. There is no barangay, so
 * no outage history is applied.
 */

import {
  ZAMBOANGA_DEFAULTS,
  calculateComparison,
  type HourlyReading,
  type QuoteResult,
} from '@calculator/solarQuoteCalculator';

import {
  RESIDENTIAL_PROFILES,
  commercialShape,
  type PeakBaseRatio,
  type ResidentialProfile,
  type Segment,
} from '@/constants/solar';

/** A Monday. The calculator repeats this week across the simulated year. */
const WEEK_START = { year: 2026, month: 9, day: 7 };

export type EstimateInput = {
  segment: Segment;
  profile: ResidentialProfile;
  peakBaseRatio: PeakBaseRatio;
  monthlyKwh: number;
  /** Share of the bill to remove, 50–90 */
  targetPct: number;
  /** ₱/kWh paid on import */
  importRate: number;
  /** ₱/kWh credited on export */
  exportCredit: number;
  /** Commercial only */
  openDaysPerWeek: number;
  /** Live rate when known; the calculator's fallback otherwise */
  usdToPhp?: number;
};

/** Hourly kWh for each day of the week, Monday first. */
function weekShape(input: EstimateInput): number[][] {
  if (input.segment === 'residential') {
    const w = RESIDENTIAL_PROFILES[input.profile];
    return Array.from({ length: 7 }, () => [...w]);
  }
  // Base load every hour; on open days the shape rides on top of it up to ratio × base.
  const open = Math.round(Math.min(7, Math.max(0, input.openDaysPerWeek)));
  const lift = input.peakBaseRatio - 1;
  return Array.from({ length: 7 }, (_, d) =>
    Array.from({ length: 24 }, (_, h) => 1 + (d < open ? lift * commercialShape(h + 0.5) : 0)),
  );
}

/** A week of hourly readings that adds up to the monthly consumption, at 12 months a year. */
export function syntheticWeek(input: EstimateInput): HourlyReading[] {
  const shape = weekShape(input);
  const total = shape.flat().reduce((a, b) => a + b, 0);
  const weekKwh = ((Math.max(0, input.monthlyKwh) * 12) / 365) * 7;
  const scale = total > 0 ? weekKwh / total : 0;
  const pad = (n: number) => String(n).padStart(2, '0');
  const { year, month, day } = WEEK_START;
  return shape.flatMap((hours, d) =>
    hours.map((w, h) => ({
      timestamp: `${year}-${pad(month)}-${pad(day + d)} ${pad(h)}:00`,
      kWh: w * scale,
    })),
  );
}

/** The hybrid quote, with the grid-tie alternative attached as `gridTie`. */
export function estimateQuote(input: EstimateInput): QuoteResult {
  return calculateComparison({
    consumption: syntheticWeek(input),
    targetReduction: input.targetPct / 100,
    electricityRate: input.importRate,
    generationCharge: input.exportCredit,
    ...(input.usdToPhp ? { usdToPhp: input.usdToPhp } : {}),
  });
}

/** Shortest payback the public price may show, in years. */
const MIN_PAYBACK_YEARS = { 'grid-tie': 2.5, hybrid: 3 } as const;

/** The shown price never exceeds the calculator's total by more than this factor. */
const MAX_MARKUP = 1.5;

/**
 * The price shown to the public: the calculator's total, raised where needed
 * so simple payback is not shorter than MIN_PAYBACK_YEARS, but never above
 * MAX_MARKUP times the total. Where the cap binds, payback comes out shorter
 * than the minimum.
 */
export function publicPrice(q: QuoteResult): { price: number; annualSaving: number; years: number | null } {
  const annualSaving = q.bill.annualBefore - q.bill.annualAfter;
  const floor = annualSaving * MIN_PAYBACK_YEARS[q.systemType ?? 'hybrid'];
  const price = Math.min(Math.max(q.pricing.total, floor), q.pricing.total * MAX_MARKUP);
  return { price, annualSaving, years: annualSaving > 0 ? price / annualSaving : null };
}

export const EstimateDefaults = {
  importRate: ZAMBOANGA_DEFAULTS.electricityRate,
  exportCredit: ZAMBOANGA_DEFAULTS.generationCharge,
  openDaysPerWeek: 6,
} as const;
