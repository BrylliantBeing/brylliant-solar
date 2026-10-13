import type { BomLine } from '@calculator/pvDesign';

import type { JobItem, JobItemKind } from '@/lib/job-items';
import { priceFor, priceKeyOf, type PriceOverrides } from '@/lib/price-list';

/** The quote's lump-sum lines that a design's itemised list replaces. */
const REPLACED_IDS = new Set(['mounting', 'pv-cable', 'mounting-cabling']);

/**
 * PV cable comes in as a plain part: the job's own pvCable check estimates
 * metres per string, and the design has measured them.
 */
const kindFor = (line: BomLine): JobItemKind =>
  line.id === 'panels'
    ? 'panel'
    : line.id.startsWith('inverter-')
      ? 'inverter'
      : ['rail', 'rail-splice', 'l-foot', 'mid-clamp', 'end-clamp'].includes(line.id)
        ? 'mounting'
        : 'part';

/**
 * A job's items with the design's materials in. Panels and inverters update the
 * job's own lines (keeping their prices); everything else replaces the last
 * design's lines and the quote's lump sums. A line applied before keeps the
 * price typed against it; new ones take the price list's, or ₱0 when the
 * price list has none.
 */
export function applyDesignToJob(
  items: JobItem[],
  bom: BomLine[],
  prices: PriceOverrides = {},
): { items: JobItem[]; unpriced: number } {
  const previous = new Map(items.filter((i) => i.id.startsWith('design-')).map((i) => [i.id, i]));
  let out = items.filter((i) => !i.id.startsWith('design-') && !REPLACED_IDS.has(i.id));
  let unpriced = 0;

  for (const line of bom) {
    const kind = kindFor(line);
    if (kind === 'panel' || kind === 'inverter') {
      const own = out.find((i) => i.kind === kind);
      if (own) {
        out = out.map((i) => (i === own ? { ...i, qty: line.qty } : i));
        continue;
      }
    }
    const id = `design-${line.id}`;
    const unitPrice = previous.get(id)?.unitPrice ?? priceFor(priceKeyOf(line), prices) ?? 0;
    if (unitPrice === 0) unpriced += 1;
    out.push({
      id,
      category: line.category,
      kind,
      name: line.name,
      unit: line.unit,
      qty: line.qty,
      unitPrice,
      defaultQty: line.qty,
      defaultUnitPrice: null,
    });
  }
  return { items: out, unpriced };
}
