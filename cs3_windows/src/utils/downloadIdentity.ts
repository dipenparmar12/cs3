import type { DownloadTask } from '../types/download';
import type { TorrentResult } from '../types/torrent';

/**
 * What makes two downloads the same download.
 *
 * The reported bug was one sentence — pressing Download on the 1080p release of
 * a film already downloading in 2160p answered `Already downloading` and did
 * nothing. Underneath it were two separate mistakes about identity.
 *
 * The first is that duplicate detection matched on the **title**, by prefix:
 * `norm(task.title).startsWith(norm(title))`. Every release of one film shares
 * that prefix, so the same media meant the same download and a viewer could
 * only ever hold one copy of a title regardless of which source produced it.
 * The second is that the *target path* was derived from the title too, so even
 * if two had been allowed to start they would have written to one file and
 * corrupted each other.
 *
 * A download is therefore addressed by media **and** the source variant that
 * produced it: which provider, which release, at what resolution, in what
 * language. Same media, same variant is a duplicate. Same media, different
 * variant is a second download the viewer asked for.
 *
 * ---
 *
 * **The variant key must be durable, not merely unique.** This is the same
 * problem `cs3/playedSource.ts` solves for resuming a saved source, and for the
 * same reason: a provider stream's `infoHash` is *synthesised* by
 * `ContentService` as the SHA-1 of its URL, so re-resolving the identical file
 * an hour later produces a different id. Keying on it would make every recovered
 * download a new download — the failure this whole feature exists to prevent,
 * arriving from the other direction.
 *
 * So torrents key on their infohash, which addresses content and is stable
 * forever; everything else keys on the durable description of the release. The
 * two rules are deliberately the ones `matchesRelease` already uses, because
 * "the same source" has to mean one thing across the app.
 */

/** The facts that distinguish one downloadable variant of a title from another. */
export interface DownloadVariant {
  /** The title's own address, not the signed link. Empty for an ad-hoc stream. */
  mediaUrl?: string;
  season?: number;
  episode?: number;
  /** Who served it. The same release name from a different site is a different file. */
  providerName?: string;
  /** The release as the provider named it. */
  releaseTitle?: string;
  /** Real for a torrent, synthesised for a provider link — see the header. */
  infoHash?: string;
  magnet?: string;
  torrentUrl?: string;
  directUrl?: string;
  resolution?: number;
  /** `WEB-DL`, `BluRay`, `HDTV` … — a 1080p WEB-DL is not a 1080p CAM. */
  quality?: string;
  languages?: string[];
  audioCodecs?: string[];
}

/** Punctuation and case differ across refreshes; identity does not. */
function normalise(value: string | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/\.(mkv|mp4|avi|m4v|ts)$/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * A real infohash addresses content; a synthetic one addresses a URL.
 *
 * Kept identical to `cs3/playedSource.ts`'s test on purpose — the two modules
 * answer the same question about the same objects, and letting them drift would
 * mean a source that can be resumed is not recognised as the download it
 * already has.
 */
function hasRealInfoHash(variant: DownloadVariant): boolean {
  if (variant.magnet || variant.torrentUrl) return true;
  return /^[a-f0-9]{40}$/i.test(variant.infoHash ?? '');
}

/** The media half of the key: which title, and which episode of it. */
function mediaKey(variant: DownloadVariant): string {
  const season = variant.season === undefined ? '' : String(variant.season);
  const episode = variant.episode === undefined ? '' : String(variant.episode);
  return `${normalise(variant.mediaUrl)}|${season}|${episode}`;
}

/**
 * The stable identity of one downloadable variant.
 *
 * Two calls describing the same release, hours and one expired link apart,
 * return the same string. Two different releases of one film never do.
 */
export function downloadVariantKey(variant: DownloadVariant): string {
  const media = mediaKey(variant);

  if (hasRealInfoHash(variant)) {
    const hash = (variant.infoHash ?? '').toLowerCase();
    // A magnet whose infohash was never parsed still addresses content by URI.
    return `${media}|t:${hash || normalise(variant.magnet ?? variant.torrentUrl)}`;
  }

  /**
   * The durable description. `directUrl` is deliberately absent: it is the one
   * field guaranteed to differ between the first attempt and the recovery.
   */
  const parts = [
    normalise(variant.providerName),
    normalise(variant.releaseTitle),
    variant.resolution ? String(variant.resolution) : '',
    normalise(variant.quality),
    (variant.languages ?? []).map(normalise).filter(Boolean).sort().join('+'),
    (variant.audioCodecs ?? []).map(normalise).filter(Boolean).sort().join('+'),
  ];

  /**
   * Nothing durable to describe — an ad-hoc stream with no provider and no
   * release name. Falling back to the address is right here and wrong above: a
   * source like that has no recovery path either, so a changed link genuinely
   * is a different download rather than the same one re-resolved.
   */
  if (parts.every((part) => part === '')) {
    return `${media}|u:${normalise(variant.directUrl)}`;
  }
  return `${media}|p:${parts.join('|')}`;
}

/**
 * FNV-1a, 32-bit.
 *
 * Not a cryptographic choice and not a security boundary: this only has to be
 * short, stable, and computed identically in the renderer and the main process.
 * `node:crypto` is unavailable in the first of those, so a hand-rolled hash is
 * the only thing that can live in one file and serve both.
 */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * The task id, derived from the variant key.
 *
 * Derived rather than random so the same variant maps to the same id across
 * restarts. That is what lets a persisted queue answer "is this already
 * downloading?" by lookup instead of by scanning every field of every task.
 */
export function downloadTaskId(variant: DownloadVariant): string {
  return `dl-${fnv1a(downloadVariantKey(variant))}`;
}

/** Reads the variant back off a task, including ones stored before this existed. */
export function variantFromTask(task: DownloadTask): DownloadVariant {
  const url = task.link?.url ?? '';
  const isMagnet = url.startsWith('magnet:');
  return {
    mediaUrl: task.mediaUrl || task.parentId,
    season: task.seasonNumber,
    episode: task.episodeNumber,
    providerName: task.providerName || task.link?.source,
    releaseTitle: task.link?.name || task.title,
    infoHash: task.sourceInfoHash,
    magnet: isMagnet ? url : undefined,
    torrentUrl: task.sourceIsTorrent && !isMagnet ? url : undefined,
    directUrl: isMagnet ? undefined : url,
    resolution: task.resolution,
    quality: task.quality,
    languages: task.languages,
    audioCodecs: task.audioCodecs,
  };
}

/** The variant a discovered source would produce, for the given episode. */
export function variantFromSource(
  source: TorrentResult,
  context: { mediaUrl?: string; season?: number; episode?: number }
): DownloadVariant {
  return {
    mediaUrl: context.mediaUrl,
    season: context.season,
    episode: context.episode,
    providerName: source.providerName || source.indexerName,
    releaseTitle: source.title,
    infoHash: source.infoHash,
    magnet: source.magnet,
    torrentUrl: source.torrentUrl,
    directUrl: source.directUrl,
    resolution: source.parsed?.resolution,
    quality: source.parsed?.source,
    languages: source.parsed?.languages,
    audioCodecs: source.parsed?.audioCodecs,
  };
}

/**
 * How a variant is named on screen, beside a title that no longer identifies it.
 *
 * The downloads list showed a title, a size and a percentage, which for two
 * variants of one film renders as two identical rows. Resolution comes first
 * because it is what the viewer was choosing between; the provider second
 * because it is what they can act on when one of them stops working.
 */
export function variantLabel(variant: DownloadVariant): string {
  const parts: string[] = [];
  if (variant.resolution) parts.push(`${variant.resolution}p`);
  if (variant.quality && variant.quality !== 'Unknown') parts.push(variant.quality);
  if (variant.providerName) parts.push(variant.providerName);

  const languages = (variant.languages ?? []).filter(Boolean);
  if (languages.length > 0) parts.push(languages.slice(0, 2).join('/'));

  return parts.join(' · ');
}

/**
 * What a path segment may not contain.
 *
 * Listed rather than matched by a regex range because the range that matters
 * is the control characters, and writing those as literal bytes in a source
 * file makes it unreadable to every tool that inspects it — including grep,
 * which reports the whole file as binary.
 */
const ILLEGAL_PATH_CHARS = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*']);

/**
 * Strips what a filesystem will not take, and what a separator would split.
 *
 * The trailing dot and space are not cosmetic: Windows silently drops both from
 * the end of a directory name, so `1080p ` and `1080p` resolve to one folder and
 * two variants land back on top of each other — the exact collision this segment
 * exists to prevent, reintroduced by the OS.
 */
function sanitizeSegment(value: string): string {
  const kept = [...value].filter(
    (ch) => ch >= ' ' && !ILLEGAL_PATH_CHARS.has(ch)
  );
  return kept
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 60);
}

/**
 * The folder that keeps two variants of one title off each other's bytes.
 *
 * Readable rather than hashed, because this is a path a person opens in their
 * file manager and `The Incredible Hulk/3f9a2c14/…` tells them nothing. Two
 * variants that would land on the same readable name are separated by
 * `DownloadService` at enqueue time, which — unlike this function — can see the
 * rest of the queue.
 *
 * Empty when the variant describes nothing, and the caller then omits the
 * folder entirely: a title with one source should not gain a `Source/` level
 * that says nothing and changes where every existing download lives.
 */
export function variantPathSegment(variant: DownloadVariant): string {
  return sanitizeSegment(variantLabel(variant));
}

/** Everything about the viewing context a task needs that the source does not carry. */
export interface DownloadTaskContext {
  title: string;
  parentTitle?: string;
  episodeTitle?: string;
  /** The title's own address — the durable half of the identity. */
  mediaUrl?: string;
  /** The main media/series details page address (for navigating back to original source details). */
  parentMediaUrl?: string;
  providerName?: string;
  mediaType?: string;
  year?: number;
  originalTitle?: string;
  posterUrl?: string;
  season?: number;
  episode?: number;
  /** Used only when the source itself carries no address, e.g. a live stream. */
  fallbackUrl?: string;
}

/**
 * One task, built the same way from every place a download can be started.
 *
 * There were four of these written out inline — the detail page's picker, the
 * player's Download button, and two branches of `App.tsx` — and they disagreed
 * in ways that mattered rather than in style. Two stored `indexerName` as the
 * provider and two stored `providerName`; none stored the language, the release
 * source or the infohash; and each built its own id from the title, which is
 * how four call sites came to share one duplicate-detection bug.
 *
 * Returns null when there is nothing to fetch, which the callers treat as "this
 * source cannot be downloaded" rather than enqueuing a task with no URL.
 */
export function buildDownloadTask(
  source: TorrentResult | null | undefined,
  context: DownloadTaskContext
): DownloadTask | null {
  const url =
    source?.directUrl || source?.magnet || source?.torrentUrl || context.fallbackUrl || '';
  if (!url) return null;

  const taskTitle = context.episodeTitle
    ? `${context.title} - ${context.episodeTitle}`
    : context.title;

  const parentMediaUrl = context.parentMediaUrl || context.mediaUrl || '';
  const parentTitle = context.parentTitle || context.title;

  /**
   * The provider, not the extractor. `indexerName` for an extension link is the
   * file host the provider happened to pick ("Voe", "Server 3"), which changes
   * between resolves of one release — so keying identity or recovery on it
   * makes the same download look like a different one.
   */
  const providerName =
    context.providerName || source?.providerName || source?.indexerName || 'Player Stream';

  const variant = variantFromSource(
    source ?? ({ infoHash: '', title: taskTitle } as TorrentResult),
    { mediaUrl: context.mediaUrl, season: context.season, episode: context.episode }
  );
  variant.directUrl = source?.directUrl || context.fallbackUrl;

  const isTorrent = Boolean(source?.magnet || source?.torrentUrl);

  return {
    id: downloadTaskId(variant),
    variantKey: downloadVariantKey(variant),
    parentId: parentMediaUrl || context.mediaUrl || '',
    title: taskTitle,
    parentTitle,
    parentMediaUrl: parentMediaUrl || undefined,
    episodeNumber: context.episode,
    seasonNumber: context.season,
    episodeTitle: context.episodeTitle,
    mediaType: context.mediaType,
    year: context.year,
    originalTitle: context.originalTitle,
    posterUrl: context.posterUrl || '',
    targetFilePath: '',
    link: {
      source: source?.indexerName || providerName,
      name: source?.title || taskTitle,
      url,
      referer: source?.directHeaders?.Referer || source?.directHeaders?.referer || '',
      quality: source?.parsed?.resolution || 1080,
      isM3u8: source?.isM3u8,
      isDash: source?.isDash,
    },
    headers: source?.directHeaders || {},
    bytesDownloaded: 0,
    totalBytes: source?.sizeBytes || 0,
    downloadSpeed: 0,
    etaSeconds: 0,
    state: 'Queued',
    providerName,
    createdTime: Date.now(),
    mediaUrl: context.mediaUrl,
    resolution: source?.parsed?.resolution,
    quality: source?.parsed?.source,
    sourceInfoHash: source?.infoHash,
    sourceIsTorrent: isTorrent,
    languages: source?.parsed?.languages,
    audioCodecs: source?.parsed?.audioCodecs,
  };
}
