/**
 * The addresses the OTT catalogue hands out, and who can open them.
 *
 *   node --experimental-strip-types electron/cs3/ottCatalog.test.mts
 *
 * These rows are the whole content of every Streaming Services page, and the
 * only thing a viewer can do with one is open it. So the address is not a
 * detail of this module — it is the feature. It shipped for months spelled
 * `cs3meta://tt4154664`, which is not the grammar `parseCinemetaUrl` accepts
 * (`cs3meta://cinemeta/<movie|series>/<id>`), so every row on every platform
 * page fell past every branch of `ContentService.fetchDetail` and opened as
 * "Nothing knows how to open this address".
 *
 * Nothing caught it. The catalogue's own tests would have passed on any
 * string; the scheme's tests passed because the *builder* was always correct;
 * and `tsc` sees two `string`s. The only thing that could have caught it is
 * what is pinned here — the round trip, mint through parse, across the module
 * boundary the two halves live on either side of.
 *
 * Driven through the real `getCatalog` against a stubbed transport rather than
 * by reaching for the private mapper, because "the builder is used" is exactly
 * the property that broke, and a test that calls the builder itself asserts
 * the one thing that was never in doubt.
 */
import assert from 'node:assert/strict';
import { parseBareImdbUrl, parseCinemetaUrl } from '../cinemeta.ts';
import { setHttpFetch } from '../torrent/http.ts';
import { OttCatalogService } from './ottCatalog.ts';

const tests: Array<[string, () => Promise<void> | void]> = [];
const test = (name: string, fn: () => Promise<void> | void) => tests.push([name, fn]);

/** One Stremio `meta`, in the shape the Streaming Catalogs addon answers with. */
function meta(id: string, name: string) {
  return { id, imdb_id: id, name, poster: `https://p.example/${id}.jpg`, year: 2019 };
}

/**
 * Answers every catalogue request with the same two titles.
 *
 * The service asks for movies and series separately, so both arrive; which
 * request is which is read off the URL the same way the addon routes it.
 */
function stubAddon(): void {
  setHttpFetch(async (input) => {
    const url = String(input);
    const metas = url.includes('/series/')
      ? [meta('tt4154664', 'Captain Marvel: The Series')]
      : [meta('tt4154664', 'Captain Marvel')];
    return new Response(JSON.stringify({ metas }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
}

test('every row the catalogue mints parses as a Cinemeta address', async () => {
  stubAddon();
  const sections = await new OttCatalogService().getCatalog('netflix');
  const rows = sections.flatMap((section) => section.items);

  // Guard the guard: an empty catalogue would pass the loop below vacuously,
  // which is how this test would quietly stop testing anything.
  assert.ok(rows.length > 0, 'expected the stubbed addon to produce rows');

  for (const row of rows) {
    const parsed = parseCinemetaUrl(row.url);
    assert.ok(parsed, `ContentService cannot open ${row.url}`);
    assert.equal(parsed.imdbId, row.imdbId);
  }
});

test('the address records the type, so the row does not have to be probed for it', async () => {
  stubAddon();
  const sections = await new OttCatalogService().getCatalog('netflix');

  for (const section of sections) {
    // Sections are minted per type; the addresses in one must agree with it.
    const expected = section.id.endsWith(':series') ? 'series' : 'movie';
    for (const row of section.items) {
      assert.equal(parseCinemetaUrl(row.url)?.type, expected);
    }
  }
});

test('the typeless form saved by older builds is still recognised', () => {
  // Bookmarks, page snapshots and library rows written before the fix hold
  // this spelling; fixing the minting site does nothing for those.
  assert.equal(parseBareImdbUrl('cs3meta://tt4154664'), 'tt4154664');
  assert.equal(parseBareImdbUrl('cs3meta://tt4154664?s=1&e=2'), 'tt4154664');
});

test('the typeless form does not swallow an address that belongs to someone else', () => {
  // `parseBareImdbUrl` runs in `fetchDetail` ahead of the provider branch, so
  // anything it claims by accident stops reaching the provider that owns it.
  assert.equal(parseBareImdbUrl('cs3meta://cinemeta/movie/tt4154664'), null);
  assert.equal(parseBareImdbUrl('cs3meta://tvmaze/1234'), null);
  assert.equal(parseBareImdbUrl('cs3ext://SomeProvider/tt4154664'), null);
  assert.equal(parseBareImdbUrl('https://example.com/tt4154664'), null);
});

// --- runner -----------------------------------------------------------------

let failed = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failed++;
    console.log(`  FAIL ${name}`);
    console.log(`       ${error instanceof Error ? error.message : String(error)}`);
  }
}
console.log(failed === 0 ? `\n${tests.length} passed` : `\n${failed} of ${tests.length} FAILED`);
process.exit(failed === 0 ? 0 : 1);
