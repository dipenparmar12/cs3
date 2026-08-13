import React from 'react';
import { Play, X, Loader2 } from 'lucide-react';
import type { Episode } from '../../types/api';

/**
 * The end-of-episode hand-off.
 *
 * A viewer who is thirty seconds from the end of an episode has exactly one
 * likely intention, and making them find it — back out of the player, scroll a
 * list, pick a source — is the friction that made binge-watching on desktop
 * worse than on the phone. The card appears over the last stretch of the
 * episode, counts down, and rolls on unless the viewer says otherwise.
 *
 * Dismissing is as important as advancing: someone watching the credits for the
 * mid-credits scene should be able to make the card go away and stay away.
 */

interface UpNextCardProps {
  episode: Episode;
  /** Whole seconds until the next episode starts on its own. */
  secondsRemaining: number;
  /** Total countdown length, for the progress ring. */
  countdownFrom: number;
  /** True while a source is being resolved for the chosen episode. */
  isLoading: boolean;
  onPlayNow: () => void;
  onDismiss: () => void;
}

export const UpNextCard: React.FC<UpNextCardProps> = ({
  episode,
  secondsRemaining,
  countdownFrom,
  isLoading,
  onPlayNow,
  onDismiss,
}) => {
  const elapsedFraction =
    countdownFrom > 0
      ? Math.min(1, Math.max(0, (countdownFrom - secondsRemaining) / countdownFrom))
      : 0;

  return (
    <aside className="up-next" aria-live="polite">
      {episode.posterUrl && (
        <img className="up-next__thumb" src={episode.posterUrl} alt="" loading="lazy" />
      )}

      <div className="up-next__body">
        <span className="up-next__label">
          {isLoading
            ? 'Finding a source…'
            : `Up next in ${Math.max(0, secondsRemaining)}s`}
        </span>
        <strong className="up-next__title">
          {episode.season != null && episode.episode != null && (
            <span className="up-next__number">
              S{episode.season} E{episode.episode}
            </span>
          )}
          {episode.name || `Episode ${episode.episode ?? ''}`}
        </strong>
        {episode.description && <p className="up-next__desc">{episode.description}</p>}

        <div className="up-next__actions">
          <button className="btn btn-primary btn-sm" onClick={onPlayNow} disabled={isLoading}>
            {isLoading ? <Loader2 className="spin" size={14} /> : <Play size={14} />}
            {isLoading ? 'Loading' : 'Play now'}
          </button>
          <button className="btn btn-sm" onClick={onDismiss}>
            <X size={14} /> Dismiss
          </button>
        </div>
      </div>

      {/* The bar doubles as the countdown, so the card needs no separate timer. */}
      <div className="up-next__countdown" aria-hidden="true">
        <div style={{ width: `${elapsedFraction * 100}%` }} />
      </div>
    </aside>
  );
};
