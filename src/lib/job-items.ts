import type { PartBasis, QuoteDefaults, QuoteResult, SystemType } from '@calculator/solarQuoteCalculator';

/**
 * A job's bill of materials: what is actually installed, seeded from a quote and
 * then edited by hand. Nothing here refuses an edit — jobWarnings() only says
 * when the parts stop fitting together (e.g. 100 panels on 4 inverters).
 */

export type JobItemKind =
  | 'panel'
  | 'inverter'
  | 'battery'
  | 'mounting'
  | 'pvCable'
  | 'part'
  | 'freight'
  | 'labor'
  | 'permit'
  | 'misc'
  | 'custom';

export type JobItem = {
  id: string;
  category: string;
  kind: JobItemKind;
  name: string;
  /** Shown after the quantity; empty for a plain count */
  unit: string;
  qty: number;
  /** PHP */
  unitPrice: number;
  /** What the quote had; null for items added by hand */
  defaultQty: number | null;
  defaultUnitPrice: number | null;
  /** Items that scale with the system: perBasis units for each job / inverter / string / panel */
  basis?: PartBasis;
  perBasis?: number;
};

/** The specs the warnings check against, taken from the quote's assumptions. Editable on the job. */
export type JobSettings = {
  panelWatts: number;
  inverterKw: number;
  inverterMaxPanels: number;
  maxDcAcRatio: number;
  panelsPerString: number;
  pvCableMetersPerString: number;
  pvCableRollMeters: number;
  batteryUnitKwh: number;
};

/** The order categories are listed in. Anything else (custom categories) follows. */
export const JOB_CATEGORIES = [
  'Solar array',
  'Inverters',
  'Batteries',
  'DC side',
  'AC side',
  'Earthing',
  'Conduit & small parts',
  'Electrical',
  'Freight & logistics',
  'Labour',
  'Permits & net metering',
  'Misc',
] as const;

/** Grid-tie quotes swap in the grid-tie inverter, as calculateQuote does. */
export function settingsFor(values: QuoteDefaults, systemType: SystemType): JobSettings {
  const gridTie = systemType === 'grid-tie';
  return {
    panelWatts: values.panelWatts,
    inverterKw: gridTie ? values.gridTieInverterKw : values.inverterKw,
    inverterMaxPanels: gridTie ? values.gridTieInverterMaxPanels : values.inverterMaxPanels,
    maxDcAcRatio: gridTie ? values.gridTieMaxDcAcRatio : values.maxDcAcRatio,
    panelsPerString: values.panelsPerString,
    pvCableMetersPerString: values.pvCableMetersPerString,
    pvCableRollMeters: values.pvCableRollMeters,
    batteryUnitKwh: values.batteryUnitKwh,
  };
}

/** Price each from a line total, falling back to the list price when the quote had none. */
const each = (total: number | undefined, qty: number, fallback: number) =>
  total !== undefined && qty > 0 ? total / qty : fallback;

/**
 * The quote's pricing as editable line items. The items add up to
 * q.pricing.total; quotes saved before an item was itemised get the combined line.
 */
export function itemsFromQuote(q: QuoteResult, values: QuoteDefaults, systemType: SystemType): JobItem[] {
  const p = q.pricing;
  const rate = p.usdToPhp ?? values.usdToPhp;
  const panels = q.panels.count;
  const items: JobItem[] = [];
  const add = (item: Omit<JobItem, 'defaultQty' | 'defaultUnitPrice'>) =>
    items.push({ ...item, defaultQty: item.qty, defaultUnitPrice: item.unitPrice });

  add({
    id: 'panels',
    category: 'Solar array',
    kind: 'panel',
    name: `Solar panel ${q.panels.wattsEach} W`,
    unit: '',
    qty: panels,
    unitPrice: each(p.panels, panels, values.panelPriceUsd * rate),
  });
  if (p.mounting !== undefined) {
    add({
      id: 'mounting',
      category: 'Solar array',
      kind: 'mounting',
      name: 'Rails & mounts, per panel',
      unit: 'set',
      qty: panels,
      unitPrice: each(p.mounting, panels, values.mountingPerPanelUsd * rate),
      basis: 'panel',
      perBasis: 1,
    });
    add({
      id: 'pv-cable',
      category: 'Solar array',
      kind: 'pvCable',
      name: `PV cable, ${values.pvCableRollMeters} m roll`,
      unit: 'roll',
      qty: p.pvCableRolls,
      unitPrice: each(p.pvCable, p.pvCableRolls, values.pvCableRollUsd * rate),
    });
  } else {
    add({ id: 'mounting-cabling', category: 'Solar array', kind: 'misc', name: 'Mounting & cabling', unit: 'lot', qty: 1, unitPrice: p.mountingCabling });
  }

  const gridTie = systemType === 'grid-tie';
  add({
    id: 'inverters',
    category: 'Inverters',
    kind: 'inverter',
    name: `${gridTie ? 'Grid-tie' : 'Hybrid'} inverter ${q.inverter.ratingKwEach} kW`,
    unit: '',
    qty: q.inverter.count,
    unitPrice: each(p.inverters, q.inverter.count, gridTie ? values.gridTieInverterPricePhp : values.inverterPriceUsd * rate),
  });
  if (!gridTie) {
    add({
      id: 'batteries',
      category: 'Batteries',
      kind: 'battery',
      name: `Battery ${values.batteryUnitKwh} kWh`,
      unit: '',
      qty: q.battery.units,
      unitPrice: each(p.batteries, q.battery.units, values.batteryPriceUsd * rate),
    });
  }

  // Basis and category come from the parts list by name, since saved results don't carry them.
  const listed = new Map(values.electricalParts.map((part) => [part.name, part]));
  (p.electricalParts ?? []).forEach((part, i) => {
    const spec = listed.get(part.name);
    add({
      id: `part-${i}`,
      category: part.category ?? spec?.category ?? 'Electrical',
      kind: 'part',
      name: part.name,
      unit: part.unit ?? '',
      qty: part.quantity,
      unitPrice: part.php,
      ...(spec ? { basis: spec.per, perBasis: spec.qty } : {}),
    });
  });
  if (p.electricalParts === undefined && p.electrical) {
    add({ id: 'electrical', category: 'Electrical', kind: 'misc', name: 'Electrical parts', unit: 'lot', qty: 1, unitPrice: p.electrical });
  }

  if (p.freight !== undefined) {
    add({
      id: 'freight',
      category: 'Freight & logistics',
      kind: 'freight',
      name: 'Container freight, share per panel',
      unit: 'panel',
      qty: panels,
      unitPrice: each(p.freight, panels, values.freightPerContainer / values.panelsPerContainer),
      basis: 'panel',
      perBasis: 1,
    });
  }
  add({ id: 'labour', category: 'Labour', kind: 'labor', name: 'Installation labour', unit: 'job', qty: 1, unitPrice: p.labor });
  if (p.netMetering !== undefined) {
    add({ id: 'net-metering', category: 'Permits & net metering', kind: 'permit', name: 'Net-metering application', unit: 'job', qty: 1, unitPrice: p.netMetering });
  }
  add({ id: 'misc', category: 'Misc', kind: 'misc', name: 'Miscellaneous', unit: 'job', qty: 1, unitPrice: p.misc });
  return items;
}

const sumKind = (items: JobItem[], kind: JobItemKind) =>
  items.filter((i) => i.kind === kind).reduce((s, i) => s + i.qty, 0);

/** Panels, inverters and the rest as the job's items now stand. */
export function jobCounts(items: JobItem[], settings: JobSettings) {
  const panels = sumKind(items, 'panel');
  const inverters = sumKind(items, 'inverter');
  const strings = settings.panelsPerString > 0 ? Math.ceil(panels / settings.panelsPerString) : 0;
  return {
    panels,
    inverters,
    batteries: sumKind(items, 'battery'),
    strings,
    pvCableRolls: sumKind(items, 'pvCable'),
    basis: { job: 1, inverter: inverters, string: strings, panel: panels } as Record<PartBasis, number>,
  };
}

export const itemTotal = (i: JobItem) => i.qty * i.unitPrice;
export const jobTotal = (items: JobItem[]) => items.reduce((s, i) => s + itemTotal(i), 0);

/** Items grouped by category, in JOB_CATEGORIES order, then custom categories A–Z. */
export function byCategory(items: JobItem[]): { category: string; items: JobItem[]; total: number }[] {
  const groups = new Map<string, JobItem[]>();
  for (const item of items) groups.set(item.category, [...(groups.get(item.category) ?? []), item]);
  const order = (c: string) => {
    const i = (JOB_CATEGORIES as readonly string[]).indexOf(c);
    return i === -1 ? JOB_CATEGORIES.length : i;
  };
  return [...groups.entries()]
    .sort(([a], [b]) => order(a) - order(b) || a.localeCompare(b))
    .map(([category, list]) => ({ category, items: list, total: jobTotal(list) }));
}

/** What a scaling item needs for the job's current panel and inverter counts; null if it doesn't scale. */
export function requiredQty(item: JobItem, items: JobItem[], settings: JobSettings): number | null {
  const c = jobCounts(items, settings);
  if (item.kind === 'pvCable') {
    return settings.pvCableRollMeters > 0
      ? Math.ceil((c.strings * settings.pvCableMetersPerString) / settings.pvCableRollMeters - 1e-9)
      : null;
  }
  if (!item.basis || item.perBasis === undefined) return null;
  return Math.ceil(item.perBasis * c.basis[item.basis] - 1e-9);
}

/** Sets every scaling item to what the current panel and inverter counts need. */
export function fitToCounts(items: JobItem[], settings: JobSettings): JobItem[] {
  return items.map((item) => {
    const need = requiredQty(item, items, settings);
    return need === null ? item : { ...item, qty: need };
  });
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const fmt = (n: number) => String(Number(n.toFixed(2)));

/** Problems with the job as edited. Shown, never enforced. */
export function jobWarnings(items: JobItem[], settings: JobSettings, systemType: SystemType): string[] {
  const c = jobCounts(items, settings);
  const out: string[] = [];

  if (c.panels > 0 && c.inverters === 0) out.push(`${plural(c.panels, 'panel')} but no inverter.`);
  if (c.inverters > 0 && settings.inverterMaxPanels > 0 && c.panels > c.inverters * settings.inverterMaxPanels) {
    const need = Math.ceil(c.panels / settings.inverterMaxPanels);
    out.push(
      `${plural(c.panels, 'panel')} need ${plural(need, 'inverter')} at ${settings.inverterMaxPanels} panels each; ` +
        `the job has ${c.inverters}.`,
    );
  }
  if (c.inverters > 0 && settings.inverterKw > 0) {
    const ratio = (c.panels * settings.panelWatts) / 1000 / (c.inverters * settings.inverterKw);
    if (ratio > settings.maxDcAcRatio) {
      out.push(`DC/AC ratio is ${fmt(ratio)}, above the ${fmt(settings.maxDcAcRatio)} limit; the inverters will clip.`);
    }
  }
  if (settings.panelsPerString > 0 && c.panels > 0 && c.panels % settings.panelsPerString !== 0) {
    out.push(
      `${plural(c.panels, 'panel')} don't split evenly into strings of ${settings.panelsPerString}; ` +
        `the last string has ${c.panels % settings.panelsPerString}.`,
    );
  }
  if (systemType === 'grid-tie' && c.batteries > 0) {
    out.push(`${plural(c.batteries, 'battery')} on a grid-tie job; grid-tie inverters can't charge them.`);
  }
  if (systemType === 'hybrid' && c.batteries === 0) out.push('A hybrid job with no batteries.');

  // Parts that scale with the system, in one line: after a panel change most of them move together.
  const short = items.flatMap((item) => {
    const need = requiredQty(item, items, settings);
    return need !== null && item.qty < need ? [`${item.name} (${fmt(item.qty)} of ${need})`] : [];
  });
  if (short.length) {
    out.push(
      `${plural(short.length, 'part')} ${short.length === 1 ? 'is' : 'are'} short for ${plural(c.panels, 'panel')} and ` +
        `${plural(c.inverters, 'inverter')}: ${short.join(', ')}. “Match parts to panels & inverters” tops them up.`,
    );
  }
  return out;
}

/** An id for an item added by hand that no other item has. */
export function newItemId(items: JobItem[]): string {
  let n = items.length + 1;
  while (items.some((i) => i.id === `custom-${n}`)) n += 1;
  return `custom-${n}`;
}
