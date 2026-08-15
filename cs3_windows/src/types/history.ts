import type { TvType } from './api';
import type { SourceStatus, StoredSource } from './library';

export const HistoryAction = {
  PlaybackAttempt: 'playback_attempt',
  PlaybackStarted: 'playback_started',
  PlaybackCompleted: 'playback_completed',
  PlaybackStopped: 'playback_stopped',
  PlaybackFailed: 'playback_failed',
  DownloadStarted: 'download_started',
  DownloadCompleted: 'download_completed',
  DownloadFailed: 'download_failed',
  DownloadCancelled: 'download_cancelled',
  SourceSelected: 'source_selected',
  DetailOpened: 'detail_opened',
  LibraryAdded: 'library_added',
  LibraryRemoved: 'library_removed',
} as const;
export type HistoryAction = (typeof HistoryAction)[keyof typeof HistoryAction];

export const HistoryStatus = {
  Played: 'Played',
  Failed: 'Failed',
  Downloaded: 'Downloaded',
  DownloadFailed: 'Download Failed',
  Attempted: 'Attempted',
  Unchecked: 'Unchecked',
  Unknown: 'Unknown',
} as const;
export type HistoryStatus = (typeof HistoryStatus)[keyof typeof HistoryStatus];

export interface HistorySourceInfo {
  sourceId?: string;
  sourceName?: string;
  providerName?: string;
  indexerName?: string;
  repository?: string;
  extension?: string;
  resolution?: number;
  quality?: string;
  videoCodec?: string;
  audioCodecs?: string[];
  languages?: string[];
  directUrl?: string;
  directHeaders?: Record<string, string>;
  isM3u8?: boolean;
  magnet?: string;
  sizeBytes?: number;
  seeders?: number;
  leechers?: number;
  status?: SourceStatus | string;
  failureReason?: string;
}

export interface HistoryDiagnostics {
  stage?: string;
  code?: string;
  details?: string;
  probeVideoCodec?: string;
  probeAudioCodec?: string;
  needsVideoTranscode?: boolean;
  needsAudioTranscode?: boolean;
}

export interface HistoryEvent {
  id: string;
  mediaKey: string;
  title: string;
  originalTitle?: string;
  year?: number;
  type?: TvType | string;
  posterUrl?: string;
  backdropUrl?: string;
  mediaUrl: string;
  season?: number;
  episode?: number;
  episodeTitle?: string;

  action: HistoryAction;
  status: HistoryStatus;
  timestamp: number;
  endedAt?: number;
  durationSeconds?: number;
  positionSeconds?: number;

  source?: HistorySourceInfo;
  sourcesDiscovered?: StoredSource[];
  failureReason?: string;
  diagnostics?: HistoryDiagnostics;
  metadata?: Record<string, any>;
}

export interface HistoryFilter {
  status?: HistoryStatus | 'All';
  type?: 'all' | 'movie' | 'series' | 'anime';
  action?: HistoryAction;
  provider?: string;
  query?: string;
  startDate?: number;
  endDate?: number;
  limit?: number;
  offset?: number;
  sortBy?: 'recent' | 'oldest' | 'played' | 'failed' | 'downloaded';
}

export interface HistoryStats {
  total: number;
  played: number;
  failed: number;
  downloaded: number;
  attempted: number;
  unchecked: number;
}

export interface HistoryListResponse {
  items: HistoryEvent[];
  total: number;
  hasMore: boolean;
}
