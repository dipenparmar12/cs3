/**
 * Whether a partial download survives its link being replaced.
 *
 *   bun run test:resume
 *   node --experimental-strip-types electron/download/resumePlan.test.mts
 *
 * Both directions of this decision fail silently, which is why it is pinned so
 * closely. Too eager appends the tail of one encode to the head of another and
 * produces a file that finalises, reports success, and does not play — the
 * viewer finds out when they sit down to watch it. Too cautious throws away
 * hours of transfer and reads as the app being unable to resume at all.
 *
 * The rows below are the shapes this actually meets: a re-signed CDN URL for
 * the identical file, a mirror serving a different encode at the same
 * resolution, and a host that answers every ranged request with the whole file
 * from byte zero.
 */
import assert from 'node:assert/strict';
import {
  containerFromUrl,
  containersAgree,
  overlapWindow,
  planResume,
  OVERLAP_WINDOW_BYTES,
  type ResumeEvidence,
} from './resumePlan.ts';

const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

/** The happy case: same release, same size, server honours Range. */
const MATCHING: ResumeEvidence = {
  partialBytes: 1_200_000_000,
  expectedTotalBytes: 4_000_000_000,
  remoteTotalBytes: 4_000_000_000,
  remoteSupportsRange: true,
  overlapVerified: true,
  sameProvider: true,
  sameResolution: true,
  sameContainer: true,
};

// --- the case the feature exists for ---------------------------------------

test('a re-signed link for the identical file resumes', () => {
  const decision = planResume(MATCHING);
  assert.equal(decision.action, 'resume');
  assert.equal(decision.keepBytes, 1_200_000_000);
  assert.equal(decision.cause, 'verified');
});

test('everything agreeing but unverified asks for the overlap check', () => {
  // The caller has not taken the window yet. This must not resume on the
  // strength of the cheap checks alone — they are all satisfied by a different
  // encode of the same film.
  const decision = planResume({ ...MATCHING, overlapVerified: undefined });
  assert.equal(decision.action, 'verify');
  assert.equal(decision.keepBytes, 1_200_000_000);
});

test('a byte mismatch at the boundary restarts', () => {
  const decision = planResume({ ...MATCHING, overlapVerified: false });
  assert.equal(decision.action, 'restart');
  assert.equal(decision.keepBytes, 0);
  assert.equal(decision.cause, 'overlap-mismatch');
});

// --- what the 20% heuristic used to let through -----------------------------

test('a size difference far below the old 20% tolerance still restarts', () => {
  /**
   * The exact pair the previous check could not tell apart: two encodes of one
   * film at one resolution, 1.5% apart. Under a 20% tolerance this resumed and
   * produced a corrupt file that reported success.
   */
  const decision = planResume({
    ...MATCHING,
    expectedTotalBytes: 4_000_000_000,
    remoteTotalBytes: 3_940_000_000,
  });
  assert.equal(decision.action, 'restart');
  assert.equal(decision.cause, 'size-mismatch');
});

test('no declared size restarts rather than trusting the overlap alone', () => {
  /**
   * The other half of the old bug: with no declared size the check did not run
   * and the partial was appended to unconditionally. A matching head does not
   * prove matching length, and a re-encode sharing a prefix is exactly the case
   * that finalises at the wrong length.
   */
  const decision = planResume({
    ...MATCHING,
    expectedTotalBytes: undefined,
    remoteTotalBytes: undefined,
  });
  assert.equal(decision.action, 'restart');
  assert.equal(decision.cause, 'unknown-length');
});

test('an absent expected size is not itself a mismatch', () => {
  // Providers frequently declare nothing. That must not force a restart when
  // the new source does declare a length and the bytes verify.
  const decision = planResume({ ...MATCHING, expectedTotalBytes: undefined });
  assert.equal(decision.action, 'resume');
});

// --- identity ---------------------------------------------------------------

test('a different provider, resolution or container restarts', () => {
  for (const key of ['sameProvider', 'sameResolution', 'sameContainer'] as const) {
    const decision = planResume({ ...MATCHING, [key]: false });
    assert.equal(decision.action, 'restart', key);
    assert.equal(decision.cause, 'identity-mismatch', key);
  }
});

test('identity is checked before anything that costs a request', () => {
  // A wrong release with an unknown length should say it is the wrong release,
  // not that the length is unknown — the reason is what the user reads.
  const decision = planResume({
    ...MATCHING,
    sameResolution: false,
    remoteTotalBytes: undefined,
  });
  assert.equal(decision.cause, 'identity-mismatch');
});

// --- arithmetic -------------------------------------------------------------

test('a partial longer than the remote file restarts', () => {
  const decision = planResume({ ...MATCHING, partialBytes: 4_000_000_001 });
  assert.equal(decision.action, 'restart');
  assert.equal(decision.cause, 'partial-too-long');
});

test('a partial exactly the size of the file is already finished', () => {
  // Transferring zero bytes and finalising is the right move; asking for
  // `bytes=N-` here is what produces the 416 the downloader has to special-case.
  const decision = planResume({ ...MATCHING, partialBytes: 4_000_000_000 });
  assert.equal(decision.action, 'complete');
  assert.equal(decision.keepBytes, 4_000_000_000);
});

test('an empty partial restarts without pretending anything is wrong', () => {
  const decision = planResume({ ...MATCHING, partialBytes: 0 });
  assert.equal(decision.action, 'restart');
  assert.equal(decision.cause, 'nothing-to-keep');
});

// --- the honest limit -------------------------------------------------------

test('a server that ignores Range restarts, and says that is why', () => {
  /**
   * Measured shape, from `video-downloads.googleusercontent.com`: answers every
   * ranged request with 200 and the whole file. The bytes genuinely cannot be
   * continued, and this is the one restart where nothing is wrong with either
   * file — so it gets its own cause rather than reading as a mismatch.
   */
  const decision = planResume({ ...MATCHING, remoteSupportsRange: false });
  assert.equal(decision.action, 'restart');
  assert.equal(decision.cause, 'no-range');
  assert.match(decision.reason, /whole file/);
});

test('a real mismatch outranks the Range limitation in the message', () => {
  // Both are true. The user is better served by "different copy" than by
  // "cannot continue part-way", because only one of them is actionable.
  const decision = planResume({
    ...MATCHING,
    remoteSupportsRange: false,
    remoteTotalBytes: 123,
    expectedTotalBytes: 4_000_000_000,
  });
  assert.equal(decision.cause, 'size-mismatch');
});

// --- the overlap window -----------------------------------------------------

test('the window never exceeds what is on disk and is never empty', () => {
  assert.deepEqual(overlapWindow(1000), { start: 0, end: 999 });
  assert.deepEqual(overlapWindow(OVERLAP_WINDOW_BYTES * 4), {
    start: OVERLAP_WINDOW_BYTES * 3,
    end: OVERLAP_WINDOW_BYTES * 4 - 1,
  });
  // A zero-length range proves nothing and some servers answer it with the
  // whole file, so it is refused rather than requested.
  assert.equal(overlapWindow(0), null);
  assert.equal(overlapWindow(-5), null);
});

// --- containers -------------------------------------------------------------

test('a container is read from the path, never from the query string', () => {
  assert.equal(containerFromUrl('https://cdn.example/film.mkv?Expires=1&Signature=x'), 'mkv');
  assert.equal(containerFromUrl('https://cdn.example/film.mp4#t=10'), 'mp4');
  assert.equal(containerFromUrl('https://cdn.example/get?id=abc'), null);
  assert.equal(containerFromUrl('https://cdn.example/film.php'), null);
});

test('an opaque address agrees with anything', () => {
  /**
   * Deliberate. Most provider links are `?id=…` with no extension at all, and a
   * container check that refused those would refuse nearly every resume — which
   * is how a safety check comes to be switched off wholesale.
   */
  assert.equal(containersAgree('https://a/get?id=1', 'https://b/film.mkv'), true);
  assert.equal(containersAgree('https://a/film.mkv', 'https://b/get?id=1'), true);
  assert.equal(containersAgree('https://a/film.mkv', 'https://b/film.mkv'), true);
});

test('a positive disagreement is rejected', () => {
  assert.equal(containersAgree('https://a/film.mkv', 'https://b/film.mp4'), false);
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
