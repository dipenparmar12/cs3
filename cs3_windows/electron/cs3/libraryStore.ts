import type { DatastoreManager } from '../datastore';
import type { TvType } from '../../src/types/api';
import { WatchStatus } from '../../src/types/api';
import type { StoredSource, SourceStatus, LibraryEntry, LibraryItemMetadata } from '../../src/types/library';
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

export type { LibraryEntry, StoredSource, SourceStatus, LibraryItemMetadata };

const ENTRIES_KEY = 'library_entries';
const PROGRESS_KEY = 'watch_progress';
const SOURCE_MEMORY_KEY = 'source_memory';

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
      const seen = newestPerKey.get(row.key);
      if (!seen || row.updatedAt > seen.updatedAt) newestPerKey.set(row.key, row);
    }

    return [...newestPerKey.values()]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit);
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
