import assert from 'node:assert/strict';
import {
  extractResolution,
  formatResolutionLabel,
  areResolutionSiblings,
  findResolutionVariants,
} from './resolutionVariants.ts';
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

test('extractResolution parses numeric resolutions correctly', () => {
  assert.equal(extractResolution(createSource({ parsed: { resolution: 720 } })), 720);
  assert.equal(extractResolution(createSource({ parsed: { resolution: 0 }, title: 'Movie 2160p UHD' })), 2160);
  assert.equal(extractResolution(createSource({ parsed: { resolution: 0 }, title: 'Movie 4k' })), 2160);
  assert.equal(extractResolution(createSource({ parsed: { resolution: 0 }, title: 'Movie 1080p' })), 1080);
  assert.equal(extractResolution(createSource({ parsed: { resolution: 0 }, title: 'Movie 480p' })), 480);
  assert.equal(extractResolution(createSource({ parsed: { resolution: 0 }, title: 'Movie Full HD' })), 1080);
  assert.equal(extractResolution(createSource({ parsed: { resolution: 0 }, title: 'Movie', directUrl: 'https://cdn.example.com/720/index.m3u8' })), 720);
});

test('extractResolution does not invent a resolution from ambiguous text', () => {
  const unknown = (title: string, directUrl?: string) =>
    extractResolution(createSource({ parsed: { resolution: 0 }, title, directUrl }));
  // Bare HD/SD are release tags, not resolutions.
  assert.equal(unknown('Movie SD'), 0);
  assert.equal(unknown('Movie HD Rip'), 0);
  // A year, or a bare number, is not a resolution.
  assert.equal(unknown('Nosferatu 1920'), 0);
  assert.equal(unknown('Server 720'), 0);
  // A name stating two resolutions confirms neither.
  assert.equal(unknown('Pack 720p + 1080p'), 0);
  // An id in a query string is not a rung.
  assert.equal(unknown('Movie', 'https://cdn.example.com/v.m3u8?id=1080'), 0);
  // The name outranks the address.
  assert.equal(unknown('Movie 480p', 'https://cdn.example.com/1080/index.m3u8'), 480);
});

test('no variants when the playing resolution is unknown or nothing differs', () => {
  const a = createSource({ infoHash: 'a', providerName: 'P', indexerName: 'X', parsed: { cleanTitle: 'Film', resolution: 0 }, title: 'Film' });
  const b = createSource({ infoHash: 'b', providerName: 'P', indexerName: 'X', parsed: { cleanTitle: 'Film', resolution: 720 } });
  assert.deepEqual(findResolutionVariants(a, [a, b]), []);
  const c = createSource({ infoHash: 'c', providerName: 'P', indexerName: 'X', parsed: { cleanTitle: 'Film', resolution: 720 } });
  assert.deepEqual(findResolutionVariants(b, [b, c]), []);
});

test('a sibling that failed this session yields to one that has not', () => {
  const active = createSource({ infoHash: 'a', providerName: 'P', indexerName: 'X', score: 10, parsed: { cleanTitle: 'Film', resolution: 1080 } });
  const dead = createSource({ infoHash: 'dead', providerName: 'P', indexerName: 'X', score: 90, parsed: { cleanTitle: 'Film', resolution: 720 } });
  const live = createSource({ infoHash: 'live', providerName: 'P', indexerName: 'X', score: 20, parsed: { cleanTitle: 'Film', resolution: 720 } });
  const variants = findResolutionVariants(active, [active, dead, live], new Set(['dead']));
  assert.equal(variants[1].source.infoHash, 'live');
  assert.equal(variants[1].failed, false);

  const onlyDead = findResolutionVariants(active, [active, dead], new Set(['dead']));
  assert.equal(onlyDead[1].failed, true);
});

test('formatResolutionLabel formats standard resolutions', () => {
  assert.equal(formatResolutionLabel(2160), '4K');
  assert.equal(formatResolutionLabel(1440), '1440p');
  assert.equal(formatResolutionLabel(1080), '1080p');
  assert.equal(formatResolutionLabel(720), '720p');
  assert.equal(formatResolutionLabel(480), '480p');
});

test('areResolutionSiblings groups valid siblings differing in resolution', () => {
  const castle720 = createSource({
    infoHash: 'c720',
    title: 'Castle TV (Use VLC) - Hindi, English, Tamil, Telugu',
    providerName: 'Castle TV (Use VLC)',
    indexerName: 'Castle TV (Use VLC)',
    directUrl: 'https://cdn.example.com/720/index_366.m3u8',
    parsed: { cleanTitle: 'Castle TV (Use VLC)', resolution: 720, languages: ['en', 'hi', 'ta', 'te'] },
  });

  const castle480 = createSource({
    infoHash: 'c480',
    title: 'Castle TV (Use VLC) - Hindi, English, Tamil, Telugu',
    providerName: 'Castle TV (Use VLC)',
    indexerName: 'Castle TV (Use VLC)',
    directUrl: 'https://cdn.example.com/480/index_370.m3u8',
    parsed: { cleanTitle: 'Castle TV (Use VLC)', resolution: 480, languages: ['en', 'hi', 'ta', 'te'] },
  });

  assert.equal(areResolutionSiblings(castle720, castle480), true);
});

test('areResolutionSiblings rejects different providers or different episodes', () => {
  const s1 = createSource({
    providerName: 'VegaMovies',
    parsed: { cleanTitle: 'Film', season: 1, episode: 1 },
  });
  const s2 = createSource({
    providerName: 'VegaMovies',
    parsed: { cleanTitle: 'Film', season: 1, episode: 2 },
  });
  const sDiffProv = createSource({
    providerName: 'OtherProvider',
    parsed: { cleanTitle: 'Film', season: 1, episode: 1 },
  });

  assert.equal(areResolutionSiblings(s1, s2), false);
  assert.equal(areResolutionSiblings(s1, sDiffProv), false);
});

test('findResolutionVariants returns sorted, deduplicated resolution variants', () => {
  const v1080 = createSource({
    infoHash: 'v1080',
    title: 'V-Cloud[Download] Basic.Instinct.1992.RM.1080p.10bit.BluRay.HIN-ENG.x265.ESub-Vegamovies.is.mkv',
    providerName: 'VegaMovies',
    indexerName: 'V-Cloud[Download]',
    score: 100,
    parsed: { cleanTitle: 'Basic Instinct', resolution: 1080 },
  });
  const v720 = createSource({
    infoHash: 'v720',
    title: 'V-Cloud[Download] Basic.Instinct.1992.RM.720p.BluRay.HIN-ENG.x264.ESub-Vegamovies.is.mkv',
    providerName: 'VegaMovies',
    indexerName: 'V-Cloud[Download]',
    score: 80,
    parsed: { cleanTitle: 'Basic Instinct', resolution: 720 },
  });
  const v480 = createSource({
    infoHash: 'v480',
    title: 'V-Cloud[Download] Basic.Instinct.1992.RM.480p.BluRay.HIN-ENG.x264.ESub-Vegamovies.is.mkv',
    providerName: 'VegaMovies',
    indexerName: 'V-Cloud[Download]',
    score: 60,
    parsed: { cleanTitle: 'Basic Instinct', resolution: 480 },
  });
  const v480Dup = createSource({
    infoHash: 'v480-dup',
    title: 'V-Cloud[Download] Basic.Instinct.1992.RM.480p.BluRay.HIN-ENG.x264.ESub-Vegamovies.is.mkv',
    providerName: 'VegaMovies',
    indexerName: 'V-Cloud[Download]',
    score: 55,
    parsed: { cleanTitle: 'Basic Instinct', resolution: 480 },
  });

  const all = [v480, v1080, v720, v480Dup];
  const variants = findResolutionVariants(v720, all);

  assert.equal(variants.length, 3);
  assert.equal(variants[0].resolution, 1080);
  assert.equal(variants[0].label, '1080p');
  assert.equal(variants[0].isCurrent, false);

  assert.equal(variants[1].resolution, 720);
  assert.equal(variants[1].label, '720p');
  assert.equal(variants[1].isCurrent, true);

  assert.equal(variants[2].resolution, 480);
  assert.equal(variants[2].label, '480p');
  assert.equal(variants[2].isCurrent, false);
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(err);
    failed++;
  }
}

if (failed > 0) {
  process.exit(1);
}
