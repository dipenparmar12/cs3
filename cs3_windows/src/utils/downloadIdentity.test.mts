/**
 * What makes two downloads the same download.
 *
 *   node --experimental-strip-types src/utils/downloadIdentity.test.mts
 *
 * Pure, and pinned because both halves of the rule fail silently in opposite
 * directions and neither is visible from the screen.
 *
 * Too coarse — the old title-prefix match — and the 1080p release of a film
 * already downloading in 2160p is refused as a duplicate: the button reports
 * `Already downloading` and nothing happens, with no way to tell that the
 * download being named is a different file.
 *
 * Too fine — keying on the link, or on a provider stream's synthetic infohash —
 * and every recovery creates a *second* task for bytes already on disk, because
 * a re-resolved provider URL is a new string for an identical release. That one
 * is worse: it looks like it worked.
 */
import assert from 'node:assert/strict';
import {
  buildDownloadTask,
  downloadTaskId,
  downloadVariantKey,
  variantFromSource,
  variantFromTask,
  variantLabel,
  variantPathSegment,
} from './downloadIdentity.ts';
import type { TorrentResult } from '../types/torrent.ts';

const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

function source(overrides: Partial<TorrentResult> = {}): TorrentResult {
  return {
    infoHash: 'ext-1111111111111111111111111111111111111111',
    title: 'The Incredible Hulk 2008 2160p WEB-DL Hindi',
    magnet: '',
    directUrl: 'https://cdn.example.com/file?id=9&Expires=1000',
    sizeBytes: 8.2e9,
    seeders: 0,
    leechers: 0,
    indexerId: 'gdshine',
    indexerName: 'Gdshine',
    providerName: 'ProviderA',
    parsed: {
      cleanTitle: 'The Incredible Hulk',
      year: 2008,
      isSeasonPack: false,
      isCompleteSeries: false,
      resolution: 2160,
      source: 'WEB-DL',
      videoCodec: 'x265',
      audioCodecs: ['EAC3'],
      hdr: [],
      languages: ['Hindi'],
      isMultiAudio: false,
      isDualAudio: false,
      hasHardcodedSubs: false,
      isRepack: false,
      isProper: false,
      isRemastered: false,
      is3D: false,
    },
    ...overrides,
  } as TorrentResult;
}

const film = { mediaUrl: 'https://provider.example/the-incredible-hulk' };

// --- the reported bug -------------------------------------------------------

test('two resolutions of one film are two different downloads', () => {
  const uhd = downloadVariantKey(variantFromSource(source(), film));
  const hd = downloadVariantKey(
    variantFromSource(
      source({
        title: 'The Incredible Hulk 2008 1080p WEB-DL Hindi',
        parsed: { ...source().parsed, resolution: 1080 },
      }),
      film
    )
  );
  assert.notEqual(uhd, hd);
});

test('two providers offering one release are two different downloads', () => {
  const a = downloadVariantKey(variantFromSource(source(), film));
  const b = downloadVariantKey(
    variantFromSource(source({ providerName: 'ProviderB' }), film)
  );
  assert.notEqual(a, b);
});

test('two languages of one release are two different downloads', () => {
  const hindi = downloadVariantKey(variantFromSource(source(), film));
  const english = downloadVariantKey(
    variantFromSource(
      source({ parsed: { ...source().parsed, languages: ['English'] } }),
      film
    )
  );
  assert.notEqual(hindi, english);
});

test('the same variant is the same download', () => {
  const first = downloadVariantKey(variantFromSource(source(), film));
  const again = downloadVariantKey(variantFromSource(source(), film));
  assert.equal(first, again);
});

// --- durability, which is the half that fails invisibly ---------------------

test('a re-signed provider link is still the same download', () => {
  /**
   * The case the whole design turns on. `ContentService` synthesises a
   * provider source's `infoHash` from its URL, so re-resolving an expired link
   * changes both the URL *and* the id for a byte-identical file. Keying on
   * either would make the recovery start a second download.
   */
  const before = downloadVariantKey(variantFromSource(source(), film));
  const after = downloadVariantKey(
    variantFromSource(
      source({
        infoHash: 'ext-2222222222222222222222222222222222222222',
        directUrl: 'https://cdn.example.com/file?id=9&Expires=99999&sig=new',
      }),
      film
    )
  );
  assert.equal(before, after);
});

test('a torrent is addressed by its real infohash, not its description', () => {
  const hash = 'a'.repeat(40);
  const first = downloadVariantKey(
    variantFromSource(
      source({ infoHash: hash, magnet: `magnet:?xt=urn:btih:${hash}`, directUrl: undefined }),
      film
    )
  );
  const renamed = downloadVariantKey(
    variantFromSource(
      source({
        infoHash: hash,
        magnet: `magnet:?xt=urn:btih:${hash}&dn=different+name`,
        directUrl: undefined,
        title: 'A completely different release name',
        providerName: 'SomeOtherIndexer',
      }),
      film
    )
  );
  assert.equal(first, renamed);
});

test('episodes of one series are separate downloads', () => {
  const e1 = downloadVariantKey(
    variantFromSource(source(), { ...film, season: 1, episode: 1 })
  );
  const e2 = downloadVariantKey(
    variantFromSource(source(), { ...film, season: 1, episode: 2 })
  );
  assert.notEqual(e1, e2);
});

test('punctuation and case in a release name do not change identity', () => {
  const plain = downloadVariantKey(
    variantFromSource(source({ title: 'The Incredible Hulk 2008 2160p WEB-DL' }), film)
  );
  const decorated = downloadVariantKey(
    variantFromSource(source({ title: 'the.incredible.hulk.2008.2160p.web-dl' }), film)
  );
  assert.equal(plain, decorated);
});

// --- the id ----------------------------------------------------------------

test('the id is derived from the key, so it survives a restart', () => {
  const variant = variantFromSource(source(), film);
  assert.equal(downloadTaskId(variant), downloadTaskId({ ...variant }));
  assert.match(downloadTaskId(variant), /^dl-[0-9a-f]{8}$/);
});

test('different variants get different ids', () => {
  const uhd = downloadTaskId(variantFromSource(source(), film));
  const hd = downloadTaskId(
    variantFromSource(
      source({ parsed: { ...source().parsed, resolution: 1080 } }),
      film
    )
  );
  assert.notEqual(uhd, hd);
});

// --- a task carries its own identity back ----------------------------------

test('a built task round-trips to the key it was built with', () => {
  const task = buildDownloadTask(source(), { title: 'The Incredible Hulk', ...film })!;
  assert.equal(task.variantKey, downloadVariantKey(variantFromSource(source(), film)));
  assert.equal(downloadVariantKey(variantFromTask(task)), task.variantKey);
});

test('a built task records the provider, not the extractor', () => {
  /**
   * `indexerName` for an extension link is the file host the provider chose,
   * and it changes between resolves of one release. Storing it as the provider
   * is what made recovery match the wrong source.
   */
  const task = buildDownloadTask(source(), { title: 'The Incredible Hulk', ...film })!;
  assert.equal(task.providerName, 'ProviderA');
  assert.equal(task.link.source, 'Gdshine');
});

test('a source with no address at all produces no task', () => {
  const task = buildDownloadTask(
    source({ directUrl: undefined, magnet: '', torrentUrl: undefined }),
    { title: 'The Incredible Hulk', ...film }
  );
  assert.equal(task, null);
});

test('a bare stream with no source still produces a task', () => {
  const task = buildDownloadTask(null, {
    title: 'Live Channel',
    fallbackUrl: 'https://example.com/live.m3u8',
  });
  assert.ok(task);
  assert.equal(task!.link.url, 'https://example.com/live.m3u8');
});

// --- labels and paths ------------------------------------------------------

test('the label names the variant, resolution first', () => {
  assert.equal(
    variantLabel(variantFromSource(source(), film)),
    '2160p · WEB-DL · ProviderA · Hindi'
  );
});

test('two variants produce two different folders', () => {
  const uhd = variantPathSegment(variantFromSource(source(), film));
  const hd = variantPathSegment(
    variantFromSource(source({ parsed: { ...source().parsed, resolution: 1080 } }), film)
  );
  assert.notEqual(uhd, hd);
  assert.ok(uhd.length > 0);
});

test('a folder name carries nothing a filesystem rejects', () => {
  const segment = variantPathSegment({
    providerName: 'Bad/Name:With*Chars?',
    resolution: 1080,
  });
  for (const illegal of ['<', '>', ':', '"', '/', '\\', '|', '?', '*']) {
    assert.ok(!segment.includes(illegal), `kept ${illegal} in ${segment}`);
  }
  // Windows drops a trailing dot or space, which would collapse two folders.
  assert.ok(!/[. ]$/.test(segment), `trailing dot or space in "${segment}"`);
});

test('a variant with nothing to say gets no folder of its own', () => {
  assert.equal(variantPathSegment({}), '');
});

test('a built episode task preserves parentMediaUrl and series metadata for navigation', () => {
  const episodeSource = source({ title: 'Stranger.Things.S01E01.1080p' });
  const task = buildDownloadTask(episodeSource, {
    title: 'Stranger Things',
    parentTitle: 'Stranger Things',
    episodeTitle: 'Chapter One: The Vanishing of Will Byers',
    mediaUrl: 'cs3ext://SuperStream/https%3A%2F%2Fsuperstream.org%2Fwatch%3Fep%3D1',
    parentMediaUrl: 'cs3ext://SuperStream/https%3A%2F%2Fsuperstream.org%2Fseries%2Fstranger-things',
    providerName: 'SuperStream',
    season: 1,
    episode: 1,
    mediaType: 'series',
    year: 2016,
    posterUrl: 'https://example.com/poster.jpg',
  })!;

  assert.equal(task.parentMediaUrl, 'cs3ext://SuperStream/https%3A%2F%2Fsuperstream.org%2Fseries%2Fstranger-things');
  assert.equal(task.parentTitle, 'Stranger Things');
  assert.equal(task.episodeTitle, 'Chapter One: The Vanishing of Will Byers');
  assert.equal(task.title, 'Stranger Things - Chapter One: The Vanishing of Will Byers');
  assert.equal(task.providerName, 'SuperStream');
  assert.equal(task.mediaType, 'series');
  assert.equal(task.year, 2016);
  assert.equal(task.posterUrl, 'https://example.com/poster.jpg');
});

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
