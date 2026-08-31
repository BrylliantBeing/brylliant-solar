import { TabList, TabSlot, TabTrigger, Tabs, type TabListProps, type TabTriggerSlotProps } from 'expo-router/ui';
import { Pressable, StyleSheet, View } from 'react-native';

import { BrandMark } from './brand-mark';
import { ThemedText } from './themed-text';

import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export default function AppTabs() {
  return (
    <Tabs>
      <TabSlot style={{ height: '100%' }} />
      <TabList asChild>
        <NavBar>
          <TabTrigger name="index" href="/" asChild>
            <NavButton>Home</NavButton>
          </TabTrigger>
          <TabTrigger name="estimate" href="/estimate" asChild>
            <NavButton>Estimate</NavButton>
          </TabTrigger>
          <TabTrigger name="book" href="/book" asChild>
            <NavButton>Book a survey</NavButton>
          </TabTrigger>
        </NavBar>
      </TabList>
    </Tabs>
  );
}

function NavBar({ style, ...props }: TabListProps) {
  const t = useTheme();
  return (
    // `style` is spread first so the bar's own styles win over the one TabList injects.
    <View
      {...props}
      style={[style, styles.bar, { backgroundColor: t.background, borderBottomColor: t.line }]}>
      <View style={styles.barInner}>
        <View style={styles.brand}>
          <BrandMark size={30} />
          <View>
            <ThemedText type="heading" style={{ fontSize: 15 }}>
              Brylliant
            </ThemedText>
            <ThemedText type="eyebrow" themeColor="textMuted" style={{ fontSize: 7.5, letterSpacing: 3 }}>
              SOLAR
            </ThemedText>
          </View>
        </View>
        <View style={styles.links}>{props.children}</View>
      </View>
    </View>
  );
}

function NavButton({ children, isFocused, ...props }: TabTriggerSlotProps) {
  const t = useTheme();
  return (
    <Pressable {...props} style={({ pressed }) => pressed && styles.pressed}>
      <View
        style={[
          styles.link,
          isFocused && { backgroundColor: t.backgroundSelected },
        ]}>
        <ThemedText type="link" themeColor={isFocused ? 'text' : 'textMuted'}>
          {children}
        </ThemedText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    top: 0,
    flexDirection: 'column',
    width: '100%',
    borderBottomWidth: 1,
    zIndex: 50,
  },
  barInner: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    gap: Spacing.three,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  links: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  link: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.two * 0.9, borderRadius: Radius.sm },
  pressed: { opacity: 0.7 },
});
