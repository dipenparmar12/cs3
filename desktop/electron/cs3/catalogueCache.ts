import type { ProviderCatalog, ProviderCatalogPage } from '../../src/types/api';
import { JsonFileStore } from '../util/jsonFileStore.ts';

/**
 * Provider catalogues, remembered — so opening a streaming service a second
 * time draws at once instead of re-scraping every row behind a spinner.
 *
 * Stale-while-revalidate, with the caller choosing when to revalidate: a read
 * answers from cache whenever there is anything to answer with, and a
 * `refresh` read goes to the provider and replaces the entry. The platform
 * page refreshes in the background only after the viewer has stayed a few
 * seconds, so paging through services costs nothing.
 *
 * Rules:
 * - **Only successes are stored.** A failed or empty answer never replaces a
 *   good one; a refresh that fails hands back the cached copy instead, so a
 *   flaky host cannot blank a page that was working a minute ago.
 * - **Identical requests in flight are shared**, or a row scrolled past twice
 *   while its first request is pending scrapes the site twice.
 * - **Bounded**, newest kept: a home page can be 340 items, and this is a
 *   cache, not an archive.
 * - **Hydrated on first use**, never at construction (§12: nothing heavy runs
 *   before the window exists).
 */

interface Entry<T> {
  value: T;
  fetchedAt: number;
}

interface CacheFile {
  version: 1;
  catalogs: Record<string, Entry<ProviderCatalog>>;
  pages: Record<string, Entry<ProviderCatalogPage>>;
}

const MAX_PAGES = 160;
const MAX_CATALOGS = 120;

export interface CatalogueReadOptions {
  /** Ask the provider even when a cached answer exists. */
  refresh?: boolean;
}

export class CatalogueCache {
  private data: CacheFile | null = null;
  private readonly store: JsonFileStore<CacheFile>;
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(file: string) {
    this.store = new JsonFileStore<CacheFile>(file, 2000, () => this.state());
  }

  private state(): CacheFile {
    if (!this.data) {
      const loaded = this.store.load();
      this.data =
        loaded?.version === 1 && loaded.catalogs && loaded.pages
          ? loaded
          : { version: 1, catalogs: {}, pages: {} };
    }
    return this.data;
  }

  public async catalog(
    provider: string,
    options: CatalogueReadOptions,
    fetch: () => Promise<ProviderCatalog>
  ): Promise<ProviderCatalog & { fetchedAt?: number }> {
    const cached = this.state().catalogs[provider];
    if (cached && !options.refresh) return { ...cached.value, fetchedAt: cached.fetchedAt };

    const fresh = await this.shared(`c\u0000${provider}`, fetch);
    if (fresh.hasMainPage && fresh.sections.length > 0) {
      const fetchedAt = Date.now();
      this.state().catalogs[provider] = { value: fresh, fetchedAt };
      this.trim('catalogs', MAX_CATALOGS);
      this.store.schedule();
      return { ...fresh, fetchedAt };
    }
    // A failed refresh keeps what was working.
    return cached ? { ...cached.value, fetchedAt: cached.fetchedAt } : fresh;
  }

  public async page(
    provider: string,
    section: { name: string; data: string },
    page: number,
    options: CatalogueReadOptions,
    fetch: () => Promise<ProviderCatalogPage>
  ): Promise<ProviderCatalogPage> {
    const key = [provider, section.name, section.data, page].join('\u0000');
    const cached = this.state().pages[key];
    if (cached && !options.refresh) return { ...cached.value, fetchedAt: cached.fetchedAt };

    const fresh = await this.shared(`p\u0000${key}`, fetch);
    if (!fresh.error && fresh.items.length > 0) {
      const fetchedAt = fresh.fetchedAt ?? Date.now();
      this.state().pages[key] = { value: { ...fresh, fetchedAt }, fetchedAt };
      this.trim('pages', MAX_PAGES);
      this.store.schedule();
      return { ...fresh, fetchedAt };
    }
    return cached ? { ...cached.value, fetchedAt: cached.fetchedAt } : fresh;
  }

  /** Drops one provider's catalogue and pages, e.g. after its extension updates. */
  public forget(provider: string): void {
    const data = this.state();
    delete data.catalogs[provider];
    for (const key of Object.keys(data.pages)) {
      if (key.startsWith(`${provider}\u0000`)) delete data.pages[key];
    }
    this.store.schedule();
  }

  public flush(): void {
    if (this.data) this.store.flush();
  }

  private shared<T>(key: string, fetch: () => Promise<T>): Promise<T> {
    const running = this.inflight.get(key) as Promise<T> | undefined;
    if (running) return running;
    const started = fetch().finally(() => this.inflight.delete(key));
    this.inflight.set(key, started);
    return started;
  }

  private trim(bucket: 'catalogs' | 'pages', max: number): void {
    const entries = Object.entries(this.state()[bucket]);
    if (entries.length <= max) return;
    entries
      .sort((a, b) => a[1].fetchedAt - b[1].fetchedAt)
      .slice(0, entries.length - max)
      .forEach(([key]) => delete this.state()[bucket][key]);
  }
}
