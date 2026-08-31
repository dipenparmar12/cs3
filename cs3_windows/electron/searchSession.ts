import { TvType, type SearchOptions, type SearchResponse } from '../src/types/api';
import type { CinemetaProvider } from './cinemeta';
import type { MetadataProvider } from './metadataProvider';
import type { PluginManager } from './pluginManager';
import type { IndexerRegistry } from './torrent/indexerRegistry';
import { mergeSearchResults, restrictToExact } from './searchMerge';
import {
  GLOBAL_SCOPE_REPORT,
  SearchScopeStore,
  type ScopeResolution,
  type SearchScopeReport,
} from './searchScope';

/**
 * One "the user pressed search" interaction, from first keystroke to done.
 *
 * Push-shaped, like `playback:*` and for the same reason: the interesting part
 * of a search is what happens *during* it. A search across fifteen extension
 * providers is fifteen independent scrapes of third-party sites, and the slowest
 * routinely takes half a minute — so a request/response search spends that whole
 * time showing a spinner over results it already has. Here the session returns a
 * snapshot immediately and emits a new one every time a source answers, which
 * makes the wait navigable rather than merely long.
 *
 * Three consequences worth stating, because they are the point:
 *
 *  - **Results appear as they land.** The first provider to answer is on screen
 *    in a second or two, and the user can open it while the rest are still
 *    running.
 *  - **A source that fails is named.** Per-source outcomes mean "0 results"
 *    never has to stand in for "every provider timed out".
 *  - **The search can be abandoned.** Once the viewer has found what they came
 *    for, the remaining scrapes are pure waste; cancelling stops dispatching and
 *    drops replies already in flight.
 */

/** How the source that produced a row reaches content. */
export type SearchSourceKind = 'provider' | 'catalogue' | 'indexer';

export interface SearchSourceOutcome {
  /** Provider name, indexer id, or catalogue id — the source's stable identity. */
  id: string;
  name: string;
  kind: SearchSourceKind;
  state: 'pending' | 'ok' | 'failed';
  /** Rows this source contributed, before merging. */
  count: number;
  latencyMs?: number;
  error?: string;
}

export interface SearchSnapshot {
  id: string;
  query: string;
  /** Merged and deduplicated, and re-merged on every arrival. See `snapshot()`. */
  results: SearchResponse[];
  /** Sources that have answered, out of `total`. */
  settled: number;
  total: number;
  /** The source that most recently answered, for the progress line. */
  lastSource?: string;
  outcomes: SearchSourceOutcome[];
  scope: SearchScopeReport;
  done: boolean;
  cancelled: boolean;
  /** Present once done with nothing to show; explains why. */
  emptyReason?: string;
}

interface SessionDependencies {
  plugins: PluginManager;
  registry: IndexerRegistry;
  cinemeta: CinemetaProvider;
  metadata: MetadataProvider;
  scope: SearchScopeStore;
  /** Called with every snapshot, including the terminal one. */
  notify: (snapshot: SearchSnapshot) => void;
  /** Lets the content service keep its `cs3ext://` alternate-route memory warm. */
  onResults: (results: SearchResponse[]) => void;
}

/** Free-text title search against indexers caps out well below source discovery. */
const INDEXER_TITLE_LIMIT = 40;

/** Finished sessions kept around so a late `cancel` is a no-op, not an error. */
const RETAINED_SESSIONS = 8;

export class SearchSession {
  public readonly id: string;
  public readonly query: string;

  private deps: SessionDependencies;
  private options: SearchOptions;
  private controller = new AbortController();

  private outcomes = new Map<string, SearchSourceOutcome>();
  /** Every row every source produced, merged fresh on each snapshot. */
  private collected: SearchResponse[] = [];
  private lastSource: string | undefined;
  private scopeReport: SearchScopeReport = GLOBAL_SCOPE_REPORT;
  private finished = false;
  private cancelled = false;
  private emptyReason: string | undefined;

  constructor(id: string, query: string, options: SearchOptions, deps: SessionDependencies) {
    this.id = id;
    this.query = query;
    this.options = options;
    this.deps = deps;
  }

  // --- lifecycle -----------------------------------------------------------

  /**
   * Starts every source, and returns the opening snapshot without waiting.
   *
   * The renderer draws from this return value, so it has to describe a search
   * that has not produced anything yet: zero results, the full source list, and
   * the scope it is running under.
   */
  public begin(): SearchSnapshot {
    void this.run();
    return this.snapshot();
  }

  public cancel(): SearchSnapshot {
    if (!this.finished) {
      this.cancelled = true;
      this.finished = true;
      this.controller.abort();
      // Sources still in flight stay `pending`: they were neither asked to stop
      // nor given a chance to answer, and calling that a failure would blame the
      // provider for the user's decision.
      this.emit();
    }
    return this.snapshot();
  }

  public get isFinished(): boolean {
    return this.finished;
  }

  // --- execution -----------------------------------------------------------

  private async run(): Promise<void> {
    try {
      // Nothing to ask. Providers answer an empty query with either everything
      // or an error, and neither is what an empty search box meant.
      if (!this.query) return;

      // A pasted magnet is directly playable — surface it as its own result
      // rather than sending it to a catalogue search that cannot understand it.
      if (this.query.startsWith('magnet:')) {
        this.record('magnet', 'Magnet link', 'indexer', magnetRow(this.query));
        return;
      }

      const enabledProviders = await this.deps.plugins.listEnabledProviders();
      const enabledIndexers = this.deps.registry
        .getConfigs()
        .filter((config) => config.enabled)
        .map((config) => config.id);

      /**
       * A per-search override beats the stored scope, and does not replace it.
       *
       * The OTT platform pages bind their search box to the providers behind
       * that platform. That binding belongs to the page — leaving it must not
       * leave the app scoped — so it arrives on the request rather than through
       * `SearchScopeStore.set`.
       */
      const providerScope = this.options.providers
        ? SearchScopeStore.override(enabledProviders, this.options.providers)
        : this.deps.scope.resolveProviders(enabledProviders);
      const indexerScope = this.deps.scope.resolveIndexers(enabledIndexers);
      this.scopeReport = this.deps.scope.report(providerScope, indexerScope);

      const plan = this.plan(providerScope, indexerScope, enabledProviders);
      for (const source of plan.sources) this.outcomes.set(source.id, source);
      this.emit();

      if (this.controller.signal.aborted) return;

      await Promise.all([
        this.runProviders(plan.providers),
        this.runIndexers(plan.indexers),
        this.runCatalogues(plan.catalogues),
      ]);
    } catch (error) {
      // A failure here is the orchestration failing, not a source: it still has
      // to reach the user as a terminal snapshot rather than a silent stall.
      this.emptyReason = error instanceof Error ? error.message : String(error);
    } finally {
      if (!this.cancelled) {
        this.finished = true;
        if (this.snapshotResults().length === 0) {
          this.emptyReason ??= this.explainEmpty();
        }
        this.emit();
      }
    }
  }

  /**
   * Decides which sources this search asks, which is the whole scope contract.
   *
   * Selecting a source is a strict filter, not a preference:
   *
   *  - **Nothing selected** is a global search — every enabled provider, plus
   *    the metadata catalogues that give a title its IMDb id.
   *  - **Providers selected** asks exactly those, and no catalogues. Adding
   *    catalogue rows to a scoped search would put back the very sources the
   *    user just excluded, under a different name.
   *  - **Indexers selected** title-searches those indexers. Indexers normally
   *    answer at source-discovery time rather than here, so without this a scope
   *    of "just this torrent site" had nothing to ask and returned an empty page.
   */
  private plan(
    providerScope: ScopeResolution,
    indexerScope: ScopeResolution,
    enabledProviders: string[]
  ): {
    providers: string[];
    indexers: string[];
    catalogues: boolean;
    sources: SearchSourceOutcome[];
  } {
    const active = providerScope.narrowed || indexerScope.narrowed;

    const providers = providerScope.narrowed
      ? providerScope.allowed
      : active
        ? []
        : enabledProviders;
    const indexers = indexerScope.narrowed ? indexerScope.allowed : [];
    const catalogues = !active;

    const indexerNames = new Map(this.deps.registry.getConfigs().map((c) => [c.id, c.name]));
    const sources: SearchSourceOutcome[] = [
      ...providers.map((name) => pending(name, name, 'provider')),
      ...indexers.map((id) => pending(id, indexerNames.get(id) ?? id, 'indexer')),
      ...(catalogues
        ? [pending('cinemeta', 'Cinemeta', 'catalogue'), pending('metadata', 'TVmaze + AniList', 'catalogue')]
        : []),
    ];

    return { providers, indexers, catalogues, sources };
  }

  private async runProviders(names: string[]): Promise<void> {
    if (names.length === 0) return;
    await this.deps.plugins.searchEach(
      this.query,
      names,
      (outcome) =>
        this.record(outcome.provider, outcome.provider, 'provider', outcome.results, {
          error: outcome.error,
          latencyMs: outcome.latencyMs,
        }),
      this.controller.signal
    );
  }

  /**
   * Title-searches the scoped indexers.
   *
   * Their rows are magnets, which the merger passes through untouched — a
   * release name is not a work title and must never be folded into one.
   */
  private async runIndexers(ids: string[]): Promise<void> {
    if (ids.length === 0) return;

    const wanted = new Set(ids);
    const started = Date.now();
    const outcome = await this.deps.registry.search(
      { query: this.query, limit: INDEXER_TITLE_LIMIT },
      // No `expectedTitle`: the user typed free text rather than picking a known
      // work, and the relevance gate would reject anything spelled differently.
      undefined,
      undefined,
      (id) => wanted.has(id)
    );
    if (this.controller.signal.aborted) return;

    const byIndexer = new Map<string, SearchResponse[]>();
    for (const result of outcome.results) {
      const rows = byIndexer.get(result.indexerId) ?? [];
      rows.push({
        name: result.title,
        url: result.magnet,
        apiName: result.indexerName,
        type: TvType.Torrent,
        year: result.parsed?.year,
        quality: result.parsed?.resolution ? `${result.parsed.resolution}p` : undefined,
      });
      byIndexer.set(result.indexerId, rows);
    }

    const elapsed = Date.now() - started;
    for (const id of ids) {
      const report = outcome.indexerOutcomes.find((entry) => entry.id === id);
      // `skipped` is the interesting case for a title search: the IMDb-keyed
      // aggregators cannot answer free text at all, and reporting that as a
      // clean zero would make an unanswerable question look like a real "no".
      const problem = report?.skipped ?? (report && !report.ok ? report.error : undefined);
      this.record(id, report?.name ?? id, 'indexer', byIndexer.get(id) ?? [], {
        error: problem,
        latencyMs: report?.latencyMs || elapsed,
      });
    }
  }

  /** Cinemeta and the legacy catalogues, each reported as it lands. */
  private async runCatalogues(enabled: boolean): Promise<void> {
    if (!enabled) return;

    await Promise.all([
      this.settle('cinemeta', 'Cinemeta', 'catalogue', () => this.deps.cinemeta.search(this.query)),
      this.settle('metadata', 'TVmaze + AniList', 'catalogue', () =>
        this.deps.metadata.search(this.query)
      ),
    ]);
  }

  private async settle(
    id: string,
    name: string,
    kind: SearchSourceKind,
    run: () => Promise<SearchResponse[]>
  ): Promise<void> {
    const started = Date.now();
    try {
      const results = await run();
      if (this.controller.signal.aborted) return;
      this.record(id, name, kind, results, { latencyMs: Date.now() - started });
    } catch (error) {
      if (this.controller.signal.aborted) return;
      this.record(id, name, kind, [], {
        error: error instanceof Error ? error.message : String(error),
        latencyMs: Date.now() - started,
      });
    }
  }

  // --- snapshots -----------------------------------------------------------

  private record(
    id: string,
    name: string,
    kind: SearchSourceKind,
    results: SearchResponse[],
    extra: { error?: string; latencyMs?: number } = {}
  ): void {
    this.collected.push(...results);
    this.outcomes.set(id, {
      id,
      name,
      kind,
      state: extra.error ? 'failed' : 'ok',
      count: results.length,
      latencyMs: extra.latencyMs,
      error: extra.error,
    });
    this.lastSource = name;
    this.emit();
  }

  /**
   * Merges the whole accumulated set on every arrival rather than appending.
   *
   * Appending would let a late catalogue row sit beside the provider row it is
   * a duplicate of, since the merge that would have joined them already ran.
   * Re-merging is cheap next to a network scrape and keeps the growing list
   * identical to what a batch search would have produced.
   */
  private snapshotResults(): SearchResponse[] {
    const merged = mergeSearchResults(this.collected);
    return this.options.exact ? restrictToExact(merged, this.options.exact) : merged;
  }

  public snapshot(): SearchSnapshot {
    const outcomes = [...this.outcomes.values()];
    return {
      id: this.id,
      query: this.query,
      results: this.snapshotResults(),
      settled: outcomes.filter((outcome) => outcome.state !== 'pending').length,
      total: outcomes.length,
      lastSource: this.lastSource,
      outcomes,
      scope: this.scopeReport,
      done: this.finished,
      cancelled: this.cancelled,
      ...(this.emptyReason ? { emptyReason: this.emptyReason } : {}),
    };
  }

  /**
   * Publishes one snapshot, and hands the merged rows to the content service.
   *
   * The merged set is what carries `alternates` — the other providers that
   * returned the same work — and those are exactly the extra routes source
   * discovery replays later. Handing over the raw per-source rows instead would
   * record nothing, because a row only learns about its siblings in the merge.
   */
  private emit(): void {
    const snapshot = this.snapshot();
    this.deps.onResults(snapshot.results);
    this.deps.notify(snapshot);
  }

  /**
   * Turns "nothing found" into something the user can act on.
   *
   * The distinction that matters most is between a scope that excluded
   * everything and a search that genuinely matched nothing — the first is one
   * click to fix and the second is not, and they look identical on screen.
   */
  private explainEmpty(): string {
    const outcomes = [...this.outcomes.values()];
    const failed = outcomes.filter((outcome) => outcome.state === 'failed');
    const missing = [...this.scopeReport.missingProviders, ...this.scopeReport.missingIndexers];

    if (outcomes.length === 0) {
      return this.scopeReport.active
        ? `The selected source(s) are not installed or are switched off${missing.length > 0 ? `: ${missing.join(', ')}` : ''}. Reset the scope to search everything.`
        : 'No providers, indexers or catalogues are enabled. Install an extension, or enable an indexer in Settings → Sources.';
    }

    if (failed.length === outcomes.length) {
      const reasons = [...new Set(failed.map((outcome) => outcome.error ?? 'unknown error'))];
      return `All ${failed.length} source(s) failed: ${reasons.slice(0, 3).join('; ')}`;
    }

    const wentMissing =
      missing.length > 0 ? ` ${missing.length} selected source(s) are gone: ${missing.join(', ')}.` : '';

    if (this.scopeReport.active) {
      const names = outcomes.map((outcome) => outcome.name);
      return `No results for "${this.query}" in the ${names.length} selected source(s): ${names.slice(0, 6).join(', ')}${names.length > 6 ? '…' : ''}.${wentMissing} Reset the scope to search everything.`;
    }

    return `No results for "${this.query}".`;
  }
}

function pending(id: string, name: string, kind: SearchSourceKind): SearchSourceOutcome {
  return { id, name, kind, state: 'pending', count: 0 };
}

function magnetRow(magnet: string): SearchResponse[] {
  const name = decodeURIComponent(magnet.match(/dn=([^&]+)/)?.[1] ?? 'Magnet link');
  return [{ name, url: magnet, apiName: 'Magnet', type: TvType.Torrent }];
}

/**
 * Owns the live sessions and routes snapshots to the renderer.
 *
 * Only one search is ever current — starting a new one cancels the last, since
 * its results are for a query the user has moved on from and every provider
 * still running is holding a connection open for nothing.
 */
export class SearchSessionManager {
  private sessions = new Map<string, SearchSession>();
  private current: SearchSession | null = null;
  private notifier: ((snapshot: SearchSnapshot) => void) | null = null;
  private nextId = 1;

  private deps: Omit<SessionDependencies, 'notify'>;

  constructor(deps: Omit<SessionDependencies, 'notify'>) {
    this.deps = deps;
  }

  public setNotifier(notifier: (snapshot: SearchSnapshot) => void): void {
    this.notifier = notifier;
  }

  public start(query: string, options: SearchOptions = {}): SearchSnapshot {
    this.current?.cancel();

    const id = `search-${this.nextId++}`;
    const session = new SearchSession(id, query.trim(), options, {
      ...this.deps,
      notify: (snapshot) => this.notifier?.(snapshot),
    });

    this.sessions.set(id, session);
    this.current = session;
    this.sweep();
    return session.begin();
  }

  public cancel(id: string): SearchSnapshot | null {
    const session = this.sessions.get(id);
    if (!session) return null;
    if (this.current === session) this.current = null;
    return session.cancel();
  }

  /** Runs a search to completion, for callers with no use for partial answers. */
  public async runToCompletion(query: string, options: SearchOptions = {}): Promise<SearchSnapshot> {
    return new Promise((resolve) => {
      const id = `batch-${this.nextId++}`;
      const session = new SearchSession(id, query.trim(), options, {
        ...this.deps,
        notify: (snapshot) => {
          if (snapshot.done) resolve(snapshot);
        },
      });
      session.begin();
    });
  }

  private sweep(): void {
    if (this.sessions.size <= RETAINED_SESSIONS) return;
    for (const [id, session] of this.sessions) {
      if (session.isFinished && id !== this.current?.id) this.sessions.delete(id);
    }
  }
}
