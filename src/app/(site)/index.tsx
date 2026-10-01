import { Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
} from 'react-native-reanimated';

import { BrandMark } from '@/components/brand-mark';
import { MotionScrollView, Reveal, useScrollY } from '@/components/motion';
import { ThemedText } from '@/components/themed-text';
import { Collapsible } from '@/components/ui/collapsible';
import { Bullet, Button, Callout, Card, Section } from '@/components/ui/kit';
import {
  Model,
  PACKAGES,
  estimate,
  kwhFromBill,
  peso,
  pesoRange,
  yearsRange,
} from '@/constants/solar';
import { Brand, BottomTabInset, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Gap between staggered items in a list, in milliseconds. */
const STAGGER = 70;

const STEPS = [
  {
    title: 'Free roof survey',
    body: 'We measure, check shading and structure, and photograph everything.',
    when: 'About an hour · no charge',
  },
  {
    title: 'Design and quotation',
    body: 'Sized system, named hardware, production estimate, fixed price.',
    when: '3–5 working days',
  },
  {
    title: 'Permits and paperwork',
    body: 'Electrical permit, net metering and CFEI coordination — filed by us.',
    when: '2–4 weeks',
  },
  {
    title: 'Installation',
    body: 'Our own crew. Commercial installs are phased so nothing stops.',
    when: '1–3 days residential',
  },
  {
    title: 'Commissioning',
    body: 'Switched on with you there, then a check-in after your first bill.',
    when: 'Same day, plus follow-up',
  },
];

const PROOF = [
  { big: '3.5', label: 'kWh per kWp per day', body: 'Measured on our own array. Every estimate scales off it.' },
  { big: '6°', label: 'Optimal fixed tilt', body: 'Near-flat mounting, less wind load.' },
  { big: '10', label: 'Working days', body: 'Utility deadline to act on a net-metering application.' },
  { big: '1 MW', label: 'Commercial cap', body: 'Raised from 100 kWp by the 2026 circular.' },
];

const FAQS = [
  {
    q: 'Will my bill go to zero?',
    a: 'Close, on the invoices we have analysed. Only a ₱5.00 monthly metering charge is billed per connection; every other line moves with kilowatt-hours. So an 80% cut in kWh really is close to an 80% cut in pesos here. Check your own tariff — this is not universal.',
  },
  {
    q: 'What happens during a brownout?',
    a: 'A grid-tied system shuts down, for the safety of linemen. Everything the estimator quotes is grid-tied. To keep power through an outage you need a hybrid inverter and a battery, which we quote separately after a survey.',
  },
  {
    q: 'Is my roof strong enough?',
    a: 'Usually. An array adds roughly 12–18 kg per square metre; the survey confirms whether yours needs reinforcement.',
  },
  {
    q: 'How does net metering work?',
    a: 'Power you use as it is generated offsets your bill one for one. Surplus you export is credited at roughly two kilowatt-hours exported per one credited — which is why a system sized to your daytime load beats a bigger one.',
  },
  {
    q: 'Can you take me off the grid?',
    a: 'Technically yes, but for most city properties we advise against it, and the estimator does not price it. Keeping the line means a normal battery instead of an enormous one.',
  },
];

export default function HomeScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  // The worked example on the home page. Runs the same engine as /estimate:
  // a typical household, sized to remove 80% of a 3,600-peso bill.
  const sampleBill = 3600;
  const sample = estimate({
    segment: 'residential',
    profile: 'typical',
    monthlyKwh: kwhFromBill(sampleBill),
  });

  return (
    <MotionScrollView
      style={{ backgroundColor: t.background }}
      contentContainerStyle={{ paddingBottom: insets.bottom + BottomTabInset + Spacing.six }}>
      <Hero />

      {/* ---------- sample ---------- */}
      <Section tinted eyebrow="For example" title="A ₱3,600 bill, on a typical household">
        <View style={styles.exampleRow}>
          <ExampleFigure label="New bill" value={peso(sample.billAfter)} tone={t.accent} delay={0} />
          <ExampleFigure
            label="System"
            value={`${sample.installedKwp.toFixed(2)} kWp`}
            tone={t.text}
            delay={STAGGER}
          />
          <ExampleFigure
            label="Payback"
            value={yearsRange(sample.paybackLow, sample.paybackHigh)}
            tone={t.text}
            delay={STAGGER * 2}
          />
        </View>
        <Reveal delay={STAGGER * 3}>
          <ThemedText type="small" themeColor="textMuted" style={{ marginTop: Spacing.three }}>
            {sample.panels} × {Model.panelWatts} Wp panels, about{' '}
            {pesoRange(sample.costLow, sample.costHigh)} installed, removing{' '}
            {Math.round(sample.reductionPct)}% of the bill. Your own numbers will differ.
          </ThemedText>
          <View style={{ marginTop: Spacing.three }}>
            <Button label="Estimate my savings" href="/estimate" tone="sun" />
          </View>
        </Reveal>
      </Section>

      {/* ---------- packages ---------- */}
      <Section
        eyebrow="Packages"
        title="Three packages"
        lede="A system sized to your daytime load earns the full grid rate on nearly every kilowatt-hour. Oversizing is what drags returns down.">
        <View style={{ gap: Spacing.three }}>
          {PACKAGES.map((p, i) => (
            <Reveal key={p.key} delay={i * STAGGER}>
              <Card style={{ borderTopWidth: 3, borderTopColor: t[p.accent] }}>
                {p.featured ? (
                  <ThemedText type="eyebrow" style={{ color: t.accent }}>
                    Most households
                  </ThemedText>
                ) : null}
                <ThemedText type="subtitle">{p.name}</ThemedText>
                <ThemedText type="data" style={{ color: t.accentWarm }}>
                  {p.sizeLabel}
                </ThemedText>
                <View style={{ gap: Spacing.one, marginTop: Spacing.two }}>
                  {p.points.slice(0, 2).map((pt) => (
                    <Bullet key={pt}>{pt}</Bullet>
                  ))}
                </View>
              </Card>
            </Reveal>
          ))}
        </View>
        <Reveal delay={PACKAGES.length * STAGGER} style={{ marginTop: Spacing.three }}>
          <Callout title="Start small, finish later">
            We fit rails and size inverters with room to grow, so adding panels later is a half-day
            visit.
          </Callout>
        </Reveal>
      </Section>

      {/* ---------- process ---------- */}
      <Section
        tinted
        eyebrow="The process"
        title="Five steps"
        lede="Nothing is a commitment until you sign the quotation.">
        <View>
          {STEPS.map((s, i) => (
            <Reveal key={s.title} delay={i * STAGGER} distance={14}>
              <View
                style={[
                  styles.step,
                  { borderBottomColor: t.line, borderBottomWidth: i === STEPS.length - 1 ? 0 : 1 },
                ]}>
                <View style={[styles.stepNum, { backgroundColor: Brand.canopy }]}>
                  <ThemedText type="data" style={{ color: Brand.noon, fontSize: 12 }}>
                    {String(i + 1).padStart(2, '0')}
                  </ThemedText>
                </View>
                <View style={{ flex: 1 }}>
                  <ThemedText type="heading">{s.title}</ThemedText>
                  <ThemedText
                    type="small"
                    themeColor="textSecondary"
                    style={{ marginTop: Spacing.one }}>
                    {s.body}
                  </ThemedText>
                  <ThemedText
                    type="eyebrow"
                    themeColor="textMuted"
                    style={{ marginTop: Spacing.two }}>
                    {s.when}
                  </ThemedText>
                </View>
              </View>
            </Reveal>
          ))}
        </View>
      </Section>

      {/* ---------- why here ---------- */}
      <Section
        eyebrow="Why here"
        title="Zamboanga is unusually good at this"
        lede="Geography, not marketing — the sun passes almost overhead all year.">
        <View style={styles.proofGrid}>
          {PROOF.map((p, i) => (
            <Reveal key={p.label} delay={i * STAGGER} style={{ flexGrow: 1, flexBasis: 200 }}>
              <Card>
                <ThemedText type="dataLarge" style={{ color: t.accent }}>
                  {p.big}
                </ThemedText>
                <ThemedText type="eyebrow" themeColor="textMuted">
                  {p.label}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {p.body}
                </ThemedText>
              </Card>
            </Reveal>
          ))}
        </View>
        <Reveal delay={PROOF.length * STAGGER}>
          <ThemedText type="small" themeColor="textMuted" style={{ marginTop: Spacing.three }}>
            Figures current as of August 2026, re-checked before every quotation.
          </ThemedText>
        </Reveal>
      </Section>

      {/* ---------- faq ---------- */}
      <Section tinted eyebrow="Questions" title="The things people actually ask">
        <View style={{ gap: Spacing.three }}>
          {FAQS.map((f, i) => (
            <Reveal key={f.q} delay={i * STAGGER} distance={12}>
              <Collapsible title={f.q}>
                <ThemedText type="small" themeColor="textSecondary">
                  {f.a}
                </ThemedText>
              </Collapsible>
            </Reveal>
          ))}
        </View>
      </Section>

      {/* ---------- footer ---------- */}
      <View style={[styles.footer, { backgroundColor: Brand.canopy }]}>
        <View style={styles.inner}>
          <Reveal>
            <BrandMark size={44} reversed />
            <ThemedText
              type="lede"
              style={{ color: Brand.noon, fontStyle: 'italic', marginTop: Spacing.two }}>
              Sunlight, well spent.
            </ThemedText>
          </Reveal>
          <Reveal delay={STAGGER}>
            <ThemedText type="small" style={{ color: Brand.sand, marginTop: Spacing.three }}>
              Zamboanga City · (062) 000 0000 · hello@brylliantsolar.ph
            </ThemedText>
            <ThemedText type="eyebrow" style={{ color: Brand.seaglass, marginTop: Spacing.three }}>
              Estimates in this app are not quotations
            </ThemedText>
          </Reveal>
          <Reveal delay={STAGGER * 2} style={{ marginTop: Spacing.four }}>
            <Button label="Book a free survey" href="/book" tone="sun" />
          </Reveal>
        </View>
      </View>
    </MotionScrollView>
  );
}

/**
 * The hero drifts and dims slightly as the page scrolls under the header, and
 * its contents ladder in on first paint.
 */
function Hero() {
  const t = useTheme();
  const scrollY = useScrollY();

  const parallax = useAnimatedStyle(() => {
    const y = Math.max(0, scrollY?.value ?? 0);
    return {
      opacity: interpolate(y, [0, 320], [1, 0.4], Extrapolation.CLAMP),
      transform: [{ translateY: y * 0.16 }],
    };
  });

  return (
    <View
      style={[
        styles.hero,
        { borderBottomColor: t.line },
        Platform.OS === 'web' && { paddingTop: Spacing.six },
      ]}>
      <Animated.View style={[styles.inner, parallax]}>
        <Reveal>
          <BrandMark size={64} pulse />
        </Reveal>
        <Reveal delay={90}>
          <ThemedText type="display" style={{ marginTop: Spacing.four }}>
            Your roof is getting paid nothing.
          </ThemedText>
        </Reveal>
        <Reveal delay={180}>
          <ThemedText type="display" style={{ color: t.accent }}>
            Let’s fix that.
          </ThemedText>
        </Reveal>
        <Reveal delay={280}>
          <ThemedText type="lede" themeColor="textSecondary" style={{ marginTop: Spacing.three }}>
            Solar design, supply and installation for homes and businesses across Zamboanga City.
          </ThemedText>
        </Reveal>
        <Reveal delay={380} style={styles.ctaRow}>
          <Button label="Book a free survey" href="/book" />
          <Button label="See what you’d save" href="/estimate" tone="ghost" />
        </Reveal>
        <View style={{ marginTop: Spacing.four, gap: Spacing.one }}>
          {[
            'Free survey, no obligation',
            'Net metering filed for you',
            'Zamboangueño-owned and crewed',
          ].map((line, i) => (
            <Reveal key={line} delay={470 + i * STAGGER} distance={10}>
              <Bullet>{line}</Bullet>
            </Reveal>
          ))}
        </View>
      </Animated.View>
    </View>
  );
}

function ExampleFigure({
  label,
  value,
  tone,
  delay,
}: {
  label: string;
  value: string;
  tone: string;
  delay: number;
}) {
  return (
    <Reveal delay={delay} style={{ flexGrow: 1, flexBasis: 110 }}>
      <ThemedText type="eyebrow" themeColor="textMuted">
        {label}
      </ThemedText>
      <ThemedText type="dataLarge" style={{ color: tone, marginTop: Spacing.half }}>
        {value}
      </ThemedText>
    </Reveal>
  );
}

const styles = StyleSheet.create({
  hero: { paddingHorizontal: Spacing.four, paddingTop: Spacing.five, paddingBottom: Spacing.six * 0.7, borderBottomWidth: 1, alignItems: 'center' },
  inner: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  ctaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginTop: Spacing.four },
  exampleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  step: { flexDirection: 'row', gap: Spacing.three, paddingVertical: Spacing.three },
  stepNum: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  proofGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  footer: { paddingHorizontal: Spacing.four, paddingVertical: Spacing.six * 0.7, alignItems: 'center', borderRadius: Radius.sm },
});
