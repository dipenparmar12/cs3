/**
 * Where CS3 keeps things, how much each cache holds, and the safe way to empty one.
 *
 * Every number comes from `storage:getReport`; every Clear goes through the
 * cache's owning service (`storage:clearArea`), so nothing persistent — the
 * library, history, settings, downloads — can be reached from here. Paths are
 * shown in full in developer mode; everyone gets an Open button.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { FolderOpen, HardDrive, RotateCw, Trash2 } from 'lucide-react';
import type { StorageReport } from '../../../electron/storage/appStorage';
import { formatBytes } from '../../utils/format';
import { useIsDeveloper } from '../../utils/ExperienceModeContext';
import { SettingRow } from './SettingRow';

const LOCATIONS: Array<{ id: keyof StorageReport['locations']; label: string; hint: string }> = [
  { id: 'downloads', label: 'Downloads', hint: 'Films and episodes you asked to download. Never cleaned automatically.' },
  { id: 'cache', label: 'Cache', hint: 'Re-creatable: anything here is fetched again when needed. Tidied automatically.' },
  { id: 'temp', label: 'Temporary files', hint: 'Working files for things in progress. Removed when the app closes; leftovers from a crash are removed on the next launch.' },
  { id: 'data', label: 'App data', hint: 'Your library, history, profiles, settings and extensions. Cache clearing never touches it.' },
  { id: 'logs', label: 'Logs', hint: 'One file per launch, for diagnosing problems.' },
];

export const StoragePanel: React.FC = () => {
  const developer = useIsDeveloper();
  const [report, setReport] = useState<StorageReport | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const answer = await window.cloudstream?.getStorageReport?.();
    if (answer?.ok && answer.locations) setReport(answer as StorageReport);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (id: string, action: () => Promise<{ ok: boolean; error?: string } | undefined>, done: string) => {
    setBusy(id);
    setMessage(null);
    try {
      const result = await action();
      setMessage(result?.ok ? done : (result?.error ?? 'That did not work.'));
    } finally {
      setBusy(null);
      void load();
    }
  };

  if (!report) {
    return <SettingRow label="Storage">{<span className="muted">Measuring…</span>}</SettingRow>;
  }

  const cacheTotal = report.areas.reduce((sum, area) => sum + area.bytes, 0);
  const legacyTotal = report.legacy.reduce((sum, entry) => sum + entry.bytes, 0);

  return (
    <>
      {LOCATIONS.map(({ id, label, hint }) => (
        <SettingRow
          key={id}
          label={label}
          hint={hint}
          note={
            developer ? (
              <code className="storage-path">{report.locations[id]}</code>
            ) : id === 'cache' ? (
              formatBytes(cacheTotal, 'Empty')
            ) : id === 'temp' ? (
              formatBytes(report.tempBytes, 'Empty')
            ) : undefined
          }
          keywords="storage disk space folder location path"
        >
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            title={report.locations[id]}
            onClick={() => void window.cloudstream?.openStorageLocation?.(id)}
          >
            <FolderOpen size={14} /> Open
          </button>
        </SettingRow>
      ))}

      {report.areas.map((area) => (
        <SettingRow
          key={area.id}
          label={area.label}
          level="advanced"
          keywords="cache clear storage disk space"
          note={
            <>
              {formatBytes(area.bytes, 'Empty')}
              {area.maxAgeDays ? ` · kept ${area.maxAgeDays} days` : ''}
              {area.maxBytes ? ` · up to ${formatBytes(area.maxBytes)}` : ''}
              {!area.managed ? ' · your folder, not cleaned automatically' : ''}
              {developer ? <code className="storage-path">{area.path}</code> : null}
            </>
          }
        >
          {area.clearable ? (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={busy !== null || area.bytes === 0}
              onClick={() =>
                void run(area.id, () => window.cloudstream!.clearStorageArea(area.id), `${area.label} cleared.`)
              }
            >
              {busy === area.id ? <RotateCw size={14} className="spin" /> : <Trash2 size={14} />} Clear
            </button>
          ) : (
            <span className="muted" title="Expires on its own; it refills as you use the app.">Automatic</span>
          )}
        </SettingRow>
      ))}

      {report.legacy.length > 0 && (
        <SettingRow
          label="Left over from an earlier version"
          hint="Earlier versions kept the torrent streaming cache in the system's temporary folder. These are those folders; nothing in them is needed any more."
          note={
            <>
              {formatBytes(legacyTotal, 'Empty')}
              {developer
                ? report.legacy.map((entry) => (
                    <code key={entry.path} className="storage-path">
                      {entry.path}
                    </code>
                  ))
                : null}
            </>
          }
          keywords="temp old cleanup disk space"
        >
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={busy !== null}
            onClick={() =>
              void run('legacy', () => window.cloudstream!.removeLegacyTemp(), 'Old temporary folders removed.')
            }
          >
            <HardDrive size={14} /> Remove
          </button>
        </SettingRow>
      )}

      {message && (
        <p className="storage-message" role="status">
          {message}
        </p>
      )}
    </>
  );
};
