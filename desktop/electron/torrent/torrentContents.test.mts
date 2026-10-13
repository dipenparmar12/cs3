import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { decodeTorrentFile, parseMagnet, type TorrentFileInfo } from './torrentFile.ts';
import {
  readTorrentContents,
  searchTorrentFiles,
  subtitlesFor,
  classifyFiles,
} from './torrentContents.ts';

/**
 * Both halves are pure and both fail silently, which is why they are tested.
 *
 * A misread file list plays the wrong episode. A sample classified as the
 * feature plays ninety seconds of trailer and stops. A latin-1 filename is
 * mojibake in the library forever. None of those raise anything, and a viewer
 * attributes every one of them to the torrent being bad.
 */

// --- a real bencoder, so the fixtures are real torrents ------------------------

type Value = number | string | Uint8Array | Value[] | { [k: string]: Value };

function bencode(value: Value): Uint8Array {
  const parts: Uint8Array[] = [];
  const encoder = new TextEncoder();

  const write = (item: Value): void => {
    if (typeof item === 'number') {
      parts.push(encoder.encode(`i${item}e`));
    } else if (typeof item === 'string') {
      const bytes = encoder.encode(item);
      parts.push(encoder.encode(`${bytes.length}:`), bytes);
    } else if (item instanceof Uint8Array) {
      parts.push(encoder.encode(`${item.length}:`), item);
    } else if (Array.isArray(item)) {
      parts.push(encoder.encode('l'));
      item.forEach(write);
      parts.push(encoder.encode('e'));
    } else {
      parts.push(encoder.encode('d'));
      // Bencode dictionaries are sorted by key, and a real client writes them
      // that way — a fixture that did not would not be a torrent.
      for (const key of Object.keys(item).sort()) {
        const k = encoder.encode(key);
        parts.push(encoder.encode(`${k.length}:`), k);
        write(item[key]);
      }
      parts.push(encoder.encode('e'));
    }
  };

  write(value);
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function torrent(
  name: string,
  files: Array<{ path: string[]; length: number }>,
  extra: { [k: string]: Value } = {}
): Uint8Array {
  return bencode({
    announce: 'udp://tracker.example:1337',
    'creation date': 1_600_000_000,
    info: {
      name,
      'piece length': 262_144,
      pieces: new Uint8Array(20),
      files: files.map((file) => ({ path: file.path, length: file.length })),
    },
    ...extra,
  });
}

function decoded(bytes: Uint8Array): TorrentFileInfo {
  const info = decodeTorrentFile(bytes);
  assert.ok(info, 'fixture did not decode as a torrent');
  return info;
}

// --- decoding ------------------------------------------------------------------

test('a multi-file torrent yields its whole tree with stable indices', () => {
  const info = decoded(
    torrent('Mythic Quest S02', [
      { path: ['Season 2', 'S02E01.mkv'], length: 700_000_000 },
      { path: ['Season 2', 'S02E02.mkv'], length: 710_000_000 },
      { path: ['Posters', 'folder.jpg'], length: 90_000 },
    ])
  );

  assert.equal(info.name, 'Mythic Quest S02');
  assert.equal(info.files.length, 3);
  assert.deepEqual(info.files.map((file) => file.index), [0, 1, 2]);
  assert.equal(info.totalSize, 700_000_000 + 710_000_000 + 90_000);
  // Offsets are cumulative, which is what makes piece arithmetic possible.
  assert.equal(info.files[1].offset, 700_000_000);
  assert.equal(info.singleFile, false);
  assert.equal(info.createdAt, 1_600_000_000_000, 'seconds are converted to milliseconds');
});

test('a single-file torrent is one entry named after the torrent', () => {
  const bytes = bencode({
    announce: 'udp://tracker.example:1337',
    info: {
      name: 'Coco.2017.1080p.BluRay.mkv',
      'piece length': 262_144,
      pieces: new Uint8Array(20),
      length: 1_500_000_000,
    },
  });
  const info = decoded(bytes);

  assert.equal(info.singleFile, true);
  assert.deepEqual(info.files[0].path, ['Coco.2017.1080p.BluRay.mkv']);
  assert.equal(info.totalSize, 1_500_000_000);
});

test('names are decoded as UTF-8, not latin-1', () => {
  /**
   * The reason this file exists rather than reusing the structural reader.
   * `latin1` is right for comparing ASCII dictionary keys and wrong for a
   * filename: it produces mojibake that is never reported as an error and
   * follows the file into the library, the download folder and the history.
   */
  const info = decoded(
    torrent('Chaal Jeevi Laiye', [
      { path: ['ચાલ જીવી લઈએ.mkv'], length: 1_000_000 },
      { path: ['Amélie.srt'], length: 40_000 },
    ])
  );

  assert.equal(info.files[0].path[0], 'ચાલ જીવી લઈએ.mkv');
  assert.equal(info.files[1].path[0], 'Amélie.srt');
});

test('the UTF-8 variant key wins over the legacy one beside it', () => {
  const bytes = bencode({
    info: {
      name: 'legacy-name',
      'name.utf-8': 'Real Name',
      'piece length': 262_144,
      pieces: new Uint8Array(20),
      files: [{ path: ['bad.mkv'], 'path.utf-8': ['good.mkv'], length: 10 }],
    },
  });
  const info = decoded(bytes);

  assert.equal(info.name, 'Real Name');
  assert.deepEqual(info.files[0].path, ['good.mkv']);
});

test('a path component that escapes the download folder is refused', () => {
  /**
   * These strings become directory names under the user's download folder, and
   * a torrent is an anonymous third-party file. Refused rather than sanitised:
   * a cleaned name still creates a file somewhere nobody asked for.
   */
  const info = decoded(
    torrent('Escape', [
      { path: ['..', '..', 'evil.mkv'], length: 10 },
      { path: ['ok.mkv'], length: 20 },
    ])
  );

  assert.equal(info.files.length, 1);
  assert.deepEqual(info.files[0].path, ['ok.mkv']);
  assert.equal(info.files[0].index, 0, 'indices stay contiguous over a rejected entry');
});

test('bytes that are not a torrent are refused rather than half-read', () => {
  assert.equal(decodeTorrentFile(new TextEncoder().encode('{"not":"bencode"}')), null);
  assert.equal(decodeTorrentFile(new Uint8Array(0)), null);
});

test('trackers come from announce and announce-list, deduped, announce first', () => {
  const info = decoded(
    torrent('X', [{ path: ['a.mkv'], length: 1 }], {
      'announce-list': [
        ['udp://tracker.example:1337'],
        ['udp://other.example:80', 'http://third.example/announce'],
      ],
    })
  );

  assert.deepEqual(info.trackers, [
    'udp://tracker.example:1337',
    'udp://other.example:80',
    'http://third.example/announce',
  ]);
});

// --- magnets --------------------------------------------------------------------

test('a v1 magnet gives its hash, name and trackers', () => {
  const hash = crypto.randomBytes(20).toString('hex');
  const parsed = parseMagnet(
    `magnet:?xt=urn:btih:${hash.toUpperCase()}&dn=Some+Release&tr=udp%3A%2F%2Ftracker.example%3A1337`
  );

  assert.equal(parsed?.infoHash, hash, 'the hash is lowercased');
  assert.equal(parsed?.name, 'Some Release');
  assert.deepEqual(parsed?.trackers, ['udp://tracker.example:1337']);
});

test('a v2-only magnet is refused rather than accepted and left hanging', () => {
  /**
   * `btmh` addresses a different hash tree that this engine cannot join.
   * Accepting it would open a page that resolves forever instead of a refusal
   * that says why.
   */
  assert.equal(
    parseMagnet('magnet:?xt=urn:btmh:1220caf1e1918a2f8e1b2c3d4e5f60718293a4b5c6d7e8f90&dn=x'),
    null
  );
  assert.equal(parseMagnet('https://example.com/not-a-magnet'), null);
});

// --- classification ----------------------------------------------------------------

test('a season pack reads as a series with its episodes in order', () => {
  const contents = readTorrentContents(
    decoded(
      torrent('Mythic Quest Ravens Banquet S02 COMPLETE 720p', [
        { path: ['Season 2', 'S02E03.mkv'], length: 700_000_000 },
        { path: ['Season 2', 'S02E01.mkv'], length: 700_000_000 },
        { path: ['Season 2', 'S02E02.mkv'], length: 700_000_000 },
        { path: ['Posters', 'folder.jpg'], length: 90_000 },
        { path: ['readme.nfo'], length: 2_000 },
      ])
    )
  );

  assert.equal(contents.shape, 'series');
  assert.equal(contents.seasons.length, 1);
  assert.deepEqual(contents.seasons[0].episodes.map((e) => e.episode), [1, 2, 3]);
  assert.equal(contents.playable.length, 3, 'the poster and nfo are not playable');
  assert.equal(contents.folderCount, 2);
  // Nothing is dropped — a file the parser found uninteresting must still be
  // reachable, or it is a feature that exists and cannot be reached.
  assert.equal(contents.files.length, 5);
});

test('a lone film is a movie, and the primary file is the film', () => {
  const contents = readTorrentContents(
    decoded(
      torrent('Coco (2017) 1080p BluRay', [
        { path: ['Coco.2017.1080p.BluRay.mkv'], length: 1_500_000_000 },
        { path: ['Sample', 'sample.mkv'], length: 20_000_000 },
        { path: ['Coco.2017.1080p.BluRay.srt'], length: 60_000 },
      ])
    )
  );

  assert.equal(contents.shape, 'movie');
  assert.equal(contents.playable.length, 1);
  assert.equal(contents.primary?.name, 'Coco.2017.1080p.BluRay.mkv');
  assert.equal(contents.samples.length, 1);
  assert.equal(contents.subtitles.length, 1);
});

test('a sample is caught by size even when nothing is named sample', () => {
  /**
   * Encoders name these inconsistently; the size ratio does not lie. Getting
   * this wrong plays ninety seconds of trailer and stops, which reads as a
   * broken torrent rather than as a misclassified file.
   */
  const contents = readTorrentContents(
    decoded(
      torrent('Film', [
        { path: ['Coco.2017.1080p.BluRay.mkv'], length: 2_000_000_000 },
        // No "sample", "trailer" or "preview" anywhere in the path — if the
        // name hint could catch this, the size rule would never be exercised
        // and this test would pass with that rule deleted. It was, and it did.
        { path: ['Coco.2017.480p.snippet.mkv'], length: 20_000_000 },
      ])
    )
  );

  assert.equal(contents.samples.length, 1);
  assert.equal(contents.samples[0].name, 'Coco.2017.480p.snippet.mkv');
  assert.equal(contents.playable.length, 1);
});

test('a full-length file inside a folder called Extras is still reachable', () => {
  const contents = readTorrentContents(
    decoded(
      torrent('Film', [
        { path: ['film.mkv'], length: 2_000_000_000 },
        { path: ['Extras', 'behind the scenes.mkv'], length: 900_000_000 },
      ])
    )
  );

  assert.equal(contents.extras.length, 1, 'flagged as an extra');
  assert.equal(contents.files.filter((f) => f.kind === 'video').length, 2, 'and still listed');
});

test('episodes with no season stated are season 1, not unassigned', () => {
  const contents = readTorrentContents(
    decoded(
      torrent('Some Anime', [
        { path: ['Some Anime - 01.mkv'], length: 300_000_000 },
        { path: ['Some Anime - 02.mkv'], length: 300_000_000 },
      ])
    )
  );

  assert.equal(contents.shape, 'series');
  assert.deepEqual(contents.seasons.map((s) => s.season), [1]);
});

test('the season comes from the folder when the file name omits it', () => {
  const contents = readTorrentContents(
    decoded(
      torrent('Show', [
        { path: ['Season 3', 'Episode 01.mkv'], length: 300_000_000 },
        { path: ['Season 3', 'Episode 02.mkv'], length: 300_000_000 },
      ])
    )
  );

  assert.deepEqual(contents.seasons.map((s) => s.season), [3]);
});

test('episodes beside loose films are mixed, never series', () => {
  /**
   * Calling this a series renders only the episode list, and every film in the
   * pack becomes unreachable — the same "exists and cannot be reached" failure,
   * produced by a classifier.
   */
  const contents = readTorrentContents(
    decoded(
      torrent('Pack', [
        { path: ['S01E01.mkv'], length: 500_000_000 },
        { path: ['S01E02.mkv'], length: 500_000_000 },
        { path: ['Some Movie 2019.mkv'], length: 900_000_000 },
      ])
    )
  );

  assert.equal(contents.shape, 'mixed');
  assert.equal(contents.playable.length, 3);
});

test('several unnumbered films are a collection', () => {
  const contents = readTorrentContents(
    decoded(
      torrent('Marvel Collection', [
        { path: ['Iron Man (2008).mkv'], length: 900_000_000 },
        { path: ['Hulk (2003).mkv'], length: 900_000_000 },
        { path: ['Avengers (2012).mkv'], length: 900_000_000 },
      ])
    )
  );

  assert.equal(contents.shape, 'collection');
  assert.equal(contents.playable.length, 3);
});

test('a torrent with nothing playable says so rather than looking broken', () => {
  const contents = readTorrentContents(
    decoded(torrent('Docs', [{ path: ['readme.txt'], length: 100 }]))
  );

  assert.equal(contents.shape, 'empty');
  assert.equal(contents.primary, undefined);
  assert.equal(contents.files.length, 1);
});

test('the file index survives classification', () => {
  /**
   * The index addresses the file in `TorrentEngine.selectFile` and
   * `StreamRequest.fileIndex`. Re-deriving it from a sorted or filtered view is
   * how pressing play on episode 4 starts episode 5.
   */
  const info = decoded(
    torrent('Show', [
      { path: ['S01E02.mkv'], length: 10 },
      { path: ['S01E01.mkv'], length: 10 },
    ])
  );
  const contents = readTorrentContents(info);

  assert.deepEqual(contents.playable.map((f) => f.episode), [1, 2], 'sorted for viewing');
  assert.deepEqual(contents.playable.map((f) => f.index), [1, 0], 'indices follow the file');
  assert.deepEqual(classifyFiles(info).map((f) => f.index), [0, 1]);
});

// --- search ------------------------------------------------------------------------

test('search narrows on every term, over data already held', () => {
  const contents = readTorrentContents(
    decoded(
      torrent('Show', [
        { path: ['Season 1', 'S01E07.1080p.mkv'], length: 10 },
        { path: ['Season 2', 'S02E07.1080p.mkv'], length: 10 },
        { path: ['Season 2', 'S02E08.720p.mkv'], length: 10 },
      ])
    )
  );

  assert.equal(searchTorrentFiles(contents.playable, 's02 1080p').length, 1);
  assert.equal(searchTorrentFiles(contents.playable, '1080p').length, 2);
  assert.equal(searchTorrentFiles(contents.playable, '').length, 3);
});

test('a viewer can type what they remember, not the encoder spelling', () => {
  const contents = readTorrentContents(
    decoded(torrent('Show', [{ path: ['Season 2', 'S02E07.mkv'], length: 10 }]))
  );

  for (const query of ['episode 7', 'e07', 's02e07', '2x07', 'season 2']) {
    assert.equal(searchTorrentFiles(contents.playable, query).length, 1, `"${query}" found nothing`);
  }
});

// --- subtitles ------------------------------------------------------------------------

test('a subtitle named after its video wins over one that merely shares an episode', () => {
  const contents = readTorrentContents(
    decoded(
      torrent('Show', [
        { path: ['S01E01.mkv'], length: 10 },
        { path: ['S01E01.en.srt'], length: 10 },
        { path: ['Subs', 'random-S01E01.srt'], length: 10 },
      ])
    )
  );

  const matched = subtitlesFor(contents.playable[0], contents.subtitles);
  assert.equal(matched.length, 1);
  assert.equal(matched[0].name, 'S01E01.en.srt');
});

test('a subs folder is matched by episode when the names do not line up', () => {
  const contents = readTorrentContents(
    decoded(
      torrent('Show', [
        { path: ['S01E01.mkv'], length: 10 },
        { path: ['S01E02.mkv'], length: 10 },
        { path: ['Subs', 'Show.S01E02.English.srt'], length: 10 },
      ])
    )
  );

  const second = contents.playable.find((file) => file.episode === 2)!;
  assert.equal(subtitlesFor(second, contents.subtitles).length, 1);
  const first = contents.playable.find((file) => file.episode === 1)!;
  assert.equal(subtitlesFor(first, contents.subtitles).length, 0);
});

test('a single film takes every subtitle in the torrent', () => {
  /**
   * With one film there is nothing else they could belong to, and offering them
   * beats leaving the viewer with none because the uploader named the file
   * `English.srt`.
   */
  const contents = readTorrentContents(
    decoded(
      torrent('Film', [
        { path: ['film.mkv'], length: 900_000_000 },
        { path: ['English.srt'], length: 10 },
        { path: ['Hindi.srt'], length: 10 },
      ])
    )
  );

  assert.equal(subtitlesFor(contents.playable[0], contents.subtitles).length, 2);
});
