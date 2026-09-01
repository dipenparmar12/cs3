import fs from 'fs';
import http, { type IncomingMessage } from 'http';
import https from 'https';

/**
 * Reads the boundary window of a download from both ends and compares them.
 *
 * ## One request, three answers
 *
 * Resuming across a replaced link needs to know three things: does the new
 * server honour `Range`, how long is the whole file, and are the bytes we
 * already have the same bytes it would have sent. A ranged request for the
 * window immediately before the resume point answers all three at once —
 * `206` proves the first, `Content-Range: bytes s-e/total` gives the second,
 * and the body is the third. Asking separately would cost two round trips
 * against a signed URL that is already the slow part of this operation.
 *
 * ## The `res.resume()` trap, again
 *
 * A server that ignores `Range` answers `200` with the entire file. Draining
 * that body — which is what `res.resume()` does — leaves a multi-gigabyte
 * transfer running behind a function that has already returned its answer.
 * This repository has been bitten by exactly that twice: once in
 * `FastChunkDownloader.probeUrl`, where an abandoned probe pulled 5.6 MB in
 * five seconds and kept going, and once in `MediaProxy`, where a detached
 * reader left Chromium's network service downloading 3.24 GB per abandoned
 * probe. So the response and the request are both destroyed, and the request
 * carries a deadline of its own.
 *
 * ## Bounded reads
 *
 * The body is capped at the window size even on a well-behaved server. A host
 * that answers `206` and then sends more than it promised would otherwise
 * buffer without limit inside a function whose whole purpose is to be cheap.
 */

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/120.0.0.0 Safari/537.36';

const MAX_REDIRECTS = 10;

/** A window fetch has to be quick or it is not worth doing before a restart. */
const WINDOW_TIMEOUT_MS = 20_000;

export interface RemoteWindow {
  /** The server honoured the exact range asked for. */
  satisfiedRange: boolean;
  /** The whole file's length, from `Content-Range` or `Content-Length`. */
  totalBytes?: number;
  /** The window's bytes, present only when `satisfiedRange` is true. */
  bytes?: Buffer;
  status: number;
  /** Why no window came back, for the ledger. Absent on success. */
  error?: string;
}

/**
 * Fetches `[start, end]` from `url`, following redirects.
 *
 * Never throws: a failure to read the window is a reason to restart the
 * download, not an exception for the caller to handle separately.
 */
export function fetchRemoteWindow(
  url: string,
  headers: Record<string, string>,
  start: number,
  end: number
): Promise<RemoteWindow> {
  const want = end - start + 1;

  return new Promise<RemoteWindow>((resolve) => {
    let settled = false;
    const finish = (result: RemoteWindow) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const attempt = (target: string, redirects: number, seen: Set<string>) => {
      if (redirects > MAX_REDIRECTS || seen.has(target)) {
        finish({ satisfiedRange: false, status: 0, error: 'The replacement link redirects in a loop.' });
        return;
      }
      seen.add(target);

      const client = target.startsWith('https:') ? https : http;
      const request = client.get(
        target,
        {
          headers: {
            'User-Agent': USER_AGENT,
            Accept: '*/*',
            ...headers,
            Range: `bytes=${start}-${end}`,
          },
        },
        (response: IncomingMessage) => {
          const status = response.statusCode ?? 0;

          if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
            const next = new URL(response.headers.location, target).toString();
            response.destroy();
            attempt(next, redirects + 1, seen);
            return;
          }

          const totalFromRange = (() => {
            const header = response.headers['content-range'];
            const match = typeof header === 'string' ? /\/(\d+)\s*$/.exec(header) : null;
            return match ? Number(match[1]) : undefined;
          })();

          if (status !== 206) {
            /**
             * `200` means the range was ignored and the whole file is coming.
             * `416` means the range is past the end. Neither can be resumed
             * from, and neither body is wanted — destroying both ends is what
             * actually stops the transfer.
             */
            const declared = Number(response.headers['content-length']);
            response.destroy();
            request.destroy();
            finish({
              satisfiedRange: false,
              status,
              totalBytes:
                totalFromRange ??
                (status === 200 && Number.isFinite(declared) && declared > 0 ? declared : undefined),
            });
            return;
          }

          const chunks: Buffer[] = [];
          let received = 0;
          response.on('data', (chunk: Buffer) => {
            chunks.push(chunk);
            received += chunk.length;
            // A server sending more than it promised is stopped here rather
            // than buffered — this function exists to be cheap.
            if (received >= want) {
              response.destroy();
              request.destroy();
            }
          });
          const done = () => {
            finish({
              satisfiedRange: true,
              status,
              totalBytes: totalFromRange,
              bytes: Buffer.concat(chunks).subarray(0, want),
            });
          };
          response.on('end', done);
          response.on('close', done);
          response.on('error', (error) =>
            finish({ satisfiedRange: false, status, error: error.message })
          );
        }
      );

      request.on('error', (error) =>
        finish({ satisfiedRange: false, status: 0, error: error.message })
      );
      request.setTimeout(WINDOW_TIMEOUT_MS, () => {
        request.destroy();
        finish({
          satisfiedRange: false,
          status: 0,
          error: 'The replacement link did not answer in time.',
        });
      });
    };

    attempt(url, 0, new Set());
  });
}

/** The same window, read off the partial file on disk. */
export function readLocalWindow(partPath: string, start: number, end: number): Buffer | null {
  const length = end - start + 1;
  if (length <= 0) return null;
  let handle: number | null = null;
  try {
    handle = fs.openSync(partPath, 'r');
    const buffer = Buffer.alloc(length);
    const read = fs.readSync(handle, buffer, 0, length, start);
    // A short read means the file shrank under us — treat it as unreadable
    // rather than comparing a partly-filled buffer, which would compare zeroes.
    return read === length ? buffer : null;
  } catch {
    return null;
  } finally {
    if (handle !== null) {
      try {
        fs.closeSync(handle);
      } catch {
        // Nothing useful to do; the descriptor leaks at worst once.
      }
    }
  }
}
