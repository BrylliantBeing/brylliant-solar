import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { InternalPage } from '@/components/internal/internal-page';
import { JobBadge } from '@/components/internal/job-badge';
import { MessageList, SmallButton } from '@/components/internal/quote-parts';
import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui/kit';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { listJobs, type JobSummary } from '@/lib/jobs-api';
import { peso } from '@/lib/quote-input';
import { manilaTime } from '@/lib/quotes-api';
import { dayLabel, installPlan, manilaDay } from '@/lib/schedule';

export default function Jobs() {
  const t = useTheme();
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listJobs()
      .then(setJobs)
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <InternalPage
      eyebrow="Jobs"
      title="Jobs"
      lede="What each customer is actually getting, edited from their quote. Start a job from a saved quote.">
      <View style={{ alignSelf: 'flex-start' }}>
        <SmallButton label="Saved quotes" onPress={() => router.push('/internal/saved')} strong />
      </View>
      {error ? <MessageList title="Could not load jobs" tone="warn" items={[error]} /> : null}
      {jobs === null && !error ? (
        <ActivityIndicator color={t.accent} style={{ alignSelf: 'flex-start' }} />
      ) : jobs && jobs.length === 0 ? (
        <Card>
          <ThemedText type="heading">No jobs yet</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Open a saved quote and press Create job.
          </ThemedText>
        </Card>
      ) : (
        <View style={{ gap: Spacing.two }}>
          {jobs?.map((j) => {
            const plan = installPlan(j.panels);
            return (
              <Pressable
                key={j.id}
                onPress={() => router.push({ pathname: '/internal/job', params: { id: String(j.id) } })}
                accessibilityRole="link"
                style={({ pressed }) => [styles.row, { borderColor: t.line, backgroundColor: t.backgroundElement }, pressed && { opacity: 0.7 }]}>
                <JobBadge kind="install" projectId={j.projectId} customer={j.customer} size={26} />
                <View style={styles.main}>
                  <ThemedText type="heading">{j.customer}</ThemedText>
                  <ThemedText type="data" themeColor="textSecondary" style={{ fontSize: 12 }}>
                    {j.systemType === 'grid-tie' ? 'Grid-tie' : 'Hybrid'} · {j.panels} panels · {plan.installDays} + {plan.inspectionDays} days
                    {j.address ? ` · ${j.address}` : ''}
                  </ThemedText>
                  <ThemedText type="data" themeColor="textMuted" style={{ fontSize: 11 }}>
                    #{j.id} · {j.installAt ? `installing from ${dayLabel(manilaDay(j.installAt), true)}` : 'installation not scheduled'} ·
                    updated {manilaTime(j.updatedAt)} by {j.updatedBy}
                  </ThemedText>
                </View>
                <ThemedText type="dataLarge" style={{ fontSize: 18, color: t.accent }}>
                  {peso(j.total)}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
      )}
    </InternalPage>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing.three,
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: Spacing.three,
  },
  main: { flexGrow: 1, flexBasis: 260, gap: 2 },
});
