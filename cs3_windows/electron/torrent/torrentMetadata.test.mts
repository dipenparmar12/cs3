/**
 * What the metadata cache is allowed to accept.
 *
 *   bun run test:torrent-metadata
 *   node --experimental-strip-types electron/torrent/torrentMetadata.test.mts
 *
 * Every row here guards a failure that is **silent**. The cache exists to skip
 * the swarm, so whatever it hands back is treated as authoritative: piece
 * hashes come from it, and the file the viewer watches is verified against
 * those. A reader that mis-locates the info dictionary by one byte produces a
 * hash that matches nothing, which is merely a slow app; one that accepts a
 * *different* torrent's bytes produces a working stream of the wrong film, and
 * nothing anywhere would report an error.
 *
 * The bencode encoder below is deliberately written from the spec rather than
 * imported, so the reader is checked against something other than itself.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  TorrentMetadataCache,
  infoHashOfTorrentFile,
  isTorrentFileFor,
  metadataCacheUrls,
  sliceInfoDict,
} from './torrentMetadata.ts';
import {
  DHT_BOOTSTRAP_NODES,
  DhtNodeCache,
  MAX_PERSISTED_NODES,
  NODE_CACHE_TTL_MS,
  sanitiseContacts,
} from './dhtNodeCache.ts';
import { DEFAULT_TRACKERS, mergeTrackers, trackersFromMagnet } from './indexers/base.ts';

const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

// --- a minimal bencode encoder, for fixtures -------------------------------

type Bencodable = number | string | Uint8Array | Bencodable[] | { [key: string]: Bencodable };

function bencode(value: Bencodable): Buffer {
  if (typeof value === 'number') return Buffer.from(`i${value}e`, 'latin1');

  if (typeof value === 'string' || value instanceof Uint8Array) {
    const bytes = typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(value);
    return Buffer.concat([Buffer.from(`${bytes.length}:`, 'latin1'), bytes]);
  }

  if (Array.isArray(value)) {
    return Buffer.concat([Buffer.from('l'), ...value.map(bencode), Buffer.from('e')]);
  }

  // Bencode requires sorted keys. The reader must not depend on that — it scans
  // — but a fixture that violates the spec would be testing the wrong thing.
  const keys = Object.keys(value).sort();
  return Buffer.concat([
    Buffer.from('d'),
    ...keys.flatMap((key) => [bencode(key), bencode(value[key])]),
    Buffer.from('e'),
  ]);
}

const pieceHashes = crypto.randomBytes(60);

function torrentFixture(overrides: Record<string, Bencodable> = {}): {
  bytes: Buffer;
  infoHash: string;
} {
  const info: Record<string, Bencodable> = {
    length: 1_073_741_824,
    name: 'Some.Release.2024.1080p.WEB-DL.mkv',
    'piece length': 524_288,
    pieces: pieceHashes,
    ...overrides,
  };

  const bytes = bencode({
    announce: 'udp://tracker.opentrackr.org:1337/announce',
    'announce-list': [['udp://tracker.opentrackr.org:1337/announce'], ['udp://explodie.org:6969/announce']],
    'creation date': 1_700_000_000,
    comment: 'fixture',
    info,
  });

  return { bytes, infoHash: crypto.createHash('sha1').update(bencode(info)).digest('hex') };
}

// --- locating the info dictionary ------------------------------------------

test('the info dictionary is located by its exact byte range', () => {
  const { bytes, infoHash } = torrentFixture();
  const slice = sliceInfoDict(bytes);
  assert.ok(slice, 'expected an info dictionary');

  // The range must be the dictionary and nothing else: one byte either way and
  // the hash is wrong, which is the whole failure this guards.
  assert.equal(bytes[slice.start], 0x64 /* d */);
  assert.equal(bytes[slice.end - 1], 0x65 /* e */);
  assert.equal(
    crypto.createHash('sha1').update(bytes.subarray(slice.start, slice.end)).digest('hex'),
    infoHash
  );
});

test('the infohash matches the one computed over the encoded info dict', () => {
  const { bytes, infoHash } = torrentFixture();
  assert.equal(infoHashOfTorrentFile(bytes), infoHash);
  assert.ok(isTorrentFileFor(bytes, infoHash));
  assert.ok(isTorrentFileFor(bytes, infoHash.toUpperCase()), 'case must not matter');
});

test('a different torrent is refused', () => {
  const a = torrentFixture();
  const b = torrentFixture({ name: 'Another.Release.2024.2160p.mkv' });
  assert.notEqual(a.infoHash, b.infoHash);
  assert.equal(isTorrentFileFor(b.bytes, a.infoHash), false);
});

test('keys before info are skipped whatever shape they are', () => {
  // Nested lists, nested dictionaries and integers all have to be walked
  // correctly or the scan lands mid-value and reads a length out of media data.
  const { bytes, infoHash } = torrentFixture();
  const withJunk = bencode({
    a: [[1, 2, [3, 'four']], { deep: { deeper: [5, 'six'] } }],
    b: -17,
    info: {
      length: 1_073_741_824,
      name: 'Some.Release.2024.1080p.WEB-DL.mkv',
      'piece length': 524_288,
      pieces: pieceHashes,
    },
    z: 'after',
  });
  assert.equal(infoHashOfTorrentFile(withJunk), infoHash);
  assert.ok(bytes.length > 0);
});

test('a season pack — a nested files list — is measured correctly', () => {
  // The multi-file info dict is a list of dictionaries of lists, which is the
  // deepest nesting the reader ever meets and the shape most likely to be
  // walked wrongly. It is also most of the corpus.
  const info: Record<string, Bencodable> = {
    files: [
      { length: 700_000_000, path: ['Season 01', 'S01E01.mkv'] },
      { length: 700_000_000, path: ['Season 01', 'S01E02.mkv'] },
    ],
    name: 'Some.Show.S01.1080p.WEB-DL',
    'piece length': 524_288,
    pieces: pieceHashes,
  };
  const bytes = bencode({ announce: 'udp://tracker:1337/announce', info });
  const infoHash = crypto.createHash('sha1').update(bencode(info)).digest('hex');

  assert.equal(infoHashOfTorrentFile(bytes), infoHash);
});

// --- refusing what is not a torrent ----------------------------------------

test('an HTML error page is not a torrent', () => {
  // The routine failure: a public mirror answers 200 with a "not found" page.
  const html = Buffer.from('<!doctype html><html><body>Not found</body></html>');
  assert.equal(sliceInfoDict(html), null);
  assert.equal(infoHashOfTorrentFile(html), null);
});

test('a truncated torrent is refused rather than half-read', () => {
  const { bytes, infoHash } = torrentFixture();
  const cut = bytes.subarray(0, bytes.length - 40);
  assert.equal(infoHashOfTorrentFile(cut), null);
  assert.equal(isTorrentFileFor(cut, infoHash), false);
});

test('a declared string length past the end of the buffer is refused', () => {
  // The shape a malicious or corrupt file takes: a length prefix that would
  // read beyond the allocation.
  assert.equal(sliceInfoDict(Buffer.from('d4:info99999:short', 'latin1')), null);
});

test('a non-numeric length prefix terminates the scan', () => {
  assert.equal(sliceInfoDict(Buffer.from('dxx:info', 'latin1')), null);
});

test('an empty buffer and a non-dictionary are refused', () => {
  assert.equal(sliceInfoDict(new Uint8Array(0)), null);
  assert.equal(sliceInfoDict(Buffer.from('l4:infoe', 'latin1')), null);
});

test('a torrent with no info key is refused', () => {
  assert.equal(infoHashOfTorrentFile(bencode({ announce: 'udp://x:1/a' })), null);
});

// --- mirror URLs -----------------------------------------------------------

test('mirror URLs are built from the uppercase hex hash', () => {
  const urls = metadataCacheUrls('0123456789abcdef0123456789abcdef01234567');
  assert.ok(urls.length >= 2, 'more than one mirror, so one being down costs nothing');
  for (const url of urls) {
    assert.ok(url.startsWith('https://'), `expected https, got ${url}`);
    assert.ok(url.includes('0123456789ABCDEF0123456789ABCDEF01234567'), url);
  }
});

test('anything that is not a 40-character hex hash yields no mirrors', () => {
  // A magnet can carry a base32 infohash, and a caller can pass a title by
  // mistake. Either would otherwise be interpolated into a URL and requested.
  assert.deepEqual(metadataCacheUrls('not-a-hash'), []);
  assert.deepEqual(metadataCacheUrls(''), []);
  assert.deepEqual(metadataCacheUrls('0123456789abcdef0123456789abcdef0123456'), []);
  assert.deepEqual(metadataCacheUrls('ZZZZ456789abcdef0123456789abcdef01234567'), []);
});

// --- the disk cache --------------------------------------------------------

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cs3-torrent-meta-'));
}

test('a written entry reads back and hashes to the same torrent', () => {
  const dir = tempDir();
  const cache = new TorrentMetadataCache(dir);
  const { bytes, infoHash } = torrentFixture();

  cache.write(infoHash, bytes);
  const read = cache.read(infoHash);

  assert.ok(read, 'expected the entry back');
  assert.equal(Buffer.compare(read, bytes), 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a write whose bytes do not match the key is refused', () => {
  // The caller passes an infohash and some bytes. If those disagree, storing
  // them would mean every future open of that infohash serves another torrent.
  const dir = tempDir();
  const cache = new TorrentMetadataCache(dir);
  const a = torrentFixture();
  const b = torrentFixture({ name: 'Different.mkv' });

  cache.write(a.infoHash, b.bytes);
  assert.equal(cache.read(a.infoHash), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a corrupt entry is deleted rather than returned', () => {
  const dir = tempDir();
  const cache = new TorrentMetadataCache(dir);
  const { bytes, infoHash } = torrentFixture();
  cache.write(infoHash, bytes);

  // A crash mid-write, or a file edited by hand. Left in place it would fail
  // its check on every open forever.
  const file = path.join(dir, `${infoHash}.torrent`);
  fs.writeFileSync(file, bytes.subarray(0, 32));

  assert.equal(cache.read(infoHash), null);
  assert.equal(fs.existsSync(file), false, 'the bad entry must not survive the read');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a miss is a miss, not an error', () => {
  const dir = tempDir();
  const cache = new TorrentMetadataCache(dir);
  assert.equal(cache.read('0123456789abcdef0123456789abcdef01234567'), null);
  assert.equal(cache.read('nonsense'), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the sweep drops old entries and keeps recent ones', () => {
  const dir = tempDir();
  const cache = new TorrentMetadataCache(dir);
  const fresh = torrentFixture({ name: 'Fresh.mkv' });
  const stale = torrentFixture({ name: 'Stale.mkv' });
  cache.write(fresh.infoHash, fresh.bytes);
  cache.write(stale.infoHash, stale.bytes);

  const longAgo = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
  fs.utimesSync(path.join(dir, `${stale.infoHash}.torrent`), longAgo, longAgo);

  assert.equal(cache.sweep(), 1);
  assert.ok(cache.read(fresh.infoHash));
  assert.equal(cache.read(stale.infoHash), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

// --- the DHT node cache ----------------------------------------------------

test('contacts that are not addressable are dropped', () => {
  const contacts = sanitiseContacts([
    { host: '1.2.3.4', port: 6881 },
    { host: '1.2.3.4', port: 6881 }, // duplicate
    { host: '', port: 6881 },
    { host: '5.6.7.8', port: 0 },
    { host: '5.6.7.8', port: 70_000 },
    { host: '5.6.7.8', port: 1.5 },
    { host: 5, port: 6881 },
    null,
    'nope',
  ]);
  assert.deepEqual(contacts, [{ host: '1.2.3.4', port: 6881 }]);
});

test('a non-array is not a routing table', () => {
  assert.deepEqual(sanitiseContacts(undefined), []);
  assert.deepEqual(sanitiseContacts({ nodes: [] }), []);
});

test('the saved table is capped', () => {
  const many = Array.from({ length: MAX_PERSISTED_NODES + 50 }, (_, i) => ({
    host: `10.0.${Math.floor(i / 256)}.${i % 256}`,
    port: 6881,
  }));
  assert.equal(sanitiseContacts(many).length, MAX_PERSISTED_NODES);
});

test('the bootstrap list stays short enough for k-rpc to work', () => {
  /**
   * Not a style rule. `k-rpc` compares `bootstrap.length` against a set capped
   * at `k` (20) on every round of every iterative lookup; a list longer than
   * that pins the comparison true, which makes the lookup throw away the
   * per-query node table it converges through and fire the whole bootstrap
   * array at the socket unthrottled.
   *
   * Saved contacts are therefore never merged in here — they go to
   * `DHT.addNode()`. This asserts the boundary that regression crossed.
   */
  assert.ok(
    DHT_BOOTSTRAP_NODES.length < 20,
    'bootstrap must stay below k-rpc’s k, or lookups degrade'
  );
});

test('the node id and the routing table survive a restart', () => {
  const dir = tempDir();
  const file = path.join(dir, 'dht-nodes.json');

  const first = new DhtNodeCache(file);
  first.load();
  const nodeId = first.getNodeId();
  first.save([{ host: '4.4.4.4', port: 6881 }]);

  const second = new DhtNodeCache(file);
  second.load();
  assert.equal(second.getNodeId(), nodeId, 'a changing node id is one nobody can route to');
  assert.deepEqual([...second.warmContacts], [{ host: '4.4.4.4', port: 6881 }]);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('contacts expire but the identity does not', () => {
  const dir = tempDir();
  const file = path.join(dir, 'dht-nodes.json');

  const first = new DhtNodeCache(file);
  const nodeId = first.getNodeId();
  first.save([{ host: '4.4.4.4', port: 6881 }], Date.now() - NODE_CACHE_TTL_MS - 1);

  const second = new DhtNodeCache(file);
  second.load();
  // A DHT contact is a residential IP with a DHCP lease; after a week most of a
  // saved table is a UDP probe that will never be answered.
  assert.equal(second.warmContacts.length, 0);
  assert.equal(second.getNodeId(), nodeId);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('an empty routing table never overwrites a good one', () => {
  // The DHT failing to come up on one launch must not cost every launch after.
  const dir = tempDir();
  const file = path.join(dir, 'dht-nodes.json');

  const cache = new DhtNodeCache(file);
  cache.save([{ host: '4.4.4.4', port: 6881 }]);
  cache.save([]);

  const reloaded = new DhtNodeCache(file);
  reloaded.load();
  assert.equal(reloaded.warmContacts.length, 1);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('a missing or unreadable cache file is a cold start, not a failure', () => {
  const dir = tempDir();
  const file = path.join(dir, 'dht-nodes.json');

  const missing = new DhtNodeCache(file);
  missing.load();
  assert.equal(missing.warmContacts.length, 0);
  assert.match(missing.getNodeId(), /^[a-f0-9]{40}$/);

  fs.writeFileSync(file, 'not json at all');
  const corrupt = new DhtNodeCache(file);
  corrupt.load();
  assert.equal(corrupt.warmContacts.length, 0);

  fs.rmSync(dir, { recursive: true, force: true });
});


// --- trackers survive a cache hit -------------------------------------------

/**
 * The regression these guard is invisible and arrives late.
 *
 * `TorrentEngine` hands `add()` a cached `.torrent` buffer whenever it has one,
 * and a buffer carries no magnet — so every `tr=` the source supplied is gone
 * on the *second* open, which is the one the cache exists to make faster. The
 * user-visible form is a release that found peers the first time and fewer the
 * next, which reads as the swarm dying rather than as a cache.
 */

test('a magnet’s own trackers are read back out', () => {
  const magnet =
    'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567' +
    '&dn=Some.Release' +
    '&tr=' + encodeURIComponent('udp://tracker.example.org:1337/announce') +
    '&tr=' + encodeURIComponent('https://tracker.example.net/announce');

  assert.deepEqual(trackersFromMagnet(magnet), [
    'udp://tracker.example.org:1337/announce',
    'https://tracker.example.net/announce',
  ]);
});

test('a bare infohash and a magnet with no trackers yield none', () => {
  assert.deepEqual(trackersFromMagnet('0123456789abcdef0123456789abcdef01234567'), []);
  assert.deepEqual(trackersFromMagnet('magnet:?xt=urn:btih:abc&dn=x'), []);
});

test('anything that is not an announce URL is dropped', () => {
  // A malformed entry is not inert: it becomes a socket the client retries for
  // the life of the torrent.
  const magnet =
    'magnet:?xt=urn:btih:abc' +
    '&tr=' + encodeURIComponent('javascript:alert(1)') +
    '&tr=not-a-url' +
    '&tr=%E0%A4%A' + // undecodable percent escape
    '&tr=' + encodeURIComponent('udp://good.example:6969/announce');

  assert.deepEqual(trackersFromMagnet(magnet), ['udp://good.example:6969/announce']);
});

test('a tr key inside another parameter is not mistaken for one', () => {
  // `dn` legitimately contains arbitrary text, and `xtr=`/`&trailer=` are not
  // announce lists. The boundary is what stops a display name becoming a
  // tracker socket.
  const magnet = 'magnet:?xt=urn:btih:abc&dn=' + encodeURIComponent('tr=udp://nope:1/a');
  assert.deepEqual(trackersFromMagnet(magnet), []);
});

test('merging keeps our defaults first and adds the source’s own', () => {
  const extra = 'udp://tracker.example.org:1337/announce';
  const merged = mergeTrackers(DEFAULT_TRACKERS, [extra]);

  assert.deepEqual(merged.slice(0, DEFAULT_TRACKERS.length), [...DEFAULT_TRACKERS]);
  assert.equal(merged[merged.length - 1], extra);
});

test('a tracker we already announce to is not announced to twice', () => {
  const merged = mergeTrackers(DEFAULT_TRACKERS, [DEFAULT_TRACKERS[0]]);
  assert.equal(merged.length, DEFAULT_TRACKERS.length);
  assert.equal(new Set(merged).size, merged.length);
});

// --- runner ----------------------------------------------------------------

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL  ${name}`);
    console.error(error instanceof Error ? error.stack : error);
  }
}

console.log(`\n${tests.length - failed}/${tests.length} passed`);
if (failed > 0) process.exit(1);
