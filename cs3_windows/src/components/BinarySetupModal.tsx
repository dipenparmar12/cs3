import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Download, CheckCircle2, RefreshCw, X, AlertTriangle } from 'lucide-react';

/**
 * The offer to install the download and playback components.
 *
 * This is frequently the first dialog a new user sees, and until 2026-08-27 the
 * button in it could not work: the preload invoked `binary:setupBinaries`, a
 * channel nothing registered, so `invoke` rejected — and the catch below dressed
 * the raw Electron message up as a friendly notice reading
 * `Notice: No handler registered for 'binary:setupBinaries' (HTTP fallback
 * stream active)`. The user was told a fallback was active and had no way to
 * know the button had done nothing at all.
 *
 * Two rules came out of that and are worth keeping:
 *
 * - **`setupAllBinaries` is the one to call.** It installs every component and
 *   pushes per-component progress, which is what the bar below renders. The
 *   handler that was *meant* to be reached installed two of them and pushed no
 *   progress.
 * - **A rejected call is not a failed install.** They are told apart now,
 *   because the first is a bug in this app and the second is a network or a
 *   mirror having a bad day, and offering the user the same sentence for both
 *   makes the actionable one invisible.
 */
interface BinarySetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

type Phase = 'idle' | 'installing' | 'done' | 'failed';

export const BinarySetupModal: React.FC<BinarySetupModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [phase, setPhase] = useState<Phase>('idle');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [progressPercent, setProgressPercent] = useState(0);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const startRef = useRef<HTMLButtonElement | null>(null);
  /** Focus is handed back where it came from, or the trigger appears to vanish. */
  const returnFocusTo = useRef<Element | null>(null);

  const installing = phase === 'installing';

  useEffect(() => {
    if (!isOpen) return;
    returnFocusTo.current = document.activeElement;
    startRef.current?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !installing) {
        onClose();
        return;
      }
      // A modal that lets Tab walk into the page behind it is not modal.
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      (returnFocusTo.current as HTMLElement | null)?.focus?.();
    };
  }, [isOpen, installing, onClose]);

  const handleStartSetup = useCallback(async () => {
    if (!window.cloudstream) return;
    setPhase('installing');
    setProgressPercent(0);
    setStatusMessage('Starting…');

    const unsubscribe = window.cloudstream.onBinarySetupProgress?.((progress) => {
      setStatusMessage(progress.component ? `${progress.component} — ${progress.status}` : progress.status);
      setProgressPercent(progress.percent);
    });

    try {
      const result = await window.cloudstream.setupAllBinaries();
      if (result.ok) {
        setPhase('done');
        setProgressPercent(100);
        setStatusMessage(result.message || 'Ready.');
        window.setTimeout(() => {
          onSuccess();
          onClose();
        }, 1200);
      } else {
        setPhase('failed');
        setStatusMessage(
          `${result.message || 'The components could not be installed.'} Downloads will use the built-in transfer until this succeeds.`
        );
      }
    } catch (error) {
      // A rejection here is this app failing to ask, not the install failing.
      setPhase('failed');
      setStatusMessage(
        `Could not reach the installer: ${
          error instanceof Error ? error.message : String(error)
        }. This is a bug — please report it.`
      );
    } finally {
      unsubscribe?.();
    }
  }, [onClose, onSuccess]);

  if (!isOpen) return null;

  return (
    <div
      className="modal-backdrop"
      onClick={() => !installing && onClose()}
      role="presentation"
    >
      <div
        className="modal binary-setup"
        ref={dialogRef}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="binary-setup-title"
      >
        <header className="modal__head">
          <h3 id="binary-setup-title">
            <Download size={17} /> Set up downloads and playback
          </h3>
          <button
            className="icon-button"
            onClick={onClose}
            disabled={installing}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </header>

        <p className="binary-setup__blurb">
          Three components make downloads faster and let unusual files play without being
          re-encoded: <strong>aria2</strong> for multi-connection transfers, <strong>yt-dlp</strong> as
          a fallback extractor, and <strong>FFmpeg</strong> for inspecting and converting media. They
          are downloaded from their publishers and kept inside this app.
        </p>

        {statusMessage && (
          <div
            className={`binary-setup__status binary-setup__status--${phase}`}
            role="status"
            aria-live="polite"
          >
            {installing && <RefreshCw size={15} className="spin" />}
            {phase === 'done' && <CheckCircle2 size={15} />}
            {phase === 'failed' && <AlertTriangle size={15} />}
            <span>{statusMessage}</span>
          </div>
        )}

        {installing && (
          <div
            className="binary-setup__bar"
            role="progressbar"
            aria-valuenow={Math.round(progressPercent)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="binary-setup__fill"
              style={{ width: `${Math.max(2, Math.min(100, progressPercent))}%` }}
            />
          </div>
        )}

        <footer className="modal__foot">
          <button className="btn btn-secondary" onClick={onClose} disabled={installing}>
            Not now
          </button>
          <button
            className="btn btn-primary"
            onClick={handleStartSetup}
            disabled={installing}
            ref={startRef}
          >
            <Download size={16} />
            <span>
              {installing ? 'Installing…' : phase === 'failed' ? 'Try again' : 'Install components'}
            </span>
          </button>
        </footer>
      </div>
    </div>
  );
};
