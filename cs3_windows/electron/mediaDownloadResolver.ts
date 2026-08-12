import path from 'path';
import os from 'os';
import { DownloadTask, DownloadState } from '../src/types/download';
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

  public generateTargetFilePath(task: Partial<DownloadTask>, customBaseDir?: string): string {
    const base = customBaseDir || this.defaultDownloadDir;
    const category = task.title ? 'Shows' : 'Downloads';
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
    
    fileName += '.mp4';
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
