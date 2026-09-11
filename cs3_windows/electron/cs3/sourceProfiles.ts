/**
 * Named search configurations, and the rule that switching between them costs
 * nothing.
 *
 * ## The frustration this exists to remove
 *
 * The scope picker has one selection and one "All sources" button, and the
 * button is wired to `persist(new Set(), new Set())` — it *erases* the
 * selection. Someone who spent a minute picking eleven Hindi providers out of
 * two hundred, searched, then pressed All sources to check something, has
 * thrown that minute away with no undo. The picker cannot even tell them what
 * they lost, because it no longer knows.
 *
 * The fix is not a confirmation prompt. It is that **All sources is a mode, not
 * an erasure**: switching to it puts the selection down rather than deleting
 * it, and switching back picks it up again. Everything else here — naming a
 * selection, keeping several, duplicating one — follows from having somewhere
 * to put a selection that is not the bin.
 *
 * ## The shape
 *
 * Three kinds of thing can be driving the scope at any moment:
 *
 *  - **All sources** — no narrowing. The reserved id `all`.
 *  - **A saved profile** — a name, a selection, and the facets that go with it.
 *  - **The draft** — an unnamed selection, which is what the picker has always
 *    had. It survives every switch, and it is what "Save as a profile" saves.
 *
 * Pure and separately tested because the interesting cases are all about what
 * must *not* be lost, and losing something quietly is exactly the kind of bug
 * that only shows up when someone has already lost it.
 */

/** The reserved profile that means "do not narrow anything". */
export const ALL_SOURCES_ID = 'all';

/** The unnamed working selection. Not a profile; it has no name and is never listed. */
export const DRAFT_ID = '';

export interface SourceProfile {
  id: string;
  name: string;
  /** Extension provider names. Empty means this profile narrows no providers. */
  providers: string[];
  /** Torrent indexer ids. */
  indexers: string[];
  /**
   * Facet narrowing carried with the profile.
   *
   * These are *display* filters in the picker — they decide which rows are
   * shown, not which sources are searched — and they are stored here because a
   * profile that reopens showing two hundred rows has not restored the thing
   * the user actually made.
   */
  languages: string[];
  contentTypes: string[];
  /**
   * Adult providers, when this profile is active.
   *
   * `undefined` means "follow the global setting", which is the only safe
   * default: a profile is a search convenience and must not be a way to turn
   * the content gate on without the consent step that owns it. A profile may
   * narrow to `false`, never widen to `true` — see `effectiveAdult`.
   */
  adult?: false;
  createdAt: number;
  updatedAt: number;
}

export interface ProfileState {
  profiles: SourceProfile[];
  /** `all`, a profile id, or `''` for the draft. */
  activeId: string;
  /** The unnamed selection. Preserved across every switch — that is the point. */
  draft: { providers: string[]; indexers: string[]; languages: string[]; contentTypes: string[] };
}

export const EMPTY_DRAFT: ProfileState['draft'] = {
  providers: [],
  indexers: [],
  languages: [],
  contentTypes: [],
};

export const INITIAL_STATE: ProfileState = {
  profiles: [],
  activeId: ALL_SOURCES_ID,
  draft: EMPTY_DRAFT,
};

/** What a profile or the draft resolves to, for the scope store to apply. */
export interface EffectiveScope {
  providers: string[];
  indexers: string[];
  languages: string[];
  contentTypes: string[];
  /** True only when something is actually narrowed. */
  narrowed: boolean;
}

export const UNNARROWED: EffectiveScope = {
  providers: [],
  indexers: [],
  languages: [],
  contentTypes: [],
  narrowed: false,
};

function uniq(values: readonly string[]): string[] {
  return [...new Set(values.filter((v) => typeof v === 'string' && v.length > 0))];
}

/** A stable id that is safe in a datastore key and readable in a log line. */
function idFor(name: string, taken: ReadonlySet<string>): string {
  const stem =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'profile';
  // `all` is reserved and an empty id is the draft; both must never be minted.
  let candidate = stem === ALL_SOURCES_ID ? `${stem}-1` : stem;
  let n = 2;
  while (taken.has(candidate)) candidate = `${stem}-${n++}`;
  return candidate;
}

export function findProfile(state: ProfileState, id: string): SourceProfile | undefined {
  return state.profiles.find((profile) => profile.id === id);
}

/**
 * What the active selection actually is.
 *
 * The one place that answers "what should the search ask", so a new kind of
 * profile cannot be added without this being updated to say what it means.
 */
export function effectiveScope(state: ProfileState): EffectiveScope {
  if (state.activeId === ALL_SOURCES_ID) return UNNARROWED;

  const source =
    state.activeId === DRAFT_ID ? state.draft : findProfile(state, state.activeId) ?? state.draft;

  const providers = uniq(source.providers);
  const indexers = uniq(source.indexers);
  return {
    providers,
    indexers,
    languages: uniq(source.languages),
    contentTypes: uniq(source.contentTypes),
    /**
     * Facets alone do not narrow the search.
     *
     * They decide which rows the picker *shows*; the search asks whatever is
     * ticked. A profile with a language filter and nothing ticked searches
     * everything, and reporting it as narrowed would put "1 source" on a button
     * that searches two hundred — the exact lie `SearchScopeStore` was fixed to
     * stop telling.
     */
    narrowed: providers.length > 0 || indexers.length > 0,
  };
}

/**
 * Whether adult providers are in scope, given the profile and the global gate.
 *
 * A profile can only ever narrow. The global setting owns the consent step, and
 * a saved search configuration must not be a way around it — a profile shared
 * in a backup, or made months ago, cannot switch the gate on.
 */
export function effectiveAdult(state: ProfileState, globallyAllowed: boolean): boolean {
  if (!globallyAllowed) return false;
  const profile = findProfile(state, state.activeId);
  return profile?.adult === false ? false : true;
}

/**
 * Switches which configuration is driving the search.
 *
 * **Nothing is destroyed here, ever.** That single property is what the whole
 * module exists for: the previous behaviour of "All sources" was to overwrite
 * the selection with an empty one, and the request was simply that it stop
 * doing that.
 */
export function activate(state: ProfileState, id: string): ProfileState {
  if (id !== ALL_SOURCES_ID && id !== DRAFT_ID && !findProfile(state, id)) {
    // An id that names nothing falls back to All sources rather than to a
    // silent no-op, so a deleted profile in a stale UI cannot leave the search
    // scoped to something that no longer exists.
    return { ...state, activeId: ALL_SOURCES_ID };
  }
  return { ...state, activeId: id };
}

/**
 * Records an edit to the selection.
 *
 * Where it lands depends on what is active, and the rule is "edit what you are
 * looking at":
 *
 *  - A named profile is *theirs*, and ticking a box while it is active means
 *    changing it. Forking to an unsaved copy would create a second thing they
 *    did not ask for and leave the profile they were editing untouched.
 *  - All sources has no selection to edit, so an edit made there becomes the
 *    draft and the draft becomes active. This is the path someone takes when
 *    they start narrowing from nothing, and it must not silently write into a
 *    profile they last used a week ago.
 */
export function edit(
  state: ProfileState,
  patch: Partial<ProfileState['draft']>,
  now = Date.now()
): ProfileState {
  const apply = (base: ProfileState['draft']): ProfileState['draft'] => ({
    providers: uniq(patch.providers ?? base.providers),
    indexers: uniq(patch.indexers ?? base.indexers),
    languages: uniq(patch.languages ?? base.languages),
    contentTypes: uniq(patch.contentTypes ?? base.contentTypes),
  });

  const active = findProfile(state, state.activeId);
  if (active) {
    return {
      ...state,
      profiles: state.profiles.map((profile) =>
        profile.id === active.id ? { ...profile, ...apply(active), updatedAt: now } : profile
      ),
    };
  }

  return { ...state, activeId: DRAFT_ID, draft: apply(state.draft) };
}

/** Saves the current selection under a name, and switches to it. */
export function create(
  state: ProfileState,
  name: string,
  from: Partial<ProfileState['draft']> = {},
  now = Date.now()
): { state: ProfileState; profile: SourceProfile } {
  const base = { ...effectiveScope(state), ...from };
  const taken = new Set(state.profiles.map((p) => p.id));
  const profile: SourceProfile = {
    id: idFor(name, taken),
    name: name.trim() || 'Untitled profile',
    providers: uniq(base.providers),
    indexers: uniq(base.indexers),
    languages: uniq(base.languages),
    contentTypes: uniq(base.contentTypes),
    createdAt: now,
    updatedAt: now,
  };
  return {
    state: { ...state, profiles: [...state.profiles, profile], activeId: profile.id },
    profile,
  };
}

export function rename(state: ProfileState, id: string, name: string, now = Date.now()): ProfileState {
  const trimmed = name.trim();
  if (!trimmed) return state;
  return {
    ...state,
    profiles: state.profiles.map((profile) =>
      profile.id === id ? { ...profile, name: trimmed, updatedAt: now } : profile
    ),
  };
}

/**
 * Copies a profile, and switches to the copy.
 *
 * The copy is what someone edits when they want "the Anime one, but with two
 * more sites" and do not want to find out afterwards that they changed the
 * original. Naming is `(copy)`, then `(copy 2)` — a numbered suffix beats a
 * hash for the same reason download paths use one: the common case stays
 * readable.
 */
export function duplicate(state: ProfileState, id: string, now = Date.now()): ProfileState {
  const source = findProfile(state, id);
  if (!source) return state;

  const names = new Set(state.profiles.map((p) => p.name));
  let name = `${source.name} (copy)`;
  for (let n = 2; names.has(name); n++) name = `${source.name} (copy ${n})`;

  const taken = new Set(state.profiles.map((p) => p.id));
  const copy: SourceProfile = {
    ...source,
    id: idFor(name, taken),
    name,
    createdAt: now,
    updatedAt: now,
  };
  return { ...state, profiles: [...state.profiles, copy], activeId: copy.id };
}

/**
 * Removes a profile.
 *
 * Deleting the active one falls back to **All sources**, not to whichever
 * profile happens to be next in the list — silently searching a different
 * user-defined set of sites than the one that was on screen is worse than
 * searching everything, because only one of the two is obvious from the button.
 */
export function remove(state: ProfileState, id: string): ProfileState {
  if (!findProfile(state, id)) return state;
  const profiles = state.profiles.filter((profile) => profile.id !== id);
  return {
    profiles,
    draft: state.draft,
    activeId: state.activeId === id ? ALL_SOURCES_ID : state.activeId,
  };
}

/**
 * Reads whatever was on disk into a state this module can work with.
 *
 * Total: a corrupt or half-written record produces the initial state rather
 * than throwing. Losing profiles is bad; refusing to open the search panel
 * because a stored array is not an array is worse.
 */
export function hydrate(stored: unknown): ProfileState {
  const record = (stored ?? {}) as Partial<ProfileState>;
  const profiles = Array.isArray(record.profiles)
    ? record.profiles
        .filter((profile): profile is SourceProfile => Boolean(profile?.id && profile?.name))
        .map((profile) => ({
          id: String(profile.id),
          name: String(profile.name),
          providers: uniq(profile.providers ?? []),
          indexers: uniq(profile.indexers ?? []),
          languages: uniq(profile.languages ?? []),
          contentTypes: uniq(profile.contentTypes ?? []),
          adult: profile.adult === false ? (false as const) : undefined,
          createdAt: Number(profile.createdAt) || Date.now(),
          updatedAt: Number(profile.updatedAt) || Date.now(),
        }))
    : [];

  const draftRecord = (record.draft ?? {}) as Partial<ProfileState['draft']>;
  const draft = {
    providers: uniq(draftRecord.providers ?? []),
    indexers: uniq(draftRecord.indexers ?? []),
    languages: uniq(draftRecord.languages ?? []),
    contentTypes: uniq(draftRecord.contentTypes ?? []),
  };

  const activeId = typeof record.activeId === 'string' ? record.activeId : ALL_SOURCES_ID;
  const known = activeId === ALL_SOURCES_ID || activeId === DRAFT_ID
    || profiles.some((profile) => profile.id === activeId);

  return { profiles, draft, activeId: known ? activeId : ALL_SOURCES_ID };
}
