import React from 'react';
import { Loader2, Play, AlertTriangle, RefreshCw, ListVideo, Globe } from 'lucide-react';
import type { TorrentResult } from '../../types/torrent';
import { useIsDeveloper } from '../../utils/ExperienceModeContext';
import { plainMessage } from '../../utils/experienceMode';

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
  /**
   * The scoped search came up empty and the app widened by itself.
   *
   * Said out loud rather than left to be inferred from the counter jumping. The
   * wait triples at that moment, and a wait that changes length for no stated
   * reason is the shape of a hang — which is what this used to look like before
   * it was a wait at all, when it was a dead end with a button under it.
   */
  widened?: boolean;
  /**
   * The sources where this title was found have all failed, and the app is
   * looking everywhere else by itself. Standard mode's automatic failover.
   */
  retryingElsewhere?: boolean;
  /** Sources ruled out so far, for "trying link 3 of 12". */
  tried?: number;
  /** Starts the whole attempt again. Standard mode's "Try again". */
  onRestart?: () => void;
  onBack: () => void;
}

/**
 * What the wait is called.
 *
 * The stages this app goes through are real and each one is a different thing
 * to be waiting on — a scope being resolved, fifteen scrapers answering, a
 * swarm producing leading bytes. Naming them is the right thing to do for
 * whoever is debugging a source and the wrong thing to put in front of someone
 * who pressed play: "Connecting to the swarm" asks them to know what a swarm
 * is in order to understand that the film is starting.
 *
 * So each stage has both spellings, and neither is a lie — the standard one is
 * the same fact at a coarser grain.
 */
function stageLabel(
  phase: 'searching' | 'starting',
  sourceCount: number,
  isDeveloper: boolean,
  tried = 0
): string {
  if (phase === 'starting') {
    if (isDeveloper) return 'Connecting to the swarm…';
    // The link being tried, as the Android player counts them. Once one has
    // failed this is what says the app is moving on rather than stuck.
    return tried > 0 && sourceCount > 0
      ? `Trying link ${Math.min(tried + 1, sourceCount)} of ${sourceCount}…`
      : 'Starting…';
  }
  if (sourceCount > 0) {
    return isDeveloper
      ? `${sourceCount} source${sourceCount === 1 ? '' : 's'} found`
      : `${sourceCount} link${sourceCount === 1 ? '' : 's'} found`;
  }
  return isDeveloper ? 'Searching for sources…' : 'Finding links…';
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
  widened,
  retryingElsewhere,
  tried = 0,
  onRestart,
  onBack,
}) => {
  const isDeveloper = useIsDeveloper();

  /*
   * Standard mode: what a streaming service shows. The title, how many links
   * there are and which one is being tried, a way to skip the rest of the
   * search, and — only when everything has been tried, here and everywhere
   * else — one plain sentence and what to do next. Everything else on this
   * overlay is a developer's.
   */
  if (!isDeveloper) {
    const heading = episodeTitle ? `${title} — ${episodeTitle}` : title;
    if (phase === 'error') {
      return (
        <div className="player__overlay player__overlay--simple">
          <AlertTriangle size={32} />
          <p>This title would not play right now.</p>
          <span className="muted">
            {sources.length > 0
              ? `None of the ${sources.length} link${sources.length === 1 ? '' : 's'} found would start. They often come back — try again in a little while, or pick one yourself.`
              : 'No links were found for it. Try again in a little while.'}
          </span>
          <div className="player__overlay-actions">
            <button className="btn btn-primary" onClick={onRestart ?? onRetry}>
              <RefreshCw size={16} /> Try again
            </button>
            {sources.length > 0 && (
              <button className="btn" onClick={onOpenSources}>
                <ListVideo size={16} /> Choose a link
              </button>
            )}
            <button className="btn" onClick={onBack}>Back</button>
          </div>
        </div>
      );
    }

    return (
      <div className="player__overlay player__overlay--simple">
        <Loader2 className="spin" size={36} />
        <p>{stageLabel(phase, sources.length, false, tried)}</p>
        <span className="muted">{heading}</span>
        {retryingElsewhere ? (
          <span className="muted">
            <Globe size={13} /> Those links did not play — looking in more places…
          </span>
        ) : widened && phase === 'searching' ? (
          <span className="muted">
            <Globe size={13} /> Nothing where this title was found — looking everywhere else.
          </span>
        ) : null}
        {phase === 'searching' && totalIndexers > 0 && !searchDone && (
          // The climbing count is what says the app is working rather than stuck.
          <span className="muted">Checked {searched} of {totalIndexers} places</span>
        )}
        <div className="player__overlay-actions">
          {phase === 'searching' && sources.length > 0 && (
            // Android's "skip loading": stop waiting for the slowest sites and
            // start with the best of what has arrived.
            <button className="btn btn-primary" onClick={onPlayNow}>
              <Play size={16} /> Skip and play
            </button>
          )}
          <button className="btn" onClick={onBack}>Cancel</button>
        </div>
      </div>
    );
  }

  // Developer mode from here on: the stages by name, the failover list, and
  // every action, because the stop is the information.
  if (phase === 'error') {
    return (
      <div className="player__overlay">
        <AlertTriangle size={36} />
        {/* The original, verbatim — `plainMessage` keeps it as `detail`. */}
        <p>{error ? plainMessage(error).detail : 'Could not start playback.'}</p>

        {/*
          The failover list is the most useful thing on this screen for whoever
          is diagnosing a provider: release name, scraper name and HTTP status
          for each source that was tried.
        */}
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

      <p>{stageLabel(phase, sources.length, true)}</p>

      <span className="muted">
        {episodeTitle ? `${title} — ${episodeTitle}` : title}
      </span>

      {/*
        The reason the wait just tripled: an unexplained change of length is the
        shape of a hang.
      */}
      {widened && phase === 'searching' && (
        <span className="muted">
          <Globe size={13} /> No sources from where this title was found — asking every
          provider and indexer.
        </span>
      )}

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
