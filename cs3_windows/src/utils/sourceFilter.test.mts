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
