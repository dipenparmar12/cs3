/**
 * Cleaning `cache/` and `temp/` without ever touching anything else.
 *
 * The rules, each one a test in `storageCleanup.test.mts`:
 *
 * - Only inside a directory carrying CS3's ownership marker, and only below
 *   the root it was asked about (by path, never by name). No marker, no delete.
 * - Symlinks are never followed; a link is removed as a link, if at all.
 * - A temp session is removed only when the process named in its marker is
 *   gone. This launch's session, and any other live instance's, stay.
 * - A cache entry that `isActive` claims is kept, whatever its age.
 * - A locked file or a permission error is counted and skipped; the sweep
 *   carries on and the file is tried again next time.
 *
 * Asynchronous throughout, so a large piece cache costs the background queue
 * time rather than the first frame.
 */
import fs from 'node:fs';
import path from 'node:path';
import { OWNER_MARKER, isInside, readMarker, type CacheArea } from './appStorage.ts';

export interface SweepResult {
  removed: string[];
  freedBytes: number;
  kept: number;
  errors: Array<{ path: string; error: string }>;
}

const empty = (): SweepResult => ({ removed: [], freedBytes: 0, kept: 0, errors: [] });

/** Whether a process is still running. `EPERM` means it exists but is not ours to signal. */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException)?.code === 'EPERM';
  }
}

interface EntryInfo {
  path: string;
  bytes: number;
  /** Newest modification anywhere inside — the last time anything used it. */
  newestMs: number;
}

/** Size and newest mtime of a file or directory, without following links. */
export async function measure(target: string): Promise<EntryInfo> {
  let bytes = 0;
  let newestMs = 0;
  const visit = async (current: string): Promise<void> => {
    let stat: fs.Stats;
    try {
      stat = await fs.promises.lstat(current);
    } catch {
      return; // Gone between listing and looking: nothing to count.
    }
    newestMs = Math.max(newestMs, stat.mtimeMs);
    if (stat.isSymbolicLink()) return;
    if (stat.isDirectory()) {
      let names: string[] = [];
      try {
        names = await fs.promises.readdir(current);
      } catch {
        return;
      }
      for (const name of names) await visit(path.join(current, name));
      return;
    }
    bytes += stat.size;
  };
  await visit(target);
  return { path: target, bytes, newestMs };
}

async function remove(target: string, result: SweepResult, bytes: number): Promise<void> {
  try {
    await fs.promises.rm(target, { recursive: true, force: true, maxRetries: 1 });
    result.removed.push(target);
    result.freedBytes += bytes;
  } catch (error) {
    result.errors.push({ path: target, error: (error as Error)?.message ?? String(error) });
  }
}

async function listEntries(dir: string): Promise<string[]> {
  try {
    return (await fs.promises.readdir(dir)).filter((name) => name !== OWNER_MARKER);
  } catch {
    return [];
  }
}

/**
 * Removes temp sessions whose process has gone, and ages out `temp-area`s.
 *
 * Anything in `tempRoot` without a marker is somebody else's and stays.
 */
export async function sweepTemp(
  tempRoot: string,
  options: {
    currentPid: number;
    isAlive?: (pid: number) => boolean;
    now?: number;
    /** Files in a stable temp area older than this go. */
    areaMaxAgeMs?: number;
  }
): Promise<SweepResult> {
  const result = empty();
  if (!readMarker(tempRoot)) return result;
  const alive = options.isAlive ?? isProcessAlive;
  const now = options.now ?? Date.now();

  for (const name of await listEntries(tempRoot)) {
    const entry = path.join(tempRoot, name);
    let stat: fs.Stats;
    try {
      stat = await fs.promises.lstat(entry);
    } catch {
      continue;
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      result.kept += 1;
      continue;
    }
    const marker = readMarker(entry);
    if (marker?.kind === 'temp-session') {
      const pid = marker.pid ?? 0;
      if (pid === options.currentPid || alive(pid)) {
        result.kept += 1;
        continue;
      }
      await remove(entry, result, (await measure(entry)).bytes);
    } else if (marker?.kind === 'temp-area' && options.areaMaxAgeMs !== undefined) {
      const aged = await sweepByAge(entry, options.areaMaxAgeMs, now, () => false);
      merge(result, aged);
    } else {
      result.kept += 1;
    }
  }
  return result;
}

async function sweepByAge(
  dir: string,
  maxAgeMs: number,
  now: number,
  isActive: (entryPath: string) => boolean
): Promise<SweepResult> {
  const result = empty();
  for (const name of await listEntries(dir)) {
    const entry = path.join(dir, name);
    if (isActive(entry)) {
      result.kept += 1;
      continue;
    }
    const info = await measure(entry);
    if (now - info.newestMs > maxAgeMs) await remove(entry, result, info.bytes);
    else result.kept += 1;
  }
  return result;
}

function merge(into: SweepResult, from: SweepResult): void {
  into.removed.push(...from.removed);
  into.freedBytes += from.freedBytes;
  into.kept += from.kept;
  into.errors.push(...from.errors);
}

/**
 * Applies a cache area's age and size rules.
 *
 * Refuses outright — removes nothing — unless the area is a directory inside a
 * marked cache root. A folder the viewer chose for the piece cache is theirs:
 * its own Clear button empties it on request, but nothing does so on a timer.
 */
export async function sweepCacheArea(
  area: CacheArea,
  cacheRoot: string,
  now = Date.now()
): Promise<SweepResult> {
  const result = empty();
  if (area.kind !== 'dir' || !area.managed) return result;
  if (!isInside(cacheRoot, area.path) || path.resolve(cacheRoot) === path.resolve(area.path)) {
    return result;
  }
  if (!readMarker(cacheRoot)) return result;

  const isActive = area.isActive ?? (() => false);
  const infos: EntryInfo[] = [];
  for (const name of await listEntries(area.path)) {
    const entry = path.join(area.path, name);
    if (isActive(entry)) {
      result.kept += 1;
      continue;
    }
    infos.push(await measure(entry));
  }

  const survivors: EntryInfo[] = [];
  for (const info of infos) {
    if (area.maxAgeMs !== undefined && now - info.newestMs > area.maxAgeMs) {
      await remove(info.path, result, info.bytes);
    } else {
      survivors.push(info);
    }
  }

  if (area.maxBytes !== undefined) {
    // Active entries are not candidates, but they do occupy the budget.
    let total = survivors.reduce((sum, info) => sum + info.bytes, 0);
    survivors.sort((a, b) => a.newestMs - b.newestMs);
    for (const info of survivors) {
      if (total <= area.maxBytes) break;
      await remove(info.path, result, info.bytes);
      total -= info.bytes;
    }
  }
  result.kept += infos.length - result.removed.length;
  return result;
}

/** How much an area (or any directory) holds, for the storage report. */
export async function areaSize(area: Pick<CacheArea, 'path'>): Promise<number> {
  if (!fs.existsSync(area.path)) return 0;
  return (await measure(area.path)).bytes;
}
