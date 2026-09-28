/**
 * What a repository offers, and what installing one of them will do.
 *
 * A list rather than a grid of cards. What distinguishes two extensions is a
 * name, a status and a line of description, and a three-up grid of tall cards
 * put a screenful of whitespace between the viewer and the forty names they
 * were scanning.
 *
 * **Every row acts on its own.** Install enqueues a background job and returns,
 * so pressing Install on five rows is five presses, not five rounds of waiting
 * for the previous one — the queue downloads them side by side and each row
 * shows its own state: waiting, a real progress bar from the main process, done
 * or failed with a retry. Rows can also be ticked and installed together.
 *
 * The compatibility check stays on demand: `analyzePlugin` downloads the
 * archive, and doing that for a hundred rows on arrival would fetch a hundred
 * archives to answer a question about one.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Clock,
  Download,
  Loader2,
  RotateCcw,
  ShieldQuestion,
  Trash2,
  X,
} from 'lucide-react';
import { Badge, ProgressBar, TriStateCheckbox } from './primitives';
import { CompatibilityReport } from './CompatibilityReport';
import { matchesQuery, matchesTags, tagLabel, type FilterState } from './useExtensionFilters';
import type { PluginCompatibilityReport, SitePlugin } from '../../types/plugin';
import type { ExtensionJob } from './useExtensionJobs';
import { useReveal } from '../../utils/ExperienceModeContext';

interface ExtensionCatalogProps {
  repository: { name: string; url: string } | null;
  plugins: SitePlugin[];
  warnings: string[];
  installedNames: Set<string>;
  filters: FilterState;
  loading: boolean;
  error: string | null;
  /** The key of an uninstall in progress, which is still a direct action. */
  busy: string | null;
  /** The queue's job for an extension, if it has one. */
  jobFor(internalName: string): ExtensionJob | null;
  /**
   * Rendered inside a repository card rather than as a page of its own.
   *
   * The repository's name and URL are already on the card two lines above, so
   * repeating them here is the kind of duplication that makes an inline panel
   * read as a second screen crammed into the first.
   */
  embedded?: boolean;
  onInstall(plugins: SitePlugin[]): void;
  onUninstall(internalName: string): void;
  onCancelJob(id: string): void;
  onRetryJob(id: string): void;
}

/**
 * Upstream's plugin status — the maintainer's own claim about the extension,
 * not anything measured here. Shown as they meant it: `0` is down, and
 * installing one of those is usually a wasted download.
 */
const STATUS: Record<number, { label: string; tone: 'success' | 'warning' | 'danger'; hint: string }> = {
  0: { label: 'down', tone: 'danger', hint: 'Its maintainer marks it as not working' },
  1: { label: 'ok', tone: 'success', hint: 'Its maintainer marks it as working' },
  2: { label: 'slow', tone: 'warning', hint: 'Its maintainer marks it as slow' },
  3: { label: 'beta', tone: 'warning', hint: 'Its maintainer marks it as beta' },
};

const isActive = (job: ExtensionJob | null) =>
  job !== null && (job.state === 'queued' || job.state === 'running');

/** The one button on the right of a row, which is whatever the row needs next. */
const RowAction: React.FC<{
  plugin: SitePlugin;
  installed: boolean;
  job: ExtensionJob | null;
  uninstalling: boolean;
  onInstall(): void;
  onUninstall(): void;
  onCancel(id: string): void;
  onRetry(id: string): void;
}> = ({ plugin, installed, job, uninstalling, onInstall, onUninstall, onCancel, onRetry }) => {
  if (job?.state === 'queued') {
    return (
      <button
        type="button"
        className="ext-btn ext-item__action"
        title="Waiting for a free slot — click to cancel"
        onClick={() => onCancel(job.id)}
      >
        <Clock size={13} /> Waiting <X size={11} />
      </button>
    );
  }
  if (job?.state === 'running') {
    return (
      <button type="button" className="ext-btn ext-item__action" disabled>
        <Loader2 size={13} className="spin" />
        {job.kind === 'update' ? 'Updating' : 'Installing'}
        {job.percent ? ` ${Math.round(job.percent)}%` : '…'}
      </button>
    );
  }
  if (job?.state === 'failed' && !installed) {
    return (
      <button type="button" className="ext-btn ext-item__action" onClick={() => onRetry(job.id)}>
        <RotateCcw size={13} /> Retry
      </button>
    );
  }
  if (installed || job?.state === 'done') {
    return (
      <span className="ext-item__installed">
        <Check size={13} /> Installed
        <button
          type="button"
          className="ext-btn ext-btn--icon ext-btn--danger"
          title={`Uninstall ${plugin.name}`}
          aria-label={`Uninstall ${plugin.name}`}
          disabled={uninstalling || !installed}
          onClick={onUninstall}
        >
          {uninstalling ? <Loader2 size={12} className="spin" /> : <Trash2 size={12} />}
        </button>
      </span>
    );
  }
  return (
    <button type="button" className="ext-btn ext-btn--primary ext-item__action" onClick={onInstall}>
      <Download size={13} /> Install
    </button>
  );
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
  jobFor,
  embedded,
  onInstall,
  onUninstall,
  onCancelJob,
  onRetryJob,
}) => {
  const technical = useReveal('technical');
  const [reports, setReports] = useState<Record<string, PluginCompatibilityReport | 'loading'>>({});
  const [picked, setPicked] = useState<Set<string>>(new Set());

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

  /** Rows that an Install would actually do something for. */
  const installable = useMemo(
    () =>
      visible.filter(
        (plugin) => !installedNames.has(plugin.internalName) && !isActive(jobFor(plugin.internalName))
      ),
    [visible, installedNames, jobFor]
  );
  const pickedInstallable = installable.filter((plugin) => picked.has(plugin.internalName));
  const allPicked = installable.length > 0 && pickedInstallable.length === installable.length;

  const togglePick = (name: string) =>
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  if (!repository) {
    return (
      <p className="ext-empty">
        Pick a repository under <strong>Browse</strong> to see what it offers.
      </p>
    );
  }

  const installedHere = plugins.filter((plugin) => installedNames.has(plugin.internalName)).length;

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
          <Loader2 size={14} className="spin" /> Reading the list…
        </p>
      ) : null}

      {!loading && plugins.length > 0 ? (
        <div className="ext-list__toolbar">
          <TriStateCheckbox
            state={
              allPicked ? 'checked' : pickedInstallable.length > 0 ? 'indeterminate' : 'unchecked'
            }
            title={allPicked ? 'Clear selection' : 'Select everything not installed'}
            onChange={() =>
              setPicked(
                allPicked ? new Set() : new Set(installable.map((plugin) => plugin.internalName))
              )
            }
          />
          <span className="ext-list__count">
            {visible.length} of {plugins.length} · {installedHere} installed
          </span>
          <span className="ext-bulk__spacer" />
          {pickedInstallable.length > 0 ? (
            <button
              type="button"
              className="ext-btn ext-btn--primary"
              onClick={() => {
                onInstall(pickedInstallable);
                setPicked(new Set());
              }}
            >
              <Download size={13} /> Install {pickedInstallable.length} selected
            </button>
          ) : installable.length > 1 ? (
            <button type="button" className="ext-btn" onClick={() => onInstall(installable)}>
              <Download size={13} /> Install all {installable.length} shown
            </button>
          ) : null}
        </div>
      ) : null}

      {!loading && plugins.length > 0 ? (
        <ul className="ext-list">
          {visible.map((plugin) => {
            const installed = installedNames.has(plugin.internalName);
            const status = STATUS[plugin.status];
            const job = jobFor(plugin.internalName);
            const report = reports[plugin.internalName];
            const selectable = !installed && !isActive(job);
            const meta = [
              plugin.version ? `v${plugin.version}` : null,
              plugin.language ? plugin.language.toUpperCase() : null,
              (plugin.tvTypes ?? []).length > 0 ? (plugin.tvTypes ?? []).map(tagLabel).join(', ') : null,
              plugin.authors?.length ? plugin.authors.join(', ') : null,
            ].filter(Boolean);

            return (
              <li
                key={plugin.internalName}
                className={`ext-item${picked.has(plugin.internalName) && selectable ? ' ext-item--picked' : ''}`}
              >
                <span className="ext-item__check">
                  {selectable ? (
                    <TriStateCheckbox
                      state={picked.has(plugin.internalName) ? 'checked' : 'unchecked'}
                      title="Select"
                      onChange={() => togglePick(plugin.internalName)}
                    />
                  ) : null}
                </span>

                <span className="ext-item__avatar" aria-hidden>
                  {(plugin.name || '?').slice(0, 1).toUpperCase()}
                </span>

                <div className="ext-item__body">
                  <div className="ext-item__title">
                    <span className="ext-item__name">{plugin.name}</span>
                    {status && plugin.status !== 1 ? (
                      <Badge tone={status.tone} title={status.hint}>
                        {status.label}
                      </Badge>
                    ) : null}
                  </div>
                  {plugin.description ? (
                    <p className="ext-item__description" title={plugin.description}>
                      {plugin.description}
                    </p>
                  ) : null}
                  {meta.length > 0 ? <div className="ext-item__meta">{meta.join(' · ')}</div> : null}

                  {job?.state === 'running' ? (
                    <ProgressBar step={job.step ?? 'Starting…'} percent={job.percent ?? 0} />
                  ) : null}
                  {job?.state === 'failed' && !installed && job.message ? (
                    <p className="ext-item__error">{job.message}</p>
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
                </div>

                <div className="ext-item__actions">
                  {!installed && !report ? (
                    <button
                      type="button"
                      className="ext-btn ext-btn--icon"
                      title={
                        technical
                          ? 'Check what this archive needs before installing it'
                          : 'Check whether this works on this computer'
                      }
                      aria-label={`Check ${plugin.name}`}
                      onClick={() => void analyse(plugin)}
                    >
                      <ShieldQuestion size={13} />
                    </button>
                  ) : null}
                  {report === 'loading' ? <Loader2 size={13} className="spin" aria-label="Checking" /> : null}
                  <RowAction
                    plugin={plugin}
                    installed={installed}
                    job={job}
                    uninstalling={busy === `uninstall:${plugin.internalName}`}
                    onInstall={() => onInstall([plugin])}
                    onUninstall={() => onUninstall(plugin.internalName)}
                    onCancel={onCancelJob}
                    onRetry={onRetryJob}
                  />
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
        <p className="ext-empty">
          {technical
            ? 'This repository published no plugin list.'
            : 'This collection is empty — it offers nothing to install.'}
        </p>
      ) : null}
    </div>
  );
};
