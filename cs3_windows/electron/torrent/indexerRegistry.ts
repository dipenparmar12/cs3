import type {
  IndexerConfig,
  IndexerHealth,
  IndexerQuery,
  SourcePreferences,
  TorrentResult,
} from '../../src/types/torrent';
import { DEFAULT_SOURCE_PREFERENCES, IndexerKind } from '../../src/types/torrent';
import { TvType } from '../../src/types/api';
import { finaliseResult, type TorrentIndexer } from './indexers/base';
import {
  AniDexIndexer,
  AnimeToshoIndexer,
  EztvIndexer,
  LimeTorrentsIndexer,
  NyaaIndexer,
  SubsPleaseIndexer,
  TokyoToshoIndexer,
  YtsIndexer,
} from './indexers/builtins';
import {
  ApiBayIndexer,
  CometIndexer,
  KnabenIndexer,
  KnightCrawlerIndexer,
  MediaFusionIndexer,
  SolidTorrentsIndexer,
  StremioAddonIndexer,
  TorrentioIndexer,
  TorrentsCsvIndexer,
} from './indexers/aggregators';
import { BitSearchIndexer, TheRarbgIndexer, X1337Indexer } from './indexers/scrapers';
import { TorznabIndexer } from './indexers/torznab';
import { dedupeByInfoHash, rankResults, type RankContext } from './ranker';
import type { DatastoreManager } from '../datastore';
import { describeError } from '../../src/utils/errors.ts';
import {
  EMPTY_OBSERVATION,
  TIMEOUT_CEILING_MS,
  describeSkip,
  isSkipped,
  observe,
  searchOrder,
  timeoutFor,
  type IndexerObservation,
} from './indexerBudget.ts';

/**
 * Aggregates searches across every configured indexer.
 *
 * Design constraints that drove this:
 *  - **Isolation.** One slow or broken indexer must never delay or fail an
 *    aggregate search. Each runs under its own timeout and its rejection is
 *    caught locally.
 *  - **Circuit breaking.** Repeatedly failing indexers are skipped for a cooldown
 *    instead of costing a timeout on every search.
 *  - **Honest reporting.** Failures surface through `getHealth()`; the UI can
 *    tell the user *which* indexer is down rather than silently showing zero
 *    results, which is indistinguishable from "nothing matched".
 */

/**
 * How long an aggregate search waits for the stragglers once it has answers.
 *
 * Not a timeout — every indexer still runs to its own deadline and its results
 * are still collected. This bounds the *wait*: once every fast indexer has
 * answered, there is no reason a viewer sits in front of a spinner for the one
 * scraper that is going to spend its whole budget and throw. Measured against
 * the reported case: Torrentio answers in about 400 ms and Cinevood takes the
 * full twenty seconds to fail.
 *
 * Generous enough that a merely slow indexer still contributes, and the caller
 * gets partial results streamed through `onProgress` throughout either way.
 */
const STRAGGLER_GRACE_MS = 6_000;

/** Nothing is abandoned before this, however fast the first answers arrive. */
const MIN_SEARCH_MS = 2_500;

const SETTINGS_KEY_INDEXERS = 'torrent_indexer_configs';
const SETTINGS_KEY_INDEXER_VERSION = 'torrent_indexer_configs_version';
const SETTINGS_KEY_PREFERENCES = 'torrent_source_preferences';

const ANIME_TYPES = [TvType.Anime, TvType.AnimeMovie, TvType.OVA];

/**
 * Defaults are ordered by how reliably they work in practice.
 *
 * Enabled by default are high-availability aggregators and multi-mirror scrapers:
 *  - Torrentio, KnightCrawler, Comet aggregate dozens of trackers server-side
 *    keyed by IMDb id with direct file stream pointers.
 *  - SolidTorrents, Knaben, apibay, LimeTorrents, Torrents-CSV take free text
 *    and provide fast keyword coverage.
 *  - YTS and EZTV cover Movies and TV with exact IMDb id and text matching.
 *  - AnimeTosho, Nyaa, and SubsPlease provide comprehensive anime coverage.
 */
export const DEFAULT_INDEXER_CONFIGS: IndexerConfig[] = [
  { id: 'torrentio', name: 'Torrentio', kind: IndexerKind.Builtin, enabled: true },
  { id: 'knightcrawler', name: 'KnightCrawler', kind: IndexerKind.Builtin, enabled: true },
  { id: 'comet', name: 'Comet', kind: IndexerKind.Builtin, enabled: true },
  { id: 'solidtorrents', name: 'SolidTorrents', kind: IndexerKind.Builtin, enabled: true },
  { id: 'knaben', name: 'Knaben', kind: IndexerKind.Builtin, enabled: true },
  { id: 'apibay', name: 'The Pirate Bay', kind: IndexerKind.Builtin, enabled: true },
  { id: 'torrentscsv', name: 'Torrents-CSV', kind: IndexerKind.Builtin, enabled: true },
  {
    id: 'yts',
    name: 'YTS',
    kind: IndexerKind.Builtin,
    enabled: true,
    supportedTypes: [TvType.Movie],
  },
  {
    id: 'eztv',
    name: 'EZTV',
    kind: IndexerKind.Builtin,
    enabled: true,
    supportedTypes: [TvType.TvSeries],
  },
  {
    id: 'animetosho',
    name: 'AnimeTosho',
    kind: IndexerKind.Builtin,
    enabled: true,
    supportedTypes: ANIME_TYPES,
  },
  {
    id: 'nyaa',
    name: 'Nyaa',
    kind: IndexerKind.Builtin,
    enabled: true,
    supportedTypes: ANIME_TYPES,
  },
  {
    id: 'subsplease',
    name: 'SubsPlease',
    kind: IndexerKind.Builtin,
    enabled: true,
    supportedTypes: ANIME_TYPES,
  },
  { id: 'limetorrents', name: 'LimeTorrents', kind: IndexerKind.Builtin, enabled: true },
  { id: '1337x', name: '1337x', kind: IndexerKind.Builtin, enabled: true },
  { id: 'bitsearch', name: 'BitSearch', kind: IndexerKind.Builtin, enabled: true },
  { id: 'therarbg', name: 'TheRARBG', kind: IndexerKind.Builtin, enabled: true },
  { id: 'mediafusion', name: 'MediaFusion', kind: IndexerKind.Builtin, enabled: false },
  /**
   * Anime, beyond the one source that currently carries it.
   *
   * Nyaa is the only broad anime index enabled here, and AnimeTosho aggregates
   * Nyaa — so a Nyaa outage or a challenge takes both, and the anime lane has a
   * single point of failure with a spare that shares it. TokyoTosho is an
   * independent index; AniDex carries the raws and non-English releases that
   * Nyaa's `c=1_2` category filter removes before a query is even typed.
   *
   * Off by default, like every site-specific indexer here, and for the reason
   * stated at the top of `scrapers.ts`: defaults should serve the user behind a
   * block, who gets nothing from these but timeouts.
   */
  {
    id: 'tokyotosho',
    name: 'TokyoTosho',
    kind: IndexerKind.Builtin,
    enabled: false,
    supportedTypes: ANIME_TYPES,
  },
  {
    id: 'anidex',
    name: 'AniDex',
    kind: IndexerKind.Builtin,
    enabled: false,
    supportedTypes: ANIME_TYPES,
  },
];

/** Schema version for the stored indexer list, so defaults can be re-seeded. */
const INDEXER_CONFIG_VERSION = 5;

/**
 * What is remembered about one indexer between searches.
 *
 * The measurements live in `observation` and the decisions made from them live
 * in `indexerBudget.ts`; everything else here is display copy for the health
 * panel. Splitting it that way is what let the deadline and the cooldown ladder
 * be tested without a network, a datastore or a clock.
 */
interface CircuitState {
  observation: IndexerObservation;
  lastError?: string;
  lastLatencyMs?: number;
  lastResultCount?: number;
}

export interface AggregateSearchResult {
  results: TorrentResult[];
  rejected: Array<{ result: TorrentResult; reason: string }>;
  /** Per-indexer outcome for this specific search, for UI feedback. */
  indexerOutcomes: Array<{
    id: string;
    name: string;
    ok: boolean;
    count: number;
    latencyMs: number;
    error?: string;
    skipped?: string;
  }>;
}

/**
 * Progress of an in-flight aggregate search.
 *
 * Emitted as each indexer settles so a caller can act on partial results. The
 * point is that waiting for the slowest indexer is not the same as waiting for
 * a usable answer: Torrentio typically answers in under a second while a
 * blocked scraper burns its full 20s timeout, and there is no reason a viewer
 * should wait for the latter to start watching.
 */
export interface SearchProgress {
  /** Best-ranked results from the indexers that have answered so far. */
  results: TorrentResult[];
  /** Indexers that have settled, out of `totalRelevant`. */
  settled: number;
  totalRelevant: number;
  /** Name of the indexer that just settled, for a "searched X" readout. */
  lastIndexerName: string;
  done: boolean;
  /**
   * True once an empty scoped answer escalated itself to every provider.
   *
   * Carried on progress rather than only on the result because the whole point
   * is to explain a wait that is *still happening* — by the time the response
   * lands there is nothing left to explain. See
   * `ContentService.escalateToAllSources`.
   */
  widened?: boolean;
}

export class IndexerRegistry {
  private configs: IndexerConfig[] = [];
  private circuits = new Map<string, CircuitState>();
  private datastore: DatastoreManager;

  constructor(datastore: DatastoreManager) {
    this.datastore = datastore;

    const storedVersion = this.datastore.getInt(SETTINGS_KEY_INDEXER_VERSION, 0);
    const stored = this.datastore.getObject<IndexerConfig[]>(SETTINGS_KEY_INDEXERS, null);

    if (storedVersion < INDEXER_CONFIG_VERSION || !Array.isArray(stored) || stored.length === 0) {
      // Re-seed on upgrade so existing installs pick up newly added indexers.
      const previous = Array.isArray(stored) ? stored : [];

      // Everything the user added themselves is theirs; only built-ins are reset.
      const userAdded = previous.filter(
        (c) => c.kind === IndexerKind.Torznab || c.kind === IndexerKind.Stremio
      );

      // A built-in the user had already turned on or off keeps that choice —
      // re-seeding should add the new indexers, not undo the user's settings.
      const priorState = new Map(previous.map((c) => [c.id, c.enabled]));
      const builtins = DEFAULT_INDEXER_CONFIGS.map((config) => ({
        ...config,
        enabled: priorState.get(config.id) ?? config.enabled,
      }));

      this.configs = [...builtins, ...userAdded];
      this.datastore.setObject(SETTINGS_KEY_INDEXERS, this.configs);
      this.datastore.setInt(SETTINGS_KEY_INDEXER_VERSION, INDEXER_CONFIG_VERSION);
    } else {
      this.configs = stored;
    }
  }

  // --- configuration -------------------------------------------------------

  public getConfigs(): IndexerConfig[] {
    return [...this.configs];
  }

  public saveConfigs(configs: IndexerConfig[]): void {
    this.configs = configs;
    this.datastore.setObject(SETTINGS_KEY_INDEXERS, configs);
    // A reconfigured indexer deserves a clean slate rather than inheriting an
    // open circuit from its previous, possibly misconfigured, incarnation.
    for (const config of configs) this.circuits.delete(config.id);
  }

  public upsertConfig(config: IndexerConfig): void {
    const next = this.configs.filter((c) => c.id !== config.id);
    next.push(config);
    this.saveConfigs(next);
  }

  public removeConfig(id: string): void {
    this.saveConfigs(this.configs.filter((c) => c.id !== id));
  }

  public getPreferences(): SourcePreferences {
    const stored = this.datastore.getObject<Partial<SourcePreferences>>(
      SETTINGS_KEY_PREFERENCES,
      {}
    );
    return { ...DEFAULT_SOURCE_PREFERENCES, ...(stored ?? {}) };
  }

  public savePreferences(preferences: Partial<SourcePreferences>): SourcePreferences {
    const merged = { ...this.getPreferences(), ...preferences };
    this.datastore.setObject(SETTINGS_KEY_PREFERENCES, merged);
    return merged;
  }

  // --- adapter construction ------------------------------------------------

  private buildAdapter(config: IndexerConfig): TorrentIndexer | null {
    if (config.kind === IndexerKind.Torznab) return new TorznabIndexer(config);
    if (config.kind === IndexerKind.Stremio) return StremioAddonIndexer.fromConfig(config);

    switch (config.id) {
      case 'torrentio':
        return new TorrentioIndexer();
      case 'knightcrawler':
        return new KnightCrawlerIndexer();
      case 'comet':
        return new CometIndexer();
      case 'mediafusion':
        return new MediaFusionIndexer();
      case 'solidtorrents':
        return new SolidTorrentsIndexer();
      case 'knaben':
        return new KnabenIndexer();
      case 'apibay':
        return new ApiBayIndexer();
      case 'torrentscsv':
        return new TorrentsCsvIndexer();
      case 'animetosho':
        return new AnimeToshoIndexer();
      case 'subsplease':
        return new SubsPleaseIndexer();
      case 'limetorrents':
        return new LimeTorrentsIndexer();
      case '1337x':
      case 'x1337':
        return new X1337Indexer();
      case 'bitsearch':
        return new BitSearchIndexer();
      case 'therarbg':
        return new TheRarbgIndexer();
      case 'yts':
        return new YtsIndexer();
      case 'eztv':
        return new EztvIndexer();
      case 'nyaa':
        return new NyaaIndexer();
      case 'tokyotosho':
        return new TokyoToshoIndexer();
      case 'anidex':
        return new AniDexIndexer();
      default:
        return null;
    }
  }

  public async testIndexer(config: IndexerConfig): Promise<{ ok: boolean; message: string }> {
    const adapter = this.buildAdapter(config);
    if (!adapter) return { ok: false, message: `Unknown indexer "${config.id}"` };

    if (adapter instanceof TorznabIndexer) return adapter.testConnection();

    // Built-ins have no capabilities endpoint; a cheap real search is the probe.
    // Stremio addons only answer to an IMDb id, so probe them with a well-known
    // one — a free-text probe would fail for reasons unrelated to the addon.
    const probe: IndexerQuery =
      adapter instanceof StremioAddonIndexer
        ? { query: 'The Shawshank Redemption', imdbId: 'tt0111161', limit: 5 }
        : { query: 'the', limit: 5 };

    const started = Date.now();
    try {
      // The full ceiling, deliberately, and not the measured budget: someone
      // pressing "test" is asking whether this indexer works at all, and
      // answering "no" because it exceeded a deadline derived from its own
      // good days would be the least useful possible reply.
      const results = await adapter.search(probe, AbortSignal.timeout(TIMEOUT_CEILING_MS));
      return {
        ok: true,
        message: `OK — ${results.length} results in ${Date.now() - started} ms`,
      };
    } catch (error) {
      return { ok: false, message: describeError(error) };
    }
  }

  // --- circuit breaker -----------------------------------------------------

  private circuitFor(id: string): CircuitState {
    let state = this.circuits.get(id);
    if (!state) {
      state = { observation: EMPTY_OBSERVATION };
      this.circuits.set(id, state);
    }
    return state;
  }

  private isCircuitOpen(id: string): boolean {
    return isSkipped(this.circuitFor(id).observation);
  }

  /** The observations, in the shape `searchOrder` and `timeoutFor` want. */
  private observations(): Map<string, IndexerObservation> {
    const out = new Map<string, IndexerObservation>();
    for (const [id, state] of this.circuits) out.set(id, state.observation);
    return out;
  }

  private recordSuccess(id: string, latencyMs: number, count: number): void {
    const state = this.circuitFor(id);
    state.observation = observe(state.observation, 'ok', latencyMs);
    state.lastError = undefined;
    state.lastLatencyMs = latencyMs;
    state.lastResultCount = count;
  }

  /**
   * A failure, classified by what it cost.
   *
   * `timeout` and `error` are counted separately because they are not
   * comparable evidence: an indexer that answers 404 has told us something in
   * one round trip, and one that times out has spent the viewer's entire search
   * telling us nothing. See `indexerBudget.ts` for what the distinction buys.
   *
   * Our own deadline and the remote's own slowness both arrive as
   * `TimeoutError` from `AbortSignal.timeout`; the repo-wide rule that a
   * cancellation is not a failure still holds, and a caller abandoning the
   * search produces `AbortError`, which is not recorded here at all.
   */
  private recordFailure(id: string, error: unknown, latencyMs: number): void {
    const state = this.circuitFor(id);
    const name = error instanceof Error ? error.name : '';
    if (name === 'AbortError') return;

    state.observation = observe(
      state.observation,
      name === 'TimeoutError' ? 'timeout' : 'error',
      latencyMs
    );
    state.lastError = describeError(error);
    state.lastLatencyMs = latencyMs;
  }

  /**
   * One reachable URL per configured indexer, for the connection test.
   *
   * The test used to probe five hardcoded hosts, which meant it answered a
   * question nobody asked: whether *those* five were reachable, rather than
   * whether the indexers this user actually has enabled are. Someone running
   * Jackett behind a blocked ISP resolver got a clean bill of health from five
   * sites they do not use.
   *
   * Built-in adapters keep their mirror lists private, so one representative
   * host each is named here. Kept beside the id list it mirrors, and a missing
   * entry simply means that indexer is not probed rather than a crash.
   */
  public probeTargets(): Array<{ id: string; name: string; url: string; enabled: boolean }> {
    const BUILTIN_HOSTS: Record<string, string> = {
      torrentio: 'https://torrentio.strem.fun/manifest.json',
      knightcrawler: 'https://knightcrawler.elfhosted.com/manifest.json',
      comet: 'https://comet.elfhosted.com/manifest.json',
      mediafusion: 'https://mediafusion.elfhosted.com/manifest.json',
      solidtorrents: 'https://solidtorrents.to/',
      knaben: 'https://knaben.eu/',
      apibay: 'https://apibay.org/precompiled/data_top100_recent.json',
      torrentscsv: 'https://torrents-csv.com/service/search?q=test',
      animetosho: 'https://feed.animetosho.org/',
      subsplease: 'https://subsplease.org/',
      limetorrents: 'https://www.limetorrents.lol/',
      yts: 'https://yts.mx/',
      eztv: 'https://eztvx.to/',
      nyaa: 'https://nyaa.si/',
      tokyotosho: 'https://www.tokyotosho.info/',
      anidex: 'https://anidex.info/',
      '1337x': 'https://1337x.to/',
      x1337: 'https://1337x.to/',
      bitsearch: 'https://bitsearch.to/',
      therarbg: 'https://therarbg.com/',
    };

    const out: Array<{ id: string; name: string; url: string; enabled: boolean }> = [];
    for (const config of this.configs) {
      // A user-configured endpoint is the only URL worth probing for these —
      // the whole point of a Torznab or Stremio entry is that it is theirs.
      const url =
        config.kind === IndexerKind.Torznab || config.kind === IndexerKind.Stremio
          ? config.baseUrl
          : BUILTIN_HOSTS[config.id];
      if (!url) continue;
      out.push({ id: config.id, name: config.name, url, enabled: config.enabled });
    }
    return out;
  }

  public getHealth(): IndexerHealth[] {
    return this.configs.map((config) => {
      const state = this.circuitFor(config.id);
      return {
        id: config.id,
        name: config.name,
        enabled: config.enabled,
        lastOk: state.observation.lastOk,
        lastError: state.lastError,
        lastLatencyMs: state.lastLatencyMs,
        lastResultCount: state.lastResultCount,
        consecutiveFailures: state.observation.consecutiveFailures,
        isCircuitOpen: this.isCircuitOpen(config.id),
        // How long it stays skipped, which the old flat five minutes made not
        // worth saying. "Back in two hours" and "back in five minutes" are
        // different answers to "why did this search find less than usual".
        pausedFor: describeSkip(state.observation) || undefined,
        budgetMs: timeoutFor(state.observation),
      };
    });
  }

  // --- search --------------------------------------------------------------

  /**
   * Skips indexers that cannot serve this query at all. Running an anime-only
   * indexer for a movie query wastes a request and pollutes the result set.
   */
  private isRelevant(config: IndexerConfig, query: IndexerQuery): boolean {
    if (!query.type) return true;
    if (config.kind === IndexerKind.Torznab) return true;
    if (!config.supportedTypes || config.supportedTypes.length === 0) return true;
    return config.supportedTypes.includes(query.type);
  }

  public async search(
    query: IndexerQuery,
    rankContext?: Omit<RankContext, 'preferences'> & { preferences?: SourcePreferences },
    /**
     * Called each time an indexer settles, with the best results known so far.
     * Optional: the batch callers (source picker, downloads) ignore it, while
     * the playback session uses it to offer "play now" before every indexer has
     * answered.
     */
    onProgress?: (progress: SearchProgress) => void,
    /**
     * Narrows the search to the indexers the user has scoped it to. Applied on
     * top of `enabled`, never instead of it, and reported as a skip reason so
     * "0 sources" never looks like an outage when it was a filter.
     */
    inScope?: (indexerId: string) => boolean
  ): Promise<AggregateSearchResult> {
    const preferences = rankContext?.preferences ?? this.getPreferences();
    const outcomes: AggregateSearchResult['indexerOutcomes'] = [];

    /** Everything received so far, re-ranked on each arrival for `onProgress`. */
    const collected: TorrentResult[] = [];
    let settled = 0;
    let totalRelevant = 0;

    const rank = (input: TorrentResult[]) =>
      rankResults(dedupeByInfoHash(input), {
        expectedTitle: rankContext?.expectedTitle,
        expectedYear: rankContext?.expectedYear,
        season: rankContext?.season ?? query.season,
        episode: rankContext?.episode ?? query.episode,
        runtimeMinutes: rankContext?.runtimeMinutes,
        preferences,
      });

    /**
     * Reports partial progress. Ranking the whole accumulated set on every
     * arrival is deliberate: appending an already-ranked tail would let a weak
     * early result outrank a strong late one, and the "play now" button acts on
     * whatever is at the top at the moment it is pressed.
     */
    const report = (name: string, isRelevant: boolean) => {
      if (!onProgress) return;
      if (isRelevant) settled += 1;
      onProgress({
        results: rank(collected).accepted,
        settled,
        totalRelevant,
        lastIndexerName: name,
        done: settled >= totalRelevant,
      });
    };

    // Which indexers will actually be queried is decided synchronously, before
    // any of them start, because `totalRelevant` is the denominator the UI
    // shows ("searched 3 of 5") and it must not climb as tasks resolve.
    // `id` is lifted out of `config` so `searchOrder` can rank these without
    // knowing what an indexer config is.
    const runnable: Array<{ id: string; config: IndexerConfig; adapter: TorrentIndexer }> = [];

    for (const config of this.configs) {
      if (!config.enabled) {
        outcomes.push({ id: config.id, name: config.name, ok: false, count: 0, latencyMs: 0, skipped: 'Disabled' });
        continue;
      }
      if (inScope && !inScope(config.id)) {
        outcomes.push({
          id: config.id,
          name: config.name,
          ok: true,
          count: 0,
          latencyMs: 0,
          skipped: 'Not in the current search scope',
        });
        continue;
      }
      if (this.isCircuitOpen(config.id)) {
        outcomes.push({
          id: config.id,
          name: config.name,
          ok: false,
          count: 0,
          latencyMs: 0,
          // Names the cause and the wait. "Temporarily disabled after repeated
          // failures" was true of a site down for a minute and of one that has
          // been refusing us for a fortnight.
          skipped:
            describeSkip(this.circuitFor(config.id).observation) ||
            'Temporarily disabled after repeated failures',
        });
        continue;
      }
      if (!this.isRelevant(config, query)) {
        outcomes.push({ id: config.id, name: config.name, ok: true, count: 0, latencyMs: 0, skipped: 'Not applicable to this content type' });
        continue;
      }

      const adapter = this.buildAdapter(config);
      if (!adapter || !adapter.canHandle(query)) {
        outcomes.push({
          id: config.id,
          name: config.name,
          ok: true,
          count: 0,
          latencyMs: 0,
          skipped: adapter ? 'Cannot serve this query (missing IMDb id or unsupported)' : 'No adapter',
        });
        continue;
      }

      runnable.push({ id: config.id, config, adapter });
    }

    totalRelevant = runnable.length;
    // A search with nothing to run still owes the caller one terminal event,
    // otherwise a session waiting on `done` never resolves.
    if (totalRelevant === 0) report('', false);

    /**
     * Fastest first.
     *
     * The fan-out is parallel, so this changes nothing about when any single
     * indexer starts. What it changes is which of them have answered by the
     * time the straggler grace below starts counting — the point is to make
     * "the useful answers are in" a moment that arrives early.
     */
    const ordered = searchOrder(runnable, this.observations());

    const tasks = ordered.map(async ({ config, adapter }) => {
      const started = Date.now();
      try {
        /**
         * Its own deadline, from its own measured latency.
         *
         * Every indexer used to get twenty seconds, so every search cost what
         * its worst member cost. An indexer that has answered its last ten
         * searches in under a second has told us what it needs; one that has
         * never answered still gets the full twenty, because judging a source
         * before it has had a chance is how a slow-but-working one gets
         * designated dead.
         */
        const budget = timeoutFor(this.circuitFor(config.id).observation, TIMEOUT_CEILING_MS);
        const raw = await adapter.search(query, AbortSignal.timeout(budget));
        const latency = Date.now() - started;

        const normalised = raw
          .map((item) => finaliseResult(item, config))
          .filter((r): r is TorrentResult => r !== null);

        this.recordSuccess(config.id, latency, normalised.length);
        outcomes.push({
          id: config.id,
          name: config.name,
          ok: true,
          count: normalised.length,
          latencyMs: latency,
        });
        collected.push(...normalised);
        report(config.name, true);
        return normalised;
      } catch (error) {
        const latency = Date.now() - started;
        this.recordFailure(config.id, error, latency);
        outcomes.push({
          id: config.id,
          name: config.name,
          ok: false,
          count: 0,
          latencyMs: latency,
          error: describeError(error),
        });
        report(config.name, true);
        return [] as TorrentResult[];
      }
    });

    /**
     * Waits for everyone, but not indefinitely for the last one.
     *
     * `allSettled` is deliberate — a rejected task must not collapse the
     * search — but on its own it makes the aggregate cost exactly what its
     * slowest member costs, which is the complaint this whole pass is about.
     * So the wait ends when either every indexer has settled *or* the
     * stragglers have had `STRAGGLER_GRACE_MS` past the point where the rest
     * finished, whichever comes first.
     *
     * Nothing is cancelled and nothing is lost: an indexer still running keeps
     * running to its own deadline, still records its outcome, and still reaches
     * the caller through `onProgress`. This bounds the *wait*, not the work —
     * which is why `MIN_SEARCH_MS` exists too, so a single instant answer from
     * a cache cannot cut the others off before they have started.
     */
    const settledAll = Promise.allSettled(tasks);
    const finished = await Promise.race([
      settledAll,
      new Promise<null>((resolve) => {
        const timer = setTimeout(
          () => resolve(null),
          Math.max(MIN_SEARCH_MS, STRAGGLER_GRACE_MS)
        );
        // The app must be able to quit while a dead scraper is still hanging.
        timer.unref?.();
        void settledAll.then(() => {
          clearTimeout(timer);
        });
      }),
    ]);

    const merged = (finished ?? []).flatMap((s) =>
      s.status === 'fulfilled' ? s.value : []
    );

    const { accepted, rejected } = rank(merged);
    return { results: accepted, rejected, indexerOutcomes: outcomes };
  }
}
