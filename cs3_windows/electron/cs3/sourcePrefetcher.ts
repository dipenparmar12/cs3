import type { ContentService, SourceQuery } from '../contentService';
import type { DatastoreManager } from '../datastore';

/**
 * Starts looking for sources while the viewer is still reading the synopsis.
 *
 * Pressing Play used to begin a fifteen-provider scrape from cold, and the
 * viewer watched a spinner for the length of the slowest one. Meanwhile they
 * had been sitting on the detail page for ten seconds doing nothing — reading
 * the plot, checking the year, scrolling the episode list — which is exactly
 * the window the work could have run in. This uses it.
 *
 * ## Why this is deliberately restrained
 *
 * Opening a detail page is not a commitment to watch. Firing a full discovery
 * on every one would scrape a dozen community sites for titles nobody plays,
 * which is both wasteful and rude to hosts this app depends on staying friendly
 * — the fastest way to get an IP blocked is to hammer a scraper target with
 * speculative traffic. So:
 *
 * - **Nothing runs until the page has been open for {@link SETTLE_MS}.** Paging
 *   through six titles fires zero scrapes, not six.
 * - **Nothing runs when the cache can already answer.** That check is a `peek`,
 *   so it neither writes nor promotes the entry.
 * - **One at a time.** A new target supersedes the previous one rather than
 *   running beside it.
 * - **It can be switched off**, and says what it costs. Someone on a metered
 *   connection should not have to discover this by watching their data go.
 *
 * ## Why it is safe to race with Play
 *
 * `ContentService.getSources` shares in-flight runs, so pressing Play during a
 * prefetch **joins** it — inheriting its progress so far — rather than starting
 * a second identical scrape. Without that this feature would be actively
 * harmful, and the sharing is the reason it is worth having rather than an
 * optimisation on top of it.
 *
 * Results are not held here. They go into `SourceCache`, which already expires
 * per source — magnets never, provider links on the deadline in their URL — so
 * "reuse unless expired" is a property of the cache and not a second policy
 * invented in this file.
 */

/** How long a detail page must stay open before its sources are worth fetching. */
const SETTLE_MS = 1_200;

/** Prefetching is on by default; the datastore holds the user's choice. */
const SETTING_KEY = 'prefetch_sources_on_detail';

export interface PrefetchState {
  /** The media this refers to, so a stale snapshot can be ignored by the UI. */
  mediaUrl: string;
  season?: number;
  episode?: number;
  status: 'idle' | 'waiting' | 'searching' | 'ready' | 'empty' | 'failed' | 'disabled';
  /** Sources known so far. */
  count: number;
  /** True when the count came from cache rather than from this run. */
  fromCache: boolean;
  /** Providers that have answered, out of how many are being asked. */
  settled?: number;
  total?: number;
  reason?: string;
}

export class SourcePrefetcher {
  private content: ContentService;
  private datastore: DatastoreManager;
  private notify: (state: PrefetchState) => void = () => {};

  private timer: NodeJS.Timeout | null = null;
  private controller: AbortController | null = null;
  /** The target of the pending or running prefetch, for supersede checks. */
  private current: { key: string; request: SourceQuery } | null = null;

  constructor(content: ContentService, datastore: DatastoreManager) {
    this.content = content;
    this.datastore = datastore;
  }

  public setNotifier(notify: (state: PrefetchState) => void): void {
    this.notify = notify;
  }

  public isEnabled(): boolean {
    return this.datastore.getBool(SETTING_KEY, true);
  }

  public setEnabled(enabled: boolean): boolean {
    this.datastore.setBool(SETTING_KEY, enabled);
    if (!enabled) this.cancel();
    return enabled;
  }

  private static keyOf(request: SourceQuery): string {
    return `${request.mediaUrl}|${request.season ?? ''}|${request.episode ?? ''}`;
  }

  private emit(request: SourceQuery, patch: Omit<PrefetchState, 'mediaUrl' | 'season' | 'episode'>): void {
    this.notify({
      mediaUrl: request.mediaUrl,
      season: request.season,
      episode: request.episode,
      ...patch,
    });
  }

  /**
   * Queues a prefetch for what the viewer would play from this page.
   *
   * Calling it again with a different target replaces the previous one; calling
   * it with the same target while that one is already running is a no-op, so a
   * re-render cannot restart the work.
   */
  public schedule(request: SourceQuery): void {
    if (!this.isEnabled()) {
      this.emit(request, {
        status: 'disabled',
        count: 0,
        fromCache: false,
        reason: 'Background source loading is switched off in Settings.',
      });
      return;
    }

    const key = SourcePrefetcher.keyOf(request);
    if (this.current?.key === key && (this.timer || this.controller)) return;

    this.cancel();
    this.current = { key, request };

    // Already known, so there is nothing to fetch and the viewer should be told
    // Play will be instant.
    if (this.content.hasFreshSources(request)) {
      this.emit(request, { status: 'ready', count: 0, fromCache: true });
      this.current = null;
      return;
    }

    this.emit(request, { status: 'waiting', count: 0, fromCache: false });

    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run(request, key);
    }, SETTLE_MS);
    this.timer.unref?.();
  }

  private async run(request: SourceQuery, key: string): Promise<void> {
    const controller = new AbortController();
    this.controller = controller;

    this.emit(request, { status: 'searching', count: 0, fromCache: false });

    try {
      const response = await this.content.getSources(
        request,
        (progress) => {
          if (controller.signal.aborted) return;
          this.emit(request, {
            status: 'searching',
            count: progress.results.length,
            fromCache: false,
            settled: progress.settled,
            total: progress.totalRelevant,
          });
        },
        { signal: controller.signal }
      );

      // Superseded or abandoned while it ran. The work is not wasted — whatever
      // it found is in the cache — but this snapshot describes a page the
      // viewer has left.
      if (controller.signal.aborted || this.current?.key !== key) return;

      this.emit(request, {
        status: response.sources.length > 0 ? 'ready' : 'empty',
        count: response.sources.length,
        fromCache: false,
        reason: response.sources.length === 0 ? response.emptyReason : undefined,
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      // A failed prefetch is not a failure the viewer needs to act on: pressing
      // Play will try again and report properly if it fails then. It is
      // recorded so the state is not left claiming to be searching.
      this.emit(request, {
        status: 'failed',
        count: 0,
        fromCache: false,
        reason: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (this.controller === controller) this.controller = null;
      if (this.current?.key === key) this.current = null;
    }
  }

  /**
   * Abandons any pending or running prefetch.
   *
   * The abort reaches `ContentService`, which only cancels the underlying run
   * if no one else has joined it — so leaving a detail page mid-prefetch does
   * not pull the rug from under a player that started a moment earlier.
   */
  public cancel(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.controller?.abort();
    this.controller = null;
    this.current = null;
  }
}
