import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { permitStatus } from '@/components/internal/calendar-sidebar';
import { ComingSoon, InternalPage } from '@/components/internal/internal-page';
import { StaffAccounts } from '@/components/internal/staff-accounts';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, Stat } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { loadPipeline, type Pipeline } from '@/lib/projects-api';
import { useStaffSession } from '@/lib/staff-session';

export default function InternalDashboard() {
  const { user } = useStaffSession();
  const [pipeline, setPipeline] = useState<Pipeline | null>(null);
  const [pipelineError, setPipelineError] = useState<string | null>(null);

  useEffect(() => {
    loadPipeline()
      .then(setPipeline)
      .catch((e: Error) => setPipelineError(e.message));
  }, []);

  const active = pipeline?.projects.filter((p) => p.status === 'active') ?? [];
  const activeIds = new Set(active.map((p) => p.id));
  const counts = pipeline && {
    surveys: active.filter((p) => !p.surveyAt).length,
    installs: pipeline.jobs.filter((j) => !j.installAt && activeIds.has(j.projectId)).length,
    permits: active.filter(
      (p) => pipeline.jobs.some((j) => j.projectId === p.id) && permitStatus(pipeline.permits, p.id)?.step !== 'approved',
    ).length,
  };

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

      <Card>
        <ThemedText type="eyebrow" themeColor="textMuted">
          Waiting to be scheduled
        </ThemedText>
        <ThemedText type="heading">Jobs calendar</ThemedText>
        {counts ? (
          <View style={styles.grid}>
            <View style={styles.stat}>
              <Stat label="Surveys" value={String(counts.surveys)} sub="requests to book" />
            </View>
            <View style={styles.stat}>
              <Stat label="Installations" value={String(counts.installs)} sub="jobs to book" />
            </View>
            <View style={styles.stat}>
              <Stat label="Permits" value={String(counts.permits)} sub="not approved yet" />
            </View>
          </View>
        ) : (
          <ThemedText type="small" themeColor="textMuted">
            {pipelineError ?? 'Loading…'}
          </ThemedText>
        )}
        <View style={[styles.grid, { marginTop: Spacing.two }]}>
          <Button label="Open the calendar" href="/internal/calendar" />
          <Button label="Jobs" href="/internal/jobs" tone="ghost" />
        </View>
      </Card>

      <StaffAccounts />

      <View style={styles.grid}>
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
  stat: { flexGrow: 1, flexBasis: 140 },
});
