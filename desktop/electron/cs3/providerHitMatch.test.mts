/**
 * Which of a provider's search hits the widened search may open.
 *
 *   bun run test providerHitMatch
 *   node --experimental-strip-types electron/cs3/providerHitMatch.test.mts
 *
 * The labelled set the Playback Source Resolution PRD asks for (§6, §13.1),
 * one row per case it names: exact matches, regional titles, missing and
 * conflicting years, sequels, remakes, movie against series, seasons, the
 * trending fallback and missing metadata. Hit names are spelled the way
 * providers spell them (file names, brackets, dub tags).
 *
 * Two errors cost differently. A wrong film admitted is offered as a source and
 * plays the wrong thing; a right film refused is a source the viewer never
 * sees. So conflicts are `mismatch`, and anything this cannot read is
 * `unknown`, which is kept.
 */
import assert from 'node:assert/strict';
import { judgeProviderHit, type HitVerdict, type WantedWork } from './providerHitMatch.ts';
import { TvType } from '../../src/types/api.ts';

const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

type Hit = Parameters<typeof judgeProviderHit>[1];

function kind(wanted: WantedWork, hit: Hit): HitVerdict['kind'] {
  return judgeProviderHit(wanted, hit).kind;
}

const film = (title: string, year?: number): WantedWork => ({ title, year, type: TvType.Movie });
const show = (title: string, season?: number, year?: number): WantedWork => ({
  title,
  season,
  year,
  type: TvType.TvSeries,
});

// --- exact and alternate titles --------------------------------------------

test('the same film under a release name is a match', () => {
  assert.equal(kind(film('Dune: Part Two', 2024), { name: 'Dune Part Two (2024) [Hindi-English] 720p' }), 'match');
  assert.equal(kind(film('The Little Prince', 2015), { name: 'Little Prince', year: 2015 }), 'match');
  assert.equal(kind(film('Avengers: Endgame', 2019), { name: 'Avengers Endgame 720p Hindi Dubbed' }), 'match');
});

test('numbers spelled either way are one title', () => {
  assert.equal(kind(film("Ocean's 8", 2018), { name: "Ocean's Eight (2018)" }), 'match');
  assert.equal(kind(film('Rocky II', 1979), { name: 'Rocky 2', year: 1979 }), 'match');
});

test('an original title the provider also sends is read', () => {
  assert.equal(
    kind(film('Spirited Away', 2001), { name: 'Sen to Chihiro no Kamikakushi', originalTitle: 'Spirited Away', year: 2001 }),
    'match'
  );
});

test('a shortened title is the same work only when the year says so', () => {
  const wanted = film('Spider-Man: Into the Spider-Verse', 2018);
  assert.equal(kind(wanted, { name: 'Into the Spider-Verse', year: 2018 }), 'match');
  assert.equal(kind(film('Avengers'), { name: 'Avengers: Endgame' }), 'mismatch');
});

test('a matching IMDb id decides, either way', () => {
  const wanted = { ...film('Dune', 2021), imdbId: 'tt1160419' };
  assert.equal(judgeProviderHit(wanted, { name: 'Doon', imdbId: 'tt1160419' }).kind, 'match');
  assert.equal(judgeProviderHit(wanted, { name: 'Dune', imdbId: 'tt0087182' }).kind, 'mismatch');
});

// --- years, remakes and sequels --------------------------------------------

test('a remake under the same title is told apart by its year', () => {
  assert.equal(kind(film('Dune', 2021), { name: 'Dune (1984)' }), 'mismatch');
  assert.equal(kind(film('Dune', 2021), { name: 'Dune', year: 2022 }), 'match', 'a year either side is release drift');
});

test('a missing year on either side does not refuse a matching title', () => {
  assert.equal(kind(film('Dune'), { name: 'Dune (2021)' }), 'match');
  assert.equal(kind(film('Dune', 2021), { name: 'Dune' }), 'match');
});

test('a sequel is another work, however close the words', () => {
  assert.equal(kind(film('Toy Story', 1995), { name: 'Toy Story 2' }), 'mismatch');
  assert.equal(kind(film('Charlie'), { name: 'Charlie 2' }), 'mismatch');
  assert.equal(kind(film('Dune', 2021), { name: 'Dune: Part Two' }), 'mismatch');
  // A number in the title that cannot be a release year is the title's own.
  assert.equal(kind(film('Blade Runner', 1982), { name: 'Blade Runner 2049' }), 'mismatch');
  assert.equal(kind(film('Blade Runner 2049', 2017), { name: 'Blade.Runner.2049.2017.1080p' }), 'match');
  assert.equal(kind(film('Blade Runner', 1982), { name: 'Blade Runner 1982 Final Cut' }), 'match');
  assert.equal(
    kind(film('Mission: Impossible - Dead Reckoning Part One'), { name: 'Mission Impossible Dead Reckoning Part Two' }),
    'mismatch'
  );
});

// --- form and seasons ------------------------------------------------------

test('a series is not the film of the same name', () => {
  assert.equal(kind(film('Fargo', 1996), { name: 'Fargo', type: TvType.TvSeries }), 'mismatch');
});

test('another season page is refused, the right one kept', () => {
  assert.equal(kind(show('Mirzapur', 3), { name: 'Mirzapur Season 2 (2020) Hindi', type: TvType.TvSeries }), 'mismatch');
  assert.equal(kind(show('Mirzapur', 3), { name: 'Mirzapur Season 3 (2024) Hindi', type: TvType.TvSeries }), 'match');
  assert.equal(kind(show('Mirzapur', 3), { name: 'Mirzapur', type: TvType.TvSeries }), 'match', 'a page for the whole show');
});

test("a series page's year is the season's, not the show's", () => {
  assert.equal(kind(show('Stranger Things', 4, 2016), { name: 'Stranger Things (2022)', type: TvType.TvSeries }), 'match');
});

// --- the trending fallback ---------------------------------------------------

test('a provider answering with its home page is refused', () => {
  // What a provider without the title sends back: whatever it is promoting.
  const wanted = film('The Little Prince', 2015);
  for (const name of ['Pushpa 2: The Rule (2024)', 'Stree 2', 'Deadpool & Wolverine 2024 1080p']) {
    assert.equal(kind(wanted, { name }), 'mismatch', name);
  }
});

// --- what cannot be judged is kept -----------------------------------------

test('a title in another script is kept, not refused', () => {
  assert.equal(kind(film('Dangal', 2016), { name: 'दंगल' }), 'unknown');
});

test('anime under romaji is kept, not refused', () => {
  const wanted: WantedWork = { title: 'Demon Slayer', type: TvType.Anime, season: 1 };
  assert.equal(kind(wanted, { name: 'Kimetsu no Yaiba', type: TvType.Anime }), 'unknown');
  assert.equal(kind(wanted, { name: 'Kimetsu no Yaiba Season 2', type: TvType.Anime }), 'mismatch', 'a season still decides');
});

test('a hit with no name is kept', () => {
  assert.equal(kind(film('Dune', 2021), { name: '' }), 'unknown');
});

// --- runner ----------------------------------------------------------------

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failed++;
    console.error(`  FAIL ${name}`);
    console.error(`       ${error instanceof Error ? error.message : String(error)}`);
  }
}
console.log(`\n${tests.length - failed} passed${failed ? `, ${failed} failed` : ''}`);
if (failed) process.exit(1);
