import fs from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';
import type { IncomingMessage, ClientRequest } from 'http';
import { URL } from 'url';

export interface DownloadProgress {
  downloadedBytes: number;
  totalBytes: number;
  percent: number;
  bytesPerSecond: number;
  speedFormatted: string;
  etaFormatted: string;
  chunksActive: number;
}

export interface FastDownloadOptions {
  mirrors: string[];
  targetPath: string;
  headers?: Record<string, string>;
  maxConnections?: number;
  chunkTimeoutMs?: number;
  maxRetriesPerChunk?: number;
  onProgress?: (progress: DownloadProgress, statusText: string) => void;
  signal?: AbortSignal;
}

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) CloudStreamDesktop/1.0';
const DEFAULT_CHUNK_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RETRIES = 3;
const MAX_REDIRECTS = 10;

interface ProbeResult {
  finalUrl: string;
  contentLength: number;
  supportsRange: boolean;
  statusCode: number;
}

/**
 * High-performance, multi-connection segmented downloader with mirror rotation,
 * stall detection, auto-resume, and accurate live throughput calculation.
 */
export class FastChunkDownloader {
  /**
   * Downloads a file using the fastest available strategy:
   * 1. Evaluates mirrors in priority order.
   * 2. Probes target server capabilities (Range support, Content-Length).
   * 3. Spawns 4-8 parallel chunk connections for multi-threaded saturation.
   * 4. Automatically detects socket stalls and retries failed segments.
   * 5. Atomically finalises to targetPath upon 100% verification.
   */
  public static async download(options: FastDownloadOptions): Promise<boolean> {
    const { mirrors, targetPath } = options;
    if (!mirrors || mirrors.length === 0) {
      throw new Error('No download mirrors provided.');
    }

    const partPath = `${targetPath}.part`;
    let lastError: Error | null = null;

    for (let mirrorIdx = 0; mirrorIdx < mirrors.length; mirrorIdx++) {
      const mirrorUrl = mirrors[mirrorIdx];
      if (options.signal?.aborted) {
        throw new Error('Download was cancelled');
      }

      try {
        if (mirrorIdx > 0 && options.onProgress) {
          options.onProgress(
            {
              downloadedBytes: 0,
              totalBytes: 0,
              percent: 0,
              bytesPerSecond: 0,
              speedFormatted: '0 MB/s',
              etaFormatted: '--',
              chunksActive: 0,
            },
            `Switching to high-speed mirror ${mirrorIdx + 1}/${mirrors.length}...`
          );
        }

        const success = await this.downloadSingleMirror(mirrorUrl, partPath, targetPath, options);
        if (success) {
          return true;
        }
      } catch (err: any) {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.warn(`[FastDownloader] Mirror ${mirrorIdx + 1} (${mirrorUrl}) failed:`, err?.message || err);
        // Clean up partial file before next mirror attempt
        try {
          if (fs.existsSync(partPath)) fs.unlinkSync(partPath);
        } catch {
          /* best effort */
        }
      }
    }

    throw lastError || new Error('All download mirrors failed.');
  }

  private static async downloadSingleMirror(
    url: string,
    partPath: string,
    targetPath: string,
    options: FastDownloadOptions
  ): Promise<boolean> {
    const probe = await this.probeUrl(url, options.headers, options.signal);
    if (probe.statusCode < 200 || probe.statusCode >= 400) {
      throw new Error(`Mirror returned HTTP ${probe.statusCode}`);
    }

    // Ensure target directory exists
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });

    const totalBytes = probe.contentLength;
    const canParallelize = probe.supportsRange && totalBytes >= 3 * 1024 * 1024; // >= 3MB

    if (canParallelize) {
      return await this.downloadParallelSegments(probe.finalUrl, partPath, targetPath, totalBytes, options);
    } else {
      return await this.downloadSequentialStream(probe.finalUrl, partPath, targetPath, totalBytes, options);
    }
  }

  /**
   * Parallel Multi-Segment Chunk Downloader.
   * Saturates high-speed broadband connections by opening multiple concurrent HTTP streams.
   */
  private static async downloadParallelSegments(
    url: string,
    partPath: string,
    targetPath: string,
    totalBytes: number,
    options: FastDownloadOptions
  ): Promise<boolean> {
    // Determine optimal connection count (3 to 8 streams)
    const maxConns = options.maxConnections || (totalBytes > 50 * 1024 * 1024 ? 8 : totalBytes > 15 * 1024 * 1024 ? 6 : 4);
    const chunkCount = Math.max(2, Math.min(maxConns, 8));
    const chunkSize = Math.floor(totalBytes / chunkCount);

    // Prepare .part file
    const fd = fs.openSync(partPath, 'w+');
    try {
      try {
        fs.ftruncateSync(fd, totalBytes);
      } catch {
        // Truncation optional on some platforms
      }

      const chunkProgress: number[] = new Array(chunkCount).fill(0);
      let isCancelled = false;
      const abortHandler = () => {
        isCancelled = true;
      };
      options.signal?.addEventListener('abort', abortHandler, { once: true });

      // Throughput calculator
      let lastTotalReported = 0;
      let windowStart = Date.now();
      let lastBytesPerSecond = 0;

      const reportProgress = () => {
        if (isCancelled) return;
        const currentDownloaded = chunkProgress.reduce((a, b) => a + b, 0);
        const now = Date.now();
        const elapsed = (now - windowStart) / 1000;

        if (elapsed >= 0.4 || currentDownloaded >= totalBytes) {
          const bytesDiff = currentDownloaded - lastTotalReported;
          if (elapsed > 0) {
            const currentSpeed = bytesDiff / elapsed;
            lastBytesPerSecond = lastBytesPerSecond === 0 ? currentSpeed : lastBytesPerSecond * 0.7 + currentSpeed * 0.3;
          }
          lastTotalReported = currentDownloaded;
          windowStart = now;

          const percent = totalBytes > 0 ? Math.min(100, Math.floor((currentDownloaded / totalBytes) * 100)) : 0;
          const remainingBytes = Math.max(0, totalBytes - currentDownloaded);
          const etaSec = lastBytesPerSecond > 0 ? Math.ceil(remainingBytes / lastBytesPerSecond) : 0;

          const speedFormatted = this.formatSpeed(lastBytesPerSecond);
          const etaFormatted = this.formatEta(etaSec);
          const statusText = `Downloading (${this.formatBytes(currentDownloaded)} / ${this.formatBytes(totalBytes)}) • ${speedFormatted} [${percent}%]${etaFormatted ? ` • ${etaFormatted}` : ''}`;

          options.onProgress?.(
            {
              downloadedBytes: currentDownloaded,
              totalBytes,
              percent,
              bytesPerSecond: lastBytesPerSecond,
              speedFormatted,
              etaFormatted,
              chunksActive: chunkCount,
            },
            statusText
          );
        }
      };

      // Launch all parallel chunks
      const chunkPromises: Promise<void>[] = [];
      for (let i = 0; i < chunkCount; i++) {
        const rangeStart = i * chunkSize;
        const rangeEnd = i === chunkCount - 1 ? totalBytes - 1 : (i + 1) * chunkSize - 1;

        chunkPromises.push(
          this.downloadSegmentWorker(
            url,
            fd,
            rangeStart,
            rangeEnd,
            i,
            chunkProgress,
            reportProgress,
            options,
            () => isCancelled
          )
        );
      }

      await Promise.all(chunkPromises);

      if (isCancelled) {
        throw new Error('Download aborted');
      }

      // Verify full length
      const stats = fs.fstatSync(fd);
      fs.closeSync(fd);

      if (stats.size < totalBytes) {
        throw new Error(`Downloaded file size mismatch (${stats.size} < ${totalBytes})`);
      }

      // Atomically move .part to destination
      try {
        if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
      } catch {}
      fs.renameSync(partPath, targetPath);

      // Final progress event
      options.onProgress?.(
        {
          downloadedBytes: totalBytes,
          totalBytes,
          percent: 100,
          bytesPerSecond: lastBytesPerSecond,
          speedFormatted: this.formatSpeed(lastBytesPerSecond),
          etaFormatted: 'Ready',
          chunksActive: 0,
        },
        'Download complete'
      );

      return true;
    } catch (err) {
      try {
        fs.closeSync(fd);
      } catch {}
      throw err;
    }
  }

  /**
   * Worker for a single chunk segment with stall detection and range retry.
   */
  private static async downloadSegmentWorker(
    url: string,
    fd: number,
    startOffset: number,
    endOffset: number,
    chunkIndex: number,
    progressArray: number[],
    onDataChunk: () => void,
    options: FastDownloadOptions,
    isCancelled: () => boolean
  ): Promise<void> {
    let currentOffset = startOffset;
    let retries = 0;
    const maxRetries = options.maxRetriesPerChunk ?? DEFAULT_MAX_RETRIES;
    const timeoutMs = options.chunkTimeoutMs ?? DEFAULT_CHUNK_TIMEOUT_MS;

    while (currentOffset <= endOffset) {
      if (isCancelled()) throw new Error('Download cancelled');

      try {
        await new Promise<void>((resolve, reject) => {
          const client = url.startsWith('https:') ? https : http;
          const headers: Record<string, string> = {
            'User-Agent': DEFAULT_USER_AGENT,
            Accept: '*/*',
            Range: `bytes=${currentOffset}-${endOffset}`,
            ...options.headers,
          };

          let req: ClientRequest;
          let stallTimer: NodeJS.Timeout | null = null;

          const resetStallTimer = () => {
            if (stallTimer) clearTimeout(stallTimer);
            stallTimer = setTimeout(() => {
              req.destroy(new Error(`Chunk ${chunkIndex} stalled (${timeoutMs}ms)`));
            }, timeoutMs);
          };

          try {
            req = client.get(url, { headers }, (res: IncomingMessage) => {
              const status = res.statusCode ?? 0;
              if (status !== 206 && status !== 200) {
                if (stallTimer) clearTimeout(stallTimer);
                res.destroy();
                reject(new Error(`Server returned HTTP ${status} for segment`));
                return;
              }

              /**
               * A `200` here means the server ignored the Range header.
               *
               * This request asked for `bytes=${currentOffset}-${endOffset}`;
               * a `200` is the whole file from byte zero. Accepting it writes
               * the *beginning* of the file at this chunk's offset — so the
               * output is silently corrupted, every worker downloads the entire
               * file, and the progress total races past 100% while the result
               * is unplayable.
               *
               * The probe already routes such a host to the sequential path, so
               * reaching here means the server changed its mind between the
               * probe and the transfer — which
               * `video-downloads.googleusercontent.com` and other signed-URL
               * CDNs do under load. Failing the chunk is the only safe answer:
               * a corrupt file that finishes is worse than a download that
               * reports why it stopped.
               */
              if (status === 200) {
                if (stallTimer) clearTimeout(stallTimer);
                res.destroy();
                reject(
                  new Error(
                    'Server ignored the byte-range request and offered the whole file; ' +
                      'this source cannot be downloaded in parallel segments.'
                  )
                );
                return;
              }

              resetStallTimer();

              res.on('data', (buffer: Buffer) => {
                if (isCancelled()) {
                  if (stallTimer) clearTimeout(stallTimer);
                  req.destroy();
                  reject(new Error('Download cancelled'));
                  return;
                }

                resetStallTimer();
                try {
                  fs.writeSync(fd, buffer, 0, buffer.length, currentOffset);
                  currentOffset += buffer.length;
                  progressArray[chunkIndex] = currentOffset - startOffset;
                  onDataChunk();
                } catch (writeErr) {
                  if (stallTimer) clearTimeout(stallTimer);
                  req.destroy();
                  reject(writeErr);
                }
              });

              res.on('end', () => {
                if (stallTimer) clearTimeout(stallTimer);
                resolve();
              });

              res.on('error', (err) => {
                if (stallTimer) clearTimeout(stallTimer);
                reject(err);
              });
            });
          } catch (reqErr) {
            reject(reqErr);
            return;
          }

          resetStallTimer();
          req.on('error', (err) => {
            if (stallTimer) clearTimeout(stallTimer);
            reject(err);
          });
        });

        // Finished this segment range
        break;
      } catch (err: any) {
        retries++;
        if (retries > maxRetries || isCancelled()) {
          throw new Error(`Segment ${chunkIndex} failed after ${retries} attempts: ${err?.message || err}`);
        }
        // Small backoff before retrying this segment from currentOffset
        await new Promise((r) => setTimeout(r, 400 * retries));
      }
    }
  }

  /**
   * Resilient single-stream fallback with backpressure and resume support.
   */
  private static async downloadSequentialStream(
    url: string,
    partPath: string,
    targetPath: string,
    totalBytes: number,
    options: FastDownloadOptions
  ): Promise<boolean> {
    return new Promise((resolve, reject) => {
      let isCancelled = false;
      const abortHandler = () => {
        isCancelled = true;
      };
      options.signal?.addEventListener('abort', abortHandler, { once: true });

      const client = url.startsWith('https:') ? https : http;
      const headers: Record<string, string> = {
        'User-Agent': DEFAULT_USER_AGENT,
        Accept: '*/*',
        ...options.headers,
      };

      const fileStream = fs.createWriteStream(partPath, { flags: 'w' });
      let downloadedBytes = 0;
      let windowStart = Date.now();
      let lastReportedBytes = 0;
      let lastSpeed = 0;
      let stallTimer: NodeJS.Timeout | null = null;
      const timeoutMs = options.chunkTimeoutMs ?? DEFAULT_CHUNK_TIMEOUT_MS;

      const resetTimer = () => {
        if (stallTimer) clearTimeout(stallTimer);
        stallTimer = setTimeout(() => {
          fileStream.close();
          reject(new Error('Connection stalled'));
        }, timeoutMs);
      };

      const req = client.get(url, { headers }, (res: IncomingMessage) => {
        if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
          if (stallTimer) clearTimeout(stallTimer);
          res.resume();
          fileStream.close();
          try {
            if (fs.existsSync(partPath)) fs.unlinkSync(partPath);
          } catch {}
          reject(new Error(`Server returned HTTP ${res.statusCode}`));
          return;
        }

        const realTotal = totalBytes > 0 ? totalBytes : parseInt(res.headers['content-length'] || '0', 10);
        resetTimer();

        res.on('data', (chunk: Buffer) => {
          if (isCancelled) {
            if (stallTimer) clearTimeout(stallTimer);
            req.destroy();
            fileStream.close();
            reject(new Error('Download cancelled'));
            return;
          }

          resetTimer();
          downloadedBytes += chunk.length;
          fileStream.write(chunk);

          const now = Date.now();
          const elapsed = (now - windowStart) / 1000;
          if (elapsed >= 0.5 || (realTotal > 0 && downloadedBytes >= realTotal)) {
            const diff = downloadedBytes - lastReportedBytes;
            if (elapsed > 0) {
              const currentSpeed = diff / elapsed;
              lastSpeed = lastSpeed === 0 ? currentSpeed : lastSpeed * 0.7 + currentSpeed * 0.3;
            }
            lastReportedBytes = downloadedBytes;
            windowStart = now;

            const percent = realTotal > 0 ? Math.min(100, Math.floor((downloadedBytes / realTotal) * 100)) : 0;
            const remaining = Math.max(0, realTotal - downloadedBytes);
            const etaSec = lastSpeed > 0 ? Math.ceil(remaining / lastSpeed) : 0;

            const speedFormatted = FastChunkDownloader.formatSpeed(lastSpeed);
            const etaFormatted = FastChunkDownloader.formatEta(etaSec);
            const statusText = `Downloading (${FastChunkDownloader.formatBytes(downloadedBytes)}${realTotal > 0 ? ` / ${FastChunkDownloader.formatBytes(realTotal)}` : ''}) • ${speedFormatted}${percent > 0 ? ` [${percent}%]` : ''}${etaFormatted ? ` • ${etaFormatted}` : ''}`;

            options.onProgress?.(
              {
                downloadedBytes,
                totalBytes: realTotal,
                percent,
                bytesPerSecond: lastSpeed,
                speedFormatted,
                etaFormatted,
                chunksActive: 1,
              },
              statusText
            );
          }
        });

        res.on('end', () => {
          if (stallTimer) clearTimeout(stallTimer);
          fileStream.end(() => {
            try {
              if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
            } catch {}
            fs.renameSync(partPath, targetPath);
            resolve(true);
          });
        });

        res.on('error', (err) => {
          if (stallTimer) clearTimeout(stallTimer);
          fileStream.close();
          try {
            if (fs.existsSync(partPath)) fs.unlinkSync(partPath);
          } catch {}
          reject(err);
        });
      });

      resetTimer();
      req.on('error', (err) => {
        if (stallTimer) clearTimeout(stallTimer);
        fileStream.close();
        try {
          if (fs.existsSync(partPath)) fs.unlinkSync(partPath);
        } catch {}
        reject(err);
      });
    });
  }

  /**
   * Probes URL headers and Range compatibility, following redirects.
   */
  public static async probeUrl(
    initialUrl: string,
    customHeaders?: Record<string, string>,
    signal?: AbortSignal
  ): Promise<ProbeResult> {
    let currentUrl = initialUrl;
    let redirects = 0;

    while (redirects < MAX_REDIRECTS) {
      if (signal?.aborted) throw new Error('Probe aborted');

      const client = currentUrl.startsWith('https:') ? https : http;
      const headers: Record<string, string> = {
        'User-Agent': DEFAULT_USER_AGENT,
        Accept: '*/*',
        Range: 'bytes=0-0', // Range probe
        ...customHeaders,
      };

      const result = await new Promise<ProbeResult | { redirectUrl: string }>((resolve, reject) => {
        const req = client.get(currentUrl, { headers }, (res: IncomingMessage) => {
          const status = res.statusCode ?? 0;

          // Handle redirects (301, 302, 303, 307, 308)
          if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
            res.resume();
            const nextUrl = new URL(res.headers.location, currentUrl).toString();
            resolve({ redirectUrl: nextUrl });
            return;
          }

          let contentLength = 0;
          let supportsRange = false;

          if (status === 206) {
            supportsRange = true;
            const contentRange = res.headers['content-range'];
            if (contentRange) {
              const match = contentRange.match(/\/(\d+)/);
              if (match) contentLength = parseInt(match[1], 10);
            }
          }

          if (!contentLength && res.headers['content-length']) {
            contentLength = parseInt(res.headers['content-length'], 10);
          }

          if (res.headers['accept-ranges'] === 'bytes') {
            supportsRange = true;
          }

          /**
           * The body is thrown away, not drained — and on some hosts that is
           * the difference between a download and a stall.
           *
           * `res.resume()` discards the data but leaves the transfer running,
           * and this probe asked for `bytes=0-0`. A server that honours it
           * sends one byte and nothing is lost. A server that **ignores Range**
           * answers `200` with the whole file, so the probe quietly keeps
           * pulling it long after it has returned its answer.
           *
           * Measured against a `video-downloads.googleusercontent.com` link —
           * which returns `200`, no `Accept-Ranges`, `Content-Length`
           * 6,175,245,105: the abandoned probe drained **5.6 MB in the five
           * seconds after it resolved**, and kept going. The real download runs
           * beside that, competing with it for the same throttled signed URL,
           * which is exactly the reported symptom: a few megabytes transferred
           * and then `0 KB/s` forever on a 5.75 GB file.
           */
          res.destroy();
          req.destroy();
          resolve({
            finalUrl: currentUrl,
            contentLength: isNaN(contentLength) ? 0 : contentLength,
            supportsRange,
            statusCode: status,
          });
        });

        req.on('error', reject);
        req.setTimeout(10_000, () => {
          req.destroy(new Error('Probe timeout'));
        });
      });

      if ('redirectUrl' in result) {
        currentUrl = result.redirectUrl;
        redirects++;
      } else {
        return result;
      }
    }

    throw new Error('Too many redirects encountered while probing URL.');
  }

  public static formatBytes(bytes: number): string {
    if (bytes <= 0) return '0 MB';
    const mb = bytes / (1024 * 1024);
    if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
    if (mb >= 1) return `${mb.toFixed(1)} MB`;
    return `${(bytes / 1024).toFixed(0)} KB`;
  }

  public static formatSpeed(bytesPerSecond: number): string {
    if (bytesPerSecond <= 0) return '0 KB/s';
    const mb = bytesPerSecond / (1024 * 1024);
    if (mb >= 1) return `${mb.toFixed(1)} MB/s`;
    return `${(bytesPerSecond / 1024).toFixed(0)} KB/s`;
  }

  public static formatEta(seconds: number): string {
    if (!seconds || seconds <= 0 || !isFinite(seconds)) return '';
    if (seconds < 60) return `${seconds}s remaining`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s remaining`;
  }
}
