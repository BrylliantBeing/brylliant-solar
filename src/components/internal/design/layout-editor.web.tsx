import { autoAssign, panelArray, panelSize, type LayoutPanel, type Orientation, type StringDef } from '@calculator/pvDesign';
import { INVERTERS, type PanelSpec } from '@calculator/pvDesignData';
import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { stringColor, stringsForPattern, type DesignLayout } from './strings';

import { SmallButton } from '@/components/internal/quote-parts';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { siteBox, siteTiles } from '@/lib/design-geo';
import type { DesignSite } from '@/lib/designs-api';

type Tool = 'select' | 'array' | 'string' | 'inverter' | 'meter' | 'panelboard' | 'measure';

const TOOLS: { tool: Tool; label: string; hint: string }[] = [
  { tool: 'select', label: 'Select / move', hint: 'Click a panel to select it, shift-click to add, double-click for its whole array. Drag to move; drag empty space to pan; scroll to zoom.' },
  { tool: 'array', label: 'Add panels', hint: 'Set rows, columns and rotation below, then click where the middle of the array goes.' },
  { tool: 'string', label: 'Paint string', hint: 'Pick a string below, then click panels in wiring order. The first and last panel are where the home runs land.' },
  { tool: 'inverter', label: 'Inverter', hint: 'Click where the inverter is mounted.' },
  { tool: 'meter', label: 'ZAMCELCO meter', hint: 'Click where the bi-directional meter is (or will be).' },
  { tool: 'panelboard', label: 'Panel board', hint: 'Click the existing panel board, where the PV breaker lands.' },
  { tool: 'measure', label: 'Calibrate', hint: 'Click both ends of something you know the length of (a wall, a gate); then type its real length.' },
];

const nextId = (prefix: string, taken: string[]) => {
  let n = 1;
  while (taken.includes(`${prefix}${n}`)) n += 1;
  return `${prefix}${n}`;
};

export function LayoutEditor({
  site,
  layout,
  panel,
  pattern,
  onChange,
  onPatternChange,
  onSiteChange,
}: {
  site: DesignSite;
  layout: DesignLayout;
  panel: PanelSpec;
  pattern: number[];
  onChange: (layout: DesignLayout) => void;
  onPatternChange: (pattern: number[]) => void;
  onSiteChange: (site: DesignSite) => void;
}) {
  const t = useTheme();
  const svg = useRef<SVGSVGElement | null>(null);
  const box = useMemo(() => siteBox(site), [site]);
  const tiles = useMemo(() => siteTiles(site), [site]);
  const [view, setView] = useState(() => ({ x: box.x - 4, y: box.y - 4, w: box.w + 8, h: box.h + 8 }));
  const [tool, setTool] = useState<Tool>('select');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [paint, setPaint] = useState<string | null>(layout.strings[0]?.id ?? null);
  const [arr, setArr] = useState({ rows: '2', cols: '11', orientation: 'portrait' as Orientation, rot: '0', gap: '0.02', rowGap: '0.3' });
  const [patternText, setPatternText] = useState(pattern.join(', '));
  const [measure, setMeasure] = useState<{ a: { x: number; y: number }; b?: { x: number; y: number } } | null>(null);
  const [realLength, setRealLength] = useState('');
  const drag = useRef<
    | { kind: 'pan'; sx: number; sy: number; view: typeof view }
    | { kind: 'panels'; start: { x: number; y: number }; orig: Map<string, { x: number; y: number }> }
    | { kind: 'thing'; what: 'meter' | 'panelboard' | string; start: { x: number; y: number }; orig: { x: number; y: number } }
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

  const update = (patch: Partial<DesignLayout>) => onChange({ ...layout, ...patch });

  /* ---------------- canvas events */

  function onBackgroundDown(e: ReactPointerEvent<SVGSVGElement>) {
    const p = at(e);
    const L = layout;
    if (tool === 'array') {
      const prefix = nextId('a', [...new Set(L.panels.map((x) => x.rowId.split('-')[0]))]);
      const added = panelArray({
        panel,
        x: p.x,
        y: p.y,
        rows: Math.max(1, Math.round(Number(arr.rows) || 1)),
        cols: Math.max(1, Math.round(Number(arr.cols) || 1)),
        orientation: arr.orientation,
        rot: Number(arr.rot) || 0,
        gapM: Number(arr.gap) || 0,
        rowGapM: Number(arr.rowGap) || 0,
        idPrefix: prefix,
      });
      update({ panels: [...L.panels, ...added] });
      setSelected(new Set(added.map((x) => x.id)));
      setTool('select');
      return;
    }
    if (tool === 'inverter') {
      const id = nextId('INV', L.inverters.map((i) => i.id));
      update({ inverters: [...L.inverters, { id, model: INVERTERS[0].model, x: p.x, y: p.y, floor: 1 }] });
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
      drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, view };
      svg.current?.setPointerCapture(e.pointerId);
    }
  }

  function onPanelDown(e: ReactPointerEvent<SVGGElement>, p: LayoutPanel) {
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
    drag.current = { kind: 'thing', what, start: at(e), orig: pos };
    svg.current?.setPointerCapture(e.pointerId);
  }

  function onMove(e: ReactPointerEvent<SVGSVGElement>) {
    const d = drag.current;
    if (!d) return;
    const L = layout;
    if (d.kind === 'pan') {
      const el = svg.current;
      if (!el) return;
      const k = d.view.w / el.clientWidth;
      setView({ ...d.view, x: d.view.x - (e.clientX - d.sx) * k, y: d.view.y - (e.clientY - d.sy) * k });
      return;
    }
    const p = at(e);
    const dx = p.x - d.start.x;
    const dy = p.y - d.start.y;
    if (d.kind === 'panels') {
      update({ panels: L.panels.map((x) => (d.orig.has(x.id) ? { ...x, x: d.orig.get(x.id)!.x + dx, y: d.orig.get(x.id)!.y + dy } : x)) });
    } else if (d.what === 'meter' || d.what === 'panelboard') {
      update({ [d.what]: { x: d.orig.x + dx, y: d.orig.y + dy } });
    } else {
      update({ inverters: L.inverters.map((i) => (i.id === d.what ? { ...i, x: d.orig.x + dx, y: d.orig.y + dy } : i)) });
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
      return { x: p.x - (p.x - v.x) * s, y: p.y - (p.y - v.y) * s, w, h: v.h * s };
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
          ? { ...x, x: cx + (x.x - cx) * cos - (x.y - cy) * sin, y: cy + (x.x - cx) * sin + (x.y - cy) * cos, rot: (x.rot + deg + 360) % 360 }
          : x,
      ),
    });
  }

  function nudge(dx: number, dy: number) {
    update({ panels: layout.panels.map((x) => (selected.has(x.id) ? { ...x, x: x.x + dx, y: x.y + dy } : x)) });
  }

  function deleteSelected() {
    update({ panels: layout.panels.filter((x) => !selected.has(x.id)) });
    setSelected(new Set());
  }

  function applyPattern() {
    const nums = patternText
      .split(/[,+\s]+/)
      .map((x) => Math.round(Number(x)))
      .filter((x) => x > 0);
    const L = layout;
    const strings = stringsForPattern(nums, L.inverters);
    onPatternChange(nums);
    onChange({ ...L, strings, panels: autoAssign(L.panels, strings.map((s, i) => ({ id: s.id, size: nums[i] }))) });
    setPaint(strings[0]?.id ?? null);
  }

  function setStringMppt(id: string, patch: Partial<StringDef>) {
    update({ strings: layout.strings.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
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
    return [members[0], members[members.length - 1]].map((p, k) => ({ key: `${s.id}-${k}`, from: inv, to: p, color: stringColor(layout.strings, s.id) }));
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
            }}
            style={[styles.tool, { borderColor: tool === x.tool ? t.accent : t.lineStrong, backgroundColor: tool === x.tool ? t.backgroundSelected : t.background }]}>
            <ThemedText type="small" themeColor={tool === x.tool ? 'text' : 'textSecondary'}>
              {x.label}
            </ThemedText>
          </Pressable>
        ))}
      </View>
      {hint ? (
        <ThemedText type="small" themeColor="textMuted">
          {hint}
        </ThemedText>
      ) : null}

      {tool === 'array' ? (
        <View style={styles.row}>
          <Field label="Rows" value={arr.rows} onChange={(v) => setArr({ ...arr, rows: v })} />
          <Field label="Columns" value={arr.cols} onChange={(v) => setArr({ ...arr, cols: v })} />
          <Field label="Rotation °" value={arr.rot} onChange={(v) => setArr({ ...arr, rot: v })} />
          <Field label="Gap m" value={arr.gap} onChange={(v) => setArr({ ...arr, gap: v })} />
          <Field label="Row gap m" value={arr.rowGap} onChange={(v) => setArr({ ...arr, rowGap: v })} />
          <SmallButton
            label={arr.orientation === 'portrait' ? 'Portrait' : 'Landscape'}
            onPress={() => setArr({ ...arr, orientation: arr.orientation === 'portrait' ? 'landscape' : 'portrait' })}
          />
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
          cursor: tool === 'select' ? 'grab' : 'crosshair',
          userSelect: 'none',
        }}>
        {tiles.map((tile) => (
          <image key={tile.url} href={tile.url} x={tile.x} y={tile.y} width={tile.w} height={tile.h} preserveAspectRatio="none" />
        ))}
        <rect x={box.x} y={box.y} width={box.w} height={box.h} fill="none" stroke="#E7A93C" strokeWidth={unit * 0.25} strokeDasharray={`${unit} ${unit}`} />

        {/* Home runs and the AC run, as the engine measures them: along x, then y */}
        {stringEnds.map((r) => (
          <polyline key={r.key} points={`${r.from.x},${r.from.y} ${r.to.x},${r.from.y} ${r.to.x},${r.to.y}`} fill="none" stroke={r.color} strokeWidth={unit * 0.2} strokeDasharray={`${unit * 0.6} ${unit * 0.4}`} opacity={0.9} />
        ))}
        {acEnd
          ? layout.inverters.map((inv) => (
              <polyline key={`ac-${inv.id}`} points={`${inv.x},${inv.y} ${acEnd.x},${inv.y} ${acEnd.x},${acEnd.y}`} fill="none" stroke="#ffffff" strokeWidth={unit * 0.25} opacity={0.8} />
            ))
          : null}

        {layout.panels.map((p) => {
          const { w, h } = panelSize(panel, p.orientation);
          const color = stringColor(layout.strings, p.stringId);
          const order = p.stringId ? layout.panels.filter((x) => x.stringId === p.stringId).indexOf(p) + 1 : null;
          return (
            <g key={p.id} transform={`translate(${p.x} ${p.y}) rotate(${p.rot})`} onPointerDown={(e) => onPanelDown(e, p)} style={{ cursor: tool === 'string' ? 'copy' : 'move' }}>
              <rect x={-w / 2} y={-h / 2} width={w} height={h} fill="#13233a" fillOpacity={0.85} stroke={selected.has(p.id) ? '#ffffff' : color} strokeWidth={selected.has(p.id) ? 0.08 : 0.05} />
              <line x1={-w / 2} y1={0} x2={w / 2} y2={0} stroke={color} strokeWidth={0.015} opacity={0.6} />
              {p.stringId ? (
                <text x={0} y={0.12} textAnchor="middle" fontSize={0.34} fill={color} fontFamily="sans-serif" fontWeight="bold" transform={`rotate(${-p.rot})`}>
                  {p.stringId}
                  {order}
                </text>
              ) : null}
            </g>
          );
        })}

        {layout.inverters.map((inv) => (
          <Marker key={inv.id} x={inv.x} y={inv.y} size={unit * 2.4} label={inv.id} fill="#E7A93C" onDown={(e) => onThingDown(e, inv.id, inv)} />
        ))}
        {layout.meter ? <Marker x={layout.meter.x} y={layout.meter.y} size={unit * 2.4} label="M" fill="#4FA3C0" round onDown={(e) => onThingDown(e, 'meter', layout.meter!)} /> : null}
        {layout.panelboard ? <Marker x={layout.panelboard.x} y={layout.panelboard.y} size={unit * 2.4} label="PB" fill="#8DBE6C" onDown={(e) => onThingDown(e, 'panelboard', layout.panelboard!)} /> : null}

        {measure ? (
          <g>
            <circle cx={measure.a.x} cy={measure.a.y} r={unit * 0.5} fill="#ff4d4d" />
            {measure.b ? (
              <>
                <line x1={measure.a.x} y1={measure.a.y} x2={measure.b.x} y2={measure.b.y} stroke="#ff4d4d" strokeWidth={unit * 0.3} />
                <circle cx={measure.b.x} cy={measure.b.y} r={unit * 0.5} fill="#ff4d4d" />
              </>
            ) : null}
          </g>
        ) : null}

        {/* Scale bar and north arrow, pinned to the view's corners */}
        <g transform={`translate(${view.x + view.w * 0.03} ${view.y + view.h * 0.95})`}>
          <rect x={-unit * 0.6} y={-unit * 3.2} width={bar + unit * 1.2} height={unit * 4} fill="#000" opacity={0.55} rx={unit * 0.4} />
          <line x1={0} y1={0} x2={bar} y2={0} stroke="#fff" strokeWidth={unit * 0.4} />
          <text x={bar / 2} y={-unit * 1} textAnchor="middle" fontSize={unit * 1.8} fill="#fff" fontFamily="sans-serif">
            {bar} m
          </text>
        </g>
        <g transform={`translate(${view.x + view.w * 0.96} ${view.y + view.h * 0.08})`}>
          <path d={`M0 ${-unit * 2.5} L${unit * 1.2} ${unit * 1.5} L0 ${unit * 0.6} L${-unit * 1.2} ${unit * 1.5} Z`} fill="#fff" />
          <text x={0} y={unit * 4} textAnchor="middle" fontSize={unit * 1.8} fill="#fff" fontFamily="sans-serif">
            N
          </text>
        </g>
      </svg>

      {/* Strings */}
      <View style={[styles.panel, { borderColor: t.line }]}>
        <View style={styles.row}>
          <Field label="String pattern" value={patternText} onChange={setPatternText} width={140} />
          <SmallButton label="Auto-assign in placement order" onPress={applyPattern} strong />
          <ThemedText type="small" themeColor="textMuted">
            {layout.panels.length} panels placed · {layout.panels.filter((p) => !p.stringId).length} unassigned
          </ThemedText>
        </View>
        {layout.strings.map((s) => {
          const count = layout.panels.filter((p) => p.stringId === s.id).length;
          return (
            <View key={s.id} style={styles.row}>
              <Pressable
                onPress={() => {
                  setPaint(s.id);
                  setTool('string');
                }}
                style={[styles.swatch, { backgroundColor: stringColor(layout.strings, s.id), borderColor: paint === s.id && tool === 'string' ? t.text : 'transparent' }]}>
                <ThemedText type="smallBold" style={{ color: '#12160F' }}>
                  {s.id}
                </ThemedText>
              </Pressable>
              <ThemedText type="small" style={{ minWidth: 80 }}>
                {count} panel{count === 1 ? '' : 's'}
              </ThemedText>
              <Choice
                options={layout.inverters.map((i) => ({ value: i.id, label: i.id }))}
                value={s.inverterId}
                onChange={(v) => setStringMppt(s.id, { inverterId: v })}
              />
              <Choice
                options={[0, 1].map((m) => ({ value: String(m), label: `MPPT${m + 1}` }))}
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
          <Field label="Floors" value={String(layout.floors)} onChange={(v) => update({ floors: Math.max(0, Math.round(Number(v) || 0)) })} />
          <Field label="Floor height m" value={String(layout.floorHeightM)} onChange={(v) => update({ floorHeightM: Math.max(0, Number(v) || 0) })} />
        </View>
        {layout.inverters.map((inv) => (
          <View key={inv.id} style={styles.row}>
            <ThemedText type="smallBold" style={{ minWidth: 48 }}>
              {inv.id}
            </ThemedText>
            <Choice
              options={INVERTERS.map((m) => ({ value: m.model, label: m.model.replace('HYXi ', '') }))}
              value={inv.model}
              onChange={(v) => update({ inverters: layout.inverters.map((i) => (i.id === inv.id ? { ...i, model: v } : i)) })}
            />
            <Field
              label="On floor"
              value={String(inv.floor)}
              onChange={(v) => update({ inverters: layout.inverters.map((i) => (i.id === inv.id ? { ...i, floor: Math.max(1, Math.round(Number(v) || 1)) } : i)) })}
            />
            <SmallButton label="Remove" onPress={() => update({ inverters: layout.inverters.filter((i) => i.id !== inv.id) })} />
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
  onDown,
}: {
  x: number;
  y: number;
  size: number;
  label: string;
  fill: string;
  round?: boolean;
  onDown: (e: ReactPointerEvent<SVGGElement>) => void;
}) {
  return (
    <g transform={`translate(${x} ${y})`} onPointerDown={onDown} style={{ cursor: 'move' }}>
      {round ? (
        <circle r={size / 2} fill={fill} stroke="#12160F" strokeWidth={size * 0.06} />
      ) : (
        <rect x={-size / 2} y={-size / 2} width={size} height={size} fill={fill} stroke="#12160F" strokeWidth={size * 0.06} rx={size * 0.1} />
      )}
      <text y={size * 0.16} textAnchor="middle" fontSize={size * (label.length > 2 ? 0.3 : 0.45)} fill="#12160F" fontFamily="sans-serif" fontWeight="bold">
        {label}
      </text>
    </g>
  );
}

function Field({ label, value, onChange, width = 90 }: { label: string; value: string; onChange: (v: string) => void; width?: number }) {
  const t = useTheme();
  return (
    <View style={{ gap: 2 }}>
      <ThemedText type="eyebrow" themeColor="textMuted" style={{ fontSize: 10 }}>
        {label}
      </ThemedText>
      <TextInput
        value={value}
        onChangeText={onChange}
        style={[styles.input, { width, borderColor: t.lineStrong, color: t.text, backgroundColor: t.background }]}
      />
    </View>
  );
}

function Choice({ options, value, onChange }: { options: { value: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  const t = useTheme();
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{ padding: '6px 8px', borderRadius: Radius.sm, border: `1px solid ${t.lineStrong}`, background: t.background, color: t.text, fontSize: 13 }}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  tool: { borderWidth: 1, borderRadius: Radius.pill, paddingHorizontal: Spacing.three, paddingVertical: 6 },
  panel: { borderWidth: 1, borderRadius: Radius.md, padding: Spacing.three, gap: Spacing.two },
  swatch: { width: 32, height: 28, borderRadius: Radius.sm, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  input: { borderWidth: 1, borderRadius: Radius.sm, paddingHorizontal: Spacing.two, paddingVertical: 6 },
});
