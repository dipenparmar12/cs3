import fs from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';
import type { IncomingMessage } from 'http';

/**
 * Built-in progressive HTTP(S) downloader.
 *
 * This is the fallback used whenever aria2c is not installed, which is the
 * default state of a fresh install — so it has to be a real downloader, not a
 * demo. The previous implementation lost data in four distinct ways, all of
 * which are addressed here:
 *
 *  - **Backpressure.** It called `fileStream.write()` per chunk and ignored the
 *    return value, so a fast link onto a slow disk buffered the whole file in
 *    memory. Piping applies the stream's own backpressure instead.
 *  - **Resume.** Pausing threw the partial file away and restarted from zero.
 *    Bytes already on disk are now continued with a `Range` request.
 *  - **Redirects.** Only 301/302 were followed, with no hop limit, so a
 *    redirect loop span forever and a 307/308 wrote an HTML error page as the
 *    "video".
 *  - **Atomicity.** The target path was written directly, leaving a truncated
 *    file that looks complete after a crash. Downloads land in `.part` and are
 *    renamed only once the transfer finishes.
 */

const MAX_REDIRECTS = 10;
const MAX_NETWORK_RETRIES = 4;
const RETRY_BASE_DELAY_MS = 1_000;

export interface HttpDownloadOptions {
  url: string;
  targetPath: string;
  headers?: Record<string, string>;
  referer?: string;
  onProgress: (downloaded: number, total: number, bytesPerSecond: number) => void;
  onComplete: (totalBytes: number) => void;
  onError: (message: string) => void;
}

export interface HttpDownloadHandle {
  /** Stops the transfer, leaving the `.part` file in place so it can resume. */
  cancel(): void;
}

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) CloudStreamDesktop/1.0';

function partPathFor(targetPath: string): string {
  return `${targetPath}.part`;
}

function existingBytes(partPath: string): number {
  try {
    return fs.statSync(partPath).size;
  } catch {
    return 0;
  }
}

export function startHttpDownload(options: HttpDownloadOptions): HttpDownloadHandle {
  const partPath = partPathFor(options.targetPath);
  let cancelled = false;
  let currentRequest: ReturnType<typeof http.get> | null = null;
  let currentStream: fs.WriteStream | null = null;
  let retries = 0;

  const abort = () => {
    currentRequest?.destroy();
    currentStream?.close();
    currentRequest = null;
    currentStream = null;
  };

  const failOrRetry = (message: string) => {
    if (cancelled) return;
    abort();

    if (retries >= MAX_NETWORK_RETRIES) {
      options.onError(message);
      return;
    }

    // Exponential backoff. Every retry resumes from what is already on disk, so
    // a flaky connection costs time rather than the whole transfer.
    const delay = RETRY_BASE_DELAY_MS * 2 ** retries;
    retries += 1;
    setTimeout(() => {
      if (!cancelled) attempt(options.url, 0);
    }, delay);
  };

  const attempt = (url: string, redirectCount: number) => {
    if (cancelled) return;

    if (redirectCount > MAX_REDIRECTS) {
      options.onError('Too many redirects — the source URL does not resolve to a file.');
      return;
    }

    const resumeFrom = existingBytes(partPath);
    const client = url.startsWith('https:') ? https : http;

    const headers: Record<string, string> = {
      'User-Agent': USER_AGENT,
      Accept: '*/*',
      ...(options.referer ? { Referer: options.referer } : {}),
      ...options.headers,
    };
    if (resumeFrom > 0) headers.Range = `bytes=${resumeFrom}-`;

    let request: ReturnType<typeof http.get>;
    try {
      request = client.get(url, { headers }, (response) => {
        handleResponse(url, redirectCount, resumeFrom, response);
      });
    } catch (error) {
      failOrRetry(error instanceof Error ? error.message : String(error));
      return;
    }

    currentRequest = request;
    request.on('error', (error) => failOrRetry(error.message || 'Network error'));
    // A server that accepts the connection but never answers would otherwise
    // hang the task forever with no speed and no error.
    request.setTimeout(60_000, () => failOrRetry('The server stopped responding.'));
  };

  const handleResponse = (
    url: string,
    redirectCount: number,
    resumeFrom: number,
    response: IncomingMessage
  ) => {
    const status = response.statusCode ?? 0;

    if ([301, 302, 303, 307, 308].includes(status)) {
      const location = response.headers.location;
      response.resume(); // Drain, or the socket is never released.
      if (!location) {
        options.onError(`Redirect ${status} without a location header.`);
        return;
      }
      attempt(new URL(location, url).toString(), redirectCount + 1);
      return;
    }

    if (status === 416) {
      // Range not satisfiable: the `.part` is already the whole file, or the
      // server changed underneath us. Treat a complete part as complete.
      response.resume();
      finalise(resumeFrom);
      return;
    }

    if (status < 200 || status >= 300) {
      response.resume();
      // 4xx is the server telling us this will never work; do not burn retries.
      if (status >= 400 && status < 500) {
        options.onError(`Server refused the download (HTTP ${status}).`);
      } else {
        failOrRetry(`Server returned HTTP ${status}.`);
      }
      return;
    }

    // A 200 in reply to a Range request means the server ignored it and is
    // sending the file from the start — the partial file must be discarded or
    // the result is a corrupt double-headed file.
    const isResumed = status === 206;
    const startAt = isResumed ? resumeFrom : 0;
    if (!isResumed && resumeFrom > 0) {
      try {
        fs.rmSync(partPath, { force: true });
      } catch {
        // Falls through to a truncating write below.
      }
    }

    const contentLength = parseInt(String(response.headers['content-length'] ?? '0'), 10) || 0;
    // With a 206 the length covers only the remaining range; the real total is
    // whatever we already have plus what is still coming.
    const total = contentLength > 0 ? startAt + contentLength : 0;

    fs.mkdirSync(path.dirname(partPath), { recursive: true });
    const fileStream = fs.createWriteStream(partPath, {
      flags: isResumed && startAt > 0 ? 'a' : 'w',
    });
    currentStream = fileStream;

    let downloaded = startAt;
    let windowStart = Date.now();
    let windowBytes = 0;

    response.on('data', (chunk: Buffer) => {
      downloaded += chunk.length;
      windowBytes += chunk.length;

      const elapsed = Date.now() - windowStart;
      if (elapsed >= 1_000) {
        options.onProgress(downloaded, total, Math.round((windowBytes * 1000) / elapsed));
        windowStart = Date.now();
        windowBytes = 0;
      }
    });

    // Piping (rather than manual writes) is what applies backpressure: the
    // socket is paused whenever the disk falls behind.
    response.pipe(fileStream);

    response.on('error', (error) => failOrRetry(error.message || 'Transfer interrupted'));
    fileStream.on('error', (error) => {
      abort();
      options.onError(`Could not write to disk: ${error.message}`);
    });

    fileStream.on('finish', () => {
      if (cancelled) return;
      // A truncated transfer arrives as a clean `finish` too; only a complete
      // file should be promoted off `.part`.
      if (total > 0 && downloaded < total) {
        failOrRetry('The connection closed before the file finished.');
        return;
      }
      // A successful transfer resets the retry budget for any later resume.
      retries = 0;
      finalise(downloaded);
    });
  };

  const finalise = (totalBytes: number) => {
    try {
      fs.mkdirSync(path.dirname(options.targetPath), { recursive: true });
      fs.renameSync(partPath, options.targetPath);
    } catch (error) {
      options.onError(
        `Downloaded but could not be moved into place: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return;
    }
    options.onComplete(totalBytes);
  };

  attempt(options.url, 0);

  return {
    cancel() {
      cancelled = true;
      abort();
    },
  };
}
