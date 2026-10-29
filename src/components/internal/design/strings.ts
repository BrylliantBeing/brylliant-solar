import type { Layout, StringDef } from '@calculator/pvDesign';

/** A design's layout with its strings, as stored in designs.layout_json. */
export type DesignLayout = Layout & { strings: StringDef[] };

export const STRING_COLORS = ['#E7A93C', '#4FA3C0', '#D9714E', '#8DBE6C', '#B58BD6', '#E5D25B', '#5BC0A8', '#E07BA6'];

export const stringColor = (strings: StringDef[], id: string | null) =>
  id === null ? '#9AA5A0' : STRING_COLORS[Math.max(0, strings.findIndex((s) => s.id === id)) % STRING_COLORS.length];
