import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  claimScreenSearch,
  episodeTerms,
  forgetScreenQueries,
  matchesScreenQuery,
  rememberScreenQuery,
  rememberedScreenQuery,
  screenSearchAvailable,
} from './screenSearch.ts';

test('nothing typed matches everything, including a row with no fields', () => {
  assert.equal(matchesScreenQuery('', ['Dune']), true);
  assert.equal(matchesScreenQuery('   ', []), true);
});

test('every word must appear, in any field and any order', () => {
  const dune = ['Dune', 2021, 'Movie'];
  assert.equal(matchesScreenQuery('dune 2021', dune), true);
  assert.equal(matchesScreenQuery('2021 DUNE', dune), true);
  assert.equal(matchesScreenQuery('dune 1984', dune), false);
});

test('a word does not match across two fields joined together', () => {
  // "Dune" + "Part Two" must not read as "dunepart"; the boundary is kept.
  assert.equal(matchesScreenQuery('dunepart', ['Dune', 'Part Two']), false);
});

test('accents and case are ignored', () => {
  assert.equal(matchesScreenQuery('amelie', ['Amélie']), true);
  assert.equal(matchesScreenQuery('AMÉLIE', ['amelie']), true);
});

test('punctuation matches with or without it', () => {
  assert.equal(matchesScreenQuery('spider-man', ['Spider-Man: No Way Home']), true);
  assert.equal(matchesScreenQuery('spiderman', ['Spider-Man: No Way Home']), true);
  assert.equal(matchesScreenQuery('spider man', ['Spider-Man: No Way Home']), true);
});

test('arrays, numbers and empty values are all accepted as fields', () => {
  assert.equal(matchesScreenQuery('drama', ['Title', undefined, null, false, ['Action', 'Drama']]), true);
  assert.equal(matchesScreenQuery('1080', ['Title', 1080]), true);
});

test('an episode is found by every common spelling', () => {
  const fields = ['Severance', episodeTerms(1, 2)];
  for (const query of ['s01e02', 'S1E2', '1x02', 'season 1', 'episode 2', 's01 e02']) {
    assert.equal(matchesScreenQuery(query, fields), true, query);
  }
  assert.equal(matchesScreenQuery('s01e03', fields), false);
  assert.equal(matchesScreenQuery('season 3', fields), false);
});

test('episode terms are empty without a season or episode', () => {
  assert.deepEqual(episodeTerms(undefined, undefined), []);
  assert.deepEqual(episodeTerms(2, undefined), ['s02', 's2', 'season 2']);
});

test('a remembered query is per screen and cleared all at once', () => {
  forgetScreenQueries();
  rememberScreenQuery('library', 'dune');
  rememberScreenQuery('history', 'failed');
  assert.equal(rememberedScreenQuery('library'), 'dune');
  rememberScreenQuery('library', '');
  assert.equal(rememberedScreenQuery('library'), '');
  forgetScreenQueries();
  assert.equal(rememberedScreenQuery('history'), '');
});

test('availability survives a remount and a double release', () => {
  assert.equal(screenSearchAvailable(), false);
  const first = claimScreenSearch();
  const second = claimScreenSearch(); // new mount before the old one unmounts
  first();
  first();
  assert.equal(screenSearchAvailable(), true);
  second();
  assert.equal(screenSearchAvailable(), false);
});
