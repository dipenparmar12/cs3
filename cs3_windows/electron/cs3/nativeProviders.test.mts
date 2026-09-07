/**
 * What the native provider lane is allowed to do.
 *
 *   bun run test:native-providers
 *   node --experimental-strip-types electron/cs3/nativeProviders.test.mts
 *
 * Pure: no network, no Electron. The providers' network calls are exercised by
 * substituting the shared fetch (`setHttpFetch`), which is the same seam the
 * main process uses to swap in Electron's `net.fetch`.
 *
 * Three groups of case, and each pins something that fails *silently* if it
 * regresses:
 *
 *  - **Addressing.** A native address that parses as an extension address, or
 *    a handle that loses its second half to an unescaped `/`, produces a
 *    "no such provider" error naming the wrong thing.
 *  - **The Internet Archive query form.** Measured on 2026-09-07: bare free
 *    text answers *Experiments in the Revival of Organisms* for "apollo 11",
 *    and an empty `sort[]` returns an empty result set rather than an error.
 *    Both look exactly like "no such film".
 *  - **The enable cascade.** A lane that registers providers outside
 *    `enabledProviderNames` re-opens the adult gate and the disable switch at
 *    once, and neither is visible until someone reports it.
 */
import assert from 'node:assert/strict';
import { setHttpFetch } from '../torrent/http.ts';
import {
  NATIVE_SCHEME,
  nativeAddress,
  parseNativeAddress,
} from './nativeProviders/types.ts';
import {
  InternetArchiveProvider,
  buildSearchUrl,
  isAdult,
  phrase,
  playableFiles,
  yearOf,
  QUALITY_GATE,
  SECTIONS as IA_SECTIONS,
} from './nativeProviders/internetArchive.ts';
import { parseQuality } from './nativeProviders/iptvOrg.ts';
import { splitHandle } from './nativeProviders/peerTube.ts';
import { NativeProviderRegistry } from './nativeProviderRegistry.ts';

const tests: Array<[string, () => void | Promise<void>]> = [];
const test = (name: string, fn: () => void | Promise<void>) => tests.push([name, fn]);

/** Minimal datastore double: the registry only ever reads bools and objects. */
function fakeDatastore(initial: Record<string, unknown> = {}) {
  const store = new Map<string, unknown>(Object.entries(initial));
  return {
    getBool: (key: string, dflt = false) => (store.has(key) ? Boolean(store.get(key)) : dflt),
    getObject: <T,>(key: string, dflt: T | null = null) =>
      (store.has(key) ? (store.get(key) as T) : dflt),
    setObject: <T,>(key: string, value: T) => {
      store.set(key, value);
    },
    _set: (key: string, value: unknown) => store.set(key, value),
  };
}

// --- Addressing -------------------------------------------------------------

test('an address round-trips through encode and parse', () => {
  const handle = 'night_of_the_living_dead';
  const parsed = parseNativeAddress(nativeAddress('internet-archive', handle));
  assert.deepEqual(parsed, { providerId: 'internet-archive', handle });
});

test('a handle containing slashes survives, rather than splitting the address', () => {
  // PeerTube handles carry a host, Archive handles carry `::file` names, and a
  // future provider will carry a path. An unescaped `/` would silently truncate
  // the handle and name a provider id that does not exist.
  const handle = 'abc-123@video.example.org/extra/path';
  const parsed = parseNativeAddress(nativeAddress('peertube', handle));
  assert.equal(parsed?.handle, handle);
});

test('a JSON handle survives, since providers encode structure into theirs', () => {
  const handle = JSON.stringify({ id: 'x', season: 2 });
  assert.equal(parseNativeAddress(nativeAddress('p', handle))?.handle, handle);
});

test('an extension address is never mistaken for a native one', () => {
  assert.equal(parseNativeAddress('cs3ext://HDO/{"imdbID":"tt1754656"}'), null);
  assert.equal(parseNativeAddress('cs3meta://tt0063350'), null);
  assert.equal(parseNativeAddress('magnet:?xt=urn:btih:abc'), null);
  assert.equal(parseNativeAddress('https://example.org/film.mp4'), null);
});

test('a malformed native address answers null rather than throwing', () => {
  // Reached from a routing decision, where a throw would abort discovery.
  assert.equal(parseNativeAddress(`${NATIVE_SCHEME}no-slash`), null);
  assert.equal(parseNativeAddress(`${NATIVE_SCHEME}/empty-provider`), null);
  assert.equal(parseNativeAddress(`${NATIVE_SCHEME}p/`), null);
  assert.equal(parseNativeAddress(`${NATIVE_SCHEME}p/%E0%A4%A`), null);
});

// --- Internet Archive query form -------------------------------------------

test('search asks for a title phrase, never bare free text', () => {
  const url = buildSearchUrl(`${QUALITY_GATE} AND title:("apollo 11")`, 'downloads desc', 10, 1);
  const q = new URL(url).searchParams.get('q') ?? '';
  assert.match(q, /title:\("apollo 11"\)/);
  // Measured: the bare form answers "Experiments in the Revival of Organisms".
  assert.ok(!/AND \(apollo 11\)/.test(q), 'must not fall back to bare terms');
});

test('a sort key is always sent, because an empty sort returns nothing', () => {
  const url = buildSearchUrl('mediatype:(movies)', 'downloads desc', 10, 1);
  const sorts = new URL(url).searchParams.getAll('sort[]');
  assert.equal(sorts.length, 1);
  assert.equal(sorts[0], 'downloads desc');
});

test('every query carries the MPEG4 quality gate', () => {
  // Ungated, the top documentary by downloads is a 3 MB clip titled "Sample 1".
  assert.match(QUALITY_GATE, /format:\(MPEG4\)/);
  for (const section of IA_SECTIONS) {
    assert.ok(
      section.query.includes('format:(MPEG4)'),
      `section "${section.id}" would admit items with no playable derivative`
    );
  }
});

test('a query is escaped so it cannot break out of the phrase', () => {
  assert.equal(phrase('the "great" escape'), 'the \\"great\\" escape');
  assert.equal(phrase('back\\slash'), 'back\\\\slash');
});

test('a year is read only when it is plausible', () => {
  assert.equal(yearOf({ year: '1968' }), 1968);
  assert.equal(yearOf({ date: '2014-06-27T00:00:00Z' }), 2014);
  assert.equal(yearOf({ year: '1200' }), undefined);
  assert.equal(yearOf({ year: '99999' }), undefined);
  assert.equal(yearOf({}), undefined);
});

test('adult items are recognised from subject and collection', () => {
  assert.equal(isAdult({ subject: ['documentary', 'erotic'] }), true);
  assert.equal(isAdult({ collection: 'pornography' }), true);
  assert.equal(isAdult({ subject: ['documentary', 'history'] }), false);
  // "adult" alone is far too loose — "adult education" is not adult content.
  assert.equal(isAdult({ subject: ['adult education'] }), false);
});

test('video derivatives are ranked best-first and thumbnails are excluded', () => {
  const files = playableFiles([
    { name: 'film_512kb.mp4', format: '512Kb MPEG4' },
    { name: 'film.mp4', format: 'h.264' },
    { name: 'film.thumbs', format: 'Thumbnail' },
    { name: 'poster.jpg', format: 'JPEG' },
    { name: 'film.ogv', format: 'Ogg Video' },
  ]);
  assert.deepEqual(
    files.map((f) => f.name),
    ['film.mp4', 'film_512kb.mp4', 'film.ogv']
  );
});

test('an item with no video derivative is a reason, not an empty list', async () => {
  const provider = new InternetArchiveProvider({ adultAllowed: () => false });
  setHttpFetch(async () =>
    new Response(JSON.stringify({ metadata: { title: 'Audio only' }, files: [{ name: 'a.mp3', format: 'VBR MP3' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  );
  await assert.rejects(
    () => provider.loadLinks('some-item', AbortSignal.timeout(5000)),
    /no playable video derivative/
  );
});

test('a dark item is refused up front rather than 403ing at the player', async () => {
  const provider = new InternetArchiveProvider({ adultAllowed: () => false });
  setHttpFetch(async () =>
    new Response(JSON.stringify({ is_dark: true, files: [{ name: 'f.mp4', format: 'h.264' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  );
  await assert.rejects(
    () => provider.loadLinks('restricted', AbortSignal.timeout(5000)),
    /restricted \(is_dark\)/
  );
});

test('adult rows are withheld from search while the gate is off', async () => {
  const docs = [
    { identifier: 'clean', title: 'A History Film', subject: ['documentary'] },
    { identifier: 'dirty', title: 'After Porn Ends', subject: ['documentary', 'porn'] },
  ];
  setHttpFetch(async () =>
    new Response(JSON.stringify({ response: { docs } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  );

  const off = new InternetArchiveProvider({ adultAllowed: () => false });
  const on = new InternetArchiveProvider({ adultAllowed: () => true });
  const signal = AbortSignal.timeout(5000);
  assert.deepEqual((await off.search('history', signal)).map((r) => r.name), ['A History Film']);
  assert.equal((await on.search('history', signal)).length, 2);
});

test('a multi-file item becomes episodes rather than one truncated row', async () => {
  setHttpFetch(async () =>
    new Response(
      JSON.stringify({
        metadata: { title: 'A Season' },
        files: [
          { name: 'ep01.mp4', format: 'h.264' },
          { name: 'ep02.mp4', format: 'h.264' },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    )
  );
  const provider = new InternetArchiveProvider({ adultAllowed: () => false });
  const detail = await provider.load('a-season', AbortSignal.timeout(5000));
  assert.equal(detail.episodes?.length, 2);
  // Each episode addresses its own file, or every one plays the same video.
  const handles = detail.episodes!.map((e) => parseNativeAddress(e.url)?.handle);
  assert.deepEqual(handles, ['a-season::ep01.mp4', 'a-season::ep02.mp4']);
});

// --- Other providers' pure parts --------------------------------------------

test('iptv-org quality labels become the resolution the ranker sorts on', () => {
  assert.equal(parseQuality('1080p'), 1080);
  assert.equal(parseQuality('720P'), 720);
  assert.equal(parseQuality('576i'), 576);
  assert.equal(parseQuality(null), 0);
  assert.equal(parseQuality('unknown'), 0);
});

test('a PeerTube handle keeps its host, which is where the files live', () => {
  // Resolving against sepiasearch.org 404s, which reads as a dead video.
  assert.deepEqual(splitHandle('abc-123@video.example.org'), {
    uuid: 'abc-123',
    host: 'video.example.org',
  });
  assert.throws(() => splitHandle('no-host'), /Malformed PeerTube handle/);
});

// --- The enable cascade ------------------------------------------------------

test('every built-in provider is listed, enabled, and describes itself', () => {
  const registry = new NativeProviderRegistry(fakeDatastore() as never);
  const summaries = registry.summaries();
  assert.ok(summaries.length >= 3, 'the roster is empty');
  for (const s of summaries) {
    assert.ok(s.id && s.name && s.description, `${s.id} is missing its identity`);
    assert.ok(s.types.length > 0, `${s.id} declares no content types`);
    assert.equal(s.enabled, true, 'a new provider must work without being opted into');
  }
});

test('provider names are unique, because the scope and enable list key on them', () => {
  const registry = new NativeProviderRegistry(fakeDatastore() as never);
  const names = registry.all().map((p) => p.name);
  assert.equal(new Set(names).size, names.length);
  const ids = registry.all().map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('disabling a provider withdraws it from enabledProviderNames', () => {
  const registry = new NativeProviderRegistry(fakeDatastore() as never);
  const before = registry.enabledProviderNames();
  assert.ok(before.includes('Internet Archive'));
  registry.setEnabled('internet-archive', false);
  const after = registry.enabledProviderNames();
  assert.ok(!after.includes('Internet Archive'));
  assert.equal(after.length, before.length - 1);
  registry.setEnabled('internet-archive', true);
  assert.deepEqual(registry.enabledProviderNames().sort(), before.sort());
});

test('a disabled provider never reaches the network at all', async () => {
  /**
   * Asserted as "the socket was not touched", not as "the result was empty".
   *
   * An empty result is what a *failing* provider also produces, so the obvious
   * version of this test passes with the cascade removed entirely — verified by
   * mutation, which is how this note came to be written.
   */
  const registry = new NativeProviderRegistry(fakeDatastore() as never);
  for (const id of ['internet-archive', 'peertube', 'iptv-org']) registry.setEnabled(id, false);

  let calls = 0;
  setHttpFetch(async () => {
    calls++;
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  });

  const rows = await registry.search('anything', AbortSignal.timeout(5000));
  assert.deepEqual(rows, []);
  assert.equal(calls, 0, 'a disabled provider was still asked');
});

test('a disabled provider no longer owns its own addresses', () => {
  const registry = new NativeProviderRegistry(fakeDatastore() as never);
  const address = nativeAddress('internet-archive', 'x');
  assert.equal(registry.handles(address), true);
  registry.setEnabled('internet-archive', false);
  assert.equal(registry.handles(address), false);
  // …and says which switch, rather than "unknown provider".
  assert.match(registry.explain(address), /switched off/);
});

test('the adult gate is read live, not captured at construction', () => {
  const datastore = fakeDatastore();
  const registry = new NativeProviderRegistry(datastore as never);
  const adultProvider = registry.all().find((p) => p.adult);
  if (!adultProvider) return; // No adult built-in today; the gate is still wired.
  assert.ok(!registry.enabledProviderNames().includes(adultProvider.name));
  datastore._set('cs3_adult_content_enabled', true);
  assert.ok(registry.enabledProviderNames().includes(adultProvider.name));
});

test('one provider failing never fails the aggregate search', async () => {
  const registry = new NativeProviderRegistry(fakeDatastore() as never);
  let call = 0;
  setHttpFetch(async () => {
    call++;
    if (call % 2 === 0) throw new Error('host is down');
    return new Response(JSON.stringify({ response: { docs: [{ identifier: 'a', title: 'A' }] }, data: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  const rows = await registry.search('dune', AbortSignal.timeout(8000));
  assert.ok(Array.isArray(rows), 'a failing provider rejected the whole search');
});

test('an unknown address is explained without claiming an extension owned it', () => {
  const registry = new NativeProviderRegistry(fakeDatastore() as never);
  const message = registry.explain(nativeAddress('not-a-provider', 'x'));
  assert.match(message, /not a built-in provider/);
  assert.ok(!/extension/i.test(message), 'must not blame an extension for a built-in address');
});

// --- Runner ------------------------------------------------------------------

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
