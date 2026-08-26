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
import React, { useCallback, useMemo, useState } from 'react';
import { Boxes, Loader2, RefreshCw, ShieldAlert } from 'lucide-react';
import { useExtensionCatalog } from './useExtensionCatalog';
import { useExtensionFilters } from './useExtensionFilters';
import { FilterBar } from './FilterBar';
import { BulkActionBar } from './BulkActionBar';
import { SourceTree } from './SourceTree';
import { RepositoryCatalog } from './RepositoryCatalog';
import { ExtensionCatalog } from './ExtensionCatalog';
import type { SitePlugin } from '../../types/plugin';
import './extensions.css';

type Tab = 'sources' | 'repositories' | 'extensions';

const TABS: Array<{ id: Tab; label: string; hint: string }> = [
  { id: 'sources', label: 'Sources', hint: 'What is installed' },
  { id: 'repositories', label: 'Repositories', hint: 'What you could add' },
  { id: 'extensions', label: 'Extensions', hint: 'What a repository offers' },
];

export const ExtensionsScreen: React.FC = () => {
  const { state, progress, busy, refresh, actions, browseRepository } = useExtensionCatalog();
  const [tab, setTab] = useState<Tab>('sources');
  const [selected, setSelected] = useState<Set<string>>(new Set());

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

  const browse = useCallback(
    async (repository: { name: string; url: string }) => {
      setTab('extensions');
      setBrowsing(repository);
      setBrowseLoading(true);
      setBrowseError(null);
      setPlugins([]);
      setWarnings([]);
      try {
        const result = await browseRepository(repository.url);
        setBrowsing({ name: result.name || repository.name, url: result.repositoryUrl });
        setPlugins(result.plugins ?? []);
        setWarnings(result.warnings ?? []);
      } catch (error) {
        setBrowseError(error instanceof Error ? error.message : String(error));
      } finally {
        setBrowseLoading(false);
      }
    },
    [browseRepository]
  );

  const install = useCallback(
    async (plugin: SitePlugin) => {
      if (!browsing) return;
      await actions.installPlugin(plugin, browsing.url);
    },
    [actions, browsing]
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

      <nav className="ext-tabs" role="tablist">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            className={`ext-tab${tab === entry.id ? ' ext-tab--on' : ''}`}
            onClick={() => setTab(entry.id)}
          >
            <span className="ext-tab__label">{entry.label}</span>
            <span className="ext-tab__hint">{entry.hint}</span>
          </button>
        ))}
      </nav>

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
        showCategories={tab === 'repositories'}
        scope={tab}
      />

      {tab === 'sources' ? (
        <>
          {/*
            Bulk actions apply to providers, which is the level the enable
            cascade actually gates. Offering them for extensions as well would
            need a second selection model, and two selections on one screen is
            how the old Providers tab came to disagree with the tree.
          */}
          {selected.size > 0 ? (
            <BulkActionBar
              count={selected.size}
              noun={selected.size === 1 ? 'provider' : 'providers'}
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
          adultAllowed={state.adultAllowed}
          filters={filters.state}
          busy={busy}
          onBrowse={(repository) => void browse(repository)}
          onRemove={(url) => void actions.removeRepository(url)}
          onAdd={(url) => void actions.addRepository(url)}
          onInstallAll={(url) => void actions.installRepository(url)}
        />
      ) : null}

      {tab === 'extensions' ? (
        <ExtensionCatalog
          repository={browsing}
          plugins={plugins}
          warnings={warnings}
          installedNames={installedNames}
          filters={filters.state}
          loading={browseLoading}
          error={browseError}
          busy={busy}
          progress={progress}
          onInstall={(plugin) => void install(plugin)}
          onUninstall={(name) => void actions.uninstallPlugin(name)}
        />
      ) : null}

      <footer className="ext-footer">
        <label className="ext-adult">
          <input
            type="checkbox"
            checked={state.adultAllowed}
            disabled={busy === 'adult'}
            onChange={(event) => void actions.setAdultAllowed(event.target.checked)}
          />
          <ShieldAlert size={14} />
          <span>
            Show adult providers
            {/*
              The gate is enforced in `PluginManager.enabledProviderNames`, which
              search, the scope picker, source discovery, playback and downloads
              all funnel through. This checkbox is the setting, not the
              enforcement — filtering at each call site would be five places to
              forget.
            */}
            <em>
              Off by default. A provider counts as adult when it declares upstream's NSFW
              content type, which catches one bundled inside an otherwise ordinary repository.
            </em>
          </span>
        </label>
      </footer>
    </div>
  );
};
