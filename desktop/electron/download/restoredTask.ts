import { DownloadState, type DownloadTask } from '../../src/types/download.ts';

/**
 * What a download record from a backup is, on this computer.
 *
 * A backup carries the download list, never the files. Restoring a record as
 * it was written would put "Completed" beside a film that is not on this disk,
 * and the first anyone knows is a Play press that fails. So the record's state
 * is re-derived from the disk, never trusted:
 *
 * | On disk | Restored as |
 * |---|---|
 * | the finished file, at the expected size (1% tolerance, as at completion) | Completed |
 * | a `.part` beside the target | Paused — resuming proves the partial matches before using it (`resumePlan.ts`) |
 * | nothing | Failed, with a sentence saying so; retrying re-resolves the source |
 *
 * A file at the target path for a record that never finished is *not*
 * evidence of completion — it may be an earlier attempt — and is treated as a
 * partial rather than promoted.
 *
 * Pure apart from the probe, which is injected so it can be tested.
 */

export interface FileProbe {
  /** Size in bytes, or null when there is no such file. */
  size(filePath: string): number | null;
}

export type RestoredVerdict = 'verified' | 'partial' | 'missing';

export function reconcileRestoredTask(
  task: DownloadTask,
  probe: FileProbe
): { task: DownloadTask; verdict: RestoredVerdict } {
  const settled: DownloadTask = {
    ...task,
    downloadSpeed: 0,
    etaSeconds: 0,
    retryCount: 0,
    errorMessage: undefined,
  };
  const finished = probe.size(task.targetFilePath);
  const partial = probe.size(`${task.targetFilePath}.part`);
  const expected = task.totalBytes > 0 ? task.totalBytes : 0;

  if (task.state === DownloadState.Completed && finished !== null && finished > 0) {
    if (expected === 0 || finished >= expected * 0.99) {
      const size = finished || expected;
      return {
        task: { ...settled, state: DownloadState.Completed, totalBytes: size, bytesDownloaded: size },
        verdict: 'verified',
      };
    }
  }

  const onDisk = partial ?? (task.state === DownloadState.Completed ? null : finished);
  if (onDisk !== null && onDisk > 0) {
    return {
      task: {
        ...settled,
        state: DownloadState.Paused,
        bytesDownloaded: Math.min(onDisk, expected || onDisk),
      },
      verdict: 'partial',
    };
  }

  return {
    task: {
      ...settled,
      state: DownloadState.Failed,
      bytesDownloaded: 0,
      errorMessage:
        task.state !== DownloadState.Completed
          ? 'Restored from a backup before it had finished. Download it again to fetch it.'
          : finished !== null && finished > 0
            ? 'Restored from a backup. The file on this computer is smaller than the download was — download it again.'
            : 'Restored from a backup. The file is not on this computer — download it again to fetch it.',
    },
    verdict: 'missing',
  };
}
