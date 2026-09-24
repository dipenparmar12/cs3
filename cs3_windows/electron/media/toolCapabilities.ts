import fs from 'node:fs';
import { Worker } from 'node:worker_threads';

import type { ToolResult } from './runTool.ts';

/**
 * What this machine's ffmpeg build can do, asked once per binary and off the
 * main thread.
 *
 * Two options are detected rather than assumed — `-extension_picky` and the
 * `zscale` filter — because passing either to a build without it fails the
 * whole command line. Asking means running the binaries, and that was the
 * longest freeze in the app's first two seconds.
 *
 * **`spawn` is synchronous where it counts.** libuv calls `CreateProcessW` on
 * the calling thread, and for an 87MB static build on a cold cache Windows
 * scans the image inside that call. Measured on the bundled binaries: **~590ms
 * per first spawn**, 5ms warm. The startup task spawned two, so the window
 * went grey for 1.1–1.8s in every launch log that ran them cold — the
 * `uninstrumented` worst stall in `startup_complete`, at the same duration as
 * the task every time.
 *
 * So the answer is remembered against the binary's path, size and mtime —
 * nothing changes it but a different binary — and when it does have to be
 * asked, the process is created from a worker thread, where that wait blocks
 * nobody.
 */

export interface ToolFingerprint {
  path: string;
  size: number;
  mtimeMs: number;
}

export interface ToolCapabilities {
  ffprobe?: ToolFingerprint & { extensionPicky: boolean };
  ffmpeg?: ToolFingerprint & { toneMap: boolean };
}

export function fingerprintOf(file: string): ToolFingerprint | null {
  try {
    const stat = fs.statSync(file);
    return { path: file, size: stat.size, mtimeMs: Math.round(stat.mtimeMs) };
  } catch {
    return null;
  }
}

export function sameBinary(
  known: ToolFingerprint | undefined,
  current: ToolFingerprint | null
): boolean {
  return Boolean(
    known &&
      current &&
      known.path === current.path &&
      known.size === current.size &&
      known.mtimeMs === current.mtimeMs
  );
}

/**
 * The worker's whole body. Plain CommonJS, because an `eval` worker is not
 * bundled and must not depend on anything the bundler would have resolved.
 */
const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
const { execFile } = require('node:child_process');
const { command, args, timeoutMs } = workerData;
execFile(command, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
  (error, stdout, stderr) => {
    parentPort.postMessage({
      ok: !error,
      stdout: String(stdout ?? ''),
      stderr: String(stderr ?? '').slice(0, 8000),
      code: error ? (typeof error.code === 'number' ? error.code : null) : 0,
      timedOut: Boolean(error && error.killed),
    });
  });
`;

/**
 * `runTool`'s answer, from a process created on a worker thread.
 *
 * For short-lived queries only: the whole output is buffered and handed back
 * at the end, which is right for `-h` and `-filters` and wrong for a stream.
 */
export function runToolOffThread(
  command: string,
  args: string[],
  timeoutMs: number
): Promise<ToolResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: ToolResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    let worker: Worker;
    try {
      worker = new Worker(WORKER_SOURCE, { eval: true, workerData: { command, args, timeoutMs } });
    } catch (error) {
      finish({ ok: false, stdout: '', stderr: String(error), code: null, timedOut: false });
      return;
    }
    worker.once('message', (result: ToolResult) => {
      finish(result);
      void worker.terminate();
    });
    worker.once('error', (error) =>
      finish({ ok: false, stdout: '', stderr: String(error), code: null, timedOut: false })
    );
    worker.once('exit', () =>
      finish({ ok: false, stdout: '', stderr: 'The worker exited without an answer.', code: null, timedOut: false })
    );
  });
}

/** Whether a run produced an answer worth remembering, as opposed to no answer. */
export function answered(result: ToolResult): boolean {
  return !result.timedOut && result.code !== null;
}
