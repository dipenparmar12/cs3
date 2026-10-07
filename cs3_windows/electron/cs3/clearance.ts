/**
 * Bot-wall clearances, owned by the desktop app rather than by each caller.
 *
 * Android solves a Cloudflare challenge inside `CloudflareKiller`: every
 * interceptor instance opens a WebView, keeps the cookies in its own map, and
 * forgets them when the process dies. That shape is fine on a phone with one
 * app process and one WebView. Here it cost three things, all measured as
 * "the first search after a restart is slow and some providers find nothing":
 *
 * - **Clearances were thrown away while still valid.** The browser partition is
 *   persistent and kept `cf_clearance`, but the JVM's map did not survive a
 *   sidecar restart, so the next challenge opened a window to re-earn a cookie
 *   the app already held.
 * - **Every caller solved for itself.** Fifteen providers searching one host
 *   meant up to fifteen browser windows, each running a proof-of-work.
 * - **A failure was retried on every request.** A host the browser cannot pass
 *   cost the full timeout per request, for the rest of the session.
 *
 * So the browser's cookie jar *is* the store, and this service is the one door
 * to it: it answers from the jar when the jar holds a live clearance, joins an
 * in-flight solve instead of starting a second, and remembers a host it could
 * not clear for {@link FAILURE_COOLDOWN_MS}. The JVM (`clearance.get` over the
 * reverse channel) and the indexer HTTP client both go through it, so a
 * clearance earned by either is used by both.
 *
 * Pure apart from its injected dependencies, so it is tested without Electron.
 */

/** The cookie Cloudflare issues once a challenge is passed. */
export const CLEARANCE_COOKIE = 'cf_clearance';

/** How long a host that could not be cleared is left alone. */
export const FAILURE_COOLDOWN_MS = 10 * 60_000;

/**
 * A clearance this close to expiry is treated as gone. Replaying one that dies
 * in flight is answered with a challenge, which costs a browser window to
 * discover; asking for a fresh one up front costs the same window, sooner.
 */
const EXPIRY_MARGIN_MS = 60_000;

export interface JarCookie {
  name: string;
  value: string;
  /** Seconds since the epoch, as Electron reports it. Absent for a session cookie. */
  expirationDate?: number;
}

export interface SolveOutcome {
  ok: boolean;
  error?: string;
}

export interface ClearanceDeps {
  /** Every cookie the browser would send to `url`, `HttpOnly` included. */
  readCookies(url: string): Promise<JarCookie[]>;
  removeCookie(url: string, name: string): Promise<void>;
  /** Opens the browser on `url` and waits for {@link CLEARANCE_COOKIE}. */
  solve(url: string): Promise<SolveOutcome>;
  /** The agent the browser presents, which the clearance is bound to. */
  userAgent(): string;
  now?: () => number;
}

export type ClearanceAnswer =
  | {
      ok: true;
      cookies: Record<string, string>;
      userAgent: string;
      /** `jar`: already held, no window opened. `solved`: a browser earned it now. */
      source: 'jar' | 'solved';
    }
  | { ok: false; error: string; retryAfterMs?: number };

export interface GetOptions {
  /** False only peeks: answer from the jar or report that nothing is held. */
  solve?: boolean;
}

export class ClearanceService {
  private readonly inflight = new Map<string, Promise<ClearanceAnswer>>();
  private readonly refused = new Map<string, { until: number; error: string }>();
  private readonly deps: ClearanceDeps;
  private readonly now: () => number;

  constructor(deps: ClearanceDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
  }

  async get(url: string, options: GetOptions = {}): Promise<ClearanceAnswer> {
    const host = hostOf(url);
    if (!host) return { ok: false, error: `Not an address a clearance can be held for: ${url}` };

    const held = await this.fromJar(url);
    if (held) return held;
    if (options.solve === false) return { ok: false, error: `No clearance is held for ${host}.` };

    const refusal = this.refused.get(host);
    if (refusal && refusal.until > this.now()) {
      return { ok: false, error: refusal.error, retryAfterMs: refusal.until - this.now() };
    }

    // Joined, not repeated: the second caller gets the first caller's answer.
    const running = this.inflight.get(host);
    if (running) return running;
    const attempt = this.solveFor(url, host).finally(() => this.inflight.delete(host));
    this.inflight.set(host, attempt);
    return attempt;
  }

  /**
   * Drops a clearance the host refused. Without this a stale cookie with time
   * left on it would be answered from the jar forever, and every request would
   * be challenged while the app insisted it was cleared.
   */
  async invalidate(url: string): Promise<void> {
    if (!hostOf(url)) return;
    await this.deps.removeCookie(url, CLEARANCE_COOKIE);
  }

  /** Whether `url`'s host currently holds a live clearance. */
  async holds(url: string): Promise<boolean> {
    return (await this.fromJar(url)) !== null;
  }

  /** Forgets every refusal; for "clear cookies" in Settings. */
  reset(): void {
    this.refused.clear();
  }

  private async solveFor(url: string, host: string): Promise<ClearanceAnswer> {
    let outcome: SolveOutcome;
    try {
      outcome = await this.deps.solve(url);
    } catch (error) {
      outcome = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    // Read back from the jar rather than trusting the solve's own cookie list:
    // the jar is what every later request will be answered from, so it is the
    // one place a "solved" verdict can be checked against.
    const held = await this.fromJar(url);
    if (held) {
      this.refused.delete(host);
      return { ...held, source: 'solved' };
    }
    const error = outcome.ok
      ? `The browser finished on ${host} without being issued a clearance.`
      : (outcome.error ?? `The browser could not clear ${host}.`);
    this.refused.set(host, { until: this.now() + FAILURE_COOLDOWN_MS, error });
    return { ok: false, error, retryAfterMs: FAILURE_COOLDOWN_MS };
  }

  private async fromJar(url: string): Promise<Extract<ClearanceAnswer, { ok: true }> | null> {
    let jar: JarCookie[];
    try {
      jar = await this.deps.readCookies(url);
    } catch {
      return null;
    }
    const clearance = jar.find((cookie) => cookie.name === CLEARANCE_COOKIE && cookie.value);
    if (!clearance) return null;
    if (
      clearance.expirationDate !== undefined &&
      clearance.expirationDate * 1000 - EXPIRY_MARGIN_MS <= this.now()
    ) {
      return null;
    }
    const cookies: Record<string, string> = {};
    for (const cookie of jar) cookies[cookie.name] = cookie.value;
    return { ok: true, cookies, userAgent: this.deps.userAgent(), source: 'jar' };
  }
}

function hostOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.hostname : null;
  } catch {
    return null;
  }
}

/**
 * The browser's agent with what real Chrome does not send removed.
 *
 * Electron's default reads
 * `… Chrome/134.0.6998.205 cloudstream-3-desktop/1.0.0 Electron/35.1.0 Safari/537.36`.
 * Two things in it are bot tells no real visitor carries: the `Electron/` and
 * app-name tokens, and a full Chrome build number — Chrome has frozen the minor
 * versions to `.0.0.0` since its User-Agent reduction. A challenge solved under
 * the raw agent is solved by something that announces it is not a browser.
 *
 * Only reshaped when it is recognisably Chromium's; anything else is returned
 * unchanged rather than guessed at.
 */
export function browserUserAgent(raw: string): string {
  // Electron places its own tokens before `Chrome/` on some builds and after
  // it on others, so the parts are found independently rather than in order.
  const head = raw.match(/^Mozilla\/5\.0 \(([^)]+)\) AppleWebKit\/([\d.]+) \(KHTML, like Gecko\)/);
  const chrome = raw.match(/\bChrome\/(\d+)/);
  if (!head || !chrome) return raw;
  const [, platform, webkit] = head;
  return `Mozilla/5.0 (${platform}) AppleWebKit/${webkit} (KHTML, like Gecko) Chrome/${chrome[1]}.0.0.0 Safari/${webkit}`;
}
