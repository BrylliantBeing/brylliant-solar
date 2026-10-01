import { StyleSheet, View } from 'react-native';

import { ComingSoon, InternalPage } from '@/components/internal/internal-page';
import { ThemedText } from '@/components/themed-text';
import { Button, Card } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useStaffSession } from '@/lib/staff-session';

export default function InternalDashboard() {
  const { user } = useStaffSession();

  return (
    <InternalPage eyebrow="Dashboard" title={`Hello, ${user?.name ?? 'team'}`}>
      <Card>
        <ThemedText type="eyebrow" themeColor="textMuted">
          Ready to use
        </ThemedText>
        <ThemedText type="heading">Hybrid quote calculator</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Upload a customer&apos;s hourly consumption and the outage history to size panels,
          inverters and batteries and price the job. It simulates a full year against the
          Zamboanga sun profile.
        </ThemedText>
        <View style={{ marginTop: Spacing.two, alignSelf: 'flex-start' }}>
          <Button label="Open the calculator" href="/internal/quote" />
        </View>
      </Card>

      <View style={styles.grid}>
        <View style={styles.cell}>
          <ComingSoon title="Pipeline">
            Leads from the booking form, surveys scheduled, quotes sent and jobs won.
          </ComingSoon>
        </View>
        <View style={styles.cell}>
          <ComingSoon title="Installed systems">
            Fleet output against forecast, and systems that need a visit.
          </ComingSoon>
        </View>
        <View style={styles.cell}>
          <ComingSoon title="Status checks">
            Website, quote mailer and inverter monitoring health.
          </ComingSoon>
        </View>
      </View>
    </InternalPage>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  cell: { flexGrow: 1, flexBasis: 260 },
});
