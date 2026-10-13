import type { DesignResult } from '@calculator/pvDesign';
import {
  calculateQuote,
  parseOutageCsv,
  ZAMBOANGA_DEFAULTS,
  type QuoteDefaults,
  type SunProfile,
} from '@calculator/solarQuoteCalculator';
import { ZAMBOANGA_SUN_PROFILE } from '@calculator/zamboangaSunProfile';

import { dispatchDay, residentialLoadCurve, solarCurve } from '@/constants/solar';
import { parseConsumptionCsv, readAssumptions } from '@/lib/quote-input';
import type { QuoteInputs } from '@/lib/quotes-api';

/**
 * What the layout as drawn does to the customer's electricity bill.
 *
 * With a saved quote, its hourly consumption is simulated again (the quote
 * calculator's grid-tie model, with clipping and net-metering credit) for the
 * design's exact panels and inverters and its calibrated monthly sun.
 * Without one, the project's monthly bill and a typical household day stand in.
 * Pure: no network, so it can run on every change and in the tests.
 */

export type Savings = {
  source: 'quote' | 'bill';
  /** Where the consumption came from, for the screen */
  basis: string;
  monthlyBefore: number;
  monthlyAfter: number;
  reductionPct: number;
  annualSaving: number;
  /** kWh the inverters lose at their limit (quote simulation only) */
  clippedKwh: number | null;
};

const DAYS = [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** The design's expected kWh per kWp per day, by month, after calibration. */
function monthlyPerKwpDay(result: DesignResult): number[] | null {
  const kwp = result.dcKw;
  if (!result.sun || !(kwp > 0)) return null;
  return result.sun.monthlyKwh.map((kwh, m) => kwh / kwp / DAYS[m]);
}

/**
 * The logged sun profile (hourly shape and within-hour spread), each month
 * scaled so its daily total is what the design's roofs are expected to make.
 */
export function designSunProfile(perKwpDay: number[], base: SunProfile = ZAMBOANGA_SUN_PROFILE): SunProfile {
  const k = base.monthly.map((hours, m) => {
    const sum = hours.reduce((a, b) => a + b, 0);
    return sum > 0 ? perKwpDay[m] / sum : 0;
  });
  return {
    monthly: base.monthly.map((hours, m) => hours.map((h) => h * k[m])),
    source: 'PV design: PVGIS calibrated to the logged array, shaped by the inverter log',
    spread: base.spread && {
      weights: base.spread.weights,
      levels: base.spread.levels.map((month, m) => month.map((hour) => hour.map((v) => v * k[m]))),
    },
  };
}

/** Re-runs a saved quote's hourly simulation for the layout as drawn. */
export function savingsFromQuote(inputs: QuoteInputs, quoteId: number, result: DesignResult): Savings | { error: string } {
  const perKwpDay = monthlyPerKwpDay(result);
  if (!perKwpDay) return { error: 'No sun data yet.' };
  if (!result.inverters.length || !(result.acKw > 0)) return { error: 'Place an inverter to work out the bill.' };
  const { values, errors } = readAssumptions(inputs.fields, inputs.toggles);
  if (errors.length) return { error: `Quote #${quoteId} has assumptions that don't read: ${errors.join(', ')}.` };
  const consumption = parseConsumptionCsv(inputs.consumption.text).readings;
  if (consumption.length < 168) return { error: `Quote #${quoteId} has less than a week of hourly consumption.` };
  const outages = inputs.outages.text.trim()
    ? parseOutageCsv(inputs.outages.text, { locations: inputs.locations, dateOrder: inputs.dateOrder }).outages
    : [];
  try {
    const q = calculateQuote({
      ...values,
      consumption,
      outages,
      dateOrder: inputs.dateOrder,
      systemType: 'grid-tie',
      // The design's yields already carry every loss, calibrated to the logged array
      systemLossFactor: 1,
      panelWatts: result.panel.watts,
      sunProfile: designSunProfile(perKwpDay),
      fixedPanels: result.panels,
      fixedInverters: { count: result.inverters.length, totalKw: result.acKw },
    });
    return {
      source: 'quote',
      basis: `Quote #${quoteId}'s hourly consumption, ${Math.round(q.energy.annualConsumptionKwh).toLocaleString('en-PH')} kWh a year`,
      monthlyBefore: q.bill.averageMonthlyBefore,
      monthlyAfter: q.bill.averageMonthlyAfter,
      reductionPct: q.bill.reductionPercent,
      annualSaving: q.bill.annualBefore - q.bill.annualAfter,
      clippedKwh: q.energy.annualClippedKwh ?? null,
    };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/**
 * From the monthly bill alone: kWh = bill ÷ the import rate, spread over a
 * typical household day, netted against the design's sun month by month with
 * the quote calculator's tariff (import rate, export credit, credit rollover).
 */
export function savingsFromBill(
  monthlyBill: number,
  result: DesignResult,
  tariff: QuoteDefaults = ZAMBOANGA_DEFAULTS,
): Savings | { error: string } {
  const perKwpDay = monthlyPerKwpDay(result);
  if (!perKwpDay) return { error: 'No sun data yet.' };
  if (!(monthlyBill > 0)) return { error: 'The project has no monthly bill.' };
  const rate = tariff.electricityRate;
  const dailyKwh = monthlyBill / rate / (365.25 / 12);
  const load = residentialLoadCurve('typical', dailyKwh);
  let carry = 0;
  let before = 0;
  let after = 0;
  perKwpDay.forEach((y, m) => {
    const day = dispatchDay(load, solarCurve(result.dcKw, y));
    const charge = day.imported * DAYS[m] * rate;
    const credit = day.exported * DAYS[m] * tariff.generationCharge + (tariff.creditRollover ? carry : 0);
    carry = Math.max(0, credit - charge);
    before += dailyKwh * DAYS[m] * rate;
    after += Math.max(0, charge - credit);
  });
  return {
    source: 'bill',
    basis: `The project's ₱${Math.round(monthlyBill).toLocaleString('en-PH')} monthly bill and a typical household day`,
    monthlyBefore: before / 12,
    monthlyAfter: after / 12,
    reductionPct: before > 0 ? (1 - after / before) * 100 : 0,
    annualSaving: before - after,
    clippedKwh: null,
  };
}
