import type { SystemType } from '@calculator/solarQuoteCalculator';

import { jsonEndpoint, post } from '@/lib/api-request';
import type { StaffEntry } from '@/lib/schedule';

/** Projects (one customer's pipeline) and permits, through public/api/projects.php (owner only). */
const request = jsonEndpoint('/api/projects.php', 'Projects');

export type Project = {
  id: number;
  customer: string;
  phone: string;
  email: string;
  address: string;
  monthlyBill: number | null;
  property: string;
  /** YYYY-MM-DD, Manila */
  freeDates: string[];
  timePref: string;
  source: 'booking' | 'manual' | 'quote';
  notes: string;
  status: 'active' | 'closed' | 'rejected';
  /** Why the survey request was turned down; empty unless rejected */
  rejectReason: string;
  createdAt: string;
  /** First survey booked, ISO UTC; null = still to schedule */
  surveyAt: string | null;
};

export type ProjectJob = {
  id: number;
  projectId: number;
  quoteId: number | null;
  systemType: SystemType;
  panels: number;
  total: number;
  status: string;
  updatedAt: string;
  /** First install day booked, ISO UTC; null = still to schedule */
  installAt: string | null;
};

export type PermitStep = 'docs_prepared' | 'submitted' | 'approved';

export const PERMIT_STEPS: { step: PermitStep; label: string }[] = [
  { step: 'docs_prepared', label: 'Documents prepared' },
  { step: 'submitted', label: 'Submitted' },
  { step: 'approved', label: 'Approved' },
];

export type Permit = { projectId: number; step: PermitStep; doneOn: string; owner: string; notes: string };

export type Pipeline = { projects: Project[]; jobs: ProjectJob[]; permits: Permit[]; directory: StaffEntry[] };

export async function loadPipeline(): Promise<Pipeline> {
  const { projects, jobs, permits, directory } = await request<Pipeline>('');
  return { projects, jobs, permits, directory };
}

export type ProjectInput = Pick<
  Project,
  'customer' | 'phone' | 'email' | 'address' | 'monthlyBill' | 'property' | 'freeDates' | 'timePref' | 'notes'
> & { id?: number };

/** With an id, updates that project; without, adds a manual one (e.g. a phoned-in request). */
export async function saveProject(input: ProjectInput): Promise<Project> {
  return (await request<{ project: Project }>('', post({ action: 'save', ...input }))).project;
}

export async function closeProject(id: number, closed: boolean): Promise<void> {
  await request('', post({ action: 'close', id, closed }));
}

/** Turns a survey request down; any survey still to come comes off the calendar. */
export async function rejectProject(id: number, reason: string): Promise<number> {
  return (await request<{ unscheduled: number }>('', post({ action: 'reject', id, reason }))).unscheduled;
}

/** Undoes a rejection. */
export async function restoreProject(id: number): Promise<void> {
  await request('', post({ action: 'restore', id }));
}

/** doneOn null clears the step. */
export async function setPermitStep(input: {
  projectId: number;
  step: PermitStep;
  doneOn: string | null;
  owner: string;
  notes?: string;
}): Promise<void> {
  await request('', post({ action: 'permit', ...input }));
}
