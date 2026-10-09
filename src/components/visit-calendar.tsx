import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Dates are plain YYYY-MM-DD strings handled as UTC midnights, so the grid is
 * the same calendar whatever zone the device is in.
 */
const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
const toIso = (d: Date) => d.toISOString().slice(0, 10);
const monthStart = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
const addMonths = (d: Date, n: number) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));

/**
 * Month-view calendar for picking several days. Days outside first..last and
 * Sundays (no site visits) cannot be chosen.
 */
export function VisitCalendar({
  first,
  last,
  selected,
  onToggle,
}: {
  first: string;
  last: string;
  selected: string[];
  onToggle: (iso: string) => void;
}) {
  const t = useTheme();
  const minMonth = monthStart(toDate(first));
  const maxMonth = monthStart(toDate(last));
  const [month, setMonth] = useState(minMonth);

  const canBack = month > minMonth;
  const canForward = month < maxMonth;

  // Leading blanks so the 1st lands under its weekday, then every day of the month.
  const daysInMonth = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).getUTCDate();
  const cells: (string | null)[] = [
    ...Array<null>(month.getUTCDay()).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) =>
      toIso(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), i + 1))),
    ),
  ];
  while (cells.length % 7) cells.push(null);

  const title = month.toLocaleDateString('en-PH', { timeZone: 'UTC', month: 'long', year: 'numeric' });

  return (
    <View style={[styles.box, { borderColor: t.lineStrong, backgroundColor: t.background }]}>
      <View style={styles.header}>
        <NavButton label="‹" hint="Previous month" enabled={canBack} onPress={() => setMonth(addMonths(month, -1))} />
        <ThemedText type="data" accessibilityRole="header">
          {title}
        </ThemedText>
        <NavButton label="›" hint="Next month" enabled={canForward} onPress={() => setMonth(addMonths(month, 1))} />
      </View>

      <View style={styles.row}>
        {WEEKDAYS.map((w) => (
          <View key={w} style={styles.cell}>
            <ThemedText type="small" themeColor="textMuted" style={{ fontSize: 11 }}>
              {w}
            </ThemedText>
          </View>
        ))}
      </View>

      <View style={styles.row}>
        {cells.map((iso, i) => {
          if (!iso) return <View key={`blank-${i}`} style={styles.cell} />;
          const day = toDate(iso);
          const enabled = iso >= first && iso <= last && day.getUTCDay() !== 0;
          const on = selected.includes(iso);
          const label = day.toLocaleDateString('en-PH', {
            timeZone: 'UTC',
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          });
          return (
            <View key={iso} style={styles.cell}>
              <Pressable
                disabled={!enabled}
                onPress={() => onToggle(iso)}
                accessibilityRole="button"
                accessibilityLabel={label}
                accessibilityState={{ selected: on, disabled: !enabled }}
                style={({ pressed }) => [
                  styles.day,
                  on && { backgroundColor: t.accent },
                  enabled && !on && { borderColor: t.lineStrong },
                  pressed && { opacity: 0.7 },
                ]}>
                <ThemedText
                  type="data"
                  style={{
                    fontSize: 13,
                    color: on ? t.onAccent : enabled ? t.text : t.textMuted,
                    opacity: enabled ? 1 : 0.45,
                  }}>
                  {day.getUTCDate()}
                </ThemedText>
              </Pressable>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function NavButton({
  label,
  hint,
  enabled,
  onPress,
}: {
  label: string;
  hint: string;
  enabled: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      disabled={!enabled}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={hint}
      accessibilityState={{ disabled: !enabled }}
      hitSlop={8}
      style={[styles.nav, { borderColor: t.lineStrong, opacity: enabled ? 1 : 0.3 }]}>
      <ThemedText type="data" style={{ fontSize: 18, lineHeight: 20 }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderRadius: Radius.md, padding: Spacing.two, gap: Spacing.one, maxWidth: 380 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: Spacing.two,
  },
  nav: {
    width: 32,
    height: 32,
    borderWidth: 1,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, aspectRatio: 1, padding: 2, alignItems: 'center', justifyContent: 'center' },
  day: {
    width: '100%',
    height: '100%',
    maxWidth: 44,
    maxHeight: 44,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
