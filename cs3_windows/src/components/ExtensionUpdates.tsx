import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, ArrowUpCircle, CheckCircle2, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import type {
  AvailableUpdate,
  ExtensionNotice,
  UpdateOutcome,
  UpdateSettings,
} from '../../electron/cs3/extensionUpdater';
import { describeError } from '../utils/errors';

export interface StatusMessage {
  text: string;
  isError?: boolean;
}

export const ExtensionUpdates: React.FC<{ onUpdated?: () => void }> = ({ onUpdated }) => {
  const [updates, setUpdates] = useState<AvailableUpdate[]>([]);
  /**
   * Extensions their own maintainer has marked as not working.
   *
   * Held beside the updates rather than folded into them because they call for
   * a different response: an update is something to press, and this is
   * something to stop debugging. Nothing is switched off on the strength of it
   * — a status is the author's information, not the app's decision.
   */
  const [notices, setNotices] = useState<ExtensionNotice[]>([]);
  const [failedOutcomes, setFailedOutcomes] = useState<UpdateOutcome[]>([]);
  const [settings, setSettings] = useState<UpdateSettings | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [message, setMessage] = useState<StatusMessage | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  const api = window.cloudstream;

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
  }, [api]);

  useEffect(() => {
    if (!api) return;
    return api.onExtensionUpdateEvent((event, payload) => {
      switch (event) {
        case 'extension:updateCheckStarted':
          setChecking(true);
          break;
        case 'extension:updateCheckFinished': {
          const result = payload as { updates?: AvailableUpdate[]; warnings?: string[] };
          const safeUpdates = Array.isArray(result?.updates) ? result.updates : [];
          setUpdates(safeUpdates);
          setChecking(false);
          if (safeUpdates.length > 0) setIsExpanded(true);
          break;
        }
        case 'extension:updateProgress':
          setProgress(payload as { current: number; total: number });
          break;
        case 'extension:autoUpdateCompleted': {
          const { outcomes } = payload as { outcomes?: UpdateOutcome[] };
          const safeOutcomes = Array.isArray(outcomes) ? outcomes : [];
          const ok = safeOutcomes.filter((o) => o?.ok).length;
          const failed = safeOutcomes.filter((o) => !o?.ok);
          setFailedOutcomes(failed);
          setMessage({
            text: failed.length > 0
              ? `Auto-updated ${ok} of ${safeOutcomes.length} extensions (${failed.length} failed).`
              : `Auto-updated all ${ok} extension(s).`,
            isError: failed.length > 0,
          });
          if (failed.length > 0) setIsExpanded(true);
          api
            .getCachedExtensionUpdates()
            .then((res) => setUpdates(Array.isArray(res) ? res : []))
            .catch(() => {});
          onUpdated?.();
          break;
        }
        default:
          break;
      }
    });
  }, [api, onUpdated]);

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
      if (safeUpdates.length > 0) setIsExpanded(true);
      setMessage(
        safeUpdates.length === 0
          ? {
              text: `All extensions up to date (${response.result.repositoriesChecked ?? 0} repos checked).`,
              isError: false,
            }
          : null
      );
    } catch (err) {
      setChecking(false);
      setMessage({ text: `Check failed: ${describeError(err)}`, isError: true });
    }
  }, [api]);

  const updateOne = useCallback(
    async (internalName: string) => {
      if (!api) return;
      setBusy((prev) => new Set(prev).add(internalName));
      try {
        const outcome = await api.updateExtension(internalName);
        setMessage({ text: outcome.message, isError: !outcome.ok });
        if (outcome.ok) {
          setFailedOutcomes((prev) => prev.filter((f) => f.internalName !== internalName));
          onUpdated?.();
        } else {
          setFailedOutcomes((prev) => {
            const next = prev.filter((f) => f.internalName !== internalName);
            next.push(outcome);
            return next;
          });
        }
        const cached = await api.getCachedExtensionUpdates().catch(() => []);
        setUpdates(Array.isArray(cached) ? cached : []);
      } catch (err) {
        setMessage({ text: `Update failed: ${describeError(err)}`, isError: true });
      } finally {
        setBusy((prev) => {
          const next = new Set(prev);
          next.delete(internalName);
          return next;
        });
      }
    },
    [api, onUpdated]
  );

  const updateEverything = useCallback(async () => {
    if (!api || updates.length === 0) return;
    setProgress({ current: 0, total: updates.length });
    try {
      const outcomes = await api.updateAllExtensions();
      const safeOutcomes = Array.isArray(outcomes) ? outcomes : [];
      const ok = safeOutcomes.filter((o) => o?.ok).length;
      const failed = safeOutcomes.filter((o) => !o?.ok);
      setFailedOutcomes(failed);
      setMessage({
        text: failed.length > 0
          ? `Updated ${ok} of ${safeOutcomes.length} extension(s) (${failed.length} failed).`
          : `Updated all ${ok} extension(s).`,
        isError: failed.length > 0,
      });
      if (failed.length > 0) setIsExpanded(true);
      const cached = await api.getCachedExtensionUpdates().catch(() => []);
      setUpdates(Array.isArray(cached) ? cached : []);
      onUpdated?.();
    } catch (err) {
      setMessage({ text: `Update all failed: ${describeError(err)}`, isError: true });
    } finally {
      setProgress(null);
    }
  }, [api, updates.length, onUpdated]);

  const retryFailed = useCallback(async () => {
    if (!api || failedOutcomes.length === 0) return;
    const targets = failedOutcomes.map((f) => f.internalName);
    setProgress({ current: 0, total: targets.length });
    try {
      const outcomes = await api.updateAllExtensions(targets);
      const safeOutcomes = Array.isArray(outcomes) ? outcomes : [];
      const ok = safeOutcomes.filter((o) => o?.ok).length;
      const stillFailed = safeOutcomes.filter((o) => !o?.ok);
      setFailedOutcomes(stillFailed);
      setMessage({
        text: stillFailed.length > 0
          ? `Updated ${ok} of ${safeOutcomes.length} extension(s) (${stillFailed.length} failed).`
          : `Updated all ${ok} extension(s).`,
        isError: stillFailed.length > 0,
      });
      const cached = await api.getCachedExtensionUpdates().catch(() => []);
      setUpdates(Array.isArray(cached) ? cached : []);
      onUpdated?.();
    } catch (err) {
      setMessage({ text: `Retry failed: ${describeError(err)}`, isError: true });
    } finally {
      setProgress(null);
    }
  }, [api, failedOutcomes, onUpdated]);

  const safeUpdates = Array.isArray(updates) ? updates : [];
  const lastCheckedStr = settings?.lastCheckedAt
    ? ` (Last checked: ${new Date(settings.lastCheckedAt).toLocaleTimeString()})`
    : '';

  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid',
      borderColor: failedOutcomes.length > 0
        ? 'var(--status-error, #ef4444)'
        : safeUpdates.length > 0
          ? 'var(--accent-primary)'
          : 'var(--border-color)',
      borderRadius: 'var(--radius-md)',
      padding: '0.6rem 1rem',
      transition: 'all 0.2s ease'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div
          onClick={() => setIsExpanded(!isExpanded)}
          style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: 'pointer', flex: 1 }}
        >
          <ArrowUpCircle
            size={16}
            style={{
              color: failedOutcomes.length > 0
                ? 'var(--status-error, #ef4444)'
                : safeUpdates.length > 0
                  ? 'var(--accent-light)'
                  : 'var(--text-subtle)',
            }}
          />
          <span style={{ fontSize: '0.83rem', fontWeight: 600, color: '#fff' }}>
            Extension Updates{lastCheckedStr}
          </span>
          {failedOutcomes.length > 0 ? (
            <span
              className="poster-badge"
              style={{
                position: 'static',
                backgroundColor: 'var(--status-error, #ef4444)',
                color: '#fff',
                fontSize: '0.68rem',
              }}
            >
              {failedOutcomes.length} failed
            </span>
          ) : safeUpdates.length > 0 ? (
            <span
              className="poster-badge"
              style={{
                position: 'static',
                backgroundColor: 'var(--accent-primary)',
                color: '#fff',
                fontSize: '0.68rem',
              }}
            >
              {safeUpdates.length} update(s) available
            </span>
          ) : (
            <span style={{ fontSize: '0.73rem', color: 'var(--text-muted)' }}>Up to date</span>
          )}
          {isExpanded ? <ChevronUp size={14} style={{ color: 'var(--text-subtle)' }} /> : <ChevronDown size={14} style={{ color: 'var(--text-subtle)' }} />}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <button
            className="btn btn-secondary"
            onClick={check}
            disabled={checking || progress !== null}
            style={{ fontSize: '0.73rem', padding: '0.25rem 0.6rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
          >
            <RefreshCw size={12} className={checking ? 'spin' : undefined} />
            <span>{checking ? 'Checking…' : 'Check Updates'}</span>
          </button>

          {failedOutcomes.length > 0 && (
            <button
              className="btn btn-secondary"
              onClick={retryFailed}
              disabled={progress !== null}
              style={{
                fontSize: '0.73rem',
                padding: '0.25rem 0.6rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                borderColor: 'var(--status-error, #ef4444)',
                color: '#ff8888',
              }}
            >
              <RefreshCw size={12} className={progress !== null ? 'spin' : undefined} />
              <span>Retry Failed ({failedOutcomes.length})</span>
            </button>
          )}

          {safeUpdates.length > 0 && (
            <button
              className="btn btn-primary"
              onClick={updateEverything}
              disabled={progress !== null}
              style={{ fontSize: '0.73rem', padding: '0.25rem 0.6rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
            >
              <ArrowUpCircle size={12} />
              <span>
                {progress ? `Updating ${progress.current}/${progress.total}…` : `Update All (${safeUpdates.length})`}
              </span>
            </button>
          )}
        </div>
      </div>

      {message && (
        <div style={{
          marginTop: '0.5rem',
          padding: '0.4rem 0.65rem',
          borderRadius: 'var(--radius-sm)',
          background: message.isError ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.12)',
          color: '#fff',
          fontSize: '0.75rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.4rem'
        }}>
          {message.isError ? (
            <AlertCircle size={13} style={{ color: 'var(--status-error, #ef4444)' }} />
          ) : (
            <CheckCircle2 size={13} style={{ color: 'var(--status-success, #10b981)' }} />
          )}
          <span>{message.text}</span>
        </div>
      )}

      {/*
        What the maintainers have said about what is installed.

        Always shown rather than folded behind the expander: someone whose
        provider has been returning nothing all week is not going to go looking
        for it, and this is the one line that ends the investigation. Not an
        action — nothing here is switched off on the author's say-so.
      */}
      {notices.length > 0 && (
        <div style={{ marginTop: '0.6rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          {notices.map((notice) => (
            <div
              key={`notice-${notice.internalName}`}
              role="status"
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.45rem',
                padding: '0.45rem 0.65rem',
                borderRadius: 'var(--radius-sm)',
                background: 'rgba(245, 158, 11, 0.12)',
                border: '1px solid rgba(245, 158, 11, 0.3)',
                fontSize: '0.74rem',
                lineHeight: 1.4,
                color: 'var(--text-main)',
              }}
            >
              <AlertCircle size={13} style={{ color: '#f59e0b', flexShrink: 0, marginTop: '0.1rem' }} />
              <span>{notice.message}</span>
            </div>
          ))}
        </div>
      )}

      {isExpanded && (safeUpdates.length > 0 || failedOutcomes.length > 0) && (
        <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.4rem', borderTop: '1px solid var(--border-color)', paddingTop: '0.6rem' }}>
          {/* Failed updates with error detail and Retry button */}
          {failedOutcomes.map((f) => (
            <div
              key={`failed-${f.internalName}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0.4rem 0.65rem',
                borderRadius: 'var(--radius-sm)',
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.25)',
                gap: '0.75rem',
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <AlertCircle size={13} style={{ color: 'var(--status-error, #ef4444)', flexShrink: 0 }} />
                  <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#fff' }}>
                    {safeUpdates.find((u) => u.internalName === f.internalName)?.name ?? f.internalName}
                  </span>
                </div>
                <div style={{ fontSize: '0.7rem', color: '#ff9999', marginTop: '0.2rem', wordBreak: 'break-word' }}>
                  {f.message}
                </div>
              </div>
              <button
                className="btn btn-secondary"
                onClick={() => updateOne(f.internalName)}
                disabled={busy.has(f.internalName) || progress !== null}
                style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem', flexShrink: 0 }}
              >
                {busy.has(f.internalName) ? 'Retrying…' : 'Retry'}
              </button>
            </div>
          ))}

          {/* Regular pending updates */}
          {safeUpdates
            .filter((u) => !failedOutcomes.some((f) => f.internalName === u.internalName))
            .map((u) => (
              <div
                key={u.internalName}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0.4rem 0.65rem',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--bg-input)',
                  gap: '0.75rem'
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#fff' }}>{u.name}</span>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-subtle)', marginLeft: '0.5rem' }}>
                    {/*
                      A republish carries the same version number on both
                      sides, so "v7 ➔ v7" reads as a bug in the updater rather
                      than as what it is: the maintainer pushed a fix without
                      bumping the field. Naming it is the whole difference.
                    */}
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
                <button
                  className="btn btn-secondary"
                  onClick={() => updateOne(u.internalName)}
                  disabled={busy.has(u.internalName) || progress !== null}
                  style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem', flexShrink: 0 }}
                >
                  {busy.has(u.internalName) ? 'Updating…' : 'Update'}
                </button>
              </div>
            ))}
        </div>
      )}
    </div>
  );
};
