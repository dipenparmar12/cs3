import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prettyType, stateOf, type Row } from './sourceScopeModel.ts';

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
