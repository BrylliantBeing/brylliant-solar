import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandMark } from '@/components/brand-mark';
import { ThemedText } from '@/components/themed-text';
import { Button, Card } from '@/components/ui/kit';
import { Radius, Spacing } from '@/constants/theme';
import { useStaffSession } from '@/lib/staff-session';
import { useTheme } from '@/hooks/use-theme';

export function StaffSignIn() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { status, signIn, continueWithoutServer } = useStaffSession();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return;
    if (!username.trim() || !password) {
      setError('Enter your username and password.');
      return;
    }
    setBusy(true);
    setError(await signIn(username.trim(), password));
    setBusy(false);
  }

  const inputStyle = [styles.input, { color: t.text, borderColor: t.lineStrong, backgroundColor: t.background }];

  return (
    <View style={[styles.page, { backgroundColor: t.background, paddingTop: insets.top + Spacing.five }]}>
      <Card style={styles.card}>
        <View style={styles.brand}>
          <BrandMark size={34} />
          <View>
            <ThemedText type="heading">Brylliant Solar</ThemedText>
            <ThemedText type="eyebrow" themeColor="textMuted">
              Staff only
            </ThemedText>
          </View>
        </View>

        <ThemedText type="eyebrow" themeColor="textMuted" style={{ marginTop: Spacing.three }}>
          Username
        </ThemedText>
        <TextInput
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="username"
          accessibilityLabel="Username"
          style={inputStyle}
        />
        <ThemedText type="eyebrow" themeColor="textMuted">
          Password
        </ThemedText>
        <TextInput
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="current-password"
          accessibilityLabel="Password"
          onSubmitEditing={submit}
          style={inputStyle}
        />

        {error ? (
          <ThemedText type="small" accessibilityRole="alert" style={{ color: t.accentWarm }}>
            {error}
          </ThemedText>
        ) : null}

        <View style={{ marginTop: Spacing.two }}>
          <Button label={busy ? 'Signing in…' : 'Sign in'} onPress={submit} full />
        </View>

        {__DEV__ && status === 'noServer' ? (
          <View style={[styles.dev, { borderColor: t.line, backgroundColor: t.backgroundSelected }]}>
            <ThemedText type="small" themeColor="textSecondary">
              Dev server: /api/auth.php isn&apos;t running here (Metro has no PHP), so sign-in can&apos;t
              be checked. This bypass does not exist in production builds.
            </ThemedText>
            <Button label="Continue as local dev" tone="ghost" onPress={continueWithoutServer} />
          </View>
        ) : null}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, alignItems: 'center', paddingHorizontal: Spacing.three },
  card: { width: '100%', maxWidth: 380 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  input: {
    borderWidth: 1,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 16,
  },
  dev: { borderWidth: 1, borderRadius: Radius.sm, padding: Spacing.three, gap: Spacing.two, marginTop: Spacing.three },
});
