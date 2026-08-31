import React, { useEffect, useMemo, useState } from 'react';
import { Download, X, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { Episode } from '../types/api';
import type { BatchProgress } from '../../electron/cs3/batchDownloader';

/**
 * One decision, then a whole season downloads.
 *
 * Downloading a 100-episode series episode-by-episode means 100 source searches
 * and 100 picks. Here the user chooses a scope and a quality once; resolution
 * and queueing happen in the main process, so navigating away does not abandon
 * the run.
 */

interface SeasonDownloadDialogProps {
  open: boolean;
  title: string;
  parentUrl: string;
  posterUrl?: string;
  providerName?: string;
  mediaType?: string;
  year?: number;
  episodes: Episode[];
  /** Season currently shown in the detail view; the default scope. */
  activeSeason: number;
  onClose: () => void;
}

const QUALITIES = [
  { value: 2160, label: '4K (2160p)' },
  { value: 1080, label: 'Full HD (1080p)' },
  { value: 720, label: 'HD (720p)' },
  { value: 480, label: 'SD (480p)' },
  { value: 0, label: 'Best available' },
];

export const SeasonDownloadDialog: React.FC<SeasonDownloadDialogProps> = ({
  open,
  title,
  parentUrl,
  posterUrl,
  providerName,
  mediaType,
  year,
  episodes,
  activeSeason,
  onClose,
}) => {
  const [scope, setScope] = useState<'season' | 'all'>('season');
  const [quality, setQuality] = useState(1080);
  const [skipExisting, setSkipExisting] = useState(true);
  const [progress, setProgress] = useState<BatchProgress | null>(null);
  const [running, setRunning] = useState(false);

  const seasonNumbers = useMemo(
    () => [...new Set(episodes.map((e) => e.season ?? 1))].sort((a, b) => a - b),
    [episodes]
  );

  const selected = useMemo(
    () => (scope === 'all' ? episodes : episodes.filter((e) => (e.season ?? 1) === activeSeason)),
    [scope, episodes, activeSeason]
  );

  useEffect(() => {
    if (!window.cloudstream || !open) return;
    return window.cloudstream.onBatchProgress(setProgress);
  }, [open]);

  // Escape closes — unless a run is in flight, where a stray keypress would
  // hide the only progress report for something that keeps going regardless.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !running) onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, running, onClose]);

  if (!open) return null;

  const start = async () => {
    if (!window.cloudstream || selected.length === 0) return;
    setRunning(true);
    setProgress(null);

    await window.cloudstream.startBatchDownload({
      parentUrl,
      title,
      posterUrl,
      providerName,
      mediaType,
      year,
      episodes: selected.map((e) => ({
        url: e.url,
        name: e.name,
        season: e.season,
        episode: e.episode,
      })),
      maxResolution: quality || undefined,
      skipExisting,
    });
    setRunning(false);
  };

  const cancel = async () => {
    if (progress?.batchId && window.cloudstream) {
      await window.cloudstream.cancelBatchDownload(progress.batchId);
    }
  };

  const percent = progress?.total ? (progress.resolved / progress.total) * 100 : 0;

  return (
    /*
      Escape and a backdrop click both close this. They did not, and the only
      exit was the × — while `DeleteDownloadDialog` and `SourcePicker` had both
      done it correctly the whole time, so this was the odd one out rather than
      a considered choice. `role="dialog"` also sat on the *backdrop*, which
      makes the accessible dialog region the whole screen.
    */
    <div className="modal-backdrop" onClick={() => !running && onClose()} role="presentation">
      <div
        className="modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="season-download-title"
      >
        <header className="modal__head">
          <h3 id="season-download-title">
            <Download size={17} /> Download {scope === 'all' ? 'entire series' : `season ${activeSeason}`}
          </h3>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        {!progress?.finished && (
          <>
            <div className="modal__field">
              <span className="modal__label">What to download</span>
              <div className="modal__choices">
                <button
                  className={`btn ${scope === 'season' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setScope('season')}
                  disabled={running}
                >
                  Season {activeSeason}
                  <em>
                    {episodes.filter((e) => (e.season ?? 1) === activeSeason).length} episodes
                  </em>
                </button>
                <button
                  className={`btn ${scope === 'all' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setScope('all')}
                  disabled={running || seasonNumbers.length < 2}
                  title={
                    seasonNumbers.length < 2
                      ? 'This title has only one season'
                      : `${seasonNumbers.length} seasons`
                  }
                >
                  All seasons
                  <em>{episodes.length} episodes</em>
                </button>
              </div>
            </div>

            <div className="modal__field">
              <span className="modal__label">Quality</span>
              <div className="modal__choices modal__choices--wrap">
                {QUALITIES.map((q) => (
                  <button
                    key={q.value}
                    className={`btn ${quality === q.value ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setQuality(q.value)}
                    disabled={running}
                  >
                    {q.label}
                  </button>
                ))}
              </div>
              <p className="modal__hint">
                The best ranked source at or below this resolution is taken. Episodes with nothing
                at this quality fall back to their best available source rather than being skipped.
              </p>
            </div>

            <label className="modal__check">
              <input
                type="checkbox"
                checked={skipExisting}
                onChange={(e) => setSkipExisting(e.target.checked)}
                disabled={running}
              />
              Skip episodes already in the download queue
            </label>
          </>
        )}

        {progress && (
          <div className="modal__progress">
            <div className="modal__progress-bar">
              <div style={{ width: `${percent}%` }} />
            </div>
            <div className="modal__progress-text">
              {progress.finished ? (
                <>
                  <CheckCircle2 size={15} style={{ color: 'var(--status-success)' }} />
                  {progress.cancelled ? 'Cancelled. ' : 'Finished. '}
                  Queued {progress.queued}
                  {progress.skipped > 0 && `, skipped ${progress.skipped}`}
                  {progress.failed > 0 && `, failed ${progress.failed}`}.
                </>
              ) : (
                <>
                  <Loader2 className="spin" size={15} />
                  Resolving {progress.resolved} of {progress.total}
                  {progress.currentEpisode && ` — ${progress.currentEpisode}`}
                </>
              )}
            </div>

            {progress.failures.length > 0 && (
              <details className="modal__failures">
                <summary>
                  <AlertTriangle size={14} /> {progress.failures.length} episode
                  {progress.failures.length === 1 ? '' : 's'} without a source
                </summary>
                <ul>
                  {progress.failures.map((f, i) => (
                    <li key={i}>
                      <strong>{f.episode}</strong> — {f.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}

        <footer className="modal__foot">
          {progress && !progress.finished ? (
            <button className="btn btn-secondary" onClick={cancel}>
              Cancel remaining
            </button>
          ) : (
            <button className="btn btn-secondary" onClick={onClose}>
              {progress?.finished ? 'Done' : 'Cancel'}
            </button>
          )}
          {!progress?.finished && (
            <button
              className="btn btn-primary"
              onClick={start}
              disabled={running || selected.length === 0}
            >
              {running ? (
                <>
                  <Loader2 className="spin" size={15} /> Queueing…
                </>
              ) : (
                <>
                  <Download size={15} /> Download {selected.length} episode
                  {selected.length === 1 ? '' : 's'}
                </>
              )}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
};
