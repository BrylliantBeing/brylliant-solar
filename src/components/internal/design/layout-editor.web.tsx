import {
  assignStrings,
  autoRotation,
  compass,
  downslope,
  faceAt,
  fillFace,
  noonSun,
  panelArray,
  panelSize,
  projection,
  refitFace,
  stringPlan,
  type LayoutPanel,
  type LayoutPoint,
  type Orientation,
  type RoofFace,
  type StringDef,
} from '@calculator/pvDesign';
import { INVERTERS, type PanelSpec } from '@calculator/pvDesignData';
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ImageryCredit } from './imagery-credit';
import { stringColor, type DesignLayout } from './strings';

import { SmallButton } from '@/components/internal/quote-parts';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { metresPerPixel, siteBox, siteCenter, siteTiles } from '@/lib/design-geo';
import { loadImagery, type Imagery } from '@/lib/imagery';
import type { DesignSite } from '@/lib/designs-api';

type Tool = 'select' | 'roof' | 'array' | 'string' | 'inverter' | 'meter' | 'panelboard' | 'measure';

const TOOLS: { tool: Tool; label: string; hint: string }[] = [
  {
    tool: 'select',
    label: 'Select / move',
    hint: 'Click a panel to select it, shift-click to add, double-click for its whole array. Drag to move; drag empty space to pan; scroll to zoom.',
  },
  {
    tool: 'roof',
    label: 'Roof face',
    hint: 'Click each corner of one sloped roof face, then double-click or press Enter to finish (Esc cancels). Then set its pitch and which way it slopes down. Flat roofs need no face.',
  },
  {
    tool: 'array',
    label: 'Add panels',
    hint: 'Set rows, columns and rotation below, then click where the middle of the array goes. On a roof face, rows follow the eave and panels are drawn as seen from above. Or Autoplace: fill the roof faces, sunniest first.',
  },
  {
    tool: 'string',
    label: 'Paint string',
    hint: 'Pick a string below, then click panels in wiring order. The first and last panel are where the home runs land.',
  },
  {
    tool: 'inverter',
    label: 'Inverter',
    hint: 'Click where the inverter is mounted.',
  },
  {
    tool: 'meter',
    label: 'ZAMCELCO meter',
    hint: 'Click where the bi-directional meter is (or will be).',
  },
  {
    tool: 'panelboard',
    label: 'Panel board',
    hint: 'Click the existing panel board, where the PV breaker lands.',
  },
  {
    tool: 'measure',
    label: 'Calibrate',
    hint: 'Click both ends of something you know the length of (a wall, a gate); then type its real length.',
  },
];

const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';

const SHORTCUTS: [string, string][] = [
  [`${MOD} Z  /  ${MOD} Shift Z, ${MOD} Y`, 'Undo / redo'],
  ['Delete, Backspace', 'Remove the selected panels, roof face, inverter, meter or panel board'],
  [`${MOD} A`, 'Select every panel'],
  [`${MOD} C  /  ${MOD} X  /  ${MOD} V`, 'Copy / cut / paste panels (pastes 1 m down-right, unstrung)'],
  [`${MOD} D`, 'Duplicate the selected panels'],
  ['Arrows  /  Shift arrows', 'Move the selection 10 cm / 1 m'],
  ['R  /  Shift R', 'Rotate the selected panels 90° clockwise / anticlockwise'],
  ['[  /  ]', 'Rotate the selected panels 5°'],
  ['Enter', 'Finish the roof face being drawn'],
  ['Esc', 'Cancel drawing, clear the selection and go back to Select'],
  ['V  F  A  S  I  M  B', 'Tools: select, roof face, add panels, paint string, inverter, meter, panel board'],
];

const FACINGS = [0, 45, 90, 135, 180, 225, 270, 315];
const ROOF_IDS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

const centroid = (pts: LayoutPoint[]) => ({
  x: pts.reduce((a, v) => a + v.x, 0) / pts.length,
  y: pts.reduce((a, v) => a + v.y, 0) / pts.length,
});

/** Compass bearing of a plan direction (x east, y south). */
const bearing = (v: LayoutPoint) => ((Math.atan2(v.x, -v.y) * 180) / Math.PI + 360) % 360;

/** The face edge nearest a point, and the bearing pointing out of the face across it: the eave's facing. */
function outwardAcrossNearestEdge(f: RoofFace, p: LayoutPoint): number {
  const c = centroid(f.points);
  let best = { d: Infinity, az: f.azimuthDeg };
  f.points.forEach((a, i) => {
    const b = f.points[(i + 1) % f.points.length];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const len2 = ex * ex + ey * ey || 1;
    const k = Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / len2));
    const d = Math.hypot(p.x - (a.x + k * ex), p.y - (a.y + k * ey));
    if (d >= best.d) return;
    let n = { x: ey, y: -ex };
    const mid = { x: a.x + ex / 2, y: a.y + ey / 2 };
    if (n.x * (mid.x - c.x) + n.y * (mid.y - c.y) < 0) n = { x: -n.x, y: -n.y };
    best = { d, az: Math.round(bearing(n)) % 360 };
  });
  return best.az;
}

/** Only ever read from event handlers (undo grouping), never while rendering. */
const clock = () => Date.now();

const nextId = (prefix: string, taken: string[]) => {
  let n = 1;
  while (taken.includes(`${prefix}${n}`)) n += 1;
  return `${prefix}${n}`;
};

export function LayoutEditor({
  site,
  layout,
  panel,
  patterns,
  onChange,
  onPatternsChange,
  onSiteChange,
}: {
  site: DesignSite;
  layout: DesignLayout;
  panel: PanelSpec;
  patterns: Record<string, number[]>;
  onChange: (layout: DesignLayout) => void;
  onPatternsChange: (patterns: Record<string, number[]>) => void;
  onSiteChange: (site: DesignSite) => void;
}) {
  const t = useTheme();
  const svg = useRef<SVGSVGElement | null>(null);
  const box = useMemo(() => siteBox(site), [site]);
  const center = siteCenter(site);
  /**
   * The provider's deepest real imagery at the site, not site.zoom: that was
   * fixed when the rectangle was drawn, possibly under another provider.
   */
  const [bg, setBg] = useState<{
    imagery: Imagery;
    zoom: number;
    credit: string;
  } | null>(null);
  useEffect(() => {
    let live = true;
    loadImagery().then(async (imagery) => {
      const zoom = await imagery.maxZoom(center.lat, center.lng);
      const credit = await imagery.copyright(
        {
          north: site.north,
          south: site.south,
          east: site.east,
          west: site.west,
        },
        zoom,
      );
      if (live) setBg({ imagery, zoom, credit });
    });
    return () => {
      live = false;
    };
  }, [center.lat, center.lng, site.north, site.south, site.east, site.west]);
  const tileZoom = bg?.zoom ?? 18;
  const tiles = useMemo(() => (bg ? siteTiles({ ...site, zoom: bg.zoom }, bg.imagery.template) : []), [site, bg]);
  const [view, setView] = useState(() => ({
    x: box.x - 4,
    y: box.y - 4,
    w: box.w + 8,
    h: box.h + 8,
  }));
  const [tool, setTool] = useState<Tool>('select');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** A selected inverter id, 'meter' or 'panelboard'; panels and equipment are never selected together */
  const [thing, setThing] = useState<string | null>(null);
  const [showKeys, setShowKeys] = useState(false);
  /** Corners of the roof face being drawn */
  const [draft, setDraft] = useState<LayoutPoint[] | null>(null);
  const [hover, setHover] = useState<LayoutPoint | null>(null);
  /** Waiting for a click on the selected face's eave */
  const [eavePick, setEavePick] = useState(false);
  const roofs = layout.roofs ?? [];
  const selectedFace = thing?.startsWith('roof:') ? (roofs.find((f) => `roof:${f.id}` === thing) ?? null) : null;
  const [paint, setPaint] = useState<string | null>(layout.strings[0]?.id ?? null);
  const [arr, setArr] = useState({
    rows: '2',
    cols: '11',
    orientation: 'portrait' as Orientation,
    rot: 'auto',
    gap: '0.02',
    rowGap: '0.3',
  });
  /** Autoplace: edge setback on the roof, and how many panels (blank = fill every face) */
  const [fill, setFill] = useState({ setback: '0.3', count: '' });
  const [note, setNote] = useState<string | null>(null);
  /** Pattern fields being typed, by inverter model */
  const [patternText, setPatternText] = useState<Record<string, string>>({});
  const models = [...new Set(layout.inverters.map((i) => i.model))];
  const specOf = (model: string) => INVERTERS.find((m) => m.model === model) ?? INVERTERS[0];
  const textFor = (model: string) => patternText[model] ?? (patterns[model] ?? specOf(model).idealPattern ?? []).join(', ');
  const [measure, setMeasure] = useState<{
    a: { x: number; y: number };
    b?: { x: number; y: number };
  } | null>(null);
  const [realLength, setRealLength] = useState('');
  const drag = useRef<
    | { kind: 'pan'; sx: number; sy: number; view: typeof view }
    | {
        kind: 'panels';
        start: { x: number; y: number };
        orig: Map<string, { x: number; y: number }>;
      }
    | {
        kind: 'thing';
        what: 'meter' | 'panelboard' | string;
        start: { x: number; y: number };
        orig: { x: number; y: number };
      }
    | { kind: 'vertex'; faceId: string; index: number; start: LayoutPoint; orig: LayoutPoint }
    | null
  >(null);

  /** Pointer position in plan metres. */
  function at(e: { clientX: number; clientY: number }) {
    const el = svg.current;
    const ctm = el?.getScreenCTM();
    if (!el || !ctm) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }

  /* ---------------- history */

  /**
   * Undo keeps whole layouts. Edits sharing a group collapse into one step: a
   * drag is one step however many moves it makes, and arrow-key nudges or
   * typing in a field merge while they come less than a second apart.
   */
  const past = useRef<DesignLayout[]>([]);
  const future = useRef<DesignLayout[]>([]);
  const lastEdit = useRef<{ group: string; at: number } | null>(null);
  const [depth, setDepth] = useState({ undo: 0, redo: 0 });
  const gesture = useRef(0);

  function commit(next: DesignLayout, group?: string) {
    const now = clock();
    const last = lastEdit.current;
    const merge = !!group && last?.group === group && (group.startsWith('drag-') || now - last.at < 1000);
    if (!merge) {
      past.current = [...past.current, layout].slice(-100);
      future.current = [];
    }
    lastEdit.current = group ? { group, at: now } : null;
    setDepth({ undo: past.current.length, redo: 0 });
    onChange(next);
  }

  const update = (patch: Partial<DesignLayout>, group?: string) => commit({ ...layout, ...patch }, group);

  /** Keeps the selection to panels and equipment that still exist after an undo or redo. */
  function restore(next: DesignLayout) {
    lastEdit.current = null;
    setSelected((sel) => new Set([...sel].filter((id) => next.panels.some((p) => p.id === id))));
    setThing((th) =>
      th &&
      (th.startsWith('roof:')
        ? (next.roofs ?? []).some((f) => `roof:${f.id}` === th)
        : th === 'meter'
          ? next.meter
          : th === 'panelboard'
            ? next.panelboard
            : next.inverters.some((i) => i.id === th))
        ? th
        : null,
    );
    onChange(next);
  }

  function undo() {
    const prev = past.current[past.current.length - 1];
    if (!prev) return;
    past.current = past.current.slice(0, -1);
    future.current = [...future.current, layout];
    setDepth({ undo: past.current.length, redo: future.current.length });
    restore(prev);
  }

  function redo() {
    const next = future.current[future.current.length - 1];
    if (!next) return;
    future.current = future.current.slice(0, -1);
    past.current = [...past.current, layout];
    setDepth({ undo: past.current.length, redo: future.current.length });
    restore(next);
  }

  /* ---------------- roof faces */

  /** Changes a face, keeping the panels on it at their true spacing on the roof. */
  function setFace(id: string, patch: Partial<RoofFace>, group?: string) {
    const old = roofs.find((f) => f.id === id);
    if (!old) return;
    const next = { ...old, ...patch };
    const nextRoofs = roofs.map((f) => (f.id === id ? next : f));
    const reshaped = patch.pitchDeg !== undefined || patch.azimuthDeg !== undefined;
    update({ roofs: nextRoofs, panels: reshaped ? refitFace(layout.panels, roofs, old, next) : layout.panels }, group);
  }

  function finishFace(points: LayoutPoint[]) {
    setDraft(null);
    setHover(null);
    if (points.length < 3) return;
    const id = [...ROOF_IDS].find((c) => !roofs.some((f) => f.id === c)) ?? `R${roofs.length + 1}`;
    const face: RoofFace = { id, points, pitchDeg: 20, azimuthDeg: 180 };
    const nextRoofs = [...roofs, face];
    // Panels already there were laid flat; fold them onto the new face.
    update({ roofs: nextRoofs, panels: refitFace(layout.panels, nextRoofs, { ...face, pitchDeg: 0 }, face) });
    setThing(`roof:${id}`);
    setSelected(new Set());
    setTool('select');
  }

  function deleteFace(id: string) {
    const face = roofs.find((f) => f.id === id);
    if (!face) return;
    // Unfold its panels back to flat before the face goes.
    const panels = refitFace(layout.panels, roofs, face, { ...face, pitchDeg: 0 });
    update({ roofs: roofs.filter((f) => f.id !== id), panels });
    setThing(null);
  }

  /* ---------------- canvas events */

  function onBackgroundDown(e: ReactPointerEvent<SVGSVGElement>) {
    const p = at(e);
    const L = layout;
    if (eavePick && selectedFace) {
      setFace(selectedFace.id, { azimuthDeg: outwardAcrossNearestEdge(selectedFace, p) });
      setEavePick(false);
      return;
    }
    if (tool === 'roof') {
      if (e.detail >= 2 && draft && draft.length >= 3) finishFace(draft);
      else setDraft((d) => [...(d ?? []), p]);
      return;
    }
    if (tool === 'array') {
      const face = faceAt(L.roofs, p);
      const typed = Number(arr.rot);
      const rot = arr.rot.trim() !== '' && arr.rot !== 'auto' && Number.isFinite(typed) ? typed : face ? autoRotation(face) : 0;
      const prefix = nextId('a', [...new Set(L.panels.map((x) => x.rowId.split('-')[0]))]);
      const added = panelArray({
        panel,
        x: p.x,
        y: p.y,
        rows: Math.max(1, Math.round(Number(arr.rows) || 1)),
        cols: Math.max(1, Math.round(Number(arr.cols) || 1)),
        orientation: arr.orientation,
        rot,
        gapM: Number(arr.gap) || 0,
        rowGapM: Number(arr.rowGap) || 0,
        idPrefix: prefix,
        face,
      });
      update({ panels: [...L.panels, ...added] });
      setSelected(new Set(added.map((x) => x.id)));
      setTool('select');
      return;
    }
    if (tool === 'inverter') {
      const id = nextId(
        'INV',
        L.inverters.map((i) => i.id),
      );
      update({
        inverters: [...L.inverters, { id, model: INVERTERS[0].model, x: p.x, y: p.y, floor: 1 }],
      });
      setTool('select');
      return;
    }
    if (tool === 'meter' || tool === 'panelboard') {
      update({ [tool]: p });
      setTool('select');
      return;
    }
    if (tool === 'measure') {
      setMeasure((m) => (!m || m.b ? { a: p } : { ...m, b: p }));
      return;
    }
    if (tool === 'select') {
      if (!e.shiftKey) setSelected(new Set());
      setThing(null);
      drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, view };
      svg.current?.setPointerCapture(e.pointerId);
    }
  }

  function onPanelDown(e: ReactPointerEvent<SVGGElement>, p: LayoutPanel) {
    // Drawing a face, placing things or picking an eave: the click is for the canvas underneath.
    if ((tool !== 'select' && tool !== 'string') || eavePick) return;
    e.stopPropagation();
    const L = layout;
    if (tool === 'string') {
      if (!paint) return;
      // Re-painting moves the panel to the end of the string's order.
      const others = L.panels.filter((x) => x.id !== p.id);
      const same = p.stringId === paint;
      update({ panels: [...others, { ...p, stringId: same ? null : paint }] });
      return;
    }
    if (tool !== 'select') return;
    let next = selected;
    if (e.detail === 2) {
      const prefix = p.rowId.split('-')[0];
      next = new Set(L.panels.filter((x) => x.rowId.split('-')[0] === prefix).map((x) => x.id));
    } else if (e.shiftKey) {
      next = new Set(selected);
      if (next.has(p.id)) next.delete(p.id);
      else next.add(p.id);
    } else if (!selected.has(p.id)) {
      next = new Set([p.id]);
    }
    setSelected(next);
    setThing(null);
    gesture.current += 1;
    drag.current = {
      kind: 'panels',
      start: at(e),
      orig: new Map(L.panels.filter((x) => next.has(x.id)).map((x) => [x.id, { x: x.x, y: x.y }])),
    };
    svg.current?.setPointerCapture(e.pointerId);
  }

  function onThingDown(e: ReactPointerEvent<SVGGElement>, what: string, pos: { x: number; y: number }) {
    if (tool !== 'select') return;
    e.stopPropagation();
    setThing(what);
    setSelected(new Set());
    gesture.current += 1;
    drag.current = { kind: 'thing', what, start: at(e), orig: pos };
    svg.current?.setPointerCapture(e.pointerId);
  }

  /** In Select, clicking a roof face selects it; dragging still pans. Other tools click straight through. */
  function onFaceDown(e: ReactPointerEvent<SVGPolygonElement>, f: RoofFace) {
    if (tool !== 'select' || eavePick) return;
    e.stopPropagation();
    setThing(`roof:${f.id}`);
    setSelected(new Set());
    drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, view };
    svg.current?.setPointerCapture(e.pointerId);
  }

  function onVertexDown(e: ReactPointerEvent<SVGCircleElement>, f: RoofFace, index: number) {
    e.stopPropagation();
    gesture.current += 1;
    drag.current = { kind: 'vertex', faceId: f.id, index, start: at(e), orig: f.points[index] };
    svg.current?.setPointerCapture(e.pointerId);
  }

  function onMove(e: ReactPointerEvent<SVGSVGElement>) {
    if (tool === 'roof' && draft) setHover(at(e));
    const d = drag.current;
    if (!d) return;
    const L = layout;
    if (d.kind === 'pan') {
      const el = svg.current;
      if (!el) return;
      const k = d.view.w / el.clientWidth;
      setView({
        ...d.view,
        x: d.view.x - (e.clientX - d.sx) * k,
        y: d.view.y - (e.clientY - d.sy) * k,
      });
      return;
    }
    const p = at(e);
    const dx = p.x - d.start.x;
    const dy = p.y - d.start.y;
    // Ignore the jitter of a plain click, so selecting doesn't count as a move.
    if (Math.hypot(dx, dy) < 0.02) return;
    const group = `drag-${gesture.current}`;
    if (d.kind === 'vertex') {
      // Reshaping the outline leaves the panels where they are.
      update(
        {
          roofs: roofs.map((f) =>
            f.id === d.faceId
              ? { ...f, points: f.points.map((v, i) => (i === d.index ? { x: d.orig.x + dx, y: d.orig.y + dy } : v)) }
              : f,
          ),
        },
        group,
      );
    } else if (d.kind === 'panels') {
      update(
        {
          panels: L.panels.map((x) =>
            d.orig.has(x.id) ? { ...x, x: d.orig.get(x.id)!.x + dx, y: d.orig.get(x.id)!.y + dy } : x,
          ),
        },
        group,
      );
    } else if (d.what === 'meter' || d.what === 'panelboard') {
      update({ [d.what]: { x: d.orig.x + dx, y: d.orig.y + dy } }, group);
    } else {
      update(
        {
          inverters: L.inverters.map((i) => (i.id === d.what ? { ...i, x: d.orig.x + dx, y: d.orig.y + dy } : i)),
        },
        group,
      );
    }
  }

  function onUp(e: ReactPointerEvent<SVGSVGElement>) {
    drag.current = null;
    if (svg.current?.hasPointerCapture(e.pointerId)) svg.current.releasePointerCapture(e.pointerId);
  }

  function onWheel(e: WheelEvent<SVGSVGElement>) {
    const p = at(e);
    const k = e.deltaY > 0 ? 1.15 : 1 / 1.15;
    setView((v) => {
      const w = Math.min(Math.max(v.w * k, 3), 400);
      const s = w / v.w;
      return {
        x: p.x - (p.x - v.x) * s,
        y: p.y - (p.y - v.y) * s,
        w,
        h: v.h * s,
      };
    });
  }

  /* ---------------- selection actions */

  function rotateSelected(deg: number) {
    const L = layout;
    const sel = L.panels.filter((x) => selected.has(x.id));
    if (!sel.length) return;
    const cx = sel.reduce((a, x) => a + x.x, 0) / sel.length;
    const cy = sel.reduce((a, x) => a + x.y, 0) / sel.length;
    const r = (deg * Math.PI) / 180;
    const cos = Math.cos(r);
    const sin = Math.sin(r);
    update({
      panels: L.panels.map((x) =>
        selected.has(x.id)
          ? {
              ...x,
              x: cx + (x.x - cx) * cos - (x.y - cy) * sin,
              y: cy + (x.x - cx) * sin + (x.y - cy) * cos,
              rot: (x.rot + deg + 360) % 360,
            }
          : x,
      ),
    });
  }

  function nudge(dx: number, dy: number) {
    const move = <T extends { x: number; y: number }>(q: T): T => ({ ...q, x: q.x + dx, y: q.y + dy });
    if (selectedFace)
      update({ roofs: roofs.map((f) => (f.id === selectedFace.id ? { ...f, points: f.points.map(move) } : f)) }, 'nudge');
    else if (thing === 'meter' && layout.meter) update({ meter: move(layout.meter) }, 'nudge');
    else if (thing === 'panelboard' && layout.panelboard) update({ panelboard: move(layout.panelboard) }, 'nudge');
    else if (thing) update({ inverters: layout.inverters.map((i) => (i.id === thing ? move(i) : i)) }, 'nudge');
    else if (selected.size) update({ panels: layout.panels.map((x) => (selected.has(x.id) ? move(x) : x)) }, 'nudge');
  }

  function deleteSelected() {
    if (selectedFace) {
      deleteFace(selectedFace.id);
      return;
    }
    if (thing) {
      if (thing === 'meter') update({ meter: null });
      else if (thing === 'panelboard') update({ panelboard: null });
      else update({ inverters: layout.inverters.filter((i) => i.id !== thing) });
      setThing(null);
      return;
    }
    if (!selected.size) return;
    update({ panels: layout.panels.filter((x) => !selected.has(x.id)) });
    setSelected(new Set());
  }

  /* ---------------- copy and paste */

  const clipboard = useRef<{ panels: LayoutPanel[]; pastes: number } | null>(null);

  function copySelected() {
    const panels = layout.panels.filter((x) => selected.has(x.id));
    if (panels.length) clipboard.current = { panels, pastes: 0 };
  }

  /** Pastes as a new array, 1 m down and right of the last copy, unstrung. */
  function paste() {
    const clip = clipboard.current;
    if (!clip) return;
    clip.pastes += 1;
    const off = clip.pastes;
    const prefix = nextId('a', [...new Set(layout.panels.map((x) => x.rowId.split('-')[0]))]);
    const rows = new Map<string, string>();
    const added = clip.panels.map((p, i) => {
      if (!rows.has(p.rowId)) rows.set(p.rowId, `${prefix}-${rows.size}`);
      return { ...p, id: `${prefix}-p${i}`, rowId: rows.get(p.rowId)!, x: p.x + off, y: p.y + off, stringId: null };
    });
    update({ panels: [...layout.panels, ...added] });
    setSelected(new Set(added.map((x) => x.id)));
    setThing(null);
  }

  /* ---------------- keyboard */

  const onKeyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    onKeyRef.current = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      // Typing in a field keeps the browser's own undo, delete and select-all.
      if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      let handled = true;
      if (mod && key === 'z' && !e.shiftKey) undo();
      else if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) redo();
      else if (mod && key === 'a') {
        setSelected(new Set(layout.panels.map((x) => x.id)));
        setThing(null);
        setTool('select');
      } else if (mod && (key === 'c' || key === 'x') && !selected.size)
        handled = false; // leave text copying alone
      else if (mod && key === 'c') copySelected();
      else if (mod && key === 'x') {
        copySelected();
        deleteSelected();
      } else if (mod && key === 'v') paste();
      else if (mod && key === 'd' && selected.size) {
        copySelected();
        paste();
      } else if (mod) handled = false;
      else if (key === 'enter' && draft) finishFace(draft);
      else if (key === 'delete' || key === 'backspace') deleteSelected();
      else if (key === 'escape') {
        setDraft(null);
        setHover(null);
        setEavePick(false);
        setSelected(new Set());
        setThing(null);
        setMeasure(null);
        setTool('select');
      } else if (key.startsWith('arrow') && (selected.size || thing)) {
        const step = e.shiftKey ? 1 : 0.1;
        const [dx, dy] = { arrowleft: [-step, 0], arrowright: [step, 0], arrowup: [0, -step], arrowdown: [0, step] }[key] ?? [
          0, 0,
        ];
        nudge(dx, dy);
      } else if (key === 'r') rotateSelected(e.shiftKey ? -90 : 90);
      else if (key === '[') rotateSelected(-5);
      else if (key === ']') rotateSelected(5);
      else {
        const pick = (
          { v: 'select', f: 'roof', a: 'array', s: 'string', i: 'inverter', m: 'meter', b: 'panelboard' } as Record<string, Tool>
        )[key];
        if (pick && !e.altKey) {
          setTool(pick);
          setMeasure(null);
          setDraft(null);
        } else handled = false;
      }
      if (handled) e.preventDefault();
    };
  });
  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKeyRef.current(e);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  /** Numbers typed into a pattern field; empty for none. */
  const parsePattern = (text: string) =>
    text
      .split(/[,+\s]+/)
      .map((x) => Math.round(Number(x)))
      .filter((x) => x > 0);

  /** Strings from each inverter model's pattern, with every roof face kept to its own MPPTs. */
  function autoString() {
    const L = layout;
    const next = { ...patterns };
    for (const model of models) {
      const nums = parsePattern(textFor(model));
      if (nums.length && nums.join() !== specOf(model).idealPattern?.join()) next[model] = nums;
      else delete next[model];
    }
    setPatternText({});
    onPatternsChange(next);
    if (!L.inverters.length) {
      setNote('Place an inverter first; its model decides the strings.');
      return;
    }
    const slots = stringPlan(L.inverters, next, L.panels.length);
    commit({
      ...L,
      strings: slots.map(({ id, inverterId, mppt }) => ({ id, inverterId, mppt })),
      panels: assignStrings(L.panels, L.roofs, slots),
    });
    setNote(null);
    setPaint(slots[0]?.id ?? null);
  }

  /** Fills the given faces, best first, with the Add panels settings, up to the panel count if one is typed. */
  function autoplace(faces: RoofFace[]) {
    const L = layout;
    if (!faces.length) {
      setNote('Draw a roof face first: autoplace fills roof faces.');
      return;
    }
    const target = Math.round(Number(fill.count));
    let room = fill.count.trim() !== '' && target > 0 ? target : Infinity;
    const prefixes = [...new Set(L.panels.map((x) => x.rowId.split('-')[0]))];
    let panels = L.panels;
    const added: string[] = [];
    for (const face of [...faces].sort((a, b) => noonSun(b, center.lat) - noonSun(a, center.lat))) {
      if (room <= 0) break;
      const idPrefix = nextId('a', prefixes);
      prefixes.push(idPrefix);
      const placed = fillFace({
        panel,
        face,
        roofs,
        existing: panels,
        orientation: arr.orientation,
        gapM: Number(arr.gap) || 0,
        rowGapM: Number(arr.rowGap) || 0,
        setbackM: Math.max(0, Number(fill.setback) || 0),
        idPrefix,
        max: room,
      });
      panels = [...panels, ...placed];
      added.push(...placed.map((x) => x.id));
      room -= placed.length;
    }
    setNote(
      added.length
        ? `Placed ${added.length} panel${added.length === 1 ? '' : 's'}${Number.isFinite(room) && room > 0 ? `; ${room} more would not fit` : ''}.`
        : 'No room for another panel on that roof.',
    );
    if (!added.length) return;
    update({ panels });
    setSelected(new Set(added));
    setThing(null);
    setTool('select');
  }

  function setStringMppt(id: string, patch: Partial<StringDef>) {
    update({
      strings: layout.strings.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    });
  }

  const measured = measure?.b ? Math.hypot(measure.b.x - measure.a.x, measure.b.y - measure.a.y) : null;
  function applyCalibration() {
    const real = Number(realLength);
    if (!measured || !(real > 0)) return;
    onSiteChange({ ...site, scale: (site.scale * real) / measured });
    setMeasure(null);
    setRealLength('');
    setTool('select');
  }

  /* ---------------- drawing */

  const hint = TOOLS.find((x) => x.tool === tool)?.hint;
  const acEnd = layout.panelboard ?? layout.meter;
  const unit = view.w / 100; // ≈1% of the view, for strokes and labels
  const bar = [1, 2, 5, 10, 20, 50].find((m) => m > view.w / 8) ?? 50;

  const stringEnds = layout.strings.flatMap((s) => {
    const members = layout.panels.filter((p) => p.stringId === s.id);
    const inv = layout.inverters.find((i) => i.id === s.inverterId);
    if (!members.length || !inv) return [];
    return [members[0], members[members.length - 1]].map((p, k) => ({
      key: `${s.id}-${k}`,
      from: inv,
      to: p,
      color: stringColor(layout.strings, s.id),
    }));
  });

  return (
    <View style={{ gap: Spacing.two }}>
      <View style={styles.row}>
        {TOOLS.map((x) => (
          <Pressable
            key={x.tool}
            onPress={() => {
              setTool(x.tool);
              setMeasure(null);
              setDraft(null);
              setEavePick(false);
            }}
            style={[
              styles.tool,
              {
                borderColor: tool === x.tool ? t.accent : t.lineStrong,
                backgroundColor: tool === x.tool ? t.backgroundSelected : t.background,
              },
            ]}>
            <ThemedText type="small" themeColor={tool === x.tool ? 'text' : 'textSecondary'}>
              {x.label}
            </ThemedText>
          </Pressable>
        ))}
        <View style={{ flexGrow: 1 }} />
        <SmallButton label={`Undo${depth.undo ? ` (${depth.undo})` : ''}`} onPress={undo} />
        <SmallButton label="Redo" onPress={redo} />
        <SmallButton label={showKeys ? 'Hide shortcuts' : 'Shortcuts'} onPress={() => setShowKeys((v) => !v)} />
      </View>
      {showKeys ? (
        <View style={[styles.panel, { borderColor: t.line }]}>
          {SHORTCUTS.map(([keys, what]) => (
            <View key={keys} style={styles.row}>
              <ThemedText type="data" style={{ fontSize: 12, minWidth: 190 }}>
                {keys}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {what}
              </ThemedText>
            </View>
          ))}
        </View>
      ) : null}
      {hint ? (
        <ThemedText type="small" themeColor="textMuted">
          {hint}
        </ThemedText>
      ) : null}

      {tool === 'array' ? (
        <View style={styles.row}>
          <Field label="Rows" value={arr.rows} onChange={(v) => setArr({ ...arr, rows: v })} />
          <Field label="Columns" value={arr.cols} onChange={(v) => setArr({ ...arr, cols: v })} />
          <Field label="Rotation ° or auto" value={arr.rot} onChange={(v) => setArr({ ...arr, rot: v })} />
          <Field label="Gap m" value={arr.gap} onChange={(v) => setArr({ ...arr, gap: v })} />
          <Field label="Row gap m" value={arr.rowGap} onChange={(v) => setArr({ ...arr, rowGap: v })} />
          <SmallButton
            label={arr.orientation === 'portrait' ? 'Portrait' : 'Landscape'}
            onPress={() =>
              setArr({
                ...arr,
                orientation: arr.orientation === 'portrait' ? 'landscape' : 'portrait',
              })
            }
          />
          <View style={{ width: 1, alignSelf: 'stretch', backgroundColor: t.line }} />
          <Field label="Edge setback m" value={fill.setback} onChange={(v) => setFill({ ...fill, setback: v })} />
          <Field label="Panels (blank = fill)" value={fill.count} onChange={(v) => setFill({ ...fill, count: v })} width={120} />
          <SmallButton label="Autoplace on roof faces" onPress={() => autoplace(roofs)} strong />
        </View>
      ) : null}
      {note ? (
        <ThemedText type="small" themeColor="textSecondary">
          {note}
        </ThemedText>
      ) : null}

      {tool === 'select' && selectedFace ? (
        <View style={[styles.panel, { borderColor: t.line }]}>
          <View style={styles.row}>
            <ThemedText type="smallBold">Roof {selectedFace.id}</ThemedText>
            <Field
              label="Pitch °"
              value={String(selectedFace.pitchDeg)}
              onChange={(v) => {
                const n = Number(v);
                if (v.trim() !== '' && Number.isFinite(n) && n >= 0 && n <= 75)
                  setFace(selectedFace.id, { pitchDeg: n }, `face-pitch-${selectedFace.id}`);
              }}
              onCommit={(v) => {
                const n = Number(v);
                if (v.trim() !== '' && Number.isFinite(n))
                  setFace(selectedFace.id, { pitchDeg: Math.min(75, Math.max(0, n)) }, `face-pitch-${selectedFace.id}`);
              }}
            />
            <View style={{ gap: 2 }}>
              <ThemedText type="eyebrow" themeColor="textMuted" style={{ fontSize: 10 }}>
                Slopes down to
              </ThemedText>
              <Choice
                options={[
                  ...FACINGS.map((d) => ({ value: String(d), label: `${compass(d)} (${d}°)` })),
                  ...(FACINGS.includes(selectedFace.azimuthDeg)
                    ? []
                    : [{ value: String(selectedFace.azimuthDeg), label: `${selectedFace.azimuthDeg}°` }]),
                ]}
                value={String(selectedFace.azimuthDeg)}
                onChange={(v) => setFace(selectedFace.id, { azimuthDeg: Number(v) })}
              />
            </View>
            <SmallButton
              label={eavePick ? 'Click the eave…' : 'Pick the eave'}
              onPress={() => setEavePick((v) => !v)}
              strong={eavePick}
            />
            <SmallButton label="Fill with panels" onPress={() => autoplace([selectedFace])} />
            <SmallButton label="Delete face" onPress={() => deleteFace(selectedFace.id)} />
          </View>
          <ThemedText type="small" themeColor="textMuted">
            {`Rises ${Math.round(Math.tan((selectedFace.pitchDeg * Math.PI) / 180) * 100)} cm per metre. Panels on it are drawn as seen from above: ${Math.round(Math.cos((selectedFace.pitchDeg * Math.PI) / 180) * 100)}% of their length down the slope. Drag the corner dots to fit the outline to the roof; arrows move the whole face.`}
          </ThemedText>
        </View>
      ) : null}

      {tool === 'select' && thing && !selectedFace ? (
        <View style={styles.row}>
          <ThemedText type="small" themeColor="textSecondary">
            {thing === 'meter' ? 'Meter' : thing === 'panelboard' ? 'Panel board' : thing} selected · arrows move it, Delete
            removes it
          </ThemedText>
          <SmallButton label="Delete" onPress={deleteSelected} />
        </View>
      ) : null}

      {tool === 'select' && selected.size ? (
        <View style={styles.row}>
          <ThemedText type="small" themeColor="textSecondary">
            {selected.size} selected
          </ThemedText>
          <SmallButton label="↺ 5°" onPress={() => rotateSelected(-5)} />
          <SmallButton label="↻ 5°" onPress={() => rotateSelected(5)} />
          <SmallButton label="↻ 90°" onPress={() => rotateSelected(90)} />
          <SmallButton label="← 10 cm" onPress={() => nudge(-0.1, 0)} />
          <SmallButton label="→ 10 cm" onPress={() => nudge(0.1, 0)} />
          <SmallButton label="↑ 10 cm" onPress={() => nudge(0, -0.1)} />
          <SmallButton label="↓ 10 cm" onPress={() => nudge(0, 0.1)} />
          <SmallButton label="Delete" onPress={deleteSelected} />
        </View>
      ) : null}

      {tool === 'measure' ? (
        <View style={styles.row}>
          <ThemedText type="small" themeColor="textSecondary">
            {measured === null ? 'Click two points on the map.' : `Measured ${measured.toFixed(2)} m on the imagery.`}
          </ThemedText>
          {measured !== null ? (
            <>
              <Field label="Real length m" value={realLength} onChange={setRealLength} />
              <SmallButton label="Rescale imagery" onPress={applyCalibration} strong />
            </>
          ) : null}
          {site.scale !== 1 ? <SmallButton label="Reset scale" onPress={() => onSiteChange({ ...site, scale: 1 })} /> : null}
        </View>
      ) : null}

      <View style={{ position: 'relative' }}>
        <svg
          ref={svg}
          viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
          preserveAspectRatio="xMidYMid meet"
          onPointerDown={onBackgroundDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onWheel={onWheel}
          style={{
            width: '100%',
            height: 600,
            background: '#1b1f1c',
            borderRadius: Radius.md,
            touchAction: 'none',
            cursor: tool === 'select' && !eavePick ? 'grab' : 'crosshair',
            userSelect: 'none',
          }}>
          {tiles.map((tile) => (
            <image
              key={tile.url}
              href={tile.url}
              x={tile.x}
              y={tile.y}
              width={tile.w}
              height={tile.h}
              preserveAspectRatio="none"
            />
          ))}
          <rect
            x={box.x}
            y={box.y}
            width={box.w}
            height={box.h}
            fill="none"
            stroke="#E7A93C"
            strokeWidth={unit * 0.25}
            strokeDasharray={`${unit} ${unit}`}
          />

          {roofs.map((f) => {
            const sel = selectedFace?.id === f.id;
            return (
              <g key={`roof-${f.id}`}>
                <polygon
                  points={f.points.map((v) => `${v.x},${v.y}`).join(' ')}
                  fill="#E7A93C"
                  fillOpacity={sel ? 0.18 : 0.08}
                  stroke={sel ? '#ffffff' : '#E7A93C'}
                  strokeWidth={unit * (sel ? 0.3 : 0.2)}
                  onPointerDown={(e) => onFaceDown(e, f)}
                />
              </g>
            );
          })}
          {draft ? (
            <g pointerEvents="none">
              <polyline
                points={[...draft, ...(hover ? [hover] : [])].map((v) => `${v.x},${v.y}`).join(' ')}
                fill="#E7A93C"
                fillOpacity={0.1}
                stroke="#E7A93C"
                strokeWidth={unit * 0.25}
                strokeDasharray={`${unit * 0.8} ${unit * 0.5}`}
              />
              {draft.map((v, i) => (
                <circle key={i} cx={v.x} cy={v.y} r={unit * 0.6} fill="#E7A93C" />
              ))}
            </g>
          ) : null}

          {/* Home runs and the AC run, as the engine measures them: along x, then y */}
          {stringEnds.map((r) => (
            <polyline
              key={r.key}
              points={`${r.from.x},${r.from.y} ${r.to.x},${r.from.y} ${r.to.x},${r.to.y}`}
              fill="none"
              stroke={r.color}
              strokeWidth={unit * 0.2}
              strokeDasharray={`${unit * 0.6} ${unit * 0.4}`}
              opacity={0.9}
            />
          ))}
          {acEnd
            ? layout.inverters.map((inv) => (
                <polyline
                  key={`ac-${inv.id}`}
                  points={`${inv.x},${inv.y} ${acEnd.x},${inv.y} ${acEnd.x},${acEnd.y}`}
                  fill="none"
                  stroke="#ffffff"
                  strokeWidth={unit * 0.25}
                  opacity={0.8}
                />
              ))
            : null}

          {layout.panels.map((p) => {
            const { w, h } = panelSize(panel, p.orientation);
            const color = stringColor(layout.strings, p.stringId);
            const order = p.stringId ? layout.panels.filter((x) => x.stringId === p.stringId).indexOf(p) + 1 : null;
            // As seen from above: squashed down the slope of the face it sits on.
            const m = projection(faceAt(roofs, p));
            return (
              <g key={p.id} onPointerDown={(e) => onPanelDown(e, p)} style={{ cursor: tool === 'string' ? 'copy' : 'move' }}>
                <g transform={`translate(${p.x} ${p.y}) matrix(${m.a} ${m.b} ${m.c} ${m.d} 0 0) rotate(${p.rot})`}>
                  <rect
                    x={-w / 2}
                    y={-h / 2}
                    width={w}
                    height={h}
                    fill="#13233a"
                    fillOpacity={0.85}
                    stroke={selected.has(p.id) ? '#ffffff' : color}
                    strokeWidth={selected.has(p.id) ? 0.08 : 0.05}
                  />
                  <line x1={-w / 2} y1={0} x2={w / 2} y2={0} stroke={color} strokeWidth={0.015} opacity={0.6} />
                </g>
                {p.stringId ? (
                  <text
                    x={p.x}
                    y={p.y + 0.12}
                    textAnchor="middle"
                    fontSize={0.34}
                    fill={color}
                    fontFamily="sans-serif"
                    fontWeight="bold"
                    pointerEvents="none">
                    {p.stringId}
                    {order}
                  </text>
                ) : null}
              </g>
            );
          })}

          {/* Slope arrows and labels over the panels */}
          {roofs.map((f) => {
            const c = centroid(f.points);
            const u = downslope(f);
            const len = unit * 4;
            return (
              <g key={`roof-label-${f.id}`} pointerEvents="none">
                <line
                  x1={c.x - (u.x * len) / 2}
                  y1={c.y - (u.y * len) / 2}
                  x2={c.x + (u.x * len) / 2}
                  y2={c.y + (u.y * len) / 2}
                  stroke="#E7A93C"
                  strokeWidth={unit * 0.3}
                  pointerEvents="none"
                />
                <path
                  d={`M ${c.x + (u.x * len) / 2} ${c.y + (u.y * len) / 2} l ${-u.x * unit * 1.2 - u.y * unit * 0.8} ${-u.y * unit * 1.2 + u.x * unit * 0.8} l ${u.y * unit * 1.6} ${-u.x * unit * 1.6} Z`}
                  fill="#E7A93C"
                  pointerEvents="none"
                />
                <text
                  x={c.x - u.x * (len / 2 + unit * 1.8)}
                  y={c.y - u.y * (len / 2 + unit * 1.8) + unit * 0.6}
                  textAnchor="middle"
                  fontSize={unit * 1.7}
                  fill="#fff"
                  stroke="#000"
                  strokeWidth={unit * 0.08}
                  paintOrder="stroke"
                  fontFamily="sans-serif"
                  fontWeight="bold"
                  pointerEvents="none">
                  {`${f.id} · ${f.pitchDeg}° · faces ${compass(f.azimuthDeg)}`}
                </text>
              </g>
            );
          })}
          {/* Corner handles of the selected face, above everything so a corner under a panel can still be dragged */}
          {selectedFace && tool === 'select'
            ? selectedFace.points.map((v, i) => (
                <circle
                  key={`vertex-${i}`}
                  cx={v.x}
                  cy={v.y}
                  r={unit * 0.7}
                  fill="#fff"
                  stroke="#000"
                  strokeWidth={unit * 0.15}
                  style={{ cursor: 'move' }}
                  onPointerDown={(e) => onVertexDown(e, selectedFace, i)}
                />
              ))
            : null}
          {layout.inverters.map((inv) => (
            <Marker
              key={inv.id}
              x={inv.x}
              y={inv.y}
              size={unit * 2.4}
              label={inv.id}
              fill="#E7A93C"
              selected={thing === inv.id}
              onDown={(e) => onThingDown(e, inv.id, inv)}
            />
          ))}
          {layout.meter ? (
            <Marker
              x={layout.meter.x}
              y={layout.meter.y}
              size={unit * 2.4}
              label="M"
              fill="#4FA3C0"
              round
              selected={thing === 'meter'}
              onDown={(e) => onThingDown(e, 'meter', layout.meter!)}
            />
          ) : null}
          {layout.panelboard ? (
            <Marker
              x={layout.panelboard.x}
              y={layout.panelboard.y}
              size={unit * 2.4}
              label="PB"
              fill="#8DBE6C"
              selected={thing === 'panelboard'}
              onDown={(e) => onThingDown(e, 'panelboard', layout.panelboard!)}
            />
          ) : null}

          {measure ? (
            <g>
              <circle cx={measure.a.x} cy={measure.a.y} r={unit * 0.5} fill="#ff4d4d" />
              {measure.b ? (
                <>
                  <line
                    x1={measure.a.x}
                    y1={measure.a.y}
                    x2={measure.b.x}
                    y2={measure.b.y}
                    stroke="#ff4d4d"
                    strokeWidth={unit * 0.3}
                  />
                  <circle cx={measure.b.x} cy={measure.b.y} r={unit * 0.5} fill="#ff4d4d" />
                </>
              ) : null}
            </g>
          ) : null}

          {/* Scale bar and north arrow, pinned to the view's corners */}
          <g transform={`translate(${view.x + view.w * 0.03} ${view.y + view.h * 0.95})`}>
            <rect
              x={-unit * 0.6}
              y={-unit * 3.2}
              width={bar + unit * 1.2}
              height={unit * 4}
              fill="#000"
              opacity={0.55}
              rx={unit * 0.4}
            />
            <line x1={0} y1={0} x2={bar} y2={0} stroke="#fff" strokeWidth={unit * 0.4} />
            <text x={bar / 2} y={-unit * 1} textAnchor="middle" fontSize={unit * 1.8} fill="#fff" fontFamily="sans-serif">
              {bar} m
            </text>
          </g>
          <g transform={`translate(${view.x + view.w * 0.96} ${view.y + view.h * 0.08})`}>
            <path
              d={`M0 ${-unit * 2.5} L${unit * 1.2} ${unit * 1.5} L0 ${unit * 0.6} L${-unit * 1.2} ${unit * 1.5} Z`}
              fill="#fff"
            />
            <text x={0} y={unit * 4} textAnchor="middle" fontSize={unit * 1.8} fill="#fff" fontFamily="sans-serif">
              N
            </text>
          </g>
        </svg>
        {bg ? <ImageryCredit provider={bg.imagery.provider} text={bg.credit} /> : null}
      </View>

      <ThemedText type="small" themeColor="textMuted">
        {`${bg?.imagery.provider === 'google' ? 'Google' : 'Esri'} imagery: zoom ${tileZoom}, about ${metresPerPixel(center.lat, tileZoom).toFixed(2)} m per pixel. Panels are drawn at true size; trust their outline over the photo's edges.`}
      </ThemedText>

      {/* Strings */}
      <View style={[styles.panel, { borderColor: t.line }]}>
        <View style={styles.row}>
          {models.map((model) => (
            <Field
              key={model}
              label={`${model.replace('HYXi ', '')} strings`}
              value={textFor(model)}
              onChange={(v) => setPatternText({ ...patternText, [model]: v })}
              width={140}
            />
          ))}
          <SmallButton label="Auto-assign by roof face" onPress={autoString} strong />
          <ThemedText type="small" themeColor="textMuted">
            {layout.panels.length} panels placed · {layout.panels.filter((p) => !p.stringId).length} unassigned
          </ThemedText>
        </View>
        {models.length ? (
          <ThemedText type="small" themeColor="textMuted">
            Panels per string for every inverter of that model, MPPT inputs in order; blank splits the panels evenly. Each roof face gets
            its own MPPTs where the pattern allows.
          </ThemedText>
        ) : null}
        {layout.strings.map((s) => {
          const count = layout.panels.filter((p) => p.stringId === s.id).length;
          return (
            <View key={s.id} style={styles.row}>
              <Pressable
                onPress={() => {
                  setPaint(s.id);
                  setTool('string');
                }}
                style={[
                  styles.swatch,
                  {
                    backgroundColor: stringColor(layout.strings, s.id),
                    borderColor: paint === s.id && tool === 'string' ? t.text : 'transparent',
                  },
                ]}>
                <ThemedText type="smallBold" style={{ color: '#12160F' }}>
                  {s.id}
                </ThemedText>
              </Pressable>
              <ThemedText type="small" style={{ minWidth: 80 }}>
                {count} panel{count === 1 ? '' : 's'}
              </ThemedText>
              <Choice
                options={layout.inverters.map((i) => ({
                  value: i.id,
                  label: i.id,
                }))}
                value={s.inverterId}
                onChange={(v) => setStringMppt(s.id, { inverterId: v })}
              />
              <Choice
                // As many trackers as the string's inverter has, and the current one even if it has fewer (flagged by the engine)
                options={Array.from(
                  {
                    length: Math.max(
                      (
                        INVERTERS.find((m) => m.model === layout.inverters.find((i) => i.id === s.inverterId)?.model) ??
                        INVERTERS[0]
                      ).mppts.length,
                      s.mppt + 1,
                    ),
                  },
                  (_, m) => ({ value: String(m), label: `MPPT${m + 1}` }),
                )}
                value={String(s.mppt)}
                onChange={(v) => setStringMppt(s.id, { mppt: Number(v) })}
              />
            </View>
          );
        })}
      </View>

      {/* Inverters and building */}
      <View style={[styles.panel, { borderColor: t.line }]}>
        <View style={styles.row}>
          <Field
            label="Floors"
            value={String(layout.floors)}
            onChange={(v) => update({ floors: Math.max(0, Math.round(Number(v) || 0)) }, 'field-floors')}
          />
          <Field
            label="Floor height m"
            value={String(layout.floorHeightM)}
            onChange={(v) => update({ floorHeightM: Math.max(0, Number(v) || 0) }, 'field-floor-height')}
          />
        </View>
        {layout.inverters.map((inv) => (
          <View key={inv.id} style={styles.row}>
            <ThemedText type="smallBold" style={{ minWidth: 48 }}>
              {inv.id}
            </ThemedText>
            <Choice
              options={INVERTERS.map((m) => ({
                value: m.model,
                label: m.model.replace('HYXi ', ''),
              }))}
              value={inv.model}
              onChange={(v) =>
                update({
                  inverters: layout.inverters.map((i) => (i.id === inv.id ? { ...i, model: v } : i)),
                })
              }
            />
            <Field
              label="On floor"
              value={String(inv.floor)}
              onChange={(v) =>
                update({
                  inverters: layout.inverters.map((i) =>
                    i.id === inv.id ? { ...i, floor: Math.max(1, Math.round(Number(v) || 1)) } : i,
                  ),
                })
              }
            />
            <SmallButton
              label="Remove"
              onPress={() =>
                update({
                  inverters: layout.inverters.filter((i) => i.id !== inv.id),
                })
              }
            />
          </View>
        ))}
        <View style={styles.row}>
          {layout.meter ? <SmallButton label="Remove meter" onPress={() => update({ meter: null })} /> : null}
          {layout.panelboard ? <SmallButton label="Remove panel board" onPress={() => update({ panelboard: null })} /> : null}
        </View>
      </View>
    </View>
  );
}

function Marker({
  x,
  y,
  size,
  label,
  fill,
  round,
  selected,
  onDown,
}: {
  x: number;
  y: number;
  size: number;
  label: string;
  fill: string;
  round?: boolean;
  selected?: boolean;
  onDown: (e: ReactPointerEvent<SVGGElement>) => void;
}) {
  const stroke = selected ? '#ffffff' : '#12160F';
  const width = size * (selected ? 0.14 : 0.06);
  return (
    <g transform={`translate(${x} ${y})`} onPointerDown={onDown} style={{ cursor: 'move' }}>
      {round ? (
        <circle r={size / 2} fill={fill} stroke={stroke} strokeWidth={width} />
      ) : (
        <rect
          x={-size / 2}
          y={-size / 2}
          width={size}
          height={size}
          fill={fill}
          stroke={stroke}
          strokeWidth={width}
          rx={size * 0.1}
        />
      )}
      <text
        y={size * 0.16}
        textAnchor="middle"
        fontSize={size * (label.length > 2 ? 0.3 : 0.45)}
        fill="#12160F"
        fontFamily="sans-serif"
        fontWeight="bold">
        {label}
      </text>
    </g>
  );
}

function Field({
  label,
  value,
  onChange,
  onCommit,
  width = 90,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  /** When set, the field keeps its own text while editing (so it can be blank) and hands it over on blur / Enter. */
  onCommit?: (v: string) => void;
  width?: number;
}) {
  const t = useTheme();
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    onCommit?.(draft);
    setDraft(null);
  };
  return (
    <View style={{ gap: 2 }}>
      <ThemedText type="eyebrow" themeColor="textMuted" style={{ fontSize: 10 }}>
        {label}
      </ThemedText>
      <TextInput
        value={draft ?? value}
        onChangeText={(v) => {
          if (onCommit) setDraft(v);
          onChange(v);
        }}
        onBlur={commit}
        onSubmitEditing={commit}
        style={[
          styles.input,
          {
            width,
            borderColor: t.lineStrong,
            color: t.text,
            backgroundColor: t.background,
          },
        ]}
      />
    </View>
  );
}

function Choice({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  const t = useTheme();
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        padding: '6px 8px',
        borderRadius: Radius.sm,
        border: `1px solid ${t.lineStrong}`,
        background: t.background,
        color: t.text,
        fontSize: 13,
      }}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing.two,
  },
  tool: {
    borderWidth: 1,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.three,
    paddingVertical: 6,
  },
  panel: {
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  swatch: {
    width: 32,
    height: 28,
    borderRadius: Radius.sm,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    borderWidth: 1,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.two,
    paddingVertical: 6,
  },
});
