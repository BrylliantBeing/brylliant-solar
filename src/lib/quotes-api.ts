import type { DateOrder, QuoteResult } from '@calculator/solarQuoteCalculator';

import { apiUrl } from '@/lib/api-base';
import type { defaultFieldText, defaultToggles } from '@/lib/quote-input';

/**
 * Saved quotes, stored in MySQL through public/api/quotes.php (staff session
 * required). Relative on web so the session cookie stays first-party.
 */
const ENDPOINT = apiUrl('/api/quotes.php');

export type DataSource = { text: string; fileName: string | null };

/** Everything the calculator needs to reproduce a quote. */
export type QuoteInputs = {
  consumption: DataSource;
  outages: DataSource;
  /** Barangays whose outages are used; empty = all */
  locations: string[];
  dateOrder: DateOrder | undefined;
  fields: ReturnType<typeof defaultFieldText>;
  toggles: ReturnType<typeof defaultToggles>;
};

export type SavedQuoteSummary = {
  id: number;
  customer: string;
  totalPrice: number;
  systemKwp: number;
  batteryKwh: number;
  reductionPct: number;
  createdBy: string;
  updatedBy: string;
  /** ISO, UTC */
  createdAt: string;
  updatedAt: string;
};

export type SavedQuote = SavedQuoteSummary & { inputs: QuoteInputs; result: QuoteResult };

type Reply<T> = { ok: true } & T;

async function request<T>(query: string, init?: RequestInit): Promise<Reply<T>> {
  let res: Response;
  try {
    res = await fetch(ENDPOINT + query, { credentials: 'include', ...init });
  } catch {
    throw new Error('Could not reach the server. Check your connection.');
  }
  if (!(res.headers.get('content-type') ?? '').includes('application/json')) {
    throw new Error(
      __DEV__
        ? 'Saved quotes need the PHP server and MySQL, which the local dev server does not have.'
        : 'The quotes service is not reachable.',
    );
  }
  const body = (await res.json()) as { ok: boolean; error?: string } & T;
  if (res.status === 401) throw new Error('Your session has ended. Reload the page and sign in again.');
  if (!body.ok) throw new Error(body.error ?? 'The request failed.');
  return body as Reply<T>;
}

const post = (body: object): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export async function listQuotes(search = ''): Promise<SavedQuoteSummary[]> {
  const q = search.trim() ? `?q=${encodeURIComponent(search.trim())}` : '';
  return (await request<{ quotes: SavedQuoteSummary[] }>(q)).quotes;
}

export async function getQuote(id: number): Promise<SavedQuote> {
  return (await request<{ quote: SavedQuote }>(`?id=${id}`)).quote;
}

/** With an id, overwrites that quote; without, creates a new one. */
export async function saveQuote(input: {
  id?: number;
  customer: string;
  inputs: QuoteInputs;
  result: QuoteResult;
}): Promise<SavedQuoteSummary> {
  return (await request<{ quote: SavedQuoteSummary }>('', post({ action: 'save', ...input }))).quote;
}

export async function deleteQuote(id: number): Promise<void> {
  await request('', post({ action: 'delete', id }));
}

/** "1 Oct 2026, 10:24" in Zamboanga time, whatever the device's zone. */
export function manilaTime(iso: string): string {
  return new Date(iso).toLocaleString('en-PH', {
    timeZone: 'Asia/Manila',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}
