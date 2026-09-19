import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  areAllFilteredSelected,
  excludeSection,
  getFilteredMembers,
  includeSection,
  prettyType,
  stateOf,
  type Row,
} from './sourceScopeModel.ts';

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
