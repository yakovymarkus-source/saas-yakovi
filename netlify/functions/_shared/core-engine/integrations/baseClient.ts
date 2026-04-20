import { env } from '../config/env';
import { fetchJson, retry } from '../utils/http';
import { SimpleRateLimiter } from '../utils/rateLimiter';

const limiter = new SimpleRateLimiter(30, 60_000);

export async function externalGet<T>(key: string, url: string, headers: Record<string, string>): Promise<T> {
  limiter.assert(key);
  return retry(() => fetchJson<T>(url, { method: 'GET', headers }, env.REQUEST_TIMEOUT_MS), 2);
}
