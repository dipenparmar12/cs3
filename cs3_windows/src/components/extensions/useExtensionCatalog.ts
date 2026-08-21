/**
 * Everything the extensions screen reads and every action it takes.
 *
 * Split out so the views stay renderers. The rule that matters most here is
 * **re-read after every mutation rather than patching local state**: the main
 * process owns the enable cascade — a provider answers only when it, its
 * extension, its repository and the adult gate all allow it — and a screen that
 * predicts the result of a toggle will eventually disagree with what a search
 * will actually ask. When that happens the screen is lying about the app's
 * behaviour, which is worse than a re-render.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProviderTreeRepository, SitePlugin } from '../../types/plugin';

/**
 * The catalogue entry, as `officialRepositories.ts` defines it.
 *
 * Restated structurally rather than imported: this file is renderer code and
 * that module is main-process code. The fields used here are the ones the
 * screen renders; `rawRepoUrl` is the one that matters functionally, because
 * `url` is a project page that returns HTML.
 */
export interface OfficialRepository {
  id: string;
  name: string;
  shortcode?: string;
  description: string;
  url: string;
  rawRepoUrl: string;
  communityUrl?: string;
  category: string;
  language: string;
  iconUrl?: string;
  isInstalled?: boolean;
  bundled?: boolean;
  adult?: boolean;
  verified?: boolean;
}

export interface CatalogState {
  tree: ProviderTreeRepository[];
  /** Installed repository URLs, which is all the main process stores. */
  installedRepositories: string[];
  installedPlugins: SitePlugin[];
  official: OfficialRepository[];
  adultAllowed: boolean;
  loading: boolean;
  error: string | null;
}

/** What `extension:installProgress` actually sends. */
export interface InstallProgress {
  internalName: string;
  name: string;
  step: 'downloading' | 'verifying' | 'analyzing' | 'complete' | 'error';
  percent: number;
  message?: string;
  downloadedBytes?: number;
  totalBytes?: number;
}

const EMPTY: CatalogState = {
  tree: [],
  installedRepositories: [],
  installedPlugins: [],
  official: [],
  adultAllowed: false,
  loading: true,
  error: null,
};

export function useExtensionCatalog() {
  const [state, setState] = useState<CatalogState>(EMPTY);
  const [progress, setProgress] = useState<InstallProgress | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /** Guards against a slow refresh landing after the component has gone. */
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    const api = window.cloudstream;
    if (!api) {
      setState((current) => ({ ...current, loading: false, error: 'Bridge unavailable.' }));
      return;
    }

    try {
      const [treeResponse, repositories, plugins, official, adultAllowed] = await Promise.all([
        api.getProviderTree(),
        api.getInstalledRepositories(),
        api.getInstalledPlugins(),
        api.getOfficialRepositories(),
        api.getAdultAllowed(),
      ]);

      if (!alive.current) return;
      setState({
        tree: treeResponse?.tree ?? [],
        installedRepositories: repositories ?? [],
        installedPlugins: plugins ?? [],
        official: (official ?? []) as unknown as OfficialRepository[],
        adultAllowed: Boolean(adultAllowed),
        loading: false,
        error: treeResponse?.ok === false ? (treeResponse.error ?? null) : null,
      });
    } catch (error) {
      if (!alive.current) return;
      setState((current) => ({
        ...current,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * Real progress, from the main process.
   *
   * `onExtensionInstallProgress` has always existed. The screen this replaces
   * ignored it in favour of a scripted `setTimeout` sequence that announced
   * "Translating DEX bytecode to JVM…" for a fixed 250 ms whether or not that
   * was happening — inventing about half a second of delay per action and
   * describing work it had no knowledge of.
   */
  useEffect(() => {
    const dispose = window.cloudstream?.onExtensionInstallProgress?.((update) => {
      setProgress(update as InstallProgress);
    });
    return () => dispose?.();
  }, []);

  /** Runs one mutation, then re-reads. See the note at the top of this file. */
  const run = useCallback(
    async (key: string, action: () => Promise<unknown>) => {
      setBusy(key);
      try {
        await action();
        await refresh();
      } catch (error) {
        if (alive.current) {
          setState((current) => ({
            ...current,
            error: error instanceof Error ? error.message : String(error),
          }));
        }
      } finally {
        if (alive.current) {
          setBusy(null);
          setProgress(null);
        }
      }
    },
    [refresh]
  );

  const actions = {
    setRepositoryEnabled: (id: string, enabled: boolean) =>
      run(`repo:${id}`, () => window.cloudstream!.setRepositoryEnabled(id, enabled)),
    setExtensionEnabled: (internalName: string, enabled: boolean) =>
      run(`ext:${internalName}`, () =>
        window.cloudstream!.setExtensionEnabled(internalName, enabled)
      ),
    setProviderEnabled: (name: string, enabled: boolean) =>
      run(`provider:${name}`, () => window.cloudstream!.setProviderEnabled(name, enabled)),
    setProvidersEnabled: (names: string[], enabled: boolean) =>
      run('providers:bulk', () => window.cloudstream!.setProvidersEnabled(names, enabled)),
    installPlugin: (plugin: SitePlugin, repositoryUrl: string) =>
      run(`install:${plugin.internalName}`, () =>
        window.cloudstream!.installPlugin(plugin, repositoryUrl)
      ),
    uninstallPlugin: (internalName: string) =>
      run(`uninstall:${internalName}`, () => window.cloudstream!.uninstallPlugin(internalName)),
    /**
     * Removing a repository uninstalls what it installed.
     *
     * Deleting only the URL is what "I can't turn off the default repositories"
     * actually was: the extensions stayed on disk, loaded, and answering
     * searches, so "remove" changed nothing observable. `setRepositoryEnabled`
     * is the reversible alternative and keeps the archives.
     */
    removeRepository: (url: string) =>
      run(`remove:${url}`, () => window.cloudstream!.removeRepository(url)),
    setAdultAllowed: (enabled: boolean) =>
      run('adult', () => window.cloudstream!.setAdultAllowed(enabled)),
  };

  /**
   * Reads a repository's plugin list. Not a mutation, so it does not refresh.
   *
   * There is deliberately no "add repository" action, because the main process
   * has no such concept: `installedRepoUrls` gains a URL when an extension is
   * installed *from* it. Offering an Add button would therefore create a
   * repository row that disappears on the next read — a state the screen would
   * be inventing.
   */
  const browseRepository = useCallback(async (url: string) => {
    const response = await window.cloudstream?.fetchRepository(url);
    if (!response?.ok || !response.repository) {
      throw new Error(response?.error ?? 'That repository could not be read.');
    }
    return response.repository;
  }, []);

  return { state, progress, busy, refresh, actions, browseRepository };
}
