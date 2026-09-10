/**
 * Which failures are evidence about a provider, and which are not.
 *
 *   bun run test failure-taxonomy
 *   node --experimental-strip-types electron/cs3/failureTaxonomy.test.mts
 *
 * The ranking has two stated rules — `empty` is not `failure`, and nothing is
 * ever silently punitive — and both were being broken by the same gap: the
 * guards lived in the callers. `loadLinksDetailed` wrote
 * `if (kind !== 'provider-missing')` out by hand and `searchEach` had no guard
 * at all, so whether the ranking followed its own rules depended on which call
 * site produced the failure.
 *
 * Every message below is real, taken from captured diagnostics.
 */
import assert from 'node:assert/strict';
import {
  FAILURE_KIND_LABELS,
  UNSCORED_FAILURE_KINDS,
  classifyFailure,
  groupingForm,
  isScoredFailure,
} from './failureTaxonomy.ts';

const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

// --- the four that must not be scored ------------------------------------------

/**
 * Measured on one real search: Disney, Marvel, Pixar and Star Wars are
 * catalogue-only providers, each answered this, and each was recorded as a
 * failed search. Four permanent penalties per query against providers working
 * exactly as designed.
 */
test('a provider that does not implement search is not scored for it', () => {
  const kind = classifyFailure('This provider does not implement that operation.');
  assert.equal(kind, 'unsupported-operation');
  assert.equal(isScoredFailure(kind), false);
});

test('a cancelled call is not scored — the app stopped waiting, not the provider', () => {
  for (const message of [
    'IOException: Canceled',
    'JobCancellationException: Parent job is Cancelling',
    'kotlinx.coroutines.JobCancellationException',
  ]) {
    assert.equal(isScoredFailure(classifyFailure(message)), false, message);
  }
});

test('a provider that was never asked is not scored', () => {
  const kind = classifyFailure('PROVIDER_NOT_LOADED: no loaded provider is named "X"');
  assert.equal(kind, 'provider-missing');
  assert.equal(isScoredFailure(kind), false);
});

/**
 * The scrape succeeded and left a socket open. It costs memory, not a stream —
 * a bug report for the maintainer, not a reason to stop asking.
 */
test('a leaked connection is not scored', () => {
  const kind = classifyFailure(
    'A connection to https://x.test/ was leaked. Did you forget to close a response body?'
  );
  assert.equal(kind, 'resource-leak');
  assert.equal(isScoredFailure(kind), false);
});

// --- what must still be scored ---------------------------------------------------

test('the failures that are genuinely about the provider are still scored', () => {
  for (const message of [
    'SocketTimeoutException: Read timed out',
    'SocketException: Connection reset',
    'UnknownHostException: No such host is known (watch32.sx)',
    'HTTP 403',
    'JsonParseException: Unrecognized token',
    'NoSuchMethodError: getResources',
  ]) {
    assert.equal(isScoredFailure(classifyFailure(message)), true, message);
  }
});

test('an unclassified failure is scored — silence is not a free pass', () => {
  assert.equal(classifyFailure('something nobody has seen before'), 'unknown');
  assert.equal(isScoredFailure('unknown'), true);
});

// --- the set itself -----------------------------------------------------------------

/**
 * A new category has to be a decision, not an omission. If this fails, someone
 * added a `FailureKind` and did not say whether it is evidence.
 */
test('every unscored kind is a real kind with a label', () => {
  for (const kind of UNSCORED_FAILURE_KINDS) {
    assert.ok(FAILURE_KIND_LABELS[kind], `${kind} has no label`);
  }
});

test('the scored and unscored sets partition the whole taxonomy', () => {
  const kinds = Object.keys(FAILURE_KIND_LABELS) as Array<keyof typeof FAILURE_KIND_LABELS>;
  assert.ok(kinds.length > UNSCORED_FAILURE_KINDS.size, 'not everything can be unscored');
  for (const kind of kinds) {
    assert.equal(
      isScoredFailure(kind),
      !UNSCORED_FAILURE_KINDS.has(kind),
      `${kind} disagrees with the set`
    );
  }
});

// --- classification order, which is load-bearing --------------------------------------

/**
 * A message can satisfy several patterns at once and the more specific reading
 * is the useful one — one needs a browser, the other needs a retry.
 */
test('a challenge behind a 403 is blocked, not merely network trouble', () => {
  assert.notEqual(classifyFailure('HTTP 403 after redirect to /cdn-cgi/challenge'), 'network');
});

/**
 * The bug this file already carried a note about: stack-frame line numbers read
 * as HTTP statuses, 23 miscounts in a real log.
 */
test('a stack frame is not read as an HTTP status', () => {
  const kind = classifyFailure(
    'ExtractorException at okhttp3.internal.connection.RealCall.execute(RealCall.java:519)'
  );
  assert.notEqual(kind, 'server-error', 'RealCall.java:519 is not a 5xx');
});

// --- grouping ---------------------------------------------------------------------------

test('bare integers stay apart, because 403 and 404 mean opposite things', () => {
  assert.notEqual(groupingForm('HTTP 403'), groupingForm('HTTP 404'));
});

test('durations and byte counts are folded out, because they differ every time', () => {
  assert.equal(groupingForm('failed after 1204ms'), groupingForm('failed after 8871ms'));
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
