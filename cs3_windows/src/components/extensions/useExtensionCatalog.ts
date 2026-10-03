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
import type { OfficialRepository } from '../../../electron/officialRepositories';
import { describeError } from '../../utils/errors';
import { useAdultState } from '../../utils/useAdultMode';

/**
 * The catalogue entry, re-exported from where it is defined.
 *
 * Imported from the main-process module rather than restated here, so there is
 * one definition. A structural copy compiles happily and then drifts — the copy
 * this replaced was missing `internalName` and `documentKind`, which is exactly
 * the kind of divergence that only surfaces when something reads a field the
 * copy never had.
 */
export type { OfficialRepository } from '../../../electron/officialRepositories';

export interface CatalogState {
  tree: ProviderTreeRepository[];
  /** Installed repository URLs, which is all the main process stores. */
  installedRepositories: string[];
  installedPlugins: SitePlugin[];
  official: OfficialRepository[];
  loading: boolean;
  error: string | null;
}

const EMPTY: CatalogState = {
  tree: [],
  installedRepositories: [],
  installedPlugins: [],
  official: [],
  loading: true,
  error: null,
};

export function useExtensionCatalog() {
  const [state, setState] = useState<CatalogState>(EMPTY);
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
      const [treeResponse, repositories, plugins, official] = await Promise.all([
        api.getProviderTree(),
        api.getInstalledRepositories(),
        api.getInstalledPlugins(),
        api.getOfficialRepositories(),
      ]);

      if (!alive.current) return;
      setState({
        tree: treeResponse?.tree ?? [],
        installedRepositories: repositories ?? [],
        installedPlugins: plugins ?? [],
        official: official ?? [],
        loading: false,
        error: treeResponse?.ok === false ? (treeResponse.error ?? null) : null,
      });
    } catch (error) {
      if (!alive.current) return;
      setState((current) => ({
        ...current,
        loading: false,
        error: describeError(error),
      }));
    }
  }, []);

  // The catalogue and tree are filtered by the adult gate in the main process,
  // so a change made anywhere has to re-read them.
  const adultAllowed = useAdultState().allowed;
  useEffect(() => {
    void refresh();
  }, [refresh, adultAllowed]);

  /**
   * Runs one quick mutation, then re-reads. See the note at the top of this file.
   *
   * Installs, updates and repository adds are not here: they take seconds to
   * minutes, so they go through the background job queue (`useExtensionJobs`)
   * and the screen re-reads when a job settles.
   */
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
            error: describeError(error),
          }));
        }
      } finally {
        if (alive.current) setBusy(null);
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
  };

  /**
   * Reads a repository's plugin list. Not a mutation, so it does not refresh.
   *
   * This used to note that there was deliberately no "add repository" action,
   * because the main process had no such concept — `installedRepoUrls` only
   * gained a URL when an extension was installed *from* it, so an Add button
   * would have created a row that vanished on the next read. That was an
   * accurate description of a gap rather than a design: it meant the only
   * repositories a user ever saw listed were the four bundled ones, and any
   * other had to be kept somewhere outside the app and pasted back to browse.
   * `addRepository` closes it, verifying the address before keeping it.
   */
  const browseRepository = useCallback(async (url: string) => {
    const response = await window.cloudstream?.fetchRepository(url);
    if (!response?.ok || !response.repository) {
      throw new Error(response?.error ?? 'That repository could not be read.');
    }
    return response.repository;
  }, []);

  return { state, busy, refresh, actions, browseRepository };
}
