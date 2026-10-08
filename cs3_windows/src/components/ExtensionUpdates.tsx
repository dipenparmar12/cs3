import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  RefreshCw,
  ArrowUpCircle,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Check,
  EyeOff,
  RotateCcw,
  Settings2,
} from 'lucide-react';
import type {
  AvailableUpdate,
  ExtensionNotice,
  IgnoredExtensionUpdate,
  UpdateOutcome,
  UpdateSettings,
} from '../../electron/cs3/extensionUpdater';
import { describeError } from '../utils/errors';
import { useExtensionJobs } from './extensions/useExtensionJobs';
import { ProgressBar } from './extensions/primitives';
import { Button, Menu } from './ui';

export interface StatusMessage {
  text: string;
  isError?: boolean;
}

export interface ExtensionUpdatesProps {
  onUpdated?: () => void;
  onCountsChange?: (counts: { pending: number; ignored: number; failed: number }) => void;
}

export const ExtensionUpdates: React.FC<ExtensionUpdatesProps> = ({ onUpdated, onCountsChange }) => {
  const [updates, setUpdates] = useState<AvailableUpdate[]>([]);
  const [ignoredUpdates, setIgnoredUpdates] = useState<Record<string, IgnoredExtensionUpdate>>({});
  const [notices, setNotices] = useState<ExtensionNotice[]>([]);
  const [failedOutcomes, setFailedOutcomes] = useState<UpdateOutcome[]>([]);
  const [settings, setSettings] = useState<UpdateSettings | null>(null);
  const [checking, setChecking] = useState(false);
  const [showIgnored, setShowIgnored] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const jobs = useExtensionJobs();
  const [message, setMessage] = useState<StatusMessage | null>(null);

  const api = window.cloudstream;

  const fetchIgnored = useCallback(() => {
    if (!api?.getIgnoredExtensionUpdates) return;
    api
      .getIgnoredExtensionUpdates()
      .then((res) => setIgnoredUpdates(res ?? {}))
      .catch(() => {});
  }, [api]);

  useEffect(() => {
    if (!api) return;
    api
      .getCachedExtensionUpdates()
      .then((res) => setUpdates(Array.isArray(res) ? res : []))
      .catch(() => setUpdates([]));

    api
      .getUpdateSettings()
      .then((res) => setSettings(res ?? null))
      .catch(() => {});

    fetchIgnored();
  }, [api, fetchIgnored]);

  // Separate active (pending) updates from ignored updates
  const activeUpdates = useMemo(() => {
    const safe = Array.isArray(updates) ? updates : [];
    return safe.filter((u) => !u.ignored && !ignoredUpdates[u.internalName]);
  }, [updates, ignoredUpdates]);

  const ignoredList = useMemo(() => {
    return Object.values(ignoredUpdates);
  }, [ignoredUpdates]);

  useEffect(() => {
    onCountsChange?.({
      pending: activeUpdates.length,
      ignored: ignoredList.length,
      failed: failedOutcomes.length,
    });
  }, [activeUpdates.length, ignoredList.length, failedOutcomes.length, onCountsChange]);

  useEffect(() => {
    if (!api) return;
    return api.onExtensionUpdateEvent((event, payload) => {
      switch (event) {
        case 'extension:updateCheckStarted':
          setChecking(true);
          break;
        case 'extension:updateCheckFinished': {
          const result = payload as {
            updates?: AvailableUpdate[];
            ignoredUpdates?: IgnoredExtensionUpdate[];
            warnings?: string[];
          };
          const safeUpdates = Array.isArray(result?.updates) ? result.updates : [];
          setUpdates(safeUpdates);
          if (Array.isArray(result?.ignoredUpdates)) {
            const map: Record<string, IgnoredExtensionUpdate> = {};
            for (const item of result.ignoredUpdates) {
              map[item.internalName] = item;
            }
            setIgnoredUpdates(map);
          }
          setChecking(false);
          break;
        }
        case 'extension:ignoredUpdatesChanged': {
          const map = payload as Record<string, IgnoredExtensionUpdate>;
          if (map && typeof map === 'object') {
            setIgnoredUpdates(map);
          }
          break;
        }
        case 'extension:updateProgress':
          setProgress(payload as { current: number; total: number });
          break;
        case 'extension:autoUpdateCompleted': {
          setProgress(null);
          const { outcomes } = payload as { outcomes?: UpdateOutcome[] };
          const safeOutcomes = Array.isArray(outcomes) ? outcomes : [];
          const ok = safeOutcomes.filter((o) => o?.ok).length;
          const failed = safeOutcomes.filter((o) => !o?.ok);
          setFailedOutcomes(failed);
          setMessage({
            text:
              failed.length > 0
                ? `Auto-updated ${ok} of ${safeOutcomes.length} extensions (${failed.length} failed and ignored).`
                : `Auto-updated all ${ok} extension(s).`,
            isError: failed.length > 0,
          });
          api
            .getCachedExtensionUpdates()
            .then((res) => setUpdates(Array.isArray(res) ? res : []))
            .catch(() => {});
          fetchIgnored();
          onUpdated?.();
          break;
        }
        default:
          break;
      }
    });
  }, [api, onUpdated, fetchIgnored]);

  const check = useCallback(async () => {
    if (!api) return;
    setChecking(true);
    setMessage(null);
    setFailedOutcomes([]);
    try {
      const response = await api.checkExtensionUpdates();
      setChecking(false);

      if (!response.ok || !response.result) {
        setMessage({ text: `Check failed: ${response.error ?? 'unknown error'}`, isError: true });
        return;
      }
      const safeUpdates = Array.isArray(response.result.updates) ? response.result.updates : [];
      setUpdates(safeUpdates);
      setNotices(Array.isArray(response.result.notices) ? response.result.notices : []);
      fetchIgnored();

      const nonIgnoredCount = safeUpdates.filter((u) => !u.ignored).length;
      setMessage(
        nonIgnoredCount === 0
          ? {
              text: `All active extensions are up to date (${response.result.repositoriesChecked ?? 0} repos checked).`,
              isError: false,
            }
          : {
              text: `Found ${nonIgnoredCount} new update(s).`,
              isError: false,
            }
      );
    } catch (err) {
      setChecking(false);
      setMessage({ text: `Check failed: ${describeError(err)}`, isError: true });
    }
  }, [api, fetchIgnored]);

  const updateJobs = useMemo(
    () => jobs.snapshot.jobs.filter((job) => job.kind === 'update'),
    [jobs.snapshot]
  );
  const updating = updateJobs.filter((job) => job.state === 'queued' || job.state === 'running');
  const seenJobs = useRef<Set<string> | null>(null);

  useEffect(() => {
    const finished = updateJobs.filter((job) => job.state === 'done' || job.state === 'failed');
    if (seenJobs.current === null) {
      seenJobs.current = new Set(finished.map((job) => job.id));
      return;
    }
    const fresh = finished.filter((job) => !seenJobs.current!.has(job.id));
    if (fresh.length === 0) return;
    for (const job of fresh) seenJobs.current.add(job.id);

    const names = (list: typeof fresh) => new Set(list.map((job) => job.target.slice('ext:'.length)));
    const succeeded = names(fresh.filter((job) => job.state === 'done'));
    const failed = fresh.filter((job) => job.state === 'failed');

    setUpdates((prev) => prev.filter((u) => !succeeded.has(u.internalName)));
    setFailedOutcomes((prev) => [
      ...prev.filter((f) => !succeeded.has(f.internalName) && !names(failed).has(f.internalName)),
      ...failed.map((job) => ({
        internalName: job.target.slice('ext:'.length),
        ok: false,
        message: job.message ?? 'The update did not install.',
      })),
    ]);

    if (succeeded.size > 0) {
      onUpdated?.();
      fetchIgnored();
    }
    if (failed.length > 0) {
      fetchIgnored();
    }
  }, [updateJobs, onUpdated, fetchIgnored]);

  const isUpdating = (internalName: string) =>
    updating.some((job) => job.target === `ext:${internalName}`);

  const enqueueUpdates = useCallback(
    (targets: Array<{ internalName: string; name?: string }>) =>
      jobs.enqueue(
        targets.map((target) => ({
          kind: 'update' as const,
          internalName: target.internalName,
          name: target.name,
        }))
      ),
    [jobs]
  );

  const updateOne = useCallback(
    (internalName: string) => {
      setMessage(null);
      const name = updates.find((u) => u.internalName === internalName)?.name;
      void enqueueUpdates([{ internalName, name }]);
    },
    [enqueueUpdates, updates]
  );

  const updateEverything = useCallback(async () => {
    if (!api) return;
    setMessage(null);
    setChecking(true);
    try {
      const response = await api.checkExtensionUpdates();
      const fresh = response.ok && response.result ? response.result.updates ?? [] : updates;
      setUpdates(fresh);
      fetchIgnored();

      const actionable = fresh.filter((u) => !u.ignored && !ignoredUpdates[u.internalName]);
      if (actionable.length === 0) {
        setMessage({ text: 'All active extensions are already up to date.', isError: false });
        return;
      }
      void enqueueUpdates(actionable);
    } catch (err) {
      setMessage({ text: `Update all failed: ${describeError(err)}`, isError: true });
    } finally {
      setChecking(false);
    }
  }, [api, updates, ignoredUpdates, enqueueUpdates, fetchIgnored]);

  const retryFailed = useCallback(() => {
    if (failedOutcomes.length === 0) return;
    setMessage(null);
    void enqueueUpdates(
      failedOutcomes.map((f) => ({
        internalName: f.internalName,
        name: updates.find((u) => u.internalName === f.internalName)?.name,
      }))
    );
  }, [failedOutcomes, updates, enqueueUpdates]);

  const ignoreUpdate = useCallback(
    async (internalName: string, reason = 'Ignored by user') => {
      if (!api?.ignoreExtensionUpdate) return;
      try {
        await api.ignoreExtensionUpdate(internalName, reason);
        fetchIgnored();
      } catch (err) {
        setMessage({ text: `Could not ignore update: ${describeError(err)}`, isError: true });
      }
    },
    [api, fetchIgnored]
  );

  const unignoreUpdate = useCallback(
    async (internalName: string) => {
      if (!api?.unignoreExtensionUpdate) return;
      try {
        await api.unignoreExtensionUpdate(internalName);
        fetchIgnored();
      } catch (err) {
        setMessage({ text: `Could not restore update: ${describeError(err)}`, isError: true });
      }
    },
    [api, fetchIgnored]
  );

  const changeSettings = useCallback(
    async (patch: Partial<UpdateSettings>) => {
      if (!api) return;
      try {
        setSettings(await api.saveUpdateSettings(patch));
      } catch (err) {
        setMessage({ text: `Could not save settings: ${describeError(err)}`, isError: true });
      }
    },
    [api]
  );

  const lastCheckedStr = settings?.lastCheckedAt
    ? ` · Last checked ${new Date(settings.lastCheckedAt).toLocaleTimeString()}`
    : '';

  /*
   * An updater, not a dashboard: one line says whether anything is waiting and
   * offers the one action that matters. Checking and the schedule are quiet
   * controls beside it; a failure or an ignored update is a short group below,
   * and an extension's description lives in its tooltip rather than its row.
   */
  const policyLabel: Record<UpdateSettings['policy'], string> = {
    startup: 'Check every time the app opens',
    daily: 'Check once a day',
    manual: 'Check only when I ask',
  };
  const busyUpdating = progress !== null || updating.length > 0;

  return (
    <div className="ext-updates">
      <div className="ext-updates__summary">
        {activeUpdates.length > 0 ? (
          <ArrowUpCircle size={18} className="ext-updates__icon ext-updates__icon--pending" aria-hidden />
        ) : (
          <CheckCircle2 size={18} className="ext-updates__icon ext-updates__icon--ok" aria-hidden />
        )}
        <div className="ext-updates__status">
          <strong>
            {activeUpdates.length > 0
              ? `${activeUpdates.length} update${activeUpdates.length === 1 ? '' : 's'} available`
              : 'Everything is up to date'}
          </strong>
          <span className="ext-updates__meta">
            {[
              settings ? (settings.autoInstall ? 'Installs automatically' : 'Installs when you choose') : null,
              lastCheckedStr.replace(/^ · /, '') || null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </div>

        <div className="ext-updates__actions">
          <Button
            size="compact"
            variant="ambient"
            icon={RefreshCw}
            loading={checking}
            disabled={busyUpdating}
            onClick={check}
          >
            {checking ? 'Checking…' : 'Check now'}
          </Button>
          {settings && (
            <Menu
              label="Update settings"
              trigger={(props) => (
                <Button {...props} size="compact" variant="ambient" iconOnly icon={Settings2} aria-label="Update settings" />
              )}
              items={[
                {
                  label: 'Install updates automatically',
                  icon: settings.autoInstall ? Check : undefined,
                  onSelect: () => void changeSettings({ autoInstall: !settings.autoInstall }),
                },
                ...(['startup', 'daily', 'manual'] as const).map((policy) => ({
                  label: policyLabel[policy],
                  icon: settings.policy === policy ? Check : undefined,
                  onSelect: () => void changeSettings({ policy }),
                })),
              ]}
            />
          )}
          {activeUpdates.length > 0 && (
            <Button
              size="compact"
              variant="prominent"
              icon={ArrowUpCircle}
              loading={busyUpdating}
              disabled={checking}
              onClick={updateEverything}
            >
              {progress
                ? `Updating ${progress.current} of ${progress.total}…`
                : updating.length > 0
                  ? `Updating ${updating.length}…`
                  : `Update all (${activeUpdates.length})`}
            </Button>
          )}
        </div>
      </div>

      {progress && progress.total > 0 && (
        <ProgressBar
          step={`Updating ${progress.current} of ${progress.total}`}
          percent={Math.round((progress.current / progress.total) * 100)}
        />
      )}

      {message && (
        <p className={`ext-updates__message${message.isError ? ' ext-updates__message--error' : ''}`} role="status">
          {message.isError ? <AlertCircle size={13} aria-hidden /> : <CheckCircle2 size={13} aria-hidden />}
          {message.text}
        </p>
      )}

      {notices.map((notice) => (
        <p key={`notice-${notice.internalName}`} className="ext-updates__notice" role="status">
          <AlertCircle size={13} aria-hidden />
          {notice.message}
        </p>
      ))}

      {activeUpdates.length > 0 && (
        <ul className="ext-updates__list" aria-label="Available updates">
          {activeUpdates.map((u) => (
            <li key={u.internalName} className="ext-updates__row">
              <span className="ext-updates__name" title={u.description || undefined}>
                {u.name}
              </span>
              <span className="ext-updates__version">
                {u.reason === 'republished'
                  ? `v${u.availableVersion} rebuilt`
                  : `v${u.installedVersion} → v${u.availableVersion}`}
                {u.fileSize ? ` · ${(u.fileSize / 1024).toFixed(0)} KB` : ''}
              </span>
              <span className="ext-updates__row-actions">
                <Button
                  size="compact"
                  variant="ambient"
                  iconOnly
                  icon={EyeOff}
                  aria-label={`Ignore the update to ${u.name}`}
                  title="Ignore this update"
                  onClick={() => ignoreUpdate(u.internalName, 'Ignored by user')}
                />
                <Button
                  size="compact"
                  loading={isUpdating(u.internalName)}
                  disabled={progress !== null}
                  onClick={() => updateOne(u.internalName)}
                >
                  Update
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {failedOutcomes.length > 0 && (
        <section className="ext-updates__group" aria-label="Updates that failed">
          <div className="ext-updates__group-head">
            <span className="ext-updates__group-title ext-updates__group-title--error">
              Couldn’t update ({failedOutcomes.length})
            </span>
            <Button size="compact" variant="ambient" icon={RotateCcw} disabled={progress !== null} onClick={retryFailed}>
              Retry all
            </Button>
          </div>
          <ul className="ext-updates__list">
            {failedOutcomes.map((f) => (
              <li key={`failed-${f.internalName}`} className="ext-updates__row">
                <span className="ext-updates__name">
                  {updates.find((u) => u.internalName === f.internalName)?.name ?? f.internalName}
                </span>
                <span className="ext-updates__reason" title={f.message}>
                  {f.message}
                </span>
                <span className="ext-updates__row-actions">
                  <Button
                    size="compact"
                    variant="ambient"
                    loading={isUpdating(f.internalName)}
                    disabled={progress !== null}
                    onClick={() => updateOne(f.internalName)}
                  >
                    Retry
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {ignoredList.length > 0 && (
        <section className="ext-updates__group" aria-label="Ignored updates">
          <button
            type="button"
            className="ext-updates__disclosure"
            aria-expanded={showIgnored}
            onClick={() => setShowIgnored(!showIgnored)}
          >
            {showIgnored ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            Ignored ({ignoredList.length})
          </button>
          {showIgnored && (
            <ul className="ext-updates__list">
              {ignoredList.map((item) => (
                <li key={item.internalName} className="ext-updates__row">
                  <span className="ext-updates__name">{item.name ?? item.internalName}</span>
                  <span className="ext-updates__reason" title={item.reason}>
                    {item.isAutoIgnored
                      ? `Kept failing${item.failureCount > 0 ? ` (${item.failureCount}×)` : ''}: ${item.reason}`
                      : item.reason}
                  </span>
                  <span className="ext-updates__row-actions">
                    <Button size="compact" variant="ambient" onClick={() => unignoreUpdate(item.internalName)}>
                      Unignore
                    </Button>
                    <Button
                      size="compact"
                      variant="ambient"
                      loading={isUpdating(item.internalName)}
                      disabled={progress !== null}
                      onClick={() => updateOne(item.internalName)}
                    >
                      Retry
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
};
