import { useState } from 'react';
import { Platform, StyleSheet, TextInput, View } from 'react-native';
import { apiUrl } from '@/lib/api-base';
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
import { VisitCalendar } from '@/components/visit-calendar';
import { peso } from '@/constants/solar';
import { Brand, BottomTabInset, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const PROPERTY = ['Home', 'Business', 'Dealer enquiry'] as const;
/** Must match TIMES in public/api/quote.php. */
const TIMES = ['Morning', 'Afternoon', 'Any time'] as const;

/** First visit day is this many days out, leaving a working day to call and confirm. */
const LEAD_DAYS = 2;
/** Must not exceed MAX_DAYS_AHEAD in public/api/quote.php. */
const LAST_DAY = 30;
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000; // Asia/Manila is UTC+8 all year, no DST

/** A YYYY-MM-DD this many days from today in Zamboanga, whatever the device's zone. */
function manilaDay(offset: number): string {
  const now = new Date(Date.now() + MANILA_OFFSET_MS);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset))
    .toISOString()
    .slice(0, 10);
}

/** "Mon, Oct 12" */
const dayLabel = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-PH', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

/**
 * PHP endpoint that mails the lead to the Hostinger inbox. Relative on web so a
 * local dev server does not post to production; absolute on native, which has no
 * origin to be relative to.
 */
const ENDPOINT = apiUrl('/api/quote.php');

type Status = 'idle' | 'sending' | 'sent' | 'fallback';

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
  const [email, setEmail] = useState('');
  const [range] = useState(() => ({ first: manilaDay(LEAD_DAYS), last: manilaDay(LAST_DAY) }));
  const [dates, setDates] = useState<string[]>([]);
  const [time, setTime] = useState<string>(TIMES[2]);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('idle');

  const shake = useSharedValue(0);
  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value }] }));

  async function submit() {
    if (status === 'sending') return;

    const missing: string[] = [];
    if (!name.trim()) missing.push('your name');
    if (!phone.trim()) missing.push('a mobile number');
    if (!address.trim()) missing.push('a barangay or address');
    if (!dates.length) missing.push('at least one day you are free');

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
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('That email address does not look right — please check it, or leave it blank.');
      nudge(shake);
      return;
    }
    setError('');

    const billNum = parseFloat(bill);
    // Built before the request, not after: if the mail fails the customer still
    // gets something they can send us, rather than a dead end.
    setSummary(
      [
        'SURVEY REQUEST — BRYLLIANT SOLAR',
        `Name:      ${name.trim()}`,
        `Mobile:    ${phone.trim()}`,
        ...(email.trim() ? [`Email:     ${email.trim()}`] : []),
        `Property:  ${property}`,
        `Address:   ${address.trim()}`,
        `Bill:      ${Number.isFinite(billNum) ? `${peso(billNum)} / month` : 'not given'}`,
        `Free on:   ${[...dates].sort().map(dayLabel).join(', ')}`,
        `Time:      ${time}`,
      ].join('\n')
    );
    setStatus('sending');

    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 15000);
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abort.signal,
        body: JSON.stringify({
          name: name.trim(),
          phone: phone.trim(),
          address: address.trim(),
          bill: bill.trim(),
          email: email.trim(),
          property,
          dates,
          time,
          company: '', // honeypot: only a bot ever fills this
        }),
      });
      if (__DEV__ && !(res.headers.get('content-type') ?? '').includes('application/json')) {
        throw new Error('The booking form needs the PHP API: run npm run dev:api and dev:proxy, then open localhost:3000.');
      }
      const data = (await res.json().catch(() => null)) as { ok?: boolean; confirmed?: boolean; error?: string } | null;
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error ?? `The server returned ${res.status}.`);
      }
      setConfirmed(Boolean(data.confirmed));
      setStatus('sent');
    } catch (e) {
      setError(
        e instanceof Error && e.name === 'AbortError'
          ? 'That took too long to send.'
          : e instanceof Error
            ? e.message
            : 'We could not reach the server.'
      );
      setStatus('fallback');
    } finally {
      clearTimeout(timer);
    }
  }

  function editAgain() {
    setSummary(null);
    setStatus('idle');
    setError('');
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

        {status === 'sent' ? (
          <Animated.View entering={FadeInDown.duration(320)}>
            <Card style={{ marginTop: Spacing.four, backgroundColor: Brand.canopy, borderColor: Brand.canopy }}>
              <ThemedText
                type="subtitle"
                style={{ color: Brand.bone }}
                accessibilityLiveRegion="polite">
                Sent — we have your request
              </ThemedText>
              <ThemedText type="small" style={{ color: Brand.sand }}>
                It is in our inbox now. We will call {phone.trim()} to confirm a time, usually within
                one working day.{' '}
                {confirmed
                  ? `A confirmation is on its way to ${email.trim()}.`
                  : email.trim()
                    ? 'We could not email you a confirmation, so keep a copy of the summary below.'
                    : 'Keep a copy below in case you want to follow up.'}
              </ThemedText>
              <View style={[styles.recap, { borderColor: Brand.seaglass }]}>
                <ThemedText type="data" style={{ color: Brand.bone }} selectable>
                  {summary}
                </ThemedText>
              </View>
              <Button label="Book another survey" tone="sun" onPress={editAgain} />
            </Card>
          </Animated.View>
        ) : status === 'fallback' && summary ? (
          <Animated.View entering={FadeInDown.duration(320)}>
            <Card style={{ marginTop: Spacing.four, backgroundColor: Brand.canopy, borderColor: Brand.canopy }}>
              <ThemedText
                type="subtitle"
                style={{ color: Brand.bone }}
                accessibilityLiveRegion="polite">
                That did not send — but nothing is lost
              </ThemedText>
              <ThemedText type="small" style={{ color: Brand.sand }}>
                Our mail server did not answer — {error} Send the summary below to us on Messenger,
                or call and read it out, and we will confirm a time within one working day.
              </ThemedText>
              <View style={[styles.recap, { borderColor: Brand.seaglass }]}>
                <ThemedText type="data" style={{ color: Brand.bone }} selectable>
                  {summary}
                </ThemedText>
              </View>
              <Button label="Try sending again" tone="sun" onPress={submit} />
              <Button label="Edit details" tone="sun" onPress={editAgain} />
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
                  label="Email for a confirmation (optional)"
                  value={email}
                  onChange={setEmail}
                  placeholder="you@example.com"
                  keyboardType="email-address"
                  autoComplete="email"
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
                    Days you are free for the visit
                  </ThemedText>
                  <ThemedText type="small" themeColor="textMuted">
                    Tap every day that works — we will call to confirm one of them. No visits on Sundays.
                  </ThemedText>
                  <VisitCalendar
                    first={range.first}
                    last={range.last}
                    selected={dates}
                    onToggle={(iso) =>
                      setDates((cur) => (cur.includes(iso) ? cur.filter((x) => x !== iso) : [...cur, iso]))
                    }
                  />
                  {dates.length ? (
                    <ThemedText type="small" themeColor="textSecondary">
                      {dates.length === 1 ? '1 day' : `${dates.length} days`}: {[...dates].sort().map(dayLabel).join(', ')}
                    </ThemedText>
                  ) : null}
                </View>

                <View style={{ gap: Spacing.two }}>
                  <ThemedText type="eyebrow" themeColor="textMuted">
                    Time of day
                  </ThemedText>
                  <View style={styles.chipRow}>
                    {TIMES.map((w) => (
                      <Chip key={w} label={w} selected={time === w} onPress={() => setTime(w)} />
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

                <Button
                  label={status === 'sending' ? 'Sending…' : 'Request my free survey'}
                  onPress={submit}
                  full
                />
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
  keyboardType?: 'default' | 'numeric' | 'phone-pad' | 'email-address';
  autoComplete?: 'name' | 'tel' | 'email';
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
        autoCapitalize={keyboardType === 'email-address' ? 'none' : undefined}
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
