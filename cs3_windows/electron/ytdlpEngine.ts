import { execFile, spawn, type ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import type { ExtractorLink } from '../src/types/api';

/** Progress line emitted by `yt-dlp --newline`, e.g. `[download]  42.1% of ~1.20GiB at 3.21MiB/s ETA 00:42`. */
const PROGRESS_RE =
  /\[download\]\s+([\d.]+)%\s+of\s+~?\s*([\d.]+)(KiB|MiB|GiB|TiB|B)(?:\s+at\s+([\d.]+)(KiB|MiB|GiB|B)\/s)?/i;

const UNIT_BYTES: Record<string, number> = {
  b: 1,
  kib: 1024,
  mib: 1024 ** 2,
  gib: 1024 ** 3,
  tib: 1024 ** 4,
};

function toBytes(amount: string, unit: string): number {
  const value = parseFloat(amount);
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * (UNIT_BYTES[unit.toLowerCase()] ?? 1));
}

export interface YtDlpDownloadOptions {
  url: string;
  targetPath: string;
  headers?: Record<string, string>;
  referer?: string;
  onProgress: (downloaded: number, total: number, bytesPerSecond: number) => void;
  onComplete: (totalBytes: number) => void;
  onError: (message: string) => void;
}

export interface YtDlpDownloadHandle {
  cancel(): void;
}

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

  /**
   * Downloads a segmented stream (HLS/DASH) to a single file.
   *
   * Segmented streams are the one shape neither aria2 nor a plain HTTP GET can
   * handle: fetching an `.m3u8` yields a few kilobytes of playlist text, which
   * is exactly what used to land on disk labelled as a video. yt-dlp walks the
   * playlist and concatenates the segments, which is why it — rather than a
   * hand-rolled muxer — is the right tool here.
   *
   * `-f` deliberately prefers a single pre-muxed format: merging separate video
   * and audio streams requires ffmpeg, which this app does not ship.
   */
  public download(options: YtDlpDownloadOptions): YtDlpDownloadHandle {
    const binary = this.isAvailable() ? this.binaryPath : 'yt-dlp';
    fs.mkdirSync(path.dirname(options.targetPath), { recursive: true });

    const args = [
      '--newline',
      '--no-warnings',
      '--no-call-home',
      '--no-playlist',
      // Resume a partially fetched file rather than starting over.
      '--continue',
      '--retries', '10',
      '--fragment-retries', '10',
      '--concurrent-fragments', '8',
      // Single muxed stream — no ffmpeg merge step required.
      '-f', 'best[ext=mp4]/best',
      '-o', options.targetPath,
    ];

    if (options.referer) args.push('--referer', options.referer);
    for (const [key, value] of Object.entries(options.headers ?? {})) {
      if (key.toLowerCase() === 'referer') continue;
      args.push('--add-header', `${key}:${value}`);
    }
    args.push(options.url);

    let child: ChildProcess;
    try {
      child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      options.onError(
        `Could not start yt-dlp: ${error instanceof Error ? error.message : String(error)}`
      );
      return { cancel: () => undefined };
    }

    let cancelled = false;
    let lastTotal = 0;
    let lastDownloaded = 0;
    let stderrTail = '';

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      for (const line of chunk.split(/\r?\n/)) {
        const match = PROGRESS_RE.exec(line);
        if (!match) continue;

        const percent = parseFloat(match[1]);
        const total = toBytes(match[2], match[3]);
        const speed = match[4] ? toBytes(match[4], match[5]) : 0;
        if (!Number.isFinite(percent) || total <= 0) continue;

        lastTotal = total;
        lastDownloaded = Math.round((percent / 100) * total);
        options.onProgress(lastDownloaded, total, speed);
      }
    });

    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      // Keep only the tail; a failing extractor can emit a lot of text.
      stderrTail = `${stderrTail}${chunk}`.slice(-2000);
    });

    child.on('error', (error) => {
      if (cancelled) return;
      options.onError(
        error.message.includes('ENOENT')
          ? 'yt-dlp is not installed. Install it from Settings → Binaries to download streaming sources.'
          : error.message
      );
    });

    child.on('close', (code) => {
      if (cancelled) return;
      if (code === 0) {
        options.onComplete(lastTotal || lastDownloaded);
        return;
      }
      const reason = stderrTail
        .split(/\r?\n/)
        .reverse()
        .find((line) => line.trim().startsWith('ERROR:'));
      options.onError(reason?.replace(/^ERROR:\s*/, '') || `yt-dlp exited with code ${code}.`);
    });

    return {
      cancel() {
        cancelled = true;
        child.kill();
      },
    };
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
