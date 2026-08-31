/**
 * Motion primitives for the marketing screens.
 *
 * `MotionScrollView` publishes its scroll offset on a shared value; `Reveal`
 * subscribes to it and fades its children up the first time they cross into the
 * viewport. Outside a `MotionScrollView` (the estimate and booking screens) a
 * `Reveal` simply plays on mount, so the primitive is safe to use anywhere.
 *
 * Every shared value is written from a module-level helper rather than inline:
 * the React Compiler treats a value captured by one hook as frozen for later
 * ones, and this keeps all the mutation in one place either way.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import {
  useWindowDimensions,
  type ScrollViewProps,
  type StyleProp,
  type View,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedReaction,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

const DURATION = 560;
const EASE = Easing.out(Easing.cubic);
/** Fraction of the screen height a block must reach before it plays. */
const TRIGGER = 0.88;
/** If a measurement never lands, show the content anyway. */
const SAFETY_MS = 1800;

const ScrollYContext = createContext<SharedValue<number> | null>(null);

/** The enclosing `MotionScrollView`'s offset, or null when there isn't one. */
export function useScrollY() {
  return useContext(ScrollYContext);
}

export function MotionScrollView({ children, ...rest }: ScrollViewProps & { children?: ReactNode }) {
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((event) => {
    scrollY.value = event.contentOffset.y;
  });

  return (
    <ScrollYContext.Provider value={scrollY}>
      <Animated.ScrollView onScroll={onScroll} scrollEventThrottle={16} {...rest}>
        {children}
      </Animated.ScrollView>
    </ScrollYContext.Provider>
  );
}

type RevealState = {
  /** 0 hidden, 1 fully in place. */
  progress: SharedValue<number>;
  revealed: SharedValue<boolean>;
  /** Where the block sits in scroll-content space, once measured. */
  anchor: SharedValue<number>;
  measured: SharedValue<boolean>;
};

/** Plays the reveal once, from either thread. */
function beginReveal(s: RevealState, hold: number) {
  'worklet';
  if (s.revealed.value) return;
  s.revealed.value = true;
  s.progress.value = withDelay(hold, withTiming(1, { duration: DURATION, easing: EASE }));
}

/** Records a window-space measurement as a scroll-content position. */
function anchorReveal(s: RevealState, scrollY: SharedValue<number>, windowY: number) {
  s.anchor.value = windowY + scrollY.value;
  s.measured.value = true;
}

function isMeasured(s: RevealState) {
  return s.measured.value;
}

type RevealProps = {
  children: ReactNode;
  /** Milliseconds to hold before playing — used to stagger lists. */
  delay?: number;
  /** How far the block travels up, in points. */
  distance?: number;
  style?: StyleProp<ViewStyle>;
};

export function Reveal({ children, delay = 0, distance = 18, style }: RevealProps) {
  const scrollY = useScrollY();
  const { height } = useWindowDimensions();
  const reducedMotion = useReducedMotion();

  const ref = useAnimatedRef<View>();
  const progress = useSharedValue(reducedMotion ? 1 : 0);
  const revealed = useSharedValue(reducedMotion);
  const anchor = useSharedValue(0);
  const measured = useSharedValue(false);
  const state: RevealState = useMemo(
    () => ({ progress, revealed, anchor, measured }),
    [progress, revealed, anchor, measured],
  );

  const onLayout = useCallback(() => {
    const node = ref.current;
    // Nothing to watch, or nothing measurable: treat it as an on-mount entrance.
    if (!scrollY || !node || typeof node.measureInWindow !== 'function') {
      beginReveal(state, delay);
      return;
    }
    node.measureInWindow((_x, y) => {
      if (typeof y !== 'number' || !Number.isFinite(y)) {
        beginReveal(state, delay);
        return;
      }
      anchorReveal(state, scrollY, y);
    });
  }, [delay, ref, scrollY, state]);

  useAnimatedReaction(
    () => (measured.value ? (scrollY?.value ?? 0) : null),
    (offset) => {
      if (offset === null) return;
      if (anchor.value - offset < height * TRIGGER) beginReveal(state, delay);
    },
    [height, delay],
  );

  useEffect(() => {
    const id = setTimeout(() => {
      if (isMeasured(state)) return;
      beginReveal(state, 0);
    }, SAFETY_MS);
    return () => clearTimeout(id);
  }, [state]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * distance }],
  }));

  return (
    <Animated.View ref={ref} onLayout={onLayout} style={[style, animatedStyle]}>
      {children}
    </Animated.View>
  );
}
