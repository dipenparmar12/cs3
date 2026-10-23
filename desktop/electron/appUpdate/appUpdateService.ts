import { automaticCheckDelay } from '../cs3/updateSchedule.ts';
import { selectUpdate, type GithubRelease, type Platform, type UpdateChannel, type UpdateOffer } from './releaseSelection.ts';

/**
 * Whether a newer CloudStream 3 Desktop is published (App Update PRD, Phase 1).
 *
 * GitHub's public release list is the only source: no server of ours. Checked
 * at most once per calendar day (the extension-update rule,
 * `cs3/updateSchedule.ts`), 60 s after launch, with `If-None-Match` so a
 * repeat costs nothing against GitHub's 60-an-hour limit; a manual check never
 * uses up the day's automatic one. A rate limit backs off until GitHub says;
 * a 404 (private or renamed repository) stops automatic checks. Phase 1 only
 * opens the download in the browser: the app fetches and runs nothing.
 *
 * Installation-wide (one program on disk), never per viewer profile.
 */

export const RELEASES_URL = 'https://api.github.com/repos/dipenparmar12/cs3/releases?per_page=20';
const SETTLE_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

const KEY = {
  channel: 'app_update_channel',
  autoCheck: 'app_update_auto_check',
  skipped: 'app_update_skipped_version',
  state: 'app_update_last_check',
  etag: 'app_update_etag',
  releases: 'app_update_releases',
} as const;

export type CheckResult =
  | { kind: 'up-to-date' }
  | { kind: 'available'; version: string }
  | { kind: 'error'; message: string }
  | { kind: 'unavailable'; message: string };

export interface AppUpdateState {
  current: string;
  channel: UpdateChannel;
  autoCheck: boolean;
  /** False in a development build or smoke run: nothing is ever checked. */
  enabled: boolean;
  checking: boolean;
  lastCheckedAt?: number;
  lastResult?: CheckResult;
  available?: UpdateOffer;
  skipped?: string;
}

interface Stored {
  lastCheckedAt?: number;
  lastAutoCheckAt?: number;
  lastResult?: CheckResult;
  backoffUntil?: number;
  /** Set by a 404: automatic checks stop until the running version changes. */
  stoppedForVersion?: string;
}

export interface AppUpdateDeps {
  store: {
    getString(key: string, fallback?: string): string | undefined;
    setString(key: string, value: string): void;
    getBool(key: string, fallback?: boolean): boolean;
    setBool(key: string, value: boolean): void;
    getObject<T>(key: string, fallback: T): T | null;
    setObject(key: string, value: unknown): void;
  };
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  currentVersion: string;
  platform: Platform;
  /** False for a development build or a smoke run. */
  enabled: boolean;
  openExternal: (url: string) => Promise<void> | void;
  log: (event: string, data?: Record<string, unknown>) => void;
  now?: () => number;
}

export class AppUpdateService {
  private readonly deps: AppUpdateDeps;
  private readonly now: () => number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private checking = false;
  private listeners = new Set<(state: AppUpdateState) => void>();

  constructor(deps: AppUpdateDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
  }

  onChange(listener: (state: AppUpdateState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    const state = this.getState();
    for (const listener of this.listeners) listener(state);
  }

  private stored(): Stored {
    return this.deps.store.getObject<Stored>(KEY.state, {}) ?? {};
  }

  private record(patch: Partial<Stored>): void {
    this.deps.store.setObject(KEY.state, { ...this.stored(), ...patch });
  }

  private channel(): UpdateChannel {
    return this.deps.store.getString(KEY.channel, 'stable') === 'beta' ? 'beta' : 'stable';
  }

  private autoCheck(): boolean {
    return this.deps.store.getBool(KEY.autoCheck, true);
  }

  /** The offer from the releases last fetched, under today's settings. No network. */
  private offer(): UpdateOffer | undefined {
    const releases = this.deps.store.getObject<GithubRelease[]>(KEY.releases, []) ?? [];
    const { offer } = selectUpdate({
      releases,
      current: this.deps.currentVersion,
      channel: this.channel(),
      platform: this.deps.platform,
      skipped: this.deps.store.getString(KEY.skipped, '') || undefined,
    });
    return offer ?? undefined;
  }

  getState(): AppUpdateState {
    const stored = this.stored();
    const skipped = this.deps.store.getString(KEY.skipped, '') || undefined;
    return {
      current: this.deps.currentVersion,
      channel: this.channel(),
      autoCheck: this.autoCheck(),
      enabled: this.deps.enabled,
      checking: this.checking,
      lastCheckedAt: stored.lastCheckedAt,
      lastResult: stored.lastResult,
      available: this.deps.enabled ? this.offer() : undefined,
      skipped,
    };
  }

  /** Arms the next automatic check. Idempotent; re-armed after every run and settings change. */
  schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.deps.enabled) return;
    const stored = this.stored();
    if (stored.stoppedForVersion === this.deps.currentVersion) return;
    const delay = automaticCheckDelay({
      policy: this.autoCheck() ? 'daily' : 'manual',
      lastAutoCheckAt: stored.lastAutoCheckAt ?? 0,
      now: this.now(),
      settleMs: SETTLE_MS,
    });
    if (delay === null) return;
    const wait = Math.max(delay, (stored.backoffUntil ?? 0) - this.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.check({ automatic: true }).finally(() => this.schedule());
    }, wait);
    this.timer.unref?.();
  }

  async check(options: { automatic?: boolean } = {}): Promise<AppUpdateState> {
    if (!this.deps.enabled || this.checking) return this.getState();
    const now = this.now();
    if (options.automatic) this.record({ lastAutoCheckAt: now });
    this.checking = true;
    this.emit();
    try {
      const etag = this.deps.store.getString(KEY.etag, '') || undefined;
      const response = await this.deps.fetch(RELEASES_URL, {
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(etag ? { 'If-None-Match': etag } : {}),
        },
      });
      if (response.status === 304) {
        this.finish(now, this.resultForOffer());
      } else if (response.status === 404) {
        const message = 'Updates cannot be checked for this build: its release page is not public.';
        this.record({ stoppedForVersion: this.deps.currentVersion });
        this.finish(now, { kind: 'unavailable', message });
      } else if (response.status === 403 || response.status === 429) {
        const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000;
        const retryAfter = Number(response.headers.get('retry-after')) * 1000;
        const until = retryAfter > 0 ? now + retryAfter : reset > now ? reset : now + DAY_MS;
        this.record({ backoffUntil: until });
        this.finish(now, { kind: 'error', message: 'GitHub asked to slow down; checking again later.' });
      } else if (!response.ok) {
        this.finish(now, { kind: 'error', message: `GitHub answered HTTP ${response.status}.` });
      } else {
        const body = (await response.json()) as unknown;
        if (!Array.isArray(body)) throw new Error('GitHub did not answer with a release list.');
        const releases = (body as GithubRelease[]).map(trimRelease);
        this.deps.store.setObject(KEY.releases, releases);
        const tag = response.headers.get('etag');
        if (tag) this.deps.store.setString(KEY.etag, tag);
        this.record({ backoffUntil: undefined });
        const { ignored } = selectUpdate({
          releases,
          current: this.deps.currentVersion,
          channel: this.channel(),
          platform: this.deps.platform,
        });
        if (ignored.length > 0) this.deps.log('app_update_ignored_release', { tags: ignored });
        this.finish(now, this.resultForOffer());
      }
    } catch (error) {
      this.finish(now, { kind: 'error', message: error instanceof Error ? error.message : String(error) });
    } finally {
      this.checking = false;
      this.emit();
    }
    return this.getState();
  }

  private resultForOffer(): CheckResult {
    const offer = this.offer();
    return offer ? { kind: 'available', version: offer.version } : { kind: 'up-to-date' };
  }

  private finish(at: number, result: CheckResult): void {
    this.record({ lastCheckedAt: at, lastResult: result });
    this.deps.log('app_update_check', { result: result.kind, ...(result.kind === 'available' ? { version: result.version } : {}) });
  }

  setSettings(patch: { channel?: UpdateChannel; autoCheck?: boolean }): AppUpdateState {
    if (patch.channel === 'stable' || patch.channel === 'beta') this.deps.store.setString(KEY.channel, patch.channel);
    if (typeof patch.autoCheck === 'boolean') this.deps.store.setBool(KEY.autoCheck, patch.autoCheck);
    this.schedule();
    this.emit();
    return this.getState();
  }

  skip(version: string): AppUpdateState {
    this.deps.store.setString(KEY.skipped, version.replace(/^v/, ''));
    this.emit();
    return this.getState();
  }

  unskip(): AppUpdateState {
    this.deps.store.setString(KEY.skipped, '');
    this.emit();
    return this.getState();
  }

  async openDownload(): Promise<boolean> {
    const offer = this.offer();
    const url = offer?.asset.url || offer?.pageUrl;
    if (!url || !/^https:\/\//.test(url)) return false;
    await this.deps.openExternal(url);
    return true;
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

/** Only what selection needs is kept (the list is stored between checks). */
function trimRelease(release: GithubRelease): GithubRelease {
  return {
    tag_name: String(release.tag_name ?? ''),
    name: release.name ?? null,
    body: typeof release.body === 'string' ? release.body.slice(0, 8000) : null,
    draft: Boolean(release.draft),
    prerelease: Boolean(release.prerelease),
    published_at: release.published_at ?? null,
    html_url: release.html_url,
    assets: (release.assets ?? []).map((a) => ({
      name: String(a.name),
      size: Number(a.size) || 0,
      browser_download_url: String(a.browser_download_url),
    })),
  };
}
