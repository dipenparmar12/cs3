import assert from 'node:assert/strict';
import { mergePlaybacks } from './bookmarkStore.ts';
import type { SavedPlayback } from '../../src/types/library.ts';

const play = (title: string, extra: Partial<SavedPlayback> = {}, url = 'a'): SavedPlayback => ({
  savedAt: 1,
  source: { id: title, title, providerName: 'P', directUrl: url } as SavedPlayback['source'],
  ...extra,
});

// Vacuous: nothing saved before.
assert.deepEqual(mergePlaybacks({}, play('A')), { playback: play('A'), previousPlaybacks: undefined });

// No new playback keeps what was there.
assert.deepEqual(mergePlaybacks({ playback: play('A') }, undefined).playback, play('A'));

// A different source keeps the earlier one.
const both = mergePlaybacks({ playback: play('A') }, play('B'));
assert.equal(both.playback?.source?.title, 'B');
assert.deepEqual(both.previousPlaybacks?.map((p) => p.source?.title), ['A']);

// The same source with a refreshed link replaces in place: no duplicate.
const refreshed = mergePlaybacks(both, play('B', {}, 'fresh'));
assert.equal(refreshed.playback?.source?.directUrl, 'fresh');
assert.deepEqual(refreshed.previousPlaybacks?.map((p) => p.source?.title), ['A']);

// Going back to A promotes it rather than listing it twice.
const back = mergePlaybacks(refreshed, play('A'));
assert.equal(back.playback?.source?.title, 'A');
assert.deepEqual(back.previousPlaybacks?.map((p) => p.source?.title), ['B']);

// Same release on another episode is a separate entry.
const ep2 = mergePlaybacks({ playback: play('A', { season: 1, episode: 1 }) }, play('A', { season: 1, episode: 2 }));
assert.equal(ep2.previousPlaybacks?.length, 1);

console.log('bookmarkPlaybacks: ok');
