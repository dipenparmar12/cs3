import type { ExtractorLink, SubtitleFile } from './api';

export const DownloadState = {
  Downloading: 'Downloading',
  Queued: 'Queued',
  Paused: 'Paused',
  Completed: 'Completed',
  Failed: 'Failed',
  Retrying: 'Retrying',
  RefreshingSource: 'RefreshingSource',
} as const;
export type DownloadState = (typeof DownloadState)[keyof typeof DownloadState];

export interface DownloadTask {
  /**
   * Derived from {@link DownloadTask.variantKey}, not random.
   *
   * A stable id is what lets a restarted app recognise the download it already
   * holds. See `src/utils/downloadIdentity.ts` for why the key is the media
   * *and* the source variant rather than the media alone.
   */
  id: string;
  parentId: string; // Media item ID
  title: string;
  /** The main series/movie title when this task represents a single episode/part. */
  parentTitle?: string;
  /** Original media source detail page URL (e.g. series details page) used to navigate back. */
  parentMediaUrl?: string;
  episodeNumber?: number;
  seasonNumber?: number;
  episodeTitle?: string;
  mediaType?: string;
  year?: number;
  originalTitle?: string;
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
  /** Media URL / query metadata used to re-resolve expired links. */
  mediaUrl?: string;
  resolution?: number;
  quality?: string;
  retryCount?: number;

  /**
   * Which downloadable variant of the media this is — see
   * `src/utils/downloadIdentity.ts`.
   *
   * Stored rather than recomputed on read so a task written by one version of
   * the app keeps the identity it was enqueued under. Optional because queues
   * persisted before this existed have to keep loading; `DownloadService`
   * backfills them.
   */
  variantKey?: string;

  /**
   * The source's own id, held separately from `link.url`.
   *
   * `link.url` is rewritten in place every time a signed link is re-resolved,
   * so it cannot be part of an identity that has to survive that. For a torrent
   * this is the real infohash and addresses content; for a provider stream it
   * is `ContentService`'s synthetic SHA-1 of the URL and addresses nothing
   * durable — which is exactly why the variant key does not lean on it.
   */
  sourceInfoHash?: string;
  /** True when the source was a magnet or `.torrent`, whose infohash is real. */
  sourceIsTorrent?: boolean;
  /** Release languages, part of what makes a Hindi dub a separate download. */
  languages?: string[];
  audioCodecs?: string[];
}

/** What {@link DownloadRequestResult.action} says actually happened. */
export const DownloadAction = {
  /** Nothing like it existed; a new transfer was queued. */
  Started: 'started',
  /** It was paused or interrupted, and is now running again. */
  Resumed: 'resumed',
  /** It had failed; the source is being re-resolved and the transfer retried. */
  Recovering: 'recovering',
  /** It is already running. The press was a no-op, and says so. */
  Active: 'active',
  /** It is queued behind other transfers. */
  Queued: 'queued',
  /** The file is already on disk. */
  Completed: 'completed',
} as const;
export type DownloadAction = (typeof DownloadAction)[keyof typeof DownloadAction];

/**
 * The answer to "the viewer pressed Download".
 *
 * Pressing Download is a request about a variant, not a command to create a
 * task, so the reply says which of six things happened. The version this
 * replaced returned nothing and the UI guessed — which is how a paused download
 * came to answer `Already downloading` and do nothing at all.
 */
export interface DownloadRequestResult {
  ok: boolean;
  action: DownloadAction;
  /** The task this resolved to, existing or new. */
  taskId?: string;
  /** Ready to show; the caller does not have to phrase six outcomes itself. */
  message: string;
  error?: string;
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
