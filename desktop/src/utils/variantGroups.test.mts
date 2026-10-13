/**
 * Release variants grouped into one card — and only release variants.
 *
 *   node --experimental-strip-types src/utils/variantGroups.test.mts
 *
 * The failure that matters is the over-merge: two different works, seasons or
 * cuts drawn as one card hides a choice the viewer can no longer see. Every
 * "kept apart" case below is one of those.
 */
import assert from 'node:assert/strict';
import { coreTitle, groupVariants, variantSummary } from './variantGroups.ts';
import type { SearchResponse } from '../types/api.ts';

const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

let n = 0;
const row = (name: string, overrides: Partial<SearchResponse> = {}): SearchResponse => ({
  name,
  url: `cs3ext://Provider/${++n}`,
  apiName: 'Provider',
  type: 'Movie' as SearchResponse['type'],
  ...overrides,
});

test('one provider listing four encodes of a film is one card with four variants', () => {
  const cards = groupVariants([
    row('Mean Girls (2024) 1080p English WEB-DL'),
    row('Mean Girls (2024) 720p English WEB-DL'),
    row('Mean Girls (2024) 720p Hindi'),
    row('Mean Girls 2024 480p Hindi Dubbed'),
  ]);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].variants.length, 4);
  assert.equal(cards[0].title, 'Mean Girls');
  assert.equal(variantSummary(cards[0]), '1080p · 720p · 480p · English +1');
  assert.equal(cards[0].variants[2].label, '720p · Hindi');
});

test('every original row survives, primary first, in arrival order', () => {
  const input = [row('Dune 2021 1080p'), row('Other Film 2020'), row('Dune 2021 720p')];
  const cards = groupVariants(input);
  assert.deepEqual(cards.map((card) => card.primary.name), ['Dune 2021 1080p', 'Other Film 2020']);
  assert.deepEqual(cards[0].variants.map((v) => v.item), [input[0], input[2]]);
});

test('different providers are never grouped here', () => {
  const cards = groupVariants([row('Dune 2021 1080p'), row('Dune 2021 720p', { apiName: 'Elsewhere' })]);
  assert.equal(cards.length, 2);
});

test('different seasons are different content, not variants', () => {
  const cards = groupVariants([
    row('The Boys S01 1080p', { type: 'TvSeries' as SearchResponse['type'] }),
    row('The Boys S02 1080p', { type: 'TvSeries' as SearchResponse['type'] }),
    row('The Boys Season 1 720p', { type: 'TvSeries' as SearchResponse['type'] }),
  ]);
  assert.equal(cards.length, 2);
  assert.equal(cards[0].variants.length, 2, 'S01 and "Season 1" are the same season');
});

test('different years stay apart (Dune 1984 vs Dune 2021)', () => {
  assert.equal(groupVariants([row('Dune 1984 720p'), row('Dune 2021 720p')]).length, 2);
});

test('a different cut is a different card', () => {
  const cards = groupVariants([row('Avatar 2009 Extended Cut 1080p'), row('Avatar 2009 1080p')]);
  assert.equal(cards.length, 2);
});

test('different content types stay apart', () => {
  const cards = groupVariants([row('Fargo 1080p'), row('Fargo 720p', { type: 'TvSeries' as SearchResponse['type'] })]);
  assert.equal(cards.length, 2);
});

test('plain duplicates collapse and say they are identical', () => {
  const cards = groupVariants([row('Heat 1995 1080p'), row('Heat 1995 1080p')]);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].identical, true);
});

test('franchise siblings are never one card', () => {
  const cards = groupVariants([row('Spider-Man 2002 1080p'), row('Spider-Man 2 2004 1080p'), row('Spider-Man 3 2007 1080p')]);
  assert.equal(cards.length, 3);
});

test('magnets are left to the source picker', () => {
  const cards = groupVariants([
    row('Dune 2021 1080p', { url: 'magnet:?xt=urn:btih:a' }),
    row('Dune 2021 720p', { url: 'magnet:?xt=urn:btih:b' }),
  ]);
  assert.equal(cards.length, 2);
});

test('the core title strips file tokens only', () => {
  assert.equal(coreTitle('Avengers.Endgame.2019.1080p.BluRay.x264-GROUP'), 'avengers endgame group');
  assert.equal(coreTitle('Mean Girls [Hindi + English] 720p WEB-DL 1.2GB'), 'mean girls');
  assert.equal(coreTitle('A Proper Violence 720p'), 'a proper violence');
});

test('a missing poster is borrowed from a variant that has one', () => {
  const cards = groupVariants([row('Heat 1995 1080p'), row('Heat 1995 720p', { posterUrl: 'p.jpg' })]);
  assert.equal(cards[0].primary.posterUrl, 'p.jpg');
});

test('enriched rows are grouped and described by the release name they were listed under', () => {
  // useTitleEnrichment renames all four to the work and keeps the file name.
  const cards = groupVariants([
    row('The Matrix', { year: 1999, originalTitle: 'The Matrix (1999) 1080p English BluRay' }),
    row('The Matrix', { year: 1999, originalTitle: 'The Matrix (1999) 720p Hindi Dubbed' }),
  ]);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].identical, false);
  assert.deepEqual(cards[0].variants.map((v) => v.label), ['1080p · English · BluRay', '720p · Hindi']);
  assert.equal(cards[0].title, 'The Matrix');
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
