import { TvType, type SearchResponse } from '../types/api';

/**
 * Content-type tabs, as CloudStream has on Android.
 *
 * Grouped rather than one per `TvType`: a viewer looking for a series does not
 * distinguish `TvSeries` from `AsianDrama`, and anime is split across three
 * types upstream (`Anime`, `AnimeMovie`, `OVA`) that all mean "anime" to the
 * person reading the screen.
 *
 * `NSFW` is deliberately absent. Adult providers are withdrawn before results
 * are ever built (`PluginManager.enabledProviderNames`), so a tab for it would
 * be empty for everyone who has not opted in — and a category label nobody
 * asked for on the screen of everyone who has not.
 *
 * Shared by the search and home screens so the two cannot drift into offering
 * different names for the same thing.
 */
export const TYPE_TABS: Array<{ id: string; label: string; types: TvType[] }> = [
  { id: 'movie', label: 'Movies', types: [TvType.Movie] },
  { id: 'series', label: 'Series & Shows', types: [TvType.TvSeries, TvType.AsianDrama] },
  { id: 'anime', label: 'Anime', types: [TvType.Anime, TvType.AnimeMovie, TvType.OVA] },
  { id: 'documentary', label: 'Documentaries', types: [TvType.Documentary] },
  { id: 'live', label: 'Live', types: [TvType.Live] },
  { id: 'torrent', label: 'Torrents', types: [TvType.Torrent] },
];

/** Every type a row can be filed under. */
export function typesOf(item: SearchResponse): TvType[] {
  return item.type ? [item.type] : [];
}

export function matchesTab(item: SearchResponse, tabId: string): boolean {
  if (tabId === 'all') return true;
  const tab = TYPE_TABS.find((entry) => entry.id === tabId);
  if (!tab) return true;
  return typesOf(item).some((type) => tab.types.includes(type));
}

/**
 * The tabs worth offering for a set of results, with counts.
 *
 * Tabs that would leave an empty grid are dropped: offering a route to nothing
 * is worse than offering no route at all.
 */
export function tabsFor(items: SearchResponse[]): Array<{ id: string; label: string; count: number }> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const types = typesOf(item);
    for (const tab of TYPE_TABS) {
      if (types.some((type) => tab.types.includes(type))) {
        counts.set(tab.id, (counts.get(tab.id) ?? 0) + 1);
      }
    }
  }
  return TYPE_TABS.filter((tab) => (counts.get(tab.id) ?? 0) > 0).map((tab) => ({
    id: tab.id,
    label: tab.label,
    count: counts.get(tab.id) ?? 0,
  }));
}
