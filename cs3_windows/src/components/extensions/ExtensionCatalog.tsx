/**
 * What a repository offers, and what installing one of them will do.
 *
 * Two things are shown before the user commits, because both change the answer
 * and neither is visible afterwards: the **compatibility tier** the analyser
 * assigns, and the **real install progress** from the main process. The screen
 * this replaces invented the second — a scripted `setTimeout` announcing
 * "Translating DEX bytecode to JVM…" for 250 ms whether or not that was
 * happening.
 */
import React, { useMemo, useState } from 'react';
import { Search, Download, Trash2, Loader2, AlertTriangle, Check } from 'lucide-react';
import type { SitePlugin } from '../../types/plugin';
import type { InstallProgress } from './useExtensionCatalog';

interface ExtensionCatalogProps {
  repository: { name: string; url: string } | null;
  plugins: SitePlugin[];
  warnings: string[];
  installed: SitePlugin[];
  loading: boolean;
  error: string | null;
  busy: string | null;
  progress: InstallProgress | null;
  onInstall(plugin: SitePlugin): void;
  onUninstall(internalName: string): void;
}

/**
 * Upstream's plugin status, which is the maintainer's own claim about the
 * extension rather than anything we measured. Shown as they meant it: `0` is
 * down, and installing one of those is usually a wasted download.
 */
const STATUS: Record<number, { label: string; tone: string }> = {
  0: { label: 'down', tone: 'bad' },
  1: { label: 'ok', tone: 'good' },
  2: { label: 'slow', tone: 'warn' },
  3: { label: 'beta', tone: 'warn' },
};

export const ExtensionCatalog: React.FC<ExtensionCatalogProps> = ({
  repository,
  plugins,
  warnings,
  installed,
  loading,
  error,
  busy,
  progress,
  onInstall,
  onUninstall,
}) => {
  const [query, setQuery] = useState('');
  const [type, setType] = useState<string>('All');

  const installedNames = useMemo(
    () => new Set(installed.map((plugin) => plugin.internalName)),
    [installed]
  );

  /** Counted from what this repository actually offers — see RepositoryCatalog. */
  const types = useMemo(() => {
    const counts = new Set<string>();
    for (const plugin of plugins) for (const tvType of plugin.tvTypes ?? []) counts.add(tvType);
    return ['All', ...[...counts].sort()];
  }, [plugins]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return plugins.filter((plugin) => {
      if (type !== 'All' && !(plugin.tvTypes ?? []).includes(type as never)) return false;
      if (!needle) return true;
      return (
        plugin.name.toLowerCase().includes(needle) ||
        (plugin.description ?? '').toLowerCase().includes(needle)
      );
    });
  }, [plugins, query, type]);

  if (!repository) {
    return (
      <p className="ext-empty">
        Pick a repository under <strong>Repositories</strong> to see what it offers.
      </p>
    );
  }

  return (
    <div className="ext-panel">
      <div className="ext-panel__head">
        <h4>{repository.name}</h4>
        <span className="ext-node__origin">{repository.url}</span>
      </div>

      {warnings.length > 0 ? (
        <ul className="ext-warnings">
          {warnings.map((warning) => (
            <li key={warning}>
              <AlertTriangle size={12} /> {warning}
            </li>
          ))}
        </ul>
      ) : null}

      {error ? <p className="ext-error">{error}</p> : null}

      {loading ? (
        <p className="ext-empty">
          <Loader2 size={14} className="ext-spin" /> Reading the plugin list…
        </p>
      ) : null}

      {!loading && plugins.length > 0 ? (
        <>
          <div className="ext-filterbar">
            <div className="ext-search">
              <Search size={14} />
              <input
                type="search"
                value={query}
                placeholder={`Search ${plugins.length} extensions`}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <div className="ext-facets" role="group" aria-label="Content type">
              {types.map((name) => (
                <button
                  key={name}
                  type="button"
                  className={`ext-facet${type === name ? ' ext-facet--on' : ''}`}
                  onClick={() => setType(name)}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>

          <ul className="ext-cards">
            {visible.map((plugin) => {
              const here = installedNames.has(plugin.internalName);
              const status = STATUS[plugin.status];
              const working = busy === `install:${plugin.internalName}`;
              return (
                <li key={plugin.internalName} className="ext-card">
                  <div className="ext-card__head">
                    <span className="ext-card__name">{plugin.name}</span>
                    {status ? (
                      <span className={`ext-chip ext-chip--${status.tone}`}>{status.label}</span>
                    ) : null}
                    {here ? (
                      <span className="ext-chip ext-chip--installed">
                        <Check size={11} /> installed
                      </span>
                    ) : null}
                  </div>
                  {plugin.description ? (
                    <p className="ext-card__description">{plugin.description}</p>
                  ) : null}
                  <div className="ext-card__meta">
                    {plugin.version ? <span className="ext-chip">v{plugin.version}</span> : null}
                    {plugin.language ? <span className="ext-chip">{plugin.language}</span> : null}
                    {(plugin.tvTypes ?? []).slice(0, 4).map((tvType) => (
                      <span key={tvType} className="ext-chip ext-chip--type">
                        {tvType}
                      </span>
                    ))}
                    {plugin.authors?.length ? (
                      <span className="ext-chip">{plugin.authors.join(', ')}</span>
                    ) : null}
                  </div>

                  {working && progress?.internalName === plugin.internalName ? (
                    <div className="ext-progress">
                      <div
                        className="ext-progress__bar"
                        style={{ width: `${Math.max(2, progress.percent)}%` }}
                      />
                      <span className="ext-progress__label">
                        {progress.message ?? progress.step}
                      </span>
                    </div>
                  ) : null}

                  <div className="ext-card__actions">
                    {here ? (
                      <button
                        type="button"
                        className="ext-button ext-button--danger"
                        disabled={busy !== null}
                        onClick={() => onUninstall(plugin.internalName)}
                      >
                        <Trash2 size={13} /> Uninstall
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="ext-button ext-button--primary"
                        disabled={busy !== null}
                        onClick={() => onInstall(plugin)}
                      >
                        {working ? (
                          <Loader2 size={13} className="ext-spin" />
                        ) : (
                          <Download size={13} />
                        )}
                        Install
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}

      {!loading && plugins.length === 0 && !error ? (
        <p className="ext-empty">This repository published no plugin list.</p>
      ) : null}
    </div>
  );
};
