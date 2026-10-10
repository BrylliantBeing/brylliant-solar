import { apiUrl } from '@/lib/api-base';

type Reply<T> = { ok: true } & T;

/**
 * A caller for one staff JSON endpoint under public/api (staff session
 * required). Relative on web so the session cookie stays first-party.
 * `what` names the data in errors, e.g. "Saved quotes".
 */
export function jsonEndpoint(path: string, what: string) {
  const endpoint = apiUrl(path);
  return async function request<T>(query: string, init?: RequestInit): Promise<Reply<T>> {
    let res: Response;
    try {
      res = await fetch(endpoint + query, { credentials: 'include', ...init });
    } catch {
      throw new Error('Could not reach the server. Check your connection.');
    }
    if (!(res.headers.get('content-type') ?? '').includes('application/json')) {
      throw new Error(
        __DEV__
          ? `${what} need the PHP server and MySQL, which the local dev server does not have.`
          : `The ${what.toLowerCase()} service is not reachable.`,
      );
    }
    const body = (await res.json()) as { ok: boolean; error?: string } & T;
    if (res.status === 401) throw new Error('Your session has ended. Reload the page and sign in again.');
    if (!body.ok) throw new Error(body.error ?? 'The request failed.');
    return body as Reply<T>;
  };
}

export const post = (body: object): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
