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
import { EztvIndexer, NyaaIndexer, YtsIndexer } from './indexers/builtins';
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
const SETTINGS_KEY_PREFERENCES = 'torrent_source_preferences';

export const DEFAULT_INDEXER_CONFIGS: IndexerConfig[] = [
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
    id: 'nyaa',
    name: 'Nyaa',
    kind: IndexerKind.Builtin,
    enabled: true,
    supportedTypes: [TvType.Anime, TvType.AnimeMovie, TvType.OVA],
  },
];

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
    const stored = this.datastore.getObject<IndexerConfig[]>(
      SETTINGS_KEY_INDEXERS,
      DEFAULT_INDEXER_CONFIGS
    );
    this.configs =
      Array.isArray(stored) && stored.length > 0 ? stored : [...DEFAULT_INDEXER_CONFIGS];
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

    switch (config.id) {
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
    const started = Date.now();
    try {
      const results = await adapter.search(
        { query: 'the', limit: 5 },
        AbortSignal.timeout(PER_INDEXER_TIMEOUT_MS)
      );
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
