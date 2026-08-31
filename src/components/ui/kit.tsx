import { Link, type Href } from 'expo-router';
import { useCallback, useEffect, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type ViewProps } from 'react-native';
import Animated, {
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { Reveal } from '../motion';
import { ThemedText } from '../themed-text';

import { Radius, Spacing, type ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/* ---------------- surfaces ---------------- */

export function Card({ style, children, ...rest }: ViewProps) {
  const t = useTheme();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: t.backgroundElement, borderColor: t.line },
        style,
      ]}
      {...rest}>
      {children}
    </View>
  );
}

export function Section({
  eyebrow,
  title,
  lede,
  children,
  tinted,
}: {
  eyebrow?: string;
  title?: string;
  lede?: string;
  children?: ReactNode;
  tinted?: boolean;
}) {
  const t = useTheme();
  return (
    <View
      style={[
        styles.section,
        tinted && { backgroundColor: t.backgroundSelected, borderColor: t.line, borderTopWidth: 1, borderBottomWidth: 1 },
      ]}>
      <View style={styles.sectionInner}>
        <Reveal>
          {eyebrow ? (
            <ThemedText type="eyebrow" themeColor="textMuted" style={{ marginBottom: Spacing.two }}>
              {eyebrow}
            </ThemedText>
          ) : null}
          {title ? <ThemedText type="title">{title}</ThemedText> : null}
          {lede ? (
            <ThemedText type="lede" themeColor="textSecondary" style={{ marginTop: Spacing.two }}>
              {lede}
            </ThemedText>
          ) : null}
        </Reveal>
        {children ? <View style={{ marginTop: Spacing.four }}>{children}</View> : null}
      </View>
    </View>
  );
}

/* ---------------- controls ---------------- */

type ButtonProps = {
  label: string;
  onPress?: () => void;
  href?: Href;
  tone?: 'primary' | 'sun' | 'ghost';
  full?: boolean;
};

/** Written from module scope so the React Compiler doesn't see a frozen value. */
function pressTo(press: SharedValue<number>, to: 0 | 1) {
  press.value = withTiming(to, {
    duration: to === 1 ? 90 : 220,
    easing: Easing.out(Easing.quad),
  });
}

export function Button({ label, onPress, href, tone = 'primary', full }: ButtonProps) {
  const t = useTheme();
  const bg = tone === 'primary' ? t.accent : tone === 'sun' ? t.sun : 'transparent';
  const fg = tone === 'ghost' ? t.text : tone === 'sun' ? '#171C19' : t.onAccent;

  /** 0 while resting, 1 while held — drives a small settle under the finger. */
  const press = useSharedValue(0);
  const onPressIn = useCallback(() => pressTo(press, 1), [press]);
  const onPressOut = useCallback(() => pressTo(press, 0), [press]);
  const pressStyle = useAnimatedStyle(() => ({
    opacity: 1 - press.value * 0.22,
    transform: [{ scale: 1 - press.value * 0.035 }],
  }));

  const inner = (
    <Animated.View
      style={[
        styles.button,
        { backgroundColor: bg, borderColor: tone === 'ghost' ? t.lineStrong : bg },
        full && { alignSelf: 'stretch' },
        pressStyle,
      ]}>
      <ThemedText type="heading" style={{ color: fg, fontSize: 15 }}>
        {label}
      </ThemedText>
    </Animated.View>
  );

  const pressableProps = {
    onPressIn,
    onPressOut,
    style: full ? ({ alignSelf: 'stretch' } as const) : undefined,
  };

  if (href) {
    return (
      <Link href={href} asChild>
        <Pressable {...pressableProps}>{inner}</Pressable>
      </Link>
    );
  }
  return (
    <Pressable onPress={onPress} {...pressableProps}>
      {inner}
    </Pressable>
  );
}

/** Eases a chip between its unselected and selected fills. */
function selectTo(on: SharedValue<number>, to: 0 | 1) {
  on.value = withTiming(to, { duration: 180, easing: Easing.out(Easing.quad) });
}

export function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  const press = useSharedValue(0);
  const on = useSharedValue(selected ? 1 : 0);

  useEffect(() => {
    selectTo(on, selected ? 1 : 0);
  }, [selected, on]);

  const onPressIn = useCallback(() => pressTo(press, 1), [press]);
  const onPressOut = useCallback(() => pressTo(press, 0), [press]);

  const animatedStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(on.value, [0, 1], [t.backgroundElement, t.accent]),
    borderColor: interpolateColor(on.value, [0, 1], [t.lineStrong, t.accent]),
    transform: [{ scale: 1 - press.value * 0.05 }],
  }));

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}>
      <Animated.View style={[styles.chip, animatedStyle]}>
        <ThemedText type="data" style={{ color: selected ? t.onAccent : t.textSecondary, fontSize: 12 }}>
          {label}
        </ThemedText>
      </Animated.View>
    </Pressable>
  );
}

/* ---------------- data display ---------------- */

/** Drops the figure back a step and lets it settle, so a recalculation reads. */
function resettle(settle: SharedValue<number>) {
  settle.value = 0;
  settle.value = withTiming(1, { duration: 320, easing: Easing.out(Easing.cubic) });
}

export function Stat({
  label,
  value,
  sub,
  hero,
}: {
  label: string;
  value: string;
  sub?: string;
  hero?: boolean;
}) {
  const t = useTheme();
  const settle = useSharedValue(0);

  // The label is the constant; only the figure beneath it replays on a change.
  useEffect(() => {
    resettle(settle);
  }, [value, sub, settle]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: 0.35 + settle.value * 0.65,
    transform: [{ translateY: (1 - settle.value) * 7 }],
  }));

  return (
    <View
      style={[
        styles.stat,
        {
          backgroundColor: hero ? t.accent : t.backgroundSelected,
          borderColor: hero ? t.accent : t.line,
        },
      ]}>
      <ThemedText type="eyebrow" style={{ color: hero ? t.sun : t.textMuted }}>
        {label}
      </ThemedText>
      <Animated.View style={animatedStyle}>
        <ThemedText type="dataLarge" style={{ color: hero ? t.sun : t.text, marginTop: Spacing.one }}>
          {value}
        </ThemedText>
        {sub ? (
          <ThemedText
            type="small"
            style={{ color: hero ? t.onAccent : t.textMuted, marginTop: Spacing.half, fontSize: 13 }}>
            {sub}
          </ThemedText>
        ) : null}
      </Animated.View>
    </View>
  );
}

export function Bullet({ children, tone = 'sun' }: { children: ReactNode; tone?: ThemeColor }) {
  const t = useTheme();
  return (
    <View style={styles.bullet}>
      <View style={[styles.bulletDot, { backgroundColor: t[tone] }]} />
      <ThemedText type="small" themeColor="textSecondary" style={{ flex: 1 }}>
        {children}
      </ThemedText>
    </View>
  );
}

export function Rule() {
  const t = useTheme();
  return <View style={{ height: 1, backgroundColor: t.line, marginVertical: Spacing.three }} />;
}

export function Callout({ title, children }: { title: string; children: ReactNode }) {
  const t = useTheme();
  return (
    <View
      style={[
        styles.callout,
        { backgroundColor: t.backgroundSelected, borderLeftColor: t.sun, borderColor: t.line },
      ]}>
      <ThemedText type="eyebrow" themeColor="textMuted">
        {title}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={{ marginTop: Spacing.two }}>
        {children}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: Radius.md, padding: Spacing.four, gap: Spacing.two },
  section: { paddingVertical: Spacing.six * 0.72, paddingHorizontal: Spacing.four },
  sectionInner: { width: '100%', alignSelf: 'center', maxWidth: 820 },
  button: {
    borderWidth: 1,
    borderRadius: Radius.sm,
    paddingVertical: Spacing.three * 0.8,
    paddingHorizontal: Spacing.four,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chip: {
    borderWidth: 1,
    borderRadius: Radius.sm,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three * 0.8,
  },
  stat: { borderWidth: 1, borderRadius: Radius.md, padding: Spacing.three, flexGrow: 1, flexBasis: 150 },
  bullet: { flexDirection: 'row', gap: Spacing.two, alignItems: 'flex-start' },
  bulletDot: { width: 6, height: 6, borderRadius: 3, marginTop: 8 },
  callout: {
    borderWidth: 1,
    borderLeftWidth: 3,
    borderRadius: Radius.sm,
    padding: Spacing.three,
  },
});
