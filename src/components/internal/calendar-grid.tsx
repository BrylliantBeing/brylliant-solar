import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { JobBadge } from '@/components/internal/job-badge';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  DAY_END,
  DAY_START,
  KIND_META,
  addDays,
  clock,
  manilaDay,
  manilaIso,
  manilaMinutes,
  overlaps,
  weekday,
  type CalendarEvent,
  type EventKind,
} from '@/lib/schedule';

/** Something drawn on the calendar: a booked event, or one being placed. */
export type GridItem = {
  key: string;
  kind: EventKind;
  projectId: number;
  customer: string;
  /** ISO, UTC */
  start: string;
  end: string;
  allDay: boolean;
  /** Being placed, not booked yet */
  pending?: boolean;
  event?: CalendarEvent;
};

const ROW_H = 22;
const SLOT_MIN = 30;
const ROWS = (DAY_END - DAY_START) / SLOT_MIN;
const TIME_COL = 44;
const MIN_COL = 96;

const dayRange = (day: string) => ({ start: manilaIso(day), end: manilaIso(addDays(day, 1)) });

/**
 * Scrolls sideways only when the columns can't fit. A horizontal ScrollView
 * sizes its content to the text, so the width is pinned to what's measured.
 */
function FitScroll({ minWidth, children }: { minWidth: number; children: ReactNode }) {
  const [width, setWidth] = useState(0);
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <View style={{ width: Math.max(width, minWidth) }}>{children}</View>
    </ScrollView>
  );
}

/** Side-by-side lanes for overlapping timed items in one day. */
function lanes(items: GridItem[]): { item: GridItem; lane: number; of: number }[] {
  const sorted = [...items].sort((a, b) => a.start.localeCompare(b.start));
  const ends: string[] = [];
  const placed = sorted.map((item) => {
    let lane = ends.findIndex((end) => end <= item.start);
    if (lane === -1) lane = ends.push(item.end) - 1;
    else ends[lane] = item.end;
    return { item, lane };
  });
  return placed.map((p) => ({ ...p, of: ends.length }));
}

/**
 * A Monday-to-Sunday week, 07:00–18:00 in half hours. All-day work
 * (installations, inspections, permit markers) sits in a strip above the hours.
 * With onSlot, every half hour is pressable (placing mode).
 */
export function WeekGrid({
  days,
  items,
  today,
  onSlot,
  onItem,
  highlightDays = [],
}: {
  days: string[];
  items: GridItem[];
  today: string;
  onSlot?: (day: string, minutes: number) => void;
  onItem: (item: GridItem) => void;
  highlightDays?: string[];
}) {
  const t = useTheme();
  const allDay = items.filter((i) => i.allDay);
  const timed = items.filter((i) => !i.allDay);

  return (
    <FitScroll minWidth={TIME_COL + MIN_COL * days.length}>
      {/* Day headings */}
      <View style={[styles.row, { borderBottomColor: t.lineStrong }]}>
        <View style={{ width: TIME_COL }} />
        {days.map((day) => {
          const sunday = weekday(day) === 0;
          return (
            <View key={day} style={[styles.col, styles.head, highlightDays.includes(day) && { backgroundColor: t.backgroundSelected }]}>
              <ThemedText type="eyebrow" themeColor={day === today ? 'accent' : sunday ? 'textMuted' : 'textSecondary'}>
                {new Date(`${day}T00:00:00Z`).toLocaleDateString('en-PH', { timeZone: 'UTC', weekday: 'short', day: 'numeric' })}
              </ThemedText>
              {highlightDays.includes(day) ? (
                <ThemedText type="data" style={{ fontSize: 10, color: t.accent }}>
                  customer free
                </ThemedText>
              ) : sunday ? (
                <ThemedText type="data" themeColor="textMuted" style={{ fontSize: 10 }}>
                  no site work
                </ThemedText>
              ) : null}
            </View>
          );
        })}
      </View>

      {/* All-day strip */}
      <View style={[styles.row, { borderBottomColor: t.lineStrong, minHeight: 34 }]}>
        <View style={[styles.timeCell, { width: TIME_COL }]}>
          <ThemedText type="data" themeColor="textMuted" style={{ fontSize: 10 }}>
            all day
          </ThemedText>
        </View>
        {days.map((day) => (
          <Pressable
            key={day}
            disabled={!onSlot}
            onPress={() => onSlot?.(day, DAY_START)}
            style={({ hovered }: { hovered?: boolean }) => [
              styles.col,
              styles.allDayCell,
              { borderLeftColor: t.line },
              weekday(day) === 0 && { backgroundColor: t.backgroundSelected },
              onSlot && hovered && { backgroundColor: t.backgroundSelected },
            ]}>
            {allDay
              .filter((i) => overlaps(i, dayRange(day)))
              .map((i) => (
                <Chip key={i.key + day} item={i} onPress={() => onItem(i)} />
              ))}
          </Pressable>
        ))}
      </View>

      {/* Hours */}
      <View style={styles.row}>
        <View style={{ width: TIME_COL }}>
          {Array.from({ length: ROWS }, (_, r) => (
            <View key={r} style={[styles.timeCell, { height: ROW_H }]}>
              {r % 2 === 0 ? (
                <ThemedText type="data" themeColor="textMuted" style={{ fontSize: 10 }}>
                  {clock(DAY_START + r * SLOT_MIN)}
                </ThemedText>
              ) : null}
            </View>
          ))}
        </View>
        {days.map((day) => (
          <View
            key={day}
            style={[
              styles.col,
              { borderLeftColor: t.line, borderLeftWidth: 1, height: ROWS * ROW_H },
              weekday(day) === 0 && { backgroundColor: t.backgroundSelected },
              highlightDays.includes(day) && { backgroundColor: t.backgroundSelected },
            ]}>
            {Array.from({ length: ROWS }, (_, r) => (
              <Pressable
                key={r}
                disabled={!onSlot}
                onPress={() => onSlot?.(day, DAY_START + r * SLOT_MIN)}
                accessibilityLabel={onSlot ? `${day} ${clock(DAY_START + r * SLOT_MIN)}` : undefined}
                style={({ hovered }: { hovered?: boolean }) => [
                  { height: ROW_H, borderTopWidth: r % 2 === 0 ? 1 : 0, borderTopColor: t.line },
                  onSlot && hovered && { backgroundColor: t.line },
                ]}
              />
            ))}
            {lanes(timed.filter((i) => manilaDay(i.start) === day)).map(({ item, lane, of }) => {
              const from = Math.max(DAY_START, manilaMinutes(item.start));
              const to = Math.min(DAY_END, manilaDay(item.end) === day ? manilaMinutes(item.end) : DAY_END);
              return (
                <Block
                  key={item.key}
                  item={item}
                  onPress={() => onItem(item)}
                  style={{
                    top: ((from - DAY_START) / SLOT_MIN) * ROW_H,
                    height: Math.max(ROW_H, ((to - from) / SLOT_MIN) * ROW_H),
                    left: `${(lane / of) * 100}%`,
                    width: `${100 / of}%`,
                  }}
                />
              );
            })}
          </View>
        ))}
      </View>
    </FitScroll>
  );
}

/** Six weeks from the Monday on or before the 1st. */
export function MonthGrid({
  weeks,
  month,
  items,
  today,
  onDay,
  onItem,
  highlightDays = [],
}: {
  weeks: string[][];
  /** YYYY-MM */
  month: string;
  items: GridItem[];
  today: string;
  onDay: (day: string) => void;
  onItem: (item: GridItem) => void;
  highlightDays?: string[];
}) {
  const t = useTheme();
  return (
    <FitScroll minWidth={MIN_COL * 7}>
      <View style={[styles.row, { borderBottomColor: t.lineStrong }]}>
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
          <View key={d} style={[styles.col, styles.head]}>
            <ThemedText type="eyebrow" themeColor="textMuted">
              {d}
            </ThemedText>
          </View>
        ))}
      </View>
      {weeks.map((week) => (
        <View key={week[0]} style={[styles.row, { borderBottomColor: t.line }]}>
          {week.map((day) => {
            const dayItems = items
              .filter((i) => overlaps(i, dayRange(day)))
              .sort((a, b) => a.start.localeCompare(b.start));
            return (
              <Pressable
                key={day}
                onPress={() => onDay(day)}
                style={({ hovered }: { hovered?: boolean }) => [
                  styles.col,
                  styles.monthCell,
                  { borderLeftColor: t.line },
                  (weekday(day) === 0 || highlightDays.includes(day)) && { backgroundColor: t.backgroundSelected },
                  hovered && { backgroundColor: t.line },
                ]}>
                <ThemedText
                  type="data"
                  style={{
                    fontSize: 12,
                    fontWeight: day === today ? '700' : '400',
                    color: day === today ? t.accent : day.startsWith(month) ? t.text : t.textMuted,
                  }}>
                  {Number(day.slice(8))}
                </ThemedText>
                {dayItems.slice(0, 4).map((i) => (
                  <Chip key={i.key + day} item={i} onPress={() => onItem(i)} showTime />
                ))}
                {dayItems.length > 4 ? (
                  <ThemedText type="data" themeColor="textMuted" style={{ fontSize: 10 }}>
                    +{dayItems.length - 4} more
                  </ThemedText>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      ))}
    </FitScroll>
  );
}

/** One line: badge, then the time (if timed) and customer. */
function Chip({ item, onPress, showTime }: { item: GridItem; onPress: () => void; showTime?: boolean }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${KIND_META[item.kind].label}, ${item.customer}`}
      style={({ pressed }) => [
        styles.chip,
        {
          borderColor: item.pending ? t.accent : t.line,
          borderStyle: item.pending ? 'dashed' : 'solid',
          backgroundColor: t.backgroundElement,
        },
        pressed && { opacity: 0.7 },
      ]}>
      <JobBadge kind={item.kind} projectId={item.projectId} customer={item.customer} size={16} />
      <ThemedText type="data" numberOfLines={1} style={{ fontSize: 11, flexShrink: 1 }}>
        {showTime && !item.allDay ? `${clock(manilaMinutes(item.start))} ` : ''}
        {item.customer}
      </ThemedText>
    </Pressable>
  );
}

/** A timed item in the hours grid. */
function Block({ item, onPress, style }: { item: GridItem; onPress: () => void; style: object }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${KIND_META[item.kind].label}, ${item.customer}, ${clock(manilaMinutes(item.start))}`}
      style={({ pressed }) => [
        styles.block,
        {
          borderColor: item.pending ? t.accent : t.lineStrong,
          borderStyle: item.pending ? 'dashed' : 'solid',
          backgroundColor: t.backgroundElement,
        },
        style,
        pressed && { opacity: 0.7 },
      ]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <JobBadge kind={item.kind} projectId={item.projectId} customer={item.customer} size={16} />
        <ThemedText type="data" style={{ fontSize: 10 }} themeColor="textMuted">
          {clock(manilaMinutes(item.start))}–{clock(manilaMinutes(item.end))}
        </ThemedText>
      </View>
      <ThemedText type="data" numberOfLines={2} style={{ fontSize: 11 }}>
        {item.pending ? 'New: ' : ''}
        {item.customer}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: 'transparent' },
  col: { flex: 1, minWidth: 0 },
  head: { paddingVertical: Spacing.two, paddingHorizontal: Spacing.one, gap: 2 },
  timeCell: { alignItems: 'flex-end', paddingRight: Spacing.one, justifyContent: 'flex-start' },
  allDayCell: { borderLeftWidth: 1, padding: 2, gap: 2 },
  monthCell: { borderLeftWidth: 1, minHeight: 92, padding: 3, gap: 2 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: Radius.sm,
    paddingHorizontal: 3,
    paddingVertical: 2,
  },
  block: {
    position: 'absolute',
    borderWidth: 1,
    borderRadius: Radius.sm,
    padding: 3,
    gap: 2,
    overflow: 'hidden',
  },
});
