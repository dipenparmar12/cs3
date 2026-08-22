import React from 'react';
import { Loader2, Play, AlertTriangle, RefreshCw, ListVideo, Globe } from 'lucide-react';
import type { TorrentResult } from '../../types/torrent';

/**
 * What the viewer sees between pressing play and the picture appearing.
 *
 * The wait is unavoidable — sources have to be found and a swarm has to produce
 * leading bytes — but it does not have to be opaque or last as long as the
 * slowest indexer. Showing the count climbing tells the viewer the app is
 * working, and "Play now" hands them the decision about when enough is enough.
 * That is the behaviour Android has, and the reason watching something there
 * feels immediate while waiting on a spinner does not.
 */

interface SourceResolveOverlayProps {
  phase: 'searching' | 'starting' | 'error';
  sources: TorrentResult[];
  searched: number;
  totalIndexers: number;
  lastIndexerName?: string;
  searchDone: boolean;
  error?: string;
  title: string;
  episodeTitle?: string;
  /** Attempted sources that failed, so a failover is visible rather than silent. */
  attempts: Array<{ title: string; indexerName: string; error: string }>;
  onPlayNow: () => void;
  onOpenSources: () => void;
  onRetry: () => void;
  /**
   * Ask every other provider and the torrent indexers.
   *
   * This is the most valuable place to offer it: the scoped search has just
   * come up short, and the sentence above says the providers this title came
   * from had nothing. Making the reader go and find a menu item at that moment
   * is what turns a one-click recovery into a dead end.
   */
  onWiden?: () => void;
  canWiden?: boolean;
  onBack: () => void;
}

export const SourceResolveOverlay: React.FC<SourceResolveOverlayProps> = ({
  phase,
  sources,
  searched,
  totalIndexers,
  lastIndexerName,
  searchDone,
  error,
  title,
  episodeTitle,
  attempts,
  onPlayNow,
  onOpenSources,
  onRetry,
  onWiden,
  canWiden,
  onBack,
}) => {
  if (phase === 'error') {
    return (
      <div className="player__overlay">
        <AlertTriangle size={36} />
        <p>{error ?? 'Could not start playback.'}</p>

        {attempts.length > 0 && (
          <ul className="player__attempts">
            {attempts.slice(0, 4).map((attempt, i) => (
              <li key={`${attempt.title}-${i}`}>
                <strong>{attempt.title}</strong> ({attempt.indexerName}) — {attempt.error}
              </li>
            ))}
          </ul>
        )}

        <div className="player__overlay-actions">
          {sources.length > 0 && (
            <button className="btn btn-primary" onClick={onOpenSources}>
              <ListVideo size={16} /> Choose a source ({sources.length})
            </button>
          )}
          {onWiden && canWiden ? (
            <button className="btn btn-primary" onClick={onWiden}>
              <Globe size={16} /> Search all sources
            </button>
          ) : null}
          <button className="btn" onClick={onRetry}>
            <RefreshCw size={16} /> Search again
          </button>
          <button className="btn" onClick={onBack}>Back</button>
        </div>
      </div>
    );
  }

  const best = sources[0];

  return (
    <div className="player__overlay">
      <Loader2 className="spin" size={36} />

      <p>
        {phase === 'starting'
          ? 'Connecting to the swarm…'
          : sources.length > 0
            ? `${sources.length} source${sources.length === 1 ? '' : 's'} found`
            : 'Searching for sources…'}
      </p>

      <span className="muted">
        {episodeTitle ? `${title} — ${episodeTitle}` : title}
      </span>

      {phase === 'searching' && totalIndexers > 0 && (
        <span className="muted">
          Searched {searched} of {totalIndexers} indexers
          {lastIndexerName && !searchDone ? ` · last: ${lastIndexerName}` : ''}
        </span>
      )}

      {/* Naming the release that would start removes the gamble from pressing
          the button — the viewer can see it is a 1080p WEB-DL, not a CAM. */}
      {phase === 'searching' && best && (
        <span className="muted player__resolve-best">
          Best so far: {best.title}
        </span>
      )}

      <div className="player__overlay-actions">
        {phase === 'searching' && sources.length > 0 && (
          <>
            <button className="btn btn-primary" onClick={onPlayNow}>
              <Play size={16} /> Play now
            </button>
            <button className="btn" onClick={onOpenSources}>
              <ListVideo size={16} /> Choose source
            </button>
          </>
        )}
        <button className="btn" onClick={onBack}>Cancel</button>
      </div>
    </div>
  );
};
