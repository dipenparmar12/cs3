import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ClipboardCopy, FolderOpen, RefreshCw, Trash2 } from 'lucide-react';
import type { DiagnosticRecord } from '../../../electron/cs3/diagnostics';
import { FacetMenu, type FacetOption } from '../FacetMenu';

/**
 * The failure log, readable.
 *
 * Extensions fail constantly and mostly not because of anything this app did —
 * a site changed shape, a host started returning 403, a mirror died. Until now
 * those failures existed only as a sentence on screen at the moment they
 * happened; by the time anyone wanted to investigate, the query was gone and
 * the provider was one of thirty.
 *
 * What this exists to produce is one pasteable block of text containing the
 * tuple that makes a report reproducible. Reading the list here is secondary to
 * being able to hand it to someone.
 */
export const DiagnosticsPanel: React.FC = () => {
  const [records, setRecords] = useState<DiagnosticRecord[]>([]);
  const [filePath, setFilePath] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const response = await window.cloudstream?.getDiagnostics?.(200);
    setRecords(response?.records ?? []);
    setFilePath(response?.filePath ?? '');
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const sources = useMemo<FacetOption[]>(() => {
    const counts = new Map<string, number>();
    for (const record of records) {
      const name = record.source ?? 'app';
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([value, count]) => ({ value, label: value, count }));
  }, [records]);

  const shown = useMemo(
    () =>
      sourceFilter === 'all'
        ? records
        : records.filter((record) => (record.source ?? 'app') === sourceFilter),
    [records, sourceFilter]
  );

  const copyAll = async () => {
    const response = await window.cloudstream?.reportDiagnostics?.(
      // Copy what is on screen: a filtered view is a deliberate narrowing, and
      // silently reporting everything would undo it.
      sourceFilter === 'all' ? undefined : shown.map((record) => record.id)
    );
    if (!response?.text) return;
    await navigator.clipboard.writeText(response.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <section className="setting-group">
      <h3>
        <AlertTriangle size={15} />
        Provider errors
      </h3>

      <p className="diag__intro">
        Every provider failure, with the query and item that produced it. Copy this
        into a bug report — it carries the app and extension-runtime versions too.
      </p>

      <div className="diag__actions">
        <button className="btn btn-secondary" onClick={copyAll} disabled={shown.length === 0}>
          <ClipboardCopy size={14} />
          <span>{copied ? 'Copied' : `Copy ${shown.length} record(s)`}</span>
        </button>
        <button className="btn btn-secondary" onClick={refresh} disabled={loading}>
          <RefreshCw size={14} />
          <span>Refresh</span>
        </button>
        {sources.length > 1 && (
          <FacetMenu
            label="Source"
            value={sourceFilter}
            options={sources}
            onChange={setSourceFilter}
            allLabel={`All sources (${records.length})`}
          />
        )}
        <button
          className="btn btn-secondary"
          onClick={async () => {
            await window.cloudstream?.clearDiagnostics?.();
            void refresh();
          }}
          disabled={records.length === 0}
        >
          <Trash2 size={14} />
          <span>Clear</span>
        </button>
      </div>

      {filePath && (
        <p className="diag__path" title={filePath}>
          <FolderOpen size={12} /> {filePath}
        </p>
      )}

      {shown.length === 0 ? (
        <p className="diag__empty">Nothing has failed yet.</p>
      ) : (
        <ul className="diag__list">
          {shown.map((record) => (
            <li key={record.id} className={`diag__row diag__row--${record.level}`}>
              <div className="diag__head">
                <span className="diag__stage">{record.stage}</span>
                {record.source && <span className="diag__source">{record.source}</span>}
                <span className="diag__time">{new Date(record.at).toLocaleString()}</span>
              </div>
              <div className="diag__message">{record.message}</div>
              {(record.query || record.title) && (
                <div className="diag__context">
                  {record.query && <span>query: {record.query}</span>}
                  {record.title && <span>item: {record.title}</span>}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
