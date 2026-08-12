import fs from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';
import { DownloadTask, DownloadState } from '../src/types/download';
import { DatastoreManager } from './datastore';
import { Aria2Engine } from './aria2Engine';
import { MediaDownloadResolver } from './mediaDownloadResolver';

export class DownloadService {
  private datastore: DatastoreManager;
  private aria2: Aria2Engine;
  private resolver: MediaDownloadResolver;
  private queue: Map<string, DownloadTask> = new Map();
  private gidToTaskId: Map<string, string> = new Map();
  private activeFallbackStreams: Map<string, { req: any; fileStream: fs.WriteStream }> = new Map();
  private pollInterval: NodeJS.Timeout | null = null;
  private onProgressCallback?: (tasks: DownloadTask[]) => void;

  constructor(datastore: DatastoreManager, aria2: Aria2Engine) {
    this.datastore = datastore;
    this.aria2 = aria2;
    this.resolver = new MediaDownloadResolver(aria2);
    this.loadQueueFromStorage();
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

    if (task.state === DownloadState.Paused) {
      task.state = DownloadState.Downloading;
      await this.enqueue(task);
    }
    this.saveQueueToStorage();
  }

  public async remove(id: string): Promise<void> {
    const task = this.queue.get(id);
    if (!task) return;

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
