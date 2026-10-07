import type { RepositoryFetchResult } from '../pluginManager';
import { JsonFileStore } from '../util/jsonFileStore.ts';

/**
 * What each repository offered the last time it was read, kept on disk.
 *
 * Browse used to fetch the list every time a card was expanded, so every
 * expand began with "Reading the list…" and an offline expand showed nothing.
 * The listing is the same few hundred kilobytes it was a minute ago; it is
 * shown from here at once and revalidated behind the viewer.
 *
 * Only successful, non-empty reads are stored: a repository that is down today
 * must not replace a listing that worked yesterday. Keyed by the address the
 * caller used, because the same repository is routinely known by two (a
 * project page and the raw document it resolves to).
 */
interface Entry {
  value: RepositoryFetchResult;
  fetchedAt: number;
}

interface File {
  version: 1;
  entries: Record<string, Entry>;
}

const MAX_ENTRIES = 80;

export class RepositoryListingCache {
  private data: File | null = null;
  private readonly store: JsonFileStore<File>;

  constructor(file: string) {
    this.store = new JsonFileStore<File>(file, 2000, () => this.state());
  }

  // Hydrated on first use, never at construction.
  private state(): File {
    if (!this.data) {
      const loaded = this.store.load();
      this.data =
        loaded?.version === 1 && loaded.entries ? loaded : { version: 1, entries: {} };
    }
    return this.data;
  }

  public peek(url: string): Entry | null {
    return this.state().entries[url] ?? null;
  }

  public put(url: string, value: RepositoryFetchResult): void {
    if (value.plugins.length === 0) return;
    const { entries } = this.state();
    const entry = { value, fetchedAt: Date.now() };
    entries[url] = entry;
    entries[value.repositoryUrl] = entry;
    const keys = Object.keys(entries);
    if (keys.length > MAX_ENTRIES) {
      keys
        .sort((a, b) => entries[a].fetchedAt - entries[b].fetchedAt)
        .slice(0, keys.length - MAX_ENTRIES)
        .forEach((key) => delete entries[key]);
    }
    this.store.schedule();
  }

  public isFresh(url: string, maxAgeMs: number): boolean {
    const entry = this.peek(url);
    return Boolean(entry && Date.now() - entry.fetchedAt < maxAgeMs);
  }

  public flush(): void {
    if (this.data) this.store.flush();
  }
}
