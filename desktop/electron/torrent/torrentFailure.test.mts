import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classifyTorrentFailure } from './torrentFailure.ts';

test("the engine's own messages map to their kind and stage", () => {
  const cases: Array<[string, string, string]> = [
    ['That torrent is not imported.', 'not-imported', 'input'],
    ['No file was chosen.', 'invalid-input', 'input'],
    ['Timed out binding the torrent port (6881)', 'engine-start', 'engine'],
    ['Torrent server did not report a port', 'engine-start', 'engine'],
    [
      'Timed out fetching torrent metadata. The swarm may be dead or unreachable — try a source with more seeders.',
      'metadata-timeout',
      'metadata',
    ],
    ['No peers answered for this torrent — the swarm looks dead.', 'no-peers', 'peers'],
    ['This torrent does not contain episode S1E3.', 'no-media', 'files'],
    ['This torrent does not contain a playable video file.', 'no-media', 'files'],
    ['Timed out waiting for enough data to start playback.', 'file-not-ready', 'files'],
    ['No peers responded — the swarm looks dead.', 'no-peers', 'peers'],
  ];
  for (const [message, kind, stage] of cases) {
    assert.deepEqual(classifyTorrentFailure(message), { kind, stage }, message);
  }
});

test('an unrecognised failure is a playback failure, never a guess', () => {
  assert.deepEqual(classifyTorrentFailure('socket hang up'), { kind: 'stream-failed', stage: 'playback' });
  assert.deepEqual(classifyTorrentFailure(''), { kind: 'stream-failed', stage: 'playback' });
});
