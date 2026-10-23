/**
 * Tests for sourceFilter.ts
 *
 *   node --experimental-strip-types src/utils/sourceFilter.test.mts
 */
import assert from 'node:assert/strict';
import {
  DEFAULT_FILTER_STATE,
  buildFacet,
  detectResolutionCategory,
  filterAndSortSources,
  foldTorrents,
  groupSourcesByOrigin,
  isFilterActive,
  matchesLanguage,
  matchesSize,
} from './sourceFilter.ts';
import type { TorrentResult, ParsedRelease } from '../types/torrent.ts';
import { Resolution } from '../types/torrent.ts';

const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

const DEFAULT_PARSED: ParsedRelease = {
  cleanTitle: 'Test Video',
  isSeasonPack: false,
  isCompleteSeries: false,
  resolution: Resolution.FHD,
  source: 'WEB-DL',
  videoCodec: 'x264',
  audioCodecs: ['AAC'],
  hdr: [],
  languages: ['en'],
  isMultiAudio: false,
  isDualAudio: false,
  hasHardcodedSubs: false,
  isRepack: false,
  isProper: false,
  isRemastered: false,
  is3D: false,
};

function createSource(
  overrides: Omit<Partial<TorrentResult>, 'parsed'> & { parsed?: Partial<ParsedRelease> } = {}
): TorrentResult {
  return {
    infoHash: overrides.infoHash ?? 'hash-1',
    title: overrides.title ?? 'Test Video 1080p',
    magnet: overrides.magnet ?? 'magnet:?xt=urn:btih:hash-1',
    directUrl: overrides.directUrl,
    sizeBytes: overrides.sizeBytes ?? 2 * 1000 * 1000 * 1000,
    seeders: overrides.seeders ?? 10,
    leechers: overrides.leechers ?? 2,
    indexerId: overrides.indexerId ?? 'nyaa',
    indexerName: overrides.indexerName ?? 'Nyaa',
    score: overrides.score ?? 50,
    scoreReasons: [],
    ...overrides,
    parsed: {
      ...DEFAULT_PARSED,
      ...overrides.parsed,
    },
  };
}

test('DEFAULT_FILTER_STATE has kind="all" and isFilterActive is false', () => {
  assert.equal(DEFAULT_FILTER_STATE.kind, 'all');
  assert.equal(isFilterActive(DEFAULT_FILTER_STATE), false);
});

test('isFilterActive reports true when kind filter is set to direct or torrent', () => {
  assert.equal(isFilterActive({ ...DEFAULT_FILTER_STATE, kind: 'direct' }), true);
  assert.equal(isFilterActive({ ...DEFAULT_FILTER_STATE, kind: 'torrent' }), true);
});

test('filterAndSortSources filters out torrents when kind="direct"', () => {
  const direct = createSource({
    infoHash: 'direct-1',
    directUrl: 'https://cdn.example.com/stream.mp4',
    title: 'Stream 1',
  });
  const torrent = createSource({
    infoHash: 'torrent-1',
    directUrl: undefined,
    title: 'Torrent 1',
  });

  const results = filterAndSortSources([direct, torrent], {
    ...DEFAULT_FILTER_STATE,
    kind: 'direct',
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].infoHash, 'direct-1');
});

test('filterAndSortSources filters out direct streams when kind="torrent"', () => {
  const direct = createSource({
    infoHash: 'direct-1',
    directUrl: 'https://cdn.example.com/stream.mp4',
    title: 'Stream 1',
  });
  const torrent = createSource({
    infoHash: 'torrent-1',
    directUrl: undefined,
    title: 'Torrent 1',
  });

  const results = filterAndSortSources([direct, torrent], {
    ...DEFAULT_FILTER_STATE,
    kind: 'torrent',
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].infoHash, 'torrent-1');
});

test('filterAndSortSources returns all items when kind="all"', () => {
  const direct = createSource({
    infoHash: 'direct-1',
    directUrl: 'https://cdn.example.com/stream.mp4',
  });
  const torrent = createSource({
    infoHash: 'torrent-1',
    directUrl: undefined,
  });

  const results = filterAndSortSources([direct, torrent], {
    ...DEFAULT_FILTER_STATE,
    kind: 'all',
  });

  assert.equal(results.length, 2);
});

test('buildFacet produces counts for kind dimension', () => {
  const direct = createSource({
    infoHash: 'direct-1',
    directUrl: 'https://cdn.example.com/stream.mp4',
  });
  const torrent1 = createSource({
    infoHash: 'torrent-1',
    directUrl: undefined,
  });
  const torrent2 = createSource({
    infoHash: 'torrent-2',
    directUrl: undefined,
  });

  const facets = buildFacet([direct, torrent1, torrent2], DEFAULT_FILTER_STATE, 'kind');
  assert.equal(facets.length, 2);
  const directFacet = facets.find((f) => f.value === 'direct');
  const torrentFacet = facets.find((f) => f.value === 'torrent');
  assert.equal(directFacet?.count, 1);
  assert.equal(torrentFacet?.count, 2);
});

test('detectResolutionCategory resolves parsed and title fallbacks', () => {
  const s4k = createSource({ parsed: { cleanTitle: 'Film', resolution: Resolution.UHD_4K, isSeasonPack: false } });
  const s1080 = createSource({ parsed: { cleanTitle: 'Film', resolution: Resolution.FHD, isSeasonPack: false } });
  const sFallback = createSource({
    title: 'Film 2024 720p WEB-DL',
    parsed: { cleanTitle: 'Film', resolution: Resolution.Unknown, isSeasonPack: false },
  });

  assert.equal(detectResolutionCategory(s4k), '4k');
  assert.equal(detectResolutionCategory(s1080), '1080p');
  assert.equal(detectResolutionCategory(sFallback), '720p');
});

test('matchesSize categorises file size properly', () => {
  const s500mb = createSource({ sizeBytes: 500 * 1000 * 1000 });
  const s2gb = createSource({ sizeBytes: 2 * 1000 * 1000 * 1000 });
  const s5gb = createSource({ sizeBytes: 5 * 1000 * 1000 * 1000 });
  const s10gb = createSource({ sizeBytes: 10 * 1000 * 1000 * 1000 });

  assert.equal(matchesSize(s500mb, 'under1gb'), true);
  assert.equal(matchesSize(s500mb, '1to3gb'), false);
  assert.equal(matchesSize(s2gb, '1to3gb'), true);
  assert.equal(matchesSize(s5gb, '3to8gb'), true);
  assert.equal(matchesSize(s10gb, 'over8gb'), true);
});

test('matchesLanguage correctly checks languages array and title tokens', () => {
  const en = createSource({ parsed: { cleanTitle: 'Film', languages: ['en'], isSeasonPack: false } });
  const ja = createSource({ title: 'Anime 1080p Japanese', parsed: { cleanTitle: 'Anime', languages: [], isSeasonPack: false } });

  assert.equal(matchesLanguage(en, 'en'), true);
  assert.equal(matchesLanguage(en, 'ja'), false);
  assert.equal(matchesLanguage(ja, 'ja'), true);
});

// Runner
test('foldTorrents keeps every stream and the best torrents, folds the tail in order', () => {
  const torrents = Array.from({ length: 8 }, (_, i) => createSource({ infoHash: `t${i}`, title: `Torrent ${i}` }));
  const stream = createSource({ infoHash: 's', directUrl: 'https://cdn.example.com/a.m3u8' });
  const list = [torrents[0], stream, ...torrents.slice(1)];
  const { shown, hidden } = foldTorrents(list, DEFAULT_FILTER_STATE, undefined, 3);
  assert.deepEqual(shown.map((s) => s.infoHash), ['t0', 's', 't1', 't2']);
  assert.equal(hidden, 5);
});

test('a list of torrents alone folds too, at the larger limit, and never folds the playing row', () => {
  const torrents = Array.from({ length: 12 }, (_, i) => createSource({ infoHash: `t${i}`, title: `Torrent ${i}` }));
  const alone = foldTorrents(torrents, DEFAULT_FILTER_STATE);
  assert.equal(alone.shown.length, 8);
  assert.equal(alone.hidden, 4);

  const stream = createSource({ infoHash: 's', directUrl: 'https://cdn.example.com/a.mp4' });
  assert.equal(foldTorrents([stream, ...torrents], { kind: 'torrent' }).shown.length, 9, 'torrent filter: 8 + the stream');

  const playing = foldTorrents([stream, ...torrents], DEFAULT_FILTER_STATE, (s) => s.infoHash === 't11', 3);
  assert.ok(playing.shown.some((s) => s.infoHash === 't11'));
  assert.equal(playing.hidden, 8);
});

test('copies of a shown release fold behind it; an unknown size never groups', () => {
  const size = 2_000_000_000;
  const a = createSource({ infoHash: 'a', title: 'Dune.2021.1080p.WEB-DL.x264-GRP', sizeBytes: size });
  const copy = createSource({ infoHash: 'b', title: 'Dune 2021 1080p WEB-DL x264-GRP', sizeBytes: size * 1.004 });
  const other = createSource({ infoHash: 'c', title: 'Dune.2021.2160p.WEB-DL.x265-GRP', sizeBytes: size * 3 });
  const noSize1 = createSource({ infoHash: 'd', title: 'Dune.2021.720p', sizeBytes: 0 });
  const noSize2 = createSource({ infoHash: 'e', title: 'Dune.2021.720p', sizeBytes: 0 });
  const { shown, hidden } = foldTorrents([a, copy, other, noSize1, noSize2], DEFAULT_FILTER_STATE);
  assert.deepEqual(shown.map((s) => s.infoHash), ['a', 'c', 'd', 'e']);
  assert.equal(hidden, 1);
});

test('sources group by origin in order of their best row, ranking kept inside', () => {
  const a1 = createSource({ infoHash: 'a1', indexerName: 'Torrentio' });
  const b1 = createSource({ infoHash: 'b1', indexerName: 'YTS' });
  const a2 = createSource({ infoHash: 'a2', indexerName: 'Torrentio, The Pirate Bay' });
  const p1 = createSource({ infoHash: 'p1', indexerName: 'x', providerName: 'HDO', directUrl: 'https://h/x.m3u8' });
  const groups = groupSourcesByOrigin([a1, b1, a2, p1]);
  assert.deepEqual(groups.map((g) => [g.origin, g.sources.map((s) => s.infoHash)]), [['Torrentio', ['a1', 'a2']], ['YTS', ['b1']], ['HDO', ['p1']]]);
  assert.equal(groupSourcesByOrigin([]).length, 0);
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL ${name}`);
    console.log(`       ${err instanceof Error ? err.message : String(err)}`);
  }
}
console.log(failed === 0 ? `\n${tests.length} passed` : `\n${failed} of ${tests.length} FAILED`);
process.exit(failed === 0 ? 0 : 1);
