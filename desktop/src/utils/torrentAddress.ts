/**
 * The durable address of one file inside an imported torrent:
 * `torrent://<infohash>/<fileIndex>` (Torrent PRD §2.4).
 *
 * The player records progress and History under it, because the loopback URL
 * the engine serves changes every session. Reading it back is what lets a
 * History row reopen the same file rather than search for its name. Pure.
 */
export interface TorrentAddress {
  infoHash: string;
  fileIndex: number;
}

const PATTERN = /^torrent:\/\/([0-9a-f]{40})\/(\d+)$/i;

export function torrentAddress(infoHash: string, fileIndex: number): string {
  return `torrent://${infoHash.toLowerCase()}/${fileIndex}`;
}

export function parseTorrentAddress(url: string | undefined | null): TorrentAddress | null {
  const match = url ? PATTERN.exec(url.trim()) : null;
  if (!match) return null;
  const fileIndex = Number(match[2]);
  return Number.isSafeInteger(fileIndex) ? { infoHash: match[1].toLowerCase(), fileIndex } : null;
}
