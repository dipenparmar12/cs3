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
  isClip,
  phrase,
  playableFiles,
  yearOf,
  QUALITY_GATE,
  SECTIONS as IA_SECTIONS,
} from './nativeProviders/internetArchive.ts';
import { parseQuality } from './nativeProviders/iptvOrg.ts';
import { splitHandle } from './nativeProviders/peerTube.ts';
import {
  StremioAddonProvider,
  acceptsId,
  fetchManifest,
  normaliseBase,
  packHandle,
  qualityFromLabel,
  unpackHandle,
} from './nativeProviders/stremioAddon.ts';
import {
  JellyfinProvider,
  probeServer,
  type JellyfinServerConfig,
} from './nativeProviders/jellyfin.ts';
import { NativeProviderRegistry, addonLocalId } from './nativeProviderRegistry.ts';

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

test('a trailer never outranks the film it advertises', async () => {
  // Measured live: "night of the living dead" put *Night of the living dead
  // Trailer* above the 1968 feature, because a two-minute clip is downloaded
  // far more often than a ninety-minute film.
  setHttpFetch(async () =>
    new Response(
      JSON.stringify({
        response: {
          docs: [
            { identifier: 'a', title: 'Night of the living dead Trailer' },
            { identifier: 'b', title: 'Night of the Living Dead', year: '1968' },
            { identifier: 'c', title: 'Night of the Living Dead (restored)', year: '1968' },
          ],
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    )
  );
  const provider = new InternetArchiveProvider({ adultAllowed: () => false });
  const rows = await provider.search('night of the living dead', AbortSignal.timeout(5000));
  assert.equal(rows[0]!.name, 'Night of the Living Dead');
  assert.equal(rows.at(-1)!.name, 'Night of the living dead Trailer');
  // The trailer is demoted, never dropped — it is a real item someone may want.
  assert.equal(rows.length, 3);
});

test('a legitimate title is not demoted by an over-eager clip filter', () => {
  assert.equal(isClip('Night of the Living Dead Trailer'), true);
  assert.equal(isClip('Behind the Scenes'), true);
  // Prelinger is full of industrial films with words like this in the title.
  assert.equal(isClip('Preview of Tomorrow'), false);
  assert.equal(isClip('The Internet\'s Own Boy'), false);
  assert.equal(isClip('Trailblazers of the West'), false);
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

// --- The generic Stremio addon lane -----------------------------------------

const CINEMETA_MANIFEST = {
  id: 'com.linvo.cinemeta',
  name: 'Cinemeta',
  types: ['movie', 'series'],
  resources: ['catalog', 'meta'],
  catalogs: [
    { type: 'movie', id: 'top', name: 'Popular' },
    { type: 'movie', id: 'year', name: 'New' },
    { type: 'series', id: 'top', name: 'Popular series' },
  ],
  idPrefixes: ['tt'],
};

test('an addon is asked only for ids it declares it accepts', () => {
  // Measured: Anime Kitsu answers HTTP **500** for `tt0063350`, not an empty
  // list. An addon that only speaks `kitsu:` treats an IMDb id as malformed, so
  // the check has to happen before the request rather than around it.
  const kitsu = { ...CINEMETA_MANIFEST, idPrefixes: ['kitsu', 'mal', 'anilist'] };
  assert.equal(acceptsId(kitsu, 'tt0063350'), false);
  assert.equal(acceptsId(kitsu, 'kitsu:12345'), true);
  assert.equal(acceptsId(CINEMETA_MANIFEST, 'tt0063350'), true);
  // No `idPrefixes` means "anything", which is the protocol's own default.
  assert.equal(acceptsId({ ...CINEMETA_MANIFEST, idPrefixes: undefined }, 'anything'), true);
});

test('a type travels with the id, because a Stremio id means nothing alone', () => {
  assert.equal(packHandle('series', 'tt0903747:1:3'), 'series|tt0903747:1:3');
  assert.deepEqual(unpackHandle('series|tt0903747:1:3'), {
    type: 'series',
    id: 'tt0903747:1:3',
  });
  // An id containing the separator must not be truncated at the wrong bar.
  assert.deepEqual(unpackHandle('movie|tt1|weird'), { type: 'movie', id: 'tt1|weird' });
  // A bare handle is still addressable rather than throwing.
  assert.deepEqual(unpackHandle('tt0063350'), { type: 'movie', id: 'tt0063350' });
});

test('a manifest URL normalises the same however it was pasted', () => {
  for (const input of [
    'https://v3-cinemeta.strem.io/manifest.json',
    'https://v3-cinemeta.strem.io/',
    'https://v3-cinemeta.strem.io',
    '  https://v3-cinemeta.strem.io//  ',
  ]) {
    assert.equal(normaliseBase(input), 'https://v3-cinemeta.strem.io');
  }
});

test('two deployments of one addon are two providers', () => {
  // Torrentio, Comet and MediaFusion all have public and self-hosted instances,
  // and a debrid-configured deployment is the whole point of adding one. Keying
  // on the manifest id alone would let the second silently replace the first.
  const a = addonLocalId('com.stremio.torrentio.addon', 'https://torrentio.strem.fun');
  const b = addonLocalId('com.stremio.torrentio.addon', 'https://my-torrentio.example.net');
  assert.notEqual(a, b);
  // Namespaced, so an addon can never claim a built-in provider's id.
  assert.ok(a.startsWith('addon:'));
});

test('quality is read out of an addon\'s free-text label', () => {
  assert.equal(qualityFromLabel('Torrentio 4k HDR | RARBG'), 2160);
  assert.equal(qualityFromLabel('1080p WEB-DL'), 1080);
  assert.equal(qualityFromLabel('720p'), 720);
  assert.equal(qualityFromLabel('some release with no resolution'), 0);
});

test('capabilities are declared from the manifest, not assumed', () => {
  const catalogueOnly = new StremioAddonProvider({
    localId: 'addon:x@y',
    baseUrl: 'https://example.org',
    manifest: CINEMETA_MANIFEST,
  });
  assert.deepEqual(catalogueOnly.capabilities(), {
    search: true,
    catalog: true,
    resolve: false,
  });

  const streamOnly = new StremioAddonProvider({
    localId: 'addon:s@y',
    baseUrl: 'https://example.org',
    manifest: { ...CINEMETA_MANIFEST, resources: ['stream'], catalogs: [] },
  });
  assert.deepEqual(streamOnly.capabilities(), {
    search: false,
    catalog: false,
    resolve: true,
  });
});

test('a catalogue-only addon says so rather than returning nothing', async () => {
  const provider = new StremioAddonProvider({
    localId: 'addon:x@y',
    baseUrl: 'https://example.org',
    manifest: CINEMETA_MANIFEST,
  });
  await assert.rejects(
    () => provider.loadLinks('movie|tt0063350', AbortSignal.timeout(5000)),
    /does not supply streams/
  );
});

test('search asks once per type, not once per catalogue', async () => {
  // Three catalogues over two types must be two requests, not three: an addon
  // publishing eight catalogues would otherwise mean eight requests to someone
  // else's server for one query, returning the same title eight times.
  const asked: string[] = [];
  setHttpFetch(async (url) => {
    asked.push(String(url));
    return new Response(JSON.stringify({ metas: [{ id: 'tt1', name: 'A Film', type: 'movie' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  const provider = new StremioAddonProvider({
    localId: 'addon:x@y',
    baseUrl: 'https://example.org',
    manifest: CINEMETA_MANIFEST,
  });
  const rows = await provider.search('dune', AbortSignal.timeout(5000));
  assert.equal(asked.length, 2, `expected one request per type, got ${asked.length}`);
  assert.equal(rows.length, 2);
  // Extras travel as a path segment, not a query string — the part of the
  // protocol that surprises everybody.
  assert.ok(asked.every((u) => u.includes('/search=dune.json')), asked.join(' '));
});

test('an external link is not offered as a source', async () => {
  setHttpFetch(async () =>
    new Response(
      JSON.stringify({
        streams: [
          { externalUrl: 'https://example.org/watch', name: 'Open in browser' },
          { ytId: 'abc123', name: 'YouTube' },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    )
  );
  const provider = new StremioAddonProvider({
    localId: 'addon:s@y',
    baseUrl: 'https://example.org',
    manifest: { ...CINEMETA_MANIFEST, resources: ['stream'] },
  });
  // A row that looks playable and opens a web page is worse than no row.
  await assert.rejects(
    () => provider.loadLinks('movie|tt0063350', AbortSignal.timeout(5000)),
    /none of them playable here/
  );
});

test('an infoHash stream becomes a magnet and a url stream stays direct', async () => {
  setHttpFetch(async () =>
    new Response(
      JSON.stringify({
        streams: [
          { infoHash: 'abcdef0123456789abcdef0123456789abcdef01', name: 'Torrentio 1080p' },
          {
            url: 'https://cdn.example.org/f.mp4',
            name: 'Debrid 4k',
            behaviorHints: { proxyHeaders: { request: { Referer: 'https://example.org/' } } },
          },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    )
  );
  const provider = new StremioAddonProvider({
    localId: 'addon:s@y',
    baseUrl: 'https://example.org',
    manifest: { ...CINEMETA_MANIFEST, resources: ['stream'] },
  });
  const links = await provider.loadLinks('movie|tt0063350', AbortSignal.timeout(5000));
  assert.equal(links.length, 2);
  assert.equal(links[0]!.linkType, 'MAGNET');
  assert.match(links[0]!.url, /^magnet:\?xt=urn:btih:abcdef01/);
  assert.equal(links[0]!.quality, 1080);
  assert.equal(links[1]!.linkType, 'VIDEO');
  assert.equal(links[1]!.quality, 2160);
  // Headers the addon supplied travel, or the host 403s the link.
  assert.equal(links[1]!.headers?.Referer, 'https://example.org/');
});

test('a URL that is not an addon is refused in front of the user', async () => {
  setHttpFetch(async () =>
    new Response('<!doctype html><html><body>hello</body></html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    })
  );
  await assert.rejects(() => fetchManifest('https://example.org'), (error: Error) => {
    // Any parse/shape failure is fine; what must not happen is silently
    // becoming a provider that is asked on every search and answers nothing.
    assert.ok(error instanceof Error);
    return true;
  });

  setHttpFetch(async () =>
    new Response(JSON.stringify({ id: 'x', name: 'Empty', resources: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  );
  await assert.rejects(() => fetchManifest('https://example.org'), /declares no resources/);
});

test('an added addon joins the roster and the enable cascade', async () => {
  const datastore = fakeDatastore();
  const registry = new NativeProviderRegistry(datastore as never);
  const builtIns = registry.all().length;

  setHttpFetch(async () =>
    new Response(JSON.stringify(CINEMETA_MANIFEST), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  );
  const record = await registry.addAddon('https://v3-cinemeta.strem.io/manifest.json');

  assert.equal(registry.all().length, builtIns + 1);
  assert.ok(registry.enabledProviderNames().includes('Cinemeta'));
  // Disabling it works exactly as it does for a built-in.
  registry.setEnabled(record.localId, false);
  assert.ok(!registry.enabledProviderNames().includes('Cinemeta'));

  registry.removeAddon(record.localId);
  assert.equal(registry.all().length, builtIns);
});

test('the same addon cannot be added twice', async () => {
  const registry = new NativeProviderRegistry(fakeDatastore() as never);
  setHttpFetch(async () =>
    new Response(JSON.stringify(CINEMETA_MANIFEST), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  );
  await registry.addAddon('https://v3-cinemeta.strem.io');
  await assert.rejects(
    () => registry.addAddon('https://v3-cinemeta.strem.io/manifest.json'),
    /already been added/
  );
});

test('a stored addon can never shadow a built-in provider', () => {
  // The addon list is user data. A malformed or hostile entry claiming
  // `internet-archive` must not replace the real one.
  const datastore = fakeDatastore({
    cs3_stremio_addons: [
      {
        localId: 'internet-archive',
        url: 'https://evil.example.org',
        manifest: { id: 'evil', name: 'Not Internet Archive', resources: ['stream'] },
        addedAt: 1,
      },
    ],
  });
  const registry = new NativeProviderRegistry(datastore as never);
  assert.equal(registry.byId('internet-archive')?.name, 'Internet Archive');
});

// --- Personal media servers --------------------------------------------------

const SERVER: JellyfinServerConfig = {
  localId: 'server:nas-local-8096',
  name: 'Home NAS (nas.local:8096)',
  url: 'http://nas.local:8096',
  apiKey: 'SECRET-KEY-0123456789',
  userId: 'user-1',
};

test('the API key travels in a header, never in a URL', async () => {
  /**
   * A URL is the one part of a request this codebase writes to disk —
   * `MediaProxy` mints routes from it, `SourceCache` persists it,
   * `DiagnosticsLog` records it, and the source export copies it to a
   * clipboard. Jellyfin accepts `?api_key=` and its own docs use it; putting a
   * long-lived credential there would leak it into all four.
   */
  const seen: Array<{ url: string; key?: string }> = [];
  setHttpFetch(async (url, init) => {
    const headers = new Headers((init?.headers ?? {}) as Record<string, string>);
    seen.push({ url: String(url), key: headers.get('X-Emby-Token') ?? undefined });
    return new Response(
      JSON.stringify({
        Id: 'item-1',
        Name: 'A Film',
        Type: 'Movie',
        MediaSources: [{ Id: 'ms-1', Container: 'mkv', MediaStreams: [{ Type: 'Video', Height: 1080 }] }],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  });

  const provider = new JellyfinProvider(SERVER);
  const links = await provider.loadLinks('item-1', AbortSignal.timeout(5000));

  assert.ok(seen.length > 0, 'no request was made');
  for (const request of seen) {
    assert.ok(!request.url.includes(SERVER.apiKey), `key leaked into a URL: ${request.url}`);
    assert.equal(request.key, SERVER.apiKey, 'the key must travel as X-Emby-Token');
  }
  assert.equal(links.length, 1);
  assert.ok(!links[0]!.url.includes(SERVER.apiKey), 'key leaked into the playable URL');
  assert.equal(links[0]!.headers?.['X-Emby-Token'], SERVER.apiKey);
  assert.equal(links[0]!.quality, 1080);
});

test('the original file is requested, not a server-side transcode', () => {
  // This app has its own compatibility engine, ffmpeg and mpv. A transcode on
  // the user's NAS would be a second one, producing a worse picture than the
  // file it started from.
  setHttpFetch(async () =>
    new Response(
      JSON.stringify({ Id: 'i', Name: 'F', Type: 'Movie', MediaSources: [{ Id: 'm' }] }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    )
  );
  return new JellyfinProvider(SERVER)
    .loadLinks('i', AbortSignal.timeout(5000))
    .then((links) => {
      assert.match(links[0]!.url, /[?&]static=true\b/);
    });
});

test('a series says to pick an episode rather than failing obscurely', async () => {
  setHttpFetch(async () =>
    new Response(JSON.stringify({ Id: 's', Name: 'A Show', Type: 'Series' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  );
  await assert.rejects(
    () => new JellyfinProvider(SERVER).loadLinks('s', AbortSignal.timeout(5000)),
    /Pick an episode/
  );
});

test('an item the server lists but has no file for is a reason, not silence', async () => {
  setHttpFetch(async () =>
    new Response(JSON.stringify({ Id: 'i', Name: 'Moved Film', Type: 'Movie', MediaSources: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  );
  await assert.rejects(
    () => new JellyfinProvider(SERVER).loadLinks('i', AbortSignal.timeout(5000)),
    /reports no media file/
  );
});

test('a key attached to no user account is named as the cause', async () => {
  // The commonest real failure: the key authenticates, so there is no 401 —
  // `/Users` just comes back empty, and "no results" would be the wrong message.
  setHttpFetch(async (url) =>
    String(url).includes('/Users')
      ? new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })
      : new Response(JSON.stringify({ ServerName: 'NAS', Version: '10.9.0' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
  );
  await assert.rejects(
    () => probeServer('http://nas.local:8096', 'k'),
    /no user account for that API key/
  );
});

test('a server address must be a URL, checked before anything is stored', async () => {
  await assert.rejects(() => probeServer('nas.local:8096', 'k'), /must start with http/);
});

test('a stored server never hands its key to the renderer', async () => {
  const datastore = fakeDatastore({ cs3_media_servers: [SERVER] });
  const registry = new NativeProviderRegistry(datastore as never);

  assert.ok(registry.enabledProviderNames().includes(SERVER.name), 'server is not in the roster');

  const listed = registry.listServers();
  assert.equal(listed.length, 1);
  assert.ok(!('apiKey' in listed[0]!), 'the API key crossed the boundary');
  // …and nothing else the renderer receives carries it either.
  const serialised = JSON.stringify({ listed, summaries: registry.summaries() });
  assert.ok(!serialised.includes(SERVER.apiKey), 'the key appears in renderer-bound data');
});

test('a media server is gated by the same cascade as everything else', () => {
  const datastore = fakeDatastore({ cs3_media_servers: [SERVER] });
  const registry = new NativeProviderRegistry(datastore as never);
  assert.ok(registry.enabledProviderNames().includes(SERVER.name));
  registry.setEnabled(SERVER.localId, false);
  assert.ok(!registry.enabledProviderNames().includes(SERVER.name));
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
