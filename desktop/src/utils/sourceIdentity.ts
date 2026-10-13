/**
 * The two primitives that decide whether two sources are the same source.
 *
 * `downloadIdentity.ts` and `cs3/playedSource.ts` answer different questions —
 * "is this already downloading?" and "is this the release that played last
 * time?" — and both had their own byte-identical copy of these, down to the
 * comment. Their headers already cross-reference each other and say they solve
 * the same problem for the same reason; this is that sentence made true.
 *
 * Sharing them is not tidiness. If one copy drifted, downloads would dedupe on
 * one rule while resume matched on another, and neither side would report
 * anything: a resume would quietly start a different release, or a second copy
 * of a file already on disk would quietly begin. Both failures are silent and
 * they point in opposite directions, so nothing would ever connect them back to
 * a diverged helper.
 */

/**
 * The form two spellings of one release share.
 *
 * Providers append and drop decorations between refreshes — a size, a mirror
 * name, `[Dual Audio]`, a container extension — and change punctuation and case
 * freely. None of that is identity.
 */
export function normaliseReleaseName(value: string | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/\.(mkv|mp4|avi|m4v|ts)$/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Only the fields that say whether this source is torrent-shaped. */
export interface InfoHashBearing {
  magnet?: string;
  torrentUrl?: string;
  infoHash?: string;
}

/**
 * Whether this source's `infoHash` addresses **content** rather than a URL.
 *
 * The distinction the whole family of identity bugs turns on. A torrent's
 * infohash is derived from the file's own bytes, so it is durable: the same
 * release is the same hash forever. A provider stream has no such id, so
 * `ContentService` synthesises one from the URL — which means re-resolving the
 * identical file an hour later, after the signed link rotates, produces a
 * *different* id for a byte-identical file.
 *
 * So a synthetic hash can be used to dedupe within one result set and can never
 * be used to recognise a source across time. `ContentService` prefixes the ones
 * it invents; a bare 40-hex string is a real one.
 */
export function hasRealInfoHash(source: InfoHashBearing): boolean {
  if (source.magnet || source.torrentUrl) return true;
  return /^[a-f0-9]{40}$/i.test(source.infoHash ?? '');
}
