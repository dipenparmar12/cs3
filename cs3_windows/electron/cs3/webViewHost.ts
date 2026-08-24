/**
 * The browser the JVM cannot open for itself.
 *
 * This is the host half of PRD-36 step 7. `WebViewResolver` on Android drives a
 * real `WebView`: it loads a page, lets its JavaScript run, and reports the
 * request that finally matched. `library-jvm`'s JVM variant of that class has a
 * pass-through `intercept` and a `resolveUsingWebView` that is
 * `TODO("Not yet implemented")`, so on desktop a provider needing a browser did
 * not degrade — it threw, or it quietly took a Cloudflare interstitial for the
 * page it asked for.
 *
 * **The engine was always in the box.** Android borrows the system WebView;
 * Electron *is* Chromium. What was missing was direction: the stdio RPC ran main
 * → sidecar only, so the JVM had no way to ask. `HostChannel` on the sidecar
 * side supplies that, and this answers it.
 *
 * ## One session, many resolves
 *
 * `webRequest` handlers are **per session, and there is only one of each**.
 * Registering `onBeforeSendHeaders` per resolve would mean the second concurrent
 * resolve silently unhooked the first — which reads as a provider that
 * intermittently finds nothing, only when another provider happens to be
 * scraping at the same time. So the handlers are installed once and dispatch on
 * `webContentsId`.
 *
 * The session is deliberately shared and persistent. `cf_clearance` is issued
 * per browser, and a clearance earned on one resolve is what makes the next
 * twenty cheap; a partition per resolve would re-solve the challenge every time.
 */
import { BrowserWindow, session, type Session, type OnBeforeSendHeadersListenerDetails } from 'electron';
import { scopedLogger } from '../logging/logger';
import {
  classifyRequest,
  compilePattern,
  compilePatterns,
  type CompiledPattern,
} from './webViewMatch';

const log = scopedLogger('runtime', { component: 'webview' });

/** Shared by every resolve, so a clearance earned once is reused. */
const PARTITION = 'persist:cs3-webview';

/**
 * How many browser windows may be open at once.
 *
 * Each is a full Chromium page with JavaScript running. A season pack's worth of
 * providers resolving together would otherwise open a dozen, and the machine
 * that suffers most is the one already struggling to decode 4K.
 */
const MAX_CONCURRENT = 3;

/** Bounds a caller that asks for a week. `HostChannel` enforces the same ceiling. */
const MAX_TIMEOUT_MS = 180_000;

export interface WebViewResolveRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  /** The Java pattern that ends the resolve. */
  interceptUrl: string;
  /** Java patterns that are collected without ending it. */
  additionalUrls?: string[];
  userAgent?: string;
  script?: string;
  /**
   * Upstream's "try to use the okhttp client as much as possible, disable for
   * cloudflare". Carried for fidelity and used only as the hint it is — see the
   * note in the bridge's `WebViewResolver` for why nothing re-issues subrequests
   * across the process boundary.
   */
  useOkhttp?: boolean;
  timeoutMs?: number;
  /**
   * Finish as soon as the session holds a cookie with this name.
   *
   * This is how a Cloudflare bypass ends. `CloudflareKiller` has no URL to
   * intercept — upstream passes the deliberately unmatchable `.^` — so the only
   * signal that the challenge is done is `cf_clearance` appearing. Without it
   * every bypass would run to the full timeout and add a minute to the first
   * request against every protected host.
   */
  awaitCookie?: string;
}

export interface ObservedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
}

/**
 * The answer document, and the wire format the bridge's `HostWebViewAnswer`
 * binds to **by field name**. Jackson matches constructor parameter names, so a
 * rename here does not fail over there — it binds to nothing, and the provider
 * reports no results.
 */
export interface WebViewAnswer {
  ok: boolean;
  error?: string;
  request?: ObservedRequest;
  extra: ObservedRequest[];
  userAgent?: string;
  cookies: Record<string, string>;
  scriptResults: string[];
}

/** Everything one in-flight resolve needs the shared handlers to know. */
interface Resolution {
  patterns: { intercept: CompiledPattern; additional: CompiledPattern[] };
  extra: ObservedRequest[];
  matched?: ObservedRequest;
  finish: () => void;
}

function toObserved(details: OnBeforeSendHeadersListenerDetails): ObservedRequest {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(details.requestHeaders ?? {})) {
    // Electron models repeated headers as an array; a provider replaying one
    // wants a single value, and the first is the one the browser sent first.
    headers[name] = Array.isArray(value) ? String(value[0]) : String(value);
  }
  return { url: details.url, method: details.method, headers };
}

export class WebViewHost {
  private ses: Session | null = null;
  private handlersInstalled = false;
  /** Keyed by `webContents.id`, which is what the webRequest details carry. */
  private readonly active = new Map<number, Resolution>();
  private queue: Array<() => void> = [];
  private running = 0;

  /** The browser's own agent, read once and reported to every caller. */
  private defaultUserAgent: string | null = null;

  public isAvailable(): boolean {
    // `BrowserWindow` is undefined outside a running Electron main process,
    // which is how the tests and the e2e harness import this module.
    return typeof BrowserWindow === 'function';
  }

  private ensureSession(): Session {
    if (this.ses) return this.ses;
    const ses = session.fromPartition(PARTITION);

    /*
     * Certificate errors are ignored for this partition and nowhere else.
     *
     * Android's WebViewResolver does `handler.proceed()` on every SSL error, and
     * a meaningful number of scraper hosts have expired or mismatched
     * certificates; refusing them means those providers simply stop working,
     * which is a divergence from the reference implementation rather than a
     * safety improvement anyone asked for.
     *
     * What bounds it: this session is used *only* to solve challenges and watch
     * which URLs a page requests. It never carries the user's credentials, and
     * the stream it discovers is fetched afterwards through the ordinary path,
     * with ordinary verification. Widening this to the app's default session
     * would be a different and much worse decision.
     */
    ses.setCertificateVerifyProc((_request, callback) => callback(0));

    this.ses = ses;
    return ses;
  }

  private installHandlers(ses: Session): void {
    if (this.handlersInstalled) return;
    this.handlersInstalled = true;

    // Cancels the assets a resolve has no use for. Separate from the collector
    // below because this is the only hook that can cancel, and that one is the
    // only hook that carries request headers.
    ses.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
      const resolution = this.active.get(details.webContentsId ?? -1);
      if (!resolution) return callback({});
      const verdict = classifyRequest(details.url, resolution.patterns);
      callback({ cancel: verdict.kind === 'block' });
    });

    ses.webRequest.onBeforeSendHeaders({ urls: ['*://*/*'] }, (details, callback) => {
      const resolution = this.active.get(details.webContentsId ?? -1);
      if (!resolution) return callback({ requestHeaders: details.requestHeaders });

      const verdict = classifyRequest(details.url, resolution.patterns);
      if (verdict.kind === 'intercept') {
        resolution.matched = toObserved(details);
        // Let the request itself proceed; cancelling it would be visible to the
        // page, and the window is about to be destroyed anyway.
        callback({ requestHeaders: details.requestHeaders });
        resolution.finish();
        return;
      }
      if (verdict.kind === 'additional') {
        resolution.extra.push(toObserved(details));
      }
      callback({ requestHeaders: details.requestHeaders });
    });
  }

  /**
   * Runs `job` once a browser slot is free.
   *
   * The slot is *handed over* rather than released and re-claimed. Decrementing
   * and letting the queue race for it lets a caller arriving in the same tick
   * take the slot a waiter was just given, so both run and the limit is quietly
   * exceeded — which on a season-pack scrape is a dozen Chromium pages instead
   * of three.
   */
  private async withSlot<T>(job: () => Promise<T>): Promise<T> {
    if (this.running < MAX_CONCURRENT) {
      this.running++;
    } else {
      await new Promise<void>((release) => this.queue.push(release));
      // The releaser kept the count; this slot is already ours.
    }
    try {
      return await job();
    } finally {
      const next = this.queue.shift();
      if (next) next();
      else this.running--;
    }
  }

  public async resolve(request: WebViewResolveRequest): Promise<WebViewAnswer> {
    const empty: WebViewAnswer = { ok: false, extra: [], cookies: {}, scriptResults: [] };
    if (!this.isAvailable()) {
      return { ...empty, error: 'This build has no browser to resolve the page with.' };
    }

    const intercept = compilePattern(request.interceptUrl);
    if (!intercept.regex) {
      // Reported rather than attempted. A pattern that can never match would
      // otherwise spend the full timeout on every link and come back looking
      // exactly like a host that is down.
      const error =
        `The extension's intercept pattern could not be used: ${intercept.reason} ` +
        `(${intercept.source})`;
      log.warn('webview_pattern_rejected', { url: request.url, error });
      return { ...empty, error };
    }

    return this.withSlot(() => this.run(request, intercept));
  }

  private async run(
    request: WebViewResolveRequest,
    intercept: CompiledPattern
  ): Promise<WebViewAnswer> {
    const ses = this.ensureSession();
    this.installHandlers(ses);

    const timeoutMs = Math.min(Math.max(request.timeoutMs ?? 60_000, 1_000), MAX_TIMEOUT_MS);
    const patterns = { intercept, additional: compilePatterns(request.additionalUrls ?? []) };
    const scriptResults: string[] = [];
    const done = log.begin('webview_resolve', { url: request.url });

    const win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 720,
      webPreferences: {
        partition: PARTITION,
        // A hidden window has its timers throttled, and a challenge page is
        // mostly timers. Left on, the page takes minutes or never finishes —
        // which reads as the site being slow rather than as our own setting.
        backgroundThrottling: false,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        // Untrusted third-party pages run here. `webSecurity` stays on: nothing
        // about solving a challenge needs cross-origin reads, and the pages are
        // written for real browsers that enforce it.
        webSecurity: true,
        images: false,
      },
    });

    const id = win.webContents.id;
    if (!this.defaultUserAgent) this.defaultUserAgent = win.webContents.getUserAgent();

    let settled = false;
    let failure: string | undefined;
    const finished = new Promise<void>((resolve) => {
      const finish = (reason?: string) => {
        if (settled) return;
        settled = true;
        if (reason) failure = reason;
        resolve();
      };

      this.active.set(id, { patterns, extra: [], finish: () => finish() });

      const timer = setTimeout(() => {
        // Not an error. Upstream returns whatever it collected on timeout, and
        // a resolve that found three of its `additionalUrls` and no intercept
        // is a useful answer.
        finish();
      }, timeoutMs);
      timer.unref?.();

      win.webContents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
        // Subresource failures are ordinary on a challenge page and upstream
        // ignores them all. A main-frame failure is different: nothing further
        // will load, and waiting the remaining 59 seconds to discover that is
        // the stall this whole feature exists to avoid.
        //
        // -3 is ERR_ABORTED, which is what a navigation the page itself
        // replaced looks like — a redirect, not a failure.
        if (!isMainFrame || code === -3) return;
        finish(`The page could not be loaded: ${description} (${code}).`);
      });

      win.webContents.on('render-process-gone', (_event, details) =>
        finish(`The browser stopped: ${details.reason}.`)
      );
      win.on('closed', () => finish('The browser window was closed.'));

      if (request.awaitCookie) {
        /*
         * Watched rather than polled, and read from the session rather than the
         * page: `cf_clearance` is `HttpOnly`, so `document.cookie` comes back
         * without the one cookie the whole exercise is for.
         */
        const wanted = request.awaitCookie;
        const onChanged = (
          _event: unknown,
          cookie: { name: string; domain?: string },
          _cause: unknown,
          removed: boolean
        ) => {
          if (removed || cookie.name !== wanted) return;
          ses.cookies.off('changed', onChanged);
          finish();
        };
        ses.cookies.on('changed', onChanged);
        void finished.then(() => ses.cookies.off('changed', onChanged));
      }
    });

    try {
      if (request.userAgent) win.webContents.setUserAgent(request.userAgent);

      /*
       * The script is evaluated after the DOM settles, and once more before the
       * window goes.
       *
       * Android evaluates it inside `shouldInterceptRequest` — once per
       * subresource, which on a busy page is dozens of times. That is free
       * in-process and is not free across an IPC boundary, and every corpus use
       * is "read a value the page has computed", which the DOM-ready evaluation
       * answers. The second pass covers a value that only appears once the
       * challenge has completed.
       */
      const evaluate = async () => {
        if (!request.script || win.isDestroyed()) return;
        try {
          const value = await win.webContents.executeJavaScript(request.script, true);
          const text = typeof value === 'string' ? value : JSON.stringify(value ?? null);
          if (text && !scriptResults.includes(text)) scriptResults.push(text);
        } catch (error) {
          log.debug('webview_script_failed', {
            url: request.url,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      };
      if (request.script) win.webContents.on('dom-ready', () => void evaluate());

      /*
       * Always a GET, whatever `method` says.
       *
       * Android's `WebView.loadUrl(url, headers)` cannot POST — upstream never
       * calls `postUrl` — so the method only ever shapes the `Request` object
       * that `requestCreator` builds, never the navigation. Sending a POST here
       * would be a divergence from the reference implementation dressed up as a
       * fix.
       */
      await win.loadURL(request.url, {
        httpReferrer: request.headers?.Referer ?? request.headers?.referer,
        userAgent: request.userAgent,
        extraHeaders: formatExtraHeaders(request.headers),
      }).catch(() => {
        // `loadURL` rejects on the same conditions `did-fail-load` reports, and
        // that listener already carries the detail. Swallowed so a redirect
        // aborting the first navigation does not fail the resolve.
      });

      await finished;
      // Awaited rather than fired off: the window is destroyed in `finally`, so
      // an unawaited second pass would race the teardown and, when it won, land
      // its result after the answer had already been returned.
      await evaluate();

      const resolution = this.active.get(id);
      const matched = resolution?.matched;
      const extra = resolution?.extra ?? [];
      const cookies = await this.readCookies(ses, request.url);

      done({ matched: Boolean(matched), extra: extra.length, cookies: Object.keys(cookies).length });
      // A cookie-driven resolve matches no URL by design, so "found nothing" is
      // not failure there — the cookies *are* the answer.
      const satisfied = Boolean(matched) || (request.awaitCookie ? request.awaitCookie in cookies : false);
      if (!satisfied && failure) {
        return {
          ok: false,
          error: failure,
          extra,
          cookies,
          userAgent: this.defaultUserAgent ?? undefined,
          scriptResults,
        };
      }
      return {
        ok: true,
        request: matched,
        extra,
        cookies,
        userAgent: this.defaultUserAgent ?? undefined,
        scriptResults,
      };
    } finally {
      this.active.delete(id);
      // A leaked hidden window keeps running its page — timers, requests and
      // all — with nothing on screen to reveal it.
      if (!win.isDestroyed()) win.destroy();
    }
  }

  /**
   * Cookies for the resolved host, for `CloudflareKiller` to replay.
   *
   * Read from the session rather than the page, so `HttpOnly` cookies are
   * included — `cf_clearance` is one, and reading `document.cookie` would come
   * back without the only cookie that matters.
   */
  private async readCookies(ses: Session, url: string): Promise<Record<string, string>> {
    try {
      const jar = await ses.cookies.get({ url });
      const cookies: Record<string, string> = {};
      for (const cookie of jar) cookies[cookie.name] = cookie.value;
      return cookies;
    } catch (error) {
      log.debug('webview_cookies_unreadable', {
        url,
        error: error instanceof Error ? error.message : String(error),
      });
      return {};
    }
  }

  /** Drops every cookie this feature has accumulated. */
  public async clearCookies(): Promise<void> {
    if (!this.ses) return;
    await this.ses.clearStorageData({ storages: ['cookies'] });
  }

  public destroy(): void {
    for (const id of this.active.keys()) {
      const contents = BrowserWindow.getAllWindows().find((w) => w.webContents.id === id);
      if (contents && !contents.isDestroyed()) contents.destroy();
    }
    this.active.clear();
  }
}

/**
 * Electron's `extraHeaders` is a single newline-joined string.
 *
 * `Referer` is deliberately excluded: it is passed through `httpReferrer`
 * instead, and supplying both makes Chromium send the header twice, which some
 * of the very hosts this exists for reject.
 */
function formatExtraHeaders(headers?: Record<string, string>): string | undefined {
  if (!headers) return undefined;
  const lines = Object.entries(headers)
    .filter(([name]) => name.toLowerCase() !== 'referer')
    .map(([name, value]) => `${name}: ${value}`);
  return lines.length > 0 ? lines.join('\n') : undefined;
}
