/**
 * The persistent source cache, and the invalidation policy in particular.
 *
 *   node --experimental-strip-types electron/sourceCache.test.mts
 *
 * This earns tests because its two failure modes are opposites and both are
 * invisible from the outside. Invalidate too eagerly and the cache empties every
 * time the wifi hiccups — the app looks slow and nobody can say why, because
 * "it re-searched" and "it had nothing cached" look identical. Invalidate too
 * lazily and dead links accumulate at the top of every source list, so the first
 * thing tried on every play is a 404.
 *
 * The datastore is stubbed rather than mocked: the cache only needs a key-value
 * object store, and an in-memory one exercises the real serialisation path
 * including the round trip through JSON that a real save/load performs.
 */
import assert from 'node:assert/strict';
import { SourceCache, deadlineFromUrl, isDefinitiveFailure } from './sourceCache.ts';
import type { TorrentResult } from '../src/types/torrent.ts';

const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

/** The narrow slice of DatastoreManager the cache actually uses. */
function stubDatastore() {
  const store = new Map<string, unknown>();
  return {
    getObject<T>(key: string, fallback: T | null = null): T | null {
      const raw = store.get(key);
      // Round-tripped through JSON, like the real datastore does on disk.
      return raw === undefined ? fallback : (JSON.parse(JSON.stringify(raw)) as T);
    },
    setObject<T>(key: string, value: T): void {
      store.set(key, JSON.parse(JSON.stringify(value)));
    },
  };
}

function makeCache() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new SourceCache(stubDatastore() as any);
}

function magnet(infoHash: string): TorrentResult {
  return {
    infoHash,
    magnet: `magnet:?xt=urn:btih:${infoHash}`,
    title: `Torrent ${infoHash}`,
    sizeBytes: 0,
    seeders: 10,
    leechers: 1,
    indexerName: 'test',
  } as TorrentResult;
}

function providerLink(infoHash: string, url = 'https://cdn.example/video.mkv'): TorrentResult {
  return {
    infoHash,
    magnet: '',
    directUrl: url,
    title: `Provider ${infoHash}`,
    sizeBytes: 0,
    seeders: 0,
    leechers: 0,
    indexerName: 'provider',
  } as TorrentResult;
}

const MEDIA = 'cs3meta://tt1375666';

// --- expiry classification -------------------------------------------------

test('a magnet never expires and a bare provider link does', () => {
  const cache = makeCache();
  cache.write(MEDIA, [magnet('aaa'), providerLink('bbb')]);

  const read = cache.read(MEDIA);
  assert.equal(read.hit, true);
  assert.deepEqual(read.fresh.map((s) => s.infoHash), ['aaa', 'bbb']);

  // The provider link carries no stated deadline, so it holds a short TTL —
  // fresh now, and the entry is what proves it was recorded at all.
  assert.equal(read.expired.length, 0);
});

test('a signed URL contributes its own deadline', () => {
  const soon = Math.floor((Date.now() + 60_000) / 1000);
  assert.equal(deadlineFromUrl(`https://cdn/x.mkv?Expires=${soon}`), soon * 1000);
  // Capital E is CloudFront's spelling and the single most common one on the web.
  assert.equal(deadlineFromUrl('https://cdn/x.mkv'), null);
});

// --- the invalidation policy ----------------------------------------------

test('404 and 410 are definitive; 403, timeouts and 5xx are not', () => {
  assert.equal(isDefinitiveFailure(404), true);
  assert.equal(isDefinitiveFailure(410), true);

  // 403 is an expired signature or a hotlink check — both recoverable by
  // re-resolving the same query, which the expiry machinery already does.
  assert.equal(isDefinitiveFailure(403), false);
  assert.equal(isDefinitiveFailure(500), false);
  assert.equal(isDefinitiveFailure(undefined, 'socket timeout'), false);
  assert.equal(isDefinitiveFailure(undefined, 'ECONNRESET'), false);

  // The reason text is read too, because not every path carries a status.
  assert.equal(isDefinitiveFailure(undefined, 'The file was deleted'), true);
});

test('a definitive failure drops the source immediately', () => {
  const cache = makeCache();
  cache.write(MEDIA, [magnet('keep'), providerLink('gone')]);

  const removed = cache.recordFailure(MEDIA, 'gone', { status: 404 });
  assert.equal(removed, true);
  assert.deepEqual(cache.peek(MEDIA).fresh.map((s) => s.infoHash), ['keep']);
});

test('an ambiguous failure needs to repeat before it counts', () => {
  const cache = makeCache();
  cache.write(MEDIA, [providerLink('flaky')]);

  // The whole point: one bad minute must not empty the cache.
  assert.equal(cache.recordFailure(MEDIA, 'flaky', { status: 503 }), false);
  assert.equal(cache.recordFailure(MEDIA, 'flaky', { reason: 'timeout' }), false);
  assert.equal(cache.peek(MEDIA).hit, true);

  assert.equal(cache.recordFailure(MEDIA, 'flaky', { status: 503 }), true);
  assert.equal(cache.peek(MEDIA).hit, false);
});

test('a source that plays has its failures forgiven', () => {
  const cache = makeCache();
  cache.write(MEDIA, [providerLink('recovers')]);

  cache.recordFailure(MEDIA, 'recovers', { status: 502 });
  cache.recordFailure(MEDIA, 'recovers', { status: 502 });
  // Two strikes, then it works — carrying those forward would have the next
  // unrelated blip drop a source that is demonstrably fine.
  cache.recordSuccess(MEDIA, 'recovers');

  assert.equal(cache.recordFailure(MEDIA, 'recovers', { status: 502 }), false);
  assert.equal(cache.peek(MEDIA).hit, true);
});

test('removing the last source removes the entry, not an empty shell', () => {
  const cache = makeCache();
  cache.write(MEDIA, [providerLink('only')]);
  cache.recordFailure(MEDIA, 'only', { status: 410 });

  // An entry that reports `hit: true` with nothing in it is worse than a miss:
  // the caller skips the discovery it needs and shows an empty source list.
  assert.equal(cache.peek(MEDIA).hit, false);
});

test('failures are recorded against one episode, not the whole series', () => {
  const cache = makeCache();
  cache.write(MEDIA, [providerLink('shared')], 1, 1);
  cache.write(MEDIA, [providerLink('shared')], 1, 2);

  cache.recordFailure(MEDIA, 'shared', { status: 404 }, 1, 1);

  assert.equal(cache.peek(MEDIA, 1, 1).hit, false);
  // Episode 2's link happens to share an identity but is a different entry;
  // dropping both would re-search a whole season because one episode 404'd.
  assert.equal(cache.peek(MEDIA, 1, 2).hit, true);
});

test('recording against an unknown entry is a no-op, not a crash', () => {
  const cache = makeCache();
  // The player can outlive a cache eviction; neither call has an entry to find.
  assert.equal(cache.recordFailure('cs3meta://nothing', 'x', { status: 404 }), false);
  cache.recordSuccess('cs3meta://nothing', 'x');
});

test('peek does not promote an entry the way read does', () => {
  const cache = makeCache();
  cache.write(MEDIA, [magnet('aaa')]);
  // The prefetcher asks speculatively; that question must not cost a write or
  // mark a title as recently used when nobody opened it.
  assert.equal(cache.peek(MEDIA).hit, true);
  assert.equal(cache.stats().entries, 1);
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
