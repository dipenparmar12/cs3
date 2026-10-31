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
 * launch; Skip this version hides it until a newer one. Download fetches the
 * right file for this machine and checks it against the release's
 * SHA256SUMS.txt; only then is Install now offered. Without checksums, or on a
 * mismatch, nothing is kept and the release page opens.
 */
export const AppUpdateNotice: React.FC<{ held: boolean }> = ({ held }) => {
  const state = useAppUpdate();
  const [laterFor, setLaterFor] = useState<string | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const offer = state?.available;
  const download = state?.download && state.download.version === offer?.version ? state.download : undefined;
  const percent = download?.total ? Math.min(100, Math.round((download.received / download.total) * 100)) : 0;

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
        {download?.phase === 'verified' && (
          <span className="app-update-notice__hint">Downloaded and verified. Installing closes CloudStream.</span>
        )}
        {download?.phase === 'failed' && <span className="app-update-notice__hint">{download.message}</span>}
      </span>
      {download?.phase === 'verified' ? (
        <Button size="compact" variant="prominent" onClick={() => void window.cloudstream?.installAppUpdate?.()}>
          Install now
        </Button>
      ) : download?.phase === 'downloading' ? (
        <span className="app-update-notice__hint" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
          Downloading… {percent}%
        </span>
      ) : (
        <Button size="compact" variant="prominent" onClick={() => void window.cloudstream?.downloadAppUpdate?.()}>
          Download
        </Button>
      )}
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
