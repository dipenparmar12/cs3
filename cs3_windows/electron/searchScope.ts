import type { DatastoreManager } from './datastore';

/**
 * Which providers this app is currently allowed to ask.
 *
 * Two separate ideas are easy to conflate here, so: *enabled* is configuration
 * — a provider the user has switched off in the extensions screen is off
 * everywhere, permanently, and never appears in this file. *Scope* is a
 * narrowing on top of that, the answer to "just search this one site for a
 * minute". Empty means no narrowing, which is the normal state.
 *
 * It is persisted rather than passed per query because the requirement is that
 * the same configuration governs search, source discovery, streaming,
 * downloading and refresh. Threading a parameter through those five paths would
 * guarantee one of them eventually forgets it; reading one stored answer cannot
 * drift.
 */

const SETTINGS_KEY = 'cs3_search_scope';

export interface SearchScope {
  /** Extension provider names in scope. Empty means every enabled provider. */
  providers: string[];
  /** Torrent indexer ids in scope. Empty means every enabled indexer. */
  indexers: string[];
}

const EMPTY: SearchScope = { providers: [], indexers: [] };

export class SearchScopeStore {
  private datastore: DatastoreManager;

  constructor(datastore: DatastoreManager) {
    this.datastore = datastore;
  }

  public get(): SearchScope {
    const stored = this.datastore.getObject<Partial<SearchScope>>(SETTINGS_KEY, EMPTY);
    return {
      providers: Array.isArray(stored?.providers) ? stored.providers : [],
      indexers: Array.isArray(stored?.indexers) ? stored.indexers : [],
    };
  }

  public set(scope: Partial<SearchScope>): SearchScope {
    const next: SearchScope = {
      providers: [...new Set(scope.providers ?? [])],
      indexers: [...new Set(scope.indexers ?? [])],
    };
    this.datastore.setObject(SETTINGS_KEY, next);
    return next;
  }

  public clear(): SearchScope {
    return this.set(EMPTY);
  }

  /**
   * Narrows a list of candidates to those in scope.
   *
   * An empty scope admits everything, and — importantly — so does a scope that
   * names nothing currently present. Uninstalling the one extension you had
   * scoped to should not silently turn search off; it should go back to
   * searching everything.
   */
  private static apply(candidates: string[], selected: string[]): string[] {
    if (selected.length === 0) return candidates;
    const wanted = new Set(selected);
    const kept = candidates.filter((candidate) => wanted.has(candidate));
    return kept.length > 0 ? kept : candidates;
  }

  public applyToProviders(enabled: string[]): string[] {
    return SearchScopeStore.apply(enabled, this.get().providers);
  }

  public applyToIndexers(enabled: string[]): string[] {
    return SearchScopeStore.apply(enabled, this.get().indexers);
  }
}
