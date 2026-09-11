import type { DatastoreManager } from '../datastore';
import type { SearchScopeStore } from '../searchScope';
import {
  ALL_SOURCES_ID,
  DRAFT_ID,
  INITIAL_STATE,
  activate,
  create,
  duplicate,
  edit,
  effectiveScope,
  hydrate,
  remove,
  rename,
  type ProfileState,
  type SourceProfile,
} from './sourceProfiles.ts';

const SETTINGS_KEY = 'cs3_source_profiles';

/**
 * Persistence and the one side effect: keeping `SearchScopeStore` in step.
 *
 * The decisions all live in `sourceProfiles.ts`, which is pure. What is left
 * here is reading and writing the record, and — the part that matters — writing
 * the *effective* scope through to `SearchScopeStore` after every change.
 *
 * That indirection is deliberate. Scope reaches five separate paths (search,
 * source discovery, streaming, downloading, refresh) and `searchScope.ts` says
 * why it is stored rather than threaded: one of five callers would eventually
 * forget it. Profiles must not become a sixth thing those paths have to know
 * about, so they resolve to exactly the `SearchScope` that already governs all
 * five, and nothing downstream changes at all.
 *
 * The consequence worth stating: **`SearchScopeStore` is now downstream, not a
 * peer.** Writing to it directly still works and still narrows the search, but
 * the next profile switch overwrites it — so the renderer edits scope through
 * this, and `search:setScope` routes here.
 */
export class SourceProfileStore {
  private datastore: DatastoreManager;
  private scope: SearchScopeStore;
  private state: ProfileState;

  constructor(datastore: DatastoreManager, scope: SearchScopeStore) {
    this.datastore = datastore;
    this.scope = scope;
    this.state = hydrate(this.datastore.getObject<unknown>(SETTINGS_KEY, INITIAL_STATE));
    /**
     * Deliberately *not* pushed to the scope store on construction.
     *
     * A user who has never opened this feature has an `all` state here and
     * whatever they last picked in `SearchScopeStore`; overwriting the second
     * with the first at startup would silently widen their search on upgrade.
     * The first explicit action adopts them — see `adoptExistingScope`.
     */
  }

  public get(): ProfileState {
    return this.state;
  }

  public list(): SourceProfile[] {
    return this.state.profiles;
  }

  /**
   * Takes a pre-existing scope selection under management, once.
   *
   * Someone upgrading into this feature has a selection in `SearchScopeStore`
   * and no profiles. Discarding it is the exact loss this whole module exists
   * to prevent, so it becomes the draft and the draft becomes active — which is
   * indistinguishable, from where they are sitting, from nothing having
   * happened.
   */
  public adoptExistingScope(): ProfileState {
    if (this.state.profiles.length > 0 || this.state.activeId !== ALL_SOURCES_ID) {
      return this.state;
    }
    const existing = this.scope.get();
    if (existing.providers.length === 0 && existing.indexers.length === 0) return this.state;

    return this.write(
      edit(this.state, { providers: existing.providers, indexers: existing.indexers })
    );
  }

  public activate(id: string): ProfileState {
    return this.write(activate(this.state, id));
  }

  public edit(patch: Partial<ProfileState['draft']>): ProfileState {
    return this.write(edit(this.state, patch));
  }

  public create(name: string, from?: Partial<ProfileState['draft']>): ProfileState {
    return this.write(create(this.state, name, from).state);
  }

  public rename(id: string, name: string): ProfileState {
    return this.write(rename(this.state, id, name));
  }

  public duplicate(id: string): ProfileState {
    return this.write(duplicate(this.state, id));
  }

  public remove(id: string): ProfileState {
    return this.write(remove(this.state, id));
  }

  /** True when the active configuration narrows the search at all. */
  public isNarrowed(): boolean {
    return effectiveScope(this.state).narrowed;
  }

  /**
   * The name to put on the button.
   *
   * A count answers "how many" and never "which", which is the complaint the
   * scope dialog rebuild already addressed for the chip strip. A profile has a
   * name, so the button can finally say it.
   */
  public activeLabel(): string {
    if (this.state.activeId === ALL_SOURCES_ID) return 'All sources';
    const profile = this.state.profiles.find((p) => p.id === this.state.activeId);
    if (profile) return profile.name;
    const scope = effectiveScope(this.state);
    const count = scope.providers.length + scope.indexers.length;
    return count > 0 ? `${count} source${count === 1 ? '' : 's'}` : 'All sources';
  }

  private write(next: ProfileState): ProfileState {
    this.state = next;
    this.datastore.setObject(SETTINGS_KEY, next);

    // The whole reason this class exists: everything downstream keeps reading
    // one `SearchScope`, and never learns that profiles happened.
    const scope = effectiveScope(next);
    this.scope.set({ providers: scope.providers, indexers: scope.indexers });
    return next;
  }
}

export { ALL_SOURCES_ID, DRAFT_ID };
