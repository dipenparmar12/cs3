import fs from 'fs';
import path from 'path';
import type { DownloadTask } from '../src/types/download';
import { DownloadState } from '../src/types/download';
import type { DatastoreManager } from './datastore';
import type { Aria2Engine } from './aria2Engine';
import { MediaDownloadResolver } from './mediaDownloadResolver';
import { YtDlpEngine } from './ytdlpEngine';
import { startHttpDownload } from './httpDownloader';
import type { TorrentEngine } from './torrent/torrentEngine';
import type { ContentService } from './contentService';
import type { AnalyticsSink } from './pluginManager';
import type { TorrentResult } from '../src/types/torrent';
import type { HistoryStore } from './cs3/historyStore';
import type { HistoryAction, HistoryStatus } from '../src/types/history';

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
        title: task.title,
        mediaUrl: task.mediaUrl || task.link.url,
        posterUrl: task.posterUrl,
        season: task.seasonNumber,
        episode: task.episodeNumber,
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

        if (status.status === 'completed') {
          task.state = DownloadState.Completed;
          task.downloadSpeed = 0;
          task.etaSeconds = 0;
          this.gidToTaskId.delete(gid);
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
        task.state = DownloadState.Completed;
        task.downloadSpeed = 0;
        task.etaSeconds = 0;
        this.torrentTasks.delete(taskId);
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

  public async enqueue(task: DownloadTask): Promise<string> {
    task.state = DownloadState.Queued;
    task.createdTime = task.createdTime || Date.now();
    task.errorMessage = undefined;

    if (!task.targetFilePath) {
      task.targetFilePath = this.resolver.generateTargetFilePath(task);
    }

    this.recordHistory(task, 'download_started', 'Attempted');
    this.queue.set(task.id, task);
    this.saveQueueToStorage();
    this.pump();
    return task.id;
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
      });
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

  private markCompleted(task: DownloadTask, totalBytes: number): void {
    this.handles.delete(task.id);
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
    task.totalBytes = totalBytes || task.totalBytes;
    task.bytesDownloaded = task.totalBytes;
    task.downloadSpeed = 0;
    task.etaSeconds = 0;
    task.errorMessage = undefined;
    this.recordHistory(task, 'download_completed', 'Downloaded');
    this.saveQueueToStorage();
    this.pump();
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
    const directSources = sources.filter((s) => Boolean(s.directUrl));
    if (directSources.length === 0) return null;

    const isSizeCompatible = (s: TorrentResult): boolean => {
      if (!task.totalBytes || task.totalBytes <= 0 || !s.sizeBytes || s.sizeBytes <= 0) {
        return true; // Size unknown; do not penalise
      }
      // Size matches within 10% tolerance
      const diff = Math.abs(s.sizeBytes - task.totalBytes);
      return diff / task.totalBytes <= 0.10;
    };

    // Tier 1: Exact match on providerName AND resolution AND size compatibility
    let best = directSources.find((s) => {
      const providerMatch =
        s.indexerName === task.providerName ||
        (s.title && s.title.toLowerCase().includes(task.providerName.toLowerCase()));
      const resStr = s.parsed?.resolution ? String(s.parsed.resolution) : '';
      const qualityMatch =
        (task.quality && (resStr === String(task.quality) || resStr === `${task.quality}p`)) ||
        (task.resolution && (resStr === String(task.resolution) || resStr === `${task.resolution}p`));
      return providerMatch && qualityMatch && isSizeCompatible(s);
    });
    if (best) return best;

    // Tier 2: Match on providerName AND size compatibility
    best = directSources.find((s) => {
      const providerMatch =
        s.indexerName === task.providerName ||
        (s.title && s.title.toLowerCase().includes(task.providerName.toLowerCase()));
      return providerMatch && isSizeCompatible(s);
    });
    if (best) return best;

    // Tier 3: Match on quality / resolution AND size compatibility
    best = directSources.find((s) => {
      const resStr = s.parsed?.resolution ? String(s.parsed.resolution) : '';
      const qualityMatch =
        (task.quality && (resStr === String(task.quality) || resStr === `${task.quality}p`)) ||
        (task.resolution && (resStr === String(task.resolution) || resStr === `${task.resolution}p`));
      return qualityMatch && isSizeCompatible(s);
    });
    if (best) return best;

    // Tier 4: Any direct source matching size compatibility
    best = directSources.find(isSizeCompatible);
    if (best) return best;

    // Fallback: Top direct source
    return directSources[0];
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

          // 2. Data Integrity Check: If size changed dramatically (>20%), truncate partial file to avoid corruption
          if (
            task.bytesDownloaded > 0 &&
            matched.sizeBytes &&
            matched.sizeBytes > 0 &&
            task.totalBytes > 0
          ) {
            const sizeDiff = Math.abs(matched.sizeBytes - task.totalBytes);
            if (sizeDiff / task.totalBytes > 0.2) {
              console.warn(
                `[download] Refreshed source size (${matched.sizeBytes}) differs from original (${task.totalBytes}); restarting partial file`
              );
              try {
                fs.rmSync(`${task.targetFilePath}.part`, { force: true });
              } catch {}
              task.bytesDownloaded = 0;
            }
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
          task.errorMessage = task.bytesDownloaded > 0
            ? `Resuming download from ${downloadedMb} MB (attempt ${attemptNum}/${maxRetries})...`
            : `Retrying download with fresh link (attempt ${attemptNum}/${maxRetries})...`;
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

  public async remove(id: string): Promise<void> {
    const task = this.queue.get(id);
    if (!task) return;

    const infoHash = this.torrentTasks.get(id);
    if (infoHash && this.torrentEngine) {
      // Keep completed files; a finished download must survive removal from the queue.
      await this.torrentEngine.stopStream(infoHash, task.state === DownloadState.Completed);
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

    // An abandoned partial file is pure waste; a completed one is the deliverable.
    if (task.state !== DownloadState.Completed) {
      try {
        fs.rmSync(`${task.targetFilePath}.part`, { force: true });
      } catch {
        // A locked file just stays.
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
