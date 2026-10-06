/**
 * Deduplication and ranking for related media results.
 *
 * Implements PRD 2026-10-06 §10 (Search Result Deduplication) & §22 (Result Ranking).
 */

import type {
  RelatedMediaCategory,
  RelatedMediaResult,
  RelatedMediaSearchRequest,
} from '../../../src/types/relatedMedia.ts';
import { normalizeMediaTitle } from './queryBuilder.ts';

function normalizeUrlKey(url: string): string {
  try {
    const parsed = new URL(url);
    // Strip common tracking parameters
    parsed.searchParams.delete('utm_source');
    parsed.searchParams.delete('utm_medium');
    parsed.searchParams.delete('utm_campaign');
    parsed.searchParams.delete('feature');
    return `${parsed.hostname}${parsed.pathname}?${parsed.searchParams.toString()}`.toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

/**
 * Deduplicates results by externalId, canonical URL, and normalized title.
 */
export function deduplicateRelatedMedia(items: RelatedMediaResult[]): RelatedMediaResult[] {
  const seenUrls = new Set<string>();
  const seenIds = new Set<string>();
  const seenTitles = new Set<string>();
  const out: RelatedMediaResult[] = [];

  for (const item of items) {
    if (item.source.externalId) {
      const extKey = `${item.source.provider}:${item.source.externalId}`.toLowerCase();
      if (seenIds.has(extKey)) continue;
      seenIds.add(extKey);
    }

    const urlKey = normalizeUrlKey(item.source.url);
    if (seenUrls.has(urlKey)) continue;
    seenUrls.add(urlKey);

    const titleKey = normalizeMediaTitle(item.title).toLowerCase();
    if (titleKey && seenTitles.has(titleKey)) continue;
    if (titleKey) seenTitles.add(titleKey);

    out.push(item);
  }

  return out;
}

/**
 * Calculates a relevance score for ranking related media.
 */
export function scoreRelatedMedia(
  item: RelatedMediaResult,
  request: RelatedMediaSearchRequest
): number {
  let score = 0;
  const canonicalTitle = normalizeMediaTitle(request.title || request.originalTitle || '').toLowerCase();
  const itemTitle = item.title.toLowerCase();

  // Exact movie title present in item title
  if (canonicalTitle && itemTitle.includes(canonicalTitle)) {
    score += 40;
  }

  // Release year match
  if (request.year && itemTitle.includes(String(request.year))) {
    score += 15;
  }

  // Season / Episode match for TV
  if (request.season && request.episode) {
    const sStr = `s${String(request.season).padStart(2, '0')}`;
    const eStr = `e${String(request.episode).padStart(2, '0')}`;
    if (itemTitle.includes(sStr) || itemTitle.includes(`season ${request.season}`)) {
      score += 20;
    }
    if (itemTitle.includes(eStr) || itemTitle.includes(`episode ${request.episode}`)) {
      score += 20;
    }
  }

  // If a specific category was requested, prioritize that category
  if (request.type && request.type !== 'all') {
    if (item.category === request.type) {
      score += 35;
    }
  } else {
    // For 'all', prioritize primary intended categories over 'other'
    const categoryWeights: Record<RelatedMediaCategory, number> = {
      explanation: 25,
      review: 25,
      recap: 20,
      analysis: 20,
      interview: 15,
      discussion: 15,
      other: 5,
    };
    score += categoryWeights[item.category] ?? 0;
  }

  // Videos with reasonable review/explanation duration (2m to 60m)
  if (item.durationSeconds) {
    if (item.durationSeconds >= 120 && item.durationSeconds <= 3600) {
      score += 10;
    }
  }

  // Thumbnail presence
  if (item.thumbnailUrl) {
    score += 5;
  }

  return score;
}

/**
 * Deduplicates and sorts related media by relevance.
 */
export function rankRelatedMedia(
  items: RelatedMediaResult[],
  request: RelatedMediaSearchRequest
): RelatedMediaResult[] {
  const deduped = deduplicateRelatedMedia(items);
  return deduped.sort((a, b) => scoreRelatedMedia(b, request) - scoreRelatedMedia(a, request));
}
