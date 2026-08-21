import { handle, handleRaw } from './channel.ts';
import type { RegisterHandlers } from './services.ts';
import type { SitePlugin } from '../../src/types/plugin';
import type { UpdateSettings } from '../cs3/extensionUpdater';
import type { SearchScope } from '../searchScope';

/**
 * Repositories, archives, providers, and what a search is allowed to ask.
 *
 * Moved out of `main.ts` unchanged; see `services.ts` for why the dependencies
 * are named rather than reached for.
 */
export const registerExtensionHandlers: RegisterHandlers = (services) => {
  const {
    bootstrap,
    contentService,
    extensionUpdater,
    pluginManager,
  } = services;

  // --- extensions ----------------------------------------------------------------
  /** Adult repositories are absent from this list until the user opts in. */
  handleRaw('extension:getOfficialRepositories', async () => bootstrap.visibleRepositories());

  handleRaw('extension:getBootstrapProgress', async () => bootstrap.getProgress());

  /** How many extension providers a search asks at once. */
  handleRaw('search:getConcurrency', async () => ({
    value: pluginManager.searchConcurrency(),
    ...pluginManager.searchConcurrencyBounds(),
  }));

  handleRaw('search:setConcurrency', async (value: number) => ({
    value: pluginManager.setSearchConcurrency(value),
    ...pluginManager.searchConcurrencyBounds(),
  }));

  handleRaw('extension:getAdultAllowed', async () => bootstrap.isAdultAllowed());

  /**
   * Turning adult content off must take effect at once, not at next launch: the
   * provider registry is re-read so anything already loaded stops being offered.
   */
  handle('extension:setAdultAllowed', async (enabled: boolean) => {
    const value = bootstrap.setAdultAllowed(Boolean(enabled));
    return { enabled: value, providers: await pluginManager.listEnabledProviders() };
  });

  handle(
    'extension:fetchRepository',
    async (repoUrl: string) => {
      return { repository: await pluginManager.fetchRepository(repoUrl) };
    },
    { repository: null }
  );

  handleRaw('extension:analyzePlugin', async (plugin: SitePlugin) => pluginManager.analyzePlugin(plugin));

  handleRaw('extension:installPlugin', async (plugin: SitePlugin, repoUrl?: string) => pluginManager.installPlugin(plugin, repoUrl));

  handleRaw('extension:uninstallPlugin', async (internalName: string) => pluginManager.uninstallPlugin(internalName));

  handleRaw('extension:getInstalledRepositories', async () => pluginManager.getInstalledRepositories());

  /**
   * Removing a repository now uninstalls the extensions it brought with it, so the
   * reply reports both — the caller needs to be able to say "removed, and 12
   * extensions with it" rather than implying nothing else changed.
   */
  handleRaw('extension:removeRepository', async (repoUrl: string) => {
    const removedExtensions = pluginManager.removeRepository(repoUrl);
    return { repositories: pluginManager.getInstalledRepositories(), removedExtensions };
  });

  /**
   * Switch a repository or extension off without deleting anything.
   *
   * The reversible half of the pair above, and the one the UI offers first: a
   * bundled repository the user does not want is silenced instantly and can be
   * brought back without re-downloading ~170 archives.
   */
  handleRaw('extension:setRepositoryEnabled', async (repositoryId: string, enabled: boolean) => pluginManager.setRepositoryEnabled(repositoryId, enabled));

  handleRaw('extension:setRepositoriesEnabled', async (repositoryIds: string[], enabled: boolean) => pluginManager.setRepositoriesEnabled(repositoryIds, enabled));

  handleRaw('extension:setExtensionEnabled', async (internalName: string, enabled: boolean) => pluginManager.setExtensionEnabled(internalName, enabled));

  handleRaw('extension:setExtensionsEnabled', async (internalNames: string[], enabled: boolean) => pluginManager.setExtensionsEnabled(internalNames, enabled));

  handleRaw('extension:getInstalledPlugins', async () => pluginManager.getInstalledPlugins());

  // --- provider selection --------------------------------------------------------
  /**
   * Loads plugins if needed so the provider list is real rather than empty.
   *
   * One `.cs3` commonly registers several providers, and which ones it registers
   * is only knowable by running its `load()`. There is no manifest to read them
   * from — so the list cannot be built without loading.
   */
  handle(
    'extension:getProviders',
    async () => {
      await pluginManager.loadProviders();
      return {
        providers: pluginManager.getProviders(),
        disabled: pluginManager.getDisabledProviders(),
      };
    },
    { providers: [], disabled: [] }
  );

  handleRaw('extension:setProviderEnabled', async (name: string, enabled: boolean) => pluginManager.setProviderEnabled(name, enabled));

  /** Bulk toggle, so "enable this whole repository" is one call not twenty. */
  handleRaw('extension:setProvidersEnabled', async (names: string[], enabled: boolean) => pluginManager.setProvidersEnabled(names, enabled));

  /**
   * The tree plus every switched-off set, in one reply.
   *
   * They travel together because they are read together: a row's appearance
   * depends on all three levels, and fetching them separately would render a tree
   * against a stale disabled-set for one frame — visible as toggles flickering
   * into place after the list draws.
   */
  handle(
    'extension:getProviderTree',
    async () => {
      await pluginManager.loadProviders();
      return {
        tree: pluginManager.getProviderTree(),
        disabled: pluginManager.getDisabledProviders(),
        disabledExtensions: pluginManager.getDisabledExtensions(),
        disabledRepositories: pluginManager.getDisabledRepositories(),
      };
    },
    { tree: [],
        disabled: [],
        disabledExtensions: [],
        disabledRepositories: [], }
  );

  // --- search scope --------------------------------------------------------------
  /**
   * Everything the scope picker needs to draw itself, in one call.
   *
   * `ensureLoaded` is the whole design here. Which providers an archive registers
   * is only knowable by running it, and running all of them takes minutes on a
   * bootstrapped install — so this used to load them unconditionally and the
   * picker had nothing to show until that finished. Since nothing said so, it
   * simply looked empty, and the only thing that appeared to fix it was running a
   * search: that awaited the very same load, and by the time the user reopened
   * the menu it had completed.
   *
   * Two calls instead of one. The picker asks with `ensureLoaded: false` when it
   * mounts, which answers instantly from whatever is already registered, and with
   * `true` when the user opens it — paying the cost at the moment there is a
   * menu open to show progress in.
   */
  handle(
    'search:getScopeOptions',
    async (ensureLoaded = true) => {
      if (ensureLoaded) await pluginManager.loadProviders();
      return {
        repositories: pluginManager.getProviderTree(),
        disabledProviders: pluginManager.getDisabledProviders(),
        indexers: contentService
          .getRegistry()
          .getConfigs()
          .filter((config) => config.enabled)
          .map((config) => ({ id: config.id, name: config.name })),
        scope: contentService.getScope().get(),
        ready: pluginManager.providersReady(),
        progress: pluginManager.getProviderLoadProgress(),
      };
    },
    { repositories: [],
        disabledProviders: [],
        indexers: [],
        scope: { providers: [], indexers: [] },
        ready: false,
        progress: pluginManager.getProviderLoadProgress(), }
  );

  handleRaw('search:setScope', async (scope: Partial<SearchScope>) => contentService.getScope().set(scope));

  // --- extension updates (over-the-air) ------------------------------------------
  handle(
    'extension:checkUpdates',
    async () => {
      return { result: await extensionUpdater.checkForUpdates() };
    },
    { result: null }
  );

  handleRaw('extension:getCachedUpdates', async () => extensionUpdater.getCachedUpdates());

  handleRaw('extension:update', async (internalName: string) => extensionUpdater.updatePlugin(internalName));

  handleRaw('extension:updateAll', async (internalNames?: string[]) => extensionUpdater.updateAll(internalNames));

  handleRaw('extension:getUpdateSettings', async () => extensionUpdater.getSettings());

  handleRaw('extension:saveUpdateSettings', async (patch: Partial<UpdateSettings>) => extensionUpdater.saveSettings(patch));
};
