import { TvType, type SearchResponse } from '../src/types/api';
import type {
  IndexerQuery,
  SourcePreferences,
  TorrentResult,
} from '../src/types/torrent';
import { MetadataProvider, parseMetadataUrl, type MetadataDetail } from './metadataProvider';
import { CinemetaProvider, parseCinemetaUrl } from './cinemeta';
import {
  IndexerRegistry,
  type AggregateSearchResult,
  type SearchProgress,
} from './torrent/indexerRegistry';
import { TorrentEngine, type StreamHandle } from './torrent/torrentEngine';
import { infoHashFromMagnet } from './torrent/indexers/base';
import { parseReleaseName } from './torrent/releaseParser';
import type { DatastoreManager } from './datastore';
import type { PluginManager } from './pluginManager';

/**
 * Orchestrates the content pipeline: catalogue metadata in, playable stream out.
 *
 *   search ──► MetadataProvider ──► user picks a title/episode
 *                                        │
 *                                        ▼
 *   getSources ──► IndexerRegistry ──► ranked TorrentResult[]
 *                                        │
 *                                        ▼
 *   startStream ──► TorrentEngine ──► http://127.0.0.1:PORT/... ──► <video>
 *
 * Extension-supplied providers (`PluginManager`) are consulted first when any
 * are actually runnable; torrents are the fallback that works today. There is
 * deliberately **no** synthetic fallback source — when nothing real is found the
 * caller gets an empty list and a reason, never a placeholder video.
 */

/** How many ranked sources an automatic start will try before giving up. */
const DEFAULT_FAILOVER_ATTEMPTS = 4;

/** Time each candidate gets to prove its swarm is alive. */
const DEFAULT_SOURCE_BUDGET_MS = 25_000;

/** One rejected candidate, kept so the UI can say what was tried and why it failed. */
export interface StreamAttempt {
  title: string;
  indexerName: string;
  error: string;
}

export interface AutoStreamResult {
  handle: StreamHandle;
  /** The source that actually started, which may not be the top-ranked one. */
  source: TorrentResult;
  attempts: StreamAttempt[];
}

export interface SourceQuery {
  /** A `cs3meta://` URL, a magnet, or a direct http(s) media URL. */
  mediaUrl: string;
  season?: number;
  episode?: number;
  /** Overrides the title derived from metadata. */
  titleOverride?: string;
}

export interface SourceResponse {
  sources: TorrentResult[];
  filtered: Array<{ title: string; reason: string; seeders: number }>;
  indexerOutcomes: AggregateSearchResult['indexerOutcomes'];
  /** Present when zero sources were produced; explains why, for the UI. */
  emptyReason?: string;
  query: { title: string; season?: number; episode?: number; imdbId?: string };
}

/** Extracts `?s=1&e=2` appended to episode URLs by the metadata provider. */
function parseEpisodeParams(url: string): { season?: number; episode?: number } {
  const query = url.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
  if (!query) return {};
  const params = new URLSearchParams(query);
  const s = params.get('s');
  const e = params.get('e');
  return {
    season: s ? parseInt(s, 10) : undefined,
    episode: e ? parseInt(e, 10) : undefined,
  };
}

function stripQuery(url: string): string {
  const index = url.indexOf('?');
  return index >= 0 ? url.slice(0, index) : url;
}

export class ContentService {
  private cinemeta = new CinemetaProvider();
  private metadata = new MetadataProvider();
  private registry: IndexerRegistry;
  private engine: TorrentEngine;
  private plugins: PluginManager;
  private detailCache = new Map<string, MetadataDetail>();

  constructor(datastore: DatastoreManager, plugins: PluginManager, engine: TorrentEngine) {
    this.registry = new IndexerRegistry(datastore);
    this.plugins = plugins;
    this.engine = engine;
  }

  public getRegistry(): IndexerRegistry {
    return this.registry;
  }

  public getEngine(): TorrentEngine {
    return this.engine;
  }

  // --- search --------------------------------------------------------------

  public async search(query: string): Promise<SearchResponse[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    // A pasted magnet is directly playable — surface it as its own result
    // rather than sending it to a catalogue search that cannot understand it.
    if (trimmed.startsWith('magnet:')) {
      const infoHash = infoHashFromMagnet(trimmed);
      const name = decodeURIComponent(trimmed.match(/dn=([^&]+)/)?.[1] ?? 'Magnet link');
      return [
        {
          name,
          url: trimmed,
          apiName: 'Magnet',
          type: TvType.Torrent,
          quality: infoHash ? infoHash.slice(0, 8) : undefined,
        },
      ];
    }

    const results: SearchResponse[] = [];

    // Runnable extension providers get first refusal, matching Android's ordering.
    const pluginResults = await this.plugins.searchAll(trimmed);
    results.push(...pluginResults);

    // Cinemeta is primary: it is the only source that yields an IMDb id for
    // movies, and the strongest indexer (Torrentio) is addressed solely by IMDb id.
    const [cinemeta, legacy] = await Promise.allSettled([
      this.cinemeta.search(trimmed),
      // TVmaze/AniList stay as a fallback so a Cinemeta outage is not fatal,
      // and because AniList resolves anime titles Cinemeta indexes poorly.
      this.metadata.search(trimmed),
    ]);

    if (cinemeta.status === 'fulfilled') results.push(...cinemeta.value);

    if (legacy.status === 'fulfilled') {
      // Suppress fallback rows that duplicate a Cinemeta hit by title+year.
      const seen = new Set(
        results.map((r) => `${r.name.toLowerCase()}|${r.year ?? ''}`)
      );
      for (const item of legacy.value) {
        const key = `${item.name.toLowerCase()}|${item.year ?? ''}`;
        if (!seen.has(key)) {
          seen.add(key);
          results.push(item);
        }
      }
    }

    if (results.length === 0 && cinemeta.status === 'rejected' && legacy.status === 'rejected') {
      throw cinemeta.reason instanceof Error
        ? cinemeta.reason
        : new Error(String(cinemeta.reason));
    }

    return results;
  }

  public async load(url: string): Promise<MetadataDetail | null> {
    const base = stripQuery(url);

    const cached = this.detailCache.get(base);
    if (cached) return cached;

    const cinemetaRef = parseCinemetaUrl(base);
    if (cinemetaRef) {
      const detail = await this.cinemeta.load(cinemetaRef.type, cinemetaRef.imdbId);
      if (!detail) return null;

      const mapped: MetadataDetail = {
        name: detail.name,
        url: base,
        apiName: 'Catalogue',
        type: detail.type,
        posterUrl: detail.posterUrl,
        year: detail.year,
        plot: detail.plot,
        rating: detail.rating,
        tags: detail.tags,
        actors: detail.actors,
        duration: detail.duration,
        runtimeMinutes: detail.runtimeMinutes,
        // The whole point of this path: an IMDb id, for every type.
        imdbId: detail.imdbId,
        episodes: detail.episodes,
      };
      this.detailCache.set(base, mapped);
      return mapped;
    }

    if (parseMetadataUrl(base)) {
      const detail = await this.metadata.load(base);
      if (detail) {
        // Backfill an IMDb id when the catalogue did not supply one; it
        // materially improves indexer precision.
        if (!detail.imdbId) {
          detail.imdbId = await this.metadata.resolveImdbId(detail.name, detail.year);
        }
        this.detailCache.set(base, detail);
      }
      return detail;
    }

    return this.plugins.loadMedia(base);
  }

  // --- sources -------------------------------------------------------------

  public async getSources(
    request: SourceQuery,
    /** Fires as each indexer answers, so a caller can act on partial results. */
    onProgress?: (progress: SearchProgress) => void
  ): Promise<SourceResponse> {
    const fromUrl = parseEpisodeParams(request.mediaUrl);
    const season = request.season ?? fromUrl.season;
    const episode = request.episode ?? fromUrl.episode;
    const base = stripQuery(request.mediaUrl);

    // A magnet needs no search at all — it *is* the source.
    if (base.startsWith('magnet:')) {
      const infoHash = infoHashFromMagnet(base) ?? '';
      const title = decodeURIComponent(base.match(/dn=([^&]+)/)?.[1] ?? 'Magnet link');
      const sources: TorrentResult[] = [
        {
          infoHash,
          title,
          magnet: base,
          sizeBytes: 0,
          seeders: 0,
          leechers: 0,
          indexerId: 'magnet',
          indexerName: 'Direct magnet',
          parsed: parseReleaseName(title),
          score: 0,
          scoreReasons: ['Supplied directly by the user'],
        },
      ];
      // A magnet is already the answer, so the one progress event a caller gets
      // is the terminal one — otherwise a session waiting on `done` would hang.
      onProgress?.({
        results: sources,
        settled: 0,
        totalRelevant: 0,
        lastIndexerName: 'Direct magnet',
        done: true,
      });
      return {
        sources,
        filtered: [],
        indexerOutcomes: [],
        query: { title, season, episode },
      };
    }

    const detail = await this.load(base);
    const title = request.titleOverride ?? detail?.name;

    if (!title) {
      onProgress?.({
        results: [],
        settled: 0,
        totalRelevant: 0,
        lastIndexerName: '',
        done: true,
      });
      return {
        sources: [],
        filtered: [],
        indexerOutcomes: [],
        emptyReason: 'Could not determine a title to search for.',
        query: { title: '', season, episode },
      };
    }

    const isAnime = detail?.type === TvType.Anime || detail?.type === TvType.AnimeMovie;

    const indexerQuery: IndexerQuery = {
      // Including the year for movies sharply reduces wrong-title matches.
      query: detail?.year && episode === undefined ? `${title} ${detail.year}` : title,
      type: detail?.type,
      season,
      episode,
      year: detail?.year,
      imdbId: detail?.imdbId,
      limit: 100,
    };

    const outcome = await this.registry.search(
      indexerQuery,
      {
        expectedTitle: title,
        // Anime releases rarely carry a year; enforcing one loses good sources.
        expectedYear: isAnime ? undefined : detail?.year,
        season,
        episode,
        runtimeMinutes: detail?.runtimeMinutes,
      },
      onProgress
    );

    const response: SourceResponse = {
      sources: outcome.results,
      filtered: outcome.rejected.slice(0, 50).map((r) => ({
        title: r.result.title,
        reason: r.reason,
        seeders: r.result.seeders,
      })),
      indexerOutcomes: outcome.indexerOutcomes,
      query: { title, season, episode, imdbId: detail?.imdbId },
    };

    if (outcome.results.length === 0) {
      response.emptyReason = this.explainEmptyResult(outcome);
    }
    return response;
  }

  /**
   * Turns "no results" into an actionable message. The distinction between
   * "every indexer is unreachable" and "the indexers worked and nothing matched"
   * is the difference between a network problem and a search problem, and the
   * user cannot fix either without being told which it is.
   */
  private explainEmptyResult(outcome: AggregateSearchResult): string {
    const attempted = outcome.indexerOutcomes.filter((o) => !o.skipped);
    const failed = attempted.filter((o) => !o.ok);

    if (attempted.length === 0) {
      return 'No indexers are enabled for this content type. Add a Jackett or Prowlarr indexer in Settings → Sources.';
    }
    if (failed.length === attempted.length) {
      const reasons = [...new Set(failed.map((f) => f.error ?? 'unknown error'))];
      return `All ${failed.length} indexer(s) failed: ${reasons.join('; ')}. Public torrent sites are often DNS-blocked by ISPs — a local Jackett/Prowlarr instance is the reliable route.`;
    }
    if (outcome.rejected.length > 0) {
      return `Found ${outcome.rejected.length} result(s), but all were filtered out by your source preferences. Loosen the filters in Settings → Sources, or view the filtered list.`;
    }
    return 'No sources found for this title. Try a different episode, or add more indexers.';
  }

  // --- playback ------------------------------------------------------------

  public async startStream(
    source: Pick<
      TorrentResult,
      'magnet' | 'infoHash' | 'torrentUrl' | 'fileIndex' | 'expectedFileName'
    >,
    season?: number,
    episode?: number
  ): Promise<StreamHandle> {
    const torrentId = source.magnet || source.torrentUrl || source.infoHash;
    if (!torrentId) {
      throw new Error('This source has no magnet link, torrent file, or infohash.');
    }
    return this.engine.startStream({
      torrentId,
      season,
      episode,
      // Torrentio names the exact file for season packs; trusting it beats
      // re-deriving the episode from file names.
      fileIndex: source.fileIndex,
      expectedFileName: source.expectedFileName,
    });
  }

  /**
   * Starts the best source that actually works, falling through the ranked list.
   *
   * The ranker orders by how good a release *looks*; whether its swarm is alive
   * can only be learned by trying. A top-ranked release with 400 stale seeders
   * reported by an indexer that last scraped a week ago is indistinguishable
   * from a healthy one until bytes either arrive or don't — so each candidate is
   * given a budget to produce playable data, and the first that does wins.
   *
   * Every discarded attempt is torn down, including its partial cache, so a
   * failover does not leave three dead swarms holding sockets.
   */
  public async startBestStream(
    candidates: TorrentResult[],
    season?: number,
    episode?: number,
    options: { maxAttempts?: number; perSourceMs?: number } = {}
  ): Promise<AutoStreamResult> {
    const maxAttempts = options.maxAttempts ?? DEFAULT_FAILOVER_ATTEMPTS;
    const perSourceMs = options.perSourceMs ?? DEFAULT_SOURCE_BUDGET_MS;
    const attempts: StreamAttempt[] = [];

    const usable = candidates.filter((c) => c.magnet || c.torrentUrl || c.infoHash);
    if (usable.length === 0) {
      throw new Error('None of the sources found carry a usable magnet or torrent link.');
    }

    for (const source of usable.slice(0, maxAttempts)) {
      let handle: StreamHandle | null = null;
      try {
        handle = await this.startStream(source, season, episode);
      } catch (error) {
        attempts.push({
          title: source.title,
          indexerName: source.indexerName,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      const verdict = await this.engine.waitUntilPlayable(handle.infoHash, perSourceMs);
      if (verdict.playable) {
        return { handle, source, attempts };
      }

      // Not playable inside the budget. A source that is merely slow — bytes are
      // arriving, peers are connected — is still the best answer we have, so it
      // is only discarded when nothing at all came through.
      const stats = await this.engine.getStats(handle.infoHash);
      const makingProgress = Boolean(stats && stats.downloaded > 0 && stats.peers > 0);
      if (makingProgress) {
        return { handle, source, attempts };
      }

      attempts.push({
        title: source.title,
        indexerName: source.indexerName,
        error: verdict.reason ?? 'No data arrived within the time budget.',
      });
      // Discard the cache too: a swarm that produced nothing has nothing worth keeping.
      await this.engine.stopStream(handle.infoHash, false);
    }

    const detail = attempts.map((a) => `${a.title} (${a.indexerName}): ${a.error}`).join('; ');
    throw new Error(
      `Tried ${attempts.length} source${attempts.length === 1 ? '' : 's'} and none started. ${detail}`
    );
  }

  /**
   * Convenience path for "just play this": finds sources and streams the first
   * that works, in one call. Used by in-player episode switching, where bouncing
   * the user back to a source list would defeat the point.
   */
  public async autoPlay(request: SourceQuery): Promise<AutoStreamResult & { query: SourceResponse['query'] }> {
    const found = await this.getSources(request);
    if (found.sources.length === 0) {
      throw new Error(found.emptyReason ?? 'No sources found for this episode.');
    }
    // `getSources` also derives season/episode from `?s=&e=` on episode URLs, so
    // its resolved query is authoritative — passing the raw request here would
    // lose the episode for callers that only had a URL.
    const result = await this.startBestStream(found.sources, found.query.season, found.query.episode);
    return { ...result, query: found.query };
  }

  public getPreferences(): SourcePreferences {
    return this.registry.getPreferences();
  }

  public savePreferences(prefs: Partial<SourcePreferences>): SourcePreferences {
    return this.registry.savePreferences(prefs);
  }
}
