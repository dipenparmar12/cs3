/**
 * "More from this person": reading Wikidata and TVmaze answers into works.
 *
 *   node --experimental-strip-types electron/metadata/filmography.test.mts
 *
 * Pure parsers only — nothing here fetches. The live queries are exercised by
 * `tools/e2e/metadata-e2e.mjs`, which this file does not replace.
 */
import assert from 'node:assert/strict';
import {
  parseTvmazeCredits,
  parseWorks,
  posterForImdb,
  tvmazePersonIdFrom,
  wikidataIdFrom,
  workType,
} from './filmography.ts';

const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

const row = (fields: Record<string, string>) =>
  Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, { value }]));

test('ids are read from profile links and nothing else', () => {
  assert.equal(wikidataIdFrom('https://www.wikidata.org/wiki/Q9545711'), 'Q9545711');
  assert.equal(wikidataIdFrom('http://www.wikidata.org/entity/Q42'), 'Q42');
  assert.equal(wikidataIdFrom('https://en.wikipedia.org/wiki/Q42'), undefined);
  assert.equal(tvmazePersonIdFrom('https://www.tvmaze.com/people/14272/bryan-cranston'), '14272');
  assert.equal(tvmazePersonIdFrom('https://anilist.co/staff/95011'), undefined);
});

test('a film written and directed is one entry with both roles, newest first', () => {
  const works = parseWorks({
    results: {
      bindings: [
        row({ work: 'http://www.wikidata.org/entity/Q83495', workLabel: 'The Matrix', imdb: 'tt0133093', date: '1999-03-31T00:00:00Z', prop: 'http://www.wikidata.org/prop/direct/P57', typeLabel: 'film' }),
        row({ work: 'http://www.wikidata.org/entity/Q83495', workLabel: 'The Matrix', imdb: 'tt0133093', date: '1999-03-31T00:00:00Z', prop: 'http://www.wikidata.org/prop/direct/P58', typeLabel: 'film' }),
        row({ work: 'http://www.wikidata.org/entity/Q1', workLabel: 'Sense8', imdb: 'tt2431438', date: '2015-06-05T00:00:00Z', prop: 'http://www.wikidata.org/prop/direct/P170', typeLabel: 'television series' }),
      ],
    },
  });
  assert.deepEqual(works.map((w) => w.title), ['Sense8', 'The Matrix']);
  assert.deepEqual(works[1].roles, ['Directing', 'Writing']);
  assert.equal(works[0].type, 'series');
  assert.equal(works[1].posterUrl, 'https://images.metahub.space/poster/medium/tt0133093/img');
});

test('episodes and unlabelled items are not works', () => {
  const works = parseWorks({
    results: {
      bindings: [
        row({ work: 'http://www.wikidata.org/entity/Q2', workLabel: 'Pilot', imdb: 'tt1', prop: 'P57', typeLabel: 'television series episode' }),
        row({ work: 'http://www.wikidata.org/entity/Q3', workLabel: 'Q3', imdb: 'tt2', prop: 'P57', typeLabel: 'film' }),
      ],
    },
  });
  assert.equal(works.length, 0);
});

test('types read as movie or series', () => {
  assert.equal(workType('film'), 'movie');
  assert.equal(workType('animated feature film'), 'movie');
  assert.equal(workType('television series'), 'series');
  assert.equal(workType('miniseries'), 'series');
  assert.equal(workType('television series episode'), null);
});

test('TVmaze cast and crew credits merge per show', () => {
  const show = (name: string, imdb: string, premiered: string) => ({
    _embedded: { show: { name, premiered, externals: { imdb }, image: { medium: `${name}.jpg` } } },
  });
  const works = parseTvmazeCredits(
    [{ ...show('Breaking Bad', 'tt0903747', '2008-01-20'), _links: { character: { name: 'Walter White' } } }],
    [{ ...show('Breaking Bad', 'tt0903747', '2008-01-20'), type: 'Director' }, { ...show('Your Honor', 'tt9810526', '2020-12-06'), type: 'Executive Producer' }]
  );
  assert.deepEqual(works.map((w) => w.title), ['Your Honor', 'Breaking Bad']);
  assert.deepEqual(works[1].roles, ['Acting', 'Directing']);
  assert.equal(works[1].character, 'Walter White');
});

test('posters are only built from real IMDb ids', () => {
  assert.equal(posterForImdb('nm0000206'), undefined);
  assert.equal(posterForImdb(undefined), undefined);
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
