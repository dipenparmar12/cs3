import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyVideoTitle,
  looksOfficial,
  orderVideos,
  readSeason,
  youTubeVideo,
} from './videoTitles.ts';
import { groupVideos } from '../../src/utils/videoGallery.ts';
import { MetadataSource, TitleVideoKind } from '../../src/types/metadata.ts';

/**
 * Every title below was returned by YouTube's oEmbed endpoint for a video id
 * Cinemeta published, on 2026-09-18. They are not invented examples — three of
 * these assertions exist because the first implementation got them wrong
 * against the live data and the measurement said so.
 */

test('a numbered trailer keeps its number and its kind', () => {
  const dune = classifyVideoTitle('Dune: Part Two | Official Trailer 3');
  assert.equal(dune.kind, TitleVideoKind.Trailer);
  assert.equal(dune.label, 'Official Trailer 3');
  assert.equal(dune.ordinal, 3);
  assert.equal(dune.season, undefined, 'a film has no season');
});

test('the film name is not repeated on the chip', () => {
  const { label } = classifyVideoTitle('SPIDER-MAN: ACROSS THE SPIDER-VERSE - Official Trailer #2 (HD)');
  assert.equal(label, 'Official Trailer #2');
  assert.ok(!/spider-man/i.test(label), 'the gallery is already under the film name');
});

test('the channel sign-off is not mistaken for the description', () => {
  const { label, kind } = classifyVideoTitle('Stranger Things | Official Final Trailer | Netflix');
  assert.equal(label, 'Official Final Trailer');
  assert.equal(kind, TitleVideoKind.Trailer);
});

test('a season trailer is filed under its season', () => {
  const { season, ordinal, kind } = classifyVideoTitle(
    'Stranger Things Season 1 Trailer 1 | Rotten Tomatoes TV'
  );
  assert.equal(season, 1);
  assert.equal(ordinal, 1);
  assert.equal(kind, TitleVideoKind.Trailer);
});

test('a multi-season retrospective is not filed under one season', () => {
  // Measured: "BREAKING BAD - Seasons 1-5 Trailer" is the series trailer.
  assert.equal(readSeason('BREAKING BAD - Seasons 1-5 Trailer'), undefined);
});

test('a bare number near no season word is not a season', () => {
  assert.equal(readSeason('Official Trailer 2'), undefined);
  assert.equal(readSeason('Dune: Part Two | Official Trailer 3'), undefined);
});

test('the describing segment decides the kind, not the rest of the title', () => {
  /**
   * The regression this exists for. Sony's title carries a numbered trailer
   * *and* a release announcement, and "In Cinemas" sits in a rule listed above
   * `trailer` — so testing the whole string classified a trailer as a promo
   * while the label correctly read "Trailer #3".
   */
  const sony = classifyVideoTitle(
    'Spider-Man: Across the Spider-Verse - Trailer #3 -  Only In Cinemas June 2'
  );
  assert.equal(sony.kind, TitleVideoKind.Trailer);
  assert.equal(sony.label, 'Trailer #3');
  assert.equal(sony.ordinal, 3);
});

test('a release announcement with no trailer in it is a promo', () => {
  const stronger = classifyVideoTitle(
    'SPIDER-MAN: ACROSS THE SPIDER-VERSE – Stronger (In Theaters June 2)'
  );
  assert.equal(stronger.kind, TitleVideoKind.Promo);
});

test('narrow kinds are tested before broad ones', () => {
  assert.equal(
    classifyVideoTitle('Dune | Behind the Scenes of the Trailer').kind,
    TitleVideoKind.BehindTheScenes,
    'a rule containing "trailer" must not be claimed by the trailer rule'
  );
  assert.equal(
    classifyVideoTitle('The Batman | Teaser Trailer').kind,
    TitleVideoKind.Teaser,
    'a teaser trailer is a teaser'
  );
  assert.equal(classifyVideoTitle('Dune | First Look').kind, TitleVideoKind.Teaser);
  assert.equal(classifyVideoTitle('Oppenheimer | Making Of').kind, TitleVideoKind.BehindTheScenes);
  assert.equal(classifyVideoTitle('Dune | Cast Interview').kind, TitleVideoKind.Interview);
  assert.equal(classifyVideoTitle('Dune | Opening Scene').kind, TitleVideoKind.Clip);
});

test('a title nothing recognises is a trailer, never hidden', () => {
  const odd = classifyVideoTitle('Dune: Part Two | Worlds Beyond');
  assert.equal(
    odd.kind,
    TitleVideoKind.Trailer,
    'these arrive from a trailer field; filing one under Related Videos hides it'
  );
});

test('the official publisher test is tight in the direction that matters', () => {
  assert.equal(looksOfficial('Warner Bros.'), true);
  assert.equal(looksOfficial('Sony Pictures Entertainment'), true);
  assert.equal(looksOfficial('Sony Pictures Releasing UK'), true);
  assert.equal(looksOfficial('Netflix'), true);
  assert.equal(looksOfficial('Rotten Tomatoes TV'), false);
  assert.equal(looksOfficial('Henry Page'), false);
  assert.equal(looksOfficial(undefined), false);
});

test('a video is addressed by its id, with a thumbnail that costs no request', () => {
  const video = youTubeVideo('U2Qp5pL3ovA', {
    source: MetadataSource.Cinemeta,
    title: 'Dune: Part Two | Official Trailer 3',
    publisher: 'Warner Bros.',
  });
  assert.equal(video.id, 'youtube:U2Qp5pL3ovA');
  assert.equal(video.url, 'https://www.youtube.com/watch?v=U2Qp5pL3ovA');
  assert.equal(video.thumbnailUrl, 'https://i.ytimg.com/vi/U2Qp5pL3ovA/hqdefault.jpg');
  assert.equal(video.official, true);
  assert.equal(video.ordinal, 3);
});

test("the studio's own upload leads, then the newest trailer", () => {
  const make = (id: string, patch: Record<string, unknown>) => ({
    ...youTubeVideo(id, { source: MetadataSource.Cinemeta, title: 'Trailer' }),
    ...patch,
  });
  const ordered = orderVideos([
    make('aaaaaaaaaaa', { kind: TitleVideoKind.Trailer, ordinal: 1, official: true }),
    make('bbbbbbbbbbb', { kind: TitleVideoKind.Teaser, official: true }),
    make('ccccccccccc', { kind: TitleVideoKind.Trailer, ordinal: 3, official: true }),
    make('ddddddddddd', { kind: TitleVideoKind.Trailer, ordinal: 3, official: false }),
    make('eeeeeeeeeee', { kind: TitleVideoKind.Trailer, season: 2, official: true }),
  ]);
  assert.deepEqual(
    ordered.map((video) => video.id),
    [
      'youtube:ccccccccccc', // official trailer 3 — newest of the studio's own
      'youtube:aaaaaaaaaaa', // official trailer 1
      'youtube:ddddddddddd', // trailer 3, but not the studio's — behind both
      'youtube:bbbbbbbbbbb', // teaser
      'youtube:eeeeeeeeeee', // season 2 comes after everything about the work
    ],
    'official outranks the ordinal: a fan re-upload of a later trailer is ' +
      'lower quality and more likely to disappear than the official upload'
  );
});

test('the gallery splits trailers from everything else', () => {
  const make = (id: string, kind: TitleVideoKind, season?: number) => ({
    ...youTubeVideo(id, { source: MetadataSource.Cinemeta, title: 'Trailer' }),
    kind,
    season,
  });
  const { trailerGroups, related } = groupVideos([
    make('aaaaaaaaaaa', TitleVideoKind.Trailer),
    make('bbbbbbbbbbb', TitleVideoKind.Teaser, 1),
    make('ccccccccccc', TitleVideoKind.Trailer, 1),
    make('ddddddddddd', TitleVideoKind.BehindTheScenes),
    make('eeeeeeeeeee', TitleVideoKind.Featurette),
    make('fffffffffff', TitleVideoKind.Promo, 2),
  ]);

  assert.deepEqual(
    trailerGroups.map((group) => group.heading),
    ['Trailers', 'Season 1', 'Season 2']
  );
  assert.equal(trailerGroups[0].videos.length, 1);
  assert.equal(trailerGroups[1].videos.length, 2);
  assert.deepEqual(
    related.map((video) => video.id),
    ['youtube:ddddddddddd', 'youtube:eeeeeeeeeee'],
    'behind-the-scenes and featurettes are related videos, not trailers'
  );
});

test('a gallery of only trailers has no season headings at all', () => {
  const { trailerGroups, related } = groupVideos([
    youTubeVideo('aaaaaaaaaaa', { source: MetadataSource.Cinemeta, title: 'Official Trailer' }),
    youTubeVideo('bbbbbbbbbbb', { source: MetadataSource.Cinemeta, title: 'Official Trailer 2' }),
  ]);
  assert.equal(trailerGroups.length, 1);
  assert.equal(
    trailerGroups[0].heading,
    null,
    'one group needs no heading — a "Trailers" heading inside a Trailers section is noise'
  );
  assert.deepEqual(related, []);
});
