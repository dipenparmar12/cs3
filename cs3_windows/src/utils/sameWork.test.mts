import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sameWorkMatches } from './sameWork.ts';

const row = (name: string, apiName: string, year?: number) => ({
  name,
  apiName,
  year,
  url: `cs3ext://${apiName}/${encodeURIComponent(name)}`,
});

test('matches the same title across punctuation, case and accents', () => {
  const found = sameWorkMatches(
    [row('Ice Cream Man', 'A'), row('ICE-CREAM MAN', 'B'), row('Amélie', 'C')],
    'Ice Cream Man'
  );
  assert.deepEqual(found.map((r) => r.apiName), ['A', 'B']);
  assert.equal(sameWorkMatches([row('Amelie', 'C')], 'Amélie').length, 1);
});

test('never opens a different film that merely starts the same way', () => {
  assert.deepEqual(sameWorkMatches([row('Dune: Part Two', 'A'), row('Dune Drifter', 'B')], 'Dune'), []);
});

test('a disagreeing year disqualifies; exact year ranks first', () => {
  const found = sameWorkMatches(
    [row('Kill', 'Off', 2023), row('Kill', 'None'), row('Kill', 'Exact', 2024), row('Kill', 'Wrong', 2017)],
    'Kill',
    2024
  );
  assert.deepEqual(found.map((r) => r.apiName), ['Exact', 'None', 'Off']);
});

test('rows without an address are skipped and the list is capped', () => {
  const many = Array.from({ length: 9 }, (_, i) => row('Kill', `P${i}`));
  assert.equal(sameWorkMatches(many, 'Kill').length, 4);
  assert.deepEqual(sameWorkMatches([{ ...row('Kill', 'A'), url: '' }], 'Kill'), []);
});
