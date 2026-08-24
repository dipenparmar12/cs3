import type { ContentService } from '../contentService';
import type { DownloadService } from '../downloadService';
import type { DownloadTask } from '../../src/types/download';
import type { TorrentResult } from '../../src/types/torrent';
import { buildDownloadTask } from '../../src/utils/downloadIdentity.ts';

/**
 * Queues a whole season — or a whole series — from a single choice.
 *
 * Downloading 100 episodes one at a time means 100 source searches and 100
 * picks. The user should make one decision, "get me this season at 1080p", and
 * have the rest happen.
 *
 * This runs in the main process rather than the renderer for a practical
 * reason: resolving sources for a long season takes minutes, and a renderer-side
 * loop would die the moment the user navigated away from the detail page mid-run.
 */

export interface EpisodeRef {
  url: string;
  name?: string;
  season?: number;
  episode?: number;
}

export interface BatchDownloadRequest {
  parentUrl: string;
  title: string;
  posterUrl?: string;
  episodes: EpisodeRef[];
  /**
   * Preferred vertical resolution. The best source at or below this is taken,
   * so asking for 1080p on a season that only has 720p still downloads rather
   * than silently skipping every episode.
   */
  maxResolution?: number;
  /** Skip episodes already queued or downloaded. */
  skipExisting?: boolean;
}

export interface BatchProgress {
  batchId: string;
  total: number;
  resolved: number;
  queued: number;
  skipped: number;
  failed: number;
  currentEpisode?: string;
  finished: boolean;
  cancelled: boolean;
  /** Per-episode outcomes, for a report the user can actually act on. */
  failures: Array<{ episode: string; reason: string }>;
}

/** Pause between episode searches, so a season does not hammer the indexers. */
const SEARCH_SPACING_MS = 600;

export class BatchDownloader {
  private content: ContentService;
  private downloads: DownloadService;
  private notify: ((progress: BatchProgress) => void) | null = null;
  private cancelled = new Set<string>();
  private active = new Map<string, BatchProgress>();

  constructor(content: ContentService, downloads: DownloadService) {
    this.content = content;
    this.downloads = downloads;
  }

  public setNotifier(notify: (progress: BatchProgress) => void): void {
    this.notify = notify;
  }

  public getActive(): BatchProgress[] {
    return [...this.active.values()];
  }

  public cancel(batchId: string): boolean {
    if (!this.active.has(batchId)) return false;
    this.cancelled.add(batchId);
    return true;
  }

  /**
   * Resolves and queues every requested episode.
   *
   * Deliberately sequential. Firing 100 concurrent source searches would get the
   * user rate-limited or banned by the very indexers the app depends on, and the
   * download queue drains one item at a time regardless.
   */
  public async start(request: BatchDownloadRequest): Promise<BatchProgress> {
    const batchId = `batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const progress: BatchProgress = {
      batchId,
      total: request.episodes.length,
      resolved: 0,
      queued: 0,
      skipped: 0,
      failed: 0,
      finished: false,
      cancelled: false,
      failures: [],
    };
    this.active.set(batchId, progress);
    this.emit(progress);

    const existing = new Set(
      this.downloads.getTasks().map((t) => `${t.parentId}|${t.seasonNumber ?? 0}|${t.episodeNumber ?? 0}`)
    );

    for (const episode of request.episodes) {
      if (this.cancelled.has(batchId)) {
        progress.cancelled = true;
        break;
      }

      const label = episodeLabel(episode);
      progress.currentEpisode = label;

      const key = `${request.parentUrl}|${episode.season ?? 0}|${episode.episode ?? 0}`;
      if (request.skipExisting !== false && existing.has(key)) {
        progress.skipped++;
        progress.resolved++;
        this.emit(progress);
        continue;
      }

      try {
        const response = await this.content.getSources({
          mediaUrl: episode.url,
          season: episode.season,
          episode: episode.episode,
          titleOverride: request.title,
        });

        const choice = pickSource(response.sources, request.maxResolution);
        if (!choice) {
          progress.failed++;
          progress.failures.push({
            episode: label,
            reason: response.emptyReason ?? 'No source matched the requested quality.',
          });
        } else {
          const task = buildTask(request, episode, choice);
          if (task) {
            /**
             * `request`, not `enqueue`: re-running a season download after a
             * few episodes failed is the common case, and this way the ones
             * already on disk are recognised and the failed ones are recovered
             * rather than duplicated.
             */
            await this.downloads.request(task);
            progress.queued++;
          } else {
            progress.failed++;
            progress.failures.push({
              episode: label,
              reason: 'That source carries no address to download from.',
            });
          }
        }
      } catch (error) {
        progress.failed++;
        progress.failures.push({
          episode: label,
          reason: error instanceof Error ? error.message : String(error),
        });
      }

      progress.resolved++;
      this.emit(progress);

      if (progress.resolved < progress.total) {
        await delay(SEARCH_SPACING_MS);
      }
    }

    progress.finished = true;
    progress.currentEpisode = undefined;
    this.emit(progress);
    this.cancelled.delete(batchId);
    this.active.delete(batchId);
    return progress;
  }

  private emit(progress: BatchProgress): void {
    try {
      // A structured clone crossing IPC must not alias the live object, or the
      // renderer can observe a half-mutated progress record.
      this.notify?.({ ...progress, failures: [...progress.failures] });
    } catch {
      // A dead renderer must not abort a running batch.
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function episodeLabel(episode: EpisodeRef): string {
  const s = episode.season != null ? `S${String(episode.season).padStart(2, '0')}` : '';
  const e = episode.episode != null ? `E${String(episode.episode).padStart(2, '0')}` : '';
  return `${s}${e}${episode.name ? ` ${episode.name}` : ''}`.trim() || episode.url;
}

/**
 * Chooses the best source at or below the requested resolution.
 *
 * Sources arrive already ranked, so the first match is the ranked pick rather
 * than merely the highest resolution — seeders and release quality have already
 * been weighed. When nothing meets the cap, the ranked best is used instead of
 * skipping the episode: a user who asked for 1080p wants the episode more than
 * they want the exact number.
 */
function pickSource(sources: TorrentResult[], maxResolution?: number): TorrentResult | null {
  if (!sources || sources.length === 0) return null;
  if (!maxResolution) return sources[0];

  const withinCap = sources.filter((s) => (s.parsed.resolution ?? 0) <= maxResolution);
  return withinCap[0] ?? sources[0];
}

/**
 * One episode's task, built exactly as a single download would be.
 *
 * The version this replaced also stamped the batch id into `providerName`
 * (`Gdshine (batch-1755…)`), which nothing ever read and which broke two things
 * that do read it: source recovery compares that field against a provider name
 * and never matched, and the download's identity changed on every batch run, so
 * re-running a season queued a second copy of every episode already in it.
 */
function buildTask(
  request: BatchDownloadRequest,
  episode: EpisodeRef,
  source: TorrentResult
): DownloadTask | null {
  return buildDownloadTask(source, {
    title: request.title,
    mediaUrl: episode.url,
    posterUrl: request.posterUrl,
    season: episode.season,
    episode: episode.episode,
  });
}
