import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildExtensionUrl,
  looksLikeLinksHandle,
  looksLikePageAddress,
  parseExtensionUrl,
} from './extensionAddress.ts';

/**
 * The two kinds of handle a `cs3ext://` address can carry, and why telling them
 * apart is worth a test.
 *
 * Every case below is a real handle taken from a user's captured diagnostics on
 * 2026-08-27. Passing one of them to `load()` produced
 * `IllegalArgumentException: Expected URL scheme 'http' or 'https' but no scheme
 * was found for [{"sou…` — the most frequent failure in that session. It was
 * recorded at stage `detail`, scored against the provider by the ranking, and
 * shown to the viewer as the reason the title would not play. The provider had
 * done nothing wrong.
 *
 * It reached `load()` from three directions, which is why this is a shared
 * predicate rather than three local checks:
 *
 *   1. `ContentService.resolveExtensionTarget` looked up an episode list for any
 *      address with an episode number — including one that already *was* the
 *      episode, which is what Continue Watching hands over.
 *   2. `ContentService.extensionSources` retried through `dataUrl` whenever the
 *      first attempt found no links, without asking whether the address it had
 *      could be opened at all — and did not catch the throw, so OkHttp's message
 *      replaced the real diagnosis on screen.
 *   3. `DetailView` was handed a playback handle as an item URL, because
 *      `progress.mediaUrl` had been recorded as the episode's handle rather than
 *      the page. That one is the "a title I saved now opens blank" report.
 */

// --- real handles, from the corpus ------------------------------------------

/** VegaMovies encodes its sources as a JSON array of objects. */
const VEGAMOVIES_LINKS =
  '[{"source":"https://vcloud.fit/ubvtmxgdjbx1xxu"},{"source":"https://vcloud.fit/ifbzxafuk6cpwbv"},{"source":"https://vcloud.fit/4k554ns1hwz4zih"}]';

/** HDHub4U encodes its sources as a JSON array of bare strings. */
const HDHUB4U_LINKS =
  '["https://greenmountmotors.com/?id=THdEbjN6MnNRSnU0TXJEK1BZRExXRGQzdXI3aXo4Sm5oQkV1NnYxdHZpSlRtOU5wQUlpQ3AxakU0SFFzb1dVUlNVSW5KaUFxV3c0L29ENEk1dlh1cGJJVjlSekdNQXBpd2k3SWcrNFRucDg9","https://hubstream.art/#mlvoou"]';

test('a JSON array of objects is a links handle, not a page', () => {
  assert.equal(looksLikeLinksHandle(VEGAMOVIES_LINKS), true);
});

test('a JSON array of strings is a links handle, not a page', () => {
  assert.equal(looksLikeLinksHandle(HDHUB4U_LINKS), true);
});

test('a JSON object is a links handle', () => {
  assert.equal(looksLikeLinksHandle('{"id":"abc","server":2}'), true);
});

test('leading whitespace does not disguise one', () => {
  assert.equal(looksLikeLinksHandle('  [{"source":"https://x.test/a"}]'), true);
});

// --- what must NOT be refused ------------------------------------------------

test('an ordinary page address is a page', () => {
  assert.equal(looksLikeLinksHandle('https://vegamovies.frl/reacher-2022/'), false);
  assert.equal(looksLikeLinksHandle('http://example.test/title/42'), false);
});

/**
 * The reason the test is narrow rather than "must start with http".
 *
 * Internet Archive's `load()` takes `https://archive.org/details/<id>` and its
 * `loadLinks` takes the bare id — so a non-URL handle is not evidence of
 * anything, and refusing every one of them would break providers that work.
 */
test('a bare identifier is not refused, because pages are not always URLs', () => {
  assert.equal(looksLikeLinksHandle('internet_archive_identifier_2001'), false);
  assert.equal(looksLikeLinksHandle('tt0111161'), false);
});

test('an empty handle is not refused here — it fails later, with a better message', () => {
  assert.equal(looksLikeLinksHandle(''), false);
});

// --- the address round-trip --------------------------------------------------

test('a links handle survives being addressed and read back', () => {
  const url = buildExtensionUrl('VegaMovies', VEGAMOVIES_LINKS);
  const parsed = parseExtensionUrl(url);
  assert.equal(parsed?.provider, 'VegaMovies');
  assert.equal(parsed?.target, VEGAMOVIES_LINKS);
  // The encoding is what keeps the JSON's own slashes out of the path split.
  assert.ok(!url.slice('cs3ext://'.length).split('/')[1].includes('"'));
});

test('a provider name containing a slash still parses', () => {
  const parsed = parseExtensionUrl(buildExtensionUrl('A/B Movies', 'https://x.test/'));
  assert.equal(parsed?.provider, 'A/B Movies');
  assert.equal(parsed?.target, 'https://x.test/');
});

test('anything that is not a cs3ext address parses as null', () => {
  assert.equal(parseExtensionUrl('https://example.test/'), null);
  assert.equal(parseExtensionUrl('magnet:?xt=urn:btih:abc'), null);
  // No slash means no handle, which is not an address this app ever mints.
  assert.equal(parseExtensionUrl('cs3ext://OnlyAProvider'), null);
});

// --- the mirror image: a page address handed to `loadLinks` -------------------

/**
 * Real handles from three captured sessions. Each produced
 * `JsonParseException: Unrecognized token 'https'` inside the provider, logged
 * at error level as "the site has probably changed" and counted against the
 * provider by the ranking — for a call the app made on a guess, which the
 * retry immediately after it got right.
 */
test('the page addresses that were mis-handed to loadLinks are recognised', () => {
  for (const address of [
    'https://bollyflix.af/the-martian-2015-dual-audio-hindi-english-movie/',
    'https://www.themoviedb.org/movie/309809',
    'https://simkl.com/movies/55002/office-space',
    'http://plain.example/page',
  ]) {
    assert.equal(looksLikePageAddress(address), true, address);
  }
});

test('a links blob is never mistaken for a page address', () => {
  assert.equal(looksLikePageAddress(VEGAMOVIES_LINKS), false);
  assert.equal(looksLikePageAddress('["https://greenmountmotors.com/?id=THdE"]'), false);
});

/**
 * The two predicates answer different questions and must never both be true:
 * one says "this is definitely not a page", the other "this is definitely a
 * page". A handle both claimed would make the speculative flag meaningless.
 */
test('the two predicates never agree', () => {
  for (const handle of [
    VEGAMOVIES_LINKS,
    'https://archive.org/details/night_of_the_living_dead',
    'tt0111161',
    '',
    '   ',
    '{"a":1}',
  ]) {
    assert.equal(
      looksLikeLinksHandle(handle) && looksLikePageAddress(handle),
      false,
      handle
    );
  }
});

/**
 * Internet Archive is the reason neither predicate may be widened: its `load()`
 * takes a URL and its `loadLinks` takes a bare id, so "not a URL" cannot mean
 * "not a page" and a bare id cannot be assumed to be either.
 */
test('a bare id is neither, which is the honest answer', () => {
  assert.equal(looksLikeLinksHandle('night_of_the_living_dead'), false);
  assert.equal(looksLikePageAddress('night_of_the_living_dead'), false);
});

test('leading whitespace does not hide a page address', () => {
  assert.equal(looksLikePageAddress('  https://x.test/'), true);
});
