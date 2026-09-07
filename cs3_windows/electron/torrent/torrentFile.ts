import { sliceInfoDict, infoHashOfTorrentFile } from './torrentMetadata.ts';

/**
 * Reading a `.torrent` completely, without touching the swarm.
 *
 * `torrentMetadata.ts` already walks bencode, but only *structurally* — it finds
 * the info dictionary's byte range so the infohash can be taken over the
 * original bytes, and deliberately materialises nothing. That is exactly right
 * for what it does and useless for what this needs: the file list, the sizes,
 * the trackers and the name, before a single piece has been requested.
 *
 * So this is a real decoder, and it reuses that module's `sliceInfoDict` and
 * `infoHashOfTorrentFile` rather than re-deriving the hash — there must be one
 * answer to "which torrent is this", and two implementations of it is how a
 * cache comes to disagree with a stream.
 *
 * ## Strings are UTF-8, and that is not a detail
 *
 * The structural reader decodes with `latin1`, which is correct there: it is
 * comparing dictionary *keys*, which are ASCII by specification, and never
 * shows a byte to anyone. Applying the same to a **file name** mangles every
 * non-ASCII title — and this corpus is full of them. A torrent named
 * `Chaal.Jeevi.Laiye.2019.Gujarati…` survives latin1 by luck because its
 * romanised; one carrying the Gujarati script in the folder name does not, and
 * the failure is silent: the file plays, and its name is mojibake in the list,
 * the library and the download folder.
 *
 * BEP-3 does not mandate an encoding. The convention BEP-3 grew is that names
 * are UTF-8, plus optional `name.utf-8` / `path.utf-8` keys written by clients
 * that also wrote a legacy-encoded `name`. Both are honoured: the `.utf-8`
 * variant wins where present, and the plain key is decoded as UTF-8 otherwise —
 * which is right for essentially everything made this century and degrades to
 * replacement characters rather than to wrong-but-plausible text.
 */

export interface TorrentFileEntry {
  /** Path components, without the torrent's own root directory. */
  path: string[];
  /** Bytes. */
  length: number;
  /**
   * Position in the torrent's file list.
   *
   * The identity every other layer uses: `TorrentEngine.selectFile` and
   * `StreamRequest.fileIndex` both address a file this way, and WebTorrent
   * orders `torrent.files` exactly as the metadata does. Deriving it from a
   * sorted or filtered view instead would select a different episode.
   */
  index: number;
  /** Byte offset of this file within the concatenated torrent payload. */
  offset: number;
}

export interface TorrentFileInfo {
  infoHash: string;
  /** The torrent's own name — a directory name in multi-file mode. */
  name: string;
  files: TorrentFileEntry[];
  totalSize: number;
  pieceLength: number;
  /** Every tracker, flattened from `announce-list` with `announce` first. */
  trackers: string[];
  comment?: string;
  createdBy?: string;
  /** Milliseconds, converted from bencode's seconds. */
  createdAt?: number;
  /** A private torrent cannot use DHT or PEX — worth saying, not hiding. */
  isPrivate: boolean;
  /** True when the payload is one file with no containing directory. */
  singleFile: boolean;
}

type Bencode = number | Uint8Array | Bencode[] | { [key: string]: Bencode };

/**
 * A general decoder, bounded so a malformed file cannot hang the process.
 *
 * Returns null rather than throwing on anything malformed: every caller here is
 * on a path where "that is not a torrent" is an ordinary answer a user can act
 * on, not an exception.
 */
function decode(buf: Uint8Array, pos: number, depth = 0): { value: Bencode; end: number } | null {
  // A torrent is at most a few levels deep. The cap is a guard against a
  // crafted file nesting lists until the stack gives out.
  if (depth > 32 || pos >= buf.length) return null;
  const tag = buf[pos];

  if (tag === 0x69 /* i */) {
    let end = pos + 1;
    while (end < buf.length && buf[end] !== 0x65 /* e */) end++;
    if (end >= buf.length) return null;
    const value = Number(asciiOf(buf, pos + 1, end));
    return Number.isFinite(value) ? { value, end: end + 1 } : null;
  }

  if (tag === 0x6c /* l */) {
    const items: Bencode[] = [];
    let cursor = pos + 1;
    while (cursor < buf.length && buf[cursor] !== 0x65 /* e */) {
      const item = decode(buf, cursor, depth + 1);
      if (!item) return null;
      items.push(item.value);
      cursor = item.end;
    }
    return cursor < buf.length ? { value: items, end: cursor + 1 } : null;
  }

  if (tag === 0x64 /* d */) {
    const map: { [key: string]: Bencode } = {};
    let cursor = pos + 1;
    while (cursor < buf.length && buf[cursor] !== 0x65 /* e */) {
      const key = decode(buf, cursor, depth + 1);
      // Keys are byte strings by specification, and ASCII in practice.
      if (!key || !(key.value instanceof Uint8Array)) return null;
      const value = decode(buf, key.end, depth + 1);
      if (!value) return null;
      map[asciiOf(key.value, 0, key.value.length)] = value.value;
      cursor = value.end;
    }
    return cursor < buf.length ? { value: map, end: cursor + 1 } : null;
  }

  // A byte string. Kept as bytes rather than decoded here, because whether it
  // is text at all depends on the key it arrived under — `pieces` is 20 bytes
  // per piece of binary hash and decoding it would cost megabytes for nothing.
  let colon = pos;
  while (colon < buf.length && buf[colon] !== 0x3a /* : */) {
    if (buf[colon] < 0x30 || buf[colon] > 0x39) return null;
    colon++;
  }
  if (colon >= buf.length || colon === pos) return null;
  const length = Number(asciiOf(buf, pos, colon));
  if (!Number.isSafeInteger(length) || length < 0) return null;
  const end = colon + 1 + length;
  if (end > buf.length) return null;
  return { value: buf.subarray(colon + 1, end), end };
}

/** For lengths and dictionary keys, which are ASCII by specification. */
function asciiOf(buf: Uint8Array, start: number, end: number): string {
  let out = '';
  for (let i = start; i < end; i++) out += String.fromCharCode(buf[i]);
  return out;
}

const utf8 = new TextDecoder('utf-8');

function text(value: Bencode | undefined): string | undefined {
  return value instanceof Uint8Array ? utf8.decode(value) : undefined;
}

/**
 * A name, preferring the explicit UTF-8 variant.
 *
 * Clients that wrote a legacy-encoded `name` also wrote `name.utf-8` beside it.
 * Where both exist the suffixed one is the authoritative text and the plain one
 * is the compatibility copy, so reading the plain key first would deliberately
 * pick the worse of two answers the file already contains.
 */
function preferUtf8(
  dict: { [key: string]: Bencode },
  key: string
): Bencode | undefined {
  return dict[`${key}.utf-8`] ?? dict[key];
}

/** Every path component a torrent gives, as text, with separators refused. */
function pathOf(value: Bencode | undefined): string[] | null {
  if (!Array.isArray(value)) return null;
  const parts: string[] = [];
  for (const part of value) {
    const component = text(part);
    if (component === undefined) return null;
    /*
     * A path component containing a separator, `..`, or a drive letter is a
     * path-traversal attempt: these strings become directory names under the
     * user's download folder. Torrents are anonymous third-party files and this
     * is the one place their contents reach the filesystem, so the component is
     * refused outright rather than sanitised — a "cleaned" name still creates a
     * file somewhere the user did not ask for.
     */
    if (!component || component === '.' || component === '..') return null;
    if (/[\\/]/.test(component) || /^[a-zA-Z]:/.test(component)) return null;
    parts.push(component);
  }
  return parts.length > 0 ? parts : null;
}

/**
 * Everything a `.torrent` says about itself.
 *
 * Null when the bytes are not a torrent, or are one this cannot trust — a
 * missing `info`, a missing name, no readable files. Every one of those is
 * reported to the user as "that file could not be read as a torrent", which is
 * both true and actionable, rather than as a half-populated page.
 */
export function decodeTorrentFile(bytes: Uint8Array): TorrentFileInfo | null {
  const infoHash = infoHashOfTorrentFile(bytes);
  if (!infoHash) return null;

  const root = decode(bytes, 0);
  if (!root || Array.isArray(root.value) || typeof root.value !== 'object') return null;
  const top = root.value as { [key: string]: Bencode };

  // Decoded from the range the structural reader found, so the two agree on
  // where `info` is by construction rather than by both being right.
  const span = sliceInfoDict(bytes);
  if (!span) return null;
  const decodedInfo = decode(bytes, span.start);
  if (!decodedInfo || Array.isArray(decodedInfo.value) || typeof decodedInfo.value !== 'object') {
    return null;
  }
  const info = decodedInfo.value as { [key: string]: Bencode };

  const name = text(preferUtf8(info, 'name'));
  if (!name) return null;

  const pieceLength = typeof info['piece length'] === 'number' ? info['piece length'] : 0;
  const files: TorrentFileEntry[] = [];
  let offset = 0;

  const list = info.files;
  const singleFile = !Array.isArray(list);

  if (singleFile) {
    const length = typeof info.length === 'number' ? info.length : -1;
    if (length < 0) return null;
    files.push({ path: [name], length, index: 0, offset: 0 });
    offset = length;
  } else {
    for (const raw of list as Bencode[]) {
      if (Array.isArray(raw) || typeof raw !== 'object' || raw instanceof Uint8Array) continue;
      const entry = raw as { [key: string]: Bencode };
      const path = pathOf(preferUtf8(entry, 'path'));
      const length = typeof entry.length === 'number' ? entry.length : -1;
      if (!path || length < 0) continue;
      /*
       * The index counts *accepted* files, and this is load-bearing: it is what
       * `TorrentEngine.selectFile` and `StreamRequest.fileIndex` address, and
       * WebTorrent builds `torrent.files` from the same list. Skipping a
       * malformed entry without also skipping its index would offset every file
       * after it, so the user would press play on episode 4 and get episode 5.
       *
       * A rejected entry therefore has to be rejected by *both* readers. The
       * only rejections here are a missing length and a path component that
       * cannot be a filename — neither of which WebTorrent would accept either.
       */
      files.push({ path, length, index: files.length, offset });
      offset += length;
    }
    if (files.length === 0) return null;
  }

  const trackers: string[] = [];
  const announce = text(top.announce);
  if (announce) trackers.push(announce);
  if (Array.isArray(top['announce-list'])) {
    for (const tier of top['announce-list'] as Bencode[]) {
      if (!Array.isArray(tier)) continue;
      for (const entry of tier) {
        const url = text(entry);
        if (url && !trackers.includes(url)) trackers.push(url);
      }
    }
  }

  const created = top['creation date'];

  return {
    infoHash,
    name,
    files,
    totalSize: offset,
    pieceLength,
    trackers,
    comment: text(top.comment),
    createdBy: text(top['created by']),
    // Bencode records seconds; everything downstream here is milliseconds.
    createdAt: typeof created === 'number' ? created * 1000 : undefined,
    isPrivate: info.private === 1,
    singleFile,
  };
}

/**
 * The infohash and display name in a magnet URI, without resolving anything.
 *
 * Only the v1 BitTorrent form is accepted (`urn:btih:` with a 40-character hex
 * or 32-character base32 hash). A v2 (`btmh`) magnet addresses a different hash
 * tree that this engine cannot join, and taking it would produce a page that
 * loads forever rather than a refusal that says why.
 */
export function parseMagnet(
  uri: string
): { infoHash: string; name?: string; trackers: string[] } | null {
  if (!/^magnet:\?/i.test(uri.trim())) return null;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(uri.trim().slice(uri.trim().indexOf('?') + 1));
  } catch {
    return null;
  }

  let infoHash: string | null = null;
  for (const xt of params.getAll('xt')) {
    const hex = /^urn:btih:([0-9a-fA-F]{40})$/.exec(xt);
    if (hex) {
      infoHash = hex[1].toLowerCase();
      break;
    }
    const base32 = /^urn:btih:([A-Za-z2-7]{32})$/.exec(xt);
    if (base32) {
      const decoded = base32ToHex(base32[1].toUpperCase());
      if (decoded) {
        infoHash = decoded;
        break;
      }
    }
  }
  if (!infoHash) return null;

  return {
    infoHash,
    name: params.get('dn') ?? undefined,
    trackers: params.getAll('tr'),
  };
}

/** RFC 4648 base32 → hex, for the older magnet form. */
function base32ToHex(input: string): string | null {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const character of input) {
    const value = alphabet.indexOf(character);
    if (value < 0) return null;
    bits += value.toString(2).padStart(5, '0');
  }
  let hex = '';
  for (let i = 0; i + 4 <= bits.length; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  }
  return hex.length === 40 ? hex : null;
}
