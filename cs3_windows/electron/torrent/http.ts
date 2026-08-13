/**
 * Minimal, dependency-free HTTP helper for indexer adapters.
 *
 * Indexers are third-party, frequently slow, and frequently down. Every request
 * therefore carries a hard timeout and bounded retries so one unhealthy indexer
 * cannot stall an aggregated search — the registry's per-indexer isolation
 * depends on requests actually terminating.
 */

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_RETRIES = 1;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) CloudStreamDesktop/1.0';

export interface HttpOptions {
  timeoutMs?: number;
  retries?: number;
  headers?: Record<string, string>;
  /** Caller-owned signal; composed with the internal timeout signal. */
  signal?: AbortSignal;
  /** JSON body; when present the request is sent as POST. */
  body?: unknown;
}

export class HttpError extends Error {
  // Declared as fields rather than constructor parameter properties, which
  // `erasableSyntaxOnly` forbids.
  readonly status?: number;
  readonly url?: string;

  constructor(message: string, status?: number, url?: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
  }
}

function composeSignals(signals: Array<AbortSignal | undefined>): AbortSignal {
  const active = signals.filter((s): s is AbortSignal => Boolean(s));
  if (active.length === 1) return active[0];

  const controller = new AbortController();
  for (const signal of active) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}

async function requestOnce(url: string, options: HttpOptions): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const signal = composeSignals([AbortSignal.timeout(timeoutMs), options.signal]);

  const hasBody = options.body !== undefined;

  const response = await fetch(url, {
    signal,
    redirect: 'follow',
    method: hasBody ? 'POST' : 'GET',
    body: hasBody ? JSON.stringify(options.body) : undefined,
    headers: {
      'User-Agent': USER_AGENT,
      Accept: '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });

  if (!response.ok) {
    throw new HttpError(`HTTP ${response.status} ${response.statusText}`, response.status, url);
  }
  return response;
}

/** Retries only on transient failures; a 4xx is not retried. */
async function withRetry(url: string, options: HttpOptions): Promise<Response> {
  const retries = options.retries ?? DEFAULT_RETRIES;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await requestOnce(url, options);
    } catch (error) {
      lastError = error;

      const isClientError =
        error instanceof HttpError &&
        error.status !== undefined &&
        error.status >= 400 &&
        error.status < 500;
      const isAborted = options.signal?.aborted === true;

      if (isClientError || isAborted || attempt === retries) break;

      // Linear backoff — indexers rate-limit, and hammering makes it worse.
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
    }
  }

  throw lastError;
}

export async function fetchJson<T>(url: string, options: HttpOptions = {}): Promise<T> {
  const response = await withRetry(url, {
    ...options,
    headers: { Accept: 'application/json', ...options.headers },
  });
  return (await response.json()) as T;
}

/** POSTs a JSON body and parses a JSON reply. Used by search APIs that take filters. */
export async function postJson<T>(
  url: string,
  body: unknown,
  options: HttpOptions = {}
): Promise<T> {
  const response = await withRetry(url, {
    ...options,
    body,
    headers: { Accept: 'application/json', ...options.headers },
  });
  return (await response.json()) as T;
}

export async function fetchText(url: string, options: HttpOptions = {}): Promise<string> {
  const response = await withRetry(url, options);
  return await response.text();
}

export async function fetchBuffer(url: string, options: HttpOptions = {}): Promise<Buffer> {
  const response = await withRetry(url, options);
  return Buffer.from(await response.arrayBuffer());
}
