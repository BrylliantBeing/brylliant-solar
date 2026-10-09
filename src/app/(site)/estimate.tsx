import { useEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MotionScrollView, Reveal } from '@/components/motion';
import { ThemedText } from '@/components/themed-text';
import { Bullet, Button, Callout, Card, Chip, Rule, Stat } from '@/components/ui/kit';
import { Collapsible } from '@/components/ui/collapsible';
import { BottomTabInset, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import {
  COMMERCIAL_LABELS,
  RESIDENTIAL_LABELS,
  type PeakBaseRatio,
  type ResidentialProfile,
  type Segment,
  kwh,
  kwhFromBill,
  peso,
  segmentFor,
} from '@/constants/solar';
import { useTheme } from '@/hooks/use-theme';
import { EstimateDefaults, estimateQuote, publicPrice } from '@/lib/estimate-quote';
import { fetchUsdToPhp } from '@/lib/exchange-rate';
import { num, runtimeText } from '@/lib/quote-input';

const QUICK_BILLS: Record<Segment, number[]> = {
  residential: [2400, 3600, 6000, 12000],
  commercial: [25000, 45000, 90000, 180000],
};

const TARGETS = [50, 60, 70, 80, 90, 100];
const RESIDENTIAL_KEYS: ResidentialProfile[] = ['typical', 'away', 'home', 'aircon'];
const RATIO_KEYS: PeakBaseRatio[] = [10, 15, 20, 30];

type System = 'grid-tie' | 'hybrid';

export default function EstimateScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();

  const [segment, setSegment] = useState<Segment>('residential');
  const [bill, setBill] = useState('3600');
  const [profile, setProfile] = useState<ResidentialProfile>('typical');
  const [ratio, setRatio] = useState<PeakBaseRatio>(20);
  const [targetPct, setTargetPct] = useState(80);
  const [system, setSystem] = useState<System>('grid-tie');

  // assumptions, held as strings so the fields stay editable mid-keystroke
  const [importRate, setImportRate] = useState(String(EstimateDefaults.importRate));
  const [exportCredit, setExportCredit] = useState(String(EstimateDefaults.exportCredit));
  const [openDays, setOpenDays] = useState(String(EstimateDefaults.openDaysPerWeek));

  // Hardware is priced in US$, as in the internal calculator; its fallback rate stands until this lands.
  const [usdToPhp, setUsdToPhp] = useState<number | undefined>();
  useEffect(() => {
    const ctrl = new AbortController();
    fetchUsdToPhp(ctrl.signal)
      .then((r) => setUsdToPhp(r.rate))
      .catch(() => {});
    return () => ctrl.abort();
  }, []);

  const num0 = (v: string, fallback: number) => {
    const n = parseFloat(v);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };

  const rate = num0(importRate, EstimateDefaults.importRate);
  const credit = num0(exportCredit, EstimateDefaults.exportCredit);
  const days = num0(openDays, EstimateDefaults.openDaysPerWeek);
  const monthlyKwh = kwhFromBill(num0(bill, 0), rate, 0);
  const empty = monthlyKwh <= 0;

  const outcome = useMemo(() => {
    if (empty) return null;
    try {
      const hybrid = estimateQuote({
        segment,
        profile,
        peakBaseRatio: ratio,
        monthlyKwh,
        targetPct,
        importRate: rate,
        exportCredit: credit,
        openDaysPerWeek: days,
        usdToPhp,
      });
      return { hybrid, gridTie: hybrid.gridTie ?? null, error: null };
    } catch (e) {
      return { hybrid: null, gridTie: null, error: (e as Error).message };
    }
  }, [empty, segment, profile, ratio, monthlyKwh, targetPct, rate, credit, days, usdToPhp]);

  function chooseSegment(next: Segment) {
    setSegment(next);
    setBill(String(QUICK_BILLS[next][1]));
  }

  const suggested = segmentFor(monthlyKwh);
  const shapeNote =
    segment === 'residential'
      ? RESIDENTIAL_LABELS[profile].blurb
      : COMMERCIAL_LABELS[ratio].blurb;

  const q = outcome ? (system === 'hybrid' ? outcome.hybrid : outcome.gridTie) : null;
  const other = outcome ? (system === 'hybrid' ? outcome.gridTie : outcome.hybrid) : null;
  const pb = q ? publicPrice(q) : null;
  const monthly = (annual: number) => annual / 12;

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
            Estimate · grid-tie or battery backup
          </ThemedText>
          <ThemedText type="title" style={{ marginTop: Spacing.two }}>
            What would solar do to your bill?
          </ThemedText>
          <ThemedText type="lede" themeColor="textSecondary" style={{ marginTop: Spacing.two }}>
            This runs the same calculator we quote with. It turns your bill into a week of hourly
            use, then simulates a whole year hour by hour against sun measured on a Zamboanga
            roof, and prices the parts we would actually install.
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
                  selected={num0(bill, 0) === b}
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
              <ThemedText type="heading">Put in a monthly bill</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Put in what you actually pay in an average month and we will size against it.
              </ThemedText>
            </Card>
          </Reveal>
        ) : !q || !pb ? (
          <Reveal>
            <Card style={{ marginTop: Spacing.three }}>
              <ThemedText type="heading">We couldn’t size this one</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {outcome?.error ?? 'No system meets this target.'} Try a lower target, or book a
                survey and we will size it by hand.
              </ThemedText>
            </Card>
          </Reveal>
        ) : (
          <Reveal delay={160}>
            <View style={[styles.chipRow, { marginTop: Spacing.three }]}>
              <Chip
                label="Grid-tie"
                selected={system === 'grid-tie'}
                onPress={() => setSystem('grid-tie')}
              />
              <Chip
                label="With battery backup"
                selected={system === 'hybrid'}
                onPress={() => setSystem('hybrid')}
              />
            </View>

            <View style={styles.statGrid}>
              <Stat
                hero
                label="Estimated new bill"
                value={peso(q.bill.averageMonthlyAfter)}
                sub={`Down from ${peso(q.bill.averageMonthlyBefore)} — saving ${peso(pb.annualSaving / 12)} a month`}
              />
              <Stat
                label="System"
                value={`${num(q.panels.systemKw, 2)} kWp`}
                sub={
                  `${q.panels.count} × ${q.panels.wattsEach} W · ${q.inverter.count} × ${q.inverter.ratingKwEach} kW inverter` +
                  (q.battery.units > 0 ? ` · ${num(q.battery.installedKwh, 0)} kWh battery` : '')
                }
              />
              <Stat
                label="Bill removed"
                value={`${Math.round(q.bill.reductionPercent)}%`}
                sub={targetPct < 100 ? `Sized for ${targetPct}%; whole panels overshoot` : 'Export credit covers every peso imported'}
              />
              <Stat
                label="In a brownout"
                value={
                  q.outageRuntime
                    ? runtimeText(q.outageRuntime.afterSunset.medianHours, q.outageRuntime.maxHours)
                    : 'No power'
                }
                sub={
                  q.outageRuntime
                    ? 'Typical runtime for an outage starting after sunset'
                    : 'Grid-tie inverters shut down with the grid, even in full sun'
                }
              />
              <Stat
                label="Installed price"
                value={peso(pb.price)}
                sub="Supplied and installed; confirmed after a survey"
              />
              <Stat
                label="Simple payback"
                value={pb.years === null ? '—' : pb.years > 25 ? '25+ yrs' : `${num(pb.years, 1)} yrs`}
                sub={`Saving ${peso(pb.annualSaving)} a year`}
              />
            </View>

            <Card style={{ marginTop: Spacing.three }}>
              <ThemedText type="eyebrow" themeColor="textMuted">
                An average month, kilowatt-hour by kilowatt-hour
              </ThemedText>
              <View style={{ marginTop: Spacing.two, gap: Spacing.one }}>
                <Line label="You use" value={kwh(monthly(q.energy.annualConsumptionKwh))} />
                <Line label="Your roof generates" value={kwh(monthly(q.energy.annualSolarKwh))} />
                <Line label="Exported to the grid" value={kwh(monthly(q.energy.annualExportKwh))} />
                <Line label="Still imported" value={kwh(monthly(q.energy.annualImportKwh))} />
                <Line
                  label={`Bill after ${peso(credit)}/kWh export credit`}
                  value={peso(q.bill.averageMonthlyAfter)}
                  strong
                />
              </View>

              <Button label="Book the free survey" href="/book" tone="sun" full />
            </Card>

            {other ? (
              <Reveal delay={90}>
                <Callout
                  title={system === 'hybrid' ? 'Without batteries' : 'With battery backup'}>
                  {system === 'hybrid'
                    ? `A grid-tie system for the same target costs ${peso(publicPrice(other).price)} and leaves a ${peso(other.bill.averageMonthlyAfter)} bill, but gives no power in a brownout.`
                    : `Adding batteries takes the price to ${peso(publicPrice(other).price)}` +
                      (other.outageRuntime
                        ? ` and keeps the house running about ${runtimeText(other.outageRuntime.afterSunset.medianHours, other.outageRuntime.maxHours)} into an evening brownout.`
                        : '.')}
                </Callout>
              </Reveal>
            ) : null}

            <Reveal delay={90}>
              <Callout title="Why exporting is worth less than using">
                Power you use the moment it is generated saves the full {peso(rate)}/kWh. Surplus
                you push to the grid is credited at {peso(credit)}/kWh, and unused credit rolls
                over to the next month. This system exports about{' '}
                {kwh(monthly(q.energy.annualExportKwh))} a month
                {segment === 'commercial'
                  ? ' — commercial demand lines up with the sun, which is why it pays back faster than a house.'
                  : ', so a good share of its output takes that discount.'}
              </Callout>
            </Reveal>
          </Reveal>
        )}

        {/* ---- assumptions ---- */}
        <Reveal style={{ marginTop: Spacing.four }}>
          <Collapsible title="Assumptions — change any of these">
            <View style={styles.fieldGrid}>
              <Field label="Import rate ₱/kWh" value={importRate} onChange={setImportRate} />
              <Field label="Export credit ₱/kWh" value={exportCredit} onChange={setExportCredit} />
              {segment === 'commercial' ? (
                <Field label="Open days per week" value={openDays} onChange={setOpenDays} />
              ) : null}
            </View>
            <ThemedText type="small" themeColor="textMuted" style={{ marginTop: Spacing.three }}>
              Everything else is what we quote with: 725 W panels, 12 kW hybrid or 10 kW grid-tie
              inverters, and 10 kWh battery units.
            </ThemedText>
          </Collapsible>
        </Reveal>

        <Reveal delay={90}>
          <Callout title="What this figure is and isn’t">
            Your bill is turned into one week of hourly use from the load shape you picked, and
            that week is repeated across the year, so seasonal changes in load are not captured.
            The household shapes are constructed archetypes, not metered data. Brownouts in your
            barangay are not included here. Fine for deciding whether to proceed; at the survey we
            replace the assumed week with your real meter readings.
          </Callout>
        </Reveal>

        <View style={{ marginTop: Spacing.four, gap: Spacing.two }}>
          <Reveal>
            <Bullet>
              The sun comes from months of output logged on a Zamboanga array, not a textbook
              yield figure.
            </Bullet>
          </Reveal>
          <Reveal delay={70}>
            <Bullet>
              Batteries are sized to carry the house for at least three hours after sunset, keeping
              40% in reserve in normal use.
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
