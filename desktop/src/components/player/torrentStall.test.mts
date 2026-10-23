import { test } from 'node:test';
import assert from 'node:assert/strict';

import { shouldSkipStalledTorrent } from './torrentStall.ts';

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
