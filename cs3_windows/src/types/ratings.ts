/**
 * Multi-source media ratings model (PRD: Multi-Source Media Ratings in Details View).
 *
 * Supported rating sources:
 * - IMDb (0-10 scale, e.g. 9.0/10 + vote count)
 * - Rotten Tomatoes (Critics Tomatometer % and Audience % where available)
 * - Metacritic (Metascore 0-100, e.g. 84/100 + User score 0-10)
 * - TMDB (0-10 scale, e.g. 8.5/10 + vote count)
 */

export type RatingSourceId = 'imdb' | 'rottenTomatoes' | 'metacritic' | 'tmdb';

export interface MediaRating {
  source: RatingSourceId;
  score: number;
  maxScore: number;
  displayValue: string;
  voteCount?: number;
  criticsScore?: number;
  audienceScore?: number;
  userScore?: number;
  url?: string;
  fetchedAt: number;
}

export interface CanonicalMediaIdentity {
  imdbId?: string;
  tmdbId?: number;
  title: string;
  originalTitle?: string;
  year?: number;
  type?: 'movie' | 'series' | string;
  season?: number;
  episode?: number;
}

export interface MediaRatingsResult {
  ok: boolean;
  ratings: MediaRating[];
  cached?: boolean;
  error?: string;
}
