import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  RefreshCw,
  ArrowUpCircle,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  EyeOff,
  RotateCcw,
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

  return (
    <div className="ext-updates-container">
      {/* Top Header Card */}
      <div className="ext-updates-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <ArrowUpCircle
            size={18}
            style={{
              color: activeUpdates.length > 0 ? 'var(--accent-light)' : 'var(--text-subtle)',
            }}
          />
          <div>
            <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#fff' }}>
              Extension Updates
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-subtle)' }}>
              {activeUpdates.length > 0
                ? `${activeUpdates.length} update(s) available`
                : 'All active extensions up to date'}
              {lastCheckedStr}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={check}
            disabled={checking || progress !== null}
          >
            <RefreshCw size={12} className={checking ? 'spin' : undefined} />
            <span>{checking ? 'Checking…' : 'Check for Updates'}</span>
          </button>

          {failedOutcomes.length > 0 && (
            <button
              type="button"
              className="btn btn-secondary btn-sm btn--danger-text"
              onClick={retryFailed}
              disabled={progress !== null}
            >
              <RotateCcw size={12} className={progress !== null ? 'spin' : undefined} />
              <span>Retry Failed ({failedOutcomes.length})</span>
            </button>
          )}

          {activeUpdates.length > 0 && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={updateEverything}
              disabled={progress !== null || checking}
            >
              <ArrowUpCircle size={13} />
              <span>
                {progress
                  ? `Updating ${progress.current}/${progress.total}…`
                  : updating.length > 0
                    ? `Updating ${updating.length}…`
                    : `Update All (${activeUpdates.length})`}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Auto-install Settings */}
      {settings && (
        <div className="ext-update-policy" style={{ margin: 0 }}>
          <label>
            <input
              type="checkbox"
              checked={settings.autoInstall}
              onChange={(event) => void changeSettings({ autoInstall: event.target.checked })}
            />
            Install updates automatically
          </label>
          <label>
            Check
            <select
              value={settings.policy}
              onChange={(event) =>
                void changeSettings({ policy: event.target.value as UpdateSettings['policy'] })
              }
            >
              <option value="startup">every time the app opens</option>
              <option value="daily">once a day</option>
              <option value="manual">only when I press Check</option>
            </select>
          </label>
        </div>
      )}

      {/* Status feedback message */}
      {message && (
        <div
          style={{
            padding: '0.45rem 0.75rem',
            borderRadius: 'var(--radius-sm)',
            background: message.isError ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.12)',
            color: '#fff',
            fontSize: '0.78rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.45rem',
          }}
        >
          {message.isError ? (
            <AlertCircle size={14} style={{ color: 'var(--status-error, #ef4444)' }} />
          ) : (
            <CheckCircle2 size={14} style={{ color: 'var(--status-success, #10b981)' }} />
          )}
          <span>{message.text}</span>
        </div>
      )}

      {/* Maintainer notices */}
      {notices.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          {notices.map((notice) => (
            <div
              key={`notice-${notice.internalName}`}
              role="status"
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.45rem',
                padding: '0.5rem 0.75rem',
                borderRadius: 'var(--radius-sm)',
                background: 'rgba(245, 158, 11, 0.12)',
                border: '1px solid rgba(245, 158, 11, 0.3)',
                fontSize: '0.75rem',
                lineHeight: 1.4,
                color: 'var(--text-main)',
              }}
            >
              <AlertCircle size={14} style={{ color: '#f59e0b', flexShrink: 0, marginTop: '0.1rem' }} />
              <span>{notice.message}</span>
            </div>
          ))}
        </div>
      )}

      {/* Active updates list */}
      <div className="ext-updates-section">
        <div className="ext-updates-section__title">
          <span>Available Updates ({activeUpdates.length})</span>
          {activeUpdates.length > 0 && (
            <span style={{ fontSize: '0.72rem', color: 'var(--text-subtle)' }}>
              Ready to install
            </span>
          )}
        </div>

        {activeUpdates.length === 0 ? (
          <div
            style={{
              padding: '1.5rem',
              textAlign: 'center',
              background: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--text-muted)',
              fontSize: '0.82rem',
            }}
          >
            <CheckCircle2
              size={24}
              style={{ color: 'var(--status-success, #10b981)', marginBottom: '0.4rem', opacity: 0.9 }}
            />
            <div>All active extensions are up to date.</div>
            {ignoredList.length > 0 && (
              <div style={{ fontSize: '0.73rem', color: 'var(--text-subtle)', marginTop: '0.3rem' }}>
                {ignoredList.length} failing extension(s) have been ignored to prevent recurring errors.
              </div>
            )}
          </div>
        ) : (
          activeUpdates.map((u) => (
            <div key={u.internalName} className="ext-update-card">
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#fff' }}>
                    {u.name}
                  </span>
                  <span style={{ fontSize: '0.73rem', color: 'var(--text-subtle)' }}>
                    {u.reason === 'republished' ? (
                      <>
                        v{u.availableVersion} <strong>rebuilt</strong>
                      </>
                    ) : (
                      <>
                        v{u.installedVersion} ➔ <strong>v{u.availableVersion}</strong>
                      </>
                    )}
                    {u.fileSize ? ` (${(u.fileSize / 1024).toFixed(0)} KB)` : ''}
                  </span>
                </div>
                {u.description && (
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-subtle)', marginTop: '0.2rem' }}>
                    {u.description}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => ignoreUpdate(u.internalName, 'Ignored by user')}
                  title="Ignore this update to suppress future notifications"
                  style={{ fontSize: '0.72rem', padding: '0.25rem 0.5rem' }}
                >
                  <EyeOff size={11} style={{ marginRight: '0.25rem' }} />
                  Ignore
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => updateOne(u.internalName)}
                  disabled={isUpdating(u.internalName) || progress !== null}
                  style={{ fontSize: '0.72rem', padding: '0.25rem 0.6rem' }}
                >
                  {isUpdating(u.internalName) ? 'Updating…' : 'Update'}
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Current session failed updates */}
      {failedOutcomes.length > 0 && (
        <div className="ext-updates-section">
          <div className="ext-updates-section__title" style={{ color: 'var(--status-error, #ef4444)' }}>
            <span>Failed Updates ({failedOutcomes.length})</span>
            <span style={{ fontSize: '0.72rem', color: '#ff9999' }}>
              Auto-ignored to prevent endless retries
            </span>
          </div>

          {failedOutcomes.map((f) => (
            <div key={`failed-${f.internalName}`} className="ext-update-card ext-update-card--failed">
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <AlertCircle size={14} style={{ color: 'var(--status-error, #ef4444)', flexShrink: 0 }} />
                  <span style={{ fontSize: '0.82rem', fontWeight: 600, color: '#fff' }}>
                    {updates.find((u) => u.internalName === f.internalName)?.name ?? f.internalName}
                  </span>
                </div>
                <div style={{ fontSize: '0.72rem', color: '#ff9999', marginTop: '0.2rem', wordBreak: 'break-word' }}>
                  {f.message}
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => updateOne(f.internalName)}
                  disabled={isUpdating(f.internalName) || progress !== null}
                  style={{ fontSize: '0.72rem', padding: '0.25rem 0.5rem' }}
                >
                  {isUpdating(f.internalName) ? 'Retrying…' : 'Retry'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Ignored updates section */}
      {ignoredList.length > 0 && (
        <div className="ext-updates-section">
          <div
            className="ext-ignored-banner"
            onClick={() => setShowIgnored(!showIgnored)}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <EyeOff size={15} style={{ color: '#f59e0b' }} />
              <div>
                <strong>Ignored / Suppressed Updates ({ignoredList.length})</strong>
                <span style={{ color: 'var(--text-subtle)', marginLeft: '0.4rem', fontSize: '0.72rem' }}>
                  Failing upstream provider builds or manually muted
                </span>
              </div>
            </div>
            {showIgnored ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </div>

          {showIgnored && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginTop: '0.25rem' }}>
              {ignoredList.map((item) => (
                <div key={item.internalName} className="ext-update-card ext-update-card--ignored">
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <span style={{ fontSize: '0.82rem', fontWeight: 600, color: '#fff' }}>
                        {item.name ?? item.internalName}
                      </span>
                      {item.isAutoIgnored && (
                        <span
                          className="poster-badge"
                          style={{
                            position: 'static',
                            backgroundColor: 'rgba(245, 158, 11, 0.2)',
                            color: '#f59e0b',
                            fontSize: '0.65rem',
                            border: '1px solid rgba(245, 158, 11, 0.4)',
                          }}
                        >
                          Provider Failure
                        </span>
                      )}
                      {item.failureCount > 0 && (
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-subtle)' }}>
                          ({item.failureCount} failure{item.failureCount > 1 ? 's' : ''})
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: '#ffaaaa', marginTop: '0.15rem', wordBreak: 'break-word' }}>
                      {item.reason}
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => unignoreUpdate(item.internalName)}
                      style={{ fontSize: '0.72rem', padding: '0.25rem 0.5rem' }}
                    >
                      Unignore
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => updateOne(item.internalName)}
                      disabled={isUpdating(item.internalName) || progress !== null}
                      style={{ fontSize: '0.72rem', padding: '0.25rem 0.5rem' }}
                    >
                      {isUpdating(item.internalName) ? 'Retrying…' : 'Retry'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
