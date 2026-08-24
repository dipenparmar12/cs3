import path from 'path';
import os from 'os';
import type { DownloadTask } from '../src/types/download';
import { Aria2Engine } from './aria2Engine';
import { variantPathSegment } from '../src/utils/downloadIdentity.ts';

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
    const clean = url.split(/[?#]/)[0].toLowerCase();
    if (
      task.link?.isM3u8 ||
      task.link?.isDash ||
      clean.endsWith('.m3u8') ||
      clean.endsWith('.m3u') ||
      clean.endsWith('.mpd') ||
      /\/(getm3u8|m3u8|hls|dash|mpd)\b/i.test(clean) ||
      /[?&]format=(m3u8|hls|dash)/i.test(url)
    ) {
      return '.mp4';
    }

    // A torrent's real filename is only known once metadata arrives; the engine
    // overwrites this path at that point.
    if (url.startsWith('magnet:') || /^[a-f0-9]{40}$/i.test(url)) return '.mp4';

    const match = clean.match(/\.(mp4|mkv|avi|mov|m4v|webm|ts|m2ts|flv|wmv|mpg|mpeg)$/i);
    return match ? `.${match[1].toLowerCase()}` : '.mp4';
  }

  /**
   * Where a download writes, including which variant of the title it is.
   *
   * The variant folder is the other half of the duplicate fix. Without it the
   * 2160p and the 1080p release of one film both resolve to
   * `Movies/The Incredible Hulk/The Incredible Hulk.mp4` — so allowing two
   * downloads to coexist in the queue would merely have moved the collision
   * onto the disk, where two engines write interleaved bytes into one file and
   * both "succeed". A corrupt file that finishes is worse than a refusal.
   *
   * Absent for a task with nothing to distinguish (no provider, no resolution),
   * which keeps the layout unchanged for the ordinary single-source case.
   */
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

    const variant = this.variantFolder(task);
    return variant
      ? path.join(base, category, folderName, variant, fileName)
      : path.join(base, category, folderName, fileName);
  }

  /** `2160p WEB-DL Gdshine`, or nothing when the task describes no variant. */
  private variantFolder(task: Partial<DownloadTask>): string {
    return variantPathSegment({
      providerName: task.providerName,
      resolution: task.resolution,
      quality: task.quality,
      languages: task.languages,
    });
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
