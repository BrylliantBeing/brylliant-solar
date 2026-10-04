import { TabList, TabSlot, TabTrigger, Tabs, type TabListProps, type TabTriggerSlotProps } from 'expo-router/ui';
import { Pressable, StyleSheet, View } from 'react-native';

import classes from './app-tabs.module.css';
import { BrandMark } from './brand-mark';
import { ThemedText } from './themed-text';

import { MaxContentWidth, Spacing } from '@/constants/theme';
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
          <TabTrigger name="about" href="/about" asChild>
            <NavButton>About</NavButton>
          </TabTrigger>
          <TabTrigger name="book" href="/book" asChild>
            <NavButton>
              {/* The site is exported as static HTML, so the phone layout is a CSS media query, not a JS width check. */}
              <span className={classes.wide}>Book a survey</span>
              <span className={classes.narrow}>Book</span>
            </NavButton>
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
          <div className={classes.wordmark}>
            <ThemedText type="heading" style={{ fontSize: 15 }}>
              Brylliant
            </ThemedText>
            <ThemedText type="eyebrow" themeColor="textMuted" style={{ fontSize: 7.5, letterSpacing: 3 }}>
              SOLAR
            </ThemedText>
          </div>
        </View>
        <div className={classes.links}>{props.children}</div>
      </View>
    </View>
  );
}

function NavButton({ children, isFocused, ...props }: TabTriggerSlotProps) {
  const t = useTheme();
  return (
    <Pressable {...props} style={({ pressed }) => pressed && styles.pressed}>
      <div
        className={classes.link}
        style={isFocused ? { backgroundColor: t.backgroundSelected } : undefined}>
        <ThemedText type="link" themeColor={isFocused ? 'text' : 'textMuted'}>
          {children}
        </ThemedText>
      </div>
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
    overflow: 'hidden', // never let the bar widen the page
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
  pressed: { opacity: 0.7 },
});
