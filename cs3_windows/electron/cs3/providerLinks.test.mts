/**
 * What the provider said, read back.
 *
 *   bun run test:links
 *   node --experimental-strip-types electron/cs3/providerLinks.test.mts
 *
 * Two modules are pinned here and both fail silently when they are wrong, which
 * is the reason they are tested at all rather than the reason they are grouped:
 *
 * - **Link classification** decides whether a stream reaches the torrent engine,
 *   the DASH remuxer, the EME path or the media element. Every wrong answer
 *   looks like a bad provider rather than a bad routing decision — a magnet
 *   handed to the HTTP proxy simply produces nothing, with no error naming the
 *   mistake.
 * - **Key material** decides whether a ClearKey stream decrypts or produces
 *   noise. A key read in the wrong encoding does not throw; it decrypts to
 *   garbage, which is indistinguishable from a corrupt download.
 */
import assert from 'node:assert/strict';
import {
  drmFromProvider,
  isTorrentLink,
  linkRequiresEme,
  mapProviderLink,
} from './providerLinks.ts';
import {
  clearKeyLicense,
  clearKeysFromProvider,
  clearKeysToHex,
  keyMaterialToHex,
  normalizeKeyMaterial,
} from '../../src/utils/clearKey.ts';

const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

// --- link classification ---------------------------------------------------

test('the provider’s own type beats the URL, in both directions', () => {
  // A playlist served from a `.php` address, which is routine in the corpus.
  const hls = mapProviderLink(
    { type: 'M3U8', url: 'https://host.test/stream.php?id=99' },
    'Fake'
  );
  assert.equal(hls.isM3u8, true);

  // And a progressive MP4 behind a path containing the word `dash`, which the
  // old heuristic called a manifest.
  const mp4 = mapProviderLink(
    { type: 'VIDEO', url: 'https://cdn.test/dash/movie.mp4' },
    'Fake'
  );
  assert.equal(mp4.isDash, false);
  assert.equal(mp4.isM3u8, false);
});

test('an older archive that types everything VIDEO still gets the URL heuristics', () => {
  // `ExtractorLinkType` predates some of the corpus. Where the provider has
  // nothing to say, the address is all there is — the change was the ordering,
  // not the deletion.
  const link = mapProviderLink({ url: 'https://host.test/master.m3u8' }, 'Fake');
  assert.equal(link.isM3u8, true);
});

test('torrents are recognised by type and by address', () => {
  assert.equal(isTorrentLink({ linkType: 'MAGNET', url: 'magnet:?xt=urn:btih:abc' }), true);
  assert.equal(isTorrentLink({ linkType: 'TORRENT', url: 'https://x.test/a.torrent' }), true);
  // No declared type: the address still answers it.
  assert.equal(isTorrentLink({ url: 'magnet:?xt=urn:btih:abc' }), true);
  assert.equal(isTorrentLink({ linkType: 'VIDEO', url: 'https://cdn.test/a.mp4' }), false);
});

test('a playlist link carries its parts, because it has no address of its own', () => {
  // `ExtractorLinkPlayList` leaves `url` empty; the parts are the address. A
  // filter judging it by `url` alone discards every multi-part title.
  const link = mapProviderLink(
    {
      type: 'VIDEO',
      url: '',
      playlist: [
        { url: 'https://cdn.test/p1.mp4', durationUs: 600_000_000 },
        { url: 'https://cdn.test/p2.mp4', durationUs: 540_000_000 },
      ],
    },
    'Fake'
  );
  assert.equal(link.playlist?.length, 2);
  assert.equal(link.playlist?.[0].durationUs, 600_000_000);
});

test('audio tracks keep their headers, which is what makes them fetchable', () => {
  const link = mapProviderLink(
    {
      type: 'VIDEO',
      url: 'https://cdn.test/v.mp4',
      audioTracks: [{ url: 'https://cdn.test/hi.m4a', headers: { Referer: 'https://p.test/' } }],
    },
    'Fake'
  );
  assert.equal(link.audioTracks?.[0].headers?.Referer, 'https://p.test/');
});

test('referer field from provider is merged into headers when headers has no Referer', () => {
  const link = mapProviderLink(
    {
      type: 'VIDEO',
      url: 'https://cdn.test/v.mp4',
      referer: 'https://embed.streamprovider.test/watch',
      headers: { 'User-Agent': 'CustomUA/1.0' },
    },
    'Fake'
  );
  assert.equal(link.headers?.['Referer'], 'https://embed.streamprovider.test/watch');
  assert.equal(link.headers?.['User-Agent'], 'CustomUA/1.0');
});

test('a half-filled extractor result is not mistaken for DRM', () => {
  assert.equal(mapProviderLink({ url: 'https://x.test/a.mp4', drm: {} }, 'Fake').drm, undefined);
  assert.equal(linkRequiresEme({ drm: undefined }), false);
});

// --- DRM -------------------------------------------------------------------

test('a DRM declaration with no key is still DRM', () => {
  // "Encrypted and we cannot decrypt it" is the answer that keeps FFmpeg off
  // the stream. Dropping it sends the source back to the probe to be
  // misdiagnosed as corrupt.
  const drm = drmFromProvider({ scheme: 'widevine', licenseUrl: 'https://lic.test/w' });
  assert.equal(drm?.type, 'widevine');
  assert.equal(drm?.clearKeys, undefined);
});

test('a system we cannot name survives as `unknown` rather than becoming `none`', () => {
  assert.equal(drmFromProvider({ scheme: 'unknown', uuid: '11111111-2222-3333-4444-555555555555' })?.type, 'unknown');
});

// --- key material ----------------------------------------------------------

test('hex and base64url are told apart by length, not by alphabet', () => {
  // `0123456789abcdef0123456789abcdef` is valid base64url *and* valid hex.
  // Reading it as base64 yields 24 bytes of the wrong key and the stream
  // decrypts to noise — so the discriminator has to be length: 16 bytes is 32
  // hex characters or 22 base64url ones.
  const asHex = normalizeKeyMaterial('0123456789abcdef0123456789abcdef');
  assert.equal(asHex, 'ASNFZ4mrze8BI0VniavN7w');
  assert.equal(keyMaterialToHex(asHex!), '0123456789abcdef0123456789abcdef');
});

test('base64url is passed through, and padding is normalised away', () => {
  assert.equal(normalizeKeyMaterial('ASNFZ4mrze8BI0VniavN7w'), 'ASNFZ4mrze8BI0VniavN7w');
  assert.equal(normalizeKeyMaterial('ASNFZ4mrze8BI0VniavN7w=='), 'ASNFZ4mrze8BI0VniavN7w');
});

test('the hyphenated UUID form providers sometimes use is read as hex', () => {
  assert.equal(
    normalizeKeyMaterial('01234567-89ab-cdef-0123-456789abcdef'),
    normalizeKeyMaterial('0123456789abcdef0123456789abcdef')
  );
});

test('anything that is not 16 bytes is rejected rather than half-read', () => {
  assert.equal(normalizeKeyMaterial('abc'), null);
  assert.equal(normalizeKeyMaterial(''), null);
  assert.equal(normalizeKeyMaterial(undefined), null);
  // 32 base64url characters is 24 bytes, not 16 — a plausible-looking string
  // that is not a CENC key. `Z` is used deliberately: it is outside the hex
  // alphabet, so this cannot be read as hex the way `AAAA…` legitimately is.
  assert.equal(normalizeKeyMaterial('ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ'), null);
});

test('a provider pair round-trips to the hex FFmpeg takes', () => {
  const keys = clearKeysFromProvider({
    scheme: 'clearkey',
    kid: '0123456789abcdef0123456789abcdef',
    key: '00112233445566778899aabbccddeeff',
  });
  assert.deepEqual(clearKeysToHex(keys!), {
    '0123456789abcdef0123456789abcdef': '00112233445566778899aabbccddeeff',
  });
});

test('a licence is a JWK Set the CDM will accept', () => {
  const license = JSON.parse(
    clearKeyLicense({ ASNFZ4mrze8BI0VniavN7w: 'ABEiM0RVZneImaq7zN3u_w' })
  );
  assert.equal(license.type, 'temporary');
  assert.deepEqual(license.keys, [
    { kty: 'oct', kid: 'ASNFZ4mrze8BI0VniavN7w', k: 'ABEiM0RVZneImaq7zN3u_w' },
  ]);
});

test('a key that is only half supplied produces no key set at all', () => {
  // Claiming an empty key set would tell the engine ClearKey is playable here
  // when it is not.
  assert.equal(clearKeysFromProvider({ scheme: 'clearkey', kid: 'ASNFZ4mrze8BI0VniavN7w' }), null);
});

// --- runner ----------------------------------------------------------------

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
