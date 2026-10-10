import { StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { KIND_META, initials, projectColor, type EventKind } from '@/lib/schedule';

/**
 * Two-axis marker for a job: the shape says the kind of work (● survey,
 * ■ installation, □ inspection, ◆ permit) and the colour says the project.
 * The project's initials ride on it, so colour is never the only cue.
 */
export function JobBadge({
  kind,
  projectId,
  customer,
  size = 22,
}: {
  kind: EventKind;
  projectId: number;
  customer: string;
  size?: number;
}) {
  const t = useTheme();
  const { fill, ink } = projectColor(projectId, t.background === Colors.dark.background);
  const { shape, label } = KIND_META[kind];
  const text = customer.trim() ? initials(customer) : '';
  const letters = (color: string) => (
    <Text style={[styles.letters, { color, fontSize: size * 0.42, lineHeight: size }]} numberOfLines={1}>
      {text}
    </Text>
  );

  const a11y = { accessible: true, accessibilityLabel: `${label}, ${customer}` };

  if (shape === 'diamond') {
    const side = size * 0.74;
    return (
      <View {...a11y} style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ position: 'absolute', width: side, height: side, backgroundColor: fill, transform: [{ rotate: '45deg' }] }} />
        {letters(ink)}
      </View>
    );
  }
  if (shape === 'outline') {
    return (
      <View {...a11y} style={[styles.box, { width: size, height: size, borderRadius: 3, borderWidth: 3, borderColor: fill }]}>
        {letters(t.text)}
      </View>
    );
  }
  return (
    <View
      {...a11y}
      style={[styles.box, { width: size, height: size, borderRadius: shape === 'circle' ? size / 2 : 3, backgroundColor: fill }]}>
      {letters(ink)}
    </View>
  );
}

/** The key to the shapes, for the top of the calendar. */
export function BadgeLegend() {
  const t = useTheme();
  const kinds: EventKind[] = ['survey', 'install', 'inspection', 'permit_approved'];
  const names: Partial<Record<EventKind, string>> = { permit_approved: 'Permit' };
  return (
    <View style={styles.legend}>
      {kinds.map((k) => (
        <View key={k} style={styles.legendItem}>
          <JobBadge kind={k} projectId={7} customer="" size={14} />
          <Text style={[styles.legendText, { color: t.textSecondary }]}>{names[k] ?? KIND_META[k].label}</Text>
        </View>
      ))}
      <Text style={[styles.legendText, { color: t.textMuted }]}>Colour + initials = project</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  letters: { fontWeight: '700', fontFamily: Fonts?.sans, textAlign: 'center', includeFontPadding: false },
  legend: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendText: { fontSize: 12, fontFamily: Fonts?.sans },
});
