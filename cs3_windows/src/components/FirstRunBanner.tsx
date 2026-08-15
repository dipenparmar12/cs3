import React, { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, PackagePlus } from 'lucide-react';
import type { BootstrapProgress } from '../../electron/cs3/bootstrap';

/**
 * What the app is doing on its very first launch.
 *
 * The first run installs the verified extension repositories in the background,
 * and that takes a minute or two of downloading and DEX translation. Without
 * this strip that minute looks like a broken app: the user searches, gets
 * nothing because no provider has registered yet, and concludes the thing does
 * not work — right before it starts working.
 *
 * It appears only while there is something to say, and removes itself a few
 * seconds after the install finishes. Nothing here blocks anything: the app is
 * fully usable throughout, drawing on the catalogues and torrent indexers while
 * the providers arrive.
 */
export const FirstRunBanner: React.FC = () => {
  const [progress, setProgress] = useState<BootstrapProgress | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let dispose: (() => void) | undefined;
    window.cloudstream?.getBootstrapProgress?.().then(setProgress);
    dispose = window.cloudstream?.onBootstrapProgress?.(setProgress);
    return () => dispose?.();
  }, []);

  // The "done" state is worth showing briefly — it is the moment search becomes
  // materially better — but it is not worth keeping.
  useEffect(() => {
    if (progress?.phase !== 'done' || progress.installed === 0) return;
    const timer = window.setTimeout(() => setDismissed(true), 6000);
    return () => window.clearTimeout(timer);
  }, [progress?.phase, progress?.installed]);

  if (dismissed || !progress || progress.phase === 'idle') return null;
  if (progress.phase === 'done' && progress.installed === 0) return null;

  const done = progress.phase === 'done';
  const settled = progress.installed + progress.failed;
  const percent = progress.total === 0 ? 0 : Math.min(100, Math.round((settled / progress.total) * 100));

  return (
    <div className={`first-run${done ? ' first-run--done' : ''}`} role="status">
      <span className="first-run__icon">
        {done ? <CheckCircle2 size={15} /> : <Loader2 size={15} className="spin" />}
      </span>

      <div className="first-run__body">
        <strong>
          {done
            ? `${progress.installed} extension${progress.installed === 1 ? '' : 's'} ready`
            : 'Setting up your extensions'}
        </strong>
        <span className="first-run__detail">
          {done
            ? 'Search now draws on every provider they registered.'
            : progress.repository
              ? `${progress.repository} — ${settled} of ${progress.total}`
              : 'Fetching repositories…'}
        </span>
        {!done && (
          <div className="first-run__bar">
            <div className="first-run__fill" style={{ width: `${percent}%` }} />
          </div>
        )}
      </div>

      {!done && (
        <span className="first-run__note">
          <PackagePlus size={12} /> You can search while this finishes
        </span>
      )}

      <button className="first-run__close" onClick={() => setDismissed(true)} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
};
