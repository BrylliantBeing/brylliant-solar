/**
 * Live USD → PHP rate for converting supplier prices. ExchangeRate-API's open
 * endpoint needs no key, allows browser requests and updates once a day.
 */
const ENDPOINT = 'https://open.er-api.com/v6/latest/USD';

export type UsdRate = {
  /** PHP per USD */
  rate: number;
  /** When the provider last updated it, ISO UTC */
  updatedAt: string;
  source: string;
};

export async function fetchUsdToPhp(signal?: AbortSignal): Promise<UsdRate> {
  const res = await fetch(ENDPOINT, { signal });
  if (!res.ok) throw new Error(`Exchange rate service replied ${res.status}.`);
  const body = (await res.json()) as {
    result?: string;
    rates?: Record<string, number>;
    time_last_update_unix?: number;
  };
  const rate = body.rates?.PHP;
  if (body.result !== 'success' || typeof rate !== 'number' || !(rate > 0)) {
    throw new Error('Exchange rate service gave no PHP rate.');
  }
  return {
    // Two decimals, as staff would type it, so the field and the saved quote match.
    rate: Math.round(rate * 100) / 100,
    updatedAt: new Date((body.time_last_update_unix ?? Date.now() / 1000) * 1000).toISOString(),
    source: 'ExchangeRate-API',
  };
}
