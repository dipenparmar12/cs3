import assert from 'node:assert/strict';
import { test } from 'node:test';
import { imdbIdFromQuery } from './cinemeta.ts';

test('a bare IMDb id is the work it names', () => {
  assert.equal(imdbIdFromQuery('tt1160419'), 'tt1160419');
  assert.equal(imdbIdFromQuery('  TT15239678 '), 'tt15239678');
});

test('every spelling of an IMDb title page is understood', () => {
  for (const url of [
    'https://www.imdb.com/title/tt1160419/',
    'https://www.imdb.com/title/tt1160419/?ref_=nv_sr_srsg_0_tt_8_nm_0_in_0_q_dune',
    'http://m.imdb.com/title/tt1160419',
    'imdb.com/title/tt1160419/reviews',
    'https://www.imdb.com/de/title/tt1160419/',
  ]) {
    assert.equal(imdbIdFromQuery(url), 'tt1160419', url);
  }
});

test('text that merely contains an id, and other links, stay text', () => {
  assert.equal(imdbIdFromQuery('Dune tt1160419'), null);
  assert.equal(imdbIdFromQuery('https://www.imdb.com/name/nm0000206/'), null);
  assert.equal(imdbIdFromQuery('https://notimdb.com/title/tt1160419/'), null);
  assert.equal(imdbIdFromQuery('tt123'), null);
  assert.equal(imdbIdFromQuery('Dune'), null);
});
