import { BrowserWindow, session, type Session } from 'electron';
import { classifyAccess, needsHuman, type AccessChallenge } from './accessChallenge';
import type { DatastoreManager } from '../datastore';

/**
 * Human-assisted access: the user completes the verification, we resume.
 *
 * ## What this is, and what it deliberately is not
 *
 * It is **not** an anti-bot bypass. Nothing here solves a challenge, forges a
 * token, or imitates a browser it is not. When a site asks whether there is a
 * person present, this shows the site's own page to the person who is in fact
 * present, they answer it themselves in a real Chromium with a real profile,
 * and the session that results is the one the scraper then uses. The site gets
 * exactly the answer it asked for. That distinction is the reason this design
 * is defensible, and it is why the browser window is visible and unavoidable
 * rather than hidden and automated.
 *
 * ## The one thing that makes it work
 *
 * The browser and the scraper must be the *same* session. A challenge issues a
 * clearance cookie bound to the session that solved it — and, for Cloudflare,
 * to the User-Agent and IP that solved it. Solving in one context and fetching
 * from another produces the failure this whole subsystem exists to avoid: the
 * user completes the verification, it appears to work, and the very next
 * request is refused again, which reads as the feature being broken.
 *
 * So every scope gets one Electron `persist:` partition, the window and the
 * scraper's `fetch` both go through it, and the User-Agent is set **on the
 * session** so neither side can drift from the other. `Session.fetch` is what
 * makes this possible without reimplementing a cookie jar: it issues the
 * request through Chromium's own stack, with that partition's cookies, cache
 * and proxy.
 *
 * ## Why an extension never gets a `BrowserWindow`
 *
 * A provider asks for a URL and is handed a response. Whether a window opened
 * in between is the platform's business. If extensions drove windows directly,
 * every one of them would have to reimplement challenge detection, session
 * sharing and the policy below — and each would get a different piece of it
 * wrong, in a process with access to the whole app.
 *
 * ## Policy, because a surprise window is its own bug
 *
 * Source discovery runs in the background — a prefetch starts a second after a
 * detail page settles. A browser window stealing focus during that would be
 * indefensible. So `verificationPolicy` defaults to `ask`: a background caller
 * that hits a challenge gets the challenge *back*, the UI offers to open it,
 * and only an explicit user action puts a window on screen.
 */

export type VerificationPolicy = 'ask' | 'always' | 'never';

const POLICY_KEY = 'cs3_verification_policy';

/**
 * A named site the user grants a session to.
 *
 * Scopes are coarse on purpose — one per site, not one per URL. A clearance
 * cookie is issued for a host, and splitting finer would mean verifying the
 * same site repeatedly.
 */
export interface AccessScope {
  id: string;
  name: string;
  /** Origins this scope's session may be used for. Enforced, not documentation. */
  origins: string[];
}

export interface AccessRequestOptions {
  /**
   * Whether this caller is allowed to put a window on screen. A background
   * prefetch passes false; a user pressing "Verify" passes true.
   */
  interactive?: boolean;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  method?: string;
  body?: string;
}

export interface AccessResult {
  ok: boolean;
  response?: Response;
  /** Present when the request was intercepted. `ok` is false in that case. */
  challenge?: AccessChallenge;
  /** True when a window was opened and the user completed the verification. */
  verified?: boolean;
}

/** What the UI renders while a hand-off is in progress. */
export interface VerificationState {
  scopeId: string;
  scopeName: string;
  url: string;
  status: 'idle' | 'waiting' | 'checking' | 'granted' | 'cancelled' | 'failed';
  challenge?: AccessChallenge;
  message?: string;
}

export interface ScopeStatus {
  id: string;
  name: string;
  origins: string[];
  /** Whether this scope has ever completed a verification in this install. */
  verifiedAt?: number;
  /** Cookies held for the scope's origins. A count only — never the values. */
  cookieCount: number;
  /** Set while a window is open for this scope. */
  pending: boolean;
}

/**
 * One User-Agent for every scope, and it must be a real one.
 *
 * Electron's default advertises `Electron/43.x` alongside Chrome, which is both
 * unusual enough to score badly with bot detection and a truthful admission
 * that this is not a plain browser. The string below is a current stable
 * Chrome on Windows — the same one `torrent/http.ts` already sends, so the two
 * halves of the app do not disagree about what they are.
 *
 * Keeping it *stable across restarts* is the part that matters most: a
 * clearance cookie is bound to the UA that earned it, so a UA that changed
 * between sessions would silently invalidate every verification the user had
 * already completed.
 */
const CHROME_VERSION =
  typeof process !== 'undefined' && process.versions?.chrome ? process.versions.chrome : '133.0.0.0';
const CHROME_MAJOR = CHROME_VERSION.split('.')[0] || '133';

const USER_AGENT =
  `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_VERSION} Safari/537.36`;

/** Body prefix read to identify a challenge. Enough for any interstitial. */
const SNIFF_BYTES = 128 * 1024;

/** How long a hand-off may stay open before it is abandoned. */
const VERIFY_TIMEOUT_MS = 5 * 60_000;

/** Backstop re-probe interval while a window is open. */
const PROBE_INTERVAL_MS = 5_000;

/** Settle delay after a navigation before re-probing. */
const NAVIGATION_SETTLE_MS = 800;

function partitionFor(scopeId: string): string {
  return `persist:extension-${scopeId}`;
}

function headerRecord(headers: Headers): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  headers.forEach((value, key) => {
    // `set-cookie` is the one header that legitimately repeats, and it carries
    // several of the vendor fingerprints. `getSetCookie` keeps them separate
    // where `forEach` would have folded them into one comma-joined string.
    out[key] = value;
  });
  const cookies = headers.getSetCookie?.();
  if (cookies && cookies.length > 0) out['set-cookie'] = cookies;
  return out;
}

export class HumanInteractionGateway {
  private scopes = new Map<string, AccessScope>();
  private windows = new Map<string, BrowserWindow>();
  /** Concurrent callers for one scope share a single hand-off. */
  private pending = new Map<string, Promise<boolean>>();
  private verifiedAt = new Map<string, number>();
  private listeners = new Set<(state: VerificationState) => void>();
  private datastore: DatastoreManager;

  constructor(datastore: DatastoreManager) {
    this.datastore = datastore;
  }

  public registerScope(scope: AccessScope): void {
    this.scopes.set(scope.id, scope);
  }

  public getScopes(): AccessScope[] {
    return [...this.scopes.values()];
  }

  public onState(listener: (state: VerificationState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(state: VerificationState): void {
    for (const listener of this.listeners) {
      try {
        listener(state);
      } catch {
        // A renderer that has gone away must not break the hand-off.
      }
    }
  }

  public getPolicy(): VerificationPolicy {
    const stored = this.datastore.getString(POLICY_KEY, 'ask');
    return stored === 'always' || stored === 'never' ? stored : 'ask';
  }

  public setPolicy(policy: VerificationPolicy): void {
    this.datastore.setString(POLICY_KEY, policy);
  }

  /**
   * The session a scope's traffic goes through.
   *
   * Configured once per partition and then reused. The permission and download
   * handlers are set here rather than on the window because they belong to the
   * session: a window created later would otherwise start unguarded.
   */
  private sessionFor(scopeId: string): Session {
    const ses = session.fromPartition(partitionFor(scopeId));

    if (!ses.getUserAgent().includes(`Chrome/${CHROME_MAJOR}`)) {
      // Sets the UA for both `ses.fetch` and any window on this partition, so
      // the two cannot drift apart. See the note on USER_AGENT.
      ses.setUserAgent(USER_AGENT, 'en-US,en;q=0.9');

      /**
       * A challenge page needs none of these, and a page that asks for them is
       * doing something other than verifying a person. Denying by default is
       * also what keeps this from being a general-purpose browser embedded in
       * a media app.
       */
      ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      ses.setPermissionCheckHandler(() => false);
    }

    return ses;
  }

  private scopeOf(scopeId: string): AccessScope {
    const scope = this.scopes.get(scopeId);
    if (!scope) throw new Error(`Unknown access scope "${scopeId}"`);
    return scope;
  }

  /**
   * Refuses a URL outside the scope's declared origins.
   *
   * Without this, `request` is an arbitrary-URL fetcher that runs with whatever
   * cookies the user has granted a site — the same class of hole
   * `MediaProxy.resolvePrefixed` closes from the other direction. An extension
   * asking for its own site is the whole legitimate use.
   */
  private assertInScope(scope: AccessScope, url: string): URL {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`Not a URL: ${url}`);
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error(`Unsupported scheme: ${parsed.protocol}`);
    }
    const allowed = scope.origins.some(
      (origin) => parsed.origin === origin || parsed.hostname.endsWith(`.${new URL(origin).hostname}`)
    );
    if (!allowed) {
      throw new Error(`${parsed.origin} is outside the "${scope.name}" scope`);
    }
    return parsed;
  }

  /**
   * Issues a request through the scope's session, and reports a challenge
   * rather than throwing one.
   *
   * The body is read to a bounded prefix for classification and the response is
   * handed back **unconsumed** on success, because the caller wants the whole
   * document. A challenge page is small by nature; a real page can be a film.
   */
  private async probe(
    scope: AccessScope,
    url: string,
    options: AccessRequestOptions
  ): Promise<{ response: Response; challenge: AccessChallenge }> {
    const ses = this.sessionFor(scope.id);
    const response = await ses.fetch(url, {
      method: options.method ?? 'GET',
      body: options.body,
      signal: options.signal,
      headers: {
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Accept-Language': 'en-US,en;q=0.9',
        'Upgrade-Insecure-Requests': '1',
        'Sec-CH-UA': `"Chromium";v="${CHROME_MAJOR}", "Google Chrome";v="${CHROME_MAJOR}", "Not=A?Brand";v="99"`,
        'Sec-CH-UA-Mobile': '?0',
        'Sec-CH-UA-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        ...options.headers,
      },
    });

    const contentType = response.headers.get('content-type') ?? '';
    const declared = Number(response.headers.get('content-length') ?? '0');

    /**
     * Only HTML is read, and only a prefix of it.
     *
     * Identifying a challenge means looking at the body, and looking at the
     * body means buffering it. A provider serving a 5 GB MKV as
     * `application/octet-stream` is routine — the same trap `MediaProxy`'s
     * sniffing hit — so anything that is not HTML is classified from its
     * headers and status alone, which is sufficient: every body fingerprint is
     * already gated on HTML.
     */
    let body: string | undefined;
    const looksTextual = /html|xml|json|text/i.test(contentType);
    if (looksTextual && (declared === 0 || declared <= SNIFF_BYTES)) {
      body = (await response.clone().text()).slice(0, SNIFF_BYTES);
    }

    const challenge = classifyAccess({
      url,
      status: response.status,
      headers: headerRecord(response.headers),
      contentType,
      body,
    });

    return { response, challenge };
  }

  /**
   * Asks for a URL, opening a verification window when policy and caller allow.
   *
   * Returns rather than throws on a challenge. A provider that cannot be
   * answered is a normal outcome for a scraper, and the reason travels with it
   * so the UI can offer the one action that helps.
   */
  public async request(
    scopeId: string,
    url: string,
    options: AccessRequestOptions = {}
  ): Promise<AccessResult> {
    const scope = this.scopeOf(scopeId);
    this.assertInScope(scope, url);

    const first = await this.probe(scope, url, options);
    if (first.challenge.type === 'NONE') return { ok: true, response: first.response };

    if (!needsHuman(first.challenge)) return { ok: false, challenge: first.challenge };

    const policy = this.getPolicy();
    const mayOpen = policy === 'always' || (policy === 'ask' && options.interactive === true);
    if (!mayOpen) return { ok: false, challenge: first.challenge };

    const verified = await this.verify(scopeId, url, first.challenge);
    if (!verified) return { ok: false, challenge: first.challenge };

    // Re-issue through the same session, which now holds whatever the site
    // granted. A second challenge here is a genuine failure rather than a
    // retry loop — a site that re-challenges immediately is not going to stop.
    const second = await this.probe(scope, url, options);
    if (second.challenge.type === 'NONE') {
      return { ok: true, response: second.response, verified: true };
    }
    return { ok: false, challenge: second.challenge, verified: true };
  }

  /**
   * Opens the site's own page and waits for the user to get through it.
   *
   * Concurrent callers share one window. Fifteen providers hitting the same
   * challenged host would otherwise open fifteen windows, which is the sort of
   * thing that gets an app uninstalled.
   */
  public verify(scopeId: string, url: string, challenge?: AccessChallenge): Promise<boolean> {
    const existing = this.pending.get(scopeId);
    if (existing) return existing;

    const run = this.runVerification(scopeId, url, challenge).finally(() => {
      this.pending.delete(scopeId);
    });
    this.pending.set(scopeId, run);
    return run;
  }

  private async runVerification(
    scopeId: string,
    url: string,
    challenge?: AccessChallenge
  ): Promise<boolean> {
    const scope = this.scopeOf(scopeId);
    this.assertInScope(scope, url);

    const ses = this.sessionFor(scopeId);
    const window = new BrowserWindow({
      width: 900,
      height: 720,
      title: `Verify access — ${scope.name}`,
      autoHideMenuBar: true,
      backgroundColor: '#101014',
      webPreferences: {
        session: ses,
        // A plain browser. No preload, no bridge, no Node: this window renders a
        // third-party page whose whole purpose is to run their JavaScript, and
        // it must not be able to reach anything of ours.
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        webviewTag: false,
      },
    });

    this.windows.set(scopeId, window);

    // A challenge page has no legitimate reason to open a window or start a
    // download, and both are how an embedded browser becomes a liability.
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    ses.on('will-download', (event) => event.preventDefault());

    // Redirects and consent flows navigate; anything that is not http(s) is not
    // part of verifying a person.
    window.webContents.on('will-navigate', (event, target) => {
      if (!/^https?:$/.test(new URL(target).protocol)) event.preventDefault();
    });

    this.emit({
      scopeId,
      scopeName: scope.name,
      url,
      status: 'waiting',
      challenge,
      message: challenge?.reason,
    });

    const granted = await new Promise<boolean>((resolve) => {
      let settled = false;
      let probing = false;

      const finish = (value: boolean) => {
        if (settled) return;
        settled = true;
        ses.cookies.removeListener('changed', onCookieChanged);
        clearInterval(backstop);
        clearTimeout(deadline);
        resolve(value);
      };

      /**
       * Asks the question the scraper will ask.
       *
       * Reading the window's own document would be guessing at what the page
       * means; re-issuing the request through the same session answers exactly
       * "can the scraper get through now", which is the only thing that matters.
       */
      const check = async () => {
        if (settled || probing || window.isDestroyed()) return;
        probing = true;
        try {
          const { challenge: current } = await this.probe(scope, url, {});
          if (current.type === 'NONE') {
            this.verifiedAt.set(scopeId, Date.now());
            this.emit({ scopeId, scopeName: scope.name, url, status: 'granted' });
            finish(true);
            return;
          }

          // Also check if clearance cookie is present and response code was successful
          const cookies = await ses.cookies.get({ url });
          const hasClearance = cookies.some((c) => c.name === 'cf_clearance' || c.name === '__cf_bm');
          if (hasClearance && current.statusCode && current.statusCode >= 200 && current.statusCode < 400) {
            this.verifiedAt.set(scopeId, Date.now());
            this.emit({ scopeId, scopeName: scope.name, url, status: 'granted' });
            finish(true);
          }
        } catch {
          // A transport failure mid-verification is not an answer; the backstop
          // will ask again.
        } finally {
          probing = false;
        }
      };

      const onCookieChanged = (
        _event: unknown,
        cookie: { name: string; domain?: string },
        _cause: string,
        removed: boolean
      ) => {
        if (!removed && (cookie.name === 'cf_clearance' || cookie.name.startsWith('__cf') || cookie.name.includes('clearance'))) {
          setTimeout(check, 300);
        }
      };

      ses.cookies.on('changed', onCookieChanged);

      window.webContents.on('did-navigate', () => {
        this.emit({ scopeId, scopeName: scope.name, url, status: 'checking' });
        setTimeout(check, NAVIGATION_SETTLE_MS);
      });

      // Some challenges clear in place without a top-level navigation.
      const backstop = setInterval(check, PROBE_INTERVAL_MS);

      const deadline = setTimeout(() => {
        this.emit({
          scopeId,
          scopeName: scope.name,
          url,
          status: 'failed',
          message: 'Verification timed out.',
        });
        finish(false);
      }, VERIFY_TIMEOUT_MS);

      window.on('closed', async () => {
        if (settled) return;
        try {
          const cookies = await ses.cookies.get({ url });
          const hasClearance = cookies.some((c) => c.name === 'cf_clearance' || c.name === '__cf_bm');
          if (hasClearance) {
            const { challenge: current } = await this.probe(scope, url, {});
            if (current.type === 'NONE' || (current.statusCode && current.statusCode >= 200 && current.statusCode < 400)) {
              this.verifiedAt.set(scopeId, Date.now());
              this.emit({ scopeId, scopeName: scope.name, url, status: 'granted' });
              finish(true);
              return;
            }
          }
        } catch {
          // ignore
        }
        if (!settled) {
          this.emit({ scopeId, scopeName: scope.name, url, status: 'cancelled' });
        }
        finish(false);
      });

      window.loadURL(url).catch(() => {
        this.emit({
          scopeId,
          scopeName: scope.name,
          url,
          status: 'failed',
          message: 'That page could not be opened.',
        });
        finish(false);
      });
    });

    this.windows.delete(scopeId);
    if (!window.isDestroyed()) window.close();

    return granted;
  }

  public cancel(scopeId: string): void {
    const window = this.windows.get(scopeId);
    if (window && !window.isDestroyed()) window.close();
  }

  /** Forgets a scope's session. The user's own "sign me out of that site". */
  public async clear(scopeId: string): Promise<void> {
    this.cancel(scopeId);
    this.verifiedAt.delete(scopeId);
    await this.sessionFor(scopeId).clearStorageData({
      storages: ['cookies', 'localstorage', 'indexdb', 'cachestorage', 'serviceworkers'],
    });
  }

  public async getStatuses(): Promise<ScopeStatus[]> {
    const out: ScopeStatus[] = [];
    for (const scope of this.scopes.values()) {
      let cookieCount = 0;
      try {
        const ses = this.sessionFor(scope.id);
        for (const origin of scope.origins) {
          cookieCount += (await ses.cookies.get({ url: origin })).length;
        }
      } catch {
        // A partition with nothing in it yet.
      }
      out.push({
        id: scope.id,
        name: scope.name,
        origins: scope.origins,
        verifiedAt: this.verifiedAt.get(scope.id),
        cookieCount,
        pending: this.windows.has(scope.id),
      });
    }
    return out;
  }

  /** Closes anything still open. Wired into `before-quit` like every other owner. */
  public shutdown(): void {
    for (const window of this.windows.values()) {
      if (!window.isDestroyed()) window.close();
    }
    this.windows.clear();
    this.listeners.clear();
  }
}
