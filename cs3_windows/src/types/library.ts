import type { TvType, WatchStatus } from './api';
import type { ParsedRelease } from './torrent';

/**
 * Standardized source statuses for persistent media library & history.
 */
export const SourceStatus = {
  Unknown: 'Unknown',
  Available: 'Available',
  Selected: 'Selected',
  Playing: 'Playing',
  Played: 'Played',
  Failed: 'Failed',
  Expired: 'Expired',
  Downloadable: 'Downloadable',
  Downloaded: 'Downloaded',
  Unavailable: 'Unavailable',
} as const;
export type SourceStatus = (typeof SourceStatus)[keyof typeof SourceStatus];

/**
 * Stored source-of-truth metadata persisted with a Library item.
 * Preserves full provider identity, quality, and capabilities independently
 * of temporary direct URLs.
 */
export interface StoredSource {
  id: string;
  infoHash?: string;
  title: string;
  sourceName?: string;
  providerName?: string;
  indexerId?: string;
  indexerName?: string;
  repository?: string;
  extension?: string;
  directUrl?: string;
  directHeaders?: Record<string, string>;
  isM3u8?: boolean;
  magnet?: string;
  torrentUrl?: string;
  resolution?: number;
  quality?: string;
  videoCodec?: string;
  audioCodecs?: string[];
  languages?: string[];
  sizeBytes?: number;
  seeders?: number;
  leechers?: number;
  status: SourceStatus;
  capabilities?: {
    canPlay?: boolean;
    canDownload?: boolean;
  };
  parsed?: ParsedRelease;
  score?: number;
  scoreReasons?: string[];
  discoveredAt: number;
  expiresAt?: number;
  lastCheckedAt?: number;
  failureReason?: string;
}

export interface LibraryItemMetadata {
  imdbId?: string;
  tmdbId?: string;
  anilistId?: string;
  seasonsCount?: number;
  episodesCount?: number;
  provider?: string;
  tags?: string[];
}

export interface LibraryEntry {
  /** Stable canonical key across providers: canonicalKey(title, year). */
  key: string;
  title: string;
  originalTitle?: string;
  year?: number;
  type?: TvType;
  posterUrl?: string;
  backdropUrl?: string;
  plot?: string;
  genres?: string[];
  duration?: string;
  /** Every provider URL seen for this title. */
  urls: string[];
  status: WatchStatus;
  userRating?: number;
  addedAt: number;
  updatedAt: number;
  /** Persisted discovered sources associated with this library item. */
  sources?: StoredSource[];
  lastSourcesRefreshedAt?: number;
  metadata?: LibraryItemMetadata;
}

/**
 * The exact source that played, kept so it can be played again.
 *
 * The library already remembers *what* was watched. This remembers **which
 * stream delivered it** — which provider, from which extension in which
 * repository, at what quality, and the link itself.
 *
 * The distinction from {@link StoredSource} in `LibraryEntry.sources` is
 * intent, not shape. That list is everything discovery *found*, refreshed
 * wholesale and expected to churn. This is the one entry that was proved to
 * work by playing it, and it survives a refresh that replaces the list.
 *
 * **The link is stored as a cached value, never as the identity.** A provider
 * URL is a temporary address on someone else's CDN, signed and typically good
 * for minutes; treating it as what the record *is* would make every saved
 * source dead within the hour. The durable half is `origin` — the query that
 * produced it — which can be replayed to obtain a fresh link for the same
 * release. That is why both are here.
 */
export interface PlayedSource {
  /** Canonical library key: `canonicalKey(title, year)`. */
  key: string;
  season?: number;
  episode?: number;

  /** Provider identity, quality, capabilities, and the link with its deadline. */
  source: StoredSource;

  /**
   * What to replay when the link has died.
   *
   * Without this a saved source is a URL and nothing else — recoverable only by
   * the user finding the title again by hand, which is exactly the work this
   * feature exists to remove.
   */
  origin: {
    /** The provider URL the detail page was loaded from. */
    mediaUrl: string;
    title: string;
    year?: number;
    episodeTitle?: string;
  };

  /**
   * When it last actually played — not when it was chosen.
   *
   * A source picked and then abandoned because it would not start is not a
   * source that worked, and recording it as one would send the viewer straight
   * back to a stream that already failed them.
   */
  playedAt: number;
  /** How far in, so "play the source that worked" can also resume. */
  positionSeconds?: number;
  durationSeconds?: number;
  /** Bumped each time it plays; a source that keeps working is worth ranking up. */
  playCount: number;
}

/** Why a saved source could not simply be reused. */
export type PlayedSourceResolution =
  /** The stored link is still good and was used as-is. */
  | 'reused'
  /** The link had expired or died; the same release was re-resolved. */
  | 'refreshed'
  /** The release is gone from the provider; nothing equivalent was found. */
  | 'unavailable';
