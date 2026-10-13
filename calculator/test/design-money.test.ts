import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoAssign, calculateDesign, panelArray, type Layout, type StringDef, type Yields } from '../src/pvDesign';
import { JINKO_725 } from '../src/pvDesignData';
import { calculateQuote, ZAMBOANGA_DEFAULTS } from '../src/solarQuoteCalculator';
import { designSunProfile, savingsFromBill, savingsFromQuote } from '../../src/lib/design-savings';
import { priceDesign, priceFor } from '../../src/lib/price-list';
import { defaultFieldText, defaultToggles, parseConsumptionCsv, sampleConsumptionCsv } from '../../src/lib/quote-input';

const m = (d: number) => Array(12).fill(d);
const yields: Yields = { faces: {}, flat: m(4.0), best: { pitchDeg: 8, azimuthDeg: 174, monthly: m(4.08) }, reference: m(3.5) };

/** A grid-tie design of `n` panels in one row, one HYX-S10K-S, strung 8 + 7 + 7 as far as they go. */
function design(n: number) {
  const panels = autoAssign(
    panelArray({ panel: JINKO_725, x: 0, y: 0, rows: 1, cols: n, orientation: 'portrait', rot: 0, gapM: 0.02, rowGapM: 0.3, idPrefix: 'a' }),
    [{ id: 'A', size: 8 }, { id: 'B', size: 7 }, { id: 'C', size: 7 }],
  );
  const layout: Layout = {
    panels,
    inverters: [{ id: 'INV1', model: 'HYXi HYX-S10K-S', x: 0, y: 6, floor: 1 }],
    meter: { x: 4, y: 8 },
    panelboard: null,
    floors: 1,
    floorHeightM: 3,
  };
  const strings: StringDef[] = [
    { id: 'A', inverterId: 'INV1', mppt: 0 },
    { id: 'B', inverterId: 'INV1', mppt: 1 },
    { id: 'C', inverterId: 'INV1', mppt: 2 },
  ];
  return calculateDesign({ layout, strings, yields, settings: { calibrationOverride: 1 } });
}

// ── Quote calculator: a fixed panel count ─────────────────────

test('calculateQuote simulates exactly the panels and inverters it is given', () => {
  const consumption = parseConsumptionCsv(sampleConsumptionCsv()).readings;
  const run = (n: number) =>
    calculateQuote({ consumption, systemType: 'grid-tie', fixedPanels: n, fixedInverters: { count: 1, totalKw: 10 } });
  const small = run(6);
  const big = run(14);
  assert.equal(small.panels.count, 6);
  assert.equal(big.panels.count, 14);
  assert.equal(big.inverter.count, 1);
  assert.ok(big.bill.annualAfter < small.bill.annualAfter);
});

test('the design sun profile keeps the logged hourly shape but carries the design yield', () => {
  const target = [4.1, 4.4, 4.5, 4.2, 3.7, 3.4, 3.5, 3.9, 4.0, 4.0, 4.0, 4.0];
  const p = designSunProfile(target);
  p.monthly.forEach((hours, i) => {
    assert.ok(Math.abs(hours.reduce((a, b) => a + b, 0) - target[i]) < 1e-9);
  });
});

// ── Price ─────────────────────────────────────────────────────

test('a design is priced line by line; unpriced parts are listed, not guessed', () => {
  const r = design(22);
  const price = priceDesign(r, {});
  const mcb = price.lines.find((l) => l.id === 'dc-mcb-32')!;
  assert.equal(mcb.unitPrice, 425);
  assert.equal(mcb.total, 425 * mcb.qty);
  assert.ok(price.unpriced.includes('Mid clamp'));
  const panels = price.lines.find((l) => l.id === 'panels')!;
  assert.equal(panels.total, 22 * priceFor('panels', {})!);
  const labour = price.extras.find((e) => e.item.key === 'job-labour')!;
  assert.equal(labour.total, ZAMBOANGA_DEFAULTS.laborCost);
  const freight = price.extras.find((e) => e.item.key === 'job-freight')!;
  assert.equal(freight.qty, 22);
  assert.equal(price.total, price.materials + price.extrasTotal + price.jobCosts);
});

test('a price set on the Prices page replaces the default, and prices an unpriced part', () => {
  const r = design(22);
  const before = priceDesign(r, {});
  const after = priceDesign(r, { 'mid-clamp': 35, 'dc-mcb-32': 500 });
  const clamps = after.lines.find((l) => l.id === 'mid-clamp')!;
  assert.equal(clamps.total, 35 * clamps.qty);
  assert.ok(!after.unpriced.includes('Mid clamp'));
  const mcbs = r.bom.find((l) => l.id === 'dc-mcb-32')!.qty;
  assert.equal(after.total - before.total, 35 * clamps.qty + 75 * mcbs);
});

test('fewer panels: a lower price', () => {
  assert.ok(priceDesign(design(16), {}).total < priceDesign(design(22), {}).total);
});

// ── Bill ──────────────────────────────────────────────────────

test('from a saved quote: the hourly simulation for the panels as drawn', () => {
  const inputs = {
    consumption: { text: sampleConsumptionCsv(), fileName: null },
    outages: { text: '', fileName: null },
    locations: [],
    dateOrder: undefined,
    fields: defaultFieldText(),
    toggles: defaultToggles(),
  };
  // The sample household is small: 16 panels already clear its bill, so compare below that.
  const s3 = savingsFromQuote(inputs, 12, design(3));
  const s6 = savingsFromQuote(inputs, 12, design(6));
  assert.ok(!('error' in s3) && !('error' in s6));
  if ('error' in s3 || 'error' in s6) return;
  assert.equal(s6.source, 'quote');
  assert.ok(s6.basis.startsWith("Quote #12's hourly consumption"));
  assert.ok(s6.reductionPct > s3.reductionPct, `${s6.reductionPct} vs ${s3.reductionPct}`);
  assert.ok(s6.monthlyAfter < s6.monthlyBefore);
  assert.ok(s6.annualSaving > s3.annualSaving);
});

test('from the monthly bill: more panels, a bigger cut, never past zero', () => {
  const small = savingsFromBill(8000, design(8));
  const big = savingsFromBill(8000, design(22));
  assert.ok(!('error' in small) && !('error' in big));
  if ('error' in small || 'error' in big) return;
  close(small.monthlyBefore, 8000, 1);
  assert.ok(big.reductionPct > small.reductionPct);
  assert.ok(big.monthlyAfter >= 0 && big.reductionPct <= 100);
  assert.deepEqual(savingsFromBill(0, design(8)), { error: 'The project has no monthly bill.' });
});

function close(a: number, b: number, tol: number) {
  assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
}
