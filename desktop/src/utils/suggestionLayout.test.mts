import { test } from 'node:test';
import assert from 'node:assert/strict';

import { blockOrder, foldName, rowPosition, suggestionRows } from './suggestionLayout.ts';

test('names fold without case, accents, apostrophes or punctuation', () => {
  assert.equal(foldName(' Amélie  Poulain '), 'amelie poulain');
  assert.equal(foldName('Surf’s Up'), 'surfs up');
  assert.equal(foldName('Spider-Man: No Way Home'), 'spider man no way home');
});

test('while typing, people always lead; with an empty box, history does', () => {
  assert.deepEqual(blockOrder(false), ['entity', 'suggestion', 'history']);
  assert.deepEqual(blockOrder(true), ['history', 'entity', 'suggestion']);
});

test('rows are laid out in one order, and each kind’s position follows from it', () => {
  const counts = { history: 2, entity: 1, suggestion: 3 };
  const typing = suggestionRows(blockOrder(false), counts);
  assert.deepEqual(typing.map((r) => r.kind), ['entity', 'suggestion', 'suggestion', 'suggestion', 'history', 'history']);
  assert.equal(rowPosition(typing, 'suggestion', 1), 2);
  assert.equal(rowPosition(typing, 'history', 0), 4);
  const empty = suggestionRows(blockOrder(true), counts);
  assert.deepEqual(empty.slice(0, 2).map((r) => r.kind), ['history', 'history']);
  assert.equal(rowPosition(suggestionRows(blockOrder(false), { history: 0, entity: 0, suggestion: 1 }), 'entity', 2), -1);
});
