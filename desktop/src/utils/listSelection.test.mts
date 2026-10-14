import assert from 'node:assert/strict';
import { test } from 'node:test';
import { groupState, invertIn, selectAllIn, toggleGroup, visibleSelection } from './listSelection.ts';

const ids = (set: ReadonlySet<string>) => [...set].sort();

test('only what is on screen counts as selected', () => {
  // "a" was selected under another category; "z" was removed by a refresh.
  const stored = new Set(['a', 'b', 'z']);
  assert.deepEqual(ids(visibleSelection(stored, ['b', 'c'])), ['b']);
});

test('select all takes the view, and drops what is outside it', () => {
  assert.deepEqual(ids(selectAllIn(['b', 'c'])), ['b', 'c']);
});

test('invert stays inside the view', () => {
  assert.deepEqual(ids(invertIn(new Set(['b']), ['a', 'b', 'c'])), ['a', 'c']);
  // A hidden selection is not inverted into view, nor kept.
  assert.deepEqual(ids(invertIn(new Set(['hidden', 'a']), ['a', 'b'])), ['b']);
  assert.deepEqual(ids(invertIn(new Set(), [])), []);
});

test('a group toggles as one: on unless every member already was', () => {
  assert.deepEqual(ids(toggleGroup(new Set(['e1']), ['e1', 'e2'])), ['e1', 'e2']);
  assert.deepEqual(ids(toggleGroup(new Set(['e1', 'e2', 'x']), ['e1', 'e2'])), ['x']);
  assert.equal(groupState(new Set(['e1']), ['e1', 'e2']), 'some');
  assert.equal(groupState(new Set(['e1', 'e2']), ['e1', 'e2']), 'all');
  assert.equal(groupState(new Set(), ['e1']), 'none');
});
