import { test } from 'node:test';
import assert from 'node:assert/strict';

import { blockOrder, entitiesFirst, rowPosition, suggestionRows } from './suggestionLayout.ts';

const cena = [{ name: 'John Cena' }];

test('a query that is a person’s name puts the person first', () => {
  assert.equal(entitiesFirst('john  cena', [{ title: 'Peacemaker' }], cena), true);
});

test('a title of exactly that name keeps titles first', () => {
  assert.equal(entitiesFirst('Inception', [{ title: 'Inception' }], [{ name: 'Inception' }]), false);
  assert.equal(entitiesFirst('Shingeki', [{ title: 'Attack on Titan', originalTitle: 'Shingeki' }], [{ name: 'Shingeki' }]), false);
});

test('a partial name or no people keeps titles first', () => {
  assert.equal(entitiesFirst('john ce', [], cena), false);
  assert.equal(entitiesFirst('john cena', [], []), false);
  assert.equal(entitiesFirst('', [], cena), false);
});

test('rows are laid out in one order, and each kind’s position follows from it', () => {
  const counts = { history: 2, entity: 1, suggestion: 3 };
  const people = suggestionRows(blockOrder(false, true), counts);
  assert.deepEqual(people.map((r) => r.kind), ['entity', 'suggestion', 'suggestion', 'suggestion', 'history', 'history']);
  assert.equal(rowPosition(people, 'suggestion', 1), 2);
  const titles = suggestionRows(blockOrder(false, false), counts);
  assert.deepEqual(titles.map((r) => r.kind), ['suggestion', 'suggestion', 'suggestion', 'entity', 'history', 'history']);
  assert.equal(rowPosition(titles, 'entity', 0), 3);
  const empty = suggestionRows(blockOrder(true, true), counts);
  assert.deepEqual(empty.slice(0, 2).map((r) => r.kind), ['history', 'history']);
  assert.equal(rowPosition(suggestionRows(blockOrder(false, false), { history: 0, entity: 0, suggestion: 1 }), 'entity', 2), -1);
});
