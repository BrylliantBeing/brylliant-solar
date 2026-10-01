import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { InternalMaxWidth } from './staff-shell';

import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Scrollable, width-capped frame shared by every /internal page. */
export function InternalPage({
  eyebrow,
  title,
  lede,
  children,
}: {
  eyebrow: string;
  title: string;
  lede?: string;
  children?: ReactNode;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={{ backgroundColor: t.background }}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.six }]}
      keyboardShouldPersistTaps="handled">
      <View style={styles.inner}>
        <ThemedText type="eyebrow" themeColor="textMuted">
          {eyebrow}
        </ThemedText>
        <ThemedText type="title" style={{ marginTop: Spacing.two }}>
          {title}
        </ThemedText>
        {lede ? (
          <ThemedText type="small" themeColor="textSecondary" style={{ marginTop: Spacing.two, maxWidth: 680 }}>
            {lede}
          </ThemedText>
        ) : null}
        <View style={{ marginTop: Spacing.four, gap: Spacing.three }}>{children}</View>
      </View>
    </ScrollView>
  );
}

/** A dashed card standing in for a section that hasn't been built yet. */
export function ComingSoon({ title, children }: { title: string; children: ReactNode }) {
  const t = useTheme();
  return (
    <Card style={{ borderStyle: 'dashed', borderColor: t.lineStrong, backgroundColor: t.background }}>
      <ThemedText type="eyebrow" themeColor="textMuted">
        Placeholder
      </ThemedText>
      <ThemedText type="heading">{title}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {children}
      </ThemedText>
    </Card>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: Spacing.three, paddingTop: Spacing.five, alignItems: 'center' },
  inner: { width: '100%', maxWidth: InternalMaxWidth },
});
