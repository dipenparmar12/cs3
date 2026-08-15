import type { SearchHistoryEntry } from '../src/types/api';
import type { DatastoreManager } from './datastore';

/**
 * Past searches, so watching something again tomorrow costs one click.
 *
 * Deliberately a list of *queries*, not of results. A query is stable and
 * re-runnable — re-running it picks up sources that appeared since — whereas a
 * cached result set goes stale silently and would show the viewer a title that
 * no longer has anything behind it.
 *
 * Stored through the datastore's object bucket rather than as its own file so
 * it travels with the existing backup/restore path for free.
 */

const KEY = 'search_history';

/** Long enough to cover "what was I watching last week", short enough to scan. */
const MAX_ENTRIES = 50;

export class SearchHistoryStore {
  private datastore: DatastoreManager;

  constructor(datastore: DatastoreManager) {
    this.datastore = datastore;
  }

  public list(limit = MAX_ENTRIES): SearchHistoryEntry[] {
    const stored = this.datastore.getObject<SearchHistoryEntry[]>(KEY, []);
    if (!Array.isArray(stored)) return [];
    return stored
      .filter((entry) => entry && typeof entry.query === 'string')
      .sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
      .slice(0, limit);
  }

  /**
   * Records a search, collapsing a repeat onto the existing row.
   *
   * Searching "dune" three times should leave one recent entry, not three
   * identical ones — the list is for recall, and repetition is noise in it.
   */
  public record(query: string, resultCount?: number): SearchHistoryEntry[] {
    const trimmed = query.trim();
    if (!trimmed) return this.list();

    // Pasted magnets and URLs are not things anyone wants to re-run from a
    // history list, and they push real searches out of it.
    if (/^(magnet:|https?:\/\/)/i.test(trimmed)) return this.list();

    const existing = this.list(MAX_ENTRIES);
    const withoutDuplicate = existing.filter(
      (entry) => entry.query.toLowerCase() !== trimmed.toLowerCase()
    );

    const next: SearchHistoryEntry[] = [
      { query: trimmed, at: Date.now(), resultCount },
      ...withoutDuplicate,
    ].slice(0, MAX_ENTRIES);

    this.datastore.setObject(KEY, next);
    return next;
  }

  /**
   * Fills in how many results a query turned out to have.
   *
   * Deliberately does not re-order: the entry's position records when the
   * search was *started*, and a slow search finishing should not jump ahead of
   * a faster one the user ran afterwards.
   */
  public setResultCount(query: string, resultCount: number): SearchHistoryEntry[] {
    const trimmed = query.trim().toLowerCase();
    const entries = this.list(MAX_ENTRIES);
    const next = entries.map((entry) =>
      entry.query.toLowerCase() === trimmed ? { ...entry, resultCount } : entry
    );
    this.datastore.setObject(KEY, next);
    return next;
  }

  public remove(query: string): SearchHistoryEntry[] {
    const next = this.list(MAX_ENTRIES).filter(
      (entry) => entry.query.toLowerCase() !== query.trim().toLowerCase()
    );
    this.datastore.setObject(KEY, next);
    return next;
  }

  public clear(): SearchHistoryEntry[] {
    this.datastore.setObject(KEY, []);
    return [];
  }
}
