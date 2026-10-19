import React from 'react';
import { ShieldAlert } from 'lucide-react';
import { Button } from '../ui';

interface PlaybackPrivacyOverlayProps {
  state: 'protected' | 'blocked';
  /** The viewer's Play: reveals this video only. */
  onPlay: () => void;
  onBack: () => void;
  /** The mini player has room for a headline and one button, not a paragraph. */
  compact?: boolean;
}

/**
 * Says why the picture is gone, and what brings it back. A status region, not a
 * dialog: it must never take focus or block the controls, only explain the pause.
 */
export const PlaybackPrivacyOverlay: React.FC<PlaybackPrivacyOverlayProps> = ({
  state,
  onPlay,
  onBack,
  compact = false,
}) => {
  const blocked = state === 'blocked';
  return (
    <div className="player-privacy" role="status" aria-live="polite">
      <ShieldAlert size={compact ? 16 : 22} aria-hidden />
      <strong>{blocked ? 'Adult content is turned off' : 'Playback is protected'}</strong>
      {!compact && (
        <span>
          {blocked
            ? 'Turn it on in Extensions to play this.'
            : 'Paused and hidden. Press Play to watch this video, or use Unblur in the top bar.'}
        </span>
      )}
      {blocked ? (
        <Button size="compact" onClick={onBack}>
          Back
        </Button>
      ) : (
        <Button size="compact" variant="prominent" onClick={onPlay}>
          Play
        </Button>
      )}
    </div>
  );
};
