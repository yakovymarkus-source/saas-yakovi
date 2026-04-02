import { env } from '../config/env';

export class HttpError extends Error {
  status: number;
  details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export async function fetchJson<T>(url: string, init: RequestInit, timeoutMs = env.REQUEST_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    const data = text ? JSON.parse(text) : {};
    if (!response.ok) {
      throw new HttpError(response.status, `External request failed: ${response.status}`, data);
    }
    return data as T;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, 'External request failure', { cause: (error as Error).message });
  } finally {
    clearTimeout(timeout);
  }
}

export async function retry<T>(operation: () => Promise<T>, retries = 2): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === retries) break;
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  throw lastError;
}
