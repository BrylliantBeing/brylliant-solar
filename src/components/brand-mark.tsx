import { useEffect } from 'react';
import { View, type ViewProps } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { ThemedText } from './themed-text';

import { Brand } from '@/constants/theme';

type Props = ViewProps & {
  size?: number;
  /** Reversed treatment for placing the mark on Canopy, Sulu or Basalt. */
  reversed?: boolean;
  /** Slowly breathe the sun disc — for the hero mark, not the small ones. */
  pulse?: boolean;
};

/**
 * "The Vinta Sun" — three banded rows rising off a horizon with the sun behind.
 * Drawn from the brand book's 128-unit grid using border trapezoids, so it needs
 * no SVG dependency and stays crisp at any size.
 *
 * React Native uses border-box sizing: a View's `width` includes its borders, so
 * a band with total width B and border (B-T)/2 on each side renders a trapezoid
 * B wide at the bottom and T wide at the top.
 */
export function BrandMark({ size = 40, reversed = false, pulse = false, style, ...rest }: Props) {
  const k = size / 128;
  const band = (bottom: number, top: number, height: number, left: number, color: string) => ({
    position: 'absolute' as const,
    left: left * k,
    width: bottom * k,
    height: height * k,
    borderLeftWidth: ((bottom - top) / 2) * k,
    borderRightWidth: ((bottom - top) / 2) * k,
    borderBottomWidth: height * k,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: color,
  });

  const upper = reversed ? Brand.seaglass : Brand.sulu;
  const lower = reversed ? Brand.bone : Brand.canopy;

  return (
    <View style={[{ width: size, height: size }, style]} {...rest}>
      <SunDisc k={k} pulse={pulse} />
      <View style={[band(31.4, 0, 30, 42.3, upper), { top: 14 * k }]} />
      <View style={[band(62.6, 37.6, 24, 26.7, lower), { top: 50 * k }]} />
      <View style={[band(96, 68.8, 26, 10, lower), { top: 80 * k }]} />
    </View>
  );
}

/**
 * The sun itself. It is drawn before the bands, so a breath only shows where
 * the disc clears them — it swells out of the horizon rather than over it.
 */
function SunDisc({ k, pulse }: { k: number; pulse: boolean }) {
  const breath = useSharedValue(0);

  useEffect(() => {
    if (!pulse) return;
    breath.value = withRepeat(
      withTiming(1, { duration: 2600, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
    return () => cancelAnimation(breath);
  }, [pulse, breath]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: 1 - breath.value * 0.18,
    transform: [{ scale: 1 + breath.value * 0.09 }],
  }));

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          left: 63 * k,
          top: 17 * k,
          width: 46 * k,
          height: 46 * k,
          borderRadius: 23 * k,
          backgroundColor: Brand.noon,
        },
        animatedStyle,
      ]}
    />
  );
}

export function Wordmark({ size = 17, reversed = false }: { size?: number; reversed?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: size * 0.55 }}>
      <BrandMark size={size * 2} reversed={reversed} />
      <View>
        <WordmarkText size={size} reversed={reversed} />
      </View>
    </View>
  );
}

function WordmarkText({ size, reversed }: { size: number; reversed: boolean }) {
  return (
    <>
      <ThemedText
        type="heading"
        style={{ fontSize: size, lineHeight: size * 1.05 }}
        themeColor={reversed ? 'onAccent' : 'text'}>
        Brylliant
      </ThemedText>
      <ThemedText
        type="eyebrow"
        style={{ fontSize: size * 0.46, letterSpacing: size * 0.19, marginTop: 2 }}
        themeColor={reversed ? 'onAccent' : 'textMuted'}>
        SOLAR
      </ThemedText>
    </>
  );
}
