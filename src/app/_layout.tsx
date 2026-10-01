import { DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';

import { Colors } from '@/constants/theme';

SplashScreen.preventAutoHideAsync();

const BrandNavTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: Colors.light.accent,
    background: Colors.light.background,
    card: Colors.light.background,
    text: Colors.light.text,
    border: Colors.light.line,
  },
};

/**
 * Two sections share the root: the public site in (site), and the staff-only
 * pages under /internal, which bring their own navigation and sign-in gate.
 */
export default function RootLayout() {
  useEffect(() => {
    SplashScreen.hideAsync();
  }, []);

  return (
    <ThemeProvider value={BrandNavTheme}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(site)" />
        <Stack.Screen name="internal" />
      </Stack>
    </ThemeProvider>
  );
}
