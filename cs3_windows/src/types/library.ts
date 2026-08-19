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
