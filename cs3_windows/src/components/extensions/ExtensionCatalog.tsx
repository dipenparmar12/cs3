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
import React, { useCallback, useMemo, useState } from 'react';
import { Download, Trash2, Loader2, AlertTriangle, ShieldQuestion } from 'lucide-react';
import { Badge, ProgressBar } from './primitives';
import { CompatibilityReport } from './CompatibilityReport';
import { matchesQuery, matchesTags, tagLabel, type FilterState } from './useExtensionFilters';
import type { PluginCompatibilityReport, SitePlugin } from '../../types/plugin';
import type { InstallProgress } from './useExtensionCatalog';

interface ExtensionCatalogProps {
  repository: { name: string; url: string } | null;
  plugins: SitePlugin[];
  warnings: string[];
  installedNames: Set<string>;
  filters: FilterState;
  loading: boolean;
  error: string | null;
  busy: string | null;
  progress: InstallProgress | null;
  /**
   * Rendered inside a repository card rather than as a page of its own.
   *
   * The repository's name and URL are already on the card two lines above, so
   * repeating them here is the kind of duplication that makes an inline panel
   * read as a second screen crammed into the first.
   */
  embedded?: boolean;
  onInstall(plugin: SitePlugin): void;
  onUninstall(internalName: string): void;
}

/**
 * Upstream's plugin status — the maintainer's own claim about the extension,
 * not anything measured here. Shown as they meant it: `0` is down, and
 * installing one of those is usually a wasted download.
 */
const STATUS: Record<number, { label: string; tone: 'success' | 'warning' | 'danger' }> = {
  0: { label: 'down', tone: 'danger' },
  1: { label: 'ok', tone: 'success' },
  2: { label: 'slow', tone: 'warning' },
  3: { label: 'beta', tone: 'warning' },
};

export const ExtensionCatalog: React.FC<ExtensionCatalogProps> = ({
  repository,
  plugins,
  warnings,
  installedNames,
  filters,
  loading,
  error,
  busy,
  progress,
  embedded,
  onInstall,
  onUninstall,
}) => {
  const [reports, setReports] = useState<Record<string, PluginCompatibilityReport | 'loading'>>({});

  /**
   * Analysis is on demand, not on render.
   *
   * `analyzePlugin` downloads the archive and resolves every type it references
   * against the runtime classpath. Doing that for a hundred catalogue rows on
   * arrival would download a hundred archives to answer a question about one.
   */
  const analyse = useCallback(async (plugin: SitePlugin) => {
    setReports((current) => ({ ...current, [plugin.internalName]: 'loading' }));
    try {
      const report = await window.cloudstream?.analyzePlugin(plugin);
      if (report) setReports((current) => ({ ...current, [plugin.internalName]: report }));
    } catch {
      setReports((current) => {
        const next = { ...current };
        delete next[plugin.internalName];
        return next;
      });
    }
  }, []);

  const visible = useMemo(
    () =>
      plugins.filter((plugin) => {
        if (!matchesTags(plugin.tvTypes, filters.tags)) return false;
        if (
          filters.languages.size > 0 &&
          !(plugin.language && filters.languages.has(plugin.language.toLowerCase()))
        ) {
          return false;
        }
        const here = installedNames.has(plugin.internalName);
        if (filters.status === 'installed' && !here) return false;
        if (filters.status === 'available' && here) return false;
        if (filters.status === 'problems' && plugin.status !== 0) return false;
        return matchesQuery(filters.query, plugin.name, plugin.description);
      }),
    [plugins, filters, installedNames]
  );

  if (!repository) {
    return (
      <p className="ext-empty">
        Pick a repository under <strong>Repositories</strong> to see what it offers.
      </p>
    );
  }

  return (
    <div className={`ext-panel${embedded ? ' ext-panel--embedded' : ''}`}>
      {embedded ? null : (
        <div className="ext-panel__head">
          <h4>{repository.name}</h4>
          <span className="ext-row__subtitle">{repository.url}</span>
        </div>
      )}

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
          <Loader2 size={14} className="spin" /> Reading the plugin list…
        </p>
      ) : null}

      {!loading && plugins.length > 0 ? (
        <ul className="ext-cards">
          {visible.map((plugin) => {
            const here = installedNames.has(plugin.internalName);
            const status = STATUS[plugin.status];
            const working = busy === `install:${plugin.internalName}`;
            const report = reports[plugin.internalName];

            return (
              <li key={plugin.internalName} className="ext-card">
                <div className="ext-row__title">
                  {plugin.name}
                  {status ? <Badge tone={status.tone}>{status.label}</Badge> : null}
                  {here ? <Badge tone="accent">installed</Badge> : null}
                </div>

                {plugin.description ? (
                  <p className="ext-card__description">{plugin.description}</p>
                ) : null}

                <div className="ext-row__subtitle">
                  {plugin.version ? <span>v{plugin.version}</span> : null}
                  {plugin.language ? <span>{plugin.language}</span> : null}
                  {(plugin.tvTypes ?? []).length > 0 ? (
                    <span>{(plugin.tvTypes ?? []).map(tagLabel).join(', ')}</span>
                  ) : null}
                  {plugin.authors?.length ? <span>{plugin.authors.join(', ')}</span> : null}
                </div>

                {working && progress?.internalName === plugin.internalName ? (
                  <ProgressBar
                    step={progress.message ?? progress.step}
                    percent={progress.percent}
                    failed={progress.step === 'error'}
                  />
                ) : null}

                {report && report !== 'loading' ? (
                  <CompatibilityReport
                    report={report}
                    onClose={() =>
                      setReports((current) => {
                        const next = { ...current };
                        delete next[plugin.internalName];
                        return next;
                      })
                    }
                  />
                ) : null}

                <div className="ext-card__actions">
                  {here ? (
                    <button
                      type="button"
                      className="ext-btn ext-btn--danger"
                      disabled={busy !== null}
                      onClick={() => onUninstall(plugin.internalName)}
                    >
                      <Trash2 size={13} /> Uninstall
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="ext-btn ext-btn--primary"
                      disabled={busy !== null}
                      onClick={() => onInstall(plugin)}
                    >
                      {working ? <Loader2 size={13} className="spin" /> : <Download size={13} />}
                      Install
                    </button>
                  )}
                  {!report ? (
                    <button
                      type="button"
                      className="ext-btn"
                      title="Check what this archive needs before installing it"
                      onClick={() => void analyse(plugin)}
                    >
                      <ShieldQuestion size={13} /> Check compatibility
                    </button>
                  ) : null}
                  {report === 'loading' ? (
                    <span className="ext-row__subtitle">
                      <Loader2 size={12} className="spin" /> analysing…
                    </span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      {!loading && plugins.length > 0 && visible.length === 0 ? (
        <p className="ext-empty">Nothing in this repository matches those filters.</p>
      ) : null}

      {!loading && plugins.length === 0 && !error ? (
        <p className="ext-empty">This repository published no plugin list.</p>
      ) : null}
    </div>
  );
};
