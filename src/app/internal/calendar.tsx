import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View, useWindowDimensions } from 'react-native';

import { CalendarSidebar, permitStatus, type PlacingKey, type SidebarTab } from '@/components/internal/calendar-sidebar';
import { MonthGrid, WeekGrid, type GridItem } from '@/components/internal/calendar-grid';
import { CrewPicker } from '@/components/internal/crew-picker';
import { InternalPage } from '@/components/internal/internal-page';
import { BadgeLegend, JobBadge } from '@/components/internal/job-badge';
import { MessageList, SmallButton } from '@/components/internal/quote-parts';
import { ThemedText } from '@/components/themed-text';
import { Card, Chip } from '@/components/ui/kit';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { loadPipeline, type Pipeline, type Project, type ProjectJob } from '@/lib/projects-api';
import { peso } from '@/lib/quote-input';
import {
  DAY_END,
  DAY_START,
  KIND_META,
  SURVEY_HOURS,
  addDays,
  clock,
  dayLabel,
  defaultCrew,
  installPlan,
  manilaDay,
  manilaIso,
  manilaMinutes,
  mondayOf,
  planInstall,
  planSurvey,
  scheduleWarnings,
  timePrefText,
  timePrefWindow,
  todayInManila,
  type CalendarEvent,
  type CrewMember,
  type PlannedEvent,
  type StaffEntry,
} from '@/lib/schedule';
import { assignCrew, bookEvents, loadEvents, unschedule } from '@/lib/schedule-api';
import { ROLE_LABELS, useStaffSession } from '@/lib/staff-session';

/** What the owner picked in the sidebar to put on the calendar; replaceBatch when moving a booking. */
type Placing =
  | { kind: 'survey'; project: Project; replaceBatch?: string }
  | { kind: 'install'; job: ProjectJob; project: Project; replaceBatch?: string };

/** Where it would go, and who would go. */
type Pending = { day: string; minutes: number; crew: CrewMember[]; inspectionCrew: CrewMember[] };

export default function Calendar() {
  const t = useTheme();
  const wide = useWindowDimensions().width >= 1000;
  const { user } = useStaffSession();
  const owner = user?.role === 'owner';
  const { job: jobParam } = useLocalSearchParams<{ job?: string }>();

  const today = todayInManila();
  const [view, setView] = useState<'week' | 'month'>('week');
  const [anchor, setAnchor] = useState(today);
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [directory, setDirectory] = useState<StaffEntry[]>([]);
  const [pipeline, setPipeline] = useState<Pipeline | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  const [tab, setTab] = useState<SidebarTab>('surveys');
  const [placing, setPlacing] = useState<Placing | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [booking, setBooking] = useState(false);
  const [bookError, setBookError] = useState<string | null>(null);
  const [selected, setSelected] = useState<CalendarEvent | null>(null);

  /* ---- the visible range ---- */

  const range = useMemo(() => {
    if (view === 'week') {
      const first = mondayOf(anchor);
      const days = Array.from({ length: 7 }, (_, i) => addDays(first, i));
      return { days, weeks: [days], first, last: days[6], month: anchor.slice(0, 7) };
    }
    const month = anchor.slice(0, 7);
    const first = mondayOf(`${month}-01`);
    const weeks = Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(first, w * 7 + d)));
    return { days: weeks.flat(), weeks, first, last: weeks[5][6], month };
  }, [view, anchor]);

  useEffect(() => {
    let live = true;
    loadEvents(manilaIso(range.first), manilaIso(addDays(range.last, 1)))
      .then((r) => {
        if (!live) return;
        setEvents(r.events);
        setDirectory(r.directory);
        setError(null);
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [range.first, range.last, reload]);

  // /internal/calendar?job=4 (from the job page): place that installation, or show where it is. Once.
  const handledJob = useRef<string | null>(null);
  function openJobParam(p: Pipeline) {
    if (!jobParam || handledJob.current === jobParam) return;
    handledJob.current = jobParam;
    const job = p.jobs.find((j) => j.id === Number(jobParam));
    const project = job && p.projects.find((x) => x.id === job.projectId);
    if (!job || !project) return;
    if (job.installAt) {
      setAnchor(manilaDay(job.installAt));
    } else {
      setTab('installs');
      startPlacing({ kind: 'install', job, project }, {
        crew: defaultCrew('install', p.directory),
        inspectionCrew: defaultCrew('inspection', p.directory),
      });
    }
  }

  useEffect(() => {
    if (!owner) return;
    let live = true;
    loadPipeline()
      .then((p) => {
        if (!live) return;
        setPipeline(p);
        openJobParam(p);
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
    // openJobParam only acts once per ?job, so it needn't re-run the load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, reload]);

  const staff = pipeline?.directory ?? directory;

  /* ---- placing ---- */

  /** The crew a placement starts with, until a slot is picked and it can be edited. */
  const pendingCrew = useRef<{ crew: CrewMember[]; inspectionCrew: CrewMember[] }>({ crew: [], inspectionCrew: [] });

  function startPlacing(next: Placing, crew?: { crew: CrewMember[]; inspectionCrew: CrewMember[] }) {
    setPlacing(next);
    // Show the first day the customer said they're free, if it's still ahead.
    const free = next.kind === 'survey' ? next.project.freeDates.find((d) => d >= today) : undefined;
    if (free && !range.days.includes(free)) setAnchor(free);
    setSelected(null);
    setBookError(null);
    setPending(null);
    pendingCrew.current = crew ?? {
      crew: defaultCrew(next.kind, staff),
      inspectionCrew: defaultCrew('inspection', staff),
    };
  }
  function pick(day: string, minutes: number) {
    if (!placing) return;
    const start = placing.kind === 'survey' ? Math.min(Math.max(minutes, DAY_START), DAY_END - SURVEY_HOURS * 60) : 0;
    setPending((p) => ({ day, minutes: start, crew: p?.crew ?? pendingCrew.current.crew, inspectionCrew: p?.inspectionCrew ?? pendingCrew.current.inspectionCrew }));
  }

  function cancelPlacing() {
    setPlacing(null);
    setPending(null);
    setBookError(null);
  }

  const planned: PlannedEvent[] = useMemo(() => {
    if (!placing || !pending) return [];
    return placing.kind === 'survey'
      ? planSurvey(pending.day, pending.minutes, pending.crew)
      : planInstall(pending.day, placing.job.panels, { install: pending.crew, inspection: pending.inspectionCrew });
  }, [placing, pending]);

  async function book() {
    if (!placing || planned.length === 0 || booking) return;
    setBooking(true);
    setBookError(null);
    try {
      await bookEvents({
        projectId: placing.project.id,
        jobId: placing.kind === 'install' ? placing.job.id : null,
        events: planned,
        replaceBatch: placing.replaceBatch,
      });
      cancelPlacing();
      setReload((n) => n + 1);
    } catch (e) {
      setBookError((e as Error).message);
    } finally {
      setBooking(false);
    }
  }

  /* ---- what to draw, and what to warn about ---- */

  const moving = placing?.replaceBatch;
  const shown = useMemo(() => (events ?? []).filter((e) => e.batch !== moving), [events, moving]);
  const items: GridItem[] = [
    ...shown.map((e) => ({
      key: `e${e.id}`,
      kind: e.kind,
      projectId: e.project.id,
      customer: e.project.customer,
      start: e.start,
      end: e.end,
      allDay: e.allDay,
      event: e,
    })),
    ...planned.map((p, i) => ({
      key: `p${i}`,
      kind: p.kind,
      projectId: placing!.project.id,
      customer: placing!.project.customer,
      start: p.start,
      end: p.end,
      allDay: p.allDay,
      pending: true,
    })),
  ];

  const warnings = useMemo(() => {
    if (!owner || !pipeline) return { all: [] as string[], booking: [] as string[] };
    const projects = new Map(pipeline.projects.map((p) => [p.id, p]));
    const names = new Map(staff.map((s) => [s.username, s.name]));
    const ctx = {
      customer: (id: number) => projects.get(id)?.customer ?? `Project #${id}`,
      name: (u: string) => names.get(u) ?? u,
      freeDates: (id: number) => projects.get(id)?.freeDates ?? [],
      timePref: (id: number) => projects.get(id)?.timePref ?? '',
      permitApproved: (id: number) => {
        const s = permitStatus(pipeline.permits, id);
        return s?.step === 'approved' ? s.doneOn : null;
      },
      surveyAt: (id: number) => projects.get(id)?.surveyAt ?? null,
    };
    const booked = shown.map((e) => ({ ...e, projectId: e.project.id }));
    const all = scheduleWarnings(booked, ctx);
    const withPlan = placing ? scheduleWarnings([...booked, ...planned.map((p) => ({ ...p, projectId: placing.project.id }))], ctx) : all;
    return { all, booking: withPlan.filter((w) => !all.includes(w)) };
  }, [owner, pipeline, staff, shown, planned, placing]);

  const freeDays = placing?.kind === 'survey' ? placing.project.freeDates : [];
  const timePref = placing?.kind === 'survey' ? placing.project.timePref : '';
  const freeWindow = timePrefWindow(timePref);
  const step = (n: number) => setAnchor((a) => (view === 'week' ? addDays(a, 7 * n) : `${addMonth(a.slice(0, 7), n)}-01`));
  const placingKey: PlacingKey = placing
    ? placing.kind === 'survey'
      ? `survey-${placing.project.id}`
      : `install-${placing.job.id}`
    : null;

  /* ---- layout ---- */

  const header = (
    <View style={styles.toolbar}>
      <View style={styles.row}>
        <SmallButton label="‹" onPress={() => step(-1)} />
        <SmallButton label="Today" onPress={() => setAnchor(today)} />
        <SmallButton label="›" onPress={() => step(1)} />
        <ThemedText type="heading" style={{ marginLeft: Spacing.two }}>
          {view === 'week'
            ? `${dayLabel(range.first)} – ${dayLabel(addDays(range.first, 6), true)}`
            : new Date(`${range.month}-01T00:00:00Z`).toLocaleDateString('en-PH', { timeZone: 'UTC', month: 'long', year: 'numeric' })}
        </ThemedText>
      </View>
      <View style={styles.row}>
        <Chip label="Week" selected={view === 'week'} onPress={() => setView('week')} />
        <Chip label="Month" selected={view === 'month'} onPress={() => setView('month')} />
      </View>
    </View>
  );

  const placingPanel = placing ? (
    <Card style={{ borderColor: t.accent }}>
      <View style={styles.row}>
        <JobBadge kind={placing.kind} projectId={placing.project.id} customer={placing.project.customer} size={26} />
        <View style={{ flex: 1 }}>
          <ThemedText type="heading">
            {placing.replaceBatch ? 'Moving' : 'Placing'} {placing.kind === 'survey' ? 'a survey' : 'an installation'} for {placing.project.customer}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {placing.kind === 'survey'
              ? `Pick a start time: ${SURVEY_HOURS} hours on site. ${whenFree(freeDays, timePref)}` +
                (freeDays.length || freeWindow ? ' Shaded on the calendar.' : '')
              : `Pick the first day: ${installPlan(placing.job.panels).installDays} install day(s) for ${placing.job.panels} panels, ` +
                'then 1 day for inspection and connections. Sundays are skipped.'}
          </ThemedText>
        </View>
        <SmallButton label="Cancel" onPress={cancelPlacing} />
      </View>
      {pending ? (
        <View style={{ gap: Spacing.two }}>
          {planned.map((p, i) => (
            <ThemedText key={i} type="data" style={{ fontSize: 12 }}>
              {KIND_META[p.kind].label}: {dayLabel(manilaDay(p.start), true)}
              {p.allDay ? '' : `, ${clock(manilaMinutes(p.start))}–${clock(manilaMinutes(p.end))}`}
            </ThemedText>
          ))}
          <CrewPicker
            title={placing.kind === 'survey' ? 'Survey crew' : 'Installation crew'}
            directory={staff}
            value={pending.crew}
            onChange={(crew) => setPending((p) => (p ? { ...p, crew } : p))}
          />
          {placing.kind === 'install' ? (
            <CrewPicker
              title="Inspection & connection"
              directory={staff}
              value={pending.inspectionCrew}
              onChange={(inspectionCrew) => setPending((p) => (p ? { ...p, inspectionCrew } : p))}
            />
          ) : null}
          <MessageList title="Heads up — you can still book it" tone="warn" items={warnings.booking} />
          {bookError ? <MessageList title="Could not book" tone="warn" items={[bookError]} /> : null}
          <View style={styles.row}>
            <SmallButton label={booking ? 'Booking…' : placing.replaceBatch ? 'Move it here' : 'Book it'} onPress={book} strong />
          </View>
        </View>
      ) : null}
    </Card>
  ) : null;

  const grid =
    events === null && !error ? (
      <ActivityIndicator color={t.accent} style={{ alignSelf: 'flex-start' }} />
    ) : view === 'week' ? (
      <WeekGrid
        days={range.days}
        items={items}
        today={today}
        onSlot={placing ? pick : undefined}
        onItem={(i) => i.event && setSelected(i.event)}
        highlightDays={freeDays}
        highlightWindow={freeWindow}
      />
    ) : (
      <MonthGrid
        weeks={range.weeks}
        month={range.month}
        items={items}
        today={today}
        highlightDays={freeDays}
        onItem={(i) => i.event && setSelected(i.event)}
        onDay={(day) => {
          if (placing) {
            const p = placing.kind === 'survey' ? placing.project : null;
            pick(day, p?.timePref === 'Afternoon' ? 13 * 60 : 9 * 60);
          } else {
            setAnchor(day);
            setView('week');
          }
        }}
      />
    );

  const main = (
    <View style={{ flex: 1, minWidth: 0, gap: Spacing.three }}>
      {header}
      <BadgeLegend />
      {placingPanel}
      {selected ? (
        <EventDetail
          event={selected}
          owner={owner}
          directory={staff}
          onClose={() => setSelected(null)}
          onChanged={() => {
            setSelected(null);
            setReload((n) => n + 1);
          }}
          onMove={() => {
            const project = pipeline?.projects.find((p) => p.id === selected.project.id);
            if (!project) return;
            const sameBatch = (events ?? []).filter((e) => e.batch === selected.batch);
            const crewOf = (kind: string) => sameBatch.find((e) => e.kind === kind)?.staff.map(({ username, role }) => ({ username, role })) ?? [];
            if (selected.kind === 'survey') {
              startPlacing({ kind: 'survey', project, replaceBatch: selected.batch }, { crew: crewOf('survey'), inspectionCrew: [] });
            } else {
              const job = pipeline?.jobs.find((j) => j.id === selected.jobId);
              if (job) startPlacing({ kind: 'install', job, project, replaceBatch: selected.batch }, { crew: crewOf('install'), inspectionCrew: crewOf('inspection') });
            }
          }}
        />
      ) : null}
      {error ? <MessageList title="Could not load the calendar" tone="warn" items={[error]} /> : null}
      {owner ? <MessageList title="Check the schedule" tone="warn" items={warnings.all} /> : null}
      {grid}
      {!owner && events?.length === 0 ? (
        <ThemedText type="small" themeColor="textMuted">
          Nothing booked for you in this {view}.
        </ThemedText>
      ) : null}
    </View>
  );

  if (!owner) {
    return (
      <InternalPage eyebrow="Calendar" title="My schedule" lede="The surveys and installations you are booked on. Tap one for the address and the customer’s number.">
        {main}
      </InternalPage>
    );
  }

  return (
    <InternalPage
      eyebrow="Calendar"
      title="Jobs calendar"
      lede="Pick a survey, installation or permit on the left, then a slot on the calendar. Crews fill in by role; change them before booking.">
      <View style={[styles.layout, wide ? { flexDirection: 'row', alignItems: 'flex-start' } : { flexDirection: 'column' }]}>
        <View style={{ width: wide ? 320 : '100%' }}>
          {pipeline ? (
            <CalendarSidebar
              pipeline={pipeline}
              tab={tab}
              onTab={setTab}
              placing={placingKey}
              onPlaceSurvey={(project) => startPlacing({ kind: 'survey', project })}
              onPlaceInstall={(job, project) => startPlacing({ kind: 'install', job, project })}
              onChanged={() => setReload((n) => n + 1)}
            />
          ) : (
            <ActivityIndicator color={t.accent} style={{ alignSelf: 'flex-start' }} />
          )}
        </View>
        {main}
      </View>
    </InternalPage>
  );
}

/** "They asked for mornings (07:00–12:00) on Wed 14 Oct, Thu 15 Oct." */
function whenFree(freeDays: string[], timePref: string): string {
  const when = timePrefText(timePref);
  const days = freeDays.filter((d) => d >= todayInManila());
  if (!when && !days.length) return 'They gave no days or time of day.';
  return `They asked for ${when ?? 'any time of day'}${days.length ? ` on ${days.map((d) => dayLabel(d)).join(', ')}` : ''}.`;
}

const addMonth = (month: string, n: number) => {
  const d = new Date(`${month}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 7);
};

/** One booked event: where, who, and (for the owner) move, unschedule or change the crew. */
function EventDetail({
  event: e,
  owner,
  directory,
  onClose,
  onChanged,
  onMove,
}: {
  event: CalendarEvent;
  owner: boolean;
  directory: StaffEntry[];
  onClose: () => void;
  onChanged: () => void;
  onMove: () => void;
}) {
  const [crew, setCrew] = useState<CrewMember[] | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isPermit = e.kind === 'permit_submitted' || e.kind === 'permit_approved';
  const p = e.project;

  async function run(fn: () => Promise<void>) {
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Card>
      <View style={styles.row}>
        <JobBadge kind={e.kind} projectId={p.id} customer={p.customer} size={30} />
        <View style={{ flex: 1 }}>
          <ThemedText type="eyebrow" themeColor="textMuted">
            {KIND_META[e.kind].label}
          </ThemedText>
          <ThemedText type="heading">{p.customer}</ThemedText>
          <ThemedText type="data" themeColor="textSecondary" style={{ fontSize: 12 }}>
            {dayLabel(manilaDay(e.start), true)}
            {e.allDay ? '' : `, ${clock(manilaMinutes(e.start))}–${clock(manilaMinutes(e.end))}`}
          </ThemedText>
        </View>
        <SmallButton label="Close" onPress={onClose} />
      </View>
      <View style={{ gap: 2 }}>
        {p.address ? <ThemedText type="small">Address: {p.address}</ThemedText> : null}
        {p.phone ? <ThemedText type="small">Mobile: {p.phone}</ThemedText> : null}
        {owner && p.email ? <ThemedText type="small" themeColor="textSecondary">{p.email}</ThemedText> : null}
        {owner && e.kind === 'survey' && (p.timePref || p.freeDates?.length) ? (
          <ThemedText type="small" themeColor="textSecondary">
            {whenFree(p.freeDates ?? [], p.timePref ?? '')}
          </ThemedText>
        ) : null}
        {owner && (p.monthlyBill || p.property) ? (
          <ThemedText type="small" themeColor="textSecondary">
            {[p.monthlyBill ? `${peso(p.monthlyBill)}/mo` : null, p.property].filter(Boolean).join(' · ')}
          </ThemedText>
        ) : null}
        <ThemedText type="small" themeColor="textSecondary">
          Crew: {e.staff.length ? e.staff.map((s) => `${s.name} (${ROLE_LABELS[s.role]})`).join(', ') : 'nobody assigned'}
        </ThemedText>
      </View>

      {owner && crew ? (
        <View style={{ gap: Spacing.two }}>
          <CrewPicker title="Crew for this day" directory={directory} value={crew} onChange={setCrew} />
          <View style={styles.row}>
            <SmallButton label="Save crew" onPress={() => run(() => assignCrew(e.id, crew))} strong />
            <SmallButton label="Cancel" onPress={() => setCrew(null)} />
          </View>
        </View>
      ) : null}

      {owner && !crew ? (
        <View style={styles.row}>
          {!isPermit ? <SmallButton label="Move" onPress={onMove} /> : null}
          <SmallButton label="Change crew" onPress={() => setCrew(e.staff.map(({ username, role }) => ({ username, role })))} />
          {!isPermit ? (
            <SmallButton
              label={confirm ? 'Confirm: take it off the calendar' : e.kind === 'survey' ? 'Unschedule' : 'Unschedule the whole installation'}
              onPress={() => (confirm ? run(() => unschedule(e.batch)) : setConfirm(true))}
            />
          ) : (
            <ThemedText type="small" themeColor="textMuted" style={{ fontSize: 12 }}>
              Change permit dates in the Permitting tab.
            </ThemedText>
          )}
          {e.jobId ? <SmallButton label="Open job" onPress={() => router.push({ pathname: '/internal/job', params: { id: String(e.jobId) } })} /> : null}
        </View>
      ) : null}
      {error ? <MessageList title="That didn't work" tone="warn" items={[error]} /> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  layout: { gap: Spacing.three },
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
});
