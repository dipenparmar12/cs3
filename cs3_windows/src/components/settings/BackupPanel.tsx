import React, { useState } from 'react';
import { Archive, Download, Upload, Loader2, Check, AlertTriangle, Undo2 } from 'lucide-react';
import { useFlash } from '../../utils/useFlash';
import { formatBytes } from '../../utils/format';

/**
 * Take this installation somewhere else, and bring it back.
 *
 * There were two exports before this and neither answered the question. The
 * Android backup carries the key/value store in the *phone's* format, for moving
 * between the two apps; library and history each exported themselves. So moving
 * to a new machine meant finding several files and still losing the
 * repositories, the extensions switched off, the saved pages and the indexer
 * configuration.
 *
 * ## Restore is a two-step, deliberately
 *
 * Choosing a file and applying it are separate presses, with the file's own
 * contents shown in between. A restore writes over live data, and the only
 * honest way to confirm one is against what is *in* the file — its date, the
 * version that wrote it, and how many rows each section holds — rather than
 * against its filename. The undo is offered afterwards for the same reason.
 */

const SECTION_LABELS: Record<string, string> = {
  settings: 'Settings and preferences',
  library: 'Library and watch progress',
  history: 'Watch history',
  bookmarks: 'Saved pages',
  searchHistory: 'Past searches',
  titleOutcomes: 'Title outcomes',
  providerAnalytics: 'Provider measurements',
  downloads: 'Download queue',
  extensions: 'Repositories and what is switched off',
  indexers: 'Indexer configuration',
};

interface Chosen {
  path: string;
  createdAt: number;
  version: string;
  platform: string;
  summary: Record<string, number>;
}

export const BackupPanel: React.FC = () => {
  const [busy, setBusy] = useState<'export' | 'choose' | 'restore' | 'undo' | null>(null);
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [restored, setRestored] = useState<Array<{ name: string; restored: number; note?: string }> | null>(
    null
  );
  const { message: notice, flash } = useFlash<{ text: string; bad?: boolean }>(6000);

  const exportNow = async () => {
    setBusy('export');
    try {
      const result = await window.cloudstream?.exportUserData?.();
      if (result?.cancelled) return;
      if (result?.ok) {
        flash({
          text: `Saved ${formatBytes(result.bytes ?? 0)} to ${result.path}`,
        });
      } else {
        flash({ text: result?.error ?? 'The export could not be written.', bad: true });
      }
    } finally {
      setBusy(null);
    }
  };

  const chooseFile = async () => {
    setBusy('choose');
    setRestored(null);
    try {
      const result = await window.cloudstream?.inspectBackup?.();
      if (result?.cancelled) return;
      if (!result?.ok || !result.envelope || !result.path) {
        setChosen(null);
        flash({ text: result?.error ?? 'That file could not be read.', bad: true });
        return;
      }
      setChosen({
        path: result.path,
        createdAt: result.envelope.createdAt,
        version: result.envelope.app.version,
        platform: result.envelope.app.platform,
        summary: result.envelope.summary,
      });
    } finally {
      setBusy(null);
    }
  };

  const restoreNow = async () => {
    if (!chosen) return;
    setBusy('restore');
    try {
      const result = await window.cloudstream?.restoreUserData?.(chosen.path);
      if (result?.ok && result.sections) {
        setRestored(result.sections);
        const total = result.sections.reduce((sum, row) => sum + row.restored, 0);
        flash({ text: `Restored ${total} item${total === 1 ? '' : 's'}. Restart to reload extensions.` });
      } else {
        flash({ text: result?.error ?? 'The restore did not complete.', bad: true });
      }
    } finally {
      setBusy(null);
    }
  };

  const undo = async () => {
    setBusy('undo');
    try {
      const result = await window.cloudstream?.undoRestore?.();
      flash(
        result?.ok
          ? { text: 'Settings put back as they were before the restore.' }
          : { text: 'There was nothing to undo.', bad: true }
      );
      if (result?.ok) setRestored(null);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="backup-panel">
      <p className="backup-panel__lede">
        One file holding your library, watch history, saved pages, searches, settings, which
        repositories and extensions you have and which are switched off, and your indexer
        configuration. Enough to make another machine into this one.
      </p>
      <p className="backup-panel__note">
        Extension archives and downloaded files are not included — they are large and can be
        fetched again. The backup records <em>which</em> ones you had, which is the part that
        cannot be: a restore puts your repositories back and remembers what you had switched
        off, then one press per repository fetches the archives. Tokens and device ids are
        stripped on the way out.
      </p>

      <div className="backup-panel__actions">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void exportNow()}
          disabled={busy !== null}
        >
          {busy === 'export' ? <Loader2 size={15} className="spin" /> : <Download size={15} />}
          Export my data
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => void chooseFile()}
          disabled={busy !== null}
        >
          {busy === 'choose' ? <Loader2 size={15} className="spin" /> : <Upload size={15} />}
          Choose a backup…
        </button>
      </div>

      {/* What is actually in the chosen file — the only honest basis for
          confirming a write over live data. */}
      {chosen && (
        <div className="backup-panel__chosen">
          <h4>
            <Archive size={15} /> Backup from {new Date(chosen.createdAt).toLocaleString()}
          </h4>
          <p className="backup-panel__meta">
            Written by version {chosen.version} on {chosen.platform}
          </p>
          <ul className="backup-panel__summary">
            {Object.entries(chosen.summary).map(([name, count]) => (
              <li key={name}>
                <span>{SECTION_LABELS[name] ?? name}</span>
                <strong>{count < 0 ? 'unreadable' : count}</strong>
              </li>
            ))}
          </ul>
          <div className="backup-panel__actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void restoreNow()}
              disabled={busy !== null}
            >
              {busy === 'restore' ? <Loader2 size={15} className="spin" /> : <Upload size={15} />}
              Restore this backup
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setChosen(null)}
              disabled={busy !== null}
            >
              Cancel
            </button>
          </div>
          <p className="backup-panel__note">
            Restoring merges into what is here rather than replacing it, so nothing added since
            the backup was taken is lost.
          </p>
        </div>
      )}

      {restored && (
        <div className="backup-panel__result">
          <ul className="backup-panel__summary">
            {restored.map((row) => (
              <li key={row.name}>
                <span>{SECTION_LABELS[row.name] ?? row.name}</span>
                <strong>{row.note ? row.note : `${row.restored} restored`}</strong>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void undo()}
            disabled={busy !== null}
          >
            {busy === 'undo' ? <Loader2 size={15} className="spin" /> : <Undo2 size={15} />}
            Undo settings restore
          </button>
        </div>
      )}

      {notice && (
        <div
          className={`backup-panel__flash${notice.bad ? ' backup-panel__flash--bad' : ''}`}
          role="status"
        >
          {notice.bad ? <AlertTriangle size={14} /> : <Check size={14} />}
          <span>{notice.text}</span>
        </div>
      )}
    </div>
  );
};
