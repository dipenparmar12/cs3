import type { StoredSource } from '../../src/types/library';
import type { TorrentResult } from '../../src/types/torrent';

/**
 * Finding a saved source again after its link has died.
 *
 * The whole difficulty is that **a provider source has no durable id**. Torrents
 * do — an infohash addresses content, so the same release is the same infohash
 * forever. A provider stream's `infoHash` is *synthesised* by `ContentService`
 * as the SHA-1 of its URL, purely so the ranker and the dedupe key have
 * something to work with. Re-resolve that release an hour later, get a freshly
 * signed URL, and the synthetic id is different — for the identical file.
 *
 * So matching by id alone silently never re-finds a provider source, which is
 * precisely the case this feature exists for. What is durable is the release
 * itself: which provider served it, what the release is called, and at what
 * resolution. That triple is what a viewer means by "the same source".
 */

/** Release names differ by punctuation and case across refreshes; identity does not. */
function normalise(value: string | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/\.(mkv|mp4|avi|m4v|ts)$/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** A real infohash addresses content; a synthetic one addresses a URL. */
function hasRealInfoHash(source: { magnet?: string; torrentUrl?: string; infoHash?: string }): boolean {
  if (source.magnet || source.torrentUrl) return true;
  // `ContentService` prefixes the synthetic ones; a bare 40-hex string is real.
  return /^[a-f0-9]{40}$/i.test(source.infoHash ?? '');
}

/**
 * Whether a stored link can still be handed to the player without re-resolving.
 *
 * Magnets are always usable: an infohash addresses content rather than a server,
 * so there is nothing to expire and re-running discovery to "refresh" one is
 * pure waste — the same magnet comes back.
 *
 * A direct link is usable only while its stated deadline holds. Where no
 * deadline was recorded the answer is **no**, deliberately: an unknown expiry on
 * someone else's CDN is not evidence of a working link, and the cost of being
 * wrong is asymmetric. Guessing "still good" spends the ffmpeg startup and the
 * player's timeout before failing over; guessing "expired" costs one provider
 * call and produces a stream that works.
 */
export function isLinkUsable(source: StoredSource, now = Date.now()): boolean {
  if (source.magnet || source.torrentUrl) return true;
  if (!source.directUrl) return false;
  return typeof source.expiresAt === 'number' && source.expiresAt > now;
}

/**
 * Whether a freshly discovered candidate is the release that was saved.
 *
 * Strict on purpose. Returning the wrong release is worse than returning
 * nothing: the viewer asked to resume *this* stream, and quietly starting a
 * different encode — a different cut, a different dub, a 480p rip where a 1080p
 * was saved — is a failure they will attribute to the app losing their place.
 * When nothing matches, the caller offers the full list, which is honest.
 */
export function matchesRelease(saved: StoredSource, candidate: TorrentResult): boolean {
  // Content-addressed on both sides: exact, and nothing else needs checking.
  if (hasRealInfoHash(saved) && hasRealInfoHash(candidate)) {
    const savedHash = (saved.infoHash ?? '').toLowerCase();
    const candidateHash = (candidate.infoHash ?? '').toLowerCase();
    if (savedHash && candidateHash) return savedHash === candidateHash;
  }

  /**
   * Otherwise the durable triple. The provider has to match — the same release
   * name from a different site is a different file with different headers and a
   * different lifetime — and so does the resolution, because "1080p" versus
   * "720p" is the distinction most viewers are actually expressing when they
   * pick a source.
   */
  const savedProvider = normalise(saved.providerName ?? saved.indexerName);
  const candidateProvider = normalise(candidate.indexerName);
  if (!savedProvider || savedProvider !== candidateProvider) return false;

  const savedResolution = saved.resolution ?? saved.parsed?.resolution;
  const candidateResolution = candidate.parsed?.resolution;
  if (savedResolution && candidateResolution && String(savedResolution) !== String(candidateResolution)) {
    return false;
  }

  const savedTitle = normalise(saved.title);
  const candidateTitle = normalise(candidate.title);
  if (!savedTitle || !candidateTitle) return false;
  if (savedTitle === candidateTitle) return true;

  /**
   * One concession to reality: providers append and drop decorations between
   * refreshes — a size, a mirror name, a "[Dual Audio]" tag. Containment in
   * either direction covers that without opening the door to matching two
   * genuinely different releases, which a similarity score would.
   */
  return savedTitle.includes(candidateTitle) || candidateTitle.includes(savedTitle);
}

/**
 * The best candidate that is the saved release, or null.
 *
 * Prefers an exact title match over a decorated one, so a provider offering both
 * `Dune 2021 1080p` and `Dune 2021 1080p [Dual Audio]` returns whichever the
 * viewer actually saved rather than whichever happens to sort first.
 */
export function pickReplacement(
  saved: StoredSource,
  candidates: TorrentResult[]
): TorrentResult | null {
  const matches = candidates.filter((candidate) => matchesRelease(saved, candidate));
  if (matches.length === 0) return null;

  const savedTitle = normalise(saved.title);
  return matches.find((candidate) => normalise(candidate.title) === savedTitle) ?? matches[0];
}
