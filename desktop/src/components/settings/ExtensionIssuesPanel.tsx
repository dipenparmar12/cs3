import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useFlash } from '../../utils/useFlash';
import { BellOff, ClipboardCopy, RefreshCw, Trash2 } from 'lucide-react';
import type { ExtensionIssue, IssueSummary } from '../../../electron/cs3/extensionIssues';
import { FacetMenu, type FacetOption } from '../FacetMenu';

/**
 * What is actually broken, counted — the "count before fixing" view.
 *
 * `DiagnosticsPanel` sits beside this and answers a different question. It is a
 * *transcript* of recent failures, shaped to be pasted to a provider
 * maintainer, capped and time-windowed. This is a *tally* of distinct problems
 * that survives restarts and log rotation.
 *
 * The distinction is the entire reason this exists, and it is measured rather
 * than asserted. A real 21-session log held 6,069 records, 5,407 of them from
 * the extension runtime — and they collapse to about **200 distinct problems**.
 * Reading the first number tells you nothing you can act on; the second is a
 * work list. Producing it previously meant a bespoke script over rotated files,
 * which is why nobody ever did it twice.
 *
 * So the tally is on top and the rows are underneath, in that order and never
 * the other way round. A list of 113 failures sends someone fixing symptoms one
 * at a time; the same list with a count above it showed six missing classes
 * covering all of it.
 */
export const ExtensionIssuesPanel: React.FC = () => {
  const [issues, setIssues] = useState<ExtensionIssue[]>([]);
  const [summary, setSummary] = useState<IssueSummary[]>([]);
  const [causeFilter, setCauseFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [showMuted, setShowMuted] = useState(false);
  const [loading, setLoading] = useState(false);
  const { message: copied, flash: setCopied } = useFlash<boolean>(2000);

  const refresh = useCallback(async () => {
    setLoading(true);
    const response = await window.cloudstream?.listIssues?.({
      limit: 400,
      includeMuted: showMuted,
    });
    setIssues(response?.issues ?? []);
    setSummary(response?.summary ?? []);
    setLoading(false);
  }, [showMuted]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const causes = useMemo<FacetOption[]>(
    () =>
      summary.map((entry) => ({
        value: entry.cause,
        label: entry.label,
        count: entry.occurrences,
      })),
    [summary]
  );

  const sources = useMemo<FacetOption[]>(() => {
    const counts = new Map<string, number>();
    for (const issue of issues) {
      const name = issue.source ?? 'unattributed';
      counts.set(name, (counts.get(name) ?? 0) + issue.occurrences);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([value, count]) => ({ value, label: value, count }));
  }, [issues]);

  const shown = useMemo(
    () =>
      issues.filter(
        (issue) =>
          (causeFilter === 'all' || issue.cause === causeFilter) &&
          (sourceFilter === 'all' || (issue.source ?? 'unattributed') === sourceFilter)
      ),
    [issues, causeFilter, sourceFilter]
  );

  const totals = useMemo(
    () => ({
      distinct: issues.length,
      occurrences: issues.reduce((n, issue) => n + issue.occurrences, 0),
    }),
    [issues]
  );

  const copyReport = useCallback(async () => {
    const response = await window.cloudstream?.reportIssues?.();
    if (!response?.report) return;
    await navigator.clipboard.writeText(response.report);
    setCopied(true);
  }, [setCopied]);

  const mute = useCallback(
    async (issue: ExtensionIssue) => {
      await window.cloudstream?.annotateIssue?.(issue.id, { muted: !issue.muted });
      void refresh();
    },
    [refresh]
  );

  return (
    <section className="diag">
      <h3>Extension issues</h3>
      <p className="diag__intro">
        Every warning and error the extension runtime has produced, grouped by cause and by which
        extension printed it, and kept across restarts. The log beside this records what happened;
        this records <em>how many distinct things are wrong</em>, which is the number worth acting
        on.
      </p>

      {summary.length > 0 && (
        <ul className="diag__tally">
          {summary.map((entry) => (
            <li key={entry.cause} className="diag__tally-row" title={entry.hint}>
              <span className="diag__tally-count">{entry.occurrences}</span>
              <span className="diag__tally-label">{entry.label}</span>
              <span className="diag__tally-distinct">{entry.issues} distinct</span>
            </li>
          ))}
        </ul>
      )}

      <div className="diag__actions">
        <button className="btn btn-secondary" onClick={copyReport} disabled={issues.length === 0}>
          <ClipboardCopy size={14} />
          <span>{copied ? 'Copied' : 'Copy report'}</span>
        </button>
        <button className="btn btn-secondary" onClick={refresh} disabled={loading}>
          <RefreshCw size={14} />
          <span>Refresh</span>
        </button>
        {causes.length > 1 && (
          <FacetMenu
            label="Cause"
            value={causeFilter}
            options={causes}
            onChange={setCauseFilter}
            allLabel={`All causes (${totals.occurrences})`}
          />
        )}
        {sources.length > 1 && (
          <FacetMenu
            label="Source"
            value={sourceFilter}
            options={sources}
            onChange={setSourceFilter}
            allLabel={`All sources (${sources.length})`}
          />
        )}
        <label className="diag__toggle">
          <input
            type="checkbox"
            checked={showMuted}
            onChange={(event) => setShowMuted(event.target.checked)}
          />
          <span>Include muted</span>
        </label>
        <button
          className="btn btn-secondary"
          onClick={async () => {
            await window.cloudstream?.clearIssues?.();
            void refresh();
          }}
          disabled={issues.length === 0}
        >
          <Trash2 size={14} />
          <span>Clear</span>
        </button>
      </div>

      {shown.length === 0 ? (
        <p className="diag__empty">
          {issues.length === 0
            ? 'No extension has reported a problem yet.'
            : 'Nothing matches those filters.'}
        </p>
      ) : (
        <ul className="diag__list">
          {shown.map((issue) => (
            <li
              key={issue.id}
              className={`diag__row diag__row--${issue.level}${issue.muted ? ' diag__row--muted' : ''}`}
            >
              <div className="diag__head">
                <span className="diag__stage">{issue.cause}</span>
                <span className="diag__source">{issue.source ?? 'unattributed'}</span>
                {/*
                  Both numbers, because they mean different things. Forty
                  occurrences in one session is a retry loop; forty across forty
                  sessions is a site that has been down for a month.
                */}
                <span className="diag__count">
                  {issue.occurrences}× over {issue.sessions} session
                  {issue.sessions === 1 ? '' : 's'}
                </span>
                <span className="diag__time">{new Date(issue.lastSeen).toLocaleString()}</span>
                <button
                  className="diag__mute"
                  title={
                    issue.muted
                      ? 'Show this again'
                      : 'Hide this — it keeps counting, so a return shows up'
                  }
                  onClick={() => void mute(issue)}
                >
                  <BellOff size={12} />
                </button>
              </div>
              <div className="diag__message">{issue.message}</div>
              {(issue.missingClass || issue.plugins.length > 0) && (
                <div className="diag__context">
                  {issue.missingClass && <span>missing class: {issue.missingClass}</span>}
                  {issue.plugins.length > 0 && <span>extensions: {issue.plugins.join(', ')}</span>}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
