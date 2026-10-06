import type {
  RatingSourceId,
  MediaRating,
  CanonicalMediaIdentity,
  MediaRatingsResult,
} from '../../../src/types/ratings.ts';

export type { RatingSourceId, MediaRating, CanonicalMediaIdentity, MediaRatingsResult };

export interface WikidataReviewStatement {
  reviewer?: string;
  reviewerLabel?: string;
  criterion?: string;
  criterionLabel?: string;
  score?: string;
  reviews?: string;
}

export interface RatingFetchContext {
  wikidataStatements?: Promise<WikidataReviewStatement[]>;
  cinemetaMeta?: Promise<Record<string, unknown> | null>;
  tmdbApiKey?: string;
}

export interface RatingProvider {
  readonly id: RatingSourceId;
  readonly name: string;
  fetch(
    identity: CanonicalMediaIdentity,
    context?: RatingFetchContext
  ): Promise<MediaRating | null>;
}
