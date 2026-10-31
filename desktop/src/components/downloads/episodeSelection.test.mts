import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  batchEpisodes,
  episodeKey,
  filterEpisodes,
  groupBySeason,
  seasonState,
  toggleSeason,
} from './episodeSelection.ts';
import type { Episode } from '../../types/api.ts';

const ep = (season: number, episode: number, name = `Episode ${episode}`): Episode =>
  ({ url: `s${season}e${episode}`, season, episode, name }) as Episode;
const series = [ep(2, 2), ep(1, 3, 'The Long Night'), ep(1, 1), ep(2, 1), ep(1, 2)];

test('episodes are grouped by season, in order', () => {
  const groups = groupBySeason(series);
  assert.deepEqual(groups.map((g) => [g.season, g.episodes.map((e) => e.episode)]), [[1, [1, 2, 3]], [2, [1, 2]]]);
});

test('a filter finds an episode by number, season, both, or name', () => {
  const groups = groupBySeason(series);
  const shown = (q: string) => filterEpisodes(groups, q).flatMap((g) => g.episodes.map((e) => episodeKey(e)));
  assert.deepEqual(shown('2'), ['1:2', '2:2']);
  assert.deepEqual(shown('s2'), ['2:1', '2:2']);
  assert.deepEqual(shown('s1e3'), ['1:3']);
  assert.deepEqual(shown('2x01'), ['2:1']);
  assert.deepEqual(shown('long night'), ['1:3']);
  assert.equal(filterEpisodes(groups, '').length, 2);
});

test("a season's select-all is all, some or none, and toggles the whole season", () => {
  const [season1] = groupBySeason(series);
  let selected = new Set<string>(['1:1']);
  assert.equal(seasonState(season1, selected), 'some');
  selected = toggleSeason(season1, selected);
  assert.equal(seasonState(season1, selected), 'all');
  selected = toggleSeason(season1, selected);
  assert.equal(seasonState(season1, selected), 'none');
});

test('the batch is in order and carries a per-episode quality only where one was set', () => {
  const out = batchEpisodes(series, new Set(['2:1', '1:2']), new Map([['2:1', 720]]));
  assert.deepEqual(out.map((e) => [e.season, e.episode, e.maxResolution]), [[1, 2, undefined], [2, 1, 720]]);
});
