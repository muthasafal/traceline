import api, { route } from '@forge/api';

/** Thin REST helpers. All calls run as the app unless `asUser` is set. */

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    what: string,
  ) {
    super(`${what} failed with HTTP ${status}: ${body.slice(0, 300)}`);
  }
}

type Route = ReturnType<typeof route>;

type Init = { method?: string; body?: string; headers?: Record<string, string>; asUser?: boolean };

async function call<T>(product: 'jira' | 'confluence', r: Route, init: Init = {}, what = 'Request'): Promise<T> {
  const actor = init.asUser ? api.asUser() : api.asApp();
  const headers: Record<string, string> = { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers ?? {}) };
  const opts = { method: init.method, body: init.body, headers };
  const res = product === 'jira' ? await actor.requestJira(r, opts) : await actor.requestConfluence(r, opts);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!res.ok) throw new HttpError(res.status, text, what);
  return (text ? JSON.parse(text) : undefined) as T;
}

export const jira = <T>(r: Route, init?: Init, what?: string) => call<T>('jira', r, init, what);
export const confluence = <T>(r: Route, init?: Init, what?: string) => call<T>('confluence', r, init, what);
export { route };
