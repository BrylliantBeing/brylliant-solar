import { jsonEndpoint, post } from '@/lib/api-request';
import type { CalendarEvent, CrewMember, PlannedEvent, StaffEntry } from '@/lib/schedule';

/**
 * The staff calendar, through public/api/schedule.php. Everyone can read (staff
 * see only their own events); only the owner can book.
 */
const request = jsonEndpoint('/api/schedule.php', 'The calendar');

export async function loadEvents(fromIso: string, toIso: string): Promise<{ events: CalendarEvent[]; directory: StaffEntry[] }> {
  const { events, directory } = await request<{ events: CalendarEvent[]; directory: StaffEntry[] }>(
    `?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`,
  );
  return { events, directory };
}

/** Books events together as one batch; with replaceBatch, those are removed first (a move). */
export async function bookEvents(input: {
  projectId: number;
  jobId?: number | null;
  events: PlannedEvent[];
  replaceBatch?: string;
}): Promise<string> {
  return (await request<{ batch: string }>('', post({ action: 'book', ...input }))).batch;
}

export async function unschedule(batch: string): Promise<void> {
  await request('', post({ action: 'unschedule', batch }));
}

export async function assignCrew(id: number, staff: CrewMember[]): Promise<void> {
  await request('', post({ action: 'assign', id, staff }));
}
