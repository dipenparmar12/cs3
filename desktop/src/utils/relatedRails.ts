import type { SearchResponse } from '../types/api.ts';
import type { FranchiseEntry } from '../types/metadata.ts';
import { normaliseTitleForMatch } from '../../electron/torrent/releaseParser.ts';

/**
 * "More like this" without the titles the page already shows (PRD §120.6).
 *
 * A provider's recommendation row routinely contains the title being viewed
 * and the very sequels the franchise rail lists in order a few hundred pixels
 * above — so the same poster appeared twice, once as "part of this series" and
 * once as "you might also like", which says neither thing clearly. The
 * franchise rail keeps those (it knows the order); the recommendations keep
 * what is left. Providers also repeat a title across their own rows, so one
 * card per address.
 *
 * A match is an IMDb id, or the same normalised title with years that do not
 * disagree (a missing year cannot contradict one). Normalised with the search
 * merge's own rule, so "The Batman" and "Batman, The" are one title here too.
 */
export function distinctRecommendations(
  recommendations: readonly SearchResponse[],
  shown: {
    current: { name: string; year?: number; imdbId?: string };
    franchise?: readonly FranchiseEntry[];
  }
): SearchResponse[] {
  const known = [
    { title: shown.current.name, year: shown.current.year, imdbId: shown.current.imdbId },
    ...(shown.franchise ?? []).map((entry) => ({ title: entry.title, year: entry.year, imdbId: entry.imdbId })),
  ].map((item) => ({ ...item, title: item.title ? normaliseTitleForMatch(item.title) : '' }));

  const alreadyShown = (item: SearchResponse) => {
    const title = normaliseTitleForMatch(item.name ?? '');
    return known.some((other) => {
      if (item.imdbId && other.imdbId) return item.imdbId === other.imdbId;
      if (!title || title !== other.title) return false;
      return item.year === undefined || other.year === undefined || item.year === other.year;
    });
  };

  const seen = new Set<string>();
  return recommendations.filter((item) => {
    const key = `${item.apiName}:${item.url}`;
    if (seen.has(key) || alreadyShown(item)) return false;
    seen.add(key);
    return true;
  });
}
