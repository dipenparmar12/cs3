import React, { useState } from 'react';
import { Checkbox, Dialog } from './ui';
import { AlertTriangle, FileX, ListX } from 'lucide-react';

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

  // Escape cancels (the safe half of a destructive choice) — the shared Dialog
  // consumes it in the capture phase, so the player behind never sees it.
  const label = count > 1 ? `${count} downloads` : title;

  return (
    <Dialog title={`Remove ${label}?`} size="sm" onClose={onCancel} className="delete-download">
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

        <Checkbox checked={remember} onChange={setRemember} label="Remember my choice and stop asking" />

        {remember && (
          <p className="delete-download__note">
            <AlertTriangle size={13} />
            You can change this again in Settings → Downloads.
          </p>
        )}
    </Dialog>
  );
};
