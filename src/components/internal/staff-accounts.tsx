import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Platform, StyleSheet, TextInput, View } from 'react-native';

import { MessageList, SmallButton } from '@/components/internal/quote-parts';
import { ThemedText } from '@/components/themed-text';
import { Card, Chip } from '@/components/ui/kit';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  createAccount,
  deleteAccount,
  generatePassword,
  listAccounts,
  setPassword,
  updateAccount,
  type StaffAccount,
} from '@/lib/staff-api';
import { ROLE_LABELS, type StaffRole } from '@/lib/staff-session';

const ROLES = Object.keys(ROLE_LABELS) as StaffRole[];

/**
 * Who can sign in, for the owner dashboard. Accounts made here are stored in
 * MySQL; ones from STAFF_USERS in hPanel are shown but changed only there.
 */
export function StaffAccounts() {
  const t = useTheme();
  const [data, setData] = useState<{ accounts: StaffAccount[]; me: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  /** Shown once after a create or reset, so the owner can pass it on. */
  const [handover, setHandover] = useState<{ username: string; password: string } | null>(null);

  useEffect(() => {
    listAccounts()
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [reload]);

  const done = (shown?: { username: string; password: string }) => {
    setAdding(false);
    setOpen(null);
    setHandover(shown ?? null);
    setReload((n) => n + 1);
  };

  return (
    <Card>
      <View style={styles.head}>
        <View style={{ flex: 1 }}>
          <ThemedText type="eyebrow" themeColor="textMuted">
            Staff accounts
          </ThemedText>
          <ThemedText type="heading">Who can sign in</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Installers and the electrical engineer see only the calendar, and only their own jobs. Changes apply
            straight away, with no redeploy.
          </ThemedText>
        </View>
        {!adding ? <SmallButton label="+ Add someone" onPress={() => { setAdding(true); setHandover(null); }} strong /> : null}
      </View>

      {handover ? (
        <View style={[styles.handover, { borderColor: t.accent, backgroundColor: t.backgroundSelected }]}>
          <ThemedText type="smallBold">Give {handover.username} this password:</ThemedText>
          <ThemedText type="dataLarge" selectable style={{ fontSize: 20, color: t.accent }}>
            {handover.password}
          </ThemedText>
          <ThemedText type="small" themeColor="textMuted" style={{ fontSize: 12 }}>
            It isn&apos;t shown again. They sign in at brylliant.solar/internal.
          </ThemedText>
          <View style={styles.buttons}>
            {Platform.OS === 'web' ? (
              <SmallButton label="Copy" onPress={() => navigator.clipboard.writeText(handover.password).catch(() => {})} />
            ) : null}
            <SmallButton label="Done" onPress={() => setHandover(null)} />
          </View>
        </View>
      ) : null}

      {adding ? <AccountForm taken={new Set(data?.accounts.map((a) => a.username))} onDone={done} onCancel={() => setAdding(false)} /> : null}
      {error ? <MessageList title="Could not load the accounts" tone="warn" items={[error]} /> : null}
      {data === null && !error ? <ActivityIndicator color={t.accent} style={{ alignSelf: 'flex-start' }} /> : null}

      {data?.accounts.map((a) => {
        const self = a.username === data.me;
        return (
          <View key={a.username} style={[styles.row, { borderTopColor: t.line }]}>
            <View style={styles.rowHead}>
              <View style={{ flex: 1, minWidth: 180 }}>
                <ThemedText type="smallBold">
                  {a.name}
                  {self ? ' (you)' : ''}
                </ThemedText>
                <ThemedText type="data" themeColor="textMuted" style={{ fontSize: 12 }}>
                  {a.username} · {ROLE_LABELS[a.role]}
                  {a.source === 'env' ? ' · in hPanel STAFF_USERS' : ''}
                </ThemedText>
              </View>
              {a.source === 'db' ? (
                <SmallButton label={open === a.username ? 'Close' : 'Manage'} onPress={() => setOpen((o) => (o === a.username ? null : a.username))} />
              ) : null}
            </View>
            {open === a.username ? <ManageAccount account={a} self={self} onDone={done} /> : null}
          </View>
        );
      })}
    </Card>
  );
}

function AccountForm({
  taken,
  onDone,
  onCancel,
}: {
  taken: Set<string>;
  onDone: (shown: { username: string; password: string }) => void;
  onCancel: () => void;
}) {
  const t = useTheme();
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [role, setRole] = useState<StaffRole>('installer');
  const [password, setPw] = useState(generatePassword);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** "Ana Cruz" → "ana.cruz", until the owner types a username of their own. */
  const [typedUsername, setTypedUsername] = useState(false);
  const suggested = name.trim().toLowerCase().normalize('NFD').replace(/[^\w\s.-]/g, '').trim().replace(/\s+/g, '.').slice(0, 40);
  const finalUsername = typedUsername ? username : suggested;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await createAccount({ username: finalUsername, name: name.trim(), role, password });
      onDone({ username: finalUsername, password });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const input = [styles.input, { color: t.text, borderColor: t.lineStrong, backgroundColor: t.background }];
  return (
    <View style={[styles.form, { borderColor: t.line }]}>
      <View style={styles.fields}>
        <Field label="Name">
          <TextInput value={name} onChangeText={setName} placeholder="Ana Cruz" placeholderTextColor={t.textMuted} accessibilityLabel="Name" style={input} />
        </Field>
        <Field label={taken.has(finalUsername) ? 'Username · taken' : 'Username'}>
          <TextInput
            value={finalUsername}
            onChangeText={(v) => {
              setTypedUsername(true);
              setUsername(v.toLowerCase());
            }}
            placeholder="ana.cruz"
            placeholderTextColor={t.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Username"
            style={input}
          />
        </Field>
        <Field label="Password">
          <View style={styles.buttons}>
            <TextInput
              value={password}
              onChangeText={setPw}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="Password"
              style={[...input, { flex: 1, fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) }]}
            />
            <SmallButton label="New" onPress={() => setPw(generatePassword())} />
          </View>
        </Field>
      </View>
      <RolePicker value={role} onChange={setRole} />
      {error ? <MessageList title="Could not add them" tone="warn" items={[error]} /> : null}
      <View style={styles.buttons}>
        <SmallButton label={busy ? 'Adding…' : 'Add account'} onPress={submit} strong />
        <SmallButton label="Cancel" onPress={onCancel} />
      </View>
    </View>
  );
}

function ManageAccount({
  account,
  self,
  onDone,
}: {
  account: StaffAccount;
  self: boolean;
  onDone: (shown?: { username: string; password: string }) => void;
}) {
  const t = useTheme();
  const [name, setName] = useState(account.name);
  const [role, setRole] = useState(account.role);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<void>) {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <View style={[styles.form, { borderColor: t.line }]}>
      <Field label="Name">
        <TextInput
          value={name}
          onChangeText={setName}
          accessibilityLabel="Name"
          style={[styles.input, { color: t.text, borderColor: t.lineStrong, backgroundColor: t.background }]}
        />
      </Field>
      {self ? (
        <ThemedText type="small" themeColor="textMuted" style={{ fontSize: 12 }}>
          You stay the owner: your own role can&apos;t be changed here.
        </ThemedText>
      ) : (
        <RolePicker value={role} onChange={setRole} />
      )}
      <View style={styles.buttons}>
        <SmallButton
          label="Save"
          strong
          onPress={() => run(async () => { await updateAccount({ username: account.username, name: name.trim(), role }); onDone(); })}
        />
        <SmallButton
          label={confirmReset ? 'Confirm: new password, sign them out' : 'Reset password'}
          onPress={() =>
            confirmReset
              ? run(async () => {
                  const password = generatePassword();
                  await setPassword(account.username, password);
                  onDone({ username: account.username, password });
                })
              : setConfirmReset(true)
          }
        />
        {!self ? (
          <SmallButton
            label={confirmRemove ? 'Confirm: remove account' : 'Remove'}
            onPress={() =>
              confirmRemove ? run(async () => { await deleteAccount(account.username); onDone(); }) : setConfirmRemove(true)
            }
          />
        ) : null}
      </View>
      {confirmRemove ? (
        <ThemedText type="small" themeColor="textMuted" style={{ fontSize: 12 }}>
          They&apos;re signed out at once and taken off upcoming bookings; past bookings still show who went.
        </ThemedText>
      ) : null}
      {error ? <MessageList title="That didn't work" tone="warn" items={[error]} /> : null}
    </View>
  );
}

function RolePicker({ value, onChange }: { value: StaffRole; onChange: (role: StaffRole) => void }) {
  return (
    <View style={{ gap: Spacing.one }}>
      <ThemedText type="eyebrow" themeColor="textMuted">
        Role
      </ThemedText>
      <View style={styles.buttons}>
        {ROLES.map((r) => (
          <Chip key={r} label={ROLE_LABELS[r]} selected={value === r} onPress={() => onChange(r)} />
        ))}
      </View>
    </View>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.field}>
      <ThemedText type="eyebrow" themeColor="textMuted">
        {label}
      </ThemedText>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: Spacing.three },
  handover: { borderWidth: 1, borderRadius: Radius.sm, padding: Spacing.three, gap: Spacing.one },
  form: { borderWidth: 1, borderRadius: Radius.sm, padding: Spacing.three, gap: Spacing.three },
  fields: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  field: { flexGrow: 1, flexBasis: 200, gap: Spacing.one },
  input: { borderWidth: 1, borderRadius: Radius.sm, paddingHorizontal: Spacing.two, paddingVertical: Spacing.two, fontSize: 15 },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  row: { borderTopWidth: 1, paddingTop: Spacing.two, gap: Spacing.two },
  rowHead: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
});
