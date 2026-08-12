import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, ArrowUpCircle, CheckCircle2, AlertTriangle, Clock } from 'lucide-react';
import type {
  AvailableUpdate,
  UpdateOutcome,
  UpdatePolicy,
  UpdateSettings,
} from '../../electron/cs3/extensionUpdater';

/**
 * Over-the-air extension updates.
 *
 * Extensions come from their original Android maintainers and change on their
 * schedule. This panel keeps that flow independent of the app's own release
 * cycle: a provider fix published upstream is one click away, and nobody
 * reinstalls the desktop app to get it.
 */

const POLICY_LABELS: Record<UpdatePolicy, { title: string; detail: string }> = {
  manual: {
    title: 'Manual only',
    detail: 'Nothing is checked automatically. Use the button above.',
  },
  startup: {
    title: 'On every launch',
    detail: 'Checks shortly after the app starts, so it never delays startup.',
  },
  daily: {
    title: 'Daily',
    detail: 'Checks at most once every 24 hours, catching up if the app was closed.',
  },
};

export const ExtensionUpdates: React.FC<{ onUpdated?: () => void }> = ({ onUpdated }) => {
  const [updates, setUpdates] = useState<AvailableUpdate[]>([]);
  const [settings, setSettings] = useState<UpdateSettings | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const api = window.cloudstream;

  useEffect(() => {
    if (!api) return;
    api.getCachedExtensionUpdates().then(setUpdates);
    api.getUpdateSettings().then(setSettings);
  }, [api]);

  // Background checks and auto-installs happen in the main process, so the panel
  // subscribes rather than polling; otherwise an auto-update would silently
  // disagree with what is on screen.
  useEffect(() => {
    if (!api) return;
    return api.onExtensionUpdateEvent((event, payload) => {
      switch (event) {
        case 'extension:updateCheckStarted':
          setChecking(true);
          break;
        case 'extension:updateCheckFinished': {
          const result = payload as { updates: AvailableUpdate[]; warnings: string[] };
          setUpdates(result.updates);
          setWarnings(result.warnings ?? []);
          setChecking(false);
          break;
        }
        case 'extension:updateProgress':
          setProgress(payload as { current: number; total: number });
          break;
        case 'extension:autoUpdateCompleted': {
          const { outcomes } = payload as { outcomes: UpdateOutcome[] };
          const ok = outcomes.filter((o) => o.ok).length;
          setMessage(`Automatically updated ${ok} of ${outcomes.length} extensions.`);
          api.getCachedExtensionUpdates().then(setUpdates);
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
    const response = await api.checkExtensionUpdates();
    setChecking(false);

    if (!response.ok || !response.result) {
      setMessage(`Could not check for updates: ${response.error ?? 'unknown error'}`);
      return;
    }
    setUpdates(response.result.updates);
    setWarnings(response.result.warnings);
    setSettings(await api.getUpdateSettings());
    setMessage(
      response.result.updates.length === 0
        ? `All extensions are up to date (${response.result.repositoriesChecked} repositories checked).`
        : null
    );
  }, [api]);

  const updateOne = useCallback(
    async (internalName: string) => {
      if (!api) return;
      setBusy((prev) => new Set(prev).add(internalName));
      const outcome = await api.updateExtension(internalName);
      setBusy((prev) => {
        const next = new Set(prev);
        next.delete(internalName);
        return next;
      });
      setMessage(outcome.message);
      setUpdates(await api.getCachedExtensionUpdates());
      if (outcome.ok) onUpdated?.();
    },
    [api, onUpdated]
  );

  const updateEverything = useCallback(async () => {
    if (!api || updates.length === 0) return;
    setProgress({ current: 0, total: updates.length });
    const outcomes = await api.updateAllExtensions();
    setProgress(null);

    const ok = outcomes.filter((o) => o.ok).length;
    const failed = outcomes.filter((o) => !o.ok);
    setMessage(
      failed.length === 0
        ? `Updated all ${ok} extensions.`
        : `Updated ${ok} of ${outcomes.length}. Failed: ${failed
            .map((f) => f.internalName)
            .join(', ')}.`
    );
    setUpdates(await api.getCachedExtensionUpdates());
    onUpdated?.();
  }, [api, updates.length, onUpdated]);

  const savePolicy = useCallback(
    async (patch: Partial<UpdateSettings>) => {
      if (!api) return;
      setSettings(await api.saveUpdateSettings(patch));
    },
    [api]
  );

  const lastChecked = settings?.lastCheckedAt
    ? new Date(settings.lastCheckedAt).toLocaleString()
    : 'never';

  return (
    <section style={{ marginBottom: '2rem' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1rem',
          marginBottom: '0.85rem',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
            <ArrowUpCircle size={18} />
            Extension updates
          </h3>
          <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)', margin: '0.3rem 0 0' }}>
            Updates come straight from the original maintainers. The app itself does not need
            reinstalling. Last checked: {lastChecked}.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn btn-secondary" onClick={check} disabled={checking}>
            <RefreshCw size={15} className={checking ? 'spin' : undefined} />
            <span>{checking ? 'Checking…' : 'Check for updates'}</span>
          </button>
          <button
            className="btn btn-primary"
            onClick={updateEverything}
            disabled={updates.length === 0 || progress !== null}
          >
            <ArrowUpCircle size={15} />
            <span>
              {progress
                ? `Updating ${progress.current}/${progress.total}…`
                : `Update all${updates.length ? ` (${updates.length})` : ''}`}
            </span>
          </button>
        </div>
      </header>

      {message && (
        <div
          style={{
            padding: '0.6rem 0.8rem',
            borderRadius: 8,
            background: 'var(--surface-2, rgba(255,255,255,0.04))',
            fontSize: '0.8rem',
            marginBottom: '0.75rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          <CheckCircle2 size={15} style={{ color: 'var(--status-success)' }} />
          {message}
        </div>
      )}

      {updates.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 1rem' }}>
          {updates.map((u) => (
            <li
              key={u.internalName}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '1rem',
                padding: '0.7rem 0.85rem',
                borderRadius: 8,
                background: 'var(--surface-2, rgba(255,255,255,0.04))',
                marginBottom: '0.4rem',
              }}
            >
              <div style={{ minWidth: 0 }}>
                <strong style={{ fontSize: '0.87rem' }}>{u.name}</strong>
                <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                  v{u.installedVersion} → <strong>v{u.availableVersion}</strong>
                  {u.fileSize ? ` · ${(u.fileSize / 1024).toFixed(0)} KB` : ''}
                </div>
                {u.description && (
                  <div
                    style={{
                      fontSize: '0.72rem',
                      color: 'var(--text-subtle)',
                      marginTop: '0.2rem',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      maxWidth: '46ch',
                    }}
                    title={u.description}
                  >
                    {u.description}
                  </div>
                )}
              </div>
              <button
                className="btn btn-secondary"
                onClick={() => updateOne(u.internalName)}
                disabled={busy.has(u.internalName)}
                style={{ flexShrink: 0 }}
              >
                {busy.has(u.internalName) ? 'Updating…' : 'Update'}
              </button>
            </li>
          ))}
        </ul>
      )}

      {warnings.length > 0 && (
        <details style={{ marginBottom: '1rem', fontSize: '0.75rem' }}>
          <summary
            style={{
              cursor: 'pointer',
              color: 'var(--status-warning, #d19a2f)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
            }}
          >
            <AlertTriangle size={14} />
            {warnings.length} repository warning{warnings.length === 1 ? '' : 's'}
          </summary>
          <ul style={{ color: 'var(--text-muted)', marginTop: '0.5rem' }}>
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      )}

      <div
        style={{
          padding: '0.85rem',
          borderRadius: 8,
          border: '1px solid var(--border, rgba(255,255,255,0.08))',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            fontSize: '0.8rem',
            marginBottom: '0.6rem',
          }}
        >
          <Clock size={15} />
          <strong>Automatic checks</strong>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.6rem' }}>
          {(Object.keys(POLICY_LABELS) as UpdatePolicy[]).map((policy) => (
            <button
              key={policy}
              className={`btn ${settings?.policy === policy ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => savePolicy({ policy })}
              title={POLICY_LABELS[policy].detail}
              style={{ fontSize: '0.76rem' }}
            >
              {POLICY_LABELS[policy].title}
            </button>
          ))}
        </div>

        <label
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '0.5rem',
            fontSize: '0.78rem',
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={settings?.autoInstall ?? false}
            onChange={(e) => savePolicy({ autoInstall: e.target.checked })}
            style={{ marginTop: '0.15rem' }}
          />
          <span>
            Install updates automatically
            <span style={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.72rem' }}>
              Off by default. Extensions run code you chose to trust at a particular version, so
              replacing it is left as your call. With this on, new versions install silently on
              the schedule above.
            </span>
          </span>
        </label>

        <p
          style={{
            fontSize: '0.72rem',
            color: 'var(--text-subtle)',
            margin: '0.6rem 0 0',
          }}
        >
          {settings ? POLICY_LABELS[settings.policy].detail : ''}
        </p>
      </div>
    </section>
  );
};
