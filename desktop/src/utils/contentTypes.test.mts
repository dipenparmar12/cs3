import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TvType, type SearchResponse } from '../types/api.ts';
import { allCount, liveBelongsInAll, matchesTab } from './contentTypes.ts';

const row = (name: string, type: TvType): SearchResponse => ({ name, url: name, apiName: 'p', type });
const film = row('Batman', TvType.Movie);
const channel = row('Batman TV', TvType.Live);

test('live channels are left out of All when there is anything else', () => {
  const items = [film, channel];
  assert.equal(liveBelongsInAll(items), false);
  assert.equal(allCount(items), 1);
  assert.equal(matchesTab(channel, 'all'), false);
  assert.equal(matchesTab(channel, 'live'), true);
  assert.equal(matchesTab(film, 'all'), true);
});

test('a search that found only channels still shows them under All', () => {
  assert.equal(liveBelongsInAll([channel]), true);
  assert.equal(allCount([channel]), 1);
  assert.equal(matchesTab(channel, 'all', { liveInAll: true }), true);
});

test('no results: All is empty, not hidden', () => {
  assert.equal(allCount([]), 0);
});
