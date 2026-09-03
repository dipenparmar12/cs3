import { execFile, spawn, type ChildProcess, type ExecException } from 'child_process';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import type { YtDlpInfo } from './ytdlpSources.ts';

/** How long one page resolve may take before it is abandoned. */
const RESOLVE_TIMEOUT_MS = 45_000;

/** What yt-dlp had to say about a page: its metadata, or why not. */
export type YtDlpResolution =
  | { ok: true; info: YtDlpInfo }
  | { ok: false; error: string };

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

  /**
   * Everything yt-dlp knows about one page, or why it does not know it.
   *
   * Three things about this replaced an implementation that had no caller and
   * two defects; the reasons are in `ytdlpSources.ts`, and the shape here is
   * what makes them fixable:
   *
   * **It answers with a reason rather than an empty array.** The old version
   * resolved `[]` on every failure and wrote a line to the console, so a missing
   * binary, an unsupported site, a geo-block and a page with no video were one
   * indistinguishable non-answer. `ContentService` cannot explain a source list
   * it was handed no explanation for, and "no sources found" is the sentence
   * this repository has spent the most effort refusing to ship.
   *
   * **It is bounded.** yt-dlp on a cold extractor makes real network calls, and
   * a site that hangs would otherwise hold a discovery open indefinitely.
   *
   * **`--no-playlist` is not tidiness.** Handed a series page or a channel URL,
   * yt-dlp will otherwise resolve every entry, which turns one press into
   * hundreds of extractions against somebody's site.
   */
  public async resolve(
    pageUrl: string,
    options: { timeoutMs?: number; signal?: AbortSignal } = {}
  ): Promise<YtDlpResolution> {
    if (!this.isAvailable()) {
      return {
        ok: false,
        error: 'yt-dlp is not installed. Settings → Components can fetch it.',
      };
    }

    return new Promise<YtDlpResolution>((resolve) => {
      execFile(
        this.binaryPath,
        [
          '--dump-single-json',
          '--no-playlist',
          '--no-warnings',
          '--no-call-home',
          '--no-progress',
          pageUrl,
        ],
        {
          maxBuffer: 32 * 1024 * 1024,
          timeout: options.timeoutMs ?? RESOLVE_TIMEOUT_MS,
          signal: options.signal,
        },
        (error, stdout, stderr) => {
          if (error) {
            return resolve({ ok: false, error: describeYtDlpFailure(error, stderr) });
          }
          try {
            return resolve({ ok: true, info: JSON.parse(stdout) as YtDlpInfo });
          } catch {
            // Valid JSON is the whole contract of `--dump-single-json`; if it is
            // not valid the binary is not the one we think it is.
            return resolve({ ok: false, error: 'yt-dlp returned output this build could not read.' });
          }
        }
      );
    });
  }
}

/**
 * yt-dlp's own words, where it has any.
 *
 * Its diagnosis is on stderr and is genuinely useful — "Unsupported URL",
 * "Video unavailable", "This video is private", a geo-block naming the country.
 * `execFile`'s Error carries only the exit code, so reporting that instead is
 * the same mistake `Main.describe` was fixed for on the JVM side: naming the
 * mechanism where the cause was one line away.
 */
function describeYtDlpFailure(error: ExecException, stderr: string): string {
  if (error.code === 'ABORT_ERR') return 'Cancelled.';
  if ((error as { killed?: boolean }).killed) {
    return `yt-dlp did not answer within ${Math.round(RESOLVE_TIMEOUT_MS / 1000)}s.`;
  }
  const reported = String(stderr ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('ERROR:'))
    .pop();
  if (reported) return reported.replace(/^ERROR:\s*/, '').replace(/^\[[^\]]+\]\s*[^:]*:\s*/, '');
  return error.message || 'yt-dlp could not read that page.';
}
