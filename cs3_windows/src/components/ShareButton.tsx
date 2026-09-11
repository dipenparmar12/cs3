import React, { useCallback } from 'react';
import { Check, Share2 } from 'lucide-react';
import { useFlash } from '../utils/useFlash';
import { describeShare, encodeShareLink, type SharePayload } from '../utils/shareLink';

/**
 * Copies a link to this media, from wherever the viewer happens to be.
 *
 * One component for every surface — search rows, the detail page, the player,
 * the library, history — because the link is the product here, and a second
 * implementation is a second answer to "what does a share link contain". The
 * payload is assembled by the caller, which is the only side that knows what it
 * is looking at; everything about *encoding* it stays in `shareLink.ts`.
 *
 * Copying rather than invoking an OS share sheet: Electron has no portable one,
 * and every destination the PRD names — WhatsApp, Telegram, Discord, email —
 * takes pasted text. A clipboard write is also the only form that cannot fail
 * halfway and leave the viewer wondering whether anything was sent.
 */
export const ShareButton: React.FC<{
  media: Omit<SharePayload, 'v'>;
  /** Icon-only, for dense rows and the player's control bar. */
  compact?: boolean;
  label?: string;
  className?: string;
}> = ({ media, compact = false, label = 'Share', className }) => {
  const { message: done, flash } = useFlash<string>(2200);

  const share = useCallback(async () => {
    const link = encodeShareLink(media);
    try {
      await navigator.clipboard.writeText(link);
      flash(describeShare(media));
    } catch {
      /**
       * The clipboard can refuse — a window without focus, a locked-down
       * profile. Saying so beats a button that looks like it worked, because
       * the viewer's next act is to paste into a chat and send nothing.
       */
      flash('Could not copy the link');
    }
  }, [media, flash]);

  return (
    <button
      type="button"
      className={className ?? `share-button${compact ? ' share-button--compact' : ''}`}
      onClick={(event) => {
        // Share rows live inside clickable cards; without this the card opens
        // behind the toast and the viewer loses the page they were sharing.
        event.stopPropagation();
        void share();
      }}
      title={`Copy a link to ${describeShare(media)}`}
      aria-label={`Copy a link to ${describeShare(media)}`}
    >
      {done ? <Check size={15} /> : <Share2 size={15} />}
      {!compact && <span>{done ? 'Link copied' : label}</span>}
    </button>
  );
};
