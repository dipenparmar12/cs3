import { test } from 'node:test';
import assert from 'node:assert/strict';

import { dedupeByInfoHash, rankResults } from './ranker.ts';
import { parseReleaseName } from './releaseParser.ts';
import { DEFAULT_SOURCE_PREFERENCES, type TorrentResult } from '../../src/types/torrent.ts';

function torrent(title: string, seeders: number | undefined, hash = title): TorrentResult {
  return {
    infoHash: hash.padEnd(40, '0').slice(0, 40),
    title,
    magnet: `magnet:?xt=urn:btih:${hash}`,
    sizeBytes: 0,
    seeders: seeders ?? 0,
    ...(seeders === undefined ? { seedersUnknown: true } : {}),
    leechers: 0,
    indexerId: 'x',
    indexerName: 'X',
    parsed: parseReleaseName(title),
    score: 0,
    scoreReasons: [],
  };
}

const ctx = { expectedTitle: 'Dune', expectedYear: 2021, preferences: DEFAULT_SOURCE_PREFERENCES };

test('a known zero-seeder torrent is rejected; an unreported count is kept', () => {
  const { accepted, rejected } = rankResults(
    [torrent('Dune.2021.1080p.WEB-DL', 0, 'a'), torrent('Dune.2021.720p.WEB-DL', undefined, 'b')],
    ctx
  );
  assert.deepEqual(accepted.map((r) => r.infoHash[0]), ['b']);
  assert.match(rejected[0].reason, /Below minimum seeders/);
});

test('an unreported count ranks below a measured healthy swarm', () => {
  const { accepted } = rankResults(
    [torrent('Dune.2021.1080p.WEB-DL', undefined, 'a'), torrent('Dune.2021.1080p.WEB-DL.x', 40, 'b')],
    ctx
  );
  assert.equal(accepted[0].infoHash[0], 'b');
});

test('an exact title outranks a close one with the same swarm', () => {
  const { accepted } = rankResults(
    [torrent('Dune.The.Sisterhood.2021.1080p.WEB-DL', 30, 'a'), torrent('Dune.2021.1080p.WEB-DL', 30, 'b')],
    ctx
  );
  assert.equal(accepted[0].infoHash[0], 'b');
  assert.ok(accepted[0].scoreReasons.includes('Exact title (+80)'));
});

test('a duplicate from an indexer that knows the count makes the merged row known', () => {
  const [merged] = dedupeByInfoHash([torrent('Dune.2021.1080p', undefined, 'a'), torrent('Dune.2021.1080p', 12, 'a')]);
  assert.equal(merged.seeders, 12);
  assert.equal(merged.seedersUnknown, undefined);
  const [unknownLast] = dedupeByInfoHash([torrent('Dune.2021.1080p', 12, 'c'), torrent('Dune.2021.1080p', undefined, 'c')]);
  assert.equal(unknownLast.seeders, 12, 'an unknown count never lowers a known one');
});
