import type { SystemType } from '@calculator/solarQuoteCalculator';

import { jsonEndpoint, post } from '@/lib/api-request';
import type { JobItem, JobSettings } from '@/lib/job-items';

/** Jobs, stored in MySQL through public/api/jobs.php (owner only). */
const request = jsonEndpoint('/api/jobs.php', 'Jobs');

export type JobSummary = {
  id: number;
  projectId: number;
  quoteId: number | null;
  customer: string;
  address: string;
  systemType: SystemType;
  panels: number;
  total: number;
  status: string;
  updatedBy: string;
  updatedAt: string;
  installAt: string | null;
};

export type Job = JobSummary & { items: JobItem[]; settings: JobSettings };

export async function listJobs(): Promise<JobSummary[]> {
  return (await request<{ jobs: JobSummary[] }>('')).jobs;
}

export async function getJob(id: number): Promise<Job> {
  return (await request<{ job: Job }>(`?id=${id}`)).job;
}

/** With an id, overwrites that job. Without a projectId it joins the quote's project, or a new one. */
export async function saveJob(input: {
  id?: number;
  projectId?: number | null;
  quoteId: number | null;
  systemType: SystemType;
  items: JobItem[];
  settings: JobSettings;
}): Promise<JobSummary> {
  return (await request<{ job: JobSummary }>('', post({ action: 'save', ...input }))).job;
}

export async function deleteJob(id: number): Promise<void> {
  await request('', post({ action: 'delete', id }));
}
