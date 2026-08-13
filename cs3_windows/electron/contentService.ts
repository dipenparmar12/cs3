import { createHash } from 'crypto';
import { TvType, type SearchResponse } from '../src/types/api';
import type {
  IndexerQuery,
  ParsedRelease,
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
import { SourceCache } from './sourceCache';
import { mergeSearchResults } from './searchMerge';

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

/** Enough for a long browsing session; see `ContentService.alternateRoutes`. */
const MAX_REMEMBERED_ROUTES = 500;

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
  private cache: SourceCache;
  private detailCache = new Map<string, MetadataDetail>();

  constructor(datastore: DatastoreManager, plugins: PluginManager, engine: TorrentEngine) {
    this.registry = new IndexerRegistry(datastore);
    this.plugins = plugins;
    this.engine = engine;
    this.cache = new SourceCache(datastore);
  }

  public getCache(): SourceCache {
    return this.cache;
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
    if (legacy.status === 'fulfilled') results.push(...legacy.value);

    if (results.length === 0 && cinemeta.status === 'rejected' && legacy.status === 'rejected') {
      throw cinemeta.reason instanceof Error
        ? cinemeta.reason
        : new Error(String(cinemeta.reason));
    }

    /**
     * One row per work, not one row per catalogue that happened to know it.
     *
     * The previous pass compared lowercased titles exactly and only checked the
     * fallback catalogues against Cinemeta, so extension providers were never
     * deduplicated at all and "Spider-Man" vs "Spider Man" stayed two rows.
     * Merging on identity also collects the losing URLs as alternates, which is
     * what lets one title draw sources from both ecosystems.
     */
    const merged = mergeSearchResults(results);
    this.rememberRoutes(merged);
    return merged;
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
    onProgress?: (progress: SearchProgress) => void,
    /** Set by an explicit refresh, which must not be answered from cache. */
    options: { bypassCache?: boolean } = {}
  ): Promise<SourceResponse> {
    const fromUrl = parseEpisodeParams(request.mediaUrl);
    const season = request.season ?? fromUrl.season;
    const episode = request.episode ?? fromUrl.episode;
    const base = stripQuery(request.mediaUrl);

    /**
     * A cache hit answers instantly, which is the whole difference between
     * re-opening something you watched yesterday and waiting through discovery
     * again. Only the still-valid half is served: magnets never expire, so they
     * survive indefinitely, while provider links past their deadline are
     * dropped here and re-resolved below.
     */
    if (!options.bypassCache) {
      const cached = this.cache.read(base, season, episode);
      if (cached.hit && cached.fresh.length > 0) {
        onProgress?.({
          results: cached.fresh,
          settled: 1,
          totalRelevant: 1,
          lastIndexerName: 'Cached sources',
          done: true,
        });
        return {
          sources: cached.fresh,
          filtered: [],
          indexerOutcomes: [],
          query: { title: request.titleOverride ?? '', season, episode },
        };
      }
    }

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

    // An extension provider already knows its own links; there is nothing to
    // search for. Asking indexers for a title the provider serves directly
    // would be slower and worse than what the provider just handed us.
    if (base.startsWith('cs3ext://')) {
      // Season and episode are forwarded because the URL may address the show
      // rather than the episode — the detail view hands over an episode handle,
      // but a quick-play straight from a search row does not.
      const sources = await this.extensionSources(base, season, episode);
      onProgress?.({
        results: sources,
        settled: 1,
        totalRelevant: 1,
        lastIndexerName: 'Extension provider',
        done: true,
      });
      if (sources.length > 0) this.cache.write(base, sources, season, episode);
      return {
        sources,
        filtered: [],
        indexerOutcomes: [],
        emptyReason:
          sources.length === 0
            ? 'The extension provider returned no playable links for this item.'
            : undefined,
        query: { title: request.titleOverride ?? '', season, episode },
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

    /**
     * Extension providers and torrent indexers answer the same question, so
     * they are asked at the same time and report into the same list.
     *
     * This is what stops the extension ecosystem from being a parallel app the
     * viewer has to opt into by clicking the right search row: a title reached
     * through the catalogue now draws on every installed provider that also
     * carries it. Provider links matter disproportionately for time-to-first-
     * frame — a direct HTTP stream starts in a second where a swarm needs to
     * find peers first — so they are streamed into progress as they land rather
     * than appended once the indexers finish.
     */
    const routes = this.alternateRoutes.get(base) ?? [];
    const fromExtensions: TorrentResult[] = [];
    let extensionsSettled = 0;

    let latest: SearchProgress | null = null;
    const report = (progress: SearchProgress | null) => {
      if (!onProgress || !progress) return;
      onProgress({
        ...progress,
        // Provider links lead: they are already resolved and start fastest.
        results: [...fromExtensions, ...progress.results],
        settled: progress.settled + extensionsSettled,
        totalRelevant: progress.totalRelevant + routes.length,
        done: progress.done && extensionsSettled >= routes.length,
      });
    };

    const [outcome] = await Promise.all([
      this.registry.search(
        indexerQuery,
        {
          expectedTitle: title,
          // Anime releases rarely carry a year; enforcing one loses good sources.
          expectedYear: isAnime ? undefined : detail?.year,
          season,
          episode,
          runtimeMinutes: detail?.runtimeMinutes,
        },
        onProgress &&
          ((progress) => {
            latest = progress;
            report(progress);
          })
      ),
      ...routes.map(async (route) => {
        try {
          fromExtensions.push(...(await this.extensionSources(route, season, episode)));
        } catch {
          // One provider failing is not a search failure; the rest still answer.
        }
        extensionsSettled += 1;
        report(latest);
      }),
    ]);

    const response: SourceResponse = {
      sources: [...fromExtensions, ...outcome.results],
      filtered: outcome.rejected.slice(0, 50).map((r) => ({
        title: r.result.title,
        reason: r.reason,
        seeders: r.result.seeders,
      })),
      indexerOutcomes: outcome.indexerOutcomes,
      query: { title, season, episode, imdbId: detail?.imdbId },
    };

    if (response.sources.length === 0) {
      response.emptyReason = this.explainEmptyResult(outcome, routes.length);
    } else {
      this.cache.write(base, response.sources, season, episode);
    }
    return response;
  }

  /**
   * Turns an extension provider's links into ranked playable sources.
   *
   * Ordered by the quality the provider declared, descending, which is the only
   * signal available — there is no swarm health to weigh and no release name to
   * parse, so the ranker's usual inputs do not exist here.
   */
  private async extensionSources(
    url: string,
    season?: number,
    episode?: number
  ): Promise<TorrentResult[]> {
    const target = await this.resolveExtensionTarget(url, season, episode);
    let links = await this.plugins.loadLinks(target);

    // An episode's URL already *is* the provider's playable handle, but a
    // film's is its detail page — and those differ (Internet Archive answers
    // with `https://archive.org/details/<id>` for the page and a bare `<id>`
    // as the handle). When the page address yields nothing, resolving the
    // detail and retrying with its `dataUrl` is what makes films playable.
    if (links.length === 0) {
      const detail = (await this.plugins.loadMedia(target)) as
        | (MetadataDetail & { dataUrl?: string })
        | null;
      if (detail?.dataUrl && detail.dataUrl !== target) {
        links = await this.plugins.loadLinks(detail.dataUrl);
      }
    }

    return links
      .filter((link) => link.url)
      .map((link, index) => {
        const parsed = parseReleaseName(link.name || link.source || 'Stream');
        // The ranker and the dedupe key both need an identity; a provider link
        // has no infohash, so one is synthesised from the URL.
        const identity = `ext-${createHash('sha1').update(link.url).digest('hex').slice(0, 20)}`;
        return {
          infoHash: identity,
          directUrl: link.url,
          directHeaders: link.headers,
          isM3u8: Boolean(link.isM3u8),
          title: link.name || link.source || 'Provider stream',
          magnet: '',
          sizeBytes: 0,
          // Seeders are meaningless for a direct stream. One keeps it above the
          // `minSeeders` floor that would otherwise filter every provider link.
          seeders: 1,
          leechers: 0,
          indexerId: 'extension',
          indexerName: link.source || 'Extension provider',
          parsed: {
            ...parsed,
            resolution: (link.quality || parsed.resolution) as ParsedRelease['resolution'],
          },
          score: link.quality || 0,
          scoreReasons: [
            `Supplied directly by ${link.source || 'the extension provider'}`,
            link.isM3u8 ? 'HLS stream' : 'Progressive stream',
          ],
          // Preserve the provider's own ordering as the tiebreak.
          fileIndex: index,
        } satisfies TorrentResult;
      })
      .sort((a, b) => b.score - a.score);
  }

  /**
   * Narrows an extension URL to the exact thing that should be played.
   *
   * A provider's search hit addresses a *show*, not an episode. Asking it for
   * links directly returns either nothing or the wrong episode, so when a
   * season and episode are wanted the show is loaded and its episode list is
   * consulted — each episode carries its own opaque handle, and that handle is
   * the only thing `loadLinks` can act on.
   *
   * Falling back to the original URL is correct rather than lazy: a film has no
   * episode list, and a provider whose numbering does not line up should still
   * get a chance to answer.
   */
  private async resolveExtensionTarget(
    url: string,
    season?: number,
    episode?: number
  ): Promise<string> {
    if (episode === undefined) return url;

    const detail = (await this.plugins.loadMedia(url)) as
      | (MetadataDetail & { episodes?: Array<{ url: string; season?: number; episode?: number }> })
      | null;
    const episodes = detail?.episodes;
    if (!episodes?.length) return url;

    const match =
      episodes.find(
        (e) => e.episode === episode && (season === undefined || e.season === season)
      ) ??
      // Providers routinely omit the season on a single-season show; matching
      // on episode number alone is better than refusing to play it.
      (season === undefined || season === 1
        ? episodes.find((e) => e.episode === episode && e.season === undefined)
        : undefined);

    return match?.url ?? url;
  }

  /**
   * Extension routes to the same work, recorded when the search merged them.
   *
   * Discovery is addressed by a single URL, so without this a title the viewer
   * reached through the catalogue could only ever be played from torrents even
   * when three installed extensions also carry it. The merge already knows they
   * are the same work; this is what keeps that knowledge alive long enough for
   * source discovery to use it.
   *
   * Bounded and insertion-ordered: it is a convenience for the current session,
   * not state worth persisting, and an unbounded map fed by every search is a
   * leak in an app that stays open for days.
   */
  private alternateRoutes = new Map<string, string[]>();

  private rememberRoutes(results: SearchResponse[]): void {
    for (const result of results) {
      const routes = (result.alternates ?? [])
        .map((alternate) => alternate.url)
        .filter((url) => url.startsWith('cs3ext://'));
      if (routes.length === 0) continue;

      this.alternateRoutes.set(result.url, routes);
      if (this.alternateRoutes.size > MAX_REMEMBERED_ROUTES) {
        const oldest = this.alternateRoutes.keys().next().value;
        if (oldest !== undefined) this.alternateRoutes.delete(oldest);
      }
    }
  }

  /**
   * Turns "no results" into an actionable message. The distinction between
   * "every indexer is unreachable" and "the indexers worked and nothing matched"
   * is the difference between a network problem and a search problem, and the
   * user cannot fix either without being told which it is.
   */
  private explainEmptyResult(
    outcome: AggregateSearchResult,
    /** Extension providers that also carry this title and were asked too. */
    extensionRoutes = 0
  ): string {
    const attempted = outcome.indexerOutcomes.filter((o) => !o.skipped);
    const failed = attempted.filter((o) => !o.ok);

    if (attempted.length === 0) {
      return extensionRoutes > 0
        ? `No indexers are enabled for this content type, and the ${extensionRoutes} extension provider(s) carrying this title returned no playable links.`
        : 'No indexers are enabled for this content type. Add a Jackett or Prowlarr indexer in Settings → Sources.';
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
      | 'magnet'
      | 'infoHash'
      | 'torrentUrl'
      | 'fileIndex'
      | 'expectedFileName'
      | 'directUrl'
      | 'isM3u8'
      | 'title'
    >,
    season?: number,
    episode?: number
  ): Promise<StreamHandle> {
    // A provider stream is already an addressable URL. There is no swarm to
    // join and nothing to download first, so it is handed to the player as-is.
    if (source.directUrl) {
      return {
        infoHash: source.infoHash,
        streamUrl: source.directUrl,
        fileName: source.title ?? 'Stream',
        fileSize: 0,
        diskPath: '',
        files: [],
        subtitleUrls: [],
        mimeType: source.isM3u8 ? 'application/x-mpegURL' : 'video/mp4',
      };
    }

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
    options: {
      maxAttempts?: number;
      perSourceMs?: number;
      /**
       * Abandons the walk. Anything already started is torn down, so a
       * superseded attempt stops competing for bandwidth with the one the
       * viewer is actually waiting on.
       */
      signal?: AbortSignal;
      /**
       * Returns as soon as the stream exists rather than waiting for it to
       * become playable. Set for an explicit choice: the viewer picked this
       * release, so they should be watching it buffer, not watching a spinner
       * decide whether their choice was allowed.
       */
      returnImmediately?: boolean;
    } = {}
  ): Promise<AutoStreamResult> {
    const maxAttempts = options.maxAttempts ?? DEFAULT_FAILOVER_ATTEMPTS;
    const perSourceMs = options.perSourceMs ?? DEFAULT_SOURCE_BUDGET_MS;
    const signal = options.signal;
    const attempts: StreamAttempt[] = [];

    const abortError = () => Object.assign(new Error('Superseded by a newer selection.'), {
      name: 'AbortError',
    });

    const usable = candidates.filter(
      (c) => c.directUrl || c.magnet || c.torrentUrl || c.infoHash
    );
    if (usable.length === 0) {
      throw new Error('None of the sources found carry a usable magnet, torrent or stream link.');
    }

    for (const source of usable.slice(0, maxAttempts)) {
      if (signal?.aborted) throw abortError();

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

      // Started while being superseded: tear it down rather than leave a swarm
      // running for a source nobody is waiting for.
      if (signal?.aborted) {
        await this.engine.stopStream(handle.infoHash, false);
        throw abortError();
      }

      // A direct stream has no swarm to become playable; the URL either serves
      // bytes or the player reports the failure. Waiting on torrent readiness
      // here would block forever on a source that is already ready.
      if (source.directUrl) {
        return { handle, source, attempts };
      }

      // An explicit choice starts now. Readiness is the player's problem from
      // here — it already renders buffer progress, peers and speed, which is
      // strictly more informative than a blank wait.
      if (options.returnImmediately) {
        return { handle, source, attempts };
      }

      const verdict = await this.engine.waitUntilPlayable(
        handle.infoHash,
        perSourceMs,
        signal
      );

      if (verdict.aborted) {
        await this.engine.stopStream(handle.infoHash, false);
        throw abortError();
      }
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
