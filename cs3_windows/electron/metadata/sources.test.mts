import { test } from 'node:test';
import assert from 'node:assert/strict';

import { setHttpFetch } from '../torrent/http.ts';
import { parseCredits, parseFacts, commonsThumbnail, entityPageUrl, fetchWikidata } from './wikidata.ts';
import { parseCast, parseCrew, lookupByImdb } from './tvmaze.ts';
import { parseAniList, aniListDate } from './anilist.ts';
import { parseCinemetaExtras, asList, splitAwards, parseImdbRating } from './cinemetaExtras.ts';
import { articleTitleFromUrl, buildNotes, parseSections, truncateAtSentence } from './wikipedia.ts';
import { CreditRole, MetadataSource } from '../../src/types/metadata.ts';

/**
 * The source adapters: their parsers, and the two failure rules.
 *
 * ## What these fixtures are, stated plainly
 *
 * They are **hand-built from each API's documented response shape, not captured
 * from a live host.** Every other adapter in this repository was measured — the
 * Internet Archive query form, the DASH manifest rewriting, the AC-3 decode
 * counters — and these could not be, because the container this was written in
 * denies every third-party host at the proxy. So these tests pin the parsing
 * logic, which is real and worth pinning, and they do *not* prove that the
 * queries ask for the right things. `tools/e2e/metadata-e2e.mjs` is what proves
 * that, and it has to be run by a person on an ordinary network.
 *
 * ## The two rules that are not about parsing
 *
 * Both came out of running that harness for the first time, and both are the
 * same defect: **a catch that turns a transport failure into "nothing found".**
 * This repository has undone that mistake repeatedly — `probeUrl`'s
 * `res.resume()`, `BinarySetupModal` rendering a rejection as a friendly
 * notice, `ensureProvidersLoaded` returning silently — and it arrived here
 * twice in one afternoon.
 *
 * It matters more here than it looks, because `MetadataSourceOutcome` draws its
 * whole diagnostic value from telling `empty` apart from `failed`. A source
 * that swallows its errors reports a dead host to the viewer as "this title has
 * no cast recorded", and nothing anywhere names the real cause.
 */

/** Installs a transport that answers each URL from a table. Returns a restore. */
function stubFetch(handler: (url: string) => { status: number; body?: unknown }) {
  setHttpFetch(async (input: string) => {
    const { status, body } = handler(input);
    return new Response(body === undefined ? '' : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  });
  return () => setHttpFetch((input, init) => fetch(input, init));
}

// --- the failure rules ----------------------------------------------------

test('TVmaze: a 404 is "not in the catalogue"', async () => {
  // The ordinary answer for every film. This one really is a null.
  const restore = stubFetch(() => ({ status: 404 }));
  try {
    assert.equal(await lookupByImdb('tt1160419'), null);
  } finally {
    restore();
  }
});

test('TVmaze: a 403 is raised, not reported as "not in the catalogue"', async () => {
  // Caught by the e2e harness, which reported *Breaking Bad* — one of the
  // best-covered series TVmaze holds — as absent while the host answered 403.
  const restore = stubFetch(() => ({ status: 403 }));
  try {
    await assert.rejects(() => lookupByImdb('tt0903747'));
  } finally {
    restore();
  }
});

test('Wikidata: both queries failing is raised, not an empty result', async () => {
  // Returning `{credits: [], facts: null}` here makes an unreachable endpoint
  // indistinguishable from a film Wikidata has never heard of — and the outcome
  // then always says `empty`, which is the one thing it must not say.
  const restore = stubFetch(() => ({ status: 403 }));
  try {
    await assert.rejects(() => fetchWikidata('tt1160419'));
  } finally {
    restore();
  }
});

test('Wikidata: one query failing still returns the other', async () => {
  // A partial answer is a real answer, and the cast list is the half the viewer
  // asked for — a slow facts query must never cost it.
  const restore = stubFetch((url) =>
    url.includes('P161')
      ? {
          status: 200,
          body: {
            results: {
              bindings: [
                {
                  person: { value: 'http://www.wikidata.org/entity/Q38111' },
                  personLabel: { value: 'Leonardo DiCaprio' },
                  job: { value: 'cast' },
                  characterLabel: { value: 'Dom Cobb' },
                },
              ],
            },
          },
        }
      : { status: 500 }
  );
  try {
    const result = await fetchWikidata('tt1375666');
    assert.equal(result.credits.length, 1);
    assert.equal(result.facts, null);
  } finally {
    restore();
  }
});

test('Wikidata: an id that is not an IMDb id never reaches the endpoint', async () => {
  // It is interpolated into a SPARQL string literal, so this is a guard rather
  // than a validation nicety.
  await assert.rejects(() => fetchWikidata("tt1' } UNION { ?x ?y ?z . #"));
});

// --- Wikidata parsing -----------------------------------------------------

const wikidataRow = (over: Record<string, string>) =>
  Object.fromEntries(Object.entries(over).map(([k, v]) => [k, { value: v }]));

test('a cast statement becomes a performer with their character', () => {
  const credits = parseCredits({
    results: {
      bindings: [
        wikidataRow({
          person: 'http://www.wikidata.org/entity/Q38111',
          personLabel: 'Leonardo DiCaprio',
          job: 'cast',
          characterLabel: 'Dom Cobb',
          order: '1',
          image: 'http://commons.wikimedia.org/wiki/Special:FilePath/Leo.jpg',
        }),
      ],
    },
  });

  assert.equal(credits.length, 1);
  assert.equal(credits[0].role, CreditRole.Cast);
  assert.equal(credits[0].character, 'Dom Cobb');
  assert.equal(credits[0].order, 1);
  assert.equal(credits[0].profileUrl, 'https://www.wikidata.org/wiki/Q38111');
  assert.deepEqual(credits[0].sources, [MetadataSource.Wikidata]);
});

test('a crew property becomes a job, classified into a department', () => {
  const credits = parseCredits({
    results: {
      bindings: [
        wikidataRow({
          person: 'http://www.wikidata.org/entity/Q25191',
          personLabel: 'Christopher Nolan',
          job: 'Director',
        }),
      ],
    },
  });

  assert.equal(credits[0].role, CreditRole.Crew);
  assert.equal(credits[0].job, 'Director');
  assert.equal(credits[0].department, 'directing');
  assert.equal(credits[0].character, undefined);
});

test('the label service echoing an entity id back is dropped, not rendered', () => {
  // Wikidata answers `Q38111` as the label when it holds none in the requested
  // language. Putting that on screen reads as data corruption.
  const credits = parseCredits({
    results: { bindings: [wikidataRow({ personLabel: 'Q38111', job: 'cast' })] },
  });
  assert.deepEqual(credits, []);
});

test('an unlabelled character falls back to the monolingual qualifier', () => {
  const credits = parseCredits({
    results: {
      bindings: [
        wikidataRow({
          personLabel: 'Some Actor',
          job: 'cast',
          characterLabel: 'Q999999',
          characterName: 'Villager #3',
        }),
      ],
    },
  });
  assert.equal(credits[0].character, 'Villager #3');
});

test('a Commons image is requested at a width, and over https', () => {
  // The raw file is the original upload — routinely megabytes for a headshot
  // drawn at 96 pixels, and this module returns up to sixty of them.
  const url = commonsThumbnail('http://commons.wikimedia.org/wiki/Special:FilePath/Leo.jpg');
  assert.ok(url?.startsWith('https://'));
  assert.ok(url?.includes('width='));
});

test('a non-Commons image is left alone but still made https', () => {
  assert.equal(commonsThumbnail('http://example.org/a.jpg'), 'https://example.org/a.jpg');
  assert.equal(commonsThumbnail(undefined), undefined);
});

test('entity URLs become pages a person can open', () => {
  assert.equal(
    entityPageUrl('http://www.wikidata.org/entity/Q25188'),
    'https://www.wikidata.org/wiki/Q25188'
  );
  assert.equal(entityPageUrl('not a uri'), undefined);
});

test('grouped facts split back into lists, and a timestamp cuts to a date', () => {
  const facts = parseFacts({
    results: {
      bindings: [
        wikidataRow({
          item: 'http://www.wikidata.org/entity/Q25188',
          date: '2021-10-22T00:00:00Z',
          boxOffice: '402453882',
          countries: 'United States|Canada',
          awards: 'Academy Award for Best Sound|Q999',
          article: 'https://en.wikipedia.org/wiki/Dune_(2021_film)',
        }),
      ],
    },
  });

  assert.equal(facts?.releaseDate, '2021-10-22');
  assert.equal(facts?.revenue, 402_453_882);
  assert.deepEqual(facts?.countries, ['United States', 'Canada']);
  // An unlabelled entity in a concat is dropped rather than shown as "Q999".
  assert.deepEqual(facts?.awards, ['Academy Award for Best Sound']);
  assert.equal(facts?.wikipediaUrl, 'https://en.wikipedia.org/wiki/Dune_(2021_film)');
});

test('no rows is no facts, rather than a record full of undefined', () => {
  assert.equal(parseFacts({ results: { bindings: [] } }), null);
  assert.equal(parseFacts({}), null);
});

// --- TVmaze parsing -------------------------------------------------------

test('TVmaze cast carries the character, both images, and its billing order', () => {
  const cast = parseCast([
    {
      person: { name: 'Bryan Cranston', url: 'https://tvmaze/p/1', image: { medium: 'p.jpg' } },
      character: { name: 'Walter White', image: { medium: 'c.jpg' } },
    },
    { person: { name: 'Aaron Paul' }, character: { name: 'Jesse Pinkman' } },
  ]);

  assert.equal(cast[0].character, 'Walter White');
  assert.equal(cast[0].imageUrl, 'p.jpg');
  assert.equal(cast[0].characterImageUrl, 'c.jpg');
  // TVmaze publishes no ordinal, so the position *is* the order — which is what
  // lets Wikidata's unordered set merge in without scrambling the list.
  assert.deepEqual(cast.map((p) => p.order), [0, 1]);
});

test('someone appearing as themselves is not credited as playing themselves', () => {
  // "Stephen Colbert as Stephen Colbert" reads as a bug in the app.
  const cast = parseCast([
    { person: { name: 'Stephen Colbert' }, character: { name: 'Stephen Colbert' }, self: true },
  ]);
  assert.equal(cast[0].character, undefined);
});

test('a voice credit is a voice credit, not an on-screen appearance', () => {
  const cast = parseCast([
    { person: { name: 'Hank Azaria' }, character: { name: 'Moe' }, voice: true },
  ]);
  assert.equal(cast[0].role, CreditRole.Voice);
});

test('TVmaze crew keeps the site\'s own job wording', () => {
  const crew = parseCrew([{ type: 'Executive Producer', person: { name: 'Vince Gilligan' } }]);
  assert.equal(crew[0].job, 'Executive Producer');
  assert.equal(crew[0].department, 'production');
});

test('a malformed reply is an empty list, not a crash', () => {
  assert.deepEqual(parseCast(null as never), []);
  assert.deepEqual(parseCrew(undefined as never), []);
  assert.deepEqual(parseCast([{ character: { name: 'Nobody' } }]), []);
});

// --- AniList parsing ------------------------------------------------------

test('a character and its voice actor keep two independent name pairs', () => {
  const parsed = parseAniList({
    id: 21,
    characters: {
      edges: [
        {
          role: 'MAIN',
          node: { name: { full: 'Aqua', native: 'アクア' }, image: { large: 'char.jpg' } },
          voiceActors: [
            {
              name: { full: 'Sora Amamiya', native: '雨宮天' },
              image: { large: 'va.jpg' },
              languageV2: 'Japanese',
            },
          ],
        },
      ],
    },
  });

  const credit = parsed.people[0];
  assert.equal(credit.role, CreditRole.Voice);
  assert.equal(credit.name, 'Sora Amamiya');
  assert.equal(credit.originalName, '雨宮天');
  assert.equal(credit.character, 'Aqua');
  assert.equal(credit.characterOriginalName, 'アクア');
  assert.equal(credit.voiceLanguage, 'Japanese');
});

test('every language of voice actor comes back, not just one', () => {
  // Filtering to Japanese loses the dub cast a dub viewer wants; filtering to
  // English loses the original performance. The UI chooses, not the adapter.
  const parsed = parseAniList({
    characters: {
      edges: [
        {
          role: 'MAIN',
          node: { name: { full: 'Luffy' } },
          voiceActors: [
            { name: { full: 'Mayumi Tanaka' }, languageV2: 'Japanese' },
            { name: { full: 'Colleen Clinkenbeard' }, languageV2: 'English' },
          ],
        },
      ],
    },
  });
  assert.equal(parsed.people.length, 2);
});

test('a character with no recorded voice actor is still listed', () => {
  // An anime cast list that silently drops half its characters reads as a
  // scraping failure rather than as a gap in the database.
  const parsed = parseAniList({
    characters: { edges: [{ role: 'MAIN', node: { name: { full: 'Nameless' } }, voiceActors: [] }] },
  });
  assert.equal(parsed.people.length, 1);
  assert.equal(parsed.people[0].name, 'Nameless');
  assert.equal(parsed.people[0].character, undefined);
});

test('main characters sort above supporting ones', () => {
  const parsed = parseAniList({
    characters: {
      edges: [
        { role: 'SUPPORTING', node: { name: { full: 'B' } }, voiceActors: [] },
        { role: 'MAIN', node: { name: { full: 'A' } }, voiceActors: [] },
      ],
    },
  });
  const a = parsed.people.find((p) => p.name === 'A');
  const b = parsed.people.find((p) => p.name === 'B');
  assert.ok((a?.order ?? 0) < (b?.order ?? 0));
});

test('spoiler tags never reach the page', () => {
  // The one piece of metadata that can actively ruin what the viewer came for.
  const parsed = parseAniList({
    tags: [
      { name: 'Shounen', rank: 90 },
      { name: 'Character Death', rank: 80, isMediaSpoiler: true },
      { name: 'Twist', rank: 70, isGeneralSpoiler: true },
    ],
  });
  assert.deepEqual(parsed.keywords, ['Shounen']);
});

test('only the main studio is a studio', () => {
  const parsed = parseAniList({
    studios: {
      edges: [
        { isMain: true, node: { name: 'Toei Animation' } },
        { isMain: false, node: { name: 'Some Licensor' } },
      ],
    },
  });
  assert.deepEqual(parsed.studios.map((s) => s.name), ['Toei Animation']);
});

test('a partial AniList date is not completed into a precise one', () => {
  // Composing `2024-null-null` into `2024-01-01` invents a debut date, and
  // nothing downstream could tell it was a guess.
  assert.equal(aniListDate({ year: 1999, month: 10, day: 20 }), '1999-10-20');
  assert.equal(aniListDate({ year: 1999, month: 10 }), '1999-10');
  assert.equal(aniListDate({ year: 1999 }), '1999');
  assert.equal(aniListDate({}), undefined);
  assert.equal(aniListDate(undefined), undefined);
});

test('an unrated AniList title still records its published zero', () => {
  // Stored as published; `normalisedRating` is what answers null at the floor.
  const parsed = parseAniList({ averageScore: 0 });
  assert.equal(parsed.ratings[0].value, 0);
  assert.equal(parsed.ratings[0].scaleMax, 100);
});

// --- Cinemeta parsing -----------------------------------------------------

test('a single-valued field arriving as a string is not spread into letters', () => {
  // `[...'Denis']` is the silent failure this prevents.
  assert.deepEqual(asList('Denis Villeneuve'), ['Denis Villeneuve']);
  assert.deepEqual(asList(['A', 'B']), ['A', 'B']);
  assert.deepEqual(asList('A, B'), ['A', 'B']);
  assert.deepEqual(asList(undefined), []);
});

test('awards split into claims without parsing counts out of them', () => {
  assert.deepEqual(splitAwards('Won 6 Oscars. 171 wins & 286 nominations total.'), [
    'Won 6 Oscars',
    '171 wins & 286 nominations total',
  ]);
  assert.deepEqual(splitAwards('N/A'), []);
  assert.deepEqual(splitAwards(undefined), []);
});

test('an "N/A" rating is nothing rather than NaN', () => {
  // NaN compares false against everything, so an unguarded one survives every
  // sanity check downstream and renders as an empty badge.
  assert.equal(parseImdbRating('N/A', 'tt1'), null);
  assert.equal(parseImdbRating(undefined, 'tt1'), null);
  assert.equal(parseImdbRating('8.8', 'tt1')?.value, 8.8);
});

test('Cinemeta cast and crew come back with billing order and jobs', () => {
  const extras = parseCinemetaExtras({
    imdb_id: 'tt1160419',
    cast: ['Timothée Chalamet', 'Rebecca Ferguson'],
    director: ['Denis Villeneuve'],
    writer: 'Jon Spaihts',
    imdbRating: '8.0',
    released: '2021-10-22T00:00:00.000Z',
    country: 'United States',
    trailerStreams: [{ title: 'Trailer', ytId: 'abc' }],
  });

  assert.deepEqual(extras.people.filter((p) => p.role === CreditRole.Cast).map((p) => p.order), [0, 1]);
  assert.equal(extras.people.find((p) => p.job === 'Director')?.name, 'Denis Villeneuve');
  assert.equal(extras.people.find((p) => p.job === 'Writer')?.name, 'Jon Spaihts');
  // The debut date, which is what `releaseInfo`'s bare year cannot answer.
  assert.equal(extras.releaseDate, '2021-10-22');
  assert.equal(extras.videos[0].url, 'https://www.youtube.com/watch?v=abc');
  assert.equal(extras.ratings[0].url, 'https://www.imdb.com/title/tt1160419/');
});

test('Cinemeta credits carry no character and no photo, deliberately', () => {
  // It has neither, and inventing a placeholder would make the merge think the
  // richer sources had nothing to add.
  const extras = parseCinemetaExtras({ cast: ['Somebody'] });
  assert.equal(extras.people[0].character, undefined);
  assert.equal(extras.people[0].imageUrl, undefined);
});

// --- Wikipedia parsing ----------------------------------------------------

test('an article is only ever taken from a sitelink-shaped URL', () => {
  assert.equal(articleTitleFromUrl('https://en.wikipedia.org/wiki/Dune_(2021_film)'), 'Dune (2021 film)');
  assert.equal(articleTitleFromUrl('https://example.org/Dune'), null);
  assert.equal(articleTitleFromUrl(undefined), null);
  // A mangled escape resolves to a *different* article rather than to nothing,
  // so it is refused instead of repaired.
  assert.equal(articleTitleFromUrl('https://en.wikipedia.org/wiki/%E0%A4'), null);
});

test('only production and context sections are kept', () => {
  const sections = parseSections(
    'Lead.\n\n== Plot ==\nSpoilers.\n\n== Filming ==\nShot in Budapest.\n\n== Reception ==\nMixed.\n\n== Legacy ==\nInfluential.'
  );
  const notes = buildNotes(sections, 'https://en.wikipedia.org/wiki/X');

  assert.deepEqual(notes.production.map((n) => n.heading), ['Filming']);
  assert.deepEqual(notes.trivia.map((n) => n.heading), ['Legacy']);
  // Plot is a spoiler and Reception is an opinion the ratings already carry.
  assert.ok(!notes.production.some((n) => /plot|reception/i.test(n.heading)));
});

test('every note carries its licence and a link to the exact section', () => {
  // CC BY-SA requires it, and an attribution the UI can forget to render is one
  // it will eventually forget to render — so it is a required field.
  const notes = buildNotes(
    parseSections('== Production ==\nSomething happened.'),
    'https://en.wikipedia.org/wiki/X'
  );
  assert.equal(notes.production[0].attribution.licence, 'CC BY-SA 4.0');
  assert.equal(notes.production[0].attribution.url, 'https://en.wikipedia.org/wiki/X#Production');
  assert.equal(notes.production[0].attribution.source, MetadataSource.Wikipedia);
});

test('long prose is cut at a sentence, with an ellipsis that earns the link', () => {
  const text = `${'Sentence one is here. '.repeat(80)}End.`;
  const cut = truncateAtSentence(text, 200);
  assert.ok(cut.length <= 210);
  assert.ok(cut.endsWith('…'));
  assert.ok(!/\w…$/.test(cut), 'a mid-word cut reads as a corrupted download');
});

test('prose shorter than the budget is left exactly alone', () => {
  assert.equal(truncateAtSentence('Short.', 200), 'Short.');
});

test('one person with several Commons photos is one credit, not several rows', () => {
  // `OPTIONAL { ?person wdt:P18 ?image }` multiplies the row out per image. The
  // cap is applied in the parser, so without a dedupe the tail of a long cast
  // list is silently dropped to make room for repeats of its head.
  const row = (image: string) =>
    wikidataRow({
      person: 'http://www.wikidata.org/entity/Q38111',
      personLabel: 'Leonardo DiCaprio',
      job: 'cast',
      characterLabel: 'Dom Cobb',
      image,
    });

  const credits = parseCredits({
    results: { bindings: [row('a.jpg'), row('b.jpg'), row('c.jpg')] },
  });

  assert.equal(credits.length, 1);
});

test('two genuinely different people are not deduplicated by their label', () => {
  const credits = parseCredits({
    results: {
      bindings: [
        wikidataRow({ person: 'http://www.wikidata.org/entity/Q1', personLabel: 'John Williams', job: 'cast', characterLabel: 'Mr Grant' }),
        wikidataRow({ person: 'http://www.wikidata.org/entity/Q2', personLabel: 'John Williams', job: 'Composer' }),
      ],
    },
  });
  assert.equal(credits.length, 2);
});
