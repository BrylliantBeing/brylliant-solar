import { Link, usePathname, type Href } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandMark } from '@/components/brand-mark';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useStaffSession } from '@/lib/staff-session';
import { useTheme } from '@/hooks/use-theme';

/** Internal pages are work tools, so they run wider than the marketing site. */
export const InternalMaxWidth = 1120;

const NAV: { label: string; href: Href; match: (path: string) => boolean }[] = [
  { label: 'Dashboard', href: '/internal', match: (p) => p === '/internal' },
  { label: 'Quote', href: '/internal/quote', match: (p) => p.startsWith('/internal/quote') },
  { label: 'Saved', href: '/internal/saved', match: (p) => p.startsWith('/internal/saved') },
  { label: 'Status', href: '/internal/status', match: (p) => p.startsWith('/internal/status') },
];

export function StaffShell({ children }: { children: ReactNode }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const path = usePathname();
  const { user, signOut } = useStaffSession();

  return (
    <View style={{ flex: 1, backgroundColor: t.background }}>
      <View style={[styles.bar, { borderBottomColor: t.line, paddingTop: insets.top, backgroundColor: t.background }]}>
        <View style={styles.barInner}>
          <View style={styles.brand}>
            <BrandMark size={26} />
            <ThemedText type="eyebrow" themeColor="textMuted">
              Staff
            </ThemedText>
          </View>
          <View style={styles.links}>
            {NAV.map((item) => {
              const active = item.match(path);
              return (
                <Link key={item.label} href={item.href} asChild>
                  {/* Link's Slot rejects style arrays, so flatten first. */}
                  <Pressable style={StyleSheet.flatten([styles.link, active && { backgroundColor: t.backgroundSelected }])}>
                    <ThemedText type="link" themeColor={active ? 'text' : 'textMuted'}>
                      {item.label}
                    </ThemedText>
                  </Pressable>
                </Link>
              );
            })}
          </View>
          <View style={styles.user}>
            <ThemedText type="small" themeColor="textMuted" numberOfLines={1}>
              {user?.name}
            </ThemedText>
            <Pressable onPress={signOut} accessibilityRole="button" style={styles.link}>
              <ThemedText type="link" themeColor="accentWarm">
                Sign out
              </ThemedText>
            </Pressable>
          </View>
        </View>
      </View>
      <View style={{ flex: 1 }}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { borderBottomWidth: 1 },
  barInner: {
    width: '100%',
    maxWidth: InternalMaxWidth,
    alignSelf: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    gap: Spacing.two,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  links: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  link: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.two * 0.8, borderRadius: Radius.sm },
  user: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, flexShrink: 1 },
});
