import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseTorrentAddress, torrentAddress } from './torrentAddress.ts';

const HASH = 'ABCDEF0123456789ABCDEF0123456789ABCDEF01';

test('an address round-trips, with the hash folded to lower case', () => {
  assert.deepEqual(parseTorrentAddress(torrentAddress(HASH, 3)), { infoHash: HASH.toLowerCase(), fileIndex: 3 });
  assert.deepEqual(parseTorrentAddress(`torrent://${HASH}/0`), { infoHash: HASH.toLowerCase(), fileIndex: 0 });
});

test('anything else is not a torrent address', () => {
  for (const url of [
    undefined,
    '',
    'magnet:?xt=urn:btih:' + HASH,
    `torrent://${HASH}`,
    `torrent://${HASH}/x`,
    `torrent://${HASH.slice(1)}/1`,
    'http://127.0.0.1:4000/stream/1',
    'cs3ext://Provider/abc',
  ]) {
    assert.equal(parseTorrentAddress(url), null, String(url));
  }
});
