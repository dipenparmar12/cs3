/**
 * An address worth writing into history: anything but our own loopback.
 *
 * `http://127.0.0.1:<port>/stream/<token>` names this session's proxy, the
 * torrent server or the transcoder — dead the moment the app closes. Stored in
 * history, replaying it fails, the failure widens the search to every source,
 * and a different film that shares the title starts playing (errors audit,
 * Part 2 §5).
 */
export function isLoopbackUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname;
    return host === '127.0.0.1' || host === 'localhost' || host === '[::1]';
  } catch {
    return false;
  }
}

/** The first candidate that will still mean something next week, or ''. */
export function durableAddress(...candidates: Array<string | undefined | null>): string {
  for (const candidate of candidates) {
    if (candidate && !isLoopbackUrl(candidate)) return candidate;
  }
  return '';
}
