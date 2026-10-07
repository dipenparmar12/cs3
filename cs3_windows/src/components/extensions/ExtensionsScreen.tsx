/**
 * The extensions manager.
 *
 * Three tabs, split by the question each answers:
 *
 * - **Sources** — what do I have? The repository → extension → provider tree,
 *   with the enable cascade visible at every level.
 * - **Repositories** — what could I add? The verified catalogue, plus any URL.
 * - **Extensions** — what does this repository offer? Install and uninstall.
 *
 * There is deliberately no fourth "Providers" tab. A flattened re-listing of the
 * tree's leaves carries its own filter and selection state, so toggling a
 * provider in one view does not update the other — two screens disagreeing about
 * which sources a search will ask.
 *
 * ## Where the pieces come from
 *
 * `primitives`, `FilterBar`, `BulkActionBar`, `ProvenancePanel`,
 * `CompatibilityReport` and `useExtensionFilters` are the original components.
 * The container and the three views were reconstructed on 2026-08-21 after an
 * unanchored `extensions/` ignore rule meant they were never committed and
 * `App.tsx` imported a module no clone contained. Where the two overlapped the
 * originals won — `Toggle` carrying a `suppressedReason` says something the
 * reconstruction's plain switch could not.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Boxes, Library, Loader2, RefreshCw } from 'lucide-react';
import { useExtensionCatalog } from './useExtensionCatalog';
import { useExtensionFilters } from './useExtensionFilters';
import { FilterBar } from './FilterBar';
import { ExtensionUpdates } from '../ExtensionUpdates';
import { BulkActionBar } from './BulkActionBar';
import { SourceTree } from './SourceTree';
import { BuiltInSources } from './BuiltInSources';
import { RepositoryCatalog } from './RepositoryCatalog';
import { ExtensionCatalog } from './ExtensionCatalog';
import { JobsTray } from './JobsTray';
import { useExtensionJobs, useOnJobsSettled } from './useExtensionJobs';
import type { SitePlugin } from '../../types/plugin';
import './extensions.css';
import { describeError } from '../../utils/errors';
import { AdultContentSetting } from '../AdultContentSetting';
import { useAdultState } from '../../utils/useAdultMode';

/**
 * Three tabs:
 * - **Installed** — community extensions & providers tree
 * - **Browse** — official & community repository catalog
 * - **Built-in Sources** — native scrapers, Stremio addons, & self-hosted media servers
 */
type Tab = 'sources' | 'repositories' | 'builtin' | 'updates';

const TABS: Array<{ id: Tab; label: string; hint: string }> = [
  { id: 'sources', label: 'Installed', hint: 'What you have, and what will be searched' },
  { id: 'repositories', label: 'Browse', hint: 'Collections of add-ons you can install' },
  { id: 'builtin', label: 'Built-in Sources', hint: 'Ship with the app — native scrapers & servers' },
  { id: 'updates', label: 'Updates', hint: 'Available updates, changelogs & maintenance' },
];

export const ExtensionsScreen: React.FC = () => {
  const { state, busy, refresh, actions, browseRepository, peekRepository } = useExtensionCatalog();
  const browseToken = useRef(0);
  const adult = useAdultState();
  const jobs = useExtensionJobs();
  // The tree is re-read, never predicted, once background work lands.
  useOnJobsSettled(jobs.snapshot, () => void refresh());
  const [tab, setTab] = useState<Tab>('sources');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [updateCounts, setUpdateCounts] = useState<{ pending: number; ignored: number; failed: number }>({
    pending: 0,
    ignored: 0,
    failed: 0,
  });

  useEffect(() => {
    const api = window.cloudstream;
    if (!api) return;

    const loadCounts = async () => {
      try {
        const [cached, ignored] = await Promise.all([
          api.getCachedExtensionUpdates().catch(() => []),
          api.getIgnoredExtensionUpdates?.().catch(() => ({})) ?? {},
        ]);
        const safeCached = Array.isArray(cached) ? cached : [];
        const ignoredMap: Record<string, unknown> = (ignored as Record<string, unknown>) ?? {};
        const pending = safeCached.filter((u) => !u.ignored && !ignoredMap[u.internalName]).length;
        const ignoredCount = Object.keys(ignoredMap).length;
        setUpdateCounts((prev) => ({ ...prev, pending, ignored: ignoredCount }));
      } catch {
        // Ignore background tally error
      }
    };

    void loadCounts();

    return api.onExtensionUpdateEvent?.((event, payload) => {
      if (event === 'extension:updateCheckFinished') {
        const result = payload as { updates?: Array<{ internalName: string; ignored?: boolean }> };
        const safe = Array.isArray(result?.updates) ? result.updates : [];
        const pending = safe.filter((u) => !u.ignored).length;
        setUpdateCounts((prev) => ({ ...prev, pending }));
      }
    });
  }, []);

  const [browsing, setBrowsing] = useState<{ name: string; url: string } | null>(null);
  const [plugins, setPlugins] = useState<SitePlugin[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [browseLoading, setBrowseLoading] = useState(false);

  const installedNames = useMemo(
    () => new Set(state.installedPlugins.map((plugin) => plugin.internalName)),
    [state.installedPlugins]
  );

  const filters = useExtensionFilters(
    state.tree,
    plugins,
    state.official,
    installedNames
  );

  const counts = useMemo(() => {
    let extensions = 0;
    let providers = 0;
    let answering = 0;
    for (const repository of state.tree) {
      extensions += repository.extensions.length;
      for (const extension of repository.extensions) {
        providers += extension.providers.length;
        answering += extension.providers.filter(
          (provider) => provider.effectivelyEnabled !== false && provider.enabled !== false
        ).length;
      }
    }
    return { repositories: state.tree.length, extensions, providers, answering };
  }, [state.tree]);

  const toggleSelected = useCallback((name: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const selectAllProviders = useCallback(() => {
    const names = new Set<string>();
    for (const repository of state.tree) {
      for (const extension of repository.extensions) {
        for (const provider of extension.providers) names.add(provider.name);
      }
    }
    setSelected(names);
  }, [state.tree]);

  /**
   * Open a repository's extension list without leaving the page.
   *
   * This used to `setTab('extensions')`, which answered "what does this
   * repository offer?" by throwing away the list the question was asked from —
   * the scroll position, the filter chips and the neighbouring repositories
   * being compared against. Comparing two catalogues meant three tab switches
   * per comparison. The list now opens as a full-width panel directly under the
   * card, so the answer appears next to the question.
   */
  const browse = useCallback(
    async (repository: { name: string; url: string }) => {
      const token = ++browseToken.current;
      const current = () => token === browseToken.current;
      setTab('repositories');
      setBrowsing(repository);
      setBrowseError(null);

      // Show the stored listing at once; the fetch below only refreshes it.
      const cached = await peekRepository(repository.url).catch(() => null);
      if (!current()) return;
      if (cached) {
        setBrowsing({ name: cached.name || repository.name, url: cached.repositoryUrl });
        setPlugins(cached.plugins ?? []);
        setWarnings(cached.warnings ?? []);
        setBrowseLoading(false);
      } else {
        setPlugins([]);
        setWarnings([]);
        setBrowseLoading(true);
      }

      try {
        const result = await browseRepository(repository.url);
        if (!current()) return;
        setBrowsing({ name: result.name || repository.name, url: result.repositoryUrl });
        setPlugins(result.plugins ?? []);
        setWarnings(result.warnings ?? []);
      } catch (error) {
        // A failed refresh must not replace a listing that is already on screen.
        if (current() && !cached) setBrowseError(describeError(error));
      } finally {
        if (current()) setBrowseLoading(false);
      }
    },
    [browseRepository, peekRepository]
  );

  const install = useCallback(
    (chosen: SitePlugin[]) => {
      if (!browsing) return;
      void jobs.enqueue(
        chosen.map((plugin) => ({ kind: 'install' as const, plugin, repositoryUrl: browsing.url }))
      );
    },
    [jobs, browsing]
  );

  return (
    <div className="ext-screen">
      <header className="ext-header">
        <div className="ext-header__title">
          <Boxes size={18} />
          <h2>Extensions</h2>
        </div>
        <p className="ext-header__summary">
          {state.loading ? (
            <>
              <Loader2 size={13} className="spin" /> Reading what is installed…
            </>
          ) : (
            <>
              {counts.repositories} repositories · {counts.extensions} extensions ·{' '}
              <strong>{counts.answering}</strong> of {counts.providers} providers will be asked
            </>
          )}
        </p>
        <button
          type="button"
          className="ext-btn"
          onClick={() => void refresh()}
          disabled={state.loading || busy !== null}
        >
          <RefreshCw size={13} /> Refresh
        </button>
      </header>

      {state.error ? <p className="ext-error">{state.error}</p> : null}

      <JobsTray />

      <nav className="ext-tabs" role="tablist">
        {TABS.map((entry) => {
          const isUpdatesTab = entry.id === 'updates';
          return (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={tab === entry.id}
              className={`ext-tab${tab === entry.id ? ' ext-tab--on' : ''}`}
              onClick={() => setTab(entry.id)}
            >
              <div className="ext-tab__head">
                <span className="ext-tab__label">{entry.label}</span>
                {isUpdatesTab && updateCounts.pending > 0 && (
                  <span className="ext-tab__badge ext-tab__badge--accent">
                    {updateCounts.pending}
                  </span>
                )}
                {isUpdatesTab && updateCounts.pending === 0 && updateCounts.ignored > 0 && (
                  <span
                    className="ext-tab__badge ext-tab__badge--muted"
                    title={`${updateCounts.ignored} update(s) ignored due to provider errors`}
                  >
                    {updateCounts.ignored} ignored
                  </span>
                )}
              </div>
              <span className="ext-tab__hint">{entry.hint}</span>
            </button>
          );
        })}
      </nav>

      {(tab === 'sources' || tab === 'repositories') && (
        <FilterBar
          query={filters.query}
          onQuery={filters.setQuery}
          status={filters.status}
          onStatus={filters.setStatus}
          tags={filters.tags}
          onToggleTag={filters.toggleTag}
          languages={filters.languages}
          onToggleLanguage={filters.toggleLanguage}
          categories={filters.categories}
          onToggleCategory={filters.toggleCategory}
          facets={filters.facets}
          activeCount={filters.activeCount}
          onReset={filters.reset}
          showCategories={true}
          scope={tab === 'repositories' ? 'repositories' : 'sources'}
        />
      )}

      {tab === 'sources' ? (
        <>
          <div className="ext-builtin-banner">
            <div className="ext-builtin-banner__content">
              <Library size={18} className="ext-builtin-banner__icon" />
              <div className="ext-builtin-banner__text">
                <strong>Built-in sources</strong>
                <span>Ship with the app — nothing to install, and they cannot break on an update.</span>
              </div>
            </div>
            <button
              type="button"
              className="ext-btn ext-btn--primary"
              onClick={() => setTab('builtin')}
            >
              View Built-in Sources
            </button>
          </div>

          {/*
            Bulk actions apply to providers, which is the level the enable
            cascade actually gates. Offering them for extensions as well would
            need a second selection model, and two selections on one screen is
            how the old Providers tab came to disagree with the tree.
          */}
          {selected.size > 0 ? (
            <BulkActionBar
              count={selected.size}
              noun="provider"
              busy={busy === 'providers:bulk' ? 'Applying…' : null}
              onClear={() => setSelected(new Set())}
              onSelectAll={selectAllProviders}
              actions={[
                {
                  label: 'Enable',
                  tone: 'primary',
                  onRun: () => {
                    void actions.setProvidersEnabled([...selected], true);
                    setSelected(new Set());
                  },
                },
                {
                  label: 'Disable',
                  onRun: () => {
                    void actions.setProvidersEnabled([...selected], false);
                    setSelected(new Set());
                  },
                },
              ]}
            />
          ) : null}

          <SourceTree
            tree={state.tree}
            filters={filters.state}
            busy={busy}
            selected={selected}
            onToggleSelected={toggleSelected}
            onRepositoryToggle={(id, enabled) => void actions.setRepositoryEnabled(id, enabled)}
            onExtensionToggle={(name, enabled) => void actions.setExtensionEnabled(name, enabled)}
            onProviderToggle={(name, enabled) => void actions.setProviderEnabled(name, enabled)}
            onUninstall={(name) => void actions.uninstallPlugin(name)}
            onRemoveRepository={(url) => void actions.removeRepository(url)}
          />
        </>
      ) : null}

      {tab === 'repositories' ? (
        <RepositoryCatalog
          official={state.official}
          installed={state.installedRepositories}
          adultAllowed={adult.allowed}
          filters={filters.state}
          busy={busy}
          jobFor={jobs.jobFor}
          jobsForRepository={jobs.jobsForRepository}
          tree={state.tree}
          expandedUrl={browsing?.url ?? null}
          onBrowse={(repository) => void browse(repository)}
          onCollapse={() => setBrowsing(null)}
          renderExpanded={() => (
            <ExtensionCatalog
              repository={browsing}
              plugins={plugins}
              warnings={warnings}
              installedNames={installedNames}
              filters={filters.state}
              loading={browseLoading}
              error={browseError}
              busy={busy}
              jobFor={(internalName) => jobs.jobFor(`ext:${internalName}`)}
              embedded
              onInstall={install}
              onUninstall={(name) => void actions.uninstallPlugin(name)}
              onCancelJob={(id) => void jobs.cancel(id)}
              onRetryJob={(id) => void jobs.retry(id)}
            />
          )}
          onRemove={(url) => void actions.removeRepository(url)}
          onAdd={(url, name) => void jobs.enqueue([{ kind: 'addRepository', url, name }])}
          onInstallAll={(url, name) => void jobs.enqueue([{ kind: 'installRepository', url, name }])}
        />
      ) : null}

      {tab === 'builtin' ? (
        <BuiltInSources />
      ) : null}

      {tab === 'updates' ? (
        <ExtensionUpdates
          onUpdated={() => void refresh()}
          onCountsChange={(counts) => setUpdateCounts(counts)}
        />
      ) : null}



      <footer className="ext-footer">
        {/* The same control as Settings → Adult content, bound to the same state. */}
        <AdultContentSetting />
      </footer>
    </div>
  );
};
