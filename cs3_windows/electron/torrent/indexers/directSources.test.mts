/**
 * The direct-link half of the indexer contract.
 *
 *   bun run test:direct-sources
 *   node --experimental-strip-types electron/torrent/indexers/directSources.test.mts
 *
 * These rows exist because every failure on this path is silent. A Stremio
 * `stream` carries either an `infoHash` or a `url`, and for as long as this
 * adapter filtered on the first, every `url` stream — which is 100% of what a
 * debrid-fronted addon returns — vanished before anything could report it. The
 * viewer saw an addon that "found nothing"; there was no error, no diagnosis and
 * nothing in any log.
 *
 * The opposite mistake is worse and equally quiet: a direct link that keeps a
 * `fileIdx` or acquires a magnet reaches the torrent engine, which asks a swarm
 * for a file that is not in one.
 */
import assert from 'node:assert/strict';

import { stremioStreamToRaw } from './aggregators.ts';
import { directSourceIdentity, finaliseResult } from './base.ts';

const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

const INDEXER = { id: 'comet', name: 'Comet' };

// --- the mapping -----------------------------------------------------------

test('a torrent stream still maps to a torrent, unchanged', () => {
  const [raw] = stremioStreamToRaw({
    infoHash: 'DD8255ECDC7CA55FB0BBF81323D87062DB1F6D1C',
    fileIdx: 3,
    title: 'Dune 2021 2160p\nDune.2021.2160p.mkv\n👤 433 💾 29.26 GB ⚙️ TorrentGalaxy',
  });
  assert.equal(raw.infoHash, 'dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c');
  assert.equal(raw.fileIndex, 3);
  assert.equal(raw.seeders, 433);
  assert.ok(raw.magnet?.startsWith('magnet:?xt=urn:btih:dd8255'));
  assert.equal(raw.directUrl, undefined);
});

test('a url stream is kept rather than filtered away', () => {
  // The whole bug, in one assertion: this used to return nothing at all.
  const out = stremioStreamToRaw({
    name: 'Comet | RD',
    title: 'Dune.Part.Two.2024.2160p.WEB-DL\n💾 24.1 GB ⚙️ RealDebrid',
    url: 'https://real-debrid.example/d/ABC123/Dune.Part.Two.mkv',
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].directUrl, 'https://real-debrid.example/d/ABC123/Dune.Part.Two.mkv');
});

test('a direct link never carries a magnet, an infohash or a file index', () => {
  const [raw] = stremioStreamToRaw({
    url: 'https://cdn.example/movie.mkv',
    fileIdx: 7,
    title: 'Some Release 1080p',
  });
  assert.equal(raw.magnet, undefined);
  assert.equal(raw.infoHash, undefined);
  // `fileIdx` indexes a file inside an archive. A direct link is the file.
  assert.equal(raw.fileIndex, undefined);
});

test('proxy headers the addon supplied are carried', () => {
  const [raw] = stremioStreamToRaw({
    url: 'https://cdn.example/movie.mkv',
    behaviorHints: { proxyHeaders: { request: { Referer: 'https://addon.example/' } } },
  });
  // Without these the origin 403s, and the failure reads as a dead source.
  assert.deepEqual(raw.directHeaders, { Referer: 'https://addon.example/' });
});

test('a declared videoSize outranks the size parsed out of the title', () => {
  const [raw] = stremioStreamToRaw({
    title: 'Release\n💾 1.00 GB',
    url: 'https://cdn.example/movie.mkv',
    behaviorHints: { videoSize: 2_500_000_000 },
  });
  assert.equal(raw.sizeBytes, 2_500_000_000);
});

test('a direct link is not credited with the seeders of the torrent behind it', () => {
  // An addon printing 👤 433 beside a cached link is describing the swarm it
  // fetched from, not what it just handed over. Copying it would rank a debrid
  // link by a swarm the viewer will never touch.
  const [raw] = stremioStreamToRaw({
    title: 'Release\n👤 433 💾 4 GB',
    url: 'https://cdn.example/movie.mkv',
  });
  assert.equal(raw.seeders, 1);
});

test('the transport is left for the inspector, even when the URL announces it', () => {
  // Nothing is decided from the URL. `.m3u8` in an address is a guess about a
  // filename somebody chose, and providers serve playlists from `.php` routes.
  const [raw] = stremioStreamToRaw({ url: 'https://cdn.example/stream/master.m3u8' });
  assert.equal(raw.isM3u8, undefined);
  assert.equal(raw.isDash, undefined);
});

test('a stream with neither infoHash nor url is dropped', () => {
  assert.deepEqual(stremioStreamToRaw({ name: 'Nothing here' }), []);
  assert.deepEqual(stremioStreamToRaw(undefined), []);
});

// --- finalisation ----------------------------------------------------------

test('a direct raw source survives finalisation', () => {
  // It used to return null here too: no infohash, no magnet, no torrentUrl.
  const result = finaliseResult(
    { title: 'Dune Part Two 2024 2160p WEB-DL', directUrl: 'https://cdn.example/d.mkv' },
    INDEXER
  );
  assert.ok(result);
  assert.equal(result.directUrl, 'https://cdn.example/d.mkv');
  assert.equal(result.magnet, '');
  assert.equal(result.indexerName, 'Comet');
  assert.equal(result.parsed.resolution, 2160);
});

test('the identity is the URL, and it matches what the provider path mints', () => {
  // Same function, same prefix, so an addon and an extension resolving a title
  // to the same host collapse to one row instead of showing it twice.
  const result = finaliseResult(
    { title: 'x', directUrl: 'https://cdn.example/d.mkv' },
    INDEXER
  );
  assert.equal(result?.infoHash, directSourceIdentity('https://cdn.example/d.mkv'));
  assert.match(result!.infoHash, /^ext-[0-9a-f]{20}$/);
});

test('two indexers offering the same URL agree on the identity', () => {
  const a = finaliseResult({ title: 'a', directUrl: 'https://cdn.example/d.mkv' }, INDEXER);
  const b = finaliseResult(
    { title: 'b', directUrl: 'https://cdn.example/d.mkv' },
    { id: 'mediafusion', name: 'MediaFusion' }
  );
  assert.equal(a?.infoHash, b?.infoHash);
});

test('a direct source clears the minimum-seeders floor', () => {
  // `minSeeders` defaults to 1, and swarm health is meaningless here. Reporting
  // 0 would hard-reject every direct source in `rankResults`.
  const result = finaliseResult({ title: 'x', directUrl: 'https://cdn.example/d.mkv' }, INDEXER);
  assert.ok((result?.seeders ?? 0) >= 1);
});

test('a torrent with no infohash and no torrent file is still rejected', () => {
  // The direct branch must not become a way for a broken torrent row to pass.
  assert.equal(finaliseResult({ title: 'x' }, INDEXER), null);
  assert.equal(finaliseResult({ title: 'x', infoHash: 'not-a-hash' }, INDEXER), null);
});

// --- runner ----------------------------------------------------------------

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failed++;
    console.log(`  FAIL ${name}`);
    console.log(`       ${error instanceof Error ? error.message : String(error)}`);
  }
}
console.log(failed === 0 ? `\n${tests.length} passed` : `\n${failed} of ${tests.length} FAILED`);
process.exit(failed === 0 ? 0 : 1);
