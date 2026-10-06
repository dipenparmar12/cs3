/**
 * Unified models and interfaces for on-demand movie reviews, explanations,
 * recaps, analysis and related media.
 *
 * Implements PRD: 2026-10-06-On-Demand Movie Reviews, Explanations and Related Media.md
 * (§20 & §21).
 */

export type RelatedMediaType =
  | 'video'
  | 'article'
  | 'review'
  | 'interview'
  | 'discussion';

export type RelatedMediaCategory =
  | 'review'
  | 'explanation'
  | 'recap'
  | 'analysis'
  | 'interview'
  | 'discussion'
  | 'other';

export interface RelatedMediaSearchRequest {
  title: string;
  originalTitle?: string;
  year?: number;
  season?: number;
  episode?: number;
  type?: RelatedMediaCategory | 'all';
  forceRefresh?: boolean;
  cachedOnly?: boolean;
}

export interface RelatedMediaResult {
  id: string;
  title: string;
  description?: string;
  source: {
    provider: string; // e.g. 'YouTube', 'Dailymotion', 'Public Web'
    url: string;
    externalId?: string;
  };
  type: RelatedMediaType;
  category: RelatedMediaCategory;
  thumbnailUrl?: string;
  durationSeconds?: number;
  publishedAt?: string;
  creator?: {
    name?: string;
    id?: string;
  };
}

export interface RelatedMediaProvider {
  id: string;
  name: string;
  search(request: RelatedMediaSearchRequest, signal?: AbortSignal): Promise<RelatedMediaResult[]>;
}

export interface RelatedMediaResponse {
  ok: boolean;
  results: RelatedMediaResult[];
  cached?: boolean;
  error?: string;
}
