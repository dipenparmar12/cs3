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
import { AnimeToshoIndexer, EztvIndexer, NyaaIndexer, YtsIndexer } from './indexers/builtins';
import {
  ApiBayIndexer,
  KnabenIndexer,
  MediaFusionIndexer,
  StremioAddonIndexer,
  TorrentioIndexer,
  TorrentsCsvIndexer,
} from './indexers/aggregators';
import { BitSearchIndexer, TheRarbgIndexer, X1337Indexer } from './indexers/scrapers';
import { TorznabIndexer } from './indexers/torznab';
import { dedupeByInfoHash, rankResults, type RankContext } from './ranker';
import type { DatastoreManager } from '../datastore';

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

const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_COOLDOWN_MS = 5 * 60 * 1000;
const PER_INDEXER_TIMEOUT_MS = 20_000;

const SETTINGS_KEY_INDEXERS = 'torrent_indexer_configs';
const SETTINGS_KEY_INDEXER_VERSION = 'torrent_indexer_configs_version';
const SETTINGS_KEY_PREFERENCES = 'torrent_source_preferences';

const ANIME_TYPES = [TvType.Anime, TvType.AnimeMovie, TvType.OVA];

/**
 * Defaults are ordered by how reliably they work in practice.
 *
 * **Enabled by default** are the sources that answer on a single stable host and
 * survive the ISP DNS blocking which takes out per-site indexers:
 *  - Torrentio aggregates dozens of trackers server-side and is keyed by IMDb
 *    id, so it covers anything with catalogue metadata.
 *  - Knaben, apibay and Torrents-CSV take free text, so they cover the titles
 *    for which no IMDb id could be resolved — the case that used to return
 *    nothing at all.
 *  - AnimeTosho covers anime, where absolute episode numbering means the
 *    IMDb-keyed addons frequently miss.
 *
 * **Disabled by default** are the per-site scrapers (YTS, EZTV, Nyaa, 1337x,
 * BitSearch, TheRARBG). Their domains rotate constantly and are blocked on many
 * networks, so leaving them on mostly buys timeouts and empty results. Users on
 * unfiltered connections can enable them in Settings → Sources, and users behind
 * a block are better served by a Torznab (Jackett/Prowlarr) entry.
 */
export const DEFAULT_INDEXER_CONFIGS: IndexerConfig[] = [
  { id: 'torrentio', name: 'Torrentio', kind: IndexerKind.Builtin, enabled: true },
  // Disabled by default: the public MediaFusion instance expects a per-user
  // configured URL (tracker selection, optional debrid), so the bare host is
  // unlikely to answer usefully. Users who have one should paste it as a
  // Stremio addon instead, which is what this entry is a shortcut for.
  { id: 'mediafusion', name: 'MediaFusion', kind: IndexerKind.Builtin, enabled: false },
  { id: 'knaben', name: 'Knaben', kind: IndexerKind.Builtin, enabled: true },
  { id: 'apibay', name: 'The Pirate Bay', kind: IndexerKind.Builtin, enabled: true },
  { id: 'torrentscsv', name: 'Torrents-CSV', kind: IndexerKind.Builtin, enabled: true },
  {
    id: 'animetosho',
    name: 'AnimeTosho',
    kind: IndexerKind.Builtin,
    enabled: true,
    supportedTypes: ANIME_TYPES,
  },
  { id: '1337x', name: '1337x', kind: IndexerKind.Builtin, enabled: false },
  { id: 'bitsearch', name: 'BitSearch', kind: IndexerKind.Builtin, enabled: false },
  { id: 'therarbg', name: 'TheRARBG', kind: IndexerKind.Builtin, enabled: false },
  {
    id: 'yts',
    name: 'YTS',
    kind: IndexerKind.Builtin,
    enabled: false,
    supportedTypes: [TvType.Movie],
  },
  {
    id: 'eztv',
    name: 'EZTV',
    kind: IndexerKind.Builtin,
    enabled: false,
    supportedTypes: [TvType.TvSeries],
  },
  {
    id: 'nyaa',
    name: 'Nyaa',
    kind: IndexerKind.Builtin,
    enabled: false,
    supportedTypes: ANIME_TYPES,
  },
];

/** Schema version for the stored indexer list, so defaults can be re-seeded. */
const INDEXER_CONFIG_VERSION = 3;

interface CircuitState {
  consecutiveFailures: number;
  openedAt?: number;
  lastOk?: number;
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
      case 'mediafusion':
        return new MediaFusionIndexer();
      case 'knaben':
        return new KnabenIndexer();
      case 'apibay':
        return new ApiBayIndexer();
      case 'torrentscsv':
        return new TorrentsCsvIndexer();
      case 'animetosho':
        return new AnimeToshoIndexer();
      case '1337x':
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
      const results = await adapter.search(probe, AbortSignal.timeout(PER_INDEXER_TIMEOUT_MS));
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
      state = { consecutiveFailures: 0 };
      this.circuits.set(id, state);
    }
    return state;
  }

  private isCircuitOpen(id: string): boolean {
    const state = this.circuitFor(id);
    if (state.consecutiveFailures < CIRCUIT_FAILURE_THRESHOLD) return false;
    if (!state.openedAt) return false;

    if (Date.now() - state.openedAt > CIRCUIT_COOLDOWN_MS) {
      // Cooldown elapsed — allow one probe through.
      state.consecutiveFailures = CIRCUIT_FAILURE_THRESHOLD - 1;
      state.openedAt = undefined;
      return false;
    }
    return true;
  }

  private recordSuccess(id: string, latencyMs: number, count: number): void {
    const state = this.circuitFor(id);
    state.consecutiveFailures = 0;
    state.openedAt = undefined;
    state.lastOk = Date.now();
    state.lastError = undefined;
    state.lastLatencyMs = latencyMs;
    state.lastResultCount = count;
  }

  private recordFailure(id: string, error: unknown, latencyMs: number): void {
    const state = this.circuitFor(id);
    state.consecutiveFailures += 1;
    state.lastError = describeError(error);
    state.lastLatencyMs = latencyMs;
    if (state.consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD && !state.openedAt) {
      state.openedAt = Date.now();
    }
  }

  public getHealth(): IndexerHealth[] {
    return this.configs.map((config) => {
      const state = this.circuitFor(config.id);
      return {
        id: config.id,
        name: config.name,
        enabled: config.enabled,
        lastOk: state.lastOk,
        lastError: state.lastError,
        lastLatencyMs: state.lastLatencyMs,
        lastResultCount: state.lastResultCount,
        consecutiveFailures: state.consecutiveFailures,
        isCircuitOpen: this.isCircuitOpen(config.id),
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
    rankContext?: Omit<RankContext, 'preferences'> & { preferences?: SourcePreferences }
  ): Promise<AggregateSearchResult> {
    const preferences = rankContext?.preferences ?? this.getPreferences();
    const outcomes: AggregateSearchResult['indexerOutcomes'] = [];

    const tasks = this.configs.map(async (config) => {
      if (!config.enabled) {
        outcomes.push({ id: config.id, name: config.name, ok: false, count: 0, latencyMs: 0, skipped: 'Disabled' });
        return [] as TorrentResult[];
      }
      if (this.isCircuitOpen(config.id)) {
        outcomes.push({
          id: config.id,
          name: config.name,
          ok: false,
          count: 0,
          latencyMs: 0,
          skipped: 'Temporarily disabled after repeated failures',
        });
        return [] as TorrentResult[];
      }
      if (!this.isRelevant(config, query)) {
        outcomes.push({ id: config.id, name: config.name, ok: true, count: 0, latencyMs: 0, skipped: 'Not applicable to this content type' });
        return [] as TorrentResult[];
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
        return [] as TorrentResult[];
      }

      const started = Date.now();
      try {
        const raw = await adapter.search(query, AbortSignal.timeout(PER_INDEXER_TIMEOUT_MS));
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
        return [] as TorrentResult[];
      }
    });

    // `allSettled` is deliberate: a rejected task must not collapse the search.
    const settled = await Promise.allSettled(tasks);
    const merged = settled.flatMap((s) => (s.status === 'fulfilled' ? s.value : []));

    const deduped = dedupeByInfoHash(merged);
    const { accepted, rejected } = rankResults(deduped, {
      expectedTitle: rankContext?.expectedTitle,
      expectedYear: rankContext?.expectedYear,
      season: rankContext?.season ?? query.season,
      episode: rankContext?.episode ?? query.episode,
      runtimeMinutes: rankContext?.runtimeMinutes,
      preferences,
    });

    return { results: accepted, rejected, indexerOutcomes: outcomes };
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    // AbortSignal.timeout surfaces as TimeoutError; say so in plain language.
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      return 'Timed out';
    }
    // Node DNS/connection failures carry a `cause` with the useful detail.
    const cause = (error as { cause?: { code?: string } }).cause;
    if (cause?.code === 'ENOTFOUND') return 'Host not found (DNS blocked or domain moved)';
    if (cause?.code === 'ECONNREFUSED') return 'Connection refused';
    if (cause?.code === 'ETIMEDOUT') return 'Connection timed out';
    if (cause?.code) return `${error.message} (${cause.code})`;
    return error.message;
  }
  return String(error);
}
