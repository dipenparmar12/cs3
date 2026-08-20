import { createHash } from 'crypto';
import { TvType, type SearchOptions, type SearchResponse } from '../src/types/api';
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
import { parseExtensionUrl, type AnalyticsSink, type PluginManager } from './pluginManager';
import { SourceCache } from './sourceCache';
import { MediaProxy } from './mediaProxy';
import { DetailCache } from './detailCache';
import { mergeSearchResults } from './searchMerge';
import { rawFetch } from './torrent/http';
import { SearchScopeStore } from './searchScope';
import { SearchSessionManager, type SearchSnapshot } from './searchSession';
import type { SourceDiagnosis } from '../src/types/diagnostics';
import { SharedDiscovery } from './sharedDiscovery';
import { getLogger } from './logging/logger';

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
  /** The extension provider behind this source, when it came from one. */
  providerName?: string;
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
  /**
   * The structured form of `emptyReason`.
   *
   * Both, because they serve different readers: the sentence goes on screen and
   * the facts go on the clipboard. Collapsing them would either put a stack of
   * addresses and HTTP statuses in front of a viewer or leave the person
   * helping them with one sentence, which is where this started.
   */
  diagnosis?: SourceDiagnosis;
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

/**
 * A truthful content type for a direct link.
 *
 * This claimed `video/mp4` for every non-HLS URL, `.mkv` included. The element
 * sniffs the bytes so it did not break playback on its own, but the lie
 * propagated: anything downstream reasoning about the type — an external
 * player, a download's suggested filename, the HLS check itself — was told
 * something false about the stream.
 */
function mimeForStreamUrl(url: string, isM3u8?: boolean): string {
  if (isM3u8 || /\.m3u8(\?|$)/i.test(url)) return 'application/x-mpegURL';
  const path = url.split('?')[0].toLowerCase();
  if (path.endsWith('.webm')) return 'video/webm';
  if (path.endsWith('.mkv')) return 'video/x-matroska';
  if (path.endsWith('.avi')) return 'video/x-msvideo';
  if (path.endsWith('.mov')) return 'video/quicktime';
  if (path.endsWith('.ts')) return 'video/mp2t';
  if (path.endsWith('.flv')) return 'video/x-flv';
  if (path.endsWith('.ogv')) return 'video/ogg';
  // Unknown extensions are far more often MP4 than anything else, and a
  // download link commonly has no extension at all.
  return 'video/mp4';
}

function stripQuery(url: string): string {
  const index = url.indexOf('?');
  return index >= 0 ? url.slice(0, index) : url;
}

const log = getLogger().child('sources');

export class ContentService {
  private cinemeta = new CinemetaProvider();
  private metadata = new MetadataProvider();
  private registry: IndexerRegistry;
  private engine: TorrentEngine;
  private plugins: PluginManager;
  private cache: SourceCache;
  private scope: SearchScopeStore;
  private searches: SearchSessionManager;
  /**
   * Applies a provider's `Referer`/`User-Agent` to the stream it handed us.
   *
   * A browser cannot send `Referer` itself — it is a forbidden header — so a
   * provider link that requires one can only be played through this.
   */
  private proxy = new MediaProxy((input, init) => rawFetch(input, init));
  private details = new DetailCache();
  /** Base URLs with a background refresh already running. */
  private revalidating = new Set<string>();
  /** Notified when a background refresh produced new metadata. */
  private onDetailRefreshed: ((url: string, detail: MetadataDetail) => void) | null = null;

  /**
   * Where playback outcomes are counted.
   *
   * Recorded here rather than in the renderer because this is the layer that
   * knows *which source* started and which ones were tried and discarded first
   * — by the time a stream reaches the `<video>` element the failed candidates
   * are gone.
   */
  private analytics: AnalyticsSink | null = null;

  /** Wired by `main.ts`; playback outcomes are counted from here onwards. */
  public setAnalytics(sink: AnalyticsSink): void {
    this.analytics = sink;
  }

  constructor(datastore: DatastoreManager, plugins: PluginManager, engine: TorrentEngine) {
    this.registry = new IndexerRegistry(datastore);
    this.plugins = plugins;
    this.engine = engine;
    this.cache = new SourceCache(datastore);
    this.scope = new SearchScopeStore(datastore);
    this.searches = new SearchSessionManager({
      plugins: this.plugins,
      registry: this.registry,
      cinemeta: this.cinemeta,
      metadata: this.metadata,
      scope: this.scope,
      onResults: (results) => this.rememberRoutes(results),
    });
  }

  public getScope(): SearchScopeStore {
    return this.scope;
  }

  public getSearches(): SearchSessionManager {
    return this.searches;
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

  /** Wired by `main.ts` so a refreshed title reaches whoever is viewing it. */
  public setDetailListener(listener: (url: string, detail: MetadataDetail) => void): void {
    this.onDetailRefreshed = listener;
  }

  public getProxy(): MediaProxy {
    return this.proxy;
  }

  /** Owns a socket, so it is wired into app shutdown like the other services. */
  public shutdown(): void {
    this.proxy.shutdown();
    this.details.flush();
  }

  // --- search --------------------------------------------------------------

  /**
   * Opens a search and returns immediately.
   *
   * Everything after this point arrives as `search:update` snapshots — the
   * scope it resolved to, each source as it answers, and the merged results so
   * far. See `searchSession.ts` for why a search is push-shaped.
   */
  public startSearch(query: string, options: SearchOptions = {}): SearchSnapshot {
    return this.searches.start(query, options);
  }

  public cancelSearch(id: string): SearchSnapshot | null {
    return this.searches.cancel(id);
  }

  /** Runs a search to completion. For callers that cannot use a partial answer. */
  public async search(query: string, options: SearchOptions = {}): Promise<SearchResponse[]> {
    if (!query.trim()) return [];
    return (await this.searches.runToCompletion(query, options)).results;
  }

  /**
   * A catalogue row, for browsing rather than searching.
   *
   * The home screen used to build its rows with the full search — every enabled
   * extension provider, waited on to completion, three times over in parallel.
   * That made opening the app cost as much as the slowest scraper on the slowest
   * of three queries, and the whole screen sat behind a spinner while it
   * happened. It is also the wrong question: a row titled "Trending" wants a
   * catalogue's idea of a popular film, and a site scraper has no view on that.
   *
   * So: catalogues only, which answer in a few hundred milliseconds. Asking one
   * named provider stays possible, because browsing a specific provider's own
   * library is a real thing the home screen offers — and one provider is fast
   * for the same reason thirty are not.
   */
  public async browse(query: string, provider?: string): Promise<SearchResponse[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    if (provider) {
      const results = await this.plugins.searchAll(trimmed, [provider]);
      return mergeSearchResults(results);
    }

    const [cinemeta, legacy] = await Promise.allSettled([
      this.cinemeta.search(trimmed),
      this.metadata.search(trimmed),
    ]);

    const results = [
      ...(cinemeta.status === 'fulfilled' ? cinemeta.value : []),
      ...(legacy.status === 'fulfilled' ? legacy.value : []),
    ];
    return mergeSearchResults(results);
  }

  /**
   * Title metadata, served from cache the moment there is one.
   *
   * Stale-while-revalidate: a cached answer goes back immediately whatever its
   * age, and a stale one starts a refresh behind it whose result is pushed to
   * whoever is looking. Revisiting a title is then instant, and still correct
   * within a few seconds if anything changed.
   *
   * The alternative — refetching on every visit — meant a blank screen and a
   * network round trip for a plot and a poster the app had displayed minutes
   * earlier, and for extension-sourced titles it meant re-scraping a web page.
   */
  public async load(url: string): Promise<MetadataDetail | null> {
    const base = stripQuery(url);

    const cached = this.details.read(base);
    if (cached) {
      if (cached.stale) this.revalidateDetail(base);
      return cached.detail;
    }

    const detail = await this.fetchDetail(base);
    this.details.write(base, detail);
    return detail;
  }

  /**
   * Refreshes a stale entry without making anyone wait for it.
   *
   * Deduplicated: opening the same title twice in quick succession, or a list
   * that renders several cards for one work, must not start several scrapes of
   * the same page. Failures are deliberately swallowed — the viewer already has
   * a usable answer on screen, and replacing it with an error because a
   * *background* refresh failed would be a strictly worse outcome than saying
   * nothing.
   */
  private revalidateDetail(base: string): void {
    if (this.revalidating.has(base)) return;
    this.revalidating.add(base);

    void (async () => {
      try {
        const fresh = await this.fetchDetail(base);
        this.details.write(base, fresh);
        this.onDetailRefreshed?.(base, fresh);
      } catch {
        // Keep the stale entry: it is better than nothing, and the next visit
        // will try again.
      } finally {
        this.revalidating.delete(base);
      }
    })();
  }

  /** The actual fetch, by address type. Throws with a reason on every failure. */
  private async fetchDetail(base: string): Promise<MetadataDetail> {
    const cinemetaRef = parseCinemetaUrl(base);
    if (cinemetaRef) {
      const detail = await this.cinemeta.load(cinemetaRef.type, cinemetaRef.imdbId);
      // Named, like the provider path: "the catalogue has no entry" and "the
      // catalogue is unreachable" need different reactions from the user, and
      // a null told them neither.
      if (!detail) {
        throw new Error(
          `The catalogue has no entry for ${cinemetaRef.imdbId}. It may have been removed, or Cinemeta may be unreachable from this network — Settings → Connection can test that.`
        );
      }

      return {
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
    }

    if (parseMetadataUrl(base)) {
      const detail = await this.metadata.load(base);
      if (!detail) {
        throw new Error(
          'TVmaze/AniList returned no details for this title. It may have been withdrawn, or the catalogue may be unreachable from this network.'
        );
      }
      // Backfill an IMDb id when the catalogue did not supply one; it
      // materially improves indexer precision.
      if (!detail.imdbId) {
        detail.imdbId = await this.metadata.resolveImdbId(detail.name, detail.year);
      }
      return detail;
    }

    const fromProvider = await this.plugins.loadMedia(base);
    if (!fromProvider) {
      // `loadMedia` throws with a reason for every failure it can name; a null
      // here means the URL was not addressed to a provider at all.
      throw new Error(`Nothing knows how to open this address: ${base.slice(0, 120)}`);
    }
    // Cached like the catalogue paths, which it previously was not — and it is
    // the expensive one, because it is a scrape rather than an API call.
    return fromProvider as MetadataDetail;
  }

  // --- sources -------------------------------------------------------------

  /**
   * Whether this query could be answered from cache right now.
   *
   * Asked speculatively — by the prefetcher, before deciding whether a scrape is
   * warranted at all — so it uses `peek` rather than `read` and never writes.
   */
  public hasFreshSources(request: SourceQuery): boolean {
    const fromUrl = parseEpisodeParams(request.mediaUrl);
    const base = stripQuery(request.mediaUrl);
    // A magnet is its own source; there is nothing to discover or cache.
    if (base.startsWith('magnet:')) return true;
    return (
      this.cache.peek(
        base,
        request.season ?? fromUrl.season,
        request.episode ?? fromUrl.episode
      ).fresh.length > 0
    );
  }

  /** Identity of a discovery run, so two callers asking the same thing share one. */
  private sourceKey(request: SourceQuery): string {
    const fromUrl = parseEpisodeParams(request.mediaUrl);
    return [
      stripQuery(request.mediaUrl),
      request.season ?? fromUrl.season ?? '',
      request.episode ?? fromUrl.episode ?? '',
    ].join('|');
  }

  /**
   * Discovery runs currently in flight, so a second caller joins rather than
   * starting an identical scrape.
   *
   * This is what makes background prefetching worth doing instead of harmful —
   * see {@link SharedDiscovery}, which owns the refcounted cancellation.
   */
  private inFlightSources = new SharedDiscovery<SourceResponse, SearchProgress>();

  public async getSources(
    request: SourceQuery,
    /** Fires as each indexer answers, so a caller can act on partial results. */
    onProgress?: (progress: SearchProgress) => void,
    /** Set by an explicit refresh, which must not be answered from cache. */
    options: { bypassCache?: boolean; signal?: AbortSignal } = {}
  ): Promise<SourceResponse> {
    const bypass = Boolean(options.bypassCache);
    return this.inFlightSources.run(
      this.sourceKey(request),
      bypass ? 'bypass' : 'cached',
      // A plain caller joins any run. A refresh joins only a run that also
      // bypassed the cache — the point of a refresh is that it must not be
      // served by something that may have answered from cache.
      (existingTag) => !bypass || existingTag === 'bypass',
      (emit, signal) => this.runDiscovery(request, emit, { bypassCache: bypass, signal }),
      { onProgress, signal: options.signal }
    );
  }

  /** True while a discovery for this exact query is already running. */
  public isDiscovering(request: SourceQuery): boolean {
    return this.inFlightSources.has(this.sourceKey(request));
  }

  /**
   * Wrapped so one record covers the whole discovery, however it ends.
   *
   * A scrape across fifteen providers takes 20-40 seconds and the slowest one
   * decides. When "finding sources" feels broken, the two questions are always
   * how long it took and how many answered — and both are here, on one line,
   * without needing the fifteen per-provider records to be correlated first.
   */
  private async runDiscovery(
    request: SourceQuery,
    onProgress?: (progress: SearchProgress) => void,
    options: { bypassCache?: boolean; signal?: AbortSignal } = {}
  ): Promise<SourceResponse> {
    const finish = log.begin('discovery', {
      mediaId: request.mediaUrl,
      mediaTitle: request.titleOverride,
      season: request.season,
      episode: request.episode,
      bypassCache: Boolean(options.bypassCache),
    });
    try {
      const response = await this.discover(request, onProgress, options);
      finish({
        status: response.sources.length > 0 ? 'ok' : 'empty',
        sources: response.sources.length,
        filtered: response.filtered?.length ?? 0,
        error: response.emptyReason,
      });
      return response;
    } catch (error) {
      finish({ status: 'threw', error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  private async discover(
    request: SourceQuery,
    onProgress?: (progress: SearchProgress) => void,
    options: { bypassCache?: boolean; signal?: AbortSignal } = {}
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
      const { sources, diagnosis } = await this.extensionSources(base, season, episode);
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
        // The specific reason when there is one. The generic sentence remains
        // only as the fallback for a path that produced no verdict at all —
        // it was previously the answer for six distinct situations.
        emptyReason:
          sources.length === 0
            ? (diagnosis?.summary ??
              'The extension provider returned no playable links for this item.')
            : undefined,
        diagnosis: sources.length === 0 ? diagnosis : undefined,
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
    const indexerScope = this.scope.resolveIndexers(
      this.registry.getConfigs().filter((c) => c.enabled).map((c) => c.id)
    );
    const allowedIndexers = new Set(indexerScope.allowed);

    const providerScope = this.scope.resolveProviders(
      await this.plugins.listEnabledProviders()
    );
    const allowedProviders = new Set(providerScope.allowed);

    const routes = (this.alternateRoutes.get(base) ?? []).filter((route) => {
      if (!providerScope.narrowed) return true;
      const ref = parseExtensionUrl(route);
      return ref ? allowedProviders.has(ref.provider) : false;
    });

    const needProviderSearch =
      routes.length === 0 && title && !(providerScope.narrowed && allowedProviders.size === 0);
    const targetProviders = providerScope.narrowed ? providerScope.allowed : undefined;
    const providerList = needProviderSearch
      ? this.plugins.narrowToEnabled(targetProviders)
      : [];
    const totalExtensionsToAsk = routes.length + (needProviderSearch ? providerList.length : 0);

    const fromExtensions: TorrentResult[] = [];
    let extensionsSettled = 0;
    let latestIndexerProgress: SearchProgress | null = null;

    const report = (progress: SearchProgress | null) => {
      if (!onProgress) return;
      if (options.signal?.aborted) return;
      const indexerResults = progress?.results ?? [];
      const indexerSettled = progress?.settled ?? 0;
      const indexerTotal = progress?.totalRelevant ?? allowedIndexers.size;
      const done =
        (progress?.done ?? false) && extensionsSettled >= totalExtensionsToAsk;

      onProgress({
        results: [...fromExtensions, ...indexerResults],
        settled: indexerSettled + extensionsSettled,
        totalRelevant: indexerTotal + totalExtensionsToAsk,
        lastIndexerName: progress?.lastIndexerName ?? 'Extension provider',
        done,
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
            latestIndexerProgress = progress;
            report(progress);
          }),
        // Source discovery honours the same scope the search did, so narrowing
        // to one site does not quietly widen again the moment you press play.
        (id) => allowedIndexers.has(id)
      ),
      ...routes.map(async (route) => {
        if (options.signal?.aborted) return;
        try {
          const res = await this.extensionSources(route, season, episode);
          if (res.sources.length > 0) {
            fromExtensions.push(...res.sources);
          }
        } catch {
          // One provider failing is not a search failure; the rest still answer.
        } finally {
          extensionsSettled += 1;
          report(latestIndexerProgress);
        }
      }),
      ...(needProviderSearch && providerList.length > 0
        ? [
            this.plugins.searchEach(
              title,
              targetProviders,
              async (providerOutcome) => {
                if (options.signal?.aborted) return;
                try {
                  const extMatches = (providerOutcome.results ?? []).filter((m) =>
                    m.url && m.url.startsWith('cs3ext://')
                  );
                  if (extMatches.length > 0) {
                    for (const match of extMatches.slice(0, 2)) {
                      if (options.signal?.aborted) break;
                      try {
                        const res = await this.extensionSources(match.url, season, episode);
                        if (res.sources.length > 0) {
                          fromExtensions.push(...res.sources);
                          report(latestIndexerProgress);
                        }
                      } catch {}
                    }
                  }
                } finally {
                  extensionsSettled += 1;
                  report(latestIndexerProgress);
                }
              },
              options.signal
            ),
          ]
        : []),
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
  ): Promise<{ sources: TorrentResult[]; diagnosis?: SourceDiagnosis }> {
    const target = await this.resolveExtensionTarget(url, season, episode);
    // `cs3ext://<provider>/<handle>` — the provider is the part worth
    // attributing outcomes to, and the only place it is still available.
    const providerName = target.startsWith('cs3ext://')
      ? decodeURIComponent(target.slice('cs3ext://'.length).split('/')[0] ?? '') || undefined
      : undefined;
    let attempt = await this.plugins.loadLinksDetailed(target);
    let links = attempt.links;
    let diagnosis = attempt.diagnosis;

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
        // The retry's verdict replaces the first one: the first address was
        // never the playable handle, so its failure describes the wrong thing.
        attempt = await this.plugins.loadLinksDetailed(detail.dataUrl);
        links = attempt.links;
        diagnosis = attempt.diagnosis;
      }
    }

    const sources = links
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
          providerName,
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

    return { sources, diagnosis: sources.length === 0 ? diagnosis : undefined };
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
      | 'directHeaders'
      | 'isM3u8'
      | 'title'
    >,
    season?: number,
    episode?: number
  ): Promise<StreamHandle> {
    /**
     * A provider stream is already an addressable URL — but usually not one the
     * player can fetch unaided.
     *
     * Most extension links only answer when accompanied by the `Referer` the
     * provider supplied, and a `<video>` element cannot send one. Routing
     * through the proxy is what makes the difference between a 403 and a
     * stream, and it covers hls.js and ffprobe at the same time because they
     * are handed the same URL. A link with no headers is passed through
     * untouched.
     */
    if (source.directUrl) {
      const streamUrl = await this.proxy.wrap(source.directUrl, source.directHeaders);
      return {
        infoHash: source.infoHash,
        streamUrl,
        fileName: source.title ?? 'Stream',
        fileSize: 0,
        diskPath: '',
        files: [],
        subtitleUrls: [],
        mimeType: mimeForStreamUrl(source.directUrl, source.isM3u8),
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
    const startedAt = Date.now();

    const abortError = () => Object.assign(new Error('Superseded by a newer selection.'), {
      name: 'AbortError',
    });

    /**
     * Records the outcome and hands back the result.
     *
     * Wrapped because there are four ways out of the loop below that all count
     * as "this source started" — a direct URL, an explicit choice, a torrent
     * that reached playability, and one that is merely slow but making
     * progress. Recording at each `return` by hand is how one of them ends up
     * uncounted and a provider looks worse than it is.
     */
    const succeed = (
      handle: StreamHandle,
      source: TorrentResult
    ): AutoStreamResult => {
      if (source.providerName) {
        this.analytics?.observe({
          provider: source.providerName,
          stage: 'playback',
          outcome: 'success',
          produced: 1,
          latencyMs: Date.now() - startedAt,
        });
      }
      return { handle, source, attempts };
    };

    const failed = (source: TorrentResult, error: string): void => {
      attempts.push({
        title: source.title,
        indexerName: source.indexerName,
        providerName: source.providerName,
        error,
      });
      if (source.providerName) {
        this.analytics?.observe({
          provider: source.providerName,
          stage: 'playback',
          outcome: 'failure',
          latencyMs: Date.now() - startedAt,
          error,
        });
      }
    };

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
        failed(source, error instanceof Error ? error.message : String(error));
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
        return succeed(handle, source);
      }

      // An explicit choice starts now. Readiness is the player's problem from
      // here — it already renders buffer progress, peers and speed, which is
      // strictly more informative than a blank wait.
      if (options.returnImmediately) {
        return succeed(handle, source);
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
        return succeed(handle, source);
      }

      // Not playable inside the budget. A source that is merely slow — bytes are
      // arriving, peers are connected — is still the best answer we have, so it
      // is only discarded when nothing at all came through.
      const stats = await this.engine.getStats(handle.infoHash);
      const makingProgress = Boolean(stats && stats.downloaded > 0 && stats.peers > 0);
      if (makingProgress) {
        return succeed(handle, source);
      }

      failed(source, verdict.reason ?? 'No data arrived within the time budget.');
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
