import path from 'node:path';
import { isInside } from '../security/localFiles.ts';

/**
 * What "Show in folder" may open (audit SEC-06 in the second report).
 *
 * The handler only ever *opens a directory* or *highlights a file*
 * (`shell.openPath` on directories, `showItemInFolder` on files), so this is
 * about navigation, not execution: an arbitrary renderer-supplied path should
 * not walk the file manager around the disk.
 *
 * Allowed: anything inside a download root (the folder chosen in Settings and
 * the OS Downloads folder), the app's data folder, or exactly a file this app
 * downloaded — and that file's folder. The last one matters: a download saved
 * before the viewer changed the download folder lives outside every current
 * root, and confining to roots alone made "Show in folder" silently open the
 * wrong place. Compared segment-wise and case-folded on Windows (`isInside`).
 * Anything else falls back to the first root.
 */
export function resolveSafeRevealTarget(
  targetPath: string | undefined | null,
  roots: readonly string[],
  knownFiles: readonly string[] = [],
  platform: NodeJS.Platform = process.platform
): string {
  const usableRoots = roots.filter(Boolean).map((root) => path.resolve(root));
  const fallback = usableRoots[0] ?? '';
  if (!targetPath) return fallback;

  const resolved = path.resolve(String(targetPath));
  if (usableRoots.some((root) => isInside(resolved, root, platform))) return resolved;

  const same = (a: string, b: string) => (platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
  const known = knownFiles.filter(Boolean).map((file) => path.resolve(file));
  if (known.some((file) => same(file, resolved) || same(path.dirname(file), resolved))) return resolved;

  return fallback;
}
