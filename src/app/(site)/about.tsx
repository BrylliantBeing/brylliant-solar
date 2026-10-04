import { useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandMark } from '@/components/brand-mark';
import { MotionScrollView, Reveal } from '@/components/motion';
import { ThemedText } from '@/components/themed-text';
import { Collapsible } from '@/components/ui/collapsible';
import { Bullet, Button, Callout, Card, Section } from '@/components/ui/kit';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Gap between staggered items in a list, in milliseconds. */
const STAGGER = 70;

/**
 * ZAMCELCO main-grid residential rate, ₱ per kWh, from the monthly "Electric Rate"
 * notices on zamcelco.com.ph. null = no notice was posted for that month.
 * January 2026 is from Better Zamboanga's "Power rates in Zamboanga Peninsula" table,
 * since ZAMCELCO posted no notice for it.
 */
const RESIDENTIAL_RATE: { month: string; rate: number | null }[] = [
  { month: 'Jan 2025', rate: 10.8579 },
  { month: 'Feb 2025', rate: 10.4422 },
  { month: 'Mar 2025', rate: 10.2847 },
  { month: 'Apr 2025', rate: 11.018 },
  { month: 'May 2025', rate: 10.9317 },
  { month: 'Jun 2025', rate: 9.8825 },
  { month: 'Jul 2025', rate: 10.1629 },
  { month: 'Aug 2025', rate: 10.5133 },
  { month: 'Sep 2025', rate: 11.0058 },
  { month: 'Oct 2025', rate: 10.1105 },
  { month: 'Nov 2025', rate: 10.711 },
  { month: 'Dec 2025', rate: 10.6148 },
  { month: 'Jan 2026', rate: 10.8932 },
  { month: 'Feb 2026', rate: 11.2093 },
  { month: 'Mar 2026', rate: 11.183 },
  { month: 'Apr 2026', rate: 11.1639 },
  { month: 'May 2026', rate: 10.9694 },
  { month: 'Jun 2026', rate: 11.4623 },
  { month: 'Jul 2026', rate: 12.1983 },
  { month: 'Aug 2026', rate: 13.0137 },
  { month: 'Sep 2026', rate: 13.4668 },
];

/** Where the current run of monthly increases starts. */
const CLIMB_FROM = RESIDENTIAL_RATE.findIndex((r) => r.month === 'May 2026');
const LATEST = RESIDENTIAL_RATE[RESIDENTIAL_RATE.length - 1];
const CLIMB_START = RESIDENTIAL_RATE[CLIMB_FROM];
const CLIMB_MONTHS = RESIDENTIAL_RATE.length - 1 - CLIMB_FROM;
const CLIMB_PCT = Math.round((LATEST.rate! / CLIMB_START.rate! - 1) * 100);

const BEFORE_CLIMB = RESIDENTIAL_RATE.slice(0, CLIMB_FROM).flatMap((r) => (r.rate === null ? [] : [r.rate]));

const rate = (r: number) => `₱${r.toFixed(2)}`;

const FACTS = [
  {
    big: '62%',
    label: 'Philippine power from coal',
    body: 'The largest single source on the national grid in 2024, by the Department of Energy’s count.',
  },
  {
    big: '80%+',
    label: 'Of that coal is imported',
    body: 'Almost all of it shipped in from Indonesia, and paid for in dollars.',
  },
  {
    big: '0',
    label: 'Local fuel in Zamboanga',
    body: 'The plants in the city burn shipped-in oil. The rest comes over the Mindanao grid.',
  },
];

const SUPPLY = [
  'Oil-fired plants in the city, running on bunker fuel and diesel brought in by sea',
  'Coal plants elsewhere in Mindanao, burning coal shipped in from abroad',
  'Hydro and other plants on the Mindanao grid, shared with the rest of the island',
];

const PRICE_DRIVERS = [
  {
    title: 'Fuel costs pass straight through',
    body: 'The generation charge on your bill follows what the power plants pay for coal and oil. When world fuel prices rise, Zamboanga pays more the following months.',
  },
  {
    title: 'Fuel is bought in dollars',
    body: 'Imported coal and oil are priced in US dollars, so a weaker peso raises the bill even when fuel prices hold still.',
  },
  {
    title: 'Demand keeps growing',
    body: 'Philippine electricity demand is rising by around 5% a year, and new supply has struggled to keep pace. Short supply means expensive power.',
  },
  {
    title: 'Supply can run short',
    body: 'Zamboanga has already faced warnings that its main oil-fired plant could shut down for lack of fuel. A city that ships in its fuel feels every disruption.',
  },
];

const WHAT_WE_DO = [
  'Zamboangueño-owned and crewed; we live with the same bills and brownouts',
  'Systems sized to your daytime load, so nearly every kilowatt-hour offsets the full grid rate',
  'Production estimates from our own measured array, not a brochure',
  'Hybrid systems with batteries for homes and businesses that cannot afford a brownout',
  'Net metering, permits and paperwork filed for you',
];

export default function AboutScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <MotionScrollView
      style={{ backgroundColor: t.background }}
      contentContainerStyle={{ paddingBottom: insets.bottom + BottomTabInset + Spacing.six }}>
      {/* ---------- intro ---------- */}
      <View
        style={[
          styles.hero,
          { borderBottomColor: t.line },
          Platform.OS === 'web' && { paddingTop: Spacing.six },
        ]}>
        <View style={styles.inner}>
          <Reveal>
            <ThemedText type="eyebrow" themeColor="textMuted">
              About Brylliant Solar
            </ThemedText>
            <ThemedText type="display" style={{ marginTop: Spacing.three }}>
              Zamboanga runs on shipped-in fuel.
            </ThemedText>
          </Reveal>
          <Reveal delay={90}>
            <ThemedText type="display" style={{ color: t.accent }}>
              We’d rather it ran on sunlight.
            </ThemedText>
          </Reveal>
          <Reveal delay={180}>
            <ThemedText type="lede" themeColor="textSecondary" style={{ marginTop: Spacing.three }}>
              Brylliant Solar is a Zamboanga City company. We design, supply and install solar for
              homes and businesses here, because the sun on your roof is the one source of power in
              this city that nobody has to ship in.
            </ThemedText>
          </Reveal>
        </View>
      </View>

      {/* ---------- the numbers ---------- */}
      <Section tinted eyebrow="The problem" title="Our power comes from somewhere else">
        <View style={styles.factGrid}>
          {FACTS.map((f, i) => (
            <Reveal key={f.label} delay={i * STAGGER} style={{ flexGrow: 1, flexBasis: 200 }}>
              <Card>
                <ThemedText type="dataLarge" style={{ color: t.accent }}>
                  {f.big}
                </ThemedText>
                <ThemedText type="eyebrow" themeColor="textMuted">
                  {f.label}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {f.body}
                </ThemedText>
              </Card>
            </Reveal>
          ))}
        </View>
      </Section>

      {/* ---------- where it comes from ---------- */}
      <Section
        eyebrow="Where it comes from"
        title="Every kilowatt-hour starts as imported fuel"
        lede="Zamboanga City produces none of the fuel it makes its electricity from. The power ZAMCELCO delivers comes from three places.">
        <View style={{ gap: Spacing.two }}>
          {SUPPLY.map((line, i) => (
            <Reveal key={line} delay={i * STAGGER} distance={10}>
              <Bullet>{line}</Bullet>
            </Reveal>
          ))}
        </View>
        <Reveal delay={SUPPLY.length * STAGGER}>
          <ThemedText themeColor="textSecondary" style={{ marginTop: Spacing.three }}>
            Across the Philippines, coal is the backbone: it made more than three of every five
            kilowatt-hours in 2024, and the country imports most of the coal it burns. So the price
            of a fan running in Tetuan is tied to coal markets in Indonesia and the exchange rate in
            Manila.
          </ThemedText>
        </Reveal>
      </Section>

      {/* ---------- why prices rise ---------- */}
      <Section
        tinted
        eyebrow="Why bills keep rising"
        title="Prices we don’t control"
        lede={`ZAMCELCO’s residential rate has gone up ${CLIMB_MONTHS} months in a row, from ${rate(CLIMB_START.rate!)} a kilowatt-hour in ${CLIMB_START.month} to ${rate(LATEST.rate!)} in ${LATEST.month}: ${CLIMB_PCT}% more in ${CLIMB_MONTHS} months.`}>
        <Reveal>
          <RateChart />
        </Reveal>
        <View style={{ marginTop: Spacing.three }}>
          {PRICE_DRIVERS.map((d, i) => (
            <Reveal key={d.title} delay={i * STAGGER} distance={14}>
              <View
                style={[
                  styles.driver,
                  { borderBottomColor: t.line, borderBottomWidth: i === PRICE_DRIVERS.length - 1 ? 0 : 1 },
                ]}>
                <ThemedText type="heading">{d.title}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary" style={{ marginTop: Spacing.one }}>
                  {d.body}
                </ThemedText>
              </View>
            </Reveal>
          ))}
        </View>
      </Section>

      {/* ---------- what we do ---------- */}
      <Section
        eyebrow="What we do"
        title="Make your own, right where you use it"
        lede="The sun passes almost overhead in Zamboanga all year. A solar system turns that into power with no fuel bill, no shipping and no exchange rate.">
        <View style={{ gap: Spacing.two }}>
          {WHAT_WE_DO.map((line, i) => (
            <Reveal key={line} delay={i * STAGGER} distance={10}>
              <Bullet>{line}</Bullet>
            </Reveal>
          ))}
        </View>
        <Reveal delay={WHAT_WE_DO.length * STAGGER} style={{ marginTop: Spacing.three }}>
          <Callout title="We keep you on the grid">
            Solar cuts how much power you buy; it doesn’t replace the line. For most city homes and
            businesses, staying connected and using the grid at night is still the cheapest setup.
            We’ll tell you honestly what solar can and can’t do for you.
          </Callout>
        </Reveal>
        <Reveal delay={(WHAT_WE_DO.length + 1) * STAGGER} style={styles.ctaRow}>
          <Button label="Book a free survey" href="/book" />
          <Button label="See what you’d save" href="/estimate" tone="ghost" />
        </Reveal>
      </Section>

      {/* ---------- sources ---------- */}
      <View style={styles.sources}>
        <View style={styles.inner}>
          <BrandMark size={32} />
          <ThemedText type="small" themeColor="textMuted" style={{ marginTop: Spacing.two }}>
            Sources: ZAMCELCO monthly electric rate notices (zamcelco.com.ph), with January 2026 from
            Better Zamboanga; Department of Energy 2024 power statistics (coal share of generation);
            Department of Energy coal import data for 2023; ZAMCELCO power supply agreements and news
            reports on Zamboanga City’s power plants. Figures current as of October 2026.
          </ThemedText>
        </View>
      </View>
    </MotionScrollView>
  );
}

const CHART_HEIGHT = 150;

/**
 * Monthly residential rate as columns from a zero baseline. The current climb is in the
 * accent colour; hovering or tapping a column shows its month in the readout.
 */
function RateChart() {
  const t = useTheme();
  const [active, setActive] = useState<number | null>(null);
  const shown = RESIDENTIAL_RATE[active ?? RESIDENTIAL_RATE.length - 1];
  const max = Math.max(...RESIDENTIAL_RATE.map((r) => r.rate ?? 0));

  return (
    <Card>
      <ThemedText type="eyebrow" themeColor="textMuted">
        ZAMCELCO residential rate, ₱ per kWh
      </ThemedText>
      <View style={styles.readout}>
        <ThemedText type="dataLarge">{shown.rate === null ? 'No notice' : rate(shown.rate)}</ThemedText>
        <ThemedText type="small" themeColor="textMuted">
          {shown.month}
        </ThemedText>
      </View>

      <View
        style={[styles.plot, { borderBottomColor: t.lineStrong }]}
        accessibilityRole="image"
        accessibilityLabel={`Column chart of ZAMCELCO’s residential rate from ${RESIDENTIAL_RATE[0].month} to ${LATEST.month}. It moved between ${rate(Math.min(...BEFORE_CLIMB))} and ${rate(Math.max(...BEFORE_CLIMB))} until ${CLIMB_START.month}, then rose every month to ${rate(LATEST.rate!)}.`}>
        {RESIDENTIAL_RATE.map((r, i) => (
          <Pressable
            key={r.month}
            style={[styles.slot, active === i && { backgroundColor: t.backgroundSelected }]}
            onHoverIn={() => setActive(i)}
            onHoverOut={() => setActive(null)}
            onPressIn={() => setActive(i)}
            accessibilityLabel={r.rate === null ? `${r.month}: no notice` : `${r.month}: ${rate(r.rate)}`}>
            {r.rate !== null && (
              <View
                style={[
                  styles.bar,
                  {
                    height: (r.rate / max) * CHART_HEIGHT,
                    backgroundColor: i > CLIMB_FROM ? t.accent : t.textMuted, // the increases, not the month they start from
                  },
                ]}
              />
            )}
          </Pressable>
        ))}
      </View>
      <View style={styles.axis}>
        <ThemedText type="data" themeColor="textMuted" style={{ fontSize: 11 }}>
          {RESIDENTIAL_RATE[0].month}
        </ThemedText>
        <ThemedText type="data" themeColor="textMuted" style={{ fontSize: 11 }}>
          {LATEST.month}
        </ThemedText>
      </View>
      <ThemedText type="small" themeColor="textMuted" style={{ marginTop: Spacing.two }}>
        Green: the last {CLIMB_MONTHS} months of increases. Gaps are months ZAMCELCO posted no rate notice.
      </ThemedText>
      <View style={{ marginTop: Spacing.two }}>
        <Collapsible title="Every month">
          <View style={{ gap: Spacing.half }}>
            {RESIDENTIAL_RATE.filter((r) => r.rate !== null).map((r) => (
              <View key={r.month} style={styles.tableRow}>
                <ThemedText type="small" themeColor="textSecondary">
                  {r.month}
                </ThemedText>
                <ThemedText type="data">₱{r.rate!.toFixed(4)}</ThemedText>
              </View>
            ))}
          </View>
        </Collapsible>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  readout: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.two, marginTop: Spacing.one },
  plot: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
    height: CHART_HEIGHT,
    marginTop: Spacing.three,
    borderBottomWidth: 1,
  },
  slot: { flex: 1, height: '100%', justifyContent: 'flex-end', borderRadius: 4 },
  bar: { borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: Spacing.one },
  tableRow: { flexDirection: 'row', justifyContent: 'space-between' },
  hero: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.five,
    paddingBottom: Spacing.six * 0.7,
    borderBottomWidth: 1,
    alignItems: 'center',
  },
  inner: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  factGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  driver: { paddingVertical: Spacing.three },
  ctaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginTop: Spacing.four },
  sources: { paddingHorizontal: Spacing.four, paddingTop: Spacing.five },
});
