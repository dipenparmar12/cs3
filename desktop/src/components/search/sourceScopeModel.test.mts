import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  areAllFilteredSelected,
  calculateSelectionImpact,
  EMPTY_INTENT,
  excludeSection,
  getFilteredMembers,
  includeSection,
  intentFromSnapshot,
  matchingPreset,
  presetIntent,
  prettyType,
  providersForIntent,
  stateOf,
  toggleIntent,
  type Row,
  type ScopeIntent,
} from './sourceScopeModel.ts';
import type { ProviderTreeRepository } from '../../types/plugin';

/**
 * The tri-state is what makes a three-level tree legible: a repository whose
 * extensions are half ticked has to look different from one that is fully
 * ticked and from one that is clear. Getting `mixed` wrong in either direction
 * means the top of the tree lies about the bottom of it.
 */
test('stateOf reports on, off and mixed from the members alone', () => {
  const selected = new Set(['A', 'B']);
  assert.equal(stateOf(['A', 'B'], selected), 'on');
  assert.equal(stateOf(['A'], selected), 'on');
  assert.equal(stateOf(['C'], selected), 'off');
  assert.equal(stateOf(['A', 'C'], selected), 'mixed');
  assert.equal(stateOf(['C', 'D'], selected), 'off');
});

/**
 * A row with nothing behind it is `off`, never `on`.
 *
 * An extension that registered no providers has no members, and the vacuous
 * reading of "every member is selected" would draw it as ticked — advertising a
 * scope that queries nothing, which is the exact failure the picker was
 * rewritten to remove, arriving through the checkbox instead of the list.
 */
test('stateOf treats a row with no members as off', () => {
  assert.equal(stateOf([], new Set()), 'off');
  assert.equal(stateOf([], new Set(['anything'])), 'off');
});

test('stateOf counts a repeated member once', () => {
  // Two extensions can register the same provider name; the clash resolver
  // keeps one, but a repository row can still list it twice in `members`.
  assert.equal(stateOf(['A', 'A'], new Set(['A'])), 'on');
  assert.equal(stateOf(['A', 'A', 'B'], new Set(['A'])), 'mixed');
  assert.equal(stateOf(['A', 'A', 'B'], new Set(['A', 'B'])), 'on');
});

test('prettyType splits the PascalCase names upstream uses', () => {
  assert.equal(prettyType('TvSeries'), 'Tv Series');
  assert.equal(prettyType('AsianDrama'), 'Asian Drama');
  assert.equal(prettyType('Movie'), 'Movie');
  assert.equal(prettyType('NSFW'), 'NSFW', 'An all-caps name is left alone');
});

test('a Row carries what the dialog needs to draw and toggle it', () => {
  const row: Row = {
    key: 'repo:x/ext:y',
    kind: 'ext',
    depth: 1,
    label: 'Extension',
    members: ['Provider One', 'Provider Two'],
    expanded: true,
    isIndexer: false,
  };
  assert.equal(stateOf(row.members, new Set(['Provider One'])), 'mixed');
  assert.equal(stateOf(row.members, new Set(row.members)), 'on');
});

test('getFilteredMembers collects distinct providers and indexers from leaf rows only', () => {
  const rows: Row[] = [
    {
      key: 'repo:1',
      kind: 'repo',
      depth: 0,
      label: 'Repo 1',
      members: ['P1', 'P2'],
      isIndexer: false,
    },
    {
      key: 'repo:1/leaf:1',
      kind: 'leaf',
      depth: 1,
      label: 'P1',
      members: ['P1'],
      isIndexer: false,
    },
    {
      key: 'repo:1/leaf:2',
      kind: 'leaf',
      depth: 1,
      label: 'P2',
      members: ['P2'],
      isIndexer: false,
    },
    {
      key: 'group:indexers',
      kind: 'repo',
      depth: 0,
      label: 'Torrents',
      members: ['I1'],
      isIndexer: true,
    },
    {
      key: 'group:indexers/leaf:1',
      kind: 'leaf',
      depth: 1,
      label: 'I1',
      members: ['I1'],
      isIndexer: true,
    },
  ];

  const filtered = getFilteredMembers(rows);
  assert.deepEqual(filtered.providers.sort(), ['P1', 'P2']);
  assert.deepEqual(filtered.indexers, ['I1']);
});

test('areAllFilteredSelected accurately reports whether filtered members are selected', () => {
  const filtered = { providers: ['P1', 'P2'], indexers: ['I1'] };
  assert.equal(areAllFilteredSelected(filtered, new Set(['P1', 'P2']), new Set(['I1'])), true);
  assert.equal(areAllFilteredSelected(filtered, new Set(['P1']), new Set(['I1'])), false);
  assert.equal(areAllFilteredSelected(filtered, new Set(['P1', 'P2']), new Set()), false);
  assert.equal(areAllFilteredSelected({ providers: [], indexers: [] }, new Set(), new Set()), false);
});

test('includeSection and excludeSection cleanly bulk-toggle row members', () => {
  const row: Row = {
    key: 'repo:r',
    kind: 'repo',
    depth: 0,
    label: 'Repo',
    members: ['P1', 'P2'],
    isIndexer: false,
  };

  const included = includeSection(row, new Set(['P3']), new Set(['I1']));
  assert.deepEqual([...included.providers].sort(), ['P1', 'P2', 'P3']);
  assert.deepEqual([...included.indexers], ['I1']);

  const excluded = excludeSection(row, included.providers, included.indexers);
  assert.deepEqual([...excluded.providers], ['P3']);
  assert.deepEqual([...excluded.indexers], ['I1']);
});

test('calculateSelectionImpact accurately determines delta and consequential threshold', () => {
  const current = {
    providers: new Set(['P1', 'P2', 'P3', 'P4']),
    indexers: new Set(['I1']),
  };
  const target = {
    providers: new Set(['P1', 'P2', 'P5']),
    indexers: new Set(['I1', 'I2']),
  };

  const impact = calculateSelectionImpact(current, target);
  assert.deepEqual(impact.removedProviders.sort(), ['P3', 'P4']);
  assert.deepEqual(impact.addedProviders, ['P5']);
  assert.deepEqual(impact.removedIndexers, []);
  assert.deepEqual(impact.addedIndexers, ['I2']);
  assert.equal(impact.totalRemoved, 2);
  assert.equal(impact.totalAdded, 2);
  assert.equal(impact.totalUnchanged, 3); // P1, P2, I1
  assert.equal(impact.newTotal, 5);
  assert.equal(impact.isConsequential, false); // 2 removed < 3, 2 added < 10

  // Consequential removal (e.g. clear all)
  const clearImpact = calculateSelectionImpact(current, { providers: new Set(), indexers: new Set() });
  assert.equal(clearImpact.totalRemoved, 5);
  assert.equal(clearImpact.isConsequential, true);

  // Routine 1-item checkbox toggle
  const routineImpact = calculateSelectionImpact(
    current,
    { providers: new Set([...current.providers, 'P5']), indexers: current.indexers }
  );
  assert.equal(routineImpact.totalAdded, 1);
  assert.equal(routineImpact.totalRemoved, 0);
  assert.equal(routineImpact.isConsequential, false);
});

// --- quick setup: chips are what was ticked, nothing more ------------------


/** Shaped like the real tree: most movie providers carry series too. */
const TREE = [
  {
    name: 'Repo',
    extensions: [
      { name: 'Hin', language: 'hi', providers: [
        { name: 'HindiMovies', supportedTypes: ['Movie', 'TvSeries'] },
        { name: 'HindiAnime', supportedTypes: ['Anime'] },
      ] },
      { name: 'Eng', language: 'en', providers: [
        { name: 'EnglishMovies', supportedTypes: ['Movie', 'TvSeries', 'Documentary'] },
        { name: 'EnglishUS', lang: 'en-US', supportedTypes: ['Movie'] },
      ] },
      { name: 'Tam', language: 'ta', providers: [
        { name: 'TamilMovies', supportedTypes: ['Movie', 'TvSeries'] },
        { name: 'Switched off', supportedTypes: ['Movie'], enabled: false },
      ] },
      { name: 'Adult', language: 'en', providers: [
        { name: 'AdultEn', supportedTypes: ['NSFW'] },
      ] },
      { name: 'Adult JP', language: 'ja', providers: [
        { name: 'AdultJa', supportedTypes: ['NSFW'] },
      ] },
    ],
  },
] as unknown as ProviderTreeRepository[];

const selectable = (p: { enabled?: boolean }) => p.enabled !== false;
const chips = (languages: string[] = [], types: string[] = []): ScopeIntent => ({
  languages: new Set(languages),
  types: new Set(types),
});

/**
 * The rule the picker used before 2026-10-21, kept as the counter-example: the
 * chips were rebuilt from the providers the last change selected.
 */
function inferredFromProviders(names: Set<string>): ScopeIntent {
  const out = chips();
  for (const ext of TREE[0].extensions) {
    for (const p of ext.providers) {
      if (!names.has(p.name)) continue;
      const lang = p.lang ?? ext.language;
      if (lang) out.languages.add(lang);
      for (const t of p.supportedTypes) out.types.add(t);
    }
  }
  return out;
}

/** What the picker shows after a save: the stored chips read back. */
function afterSave(intent: ScopeIntent): ScopeIntent {
  return intentFromSnapshot({
    activeId: '',
    draft: { languages: [...intent.languages], contentTypes: [...intent.types] },
  });
}

test('ticking Movies leaves Series and every language unticked', () => {
  const ticked = toggleIntent(EMPTY_INTENT, 'types', 'Movie');
  const selected = providersForIntent(TREE, ticked, selectable);
  assert.deepEqual([...afterSave(ticked).types], ['Movie']);
  assert.equal(afterSave(ticked).languages.size, 0);

  // The old rule lit Series and four languages from the same selection.
  const old = inferredFromProviders(selected);
  assert.ok(old.types.has('TvSeries') && old.languages.size >= 3, 'the counter-example still shows the bug');
});

test('the NSFW content chip ticks no language', () => {
  const ticked = toggleIntent(EMPTY_INTENT, 'types', 'NSFW');
  assert.equal(afterSave(ticked).languages.size, 0);
  assert.deepEqual([...providersForIntent(TREE, ticked, selectable)].sort(), ['AdultEn', 'AdultJa']);
  assert.ok(inferredFromProviders(providersForIntent(TREE, ticked, selectable)).languages.size === 2);
});

test('ticking a language changes only that language', () => {
  const hindi = toggleIntent(EMPTY_INTENT, 'languages', 'hi');
  const both = toggleIntent(hindi, 'languages', 'ta');
  assert.deepEqual([...both.languages], ['hi', 'ta']);
  assert.equal(both.types.size, 0, 'no content chip appears');
  assert.deepEqual([...toggleIntent(both, 'languages', 'hi').languages], ['ta'], 'and unticks only itself');
});

test('chips combine as any-of within a row and all-of across rows', () => {
  assert.deepEqual(
    [...providersForIntent(TREE, chips(['hi', 'ta']), selectable)].sort(),
    ['HindiAnime', 'HindiMovies', 'TamilMovies'],
    'Hindi or Tamil'
  );
  assert.deepEqual(
    [...providersForIntent(TREE, chips(['hi'], ['Movie']), selectable)],
    ['HindiMovies'],
    'Hindi and Movies'
  );
  assert.deepEqual(
    [...providersForIntent(TREE, chips(['hi'], ['Movie', 'Anime']), selectable)].sort(),
    ['HindiAnime', 'HindiMovies'],
    'Movies or Anime, in Hindi'
  );
  assert.equal(providersForIntent(TREE, chips(['hi'], ['NSFW']), selectable).size, 0, 'nothing matches both');
});

test('no chips selects nothing, which the scope reads as every source', () => {
  assert.equal(providersForIntent(TREE, EMPTY_INTENT, selectable).size, 0);
});

test('a switched-off provider is never selected by a chip', () => {
  assert.ok(!providersForIntent(TREE, chips(['ta']), selectable).has('Switched off'));
});

test('stored chips come back from the profile or draft that is active', () => {
  const snapshot = {
    activeId: 'p1',
    profiles: [{ id: 'p1', languages: ['ta'], contentTypes: ['Movie'] }],
    draft: { languages: ['hi'], contentTypes: [] },
  };
  assert.deepEqual([...intentFromSnapshot(snapshot).languages], ['ta']);
  assert.deepEqual([...intentFromSnapshot({ ...snapshot, activeId: '' }).languages], ['hi']);
  assert.equal(intentFromSnapshot({ ...snapshot, activeId: 'all' }).languages.size, 0);
});

test('a hand-picked selection shows no chips, however many providers it holds', () => {
  const handPicked = intentFromSnapshot({
    activeId: '',
    draft: { languages: [], contentTypes: [] },
  });
  assert.equal(handPicked.languages.size + handPicked.types.size, 0);
});

test('a preset is a set of chips built from what is installed', () => {
  const available = { languages: ['hi', 'en', 'en-US', 'ta'], types: ['Movie', 'Anime', 'NSFW'] };
  assert.deepEqual([...presetIntent('english', available).languages], ['en', 'en-US']);
  assert.deepEqual([...presetIntent('anime', available).types], ['Anime'], 'only types that exist');
  assert.deepEqual([...presetIntent('nsfw', available).types], ['NSFW']);
  assert.equal(presetIntent('nsfw', available).languages.size, 0);
});

test('the unnamed selection is a preset exactly when its chips are', () => {
  const available = { languages: ['hi', 'en'], types: ['Movie', 'Anime'] };
  const presets = ['english', 'hindi', 'anime'] as const;
  assert.equal(matchingPreset(chips(['hi']), [...presets], available), 'hindi');
  assert.equal(matchingPreset(chips(['hi'], ['Movie']), [...presets], available), undefined);
  assert.equal(matchingPreset(EMPTY_INTENT, [...presets], available), undefined, 'no chips is not a preset');
  // Nothing here carries Asian drama, so that preset has no chips at all; it
  // must not light up whenever nothing is chosen.
  assert.equal(matchingPreset(EMPTY_INTENT, ['drama'], available), undefined);
});
