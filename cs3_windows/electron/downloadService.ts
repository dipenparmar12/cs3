import fs from 'fs';
import path from 'path';
import type { DownloadRequestResult, DownloadTask } from '../src/types/download';
import { DownloadAction, DownloadState } from '../src/types/download';
import {
  downloadTaskId,
  downloadVariantKey,
  variantFromSource,
  variantFromTask,
} from '../src/utils/downloadIdentity.ts';
import type { DatastoreManager } from './datastore';
import type { Aria2Engine } from './aria2Engine';
import { MediaDownloadResolver } from './mediaDownloadResolver';
import { YtDlpEngine } from './ytdlpEngine';
import { startHttpDownload } from './httpDownloader';
import { containersAgree, overlapWindow, planResume } from './download/resumePlan.ts';
import { fetchRemoteWindow, readLocalWindow } from './download/resumeWindow.ts';
import type { TorrentEngine } from './torrent/torrentEngine';
import type { ContentService } from './contentService';
import type { AnalyticsSink } from './pluginManager';
import type { TorrentResult } from '../src/types/torrent';
import type { HistoryStore } from './cs3/historyStore';
import type { HistoryAction, HistoryStatus } from '../src/types/history';
import { scopedLogger } from './logging/logger.ts';

const log = scopedLogger('download');

/**
 * The download queue, across every kind of source the app can play.
 *
 * There are four transport shapes and each needs a different engine, which is
 * the whole reason this class exists:
 *
 *  | Source                | Engine            | Why                            |
 *  |-----------------------|-------------------|--------------------------------|
 *  | magnet / infohash     | `TorrentEngine`   | reuses pieces already streamed |
 *  | HLS (`.m3u8`) / DASH  | `yt-dlp`          | segments must be concatenated  |
 *  | progressive HTTP      | `aria2c`          | multi-connection, fast         |
 *  | progressive HTTP      | built-in fallback | aria2c is optional             |
 *
 * Previously only the first and third worked: HLS failed with a message, and
 * the built-in fallback lost the file on pause. Every row now completes, resumes
 * and reports progress the same way.
 */

/**
 * Transfers running at once. A season batch queues dozens of episodes; starting
 * them all would open dozens of swarms and split the bandwidth so finely that
 * nothing finishes.
 */
const MAX_CONCURRENT_DOWNLOADS = 3;

/** Anything a running transfer needs to be able to stop. */
interface ActiveHandle {
  cancel(): void;
}

export class DownloadService {
  private datastore: DatastoreManager;
  private aria2: Aria2Engine;
  private ytdlp = new YtDlpEngine();
  private resolver: MediaDownloadResolver;
  private torrentEngine: TorrentEngine | null = null;
  private contentService: ContentService | null = null;
  private queue: Map<string, DownloadTask> = new Map();
  private gidToTaskId: Map<string, string> = new Map();
  /** taskId → infoHash, for downloads served by the torrent engine. */
  private torrentTasks: Map<string, string> = new Map();
  /** taskId → canceller, for the built-in HTTP downloader and yt-dlp. */
  private handles: Map<string, ActiveHandle> = new Map();
  private pollInterval: NodeJS.Timeout | null = null;
  private onProgressCallback?: (tasks: DownloadTask[]) => void;
  /** Where download outcomes are counted, when the host supplies a store. */
  private analytics: AnalyticsSink | null = null;
  /** Where user download events and history records are persisted. */
  private historyStore: HistoryStore | null = null;

  /** Wired by `main.ts`; download outcomes are counted from here onwards. */
  public setAnalytics(sink: AnalyticsSink): void {
    this.analytics = sink;
  }

  public setHistoryStore(sink: HistoryStore): void {
    this.historyStore = sink;
  }

  public recordHistory(
    task: DownloadTask,
    action: HistoryAction,
    status: HistoryStatus,
    failureReason?: string
  ): void {
    if (!this.historyStore) return;
    try {
      this.historyStore.record({
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
      });
    } catch (e) {
      console.warn('[downloadService] Failed to record history event:', e);
    }
  }

  constructor(datastore: DatastoreManager, aria2: Aria2Engine) {
    this.datastore = datastore;
    this.aria2 = aria2;
    this.resolver = new MediaDownloadResolver(aria2);
    this.loadQueueFromStorage();
  }

  public setContentService(contentService: ContentService): void {
    this.contentService = contentService;
  }

  /**
   * Torrent downloads reuse the streaming engine rather than aria2.
   *
   * aria2 can handle magnets, but routing them through the engine means a title
   * the user is already streaming continues from the pieces it has instead of
   * restarting the transfer from zero in a second client.
   */
  public setTorrentEngine(engine: TorrentEngine): void {
    this.torrentEngine = engine;
  }

  private static isMagnet(url: string): boolean {
    return url.startsWith('magnet:') || /^[a-f0-9]{40}$/i.test(url);
  }

  private static isSegmented(task: DownloadTask): boolean {
    const url = task.link?.url ?? '';
    const clean = url.split(/[?#]/)[0].toLowerCase();
    return (
      Boolean(task.link?.isM3u8) ||
      Boolean(task.link?.isDash) ||
      clean.endsWith('.m3u8') ||
      clean.endsWith('.m3u') ||
      clean.endsWith('.mpd') ||
      /\/(getm3u8|m3u8|hls|dash|mpd)\b/i.test(clean) ||
      /[?&]format=(m3u8|hls|dash)/i.test(url)
    );
  }

  private loadQueueFromStorage(): void {
    const saved = this.datastore.getObject<DownloadTask[]>('download_queue_list', []);
    if (!saved || !Array.isArray(saved)) return;

    for (const task of saved) {
      // Nothing is running after a restart. Marking these Paused rather than
      // Queued is deliberate: a partial file is on disk and resuming continues
      // from it, but silently restarting a dozen transfers on launch is not
      // something the user asked for.
      if (task.state === DownloadState.Downloading || task.state === DownloadState.Queued) {
        task.state = DownloadState.Paused;
        task.downloadSpeed = 0;
        task.etaSeconds = 0;
      }
      /**
       * Queues written before downloads had a variant identity are given one
       * from what they already carry. The id is left alone: rewriting it would
       * orphan the `.part` file beside it and lose the bytes already fetched.
       */
      if (!task.variantKey) task.variantKey = downloadVariantKey(variantFromTask(task));
      this.queue.set(task.id, task);
    }
  }

  private saveQueueToStorage(): void {
    const list = Array.from(this.queue.values());
    this.datastore.setObject('download_queue_list', list);
    if (this.onProgressCallback) {
      this.onProgressCallback(list);
    }
  }

  public setProgressCallback(cb: (tasks: DownloadTask[]) => void): void {
    this.onProgressCallback = cb;
  }

  public async start(): Promise<void> {
    await this.aria2.start();
    this.startPolling();
  }

  private startPolling(): void {
    if (this.pollInterval) clearInterval(this.pollInterval);
    this.pollInterval = setInterval(async () => {
      await this.pollStatus();
    }, 1000);
  }

  private async pollStatus(): Promise<void> {
    await this.pollTorrentTasks();
    await this.pollAria2Tasks();
    // Slots free up as transfers finish; pumping here is what turns a queue of
    // 40 episodes into 3 running and 37 waiting rather than 40 stalled.
    this.pump();
  }

  private async pollAria2Tasks(): Promise<void> {
    if (!this.aria2.isRunning()) return;

    for (const [gid, taskId] of this.gidToTaskId.entries()) {
      try {
        const status = await this.aria2.getStatus(gid);
        const task = this.queue.get(taskId);
        if (!task) {
          this.gidToTaskId.delete(gid);
          continue;
        }

        task.bytesDownloaded = status.completedLength;
        task.totalBytes = status.totalLength;
        task.downloadSpeed = status.downloadSpeed;

        if (status.downloadSpeed > 0 && status.totalLength > status.completedLength) {
          task.etaSeconds = Math.ceil(
            (status.totalLength - status.completedLength) / status.downloadSpeed
          );
        } else {
          task.etaSeconds = 0;
        }

        if (status.status === 'complete') {
          /**
           * `complete`, not `completed` — see `Aria2Progress.status`. The old
           * spelling matched nothing aria2 sends, so every finished aria2
           * transfer stayed `Downloading` at 100% for the life of the session.
           */
          this.gidToTaskId.delete(gid);
          this.finalizeCompletion(task, status.totalLength);
        } else if (status.status === 'removed') {
          /**
           * Removed out from under us — an aria2 restart, or a `remove` we did
           * not initiate. Left unhandled this was the second way a task could
           * stick: the gid is gone, so no further poll will ever change it.
           */
          this.gidToTaskId.delete(gid);
          if (task.state === DownloadState.Downloading) {
            this.markFailed(task, 'The transfer was removed from the download engine.');
          }
        } else if (status.status === 'paused') {
          // Paused inside aria2 (not through us) must still show as paused.
          if (task.state === DownloadState.Downloading) task.state = DownloadState.Paused;
        } else if (status.status === 'error') {
          const isRangeError =
            status.errorMessage &&
            /range|invalid range|416/i.test(status.errorMessage);
          if (isRangeError) {
            console.warn(
              `[downloads] aria2 range error (${status.errorMessage}); falling back to HTTP downloader for task ${taskId}`
            );
            this.gidToTaskId.delete(gid);
            this.startHttpTask(task);
            return;
          }
          task.state = DownloadState.Failed;
          task.errorMessage = status.errorMessage || 'aria2 transfer error';
          this.gidToTaskId.delete(gid);
        }

        this.saveQueueToStorage();
      } catch {
        // A single failed status poll is not worth surfacing; the next tick retries.
      }
    }
  }

  private async pollTorrentTasks(): Promise<void> {
    if (!this.torrentEngine || this.torrentTasks.size === 0) return;

    let changed = false;
    for (const [taskId, infoHash] of this.torrentTasks.entries()) {
      const task = this.queue.get(taskId);
      if (!task) {
        this.torrentTasks.delete(taskId);
        continue;
      }

      const stats = await this.torrentEngine.getStats(infoHash);
      if (!stats) continue;

      task.bytesDownloaded = stats.downloaded;
      task.totalBytes = stats.fileSize;
      task.downloadSpeed = stats.downloadSpeed;
      task.etaSeconds = Math.round(stats.timeRemainingMs / 1000) || 0;

      if (stats.error) {
        task.state = DownloadState.Failed;
        task.errorMessage = stats.error;
        this.torrentTasks.delete(taskId);
      } else if (stats.progress >= 1) {
        this.torrentTasks.delete(taskId);
        this.finalizeCompletion(task, stats.fileSize);
      } else if (stats.isStalled && !stats.isPaused) {
        // Say so rather than showing 0 B/s forever with no explanation.
        task.errorMessage = `No data for ${Math.round(stats.stalledMs / 1000)}s — the swarm may be dead.`;
        task.state = DownloadState.Downloading;
      } else {
        task.errorMessage = undefined;
        task.state = stats.isPaused ? DownloadState.Paused : DownloadState.Downloading;
      }
      changed = true;
    }

    if (changed) this.saveQueueToStorage();
  }

  // --- queueing ------------------------------------------------------------

  private activeCount(): number {
    let count = 0;
    for (const task of this.queue.values()) {
      if (task.state === DownloadState.Downloading) count++;
    }
    return count;
  }

  /** Promotes queued tasks into running ones while there is capacity. */
  private pump(): void {
    let free = MAX_CONCURRENT_DOWNLOADS - this.activeCount();
    if (free <= 0) return;

    for (const task of this.queue.values()) {
      if (free <= 0) break;
      if (task.state !== DownloadState.Queued) continue;

      free--;
      void this.startTask(task);
    }
  }

  /**
   * The task already holding this variant, if there is one.
   *
   * Keyed on the variant rather than the title, which is the whole fix: the
   * 2160p and the 1080p release of one film are two entries here, and pressing
   * Download on the second no longer finds the first.
   */
  public findByVariant(variantKey: string): DownloadTask | undefined {
    if (!variantKey) return undefined;
    for (const task of this.queue.values()) {
      if ((task.variantKey ?? downloadVariantKey(variantFromTask(task))) === variantKey) {
        return task;
      }
    }
    return undefined;
  }

  /**
   * A path no other task in the queue is writing to.
   *
   * `variantPathSegment` keeps the folder readable, which means it can collide:
   * two different releases from one provider at one resolution produce the same
   * label. Only this class can see the rest of the queue, so the disambiguation
   * belongs here rather than in the pure module. A numbered suffix beats a hash
   * because the common case stays `1080p` — the point of a readable name.
   */
  private claimTargetPath(task: DownloadTask): string {
    const base = this.resolver.generateTargetFilePath(task);
    const taken = new Set<string>();
    for (const other of this.queue.values()) {
      if (other.id !== task.id && other.targetFilePath) {
        taken.add(other.targetFilePath.toLowerCase());
      }
    }
    if (!taken.has(base.toLowerCase())) return base;

    const dir = path.dirname(base);
    const ext = path.extname(base);
    const stem = path.basename(base, ext);
    for (let n = 2; n < 100; n++) {
      const candidate = path.join(dir, `${stem} (${n})${ext}`);
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
    return base;
  }

  public async enqueue(task: DownloadTask): Promise<string> {
    task.state = DownloadState.Queued;
    task.createdTime = task.createdTime || Date.now();
    task.errorMessage = undefined;
    if (!task.variantKey) task.variantKey = downloadVariantKey(variantFromTask(task));
    if (!task.id) task.id = downloadTaskId(variantFromTask(task));

    if (!task.targetFilePath) {
      task.targetFilePath = this.claimTargetPath(task);
    }

    this.recordHistory(task, 'download_started', 'Attempted');
    this.queue.set(task.id, task);
    this.saveQueueToStorage();
    this.pump();
    return task.id;
  }

  /**
   * "The viewer pressed Download", answered according to what already exists.
   *
   * The reported behaviour was that every press on a title with any entry in
   * the list answered `Already downloading` — including when that entry was
   * paused, or had failed, or was a completely different release. Two separate
   * faults: the match was on the title (fixed by the variant key above), and
   * the only outcome was a refusal.
   *
   * A press is a request for the file to make progress. Six states, six useful
   * answers, and only one of them is "nothing to do".
   */
  public async request(task: DownloadTask): Promise<DownloadRequestResult> {
    const variantKey = task.variantKey || downloadVariantKey(variantFromTask(task));
    task.variantKey = variantKey;
    const existing = this.findByVariant(variantKey);

    if (!existing) {
      const id = await this.enqueue(task);
      return { ok: true, action: DownloadAction.Started, taskId: id, message: 'Download started' };
    }

    switch (existing.state) {
      case DownloadState.Downloading:
      case DownloadState.Retrying:
      case DownloadState.RefreshingSource:
        return {
          ok: true,
          action: DownloadAction.Active,
          taskId: existing.id,
          message: 'Already downloading this source',
        };

      case DownloadState.Queued:
        return {
          ok: true,
          action: DownloadAction.Queued,
          taskId: existing.id,
          message: 'Already queued — it starts when a slot frees up',
        };

      case DownloadState.Completed: {
        /**
         * "Completed" is a claim about a file, so it is checked against one.
         * A download whose file the user has since deleted or moved must be
         * startable again — reporting it as finished would leave the only
         * useful action unavailable, with the reason invisible.
         */
        if (existing.targetFilePath && fs.existsSync(existing.targetFilePath)) {
          return {
            ok: true,
            action: DownloadAction.Completed,
            taskId: existing.id,
            message: 'Already downloaded — open Downloads to find it',
          };
        }
        existing.bytesDownloaded = 0;
        existing.retryCount = 0;
        existing.errorMessage = undefined;
        existing.targetFilePath = this.claimTargetPath(existing);
        await this.enqueue(existing);
        return {
          ok: true,
          action: DownloadAction.Started,
          taskId: existing.id,
          message: 'The file was gone — downloading it again',
        };
      }

      case DownloadState.Paused:
        await this.resume(existing.id);
        return {
          ok: true,
          action: DownloadAction.Resumed,
          taskId: existing.id,
          message: 'Download resumed',
        };

      case DownloadState.Failed:
        /**
         * `resume` is the recovery path, not a second start: for a direct link
         * it clears the retry budget and re-resolves the source through the
         * provider before retrying. That is what stops the viewer having to
         * delete a failed task by hand and rebuild it from the source list.
         */
        await this.resume(existing.id);
        return {
          ok: true,
          action: DownloadAction.Recovering,
          taskId: existing.id,
          message: 'Retrying — finding the source again',
        };

      default:
        return {
          ok: true,
          action: DownloadAction.Active,
          taskId: existing.id,
          message: `Already in the download list (${existing.state})`,
        };
    }
  }

  /** Dispatches one task to whichever engine can actually fetch its URL. */
  private async startTask(task: DownloadTask): Promise<void> {
    task.state = DownloadState.Downloading;
    task.errorMessage = undefined;
    this.recordHistory(task, 'download_started', 'Downloaded');
    this.saveQueueToStorage();

    const outputDir = path.dirname(task.targetFilePath);
    try {
      fs.mkdirSync(outputDir, { recursive: true });
    } catch (error) {
      this.markFailed(task, `Could not create the download folder: ${describe(error)}`);
      return;
    }

    if (DownloadService.isMagnet(task.link.url) && this.torrentEngine) {
      await this.startTorrentTask(task, outputDir);
      return;
    }

    if (DownloadService.isSegmented(task)) {
      this.startSegmentedTask(task);
      return;
    }

    if (this.aria2.isRunning()) {
      try {
        const gid = await this.resolver.dispatchDownload(task);
        this.gidToTaskId.set(gid, task.id);
        this.saveQueueToStorage();
        return;
      } catch {
        console.warn('[downloads] aria2 dispatch failed; using the built-in downloader');
      }
    }

    this.startHttpTask(task);
  }

  private async startTorrentTask(task: DownloadTask, outputDir: string): Promise<void> {
    if (!this.torrentEngine) return;

    try {
      const handle = await this.torrentEngine.startStream({
        torrentId: task.link.url,
        season: task.seasonNumber,
        episode: task.episodeNumber,
        // Per-request rather than mutating the engine-wide path, which used to
        // redirect every *later* torrent — including live streams — into this
        // task's folder.
        downloadPath: outputDir,
        // A download has no playhead. Sequential fetching is what makes a
        // stream playable in seconds and it costs real throughput — a peer
        // holding anything but the exact next piece contributes nothing — so a
        // download that inherits it is slower for no benefit at all.
        mode: 'download',
      });

      // The torrent may already be live from a stream the user was watching,
      // in which case `add` never ran and the strategy is still sequential.
      await this.torrentEngine.setMode(handle.infoHash, 'download');
      this.torrentTasks.set(task.id, handle.infoHash);
      task.totalBytes = handle.fileSize;
      // Multi-file releases nest the episode inside the torrent's own folder,
      // so the real path comes from the engine rather than being guessed.
      task.targetFilePath = handle.diskPath;
      this.saveQueueToStorage();
    } catch (error) {
      this.markFailed(task, describe(error));
    }
  }

  private startSegmentedTask(task: DownloadTask): void {
    const handle = this.ytdlp.download({
      url: task.link.url,
      targetPath: task.targetFilePath,
      headers: task.headers,
      referer: task.link.referer,
      onProgress: (downloaded, total, speed) => this.applyProgress(task, downloaded, total, speed),
      onComplete: (total) => this.markCompleted(task, total),
      onError: (message) => this.markFailed(task, message),
    });
    this.handles.set(task.id, handle);
  }

  private startHttpTask(task: DownloadTask): void {
    const handle = startHttpDownload({
      url: task.link.url,
      targetPath: task.targetFilePath,
      headers: task.headers,
      referer: task.link.referer,
      onProgress: (downloaded, total, speed) => this.applyProgress(task, downloaded, total, speed),
      onComplete: (total) => this.markCompleted(task, total),
      onError: (message) => this.markFailed(task, message),
    });
    this.handles.set(task.id, handle);
  }

  // --- task state transitions ---------------------------------------------

  private applyProgress(
    task: DownloadTask,
    downloaded: number,
    total: number,
    speed: number
  ): void {
    // A cancelled transfer can emit one last progress event; it must not drag
    // the task back out of Paused.
    if (task.state !== DownloadState.Downloading) return;

    task.bytesDownloaded = downloaded;
    if (total > 0) task.totalBytes = total;
    task.downloadSpeed = speed;
    task.etaSeconds =
      speed > 0 && task.totalBytes > downloaded
        ? Math.ceil((task.totalBytes - downloaded) / speed)
        : 0;
    this.saveQueueToStorage();
  }

  /** An engine reported success. Whether that is true is decided below. */
  private markCompleted(task: DownloadTask, totalBytes: number): void {
    this.finalizeCompletion(task, totalBytes);
  }

  /**
   * The only path to `Completed`, and it verifies rather than trusts.
   *
   * "The engine said 100%" and "there is a playable file on disk" are different
   * claims, and the download list is worthless if it reports the second when it
   * only knows the first. A transfer can report every byte and still leave
   * nothing usable: the rename out of `.part` can fail on a locked file, the
   * target directory can vanish onto a disconnected drive, and a server that
   * ignores Range can satisfy a segmented download with garbage that is exactly
   * the right length.
   *
   * So completion requires all of: the engine finished, the target file exists,
   * and its size agrees with what was expected where an expectation exists. A
   * download that fails any of them becomes `Failed` **with the reason**, which
   * the user can retry — rather than `Completed` over a file that will not open.
   */
  private finalizeCompletion(task: DownloadTask, reportedBytes: number): void {
    this.handles.delete(task.id);
    log.info('download_finalising', {
      mediaTitle: task.title,
      provider: task.providerName,
      sourceId: task.id,
      reportedBytes,
      expectedBytes: task.totalBytes,
      target: task.targetFilePath,
    });

    const expected = reportedBytes || task.totalBytes || 0;
    let actual = 0;
    try {
      actual = fs.statSync(task.targetFilePath).size;
    } catch {
      /**
       * Torrent downloads are the exception worth naming: the engine owns the
       * path and may have nested the episode inside the torrent's folder, in
       * which case `targetFilePath` was already rewritten to the real location.
       * If it still is not there, the file genuinely is not there.
       */
      this.markFailed(
        task,
        'The transfer finished but the downloaded file is not on disk. It may have been ' +
          'moved, or the destination folder is no longer available.'
      );
      return;
    }

    /**
     * A leftover `.part` means the finalising rename never happened, so the
     * target is at best a previous attempt. Reporting success here is how a
     * half-written file ends up in someone's library.
     */
    if (fs.existsSync(`${task.targetFilePath}.part`) && actual < expected) {
      this.markFailed(
        task,
        'The transfer finished but the file could not be finalised — a partial download is ' +
          'still on disk. Retry to finish it.'
      );
      return;
    }

    /**
     * Size is checked only when something credible was expected, and with a
     * tolerance. Plenty of sources never send `Content-Length`, and a strict
     * equality test would fail every one of those on a file that is perfectly
     * fine. A shortfall of more than 1% on a *known* size is a truncated file.
     */
    if (expected > 0 && actual < expected * 0.99) {
      this.markFailed(
        task,
        `The transfer stopped early: ${DownloadService.formatBytes(actual)} of ` +
          `${DownloadService.formatBytes(expected)} was written. Retry to resume it.`
      );
      return;
    }

    // Counted here rather than at the engine: a download that retried through a
    // refreshed source still succeeded, and the provider that supplied the link
    // that finally worked is the one that earned the credit.
    this.analytics?.observe({
      provider: task.providerName,
      stage: 'download',
      outcome: 'success',
      produced: 1,
      latencyMs: Date.now() - task.createdTime,
    });

    task.state = DownloadState.Completed;
    task.totalBytes = actual || expected || task.totalBytes;
    task.bytesDownloaded = task.totalBytes;
    task.downloadSpeed = 0;
    task.etaSeconds = 0;
    task.errorMessage = undefined;
    this.writeDownloadInfoFiles(task, task.totalBytes);
    this.recordHistory(task, 'download_completed', 'Downloaded');
    this.saveQueueToStorage();
    this.pump();
  }

  /**
   * Writes companion metadata files (.info.json and .info.txt) alongside the downloaded media.
   *
   * Preserves full origin provenance (original provider, media details URL, series context,
   * source hashes, and download timestamp) directly on disk. If the app is closed, reinstalled,
   * or if the datastore is reset, the file retains its original identity and can be retried or
   * re-opened in CloudStream Desktop at any time.
   */
  private writeDownloadInfoFiles(task: DownloadTask, actualBytes: number): void {
    try {
      if (!task.targetFilePath) return;
      const targetDir = path.dirname(task.targetFilePath);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      const ext = path.extname(task.targetFilePath);
      const basePath = ext ? task.targetFilePath.slice(0, -ext.length) : task.targetFilePath;
      const jsonPath = `${basePath}.info.json`;
      const txtPath = `${basePath}.info.txt`;

      const completedAt = new Date().toISOString();
      const createdAt = task.createdTime ? new Date(task.createdTime).toISOString() : completedAt;

      const metadata = {
        schemaVersion: 1,
        title: task.title,
        parentTitle: task.parentTitle || task.title,
        episodeTitle: task.episodeTitle,
        mediaType: task.mediaType || (task.seasonNumber !== undefined ? 'series' : 'movie'),
        year: task.year,
        originalTitle: task.originalTitle,
        season: task.seasonNumber,
        episode: task.episodeNumber,
        posterUrl: task.posterUrl,
        parentMediaUrl: task.parentMediaUrl,
        mediaUrl: task.mediaUrl,
        providerName: task.providerName,
        source: {
          name: task.link?.name || task.title,
          url: task.link?.url,
          referer: task.link?.referer,
          quality: task.quality,
          resolution: task.resolution,
          infoHash: task.sourceInfoHash,
          isTorrent: task.sourceIsTorrent,
          languages: task.languages,
          audioCodecs: task.audioCodecs,
        },
        download: {
          taskId: task.id,
          variantKey: task.variantKey,
          targetFilePath: task.targetFilePath,
          fileSizeBytes: actualBytes || task.totalBytes,
          fileSizeFormatted: DownloadService.formatBytes(actualBytes || task.totalBytes),
          createdTime: createdAt,
          downloadCompletedAt: completedAt,
        },
        subtitles: task.subtitles ?? [],
      };

      // 1. Structured JSON for programmatic import and recovery
      fs.writeFileSync(jsonPath, JSON.stringify(metadata, null, 2), 'utf8');

      // 2. Human-readable companion text file
      const isEpisode = task.episodeNumber !== undefined || task.seasonNumber !== undefined;
      const itemLabel = isEpisode
        ? `Season ${task.seasonNumber ?? 1}, Episode ${task.episodeNumber ?? 1}${task.episodeTitle ? ` — ${task.episodeTitle}` : ''}`
        : 'Movie / Feature';

      const readableText = [
        '================================================================================',
        'CloudStream 3 Desktop — Download Provenance & Source Metadata',
        '================================================================================',
        `Title:            ${task.parentTitle || task.title}${task.year ? ` (${task.year})` : ''}`,
        `Item:             ${itemLabel}`,
        `Media Type:       ${metadata.mediaType}`,
        `Provider / Source:${task.providerName || 'Extension / Built-in'}`,
        `Source Release:   ${task.link?.name || task.title}`,
        `Quality:          ${task.quality || (task.resolution ? `${task.resolution}p` : 'Unknown')}`,
        task.languages?.length ? `Languages:        ${task.languages.join(', ')}` : null,
        task.audioCodecs?.length ? `Audio Codecs:     ${task.audioCodecs.join(', ')}` : null,
        `File Size:        ${DownloadService.formatBytes(actualBytes || task.totalBytes)}`,
        `Downloaded Date:  ${completedAt}`,
        `Target File:      ${path.basename(task.targetFilePath)}`,
        `Task ID:          ${task.id}`,
        task.variantKey ? `Variant Key:      ${task.variantKey}` : null,
        '',
        '--------------------------------------------------------------------------------',
        'ORIGINAL SOURCE & DETAIL PAGE (FOR RE-OPENING / RETRYING)',
        '--------------------------------------------------------------------------------',
        `Original Media URL: ${task.parentMediaUrl || task.mediaUrl || 'N/A'}`,
        task.parentMediaUrl && task.mediaUrl && task.parentMediaUrl !== task.mediaUrl
          ? `Episode Stream URL: ${task.mediaUrl}`
          : null,
        task.link?.url ? `Direct Link / URI:  ${task.link.url}` : null,
        task.sourceInfoHash ? `Torrent InfoHash:   ${task.sourceInfoHash}` : null,
        '================================================================================',
      ]
        .filter(Boolean)
        .join('\n');

      fs.writeFileSync(txtPath, readableText, 'utf8');
      log.info('download_info_files_written', { jsonPath, txtPath, taskId: task.id });
    } catch (error) {
      console.warn('[downloads] Failed to write download info companion files:', describe(error));
    }
  }

  private static formatBytes(bytes: number): string {
    if (!bytes || bytes < 0) return '0 MB';
    const gb = bytes / 1e9;
    return gb >= 1 ? `${gb.toFixed(2)} GB` : `${Math.round(bytes / 1e6)} MB`;
  }

  /**
   * Classifies whether a download error is recoverable via smart source refresh.
   */
  private isRecoverableError(message: string): boolean {
    if (!message) return true;
    // Non-recoverable: User cancelled, bad target path, unsupported file, filesystem write error
    if (/cancelled|user cancel|invalid path|unsupported format|permission denied|no space/i.test(message)) {
      return false;
    }
    // Recoverable: expired token, 401, 403, 404, 410, connection reset, timeout, range header mismatch, 5xx
    return true;
  }

  /**
   * Intelligently matches a fresh direct source from provider against the download task's original metadata.
   * Prioritises Tier 1 (Provider + Quality + Size), Tier 2 (Provider + Size), Tier 3 (Quality + Size), Tier 4 (Best Fallback).
   */
  private findMatchingSource(
    task: DownloadTask,
    sources: TorrentResult[]
  ): TorrentResult | null {
    const context = {
      mediaUrl: task.mediaUrl,
      season: task.seasonNumber,
      episode: task.episodeNumber,
    };
    const directSources = sources.filter((s) => Boolean(s.directUrl));
    if (directSources.length === 0) return null;

    /**
     * Recovery is per download, so it must find *this* release again.
     *
     * The variant key is exactly the durable description of what was being
     * downloaded — provider, release name, resolution, language — and it
     * survives the re-signed URL that caused the failure in the first place.
     * Asking for it first means the 2160p task recovers the 2160p file even
     * when the 1080p one is listed above it and within the size tolerance.
     */
    const exact = task.variantKey
      ? directSources.find(
          (s) => downloadVariantKey(variantFromSource(s, context)) === task.variantKey
        )
      : undefined;
    if (exact) return exact;

    /**
     * Below this line the match is a guess, and the guard is what keeps it an
     * acceptable one: a different **resolution** is a different file, not a
     * mirror of the same one. Without it the last tiers would hand a 4K task a
     * 480p rip of similar size, write it to the folder labelled 2160p, and
     * report a successful download of something the viewer did not ask for.
     */
    const sameResolution = (s: TorrentResult): boolean => {
      const wanted = task.resolution;
      const got = s.parsed?.resolution;
      if (!wanted || !got) return true;
      return String(wanted) === String(got);
    };

    const isSizeCompatible = (s: TorrentResult): boolean => {
      if (!task.totalBytes || task.totalBytes <= 0 || !s.sizeBytes || s.sizeBytes <= 0) {
        return true; // Size unknown; do not penalise
      }
      // Size matches within 10% tolerance
      const diff = Math.abs(s.sizeBytes - task.totalBytes);
      return diff / task.totalBytes <= 0.10;
    };

    /**
     * Either name may be the one recorded. `providerName` is the extension's
     * provider and `indexerName` is the extractor it chose — a file host, which
     * changes between resolves of the same release — and the four call sites
     * that built these tasks did not previously agree on which to store.
     */
    const matchesProvider = (s: TorrentResult): boolean => {
      const wanted = (task.providerName ?? '').toLowerCase();
      if (!wanted) return false;
      return (
        s.indexerName?.toLowerCase() === wanted ||
        s.providerName?.toLowerCase() === wanted ||
        Boolean(s.title && s.title.toLowerCase().includes(wanted))
      );
    };

    // Tier 1: Exact match on providerName AND resolution AND size compatibility
    let best = directSources.find((s) => {
      const providerMatch = matchesProvider(s);
      const resStr = s.parsed?.resolution ? String(s.parsed.resolution) : '';
      const qualityMatch =
        (task.quality && (resStr === String(task.quality) || resStr === `${task.quality}p`)) ||
        (task.resolution && (resStr === String(task.resolution) || resStr === `${task.resolution}p`));
      return providerMatch && qualityMatch && isSizeCompatible(s);
    });
    if (best) return best;

    // Tier 2: Match on providerName AND size compatibility
    best = directSources.find((s) => {
      const providerMatch = matchesProvider(s);
      return providerMatch && sameResolution(s) && isSizeCompatible(s);
    });
    if (best) return best;

    // Tier 3: Match on quality / resolution AND size compatibility
    best = directSources.find((s) => {
      if (!sameResolution(s)) return false;
      const resStr = s.parsed?.resolution ? String(s.parsed.resolution) : '';
      const qualityMatch =
        (task.quality && (resStr === String(task.quality) || resStr === `${task.quality}p`)) ||
        (task.resolution && (resStr === String(task.resolution) || resStr === `${task.resolution}p`));
      return qualityMatch && isSizeCompatible(s);
    });
    if (best) return best;

    // Tier 4: Any direct source of the same resolution and compatible size
    best = directSources.find((s) => sameResolution(s) && isSizeCompatible(s));
    if (best) return best;

    /**
     * Last resort, and still resolution-bound. Returning `directSources[0]`
     * unconditionally — which is what this used to do — is how a recovery came
     * to substitute an unrelated release; a task that finds nothing of its own
     * resolution is better left Failed with its reason than silently rebound.
     */
    return directSources.find(sameResolution) ?? null;
  }

  /**
   * Whether the bytes already on disk survive the link being replaced.
   *
   * The identity half is cheap and local; the proof is one 64 KB ranged
   * request against the replacement URL, compared byte for byte with the tail
   * of the `.part` file. That single request also establishes whether the new
   * server honours `Range` at all and how long it says the file is, so a
   * resume across a re-signed CDN link costs one round trip rather than three.
   *
   * The decision itself lives in `download/resumePlan.ts` and is pure, because
   * both of its failure modes are silent: resuming when it should not have
   * produces a file that finalises, reports success and does not play, and
   * restarting when it should not have throws away hours of transfer while
   * looking exactly like a download that could never resume.
   */
  private async decideResume(
    task: DownloadTask,
    matched: TorrentResult
  ): Promise<{ action: 'resume' | 'complete' | 'restart'; reason: string }> {
    const partPath = `${task.targetFilePath}.part`;
    const partialBytes = (() => {
      try {
        return fs.statSync(partPath).size;
      } catch {
        return 0;
      }
    })();

    const identity = {
      /**
       * `providerName` is the extension provider, not `indexerName` — that is
       * the *extractor* the provider happened to pick ("Voe", "Server 3") and
       * it changes between resolves of one release, so comparing it would
       * reject nearly every legitimate resume.
       */
      sameProvider:
        !task.providerName ||
        !matched.providerName ||
        task.providerName === matched.providerName,
      /**
       * `parsed.resolution`, matching `findMatchingSource`'s own comparison.
       * A resolution the release name did not state is "no opinion" rather
       * than a mismatch — most direct provider links carry no release name at
       * all, and treating that as a difference would refuse every resume.
       */
      sameResolution:
        !task.resolution ||
        !matched.parsed?.resolution ||
        String(task.resolution) === String(matched.parsed.resolution),
      sameContainer: containersAgree(task.link?.url ?? '', matched.directUrl ?? ''),
    };

    /**
     * `verify` is a real answer from the pure planner — it means "everything
     * cheap agrees, now go and compare the bytes" — and this caller has already
     * done that by the time it asks. Reaching it here therefore means the
     * comparison could not be made: an unreadable part file, or a window the
     * server would not serve. That is not evidence of a match, so it restarts,
     * and it says so in its own words rather than borrowing the mismatch
     * message and telling the user the files differ when nobody knows.
     */
    const settle = (decision: ReturnType<typeof planResume>) =>
      decision.action === 'verify'
        ? {
            action: 'restart' as const,
            reason:
              'The replacement file could not be checked against what has already been ' +
              'downloaded, so the transfer starts again rather than risk a corrupt file.',
          }
        : { action: decision.action, reason: decision.reason };

    const window = overlapWindow(partialBytes);
    if (!window) {
      return settle(
        planResume({
          partialBytes,
          remoteSupportsRange: false,
          ...identity,
        })
      );
    }

    const local = readLocalWindow(partPath, window.start, window.end);
    const remote = await fetchRemoteWindow(
      matched.directUrl ?? '',
      { ...task.headers, ...matched.directHeaders },
      window.start,
      window.end
    );

    return settle(
      planResume({
      partialBytes,
      // The provider's declared size, which is what the task was created with.
      // Frequently absent, and `planResume` treats absent as "no opinion"
      // rather than as agreement.
      expectedTotalBytes: task.totalBytes > 0 ? task.totalBytes : undefined,
      remoteTotalBytes: remote.totalBytes,
      remoteSupportsRange: remote.satisfiedRange,
      /**
       * Left `undefined` when either side could not be read, which `settle`
       * turns into a restart. A failed read is not evidence of a match, and
       * defaulting it to `true` here would put the corruption back with a
       * safety check standing in front of it.
       */
      overlapVerified:
        local && remote.bytes ? local.equals(remote.bytes) : undefined,
      ...identity,
      })
    );
  }

  private async markFailed(task: DownloadTask, message: string): Promise<void> {
    this.handles.delete(task.id);

    const isDirectLink = task.link && task.link.url && !DownloadService.isMagnet(task.link.url);
    const maxRetries = 4;
    const currentRetries = task.retryCount || 0;

    const canRecover =
      Boolean(task.mediaUrl) &&
      this.contentService !== null &&
      isDirectLink &&
      currentRetries < maxRetries &&
      this.isRecoverableError(message);

    if (canRecover && this.contentService && task.mediaUrl) {
      const attemptNum = currentRetries + 1;
      task.retryCount = attemptNum;
      task.state = DownloadState.RefreshingSource;
      task.errorMessage = `Refreshing source from provider (attempt ${attemptNum}/${maxRetries})...`;
      this.saveQueueToStorage();

      try {
        const response = await this.contentService.getSources(
          {
            mediaUrl: task.mediaUrl,
            season: task.seasonNumber,
            episode: task.episodeNumber,
          },
          undefined,
          { bypassCache: true }
        );

        const matched = this.findMatchingSource(task, response.sources);
        if (matched && matched.directUrl) {
          // 1. Session & Engine Cleanup: Remove old aria2 GID mapping if present
          for (const [gid, taskId] of this.gidToTaskId.entries()) {
            if (taskId === task.id) {
              await this.aria2.remove(gid).catch(() => {});
              this.gidToTaskId.delete(gid);
            }
          }

          /**
           * 2. Decide whether the bytes already on disk survive the new link.
           *
           * Only `restart` needs acting on here. `resume` is the default —
           * every engine already continues from a `.part` file — and
           * `complete` (the partial is exactly the whole file) is carried by
           * machinery that already exists: the transfer asks for `bytes=N-`,
           * the server answers `416`, and `httpDownloader` finalises the part
           * rather than treating it as an error. aria2 routes its own range
           * errors to that same downloader. Adding a rename here would bypass
           * `finalizeCompletion`, which is the only thing that checks the file
           * is actually there and the right size before claiming success.
           */
          const resume = await this.decideResume(task, matched);
          if (resume.action === 'restart') {
            try {
              fs.rmSync(`${task.targetFilePath}.part`, { force: true });
            } catch {
              // A locked part file falls through: the downloader opens with
              // `w` when it is not resuming, which truncates it anyway.
            }
            task.bytesDownloaded = 0;
          }

          // 3. Update task link & headers
          task.link.url = matched.directUrl;
          if (matched.directHeaders) {
            task.headers = { ...task.headers, ...matched.directHeaders };
          }
          if (matched.sizeBytes) task.totalBytes = matched.sizeBytes;

          // 4. Update Source Cache so future requests reuse fresh valid link
          try {
            this.contentService
              .getCache()
              .write(task.mediaUrl, [matched], task.seasonNumber, task.episodeNumber);
          } catch {}

          task.state = DownloadState.Retrying;
          const downloadedMb = task.bytesDownloaded > 0 ? (task.bytesDownloaded / 1e6).toFixed(0) : '0';
          /**
           * The reason travels with the state, and that is the visible half of
           * this fix. A restart that says nothing is indistinguishable from the
           * download having failed and silently begun again — which is what
           * this path looked like when it discarded a partial on a 20% size
           * heuristic and reported "Retrying with fresh link".
           */
          task.errorMessage =
            task.bytesDownloaded > 0
              ? `Resuming from ${downloadedMb} MB — ${resume.reason} (attempt ${attemptNum}/${maxRetries})`
              : `${resume.reason} (attempt ${attemptNum}/${maxRetries})`;
          this.saveQueueToStorage();

          // 5. Exponential Backoff (1s, 2s, 4s, 8s)
          const delay = Math.min(1000 * Math.pow(2, currentRetries), 8000);
          setTimeout(() => {
            void this.startTask(task);
          }, delay);
          return;
        }
      } catch (err) {
        console.warn(`[download] Source refresh attempt ${attemptNum} failed:`, err);
      }
    }

    // Only after every refresh and retry has been exhausted. Counting the first
    // failed attempt would penalise a provider whose links simply expire
    // quickly but always regenerate.
    this.analytics?.observe({
      provider: task.providerName,
      stage: 'download',
      outcome: 'failure',
      latencyMs: Date.now() - task.createdTime,
      error: message,
    });
    task.state = DownloadState.Failed;
    task.errorMessage = message;
    task.downloadSpeed = 0;
    task.etaSeconds = 0;
    this.recordHistory(task, 'download_failed', 'Download Failed', message);
    this.saveQueueToStorage();
    this.pump();
  }

  // --- controls ------------------------------------------------------------

  public async pause(id: string): Promise<void> {
    const task = this.queue.get(id);
    if (!task) return;
    if (task.state === DownloadState.Completed || task.state === DownloadState.Failed) return;

    task.state = DownloadState.Paused;
    task.downloadSpeed = 0;
    task.etaSeconds = 0;

    const infoHash = this.torrentTasks.get(id);
    if (infoHash && this.torrentEngine) {
      await this.torrentEngine.pause(infoHash);
      this.saveQueueToStorage();
      this.pump();
      return;
    }

    for (const [gid, taskId] of this.gidToTaskId.entries()) {
      if (taskId === id) await this.aria2.pause(gid);
    }

    // The `.part` file stays on disk; resuming continues from it.
    this.handles.get(id)?.cancel();
    this.handles.delete(id);

    this.saveQueueToStorage();
    this.pump();
  }

  public async resume(id: string): Promise<void> {
    const task = this.queue.get(id);
    if (!task) return;
    if (task.state !== DownloadState.Paused && task.state !== DownloadState.Failed) return;

    // Reset retry count when manually retried by user to give a full retry budget
    if (task.state === DownloadState.Failed) {
      task.retryCount = 0;
    }

    // If it's a failed direct link download, auto-refresh source before restarting download
    const isDirectLink = task.link && task.link.url && !DownloadService.isMagnet(task.link.url);
    if (task.state === DownloadState.Failed && isDirectLink && task.mediaUrl && this.contentService) {
      void this.markFailed(task, 'Manual user retry requested');
      return;
    }

    const infoHash = this.torrentTasks.get(id);
    if (infoHash && this.torrentEngine) {
      task.state = DownloadState.Downloading;
      task.errorMessage = undefined;
      await this.torrentEngine.resume(infoHash);
      this.saveQueueToStorage();
      return;
    }

    // aria2 keeps the transfer in its own queue; unpausing continues it. The old
    // code re-dispatched the URI here, which started a second transfer from zero.
    for (const [gid, taskId] of this.gidToTaskId.entries()) {
      if (taskId === id) {
        try {
          await this.aria2.unpause(gid);
          task.state = DownloadState.Downloading;
          task.errorMessage = undefined;
          this.saveQueueToStorage();
          return;
        } catch {
          // aria2 forgot the gid (it was restarted); fall through to a fresh start.
          this.gidToTaskId.delete(gid);
        }
      }
    }

    task.state = DownloadState.Queued;
    task.errorMessage = undefined;
    this.saveQueueToStorage();
    this.pump();
  }

  /**
   * Removes a download from the list, and optionally the file it produced.
   *
   * Two genuinely different actions behind one word, which is why `deleteFile`
   * is a parameter rather than a guess. "Remove" on a finished film usually
   * means "tidy the list" — the file is the whole point and deleting it would be
   * unrecoverable — while "remove" on an abandoned one usually means "get rid of
   * it". Neither reading is safe to assume, so the caller decides and the UI asks
   * (see `downloads:deletePreference`).
   */
  public async remove(id: string, deleteFile = false): Promise<void> {
    const task = this.queue.get(id);
    if (!task) return;

    const infoHash = this.torrentTasks.get(id);
    if (infoHash && this.torrentEngine) {
      // Keep completed files unless the caller asked for them to go; a finished
      // download must survive removal from the queue by default.
      await this.torrentEngine.stopStream(
        infoHash,
        task.state === DownloadState.Completed && !deleteFile
      );
      this.torrentTasks.delete(id);
    }

    for (const [gid, taskId] of this.gidToTaskId.entries()) {
      if (taskId === id) {
        await this.aria2.remove(gid);
        this.gidToTaskId.delete(gid);
      }
    }

    this.handles.get(id)?.cancel();
    this.handles.delete(id);

    /**
     * The partial always goes: an abandoned `.part` is pure waste, and keeping
     * one for a completed download would leave a stale duplicate beside the
     * real file.
     */
    try {
      fs.rmSync(`${task.targetFilePath}.part`, { force: true });
    } catch {
      // A locked file just stays.
    }

    if (deleteFile) {
      /**
       * Failure to delete is reported by leaving the file, not by refusing to
       * remove the entry. A file held open by a player is the common case, and
       * trapping the download in the list because of it helps nobody — the entry
       * is what the user asked to be rid of.
       */
      try {
        fs.rmSync(task.targetFilePath, { force: true });
      } catch (error) {
        console.warn('[downloads] could not delete file for removed task:', describe(error));
      }
    }

    this.queue.delete(id);
    this.saveQueueToStorage();
    this.pump();
  }

  public getTasks(): DownloadTask[] {
    return Array.from(this.queue.values());
  }

  public stop(): void {
    if (this.pollInterval) clearInterval(this.pollInterval);
    for (const handle of this.handles.values()) handle.cancel();
    this.handles.clear();
    this.aria2.stop();
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
