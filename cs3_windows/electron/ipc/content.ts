import { handle, handleRaw } from './channel.ts';
import type { RegisterHandlers } from './services.ts';
import type { SearchOptions } from '../../src/types/api';

/**
 * Search, browse, metadata, subtitles and search history.
 *
 * Moved out of `main.ts` unchanged; see `services.ts` for why the dependencies
 * are named rather than reached for.
 */
export const registerContentHandlers: RegisterHandlers = (services) => {
  const {
    contentService,
    pluginManager,
    searchHistory,
    searchSuggestions,
    subtitles,
  } = services;

  // --- content -------------------------------------------------------------------
  handle(
    'api:searchAll',
    async (query: string, options?: SearchOptions) => {
      const results = await contentService.search(query, options ?? {});
      // Recorded on success only: a query that failed transport is not something
      // the user asked to remember.
      searchHistory.record(query, results.length);
      return { results };
    },
    { results: [] }
  );

  /**
   * Opens a search and returns immediately.
   *
   * The renderer renders from the returned snapshot, not from a completed search;
   * every source that answers afterwards arrives as a `search:update`. Fifteen
   * extension providers are fifteen independent scrapes, and the slowest of them
   * should not decide when the first result becomes visible.
   */
  handle(
    'search:start',
    async (query: string, options?: SearchOptions) => {
      const snapshot = contentService.startSearch(query, options ?? {});
      /**
       * Recorded now, not when the search finishes.
       *
       * History is an ordering of *when you searched*, and a streaming search
       * finishes seconds later — long after the user has looked at the list and
       * formed an opinion about whether it is in the right order. Recording on
       * completion meant the newest query was missing from the list for as long
       * as the slowest provider took, which reads as the order being random.
       * The result count is filled in by the notifier once it is known.
       */
      searchHistory.record(query);
      return { snapshot };
    },
    { snapshot: null }
  );

  handle('search:cancel', async (id: string) => ({ snapshot: contentService.cancelSearch(id) }), {
    snapshot: null,
  });

  /**
   * Title autocomplete. Called on every debounced keystroke, so it never rejects
   * and never blocks — an empty list is an acceptable answer for a search box.
   */
  handle('api:suggest', async (query: string) => ({ suggestions: await searchSuggestions.suggest(query) }), {
    suggestions: [],
  });

  /**
   * The provider's own subtitles, in the shape the catalogue results use.
   *
   * Labelled with their origin because the two sets are not interchangeable: a
   * provider's track belongs to the exact release being played, where an
   * OpenSubtitles match is for the work in general and is routinely out of sync
   * with a particular cut. The viewer choosing between them needs to know which
   * is which.
   */
  async function providerSubtitles(mediaUrl?: string) {
    if (!mediaUrl?.startsWith('cs3ext://')) return [];
    const entries = await pluginManager.loadSubtitles(mediaUrl).catch(() => []);
    return entries.map((entry) => ({
      id: `provider:${entry.url}`,
      lang: entry.lang,
      langName: `${entry.lang} (from this provider)`,
      url: entry.url,
    }));
  }

  /**
   * Subtitles for the thing being played, from both places they come from.
   *
   * OpenSubtitles is keyed by IMDb id, which extension-sourced content routinely
   * does not have — a provider scraped a site, and the site never printed one. But
   * the provider itself frequently *did* offer subtitles: `loadLinks` yields them
   * alongside the links, upstream collects them, and this app was throwing them
   * away. `PluginManager.loadSubtitles` existed and nothing called it, so a film
   * played from an extension had no subtitles available at all even when the
   * provider had handed them over in the same response as the video.
   *
   * Provider subtitles lead: they belong to the exact release being played, where
   * an OpenSubtitles match is for the work in general and may be out of sync.
   */
  handle(
    'subtitles:search',
    async (imdbIdOrQuery: string, season?: number, episode?: number, mediaUrl?: string) => {
      const trimmed = imdbIdOrQuery?.trim() ?? '';
      const [providerResults, fromCatalogue] = await Promise.all([
        providerSubtitles(mediaUrl),
        trimmed
          ? /^tt\d+$/i.test(trimmed)
            ? subtitles.search(trimmed, season, episode).catch(() => [])
            : subtitles
                .searchByTitle(trimmed, season, episode)
                .then((r) => r.results)
                .catch(() => [])
          : Promise.resolve([]),
      ]);

      return { results: [...providerResults, ...fromCatalogue] };
    },
    { results: [] }
  );

  /**
   * Searches subtitles by custom movie/series title or IMDb id, returning the matched title and IMDb id.
   */
  handle(
    'subtitles:searchByTitle',
    async (query: string, season?: number, episode?: number, mediaUrl?: string) => {
      const trimmed = query?.trim() ?? '';
      const empty = { results: [], imdbId: undefined, matchedTitle: undefined };
      if (!trimmed && !mediaUrl?.startsWith('cs3ext://')) return empty;

      const [providerResults, titleResult] = await Promise.all([
        providerSubtitles(mediaUrl),
        trimmed
          ? subtitles.searchByTitle(trimmed, season, episode).catch(() => empty)
          : Promise.resolve(empty),
      ]);

      return {
        imdbId: titleResult.imdbId,
        matchedTitle: titleResult.matchedTitle,
        results: [...providerResults, ...titleResult.results],
      };
    },
    { results: [], imdbId: undefined, matchedTitle: undefined }
  );

  /**
   * Fetches one subtitle as WebVTT text.
   *
   * The renderer cannot fetch these directly — third-party origin, and the files
   * are SubRip, which `<track>` rejects. Conversion happens here and the renderer
   * turns the returned text into a blob URL.
   */
  handle('subtitles:fetch', async (url: string) => ({ vtt: await subtitles.fetchAsVtt(url) }), {
    vtt: '',
  });

  handleRaw('api:getSearchHistory', () => searchHistory.list());
  handleRaw('api:removeSearchHistory', (query: string) => searchHistory.remove(query));
  handleRaw('api:clearSearchHistory', () => searchHistory.clear());
};
