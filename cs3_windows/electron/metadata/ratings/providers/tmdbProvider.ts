import type {
  CanonicalMediaIdentity,
  MediaRating,
  RatingFetchContext,
  RatingProvider,
} from '../../../../src/types/ratings.ts';
import { fetchJson } from '../../../torrent/http.ts';

interface TmdbItemResponse {
  id?: number;
  vote_average?: number;
  vote_count?: number;
}

interface TmdbFindResponse {
  movie_results?: TmdbItemResponse[];
  tv_results?: TmdbItemResponse[];
}

export class TMDBRatingProvider implements RatingProvider {
  public readonly id = 'tmdb' as const;
  public readonly name = 'TMDB';

  public async fetch(
    identity: CanonicalMediaIdentity,
    context?: RatingFetchContext
  ): Promise<MediaRating | null> {
    const isSeries = identity.type === 'series' || identity.type === 'tv';
    const apiKey = context?.tmdbApiKey?.trim();

    let tmdbId = identity.tmdbId;

    // If tmdbId not present, try finding it from Cinemeta meta if available
    if (!tmdbId && context?.cinemetaMeta) {
      try {
        const meta = await context.cinemetaMeta;
        if (typeof meta?.moviedb_id === 'number') {
          tmdbId = meta.moviedb_id;
        }
      } catch {
        // Ignore
      }
    }

    if (!apiKey) {
      // Without API key, TMDB cannot be queried directly per API terms
      return null;
    }

    try {
      let voteAverage: number | undefined;
      let voteCount: number | undefined;

      if (tmdbId) {
        const media = isSeries ? 'tv' : 'movie';
        const url = `https://api.themoviedb.org/3/${media}/${tmdbId}?api_key=${encodeURIComponent(apiKey)}`;
        const data = await fetchJson<TmdbItemResponse>(url, { timeoutMs: 10_000 });
        if (typeof data.vote_average === 'number' && data.vote_average > 0) {
          voteAverage = data.vote_average;
          voteCount = data.vote_count;
        }
      } else if (identity.imdbId) {
        const url = `https://api.themoviedb.org/3/find/${encodeURIComponent(identity.imdbId)}?api_key=${encodeURIComponent(apiKey)}&external_source=imdb_id`;
        const data = await fetchJson<TmdbFindResponse>(url, { timeoutMs: 10_000 });
        const res = isSeries ? data.tv_results?.[0] : data.movie_results?.[0];
        if (res && typeof res.vote_average === 'number' && res.vote_average > 0) {
          voteAverage = res.vote_average;
          voteCount = res.vote_count;
          if (res.id) tmdbId = res.id;
        }
      }

      if (voteAverage === undefined) {
        return null;
      }

      const score = Math.round(voteAverage * 10) / 10;
      const mediaPath = isSeries ? 'tv' : 'movie';
      const url = tmdbId ? `https://www.themoviedb.org/${mediaPath}/${tmdbId}` : undefined;

      return {
        source: 'tmdb',
        score,
        maxScore: 10,
        displayValue: `${score.toFixed(1)}/10`,
        voteCount,
        url,
        fetchedAt: Date.now(),
      };
    } catch {
      return null;
    }
  }
}
