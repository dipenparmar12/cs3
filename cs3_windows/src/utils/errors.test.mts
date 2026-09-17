/**
 * What a thrown thing is reported as.
 *
 *   node --experimental-strip-types src/utils/errors.test.mts
 *
 * Pure, and worth pinning because every assertion here is about a message that
 * is *plausible* when it is wrong. Nothing errors, nothing looks broken — the
 * failure is that the tally downstream counts the wrong number of distinct
 * problems, or the viewer is shown two words they cannot act on.
 */
import assert from 'node:assert/strict';
import { describeError, isAbort } from './errors.ts';
import { classifyFailure } from '../../electron/cs3/failureTaxonomy.ts';

const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

/** Node's fetch failure, reproduced exactly: a bare message, reason in `cause`. */
function fetchFailure(code: string): Error {
  const error = new TypeError('fetch failed');
  (error as { cause?: unknown }).cause = Object.assign(new Error(code), { code });
  return error;
}

test('every description lands in the taxonomy row it means', () => {
  /**
   * The coupling this file has to `failureTaxonomy`, made explicit so it cannot
   * drift. These strings are fed to `classifyFailure` by the analytics and the
   * issue ledger, so the *wording* decides the category — and the taxonomy's
   * own warning applies to it: a plausible category on a real failure is the
   * worst answer a classifier can give.
   *
   * Every entry below was wrong on the first attempt at this table, and none of
   * them looked wrong. "Host not found (DNS blocked…)" contains "not found", so
   * a DNS failure was filed as `not-found` — "the page or file is gone, the link
   * was real when the provider produced it". "The site's certificate has
   * expired" contains "expired", so a TLS fault was filed as `expired` — "the
   * address carried a deadline; refresh the sources". Both send the reader
   * somewhere useless, and neither is visible from reading the sentence.
   */
  const cause = (code: string) => {
    const error = new TypeError('fetch failed');
    (error as { cause?: unknown }).cause = Object.assign(new Error(code), { code });
    return error;
  };

  const expected: Array<[string, string]> = [
    ['ENOTFOUND', 'network'],
    ['EAI_AGAIN', 'network'],
    ['ECONNREFUSED', 'network'],
    ['ECONNRESET', 'network'],
    // A connection timeout really is a timeout, and stays one.
    ['ETIMEDOUT', 'timeout'],
    ['EHOSTUNREACH', 'network'],
    ['ENETUNREACH', 'network'],
    ['EPROTO', 'network'],
    ['DEPTH_ZERO_SELF_SIGNED_CERT', 'network'],
    ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'network'],
    ['CERT_HAS_EXPIRED', 'network'],
  ];

  for (const [code, kind] of expected) {
    const described = describeError(cause(code));
    assert.equal(classifyFailure(described), kind, `${code}: "${described}"`);
  }

  const timeout = new Error('x');
  timeout.name = 'TimeoutError';
  assert.equal(classifyFailure(describeError(timeout)), 'timeout');

  const abort = new Error('x');
  abort.name = 'AbortError';
  assert.equal(classifyFailure(describeError(abort)), 'cancelled');

  // The taxonomy's catch-all matches anything containing "Error", so the
  // obvious fallback string would file a failure nobody could describe under
  // "the extension itself threw. Worth reporting to its maintainer".
  assert.equal(classifyFailure(describeError(undefined)), 'unknown');
});

test('a plain Error is its message', () => {
  assert.equal(describeError(new Error('Provider returned no links')), 'Provider returned no links');
});

test('fetch failed is replaced by the reason in cause', () => {
  /**
   * The case the module exists for. `fetch failed` is what the naive idiom
   * reports for DNS, refusal, reset, TLS and unreachable alike — so
   * `groupingForm` collapses the entire network family into one ledger row and
   * "how many distinct things are wrong" answers "one".
   */
  // The property, not the exact prose: `fetch failed` must not survive, and the
  // code must, because the code is the half that distinguishes one failure from
  // another and the half a maintainer can act on.
  for (const code of ['ENOTFOUND', 'ECONNREFUSED', 'EPROTO']) {
    const described = describeError(fetchFailure(code));
    assert.doesNotMatch(described, /fetch failed/, code);
    assert.match(described, new RegExp(code), code);
  }
  assert.match(describeError(fetchFailure('CERT_HAS_EXPIRED')), /certificate/i);

  // Distinctness is the point, not the wording: these must not collapse.
  const seen = new Set(
    ['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPROTO'].map((code) =>
      describeError(fetchFailure(code))
    )
  );
  assert.equal(seen.size, 5);
});

test('an unknown cause code is kept rather than dropped', () => {
  // The code is the half that distinguishes one failure from another, so a
  // code we have no sentence for still has to survive into the message.
  assert.equal(describeError(fetchFailure('EWEIRD')), 'EWEIRD');
  const withMessage = new Error('Upstream refused');
  (withMessage as { cause?: unknown }).cause = { code: 'EWEIRD' };
  assert.equal(describeError(withMessage), 'Upstream refused (EWEIRD)');
});

test('a timeout and a cancellation are told apart', () => {
  /**
   * Load-bearing, and not a wording preference. `classifyFailure` files
   * anything matching /cancell?ed/ under `cancelled`, which the issue ledger
   * drops rather than counting. Describing an abort with the word "timeout"
   * would score it against a provider for the app's own decision to stop
   * waiting — and the providers still running when a cancel lands are the
   * slowest ones, so it would rank exactly the wrong thing down.
   */
  const timeout = new Error('The operation was aborted due to timeout');
  timeout.name = 'TimeoutError';
  assert.equal(describeError(timeout), 'Timed out');

  const abort = new Error('This operation was aborted');
  abort.name = 'AbortError';
  assert.equal(describeError(abort), 'Cancelled');
  assert.match(describeError(abort), /cancell?ed/i);
  assert.doesNotMatch(describeError(abort), /timed? ?out/i);
});

test('a nested Error cause is unwrapped', () => {
  const outer = new Error('fetch failed');
  (outer as { cause?: unknown }).cause = new Error('socket hang up');
  assert.equal(describeError(outer), 'socket hang up');

  const informative = new Error('Could not resolve the source');
  (informative as { cause?: unknown }).cause = new Error('socket hang up');
  assert.equal(describeError(informative), 'Could not resolve the source: socket hang up');
});

test('a non-Error never renders as [object Object]', () => {
  // A rejected promise carrying a plain object is routine across IPC, and
  // `String({})` is the one answer that says less than nothing.
  assert.equal(describeError({ message: 'Sidecar is not running' }), 'Sidecar is not running');
  assert.equal(describeError({ error: 'PROVIDER_NOT_LOADED' }), 'PROVIDER_NOT_LOADED');
  assert.equal(describeError({ status: 503 }), '{"status":503}');
  assert.equal(describeError('a bare string'), 'a bare string');
});

test('nothing produces an empty description', () => {
  // A blank message is worse than a vague one: it renders as an empty element
  // and gives the reader no reason to look further.
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  for (const value of [undefined, null, '', {}, [], 0, false, new Error(''), circular]) {
    const described = describeError(value);
    assert.equal(typeof described, 'string');
    assert.ok(described.length > 0, `empty description for ${String(value)}`);
  }
});

test('isAbort recognises only a real abort', () => {
  const abort = new Error('x');
  abort.name = 'AbortError';
  assert.equal(isAbort(abort), true);

  const timeout = new Error('x');
  timeout.name = 'TimeoutError';
  assert.equal(isAbort(timeout), false, 'a timeout is a failure; an abort is not');
  assert.equal(isAbort(new Error('aborted')), false, 'the word in a message is not the name');
  assert.equal(isAbort('aborted'), false);
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
