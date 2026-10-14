import path from 'node:path';

/**
 * Which local files the loopback server may hand out (audit SEC-05).
 *
 * Local serving exists to play the viewer's own media — File → Open, a dropped
 * video, a finished download — and any path the renderer names reaches it. It
 * used to allow *every* file under `userData` (the datastore with a Jellyfin
 * key in it), the OS temp folder, and `process.cwd()` (wherever a packaged app
 * was launched from — often the user profile).
 *
 * The rule now matches the feature: a media or subtitle file wherever the
 * viewer keeps it, and any other file only inside the folders downloads land
 * in. Paths are compared after symlinks and junctions are resolved, and on
 * Windows without regard to case, as the filesystem does.
 */

/** Containers and streams the players open, plus the subtitle formats the player loads. */
const MEDIA_EXTENSIONS = new Set([
  'mkv', 'mp4', 'm4v', 'mov', 'avi', 'webm', 'ts', 'm2ts', 'mts', 'wmv', 'flv', 'mpg', 'mpeg', 'ogv', '3gp',
  'mp3', 'm4a', 'aac', 'flac', 'opus', 'ogg', 'oga', 'wav', 'mka',
  'vtt', 'srt', 'ass', 'ssa',
]);

export function isMediaFile(filePath: string): boolean {
  return MEDIA_EXTENSIONS.has(path.extname(filePath).slice(1).toLowerCase());
}

/** `child` is `dir` or inside it — by path segments, never a string prefix. */
export function isInside(child: string, dir: string, platform: NodeJS.Platform = process.platform): boolean {
  const fold = (value: string) => (platform === 'win32' ? value.toLowerCase() : value);
  const relative = path.relative(fold(dir), fold(child));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * Whether `realPath` (already resolved through links) may be served.
 * `downloadDirs` are the folders downloads are written to, also resolved.
 */
export function mayServeLocalFile(
  realPath: string,
  downloadDirs: readonly string[],
  platform: NodeJS.Platform = process.platform
): boolean {
  if (!realPath || realPath.includes('\0')) return false;
  if (isMediaFile(realPath)) return true;
  return downloadDirs.some((dir) => Boolean(dir) && isInside(realPath, dir, platform));
}
