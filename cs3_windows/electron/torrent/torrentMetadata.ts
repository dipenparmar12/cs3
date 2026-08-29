import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

/**
 * Getting a torrent's metadata without waiting for the swarm.
 *
 * The report this module exists for: the same magnet that plays within a second
 * or two on a hosted service (seedr, and every "cloud torrent" product) spends
 * five to thirty seconds here before the file list even appears. That gap is
 * almost entirely **metadata acquisition**, and it is not a swarm problem — it
 * is a *cold client* problem, which is a different thing with a different fix.
 *
 * A magnet link carries an infohash and some tracker URLs. It does not carry
 * the file list, the piece length, or the piece hashes, and nothing can be
 * downloaded until those arrive. Getting them the standard way means: bootstrap
 * the DHT, iteratively walk toward the infohash, announce to a handful of UDP
 * trackers, wait for peer lists, dial peers, complete a BitTorrent handshake,
 * negotiate `ut_metadata` (BEP-9), and pull the info dictionary in 16 KB
 * chunks. Every one of those steps is a network round trip, several are
 * sequential, and a fresh process pays all of them.
 *
 * A hosted service pays none of it, for two reasons that have nothing to do
 * with bandwidth:
 *
 *  1. **It has seen the torrent before**, or someone else on the same service
 *     has. The info dictionary is small, immutable, and addressed by its own
 *     hash — it is the most cacheable object in the entire protocol.
 *  2. **Its DHT node has been running for weeks**, so its routing table is
 *     already dense around every part of the keyspace.
 *
 * Both are things a desktop app can have. This module is the first;
 * `dhtNodeCache.ts` is the second.
 *
 * Three sources are raced, and the first correct answer wins:
 *
 *  - the **on-disk cache** below, which is instant and answers for anything
 *    this machine has opened before;
 *  - a **public `.torrent` cache** over HTTPS, which typically answers in a few
 *    hundred milliseconds where the swarm takes tens of seconds;
 *  - the **swarm itself**, which is the only source that always eventually
 *    works and is therefore never abandoned.
 *
 * **The HTTP leg is not implemented here, deliberately.** WebTorrent already
 * does it: a magnet's `xs` ("exact source") parameters are fetched in parallel
 * with the swarm, the result is parsed, and it is **discarded unless its
 * infohash matches** the one being resolved (`torrent.js`,
 * `_getMetadataFromServer`). Writing a second race beside that one would add a
 * verification path to keep correct for no capability we do not already have,
 * so this module only builds the URLs (`metadataCacheUrls`) and the engine
 * appends them to the magnet.
 *
 * **On sending the infohash to a third party.** This is a real question in an
 * app whose users frequently run a VPN, and the answer is that the marginal
 * exposure is close to zero: pressing play already announces that exact
 * infohash to a dozen public UDP trackers and broadcasts it across the DHT to
 * hundreds of strangers, which is both more informative and less deniable than
 * one HTTPS GET. It is still a switch, because a user who has decided to trust
 * only the DHT is entitled to that, and because a capability nobody can turn
 * off is one nobody can audit.
 *
 * **The disk cache verifies its own contents**, because a file under
 * `%APPDATA%` is not evidence of anything: it can be truncated by a crash,
 * edited, or replaced. The bencode reader below exists rather than a dependency
 * because the check has to hash the *exact original byte range* of the info
 * dictionary, and any parse-then-re-encode round trip through a general bencode
 * library silently normalises key order and loses it.
 */

/**
 * Public `.torrent` caches, attached to a magnet as `xs` parameters.
 *
 * More than one, because these are third-party mirrors with no availability
 * guarantee and WebTorrent fetches every `xs` in parallel — so a dead entry
 * costs nothing, where a single entry that is down costs the whole benefit.
 */
const HTTP_CACHE_TEMPLATES: readonly string[] = [
  'https://itorrents.org/torrent/{HASH}.torrent',
  'https://btcache.me/torrent/{HASH}',
];

/**
 * A `.torrent` bigger than this is not one we want.
 *
 * The info dictionary is piece hashes plus a file list; 8 MB is roughly a
 * 40 GB torrent at a 16 KB piece size, well past anything in the corpus. The
 * cap matters because the read below hashes whatever it is given, and an entry
 * that has been replaced by something enormous would otherwise be hashed in
 * full before being rejected.
 */
const MAX_METADATA_BYTES = 8 * 1024 * 1024;

/** Entries older than this are swept; a magnet nobody reopens is dead weight. */
const CACHE_TTL_MS = 60 * 24 * 60 * 60 * 1000;

export function metadataCacheUrls(infoHash: string): string[] {
  const hash = infoHash.toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(hash)) return [];
  // Both mirrors key on the uppercase hex form.
  return HTTP_CACHE_TEMPLATES.map((template) => template.replace('{HASH}', hash.toUpperCase()));
}

// --- bencode: just enough to find the info dictionary ----------------------

/**
 * Byte range of the `info` value inside a bencoded torrent file.
 *
 * Only structural: it walks values to learn their length and never decodes
 * one. That is the whole requirement — the infohash is SHA-1 over the
 * *original* bytes of that range, so the useful output is a pair of offsets and
 * anything that materialises a value is doing work that would have to be thrown
 * away.
 *
 * Returns null on anything malformed rather than throwing, because every caller
 * is on a path where "this is not a torrent file" is an ordinary answer.
 */
export function sliceInfoDict(buf: Uint8Array): { start: number; end: number } | null {
  if (buf.length === 0 || buf[0] !== 0x64 /* d */) return null;

  let pos = 1;
  while (pos < buf.length && buf[pos] !== 0x65 /* e */) {
    const key = readString(buf, pos);
    if (!key) return null;

    const valueStart = key.end;
    const valueEnd = skipValue(buf, valueStart);
    if (valueEnd < 0) return null;

    if (key.text === 'info') return { start: valueStart, end: valueEnd };
    pos = valueEnd;
  }
  return null;
}

function readString(buf: Uint8Array, pos: number): { text: string; end: number } | null {
  let colon = pos;
  while (colon < buf.length && buf[colon] !== 0x3a /* : */) {
    // A length is digits and nothing else; bailing here is what stops a
    // malformed file from being scanned to its end one byte at a time.
    if (buf[colon] < 0x30 || buf[colon] > 0x39) return null;
    colon++;
  }
  if (colon >= buf.length || colon === pos) return null;

  const length = Number(latin1(buf, pos, colon));
  if (!Number.isSafeInteger(length) || length < 0) return null;

  const end = colon + 1 + length;
  if (end > buf.length) return null;

  return { text: latin1(buf, colon + 1, end), end };
}

/** Byte offset just past the value starting at `pos`, or -1 if malformed. */
function skipValue(buf: Uint8Array, pos: number): number {
  if (pos >= buf.length) return -1;

  const tag = buf[pos];

  if (tag === 0x69 /* i */) {
    let end = pos + 1;
    while (end < buf.length && buf[end] !== 0x65 /* e */) end++;
    return end < buf.length ? end + 1 : -1;
  }

  if (tag === 0x6c /* l */ || tag === 0x64 /* d */) {
    let cursor = pos + 1;
    while (cursor < buf.length && buf[cursor] !== 0x65 /* e */) {
      const next = skipValue(buf, cursor);
      if (next < 0) return -1;
      cursor = next;
    }
    return cursor < buf.length ? cursor + 1 : -1;
  }

  const str = readString(buf, pos);
  return str ? str.end : -1;
}

function latin1(buf: Uint8Array, start: number, end: number): string {
  let out = '';
  for (let i = start; i < end; i++) out += String.fromCharCode(buf[i]);
  return out;
}

/**
 * The infohash these bytes actually describe, or null if they are not a torrent.
 *
 * This is the verification step, and it is not optional on anything that came
 * off the network: the bytes go on to drive piece verification for a file the
 * user will watch, and a cache that answered with a different torrent — by
 * mistake or otherwise — would be indistinguishable from the right one until
 * the wrong film started playing.
 */
export function infoHashOfTorrentFile(bytes: Uint8Array): string | null {
  const info = sliceInfoDict(bytes);
  if (!info) return null;
  return crypto.createHash('sha1').update(bytes.subarray(info.start, info.end)).digest('hex');
}

export function isTorrentFileFor(bytes: Uint8Array, infoHash: string): boolean {
  return infoHashOfTorrentFile(bytes) === infoHash.toLowerCase();
}

// --- the disk cache --------------------------------------------------------

/**
 * `.torrent` files this machine has already resolved, keyed by infohash.
 *
 * Content-addressed and immutable, so there is no invalidation problem and no
 * version to key on: bytes whose SHA-1 is the file name are either those bytes
 * or a corrupt file, and the read verifies which. A corrupt entry is deleted
 * rather than repaired — it costs one swarm fetch and cannot recur.
 */
export class TorrentMetadataCache {
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  public get directory(): string {
    return this.dir;
  }

  private fileFor(infoHash: string): string {
    return path.join(this.dir, `${infoHash.toLowerCase()}.torrent`);
  }

  public read(infoHash: string): Buffer | null {
    if (!/^[a-f0-9]{40}$/i.test(infoHash)) return null;

    const file = this.fileFor(infoHash);
    let bytes: Buffer;
    try {
      if (fs.statSync(file).size > MAX_METADATA_BYTES) return null;
      bytes = fs.readFileSync(file);
    } catch {
      return null;
    }

    if (!isTorrentFileFor(bytes, infoHash)) {
      // Truncated by a crash, or never valid. Either way it must not be handed
      // to the client, and leaving it would make every future open re-read it.
      try {
        fs.rmSync(file, { force: true });
      } catch {
        // Locked; the hash check will reject it again next time.
      }
      return null;
    }

    // Touch it, so the sweep below measures "last used" rather than "first seen".
    try {
      const now = new Date();
      fs.utimesSync(file, now, now);
    } catch {
      // A cache entry that cannot be touched is still a valid cache entry.
    }
    return bytes;
  }

  public write(infoHash: string, bytes: Uint8Array): void {
    if (!isTorrentFileFor(bytes, infoHash)) return;

    try {
      fs.mkdirSync(this.dir, { recursive: true });
      // Written beside and renamed: a half-written file that survives a crash
      // would otherwise be read back, fail its hash check and be deleted, which
      // works but hides the reason.
      const temp = `${this.fileFor(infoHash)}.${process.pid}.tmp`;
      fs.writeFileSync(temp, bytes);
      fs.renameSync(temp, this.fileFor(infoHash));
    } catch {
      // A cache that cannot be written is a slower app, not a broken one.
    }
  }

  /** Drops entries untouched for `CACHE_TTL_MS`. Returns how many went. */
  public sweep(now = Date.now()): number {
    let removed = 0;
    let entries: string[];
    try {
      entries = fs.readdirSync(this.dir);
    } catch {
      return 0;
    }

    for (const entry of entries) {
      if (!entry.endsWith('.torrent')) continue;
      const file = path.join(this.dir, entry);
      try {
        if (now - fs.statSync(file).mtimeMs < CACHE_TTL_MS) continue;
        fs.rmSync(file, { force: true });
        removed++;
      } catch {
        // Locked or already gone.
      }
    }
    return removed;
  }
}
