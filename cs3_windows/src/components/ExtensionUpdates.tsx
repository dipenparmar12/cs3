import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, ArrowUpCircle, CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react';
import type {
  AvailableUpdate,
  UpdateOutcome,
  UpdateSettings,
} from '../../electron/cs3/extensionUpdater';

export const ExtensionUpdates: React.FC<{ onUpdated?: () => void }> = ({ onUpdated }) => {
  const [updates, setUpdates] = useState<AvailableUpdate[]>([]);
  const [settings, setSettings] = useState<UpdateSettings | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
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
          setMessage(`Auto-updated ${ok} of ${safeOutcomes.length} extensions.`);
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
    try {
      const response = await api.checkExtensionUpdates();
      setChecking(false);

      if (!response.ok || !response.result) {
        setMessage(`Check failed: ${response.error ?? 'unknown error'}`);
        return;
      }
      const safeUpdates = Array.isArray(response.result.updates) ? response.result.updates : [];
      setUpdates(safeUpdates);
      if (safeUpdates.length > 0) setIsExpanded(true);
      setMessage(
        safeUpdates.length === 0
          ? `All extensions up to date (${response.result.repositoriesChecked ?? 0} repos checked).`
          : null
      );
    } catch (err) {
      setChecking(false);
      setMessage(`Check failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [api]);

  const updateOne = useCallback(
    async (internalName: string) => {
      if (!api) return;
      setBusy((prev) => new Set(prev).add(internalName));
      try {
        const outcome = await api.updateExtension(internalName);
        setMessage(outcome.message);
        const cached = await api.getCachedExtensionUpdates().catch(() => []);
        setUpdates(Array.isArray(cached) ? cached : []);
        if (outcome.ok) onUpdated?.();
      } catch (err) {
        setMessage(`Update failed: ${err instanceof Error ? err.message : String(err)}`);
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
      setMessage(`Updated all ${ok} extension(s).`);
      const cached = await api.getCachedExtensionUpdates().catch(() => []);
      setUpdates(Array.isArray(cached) ? cached : []);
      onUpdated?.();
    } catch (err) {
      setMessage(`Update all failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setProgress(null);
    }
  }, [api, updates.length, onUpdated]);

  const safeUpdates = Array.isArray(updates) ? updates : [];
  const lastCheckedStr = settings?.lastCheckedAt
    ? ` (Last checked: ${new Date(settings.lastCheckedAt).toLocaleTimeString()})`
    : '';

  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid',
      borderColor: safeUpdates.length > 0 ? 'var(--accent-primary)' : 'var(--border-color)',
      borderRadius: 'var(--radius-md)',
      padding: '0.6rem 1rem',
      transition: 'all 0.2s ease'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div
          onClick={() => setIsExpanded(!isExpanded)}
          style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: 'pointer', flex: 1 }}
        >
          <ArrowUpCircle size={16} style={{ color: safeUpdates.length > 0 ? 'var(--accent-light)' : 'var(--text-subtle)' }} />
          <span style={{ fontSize: '0.83rem', fontWeight: 600, color: '#fff' }}>
            Extension Updates{lastCheckedStr}
          </span>
          {safeUpdates.length > 0 ? (
            <span className="poster-badge" style={{ position: 'static', backgroundColor: 'var(--accent-primary)', color: '#fff', fontSize: '0.68rem' }}>
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
            disabled={checking}
            style={{ fontSize: '0.73rem', padding: '0.25rem 0.6rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
          >
            <RefreshCw size={12} className={checking ? 'spin' : undefined} />
            <span>{checking ? 'Checking…' : 'Check Updates'}</span>
          </button>

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
          background: 'rgba(16, 185, 129, 0.12)',
          color: '#fff',
          fontSize: '0.75rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.4rem'
        }}>
          <CheckCircle2 size={13} style={{ color: 'var(--status-success)' }} />
          <span>{message}</span>
        </div>
      )}

      {isExpanded && safeUpdates.length > 0 && (
        <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.4rem', borderTop: '1px solid var(--border-color)', paddingTop: '0.6rem' }}>
          {safeUpdates.map((u) => (
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
                  v{u.installedVersion} ➔ <strong>v{u.availableVersion}</strong>
                  {u.fileSize ? ` (${(u.fileSize / 1024).toFixed(0)} KB)` : ''}
                </span>
              </div>
              <button
                className="btn btn-secondary"
                onClick={() => updateOne(u.internalName)}
                disabled={busy.has(u.internalName)}
                style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem' }}
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
