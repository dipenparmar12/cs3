import { handle, handleRaw } from './channel.ts';
import type { RegisterHandlers } from './services.ts';
import type { StoredSource } from '../../src/types/library';
import { continueWatchingEnabled, setContinueWatchingEnabled } from '../cs3/continueWatching';
import { DEFAULT_PROVIDER_ID, } from '../cs3/homeProviderRegistry';
import { LibraryStore, canonicalKey, torrentResultToStoredSource } from '../cs3/libraryStore';

/**
 * Which catalogue the home screen comes from, and whether it is answering.
 *
 * Moved out of `main.ts` unchanged; see `services.ts` for why the dependencies
 * are named rather than reached for.
 */
export const registerHomeHandlers: RegisterHandlers = (services) => {
  const {
    contentService,
    datastore,
    discovery,
    homeProviders,
    libraryStore,
    logger,
    getWindow,
  } = services;

  // --- the home screen's catalogue source ----------------------------------------
  /**
   * `home:*` is the surface over `HomeProviderRegistry`.
   *
   * `check` is separate from `list` and forced, because "is it working *now*" is
   * a different question from "what is available" and the answer to the first is
   * cached for ten minutes. Someone who has just pasted an addon URL wants it
   * probed, not told what a probe said before the URL existed.
   */
  handle(
    'home:listProviders',
    async (force?: boolean) => {
      return {
        providers: await homeProviders.summaries(Boolean(force)),
        selected: homeProviders.selectedId,
        tmdbKeySet: homeProviders.hasTmdbKey(),
        customUrl: homeProviders.customCatalogUrl(),
      };
    },
    { providers: [], selected: DEFAULT_PROVIDER_ID, tmdbKeySet: false, customUrl: '' }
  );

  /**
   * Selecting refuses a provider that is not answering, and says why.
   *
   * Accepting it and letting the home screen come up empty would make the health
   * check a decoration. The refusal can name the cause; the empty screen could
   * not.
   */
  handle(
    'home:selectProvider',
    async (id: string) => {
      const result = await homeProviders.select(id);
      if (result.ok) {
        // The cache is keyed by provider, so the old rows are not wrong — they
        // are someone else's catalogue, and leaving them would keep the previous
        // provider on screen until each row aged out six hours later.
        discovery.invalidateForProviderChange();
        getWindow()?.webContents.send('discover:invalidated');
      }
      // Carries the registry's own verdict: an unhealthy provider is *refused*
      // rather than selected, and that refusal names the cause.
      return { ...result };
    },
    // Read lazily, so a failed selection reports the provider still in force
    // rather than the one that could not be adopted.
    () => ({ id: homeProviders.selectedId })
  );

  handle(
    'home:setTmdbKey',
    async (key: string) => {
      homeProviders.setTmdbKey(key);
      // Probed immediately: a key is pasted in order to find out whether it
      // works, and making the user hunt for a refresh button to learn that is a
      // gap they will read as the field not saving.
      return { health: await homeProviders.checkOne('tmdb', true) };
    },
    { health: null }
  );

  handle(
    'home:setCustomCatalogUrl',
    async (url: string) => {
      homeProviders.setCustomCatalogUrl(url);
      return { health: url.trim() ? await homeProviders.checkOne('custom', true) : null };
    },
    { health: null }
  );

  handle('library:getContinueWatchingEnabled', async () => ({
    enabled: continueWatchingEnabled(datastore),
  }));

  handle('library:setContinueWatchingEnabled', async (enabled: boolean) => {
    setContinueWatchingEnabled(datastore, enabled);
    logger.info('library', 'continue_watching_visibility_changed', { enabled });
    // Nothing is deleted either way. The history is what the library is built on
    // — resume points, the played-source records, the ranking — and hiding a row
    // is not consent to discard any of it.
    return { enabled };
  });

  handleRaw('library:clearProgress', async (key: string, season?: number, episode?: number) => libraryStore.clearProgress(key, season, episode));

  handleRaw('library:rememberSource', async (input: Parameters<LibraryStore['rememberSource']>[0]) => {
    libraryStore.rememberSource(input);
  });

  handleRaw('library:recallSource', async (key: string, season?: number, episode?: number) => libraryStore.recallSource(key, season, episode));

  handleRaw('library:export', async () => libraryStore.exportAll());

  handleRaw('library:import', async (payload: Parameters<LibraryStore['importAll']>[0]) => libraryStore.importAll(payload));

  handleRaw('library:setSources', async (key: string, sources: StoredSource[]) => libraryStore.setSources(key, sources));

  handleRaw('library:getSources', async (key: string) => libraryStore.getStoredSources(key));

  handle(
    'library:refreshSources',
    async (mediaUrl: string, title: string, year?: number, season?: number, episode?: number) => {
      try {
        const result = await contentService.getSources(
          { mediaUrl, titleOverride: title, season, episode },
          undefined,
          { bypassCache: true }
        );
        const key = canonicalKey(title, year);
        const stored = result.sources.map(torrentResultToStoredSource);
        libraryStore.setSources(key, stored);
        return { sources: result.sources, storedSources: stored };
      } catch (error: any) {
        // Keeps a local catch for its message precedence: a thrown non-Error
        // reports the sentence below, where the shared helper would stringify
        // whatever was thrown.
        return {
          ok: false,
          error: error?.message || 'Failed to refresh sources',
          sources: [],
          storedSources: [],
        };
      }
    }
  );
};
