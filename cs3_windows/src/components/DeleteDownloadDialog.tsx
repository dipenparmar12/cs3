import React, { useEffect, useState } from 'react';
import { AlertTriangle, FileX, ListX, X } from 'lucide-react';

export type DeletePreference = 'ask' | 'list-only' | 'list-and-file';

/**
 * The two things "Delete" can mean, asked rather than assumed.
 *
 * Removing a finished film from the list and erasing it from the disk are not
 * degrees of the same action — one is tidying, the other is unrecoverable — and
 * no default is right for both. A download manager that picks for you is wrong
 * about half the time, and wrong in the direction that loses a 5 GB file
 * somebody waited an hour for.
 *
 * The "remember" checkbox is the escape from being asked forever, and it is
 * deliberately **off** by default: a preference silently learned from one click
 * on one download is a preference nobody knows they set. Whichever way it ends
 * up remembered, Settings → Downloads can put the prompt back — a choice that
 * can only be made inside a dialog you no longer see is a choice you cannot
 * reverse.
 */
export const DeleteDownloadDialog: React.FC<{
  /** What is being removed, so the confirmation names it. */
  title: string;
  /** Plural form for the batch case: "3 downloads". */
  count?: number;
  /** True when a finished file exists — deleting then really does destroy something. */
  hasFile: boolean;
  onConfirm: (deleteFile: boolean, remember: boolean) => void;
  onCancel: () => void;
}> = ({ title, count = 1, hasFile, onConfirm, onCancel }) => {
  const [remember, setRemember] = useState(false);

  // Escape cancels, which is the safe half of a destructive choice.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const label = count > 1 ? `${count} downloads` : title;

  return (
    <div className="modal-backdrop" onClick={onCancel} role="presentation">
      <div
        className="modal delete-download"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-download-title"
      >
        <div className="delete-download__head">
          <h3 id="delete-download-title">Remove {label}?</h3>
          <button
            type="button"
            className="btn btn-secondary btn-icon"
            onClick={onCancel}
            title="Cancel"
          >
            <X size={15} />
          </button>
        </div>

        <div className="delete-download__choices">
          <button
            type="button"
            className="delete-download__choice"
            onClick={() => onConfirm(false, remember)}
          >
            <ListX size={18} />
            <span>
              <strong>Remove from list only</strong>
              <em>
                {hasFile
                  ? 'The downloaded file stays on disk.'
                  : 'Nothing has finished downloading yet, so nothing is kept.'}
              </em>
            </span>
          </button>

          <button
            type="button"
            className="delete-download__choice delete-download__choice--danger"
            onClick={() => onConfirm(true, remember)}
          >
            <FileX size={18} />
            <span>
              <strong>Remove and delete the file</strong>
              <em>
                {hasFile
                  ? 'The file is deleted from disk. This cannot be undone.'
                  : 'Also clears any partial data left behind.'}
              </em>
            </span>
          </button>
        </div>

        <label className="delete-download__remember">
          <input
            type="checkbox"
            checked={remember}
            onChange={(event) => setRemember(event.target.checked)}
          />
          <span>Remember my choice and stop asking</span>
        </label>

        {remember && (
          <p className="delete-download__note">
            <AlertTriangle size={13} />
            You can change this again in Settings → Downloads.
          </p>
        )}
      </div>
    </div>
  );
};
