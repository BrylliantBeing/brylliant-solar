import { Slot } from 'expo-router';
import Head from 'expo-router/head';
import { ActivityIndicator, View } from 'react-native';

import { StaffShell } from '@/components/internal/staff-shell';
import { StaffSignIn } from '@/components/internal/staff-sign-in';
import { StaffSessionProvider, useStaffSession } from '@/lib/staff-session';
import { useTheme } from '@/hooks/use-theme';

/**
 * Everything under /internal is staff-only. The static HTML for these routes only
 * ever contains the loading state; the pages render once auth.php confirms a
 * session. Any internal data must come from APIs that call require_staff().
 */
export default function InternalLayout() {
  return (
    <StaffSessionProvider>
      <Head>
        <title>Brylliant Solar · Staff</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <Gate />
    </StaffSessionProvider>
  );
}

function Gate() {
  const { status } = useStaffSession();
  const t = useTheme();

  if (status === 'loading') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.background }}>
        <ActivityIndicator color={t.accent} />
      </View>
    );
  }
  if (status !== 'signedIn') return <StaffSignIn />;
  return (
    <StaffShell>
      <Slot />
    </StaffShell>
  );
}
