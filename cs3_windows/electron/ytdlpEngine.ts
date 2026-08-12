import { execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import type { ExtractorLink } from '../src/types/api';

export class YtDlpEngine {
  private binaryPath: string;

  constructor() {
    const binaryName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
    const appDir = app ? app.getPath('userData') : process.cwd();
    this.binaryPath = path.join(appDir, 'bin', binaryName);
  }

  public isAvailable(): boolean {
    return fs.existsSync(this.binaryPath);
  }

  public async searchAndExtract(query: string): Promise<ExtractorLink[]> {
    const target = query.startsWith('http://') || query.startsWith('https://')
      ? query
      : `ytsearch1:${query} official trailer OR full feature`;
    return this.extractLinks(target);
  }

  public async extractLinks(targetUrl: string): Promise<ExtractorLink[]> {
    return new Promise((resolve) => {
      const execBinary = this.isAvailable() ? this.binaryPath : 'yt-dlp';

      execFile(
        execBinary,
        ['--dump-json', '--no-warnings', '--no-call-home', '--format', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best', targetUrl],
        { maxBuffer: 15 * 1024 * 1024 },
        (error, stdout) => {
          if (error) {
            console.warn('yt-dlp extraction skipped or binary not initialized:', error.message);
            return resolve([]);
          }

          try {
            const data = JSON.parse(stdout);
            const links: ExtractorLink[] = [];

            if (data.formats && Array.isArray(data.formats)) {
              for (const fmt of data.formats) {
                if (fmt.url && (fmt.vcodec !== 'none' || fmt.acodec !== 'none')) {
                  links.push({
                    source: `yt-dlp Extractor (${data.extractor || 'Web Stream'})`,
                    name: `${data.title || 'Live Stream'} - ${fmt.format_note || fmt.height + 'p' || 'HD'}`,
                    url: fmt.url,
                    referer: data.webpage_url || targetUrl,
                    quality: fmt.height || 720,
                    isM3u8: fmt.url.includes('.m3u8') || fmt.protocol === 'm3u8',
                    isDash: fmt.url.includes('.mpd') || fmt.protocol === 'http_dash_segments',
                    headers: fmt.http_headers || data.http_headers || {}
                  });
                }
              }
            } else if (data.url) {
              links.push({
                source: `yt-dlp Extractor (${data.extractor || 'Web Stream'})`,
                name: `${data.title || 'Live Stream'} (${data.height || 720}p)`,
                url: data.url,
                referer: data.webpage_url || targetUrl,
                quality: data.height || 720,
                headers: data.http_headers || {}
              });
            }

            // Return top 4 distinct quality streams sorted by height
            links.sort((a, b) => b.quality - a.quality);
            resolve(links.slice(0, 4));
          } catch (e) {
            console.error('Failed to parse yt-dlp output:', e);
            resolve([]);
          }
        }
      );
    });
  }
}
