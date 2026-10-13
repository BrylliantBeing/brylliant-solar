import { compass, DESIGN_DEFAULTS, type CircuitOverride, type DesignResult, type DesignSettings } from '@calculator/pvDesign';
import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { KeyValue, MessageList, NumberInput, Panel, SmallButton, Table } from '@/components/internal/quote-parts';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { Model } from '@/constants/solar';
import { useTheme } from '@/hooks/use-theme';
import type { Savings } from '@/lib/design-savings';
import type { DesignPrice } from '@/lib/price-list';
import type { SunData } from '@/lib/pvgis';

const f = (n: number, dp = 1) => n.toLocaleString('en-PH', { maximumFractionDigits: dp, minimumFractionDigits: dp });

/** Settings worth editing per job; the rest stay at DESIGN_DEFAULTS. */
const SETTING_FIELDS: { key: keyof DesignSettings; label: string; unit: string; help?: string }[] = [
  { key: 'minAmbientC', label: 'Coldest morning', unit: '°C', help: 'Sets the cold-corrected Voc.' },
  {
    key: 'referenceTiltDeg',
    label: 'Reference array tilt',
    unit: '°',
    help: 'Your logged 1.95 kWp array, measured on the frame.',
  },
  { key: 'referenceAzimuthDeg', label: 'Reference array facing', unit: '°', help: '0 N, 90 E, 180 S, 270 W.' },
  { key: 'calibrationOverride', label: 'Fixed sun factor', unit: '×', help: '0 = calibrate from the reference array.' },
  { key: 'vdropLimitPct', label: 'Voltage drop limit', unit: '%' },
  { key: 'minDcMm2', label: 'Smallest PV wire', unit: 'mm²' },
  { key: 'slackPct', label: 'Slack on runs', unit: '%' },
  { key: 'inverterMountM', label: 'Inverter height', unit: 'm', help: 'Above its floor.' },
  { key: 'acExtraM', label: 'Extra AC length', unit: 'm', help: 'E.g. up a meter pole.' },
  { key: 'railStockM', label: 'Rail length', unit: 'm' },
  { key: 'footSpacingM', label: 'L-foot spacing', unit: 'm' },
  { key: 'railOverhangM', label: 'Rail overhang', unit: 'm', help: 'Past the end panel, each end.' },
  { key: 'pvCableRollM', label: 'PV cable roll', unit: 'm' },
  { key: 'transformerKva', label: 'Transformer', unit: 'kVA', help: 'From the pole transformer nameplate.' },
  { key: 'transformerZPct', label: 'Transformer %Z', unit: '%' },
  { key: 'serviceDropM', label: 'Service drop', unit: 'm', help: 'Transformer to the main service equipment.' },
  { key: 'serviceDropMm2', label: 'Service drop wire', unit: 'mm²' },
];

export function DesignResults({
  result,
  settings,
  overrides,
  onSettings,
  onOverrides,
  sunData,
  price,
  savings,
  pricesNote,
}: {
  result: DesignResult;
  settings: Partial<DesignSettings>;
  overrides: Record<string, CircuitOverride>;
  onSettings: (s: Partial<DesignSettings>) => void;
  onOverrides: (o: Record<string, CircuitOverride>) => void;
  sunData?: SunData;
  price?: DesignPrice | null;
  savings?: Savings | { error: string } | null;
  pricesNote?: string | null;
}) {
  const t = useTheme();
  const r = result;

  function setOverride(id: string, key: keyof CircuitOverride, text: string) {
    const n = Number(text);
    const next = { ...overrides[id] };
    if (text.trim() === '' || !(n > 0)) delete next[key];
    else next[key] = n;
    const all = { ...overrides };
    if (next.mm2 === undefined && next.breakerA === undefined) delete all[id];
    else all[id] = next;
    onOverrides(all);
  }

  return (
    <View style={{ gap: Spacing.three }}>
      <MessageList title="Check these" items={r.warnings} tone="warn" />

      <Panel title="System">
        <KeyValue label="Panels" value={`${r.panels} × ${r.panel.watts} W`} sub={r.panel.model} />
        <KeyValue label="DC capacity" value={`${f(r.dcKw, 2)} kWp`} />
        <KeyValue
          label="AC capacity"
          value={`${f(r.acKw, 2)} kW`}
          sub={r.inverters.map((i) => `${i.id}: ${i.spec.model}`).join(' · ')}
        />
        <KeyValue label="DC/AC ratio" value={r.dcAcRatio === null ? '—' : f(r.dcAcRatio, 2)} />
      </Panel>

      {price ? <PriceBillPanel price={price} savings={savings ?? null} note={pricesNote ?? null} /> : null}

      <SunPanel result={r} sunData={sunData} />

      <Panel title="Strings">
        <Table
          head={['String', 'Inverter', 'Panels', 'Voc', `Voc cold`, 'Vmp', 'Isc', 'Imp', 'kWp']}
          rows={r.strings.map((s) => [
            s.id,
            `${s.inverterId} · MPPT${s.mppt + 1}`,
            String(s.series),
            `${f(s.vocV)} V`,
            `${f(s.vocColdV)} V`,
            `${f(s.vmpV)} V`,
            `${f(s.iscA, 2)} A`,
            `${f(s.impA, 2)} A`,
            f(s.powerW / 1000, 2),
          ])}
        />
        <Table
          head={['MPPT', 'Strings', 'Isc', 'Isc limit', 'Imp', 'Imp limit']}
          rows={r.mppts.map((m) => [
            `${m.inverterId} · MPPT${m.mppt + 1}`,
            m.stringIds.join(' ‖ '),
            `${f(m.iscA, 2)} A`,
            `${m.maxIscA} A`,
            `${f(m.impA, 2)} A`,
            `${m.maxInputA} A`,
          ])}
        />
      </Panel>

      <Panel title="Wires & breakers">
        <ThemedText type="small" themeColor="textMuted">
          Sized automatically: breaker at 1.56 × Isc (DC) or 1.25 × max output (AC), wire to carry the breaker, then larger until
          the drop is within {settings.vdropLimitPct ?? DESIGN_DEFAULTS.vdropLimitPct}%. Type a size to override it; it is
          checked, not changed.
        </ThemedText>
        {r.circuits.map((c) => {
          const over = c.vdropPct > (settings.vdropLimitPct ?? DESIGN_DEFAULTS.vdropLimitPct);
          return (
            <View key={c.id} style={[styles.circuit, { borderColor: over ? t.accentWarm : t.line }]}>
              <View style={{ flex: 1, minWidth: 220, gap: 2 }}>
                <ThemedText type="smallBold">
                  {c.label}{' '}
                  <ThemedText type="small" themeColor="textMuted">
                    · {c.kind.toUpperCase()}
                  </ThemedText>
                </ThemedText>
                <ThemedText type="data" style={{ fontSize: 12 }}>
                  {c.breakerA ?? '—'} AT · {c.mm2} mm²{c.awg ? ` (${c.awg})` : ''} · {c.ampacityA} A
                  {c.groundMm2 ? ` · ${c.groundMm2} mm² G` : ''}
                </ThemedText>
                <ThemedText type="data" themeColor="textMuted" style={{ fontSize: 12 }}>
                  {f(c.oneWayM)} m one-way{c.estimated ? ' (estimated)' : ''} · {f(c.cableM)} m of wire · design {f(c.designA, 2)}{' '}
                  A
                </ThemedText>
                <ThemedText type="data" style={{ fontSize: 12, color: over ? t.accentWarm : t.textSecondary }}>
                  Vdrop {f(c.vdropV, 2)} V = {f(c.vdropPct, 2)}% of {f(c.nominalV)} V at {f(c.vdropCurrentA, 2)} A
                  {c.upsizedForVdrop ? ' · upsized for drop' : ''}
                </ThemedText>
              </View>
              <OverrideField label="Wire mm²" value={overrides[c.id]?.mm2} onChange={(v) => setOverride(c.id, 'mm2', v)} />
              <OverrideField
                label="Breaker A"
                value={overrides[c.id]?.breakerA}
                onChange={(v) => setOverride(c.id, 'breakerA', v)}
              />
            </View>
          );
        })}
        {Object.keys(overrides).length ? <SmallButton label="Clear all overrides" onPress={() => onOverrides({})} /> : null}
      </Panel>

      {r.shortCircuit ? (
        <Panel title="Short circuit">
          <KeyValue
            label="Transformer"
            value={`${r.shortCircuit.transformerKva} kVA, ${r.shortCircuit.zPct}% Z`}
            sub={`IFLA ${f(r.shortCircuit.iflaA, 2)} A · multiplier ${f(r.shortCircuit.multiplier, 2)}`}
          />
          <KeyValue label="X1 transformer secondary" value={`${f(r.shortCircuit.x1A, 0)} A`} />
          {r.shortCircuit.points.map((p, i) => (
            <KeyValue
              key={p.label}
              label={`X${i + 2} ${p.label}`}
              value={`${f(p.iscA, 0)} A`}
              sub={`${f(p.lengthM)} m of ${p.mm2} mm² · f ${p.f} · M ${p.m}`}
            />
          ))}
          <KeyValue label="Breaker interrupting rating" value={`${r.shortCircuit.kaic} kAIC min`} total />
        </Panel>
      ) : null}

      <Panel title="Materials">
        <Table
          head={['Item', 'Category', 'Qty', 'How', 'Each', 'Total']}
          rows={(price?.lines ?? r.bom.map((l) => ({ ...l, unitPrice: null, total: 0 }))).map((l) => [
            l.name,
            l.category,
            `${l.qty}${l.unit ? ` ${l.unit}` : ''}`,
            l.detail ?? '',
            l.unitPrice === null ? 'no price' : peso(l.unitPrice),
            l.unitPrice === null ? '—' : peso(l.total),
          ])}
          foot={price ? ['Materials', '', '', '', '', peso(price.materials)] : undefined}
        />
      </Panel>

      <Panel title="Design settings">
        <View style={styles.grid}>
          {SETTING_FIELDS.map((field) => {
            const value = settings[field.key] ?? DESIGN_DEFAULTS[field.key];
            return (
              <NumberInput
                key={field.key}
                label={field.label}
                unit={field.unit}
                help={field.help}
                value={String(value)}
                changed={settings[field.key] !== undefined}
                onChange={(v) => {
                  const next = { ...settings };
                  const n = Number(v);
                  if (v.trim() === '' || !Number.isFinite(n) || n === DESIGN_DEFAULTS[field.key]) delete next[field.key];
                  else (next as Record<string, number>)[field.key] = n;
                  onSettings(next);
                }}
              />
            );
          })}
        </View>
      </Panel>
    </View>
  );
}

/** Commits on blur, so a half-typed size doesn't recalculate on every keystroke. */
const peso = (n: number) => `₱${Math.round(n).toLocaleString('en-PH')}`;

/** The job's price and what the layout as drawn does to the bill; both follow every panel added or removed. */
function PriceBillPanel({
  price,
  savings,
  note,
}: {
  price: DesignPrice;
  savings: Savings | { error: string } | null;
  note: string | null;
}) {
  const ok = savings && !('error' in savings) ? savings : null;
  const payback = ok && ok.annualSaving > 0 ? price.total / ok.annualSaving : null;
  return (
    <Panel title="Price & bill">
      <KeyValue label="Materials" value={peso(price.materials)} sub={`${price.lines.length} lines from the design`} />
      <KeyValue
        label="Small parts & extras"
        value={peso(price.extrasTotal)}
        sub="Fittings, ties, lugs, labels, house breaker, safety switch, earthing clips"
      />
      <KeyValue label="Labour, freight, net metering, misc" value={peso(price.jobCosts)} />
      <KeyValue
        label="Total"
        value={peso(price.total)}
        total
        sub={
          price.unpriced.length
            ? `Leaves out ${price.unpriced.length} unpriced: ${price.unpriced.join(', ')}. Set them on the Prices page.`
            : undefined
        }
      />
      {ok ? (
        <>
          <KeyValue label="Bill" value={`${peso(ok.monthlyBefore)} → ${peso(ok.monthlyAfter)} a month`} sub={ok.basis} />
          <KeyValue
            label="Bill reduction"
            value={`${f(ok.reductionPct, 0)}%`}
            sub={`${peso(ok.annualSaving)} a year${ok.clippedKwh ? ` · inverters clip ${f(ok.clippedKwh, 0)} kWh a year` : ''}`}
            total
          />
          <KeyValue
            label="Simple payback"
            value={payback === null ? '—' : `${f(payback, 1)} years`}
            sub="Total price ÷ yearly saving"
          />
        </>
      ) : (
        <ThemedText type="small" themeColor="accentWarm">
          {savings && 'error' in savings ? savings.error : 'Working out the bill…'}
        </ThemedText>
      )}
      {note ? (
        <ThemedText type="small" themeColor="accentWarm">
          {note}
        </ThemedText>
      ) : null}
    </Panel>
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Expected generation by roof face, from PVGIS less the derate. */
function SunPanel({ result: r, sunData }: { result: DesignResult; sunData?: SunData }) {
  const sun = r.sun;
  if (!sun) {
    return (
      <Panel title="Sun">
        <ThemedText type="small" themeColor={sunData?.error ? 'accentWarm' : 'textMuted'}>
          {sunData?.error ?? (sunData?.loading ? 'Fetching sun data from PVGIS…' : 'Draw the site to get sun data.')}
        </ThemedText>
      </Panel>
    );
  }
  const vs = (pct: number) => (Math.abs(pct) < 0.5 ? 'best' : `${pct > 0 ? '+' : ''}${f(pct, 0)}%`);
  const cal = sun.calibration;
  return (
    <Panel
      title="Sun"
      right={
        sunData?.loading ? (
          <ThemedText type="small" themeColor="textMuted">
            Updating…
          </ThemedText>
        ) : undefined
      }>
      <KeyValue
        label="Expected generation"
        value={`${f(sun.kwhPerYear, 0)} kWh/yr`}
        sub={`${f(sun.kwhPerDay)} kWh a day on average`}
        total
      />
      <KeyValue
        label="Yield"
        value={`${f(sun.perKwpDay, 2)} kWh/kWp/day`}
        sub={`Best here: ${f(sun.bestPerKwpDay, 2)} at ${f(sun.best.pitchDeg, 0)}° facing ${compass(sun.best.azimuthDeg)} · quotes assume ${Model.yieldPerKwp}`}
      />
      <Table
        head={['Roof', 'Pitch', 'Faces', 'Panels', 'kWp', 'kWh/kWp/day', 'kWh/yr', 'vs best']}
        rows={sun.faces.map((x) => [
          x.label,
          `${f(x.pitchDeg, 0)}°`,
          x.azimuthDeg === null ? '—' : compass(x.azimuthDeg),
          String(x.panels),
          f(x.kwp, 2),
          f(x.perKwpDay, 2),
          f(x.kwhPerYear, 0),
          vs(x.vsBestPct),
        ])}
      />
      <Table head={['', ...MONTHS]} rows={[['kWh', ...sun.monthlyKwh.map((k) => f(k, 0))]]} />
      <KeyValue
        label="Calibration"
        value={`× ${f(cal.factor, 3)}`}
        sub={
          cal.auto
            ? `Reference array (${cal.tiltDeg}° facing ${compass(cal.azimuthDeg)}), ${cal.window}, ${cal.days} days: measured ${f(cal.measuredPerKwpDay, 2)}, PVGIS ${f(cal.pvgisPerKwpDay, 2)}, so predicted ${f(cal.pvgisPerKwpDay * cal.factor, 2)} kWh/kWp/day`
            : 'Fixed in Design settings, not calibrated'
        }
      />
      <ThemedText type="small" themeColor="textMuted">
        {`${sunData?.source ?? 'PVGIS'} average × the calibration. Shading from trees and neighbours is not included.`}
      </ThemedText>
    </Panel>
  );
}

function OverrideField({ label, value, onChange }: { label: string; value: number | undefined; onChange: (v: string) => void }) {
  const t = useTheme();
  const saved = value !== undefined ? String(value) : '';
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <View style={{ gap: 2 }}>
      <ThemedText type="eyebrow" themeColor={value !== undefined ? 'accentWarm' : 'textMuted'} style={{ fontSize: 10 }}>
        {label}
      </ThemedText>
      <TextInput
        value={draft ?? saved}
        placeholder="auto"
        placeholderTextColor={t.textMuted}
        onChangeText={setDraft}
        onBlur={() => {
          if (draft !== null && draft !== saved) onChange(draft);
          setDraft(null);
        }}
        style={[
          styles.input,
          { borderColor: value !== undefined ? t.accentWarm : t.lineStrong, color: t.text, backgroundColor: t.background },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  circuit: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    alignItems: 'flex-end',
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: Spacing.two,
  },
  input: { width: 84, borderWidth: 1, borderRadius: Radius.sm, paddingHorizontal: Spacing.two, paddingVertical: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
});
