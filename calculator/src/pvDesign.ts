/**
 * PV system design: a roof layout in, string checks, wire and breaker sizes,
 * voltage drop, short-circuit level and a bill of materials out.
 *
 * Pure and synchronous, so the design page can recalculate on every drag.
 * Nothing here throws on a bad design: every problem becomes a line in
 * `warnings`, and the staff decide (see the "warn, don't enforce" rule).
 *
 * Units: metres, volts, amps, watts. Layout coordinates are metres in a local
 * plan frame, x east and y south (SVG order), with panel centres and rotation
 * in degrees clockwise.
 */

import {
  AC_BREAKERS_A,
  AC_CONDUCTORS,
  C_VALUES,
  COPPER_RHO_75C,
  DC_BREAKERS_A,
  DC_CONDUCTORS,
  GROUND_CONDUCTORS,
  INVERTERS,
  JINKO_725,
  KAIC_RATINGS,
  REFERENCE_ARRAY,
  referenceDays,
  referenceMeasured,
  type InverterSpec,
  type PanelSpec,
} from './pvDesignData';

/* ------------------------------------------------------------------ *
 * Inputs
 * ------------------------------------------------------------------ */

export type Orientation = 'portrait' | 'landscape';

export type LayoutPanel = {
  id: string;
  /** Centre, metres */
  x: number;
  y: number;
  /** Degrees clockwise */
  rot: number;
  /** Portrait: the long side runs across the rails */
  orientation: Orientation;
  /** Panels sharing a pair of rails */
  rowId: string;
  /** In string order: the first and last panel of a string are where its home runs land */
  stringId: string | null;
};

export type LayoutPoint = { x: number; y: number };

export type LayoutInverter = LayoutPoint & {
  id: string;
  model: string;
  /** 1 = ground floor */
  floor: number;
};

export type Layout = {
  panels: LayoutPanel[];
  inverters: LayoutInverter[];
  /** ZAMCELCO bi-directional meter */
  meter: LayoutPoint | null;
  /** The existing panel board, where the PV breaker lands. Falls back to the meter. */
  panelboard: LayoutPoint | null;
  /** Storeys under the roof the array sits on */
  floors: number;
  floorHeightM: number;
  /** Pitched roof faces; a panel sits on the last-drawn face containing its centre. Absent = all flat. */
  roofs?: RoofFace[];
};

/**
 * One plane of a roof, outlined in plan. `azimuthDeg` is the compass direction
 * the slope runs DOWN (the way the face looks): 0 N, 90 E, 180 S, 270 W.
 */
export type RoofFace = { id: string; points: LayoutPoint[]; pitchDeg: number; azimuthDeg: number };

export type StringDef = { id: string; inverterId: string; /** 0-based */ mppt: number };

export type DesignSettings = {
  /** Coldest morning the array will see; sets the cold-corrected Voc */
  minAmbientC: number;
  vdropLimitPct: number;
  /** General note 2: PV wire no smaller than 4 mm² */
  minDcMm2: number;
  /** Added to every measured run */
  slackPct: number;
  /** Inverter height above its floor */
  inverterMountM: number;
  /** Extra AC length at the meter end (e.g. up a pole) */
  acExtraM: number;
  /** Used when the layout has no inverter, meter or panel board yet */
  fallbackDcRunM: number;
  fallbackAcRunM: number;
  maxDcAcRatio: number;
  dcBreakers: number[];
  acBreakers: number[];
  /** Mounting */
  panelGapM: number;
  railsPerRow: number;
  railStockM: number;
  railOverhangM: number;
  footSpacingM: number;
  groundLugsPerRow: number;
  mc4PairsPerString: number;
  pvCableRollM: number;
  conduitPieceM: number;
  /** Short-circuit analysis; read the transformer's nameplate */
  transformerKva: number;
  transformerZPct: number;
  serviceDropM: number;
  serviceDropMm2: number;
  /** The logged reference array's real tilt and facing; calibration depends on them */
  referenceTiltDeg: number;
  referenceAzimuthDeg: number;
  /** A fixed factor on PVGIS instead of the measured calibration; 0 = calibrate from the reference array */
  calibrationOverride: number;
};

export const DESIGN_DEFAULTS: DesignSettings = {
  minAmbientC: 20,
  vdropLimitPct: 3,
  minDcMm2: 4,
  slackPct: 10,
  inverterMountM: 1.5,
  acExtraM: 0,
  fallbackDcRunM: 20,
  fallbackAcRunM: 10,
  maxDcAcRatio: 2,
  dcBreakers: DC_BREAKERS_A,
  acBreakers: AC_BREAKERS_A,
  panelGapM: 0.02,
  railsPerRow: 2,
  railStockM: 4.2,
  railOverhangM: 0.1,
  footSpacingM: 1.2,
  groundLugsPerRow: 2,
  mc4PairsPerString: 2,
  pvCableRollM: 100,
  conduitPieceM: 3,
  transformerKva: 50,
  transformerZPct: 2.5,
  serviceDropM: 30,
  serviceDropMm2: 14,
  referenceTiltDeg: REFERENCE_ARRAY.tiltDeg,
  referenceAzimuthDeg: REFERENCE_ARRAY.azimuthDeg,
  calibrationOverride: 0,
};

/** A hand-picked size for one circuit, keyed by Circuit.id. */
export type CircuitOverride = { mm2?: number; breakerA?: number };

export type DesignInput = {
  panel?: PanelSpec;
  layout: Layout;
  strings: StringDef[];
  settings?: Partial<DesignSettings>;
  overrides?: Record<string, CircuitOverride>;
  /** PVGIS monthly kWh/kWp/day, fetched outside the engine; without it there is no sun analysis */
  yields?: Yields | null;
};

/** Monthly average kWh per kWp per day, January first, straight from PVGIS. */
export type Yields = {
  faces: Record<string, number[]>;
  flat: number[];
  best: { pitchDeg: number; azimuthDeg: number; monthly: number[] };
  /** The reference array's orientation, for calibration */
  reference: number[];
};

/** How PVGIS was brought into line with what the reference array actually made. */
export type Calibration = {
  /** Multiplies every PVGIS yield */
  factor: number;
  /** false when a fixed factor was typed in */
  auto: boolean;
  /** Over the logged months, weighted by logged days: what the array made, and what PVGIS says it should have */
  measuredPerKwpDay: number;
  pvgisPerKwpDay: number;
  days: number;
  tiltDeg: number;
  azimuthDeg: number;
  window: string;
};

/* ------------------------------------------------------------------ *
 * Results
 * ------------------------------------------------------------------ */

export type StringResult = {
  id: string;
  inverterId: string;
  mppt: number;
  series: number;
  vocV: number;
  /** Voc at minAmbientC */
  vocColdV: number;
  vmpV: number;
  iscA: number;
  impA: number;
  powerW: number;
};

export type MpptResult = {
  inverterId: string;
  mppt: number;
  stringIds: string[];
  iscA: number;
  impA: number;
  maxIscA: number;
  maxInputA: number;
};

export type Circuit = {
  /** dc-<stringId> or ac-<inverterId> */
  id: string;
  kind: 'dc' | 'ac';
  label: string;
  /** 1.56 × Isc for DC, 1.25 × max output for AC */
  designA: number;
  /** null when no breaker in the list is large enough */
  breakerA: number | null;
  mm2: number;
  awg: string | null;
  ampacityA: number;
  /** Equipment grounding conductor; null when the breaker is past the table */
  groundMm2: number | null;
  /** Measured one-way length with slack, metres */
  oneWayM: number;
  /** Conductor metres for the run: + and − (or L and N) */
  cableM: number;
  /** True when the run used fallbackDcRunM/fallbackAcRunM */
  estimated: boolean;
  vdropCurrentA: number;
  nominalV: number;
  vdropV: number;
  vdropPct: number;
  /** Larger than ampacity alone needed, to meet the voltage-drop limit */
  upsizedForVdrop: boolean;
  overridden: boolean;
};

export type BomLine = {
  id: string;
  /** Where its price is looked up; the id unless two sizes share one (conduit) */
  priceKey?: string;
  category: string;
  name: string;
  qty: number;
  unit: string;
  /** How the quantity was reached */
  detail?: string;
};

export type FaultPoint = { label: string; lengthM: number; mm2: number; c: number; f: number; m: number; iscA: number };

export type ShortCircuit = {
  transformerKva: number;
  zPct: number;
  voltage: number;
  iflaA: number;
  multiplier: number;
  /** X1 at the transformer secondary, then each point downstream */
  x1A: number;
  points: FaultPoint[];
  /** For the PV breaker at the last point */
  kaic: number;
};

export type DesignResult = {
  panel: PanelSpec;
  inverters: (LayoutInverter & { spec: InverterSpec })[];
  panels: number;
  unassignedPanels: number;
  dcKw: number;
  acKw: number;
  dcAcRatio: number | null;
  strings: StringResult[];
  mppts: MpptResult[];
  circuits: Circuit[];
  shortCircuit: ShortCircuit | null;
  bom: BomLine[];
  sun: SunResult | null;
  warnings: string[];
};

export type SunFace = {
  /** The face id, or "" for panels on no face (treated as flat) */
  id: string;
  label: string;
  pitchDeg: number;
  azimuthDeg: number | null;
  panels: number;
  kwp: number;
  /** After calibration */
  perKwpDay: number;
  kwhPerDay: number;
  kwhPerYear: number;
  monthlyKwh: number[];
  /** Against the best orientation at the site; negative = worse */
  vsBestPct: number;
};

export type SunResult = {
  faces: SunFace[];
  kwhPerYear: number;
  kwhPerDay: number;
  perKwpDay: number;
  bestPerKwpDay: number;
  best: { pitchDeg: number; azimuthDeg: number };
  monthlyKwh: number[];
  calibration: Calibration;
};

/* ------------------------------------------------------------------ *
 * Formulas
 * ------------------------------------------------------------------ */

const round = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;
const ceil = (n: number) => Math.ceil(n - 1e-9);
const fmt = (n: number, dp = 2) => String(round(n, dp));

/**
 * The voltage-drop sheet's formula: VD = K × L × I × Z / 305, with L the
 * one-way length in metres, Z = √(R² + X²) in Ω per 305 m, and K = 2 for
 * single-phase and DC (1.732 for three-phase).
 *
 * The sheet divides by a fixed 240 V for the percentage even though its
 * nominal voltage cell says 350 V; this uses the circuit's own voltage.
 */
export function voltageDrop(a: {
  k?: number;
  lengthM: number;
  currentA: number;
  rOhmPer305m: number;
  xOhmPer305m?: number;
  nominalV: number;
}): { volts: number; pct: number } {
  const z = Math.hypot(a.rOhmPer305m, a.xOhmPer305m ?? 0);
  const volts = ((a.k ?? 2) * a.lengthM * a.currentA * z) / 305;
  return { volts, pct: a.nominalV > 0 ? (volts / a.nominalV) * 100 : 0 };
}

/** DC resistance of copper, Ω per 305 m, from resistivity at 75 °C. */
export const dcOhmPer305m = (mm2: number) => (COPPER_RHO_75C * 305) / mm2;

/** The smallest rating at or above `amps`; null if the list runs out. */
export function nextBreaker(amps: number, ratings: number[]): number | null {
  return [...ratings].sort((a, b) => a - b).find((r) => r >= amps - 1e-9) ?? null;
}

export function groundFor(breakerA: number): number | null {
  return GROUND_CONDUCTORS.find((g) => breakerA <= g.upToA)?.mm2 ?? null;
}

/** Panel footprint before rotation: w along the rails, h across them. */
export function panelSize(panel: PanelSpec, orientation: Orientation): { w: number; h: number } {
  const long = panel.lengthMm / 1000;
  const short = panel.widthMm / 1000;
  return orientation === 'portrait' ? { w: short, h: long } : { w: long, h: short };
}

const manhattan = (a: LayoutPoint, b: LayoutPoint) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/** Roof height above the inverter. */
function verticalDrop(layout: Layout, inv: LayoutInverter, s: DesignSettings) {
  const roof = Math.max(0, layout.floors) * layout.floorHeightM;
  const inverter = (Math.max(1, inv.floor) - 1) * layout.floorHeightM + s.inverterMountM;
  return Math.max(0, roof - inverter);
}

/* ------------------------------------------------------------------ *
 * The design
 * ------------------------------------------------------------------ */

export function calculateDesign(input: DesignInput): DesignResult {
  const s: DesignSettings = { ...DESIGN_DEFAULTS, ...input.settings };
  const panel = input.panel ?? JINKO_725;
  const { layout } = input;
  const overrides = input.overrides ?? {};
  const warnings: string[] = [];
  const slack = 1 + s.slackPct / 100;

  const inverters = layout.inverters.map((inv) => {
    const spec = INVERTERS.find((x) => x.model === inv.model);
    if (!spec) warnings.push(`Inverter model “${inv.model}” is not in the equipment list; using ${INVERTERS[0].model}.`);
    return { ...inv, spec: spec ?? INVERTERS[0] };
  });
  const inverterById = new Map(inverters.map((i) => [i.id, i]));

  /* ---------------- strings */

  const coldFactor = 1 + (panel.vocTempCoeffPct / 100) * (s.minAmbientC - 25);
  const strings: StringResult[] = [];
  const stringPanels = new Map<string, LayoutPanel[]>();
  for (const def of input.strings) {
    const members = layout.panels.filter((p) => p.stringId === def.id);
    stringPanels.set(def.id, members);
    const n = members.length;
    strings.push({
      id: def.id,
      inverterId: def.inverterId,
      mppt: def.mppt,
      series: n,
      vocV: round(n * panel.vocV),
      vocColdV: round(n * panel.vocV * coldFactor),
      vmpV: round(n * panel.vmpV),
      iscA: panel.iscA,
      impA: panel.impA,
      powerW: n * panel.watts,
    });
  }
  const known = new Set(input.strings.map((d) => d.id));
  const unassignedPanels = layout.panels.filter((p) => !p.stringId || !known.has(p.stringId)).length;
  if (unassignedPanels > 0) {
    warnings.push(`${unassignedPanels} panel${unassignedPanels === 1 ? ' is' : 's are'} not on a string.`);
  }

  /** The roof faces a string's panels sit on; '' is flat roof */
  const facesOf = (id: string) => [...new Set((stringPanels.get(id) ?? []).map((p) => faceAt(layout.roofs, p)?.id ?? ''))];
  const faceName = (id: string) => (id ? `roof ${id}` : 'flat roof');

  for (const st of strings) {
    const inv = inverterById.get(st.inverterId);
    if (st.series === 0) {
      warnings.push(`String ${st.id} has no panels.`);
      continue;
    }
    const faces = facesOf(st.id);
    if (faces.length > 1) {
      warnings.push(`String ${st.id} runs across ${faces.map(faceName).join(' and ')}; panels facing different ways drag a string down to its weakest.`);
    }
    if (!inv) {
      warnings.push(`String ${st.id} is not connected to an inverter.`);
      continue;
    }
    const spec = inv.spec;
    if (st.vocColdV > spec.maxDcV) {
      warnings.push(
        `String ${st.id}: ${st.series} panels reach ${fmt(st.vocColdV, 1)} V Voc at ${s.minAmbientC} °C, above the ${spec.maxDcV} V inverter limit.`,
      );
    }
    if (st.vmpV < spec.mpptMinV || st.vmpV > spec.mpptMaxV) {
      warnings.push(`String ${st.id}: Vmp ${fmt(st.vmpV, 1)} V is outside the ${spec.mpptMinV}–${spec.mpptMaxV} V MPPT range.`);
    } else if (st.vmpV < spec.fullLoadMinV || st.vmpV > spec.fullLoadMaxV) {
      warnings.push(
        `String ${st.id}: Vmp ${fmt(st.vmpV, 1)} V is outside the ${spec.fullLoadMinV}–${spec.fullLoadMaxV} V full-load range; the inverter will derate.`,
      );
    }
  }

  /* ---------------- MPPTs */

  const mppts: MpptResult[] = [];
  for (const inv of inverters) {
    inv.spec.mppts.forEach((m, i) => {
      const on = strings.filter((st) => st.inverterId === inv.id && st.mppt === i && st.series > 0);
      if (!on.length) return;
      const r: MpptResult = {
        inverterId: inv.id,
        mppt: i,
        stringIds: on.map((x) => x.id),
        iscA: round(on.reduce((a, x) => a + x.iscA, 0)),
        impA: round(on.reduce((a, x) => a + x.impA, 0)),
        maxIscA: m.maxIscA,
        maxInputA: m.maxInputA,
      };
      mppts.push(r);
      const name = `${inv.id} MPPT${i + 1}`;
      if (on.length > m.inputs) warnings.push(`${name} has ${on.length} strings but only ${m.inputs} input${m.inputs === 1 ? '' : 's'}.`);
      if (r.iscA > m.maxIscA) warnings.push(`${name}: Isc ${fmt(r.iscA)} A is above its ${m.maxIscA} A short-circuit rating.`);
      if (r.impA > m.maxInputA) {
        warnings.push(`${name}: Imp ${fmt(r.impA)} A is above its ${m.maxInputA} A input limit; it will clip about ${fmt((1 - m.maxInputA / r.impA) * 100, 0)}% at peak.`);
      }
      if (new Set(on.map((x) => x.series)).size > 1) {
        warnings.push(`${name}: parallel strings have different lengths (${on.map((x) => x.series).join(' and ')}); the shorter pulls the voltage down.`);
      }
      const faces = [...new Set(on.flatMap((x) => facesOf(x.id)))];
      if (on.length > 1 && faces.length > 1) {
        warnings.push(`${name}: its strings sit on ${faces.map(faceName).join(' and ')}; one tracker can only follow one facing.`);
      }
    });
    strings
      .filter((st) => st.inverterId === inv.id && st.mppt >= inv.spec.mppts.length)
      .forEach((st) => warnings.push(`String ${st.id} is on MPPT${st.mppt + 1}, which ${inv.spec.model} does not have.`));
  }

  /* ---------------- power */

  const panelCount = layout.panels.length;
  const dcKw = (panelCount * panel.watts) / 1000;
  const acKw = inverters.reduce((a, i) => a + i.spec.nominalAcW, 0) / 1000;
  const dcAcRatio = acKw > 0 ? dcKw / acKw : null;
  if (panelCount > 0 && !inverters.length) warnings.push('No inverter placed yet.');
  if (dcAcRatio !== null && dcAcRatio > s.maxDcAcRatio) {
    warnings.push(`DC/AC ratio is ${fmt(dcAcRatio)}, above the ${fmt(s.maxDcAcRatio)} limit.`);
  }
  for (const inv of inverters) {
    const w = strings.filter((st) => st.inverterId === inv.id).reduce((a, st) => a + st.powerW, 0);
    if (w > inv.spec.maxDcW) warnings.push(`${inv.id}: ${fmt(w / 1000)} kWp of panels, above its ${inv.spec.maxDcW / 1000} kW DC input.`);
  }

  /* ---------------- DC circuits, one per string */

  const circuits: Circuit[] = [];
  const longestLead = Math.max(panel.lengthMm, panel.widthMm) / 1000 + 0.5;
  const jumperM = new Map<string, number>();

  for (const st of strings) {
    const inv = inverterById.get(st.inverterId);
    const members = stringPanels.get(st.id) ?? [];
    if (!members.length) continue;

    // Panels too far apart for their own leads need a jumper, run along the roof.
    let jumpers = 0;
    for (let i = 1; i < members.length; i += 1) {
      if (Math.hypot(members[i].x - members[i - 1].x, members[i].y - members[i - 1].y) > longestLead) {
        jumpers += manhattan(members[i], members[i - 1]);
      }
    }
    jumperM.set(st.id, jumpers * slack);

    let pos = s.fallbackDcRunM;
    let neg = s.fallbackDcRunM;
    const estimated = !inv;
    if (inv) {
      // Up a pitched face the run also climbs from the eave to the panel.
      const v = verticalDrop(layout, inv, s);
      const rise = (p: LayoutPanel) => {
        const f = faceAt(layout.roofs, p);
        return f ? heightAboveEave(f, p) : 0;
      };
      const first = members[0];
      const last = members[members.length - 1];
      pos = manhattan(inv, first) + v + rise(first);
      neg = manhattan(inv, last) + v + rise(last);
    }
    const id = `dc-${st.id}`;
    const designA = 1.25 * 1.25 * st.iscA;
    circuits.push(
      sizeCircuit({
        id,
        kind: 'dc',
        label: `String ${st.id}`,
        designA,
        oneWayM: Math.max(pos, neg) * slack,
        cableM: (pos + neg) * slack,
        estimated,
        vdropCurrentA: st.iscA,
        nominalV: st.vmpV,
        settings: s,
        override: overrides[id],
        warnings,
      }),
    );
    const breaker = circuits[circuits.length - 1].breakerA;
    if (breaker !== null && breaker > panel.maxSeriesFuseA) {
      warnings.push(`String ${st.id}: ${breaker} A breaker is above the panel's ${panel.maxSeriesFuseA} A series fuse rating.`);
    }
  }

  /* ---------------- AC circuits, one per inverter */

  const acEnd = layout.panelboard ?? layout.meter;
  if (inverters.length && !acEnd) warnings.push('Place the meter or panel board to measure the AC run.');
  for (const inv of inverters) {
    const height = (Math.max(1, inv.floor) - 1) * layout.floorHeightM + s.inverterMountM;
    const run = acEnd ? manhattan(inv, acEnd) + height + s.acExtraM : s.fallbackAcRunM;
    const id = `ac-${inv.id}`;
    circuits.push(
      sizeCircuit({
        id,
        kind: 'ac',
        label: `${inv.id} → ${layout.panelboard ? 'panel board' : 'meter'}`,
        designA: 1.25 * inv.spec.maxAcA,
        oneWayM: run * slack,
        cableM: 2 * run * slack,
        estimated: !acEnd,
        vdropCurrentA: inv.spec.maxAcA,
        nominalV: inv.spec.nominalAcV,
        settings: s,
        override: overrides[id],
        warnings,
      }),
    );
  }

  /* ---------------- short circuit, at the first inverter's breaker */

  const firstAc = circuits.find((c) => c.kind === 'ac');
  const shortCircuit =
    firstAc && s.transformerKva > 0 && s.transformerZPct > 0
      ? shortCircuitAnalysis({
          kva: s.transformerKva,
          zPct: s.transformerZPct,
          voltage: inverters[0].spec.nominalAcV,
          segments: [
            { label: 'Main service equipment', lengthM: s.serviceDropM, mm2: s.serviceDropMm2 },
            { label: 'Circuit breaker of inverter', lengthM: firstAc.oneWayM, mm2: firstAc.mm2 },
          ],
          warnings,
        })
      : null;

  const bom = buildBom({ layout, panel, inverters, strings, circuits, jumperM, mpptsUsed: mppts.length, settings: s });

  /* ---------------- roof faces */

  const roofs = layout.roofs ?? [];
  if (roofs.length) {
    const over = layout.panels.filter((p) => {
      const f = faceAt(roofs, p);
      return f && panelCorners(panel, p, roofs).some((c) => faceAt(roofs, c)?.id !== f.id);
    }).length;
    if (over) warnings.push(`${over} panel${over === 1 ? ' hangs' : 's hang'} over the edge of ${over === 1 ? 'its' : 'their'} roof face.`);
  }
  let sun: SunResult | null = null;
  if (input.yields) {
    const cal = calibrationFor(input.yields, s);
    sun = sunAnalysis(layout, panel, input.yields, cal);
    if (cal.auto && (cal.factor < 0.8 || cal.factor > 1.1)) {
      warnings.push(
        `Sun calibration is ×${round(cal.factor, 2)}: the reference array made ${round(cal.measuredPerKwpDay, 2)} kWh/kWp/day but PVGIS expects ${round(cal.pvgisPerKwpDay, 2)} at ${cal.tiltDeg}° facing ${compass(cal.azimuthDeg)}. Outside 0.8–1.1 the reference tilt or facing is probably wrong; measure them on the panel frame.`,
      );
    }
  }
  for (const f of sun?.faces ?? []) {
    if (f.id && f.vsBestPct < -10) {
      warnings.push(
        `Roof ${f.id} (${round(f.pitchDeg, 0)}°, faces ${compass(f.azimuthDeg ?? 0)}) yields ${round(-f.vsBestPct, 0)}% less than the best orientation here.`,
      );
    }
  }

  return {
    panel,
    inverters,
    panels: panelCount,
    unassignedPanels,
    dcKw: round(dcKw, 3),
    acKw: round(acKw, 3),
    dcAcRatio: dcAcRatio === null ? null : round(dcAcRatio, 3),
    strings,
    mppts,
    circuits,
    shortCircuit,
    bom,
    sun,
    warnings,
  };
}

/* ------------------------------------------------------------------ *
 * Wire and breaker sizing
 * ------------------------------------------------------------------ */

type WireOption = { mm2: number; awg: string | null; ampacityA: number; r: number; x: number };

const dcOptions = (): WireOption[] =>
  DC_CONDUCTORS.map((c) => ({ mm2: c.mm2, awg: null, ampacityA: c.ampacityA, r: dcOhmPer305m(c.mm2), x: 0 }));
const acOptions = (): WireOption[] =>
  AC_CONDUCTORS.map((c) => ({ mm2: c.mm2, awg: c.awg, ampacityA: c.ampacityA, r: c.rOhmPer305m, x: c.xOhmPer305m }));

/**
 * Breaker: the next rating at or above the design current. Wire: the smallest
 * size whose ampacity covers the breaker, then larger until the drop is within
 * the limit. An override replaces either choice and is only checked, not fixed.
 */
function sizeCircuit(a: {
  id: string;
  kind: 'dc' | 'ac';
  label: string;
  designA: number;
  oneWayM: number;
  cableM: number;
  estimated: boolean;
  vdropCurrentA: number;
  nominalV: number;
  settings: DesignSettings;
  override?: CircuitOverride;
  warnings: string[];
}): Circuit {
  const s = a.settings;
  const options = a.kind === 'dc' ? dcOptions() : acOptions();
  const ratings = a.kind === 'dc' ? s.dcBreakers : s.acBreakers;
  const autoBreaker = nextBreaker(a.designA, ratings);
  const breakerA = a.override?.breakerA ?? autoBreaker;
  if (breakerA === null) {
    a.warnings.push(`${a.label}: no ${a.kind.toUpperCase()} breaker in the list reaches ${fmt(a.designA)} A.`);
  }
  const needA = Math.max(a.designA, breakerA ?? 0);
  const floor = a.kind === 'dc' ? s.minDcMm2 : 0;
  const drop = (w: WireOption) =>
    voltageDrop({ lengthM: a.oneWayM, currentA: a.vdropCurrentA, rOhmPer305m: w.r, xOhmPer305m: w.x, nominalV: a.nominalV });

  const fits = options.filter((w) => w.mm2 >= floor - 1e-9 && w.ampacityA >= needA - 1e-9);
  const byAmpacity = fits[0] ?? options[options.length - 1];
  const byDrop = fits.find((w) => drop(w).pct <= s.vdropLimitPct + 1e-9);
  let wire = byDrop ?? fits[fits.length - 1] ?? byAmpacity;

  const forced = a.override?.mm2 !== undefined ? options.find((w) => Math.abs(w.mm2 - a.override!.mm2!) < 1e-6) : undefined;
  if (forced) wire = forced;

  const vd = drop(wire);
  if (!fits.length) a.warnings.push(`${a.label}: no ${a.kind.toUpperCase()} wire in the table carries ${fmt(needA)} A.`);
  if (forced && forced.ampacityA < needA - 1e-9) {
    a.warnings.push(`${a.label}: ${forced.mm2} mm² carries ${forced.ampacityA} A, less than the ${fmt(needA)} A it needs.`);
  }
  if (forced && forced.mm2 < floor) a.warnings.push(`${a.label}: ${forced.mm2} mm² is below the ${floor} mm² minimum for PV wire.`);
  if (vd.pct > s.vdropLimitPct + 1e-9) {
    a.warnings.push(
      `${a.label}: voltage drop is ${fmt(vd.pct)}% on ${wire.mm2} mm² over ${fmt(a.oneWayM, 1)} m, above the ${s.vdropLimitPct}% limit.`,
    );
  }

  return {
    id: a.id,
    kind: a.kind,
    label: a.label,
    designA: round(a.designA),
    breakerA,
    mm2: wire.mm2,
    awg: wire.awg,
    ampacityA: wire.ampacityA,
    groundMm2: breakerA === null ? null : groundFor(breakerA),
    oneWayM: round(a.oneWayM, 1),
    cableM: round(a.cableM, 1),
    estimated: a.estimated,
    vdropCurrentA: round(a.vdropCurrentA),
    nominalV: round(a.nominalV, 1),
    vdropV: round(vd.volts),
    vdropPct: round(vd.pct),
    upsizedForVdrop: wire.mm2 > byAmpacity.mm2 && !forced,
    overridden: !!a.override && (a.override.mm2 !== undefined || a.override.breakerA !== undefined),
  };
}

/* ------------------------------------------------------------------ *
 * Short circuit: point-to-point method, single phase
 * ------------------------------------------------------------------ */

export function shortCircuitAnalysis(a: {
  kva: number;
  zPct: number;
  voltage: number;
  segments: { label: string; lengthM: number; mm2: number }[];
  warnings?: string[];
}): ShortCircuit {
  const iflaA = (a.kva * 1000) / a.voltage;
  // The 0.9 allows for a transformer up to 10% below its nameplate impedance.
  const multiplier = 100 / (a.zPct * 0.9);
  const x1A = iflaA * multiplier;
  let i = x1A;
  const points = a.segments.map((seg) => {
    let c = C_VALUES[seg.mm2];
    if (c === undefined) {
      const smaller = Object.keys(C_VALUES).map(Number).filter((k) => k <= seg.mm2).sort((p, q) => q - p)[0];
      c = C_VALUES[smaller ?? 2.0];
      a.warnings?.push(`No “C” value for ${seg.mm2} mm²; the short-circuit analysis used ${smaller ?? 2.0} mm².`);
    }
    const lengthFt = seg.lengthM * 3.28;
    const f = (2 * lengthFt * i) / (c * 1 * a.voltage);
    const m = 1 / (1 + f);
    i = m * i;
    return { label: seg.label, lengthM: round(seg.lengthM, 1), mm2: seg.mm2, c, f: round(f, 3), m: round(m, 3), iscA: round(i) };
  });
  const kA = i / 1000;
  return {
    transformerKva: a.kva,
    zPct: a.zPct,
    voltage: a.voltage,
    iflaA: round(iflaA),
    multiplier: round(multiplier),
    x1A: round(x1A),
    points,
    kaic: KAIC_RATINGS.find((r) => r >= kA) ?? KAIC_RATINGS[KAIC_RATINGS.length - 1],
  };
}

/* ------------------------------------------------------------------ *
 * Bill of materials
 * ------------------------------------------------------------------ */

function buildBom(a: {
  layout: Layout;
  panel: PanelSpec;
  inverters: (LayoutInverter & { spec: InverterSpec })[];
  strings: StringResult[];
  circuits: Circuit[];
  jumperM: Map<string, number>;
  mpptsUsed: number;
  settings: DesignSettings;
}): BomLine[] {
  const s = a.settings;
  const out: BomLine[] = [];
  const add = (line: BomLine) => {
    if (line.qty > 0) out.push({ ...line, qty: round(line.qty, 1) });
  };

  add({ id: 'panels', category: 'Solar array', name: `${a.panel.model} ${a.panel.watts} W`, qty: a.layout.panels.length, unit: '' });
  const models = new Map<string, number>();
  for (const inv of a.inverters) models.set(inv.spec.model, (models.get(inv.spec.model) ?? 0) + 1);
  for (const [model, n] of models) {
    add({ id: `inverter-${model}`, category: 'Inverters', name: model, qty: n, unit: '' });
  }

  /* Mounting, row by row */
  const rows = new Map<string, LayoutPanel[]>();
  for (const p of a.layout.panels) rows.set(p.rowId, [...(rows.get(p.rowId) ?? []), p]);
  let railPieces = 0;
  let splices = 0;
  let feet = 0;
  let mid = 0;
  let end = 0;
  for (const members of rows.values()) {
    const n = members.length;
    const along = panelSize(a.panel, members[0].orientation).w;
    const railM = n * along + (n - 1) * s.panelGapM + 2 * s.railOverhangM;
    const pieces = s.railStockM > 0 ? ceil(railM / s.railStockM) : 0;
    railPieces += s.railsPerRow * pieces;
    splices += s.railsPerRow * Math.max(0, pieces - 1);
    feet += s.railsPerRow * (s.footSpacingM > 0 ? ceil(railM / s.footSpacingM) + 1 : 0);
    mid += s.railsPerRow * (n - 1);
    end += s.railsPerRow * 2;
  }
  const rowCount = rows.size;
  add({ id: 'rail', category: 'Solar array', name: `Mounting rail ${s.railStockM} m`, qty: railPieces, unit: 'pc', detail: `${rowCount} row${rowCount === 1 ? '' : 's'} × ${s.railsPerRow} rails` });
  add({ id: 'rail-splice', category: 'Solar array', name: 'Rail splice', qty: splices, unit: 'pc' });
  add({ id: 'l-foot', category: 'Solar array', name: 'L-foot / roof attachment', qty: feet, unit: 'pc', detail: `every ${s.footSpacingM} m` });
  add({ id: 'mid-clamp', category: 'Solar array', name: 'Mid clamp', qty: mid, unit: 'pc' });
  add({ id: 'end-clamp', category: 'Solar array', name: 'End clamp', qty: end, unit: 'pc' });
  add({ id: 'ground-lug', category: 'Earthing', name: 'Rail grounding lug', qty: rowCount * s.groundLugsPerRow, unit: 'pc' });

  /* PV cable, by size */
  const dc = a.circuits.filter((c) => c.kind === 'dc');
  const pvBySize = new Map<number, number>();
  for (const c of dc) {
    const jumper = a.jumperM.get(c.id.slice(3)) ?? 0;
    pvBySize.set(c.mm2, (pvBySize.get(c.mm2) ?? 0) + c.cableM + jumper);
  }
  for (const [mm2, m] of [...pvBySize].sort((p, q) => p[0] - q[0])) {
    const rolls = s.pvCableRollM > 0 ? ceil(m / s.pvCableRollM) : 0;
    add({ id: `pv-cable-${mm2}`, category: 'DC side', name: `PV cable ${mm2} mm², ${s.pvCableRollM} m roll`, qty: rolls, unit: 'roll', detail: `${fmt(m, 0)} m red + black` });
  }
  add({ id: 'mc4', category: 'DC side', name: 'MC4 connector pair', qty: a.strings.filter((x) => x.series > 0).length * s.mc4PairsPerString, unit: 'pair' });

  const dcBreakers = new Map<number, number>();
  for (const c of dc) if (c.breakerA !== null) dcBreakers.set(c.breakerA, (dcBreakers.get(c.breakerA) ?? 0) + 1);
  for (const [amps, n] of [...dcBreakers].sort((p, q) => p[0] - q[0])) {
    add({ id: `dc-mcb-${amps}`, category: 'DC side', name: `DC MCB 2P ${amps} AT, 600 V DC`, qty: n, unit: 'pc' });
  }
  add({ id: 'dc-spd', category: 'DC side', name: 'DC SPD Type II, 600 V', qty: a.mpptsUsed, unit: 'pc' });
  add({ id: 'dc-box', category: 'DC side', name: 'DC combiner enclosure, IP65', qty: a.inverters.length, unit: 'pc' });

  /* AC side */
  const ac = a.circuits.filter((c) => c.kind === 'ac');
  const acBreakers = new Map<number, number>();
  for (const c of ac) if (c.breakerA !== null) acBreakers.set(c.breakerA, (acBreakers.get(c.breakerA) ?? 0) + 1);
  for (const [amps, n] of [...acBreakers].sort((p, q) => p[0] - q[0])) {
    add({ id: `ac-mcb-${amps}`, category: 'AC side', name: `AC MCB 2P ${amps} AT, 230 V`, qty: n, unit: 'pc' });
  }
  add({ id: 'ac-spd', category: 'AC side', name: 'AC SPD Type II, 275 V', qty: a.inverters.length, unit: 'pc' });
  add({ id: 'ac-box', category: 'AC side', name: 'AC breaker enclosure, NEMA 3R', qty: a.inverters.length, unit: 'pc' });
  add({ id: 'ct', category: 'AC side', name: 'Export-limit CT / smart meter', qty: a.inverters.length, unit: 'pc' });

  const thhn = new Map<number, number>();
  const ground = new Map<number, number>();
  for (const c of ac) {
    thhn.set(c.mm2, (thhn.get(c.mm2) ?? 0) + c.cableM);
    if (c.groundMm2 !== null) ground.set(c.groundMm2, (ground.get(c.groundMm2) ?? 0) + c.oneWayM);
  }
  // The array's grounding conductor follows the longest DC run down.
  const longestDc = dc.reduce((m, c) => Math.max(m, c.oneWayM), 0);
  const dcGround = dc.reduce((m, c) => Math.max(m, c.groundMm2 ?? 0), 0);
  if (longestDc > 0 && dcGround > 0) ground.set(dcGround, (ground.get(dcGround) ?? 0) + longestDc);
  for (const [mm2, m] of [...thhn].sort((p, q) => p[0] - q[0])) {
    add({ id: `thhn-${mm2}`, category: 'AC side', name: `THHN ${mm2} mm² stranded`, qty: ceil(m), unit: 'm' });
  }
  for (const [mm2, m] of [...ground].sort((p, q) => p[0] - q[0])) {
    add({ id: `ground-${mm2}`, category: 'Earthing', name: `TW ${mm2} mm² (G), green`, qty: ceil(m), unit: 'm' });
  }
  add({ id: 'ground-rod', category: 'Earthing', name: 'Ground rod 5/8" × 8 ft + clamp', qty: 1, unit: 'pc' });

  /* Conduit: the strings share one run down; each inverter has its own AC run */
  const acM = ac.reduce((m, c) => m + c.oneWayM, 0);
  const acSize = ac.some((c) => c.mm2 >= 14) ? 25 : 20;
  if (s.conduitPieceM > 0) {
    add({ id: 'conduit-dc', priceKey: 'conduit-20', category: 'Conduit & small parts', name: `PVC conduit 20 mm, ${s.conduitPieceM} m`, qty: ceil(longestDc / s.conduitPieceM), unit: 'pc', detail: `${fmt(longestDc, 1)} m` });
    add({ id: 'conduit-ac', priceKey: `conduit-${acSize}`, category: 'Conduit & small parts', name: `PVC conduit ${acSize} mm, ${s.conduitPieceM} m`, qty: ceil(acM / s.conduitPieceM), unit: 'pc', detail: `${fmt(acM, 1)} m` });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Layout helpers for the editor
 * ------------------------------------------------------------------ */

/**
 * Assigns panels to strings in placement order: [8, 7, 7] puts the first
 * eight on string A, the next seven on B, and so on. Panels past the pattern
 * are left unassigned.
 */
export function autoAssign(panels: LayoutPanel[], pattern: { id: string; size: number }[]): LayoutPanel[] {
  let i = 0;
  const slots: (string | null)[] = [];
  for (const p of pattern) for (let k = 0; k < p.size; k += 1) slots.push(p.id);
  return panels.map((p) => ({ ...p, stringId: slots[i++] ?? null }));
}

/** A string to fill: where it lands and how many panels its pattern gives it. */
export type StringSlot = StringDef & { size: number };

const STRING_IDS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * The strings every inverter takes. A model's pattern (one typed for the
 * design, else the model's ideal pattern) fills its MPPT inputs in order, so
 * every HYX-S10K-S gets 8 + 7 + 7. Models with neither share the panels left
 * over evenly across their inputs.
 */
export function stringPlan(inverters: LayoutInverter[], patterns: Record<string, number[]>, panelCount: number): StringSlot[] {
  const specOf = (inv: LayoutInverter) => INVERTERS.find((x) => x.model === inv.model) ?? INVERTERS[0];
  const inputsOf = (spec: InverterSpec) => spec.mppts.flatMap((m, i) => Array.from({ length: m.inputs }, () => i));
  const patternOf = (inv: LayoutInverter) => {
    const p = patterns[inv.model] ?? specOf(inv).idealPattern;
    return p?.length ? p : null;
  };
  const fixed = inverters.reduce((a, inv) => a + (patternOf(inv)?.reduce((x, y) => x + y, 0) ?? 0), 0);
  let left = Math.max(0, panelCount - fixed);
  let inputsLeft = inverters.filter((inv) => !patternOf(inv)).reduce((a, inv) => a + inputsOf(specOf(inv)).length, 0);
  const out: StringSlot[] = [];
  for (const inv of inverters) {
    const inputs = inputsOf(specOf(inv));
    const sizes =
      patternOf(inv) ??
      inputs.map(() => {
        const n = Math.ceil(left / inputsLeft);
        left -= n;
        inputsLeft -= 1;
        return n;
      });
    sizes.forEach((size, i) => {
      if (size <= 0) return;
      out.push({ id: STRING_IDS[out.length] ?? `S${out.length + 1}`, inverterId: inv.id, mppt: inputs[Math.min(i, inputs.length - 1)] ?? 0, size });
    });
  }
  return out;
}

/** Panels in wiring order: array by array, row by row, snaking back along every other row. */
function snakeOrder(panels: LayoutPanel[]): LayoutPanel[] {
  const arrayOf = (p: LayoutPanel) => p.rowId.split('-')[0];
  const rows = new Map<string, LayoutPanel[]>();
  for (const p of panels) rows.set(p.rowId, [...(rows.get(p.rowId) ?? []), p]);
  const out: LayoutPanel[] = [];
  for (const a of new Set(panels.map(arrayOf))) {
    const mine = [...rows.values()].filter((r) => arrayOf(r[0]) === a);
    const r0 = rad(mine[0][0].rot);
    const along = (p: LayoutPoint) => p.x * Math.cos(r0) + p.y * Math.sin(r0);
    const down = (r: LayoutPanel[]) => r.reduce((s, p) => s - p.x * Math.sin(r0) + p.y * Math.cos(r0), 0) / r.length;
    mine
      .sort((p, q) => down(p) - down(q))
      .forEach((r, k) => out.push(...[...r].sort((p, q) => (k % 2 ? -1 : 1) * (along(p) - along(q)))));
  }
  return out;
}

/**
 * Puts panels on strings so each MPPT sees one roof face. Faces go largest
 * first, each onto the trackers that suit it best: an exact fit, else the
 * largest it fills, else the smallest that holds it. Only what no tracker of
 * its own can take spills into the room left on others (the design warns
 * about the mix). Strings run in snake order along the rows; panels past the
 * plan are left unassigned. Returns the panels in string order.
 */
export function assignStrings(panels: LayoutPanel[], roofs: RoofFace[] | undefined, slots: StringSlot[]): LayoutPanel[] {
  type Unit = { slots: StringSlot[]; cap: number; panels: LayoutPanel[] };
  const units: Unit[] = [];
  for (const s of slots) {
    const u = units.find((x) => x.slots[0].inverterId === s.inverterId && x.slots[0].mppt === s.mppt);
    if (u) {
      u.slots.push(s);
      u.cap += s.size;
    } else units.push({ slots: [s], cap: s.size, panels: [] });
  }
  const groups = new Map<string, LayoutPanel[]>();
  for (const p of panels) {
    const k = faceAt(roofs, p)?.id ?? '';
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  const spill: LayoutPanel[] = [];
  for (const group of [...groups.values()].sort((a, b) => b.length - a.length)) {
    let rest = snakeOrder(group);
    while (rest.length) {
      const n = rest.length;
      const empty = units.filter((u) => !u.panels.length && u.cap > 0);
      const pick =
        empty.find((u) => u.cap === n) ??
        empty.filter((u) => u.cap < n).sort((a, b) => b.cap - a.cap)[0] ??
        empty.filter((u) => u.cap > n).sort((a, b) => a.cap - b.cap)[0];
      if (!pick) break;
      pick.panels = rest.slice(0, pick.cap);
      rest = rest.slice(pick.cap);
    }
    spill.push(...rest);
  }
  for (const u of units) u.panels.push(...spill.splice(0, Math.max(0, u.cap - u.panels.length)));

  const out: LayoutPanel[] = [];
  for (const u of units) {
    u.slots.reduce((i, s) => {
      u.panels.slice(i, i + s.size).forEach((p) => out.push({ ...p, stringId: s.id }));
      return i + s.size;
    }, 0);
  }
  const strung = new Set(out.map((p) => p.id));
  return [...out, ...panels.filter((p) => !strung.has(p.id)).map((p) => ({ ...p, stringId: null }))];
}

/** How squarely a face meets the noon sun at latitude `lat` (equinox), 1 = head on. Autoplace fills the best faces first. */
export function noonSun(f: Pick<RoofFace, 'pitchDeg' | 'azimuthDeg'>, lat: number): number {
  const t = rad(f.pitchDeg);
  return Math.cos(t) * Math.cos(rad(lat)) - Math.sin(t) * Math.cos(rad(f.azimuthDeg)) * Math.sin(rad(lat));
}

/**
 * Fills a roof face with panels in rows along its eave, from the eave up:
 * each panel `setbackM` inside the outline (true distance on the roof) and
 * clear of panels already on the face. Each row slides sideways to fit the
 * most. With `max`, stops there, keeping the middle of the last row.
 */
export function fillFace(a: {
  panel: PanelSpec;
  face: RoofFace;
  roofs: RoofFace[];
  existing: LayoutPanel[];
  orientation: Orientation;
  gapM: number;
  rowGapM: number;
  setbackM: number;
  idPrefix: string;
  max?: number;
}): LayoutPanel[] {
  const { face, setbackM: sb } = a;
  const c = Math.cos(rad(face.pitchDeg));
  const u = downslope(face);
  const v = { x: u.y, y: -u.x }; // across the slope, a panel's local x at autoRotation
  // Roof coordinates: x across the slope, y true distance down it.
  const toRoof = (p: LayoutPoint) => ({ x: p.x * v.x + p.y * v.y, y: (p.x * u.x + p.y * u.y) / c });
  const toPlan = (q: LayoutPoint) => ({ x: q.x * v.x + q.y * c * u.x, y: q.x * v.y + q.y * c * u.y });
  const outline = face.points.map(toRoof);
  const rot = autoRotation(face);
  const { w, h } = panelSize(a.panel, a.orientation);
  const taken = a.existing
    .filter((p) => faceAt(a.roofs, p)?.id === face.id)
    .map((p) => {
      const s = panelSize(a.panel, p.orientation);
      const turned = Math.abs(((((p.rot - rot) % 180) + 180) % 180) - 90) < 45;
      return { ...toRoof(p), w: turned ? s.h : s.w, h: turned ? s.w : s.h };
    });
  const fits = (q: LayoutPoint) =>
    [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ].every(([sx, sy]) => pointInPolygon({ x: q.x + sx * (w / 2 + sb), y: q.y + sy * (h / 2 + sb) }, outline)) &&
    faceAt(a.roofs, toPlan(q))?.id === face.id &&
    !taken.some((t) => Math.abs(t.x - q.x) < (t.w + w) / 2 + a.gapM - 1e-9 && Math.abs(t.y - q.y) < (t.h + h) / 2 + a.gapM - 1e-9);

  const xs = outline.map((q) => q.x);
  const ys = outline.map((q) => q.y);
  const [x0, x1, y0] = [Math.min(...xs), Math.max(...xs), Math.min(...ys)];
  const step = w + a.gapM;
  const max = a.max ?? Infinity;
  const out: LayoutPanel[] = [];
  for (let r = 0, y = Math.max(...ys) - sb - h / 2; y - h / 2 - sb >= y0 - 1e-9 && out.length < max; r += 1, y -= h + a.rowGapM) {
    let best: LayoutPoint[] = [];
    for (let k = 0; k < 12; k += 1) {
      const row: LayoutPoint[] = [];
      for (let x = x0 + sb + w / 2 + (k * step) / 12; x + w / 2 + sb <= x1 + 1e-9; x += step) if (fits({ x, y })) row.push({ x, y });
      if (row.length > best.length) best = row;
    }
    const keep = Math.min(best.length, max - out.length);
    const from = Math.floor((best.length - keep) / 2);
    best.slice(from, from + keep).forEach((q, i) => {
      const p = toPlan(q);
      out.push({ id: `${a.idPrefix}-${r}-${i}`, x: p.x, y: p.y, rot, orientation: a.orientation, rowId: `${a.idPrefix}-${r}`, stringId: null });
    });
  }
  return out;
}

/** Panels of a new array: rows × cols, centred on (x, y), rotated as one block. */
export function panelArray(a: {
  panel: PanelSpec;
  x: number;
  y: number;
  rows: number;
  cols: number;
  orientation: Orientation;
  rot: number;
  gapM: number;
  rowGapM: number;
  idPrefix: string;
  /** Lay the array on this face: true spacing on the roof, foreshortened in plan */
  face?: RoofFace | null;
}): LayoutPanel[] {
  const { w, h } = panelSize(a.panel, a.orientation);
  const m = projection(a.face ?? null);
  const width = a.cols * w + (a.cols - 1) * a.gapM;
  const height = a.rows * h + (a.rows - 1) * a.rowGapM;
  const rad = (a.rot * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const out: LayoutPanel[] = [];
  for (let r = 0; r < a.rows; r += 1) {
    for (let c = 0; c < a.cols; c += 1) {
      const lx = -width / 2 + w / 2 + c * (w + a.gapM);
      const ly = -height / 2 + h / 2 + r * (h + a.rowGapM);
      const v = applyM(m, { x: lx * cos - ly * sin, y: lx * sin + ly * cos });
      out.push({
        id: `${a.idPrefix}-${r}-${c}`,
        x: a.x + v.x,
        y: a.y + v.y,
        rot: a.rot,
        orientation: a.orientation,
        rowId: `${a.idPrefix}-${r}`,
        stringId: null,
      });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Roof faces: geometry
 *
 * Plan coordinates are x east, y south. A face's down-slope direction u is
 * (sin α, −cos α) for compass azimuth α. Seen from above, anything lying on
 * the face is squashed along u by cos(pitch) and untouched across it; that is
 * the whole projection, M = I + (cos θ − 1)·u·uᵀ.
 * ------------------------------------------------------------------ */

const rad = (deg: number) => (deg * Math.PI) / 180;

export function pointInPolygon(p: LayoutPoint, pts: LayoutPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i += 1) {
    const a = pts[i];
    const b = pts[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** The face under a point: the last drawn wins where faces overlap. */
export function faceAt(roofs: RoofFace[] | undefined, p: LayoutPoint): RoofFace | null {
  if (!roofs) return null;
  for (let i = roofs.length - 1; i >= 0; i -= 1) if (roofs[i].points.length >= 3 && pointInPolygon(p, roofs[i].points)) return roofs[i];
  return null;
}

export function downslope(f: Pick<RoofFace, 'azimuthDeg'>): LayoutPoint {
  return { x: Math.sin(rad(f.azimuthDeg)), y: -Math.cos(rad(f.azimuthDeg)) };
}

/** Plan projection of the face, as SVG matrix(a b c d 0 0) terms. Identity for a flat face. */
export function projection(f: Pick<RoofFace, 'azimuthDeg' | 'pitchDeg'> | null): { a: number; b: number; c: number; d: number } {
  if (!f) return { a: 1, b: 0, c: 0, d: 1 };
  const u = downslope(f);
  const k = Math.cos(rad(f.pitchDeg)) - 1;
  return { a: 1 + k * u.x * u.x, b: k * u.x * u.y, c: k * u.x * u.y, d: 1 + k * u.y * u.y };
}

const applyM = (m: ReturnType<typeof projection>, v: LayoutPoint) => ({ x: m.a * v.x + m.c * v.y, y: m.b * v.x + m.d * v.y });

/** How far down-slope the eave is: the largest u·v over the outline. */
const eaveReach = (f: RoofFace) => Math.max(...f.points.map((v) => v.x * downslope(f).x + v.y * downslope(f).y));

/** Height of a point on the face above its eave (lowest edge), in metres. */
export function heightAboveEave(f: RoofFace, p: LayoutPoint): number {
  const u = downslope(f);
  return Math.max(0, eaveReach(f) - (u.x * p.x + u.y * p.y)) * Math.tan(rad(f.pitchDeg));
}

/** The rotation that runs a panel's rows along the eave, its long side down the slope in portrait. */
export const autoRotation = (f: Pick<RoofFace, 'azimuthDeg'>) => (((f.azimuthDeg + 180) % 360) + 360) % 360;

/** Corners of a panel as seen from above. */
export function panelCorners(panel: PanelSpec, p: LayoutPanel, roofs: RoofFace[] | undefined): LayoutPoint[] {
  const { w, h } = panelSize(panel, p.orientation);
  const m = projection(faceAt(roofs, p));
  const r = rad(p.rot);
  return [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ].map(([lx, ly]) => {
    const v = applyM(m, { x: lx * Math.cos(r) - ly * Math.sin(r), y: lx * Math.sin(r) + ly * Math.cos(r) });
    return { x: p.x + v.x, y: p.y + v.y };
  });
}

/**
 * Keeps the panels on a face at their true spacing on the roof when the face's
 * pitch or facing changes, including when it is first drawn under them (from a
 * 0° face). Membership is decided once, against the old face. Positions are
 * un-squashed along the old slope and squashed along the new one: about the
 * face's lowest corner for a pitch change, so the bottom row stays at the
 * eave, and about its middle when it turns.
 * Panels whose rows followed the old eave are turned to follow the new one.
 */
export function refitFace(panels: LayoutPanel[], roofs: RoofFace[], oldFace: RoofFace, newFace: RoofFace): LayoutPanel[] {
  const uo = downslope(oldFace);
  const un = downslope(newFace);
  const co = Math.cos(rad(oldFace.pitchDeg));
  const cn = Math.cos(rad(newFace.pitchDeg));
  if (co <= 1e-9) return panels;
  const turn = newFace.azimuthDeg !== oldFace.azimuthDeg;
  // A pitch change pivots on the eave; a turn pivots on the middle, which is the same whichever way the face slopes.
  const anchor = turn
    ? {
        x: oldFace.points.reduce((a, v) => a + v.x, 0) / oldFace.points.length,
        y: oldFace.points.reduce((a, v) => a + v.y, 0) / oldFace.points.length,
      }
    : oldFace.points.reduce((best, v) => (v.x * uo.x + v.y * uo.y > best.x * uo.x + best.y * uo.y ? v : best), oldFace.points[0]);
  const oldRot = autoRotation(oldFace);
  const members = new Set(panels.filter((p) => faceAt(roofs, p)?.id === oldFace.id).map((p) => p.id));
  return panels.map((p) => {
    if (!members.has(p.id)) return p;
    const v = { x: p.x - anchor.x, y: p.y - anchor.y };
    const ko = (1 / co - 1) * (uo.x * v.x + uo.y * v.y);
    const t = { x: v.x + ko * uo.x, y: v.y + ko * uo.y };
    const kn = (cn - 1) * (un.x * t.x + un.y * t.y);
    const followed = Math.abs((((p.rot - oldRot) % 360) + 360) % 360) < 1e-6;
    return {
      ...p,
      x: anchor.x + t.x + kn * un.x,
      y: anchor.y + t.y + kn * un.y,
      rot: turn && followed ? autoRotation(newFace) : p.rot,
    };
  });
}

/** Eight-point compass name for an azimuth. */
export function compass(deg: number): string {
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

/** PVGIS's "aspect": 0 south, −90 east, 90 west, 180 north. */
export function pvgisAspect(azimuthDeg: number): number {
  const a = ((((azimuthDeg - 180) % 360) + 540) % 360) - 180;
  return a === -180 ? 180 : a;
}

/* ------------------------------------------------------------------ *
 * Sun analysis
 * ------------------------------------------------------------------ */

const DAYS = [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const yearly = (monthly: number[]) => monthly.reduce((a, d, i) => a + d * DAYS[i], 0);

/**
 * Measured ÷ PVGIS for the reference array, over the months it was logged,
 * each month weighted by its logged days. By construction the reference array
 * is then predicted exactly for those months.
 */
export function calibrate(measured: number[], days: number[], pvgis: number[]): { factor: number; measured: number; pvgis: number; days: number } {
  const n = days.reduce((a, d) => a + d, 0);
  const m = measured.reduce((a, v, i) => a + v * days[i], 0);
  const p = pvgis.reduce((a, v, i) => a + v * days[i], 0);
  return { factor: p > 0 ? m / p : 1, measured: n ? m / n : 0, pvgis: n ? p / n : 0, days: n };
}

export function calibrationFor(yields: Yields, s: Pick<DesignSettings, 'referenceTiltDeg' | 'referenceAzimuthDeg' | 'calibrationOverride'>): Calibration {
  const c = calibrate(referenceMeasured(), referenceDays(), yields.reference);
  const fixed = s.calibrationOverride > 0;
  return {
    factor: round(fixed ? s.calibrationOverride : c.factor, 4),
    auto: !fixed,
    measuredPerKwpDay: round(c.measured, 3),
    pvgisPerKwpDay: round(c.pvgis, 3),
    days: c.days,
    tiltDeg: s.referenceTiltDeg,
    azimuthDeg: s.referenceAzimuthDeg,
    window: `${REFERENCE_ARRAY.from} to ${REFERENCE_ARRAY.to}`,
  };
}

/**
 * Expected generation by roof face: PVGIS kWh/kWp/day for each face's pitch
 * and facing, times the calibration factor, times the kWp on it. Panels on no
 * face use the flat-roof figures.
 */
export function sunAnalysis(layout: Layout, panel: PanelSpec, yields: Yields, calibration: Calibration): SunResult {
  const keep = calibration.factor;
  const groups = new Map<string, LayoutPanel[]>();
  for (const p of layout.panels) {
    const id = faceAt(layout.roofs, p)?.id ?? '';
    groups.set(id, [...(groups.get(id) ?? []), p]);
  }
  const bestYear = yearly(yields.best.monthly) * keep;
  const bestPerKwpDay = bestYear / 365.25;
  const faces: SunFace[] = [];
  for (const f of [...(layout.roofs ?? []), null]) {
    const id = f?.id ?? '';
    const n = groups.get(id)?.length ?? 0;
    if (!n && !f) continue;
    const per = (f ? yields.faces[f.id] : yields.flat) ?? yields.flat;
    const kwp = (n * panel.watts) / 1000;
    const monthlyKwh = per.map((d, i) => round(d * keep * kwp * DAYS[i], 1));
    const year = yearly(per) * keep;
    faces.push({
      id,
      label: f ? `Roof ${f.id}` : 'No roof face (flat)',
      pitchDeg: f?.pitchDeg ?? 0,
      azimuthDeg: f?.azimuthDeg ?? null,
      panels: n,
      kwp: round(kwp, 3),
      perKwpDay: round(year / 365.25, 3),
      kwhPerDay: round((year / 365.25) * kwp, 1),
      kwhPerYear: round(year * kwp, 0),
      monthlyKwh,
      vsBestPct: round((year / bestYear - 1) * 100, 1),
    });
  }
  const kwhPerYear = faces.reduce((a, f) => a + f.kwhPerYear, 0);
  const kwp = (layout.panels.length * panel.watts) / 1000;
  return {
    faces,
    kwhPerYear: round(kwhPerYear, 0),
    kwhPerDay: round(kwhPerYear / 365.25, 1),
    perKwpDay: kwp > 0 ? round(kwhPerYear / 365.25 / kwp, 3) : 0,
    bestPerKwpDay: round(bestPerKwpDay, 3),
    best: { pitchDeg: yields.best.pitchDeg, azimuthDeg: yields.best.azimuthDeg },
    monthlyKwh: DAYS.map((_, i) => round(faces.reduce((a, f) => a + f.monthlyKwh[i], 0), 1)),
    calibration,
  };
}
