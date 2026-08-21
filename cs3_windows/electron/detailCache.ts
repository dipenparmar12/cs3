import { app } from 'electron';
import path from 'path';
import { JsonFileStore } from './util/jsonFileStore';
import type { MetadataDetail } from './metadataProvider';

/**
 * Title metadata, kept so revisiting something is instant.
 *
 * Opening a title used to re-fetch everything — name, plot, tags, poster,
 * episode list — from the catalogue or, worse, by re-scraping the provider's
 * page. That is a network round trip and a blank screen for something the app
 * had already fetched and displayed minutes earlier, and none of it changes
 * often enough to justify the wait.
 *
 * Three faults in what this replaces, in increasing order of severity:
 *
 *  1. **It was memory-only**, so every restart started cold.
 *  2. **It never expired**, so a title cached once was cached with whatever it
 *     said that day, forever.
 *  3. **The provider path never wrote to it at all.** Only the two catalogue
 *     branches cached; extension-sourced titles — the ones that cost a scrape
 *     rather than an API call — re-fetched on every single visit.
 *
 * The policy is stale-while-revalidate: a hit is served immediately whatever
 * its age, and anything past {@link FRESH_MS} is refreshed in the background
 * with the result pushed to whoever is looking at it. The viewer waits for the
 * network only the first time.
 *
 * Its own file rather than the datastore: an episode list for a long-running
 * series is large, and this is derived data that can be rebuilt at any time —
 * it has no business inflating a user's backup.
 */

interface CacheEntry {
  detail: MetadataDetail;
  at: number;
}

/** Beyond this a hit is still served, but a refresh is started behind it. */
const FRESH_MS = 12 * 60 * 60 * 1000;

/** Past this an entry is dropped rather than shown; a year-old plot is wrong. */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** Titles retained. Episode lists make these large, so this is not generous. */
const MAX_ENTRIES = 300;

const FILE_NAME = 'cs3-detail-cache.json';

export interface CacheRead {
  detail: MetadataDetail;
  /** True when a background refresh should be started for this entry. */
  stale: boolean;
}

/** The on-disk shape: a `Map` does not survive `JSON.stringify`. */
type CacheRow = { url: string; entry: CacheEntry };

export class DetailCache {
  private entries = new Map<string, CacheEntry>();
  /**
   * Debounced at two seconds, because a search that opens several titles writes
   * several times and this file carries whole episode lists.
   */
  private store: JsonFileStore<CacheRow[]>;

  constructor(directory?: string) {
    const base = directory ?? (app ? app.getPath('userData') : process.cwd());
    this.store = new JsonFileStore(path.join(base, FILE_NAME), 2_000, () =>
      [...this.entries.entries()].map(([url, entry]) => ({ url, entry }))
    );
    this.restore();
  }

  private restore(): void {
    // An unreadable or absent file simply means the app refetches, which is the
    // behaviour this cache replaces rather than a new failure.
    const parsed = this.store.load();
    if (!Array.isArray(parsed)) return;
    // The age filter happens here rather than in the store: what counts as too
    // old is this cache's policy, not a property of JSON on disk.
    const cutoff = Date.now() - MAX_AGE_MS;
    for (const row of parsed) {
      if (row?.url && row.entry?.detail && row.entry.at >= cutoff) {
        this.entries.set(row.url, row.entry);
      }
    }
  }

  private scheduleWrite(): void {
    this.store.schedule();
  }

  public flush(): void {
    this.store.flush();
  }

  public read(url: string): CacheRead | null {
    const entry = this.entries.get(url);
    if (!entry) return null;

    const age = Date.now() - entry.at;
    if (age > MAX_AGE_MS) {
      this.entries.delete(url);
      return null;
    }
    return { detail: entry.detail, stale: age > FRESH_MS };
  }

  public write(url: string, detail: MetadataDetail): void {
    // Re-inserted rather than updated in place: `Map` keeps insertion order, so
    // deleting first makes the eviction below a true least-recently-written.
    this.entries.delete(url);
    this.entries.set(url, { detail, at: Date.now() });

    while (this.entries.size > MAX_ENTRIES) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    this.scheduleWrite();
  }

  public clear(): void {
    this.entries.clear();
    this.scheduleWrite();
  }
}
