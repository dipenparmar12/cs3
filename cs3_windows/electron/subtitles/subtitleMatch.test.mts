import { test } from 'node:test';
import assert from 'node:assert/strict';

import { rankSubtitles, releaseGroup, releaseSimilarity, releaseTokens, type RankableSubtitle } from './subtitleMatch.ts';

const sub = (over: Partial<RankableSubtitle>): RankableSubtitle => ({
  id: over.id ?? Math.random().toString(36),
  lang: 'eng',
  langName: 'English',
  origin: 'opensubtitles',
  ...over,
});

test('release vocabulary is normalised across spellings', () => {
  const tokens = releaseTokens('Dune.Part.Two.2024.1080p.AMZN.WEB-DL.DDP5.1.H.264-FLUX');
  assert.ok(tokens.has('webdl'));
  assert.ok(tokens.has('h264'));
  assert.ok(tokens.has('1080p'));
  assert.ok(!tokens.has('2024'), 'the year says nothing about which release');
  assert.equal(releaseGroup('Dune.Part.Two.2024.1080p.WEB-DL.H264.AAC-InMemoryOfEVO.srt'), 'inmemoryofevo');
});

test('the same group outranks the same resolution', () => {
  const playing = 'Dune.Part.Two.2024.2160p.WEB-DL.DDP5.1.HDR.H.265-FLUX';
  const sameGroup = releaseSimilarity(sub({ releaseName: 'Dune.Part.Two.2024.1080p.WEB-DL.H.264-FLUX' }), playing);
  const sameResolution = releaseSimilarity(sub({ releaseName: 'Dune.Part.Two.2024.2160p.BluRay.x265-OTHER' }), playing);
  assert.ok(sameGroup > sameResolution, `${sameGroup} vs ${sameResolution}`);
});

test('a disc release does not pass for a web one', () => {
  const playing = 'Movie.2023.1080p.WEBRip.x264-GRP';
  assert.ok(
    releaseSimilarity(sub({ fileName: 'Movie.2023.720p.WEBRip.srt' }), playing) >
      releaseSimilarity(sub({ fileName: 'Movie.2023.1080p.BluRay.srt' }), playing)
  );
});

test('the file that shipped with the stream is preferred over any catalogue file', () => {
  const ranked = rankSubtitles(
    [sub({ id: 'popular', downloads: 900_000, rating: 9 }), sub({ id: 'provider', origin: 'provider' })],
    {}
  );
  assert.equal(ranked[0].id, 'provider');
});

test('popularity decides between otherwise equal files', () => {
  const ranked = rankSubtitles([sub({ id: 'rare', downloads: 40 }), sub({ id: 'common', downloads: 300_000 })], {});
  assert.equal(ranked[0].id, 'common');
});

test('a file listed under another year sinks: it is probably another work', () => {
  const ranked = rankSubtitles(
    [sub({ id: 'remake', year: 2011, downloads: 500_000 }), sub({ id: 'right', year: 2023, downloads: 2_000 })],
    { year: 2023 }
  );
  assert.equal(ranked[0].id, 'right');
});

test('one best match per language, and nothing is ever removed', () => {
  const ranked = rankSubtitles(
    [
      sub({ id: 'e1', downloads: 10 }),
      sub({ id: 'e2', downloads: 1000 }),
      sub({ id: 'h1', lang: 'hin', langName: 'Hindi' }),
    ],
    {}
  );
  assert.equal(ranked.length, 3);
  assert.deepEqual(
    ranked.filter((r) => r.best).map((r) => r.id).sort(),
    ['e2', 'h1']
  );
});

test('machine translation and hearing-impaired annotations rank below a clean file', () => {
  const ranked = rankSubtitles(
    [sub({ id: 'mt', machineTranslated: true }), sub({ id: 'hi', hearingImpaired: true }), sub({ id: 'clean' })],
    {}
  );
  assert.deepEqual(ranked.map((r) => r.id), ['clean', 'hi', 'mt']);
});

test('a forced file — foreign dialogue only — never wins the language', () => {
  // Measured on Extraction II: "...x264-CMRG-en-forced" ranked second of three
  // English files on popularity, and auto-loading it shows almost nothing.
  const ranked = rankSubtitles(
    [
      sub({ id: 'forced', fileName: 'Extraction.2.2023.1080p.WEB-DL-CMRG-en-forced', downloads: 900_000 }),
      sub({ id: 'full', fileName: 'Extraction.2.2023.1080p.WEB-DL-CMRG', downloads: 20_000 }),
    ],
    {}
  );
  assert.equal(ranked[0].id, 'full');
  assert.ok(ranked.find((r) => r.id === 'forced')?.matchReasons.includes('foreign dialogue only'));
});

test('"same release group" is said only when the group is the same', () => {
  const [ranked] = rankSubtitles(
    [sub({ releaseName: 'Extraction.2.2023.1080p.NF.WEB-DL.DDP5.1.Atmos.x264-CMRG' })],
    { releaseName: 'Extraction.II.2023.1080p.NF.WEB-DL.DDP5.1.Atmos.H.264-FLUX' }
  );
  assert.ok(!ranked.matchReasons.includes('same release group'), ranked.matchReasons.join(', '));
  assert.ok(ranked.matchReasons.includes('same kind of release'));
});
