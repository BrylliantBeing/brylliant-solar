import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  autoAssign, calculateDesign, panelArray, shortCircuitAnalysis, voltageDrop, type Layout, type StringDef,
} from '../src/pvDesign';
import { JINKO_725 } from '../src/pvDesignData';

const close = (actual: number, expected: number, tol = 0.01) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${actual} is not within ${tol} of ${expected}`);

/** 22 panels, two portrait rows of 11, strung 8 + 7 + 7 onto one HYX-S10K-S2. */
function site(over: Partial<Layout> = {}): { layout: Layout; strings: StringDef[] } {
  const panels = autoAssign(
    panelArray({ panel: JINKO_725, x: 0, y: 0, rows: 2, cols: 11, orientation: 'portrait', rot: 0, gapM: 0.02, rowGapM: 0.3, idPrefix: 'a' }),
    [
      { id: 'A', size: 8 },
      { id: 'B', size: 7 },
      { id: 'C', size: 7 },
    ],
  );
  return {
    layout: {
      panels,
      inverters: [{ id: 'INV1', model: 'HYXi HYX-S10K-S2', x: 0, y: 6, floor: 1 }],
      meter: { x: 4, y: 8 },
      panelboard: null,
      floors: 2,
      floorHeightM: 3,
      ...over,
    },
    strings: [
      { id: 'A', inverterId: 'INV1', mppt: 0 },
      { id: 'B', inverterId: 'INV1', mppt: 1 },
      { id: 'C', inverterId: 'INV1', mppt: 1 },
    ],
  };
}

// ── Voltage drop ──────────────────────────────────────────────

test('voltage drop matches the xlsx calculator', () => {
  // Sheet: X 0.054, R 2 (3.5 mm²), 50 m, K 2, 13 A → 8.5277 V; the sheet divides by 240.
  const vd = voltageDrop({ lengthM: 50, currentA: 13, rOhmPer305m: 2, xOhmPer305m: 0.054, nominalV: 240 });
  close(vd.volts, 8.52769681, 1e-6);
  close(vd.pct, 3.553207, 1e-5);
});

// ── Strings and MPPTs ─────────────────────────────────────────

test('8 + 7 + 7 strings: voltages, currents and the MPPT2 clipping warning', () => {
  const r = calculateDesign(site());
  const [a, b, c] = r.strings;
  assert.deepEqual([a.series, b.series, c.series], [8, 7, 7]);
  close(a.vocColdV, 8 * 49.2 * 1.0125); // 398.52 V at 20 °C, under 600 V
  close(b.vmpV, 287);
  assert.equal(r.unassignedPanels, 0);
  close(r.dcKw, 15.95, 1e-9);
  close(r.dcAcRatio!, 1.595, 1e-9);

  const mppt2 = r.mppts.find((m) => m.mppt === 1)!;
  close(mppt2.iscA, 37.48);
  close(mppt2.impA, 35.38);
  assert.ok(r.warnings.some((w) => w.includes('MPPT2: Imp 35.38 A is above its 32 A')));
  assert.ok(!r.warnings.some((w) => w.includes('short-circuit rating')));
  assert.ok(!r.warnings.some((w) => w.includes('inverter limit')));
});

test('a 13-panel string goes over 600 V cold and is flagged, not refused', () => {
  const { layout, strings } = site();
  const panels = autoAssign(layout.panels, [{ id: 'A', size: 13 }, { id: 'B', size: 9 }]);
  const r = calculateDesign({ layout: { ...layout, panels }, strings: strings.slice(0, 2) });
  assert.ok(r.warnings.some((w) => w.startsWith('String A: 13 panels reach')));
  assert.equal(r.strings[0].series, 13);
});

// ── Wire and breaker sizing ───────────────────────────────────

test('DC strings: 1.56 × Isc → 32 A breaker on 6 mm²; AC: 1.25 × 45.5 A → 60 AT on 14 mm²', () => {
  const r = calculateDesign(site());
  const dc = r.circuits.find((c) => c.id === 'dc-A')!;
  close(dc.designA, 29.28);
  assert.equal(dc.breakerA, 32);
  assert.equal(dc.mm2, 6);
  assert.ok(dc.vdropPct < 3);

  const ac = r.circuits.find((c) => c.id === 'ac-INV1')!;
  close(ac.designA, 56.88);
  assert.equal(ac.breakerA, 60);
  assert.equal(ac.mm2, 14);
  assert.equal(ac.awg, '#6');
  assert.equal(ac.groundMm2, 5.5);
  assert.equal(ac.upsizedForVdrop, false);
});

test('a long AC run is upsized until the drop is within 3%', () => {
  const r = calculateDesign(site({ meter: { x: 0, y: 6 + 78.5 } }));
  const ac = r.circuits.find((c) => c.kind === 'ac')!;
  // 80 m one-way before slack: 14 mm² ≈ 5.6%, 22 mm² ≈ 3.6%, 30 mm² ≈ 2.2%.
  assert.equal(ac.mm2, 30);
  assert.equal(ac.upsizedForVdrop, true);
  assert.ok(ac.vdropPct <= 3);
  assert.ok(!r.warnings.some((w) => w.includes('voltage drop')));
});

test('an override is kept and checked, never corrected', () => {
  const r = calculateDesign({ ...site(), overrides: { 'dc-A': { mm2: 2.5 } } });
  const dc = r.circuits.find((c) => c.id === 'dc-A')!;
  assert.equal(dc.mm2, 2.5);
  assert.equal(dc.overridden, true);
  assert.ok(r.warnings.some((w) => w.includes('2.5 mm² carries 21 A')));
  assert.ok(r.warnings.some((w) => w.includes('below the 4 mm² minimum')));
});

test('runs grow with floors and with the inverter moving away', () => {
  const near = calculateDesign(site()).circuits.find((c) => c.id === 'dc-A')!;
  const higher = calculateDesign(site({ floors: 3 })).circuits.find((c) => c.id === 'dc-A')!;
  const far = calculateDesign(
    site({ inverters: [{ id: 'INV1', model: 'HYXi HYX-S10K-S2', x: 0, y: 20, floor: 1 }] }),
  ).circuits.find((c) => c.id === 'dc-A')!;
  close(higher.oneWayM - near.oneWayM, 3 * 1.1, 0.11);
  assert.ok(far.oneWayM > near.oneWayM);
  assert.equal(near.estimated, false);
});

test('without an inverter, the fallback run is used and flagged', () => {
  const r = calculateDesign(site({ inverters: [] }));
  assert.ok(r.warnings.includes('No inverter placed yet.'));
  assert.ok(r.warnings.some((w) => w.includes('not connected to an inverter')));
});

// ── Bill of materials ─────────────────────────────────────────

test('mounting for two portrait rows of 11', () => {
  const r = calculateDesign(site());
  const qty = (id: string) => r.bom.find((l) => l.id === id)?.qty;
  // Each rail: 11 × 1.303 + 10 × 0.02 + 2 × 0.1 = 14.733 m → 4 pieces of 4.2 m, 3 splices, 14 feet.
  assert.equal(qty('rail'), 16);
  assert.equal(qty('rail-splice'), 12);
  assert.equal(qty('l-foot'), 56);
  assert.equal(qty('mid-clamp'), 40);
  assert.equal(qty('end-clamp'), 8);
  assert.equal(qty('panels'), 22);
  assert.equal(qty('dc-mcb-32'), 3);
  assert.equal(qty('dc-spd'), 2);
  assert.equal(qty('ac-mcb-60'), 1);
  assert.equal(qty('mc4'), 6);
  assert.ok((qty('pv-cable-6') ?? 0) >= 1);
});

// ── Short circuit ─────────────────────────────────────────────

test('short circuit matches the sample plan set (75 kVA, 5 %Z, 50 m and 2 m of 8.0 mm²)', () => {
  const sc = shortCircuitAnalysis({
    kva: 75,
    zPct: 5,
    voltage: 230,
    segments: [
      { label: 'Main service equipment', lengthM: 50, mm2: 8.0 },
      { label: 'Circuit breaker of inverter', lengthM: 2, mm2: 8.0 },
    ],
  });
  close(sc.iflaA, 326.09);
  close(sc.multiplier, 22.22);
  // The sample sheet rounds along the way: 7245.72, 948.39, then M to 0.97 for 920.76 A
  // (unrounded M is 0.966, so 917 A).
  close(sc.x1A, 7245.72, 2);
  close(sc.points[0].iscA, 948.39, 1);
  close(sc.points[1].iscA, 920.76, 5);
  assert.equal(sc.kaic, 10);
});
