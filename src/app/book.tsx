import { useState } from 'react';
import { Platform, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { MotionScrollView, Reveal } from '@/components/motion';
import { ThemedText } from '@/components/themed-text';
import { Button, Callout, Card, Chip } from '@/components/ui/kit';
import { peso } from '@/constants/solar';
import { Brand, BottomTabInset, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const PROPERTY = ['Home', 'Business', 'Dealer enquiry'] as const;
const WHEN = ['Weekday morning', 'Weekday afternoon', 'Saturday', 'Any time'] as const;

/**
 * A short nudge on the form when validation fails, so the error message isn't
 * the only thing announcing it. Reanimated flattens this to a no-op when the
 * OS asks for reduced motion.
 */
function nudge(offset: SharedValue<number>) {
  offset.value = withSequence(
    withTiming(-7, { duration: 55 }),
    withTiming(7, { duration: 55 }),
    withTiming(-4, { duration: 50 }),
    withTiming(0, { duration: 50 }),
  );
}

export default function BookScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [bill, setBill] = useState('');
  const [property, setProperty] = useState<string>(PROPERTY[0]);
  const [when, setWhen] = useState<string>(WHEN[0]);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState<string | null>(null);

  const shake = useSharedValue(0);
  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value }] }));

  function submit() {
    const missing: string[] = [];
    if (!name.trim()) missing.push('your name');
    if (!phone.trim()) missing.push('a mobile number');
    if (!address.trim()) missing.push('a barangay or address');

    if (missing.length) {
      setError(`Still needed: ${missing.join(', ')}.`);
      nudge(shake);
      return;
    }
    if (phone.replace(/\D/g, '').length < 10) {
      setError('That mobile number looks too short — please check it.');
      nudge(shake);
      return;
    }
    setError('');
    const billNum = parseFloat(bill);
    setSummary(
      [
        'SURVEY REQUEST — BRYLLIANT SOLAR',
        `Name:      ${name.trim()}`,
        `Mobile:    ${phone.trim()}`,
        `Property:  ${property}`,
        `Address:   ${address.trim()}`,
        `Bill:      ${Number.isFinite(billNum) ? `${peso(billNum)} / month` : 'not given'}`,
        `Best time: ${when}`,
      ].join('\n')
    );
  }

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
            Book a survey
          </ThemedText>
          <ThemedText type="title" style={{ marginTop: Spacing.two }}>
            Free, about an hour, no obligation
          </ThemedText>
          <ThemedText type="lede" themeColor="textSecondary" style={{ marginTop: Spacing.two }}>
            We measure the roof, check the shading and the electrical panel, and photograph what we
            find. You get a written quotation within a week — or an honest explanation of why your
            roof is not a good candidate.
          </ThemedText>
        </Reveal>

        {summary ? (
          <Animated.View entering={FadeInDown.duration(320)}>
            <Card style={{ marginTop: Spacing.four, backgroundColor: Brand.canopy, borderColor: Brand.canopy }}>
              <ThemedText type="subtitle" style={{ color: Brand.bone }}>
                Got it — here is what you sent
              </ThemedText>
              <ThemedText type="small" style={{ color: Brand.sand }}>
                Send this to us on Messenger, or call and read it out. We will confirm a time within
                one working day.
              </ThemedText>
              <View style={[styles.recap, { borderColor: Brand.seaglass }]}>
                <ThemedText type="data" style={{ color: Brand.bone }} selectable>
                  {summary}
                </ThemedText>
              </View>
              <Button label="Edit details" tone="sun" onPress={() => setSummary(null)} />
            </Card>
          </Animated.View>
        ) : (
          <Animated.View entering={FadeIn.duration(260)}>
            <Animated.View style={shakeStyle}>
              <Card style={{ marginTop: Spacing.four, gap: Spacing.three }}>
                <Field label="Your name" value={name} onChange={setName} autoComplete="name" />
                <Field
                  label="Mobile number"
                  value={phone}
                  onChange={setPhone}
                  placeholder="09XX XXX XXXX"
                  keyboardType="phone-pad"
                  autoComplete="tel"
                />
                <Field
                  label="Barangay or address"
                  value={address}
                  onChange={setAddress}
                  placeholder="e.g. Tetuan, Zamboanga City"
                />
                <Field
                  label="Average monthly bill ₱"
                  value={bill}
                  onChange={setBill}
                  placeholder="9800"
                  keyboardType="numeric"
                />

                <View style={{ gap: Spacing.two }}>
                  <ThemedText type="eyebrow" themeColor="textMuted">
                    Property type
                  </ThemedText>
                  <View style={styles.chipRow}>
                    {PROPERTY.map((p) => (
                      <Chip key={p} label={p} selected={property === p} onPress={() => setProperty(p)} />
                    ))}
                  </View>
                </View>

                <View style={{ gap: Spacing.two }}>
                  <ThemedText type="eyebrow" themeColor="textMuted">
                    Best time to visit
                  </ThemedText>
                  <View style={styles.chipRow}>
                    {WHEN.map((w) => (
                      <Chip key={w} label={w} selected={when === w} onPress={() => setWhen(w)} />
                    ))}
                  </View>
                </View>

                {error ? (
                  <Animated.View entering={FadeInDown.duration(200)} exiting={FadeOut.duration(120)}>
                    <ThemedText
                      type="data"
                      style={{ color: t.accentWarm }}
                      accessibilityLiveRegion="polite">
                      {error}
                    </ThemedText>
                  </Animated.View>
                ) : null}

                <Button label="Request my free survey" onPress={submit} full />
                <ThemedText type="small" themeColor="textMuted">
                  We will call to confirm a time. We do not sell or share your details.
                </ThemedText>
              </Card>
            </Animated.View>
          </Animated.View>
        )}

        <Reveal style={{ marginTop: Spacing.four }}>
          <Callout title="Bring if you have them">
            Your last twelve electricity bills, and any roof or building plans. Twelve months of data
            lets us size against your real pattern instead of guessing from a single month.
          </Callout>
        </Reveal>

        <Reveal delay={90} style={{ marginTop: Spacing.three }}>
          <Callout title="Developer note">
            This form has no backend yet. It validates and produces a summary the customer can send
            you. Wire it to an inbox, a Messenger handoff or a CRM before launch.
          </Callout>
        </Reveal>
      </View>
    </MotionScrollView>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  keyboardType,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'numeric' | 'phone-pad';
  autoComplete?: 'name' | 'tel';
}) {
  const t = useTheme();
  return (
    <View style={{ gap: Spacing.one }}>
      <ThemedText type="eyebrow" themeColor="textMuted">
        {label}
      </ThemedText>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={t.textMuted}
        keyboardType={keyboardType ?? 'default'}
        autoComplete={autoComplete}
        accessibilityLabel={label}
        style={[styles.input, { color: t.text, borderColor: t.lineStrong, backgroundColor: t.background }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: Spacing.four, paddingTop: Spacing.four, alignItems: 'center' },
  inner: { width: '100%', maxWidth: MaxContentWidth },
  input: {
    borderWidth: 1,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three * 0.7,
    fontSize: 16,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  recap: {
    borderWidth: 1,
    borderRadius: Radius.sm,
    padding: Spacing.three,
    backgroundColor: 'rgba(0,0,0,0.22)',
  },
});
