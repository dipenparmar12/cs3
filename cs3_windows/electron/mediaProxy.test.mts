/**
 * The proxy's manifest handling, against a stubbed origin.
 *
 *   bun run test:proxy
 *   node --experimental-strip-types electron/mediaProxy.test.mts
 *
 * This module earns tests because its failures are silent and are attributed to
 * the wrong thing. A DASH manifest served unmodified from loopback produces a
 * player asking this proxy for segment paths it has no route for — every segment
 * 404s, and the report that comes back is "the provider is broken". Nothing in
 * the manifest, the network log or the player says the rewriting is what went
 * wrong.
 *
 * The *origin* is a stub rather than a real server, and that is deliberate: a
 * real one would have to listen on 127.0.0.1, and `wrap` returns loopback URLs
 * untouched by design — so a socket-backed origin tests nothing, which is a
 * mistake worth only making once. Requests to the proxy itself are real HTTP.
 */
import assert from 'node:assert/strict';
import { MediaProxy } from './mediaProxy.ts';

const MPD_RELATIVE = `<?xml version="1.0"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static">
 <Period>
  <AdaptationSet mimeType="video/mp4">
   <Representation id="0" bandwidth="800000">
    <SegmentTemplate media="chunk-$RepresentationID$-$Number%05d$.m4s" initialization="init-$RepresentationID$.m4s" startNumber="1"/>
   </Representation>
  </AdaptationSet>
 </Period>
</MPD>`;

const MPD_WITH_BASE = `<?xml version="1.0"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011">
 <BaseURL>https://cdn.origin.test/v1/</BaseURL>
 <Period><AdaptationSet><Representation>
  <SegmentTemplate media="seg-$Number$.m4s" initialization="init.m4s"/>
 </Representation></AdaptationSet></Period>
</MPD>`;

const MPD_ABSOLUTE = `<?xml version="1.0"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011">
 <Period><AdaptationSet><Representation>
  <SegmentTemplate media="https://cdn.origin.test/abs/seg-$Number$.m4s" initialization="https://cdn.origin.test/abs/init.m4s"/>
 </Representation></AdaptationSet></Period>
</MPD>`;

const HLS_PLAYLIST = `#EXTM3U
#EXT-X-KEY:METHOD=AES-128,URI="key.bin"
#EXTINF:6.0,
seg1.ts
`;

/** What the stub origin was asked for, in order. */
const seen: Array<{ url: string; referer?: string }> = [];

const bodies: Record<string, { body: string; type?: string; length?: boolean }> = {
  'https://cdn.origin.test/rel.mpd': { body: MPD_RELATIVE, type: 'application/dash+xml' },
  'https://cdn.origin.test/base.mpd': { body: MPD_WITH_BASE, type: 'application/octet-stream', length: true },
  'https://cdn.origin.test/abs.mpd': { body: MPD_ABSOLUTE, type: 'application/dash+xml' },
  'https://cdn.origin.test/noext': { body: MPD_RELATIVE, type: 'application/octet-stream', length: true },
  'https://cdn.origin.test/list.m3u8': { body: HLS_PLAYLIST, type: 'application/vnd.apple.mpegurl' },
};

const stubFetch = (async (url: string, init?: { headers?: Record<string, string> }) => {
  seen.push({ url, referer: init?.headers?.Referer ?? init?.headers?.referer });
  const entry = bodies[url];
  const body = entry ? entry.body : 'SEGMENT';
  const headers = new Headers({ 'Content-Type': entry?.type ?? 'video/mp4' });
  if (entry?.length || !entry) headers.set('Content-Length', String(Buffer.byteLength(body)));
  return new Response(body, { status: 200, headers });
}) as never;

const proxy = new MediaProxy(stubFetch);

const tests: Array<[string, () => Promise<void>]> = [];
const test = (name: string, fn: () => Promise<void>) => tests.push([name, fn]);

const baseUrlIn = (text: string): string => {
  const match = /<BaseURL>([^<]+)<\/BaseURL>/.exec(text);
  assert.ok(match, `no BaseURL in:\n${text}`);
  return match![1];
};

// --- DASH ------------------------------------------------------------------

test('a manifest with no BaseURL is given one pointing at the proxy', async () => {
  const wrapped = await proxy.wrap('https://cdn.origin.test/rel.mpd', { Referer: 'https://provider.test/' });
  const text = await (await fetch(wrapped)).text();
  assert.match(baseUrlIn(text), /^http:\/\/127\.0\.0\.1:\d+\/base\/\d+\/$/);
});

test('segment templates keep their placeholders — the player expands them', async () => {
  // This is why DASH needs a *directory* route where HLS did not: there is no
  // list of segment URLs to rewrite, only a base to redirect.
  const wrapped = await proxy.wrap('https://cdn.origin.test/rel.mpd', {});
  const text = await (await fetch(wrapped)).text();
  assert.match(text, /media="chunk-\$RepresentationID\$-\$Number%05d\$\.m4s"/);
});

test('a segment fetched through that base reaches the origin with the Referer', async () => {
  const wrapped = await proxy.wrap('https://cdn.origin.test/rel.mpd', { Referer: 'https://provider.test/' });
  const text = await (await fetch(wrapped)).text();
  seen.length = 0;

  const segment = await fetch(`${baseUrlIn(text)}chunk-0-00001.m4s`);
  assert.equal(await segment.text(), 'SEGMENT');
  assert.equal(seen.at(-1)?.url, 'https://cdn.origin.test/chunk-0-00001.m4s');
  assert.equal(seen.at(-1)?.referer, 'https://provider.test/');
});

test('an existing BaseURL is replaced, not added to', async () => {
  const wrapped = await proxy.wrap('https://cdn.origin.test/base.mpd', {});
  const text = await (await fetch(wrapped)).text();
  assert.equal((text.match(/<BaseURL>/g) ?? []).length, 1);
  assert.doesNotMatch(text, /<BaseURL>https:\/\/cdn\.origin\.test/);
});

test('the replaced BaseURL still points at what it originally named', async () => {
  const wrapped = await proxy.wrap('https://cdn.origin.test/base.mpd', {});
  const text = await (await fetch(wrapped)).text();
  seen.length = 0;
  await fetch(`${baseUrlIn(text)}seg-1.m4s`);
  // The manifest's own BaseURL was `/v1/`, so the segment lives under it.
  assert.equal(seen.at(-1)?.url, 'https://cdn.origin.test/v1/seg-1.m4s');
});

test('absolute segment URLs are rewritten, keeping the filename intact', async () => {
  const wrapped = await proxy.wrap('https://cdn.origin.test/abs.mpd', {});
  const text = await (await fetch(wrapped)).text();
  assert.doesNotMatch(text, /media="https:\/\/cdn\.origin\.test/);
  assert.match(text, /media="http:\/\/127\.0\.0\.1:\d+\/base\/\d+\/seg-\$Number\$\.m4s"/);
});

test('a manifest with no extension and no content type is recognised by its body', async () => {
  // Providers serve `.mpd` documents as octet-stream from extensionless URLs
  // routinely. The URL cannot answer this; the first bytes can.
  const wrapped = await proxy.wrap('https://cdn.origin.test/noext', {});
  const response = await fetch(wrapped);
  assert.equal(response.headers.get('content-type'), 'application/dash+xml');
  assert.match(await response.text(), /<BaseURL>http:\/\/127\.0\.0\.1/);
});

test('a directory route cannot be walked out of', async () => {
  // The suffix arrives from the renderer. Without the containment check a
  // directory route becomes the arbitrary-URL fetcher `wrap` deliberately is.
  const wrapped = await proxy.wrap('https://cdn.origin.test/rel.mpd', {});
  const text = await (await fetch(wrapped)).text();
  const escaped = await fetch(`${baseUrlIn(text)}../../secret`);
  assert.equal(escaped.status, 404);
});

test('one directory route is minted per base, not one per segment', async () => {
  const wrapped = await proxy.wrap('https://cdn.origin.test/rel.mpd', {});
  const base = baseUrlIn(await (await fetch(wrapped)).text());
  const again = baseUrlIn(await (await fetch(wrapped)).text());
  assert.equal(base, again);
});

// --- HLS, unchanged --------------------------------------------------------

test('HLS playlists are still rewritten line by line', async () => {
  // DASH handling must not have displaced the playlist path it sits beside.
  const wrapped = await proxy.wrap('https://cdn.origin.test/list.m3u8', {});
  const text = await (await fetch(wrapped)).text();
  assert.match(text, /URI="http:\/\/127\.0\.0\.1:\d+\/stream\/\d+"/);
  assert.match(text, /^http:\/\/127\.0\.0\.1:\d+\/stream\/\d+$/m);
});

test('a loopback URL is returned untouched rather than wrapped again', async () => {
  const already = 'http://127.0.0.1:9/stream/1';
  assert.equal(await proxy.wrap(already, { Referer: 'x' }), already);
});

test('Google CDN URLs strip Referer headers to avoid 403 Forbidden', async () => {
  const wrapped = await proxy.wrap('https://video-downloads.googleusercontent.com/test-video', {
    Referer: 'https://provider.test/',
  });
  seen.length = 0;
  await fetch(wrapped);
  assert.equal(seen.at(-1)?.url, 'https://video-downloads.googleusercontent.com/test-video');
  assert.equal(seen.at(-1)?.referer, undefined);
});

// --- runner ----------------------------------------------------------------

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
proxy.shutdown();
console.log(failed === 0 ? `\n${tests.length} passed` : `\n${failed} of ${tests.length} FAILED`);
process.exit(failed === 0 ? 0 : 1);
