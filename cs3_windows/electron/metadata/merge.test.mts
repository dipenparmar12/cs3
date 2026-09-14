import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  charactersAgree,
  classifyJob,
  contributingSources,
  mergeCredits,
  mergeNotes,
  mergeRatings,
  mergeStrings,
  mergeVideos,
  normalisedRating,
  normaliseCharacterName,
  normalisePersonName,
  orderCredits,
  preferPreciseDate,
  summariseCrew,
} from './merge.ts';
import {
  CreditRole,
  Department,
  MetadataSource,
  type CreditPerson,
  type TitleRating,
} from '../../src/types/metadata.ts';

/**
 * The merge rules, pinned.
 *
 * Every assertion here stands for a failure that produces no error and looks
 * plausible on screen: a cast list with one actor twice, a composer folded into
 * an actor of the same name, an unbilled extra sorted above the lead, or a
 * "0.0/10" where a source simply had no rating. None of those would be reported
 * as what they are.
 *
 * Verified by mutation — see the note above each group for what breaks it.
 */

const cast = (over: Partial<CreditPerson> & { name: string }): CreditPerson => ({
  role: CreditRole.Cast,
  sources: [MetadataSource.TvMaze],
  ...over,
});

const crew = (over: Partial<CreditPerson> & { name: string }): CreditPerson => ({
  role: CreditRole.Crew,
  sources: [MetadataSource.Wikidata],
  ...over,
});

// --- name folding ---------------------------------------------------------

test('diacritics and punctuation fold, so two spellings are one person', () => {
  assert.equal(normalisePersonName('Léa Seydoux'), normalisePersonName('Lea Seydoux'));
  assert.equal(
    normalisePersonName('Robert Downey, Jr.'),
    normalisePersonName('Robert Downey Jr')
  );
  assert.equal(normalisePersonName('  Tom   Hardy '), 'tom hardy');
});

test('a reordered name is left alone rather than guessed at', () => {
  // "Smith, John" and "John Smith" are the same person and this deliberately
  // does not say so: no source here publishes the inverted form, and a rule
  // that reordered names would merge on a guess.
  assert.notEqual(normalisePersonName('Smith, John'), normalisePersonName('John Smith'));
});

test('character decorations are stripped', () => {
  assert.equal(normaliseCharacterName('Batman (voice)'), 'batman');
  assert.equal(normaliseCharacterName('Alfred (uncredited)'), 'alfred');
});

// --- the character guard --------------------------------------------------

test('a missing character is no opinion, not a disagreement', () => {
  // The whole reason merging works: Wikidata has the character, TVmaze has the
  // photograph, and neither has both. Returning `false` here would leave every
  // enriched cast list doubled.
  assert.equal(charactersAgree(undefined, 'Tony Stark'), null);
  assert.equal(charactersAgree('Tony Stark', undefined), null);
  assert.equal(charactersAgree('', ''), null);
});

test('containment counts as agreement in either direction', () => {
  assert.equal(charactersAgree('Tony Stark', 'Tony Stark / Iron Man'), true);
  assert.equal(charactersAgree('Tony Stark / Iron Man', 'Tony Stark'), true);
});

test('two stated characters that disagree are two people', () => {
  assert.equal(charactersAgree('Tony Stark', 'Steve Rogers'), false);
});

// --- credit merging -------------------------------------------------------

test('one person from two sources becomes one credit carrying both halves', () => {
  const merged = mergeCredits([
    [cast({ name: 'Robert Downey Jr.', imageUrl: 'https://img/rdj.jpg', order: 0 })],
    [
      cast({
        name: 'Robert Downey, Jr.',
        character: 'Tony Stark',
        sources: [MetadataSource.Wikidata],
      }),
    ],
  ]);

  assert.equal(merged.length, 1, 'the punctuation difference must not split the row');
  assert.equal(merged[0].character, 'Tony Stark');
  assert.equal(merged[0].imageUrl, 'https://img/rdj.jpg');
  assert.deepEqual(merged[0].sources, [MetadataSource.TvMaze, MetadataSource.Wikidata]);
});

test('two performers sharing a name stay apart when their characters disagree', () => {
  const merged = mergeCredits([
    [cast({ name: 'Chris Evans', character: 'Steve Rogers' })],
    [cast({ name: 'Chris Evans', character: 'Lee Adams', sources: [MetadataSource.Wikidata] })],
  ]);

  assert.equal(merged.length, 2);
});

test('a crew credit never merges into a performer of the same name', () => {
  // The John Williams case: composer and bit-part actor. Merging them puts
  // "Composer" on an actor's row and loses one of the two credits.
  const merged = mergeCredits([
    [cast({ name: 'John Williams', character: 'Mr. Grant' })],
    [crew({ name: 'John Williams', job: 'Composer', department: Department.Sound })],
  ]);

  assert.equal(merged.length, 2);
  assert.equal(merged.find((p) => p.role === CreditRole.Crew)?.job, 'Composer');
});

test('one person holding two crew jobs keeps both credits', () => {
  const merged = mergeCredits([
    [crew({ name: 'Christopher Nolan', job: 'Director' })],
    [crew({ name: 'Christopher Nolan', job: 'Screenplay' })],
  ]);

  assert.equal(merged.length, 2, 'wrote and directed it is two credits, not one');
});

test('the same crew job from two sources folds', () => {
  const merged = mergeCredits([
    [crew({ name: 'Christopher Nolan', job: 'Director' })],
    [
      crew({
        name: 'Christopher Nolan',
        job: 'Director',
        imageUrl: 'https://img/nolan.jpg',
        sources: [MetadataSource.Wikipedia],
      }),
    ],
  ]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].imageUrl, 'https://img/nolan.jpg');
});

test('the first source to claim someone decides their role', () => {
  // A later source calling a voice credit "cast" must not reclassify a row the
  // viewer may already be reading.
  const merged = mergeCredits([
    [cast({ name: 'Sora Amamiya', role: CreditRole.Voice, character: 'Aqua' })],
    [cast({ name: 'Sora Amamiya', character: 'Aqua', sources: [MetadataSource.Wikidata] })],
  ]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].role, CreditRole.Voice);
});

test('the top billing wins when two sources disagree about order', () => {
  const merged = mergeCredits([
    [cast({ name: 'Zendaya', order: 9 })],
    [cast({ name: 'Zendaya', order: 2, sources: [MetadataSource.Wikidata] })],
  ]);

  assert.equal(merged[0].order, 2);
});

test('the longer of two character strings survives', () => {
  const merged = mergeCredits([
    [cast({ name: 'Hugh Jackman', character: 'Logan' })],
    [cast({ name: 'Hugh Jackman', character: 'Logan / Wolverine', sources: [MetadataSource.Wikidata] })],
  ]);

  assert.equal(merged[0].character, 'Logan / Wolverine');
});

test('a nameless credit is dropped rather than rendered blank', () => {
  assert.deepEqual(mergeCredits([[cast({ name: '   ' })]]), []);
});

// --- ordering -------------------------------------------------------------

test('credits with no billing order follow the ones that have it', () => {
  // Wikidata answers a SPARQL set in planner order. Treating a missing `order`
  // as 0 scatters unbilled extras through the top of the list.
  const ordered = orderCredits([
    cast({ name: 'Unbilled Extra' }),
    cast({ name: 'Lead', order: 0 }),
    cast({ name: 'Second', order: 1 }),
  ]);

  assert.deepEqual(
    ordered.map((p) => p.name),
    ['Lead', 'Second', 'Unbilled Extra']
  );
});

test('ordering is stable for equal orders and for unordered credits', () => {
  const ordered = orderCredits([
    cast({ name: 'B', order: 1 }),
    cast({ name: 'A', order: 1 }),
    cast({ name: 'Y' }),
    cast({ name: 'X' }),
  ]);

  assert.deepEqual(
    ordered.map((p) => p.name),
    ['B', 'A', 'Y', 'X']
  );
});

// --- job classification ---------------------------------------------------

test('the cinematographer does not land under directing', () => {
  // The one misclassification in this table a reader would actually notice.
  assert.equal(classifyJob('Director of Photography'), Department.Camera);
  assert.equal(classifyJob('Director'), Department.Directing);
});

test('common jobs reach their department', () => {
  assert.equal(classifyJob('Screenplay'), Department.Writing);
  assert.equal(classifyJob('Original Music Composer'), Department.Sound);
  assert.equal(classifyJob('Executive Producer'), Department.Production);
  assert.equal(classifyJob('Film Editor'), Department.Editing);
  assert.equal(classifyJob('Costume Designer'), Department.Costume);
  assert.equal(classifyJob('Visual Effects Supervisor'), Department.VisualEffects);
});

test('an unrecognised job is crew rather than a guess', () => {
  assert.equal(classifyJob('Best Boy'), Department.Crew);
  assert.equal(classifyJob(undefined), Department.Crew);
});

// --- ratings --------------------------------------------------------------

test('one source publishing a critic and an audience score keeps both', () => {
  const merged = mergeRatings([
    [
      { source: 'rottenTomatoes', kind: 'critic', value: 90, scaleMin: 0, scaleMax: 100 },
      { source: 'rottenTomatoes', kind: 'audience', value: 51, scaleMin: 0, scaleMax: 100 },
    ],
  ]);

  assert.equal(merged.length, 2, 'the disagreement is the information');
});

test('the better-evidenced copy of one rating wins', () => {
  const merged = mergeRatings([
    [{ source: MetadataSource.Cinemeta, value: 8.8, scaleMin: 0, scaleMax: 10, votes: 12 }],
    [{ source: MetadataSource.Cinemeta, value: 8.8, scaleMin: 0, scaleMax: 10, votes: 900_000 }],
  ]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].votes, 900_000);
});

test('ratings sort by how many people voted, not by value', () => {
  const merged = mergeRatings([
    [
      { source: 'provider', value: 10, scaleMin: 0, scaleMax: 10, votes: 12 },
      { source: MetadataSource.Cinemeta, value: 8.8, scaleMin: 0, scaleMax: 10, votes: 900_000 },
    ],
  ]);

  assert.equal(merged[0].source, MetadataSource.Cinemeta);
});

test('a malformed scale is dropped instead of dividing by zero', () => {
  const merged = mergeRatings([
    [{ source: 'x', value: 5, scaleMin: 10, scaleMax: 10 }],
    [{ source: 'y', value: Number.NaN, scaleMin: 0, scaleMax: 10 }],
  ]);

  assert.deepEqual(merged, []);
});

test('a zero rating reads as absent, not as nought out of ten', () => {
  // AniList sends averageScore: 0 and Cinemeta omits imdbRating for a title
  // nobody has rated. Scaling those renders a real and terrible score.
  const none: TitleRating = { source: MetadataSource.AniList, value: 0, scaleMin: 0, scaleMax: 100 };
  assert.equal(normalisedRating(none), null);
});

test('a percentage and a ten-point score land on one comparable scale', () => {
  assert.equal(
    normalisedRating({ source: 'rottenTomatoes', value: 91, scaleMin: 0, scaleMax: 100 }),
    9.1
  );
  assert.equal(
    normalisedRating({ source: MetadataSource.Cinemeta, value: 8.8, scaleMin: 0, scaleMax: 10 }),
    8.8
  );
});

// --- crew summary ---------------------------------------------------------

test('the crew summary reads jobs, not departments', () => {
  const people = [
    crew({ name: 'Denis Villeneuve', job: 'Director' }),
    crew({ name: 'Jon Spaihts', job: 'Screenplay' }),
    crew({ name: 'Hans Zimmer', job: 'Original Music Composer' }),
    crew({ name: 'Greig Fraser', job: 'Director of Photography' }),
    cast({ name: 'Timothée Chalamet', character: 'Paul Atreides' }),
  ];

  const summary = summariseCrew(people);
  assert.deepEqual(summary.directors.map((p) => p.name), ['Denis Villeneuve']);
  assert.deepEqual(summary.writers.map((p) => p.name), ['Jon Spaihts']);
  assert.deepEqual(summary.composers.map((p) => p.name), ['Hans Zimmer']);
  assert.deepEqual(summary.cinematographers.map((p) => p.name), ['Greig Fraser']);
});

test('the director of photography is not listed as a director', () => {
  const summary = summariseCrew([crew({ name: 'Greig Fraser', job: 'Director of Photography' })]);
  assert.deepEqual(summary.directors, []);
});

// --- notes, videos, strings, dates ---------------------------------------

test('the same passage from two sources appears once', () => {
  const attribution = {
    source: MetadataSource.Wikipedia,
    url: 'https://en.wikipedia.org/wiki/Dune',
    licence: 'CC BY-SA 4.0',
  };
  const merged = mergeNotes([
    [{ heading: 'Production', text: 'Filming began in March 2019.', attribution }],
    [{ heading: 'Production', text: 'Filming began in March 2019.', attribution }],
  ]);

  assert.equal(merged.length, 1);
});

test('videos deduplicate on URL', () => {
  const video = { title: 'Trailer', url: 'https://y/1', kind: 'trailer' as const, host: 'youtube' as const };
  assert.equal(mergeVideos([[video], [{ ...video, title: 'Official Trailer' }]]).length, 1);
});

test('strings deduplicate case-insensitively and keep their order', () => {
  assert.deepEqual(mergeStrings([['Science Fiction', 'Drama'], ['drama', 'Adventure']]), [
    'Science Fiction',
    'Drama',
    'Adventure',
  ]);
});

test('the more precise date wins when the sources agree on the year', () => {
  assert.equal(preferPreciseDate('2021', '2021-10-22'), '2021-10-22');
  assert.equal(preferPreciseDate('2021-10-22', '2021'), '2021-10-22');
});

test('a date from a different year is rejected rather than picked between', () => {
  // A festival premiere and a general release are two dates; guessing which the
  // viewer meant is worse than keeping the one already on screen.
  assert.equal(preferPreciseDate('2021-10-22', '2020-09-03'), '2021-10-22');
});

test('the contributing sources are what actually produced a credit', () => {
  const people = [
    cast({ name: 'A', sources: [MetadataSource.TvMaze] }),
    cast({ name: 'B', sources: [MetadataSource.Wikidata, MetadataSource.TvMaze] }),
  ];
  assert.deepEqual(contributingSources(people), [MetadataSource.TvMaze, MetadataSource.Wikidata]);
});
