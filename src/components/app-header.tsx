import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Wordmark } from './brand-mark';
import { ThemedText } from './themed-text';

import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Brand bar sitting above the native tabs, which carry no header of their own.
 * The web build already has a nav bar in app-tabs.web.tsx, so app-header.web.tsx
 * renders nothing there.
 */
export function AppHeader() {
  const t = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.bar,
        { backgroundColor: t.background, borderBottomColor: t.line, paddingTop: insets.top },
      ]}>
      <StatusBar style="dark" />
      <View style={styles.inner}>
        <Wordmark size={15} />
        <ThemedText type="eyebrow" themeColor="textMuted">
          Zamboanga City
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { borderBottomWidth: 1 },
  inner: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
  },
});
