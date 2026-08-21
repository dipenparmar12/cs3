/**
 * The IPC envelope, which sixty-eight handlers used to implement individually.
 *
 *   node --experimental-strip-types electron/ipc/envelope.test.mts
 *
 * This earns tests because it is about to be applied everywhere at once. A
 * subtle mistake here — an `ok` that overrides a deliberate `ok: false`, a
 * fallback that replaces a real payload, an error message that comes out
 * `[object Object]` — would not fail loudly in one place. It would change the
 * shape of every fallible reply in the app simultaneously, and each symptom
 * would look like a bug in the feature that reported it.
 *
 * The spread-order cases below are the ones worth reading: they pin behaviour
 * that the sixty-eight hand-written copies had, and that a naive helper loses.
 */
import assert from 'node:assert/strict';
import { failure, toEnvelope } from './envelope.ts';

const tests: Array<[string, () => Promise<void> | void]> = [];
const test = (name: string, fn: () => Promise<void> | void) => tests.push([name, fn]);

// --- failure() -------------------------------------------------------------

test('failure carries an Error message', () => {
  assert.deepEqual(failure(new Error('provider timed out')), {
    ok: false,
    error: 'provider timed out',
  });
});

test('failure stringifies a thrown non-Error', () => {
  // Extension and transport code throws strings and plain objects; a renderer
  // showing `[object Object]` tells the user nothing they can act on.
  assert.equal(failure('ECONNRESET').error, 'ECONNRESET');
  assert.equal(failure(404).error, '404');
});

// --- the success path ------------------------------------------------------

test('a resolved payload is merged under ok: true', async () => {
  const result = await toEnvelope(async () => ({ results: [1, 2, 3] }));
  assert.deepEqual(result, { ok: true, results: [1, 2, 3] });
});

test('a synchronous handler is wrapped just the same', async () => {
  assert.deepEqual(await toEnvelope(() => ({ count: 7 })), { ok: true, count: 7 });
});

test('an empty payload still reports success', async () => {
  assert.deepEqual(await toEnvelope(() => ({})), { ok: true });
});

test('a handler may answer ok: false for a validation failure', async () => {
  /**
   * This is the case a hard-coded `ok: true` would destroy. Several channels —
   * `download:setDeletePreference` is the clearest — reject an unknown value by
   * *returning* a failure rather than throwing, because a bad enum from the
   * renderer is an answer, not an exception. The payload spreads last so that
   * answer survives.
   */
  const result = await toEnvelope(() => ({
    ok: false as const,
    error: 'Unknown delete preference: sometimes',
  }));
  assert.deepEqual(result, { ok: false, error: 'Unknown delete preference: sometimes' });
});

// --- the failure path ------------------------------------------------------

test('a thrown error becomes the error half of the envelope', async () => {
  const result = await toEnvelope(() => {
    throw new Error('sidecar is not running');
  });
  assert.deepEqual(result, { ok: false, error: 'sidecar is not running' });
});

test('a rejected promise is treated identically to a throw', async () => {
  const result = await toEnvelope(async () => {
    throw new Error('scrape failed');
  });
  assert.deepEqual(result, { ok: false, error: 'scrape failed' });
});

test('the fallback payload is merged into a failure', async () => {
  /**
   * Why this exists at all: the renderer destructures these replies. A failed
   * search that answered `{ ok: false, error }` with no `results` would make
   * every caller's `results.map(…)` throw — turning a reported provider failure
   * into an unhandled renderer crash, which is the exact outcome the envelope
   * was introduced to prevent.
   */
  const result = await toEnvelope(
    () => {
      throw new Error('all providers timed out');
    },
    { results: [] as number[] }
  );
  assert.deepEqual(result, { ok: false, error: 'all providers timed out', results: [] });
});

test('a lazy fallback is only evaluated on failure', async () => {
  let evaluated = 0;
  const fallback = () => {
    evaluated++;
    return { progress: null };
  };

  await toEnvelope(() => ({ progress: 'running' }), fallback);
  assert.equal(evaluated, 0, 'the success path must not pay for the failure payload');

  await toEnvelope(() => {
    throw new Error('nope');
  }, fallback);
  assert.equal(evaluated, 1);
});

test('a fallback that throws does not replace the original error', async () => {
  // Some fallbacks read live state — `pluginManager.getProviderLoadProgress()`
  // among them. If that read is what is broken, the caller must still be told
  // why *their* call failed, not why the error path failed afterwards.
  const result = await toEnvelope(
    () => {
      throw new Error('the real problem');
    },
    () => {
      throw new Error('a second, unrelated problem');
    }
  );
  assert.deepEqual(result, { ok: false, error: 'the real problem' });
});

test('a fallback may state its own error text', async () => {
  // Mirror image of the validation case: the fallback spreads after the error,
  // so a channel that has a better sentence than the exception can supply it.
  const result = await toEnvelope(
    () => {
      throw new Error('ENOENT: no such file or directory');
    },
    { error: 'Downloads folder is missing', path: null }
  );
  assert.deepEqual(result, {
    ok: false,
    error: 'Downloads folder is missing',
    path: null,
  });
});

test('no fallback leaves the failure payload empty rather than undefined', async () => {
  const result = await toEnvelope(() => {
    throw new Error('x');
  });
  assert.deepEqual(Object.keys(result).sort(), ['error', 'ok']);
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
console.log(failed === 0 ? `\n${tests.length} passed` : `\n${failed} of ${tests.length} FAILED`);
process.exit(failed === 0 ? 0 : 1);
