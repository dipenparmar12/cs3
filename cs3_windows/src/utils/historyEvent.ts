import type { DownloadTask } from '../types/download';
import type { HistoryEvent } from '../types/history';

/**
 * The one place a download task is turned into a history record.
 *
 * This mapping existed three times — `DownloadService.recordHistory` in the main
 * process, and `App.handleEnqueueDownload` and `VideoPlayer`'s download button in
 * the renderer — each spelling out the same twenty-odd fields by hand, including
 * the two fallback chains that are easy to get subtly wrong:
 *
 *  - `title` falls back **from the parent to the episode**, so a series event is
 *    filed under the show rather than under "Episode 3".
 *  - `mediaUrl` prefers the parent's address, then the task's own, and only then
 *    the link — and the link is a *download* address, which is why it is last.
 *  - `type` is derived from the presence of a season or episode number when the
 *    task does not state it, so a series never files itself as a film.
 *
 * Three copies of that is the `sourceIdentity` failure shape: they do not break,
 * they **drift** — one caller starts filing episodes under their own titles and
 * the history view silently splits one show into forty rows. Nothing throws, and
 * nothing in a log says so.
 *
 * Callers supply only what they actually know: what happened (`action`), how it
 * went (`status`), and a reason if it failed.
 */
export function historyEventForTask(
  task: DownloadTask,
  action: HistoryEvent['action'],
  status: HistoryEvent['status'],
  failureReason?: string
): Omit<HistoryEvent, 'id' | 'timestamp' | 'mediaKey'> {
  return {
    title: task.parentTitle || task.title,
    parentTitle: task.parentTitle,
    mediaUrl: task.parentMediaUrl || task.mediaUrl || task.link.url,
    parentMediaUrl: task.parentMediaUrl,
    posterUrl: task.posterUrl,
    season: task.seasonNumber,
    episode: task.episodeNumber,
    episodeTitle: task.episodeTitle,
    type:
      task.mediaType ||
      (task.seasonNumber !== undefined || task.episodeNumber !== undefined
        ? 'series'
        : 'movie'),
    year: task.year,
    originalTitle: task.originalTitle,
    action,
    status,
    failureReason,
    source: {
      providerName: task.providerName,
      sourceName: task.link.name,
      directUrl: task.link.url,
      directHeaders: task.headers,
      quality: task.quality ? `${task.quality}p` : undefined,
      resolution: task.resolution,
      sizeBytes: task.totalBytes,
    },
  };
}
