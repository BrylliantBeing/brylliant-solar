import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  autoAssign, autoRotation, calculateDesign, faceAt, heightAboveEave, panelArray, panelCorners, pvgisAspect, refitFace, calibrate, calibrationFor,
  shortCircuitAnalysis, sunAnalysis, voltageDrop, type Layout, type LayoutPanel, type RoofFace, type StringDef,
} from '../src/pvDesign';
import { JINKO_725, referenceDays, referenceMeasured } from '../src/pvDesignData';

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

// ── Roof faces ────────────────────────────────────────────────

/** A 10 m square face centred on the origin, sloping down to the south (eave along y = 5). */
const southFace = (pitchDeg: number, id = 'A'): RoofFace => ({
  id,
  pitchDeg,
  azimuthDeg: 180,
  points: [{ x: -5, y: -5 }, { x: 5, y: -5 }, { x: 5, y: 5 }, { x: -5, y: 5 }],
});
const one = (x: number, y: number, rot = 0): LayoutPanel => ({ id: `p${x},${y}`, x, y, rot, orientation: 'portrait', rowId: 'r', stringId: null });
const extent = (pts: { x: number; y: number }[], k: 'x' | 'y') => Math.max(...pts.map((p) => p[k])) - Math.min(...pts.map((p) => p[k]));

test('a 45° face foreshortens a panel down the slope by √2 and leaves it alone across the slope', () => {
  const face = southFace(45);
  assert.equal(autoRotation(face), 0);
  const corners = panelCorners(JINKO_725, one(0, 0), [face]);
  close(extent(corners, 'y'), 2.384 / Math.SQRT2, 0.001);
  close(extent(corners, 'x'), 1.303, 1e-9);
  // Off the face, full size
  close(extent(panelCorners(JINKO_725, one(20, 0), [face]), 'y'), 2.384, 1e-9);
});

test('panels laid on a face keep true spacing on the roof', () => {
  const flat = panelArray({ panel: JINKO_725, x: 0, y: 0, rows: 2, cols: 1, orientation: 'portrait', rot: 0, gapM: 0.02, rowGapM: 0.3, idPrefix: 'f' });
  const sloped = panelArray({ panel: JINKO_725, x: 0, y: 0, rows: 2, cols: 1, orientation: 'portrait', rot: 0, gapM: 0.02, rowGapM: 0.3, idPrefix: 's', face: southFace(60) });
  close(sloped[1].y - sloped[0].y, (flat[1].y - flat[0].y) * 0.5, 1e-9); // cos 60° = 0.5
});

test('height above the eave, and the DC run climbing it', () => {
  const face = southFace(45);
  close(heightAboveEave(face, { x: 0, y: 5 }), 0, 1e-9);
  close(heightAboveEave(face, { x: 0, y: 0 }), 5, 1e-9);
  const { layout, strings } = site();
  const roofFace: RoofFace = { ...face, points: [{ x: -10, y: -6 }, { x: 10, y: -6 }, { x: 10, y: 1 }, { x: -10, y: 1 }] };
  const flatRun = calculateDesign({ layout, strings }).circuits.find((c) => c.id === 'dc-A')!;
  const slopedRun = calculateDesign({ layout: { ...layout, roofs: [roofFace] }, strings }).circuits.find((c) => c.id === 'dc-A')!;
  assert.ok(slopedRun.oneWayM > flatRun.oneWayM);
});

test('refitting 0° → 45° → 0° puts panels back where they were, the eave row staying put', () => {
  const flat = southFace(0);
  const steep = southFace(45);
  const panels = [one(0, -3), one(1, 2), one(30, 0)];
  const there = refitFace(panels, [flat], flat, steep);
  // 8 m up the roof from the eave (y = 5) becomes 8 × cos 45° in plan; off-face panels don't move
  close(5 - there[0].y, 8 * Math.SQRT1_2, 1e-9);
  assert.deepEqual(there[2], panels[2]);
  const back = refitFace(there, [steep], steep, flat);
  close(back[0].y, -3, 1e-9);
  close(back[1].y, 2, 1e-9);
});

test('turning a face to slope east and back restores panels and their rotation', () => {
  const south = southFace(30);
  const east: RoofFace = { ...south, azimuthDeg: 90 };
  const panels = [one(-2, -1, autoRotation(south)), one(2, 3, 45)];
  const turned = refitFace(panels, [south], south, east);
  assert.equal(turned[0].rot, autoRotation(east)); // followed the eave
  assert.equal(turned[1].rot, 45); // hand-rotated, left alone
  const back = refitFace(turned, [east], east, south);
  close(back[0].x, -2, 1e-9);
  close(back[0].y, -1, 1e-9);
  assert.equal(back[0].rot, autoRotation(south));
});

test('faceAt: the last drawn face wins, and nothing outside', () => {
  const a = southFace(20, 'A');
  const b = { ...southFace(30, 'B'), points: [{ x: 0, y: -5 }, { x: 5, y: -5 }, { x: 5, y: 5 }, { x: 0, y: 5 }] };
  assert.equal(faceAt([a, b], { x: -2, y: 0 })?.id, 'A');
  assert.equal(faceAt([a, b], { x: 2, y: 0 })?.id, 'B');
  assert.equal(faceAt([a, b], { x: 9, y: 0 }), null);
});

test('PVGIS aspect: N 180, E −90, S 0, W 90', () => {
  assert.deepEqual([0, 90, 180, 270, 360].map(pvgisAspect), [180, -90, 0, 90, 180]);
});

// ── Sun analysis ──────────────────────────────────────────────

test('sun: a fixed ×0.875 turns 45° north at 2.84 into 2.485, ~30% under the best roof', () => {
  const north: RoofFace = { ...southFace(45, 'N'), azimuthDeg: 0 };
  const layout: Layout = {
    panels: [one(-2, 0), one(2, 0), one(30, 0)],
    inverters: [],
    meter: null,
    panelboard: null,
    floors: 1,
    floorHeightM: 3,
    roofs: [north],
  };
  const m = (d: number) => Array(12).fill(d);
  const yields = { faces: { N: m(2.84) }, flat: m(4.05), best: { pitchDeg: 10, azimuthDeg: 180, monthly: m(4.08) }, reference: m(3.5) };
  const cal = calibrationFor(yields, { referenceTiltDeg: 45, referenceAzimuthDeg: 180, calibrationOverride: 0.875 });
  assert.equal(cal.auto, false);
  const sun = sunAnalysis(layout, JINKO_725, yields, cal);
  const onNorth = sun.faces.find((f) => f.id === 'N')!;
  close(onNorth.perKwpDay, 2.485, 0.005);
  assert.equal(onNorth.panels, 2);
  close(onNorth.vsBestPct, (2.84 / 4.08 - 1) * 100, 0.1);
  assert.equal(sun.faces.find((f) => f.id === '')!.panels, 1);
  close(sun.kwhPerYear, (1.45 * 2.485 + 0.725 * 4.05 * 0.875) * 365.25, 2);
  const r = calculateDesign({ layout, strings: [], yields, settings: { calibrationOverride: 0.875 } });
  assert.ok(r.warnings.some((w) => w.startsWith('Roof N (45°, faces N) yields 30% less')));
});

// ── Calibration against the logged 1.95 kWp array ─────────────

/** PVGIS (loss 14%) for Zamboanga, June–September, as fetched while building this. */
const pvgisJunSep = (jun: number, jul: number, aug: number, sep: number) => [0, 0, 0, 0, 0, jun, jul, aug, sep, 0, 0, 0];

test('the logged window is June 8 – September 27: 23 + 31 + 31 + 27 days', () => {
  assert.deepEqual(referenceDays(), [0, 0, 0, 0, 0, 23, 31, 31, 27, 0, 0, 0]);
});

test('calibration reproduces the measured array exactly, whatever PVGIS says', () => {
  const pvgis = pvgisJunSep(3.37, 3.41, 3.87, 3.99); // 15° south
  const c = calibrate(referenceMeasured(), referenceDays(), pvgis);
  close(c.pvgis * c.factor, c.measured, 1e-9);
  close(c.factor, 0.96, 0.01);
});

test('45° south does not fit the log: ×1.35, flagged', () => {
  const m = (d: number) => Array(12).fill(d);
  const yields = { faces: {}, flat: m(4.05), best: { pitchDeg: 8, azimuthDeg: 174, monthly: m(4.08) }, reference: pvgisJunSep(2.1, 2.21, 2.77, 3.29) };
  const cal = calibrationFor(yields, { referenceTiltDeg: 45, referenceAzimuthDeg: 180, calibrationOverride: 0 });
  close(cal.factor, 1.35, 0.01);
  const { layout, strings } = site();
  const r = calculateDesign({ layout, strings, yields });
  assert.ok(r.warnings.some((w) => w.startsWith('Sun calibration is ×1.35')), r.warnings.join(' | '));
  close(r.sun!.calibration.factor, cal.factor, 1e-9);
});

// ── HYX-S10K-S: three trackers, one string each ───────────────

test('8 + 7 + 7 on the HYX-S10K-S, one string per MPPT: no tracker warnings', () => {
  const { layout, strings } = site({ inverters: [{ id: 'INV1', model: 'HYXi HYX-S10K-S', x: 0, y: 6, floor: 1 }] });
  const r = calculateDesign({ layout, strings: strings.map((s, i) => ({ ...s, mppt: i })) });
  assert.deepEqual(r.mppts.map((m) => [m.mppt, m.impA, m.maxInputA, m.maxIscA]), [[0, 17.69, 20, 24], [1, 17.69, 20, 24], [2, 17.69, 20, 24]]);
  assert.ok(!r.warnings.some((w) => w.includes('MPPT')), r.warnings.join(' | '));
  // 15.95 kWp against its 16 kW DC limit: under, just
  assert.ok(!r.warnings.some((w) => w.includes('DC input')));
  const ac = r.circuits.find((c) => c.kind === 'ac')!;
  close(ac.designA, 1.25 * 47.9);
  assert.equal(ac.breakerA, 60);
});

test('two strings on one HYX-S10K-S tracker are flagged: it has one input per MPPT', () => {
  const { layout, strings } = site({ inverters: [{ id: 'INV1', model: 'HYXi HYX-S10K-S', x: 0, y: 6, floor: 1 }] });
  const r = calculateDesign({ layout, strings });
  assert.ok(r.warnings.some((w) => w.startsWith('INV1 MPPT2 has 2 strings but only 1 input')));
});
