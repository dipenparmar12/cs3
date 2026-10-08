import type {
  CanonicalMediaIdentity,
  MediaRating,
  MediaRatingsResult,
  RatingFetchContext,
  RatingProvider,
} from '../../../src/types/ratings.ts';
import { RatingCache, buildRatingCacheKey } from './ratingCache.ts';
import { IMDbRatingProvider } from './providers/imdbProvider.ts';
import { RottenTomatoesRatingProvider } from './providers/rottenTomatoesProvider.ts';
import { MetacriticRatingProvider } from './providers/metacriticProvider.ts';
import { TMDBRatingProvider } from './providers/tmdbProvider.ts';
import { fetchWikidataReviewStatements } from './providers/wikidataHelper.ts';
import { fetchJson } from '../../torrent/http.ts';
import type { DatastoreManager } from '../../datastore.ts';

const CINEMETA_BASE = 'https://v3-cinemeta.strem.io';
const TMDB_KEY = 'home_tmdb_api_key';

export class MediaRatingService {
  private readonly cache = new RatingCache();
  private readonly providers: RatingProvider[];
  private datastore: DatastoreManager | null = null;
  private readonly inFlight = new Map<string, Promise<MediaRating[]>>();

  constructor(providers?: RatingProvider[]) {
    this.providers = providers ?? [
      new IMDbRatingProvider(),
      new RottenTomatoesRatingProvider(),
      new MetacriticRatingProvider(),
      new TMDBRatingProvider(),
    ];
  }

  public setDirectory(dir: string): void {
    this.cache.setDirectory(dir);
  }

  /** Empties the ratings cache; the next request asks the providers again. */
  public clearCache(): void {
    this.cache.clear();
  }

  public setDatastore(datastore: DatastoreManager): void {
    this.datastore = datastore;
  }

  /**
   * Retrieves ratings for a media item.
   * If cached and valid, returns cached ratings immediately.
   * If stale, returns cached ratings immediately and triggers background refresh.
   * If missing or forceRefresh, fetches fresh ratings across all providers in parallel.
   */
  public async getRatings(
    identity: CanonicalMediaIdentity,
    options: { forceRefresh?: boolean } = {}
  ): Promise<MediaRatingsResult> {
    if (!identity.title && !identity.imdbId && !identity.tmdbId) {
      return { ok: false, ratings: [], error: 'No media identity provided' };
    }

    const key = buildRatingCacheKey(identity);

    if (!options.forceRefresh) {
      const { entry, isStale } = this.cache.get(identity);
      if (entry && entry.ratings.length > 0) {
        if (isStale) {
          // Stale-while-revalidate: background refresh
          void this.fetchAndCache(identity, key).catch(() => {});
        }
        return { ok: true, ratings: entry.ratings, cached: true };
      }
    }

    try {
      const ratings = await this.fetchAndCache(identity, key);
      return { ok: true, ratings, cached: false };
    } catch (error) {
      const fallback = this.cache.get(identity).entry?.ratings ?? [];
      return {
        ok: fallback.length > 0,
        ratings: fallback,
        cached: true,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  public async refreshRatings(identity: CanonicalMediaIdentity): Promise<MediaRatingsResult> {
    return this.getRatings(identity, { forceRefresh: true });
  }

  private async fetchAndCache(
    identity: CanonicalMediaIdentity,
    key: string
  ): Promise<MediaRating[]> {
    const existing = this.inFlight.get(key);
    if (existing) {
      return existing;
    }

    const task = (async () => {
      const context: RatingFetchContext = {};

      // 1. Shared Wikidata query if IMDb ID is available
      if (identity.imdbId && /^tt\d+/i.test(identity.imdbId.trim())) {
        context.wikidataStatements = fetchWikidataReviewStatements(identity.imdbId.trim());
      }

      // 2. Shared Cinemeta meta query if IMDb ID is available
      if (identity.imdbId && /^tt\d+/i.test(identity.imdbId.trim())) {
        const type =
          identity.type === 'series' || identity.type === 'tv' ? 'series' : 'movie';
        context.cinemetaMeta = fetchJson<{ meta?: Record<string, unknown> }>(
          `${CINEMETA_BASE}/meta/${type}/${identity.imdbId.trim()}.json`,
          { timeoutMs: 8_000 }
        )
          .then((res) => res.meta ?? null)
          .catch(() => null);
      }

      // 3. TMDB API key from datastore
      if (this.datastore) {
        context.tmdbApiKey = this.datastore.getString(TMDB_KEY, '', true).trim() || undefined;
      }

      // 4. Provider failure isolation: Promise.allSettled across all adapters
      const outcomes = await Promise.allSettled(
        this.providers.map((p) => p.fetch(identity, context))
      );

      const ratings: MediaRating[] = [];
      for (const outcome of outcomes) {
        if (outcome.status === 'fulfilled' && outcome.value) {
          ratings.push(outcome.value);
        }
      }

      // Ensure stable ordering: IMDb, Rotten Tomatoes, Metacritic, TMDB
      const order: Record<string, number> = {
        imdb: 0,
        rottenTomatoes: 1,
        metacritic: 2,
        tmdb: 3,
      };
      ratings.sort((a, b) => (order[a.source] ?? 99) - (order[b.source] ?? 99));

      if (ratings.length > 0) {
        this.cache.set(identity, ratings);
      }

      return ratings;
    })();

    this.inFlight.set(key, task);
    try {
      return await task;
    } finally {
      this.inFlight.delete(key);
    }
  }
}

export const mediaRatingService = new MediaRatingService();
