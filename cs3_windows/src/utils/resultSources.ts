/**
 * Which providers a result row came from — its own, then every alternate.
 *
 * A merged row is one work found by several providers, and all of them are a
 * real route to it: the card says how many, the Source filter offers each.
 */
import type { SearchResponse } from '../types/api';

export function resultSources(item: Pick<SearchResponse, 'apiName' | 'alternates'>): string[] {
  const names = new Set<string>();
  if (item.apiName) names.add(item.apiName);
  for (const alternate of item.alternates ?? []) {
    if (alternate?.apiName) names.add(alternate.apiName);
  }
  return [...names];
}
