import { View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Chip } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { ROLE_LABELS } from '@/lib/staff-session';
import type { CrewMember, StaffEntry } from '@/lib/schedule';

/** Who goes: every staff member as a toggle, labelled with their role. */
export function CrewPicker({
  title,
  directory,
  value,
  onChange,
}: {
  title: string;
  directory: StaffEntry[];
  value: CrewMember[];
  onChange: (next: CrewMember[]) => void;
}) {
  const on = new Set(value.map((c) => c.username));
  return (
    <View style={{ gap: Spacing.one }}>
      <ThemedText type="eyebrow" themeColor="textMuted">
        {title}
      </ThemedText>
      {directory.length === 0 ? (
        <ThemedText type="small" themeColor="textMuted">
          No staff accounts to assign. Add roles to STAFF_USERS.
        </ThemedText>
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one }}>
          {directory.map((s) => (
            <Chip
              key={s.username}
              label={`${s.name} · ${ROLE_LABELS[s.role]}`}
              selected={on.has(s.username)}
              onPress={() =>
                onChange(
                  on.has(s.username)
                    ? value.filter((c) => c.username !== s.username)
                    : [...value, { username: s.username, role: s.role }],
                )
              }
            />
          ))}
        </View>
      )}
    </View>
  );
}
