/**
 * Minimal, dependency-free HTTP helper for indexer adapters.
 *
 * Indexers are third-party, frequently slow, and frequently down. Every request
 * therefore carries a hard timeout and bounded retries so one unhealthy indexer
 * cannot stall an aggregated search — the registry's per-indexer isolation
 * depends on requests actually terminating.
 */

import { ChallengeError, detectChallenge } from './botChallenge.ts';

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_RETRIES = 1;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';

/** How much of a refusal is read before classifying it. Enough for any interstitial. */
const CHALLENGE_SNIFF_BYTES = 8_192;

/**
 * What a browser sends when it asks for a page, which is what we were not doing.
 *
 * The User-Agent above has always claimed to be Chrome, and the request beside
 * it asked for a wildcard Accept with no `Sec-Fetch` metadata and no
 * `Upgrade-Insecure-Requests` — a combination no Chrome has ever produced. Bot
 * detection scores
 * exactly this kind of disagreement, and it costs nothing to stop making it.
 *
 * Applied only to HTML scrapes: a JSON API asked for `text/html` gets a
 * different answer or none, and the aggregator adapters that use JSON were
 * never the ones being blocked.
 */
const BROWSER_DOCUMENT_HEADERS: Record<string, string> = {
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Sec-CH-UA': '"Chromium";v="133", "Not(A:Brand";v="99"',
  'Sec-CH-UA-Mobile': '?0',
  'Sec-CH-UA-Platform': '"Windows"',
};

/**
 * Cookies harvested from a solved challenge, per host.
 *
 * Held in memory rather than persisted: a `cf_clearance` is bound to the IP and
 * the User-Agent that earned it, so restoring one from disk onto a new session
 * produces a failure that looks exactly like a fresh challenge and costs a
 * browser window to discover.
 */
const clearances = new Map<string, string>();

/**
 * Solves a challenge and returns the cookie header, when a browser is available.
 *
 * Injected for the same reason `activeFetch` is: this module has to keep
 * working outside Electron, where `WebViewHost` cannot exist — the e2e
 * harnesses run the whole indexer stack with no browser at all, and they must
 * degrade to "this indexer is blocked" rather than to a crash.
 */
type ChallengeSolver = (url: string) => Promise<{ cookie: string; userAgent?: string } | null>;
let solveChallenge: ChallengeSolver | null = null;

export function setChallengeSolver(solver: ChallengeSolver | null): void {
  solveChallenge = solver;
}

/** Test seam and a way for settings to drop a stale clearance. */
export function clearChallengeCookies(): void {
  clearances.clear();
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

export interface HttpOptions {
  timeoutMs?: number;
  retries?: number;
  headers?: Record<string, string>;
  /** Caller-owned signal; composed with the internal timeout signal. */
  signal?: AbortSignal;
  /** JSON body; when present the request is sent as POST. */
  body?: unknown;
  /**
   * This request is for an HTML page a person would browse to.
   *
   * Sends the header set a real Chrome sends for a navigation, and turns on
   * challenge sniffing of successful bodies. Off for JSON APIs, which are not
   * the ones being blocked and whose bodies are not challenge pages.
   */
  asDocument?: boolean;
  /** Overrides the default UA — used to match the one a solved challenge was issued to. */
  userAgent?: string;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Node's `fetch`, until the main process replaces it with Electron's.
 *
 * This exists so DNS settings can work at all. `app.configureHostResolver`
 * configures Chromium's resolver, and Node's `fetch` does not use it — so an
 * app whose scraping runs on Node's stack would offer a DNS-over-HTTPS setting
 * that changes nothing. Electron's `net.fetch` goes through Chromium and
 * therefore honours it, along with the system proxy.
 *
 * Injected rather than imported so this module stays usable outside Electron,
 * where `import('electron')` throws.
 */
let activeFetch: FetchLike = (input, init) => fetch(input, init);

export function setHttpFetch(implementation: FetchLike): void {
  activeFetch = implementation;
}

/**
 * The configured fetch, unwrapped.
 *
 * `fetchJson` and friends add retries, timeouts and body parsing, all of which
 * are wrong for streaming a film: the response has to stay a stream, the
 * timeout is the length of the movie, and retrying a partial range would start
 * it again. `MediaProxy` needs the transport and none of the policy — but it
 * does need this indirection rather than global `fetch`, so proxied streams
 * honour the DNS setting like everything else.
 */
export function rawFetch(input: string, init?: RequestInit): Promise<Response> {
  return activeFetch(input, init);
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

  const origin = originOf(url);
  const clearance = clearances.get(origin);

  const response = await activeFetch(url, {
    signal,
    redirect: 'follow',
    method: hasBody ? 'POST' : 'GET',
    body: hasBody ? JSON.stringify(options.body) : undefined,
    headers: {
      'User-Agent': options.userAgent ?? USER_AGENT,
      Accept: '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      ...(options.asDocument ? BROWSER_DOCUMENT_HEADERS : {}),
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      ...(clearance ? { Cookie: clearance } : {}),
      ...options.headers,
    },
  });

  /**
   * A wall is classified before it becomes an `HttpError`.
   *
   * Everything used to arrive as `HTTP 403 Forbidden` — a challenge, a country
   * block and a hotlink refusal alike — so the registry counted three
   * indistinguishable failures and skipped the indexer. The distinction is what
   * decides whether opening a browser is worth several seconds or is pure
   * waste; see `botChallenge.ts`.
   */
  if (!response.ok) {
    const verdict = detectChallenge({
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      bodyPrefix: await peek(response),
    });
    if (verdict.kind !== 'none') throw new ChallengeError(verdict, url, response.status);
    throw new HttpError(`HTTP ${response.status} ${response.statusText}`, response.status, url);
  }

  /**
   * And a wall that answered 200.
   *
   * Cloudflare's managed challenge is routinely served with a success status,
   * so this branch is not an edge case — it is the branch that produced
   * "0 results in 5596ms" from a site that was never asked anything. Only HTML
   * is sniffed: a JSON API's body is not a challenge page and reading it twice
   * would be waste.
   */
  if (options.asDocument) {
    const verdict = detectChallenge({
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      bodyPrefix: await peek(response),
    });
    if (verdict.kind !== 'none') throw new ChallengeError(verdict, url, response.status);
  }

  return response;
}

/**
 * The first few KB of a body, without consuming it.
 *
 * `response.clone()` rather than a read: the caller still needs the body, and
 * on a challenge page it is small enough that cloning costs nothing. A body
 * that cannot be read at all classifies as "no evidence", which
 * `detectChallenge` handles rather than throwing.
 */
async function peek(response: Response): Promise<string> {
  try {
    const text = await response.clone().text();
    return text.slice(0, CHALLENGE_SNIFF_BYTES);
  } catch {
    return '';
  }
}

/** Retries only on transient failures; a 4xx is not retried. */
async function withRetry(url: string, options: HttpOptions): Promise<Response> {
  const retries = options.retries ?? DEFAULT_RETRIES;
  let lastError: unknown;
  let solveAttempted = false;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await requestOnce(url, options);
    } catch (error) {
      lastError = error;

      /**
       * A challenge is answered, not retried.
       *
       * Repeating the same request over the same connection gets challenged
       * again — that is what a challenge is. So the browser is asked once per
       * host, its `cf_clearance` is kept, and the request is reissued *with*
       * it. If there is no browser (the e2e harnesses run with none) or the
       * challenge is not the solvable kind, this falls straight through to the
       * throw below, which is the honest answer.
       *
       * The retry is deliberately outside the attempt budget: solving a
       * challenge is not a retry of a failed request, it is the request finally
       * being allowed to happen.
       */
      if (error instanceof ChallengeError && error.solvable && !solveAttempted && solveChallenge) {
        solveAttempted = true;
        try {
          const solved = await solveChallenge(url);
          if (solved?.cookie) {
            clearances.set(originOf(url), solved.cookie);
            // The clearance is bound to the User-Agent that earned it; sending
            // it with a different one is how a solved challenge re-challenges.
            return await requestOnce(url, { ...options, userAgent: solved.userAgent });
          }
        } catch (solveError) {
          lastError = solveError;
        }
        break;
      }

      const isClientError =
        error instanceof HttpError &&
        error.status !== undefined &&
        error.status >= 400 &&
        error.status < 500;
      const isChallenge = error instanceof ChallengeError;
      const isAborted = options.signal?.aborted === true;

      if (isClientError || isChallenge || isAborted || attempt === retries) break;

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

/**
 * An HTML page, fetched the way a browser fetches one.
 *
 * Separate from `fetchText` rather than a flag on it because the distinction is
 * about what is being asked for, not how: every caller of this is scraping a
 * site built for people, and every caller of `fetchText` that is not should
 * keep getting the plain request. The HTML scrapers — 1337x, BitSearch,
 * TheRARBG, Nyaa — are also precisely the indexers that get blocked, and the
 * JSON aggregators are precisely the ones that never do.
 */
export async function fetchDocument(url: string, options: HttpOptions = {}): Promise<string> {
  const response = await withRetry(url, { ...options, asDocument: true });
  return await response.text();
}

export async function fetchBuffer(
  url: string,
  options: HttpOptions = {},
  onProgress?: (downloadedBytes: number, totalBytes: number, percent: number) => void
): Promise<Buffer> {
  const response = await withRetry(url, options);
  const totalBytes = parseInt(response.headers.get('content-length') || '0', 10);

  if (!response.body || !onProgress) {
    return Buffer.from(await response.arrayBuffer());
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let downloadedBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      downloadedBytes += value.length;
      const percent =
        totalBytes > 0 ? Math.min(100, Math.floor((downloadedBytes / totalBytes) * 100)) : 0;
      onProgress(downloadedBytes, totalBytes, percent);
    }
  }

  const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  return Buffer.from(combined);
}
