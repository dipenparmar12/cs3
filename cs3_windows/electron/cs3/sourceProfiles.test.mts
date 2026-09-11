/**
 * Named search configurations, and the one property they exist for.
 *
 *   bun run test source-profiles
 *   node --experimental-strip-types electron/cs3/sourceProfiles.test.mts
 *
 * The reported frustration was that pressing "All sources" erased a selection
 * that took a minute to build, with no undo and no way for the picker to even
 * say what was lost. So the test that matters most is the boring one: switch
 * away, switch back, and find it exactly as it was. Nearly every case below is
 * some version of "this must not quietly lose something".
 */
import assert from 'node:assert/strict';
import {
  ALL_SOURCES_ID,
  DRAFT_ID,
  INITIAL_STATE,
  activate,
  create,
  duplicate,
  edit,
  effectiveAdult,
  effectiveScope,
  findProfile,
  hydrate,
  remove,
  rename,
  type ProfileState,
} from './sourceProfiles.ts';

const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

const HINDI = ['VegaMovies', 'Moviesmod', 'BollyFlix'];

/** A draft with a real selection in it, the way the picker leaves one. */
const withSelection = (): ProfileState =>
  edit(INITIAL_STATE, { providers: HINDI, indexers: ['1337x'], languages: ['hi'] });

// --- the reported bug ---------------------------------------------------------

test('a selection made from All sources becomes the draft, and is active', () => {
  const state = withSelection();
  assert.equal(state.activeId, DRAFT_ID);
  assert.deepEqual(effectiveScope(state).providers, HINDI);
  assert.equal(effectiveScope(state).narrowed, true);
});

test('switching to All sources does not erase the selection', () => {
  const selected = withSelection();
  const all = activate(selected, ALL_SOURCES_ID);

  assert.deepEqual(effectiveScope(all), {
    providers: [],
    indexers: [],
    languages: [],
    contentTypes: [],
    narrowed: false,
  });
  assert.deepEqual(all.draft.providers, HINDI, 'the selection is put down, not thrown away');
});

test('switching back picks the selection up exactly as it was', () => {
  const selected = withSelection();
  const roundTrip = activate(activate(selected, ALL_SOURCES_ID), DRAFT_ID);
  assert.deepEqual(effectiveScope(roundTrip), effectiveScope(selected));
});

test('a whole tour of the profiles leaves the draft untouched', () => {
  let state = withSelection();
  state = create(state, 'Anime', { providers: ['Nyaa'] }).state;
  state = activate(state, ALL_SOURCES_ID);
  state = create(state, 'Movies', { providers: ['YTS'] }).state;
  state = activate(state, DRAFT_ID);
  assert.deepEqual(state.draft.providers, HINDI);
});

// --- where an edit lands --------------------------------------------------------

test('editing while a profile is active edits that profile', () => {
  const { state, profile } = create(INITIAL_STATE, 'Anime', { providers: ['Nyaa'] });
  const edited = edit(state, { providers: ['Nyaa', 'AnimeTosho'] });

  assert.equal(edited.activeId, profile.id, 'and stays on it');
  assert.deepEqual(findProfile(edited, profile.id)?.providers, ['Nyaa', 'AnimeTosho']);
  assert.deepEqual(edited.draft.providers, [], 'without touching the draft');
});

/**
 * The path someone takes when they start narrowing from nothing. It must not
 * write into whichever profile they last used.
 */
test('editing while All sources is active writes to the draft, not to a profile', () => {
  const { state, profile } = create(INITIAL_STATE, 'Anime', { providers: ['Nyaa'] });
  const edited = edit(activate(state, ALL_SOURCES_ID), { providers: ['YTS'] });

  assert.equal(edited.activeId, DRAFT_ID);
  assert.deepEqual(edited.draft.providers, ['YTS']);
  assert.deepEqual(findProfile(edited, profile.id)?.providers, ['Nyaa'], 'profile is untouched');
});

test('an edit patches only the dimension it names', () => {
  const state = edit(withSelection(), { indexers: ['nyaa'] });
  assert.deepEqual(state.draft.providers, HINDI, 'providers survive an indexer-only edit');
  assert.deepEqual(state.draft.indexers, ['nyaa']);
  assert.deepEqual(state.draft.languages, ['hi']);
});

test('duplicates in a selection are collapsed', () => {
  const state = edit(INITIAL_STATE, { providers: ['A', 'A', 'B'] });
  assert.deepEqual(state.draft.providers, ['A', 'B']);
});

// --- narrowing, and what does not count as narrowing ------------------------------

/**
 * The lie `SearchScopeStore` was fixed to stop telling: a button reading
 * "1 source" over a search that asks two hundred. Facets decide which rows the
 * picker *shows*; they narrow nothing.
 */
test('a facet filter alone is not a narrowed scope', () => {
  const state = edit(INITIAL_STATE, { languages: ['hi'], contentTypes: ['Movie'] });
  const scope = effectiveScope(state);
  assert.equal(scope.narrowed, false);
  assert.deepEqual(scope.languages, ['hi'], 'but it is still carried, so the picker restores it');
});

test('All sources reports nothing narrowed whatever the draft holds', () => {
  assert.equal(effectiveScope(activate(withSelection(), ALL_SOURCES_ID)).narrowed, false);
});

// --- create / rename / duplicate / delete -------------------------------------------

test('creating a profile saves the current selection and switches to it', () => {
  const { state, profile } = create(withSelection(), 'Hindi');
  assert.equal(state.activeId, profile.id);
  assert.deepEqual(profile.providers, HINDI);
  assert.deepEqual(profile.languages, ['hi']);
});

test('profile ids are unique even when the names collide', () => {
  let state = create(INITIAL_STATE, 'Movies').state;
  state = create(state, 'Movies').state;
  state = create(state, 'Movies').state;
  const ids = state.profiles.map((p) => p.id);
  assert.equal(new Set(ids).size, 3, `ids collided: ${ids.join(', ')}`);
});

test('a profile can never be minted with a reserved id', () => {
  const state = create(INITIAL_STATE, 'All').state;
  assert.notEqual(state.profiles[0].id, ALL_SOURCES_ID);
  assert.notEqual(state.profiles[0].id, DRAFT_ID);
});

test('a nameless profile still gets a name', () => {
  const { profile } = create(INITIAL_STATE, '   ');
  assert.ok(profile.name.trim().length > 0);
});

test('renaming keeps the id, so the active profile stays active', () => {
  const { state, profile } = create(INITIAL_STATE, 'Anime');
  const renamed = rename(state, profile.id, 'Anime & Manga');
  assert.equal(renamed.activeId, profile.id);
  assert.equal(findProfile(renamed, profile.id)?.name, 'Anime & Manga');
});

test('renaming to blank is refused rather than applied', () => {
  const { state, profile } = create(INITIAL_STATE, 'Anime');
  assert.equal(findProfile(rename(state, profile.id, '  '), profile.id)?.name, 'Anime');
});

test('duplicating copies the selection and leaves the original alone', () => {
  const { state, profile } = create(INITIAL_STATE, 'Anime', { providers: ['Nyaa'] });
  const copied = duplicate(state, profile.id);
  const copy = copied.profiles.find((p) => p.id !== profile.id);

  assert.equal(copied.profiles.length, 2);
  assert.deepEqual(copy?.providers, ['Nyaa']);
  assert.equal(copied.activeId, copy?.id, 'and switches to the copy — that is what it is for');

  const edited = edit(copied, { providers: ['Nyaa', 'AniDex'] });
  assert.deepEqual(findProfile(edited, profile.id)?.providers, ['Nyaa'], 'original untouched');
});

test('copies of copies get distinguishable names', () => {
  const { state, profile } = create(INITIAL_STATE, 'Anime');
  const once = duplicate(state, profile.id);
  const twice = duplicate(once, profile.id);
  const names = twice.profiles.map((p) => p.name);
  assert.equal(new Set(names).size, names.length, `names collided: ${names.join(', ')}`);
});

/**
 * Falling back to the next profile in the list would silently search a
 * different user-defined set of sites than the one that was on screen — and
 * unlike "everything", that is not obvious from the button.
 */
test('deleting the active profile falls back to All sources', () => {
  let state = create(INITIAL_STATE, 'Anime').state;
  const { state: withSecond, profile: second } = create(state, 'Movies');
  state = remove(withSecond, second.id);
  assert.equal(state.activeId, ALL_SOURCES_ID);
  assert.equal(state.profiles.length, 1);
});

test('deleting an inactive profile leaves the active one alone', () => {
  const { state: first, profile: anime } = create(INITIAL_STATE, 'Anime');
  const { state: second, profile: movies } = create(first, 'Movies');
  const after = remove(second, anime.id);
  assert.equal(after.activeId, movies.id);
});

test('deleting never touches the draft', () => {
  const { state, profile } = create(withSelection(), 'Hindi');
  assert.deepEqual(remove(state, profile.id).draft.providers, HINDI);
});

test('deleting something that does not exist changes nothing', () => {
  const { state } = create(INITIAL_STATE, 'Anime');
  assert.deepEqual(remove(state, 'no-such-profile'), state);
});

// --- the stale-id case --------------------------------------------------------------

test('activating an id that names nothing falls back to All sources', () => {
  const state = activate(withSelection(), 'deleted-in-another-window');
  assert.equal(state.activeId, ALL_SOURCES_ID);
  assert.deepEqual(state.draft.providers, HINDI, 'and still does not lose the draft');
});

// --- the adult gate -------------------------------------------------------------------

/**
 * A profile can narrow and never widen. The global setting owns the consent
 * step, and a profile restored from a backup or made months ago must not be a
 * way around it.
 */
test('a profile cannot turn adult content on', () => {
  const { state } = create(INITIAL_STATE, 'Anything');
  assert.equal(effectiveAdult(state, false), false);
  assert.equal(effectiveAdult(state, true), true, 'and does not turn it off either, by default');
});

test('a profile can turn adult content off for itself', () => {
  const { state, profile } = create(INITIAL_STATE, 'Family');
  const gated: ProfileState = {
    ...state,
    profiles: state.profiles.map((p) => (p.id === profile.id ? { ...p, adult: false as const } : p)),
  };
  assert.equal(effectiveAdult(gated, true), false);
});

// --- hydration ------------------------------------------------------------------------

test('a round trip through storage preserves everything', () => {
  const { state } = create(withSelection(), 'Hindi');
  const restored = hydrate(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(restored.profiles.map((p) => p.name), ['Hindi']);
  assert.equal(restored.activeId, state.activeId);
  assert.deepEqual(restored.draft.providers, HINDI);
});

test('nothing stored is the initial state, not a crash', () => {
  assert.deepEqual(hydrate(undefined), INITIAL_STATE);
  assert.deepEqual(hydrate(null), INITIAL_STATE);
});

/**
 * Losing profiles is bad. Refusing to open the search panel because a stored
 * array is not an array is worse.
 */
test('a corrupt record degrades rather than throwing', () => {
  const state = hydrate({ profiles: 'not an array', activeId: 42, draft: 7 });
  assert.deepEqual(state.profiles, []);
  assert.equal(state.activeId, ALL_SOURCES_ID);
  assert.deepEqual(state.draft.providers, []);
});

test('a stored active id naming a deleted profile falls back', () => {
  const state = hydrate({ profiles: [], activeId: 'gone', draft: { providers: ['A'] } });
  assert.equal(state.activeId, ALL_SOURCES_ID);
  assert.deepEqual(state.draft.providers, ['A'], 'and the draft still survives');
});

test('profiles missing an id or a name are dropped rather than half-loaded', () => {
  const state = hydrate({
    profiles: [{ id: 'a', name: 'Good' }, { id: '', name: 'No id' }, { name: 'No id at all' }],
  });
  assert.deepEqual(state.profiles.map((p) => p.name), ['Good']);
});

// --- runner ----------------------------------------------------------------

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failed++;
    console.log(`  FAIL ${name}`);
    console.log(`       ${error instanceof Error ? error.message : String(error)}`);
  }
}
console.log(failed === 0 ? `\n${tests.length} passed` : `\n${failed} of ${tests.length} FAILED`);
process.exit(failed === 0 ? 0 : 1);
