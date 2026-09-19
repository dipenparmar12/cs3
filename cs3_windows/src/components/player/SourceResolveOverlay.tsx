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
  isDeveloper: boolean
): string {
  if (phase === 'starting') {
    return isDeveloper ? 'Connecting to the swarm…' : 'Starting playback…';
  }
  if (sourceCount > 0) {
    return isDeveloper
      ? `${sourceCount} source${sourceCount === 1 ? '' : 's'} found`
      : `Found ${sourceCount} source${sourceCount === 1 ? '' : 's'} — picking the best…`;
  }
  return isDeveloper ? 'Searching for sources…' : 'Finding the best source…';
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
  onBack,
}) => {
  const isDeveloper = useIsDeveloper();

  if (phase === 'error') {
    const plain = plainMessage(error);
    return (
      <div className="player__overlay">
        <AlertTriangle size={36} />
        {/* The original is never discarded — developer mode shows it, and
            `CopyErrorButton` still reports it verbatim. What changes is which
            of the two a viewer is handed first. */}
        <p>{error ? (isDeveloper ? plain.detail : plain.summary) : 'Could not start playback.'}</p>

        {/*
          The failover list is the most useful thing on this screen for whoever
          is diagnosing a provider, and the least useful for whoever wanted to
          watch something: four rows of release name, scraper name and HTTP
          status, describing sources they never chose. The actions below are
          what they need, and those are unchanged.
        */}
        {attempts.length > 0 && isDeveloper && (
          <ul className="player__attempts">
            {attempts.slice(0, 4).map((attempt, i) => (
              <li key={`${attempt.title}-${i}`}>
                <strong>{attempt.title}</strong> ({attempt.indexerName}) — {attempt.error}
              </li>
            ))}
          </ul>
        )}
        {attempts.length > 0 && !isDeveloper && (
          <span className="muted">
            {attempts.length} source{attempts.length === 1 ? '' : 's'} tried so far.
          </span>
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

      <p>{stageLabel(phase, sources.length, isDeveloper)}</p>

      <span className="muted">
        {episodeTitle ? `${title} — ${episodeTitle}` : title}
      </span>

      {/*
        Said in both modes, because it is the reason the wait just tripled and
        an unexplained change of length is the shape of a hang. Only the word
        "indexer" goes.
      */}
      {widened && phase === 'searching' && (
        <span className="muted">
          <Globe size={13} />{' '}
          {isDeveloper
            ? 'No sources from where this title was found — asking every provider and indexer.'
            : 'Nothing where this title was found — looking everywhere else.'}
        </span>
      )}

      {phase === 'searching' && totalIndexers > 0 && (
        <span className="muted">
          {isDeveloper ? (
            <>
              Searched {searched} of {totalIndexers} indexers
              {lastIndexerName && !searchDone ? ` · last: ${lastIndexerName}` : ''}
            </>
          ) : (
            // The count stays: a climbing number is what tells the viewer the
            // app is working rather than stuck, which is this overlay's whole
            // reason for existing. Which scraper answered last is not.
            <>Checked {searched} of {totalIndexers} places</>
          )}
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
