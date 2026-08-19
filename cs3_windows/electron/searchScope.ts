import type { DatastoreManager } from './datastore';

/**
 * Which sources this app is currently allowed to ask.
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
 *
 * **A selection is a filter, not a preference.** An earlier version widened
 * back to every source whenever the selection matched nothing currently
 * installed, on the theory that uninstalling your one scoped extension should
 * not silently turn search off. In practice that rule fired constantly — the
 * picker could offer a name no provider actually had — and the symptom was the
 * worst possible one: the user selects one site, and the app searches all two
 * hundred while the button still reads "1 source". Selecting nothing now
 * genuinely means nothing, and the unresolvable selection is reported instead
 * so the UI can say which sources went missing.
 */

const SETTINGS_KEY = 'cs3_search_scope';

export interface SearchScope {
  /** Extension provider names in scope. Empty means every enabled provider. */
  providers: string[];
  /** Torrent indexer ids in scope. Empty means every enabled indexer. */
  indexers: string[];
}

/** What one dimension of the scope resolves to against what exists right now. */
export interface ScopeResolution {
  /** True when the user narrowed this dimension at all. */
  narrowed: boolean;
  /**
   * What to actually ask. When narrowed this is the selection, intersected
   * with what is installed and enabled — never widened past it.
   */
  allowed: string[];
  /** Selected entries that are no longer installed, or were switched off. */
  missing: string[];
}

/** The scope as it applied to one search, for the UI to state plainly. */
export interface SearchScopeReport {
  /** False means this was a global search across everything enabled. */
  active: boolean;
  providers: string[];
  indexers: string[];
  missingProviders: string[];
  missingIndexers: string[];
}

export const GLOBAL_SCOPE_REPORT: SearchScopeReport = {
  active: false,
  providers: [],
  indexers: [],
  missingProviders: [],
  missingIndexers: [],
};

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

  public isActive(): boolean {
    const scope = this.get();
    return scope.providers.length > 0 || scope.indexers.length > 0;
  }

  /**
   * Narrows a candidate list to what is in scope.
   *
   * Selection order is preserved when narrowed, so "the first source I picked"
   * is also the first one asked.
   */
  private static resolve(candidates: string[], selected: string[]): ScopeResolution {
    if (selected.length === 0) {
      return { narrowed: false, allowed: candidates, missing: [] };
    }
    const available = new Set(candidates);
    const allowed: string[] = [];
    const missing: string[] = [];
    for (const entry of selected) {
      if (available.has(entry)) allowed.push(entry);
      else missing.push(entry);
    }
    return { narrowed: true, allowed, missing };
  }

  public resolveProviders(enabled: string[]): ScopeResolution {
    return SearchScopeStore.resolve(enabled, this.get().providers);
  }

  public resolveIndexers(enabled: string[]): ScopeResolution {
    return SearchScopeStore.resolve(enabled, this.get().indexers);
  }

  /** Both dimensions at once, in the shape the renderer renders. */
  public report(providers: ScopeResolution, indexers: ScopeResolution): SearchScopeReport {
    return {
      active: providers.narrowed || indexers.narrowed,
      providers: providers.narrowed ? providers.allowed : [],
      indexers: indexers.narrowed ? indexers.allowed : [],
      missingProviders: providers.missing,
      missingIndexers: indexers.missing,
    };
  }
}
