import fs from 'node:fs';
import path from 'node:path';

/**
 * Putting a new extension archive where the old one was, on an OS that will not
 * replace a file somebody has open.
 *
 * Android replaces an archive by deleting it and writing the new one, which on
 * Linux works while the old file is still open. Windows refuses: a JVM class
 * loader opens its jars without `FILE_SHARE_DELETE`, and while it holds one the
 * rename over it fails with `EPERM` — as does any rename while an antivirus
 * scan or the search indexer has the file. Measured on a real install, the
 * extension whose load fails on every launch could never be updated at all.
 *
 * So the rename is retried for as long as a transient hold lasts, and when the
 * hold outlives that, the new archive is written *beside* the old one under a
 * name nothing has open, and the caller points the install record at it. The
 * update succeeds either way; the locked copy is deleted later, once whatever
 * held it has let go. An update must not depend on another process's handles.
 */

export interface PlacementFs {
  existsSync(file: string): boolean;
  renameSync(from: string, to: string): void;
  chmodSync(file: string, mode: number): void;
  unlinkSync(file: string): void;
}

/**
 * What Windows answers when a file is held open or read-only.
 *
 * `EACCES` is in the set because a read-only target answers it — Android's load
 * sequence marks the archive read-only before loading, and so does ours.
 */
const LOCKED = new Set(['EPERM', 'EBUSY', 'EACCES']);

export function isLockedFileError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && LOCKED.has(code);
}

/** `Name.123.cs3` → `Name.123.<digest>.cs3`: content-addressed, so a retry reuses it. */
export function sideBySidePath(target: string, digest: string): string {
  const extension = path.extname(target);
  const stem = extension ? target.slice(0, -extension.length) : target;
  return `${stem}.${digest.slice(0, 12).toLowerCase()}${extension}`;
}

/** Windows paths compare without regard to case; nothing else's do. */
export function samePath(a: string, b: string): boolean {
  const left = path.resolve(a);
  const right = path.resolve(b);
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

export interface Placement {
  /** Where the archive now is. */
  path: string;
  /** True when the target was held and the archive went beside it. */
  lockedTarget: boolean;
}

/**
 * Moves a verified download into place.
 *
 * Six attempts over about 1.5s cover an antivirus scan of the file just
 * written, which is the ordinary transient case; the previous budget of half a
 * second did not.
 */
export async function placeArchive(options: {
  tempPath: string;
  target: string;
  digest: string;
  attempts?: number;
  backoffMs?: number;
  fs?: PlacementFs;
  sleep?: (ms: number) => Promise<void>;
}): Promise<Placement> {
  const files = options.fs ?? fs;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const attempts = options.attempts ?? 6;
  const backoffMs = options.backoffMs ?? 100;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      makeWritable(files, options.target);
      files.renameSync(options.tempPath, options.target);
      return { path: options.target, lockedTarget: false };
    } catch (error) {
      if (!isLockedFileError(error)) throw error;
      if (attempt < attempts) await sleep(backoffMs * attempt);
    }
  }

  const beside = sideBySidePath(options.target, options.digest);
  if (files.existsSync(beside)) {
    // The same verified bytes, placed by an earlier attempt — and possibly the
    // copy that is loaded right now, so it is reused rather than replaced.
    files.unlinkSync(options.tempPath);
  } else {
    files.renameSync(options.tempPath, beside);
  }
  return { path: beside, lockedTarget: true };
}

/**
 * Deletes archives that were displaced while something held them.
 *
 * Returns the ones still held, to try again later. A path an install record
 * points at again — a rollback onto it, say — is dropped from the list without
 * being touched.
 */
export function sweepDisplaced(
  pending: readonly string[],
  inUse: (file: string) => boolean,
  files: PlacementFs = fs
): string[] {
  const remaining: string[] = [];
  for (const file of pending) {
    if (inUse(file)) continue;
    try {
      if (!files.existsSync(file)) continue;
      makeWritable(files, file);
      files.unlinkSync(file);
    } catch (error) {
      if (isLockedFileError(error)) remaining.push(file);
    }
  }
  return remaining;
}

function makeWritable(files: PlacementFs, file: string): void {
  try {
    if (files.existsSync(file)) files.chmodSync(file, 0o666);
  } catch {
    // The rename or unlink that follows reports the real problem.
  }
}
