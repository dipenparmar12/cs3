import type { DatastoreManager } from '../datastore';
import type { TvType } from '../../src/types/api';
import { WatchStatus } from '../../src/types/api';
import type {
  StoredSource,
  SourceStatus,
  LibraryEntry,
  LibraryItemMetadata,
  PlayedSource,
} from '../../src/types/library';
import type { TorrentResult } from '../../src/types/torrent';
import { deadlineFromUrl } from '../sourceCache';

export { WatchStatus };

export interface WatchProgress {
  key: string;
  season?: number;
  episode?: number;
  positionSeconds: number;
  durationSeconds: number;
  updatedAt: number;
  /** Set once the position passes the completion threshold. */
  completed: boolean;
  /** Denormalised for rendering a resume row without a second lookup. */
  title: string;
  episodeTitle?: string;
  posterUrl?: string;
  /** A provider URL that plays this item, for resuming without a search. */
  mediaUrl: string;
  /**
   * When the viewer removed this from Continue Watching.
   *
   * A dismissal, deliberately, rather than deleting the progress. "Remove this
   * from the row" and "forget where I was" are different intentions, and the
   * destructive reading of the first is unrecoverable: someone tidying their
   * home screen would silently lose the resume point on a film they were
   * halfway through.
   *
   * Compared against `updatedAt` rather than being a boolean, which is what
   * makes "Play again" work with no extra machinery: watching more of the title
   * moves `updatedAt` past the dismissal and the row comes back on its own.
   */
  dismissedAt?: number;
}

/** The source the user chose last time, so the same pick can be reused. */
export interface SourceMemory {
  key: string;
  season?: number;
  episode?: number;
  infoHash: string;
  sourceTitle: string;
  indexerName: string;
  resolution?: number;
  magnet?: string;
  chosenAt: number;
}

export type { LibraryEntry, StoredSource, SourceStatus, LibraryItemMetadata, PlayedSource };

const ENTRIES_KEY = 'library_entries';
const PROGRESS_KEY = 'watch_progress';
const SOURCE_MEMORY_KEY = 'source_memory';
/** The source that actually played, per title/season/episode. See `PlayedSource`. */
const PLAYED_SOURCE_KEY = 'played_sources';

/**
 * Cap on remembered played sources, oldest evicted first.
 *
 * These live in the datastore that Android backups round-trip through, so an
 * unbounded list grows someone's backup file without limit.
 */
const MAX_PLAYED_SOURCES = 400;

/**
 * Fraction of the runtime past which an item counts as finished.
 */
const COMPLETION_THRESHOLD = 0.92;

/** Below this, playback is treated as "not really started" and is not resumed. */
const RESUME_FLOOR_SECONDS = 30;

/** Cap on retained progress rows, oldest evicted first. */
const MAX_PROGRESS_ROWS = 500;

/**
 * Derives a provider-independent identity for a title.
 */
export function canonicalKey(title: string, year?: number): string {
  const normalised = title
    .toLowerCase()
    .replace(/\(\d{4}\)/g, '')
    .replace(/\b(19|20)\d{2}\b/g, '')
    // Release-tag noise that providers append to titles.
    .replace(/\b(1080p|720p|2160p|4k|hdr|web-?dl|bluray|x264|x265|hevc)\b/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/^(the|a|an)\s+/, '')
    .replace(/\s+/g, '-');

  return year ? `${normalised}:${year}` : normalised;
}

/**
 * Converts a live TorrentResult into a durable StoredSource for Library persistence.
 */
export function torrentResultToStoredSource(res: TorrentResult): StoredSource {
  const expiresAt = res.directUrl
    ? deadlineFromUrl(res.directUrl) ?? Date.now() + 20 * 60 * 1000
    : undefined;
  const isExpired = expiresAt ? expiresAt < Date.now() : false;

  return {
    id: res.infoHash || `src-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    infoHash: res.infoHash,
    title: res.title,
    sourceName: res.indexerName || res.providerName || 'Unknown Source',
    providerName: res.providerName,
    indexerId: res.indexerId,
    indexerName: res.indexerName,
    directUrl: res.directUrl,
    directHeaders: res.directHeaders,
    isM3u8: res.isM3u8,
    magnet: res.magnet,
    torrentUrl: res.torrentUrl,
    resolution: res.parsed?.resolution,
    quality: res.parsed?.resolution ? `${res.parsed.resolution}p` : undefined,
    videoCodec: res.parsed?.videoCodec,
    audioCodecs: res.parsed?.audioCodecs,
    languages: res.parsed?.languages,
    sizeBytes: res.sizeBytes,
    seeders: res.seeders,
    leechers: res.leechers,
    status: isExpired ? 'Expired' : 'Available',
    capabilities: {
      canPlay: true,
      canDownload: Boolean(res.directUrl || res.magnet),
    },
    parsed: res.parsed,
    score: res.score,
    scoreReasons: res.scoreReasons,
    discoveredAt: Date.now(),
    expiresAt,
  };
}

/**
 * Converts a StoredSource back into a TorrentResult format for playback or download.
 */
export function storedSourceToTorrentResult(src: StoredSource): TorrentResult {
  return {
    infoHash: src.infoHash || src.id,
    directUrl: src.directUrl,
    directHeaders: src.directHeaders,
    isM3u8: src.isM3u8,
    title: src.title,
    magnet: src.magnet || '',
    torrentUrl: src.torrentUrl,
    sizeBytes: src.sizeBytes || 0,
    seeders: src.seeders || 1,
    leechers: src.leechers || 0,
    indexerId: src.indexerId || 'library',
    indexerName: src.indexerName || src.sourceName || 'Stored source',
    providerName: src.providerName,
    parsed: src.parsed || {
      cleanTitle: src.title,
      resolution: (src.resolution as any) || 0,
      source: 'Unknown' as any,
      videoCodec: (src.videoCodec as any) || 'Unknown',
      audioCodecs: src.audioCodecs || [],
      hdr: [],
      languages: src.languages || [],
      isMultiAudio: (src.audioCodecs?.length ?? 0) > 1,
      isDualAudio: (src.audioCodecs?.length ?? 0) === 2,
      hasHardcodedSubs: false,
      isRepack: false,
      isProper: false,
      isRemastered: false,
      is3D: false,
      isSeasonPack: false,
      isCompleteSeries: false,
    },
    score: src.score || 0,
    scoreReasons: src.scoreReasons || ['Restored from saved Library sources'],
  };
}

export class LibraryStore {
  private datastore: DatastoreManager;
  private entries = new Map<string, LibraryEntry>();
  private progress = new Map<string, WatchProgress>();
  private sources = new Map<string, SourceMemory>();

  constructor(datastore: DatastoreManager) {
    this.datastore = datastore;
    this.restore();
  }

  private restore(): void {
    const entries = this.datastore.getObject<LibraryEntry[]>(ENTRIES_KEY, []);
    if (Array.isArray(entries)) for (const e of entries) if (e?.key) this.entries.set(e.key, e);

    const progress = this.datastore.getObject<WatchProgress[]>(PROGRESS_KEY, []);
    if (Array.isArray(progress)) for (const p of progress) this.progress.set(progressId(p), p);

    const sources = this.datastore.getObject<SourceMemory[]>(SOURCE_MEMORY_KEY, []);
    if (Array.isArray(sources)) for (const s of sources) this.sources.set(progressId(s), s);
  }

  private persistEntries(): void {
    this.datastore.setObject(ENTRIES_KEY, [...this.entries.values()]);
  }

  private persistProgress(): void {
    const rows = [...this.progress.values()].sort((a, b) => b.updatedAt - a.updatedAt);
    if (rows.length > MAX_PROGRESS_ROWS) {
      const keep = rows.slice(0, MAX_PROGRESS_ROWS);
      this.progress = new Map(keep.map((p) => [progressId(p), p]));
      this.datastore.setObject(PROGRESS_KEY, keep);
      return;
    }
    this.datastore.setObject(PROGRESS_KEY, rows);
  }

  private persistSources(): void {
    this.datastore.setObject(SOURCE_MEMORY_KEY, [...this.sources.values()]);
  }

  // --- library entries -----------------------------------------------------

  public upsertEntry(input: {
    title: string;
    originalTitle?: string;
    year?: number;
    type?: TvType;
    posterUrl?: string;
    backdropUrl?: string;
    plot?: string;
    genres?: string[];
    duration?: string;
    mediaUrl: string;
    status?: WatchStatus;
    sources?: StoredSource[];
    metadata?: LibraryItemMetadata;
  }): LibraryEntry {
    const key = canonicalKey(input.title, input.year);
    const now = Date.now();
    const existing = this.entries.get(key);

    const mergedSources = input.sources && input.sources.length > 0
      ? input.sources
      : existing?.sources;

    const entry: LibraryEntry = existing
      ? {
          ...existing,
          originalTitle: input.originalTitle ?? existing.originalTitle,
          posterUrl: input.posterUrl ?? existing.posterUrl,
          backdropUrl: input.backdropUrl ?? existing.backdropUrl,
          plot: input.plot ?? existing.plot,
          genres: input.genres ?? existing.genres,
          duration: input.duration ?? existing.duration,
          type: input.type ?? existing.type,
          urls: existing.urls.includes(input.mediaUrl)
            ? existing.urls
            : [...existing.urls, input.mediaUrl],
          status: input.status ?? existing.status,
          sources: mergedSources,
          metadata: { ...existing.metadata, ...input.metadata },
          updatedAt: now,
        }
      : {
          key,
          title: input.title,
          originalTitle: input.originalTitle,
          year: input.year,
          type: input.type,
          posterUrl: input.posterUrl,
          backdropUrl: input.backdropUrl,
          plot: input.plot,
          genres: input.genres,
          duration: input.duration,
          urls: [input.mediaUrl],
          status: input.status ?? WatchStatus.Watching,
          sources: input.sources,
          metadata: input.metadata,
          addedAt: now,
          updatedAt: now,
        };

    this.entries.set(key, entry);
    this.persistEntries();
    return entry;
  }

  public setStatus(key: string, status: WatchStatus): LibraryEntry | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    entry.status = status;
    entry.updatedAt = Date.now();
    this.persistEntries();
    return entry;
  }

  public setUserRating(key: string, rating: number | undefined): LibraryEntry | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    entry.userRating = rating;
    entry.updatedAt = Date.now();
    this.persistEntries();
    return entry;
  }

  public removeEntry(key: string): boolean {
    const removed = this.entries.delete(key);
    if (removed) {
      for (const [id, p] of this.progress) if (p.key === key) this.progress.delete(id);
      this.persistEntries();
      this.persistProgress();
    }
    return removed;
  }

  public getEntries(status?: WatchStatus): LibraryEntry[] {
    const all = [...this.entries.values()];
    const filtered = status ? all.filter((e) => e.status === status) : all;
    return filtered.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  public getEntry(key: string): LibraryEntry | null {
    return this.entries.get(key) ?? null;
  }

  public getEntryForUrl(mediaUrl: string): LibraryEntry | null {
    for (const entry of this.entries.values()) {
      if (entry.urls.includes(mediaUrl)) return entry;
    }
    return null;
  }

  // --- source persistence --------------------------------------------------

  public setSources(key: string, sources: StoredSource[]): StoredSource[] {
    const entry = this.entries.get(key);
    if (!entry) return sources;
    entry.sources = sources;
    entry.lastSourcesRefreshedAt = Date.now();
    entry.updatedAt = Date.now();
    this.persistEntries();
    return sources;
  }

  public getStoredSources(key: string): StoredSource[] {
    const entry = this.entries.get(key);
    return entry?.sources ?? [];
  }

  public updateSourceStatus(
    key: string,
    sourceId: string,
    status: SourceStatus,
    failureReason?: string
  ): void {
    const entry = this.entries.get(key);
    if (!entry || !entry.sources) return;

    let modified = false;
    for (const s of entry.sources) {
      if (s.id === sourceId || s.infoHash === sourceId) {
        s.status = status;
        s.lastCheckedAt = Date.now();
        if (failureReason) s.failureReason = failureReason;
        modified = true;
      }
    }
    if (modified) {
      entry.updatedAt = Date.now();
      this.persistEntries();
    }
  }

  // --- the source that actually played ------------------------------------

  /**
   * Records that this exact source delivered playback.
   *
   * Called once a stream has genuinely started, never when one is merely
   * selected — {@link SourceMemory} already covers "what the viewer picked",
   * and the two are different claims. A release that is chosen and then fails
   * to start is not a release that works, and saving it as one sends the viewer
   * straight back to a stream that already failed them.
   *
   * Re-recording the same source updates it in place and bumps `playCount`
   * rather than appending: this is one slot per (title, season, episode), which
   * is the question it answers — "what played this, last time?".
   */
  public recordPlayedSource(input: {
    key: string;
    season?: number;
    episode?: number;
    source: StoredSource;
    origin: PlayedSource['origin'];
    positionSeconds?: number;
    durationSeconds?: number;
  }): PlayedSource {
    const played = this.loadPlayedSources();
    const slot = LibraryStore.playedSlot(input.key, input.season, input.episode);
    const existing = played.get(slot);

    /**
     * The link is refreshed on every play, the identity is not.
     *
     * A source re-resolved through a new provider call carries a new signed URL
     * for the same release, and that is the value worth keeping — while
     * `playCount` and the original discovery time describe the release across
     * all of them.
     */
    const record: PlayedSource = {
      key: input.key,
      season: input.season,
      episode: input.episode,
      source: {
        ...input.source,
        status: 'Played',
        lastCheckedAt: Date.now(),
        failureReason: undefined,
      },
      origin: input.origin,
      playedAt: Date.now(),
      positionSeconds: input.positionSeconds,
      durationSeconds: input.durationSeconds,
      playCount: (existing?.playCount ?? 0) + 1,
    };

    played.set(slot, record);
    this.persistPlayedSources(played);
    return record;
  }

  public getPlayedSource(key: string, season?: number, episode?: number): PlayedSource | null {
    return this.loadPlayedSources().get(LibraryStore.playedSlot(key, season, episode)) ?? null;
  }

  /**
   * Every remembered source, newest first.
   *
   * The library screen's answer to "which of my titles have I actually got a
   * working stream for, and where did it come from?".
   */
  public listPlayedSources(limit = 200): PlayedSource[] {
    return [...this.loadPlayedSources().values()]
      .sort((a, b) => b.playedAt - a.playedAt)
      .slice(0, limit);
  }

  /** Every remembered source for one title, across its episodes. */
  public getPlayedSourcesForKey(key: string): PlayedSource[] {
    return [...this.loadPlayedSources().values()]
      .filter((record) => record.key === key)
      .sort((a, b) => (a.season ?? 0) - (b.season ?? 0) || (a.episode ?? 0) - (b.episode ?? 0));
  }

  /**
   * Replaces the stored link after a re-resolve, keeping everything else.
   *
   * The release did not change — its provider, quality and identity are the
   * same — so overwriting the whole record would throw away `playCount` and the
   * original `playedAt` to save one URL.
   */
  public updatePlayedSourceLink(
    key: string,
    source: Pick<StoredSource, 'directUrl' | 'directHeaders' | 'magnet' | 'expiresAt' | 'isM3u8'>,
    season?: number,
    episode?: number
  ): PlayedSource | null {
    const played = this.loadPlayedSources();
    const slot = LibraryStore.playedSlot(key, season, episode);
    const record = played.get(slot);
    if (!record) return null;

    record.source = {
      ...record.source,
      ...source,
      status: 'Played',
      lastCheckedAt: Date.now(),
      failureReason: undefined,
    };
    played.set(slot, record);
    this.persistPlayedSources(played);
    return record;
  }

  /**
   * Marks a saved source as no longer obtainable.
   *
   * Kept rather than deleted, and that is deliberate. "This is the release that
   * used to work and the provider no longer has it" is more useful than the
   * entry silently vanishing, which reads as the app having forgotten. The UI
   * can offer to find something else from the same title.
   */
  public markPlayedSourceUnavailable(
    key: string,
    reason: string,
    season?: number,
    episode?: number
  ): void {
    const played = this.loadPlayedSources();
    const slot = LibraryStore.playedSlot(key, season, episode);
    const record = played.get(slot);
    if (!record) return;

    record.source = {
      ...record.source,
      status: 'Unavailable',
      failureReason: reason,
      lastCheckedAt: Date.now(),
    };
    played.set(slot, record);
    this.persistPlayedSources(played);
  }

  public forgetPlayedSource(key: string, season?: number, episode?: number): boolean {
    const played = this.loadPlayedSources();
    const removed = played.delete(LibraryStore.playedSlot(key, season, episode));
    if (removed) this.persistPlayedSources(played);
    return removed;
  }

  /**
   * One slot per episode, not per title.
   *
   * A series is watched an episode at a time and each one resolves to its own
   * release; keying on the title alone would have episode 6 overwrite the
   * source that played episode 5.
   */
  private static playedSlot(key: string, season?: number, episode?: number): string {
    return `${key}::${season ?? ''}::${episode ?? ''}`;
  }

  private loadPlayedSources(): Map<string, PlayedSource> {
    const stored = this.datastore.getObject<PlayedSource[]>(PLAYED_SOURCE_KEY, []);
    const map = new Map<string, PlayedSource>();
    for (const record of Array.isArray(stored) ? stored : []) {
      if (!record?.key || !record.source) continue;
      map.set(LibraryStore.playedSlot(record.key, record.season, record.episode), record);
    }
    return map;
  }

  private persistPlayedSources(played: Map<string, PlayedSource>): void {
    /**
     * Bounded, oldest-played evicted first. Each record is a fraction of a KB,
     * but this lives in the datastore that Android backups round-trip through,
     * and an unbounded list there grows a user's backup without limit.
     */
    const all = [...played.values()].sort((a, b) => b.playedAt - a.playedAt);
    this.datastore.setObject(PLAYED_SOURCE_KEY, all.slice(0, MAX_PLAYED_SOURCES));
  }

  // --- watch progress ------------------------------------------------------

  public recordProgress(input: {
    title: string;
    year?: number;
    mediaUrl: string;
    posterUrl?: string;
    episodeTitle?: string;
    season?: number;
    episode?: number;
    positionSeconds: number;
    durationSeconds: number;
    type?: TvType;
  }): WatchProgress | null {
    if (!Number.isFinite(input.positionSeconds) || !Number.isFinite(input.durationSeconds)) {
      return null;
    }
    if (input.durationSeconds <= 0) return null;

    const key = canonicalKey(input.title, input.year);
    const id = progressId({ key, season: input.season, episode: input.episode });
    const existing = this.progress.get(id);

    if (
      existing &&
      input.positionSeconds < RESUME_FLOOR_SECONDS &&
      existing.positionSeconds > RESUME_FLOOR_SECONDS
    ) {
      return existing;
    }

    const completed = input.positionSeconds / input.durationSeconds >= COMPLETION_THRESHOLD;

    const row: WatchProgress = {
      key,
      season: input.season,
      episode: input.episode,
      positionSeconds: input.positionSeconds,
      durationSeconds: input.durationSeconds,
      updatedAt: Date.now(),
      completed,
      title: input.title,
      episodeTitle: input.episodeTitle,
      posterUrl: input.posterUrl,
      mediaUrl: input.mediaUrl,
    };

    this.progress.set(id, row);
    this.persistProgress();

    const entry = this.entries.get(key);
    if (!entry) {
      this.upsertEntry({
        title: input.title,
        year: input.year,
        type: input.type,
        posterUrl: input.posterUrl,
        mediaUrl: input.mediaUrl,
        status: WatchStatus.Watching,
      });
    } else if (entry.status === WatchStatus.PlanToWatch) {
      entry.status = WatchStatus.Watching;
      entry.updatedAt = Date.now();
      this.persistEntries();
    }

    return row;
  }

  public getProgress(key: string, season?: number, episode?: number): WatchProgress | null {
    return this.progress.get(progressId({ key, season, episode })) ?? null;
  }

  public getProgressForKey(key: string): WatchProgress[] {
    return [...this.progress.values()].filter((p) => p.key === key);
  }

  public getContinueWatching(limit = 20): WatchProgress[] {
    const newestPerKey = new Map<string, WatchProgress>();

    for (const row of this.progress.values()) {
      if (row.completed) continue;
      if (row.positionSeconds < RESUME_FLOOR_SECONDS) continue;
      // Dismissed, and not watched since. See `dismissedAt`.
      if (row.dismissedAt !== undefined && row.dismissedAt >= row.updatedAt) continue;
      const seen = newestPerKey.get(row.key);
      if (!seen || row.updatedAt > seen.updatedAt) newestPerKey.set(row.key, row);
    }

    return [...newestPerKey.values()]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit);
  }

  /**
   * Takes one title off the Continue Watching row, keeping where it got to.
   *
   * Applied to every episode of the title rather than to one row, because the
   * row is *per title* — it shows the newest episode of a series as one card,
   * so dismissing only that episode would put the previous one back in its
   * place, which reads as the remove button not working.
   */
  public dismissFromContinueWatching(key: string): boolean {
    const at = Date.now();
    let changed = false;
    for (const row of this.progress.values()) {
      if (row.key !== key) continue;
      row.dismissedAt = at;
      changed = true;
    }
    if (changed) this.persistProgress();
    return changed;
  }

  /**
   * Empties the row without touching a single watch position.
   *
   * The confirmation says exactly this, because a "clear all" that people
   * expect to be destructive and is not would be its own surprise — and one
   * they would discover by finding their positions intact, which is the good
   * direction to be wrong in.
   */
  public clearContinueWatching(): number {
    const at = Date.now();
    let cleared = 0;
    for (const row of this.progress.values()) {
      if (row.completed) continue;
      if (row.dismissedAt !== undefined && row.dismissedAt >= row.updatedAt) continue;
      row.dismissedAt = at;
      cleared++;
    }
    if (cleared > 0) this.persistProgress();
    return cleared;
  }

  public clearProgress(key: string, season?: number, episode?: number): boolean {
    if (season === undefined && episode === undefined) {
      let removed = false;
      for (const [id, p] of this.progress) {
        if (p.key === key) {
          this.progress.delete(id);
          removed = true;
        }
      }
      if (removed) this.persistProgress();
      return removed;
    }
    const removed = this.progress.delete(progressId({ key, season, episode }));
    if (removed) this.persistProgress();
    return removed;
  }

  // --- source memory -------------------------------------------------------

  public rememberSource(input: Omit<SourceMemory, 'chosenAt'>): void {
    this.sources.set(progressId(input), { ...input, chosenAt: Date.now() });
    this.persistSources();
  }

  public recallSource(key: string, season?: number, episode?: number): SourceMemory | null {
    return this.sources.get(progressId({ key, season, episode })) ?? null;
  }

  // --- portability ---------------------------------------------------------

  public exportAll(): {
    entries: LibraryEntry[];
    progress: WatchProgress[];
    sources: SourceMemory[];
  } {
    return {
      entries: [...this.entries.values()],
      progress: [...this.progress.values()],
      sources: [...this.sources.values()],
    };
  }

  public importAll(payload: {
    entries?: LibraryEntry[];
    progress?: WatchProgress[];
    sources?: SourceMemory[];
  }): { entries: number; progress: number; sources: number } {
    let entryCount = 0;
    let progressCount = 0;
    let sourceCount = 0;

    for (const entry of payload.entries ?? []) {
      if (!entry?.key) continue;
      const existing = this.entries.get(entry.key);
      if (!existing || entry.updatedAt > existing.updatedAt) {
        this.entries.set(entry.key, {
          ...entry,
          urls: [...new Set([...(existing?.urls ?? []), ...(entry.urls ?? [])])],
        });
        entryCount++;
      }
    }

    for (const row of payload.progress ?? []) {
      if (!row?.key) continue;
      const id = progressId(row);
      const existing = this.progress.get(id);
      if (!existing || row.updatedAt > existing.updatedAt) {
        this.progress.set(id, row);
        progressCount++;
      }
    }

    for (const source of payload.sources ?? []) {
      if (!source?.key) continue;
      const id = progressId(source);
      const existing = this.sources.get(id);
      if (!existing || source.chosenAt > existing.chosenAt) {
        this.sources.set(id, source);
        sourceCount++;
      }
    }

    this.persistEntries();
    this.persistProgress();
    this.persistSources();
    return { entries: entryCount, progress: progressCount, sources: sourceCount };
  }
}

function progressId(row: { key: string; season?: number; episode?: number }): string {
  return `${row.key}|${row.season ?? ''}|${row.episode ?? ''}`;
}
