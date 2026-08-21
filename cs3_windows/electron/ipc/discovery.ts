import { handle, } from './channel.ts';
import type { RegisterHandlers } from './services.ts';
import { failure as fail } from './envelope.ts';
import { DiscoveryService } from '../cs3/discovery';
import { TitleEnricher } from '../cs3/titleEnricher';

/**
 * The home screen's catalogue rows, title enrichment, and provider provenance.
 *
 * Moved out of `main.ts` unchanged; see `services.ts` for why the dependencies
 * are named rather than reached for.
 */
export const registerDiscoveryHandlers: RegisterHandlers = (services) => {
  const {
    bookmarks,
    discovery,
    libraryStore,
    pluginManager,
    titleEnricher,
  } = services;

  // --- discovery (the dynamic home screen) ---------------------------------------
  /**
   * The home screen's sections.
   *
   * Genres are derived from what the user has watched, on this machine, and are
   * used only to choose which public catalogue URL to fetch. Nothing about the
   * user is sent anywhere: the catalogue is asked "what is popular in Horror",
   * not "what should this person watch".
   */
  handle(
    'discover:sections',
    async (options?: { includeAnime?: boolean }) => {
      const genres = topGenresFromHistory();
      const sections = await discovery.sections({ genres, includeAnime: options?.includeAnime });
      return { sections, personalGenres: genres };
    },
    { sections: [], personalGenres: [] }
  );

  handle(
    'discover:more',
    async (section: string, skip: number) => ({ items: await discovery.more(section as never, skip) }),
    { items: [] }
  );

  /** Forces the next fetch to hit the network. The "refresh" button. */
  handle('discover:refresh', () => {
    discovery.invalidate();
    return {};
  });

  /**
   * The genres this user actually watches, most-watched first.
   *
   * Read from the library rather than from a preferences screen nobody fills in.
   * Capped at three sections so the home page does not become a list of one
   * genre per film they have ever opened.
   */
  function topGenresFromHistory(): string[] {
    try {
      const tally = new Map<string, number>();
      for (const entry of libraryStore.getEntries()) {
        const bookmark = bookmarks.get(entry.urls[0] ?? '');
        for (const genre of bookmark?.genres ?? []) {
          if (!DiscoveryService.GENRES.includes(genre)) continue;
          tally.set(genre, (tally.get(genre) ?? 0) + 1);
        }
      }
      return [...tally.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([genre]) => genre);
    } catch {
      return [];
    }
  }

  /**
   * Normalises a provider's release name to its catalogue record.
   *
   * Exposed as its own channel rather than folded into search, because the
   * caller decides when it is worth the round trips — a grid of two hundred rows
   * does not want two hundred lookups before it draws anything.
   */
  handle('discover:enrich', async (results: Parameters<TitleEnricher['enrichAll']>[0], limit?: number) => {
    try {
      return { results: await titleEnricher.enrichAll(results, { limit }) };
    } catch (error) {
      // The unenriched rows are the fallback, so this one keeps its own catch:
      // the payload is the *input*, which the shared helper cannot see.
      return { ...fail(error), results };
    }
  });

  handle(
    'discover:resolveTitle',
    async (rawTitle: string, hint?: { type?: never; year?: number }) => ({
      metadata: await titleEnricher.resolve(rawTitle, hint ?? {}),
    }),
    { metadata: null }
  );

  /**
   * Where a provider came from, for showing on the detail page.
   *
   * A result carries its provider's name and nothing else, so a page could say
   * which site served it and never whose extension or whose repository that was
   * — which is exactly what someone needs when a provider starts returning
   * nothing and they want to know what to turn off.
   */
  handle('api:getProviderProvenance', (providerName: string) => {
    try {
      return { provenance: pluginManager.provenanceOf(providerName) };
    } catch (error) {
      // Keeps its own catch: the fallback names the provider that was asked for,
      // which is an argument the shared helper never sees.
      return { ...fail(error), provenance: { provider: providerName } };
    }
  });

  /**
   * The same mapping for a whole source list, in one call.
   *
   * `provenanceOf` reads two in-memory Maps, so the cost here is entirely the IPC
   * round trip — which is why thirty rows asking individually was worth removing.
   * An unknown name still answers, with just itself: a provider that has since
   * been uninstalled must still be attributable in a list captured before it was.
   */
  handle(
    'api:getProviderProvenanceMap',
    (providerNames: string[]) => {
      const provenance: Record<
        string,
        { provider: string; repositoryName?: string; extensionName?: string }
      > = {};
      for (const name of new Set((providerNames ?? []).filter(Boolean))) {
        const record = pluginManager.provenanceOf(name);
        provenance[name] = {
          provider: record.provider,
          repositoryName: record.repositoryName,
          extensionName: record.extensionName,
        };
      }
      return { provenance };
    },
    { provenance: {} }
  );
};
