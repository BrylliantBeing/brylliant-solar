import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { JobBadge } from '@/components/internal/job-badge';
import { MessageList, SmallButton } from '@/components/internal/quote-parts';
import { ThemedText } from '@/components/themed-text';
import { Chip } from '@/components/ui/kit';
import { VisitCalendar } from '@/components/visit-calendar';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  PERMIT_STEPS,
  closeProject,
  saveProject,
  setPermitStep,
  type Permit,
  type PermitStep,
  type Pipeline,
  type Project,
  type ProjectInput,
  type ProjectJob,
} from '@/lib/projects-api';
import { peso } from '@/lib/quote-input';
import { addDays, dayLabel, installPlan, manilaDay, todayInManila, type EventKind } from '@/lib/schedule';
import { ROLE_LABELS } from '@/lib/staff-session';

export type SidebarTab = 'surveys' | 'installs' | 'permits';

/** What the calendar is waiting to place, keyed so the sidebar can mark it. */
export type PlacingKey = `survey-${number}` | `install-${number}` | null;

/** Must match PROPERTY in src/app/(site)/book.tsx. */
const PROPERTY = ['Home', 'Business', 'Dealer enquiry'];
/** Must match TIMES in src/app/(site)/book.tsx. */
const TIMES = ['Morning', 'Afternoon', 'Any time'];

/** Approved, else the latest step done, else null. */
export function permitStatus(permits: Permit[], projectId: number): Permit | null {
  const mine = permits.filter((p) => p.projectId === projectId);
  for (const step of ['approved', 'submitted', 'docs_prepared'] as PermitStep[]) {
    const found = mine.find((p) => p.step === step);
    if (found) return found;
  }
  return null;
}

/**
 * The owner's to-do list: survey requests, jobs and permits not yet on the
 * calendar. Pressing Place puts the calendar into placing mode for that item.
 */
export function CalendarSidebar({
  pipeline,
  tab,
  onTab,
  placing,
  onPlaceSurvey,
  onPlaceInstall,
  onChanged,
}: {
  pipeline: Pipeline;
  tab: SidebarTab;
  onTab: (tab: SidebarTab) => void;
  placing: PlacingKey;
  onPlaceSurvey: (project: Project) => void;
  onPlaceInstall: (job: ProjectJob, project: Project) => void;
  onChanged: () => void;
}) {
  const t = useTheme();
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const active = pipeline.projects.filter((p) => p.status === 'active');
  const byId = new Map(pipeline.projects.map((p) => [p.id, p]));

  const surveys = active.filter((p) => !p.surveyAt);
  const installs = pipeline.jobs.filter((j) => !j.installAt && byId.get(j.projectId)?.status === 'active');
  const permits = active.filter(
    (p) => pipeline.jobs.some((j) => j.projectId === p.id) && permitStatus(pipeline.permits, p.id)?.step !== 'approved',
  );

  const tabs: { key: SidebarTab; label: string; count: number; kind: EventKind }[] = [
    { key: 'surveys', label: 'Surveys', count: surveys.length, kind: 'survey' },
    { key: 'installs', label: 'Installations', count: installs.length, kind: 'install' },
    { key: 'permits', label: 'Permitting', count: permits.length, kind: 'permit_approved' },
  ];
  const toggle = (key: string) => setOpen((o) => (o === key ? null : key));

  return (
    <View style={[styles.sidebar, { borderColor: t.line, backgroundColor: t.backgroundElement }]}>
      <View style={[styles.tabs, { borderBottomColor: t.line }]} accessibilityRole="tablist">
        {tabs.map((x) => (
          <Pressable
            key={x.key}
            onPress={() => onTab(x.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === x.key }}
            style={[styles.tab, tab === x.key && { borderBottomColor: t.accent }]}>
            <JobBadge kind={x.kind} projectId={7} customer="" size={12} />
            <ThemedText type="link" themeColor={tab === x.key ? 'text' : 'textMuted'} style={{ fontSize: 13 }}>
              {x.label} {x.count ? `(${x.count})` : ''}
            </ThemedText>
          </Pressable>
        ))}
      </View>

      <View style={styles.list}>
        {tab === 'surveys' ? (
          <>
            <ThemedText type="small" themeColor="textMuted" style={{ fontSize: 12 }}>
              Survey requests not yet booked. Website bookings land here on their own.
            </ThemedText>
            {adding ? (
              <ProjectForm onDone={(changed) => { setAdding(false); if (changed) onChanged(); }} />
            ) : (
              <View style={{ alignSelf: 'flex-start' }}>
                <SmallButton label="+ New request" onPress={() => setAdding(true)} />
              </View>
            )}
            {surveys.length === 0 ? <Empty>No surveys waiting.</Empty> : null}
            {surveys.map((p) => (
              <ProjectCard
                key={p.id}
                kind="survey"
                project={p}
                open={open === `s${p.id}`}
                onToggle={() => toggle(`s${p.id}`)}
                placing={placing === `survey-${p.id}`}
                onPlace={() => onPlaceSurvey(p)}
                onChanged={onChanged}
              />
            ))}
          </>
        ) : null}

        {tab === 'installs' ? (
          <>
            <ThemedText type="small" themeColor="textMuted" style={{ fontSize: 12 }}>
              Jobs with no installation booked. Make a job from a saved quote.
            </ThemedText>
            {installs.length === 0 ? <Empty>No installations waiting.</Empty> : null}
            {installs.map((j) => {
              const p = byId.get(j.projectId);
              if (!p) return null;
              const plan = installPlan(j.panels);
              const permit = permitStatus(pipeline.permits, p.id);
              return (
                <ProjectCard
                  key={j.id}
                  kind="install"
                  project={p}
                  extra={`${j.panels} panels · ${plan.installDays} install + ${plan.inspectionDays} inspection day · permit ${
                    permit ? PERMIT_STEPS.find((s) => s.step === permit.step)!.label.toLowerCase() : 'not started'
                  }`}
                  open={open === `i${j.id}`}
                  onToggle={() => toggle(`i${j.id}`)}
                  placing={placing === `install-${j.id}`}
                  onPlace={() => onPlaceInstall(j, p)}
                  jobId={j.id}
                  onChanged={onChanged}
                />
              );
            })}
          </>
        ) : null}

        {tab === 'permits' ? (
          <>
            <ThemedText type="small" themeColor="textMuted" style={{ fontSize: 12 }}>
              Projects with a job whose permit isn&apos;t approved yet: the city electrical permit and the
              ZAMCELCO net-metering application. Submitted and approved dates show on the calendar.
            </ThemedText>
            {permits.length === 0 ? <Empty>No permits pending.</Empty> : null}
            {permits.map((p) => {
              const status = permitStatus(pipeline.permits, p.id);
              return (
                <ProjectCard
                  key={p.id}
                  kind="permit_approved"
                  project={p}
                  extra={status ? `${PERMIT_STEPS.find((s) => s.step === status.step)!.label} ${dayLabel(status.doneOn)}` : 'Not started'}
                  open={open === `p${p.id}`}
                  onToggle={() => toggle(`p${p.id}`)}
                  onChanged={onChanged}>
                  <PermitEditor project={p} pipeline={pipeline} onChanged={onChanged} />
                </ProjectCard>
              );
            })}
          </>
        ) : null}
      </View>
    </View>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <ThemedText type="small" themeColor="textMuted" style={{ paddingVertical: Spacing.three }}>
      {children}
    </ThemedText>
  );
}

/** Location, bill and property up front; everything else when opened. */
function ProjectCard({
  kind,
  project: p,
  extra,
  open,
  onToggle,
  placing,
  onPlace,
  jobId,
  onChanged,
  children,
}: {
  kind: EventKind;
  project: Project;
  extra?: string;
  open: boolean;
  onToggle: () => void;
  placing?: boolean;
  onPlace?: () => void;
  jobId?: number;
  onChanged: () => void;
  children?: ReactNode;
}) {
  const t = useTheme();
  const [editing, setEditing] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const basics = [p.monthlyBill ? `${peso(p.monthlyBill)}/mo` : null, p.property || null].filter(Boolean).join(' · ');

  async function close() {
    if (!confirmClose) {
      setConfirmClose(true);
      return;
    }
    try {
      await closeProject(p.id, true);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <View style={[styles.card, { borderColor: placing ? t.accent : t.line, backgroundColor: t.background }]}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => [styles.cardHead, pressed && { opacity: 0.7 }]}>
        <JobBadge kind={kind} projectId={p.id} customer={p.customer} size={26} />
        <View style={{ flex: 1, gap: 1 }}>
          <ThemedText type="smallBold" numberOfLines={1}>
            {p.customer}
          </ThemedText>
          <ThemedText type="data" themeColor="textSecondary" style={{ fontSize: 11 }} numberOfLines={open ? undefined : 1}>
            {p.address || 'No address yet'}
          </ThemedText>
          {basics ? (
            <ThemedText type="data" themeColor="textMuted" style={{ fontSize: 11 }}>
              {basics}
            </ThemedText>
          ) : null}
          {extra ? (
            <ThemedText type="data" themeColor="textMuted" style={{ fontSize: 11 }}>
              {extra}
            </ThemedText>
          ) : null}
        </View>
        <ThemedText type="data" themeColor="textMuted" style={{ fontSize: 12 }}>
          {open ? '▴' : '▾'}
        </ThemedText>
      </Pressable>

      {placing ? (
        <ThemedText type="data" style={{ fontSize: 11, color: t.accent }}>
          Placing: pick a {kind === 'survey' ? 'time' : 'first day'} on the calendar →
        </ThemedText>
      ) : null}

      {open ? (
        editing ? (
          <ProjectForm project={p} onDone={(changed) => { setEditing(false); if (changed) onChanged(); }} />
        ) : (
          <View style={{ gap: Spacing.two }}>
            <View style={{ gap: 2 }}>
              <Detail label="Mobile" value={p.phone} />
              <Detail label="Email" value={p.email} />
              <Detail
                label="Free on"
                value={p.freeDates.length ? p.freeDates.map((d) => dayLabel(d)).join(', ') : ''}
              />
              <Detail label="Time" value={p.timePref} />
              <Detail label="Notes" value={p.notes} />
              <Detail
                label="From"
                value={`${p.source === 'booking' ? 'Website booking' : p.source === 'quote' ? 'A saved quote' : 'Added by hand'}, ${dayLabel(manilaDay(p.createdAt), true)}`}
              />
            </View>
            {children}
            <View style={styles.buttons}>
              {onPlace ? <SmallButton label={placing ? 'Placing…' : 'Place on calendar'} onPress={onPlace} strong /> : null}
              {jobId ? <SmallButton label="Open job" onPress={() => router.push({ pathname: '/internal/job', params: { id: String(jobId) } })} /> : null}
              <SmallButton label="Edit details" onPress={() => setEditing(true)} />
              <SmallButton label={confirmClose ? 'Confirm close' : 'Close project'} onPress={close} />
            </View>
            {error ? <MessageList title="Could not close" tone="warn" items={[error]} /> : null}
          </View>
        )
      ) : onPlace && !placing ? (
        <View style={{ alignSelf: 'flex-start' }}>
          <SmallButton label="Place on calendar" onPress={onPlace} />
        </View>
      ) : null}
    </View>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 12 }}>
      <ThemedText type="smallBold" style={{ fontSize: 12 }}>
        {label}:{' '}
      </ThemedText>
      {value}
    </ThemedText>
  );
}

/** Add a request (phoned in, Messenger) or correct one. */
function ProjectForm({ project, onDone }: { project?: Project; onDone: (changed: boolean) => void }) {
  const t = useTheme();
  const [form, setForm] = useState<ProjectInput>(() => ({
    id: project?.id,
    customer: project?.customer ?? '',
    phone: project?.phone ?? '',
    email: project?.email ?? '',
    address: project?.address ?? '',
    monthlyBill: project?.monthlyBill ?? null,
    property: project?.property ?? PROPERTY[0],
    freeDates: project?.freeDates ?? [],
    timePref: project?.timePref || TIMES[2],
    notes: project?.notes ?? '',
  }));
  const [bill, setBill] = useState(project?.monthlyBill ? String(project.monthlyBill) : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const today = todayInManila();

  const field = (key: 'customer' | 'phone' | 'email' | 'address' | 'notes', placeholder: string, multiline = false) => (
    <TextInput
      value={form[key]}
      onChangeText={(v) => setForm((f) => ({ ...f, [key]: v }))}
      placeholder={placeholder}
      placeholderTextColor={t.textMuted}
      multiline={multiline}
      accessibilityLabel={placeholder}
      style={[styles.input, { color: t.text, borderColor: t.lineStrong, backgroundColor: t.backgroundElement }, multiline && { minHeight: 60 }]}
    />
  );

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const n = Number(bill.replace(/[,\s₱]/g, ''));
      await saveProject({ ...form, monthlyBill: bill.trim() && Number.isFinite(n) ? n : null });
      onDone(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={{ gap: Spacing.two }}>
      {field('customer', 'Customer name')}
      {field('phone', 'Mobile number')}
      {field('email', 'Email (optional)')}
      {field('address', 'Address')}
      <TextInput
        value={bill}
        onChangeText={setBill}
        placeholder="Monthly bill ₱"
        placeholderTextColor={t.textMuted}
        keyboardType="decimal-pad"
        inputMode="decimal"
        accessibilityLabel="Monthly bill in pesos"
        style={[styles.input, { color: t.text, borderColor: t.lineStrong, backgroundColor: t.backgroundElement }]}
      />
      <View style={styles.buttons}>
        {PROPERTY.map((x) => (
          <Chip key={x} label={x} selected={form.property === x} onPress={() => setForm((f) => ({ ...f, property: x }))} />
        ))}
      </View>
      <ThemedText type="eyebrow" themeColor="textMuted">
        Days they are free
      </ThemedText>
      <VisitCalendar
        first={today}
        last={addDays(today, 90)}
        selected={form.freeDates}
        onToggle={(d) =>
          setForm((f) => ({ ...f, freeDates: f.freeDates.includes(d) ? f.freeDates.filter((x) => x !== d) : [...f.freeDates, d] }))
        }
      />
      <View style={styles.buttons}>
        {TIMES.map((x) => (
          <Chip key={x} label={x} selected={form.timePref === x} onPress={() => setForm((f) => ({ ...f, timePref: x }))} />
        ))}
      </View>
      {field('notes', 'Notes', true)}
      {error ? <MessageList title="Could not save" tone="warn" items={[error]} /> : null}
      <View style={styles.buttons}>
        <SmallButton label={saving ? 'Saving…' : project ? 'Save' : 'Add request'} onPress={submit} strong />
        <SmallButton label="Cancel" onPress={() => onDone(false)} />
      </View>
    </View>
  );
}

/** The three permit steps, each with a date and who's handling it (the electrical engineer by default). */
function PermitEditor({ project, pipeline, onChanged }: { project: Project; pipeline: Pipeline; onChanged: () => void }) {
  const t = useTheme();
  const electrician = pipeline.directory.find((s) => s.role === 'electrician')?.username ?? '';
  const existing = (step: PermitStep) => pipeline.permits.find((p) => p.projectId === project.id && p.step === step);
  const [dates, setDates] = useState<Record<PermitStep, string>>(() => ({
    docs_prepared: existing('docs_prepared')?.doneOn ?? '',
    submitted: existing('submitted')?.doneOn ?? '',
    approved: existing('approved')?.doneOn ?? '',
  }));
  const [owner, setOwner] = useState(
    existing('approved')?.owner || existing('submitted')?.owner || existing('docs_prepared')?.owner || electrician,
  );
  const [busy, setBusy] = useState<PermitStep | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(step: PermitStep, doneOn: string | null) {
    if (doneOn !== null && !/^\d{4}-\d{2}-\d{2}$/.test(doneOn)) {
      setError('Dates are YYYY-MM-DD, e.g. 2026-10-12.');
      return;
    }
    setBusy(step);
    setError(null);
    try {
      await setPermitStep({ projectId: project.id, step, doneOn, owner });
      setDates((d) => ({ ...d, [step]: doneOn ?? '' }));
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={[styles.permit, { borderColor: t.line }]}>
      <ThemedText type="eyebrow" themeColor="textMuted">
        Handled by
      </ThemedText>
      <View style={styles.buttons}>
        {pipeline.directory.map((s) => (
          <Chip
            key={s.username}
            label={`${s.name} · ${ROLE_LABELS[s.role]}`}
            selected={owner === s.username}
            onPress={() => setOwner(s.username)}
          />
        ))}
      </View>
      {PERMIT_STEPS.map(({ step, label }) => {
        const done = existing(step);
        return (
          <View key={step} style={{ gap: Spacing.one }}>
            <ThemedText type="smallBold" style={{ fontSize: 12 }}>
              {done ? '✓ ' : ''}
              {label}
              {done ? ` · ${dayLabel(done.doneOn, true)}` : ''}
            </ThemedText>
            <View style={styles.buttons}>
              <TextInput
                value={dates[step]}
                onChangeText={(v) => setDates((d) => ({ ...d, [step]: v }))}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={t.textMuted}
                accessibilityLabel={`${label} date`}
                style={[styles.input, { width: 120, flexGrow: 0, color: t.text, borderColor: t.lineStrong, backgroundColor: t.backgroundElement }]}
              />
              <SmallButton label="Today" onPress={() => setDates((d) => ({ ...d, [step]: todayInManila() }))} />
              <SmallButton label={busy === step ? 'Saving…' : 'Save'} onPress={() => save(step, dates[step].trim())} strong />
              {done ? <SmallButton label="Clear" onPress={() => save(step, null)} /> : null}
            </View>
          </View>
        );
      })}
      {error ? <MessageList title="Could not save" tone="warn" items={[error]} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  sidebar: { borderWidth: 1, borderRadius: Radius.md, overflow: 'hidden' },
  tabs: { flexDirection: 'row', borderBottomWidth: 1 },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: Spacing.two,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  list: { padding: Spacing.two, gap: Spacing.two },
  card: { borderWidth: 1, borderRadius: Radius.sm, padding: Spacing.two, gap: Spacing.two },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one, alignItems: 'center' },
  input: { borderWidth: 1, borderRadius: Radius.sm, paddingHorizontal: Spacing.two, paddingVertical: Spacing.one + 2, fontSize: 14 },
  permit: { borderTopWidth: 1, paddingTop: Spacing.two, gap: Spacing.two },
});
