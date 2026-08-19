import type { DiagnosticsSink } from './pluginManager';

/**
 * Everything the app knows about network requests failing, in one place.
 *
 * The report that prompted this was a hard crash of the whole application:
 *
 *     Uncaught Exception:
 *     Error: net::ERR_HTTP2_PROTOCOL_ERROR
 *       at SimpleURLLoaderWrapper.<anonymous> (node:electron/js2c/browser_init:2:138489)
 *       at SimpleURLLoaderWrapper.emit (node:events:509:28)
 *
 * That stack is not from a request being *made*; it is from one being *torn
 * down*. It was reproduced here against a real HTTP/2 origin (see the class
 * comment on {@link ResilientFetch} for what the reproduction showed) and the
 * shape is the important part: `net.fetch` resolves, the caller's `try/catch`
 * has already exited, and the transport fails afterwards. There is no call site
 * left to catch it, which is why one bad CDN could close the app.
 *
 * Three layers answer that, and all three are needed:
 *
 *  1. **This module** retries the request, because most HTTP/2 failures are
 *     transient and the second attempt simply works.
 *  2. **Whoever consumes a body stream** must attach an error handler to it —
 *     the crash above came from a stream nobody was listening to.
 *  3. **A process-level guard** in `main.ts` catches whatever still escapes,
 *     because the cost of being wrong is losing the user's playback.
 *
 * Nothing here is provider-specific. A failing origin is a failing origin.
 */

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Chromium error codes worth trying again.
 *
 * Every one of these describes a connection that died rather than a server that
 * answered. A 404 is a fact and repeating the question will not change it; a
 * severed TCP connection is an accident, and the retry usually succeeds.
 */
const RETRYABLE_CODES = new Set([
  'ERR_HTTP2_PROTOCOL_ERROR',
  'ERR_HTTP2_SERVER_REFUSED_STREAM',
  'ERR_HTTP2_PING_FAILED',
  'ERR_HTTP2_INADEQUATE_TRANSPORT_SECURITY',
  'ERR_HTTP2_FLOW_CONTROL_ERROR',
  'ERR_HTTP2_FRAME_SIZE_ERROR',
  'ERR_HTTP2_COMPRESSION_ERROR',
  'ERR_HTTP2_STREAM_CLOSED',
  'ERR_SPDY_PROTOCOL_ERROR',
  'ERR_QUIC_PROTOCOL_ERROR',
  'ERR_CONNECTION_RESET',
  'ERR_CONNECTION_CLOSED',
  'ERR_CONNECTION_ABORTED',
  'ERR_CONNECTION_FAILED',
  'ERR_CONNECTION_TIMED_OUT',
  'ERR_TIMED_OUT',
  'ERR_EMPTY_RESPONSE',
  // The origin promised N bytes and sent fewer. This is what a connection
  // dropped mid-film actually looks like from Chromium — measured, not assumed —
  // and it is the single most resumable failure there is: the byte count already
  // delivered is exactly where to continue from.
  'ERR_CONTENT_LENGTH_MISMATCH',
  'ERR_INCOMPLETE_CHUNKED_ENCODING',
  'ERR_SOCKET_NOT_CONNECTED',
  'ERR_NETWORK_CHANGED',
  'ERR_ADDRESS_UNREACHABLE',
  'ERR_TUNNEL_CONNECTION_FAILED',
]);

/**
 * Failures specific to HTTP/2 framing.
 *
 * These get one extra move the others do not: the origin is remembered as
 * HTTP/2-hostile and subsequent requests to it go out over HTTP/1.1. Some CDNs
 * — particularly the cheap ones providers use — run an HTTP/2 frontend that
 * mishandles long-lived range requests, and no number of retries on the same
 * transport fixes that. Falling back is the only thing that does.
 */
const HTTP2_CODES = new Set([
  'ERR_HTTP2_PROTOCOL_ERROR',
  'ERR_HTTP2_SERVER_REFUSED_STREAM',
  'ERR_HTTP2_PING_FAILED',
  'ERR_HTTP2_FLOW_CONTROL_ERROR',
  'ERR_HTTP2_FRAME_SIZE_ERROR',
  'ERR_HTTP2_COMPRESSION_ERROR',
  'ERR_HTTP2_STREAM_CLOSED',
  'ERR_SPDY_PROTOCOL_ERROR',
]);

export interface NetworkFailure {
  /** The bare Chromium code — `ERR_HTTP2_PROTOCOL_ERROR` — when there is one. */
  code: string | null;
  /** Worth another attempt, as opposed to a settled answer. */
  retryable: boolean;
  /** Specifically an HTTP/2 framing failure, so the origin can be downgraded. */
  http2: boolean;
  /** The user cancelled; not a failure and never retried. */
  aborted: boolean;
  message: string;
}

/**
 * Reads a Chromium network error out of whatever was thrown.
 *
 * Deliberately string-based. Electron surfaces these as a plain `Error` whose
 * message is `net::ERR_SOMETHING` with no code property, and undici throws a
 * `TypeError` with the real reason one or two `cause` links down, so there is no
 * structured field to read on either stack.
 */
export function classifyNetworkError(error: unknown): NetworkFailure {
  const aborted =
    error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');

  // Walk the cause chain: undici reports `TypeError: fetch failed` and puts the
  // reason underneath, so the top-level message alone says nothing useful.
  const messages: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth++) {
    if (current instanceof Error) {
      messages.push(current.message);
      const code = (current as NodeJS.ErrnoException).code;
      if (typeof code === 'string') messages.push(code);
      current = (current as { cause?: unknown }).cause;
    } else {
      messages.push(String(current));
      break;
    }
  }
  const text = messages.join(' | ');

  const chromium = text.match(/\bERR_[A-Z0-9_]+/);
  // Node's own transport failures are the same class of event under different
  // spelling, and the fallback path produces these rather than `net::` codes.
  const node = text.match(/\b(ECONNRESET|ECONNREFUSED|ECONNABORTED|ETIMEDOUT|EPIPE|EAI_AGAIN|ENOTFOUND|UND_ERR_SOCKET|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT)\b/);

  const code = chromium?.[0] ?? node?.[0] ?? null;
  const nodeRetryable = new Set([
    'ECONNRESET',
    'ECONNABORTED',
    'ETIMEDOUT',
    'EPIPE',
    'EAI_AGAIN',
    'UND_ERR_SOCKET',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_HEADERS_TIMEOUT',
  ]);

  return {
    code,
    retryable: !aborted && Boolean(code && (RETRYABLE_CODES.has(code) || nodeRetryable.has(code))),
    http2: Boolean(code && HTTP2_CODES.has(code)),
    aborted,
    message: error instanceof Error ? error.message : String(error),
  };
}

/** True for anything that reads like a Chromium/Node transport failure. */
export function isNetworkError(error: unknown): boolean {
  const failure = classifyNetworkError(error);
  return failure.code !== null;
}

export interface RetryPolicy {
  /** Total attempts including the first. Bounded, and configurable per call. */
  attempts: number;
  /** First backoff; each subsequent wait doubles it. */
  baseDelayMs: number;
  /** Ceiling on a single backoff, so a long chain cannot stall a search. */
  maxDelayMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  attempts: 3,
  baseDelayMs: 300,
  maxDelayMs: 4_000,
};

/**
 * Exponential, with jitter.
 *
 * The jitter is not decoration. When an origin resets one connection it has
 * usually reset all of them, so a search across fifteen providers retries
 * fifteen times at once — and a fixed backoff reproduces that thundering herd
 * exactly one delay later.
 */
export function backoffFor(attempt: number, policy: RetryPolicy): number {
  const exponential = policy.baseDelayMs * 2 ** (attempt - 1);
  const capped = Math.min(exponential, policy.maxDelayMs);
  return Math.round(capped * (0.5 + Math.random() * 0.5));
}

export interface ResilientFetchOptions {
  /** Chromium's stack: honours the DNS setting and the system proxy. */
  primary: FetchLike;
  /**
   * Node's stack, used only as an HTTP/1.1 rescue.
   *
   * It does *not* honour `app.configureHostResolver`, so an origin that has
   * been downgraded is no longer covered by the user's DNS choice. That is a
   * real cost, taken knowingly: it applies only to origins that have already
   * proven they cannot complete a request over HTTP/2, where the alternative is
   * not "slower" but "does not work".
   */
  fallback?: FetchLike;
  policy?: Partial<RetryPolicy>;
  diagnostics?: DiagnosticsSink;
}

/** Per-call overrides, threaded through `RequestInit` so callers need no new API. */
export interface AttemptOptions {
  /** Names the operation in diagnostics: `sources`, `metadata`, `media`… */
  operation?: string;
  /** Provider, indexer or repository this request belongs to. */
  source?: string;
  policy?: Partial<RetryPolicy>;
  /** Set for requests that must not be repeated. */
  noRetry?: boolean;
}

/** Methods safe to repeat. A retried POST can double-submit; nothing here does. */
const IDEMPOTENT = new Set(['GET', 'HEAD', 'OPTIONS']);

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * A fetch that survives the network being unreliable.
 *
 * The behaviour was derived from a reproduction rather than from documentation.
 * An HTTP/2 origin was made to answer normally and then fail mid-body, and the
 * shipping code was run against it under Electron 43:
 *
 *     upstream status=200
 *     UNCAUGHT: net::ERR_CONNECTION_CLOSED
 *       at SimpleURLLoaderWrapper.<anonymous> (node:electron/js2c/browser_init:2:138489)
 *       at SimpleURLLoaderWrapper.emit (node:events:509:28)
 *
 * — the reported stack, frame for frame. The status line printing first is the
 * whole diagnosis: the promise had already resolved, so no `await` was left to
 * reject and no `catch` was left to run.
 *
 * What this class can therefore fix is the *request*. A body that fails after
 * the response is handed over is the consumer's to handle, which is why
 * `MediaProxy` grew its own resume path rather than relying on this.
 */
export class ResilientFetch {
  private primary: FetchLike;
  private fallback: FetchLike | null;
  private policy: RetryPolicy;
  private diagnostics: DiagnosticsSink | null;

  /** Origins whose HTTP/2 has failed, and are now spoken to over HTTP/1.1. */
  private downgraded = new Set<string>();

  constructor(options: ResilientFetchOptions) {
    this.primary = options.primary;
    this.fallback = options.fallback ?? null;
    this.policy = { ...DEFAULT_RETRY_POLICY, ...options.policy };
    this.diagnostics = options.diagnostics ?? null;
  }

  public setDiagnostics(sink: DiagnosticsSink): void {
    this.diagnostics = sink;
  }

  public setPolicy(policy: Partial<RetryPolicy>): void {
    this.policy = { ...this.policy, ...policy };
  }

  /** Origins currently downgraded, for the diagnostics panel. */
  public downgradedOrigins(): string[] {
    return [...this.downgraded];
  }

  public clearDowngrades(): void {
    this.downgraded.clear();
  }

  public fetch = async (
    url: string,
    init: RequestInit = {},
    attemptOptions: AttemptOptions = {}
  ): Promise<Response> => {
    const policy = { ...this.policy, ...attemptOptions.policy };
    const method = (init.method ?? 'GET').toUpperCase();
    const origin = originOf(url);

    // A non-idempotent request is attempted once, whatever the policy says. The
    // failure modes here are indistinguishable from the outside: a reset that
    // arrives after the server processed the body would be retried into a
    // duplicate submission.
    const repeatable = IDEMPOTENT.has(method) && !attemptOptions.noRetry;
    const attempts = repeatable ? Math.max(1, policy.attempts) : 1;

    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      const useFallback = Boolean(origin && this.downgraded.has(origin) && this.fallback);
      const impl = useFallback ? this.fallback! : this.primary;

      try {
        const response = await impl(url, init);
        if (attempt > 1) {
          this.record('info', attemptOptions, url, {
            message: `Recovered after ${attempt} attempt(s): HTTP ${response.status}`,
            detail: [
              `transport: ${useFallback ? 'http/1.1 (fallback)' : 'chromium'}`,
              `attempts: ${attempt}/${attempts}`,
            ].join('\n'),
          });
        }
        return response;
      } catch (error) {
        lastError = error;
        const failure = classifyNetworkError(error);

        // The user closing the player is not a network fault and must not be
        // retried — doing so would keep fetching for a session that is gone.
        if (failure.aborted) throw error;

        /**
         * An HTTP/2 framing failure downgrades the origin *before* the next
         * attempt, so the retry is not a repeat of the request that just failed
         * on a transport that has already proven itself broken here.
         */
        if (failure.http2 && origin && this.fallback && !this.downgraded.has(origin)) {
          this.downgraded.add(origin);
          this.record('warn', attemptOptions, url, {
            message: `${failure.code} — falling back to HTTP/1.1 for ${origin}`,
            detail: this.context(url, init, attempt, attempts, failure, useFallback),
          });
        }

        const isLast = attempt === attempts;
        if (!failure.retryable || isLast) {
          this.record('error', attemptOptions, url, {
            message: failure.code
              ? `${failure.code} after ${attempt} attempt(s)`
              : failure.message,
            detail: this.context(url, init, attempt, attempts, failure, useFallback),
          });
          throw error;
        }

        const delay = backoffFor(attempt, policy);
        this.record('warn', attemptOptions, url, {
          message: `${failure.code ?? 'network error'} — retrying in ${delay}ms`,
          detail: this.context(url, init, attempt, attempts, failure, useFallback),
        });
        await sleep(delay, init.signal ?? undefined);
      }
    }

    throw lastError;
  };

  /**
   * The context a report needs to be actionable.
   *
   * Headers are included because they are frequently the cause — a `Referer` a
   * host has started rejecting, a `Range` an origin mishandles — but their
   * *values* are not, since providers sign URLs and tokens end up in headers.
   * Names only.
   */
  private context(
    url: string,
    init: RequestInit,
    attempt: number,
    attempts: number,
    failure: NetworkFailure,
    usedFallback: boolean
  ): string {
    const origin = originOf(url);
    const headerNames = Object.keys(headersToObject(init.headers)).sort();
    return [
      `url:       ${url.slice(0, 300)}`,
      `origin:    ${origin ?? 'unparseable'}`,
      `scheme:    ${url.startsWith('https:') ? 'https' : 'http'}`,
      `transport: ${usedFallback ? 'http/1.1 (fallback)' : 'chromium (h2 or h1, negotiated)'}`,
      `method:    ${(init.method ?? 'GET').toUpperCase()}`,
      `headers:   ${headerNames.join(', ') || '(none)'}`,
      `attempt:   ${attempt}/${attempts}`,
      `code:      ${failure.code ?? 'none'}`,
      `retryable: ${failure.retryable}`,
      `downgraded origins: ${[...this.downgraded].join(', ') || '(none)'}`,
      `raw:       ${failure.message}`,
    ].join('\n');
  }

  private record(
    level: 'error' | 'warn' | 'info',
    options: AttemptOptions,
    url: string,
    entry: { message: string; detail: string }
  ): void {
    this.diagnostics?.record({
      level,
      stage: 'runtime',
      source: options.source ?? options.operation ?? 'network',
      url,
      message: entry.message,
      detail: entry.detail,
    });
  }
}

export function headersToObject(headers: RequestInit['headers']): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  if (Array.isArray(headers)) return Object.fromEntries(headers);

  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value === 'string') out[name] = value;
  }
  return out;
}

/** A cancellable sleep, so a backoff does not outlive the request it belongs to. */
function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
