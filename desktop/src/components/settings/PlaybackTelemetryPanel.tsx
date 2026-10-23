import React, { useCallback, useEffect, useState } from 'react';
import { Gauge, RefreshCw } from 'lucide-react';
import { Button } from '../ui';
import type { PlaybackTelemetryRecord, TelemetrySummary } from '../../../electron/media/playbackTelemetry';

/**
 * PRD-40.1 playback sessions of this launch, newest first (Developer, Everything).
 *
 * The question it answers is "how long did the last few films take to start,
 * and did they stall", which the log can answer only with a search. Figures the
 * app does not measure yet (lease refreshes, mpv's runtime) are not shown.
 */

const RECENT = 10;

function ms(value: number): string {
  if (!value) return '—';
  return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${Math.round(value)}ms`;
}

export const PlaybackTelemetryPanel: React.FC = () => {
  const [records, setRecords] = useState<PlaybackTelemetryRecord[]>([]);
  const [summary, setSummary] = useState<TelemetrySummary | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const answer = await window.cloudstream?.getPlaybackDiagnostics?.();
      setRecords(answer?.telemetry ?? []);
      setSummary(answer?.summary ?? null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const recent = records.slice(-RECENT).reverse();

  return (
    <section className="settings-group">
      <header className="settings-group__header">
        <Gauge size={15} aria-hidden />
        <h3>Playback sessions</h3>
        <div className="settings-group__actions">
          <Button variant="ambient" icon={RefreshCw} loading={loading} onClick={() => void refresh()}>
            Refresh
          </Button>
        </div>
      </header>

      {!summary || summary.sampleCount === 0 ? (
        <p className="settings-note">Nothing has played since the app started.</p>
      ) : (
        <>
          <dl className="startup-profile__marks">
            <div>
              <dt>Sessions</dt>
              <dd>{summary.sampleCount}</dd>
            </div>
            <div>
              <dt>First frame (median)</dt>
              <dd>{ms(summary.performance.timeToFirstFrameP50)}</dd>
            </div>
            <div>
              <dt>Prepare overhead (median)</dt>
              <dd>{ms(summary.performance.orchestrationP50)}</dd>
            </div>
            <div className={summary.reliability.fatalErrorRate > 0 ? 'startup-profile__mark--bad' : undefined}>
              <dt>Failed to start</dt>
              <dd>{Math.round(summary.reliability.fatalErrorRate * 100)}%</dd>
            </div>
          </dl>

          <h4 className="startup-profile__heading">Most recent</h4>
          <ul className="startup-profile__list">
            {recent.map((record) => (
              <li
                key={`${record.sessionId}-${record.timestamp}`}
                className={record.terminalState === 'fatal-error' ? 'startup-profile__row--bad' : undefined}
              >
                <strong>{ms(record.timeToFirstFrameMs)}</strong>
                <span>
                  {record.selectedStrategy} · {record.container}
                  {record.stallCount > 0 && ` · ${record.stallCount} stalls (${ms(record.stallTotalMs)})`}
                </span>
                <em>{record.fatalError ?? record.terminalState}</em>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
};
