import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFranchise } from './wikidata.ts';

const row = (series: string, seriesLabel: string, imdb: string, label: string, date?: string, ordinal?: string) => ({
  series: { value: series },
  seriesLabel: { value: seriesLabel },
  imdb: { value: imdb },
  memberLabel: { value: label },
  ...(date ? { date: { value: date } } : {}),
  ...(ordinal ? { ordinal: { value: ordinal } } : {}),
});

test('orders by release date, marks the current title, merges duplicate dates', () => {
  const franchise = parseFranchise(
    {
      results: {
        bindings: [
          row('S1', 'Dune', 'tt15239678', 'Dune: Part Two', '2024-03-01T00:00:00Z', '2'),
          row('S1', 'Dune', 'tt1160419', 'Dune', '2021-10-22T00:00:00Z', '1'),
          row('S1', 'Dune', 'tt1160419', 'Dune', '2021-09-03T00:00:00Z'),
        ],
      },
    },
    'tt15239678'
  );
  assert.equal(franchise?.name, 'Dune');
  assert.deepEqual(
    franchise?.entries.map((e) => [e.imdbId, e.year, e.current]),
    [
      ['tt1160419', 2021, false],
      ['tt15239678', 2024, true],
    ]
  );
});

test('prefers the most specific series and ignores singletons and unlabelled items', () => {
  const bindings = [
    row('U', 'Universe', 'tt1', 'A', '2008-01-01'),
    row('U', 'Universe', 'tt2', 'B', '2010-01-01'),
    row('U', 'Universe', 'tt3', 'C', '2012-01-01'),
    row('T', 'Trilogy', 'tt1', 'A', '2008-01-01'),
    row('T', 'Trilogy', 'tt3', 'C', '2012-01-01'),
    row('X', 'Lonely', 'tt1', 'A'),
    row('T', 'Trilogy', 'tt9', 'Q12345'),
  ];
  const franchise = parseFranchise({ results: { bindings } }, 'tt1');
  assert.equal(franchise?.name, 'Trilogy');
  assert.equal(franchise?.entries.length, 2);
});

test('nothing usable answers null', () => {
  assert.equal(parseFranchise({ results: { bindings: [] } }, 'tt1'), null);
});
