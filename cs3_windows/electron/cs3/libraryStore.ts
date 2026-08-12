import type { DatastoreManager } from '../datastore';
import type { TvType } from '../../src/types/api';

/**
 * Watch state, library buckets, and the memory of what the user already chose.
 *
 * Three problems this solves, all of which the app had in some form:
 *
 * 1. **The library was fabricated.** It listed two hardcoded titles with stock
 *    photography. Nothing the user watched was ever recorded.
 * 2. **The same title appears many times.** A movie found through five providers
 *    is five cards. Progress recorded against one of them must be visible on all
 *    five, or "continue watching" misses the entry the user actually clicks.
 * 3. **Every playback re-resolved from scratch.** The source the user picked
 *    last night is knowable; making them search and choose again is wasted work.
 *
 * The identity that ties it together is a canonical key derived from the title
 * and year, not the provider URL — see {@link canonicalKey}.
 */

export const WatchStatus = {
  Watching: 'Watching',
  Completed: 'Completed',
  OnHold: 'OnHold',
  PlanToWatch: 'PlanToWatch',
  Dropped: 'Dropped',
} as const;
export type WatchStatus = (typeof WatchStatus)[keyof typeof WatchStatus];

export interface LibraryEntry {
  /** Stable identity across providers. */
  key: string;
  title: string;
  year?: number;
  type?: TvType;
  posterUrl?: string;
  /** Every provider URL seen for this title, so any card resolves to this entry. */
  urls: string[];
  status: WatchStatus;
  /** User's own score, 0–10, independent of any external rating. */
  userRating?: number;
  addedAt: number;
  updatedAt: number;
}

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

const ENTRIES_KEY = 'library_entries';
const PROGRESS_KEY = 'watch_progress';
const SOURCE_MEMORY_KEY = 'source_memory';

/**
 * Fraction of the runtime past which an item counts as finished.
 *
 * 92% rather than 100%: end credits mean nobody watches to the last frame, and
 * an item stuck at "97% watched" in Continue Watching forever is worse than one
 * marked done slightly early.
 */
const COMPLETION_THRESHOLD = 0.92;

/** Below this, playback is treated as "not really started" and is not resumed. */
const RESUME_FLOOR_SECONDS = 30;

/** Cap on retained progress rows, oldest evicted first. */
const MAX_PROGRESS_ROWS = 500;

/**
 * Derives a provider-independent identity for a title.
 *
 * Provider URLs cannot be the key: the same film has a different URL on every
 * site, so keying on URL would scatter one title across five library entries and
 * lose progress whenever the user picked a different card.
 *
 * Normalisation strips punctuation, articles and the year suffix providers like
 * to append, so "The Matrix (1999)", "Matrix, The" and "the matrix" converge.
 * It is deliberately conservative — collapsing two genuinely different titles is
 * worse than failing to merge two spellings of one, because a false merge shows
 * the user progress for something they never watched.
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
    // Bounded: a heavy user watching a long-running series would otherwise grow
    // this file without limit. Newest kept.
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

  /**
   * Records or updates a title, merging provider URLs into the existing entry.
   *
   * Called both when the user explicitly bookmarks something and implicitly when
   * they start watching, so the library reflects real activity rather than only
   * deliberate curation.
   */
  public upsertEntry(input: {
    title: string;
    year?: number;
    type?: TvType;
    posterUrl?: string;
    mediaUrl: string;
    status?: WatchStatus;
  }): LibraryEntry {
    const key = canonicalKey(input.title, input.year);
    const now = Date.now();
    const existing = this.entries.get(key);

    const entry: LibraryEntry = existing
      ? {
          ...existing,
          // A later sighting may carry a poster the first one lacked, but must
          // not overwrite a good poster with an absent one.
          posterUrl: input.posterUrl ?? existing.posterUrl,
          type: input.type ?? existing.type,
          urls: existing.urls.includes(input.mediaUrl)
            ? existing.urls
            : [...existing.urls, input.mediaUrl],
          status: input.status ?? existing.status,
          updatedAt: now,
        }
      : {
          key,
          title: input.title,
          year: input.year,
          type: input.type,
          posterUrl: input.posterUrl,
          urls: [input.mediaUrl],
          status: input.status ?? WatchStatus.Watching,
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

  public getEntryForUrl(mediaUrl: string): LibraryEntry | null {
    for (const entry of this.entries.values()) {
      if (entry.urls.includes(mediaUrl)) return entry;
    }
    return null;
  }

  // --- watch progress ------------------------------------------------------

  /**
   * Records playback position.
   *
   * Called periodically during playback, so it must be cheap and must not
   * regress state: a seek backwards is legitimate, but a stray zero from a
   * reloading video element must not wipe a nearly-finished item.
   */
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

    // A reported position of ~0 on an item already in progress is almost always
    // a source switch or an element reload, not the user seeking to the start.
    if (existing && input.positionSeconds < RESUME_FLOOR_SECONDS && existing.positionSeconds > RESUME_FLOOR_SECONDS) {
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

    // Watching something is itself a statement about status; a title the user is
    // partway through belongs in Watching without them filing it there.
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

  /** Every recorded position for a title, for painting an episode list. */
  public getProgressForKey(key: string): WatchProgress[] {
    return [...this.progress.values()].filter((p) => p.key === key);
  }

  /**
   * The Continue Watching row: one entry per title, most recent first.
   *
   * Collapsed per title deliberately. A user three episodes into a series wants
   * one card that resumes where they stopped, not three.
   */
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

  /**
   * Remembers which source the user chose, so the next play can skip the search.
   *
   * Only the choice is stored, never a resolved stream URL: those expire, and a
   * stale one produces a failure that looks like a broken provider.
   */
  public rememberSource(input: Omit<SourceMemory, 'chosenAt'>): void {
    this.sources.set(progressId(input), { ...input, chosenAt: Date.now() });
    this.persistSources();
  }

  public recallSource(key: string, season?: number, episode?: number): SourceMemory | null {
    return this.sources.get(progressId({ key, season, episode })) ?? null;
  }

  // --- portability ---------------------------------------------------------

  /** Everything this store owns, for a complete export. */
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

  /**
   * Merges an exported payload into this store.
   *
   * Merge rather than replace, and newest-wins per record: importing a backup on
   * a machine that has since been used should not silently discard the newer
   * activity.
   */
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

/** Composite id for a specific episode of a title (or the title itself). */
function progressId(row: { key: string; season?: number; episode?: number }): string {
  return `${row.key}|${row.season ?? ''}|${row.episode ?? ''}`;
}
