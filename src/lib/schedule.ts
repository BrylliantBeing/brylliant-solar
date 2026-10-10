import type { StaffRole } from '@/lib/staff-session';

/**
 * Calendar rules shared by the calendar page and the tests. Times travel as
 * UTC ISO strings and are shown in Zamboanga (Asia/Manila, UTC+8, no DST), so
 * a Manila wall time is the UTC time plus eight hours.
 */

export type EventKind = 'survey' | 'install' | 'inspection' | 'permit_submitted' | 'permit_approved';

export type StaffEntry = { username: string; name: string; role: StaffRole };
export type CrewMember = { username: string; role: StaffRole };

/** What schedule.php returns. Owner-only project fields are missing for everyone else. */
export type CalendarEvent = {
  id: number;
  batch: string;
  jobId: number | null;
  kind: EventKind;
  /** ISO, UTC */
  start: string;
  end: string;
  allDay: boolean;
  notes: string;
  staff: (CrewMember & { name: string })[];
  project: {
    id: number;
    customer: string;
    phone: string;
    address: string;
    email?: string;
    monthlyBill?: number | null;
    property?: string;
    freeDates?: string[];
  };
};

/** An event about to be booked, before it has an id. */
export type PlannedEvent = { kind: EventKind; start: string; end: string; allDay: boolean; staff: CrewMember[] };

export const SURVEY_HOURS = 3;
export const PANELS_PER_INSTALL_DAY = 20;
/** The calendar's working day, in minutes after Manila midnight. */
export const DAY_START = 7 * 60;
export const DAY_END = 18 * 60;

/* ---------------- Manila dates ---------------- */

const OFFSET_MS = 8 * 3600000;
const DAY_MS = 86400000;

/** "YYYY-MM-DD" of the Manila calendar day an instant falls on. */
export const manilaDay = (iso: string) => new Date(Date.parse(iso) + OFFSET_MS).toISOString().slice(0, 10);

/** Minutes after Manila midnight. */
export function manilaMinutes(iso: string): number {
  const d = new Date(Date.parse(iso) + OFFSET_MS);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** A Manila day and minutes after its midnight, as a UTC ISO string. */
export const manilaIso = (day: string, minutes = 0) =>
  new Date(Date.parse(`${day}T00:00:00Z`) - OFFSET_MS + minutes * 60000).toISOString();

export const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

/** 0 = Sunday */
export const weekday = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();

export const todayInManila = () => manilaDay(new Date().toISOString());

/** The Monday on or before a day. */
export const mondayOf = (day: string) => addDays(day, -((weekday(day) + 6) % 7));

/** n working days (no Sundays — no site work) from `start`, which counts if it is one. */
export function workingDays(start: string, n: number): string[] {
  const out: string[] = [];
  for (let day = start; out.length < n; day = addDays(day, 1)) {
    if (weekday(day) !== 0) out.push(day);
  }
  return out;
}

export const clock = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** "Mon 12 Oct" */
export function dayLabel(day: string, withYear = false): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-PH', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
  });
}

/* ---------------- booking rules ---------------- */

/** Install days for a panel count (20 a day), then one day for inspection and connections. */
export function installPlan(panels: number): { installDays: number; inspectionDays: number } {
  return { installDays: Math.max(1, Math.ceil(panels / PANELS_PER_INSTALL_DAY)), inspectionDays: 1 };
}

const firstWith = (directory: StaffEntry[], role: StaffRole, n = 1) =>
  directory.filter((s) => s.role === role).slice(0, n).map((s): CrewMember => ({ username: s.username, role }));

/**
 * The fixed crew for each kind of event: the owner, lead installer and electrical
 * engineer survey; the lead and two installers install; the electrical engineer
 * inspects and connects, and handles permits.
 */
export function defaultCrew(kind: EventKind, directory: StaffEntry[]): CrewMember[] {
  switch (kind) {
    case 'survey':
      return [...firstWith(directory, 'owner'), ...firstWith(directory, 'lead_installer'), ...firstWith(directory, 'electrician')];
    case 'install':
      return [...firstWith(directory, 'lead_installer'), ...firstWith(directory, 'installer', 2)];
    default:
      return firstWith(directory, 'electrician');
  }
}

/** A survey: SURVEY_HOURS from a Manila day and time. */
export function planSurvey(day: string, startMinutes: number, crew: CrewMember[]): PlannedEvent[] {
  return [
    {
      kind: 'survey',
      start: manilaIso(day, startMinutes),
      end: manilaIso(day, startMinutes + SURVEY_HOURS * 60),
      allDay: false,
      staff: crew,
    },
  ];
}

/**
 * An installation from its first day: one all-day event per install day, then
 * the inspection day, skipping Sundays. 38 panels → 2 install days + 1 inspection.
 */
export function planInstall(
  firstDay: string,
  panels: number,
  crew: { install: CrewMember[]; inspection: CrewMember[] },
): PlannedEvent[] {
  const { installDays, inspectionDays } = installPlan(panels);
  return workingDays(firstDay, installDays + inspectionDays).map((day, i) => ({
    kind: i < installDays ? 'install' : 'inspection',
    start: manilaIso(day),
    end: manilaIso(addDays(day, 1)),
    allDay: true,
    staff: i < installDays ? crew.install : crew.inspection,
  }));
}

/* ---------------- warnings ---------------- */

type Timed = { start: string; end: string };
export const overlaps = (a: Timed, b: Timed) => Date.parse(a.start) < Date.parse(b.end) && Date.parse(b.start) < Date.parse(a.end);

/** Events as the warnings need them; planned ones have no id. */
type Checked = Timed & { kind: EventKind; staff: CrewMember[]; projectId: number; id?: number };

export type ScheduleContext = {
  customer: (projectId: number) => string;
  name: (username: string) => string;
  /** Days the customer said they are free; empty = no preference */
  freeDates: (projectId: number) => string[];
  /** Manila day the permit was approved, or null */
  permitApproved: (projectId: number) => string | null;
  /** Earliest survey start (ISO), from the database rather than just the loaded week */
  surveyAt: (projectId: number) => string | null;
};

/** Clashes and out-of-order bookings. Shown to the owner, never enforced. */
export function scheduleWarnings(events: Checked[], ctx: ScheduleContext): string[] {
  const out = new Set<string>();
  const onSite = events.filter((e) => e.kind === 'survey' || e.kind === 'install' || e.kind === 'inspection');

  for (let i = 0; i < onSite.length; i++) {
    for (let j = i + 1; j < onSite.length; j++) {
      const a = onSite[i];
      const b = onSite[j];
      if (!overlaps(a, b)) continue;
      for (const s of a.staff) {
        if (b.staff.some((t) => t.username === s.username)) {
          out.add(
            `${ctx.name(s.username)} is double-booked on ${dayLabel(manilaDay(a.start > b.start ? a.start : b.start))}: ` +
              `${ctx.customer(a.projectId)} and ${ctx.customer(b.projectId)}.`,
          );
        }
      }
    }
  }

  const firstInstall = new Map<number, string>();
  for (const e of onSite) {
    if (e.kind !== 'install') continue;
    const prev = firstInstall.get(e.projectId);
    if (!prev || e.start < prev) firstInstall.set(e.projectId, e.start);
  }
  for (const [projectId, start] of firstInstall) {
    const day = manilaDay(start);
    const approved = ctx.permitApproved(projectId);
    if (!approved) out.add(`${ctx.customer(projectId)}: installation on ${dayLabel(day)}, but the permit isn't approved yet.`);
    else if (approved > day) out.add(`${ctx.customer(projectId)}: installation on ${dayLabel(day)}, before the permit approval on ${dayLabel(approved)}.`);
    const planned = onSite.find((e) => e.kind === 'survey' && e.projectId === projectId);
    const survey = planned?.start ?? ctx.surveyAt(projectId);
    if (!survey) out.add(`${ctx.customer(projectId)}: installation booked with no site survey.`);
    else if (survey >= start) out.add(`${ctx.customer(projectId)}: installation on ${dayLabel(day)} is before the survey.`);
  }

  for (const e of onSite) {
    if (e.kind !== 'survey') continue;
    const free = ctx.freeDates(e.projectId);
    const day = manilaDay(e.start);
    if (free.length && !free.includes(day)) {
      out.add(`${ctx.customer(e.projectId)}: survey on ${dayLabel(day)}, which isn't one of the days they said they're free.`);
    }
  }
  return [...out];
}

/* ---------------- colour and shape ---------------- */

/**
 * Okabe–Ito palette: stays distinguishable with deuteranopia and the other
 * common colour-vision deficiencies. Each project gets one by id, and its
 * initials ride on the badge so colour is never the only cue.
 * `ink` is the text colour with enough contrast on that fill.
 */
const PALETTE: { fill: string; ink: string }[] = [
  { fill: '#E69F00', ink: '#171C19' }, // orange
  { fill: '#56B4E9', ink: '#171C19' }, // sky blue
  { fill: '#009E73', ink: '#171C19' }, // bluish green
  { fill: '#F0E442', ink: '#171C19' }, // yellow
  { fill: '#0072B2', ink: '#FFFFFF' }, // blue
  { fill: '#D55E00', ink: '#171C19' }, // vermillion
  { fill: '#CC79A7', ink: '#171C19' }, // reddish purple
  { fill: '#000000', ink: '#FFFFFF' }, // black
];
/** Black disappears on the dark theme, so it becomes near-white there. */
const DARK_BLACK = { fill: '#EDE7DA', ink: '#171C19' };

export function projectColor(projectId: number, dark = false): { fill: string; ink: string } {
  const c = PALETTE[((projectId % PALETTE.length) + PALETTE.length) % PALETTE.length];
  return dark && c.fill === '#000000' ? DARK_BLACK : c;
}

/** Two letters for the badge: first and last word, or the first two letters. */
export function initials(customer: string): string {
  const words = customer.trim().split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
  if (words.length === 0) return '?';
  const first = [...words[0]][0] ?? '';
  const second = words.length > 1 ? ([...words[words.length - 1]][0] ?? '') : ([...words[0]][1] ?? '');
  return (first + second).toUpperCase();
}

/** Shape says the kind of work, colour says the project. */
export type BadgeShape = 'circle' | 'square' | 'outline' | 'diamond';

export const KIND_META: Record<EventKind, { label: string; shape: BadgeShape }> = {
  survey: { label: 'Survey', shape: 'circle' },
  install: { label: 'Installation', shape: 'square' },
  inspection: { label: 'Inspection & connection', shape: 'outline' },
  permit_submitted: { label: 'Permit submitted', shape: 'diamond' },
  permit_approved: { label: 'Permit approved', shape: 'diamond' },
};
