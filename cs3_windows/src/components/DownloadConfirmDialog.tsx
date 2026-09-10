import React, { useEffect, useState } from 'react';
import { Download, FolderOpen, HardDrive, X } from 'lucide-react';
import type { DownloadTask } from '../types/download';
import { formatBytes } from '../utils/format';

export type DownloadConfirmPreference = 'ask' | 'immediate';

/** What the main process knows about this press that the renderer cannot work out. */
export interface DownloadPreview {
  targetPath?: string;
  directory?: string;
  /** `Paused`, `Completed`, … when a task for this exact variant already exists. */
  existingState?: string;
}

/**
 * "Download" is a commitment to one variant, shown before it is made.
 *
 * Every row in the source list reads "Download". They are not the same
 * download: a 16 GB 2160p Atmos release and a 900 MB 1080p dual-audio one are
 * different files, in different folders, over different amounts of a metered
 * connection, and the press that chooses between them shows none of that. This
 * is the difference made visible — and nothing more than that. It performs no
 * action of its own; the press it confirms is the press that was already going
 * to happen.
 *
 * Off by default (`immediate`), because the worst outcome of a mistaken
 * download is a cancellable transfer and a file in the wrong folder — unlike
 * the delete prompt beside it, which guards something unrecoverable and
 * therefore asks by default.
 *
 * The destination is quoted from `download:preview` rather than assembled here.
 * The folder layout, the variant segment and the collision suffix are all
 * decided in the main process from the rest of the queue, so a path composed in
 * the renderer would be wrong exactly when it matters — on the second release
 * of a film already being downloaded, which is the case this dialog exists to
 * make legible.
 */
export const DownloadConfirmDialog: React.FC<{
  task: DownloadTask;
  preview: DownloadPreview | null;
  onConfirm: (remember: boolean) => void;
  onCancel: () => void;
}> = ({ task, preview, onConfirm, onCancel }) => {
  const [remember, setRemember] = useState(false);

  // Escape cancels. Nothing has started, so cancelling costs nothing.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onCancel]);

  const episode =
    task.seasonNumber !== undefined && task.episodeNumber !== undefined
      ? `S${String(task.seasonNumber).padStart(2, '0')}E${String(task.episodeNumber).padStart(2, '0')}`
      : task.episodeNumber !== undefined
        ? `E${String(task.episodeNumber).padStart(2, '0')}`
        : null;

  /**
   * Rows are omitted rather than filled with "Unknown".
   *
   * A provider that declares no language has said nothing about the language;
   * printing "Unknown" three times turns a short honest summary into a wall
   * that reads as broken metadata.
   */
  const rows: Array<[string, string]> = [];
  if (task.providerName) rows.push(['From', task.providerName]);
  if (task.resolution) rows.push(['Resolution', `${task.resolution}p`]);
  else if (task.quality) rows.push(['Quality', task.quality]);
  if (task.languages?.length) rows.push(['Language', task.languages.join(', ')]);
  if (task.link?.name && task.link.name !== task.title) rows.push(['Release', task.link.name]);
  /**
   * "Estimated", and it is an estimate: many providers send no `Content-Length`
   * at all, and the ones that do are quoting the host, not the file. Base 1000
   * because a release size is a provider/tracker quote — see `utils/format.ts`
   * for why download *progress* uses 1024 and this deliberately does not.
   */
  if (task.totalBytes > 0) {
    rows.push(['Estimated size', formatBytes(task.totalBytes, { base: 1000, decimals: 1 })]);
  }

  const resuming = preview?.existingState === 'Paused';
  const alreadyDone = preview?.existingState === 'Completed';

  return (
    <div className="modal-backdrop" onClick={onCancel} role="presentation">
      <div
        className="modal download-confirm"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="download-confirm-title"
      >
        <div className="download-confirm__head">
          <h3 id="download-confirm-title">
            {resuming ? 'Resume this download?' : 'Download this?'}
          </h3>
          <button
            type="button"
            className="btn btn-secondary btn-icon"
            onClick={onCancel}
            title="Cancel"
          >
            <X size={15} />
          </button>
        </div>

        <p className="download-confirm__title">
          {task.parentTitle || task.title}
          {episode && <span className="download-confirm__episode">{episode}</span>}
          {task.episodeTitle && (
            <span className="download-confirm__episode-title">{task.episodeTitle}</span>
          )}
        </p>

        <dl className="download-confirm__facts">
          {rows.map(([label, value]) => (
            <React.Fragment key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </React.Fragment>
          ))}
        </dl>

        <div className="download-confirm__where">
          <FolderOpen size={14} />
          <span title={preview?.targetPath}>
            {preview?.directory ?? 'Working out where this will be saved…'}
          </span>
        </div>

        {/*
          What the press will actually do, when it is not simply "start".
          `download:request` has distinguished these six cases since it replaced
          the old blanket "Already downloading" refusal; saying so before the
          press rather than after is the whole point of asking at all.
        */}
        {resuming && (
          <p className="download-confirm__note">
            <HardDrive size={13} />
            This was paused part-way. It continues from where it stopped.
          </p>
        )}
        {alreadyDone && (
          <p className="download-confirm__note">
            <HardDrive size={13} />
            This has already finished. It downloads again only if the file has gone.
          </p>
        )}

        <label className="download-confirm__remember">
          <input
            type="checkbox"
            checked={remember}
            onChange={(event) => setRemember(event.target.checked)}
          />
          <span>Don’t ask again — start downloads straight away</span>
        </label>

        <div className="download-confirm__actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => onConfirm(remember)}
            autoFocus
          >
            <Download size={15} />
            {resuming ? 'Resume' : 'Download now'}
          </button>
        </div>
      </div>
    </div>
  );
};
