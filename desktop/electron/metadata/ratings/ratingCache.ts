import path from 'path';
import { JsonFileStore } from '../../util/jsonFileStore.ts';
import type { CanonicalMediaIdentity, MediaRating } from '../../../src/types/ratings.ts';

const FILE_NAME = 'cs3-ratings-cache.json';
const FRESH_MS = 7 * 24 * 60 * 60 * 1000; // 7 days freshness window
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days max retention
const MAX_ENTRIES = 500;
const WRITE_DEBOUNCE_MS = 2_000;

export interface RatingCacheEntry {
  identity: CanonicalMediaIdentity;
  ratings: MediaRating[];
  fetchedAt: number;
  expiresAt: number;
}

export function buildRatingCacheKey(identity: CanonicalMediaIdentity): string {
  if (identity.imdbId && /^tt\d+/i.test(identity.imdbId.trim())) {
    return `imdb:${identity.imdbId.trim().toLowerCase()}`;
  }
  if (identity.tmdbId && identity.tmdbId > 0) {
    return `tmdb:${identity.tmdbId}`;
  }
  const cleanTitle = (identity.title || identity.originalTitle || '')
    .trim()
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ');
  const yr = identity.year ? `:${identity.year}` : '';
  return `title:${cleanTitle}${yr}`;
}

export class RatingCache {
  private store: JsonFileStore<Record<string, RatingCacheEntry>> | null = null;
  private entries = new Map<string, RatingCacheEntry>();
  private loaded = false;

  constructor(storageDir?: string) {
    if (storageDir) {
      this.setDirectory(storageDir);
    }
  }

  public setDirectory(storageDir: string): void {
    const filePath = path.join(storageDir, FILE_NAME);
    this.store = new JsonFileStore(filePath, WRITE_DEBOUNCE_MS, () =>
      Object.fromEntries(this.entries.entries())
    );
    this.load();
  }

  private load(): void {
    if (!this.store) return;
    const raw = this.store.load();
    this.entries.clear();
    const now = Date.now();

    if (raw && typeof raw === 'object') {
      for (const [key, val] of Object.entries(raw)) {
        if (!val || typeof val !== 'object' || !Array.isArray((val as RatingCacheEntry).ratings)) {
          continue;
        }
        const entry = val as RatingCacheEntry;
        if (now - entry.fetchedAt > MAX_AGE_MS) {
          continue;
        }
        this.entries.set(key, entry);
      }
    }
    this.loaded = true;
  }

  public get(identity: CanonicalMediaIdentity): { entry: RatingCacheEntry | null; isStale: boolean } {
    if (!this.loaded && this.store) {
      this.load();
    }
    const key = buildRatingCacheKey(identity);
    const entry = this.entries.get(key);
    if (!entry) {
      return { entry: null, isStale: false };
    }
    const now = Date.now();
    const isStale = now >= entry.expiresAt || (now - entry.fetchedAt > FRESH_MS);
    return { entry, isStale };
  }

  public set(identity: CanonicalMediaIdentity, ratings: MediaRating[]): void {
    if (!this.loaded && this.store) {
      this.load();
    }
    const key = buildRatingCacheKey(identity);
    const now = Date.now();
    const entry: RatingCacheEntry = {
      identity,
      ratings,
      fetchedAt: now,
      expiresAt: now + FRESH_MS,
    };

    this.entries.set(key, entry);

    if (this.entries.size > MAX_ENTRIES) {
      this.prune();
    }

    if (this.store) {
      this.store.schedule();
    }
  }

  public delete(identity: CanonicalMediaIdentity): void {
    const key = buildRatingCacheKey(identity);
    if (this.entries.delete(key) && this.store) {
      this.store.schedule();
    }
  }

  public clear(): void {
    this.entries.clear();
    if (this.store) {
      this.store.schedule();
    }
  }

  private prune(): void {
    // Sort oldest fetched first, evict down to 80% capacity
    const sorted = [...this.entries.entries()].sort(
      ([, a], [, b]) => a.fetchedAt - b.fetchedAt
    );
    const toRemove = sorted.slice(0, Math.floor(MAX_ENTRIES * 0.2));
    for (const [key] of toRemove) {
      this.entries.delete(key);
    }
  }
}
