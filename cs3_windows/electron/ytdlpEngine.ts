import { execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import type { ExtractorLink } from '../src/types/api';

export class YtDlpEngine {
  private binaryPath: string;

  constructor() {
    const binaryName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
    this.binaryPath = path.join(process.cwd(), 'bin', binaryName);
  }

  public isAvailable(): boolean {
    return fs.existsSync(this.binaryPath);
  }

  public async extractLinks(targetUrl: string): Promise<ExtractorLink[]> {
    return new Promise((resolve) => {
      // If yt-dlp binary is not bundled locally, fallback gracefully
      const execBinary = this.isAvailable() ? this.binaryPath : 'yt-dlp';

      execFile(
        execBinary,
        ['--dump-json', '--no-warnings', '--no-call-home', targetUrl],
        { maxBuffer: 10 * 1024 * 1024 },
        (error, stdout) => {
          if (error) {
            console.warn('yt-dlp extraction skipped or failed:', error.message);
            return resolve([]); // Return empty list on error
          }

          try {
            const data = JSON.parse(stdout);
            const links: ExtractorLink[] = [];

            if (data.formats && Array.isArray(data.formats)) {
              for (const fmt of data.formats) {
                if (fmt.url && (fmt.vcodec !== 'none' || fmt.acodec !== 'none')) {
                  links.push({
                    source: 'yt-dlp Extractor',
                    name: fmt.format_note || fmt.format_id || 'yt-dlp stream',
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
                source: 'yt-dlp Extractor',
                name: data.format || 'Standard Stream',
                url: data.url,
                referer: data.webpage_url || targetUrl,
                quality: data.height || 720,
                headers: data.http_headers || {}
              });
            }

            resolve(links);
          } catch (e) {
            console.error('Failed to parse yt-dlp output:', e);
            resolve([]);
          }
        }
      );
    });
  }
}
