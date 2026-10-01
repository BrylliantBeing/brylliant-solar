import { useMemo, useState } from 'react';
import { Platform, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MotionScrollView, Reveal } from '@/components/motion';
import { ThemedText } from '@/components/themed-text';
import { Bullet, Button, Callout, Card, Chip, Rule, Stat } from '@/components/ui/kit';
import { Collapsible } from '@/components/ui/collapsible';
import { BottomTabInset, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import {
  COMMERCIAL_LABELS,
  Model,
  RESIDENTIAL_LABELS,
  type PeakBaseRatio,
  type ResidentialProfile,
  type Segment,
  estimate,
  kwh,
  kwhFromBill,
  peso,
  pesoRange,
  segmentFor,
  yearsRange,
} from '@/constants/solar';
import { useTheme } from '@/hooks/use-theme';

const QUICK_BILLS: Record<Segment, number[]> = {
  residential: [2400, 3600, 6000, 12000],
  commercial: [25000, 45000, 90000, 180000],
};

const TARGETS = [50, 60, 70, 80, 90];
const RESIDENTIAL_KEYS: ResidentialProfile[] = ['typical', 'away', 'home', 'aircon'];
const RATIO_KEYS: PeakBaseRatio[] = [10, 15, 20, 30];

export default function EstimateScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();

  const [segment, setSegment] = useState<Segment>('residential');
  const [bill, setBill] = useState('3600');
  const [profile, setProfile] = useState<ResidentialProfile>('typical');
  const [ratio, setRatio] = useState<PeakBaseRatio>(20);
  const [targetPct, setTargetPct] = useState(80);

  // assumptions, held as strings so the fields stay editable mid-keystroke
  const [gridRate, setGridRate] = useState(String(Model.gridRate));
  const [yieldPerKwp, setYield] = useState(String(Model.yieldPerKwp));
  const [exportRatio, setExportRatio] = useState(String(Model.exportRatio));
  const [openDays, setOpenDays] = useState(String(Model.openDaysPerWeek));
  const [fixedCharge, setFixed] = useState(String(Model.fixedCharge));

  const num = (v: string, fallback: number) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : fallback;
  };

  const rate = num(gridRate, Model.gridRate);
  const fixed = num(fixedCharge, Model.fixedCharge);
  const monthlyKwh = kwhFromBill(num(bill, 0), rate, fixed);

  const result = useMemo(
    () =>
      estimate({
        segment,
        profile,
        peakBaseRatio: ratio,
        monthlyKwh,
        targetPct,
        yieldPerKwp: num(yieldPerKwp, Model.yieldPerKwp),
        exportRatio: num(exportRatio, Model.exportRatio),
        gridRate: rate,
        fixedCharge: fixed,
        openDaysPerWeek: num(openDays, Model.openDaysPerWeek),
      }),
    [segment, profile, ratio, monthlyKwh, targetPct, yieldPerKwp, exportRatio, rate, fixed, openDays]
  );

  function chooseSegment(next: Segment) {
    setSegment(next);
    setBill(String(QUICK_BILLS[next][1]));
  }

  const suggested = segmentFor(monthlyKwh);
  const empty = monthlyKwh <= 0;
  const shapeNote =
    segment === 'residential'
      ? RESIDENTIAL_LABELS[profile].blurb
      : COMMERCIAL_LABELS[ratio].blurb;

  return (
    <MotionScrollView
      style={{ backgroundColor: t.background }}
      contentContainerStyle={[
        styles.content,
        { paddingBottom: insets.bottom + BottomTabInset + Spacing.six },
        Platform.OS === 'web' && { paddingTop: Spacing.six },
      ]}
      keyboardShouldPersistTaps="handled">
      <View style={styles.inner}>
        <Reveal>
          <ThemedText type="eyebrow" themeColor="textMuted">
            Estimate · grid-tie
          </ThemedText>
          <ThemedText type="title" style={{ marginTop: Spacing.two }}>
            What would solar do to your bill?
          </ThemedText>
          <ThemedText type="lede" themeColor="textSecondary" style={{ marginTop: Spacing.two }}>
            Two models sit behind this: household load shapes for homes, and a measured
            office-and-retail shape for businesses. Both run a five-minute simulation of a whole
            month against your roof. Every assumption is shown below and you can change any of them.
          </ThemedText>
        </Reveal>

        {/* ---- inputs ---- */}
        <Reveal delay={90}>
          <Card style={{ marginTop: Spacing.four }}>
            <ThemedText type="eyebrow" themeColor="textMuted">
              Residential or commercial?
            </ThemedText>
            <View style={styles.chipRow}>
              <Chip
                label="Residential"
                selected={segment === 'residential'}
                onPress={() => chooseSegment('residential')}
              />
              <Chip
                label="Commercial"
                selected={segment === 'commercial'}
                onPress={() => chooseSegment('commercial')}
              />
            </View>

            <Rule />

            <ThemedText type="eyebrow" themeColor="textMuted">
              Average monthly bill
            </ThemedText>
            <View
              style={[styles.inputRow, { borderColor: t.lineStrong, backgroundColor: t.background }]}>
              <ThemedText type="dataLarge" themeColor="textMuted">
                ₱
              </ThemedText>
              <TextInput
                value={bill}
                onChangeText={setBill}
                keyboardType="numeric"
                inputMode="numeric"
                accessibilityLabel="Average monthly electricity bill in pesos"
                style={[styles.input, { color: t.text }]}
                placeholder="3600"
                placeholderTextColor={t.textMuted}
              />
            </View>
            <ThemedText type="small" themeColor="textMuted">
              That is about {kwh(monthlyKwh)} a month at {peso(rate)}/kWh.
            </ThemedText>
            <View style={styles.chipRow}>
              {QUICK_BILLS[segment].map((b) => (
                <Chip
                  key={b}
                  label={peso(b)}
                  selected={num(bill, 0) === b}
                  onPress={() => setBill(String(b))}
                />
              ))}
            </View>
            {!empty && suggested !== segment ? (
              <ThemedText type="small" themeColor="textMuted">
                A bill this size is usually{' '}
                <ThemedText type="smallBold">
                  {suggested === 'commercial' ? 'commercial' : 'residential'}
                </ThemedText>
                . The load shape matters more than the size, so pick whichever describes the
                building.
              </ThemedText>
            ) : null}

            <Rule />

            {segment === 'residential' ? (
              <>
                <ThemedText type="eyebrow" themeColor="textMuted">
                  Which describes the household?
                </ThemedText>
                <View style={styles.chipRow}>
                  {RESIDENTIAL_KEYS.map((k) => (
                    <Chip
                      key={k}
                      label={RESIDENTIAL_LABELS[k].name}
                      selected={k === profile}
                      onPress={() => setProfile(k)}
                    />
                  ))}
                </View>
              </>
            ) : (
              <>
                <ThemedText type="eyebrow" themeColor="textMuted">
                  How much shuts down at night?
                </ThemedText>
                <View style={styles.chipRow}>
                  {RATIO_KEYS.map((k) => (
                    <Chip
                      key={k}
                      label={COMMERCIAL_LABELS[k].name}
                      selected={k === ratio}
                      onPress={() => setRatio(k)}
                    />
                  ))}
                </View>
              </>
            )}
            <ThemedText type="small" themeColor="textSecondary">
              {shapeNote}
            </ThemedText>

            <Rule />

            <ThemedText type="eyebrow" themeColor="textMuted">
              How much of the bill should it remove?
            </ThemedText>
            <View style={styles.chipRow}>
              {TARGETS.map((p) => (
                <Chip
                  key={p}
                  label={`${p}%`}
                  selected={p === targetPct}
                  onPress={() => setTargetPct(p)}
                />
              ))}
            </View>
          </Card>
        </Reveal>

        {/* ---- results ---- */}
        {empty ? (
          <Reveal>
            <Card style={{ marginTop: Spacing.three }}>
              <ThemedText type="heading">That bill is already at the connection charge</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Put in what you actually pay in an average month and we will size against it.
              </ThemedText>
            </Card>
          </Reveal>
        ) : (
          <Reveal delay={160}>
            <View style={styles.statGrid}>
              <Stat
                hero
                label="Estimated new bill"
                value={peso(result.billAfter)}
                sub={
                  result.atFloor
                    ? `Down to the connection charge — saving ${peso(result.monthlySaving)}/mo`
                    : `Down from ${peso(result.billBefore)} — saving ${peso(result.monthlySaving)} a month`
                }
              />
              <Stat
                label="System"
                value={`${result.installedKwp.toFixed(2)} kWp`}
                sub={`${result.panels} × ${Model.panelWatts} Wp · ${result.inverterKw.toFixed(1)} kW inverter`}
              />
              <Stat
                label="Bill removed"
                value={`${Math.round(result.reductionPct)}%`}
                sub={`Sized for ${targetPct}%; whole panels overshoot`}
              />
              <Stat
                label="Used on site"
                value={`${Math.round(result.selfSharePct)}%`}
                sub={`${kwh(result.selfKwh)} used as generated, ${kwh(result.exportKwh)} exported`}
              />
              <Stat
                label="Installed cost"
                value={pesoRange(result.costLow, result.costHigh)}
                sub="Range is the balance-of-system band, not a quotation"
              />
              <Stat
                label="Rough payback"
                value={yearsRange(result.paybackLow, result.paybackHigh)}
                sub="Before degradation, maintenance and financing"
              />
            </View>

            <Card style={{ marginTop: Spacing.three }}>
              <ThemedText type="eyebrow" themeColor="textMuted">
                The month, kilowatt-hour by kilowatt-hour
              </ThemedText>
              <View style={{ marginTop: Spacing.two, gap: Spacing.one }}>
                <Line label="You use" value={kwh(result.monthlyKwh)} />
                <Line label="Your roof generates" value={kwh(result.generation)} />
                <Line label="Used as it is generated" value={kwh(result.selfKwh)} />
                <Line label="Exported to the grid" value={kwh(result.exportKwh)} />
                <Line label="Still imported" value={kwh(result.importKwh)} />
                <Line
                  label={`Net billed, after ${num(exportRatio, Model.exportRatio)}:1 export credit`}
                  value={kwh(result.billedKwh)}
                  strong
                />
              </View>
              <ThemedText type="small" themeColor="textMuted" style={{ marginTop: Spacing.two }}>
                {segment === 'residential'
                  ? `Peak household draw about ${result.peakKw.toFixed(2)} kW, in the evening after the sun has gone.`
                  : `Base load about ${result.baseKw.toFixed(2)} kW around the clock, peaking near ${result.peakKw.toFixed(1)} kW at 15:00.`}
              </ThemedText>
              <Button label="Book the free survey" href="/book" tone="sun" full />
            </Card>

            <Reveal delay={90}>
              <Callout title="Why the export ratio is the number that hurts">
                Power you use the moment it is generated offsets your bill one for one. Surplus you
                push to the grid is credited at {num(exportRatio, Model.exportRatio)} kWh exported
                per 1 kWh credited. This system uses{' '}
                {Math.round(result.selfSharePct)}% of its own output on site
                {segment === 'commercial'
                  ? ' — which is why commercial roofs pay back faster than houses.'
                  : ', so a good share of it takes that haircut.'}
              </Callout>
            </Reveal>
          </Reveal>
        )}

        {/* ---- assumptions ---- */}
        <Reveal style={{ marginTop: Spacing.four }}>
          <Collapsible title="Assumptions — change any of these">
            <View style={styles.fieldGrid}>
              <Field label="Grid rate ₱/kWh" value={gridRate} onChange={setGridRate} />
              <Field label="Yield kWh/kWp/day" value={yieldPerKwp} onChange={setYield} />
              <Field label="Export ratio (kWh per credit)" value={exportRatio} onChange={setExportRatio} />
              <Field label="Fixed charge ₱/mo" value={fixedCharge} onChange={setFixed} />
              {segment === 'commercial' ? (
                <Field label="Open days per week" value={openDays} onChange={setOpenDays} />
              ) : null}
            </View>
            <ThemedText type="small" themeColor="textMuted" style={{ marginTop: Spacing.three }}>
              Yield is the dominant input — everything scales inversely with it, and a wrong figure
              moves the quote by about a third. {Model.yieldPerKwp} kWh/kWp/day is measured on one
              Zamboanga array; your roof will differ. Set the export ratio to 1 if you have full
              retail net metering, in which case the load shape stops mattering entirely.
            </ThemedText>
          </Collapsible>
        </Reveal>

        <Reveal delay={90}>
          <Callout title="What this figure is and isn’t">
            An average-day model: no cloudy days, no seasonal variation, and the load shape assumed
            to repeat. The household shapes are constructed archetypes, not metered data — no public
            dataset of hourly Philippine household consumption exists. Annual figures are one month
            multiplied by twelve. Fine for deciding whether to proceed; not a design document.
          </Callout>
        </Reveal>

        <View style={{ marginTop: Spacing.four, gap: Spacing.two }}>
          <Reveal>
            <Bullet>
              Panels priced on a real supplier quote — Jinko 720 Wp at USD 0.115/W, ₱62 to the
              dollar, plus 12% VAT.
            </Bullet>
          </Reveal>
          <Reveal delay={70}>
            <Bullet>
              At that price panels are only 13–18% of the job. The balance-of-system rate is what
              decides your quotation, and it is the number we replace after a survey.
            </Bullet>
          </Reveal>
          <Reveal delay={140}>
            <Bullet>
              Three-phase customers: we confirm delta against wye before specifying an inverter.
              Both print as “3 phase” on a bill and an inverter for one will not run on the other.
            </Bullet>
          </Reveal>
        </View>
      </View>
    </MotionScrollView>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  const t = useTheme();
  return (
    <View style={[styles.line, strong && { borderTopWidth: 1, borderTopColor: t.line, paddingTop: Spacing.two }]}>
      <ThemedText type={strong ? 'smallBold' : 'small'} themeColor={strong ? 'text' : 'textSecondary'}>
        {label}
      </ThemedText>
      <ThemedText type="data" style={{ color: strong ? t.accent : t.text, fontSize: 14 }}>
        {value}
      </ThemedText>
    </View>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const t = useTheme();
  return (
    <View style={styles.field}>
      <ThemedText type="eyebrow" themeColor="textMuted">
        {label}
      </ThemedText>
      <TextInput
        value={value}
        onChangeText={onChange}
        keyboardType="numeric"
        inputMode="numeric"
        placeholder={placeholder}
        placeholderTextColor={t.textMuted}
        accessibilityLabel={label}
        style={[
          styles.fieldInput,
          { color: t.text, borderColor: t.lineStrong, backgroundColor: t.background },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: Spacing.four, paddingTop: Spacing.four, alignItems: 'center' },
  inner: { width: '100%', maxWidth: MaxContentWidth },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.three,
  },
  input: { flex: 1, fontSize: 24, fontWeight: '600', paddingVertical: Spacing.three * 0.75 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginTop: Spacing.three },
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: Spacing.three },
  fieldGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  field: { gap: Spacing.one, flexGrow: 1, flexBasis: 140 },
  fieldInput: {
    borderWidth: 1,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
    fontSize: 15,
  },
});
