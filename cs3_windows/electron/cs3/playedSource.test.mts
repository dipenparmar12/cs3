/**
 * Re-finding a saved source after its link expired.
 *
 *   node --experimental-strip-types electron/cs3/playedSource.test.mts
 *
 * Pure, and tested because both failure directions are bad in ways that are
 * invisible from the outside. Too strict and a saved source is never re-found,
 * so the feature quietly does nothing and looks like the app forgot. Too loose
 * and "resume the source that worked" starts a *different* release — a
 * different cut, a different dub, a 480p rip where a 1080p was saved — which
 * the viewer will read as the app losing their place rather than as a matching
 * bug.
 *
 * The case that motivates the whole file: a provider source's `infoHash` is the
 * SHA-1 of its URL, so it changes every time the link is refreshed. Matching on
 * it alone can never re-find one.
 */
import assert from 'node:assert/strict';
import { isLinkUsable, matchesRelease, pickReplacement } from './playedSource.ts';
import type { StoredSource } from '../../src/types/library.ts';
import type { TorrentResult } from '../../src/types/torrent.ts';

const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

function saved(overrides: Partial<StoredSource> = {}): StoredSource {
  return {
    id: 'saved-1',
    infoHash: 'ext-1111111111111111',
    title: 'Dune Part Two 2024 1080p WEB-DL',
    providerName: 'UHDmovies',
    indexerName: 'UHDmovies',
    directUrl: 'https://cdn.example/a.mkv?Expires=1',
    resolution: 1080,
    status: 'Played',
    discoveredAt: 0,
    ...overrides,
  } as StoredSource;
}

function candidate(overrides: Partial<TorrentResult> = {}): TorrentResult {
  return {
    infoHash: 'ext-2222222222222222',
    magnet: '',
    directUrl: 'https://cdn.example/a.mkv?Expires=999',
    title: 'Dune Part Two 2024 1080p WEB-DL',
    indexerName: 'UHDmovies',
    sizeBytes: 0,
    seeders: 0,
    leechers: 0,
    parsed: { resolution: 1080 },
    ...overrides,
  } as TorrentResult;
}

// --- link usability --------------------------------------------------------

test('a magnet is always usable and never needs refreshing', () => {
  // An infohash addresses content, not a server: there is nothing to expire.
  assert.equal(isLinkUsable(saved({ magnet: 'magnet:?xt=urn:btih:abc', directUrl: undefined })), true);
});

test('a direct link is usable only while its stated deadline holds', () => {
  const now = 1_000_000;
  assert.equal(isLinkUsable(saved({ expiresAt: now + 60_000 }), now), true);
  assert.equal(isLinkUsable(saved({ expiresAt: now - 1 }), now), false);
});

test('a direct link with no recorded deadline is treated as expired', () => {
  /**
   * The asymmetry is the reason. Guessing "still good" spends the ffmpeg
   * startup and the player's timeout before failing over; guessing "expired"
   * costs one provider call and produces a stream that works.
   */
  assert.equal(isLinkUsable(saved({ expiresAt: undefined })), false);
});

// --- matching --------------------------------------------------------------

test('a provider source is re-found even though its synthetic id changed', () => {
  // The case the whole file exists for: same release, new signed URL, new
  // SHA-1-of-the-URL identity. Matching on the id alone would never find it.
  assert.equal(matchesRelease(saved(), candidate()), true);
});

test('two torrents are matched on infohash alone', () => {
  const hash = 'a'.repeat(40);
  assert.equal(
    matchesRelease(
      saved({ infoHash: hash, magnet: `magnet:?xt=urn:btih:${hash}`, title: 'whatever' }),
      candidate({ infoHash: hash, magnet: `magnet:?xt=urn:btih:${hash}`, title: 'different name' })
    ),
    true
  );
});

test('the same release name from a different provider is not a match', () => {
  // A different site serving the same release is a different file, with
  // different headers and a different lifetime.
  assert.equal(matchesRelease(saved(), candidate({ indexerName: 'Cinefreak' })), false);
});

test('a different resolution is not a match', () => {
  // "1080p" versus "720p" is most of what a viewer is expressing when they
  // pick a source by hand.
  assert.equal(
    matchesRelease(saved(), candidate({ parsed: { resolution: 720 } as never })),
    false
  );
});

test('a genuinely different release from the same provider is not a match', () => {
  assert.equal(
    matchesRelease(saved(), candidate({ title: 'Oppenheimer 2023 1080p WEB-DL' })),
    false
  );
});

test('decorations added or dropped between refreshes still match', () => {
  // Providers append and drop a size, a mirror name, a [Dual Audio] tag.
  assert.equal(
    matchesRelease(saved(), candidate({ title: 'Dune Part Two 2024 1080p WEB-DL [Dual Audio]' })),
    true
  );
  assert.equal(
    matchesRelease(saved({ title: 'Dune Part Two 2024 1080p WEB-DL [Dual Audio] 2.4GB' }), candidate()),
    true
  );
});

test('punctuation and case differences do not defeat a match', () => {
  assert.equal(
    matchesRelease(saved(), candidate({ title: 'Dune.Part.Two.2024.1080p.WEB-DL' })),
    true
  );
});

// --- replacement selection -------------------------------------------------

test('an exact title wins over a decorated one', () => {
  const decorated = candidate({ title: 'Dune Part Two 2024 1080p WEB-DL [Dual Audio]' });
  const exact = candidate({ title: 'Dune Part Two 2024 1080p WEB-DL' });
  assert.equal(pickReplacement(saved(), [decorated, exact]), exact);
});

test('nothing matching returns null rather than a nearby release', () => {
  /**
   * The caller offers the full source list when this happens. Silently
   * starting something else is the failure this guards: the viewer asked to
   * resume *this* stream.
   */
  assert.equal(pickReplacement(saved(), [candidate({ indexerName: 'Somewhere Else' })]), null);
  assert.equal(pickReplacement(saved(), []), null);
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
