/**
 * Brylliant Solar brand palette.
 * Source of truth is the brand book: Canopy green leads, Sulu blue supports,
 * Noon amber accents and never exceeds ~10% of a layout.
 */

import '@/global.css';

import { Platform } from 'react-native';

/** Raw brand colours — use these when a value must not flip with the theme
 *  (the logo mark, a reversed panel, print-matched fills). */
export const Brand = {
  canopy: '#28453A',
  sulu: '#1C4655',
  noon: '#E7A93C',
  clay: '#9C5638',
  moss: '#7F9F82',
  seaglass: '#8CB0B8',
  sand: '#F3EDE1',
  bone: '#FDFBF6',
  basalt: '#171C19',
} as const;

export const Colors = {
  light: {
    text: '#171C19',
    textSecondary: '#414B44',
    textMuted: '#6B7570',
    background: '#FDFBF6',
    backgroundElement: '#FFFFFF',
    backgroundSelected: '#F3EDE1',
    line: '#E9E2D3',
    lineStrong: '#CFC4AF',
    accent: '#28453A',
    accentAlt: '#1C4655',
    accentWarm: '#9C5638',
    sun: '#E7A93C',
    onAccent: '#FDFBF6',
  },
  dark: {
    text: '#EDE7DA',
    textSecondary: '#C3C9C0',
    textMuted: '#A6AEA4',
    background: '#12160F',
    backgroundElement: '#1B211C',
    backgroundSelected: '#232A24',
    line: '#303A33',
    lineStrong: '#47524A',
    accent: '#9BBA9E',
    accentAlt: '#A3C3CA',
    accentWarm: '#D98A50',
    sun: '#E7A93C',
    onAccent: '#12160F',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: { sans: 'system-ui', serif: 'ui-serif', rounded: 'ui-rounded', mono: 'ui-monospace' },
  default: { sans: 'normal', serif: 'serif', rounded: 'normal', mono: 'monospace' },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const Radius = { sm: 3, md: 6, lg: 10, pill: 999 } as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 820;
