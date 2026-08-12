import fs from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';
import type { DownloadTask } from '../src/types/download';
import { DownloadState } from '../src/types/download';
import type { DatastoreManager } from './datastore';
import type { Aria2Engine } from './aria2Engine';
import { MediaDownloadResolver } from './mediaDownloadResolver';
import type { TorrentEngine } from './torrent/torrentEngine';

export class DownloadService {
  private datastore: DatastoreManager;
  private aria2: Aria2Engine;
  private resolver: MediaDownloadResolver;
  private torrentEngine: TorrentEngine | null = null;
  private queue: Map<string, DownloadTask> = new Map();
  private gidToTaskId: Map<string, string> = new Map();
  /** taskId → infoHash, for downloads served by the torrent engine. */
  private torrentTasks: Map<string, string> = new Map();
  private activeFallbackStreams: Map<string, { req: any; fileStream: fs.WriteStream }> = new Map();
  private pollInterval: NodeJS.Timeout | null = null;
  private onProgressCallback?: (tasks: DownloadTask[]) => void;

  constructor(datastore: DatastoreManager, aria2: Aria2Engine) {
    this.datastore = datastore;
    this.aria2 = aria2;
    this.resolver = new MediaDownloadResolver(aria2);
    this.loadQueueFromStorage();
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

  private loadQueueFromStorage(): void {
    const saved = this.datastore.getObject<DownloadTask[]>('download_queue_list', []);
    if (saved && Array.isArray(saved)) {
      for (const task of saved) {
        if (task.state === DownloadState.Downloading) {
          task.state = DownloadState.Queued;
        }
        this.queue.set(task.id, task);
      }
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
    if (!this.aria2.isRunning()) return;

    for (const [gid, taskId] of this.gidToTaskId.entries()) {
      try {
        const status = await this.aria2.getStatus(gid);
        const task = this.queue.get(taskId);
        if (task) {
          task.bytesDownloaded = status.completedLength;
          task.totalBytes = status.totalLength;
          task.downloadSpeed = status.downloadSpeed;

          if (status.downloadSpeed > 0 && status.totalLength > status.completedLength) {
            task.etaSeconds = Math.ceil((status.totalLength - status.completedLength) / status.downloadSpeed);
          } else {
            task.etaSeconds = 0;
          }

          if (status.status === 'completed') {
            task.state = DownloadState.Completed;
            this.gidToTaskId.delete(gid);
          } else if (status.status === 'error') {
            task.state = DownloadState.Failed;
            task.errorMessage = status.errorMessage || 'aria2 transfer error';
            this.gidToTaskId.delete(gid);
          }

          this.saveQueueToStorage();
        }
      } catch (e) {
        // Silently handle status polling
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
      } else {
        task.state = stats.isPaused ? DownloadState.Paused : DownloadState.Downloading;
      }
      changed = true;
    }

    if (changed) this.saveQueueToStorage();
  }

  public async enqueue(task: DownloadTask): Promise<string> {
    task.state = DownloadState.Downloading;
    task.createdTime = Date.now();

    if (!task.targetFilePath) {
      task.targetFilePath = this.resolver.generateTargetFilePath(task);
    }

    const outputDir = path.dirname(task.targetFilePath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Torrent sources go to the streaming engine, which already holds any
    // pieces fetched while the user was watching.
    if (DownloadService.isMagnet(task.link.url) && this.torrentEngine) {
      try {
        this.torrentEngine.setDownloadPath(outputDir);
        const handle = await this.torrentEngine.startStream({
          torrentId: task.link.url,
          season: task.seasonNumber,
          episode: task.episodeNumber,
        });
        this.torrentTasks.set(task.id, handle.infoHash);
        task.totalBytes = handle.fileSize;
        task.targetFilePath = path.join(outputDir, handle.fileName);
        this.queue.set(task.id, task);
        this.saveQueueToStorage();
        return task.id;
      } catch (error) {
        task.state = DownloadState.Failed;
        task.errorMessage = error instanceof Error ? error.message : String(error);
        this.queue.set(task.id, task);
        this.saveQueueToStorage();
        return task.id;
      }
    }

    // HLS playlists cannot be fetched as a single file: aria2 would save the
    // .m3u8 text itself. Fail loudly rather than writing a 2 KB "video".
    if (/\.m3u8(\?|$)/i.test(task.link.url) || task.link.isM3u8) {
      task.state = DownloadState.Failed;
      task.errorMessage =
        'HLS streams need segment muxing, which this build cannot do yet. Install yt-dlp from Settings and download via the source URL instead.';
      this.queue.set(task.id, task);
      this.saveQueueToStorage();
      return task.id;
    }

    // Attempt high-speed aria2 dispatch if binary is running
    if (this.aria2.isRunning()) {
      try {
        const gid = await this.resolver.dispatchDownload(task);
        this.gidToTaskId.set(gid, task.id);
        this.queue.set(task.id, task);
        this.saveQueueToStorage();
        return task.id;
      } catch (e) {
        console.warn('aria2 dispatch failed, falling back to Native HTTP Downloader');
      }
    }

    // Built-in Native HTTP Stream Fallback
    this.startNativeHttpDownload(task);
    this.queue.set(task.id, task);
    this.saveQueueToStorage();
    return task.id;
  }

  private startNativeHttpDownload(task: DownloadTask): void {
    const url = task.link.url;
    const requestClient = url.startsWith('https') ? https : http;
    const fileStream = fs.createWriteStream(task.targetFilePath);

    let startTime = Date.now();
    let lastBytes = 0;

    const req = requestClient.get(
      url,
      { headers: task.headers || { 'User-Agent': 'CloudStreamDesktop/1.0', Referer: task.link.referer || '' } },
      (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          if (res.headers.location) {
            task.link.url = res.headers.location;
            fileStream.close();
            this.startNativeHttpDownload(task);
            return;
          }
        }

        task.totalBytes = parseInt(res.headers['content-length'] || '0', 10) || 50 * 1024 * 1024;
        let downloaded = 0;

        res.on('data', (chunk) => {
          downloaded += chunk.length;
          fileStream.write(chunk);
          task.bytesDownloaded = downloaded;

          const now = Date.now();
          const elapsedSec = (now - startTime) / 1000;
          if (elapsedSec >= 1) {
            task.downloadSpeed = Math.floor((downloaded - lastBytes) / elapsedSec);
            lastBytes = downloaded;
            startTime = now;
            if (task.totalBytes > downloaded && task.downloadSpeed > 0) {
              task.etaSeconds = Math.ceil((task.totalBytes - downloaded) / task.downloadSpeed);
            }
            this.saveQueueToStorage();
          }
        });

        res.on('end', () => {
          fileStream.end();
          task.state = DownloadState.Completed;
          task.bytesDownloaded = task.totalBytes || downloaded;
          task.downloadSpeed = 0;
          task.etaSeconds = 0;
          this.activeFallbackStreams.delete(task.id);
          this.saveQueueToStorage();
        });
      }
    );

    req.on('error', (err) => {
      fileStream.close();
      task.state = DownloadState.Failed;
      task.errorMessage = err.message || 'Stream download error';
      this.activeFallbackStreams.delete(task.id);
      this.saveQueueToStorage();
    });

    this.activeFallbackStreams.set(task.id, { req, fileStream });
  }

  public async pause(id: string): Promise<void> {
    const task = this.queue.get(id);
    if (!task) return;

    task.state = DownloadState.Paused;

    const infoHash = this.torrentTasks.get(id);
    if (infoHash && this.torrentEngine) {
      await this.torrentEngine.pause(infoHash);
      this.saveQueueToStorage();
      return;
    }

    for (const [gid, tId] of this.gidToTaskId.entries()) {
      if (tId === id) {
        await this.aria2.pause(gid);
      }
    }

    const fallback = this.activeFallbackStreams.get(id);
    if (fallback) {
      fallback.req.destroy();
      fallback.fileStream.close();
      this.activeFallbackStreams.delete(id);
    }

    this.saveQueueToStorage();
  }

  public async resume(id: string): Promise<void> {
    const task = this.queue.get(id);
    if (!task) return;

    if (task.state !== DownloadState.Paused) return;

    const infoHash = this.torrentTasks.get(id);
    if (infoHash && this.torrentEngine) {
      task.state = DownloadState.Downloading;
      await this.torrentEngine.resume(infoHash);
      this.saveQueueToStorage();
      return;
    }

    task.state = DownloadState.Downloading;
    await this.enqueue(task);
    this.saveQueueToStorage();
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

    for (const [gid, tId] of this.gidToTaskId.entries()) {
      if (tId === id) {
        await this.aria2.remove(gid);
        this.gidToTaskId.delete(gid);
      }
    }

    const fallback = this.activeFallbackStreams.get(id);
    if (fallback) {
      fallback.req.destroy();
      fallback.fileStream.close();
      this.activeFallbackStreams.delete(id);
    }

    this.queue.delete(id);
    this.saveQueueToStorage();
  }

  public getTasks(): DownloadTask[] {
    return Array.from(this.queue.values());
  }

  public stop(): void {
    if (this.pollInterval) clearInterval(this.pollInterval);
    for (const [, stream] of this.activeFallbackStreams) {
      stream.req.destroy();
      stream.fileStream.close();
    }
    this.aria2.stop();
  }
}
