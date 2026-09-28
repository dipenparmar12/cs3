import path from 'path';
import type { SearchResponse } from '../src/types/api';
import { JsonFileStore } from './util/jsonFileStore.ts';

/**
 * Search results the viewer chose to keep.
 *
 * `searchHistory` deliberately remembers only *queries*, because a cached
 * result set goes stale silently. That stays true for history, which records
 * every search whether or not anyone wanted it kept. This is the other case: a
 * list someone looked at and pressed Save on — a shortlist of what a search
 * found, to come back to next week. What makes it safe is that it never
 * pretends to be live:
 *
 * - **Every saved search carries the moment it was saved**, and the search
 *   screen says "saved results from …" with a one-click re-run beside it.
 * - **The rows are page addresses, not stream links.** A search result opens a
 *   title's page, and a page address is the durable half of anything this app
 *   stores; nothing here expires the way a signed CDN link does.
 * - **Saving the same query again updates it** rather than stacking copies,
 *   unless the scope differs — "dune" across everything and "dune" on one
 *   provider are two different lists.
 *
 * Its own file rather than the datastore: two hundred result rows per search is
 * the wrong size for a store that is serialised whole on every setter, and it
 * is read only when the search screen or the library asks.
 */

export interface SavedSearch {
  id: string;
  query: string;
  savedAt: number;
  results: SearchResponse[];
  /** The providers and indexers it was narrowed to; both empty means everything. */
  providers: string[];
  indexers: string[];
}

export interface SavedSearchSummary {
  id: string;
  query: string;
  savedAt: number;
  resultCount: number;
  /** A few posters, so a list of saved searches is recognisable at a glance. */
  posters: string[];
  scoped: boolean;
}

export interface SaveSearchInput {
  query: string;
  results: SearchResponse[];
  providers?: string[];
  indexers?: string[];
}

export const MAX_SAVED_SEARCHES = 50;
export const MAX_SAVED_RESULTS = 200;

const normalise = (query: string) => query.trim().toLowerCase().replace(/\s+/g, ' ');
const scopeKey = (providers: string[], indexers: string[]) =>
  [...providers].sort().join('\u0001') + '\u0002' + [...indexers].sort().join('\u0001');

function summarise(search: SavedSearch): SavedSearchSummary {
  return {
    id: search.id,
    query: search.query,
    savedAt: search.savedAt,
    resultCount: search.results.length,
    posters: search.results
      .map((result) => result.posterUrl)
      .filter((url): url is string => typeof url === 'string' && url.length > 0)
      .slice(0, 4),
    scoped: search.providers.length > 0 || search.indexers.length > 0,
  };
}

function isSavedSearch(value: unknown): value is SavedSearch {
  const row = value as SavedSearch | null;
  return (
    !!row &&
    typeof row.id === 'string' &&
    typeof row.query === 'string' &&
    typeof row.savedAt === 'number' &&
    Array.isArray(row.results)
  );
}

export class SavedSearchStore {
  private searches: SavedSearch[] = [];
  private hydrated = false;
  private readonly file: JsonFileStore<{ version: 1; searches: SavedSearch[] }>;
  private readonly now: () => number;

  constructor(directory: string, now: () => number = Date.now) {
    this.now = now;
    this.file = new JsonFileStore(path.join(directory, 'saved-searches.json'), 1_000, () => ({
      version: 1 as const,
      searches: this.searches,
    }));
  }

  /** Read on first use, not at construction, which runs before the window exists. */
  private hydrate(): void {
    if (this.hydrated) return;
    this.hydrated = true;
    const stored = this.file.load();
    const rows = Array.isArray(stored?.searches) ? stored.searches : [];
    // Anything saved before the first read is newer than the file's copy.
    const known = new Set(this.searches.map((search) => search.id));
    for (const row of rows) {
      if (!isSavedSearch(row) || known.has(row.id)) continue;
      this.searches.push({ ...row, providers: row.providers ?? [], indexers: row.indexers ?? [] });
    }
    this.searches.sort((a, b) => b.savedAt - a.savedAt);
  }

  public list(): SavedSearchSummary[] {
    this.hydrate();
    return this.searches.map(summarise);
  }

  public get(id: string): SavedSearch | null {
    this.hydrate();
    return this.searches.find((search) => search.id === id) ?? null;
  }

  /** The saved search a live one would update, if any — for the Save button's label. */
  public find(query: string, providers: string[] = [], indexers: string[] = []): SavedSearchSummary | null {
    this.hydrate();
    const match = this.matching(query, providers, indexers);
    return match ? summarise(match) : null;
  }

  public save(input: SaveSearchInput): SavedSearchSummary | null {
    this.hydrate();
    const query = input.query?.trim();
    if (!query || !Array.isArray(input.results) || input.results.length === 0) return null;
    const providers = input.providers ?? [];
    const indexers = input.indexers ?? [];

    const existing = this.matching(query, providers, indexers);
    const search: SavedSearch = {
      id: existing?.id ?? `saved-${this.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      query,
      savedAt: this.now(),
      results: input.results.slice(0, MAX_SAVED_RESULTS),
      providers,
      indexers,
    };
    this.searches = [search, ...this.searches.filter((row) => row.id !== search.id)].slice(
      0,
      MAX_SAVED_SEARCHES
    );
    this.file.schedule();
    return summarise(search);
  }

  public remove(id: string): SavedSearchSummary[] {
    this.hydrate();
    const before = this.searches.length;
    this.searches = this.searches.filter((search) => search.id !== id);
    if (this.searches.length !== before) this.file.schedule();
    return this.list();
  }

  public clear(): void {
    this.hydrate();
    this.searches = [];
    this.file.schedule();
  }

  /** Whole records, for the backup file. */
  public exportAll(): SavedSearch[] {
    this.hydrate();
    return this.searches.map((search) => ({ ...search }));
  }

  /** Restores records, keeping the newer of two copies of one id. */
  public importAll(rows: unknown[]): number {
    this.hydrate();
    let count = 0;
    for (const row of rows) {
      if (!isSavedSearch(row)) continue;
      const current = this.searches.find((search) => search.id === row.id);
      if (current && current.savedAt >= row.savedAt) continue;
      this.searches = [
        { ...row, providers: row.providers ?? [], indexers: row.indexers ?? [] },
        ...this.searches.filter((search) => search.id !== row.id),
      ];
      count++;
    }
    this.searches.sort((a, b) => b.savedAt - a.savedAt);
    this.searches = this.searches.slice(0, MAX_SAVED_SEARCHES);
    if (count > 0) this.file.schedule();
    return count;
  }

  public flush(): void {
    if (this.hydrated) this.file.flush();
  }

  private matching(query: string, providers: string[], indexers: string[]): SavedSearch | undefined {
    const wanted = normalise(query);
    const scope = scopeKey(providers, indexers);
    return this.searches.find(
      (search) => normalise(search.query) === wanted && scopeKey(search.providers, search.indexers) === scope
    );
  }
}
