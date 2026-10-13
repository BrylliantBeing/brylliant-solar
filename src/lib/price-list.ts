import type { BomLine, DesignResult } from '@calculator/pvDesign';
import {
  AC_BREAKERS_A,
  AC_CONDUCTORS,
  DC_BREAKERS_A,
  DC_CONDUCTORS,
  GROUND_CONDUCTORS,
  INVERTERS,
} from '@calculator/pvDesignData';
import { ZAMBOANGA_DEFAULTS as Q } from '@calculator/solarQuoteCalculator';

/**
 * The price list: every item the PV design tool can put on a bill of
 * materials, plus the per-job costs and small-parts lots a full job carries.
 * Defaults come from the quote calculator (ZAMBOANGA_DEFAULTS) where it has
 * one; everything else starts unpriced until set on the Prices page, which
 * stores only the prices changed there (public/api/prices.php, through
 * src/lib/prices-api.ts). Pure, so the tests can run it.
 */

export type PriceBasis = 'job' | 'inverter' | 'panel' | 'string';

export type PriceItem = {
  /** BomLine.priceKey ?? BomLine.id for materials; a fixed key for extras and job costs */
  key: string;
  name: string;
  /** What one price buys: "roll", "m", "pc" … */
  unit: string;
  group: string;
  defaultPhp: number | null;
  /** Extras and job costs only: how many come with each job / inverter / panel / string */
  basis?: PriceBasis;
  qty?: number;
};

/** Quote prices quoted in US$, at the quote calculator's fallback rate */
const usd = (n: number) => Math.round(n * Q.usdToPhp * 100) / 100;
const part = (name: string) => Q.electricalParts.find((p) => p.name === name)?.php ?? null;

const materials: PriceItem[] = [
  {
    key: 'panels',
    name: 'Jinko Tiger Neo 725 W panel',
    unit: 'pc',
    group: 'Panels & inverters',
    defaultPhp: usd(Q.panelPriceUsd),
  },
  ...INVERTERS.map((m) => ({
    key: `inverter-${m.model}`,
    name: m.model,
    unit: 'pc',
    group: 'Panels & inverters',
    defaultPhp: m.model === 'HYXi HYX-S10K-S' ? Q.gridTieInverterPricePhp : null,
  })),
  { key: 'rail', name: 'Mounting rail, 4.2 m', unit: 'pc', group: 'Mounting', defaultPhp: null },
  { key: 'rail-splice', name: 'Rail splice', unit: 'pc', group: 'Mounting', defaultPhp: null },
  { key: 'l-foot', name: 'L-foot / roof attachment', unit: 'pc', group: 'Mounting', defaultPhp: null },
  { key: 'mid-clamp', name: 'Mid clamp', unit: 'pc', group: 'Mounting', defaultPhp: null },
  { key: 'end-clamp', name: 'End clamp', unit: 'pc', group: 'Mounting', defaultPhp: null },
  { key: 'ground-lug', name: 'Rail grounding lug', unit: 'pc', group: 'Mounting', defaultPhp: null },
  ...DC_CONDUCTORS.map((c) => ({
    key: `pv-cable-${c.mm2}`,
    name: `PV cable ${c.mm2} mm², ${Q.pvCableRollMeters} m roll`,
    unit: 'roll',
    group: 'DC side',
    defaultPhp: c.mm2 === 6 ? usd(Q.pvCableRollUsd) : null,
  })),
  { key: 'mc4', name: 'MC4 connector pair', unit: 'pair', group: 'DC side', defaultPhp: part('MC4 pair, home runs') },
  ...DC_BREAKERS_A.map((a) => ({
    key: `dc-mcb-${a}`,
    name: `DC MCB 2P ${a} AT, 600 V DC`,
    unit: 'pc',
    group: 'DC side',
    defaultPhp: a === 32 ? part('DC breaker 2P 32 A 600 V+') : null,
  })),
  {
    key: 'dc-spd',
    name: 'DC SPD Type II, 600 V',
    unit: 'pc',
    group: 'DC side',
    defaultPhp: part('DC surge protector Type II 600 V'),
  },
  { key: 'dc-box', name: 'DC combiner enclosure, IP65', unit: 'pc', group: 'DC side', defaultPhp: part('DC enclosure IP65') },
  ...AC_BREAKERS_A.map((a) => ({
    key: `ac-mcb-${a}`,
    name: `AC MCB 2P ${a} AT, 230 V`,
    unit: 'pc',
    group: 'AC side',
    defaultPhp: a === 60 ? part('AC breaker 2P 60 A') : null,
  })),
  {
    key: 'ac-spd',
    name: 'AC SPD Type II, 275 V',
    unit: 'pc',
    group: 'AC side',
    defaultPhp: part('AC surge protector Type II 275 V'),
  },
  { key: 'ac-box', name: 'AC breaker enclosure, NEMA 3R', unit: 'pc', group: 'AC side', defaultPhp: part('AC enclosure') },
  { key: 'ct', name: 'Export-limit CT / smart meter', unit: 'pc', group: 'AC side', defaultPhp: null },
  ...AC_CONDUCTORS.map((c) => ({
    key: `thhn-${c.mm2}`,
    name: `THHN ${c.mm2} mm² stranded`,
    unit: 'm',
    group: 'AC side',
    defaultPhp: c.mm2 === 14 ? part('14 mm² THHN, line + neutral') : null,
  })),
  ...GROUND_CONDUCTORS.map((g) => ({
    key: `ground-${g.mm2}`,
    name: `TW ${g.mm2} mm² (G), green`,
    unit: 'm',
    group: 'Earthing',
    defaultPhp: g.mm2 === 8 ? part('8 mm² THHN green') : null,
  })),
  {
    key: 'ground-rod',
    name: 'Ground rod 5/8" × 8 ft + clamp',
    unit: 'pc',
    group: 'Earthing',
    defaultPhp: part('Ground rod 5/8" × 10 ft + clamp'),
  },
  { key: 'conduit-20', name: 'PVC conduit 20 mm, 3 m', unit: 'pc', group: 'Conduit', defaultPhp: part('Conduit, 3 m length') },
  { key: 'conduit-25', name: 'PVC conduit 25 mm, 3 m', unit: 'pc', group: 'Conduit', defaultPhp: null },
];

/** What a full job carries beyond the designed parts, as the quote calculator prices it. */
const extras: PriceItem[] = [
  {
    key: 'extra-house-breaker',
    name: 'House panel breaker 2P 60 A',
    unit: 'pc',
    group: 'Small parts & extras',
    defaultPhp: part('House panel breaker 2P 60 A'),
    basis: 'inverter',
    qty: 1,
  },
  {
    key: 'extra-safety-switch',
    name: 'Lockable safety switch 2P 60 A',
    unit: 'pc',
    group: 'Small parts & extras',
    defaultPhp: part('Lockable safety switch 2P 60 A'),
    basis: 'job',
    qty: 1,
  },
  {
    key: 'extra-earthing-clip',
    name: 'Earthing clip',
    unit: 'pc',
    group: 'Small parts & extras',
    defaultPhp: part('Earthing clip'),
    basis: 'panel',
    qty: 1,
  },
  {
    key: 'extra-fittings',
    name: 'Conduit fittings and straps',
    unit: 'lot',
    group: 'Small parts & extras',
    defaultPhp: part('Conduit fittings and straps'),
    basis: 'job',
    qty: 1,
  },
  {
    key: 'extra-ties',
    name: 'UV cable ties and clips',
    unit: 'lot',
    group: 'Small parts & extras',
    defaultPhp: part('UV cable ties and clips'),
    basis: 'job',
    qty: 1,
  },
  {
    key: 'extra-lugs',
    name: 'Lugs and heat shrink',
    unit: 'lot',
    group: 'Small parts & extras',
    defaultPhp: part('Lugs and heat shrink'),
    basis: 'job',
    qty: 1,
  },
  {
    key: 'extra-labels',
    name: 'Warning labels',
    unit: 'set',
    group: 'Small parts & extras',
    defaultPhp: part('Warning labels'),
    basis: 'job',
    qty: 1,
  },
  {
    key: 'job-labour',
    name: 'Installation labour',
    unit: 'job',
    group: 'Job costs',
    defaultPhp: Q.laborCost,
    basis: 'job',
    qty: 1,
  },
  {
    key: 'job-freight',
    name: 'Container freight, share per panel',
    unit: 'panel',
    group: 'Job costs',
    defaultPhp: Math.round((Q.freightPerContainer / Q.panelsPerContainer) * 100) / 100,
    basis: 'panel',
    qty: 1,
  },
  {
    key: 'job-net-metering',
    name: 'Net-metering application',
    unit: 'job',
    group: 'Job costs',
    defaultPhp: Q.netMeteringCost,
    basis: 'job',
    qty: 1,
  },
  { key: 'job-misc', name: 'Miscellaneous', unit: 'job', group: 'Job costs', defaultPhp: Q.miscCost, basis: 'job', qty: 1 },
];

export const PRICE_ITEMS: PriceItem[] = [...materials, ...extras];
export const PRICE_GROUPS = [...new Set(PRICE_ITEMS.map((i) => i.group))];
const byKey = new Map(PRICE_ITEMS.map((i) => [i.key, i]));

/** Prices set on the Prices page, by key. */
export type PriceOverrides = Record<string, number>;

export const priceKeyOf = (line: BomLine) => line.priceKey ?? line.id;

/** The price in use: the one set on the Prices page, else the default; null = unpriced. */
export function priceFor(key: string, overrides: PriceOverrides): number | null {
  if (key in overrides) return overrides[key];
  return byKey.get(key)?.defaultPhp ?? null;
}

export type PricedLine = BomLine & { unitPrice: number | null; total: number };

export type DesignPrice = {
  lines: PricedLine[];
  extras: { item: PriceItem; qty: number; unitPrice: number | null; total: number }[];
  materials: number;
  extrasTotal: number;
  jobCosts: number;
  total: number;
  /** Lines with no price yet; the total leaves them out */
  unpriced: string[];
};

/** The design's bill of materials priced line by line, plus the extras and job costs of a full job. */
export function priceDesign(result: DesignResult, overrides: PriceOverrides): DesignPrice {
  const unpriced: string[] = [];
  const lines = result.bom.map((l) => {
    const unitPrice = priceFor(priceKeyOf(l), overrides);
    if (unitPrice === null) unpriced.push(l.name);
    return { ...l, unitPrice, total: (unitPrice ?? 0) * l.qty };
  });
  const strings = result.strings.filter((s) => s.series > 0).length;
  const count: Record<PriceBasis, number> = { job: 1, inverter: result.inverters.length, panel: result.panels, string: strings };
  const extraLines = extras.map((item) => {
    const unitPrice = priceFor(item.key, overrides);
    const qty = Math.ceil((item.qty ?? 1) * count[item.basis ?? 'job'] - 1e-9);
    if (unitPrice === null && qty > 0) unpriced.push(item.name);
    return { item, qty, unitPrice, total: (unitPrice ?? 0) * qty };
  });
  const materials = lines.reduce((a, l) => a + l.total, 0);
  const extrasTotal = extraLines.filter((e) => e.item.group !== 'Job costs').reduce((a, e) => a + e.total, 0);
  const jobCosts = extraLines.filter((e) => e.item.group === 'Job costs').reduce((a, e) => a + e.total, 0);
  return { lines, extras: extraLines, materials, extrasTotal, jobCosts, total: materials + extrasTotal + jobCosts, unpriced };
}
