/**
 * Equipment and code tables for the PV design tool (pvDesign.ts).
 *
 * Panel and inverter figures are datasheet values. The conductor and breaker
 * tables are the ones the business sizes against; the voltage-drop R/X table
 * is copied from context/VOLTAGE DROP CALCULATOR.xlsx (PEC Table 10.1.1.9).
 * Everything here is data: change a figure here, not in the engine.
 */

import { ZAMBOANGA_SUN_PROFILE } from './zamboangaSunProfile';

/* ------------------------------------------------------------------ *
 * Reference array
 *
 * The logged system every yield prediction is calibrated against: PVGIS is
 * asked what this array should have made over the logged months, and the
 * ratio of measured to predicted is applied to every roof. Its tilt and facing
 * must be the real ones, measured on the frame, or that error is copied into
 * every design.
 * ------------------------------------------------------------------ */

export const REFERENCE_ARRAY = {
  description: '3 × 650 W, Zamboanga',
  kwp: 1.95,
  /** Measured on the panel frame, 2026-10-13 */
  tiltDeg: 20,
  /** Faces south */
  azimuthDeg: 180,
  /** PVGIS weather is on a ~25 km grid, so anywhere in the city gives the same answer */
  lat: 6.92,
  lng: 122.08,
  /** The logged window, from the header of zamboangaSunProfile.ts */
  from: '2026-06-08',
  to: '2026-09-27',
};

/** Measured kWh per kWp per day, by month, from the inverter log. */
export const referenceMeasured = (): number[] => ZAMBOANGA_SUN_PROFILE.monthly.map((hours) => hours.reduce((a, b) => a + b, 0));

/**
 * Logged days per month. The profile records them from the next rebuild on;
 * until then they are counted from the logged window.
 */
export function referenceDays(): number[] {
  if (ZAMBOANGA_SUN_PROFILE.measuredDays) return ZAMBOANGA_SUN_PROFILE.measuredDays;
  const days = new Array(12).fill(0);
  for (let t = Date.parse(`${REFERENCE_ARRAY.from}T00:00:00Z`); t <= Date.parse(`${REFERENCE_ARRAY.to}T00:00:00Z`); t += 86400000) {
    days[new Date(t).getUTCMonth()] += 1;
  }
  return days;
}

/* ------------------------------------------------------------------ *
 * Panels
 * ------------------------------------------------------------------ */

export type PanelSpec = {
  model: string;
  watts: number;
  /** Open-circuit voltage, STC */
  vocV: number;
  /** Short-circuit current, STC */
  iscA: number;
  vmpV: number;
  impA: number;
  /** Long side, mm */
  lengthMm: number;
  /** Short side, mm */
  widthMm: number;
  thicknessMm: number;
  weightKg: number;
  /** % per °C, negative. Raises Voc on cold mornings. */
  vocTempCoeffPct: number;
  /** The largest fuse or breaker the module may sit behind. */
  maxSeriesFuseA: number;
};

/**
 * Jinko Tiger Neo JKM725N-66HL5-BDV. Electrical figures from the published
 * datasheet; check the temperature coefficient and series fuse rating against
 * the sheet that ships with the batch.
 */
export const JINKO_725: PanelSpec = {
  model: 'Jinko Tiger Neo JKM725N-66HL5-BDV',
  watts: 725,
  vocV: 49.2,
  iscA: 18.74,
  vmpV: 41.0,
  impA: 17.69,
  lengthMm: 2384,
  widthMm: 1303,
  thicknessMm: 33,
  weightKg: 37.5,
  vocTempCoeffPct: -0.25,
  maxSeriesFuseA: 35,
};

export const PANELS: PanelSpec[] = [JINKO_725];

/* ------------------------------------------------------------------ *
 * Inverters
 * ------------------------------------------------------------------ */

export type MpptSpec = {
  /** Operating current the tracker will accept; more than this is clipped */
  maxInputA: number;
  /** Short-circuit current the tracker is rated for */
  maxIscA: number;
  /** String inputs on this tracker */
  inputs: number;
};

export type InverterSpec = {
  model: string;
  maxDcV: number;
  nominalDcV: number;
  startupV: number;
  /** Operating window */
  mpptMinV: number;
  mpptMaxV: number;
  /** Window for full output; below it the inverter derates */
  fullLoadMinV: number;
  fullLoadMaxV: number;
  mppts: MpptSpec[];
  maxDcW: number;
  nominalAcW: number;
  maxApparentVA: number;
  nominalAcV: number;
  frequencyHz: string;
  maxAcA: number;
  powerFactor: string;
  weightKg: number;
  dimensionsMm: string;
};

/** HYXi EcoSavvy HYX-S(8-10.5)K-S2, datasheet V1.0-202608 (calculator/src). Single phase. */
const hyxi = (model: string, maxDcW: number, nominalAcW: number, maxApparentVA: number, maxAcA: number): InverterSpec => ({
  model,
  maxDcV: 600,
  nominalDcV: 360,
  startupV: 40,
  mpptMinV: 40,
  mpptMaxV: 560,
  fullLoadMinV: 200,
  fullLoadMaxV: 500,
  mppts: [
    { maxInputA: 20, maxIscA: 25, inputs: 1 },
    { maxInputA: 32, maxIscA: 40, inputs: 2 },
  ],
  maxDcW,
  nominalAcW,
  maxApparentVA,
  nominalAcV: 230,
  frequencyHz: '50/60',
  maxAcA,
  powerFactor: '0.8 leading – 0.8 lagging',
  weightKg: 12,
  dimensionsMm: '340 × 360 × 136',
});

/**
 * HYXi HYX-S(7-12)K-S, datasheet V1.0-202404 AU (calculator/src). Single phase,
 * one string per MPPT; the 7K and 8K have two trackers, the rest three. Not the
 * -S2 range above, which has two trackers with two inputs on the second.
 */
const hyxiS = (model: string, trackers: number, maxDcW: number, nominalAcW: number, maxApparentVA: number, maxAcA: number): InverterSpec => ({
  model,
  maxDcV: 600,
  nominalDcV: 360,
  startupV: 80,
  mpptMinV: 40,
  mpptMaxV: 560,
  fullLoadMinV: 200,
  fullLoadMaxV: 500,
  mppts: Array.from({ length: trackers }, () => ({ maxInputA: 20, maxIscA: 24, inputs: 1 })),
  maxDcW,
  nominalAcW,
  maxApparentVA,
  nominalAcV: 230,
  frequencyHz: '50/60',
  // At 230 V
  maxAcA,
  powerFactor: '0.8 leading – 0.8 lagging',
  weightKg: 23,
  dimensionsMm: '522 × 416 × 162.5',
});

/** The first entry is what a newly placed inverter starts as. */
export const INVERTERS: InverterSpec[] = [
  hyxiS('HYXi HYX-S10K-S', 3, 16000, 10000, 11000, 47.9),
  hyxiS('HYXi HYX-S7K-S', 2, 11200, 7000, 7700, 33.4),
  hyxiS('HYXi HYX-S8K-S', 2, 12800, 8000, 8800, 38.3),
  hyxiS('HYXi HYX-S9K-S', 3, 14400, 9000, 9900, 43),
  hyxiS('HYXi HYX-S12K-S', 3, 19200, 12000, 13200, 57.42),
  hyxi('HYXi HYX-S10K-S2', 20000, 10000, 10000, 45.5),
  hyxi('HYXi HYX-S8K-S2', 16000, 8000, 8800, 40),
  hyxi('HYXi HYX-S10K5-S2', 21000, 10500, 10500, 47.7),
];

/* ------------------------------------------------------------------ *
 * Conductors
 * ------------------------------------------------------------------ */

export type AcConductor = {
  awg: string;
  mm2: number;
  ampacityA: number;
  /** Ω to neutral per 305 m, 60 Hz, 75 °C, uncoated copper in PVC conduit (Table 10.1.1.9) */
  rOhmPer305m: number;
  xOhmPer305m: number;
};

/** THHN copper, the business's table, with R and X from the voltage-drop sheet. */
export const AC_CONDUCTORS: AcConductor[] = [
  { awg: '#14', mm2: 2.0, ampacityA: 25, rOhmPer305m: 3.1, xOhmPer305m: 0.058 },
  { awg: '#12', mm2: 3.5, ampacityA: 30, rOhmPer305m: 2.0, xOhmPer305m: 0.054 },
  { awg: '#10', mm2: 5.5, ampacityA: 40, rOhmPer305m: 1.2, xOhmPer305m: 0.05 },
  { awg: '#8', mm2: 8.0, ampacityA: 55, rOhmPer305m: 0.78, xOhmPer305m: 0.052 },
  { awg: '#6', mm2: 14, ampacityA: 70, rOhmPer305m: 0.49, xOhmPer305m: 0.051 },
  { awg: '#4', mm2: 22, ampacityA: 90, rOhmPer305m: 0.31, xOhmPer305m: 0.048 },
  { awg: '#2', mm2: 30, ampacityA: 115, rOhmPer305m: 0.19, xOhmPer305m: 0.045 },
  { awg: '#1', mm2: 38, ampacityA: 130, rOhmPer305m: 0.15, xOhmPer305m: 0.046 },
  { awg: '#1/0', mm2: 50, ampacityA: 150, rOhmPer305m: 0.12, xOhmPer305m: 0.044 },
  { awg: '#2/0', mm2: 60, ampacityA: 170, rOhmPer305m: 0.1, xOhmPer305m: 0.043 },
  { awg: '#3/0', mm2: 80, ampacityA: 205, rOhmPer305m: 0.077, xOhmPer305m: 0.042 },
  { awg: '#4/0', mm2: 100, ampacityA: 225, rOhmPer305m: 0.062, xOhmPer305m: 0.041 },
];

export type DcConductor = { mm2: number; diameterMm: number; ampacityA: number };

/** Single-strand DC (PV) cable and its ampacity. 1.0 mm² is left out: not used in industry. */
export const DC_CONDUCTORS: DcConductor[] = [
  { mm2: 1.5, diameterMm: 1.37, ampacityA: 15 },
  { mm2: 2.5, diameterMm: 1.76, ampacityA: 21 },
  { mm2: 4, diameterMm: 2.24, ampacityA: 26 },
  { mm2: 6, diameterMm: 2.73, ampacityA: 34 },
  { mm2: 10, diameterMm: 3.56, ampacityA: 46 },
  { mm2: 16, diameterMm: 4.51, ampacityA: 61 },
  { mm2: 25, diameterMm: 5.64, ampacityA: 80 },
  { mm2: 35, diameterMm: 6.67, ampacityA: 98 },
  { mm2: 50, diameterMm: 7.97, ampacityA: 121 },
  { mm2: 70, diameterMm: 9.44, ampacityA: 156 },
  { mm2: 95, diameterMm: 10.99, ampacityA: 187 },
  { mm2: 120, diameterMm: 12.36, ampacityA: 215 },
  { mm2: 150, diameterMm: 13.81, ampacityA: 262 },
  { mm2: 185, diameterMm: 15.34, ampacityA: 289 },
];

/**
 * Copper resistivity at 75 °C, Ω·mm²/m: 0.017241 × (1 + 0.00393 × 55).
 * DC voltage drop uses this because the sheet's R table only has the
 * Philippine sizes (3.5, 5.5 …), not the IEC PV-cable sizes (4, 6 …).
 */
export const COPPER_RHO_75C = 0.017241 * (1 + 0.00393 * 55);

/** Equipment grounding conductor by the rating of the breaker ahead of it (PEC 2.50.6.13, copper). */
export const GROUND_CONDUCTORS: { upToA: number; mm2: number }[] = [
  { upToA: 15, mm2: 2.0 },
  { upToA: 20, mm2: 3.5 },
  { upToA: 60, mm2: 5.5 },
  { upToA: 100, mm2: 8.0 },
  { upToA: 200, mm2: 14 },
  { upToA: 300, mm2: 22 },
  { upToA: 400, mm2: 30 },
];

/**
 * "C" values for the point-to-point short-circuit method (Bussmann Table 4):
 * copper, single conductors, steel conduit, 600 V. Keyed by mm².
 */
export const C_VALUES: Record<number, number> = {
  2.0: 389,
  3.5: 617,
  5.5: 981,
  8.0: 1557,
  14: 2425,
  22: 3806,
  30: 5907,
  38: 7293,
  50: 8925,
  60: 10755,
  80: 12844,
  100: 15082,
};

/* ------------------------------------------------------------------ *
 * Breakers
 * ------------------------------------------------------------------ */

export const DC_BREAKERS_A = [6, 10, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125, 150];

/** Standard AC trip ratings. Edit to what the supplier actually stocks. */
export const AC_BREAKERS_A = [15, 20, 30, 40, 50, 60, 70, 80, 100, 125, 150];

/** Interrupting ratings offered; never below 10 kA, as the sample plan set specifies. */
export const KAIC_RATINGS = [10, 14, 18, 22, 25, 35, 42, 50, 65];
