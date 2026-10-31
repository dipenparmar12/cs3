import { test } from 'node:test';
import assert from 'node:assert/strict';

import { shouldSkipStalledTorrent, startOfFilePercent } from './torrentStall.ts';

const waiting = { readyBytes: 1_000_000, readyTargetBytes: 4_000_000, peers: 3, isPlayable: false, isStalled: false };

test('peers connected and the start of the file still arriving is its own state, with progress', () => {
  assert.equal(startOfFilePercent(waiting), 25);
  assert.equal(startOfFilePercent({ ...waiting, readyBytes: 4_000_000 }), 99);
  assert.equal(startOfFilePercent({ ...waiting, readyBytes: 0 }), 0);
});

test('not that state: no peers, stalled, playable, or no target', () => {
  assert.equal(startOfFilePercent({ ...waiting, peers: 0 }), null);
  assert.equal(startOfFilePercent({ ...waiting, isStalled: true }), null);
  assert.equal(startOfFilePercent({ ...waiting, isPlayable: true }), null);
  assert.equal(startOfFilePercent({ ...waiting, readyTargetBytes: undefined }), null);
  assert.equal(startOfFilePercent({ ...waiting, readyTargetBytes: 0 }), null);
});

test('a swarm with nobody in it is left after 20 s, before anything played', () => {
  assert.equal(shouldSkipStalledTorrent({ startedPlayback: false, stalledMs: 19_000, peers: 0, isStalled: false }), null);
  assert.match(shouldSkipStalledTorrent({ startedPlayback: false, stalledMs: 21_000, peers: 0, isStalled: false })!, /No peers/);
});

test('peers but no data waits for the engine to call it stalled', () => {
  assert.equal(shouldSkipStalledTorrent({ startedPlayback: false, stalledMs: 30_000, peers: 3, isStalled: false }), null);
  assert.ok(shouldSkipStalledTorrent({ startedPlayback: false, stalledMs: 46_000, peers: 3, isStalled: true }));
});

test('once the film is playing a stall is never an automatic switch', () => {
  assert.equal(shouldSkipStalledTorrent({ startedPlayback: true, stalledMs: 90_000, peers: 0, isStalled: true }), null);
});
