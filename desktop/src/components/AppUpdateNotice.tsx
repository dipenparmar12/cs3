import React, { useState } from 'react';
import { ArrowUpCircle, X } from 'lucide-react';
import { Button, Dialog, DialogActions } from './ui';
import { useAppUpdate } from '../utils/useAppUpdate';
import { formatBytes } from '../utils/format';

/**
 * "A newer CloudStream 3 Desktop is available" (App Update PRD §7.1).
 *
 * Bottom right, beside the extension notice's place. Held while the player is
 * in front: a film is never interrupted by an update. Later hides it for this
 * launch; Skip this version hides it until a newer one. Download opens the
 * right file for this machine in the browser (Phase 1: the app runs nothing).
 */
export const AppUpdateNotice: React.FC<{ held: boolean }> = ({ held }) => {
  const state = useAppUpdate();
  const [laterFor, setLaterFor] = useState<string | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const offer = state?.available;

  if (!offer) return null;
  if (notesOpen) {
    return (
      <Dialog
        title={offer.title}
        description={`${offer.channel === 'beta' ? 'Beta · ' : ''}Released ${new Date(offer.publishedAt).toLocaleDateString()}`}
        onClose={() => setNotesOpen(false)}
        footer={
          <DialogActions>
            <Button onClick={() => setNotesOpen(false)}>Close</Button>
            <Button
              variant="prominent"
              onClick={() => {
                setNotesOpen(false);
                void window.cloudstream?.openAppUpdateDownload?.();
              }}
            >
              Download
            </Button>
          </DialogActions>
        }
      >
        {/* Release notes are someone else's text: shown as text, never markup. */}
        <pre className="app-update-notes">{offer.notes || 'No release notes were published.'}</pre>
      </Dialog>
    );
  }
  if (held || laterFor === offer.version) return null;

  return (
    <div className="toast ext-update-notice app-update-notice" role="status">
      <ArrowUpCircle size={15} aria-hidden />
      <span>
        <strong>CloudStream 3 Desktop {offer.version}</strong> is available
        {offer.channel === 'beta' ? ' (beta)' : ''}
        {offer.asset.size ? ` · ${formatBytes(offer.asset.size)}` : ''}
        {offer.channel === 'beta' && (
          <span className="app-update-notice__hint">Previews of the next release. May be unstable.</span>
        )}
      </span>
      <Button size="compact" variant="prominent" onClick={() => void window.cloudstream?.openAppUpdateDownload?.()}>
        Download
      </Button>
      <Button size="compact" variant="ambient" onClick={() => setNotesOpen(true)}>
        What&apos;s new
      </Button>
      <Button size="compact" variant="ambient" onClick={() => void window.cloudstream?.skipAppUpdate?.(offer.version)}>
        Skip this version
      </Button>
      <button
        type="button"
        className="ext-update-notice__close"
        aria-label="Later"
        title="Later"
        onClick={() => setLaterFor(offer.version)}
      >
        <X size={13} />
      </button>
    </div>
  );
};
