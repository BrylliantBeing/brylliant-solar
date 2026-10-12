import type { Layout, LayoutInverter, StringDef } from '@calculator/pvDesign';
import { INVERTERS } from '@calculator/pvDesignData';

/** A design's layout with its strings, as stored in designs.layout_json. */
export type DesignLayout = Layout & { strings: StringDef[] };

export const STRING_COLORS = ['#E7A93C', '#4FA3C0', '#D9714E', '#8DBE6C', '#B58BD6', '#E5D25B', '#5BC0A8', '#E07BA6'];

export const stringColor = (strings: StringDef[], id: string | null) =>
  id === null ? '#9AA5A0' : STRING_COLORS[Math.max(0, strings.findIndex((s) => s.id === id)) % STRING_COLORS.length];

const STRING_IDS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Strings for a pattern like [8, 7, 7]: each inverter's MPPT inputs fill in order, then the next inverter. */
export function stringsForPattern(pattern: number[], inverters: LayoutInverter[]): StringDef[] {
  const slots: { inverterId: string; mppt: number }[] = [];
  for (const inv of inverters) {
    const spec = INVERTERS.find((x) => x.model === inv.model) ?? INVERTERS[0];
    spec.mppts.forEach((m, i) => {
      for (let k = 0; k < m.inputs; k += 1) slots.push({ inverterId: inv.id, mppt: i });
    });
  }
  const last = slots[slots.length - 1] ?? { inverterId: inverters[0]?.id ?? '', mppt: 0 };
  return pattern.map((_, i) => ({ id: STRING_IDS[i] ?? `S${i + 1}`, ...(slots[i] ?? last) }));
}
