import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fileFitsEpisode, pickEpisodeHandle } from './episodeMatch.ts';

const list = [
  { url: 'ep1', season: 1, episode: 1 },
  { url: 'ep2', season: 1, episode: 2 },
  { url: 'ep3', season: 1, episode: 3 },
  { url: 's2e1', season: 2, episode: 1 },
];

test('each episode resolves to its own handle, in any order', () => {
  for (const [season, episode, url] of [[1, 2, 'ep2'], [1, 3, 'ep3'], [1, 1, 'ep1'], [2, 1, 's2e1'], [1, 2, 'ep2']] as const) {
    assert.equal(pickEpisodeHandle(list, season, episode), url);
  }
});

test('an episode the provider does not list is nothing, never the series page or episode 1', () => {
  assert.equal(pickEpisodeHandle(list, 1, 9), null);
  assert.equal(pickEpisodeHandle(list, 3, 1), null);
  assert.equal(pickEpisodeHandle([], 1, 1), null);
});

test('a single-season show listed without seasons still resolves season 1', () => {
  const unnumbered = [{ url: 'a', episode: 1 }, { url: 'b', episode: 2 }];
  assert.equal(pickEpisodeHandle(unnumbered, 1, 2), 'b');
  assert.equal(pickEpisodeHandle(unnumbered, 2, 2), 'b', 'a page with no seasons is one season (an anime season page)');
  const mixed = [{ url: 'x', season: 1, episode: 1 }, { url: 'y', episode: 2 }];
  assert.equal(pickEpisodeHandle(mixed, 2, 2), null, 'with seasons listed, season 2 is not guessed');
});

test("a season pack's file is taken only when it is the requested episode", () => {
  assert.equal(fileFitsEpisode('Show.S01E01.1080p.mkv', 1, 2), false, "E1's file is not E2");
  assert.equal(fileFitsEpisode('Show.S01E02.1080p.mkv', 1, 2), true);
  assert.equal(fileFitsEpisode('Show.S02E02.1080p.mkv', 1, 2), false, 'another season');
  assert.equal(fileFitsEpisode('feature.mkv', 1, 2), true, 'a name that says nothing is trusted');
  assert.equal(fileFitsEpisode('Show.S01E01.mkv', undefined, undefined), true, 'no episode asked');
});
