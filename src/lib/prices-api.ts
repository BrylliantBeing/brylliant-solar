import { jsonEndpoint, post } from '@/lib/api-request';
import type { PriceOverrides } from '@/lib/price-list';

/** The price list through public/api/prices.php (owner only). */
const request = jsonEndpoint('/api/prices.php', 'Prices');

export type PriceUpdate = { by: string; at: string };

export async function loadPrices(): Promise<{ prices: PriceOverrides; updated: Record<string, PriceUpdate> }> {
  const { prices, updated } = await request<{ prices: PriceOverrides; updated: Record<string, PriceUpdate> }>('');
  return { prices, updated };
}

/** null clears a price back to its default. */
export async function savePrices(changes: Record<string, number | null>) {
  const { prices, updated } = await request<{ prices: PriceOverrides; updated: Record<string, PriceUpdate> }>(
    '',
    post({ action: 'save', prices: changes }),
  );
  return { prices, updated };
}
