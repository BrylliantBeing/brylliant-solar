/**
 * The brand runs light-only, matching the website.
 * Flip FORCE_LIGHT to false (and app.json userInterfaceStyle back to "automatic")
 * to let the app follow the device theme — the dark palette is already defined.
 */

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

const FORCE_LIGHT = true;

export function useTheme() {
  const scheme = useColorScheme();
  if (FORCE_LIGHT) return Colors.light;
  return Colors[scheme === 'dark' ? 'dark' : 'light'];
}
