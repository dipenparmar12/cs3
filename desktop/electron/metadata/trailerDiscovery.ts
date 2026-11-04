/**
 * Unified trailer and promotional video discovery.
 *
 * Implements PRD-56 §3-4: Chip-gated discovery across public video platforms.
 * Discovers trailers, teasers, promotional clips, and featurettes for any title,
 * franchise, keyword, or typo query without requiring pre-resolution to an exact
 * catalogue item.
 */

import type { TitleVideo, TitleVideoKind } from '../../src/types/metadata.ts';
import { orderVideos } from './videoTitles.ts';
import { searchYouTubeTrailers } from './youtube.ts';

export interface TrailerDiscoveryOptions {
  maxResults?: number;
  officialOnly?: boolean;
  kind?: TitleVideoKind;
  signal?: AbortSignal;
}

const PROMOTIONAL_KEYWORDS =
  /\b(trailer|teaser|clip|scene|bts|behind[- ]the[- ]scenes|making[- ]of|featurette|promo|tv spot|sneak peek|interview|announcement)\b/i;

/**
 * Plans the search queries to issue to public video providers.
 *
 * If the user's query already contains a promotional keyword (e.g. "Dune teaser",
 * "Stranger Things season 5 trailer", "Batman behind the scenes"), we search that
 * exact intent directly.
 *
 * If the user's query is an unadorned title or phrase (e.g. "Spider-Man", "Interstellar"),
 * we plan a primary trailer query and a secondary teasers/clips query to discover
 * a comprehensive promotional suite.
 */
export function planTrailerQueries(query: string): string[] {
  const clean = query.trim();
  if (!clean) return [];

  if (PROMOTIONAL_KEYWORDS.test(clean)) {
    return [clean];
  }

  return [`${clean} trailer`, `${clean} teaser clip`];
}

/**
 * Filters and deduplicates discovered videos according to user criteria.
 */
export function filterAndRankTrailers(
  videos: TitleVideo[],
  options: {
    officialOnly?: boolean;
    kind?: TitleVideoKind;
  } = {}
): TitleVideo[] {
  let list = videos;

  if (options.officialOnly) {
    list = list.filter((v) => v.official === true);
  }

  if (options.kind) {
    list = list.filter((v) => v.kind === options.kind);
  }

  return orderVideos(list);
}

/**
 * Discovers open trailers, teasers, and promotional videos from public platforms.
 */
export async function discoverTrailers(
  query: string,
  options: TrailerDiscoveryOptions = {}
): Promise<TitleVideo[]> {
  const queries = planTrailerQueries(query);
  if (queries.length === 0) return [];

  const maxTotal = options.maxResults ?? 24;
  const perQueryMax = Math.max(12, Math.ceil(maxTotal / queries.length));

  const results = await Promise.allSettled(
    queries.map((q) =>
      searchYouTubeTrailers(q, {
        maxResults: perQueryMax,
        signal: options.signal,
      })
    )
  );

  const seen = new Set<string>();
  const combined: TitleVideo[] = [];

  for (const res of results) {
    if (res.status === 'fulfilled') {
      for (const video of res.value) {
        if (!seen.has(video.id)) {
          seen.add(video.id);
          combined.push(video);
        }
      }
    }
  }

  return filterAndRankTrailers(combined, options);
}
