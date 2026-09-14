import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  answeringSources,
  describeCredit,
  failedSources,
  formatMoney,
  formatRating,
  formatReleaseDate,
  formatRuntimeMinutes,
  formatVotes,
  groupCredits,
  hasAnything,
  sourceLabel,
} from './metadataDisplay.ts';
import {
  CreditRole,
  MetadataSource,
  type CreditPerson,
} from '../types/metadata.ts';

/**
 * The display rules, pinned.
 *
 * The date group is the one that matters most: every assertion in it stands for
 * a film's debut year being rendered one year early, which is both wrong and
 * completely invisible to whoever wrote the code — it only reproduces west of
 * Greenwich.
 */

const person = (over: Partial<CreditPerson> & { name: string }): CreditPerson => ({
  role: CreditRole.Cast,
  sources: [MetadataSource.TvMaze],
  ...over,
});

// --- dates ----------------------------------------------------------------

test('a year-only date renders as the year, in every timezone', () => {
  // `new Date('2008')` is UTC midnight on 1 January, so formatting it locally
  // shows 2007 anywhere west of Greenwich. Nothing here constructs a Date.
  assert.equal(formatReleaseDate('2008'), '2008');
});

test('each precision renders as exactly what it claims', () => {
  assert.equal(formatReleaseDate('2008-05'), 'May 2008');
  assert.equal(formatReleaseDate('2008-05-02'), '2 May 2008');
  assert.equal(formatReleaseDate('2008-05-02T00:00:00Z'), '2 May 2008');
});

test('an impossible date degrades rather than rolling forward', () => {
  // `new Date('2008-13-45')` rolls into the next year and renders confidently.
  assert.equal(formatReleaseDate('2008-13-02'), '2008');
  assert.equal(formatReleaseDate('2008-05-45'), 'May 2008');
});

test('a date that is not one answers nothing', () => {
  assert.equal(formatReleaseDate(undefined), null);
  assert.equal(formatReleaseDate('coming soon'), null);
  assert.equal(formatReleaseDate(''), null);
});

// --- ratings --------------------------------------------------------------

test('a percentage stays a percentage and a ten-point score stays a fraction', () => {
  // Rendering Rotten Tomatoes' 91% as "9.1/10" is a misquote, not a conversion.
  assert.equal(
    formatRating({ source: 'rottenTomatoes', value: 91, scaleMin: 0, scaleMax: 100 }),
    '91%'
  );
  assert.equal(
    formatRating({ source: MetadataSource.Cinemeta, value: 8.8, scaleMin: 0, scaleMax: 10 }),
    '8.8/10'
  );
});

test('a whole-number score does not gain a decimal point', () => {
  assert.equal(
    formatRating({ source: MetadataSource.Cinemeta, value: 9, scaleMin: 0, scaleMax: 10 }),
    '9/10'
  );
});

test('an unrated title renders nothing rather than nought out of ten', () => {
  assert.equal(
    formatRating({ source: MetadataSource.AniList, value: 0, scaleMin: 0, scaleMax: 100 }),
    null
  );
});

test('the source label is the name a viewer recognises', () => {
  // Cinemeta's rating *is* IMDb's; labelling the chip "cinemeta" names our
  // plumbing rather than the thing the number came from.
  assert.equal(sourceLabel('cinemeta'), 'IMDb');
  assert.equal(sourceLabel('anilist'), 'AniList');
  assert.equal(sourceLabel('something-new'), 'something-new');
});

test('vote counts shorten without losing their order of magnitude', () => {
  assert.equal(formatVotes(903_418), '903K');
  assert.equal(formatVotes(1_400_000), '1.4M');
  assert.equal(formatVotes(12), '12');
  assert.equal(formatVotes(0), null);
  assert.equal(formatVotes(undefined), null);
});

// --- money and runtime ----------------------------------------------------

test('money is rounded, because the underlying figures disagree by millions', () => {
  assert.equal(formatMoney(402_453_882), '$402M');
  assert.equal(formatMoney(2_923_706_026), '$2.92B');
  assert.equal(formatMoney(0), null);
  assert.equal(formatMoney(undefined), null);
});

test('a currency with no symbol is named rather than dropped', () => {
  assert.equal(formatMoney(50_000_000, 'JPY'), '50M JPY');
});

test('runtime reads as hours and minutes', () => {
  assert.equal(formatRuntimeMinutes(166), '2 h 46 min');
  assert.equal(formatRuntimeMinutes(120), '2 h');
  assert.equal(formatRuntimeMinutes(45), '45 min');
  assert.equal(formatRuntimeMinutes(0), null);
});

// --- credits --------------------------------------------------------------

test('voice credits stay with the cast', () => {
  // Splitting them out leaves an anime page with an empty "Cast" heading above
  // a populated "Voice" one, which reads as the lookup having failed.
  const { cast, crew } = groupCredits([
    person({ name: 'A', role: CreditRole.Cast }),
    person({ name: 'B', role: CreditRole.Voice }),
    person({ name: 'C', role: CreditRole.Crew, job: 'Director' }),
  ]);

  assert.deepEqual(cast.map((p) => p.name), ['A', 'B']);
  assert.deepEqual(crew.map((p) => p.name), ['C']);
});

test('both name pairs survive, independently', () => {
  const described = describeCredit(
    person({
      name: 'Sora Amamiya',
      originalName: '雨宮天',
      role: CreditRole.Voice,
      character: 'Aqua',
      characterOriginalName: 'アクア',
      voiceLanguage: 'Japanese',
    })
  );

  assert.equal(described.name, 'Sora Amamiya');
  assert.equal(described.secondaryName, '雨宮天');
  assert.equal(described.character, 'Aqua');
  assert.equal(described.characterSecondary, 'アクア');
  assert.equal(described.note, 'Japanese voice');
});

test('a native spelling identical to the display name is suppressed', () => {
  // "Tom Hardy (Tom Hardy)" is noise that hides the rows which genuinely differ.
  const described = describeCredit(person({ name: 'Tom Hardy', originalName: 'Tom Hardy' }));
  assert.equal(described.secondaryName, null);
});

test('an episode count is stated, so a guest is not read as a regular', () => {
  assert.equal(describeCredit(person({ name: 'A', episodeCount: 1 })).note, '1 ep');
  assert.equal(describeCredit(person({ name: 'A', episodeCount: 62 })).note, '62 eps');
});

// --- emptiness ------------------------------------------------------------

test('an empty record draws nothing at all', () => {
  // A "Cast" heading over a blank space reads as a failed lookup, which is the
  // one impression this feature must not leave on a title nothing knows about.
  assert.equal(hasAnything(null), false);
  assert.equal(
    hasAnything({ url: 'x', ids: {}, outcomes: [], fetchedAt: 0, people: [] }),
    false
  );
});

test('one populated field is enough to draw', () => {
  assert.equal(
    hasAnything({
      url: 'x',
      ids: {},
      outcomes: [],
      fetchedAt: 0,
      people: [person({ name: 'A' })],
    }),
    true
  );
  assert.equal(
    hasAnything({ url: 'x', ids: {}, outcomes: [], fetchedAt: 0, releaseDate: '2008' }),
    true
  );
});

test('failures and answers are read off the outcomes, not guessed', () => {
  const outcomes = [
    { source: MetadataSource.Cinemeta, status: 'ok' as const },
    { source: MetadataSource.Wikidata, status: 'failed' as const, reason: 'timed out' },
    // `empty` is not a failure: Wikidata genuinely has no entry for plenty of
    // titles, and reporting that as an error puts a red state on a page that is
    // simply about something obscure.
    { source: MetadataSource.TvMaze, status: 'empty' as const },
    { source: MetadataSource.AniList, status: 'skipped' as const },
  ];

  assert.deepEqual(failedSources(outcomes), ['Wikidata']);
  assert.deepEqual(answeringSources(outcomes), ['IMDb']);
});
