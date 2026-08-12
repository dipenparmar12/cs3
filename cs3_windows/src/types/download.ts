import type { ExtractorLink, SubtitleFile } from './api';

export const DownloadState = {
  Downloading: 'Downloading',
  Queued: 'Queued',
  Paused: 'Paused',
  Completed: 'Completed',
  Failed: 'Failed',
} as const;
export type DownloadState = (typeof DownloadState)[keyof typeof DownloadState];

export interface DownloadTask {
  id: string; // Unique task GUID or 32-bit Java hashCode string
  parentId: string; // Media item ID
  title: string;
  episodeNumber?: number;
  seasonNumber?: number;
  posterUrl?: string;
  targetFilePath: string;
  link: ExtractorLink;
  headers: Record<string, string>;
  subtitles?: SubtitleFile[];
  bytesDownloaded: number;
  totalBytes: number;
  downloadSpeed: number; // bytes per second
  etaSeconds: number;
  state: DownloadState;
  errorMessage?: string;
  providerName: string;
  createdTime: number;
}

export interface DownloadStatus {
  id: string;
  state: DownloadState;
  bytesDownloaded: number;
  totalBytes: number;
  speed: number;
  eta: number;
  error?: string;
}

export interface DownloadEngine {
  add(task: DownloadTask): Promise<string>;
  pause(id: string): Promise<void>;
  resume(id: string): Promise<void>;
  cancel(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  getStatus(id: string): Promise<DownloadStatus>;
}
