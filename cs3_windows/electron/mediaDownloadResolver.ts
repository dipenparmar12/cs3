import path from 'path';
import os from 'os';
import type { DownloadTask } from '../src/types/download';
import { Aria2Engine } from './aria2Engine';

export class MediaDownloadResolver {
  private aria2: Aria2Engine;
  private defaultDownloadDir: string;

  constructor(aria2: Aria2Engine) {
    this.aria2 = aria2;
    this.defaultDownloadDir = path.join(os.homedir(), 'Downloads', 'CloudStream');
  }

  public getDefaultDirectory(): string {
    return this.defaultDownloadDir;
  }

  public sanitizeFilename(name: string): string {
    // Windows/Cross-platform sanitization
    return name
      .replace(/[<>:"/\\|?*]/g, '_')
      .replace(/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i, '_$1_')
      .trim();
  }

  /**
   * Picks the container extension from the source URL.
   *
   * Hard-coding `.mp4` mislabels every MKV the app downloads, which then fails
   * to open in players that trust the extension. Segmented sources are the one
   * genuine exception: yt-dlp remuxes them, and the result really is an MP4.
   */
  private extensionFor(task: Partial<DownloadTask>): string {
    const url = task.link?.url ?? '';
    if (task.link?.isM3u8 || task.link?.isDash || /\.(m3u8|mpd)(\?|$)/i.test(url)) {
      return '.mp4';
    }

    // A torrent's real filename is only known once metadata arrives; the engine
    // overwrites this path at that point.
    if (url.startsWith('magnet:') || /^[a-f0-9]{40}$/i.test(url)) return '.mp4';

    const match = url
      .split('?')[0]
      .match(/\.(mp4|mkv|avi|mov|m4v|webm|ts|m2ts|flv|wmv|mpg|mpeg)$/i);
    return match ? `.${match[1].toLowerCase()}` : '.mp4';
  }

  public generateTargetFilePath(task: Partial<DownloadTask>, customBaseDir?: string): string {
    const base = customBaseDir || this.defaultDownloadDir;
    // Episodes belong in a series folder; a film is a single file, not a show.
    const isEpisode = task.episodeNumber !== undefined || task.seasonNumber !== undefined;
    const category = isEpisode ? 'Shows' : 'Movies';
    const folderName = this.sanitizeFilename(task.title || 'Media');

    let fileName = `${folderName}`;
    if (task.seasonNumber !== undefined && task.episodeNumber !== undefined) {
      const s = String(task.seasonNumber).padStart(2, '0');
      const e = String(task.episodeNumber).padStart(2, '0');
      fileName += `_S${s}E${e}`;
    } else if (task.episodeNumber !== undefined) {
      const e = String(task.episodeNumber).padStart(2, '0');
      fileName += `_E${e}`;
    }

    fileName += this.extensionFor(task);
    return path.join(base, category, folderName, fileName);
  }

  public async dispatchDownload(task: DownloadTask): Promise<string> {
    const targetPath = task.targetFilePath || this.generateTargetFilePath(task);
    const outputDir = path.dirname(targetPath);
    const fileName = path.basename(targetPath);

    // Route progressive / magnet links to aria2
    return await this.aria2.addUri(
      task.link.url,
      outputDir,
      fileName,
      task.headers
    );
  }
}
