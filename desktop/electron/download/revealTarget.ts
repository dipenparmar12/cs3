import path from 'node:path';

/**
 * Validates and confines target paths requested for folder/file reveal.
 *
 * Prevents arbitrary directory browsing via IPC by strictly confining targets
 * to the active downloads directory or the application data directory.
 * Any unconfined or empty target safely defaults to the downloads folder.
 */
export function resolveSafeRevealTarget(
  targetPath: string | undefined | null,
  downloadsDir: string,
  dataDir: string
): string {
  if (!targetPath) return downloadsDir;
  const resolved = path.resolve(String(targetPath));
  const normalizedDownloads = path.resolve(downloadsDir);
  const normalizedData = path.resolve(dataDir);

  const inDownloads =
    resolved === normalizedDownloads ||
    resolved.startsWith(normalizedDownloads + path.sep);
  const inData =
    resolved === normalizedData ||
    resolved.startsWith(normalizedData + path.sep);

  return inDownloads || inData ? resolved : normalizedDownloads;
}
