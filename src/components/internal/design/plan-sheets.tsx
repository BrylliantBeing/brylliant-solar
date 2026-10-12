import { panelSize, type Circuit, type DesignResult } from '@calculator/pvDesign';
import type { ReactNode } from 'react';

import { stringColor } from './strings';

import { siteBox, siteCenter, tilesAround } from '@/lib/design-geo';
import type { DesignDoc, DesignProject } from '@/lib/designs-api';

/**
 * The net-metering plan set as two A3 landscape sheets, drawn in millimetres
 * so 1 SVG unit prints as 1 mm. The layout copies the sample plan set
 * (context/printtopdf.pdf), redrawn for a grid-tie system: no battery, no ATS.
 */

export type SheetData = {
  project: DesignProject;
  doc: DesignDoc;
  result: DesignResult;
};

const W = 420;
const H = 297;
const INK = '#111';
const FONT = 'Arial, Helvetica, sans-serif';

const GENERAL_NOTES = [
  'ALL ELECTRICAL WORKS SHALL BE DONE IN ACCORDANCE WITH THE LATEST EDITION OF THE PHILIPPINE ELECTRICAL CODE.',
  'MINIMUM SIZE OF WIRE AND CONDUIT FOR PHOTOVOLTAIC MODULES SHALL BE 4mm² DC CABLE AND 15mm Ø RESPECTIVELY UNLESS OTHERWISE SPECIFIED ON PLAN.',
  'ALL MATERIALS AND EQUIPMENT TO BE USED SHALL BE BRAND NEW AND OF APPROVED TYPE FOR THEIR LOCATION AND PURPOSE.',
  'ALL METAL FRAMES SHALL BE PROPERLY AND ADEQUATELY GROUNDED.',
  'ALL WEATHER-EXPOSED INSTALLATIONS SHALL USE WEATHERPROOF MATERIALS, ESPECIALLY CONDUITS, JUNCTION BOXES AND SAFETY DEVICES.',
  'ALL SPECIAL EQUIPMENT (INVERTERS AND PV MODULES) SHALL BE INSTALLED IN ACCORDANCE WITH THE CODE AND THE MANUFACTURER’S SPECIFICATIONS.',
  'INVERTERS SHALL BE INSTALLED IN A WELL SECURED AND VENTILATED LOCATION.',
  'ALL INSTALLATION SHALL BE DONE IN GOOD AND NEAT WORKMANSHIP.',
  'ALL ELECTRICAL WORKS SHALL BE DONE UNDER THE DIRECT SUPERVISION OF A REGISTERED ELECTRICAL ENGINEER / REGISTERED MASTER ELECTRICIAN OR PROFESSIONAL SOLAR SYSTEM INSTALLER.',
];

const ABBREVIATIONS = [
  'A - AMPERE',
  'AT - AMPERE TRIP',
  'AF - AMPERE FRAME',
  'V - VOLTAGE',
  'VA - VOLT AMPERE',
  'KW - KILOWATT',
  'MCB - MINIATURE CIRCUIT BREAKER',
  'AC - ALTERNATING CURRENT',
  'DC - DIRECT CURRENT',
  'PV - PHOTOVOLTAIC',
  '2P - TWO POLE / DOUBLE POLE',
  'SPD - SURGE PROTECTION DEVICE',
  'KAIC - KILO AMPERE INTERRUPTING CAPACITY',
  'CT - CURRENT TRANSFORMER',
];

const n = (v: number, dp = 2) =>
  v.toLocaleString('en-PH', {
    maximumFractionDigits: dp,
    minimumFractionDigits: dp,
  });

/** Breaks text into lines of at most `max` characters, on spaces. */
function wrap(text: string, max: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    if ((line + ' ' + word).trim().length > max && line) {
      out.push(line);
      line = word;
    } else line = (line + ' ' + word).trim();
  }
  if (line) out.push(line);
  return out;
}

/* ------------------------------------------------------------------ *
 * Drawing primitives (all in mm)
 * ------------------------------------------------------------------ */

function T({
  x,
  y,
  size = 2.2,
  bold,
  anchor = 'start',
  children,
  fill = INK,
}: {
  x: number;
  y: number;
  size?: number;
  bold?: boolean;
  anchor?: 'start' | 'middle' | 'end';
  children: ReactNode;
  fill?: string;
}) {
  return (
    <text x={x} y={y} fontSize={size} fontFamily={FONT} fontWeight={bold ? 'bold' : 'normal'} textAnchor={anchor} fill={fill}>
      {children}
    </text>
  );
}

function Lines({ x, y, lines, size = 2.1, gap = 1.35 }: { x: number; y: number; lines: string[]; size?: number; gap?: number }) {
  return (
    <>
      {lines.map((l, i) => (
        <T key={i} x={x} y={y + i * size * gap} size={size}>
          {l}
        </T>
      ))}
    </>
  );
}

/** A section title in the sample's style: a circled bullet, the title, a rule. */
function Heading({ x, y, w, children }: { x: number; y: number; w: number; children: string }) {
  return (
    <g>
      <circle cx={x + 2.5} cy={y - 1} r={2.5} fill="none" stroke={INK} strokeWidth={0.3} />
      <line x1={x} y1={y - 1} x2={x + 5} y2={y - 1} stroke={INK} strokeWidth={0.3} />
      <T x={x + 7} y={y} size={3} bold>
        {children}
      </T>
      <line
        x1={x + 7}
        y1={y + 1.2}
        x2={x + Math.min(w, 7 + children.length * 2.1)}
        y2={y + 1.2}
        stroke={INK}
        strokeWidth={0.35}
      />
    </g>
  );
}

function Breaker({ x, y, label, vertical }: { x: number; y: number; label?: string; vertical?: boolean }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${vertical ? 90 : 0})`}>
      <circle cx={-1.6} cy={0} r={0.45} fill="none" stroke={INK} strokeWidth={0.25} />
      <circle cx={1.6} cy={0} r={0.45} fill="none" stroke={INK} strokeWidth={0.25} />
      <path d="M -1.6 -0.4 A 1.8 1.8 0 0 1 1.6 -0.4" fill="none" stroke={INK} strokeWidth={0.3} />
      {label ? (
        <text
          x={0}
          y={-2.2}
          fontSize={1.8}
          fontFamily={FONT}
          textAnchor="middle"
          fill={INK}
          transform={vertical ? 'rotate(-90)' : undefined}>
          {label}
        </text>
      ) : null}
    </g>
  );
}

function Ground({ x, y }: { x: number; y: number }) {
  return (
    <g stroke={INK} strokeWidth={0.3}>
      <line x1={x} y1={y} x2={x} y2={y + 2} />
      <line x1={x - 2} y1={y + 2} x2={x + 2} y2={y + 2} />
      <line x1={x - 1.3} y1={y + 2.8} x2={x + 1.3} y2={y + 2.8} />
      <line x1={x - 0.6} y1={y + 3.6} x2={x + 0.6} y2={y + 3.6} />
    </g>
  );
}

function Meter({ x, y, r = 3 }: { x: number; y: number; r?: number }) {
  return (
    <g>
      <circle cx={x} cy={y} r={r} fill="#fff" stroke={INK} strokeWidth={0.35} />
      <T x={x} y={y + r * 0.35} size={r * 0.9} bold anchor="middle">
        M
      </T>
    </g>
  );
}

function Box({
  x,
  y,
  w,
  h,
  children,
  dash,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  children?: ReactNode;
  dash?: boolean;
}) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        fill="#fff"
        stroke={INK}
        strokeWidth={0.35}
        strokeDasharray={dash ? '1 0.7' : undefined}
      />
      {children}
    </g>
  );
}

const L = ({ d, w = 0.3, dash }: { d: string; w?: number; dash?: boolean }) => (
  <path d={d} fill="none" stroke={INK} strokeWidth={w} strokeDasharray={dash ? '1 0.7' : undefined} />
);

/* ------------------------------------------------------------------ *
 * Sheet frame and title block
 * ------------------------------------------------------------------ */

function Frame({ data, sheet, total, children }: { data: SheetData; sheet: number; total: number; children: ReactNode }) {
  const { plan } = data.doc.inputs;
  const title = plan.title || `${n(data.result.dcKw)}KWP GRID-TIE SOLAR PV ROOFTOP SYSTEM WITH NET METERING`;
  const y0 = 262;
  const cells: { w: number; head: string; body: string[] }[] = [
    {
      w: 92,
      head: 'PROFESSIONAL ELECTRICAL ENGINEER',
      body: [
        plan.engineer.toUpperCase(),
        plan.engineerLicense ? `PRC LIC. NO. ${plan.engineerLicense}` : '',
        '',
        'SIGNATURE: ____________________',
      ],
    },
    {
      w: 56,
      head: 'PREPARED BY',
      body: [plan.designer.toUpperCase(), 'BRYLLIANT SOLAR'],
    },
    { w: 86, head: 'PROJECT TITLE', body: wrap(title.toUpperCase(), 40) },
    {
      w: 80,
      head: 'PROJECT LOCATION',
      body: wrap(plan.location.toUpperCase(), 38),
    },
    { w: 62, head: 'OWNER', body: wrap(plan.ownerName.toUpperCase(), 28) },
    { w: 24, head: 'SHEET', body: [] },
  ];
  let x = 10;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      xmlns="http://www.w3.org/2000/svg"
      className="design-sheet"
      style={{ background: '#fff', display: 'block' }}>
      <rect x={0} y={0} width={W} height={H} fill="#fff" />
      <rect x={8} y={8} width={W - 16} height={H - 16} fill="none" stroke={INK} strokeWidth={0.7} />
      <line x1={8} y1={y0} x2={W - 8} y2={y0} stroke={INK} strokeWidth={0.5} />
      {cells.map((c) => {
        const cx = x;
        x += c.w;
        return (
          <g key={c.head}>
            <line x1={cx + c.w} y1={y0} x2={cx + c.w} y2={H - 8} stroke={INK} strokeWidth={0.3} />
            <T x={cx + 1.5} y={y0 + 3.5} size={1.8} bold>
              {c.head}
            </T>
            {c.head === 'SHEET' ? (
              <>
                <circle cx={cx + c.w / 2} cy={y0 + 14} r={7} fill="none" stroke={INK} strokeWidth={0.4} />
                <line x1={cx + c.w / 2 - 7} y1={y0 + 14} x2={cx + c.w / 2 + 7} y2={y0 + 14} stroke={INK} strokeWidth={0.3} />
                <T x={cx + c.w / 2} y={y0 + 12.5} size={3.2} bold anchor="middle">
                  E-{sheet}
                </T>
                <T x={cx + c.w / 2} y={y0 + 18.5} size={2.4} anchor="middle">
                  {total}
                </T>
              </>
            ) : (
              <Lines
                x={cx + 1.5}
                y={y0 + 8}
                lines={c.body.filter((_, i) => i < 5)}
                size={c.head === 'PROJECT TITLE' ? 2.8 : 2.3}
              />
            )}
          </g>
        );
      })}
      {children}
    </svg>
  );
}

/* ------------------------------------------------------------------ *
 * Sheet 1 parts
 * ------------------------------------------------------------------ */

function GeneralNotes({ x, y, w }: { x: number; y: number; w: number }) {
  const notes = GENERAL_NOTES.map((note) => wrap(note, Math.floor(w / 1.05)));
  const tops = notes.map((_, i) => y + 6 + notes.slice(0, i).reduce((a, l) => a + l.length * 2.6 + 0.8, 0));
  return (
    <g>
      <Heading x={x} y={y} w={w}>
        GENERAL NOTES AND SPECIFICATIONS
      </Heading>
      {notes.map((lines, i) => (
        <Lines key={i} x={x} y={tops[i]} lines={lines.map((l, k) => (k === 0 ? `${i + 1}. ${l}` : `    ${l}`))} size={1.9} />
      ))}
    </g>
  );
}

function SitePlan({ x, y, w, h, data }: { x: number; y: number; w: number; h: number; data: SheetData }) {
  const { doc, result } = data;
  const L0 = doc.layout;
  const site = siteBox(doc.site);
  // Fit what was placed, not the whole rectangle: a generous rectangle would shrink the array to a smudge.
  const placed = [
    ...L0.panels.map((p) => ({ x: p.x, y: p.y })),
    ...L0.inverters,
    ...(L0.meter ? [L0.meter] : []),
    ...(L0.panelboard ? [L0.panelboard] : []),
  ];
  const pts = placed.length
    ? placed
    : [
        { x: site.x, y: site.y },
        { x: site.x + site.w, y: site.y + site.h },
      ];
  const minX = Math.min(...pts.map((p) => p.x)) - 3;
  const maxX = Math.max(...pts.map((p) => p.x)) + 3;
  const minY = Math.min(...pts.map((p) => p.y)) - 3;
  const maxY = Math.max(...pts.map((p) => p.y)) + 3;
  const top = y + 6;
  const ah = h - 12;
  const s = Math.min((w - 12) / (maxX - minX), ah / (maxY - minY));
  const ox = x + (w - 12 - (maxX - minX) * s) / 2 - minX * s;
  const oy = top + (ah - (maxY - minY) * s) / 2 - minY * s;
  const scale = Math.round(1000 / s / 50) * 50;
  return (
    <g>
      <Heading x={x} y={y} w={w}>
        SITE DEVELOPMENT PLAN
      </Heading>
      <clipPath id="site-plan">
        <rect x={x} y={top} width={w - 12} height={ah} />
      </clipPath>
      <g clipPath="url(#site-plan)">
        <g transform={`translate(${ox} ${oy}) scale(${s})`}>
          <rect
            x={site.x}
            y={site.y}
            width={site.w}
            height={site.h}
            fill="none"
            stroke={INK}
            strokeWidth={0.3 / s}
            strokeDasharray={`${1.5 / s} ${1 / s}`}
          />
          {L0.panels.map((p) => {
            const { w: pw, h: ph } = panelSize(result.panel, p.orientation);
            return (
              <g key={p.id} transform={`translate(${p.x} ${p.y}) rotate(${p.rot})`}>
                <rect x={-pw / 2} y={-ph / 2} width={pw} height={ph} fill="#fff" stroke={INK} strokeWidth={0.25 / s} />
                <line
                  x1={-pw / 2}
                  y1={-ph / 2}
                  x2={pw / 2}
                  y2={ph / 2}
                  stroke={stringColor(L0.strings, p.stringId)}
                  strokeWidth={0.2 / s}
                />
              </g>
            );
          })}
          {L0.inverters.map((i) => (
            <g key={i.id}>
              <rect x={i.x - 2 / s} y={i.y - 2 / s} width={4 / s} height={4 / s} fill="#fff" stroke={INK} strokeWidth={0.3 / s} />
              <text x={i.x} y={i.y + 0.7 / s} fontSize={1.8 / s} textAnchor="middle" fontFamily={FONT}>
                INV
              </text>
            </g>
          ))}
          {L0.meter ? (
            <g>
              <circle cx={L0.meter.x} cy={L0.meter.y} r={2 / s} fill="#fff" stroke={INK} strokeWidth={0.3 / s} />
              <text
                x={L0.meter.x}
                y={L0.meter.y + 0.7 / s}
                fontSize={2 / s}
                textAnchor="middle"
                fontFamily={FONT}
                fontWeight="bold">
                M
              </text>
            </g>
          ) : null}
          {L0.panelboard ? (
            <g>
              <rect
                x={L0.panelboard.x - 2 / s}
                y={L0.panelboard.y - 1.5 / s}
                width={4 / s}
                height={3 / s}
                fill="#ddd"
                stroke={INK}
                strokeWidth={0.3 / s}
              />
              <text x={L0.panelboard.x} y={L0.panelboard.y + 0.6 / s} fontSize={1.6 / s} textAnchor="middle" fontFamily={FONT}>
                PB
              </text>
            </g>
          ) : null}
        </g>
      </g>
      <g transform={`translate(${x + w - 6} ${top + 6})`}>
        <path d="M0 -4 L2 2 L0 1 L-2 2 Z" fill={INK} />
        <T x={0} y={5.5} size={2.2} bold anchor="middle">
          N
        </T>
      </g>
      <T x={x} y={y + h - 1} size={1.9}>
        {`PV MODULE LAYOUT · ${result.panels} × ${result.panel.watts}Wp · SCALE ≈ 1:${scale}`}
      </T>
    </g>
  );
}

function VicinityMap({ x, y, w, h, data }: { x: number; y: number; w: number; h: number; data: SheetData }) {
  const c = siteCenter(data.doc.site);
  const { tiles, px, py } = tilesAround(c.lat, c.lng, 16, 3);
  const top = y + 5;
  const size = Math.min(w, h - 10);
  const t = size / 3;
  const ox = x + (w - size) / 2;
  return (
    <g>
      <Heading x={x} y={y} w={w}>
        VICINITY MAP
      </Heading>
      <clipPath id="vicinity">
        <rect x={ox} y={top} width={size} height={size} />
      </clipPath>
      <g clipPath="url(#vicinity)">
        {tiles.map((tile) => (
          <image
            key={tile.url}
            href={tile.url}
            x={ox + tile.col * t}
            y={top + tile.row * t}
            width={t}
            height={t}
            style={{ filter: 'grayscale(1)' }}
          />
        ))}
      </g>
      <rect x={ox} y={top} width={size} height={size} fill="none" stroke={INK} strokeWidth={0.4} />
      <circle cx={ox + px * t} cy={top + py * t} r={2.2} fill="none" stroke="#c00" strokeWidth={0.6} />
      <circle cx={ox + px * t} cy={top + py * t} r={0.6} fill="#c00" />
      <T x={ox} y={top + size + 3} size={1.9}>
        {`SITE: ${c.lat.toFixed(6)}, ${c.lng.toFixed(6)} · MAP © OPENSTREETMAP CONTRIBUTORS`}
      </T>
    </g>
  );
}

function ServiceEntrance({ x, y, w, data }: { x: number; y: number; w: number; data: SheetData }) {
  const ac = data.result.circuits.find((c) => c.kind === 'ac');
  const s = data.doc.inputs.settings;
  const top = y + 6;
  return (
    <g>
      <Heading x={x} y={y} w={w}>
        SERVICE ENTRANCE LAYOUT
      </Heading>
      {/* Pole, drop, meter base, service equipment, ground rod */}
      <L d={`M ${x + 8} ${top + 2} L ${x + 8} ${top + 44}`} w={1} />
      <L d={`M ${x + 4} ${top + 5} L ${x + 12} ${top + 5}`} w={0.6} />
      <T x={x + 2} y={top + 48} size={1.8}>
        ZAMCELCO POLE
      </T>
      <L d={`M ${x + 12} ${top + 5} Q ${x + 25} ${top + 12} ${x + 38} ${top + 10}`} />
      <T x={x + 14} y={top + 4} size={1.8}>
        {`SERVICE DROP ${s.serviceDropMm2 ?? 14}mm² · ${s.serviceDropM ?? 30}m`}
      </T>
      <L d={`M ${x + 38} ${top + 10} L ${x + 38} ${top + 18}`} />
      <Meter x={x + 38} y={top + 21} />
      <T x={x + 43} y={top + 20} size={1.8}>
        REC BI-DIRECTIONAL
      </T>
      <T x={x + 43} y={top + 22.5} size={1.8}>
        METER &amp; METER BASE
      </T>
      <L d={`M ${x + 38} ${top + 24} L ${x + 38} ${top + 30}`} />
      <Box x={x + 33} y={top + 30} w={10} h={8} />
      <Breaker x={x + 38} y={top + 34} vertical />
      <T x={x + 45} y={top + 33} size={1.8}>
        SERVICE EQUIPMENT
      </T>
      <T x={x + 45} y={top + 35.5} size={1.8}>
        (EXISTING, NEMA 3R)
      </T>
      <L d={`M ${x + 38} ${top + 38} L ${x + 38} ${top + 44} L ${x + 28} ${top + 44}`} />
      <L d={`M ${x + 28} ${top + 44} L ${x + 28} ${top + 52}`} w={0.6} />
      <Ground x={x + 28} y={top + 52} />
      <T x={x + 31} y={top + 51} size={1.8}>
        {'GROUND ROD 5/8" × 8ft'}
      </T>
      {ac ? (
        <T x={x + 45} y={top + 40} size={1.8}>
          {`TO PV: ${ac.breakerA}AT 2P, 2-${ac.mm2}mm² THHN`}
        </T>
      ) : null}
    </g>
  );
}

function ShortCircuitBlock({ x, y, w, data }: { x: number; y: number; w: number; data: SheetData }) {
  const sc = data.result.shortCircuit;
  const lines: string[] = sc
    ? [
        `TRANSFORMER RATING = ${sc.transformerKva}KVA, SINGLE PHASE, %Z = ${sc.zPct}, VSEC = ${sc.voltage}V`,
        `FAULT X1: IFLA = ${sc.transformerKva}KVA × 1000 / ${sc.voltage}V = ${n(sc.iflaA)}A`,
        `MULTIPLIER = 100 / (${sc.zPct} × 0.9) = ${n(sc.multiplier)}`,
        `I(S.C.)(X1) = ${n(sc.iflaA)}A × ${n(sc.multiplier)} = ${n(sc.x1A)}A`,
        `f = 2 × L × I(S.C.) / (C × n × V),  M = 1 / (1 + f)`,
        ...sc.points.flatMap((p, i) => {
          const prev = i === 0 ? sc.x1A : sc.points[i - 1].iscA;
          return [
            `FAULT X${i + 2} — ${p.label.toUpperCase()}: ${n(p.lengthM, 1)}m, ${p.mm2}mm² COPPER, C = ${p.c}`,
            `  f = 2 × (${n(p.lengthM, 1)} × 3.28) × ${n(prev)}A / (${p.c} × 1 × ${sc.voltage}V) = ${p.f}`,
            `  M = 1 / (1 + ${p.f}) = ${p.m};  I(S.C.)(X${i + 2}) = ${p.m} × ${n(prev)}A = ${n(p.iscA)}A`,
          ];
        }),
        `THEREFORE, SELECT KAIC RATING OF CIRCUIT BREAKER NOT LESS THAN ${sc.kaic}KAIC.`,
      ]
    : ['PLACE THE INVERTER AND METER TO RUN THE SHORT-CIRCUIT ANALYSIS.'];
  return (
    <g>
      <Heading x={x} y={y} w={w}>
        SHORT CIRCUIT ANALYSIS
      </Heading>
      <Lines x={x} y={y + 6} lines={lines.flatMap((l) => wrap(l, Math.floor(w / 0.98)))} size={1.85} />
    </g>
  );
}

function VoltageDropBlock({ x, y, w, data }: { x: number; y: number; w: number; data: SheetData }) {
  const lines = data.result.circuits.flatMap((c: Circuit) => [
    `${c.label.toUpperCase()} (${c.kind.toUpperCase()}): 2-${c.mm2}mm² ${c.kind === 'dc' ? 'PV CABLE' : 'THHN'}, L = ${n(c.oneWayM, 1)}m, I = ${n(c.vdropCurrentA)}A`,
    `  VD = 2 × L × I × Z / 305 = ${n(c.vdropV)}V;  %VD = ${n(c.vdropV)}V / ${n(c.nominalV, 1)}V = ${n(c.vdropPct)}%  ${c.vdropPct <= 3 ? '≤ 3% OK' : '> 3%'}`,
  ]);
  return (
    <g>
      <Heading x={x} y={y} w={w}>
        VOLTAGE DROP CALCULATION
      </Heading>
      <Lines x={x} y={y + 6} lines={lines.flatMap((l) => wrap(l, Math.floor(w / 0.98)))} size={1.85} />
    </g>
  );
}

function StringCalc({ x, y, w, data }: { x: number; y: number; w: number; data: SheetData }) {
  const p = data.result.panel;
  const lines = data.result.strings.flatMap((s) => [
    `STRING ${s.id} SERIES CONNECTION (${s.series}S) — ${s.inverterId} MPPT${s.mppt + 1}`,
    `  VOC = ${n(p.vocV)}V × ${s.series} = ${n(s.vocV)}V  (${n(s.vocColdV)}V AT COLDEST)`,
    `  VMP = ${n(p.vmpV)}V × ${s.series} = ${n(s.vmpV)}V;  IMP = ${n(s.impA)}A;  ISC = ${n(s.iscA)}A`,
  ]);
  return (
    <g>
      <Heading x={x} y={y} w={w}>
        PANEL STRING CALCULATION
      </Heading>
      <Lines x={x} y={y + 6} lines={[`${p.model.toUpperCase()} ${p.watts}W`, ...lines]} size={1.85} />
    </g>
  );
}

function InverterSpec({ x, y, w, data }: { x: number; y: number; w: number; data: SheetData }) {
  const spec = data.result.inverters[0]?.spec;
  if (!spec) return null;
  const rows: [string, string][] = [
    ['MODEL', spec.model.toUpperCase()],
    ['MAX. DC INPUT POWER', `${spec.maxDcW}W`],
    ['MAX. DC INPUT VOLTAGE', `${spec.maxDcV}V`],
    ['MPPT VOLTAGE RANGE', `${spec.mpptMinV}-${spec.mpptMaxV}V`],
    ['MAX. DC INPUT CURRENT', spec.mppts.map((m) => `${m.maxInputA}A`).join(' + ')],
    ['MAX. SHORT CIRCUIT', spec.mppts.map((m) => `${m.maxIscA}A`).join(' + ')],
    ['RATED AC GRID VOLTAGE', `${spec.nominalAcV}V`],
    ['RATED AC GRID FREQUENCY', `${spec.frequencyHz} HZ`],
    ['RATED AC OUTPUT POWER', `${spec.nominalAcW}W`],
    ['MAX. APPARENT POWER', `${spec.maxApparentVA}VA`],
    ['MAX. AC OUTPUT CURRENT', `${spec.maxAcA}A`],
    ['POWER FACTOR', spec.powerFactor.toUpperCase()],
  ];
  return (
    <g>
      <Heading x={x} y={y} w={w}>
        GRID-TIE INVERTER SPECIFICATION
      </Heading>
      {rows.map(([k, v], i) => (
        <g key={k}>
          <T x={x} y={y + 6 + i * 2.9} size={1.9}>
            {k}
          </T>
          <T x={x + w * 0.5} y={y + 6 + i * 2.9} size={1.9}>
            {`-   ${v}`}
          </T>
        </g>
      ))}
    </g>
  );
}

function Legends({ x, y, w }: { x: number; y: number; w: number }) {
  const row = (i: number) => y + 8 + i * 6;
  return (
    <g>
      <Heading x={x} y={y} w={w}>
        LEGENDS AND SYMBOLS
      </Heading>
      <Box x={x} y={row(0) - 2.5} w={6} h={5} />
      <L d={`M ${x} ${row(0) + 2.5} L ${x + 6} ${row(0) - 2.5}`} />
      <T x={x + 9} y={row(0) + 0.7} size={1.9}>
        GRID-TIE INVERTER
      </T>
      <Box x={x} y={row(1) - 2} w={6} h={4} />
      <L d={`M ${x} ${row(1) - 2} L ${x + 6} ${row(1) + 2}`} w={0.2} />
      <T x={x + 9} y={row(1) + 0.7} size={1.9}>
        PV MODULE
      </T>
      <Ground x={x + 3} y={row(2) - 2} />
      <T x={x + 9} y={row(2) + 0.7} size={1.9}>
        GROUND
      </T>
      <Breaker x={x + 3} y={row(3)} />
      <T x={x + 9} y={row(3) + 0.7} size={1.9}>
        DC / AC CIRCUIT BREAKER
      </T>
      <Box x={x} y={row(4) - 2} w={6} h={4}>
        <T x={x + 3} y={row(4) + 0.7} size={1.5} anchor="middle">
          SPD
        </T>
      </Box>
      <T x={x + 9} y={row(4) + 0.7} size={1.9}>
        DC SPD / AC SPD
      </T>
      <Meter x={x + 3} y={row(5)} r={2.2} />
      <T x={x + 9} y={row(5) + 0.7} size={1.9}>
        BI-DIRECTIONAL METER
      </T>
      <Box x={x} y={row(6) - 2} w={6} h={4}>
        <T x={x + 3} y={row(6) + 0.7} size={1.5} anchor="middle">
          CT
        </T>
      </Box>
      <T x={x + 9} y={row(6) + 0.7} size={1.9}>
        CT / EXPORT LIMITER
      </T>
    </g>
  );
}

/**
 * Single-line diagram, grid-tie: each string through its DC breaker, a DC SPD,
 * the inverter, the AC breaker and AC SPD, the existing panel board, then the
 * bi-directional meter and the service entrance.
 */
function SingleLine({ x, y, w, h, data }: { x: number; y: number; w: number; h: number; data: SheetData }) {
  const r = data.result;
  const groups = r.inverters.map((inv) => ({
    inv,
    strings: r.strings.filter((s) => s.inverterId === inv.id && s.series > 0),
  }));
  const pitch = 12;
  const groupH = (g: (typeof groups)[number]) => Math.max(g.strings.length * pitch, 26) + 14;
  const groupTops = groups.map((_, i) => y + 10 + groups.slice(0, i).reduce((a, g) => a + groupH(g), 0));
  const pbX = x + w * 0.74;
  const pbTop = y + 10;
  const totalH = groups.reduce((a, g) => a + groupH(g), 0);
  const pbH = Math.max(28, totalH - 14);
  const feeds = groups.map((g, i) => groupTops[i] + Math.max(g.strings.length * pitch, 26) / 2);

  return (
    <g>
      <Heading x={x} y={y} w={w}>
        PV SYSTEM SINGLE LINE DIAGRAM
      </Heading>
      {groups.map((g, gi) => {
        const top = groupTops[gi];
        const invY = feeds[gi];
        const invX = x + w * 0.38;
        const dc = r.circuits.filter((c) => g.strings.some((s) => c.id === `dc-${s.id}`));
        const ac = r.circuits.find((c) => c.id === `ac-${g.inv.id}`);
        return (
          <g key={g.inv.id}>
            {g.strings.map((s, i) => {
              const sy = top + i * pitch + pitch / 2;
              const c = dc.find((d) => d.id === `dc-${s.id}`);
              return (
                <g key={s.id}>
                  <Box x={x} y={sy - 4} w={18} h={8}>
                    <T x={x + 9} y={sy - 1} size={1.8} bold anchor="middle">
                      {`STRING ${s.id}`}
                    </T>
                    <T x={x + 9} y={sy + 1.6} size={1.6} anchor="middle">
                      {`${s.series} PCS × ${r.panel.watts}Wp`}
                    </T>
                  </Box>
                  <L d={`M ${x + 18} ${sy} L ${x + 26} ${sy}`} />
                  <Breaker x={x + 29} y={sy} label={c?.breakerA ? `${c.breakerA}AT` : ''} />
                  <L d={`M ${x + 32} ${sy} L ${invX - 4} ${sy} L ${invX - 4} ${invY} L ${invX} ${invY}`} />
                </g>
              );
            })}
            <T x={x + 20} y={top + g.strings.length * pitch + 3} size={1.7}>
              {`2-${dc[0]?.mm2 ?? 4}mm² PV CABLE · ${dc[0]?.breakerA ?? ''}AT 2P 600VDC MCB`}
            </T>
            {/* DC SPD on the inverter input */}
            <L d={`M ${invX - 4} ${invY} L ${invX - 4} ${invY + 9}`} dash />
            <Box x={invX - 7} y={invY + 9} w={6} h={4}>
              <T x={invX - 4} y={invY + 11.7} size={1.4} anchor="middle">
                SPD
              </T>
            </Box>
            <Ground x={invX - 4} y={invY + 13} />
            {/* Inverter */}
            <Box x={invX} y={invY - 9} w={20} h={18}>
              <L d={`M ${invX} ${invY + 9} L ${invX + 20} ${invY - 9}`} w={0.2} />
              <T x={invX + 5} y={invY - 4} size={2.4} bold anchor="middle">
                =
              </T>
              <T x={invX + 15} y={invY + 6} size={2.4} bold anchor="middle">
                ~
              </T>
            </Box>
            <T x={invX + 10} y={invY + 12} size={1.7} bold anchor="middle">
              {g.inv.spec.model.replace('HYXi ', '').toUpperCase()}
            </T>
            <T x={invX + 10} y={invY + 14.4} size={1.6} anchor="middle">
              {`${g.inv.spec.nominalAcW / 1000}KW ${g.inv.spec.nominalAcV}V 1PH INVERTER`}
            </T>
            {/* AC out */}
            <L d={`M ${invX + 20} ${invY} L ${invX + 26} ${invY}`} />
            <Box x={invX + 26} y={invY - 4} w={10} h={8} dash />
            <Breaker x={invX + 31} y={invY} label={ac?.breakerA ? `${ac.breakerA}AT 2P` : ''} />
            <L d={`M ${invX + 36} ${invY} L ${pbX} ${invY}`} />
            <L d={`M ${invX + 31} ${invY + 4} L ${invX + 31} ${invY + 8}`} dash />
            <Box x={invX + 28} y={invY + 8} w={6} h={4}>
              <T x={invX + 31} y={invY + 10.7} size={1.4} anchor="middle">
                SPD
              </T>
            </Box>
            {ac ? (
              <Lines
                x={invX + 22}
                y={invY - 14}
                size={1.5}
                gap={1.3}
                lines={[`2-${ac.mm2}mm² THHN`, `+ 1-${ac.groundMm2 ?? 5.5}mm² TW (G)`, `IN ${ac.mm2 >= 14 ? 25 : 20}mmØ PVC`]}
              />
            ) : null}
          </g>
        );
      })}
      {/* Panel board, meter, service */}
      <Box x={pbX} y={pbTop} w={w * 0.2} h={pbH}>
        <T x={pbX + w * 0.1} y={pbTop + 4} size={1.8} bold anchor="middle">
          EXISTING
        </T>
        <T x={pbX + w * 0.1} y={pbTop + 6.5} size={1.8} bold anchor="middle">
          PANEL BOARD
        </T>
      </Box>
      {feeds.map((fy, i) => (
        <circle key={i} cx={pbX} cy={fy} r={0.6} fill={INK} />
      ))}
      <L d={`M ${pbX + w * 0.1} ${pbTop + pbH} L ${pbX + w * 0.1} ${pbTop + pbH + 8}`} />
      <Box x={pbX + w * 0.1 - 6} y={pbTop + pbH + 1.5} w={4} h={3}>
        <T x={pbX + w * 0.1 - 4} y={pbTop + pbH + 3.7} size={1.3} anchor="middle">
          CT
        </T>
      </Box>
      <Meter x={pbX + w * 0.1} y={pbTop + pbH + 11} />
      <T x={pbX + w * 0.1 + 4} y={pbTop + pbH + 10.5} size={1.6}>
        BI-DIRECTIONAL
      </T>
      <T x={pbX + w * 0.1 + 4} y={pbTop + pbH + 12.7} size={1.6}>
        METER
      </T>
      <L d={`M ${pbX + w * 0.1} ${pbTop + pbH + 14} L ${pbX + w * 0.1} ${pbTop + pbH + 22}`} />
      <T x={pbX + w * 0.1} y={pbTop + pbH + 25} size={1.7} bold anchor="middle">
        SERVICE ENTRANCE
      </T>
      <T x={pbX + w * 0.1} y={pbTop + pbH + 27.4} size={1.6} anchor="middle">
        230V, 60HZ, SINGLE PHASE
      </T>
      {r.shortCircuit ? (
        <T x={x} y={y + h - 1} size={1.7}>
          {`ALL BREAKERS ${r.shortCircuit.kaic}KAIC MINIMUM. DC/AC RATIO ${r.dcAcRatio ?? '—'} · ${n(r.dcKw)}KWP DC / ${n(r.acKw)}KW AC`}
        </T>
      ) : null}
    </g>
  );
}

/* ------------------------------------------------------------------ *
 * Sheets
 * ------------------------------------------------------------------ */

export function Sheet1({ data }: { data: SheetData }) {
  return (
    <Frame data={data} sheet={1} total={2}>
      <GeneralNotes x={14} y={16} w={88} />
      <ServiceEntrance x={14} y={108} w={88} data={data} />
      <ShortCircuitBlock x={14} y={176} w={88} data={data} />
      <SitePlan x={110} y={16} w={100} h={110} data={data} />
      <VicinityMap x={110} y={134} w={100} h={62} data={data} />
      <VoltageDropBlock x={110} y={210} w={100} data={data} />
      <SingleLine x={218} y={16} w={112} h={170} data={data} />
      <StringCalc x={218} y={200} w={112} data={data} />
      <InverterSpec x={338} y={16} w={70} data={data} />
      <g>
        <Heading x={338} y={60} w={70}>
          UNITS / ABBREVIATIONS
        </Heading>
        <Lines x={338} y={66} lines={ABBREVIATIONS} size={1.9} />
      </g>
      <Legends x={338} y={110} w={70} />
      {data.result.warnings.length ? (
        <g>
          <Heading x={338} y={166} w={70}>
            DESIGN NOTES
          </Heading>
          <Lines x={338} y={172} lines={data.result.warnings.flatMap((m) => wrap(m.toUpperCase(), 44)).slice(0, 28)} size={1.7} />
        </g>
      ) : null}
    </Frame>
  );
}

export function Sheet2({ data }: { data: SheetData }) {
  const { loads } = data.doc.inputs.plan;
  const pv = data.result.circuits.filter((c) => c.kind === 'ac');
  const rows = [
    ...loads.map((l, i) => ({ ckt: String(i + 1), ...l })),
    ...pv.map((c, i) => ({
      ckt: String(loads.length + i + 1),
      description: `SOLAR PV (${c.label.split(' ')[0]})`,
      va: 0,
      breakerA: c.breakerA ?? 0,
      wire: `2-${c.mm2}mm², 1-${c.groundMm2 ?? 5.5}mm² (G)`,
    })),
  ];
  const totalVa = loads.reduce((a, l) => a + l.va, 0);
  const demandA = (totalVa * 0.7) / 230;
  const cols = [
    { head: 'CKT', w: 10 },
    { head: 'DESCRIPTION', w: 52 },
    { head: 'VA', w: 16 },
    { head: 'AT', w: 12 },
    { head: 'P', w: 8 },
    { head: 'WIRES (THHN / TW G)', w: 50 },
  ];
  const tx = 16;
  const ty = 30;
  const rh = 5;
  const tw = cols.reduce((a, c) => a + c.w, 0);
  const p = data.result.panel;
  const riserX = 190;
  const half = Math.ceil(rows.length / 2);

  return (
    <Frame data={data} sheet={2} total={2}>
      <Heading x={tx} y={20} w={tw}>
        SCHEDULE OF LOADS
      </Heading>
      <rect x={tx} y={ty} width={tw} height={rh * (rows.length + 2)} fill="none" stroke={INK} strokeWidth={0.35} />
      {
        cols.reduce<{ x: number; els: ReactNode[] }>(
          (acc, c, i) => {
            acc.els.push(
              <g key={c.head}>
                {i > 0 ? (
                  <line x1={acc.x} y1={ty} x2={acc.x} y2={ty + rh * (rows.length + 1)} stroke={INK} strokeWidth={0.25} />
                ) : null}
                <T x={acc.x + c.w / 2} y={ty + 3.4} size={1.8} bold anchor="middle">
                  {c.head}
                </T>
              </g>,
            );
            acc.x += c.w;
            return acc;
          },
          { x: tx, els: [] },
        ).els
      }
      {rows.map((row, i) => {
        const y = ty + rh * (i + 1);
        const cells = [
          row.ckt,
          row.description.toUpperCase(),
          row.va ? String(row.va) : '—',
          String(row.breakerA),
          '2',
          row.wire,
        ];
        let cx = tx;
        return (
          <g key={i}>
            <line x1={tx} y1={y} x2={tx + tw} y2={y} stroke={INK} strokeWidth={0.2} />
            {cells.map((v, k) => {
              const at = cx;
              cx += cols[k].w;
              return (
                <T
                  key={k}
                  x={k === 1 || k === 5 ? at + 1.5 : at + cols[k].w / 2}
                  y={y + 3.4}
                  size={1.8}
                  anchor={k === 1 || k === 5 ? 'start' : 'middle'}>
                  {v}
                </T>
              );
            })}
          </g>
        );
      })}
      <line
        x1={tx}
        y1={ty + rh * (rows.length + 1)}
        x2={tx + tw}
        y2={ty + rh * (rows.length + 1)}
        stroke={INK}
        strokeWidth={0.25}
      />
      <T x={tx + 1.5} y={ty + rh * (rows.length + 1) + 3.4} size={1.9} bold>
        {`TOTAL VA LOAD ${totalVa.toLocaleString('en-PH')}`}
      </T>
      <Lines
        x={tx}
        y={ty + rh * (rows.length + 2) + 5}
        size={1.9}
        lines={[
          `DEMAND LOAD IN AMPERES: IL @ 70% D.F. = ${totalVa.toLocaleString('en-PH')} × 70% / 230V = ${n(demandA)} A`,
          ...(rows.length ? [] : ['ADD THE HOUSE CIRCUITS ON THE DESIGN PAGE (STEP 4) TO FILL THIS SCHEDULE.']),
        ]}
      />

      <Heading x={riserX} y={20} w={80}>
        RISER DIAGRAM
      </Heading>
      <Box x={riserX + 22} y={30} w={36} h={Math.max(30, half * 9 + 10)} />
      <L d={`M ${riserX + 40} 30 L ${riserX + 40} ${30 + Math.max(30, half * 9 + 10)}`} w={0.6} />
      {rows.map((row, i) => {
        const left = i % 2 === 0;
        const y = 38 + Math.floor(i / 2) * 9;
        const bx = left ? riserX + 31 : riserX + 49;
        return (
          <g key={i}>
            <L d={left ? `M ${riserX + 40} ${y} L ${bx + 3} ${y}` : `M ${riserX + 40} ${y} L ${bx - 3} ${y}`} />
            <Breaker x={bx} y={y} label={`${row.breakerA}AT`} />
            <L d={left ? `M ${bx - 3} ${y} L ${riserX + 14} ${y}` : `M ${bx + 3} ${y} L ${riserX + 66} ${y}`} />
            <T x={left ? riserX + 12 : riserX + 68} y={y + 0.7} size={2} bold anchor={left ? 'end' : 'start'}>
              {row.ckt}
            </T>
          </g>
        );
      })}
      <Ground x={riserX + 40} y={30 + Math.max(30, half * 9 + 10)} />

      <Heading x={290} y={20} w={110}>
        PV MODULE DATASHEET
      </Heading>
      <Box x={290} y={28} w={116} h={96} />
      <Lines
        x={294}
        y={35}
        size={2.1}
        gap={1.5}
        lines={[
          p.model.toUpperCase(),
          '',
          `RATED POWER (PMAX)         ${p.watts} Wp`,
          `OPEN CIRCUIT VOLTAGE (VOC) ${n(p.vocV)} V`,
          `SHORT CIRCUIT CURRENT (ISC) ${n(p.iscA)} A`,
          `MAX. POWER VOLTAGE (VMP)    ${n(p.vmpV)} V`,
          `MAX. POWER CURRENT (IMP)    ${n(p.impA)} A`,
          `TEMP. COEFF. OF VOC         ${p.vocTempCoeffPct} %/°C`,
          `MAX. SERIES FUSE RATING     ${p.maxSeriesFuseA} A`,
          `DIMENSIONS                  ${p.lengthMm} × ${p.widthMm} × ${p.thicknessMm} mm`,
          `WEIGHT                      ${p.weightKg} kg`,
          '',
          `ARRAY: ${data.result.panels} MODULES, ${n(data.result.dcKw)} KWP`,
          ...data.result.strings.map(
            (s) => `STRING ${s.id}: ${s.series}S, VOC ${n(s.vocV)}V, VMP ${n(s.vmpV)}V, IMP ${n(s.impA)}A`,
          ),
        ]}
      />
    </Frame>
  );
}

/** Both sheets, for the screen preview and the print copy. */
export function PlanSheets({ data }: { data: SheetData }) {
  return (
    <>
      <Sheet1 data={data} />
      <Sheet2 data={data} />
    </>
  );
}
