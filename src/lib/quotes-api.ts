import type { DateOrder, QuoteResult } from '@calculator/solarQuoteCalculator';

import { jsonEndpoint, post } from '@/lib/api-request';
import type { defaultFieldText, defaultToggles } from '@/lib/quote-input';

/** Saved quotes, stored in MySQL through public/api/quotes.php (owner only). */
const request = jsonEndpoint('/api/quotes.php', 'Saved quotes');

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
  /** The project a job made from this quote belongs to; missing on old servers */
  projectId?: number | null;
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
