/**
 * What the player does when a transport gives up.
 *
 *   bun run test playback-recovery
 *   node --experimental-strip-types src/components/player/playbackRecovery.test.mts
 *
 * The case worth protecting is `fragParsingError`. It is the error behind every
 * reported "it downloads but it will not stream": the segments arrive intact,
 * hls.js's JavaScript demuxer cannot read them, and until this module existed
 * the player printed the raw detail string and stopped — with mpv idle and the
 * next candidate untried. It must escalate, on the first occurrence, without
 * spending a retry on bytes that already arrived.
 *
 * The mirror-image case is `bufferStalledError` and friends, which must *not*
 * escalate on sight: a stall on a discontinuity is what `recoverMediaError()`
 * exists for, and handing a playing film to another engine over one is the
 * over-correction.
 */
import assert from 'node:assert/strict';
import {
  EMPTY_BUDGET,
  RECOVERY_LIMITS,
  classifyDashFailure,
  classifyHlsFailure,
  spend,
  type RecoveryBudget,
} from './playbackRecovery.ts';

const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

const hls = (
  details: string,
  extra: {
    type?: string;
    fatal?: boolean;
    spent?: RecoveryBudget;
    responseCode?: number;
  } = {}
) =>
  classifyHlsFailure({
    fatal: extra.fatal ?? true,
    type: extra.type ?? 'mediaError',
    details,
    spent: extra.spent ?? EMPTY_BUDGET,
    responseCode: extra.responseCode,
  });

// --- the reported failure ---------------------------------------------------

test('fragParsingError escalates immediately rather than retrying', () => {
  const action = hls('fragParsingError');
  assert.equal(action.kind, 'escalate');
});

test('a codec the browser cannot take escalates, it does not reload', () => {
  for (const details of [
    'manifestIncompatibleCodecsError',
    'bufferAddCodecError',
    'bufferIncompatibleCodecsError',
  ]) {
    assert.equal(hls(details).kind, 'escalate', details);
  }
});

// --- what must not escalate -------------------------------------------------

test('a non-fatal error is left to hls.js', () => {
  assert.equal(hls('fragParsingError', { fatal: false }).kind, 'ignore');
  assert.equal(hls('bufferStalledError', { fatal: false }).kind, 'ignore');
});

test('a stalled buffer is rebuilt before the source is blamed', () => {
  const action = hls('bufferStalledError');
  assert.equal(action.kind, 'recover-media');
});

test('a stalled buffer escalates once the rebuild budget is spent', () => {
  const action = hls('bufferStalledError', {
    spent: { reloads: 0, mediaRecoveries: RECOVERY_LIMITS.mediaRecoveries },
  });
  assert.equal(action.kind, 'escalate');
});

// --- transient fetches ------------------------------------------------------

test('a segment that failed to load is fetched again', () => {
  assert.equal(hls('fragLoadError', { type: 'networkError' }).kind, 'reload');
  assert.equal(hls('fragLoadTimeOut', { type: 'networkError' }).kind, 'reload');
  assert.equal(hls('levelLoadError', { type: 'networkError' }).kind, 'reload');
  assert.equal(hls('keyLoadError', { type: 'networkError' }).kind, 'reload');
});

test('reloading stops at the budget and hands the source on', () => {
  const action = hls('fragLoadError', {
    type: 'networkError',
    spent: { reloads: RECOVERY_LIMITS.reloads, mediaRecoveries: 0 },
  });
  assert.equal(action.kind, 'escalate');
});

test('a 404 on a segment is not retried', () => {
  const action = hls('fragLoadError', { type: 'networkError', responseCode: 404 });
  assert.equal(action.kind, 'escalate');
  assert.match(action.kind === 'escalate' ? action.reason : '', /404/);
});

/**
 * The rule `SourceCache.recordFailure` already follows, restated here because
 * the two would otherwise be free to disagree: an expired signed URL and
 * hotlink protection both answer 403, and both recover from a re-resolve.
 */
test('a 403 is still retried — it is not a permanent refusal', () => {
  assert.equal(hls('fragLoadError', { type: 'networkError', responseCode: 403 }).kind, 'reload');
});

// --- the playlist itself ----------------------------------------------------

test('a playlist that cannot be fetched or parsed escalates', () => {
  for (const details of [
    'manifestLoadError',
    'manifestLoadTimeOut',
    'manifestParsingError',
    'levelParsingError',
  ]) {
    assert.equal(hls(details, { type: 'networkError' }).kind, 'escalate', details);
  }
});

// --- encryption -------------------------------------------------------------

test('a refused key is named as encryption, not as a codec', () => {
  const action = hls('keySystemNoAccess', { type: 'keySystemError' });
  assert.equal(action.kind, 'escalate');
  assert.match(action.kind === 'escalate' ? action.reason : '', /encrypted/i);
});

// --- the open set -----------------------------------------------------------

test('an unrecognised detail escalates rather than looping', () => {
  const action = hls('someErrorHlsAddedLastTuesday', { type: 'otherError' });
  assert.equal(action.kind, 'escalate');
  assert.match(action.kind === 'escalate' ? action.reason : '', /someErrorHlsAddedLastTuesday/);
});

// --- DASH -------------------------------------------------------------------

test('a fatal Shaka failure escalates and keeps its reason', () => {
  const action = classifyDashFailure('3016: video error');
  assert.equal(action.kind, 'escalate');
  assert.equal(action.kind === 'escalate' ? action.reason : '', '3016: video error');
});

test('a Shaka failure with no reason still says something', () => {
  const action = classifyDashFailure('');
  assert.equal(action.kind, 'escalate');
  assert.ok((action.kind === 'escalate' ? action.reason : '').length > 0);
});

// --- the budget -------------------------------------------------------------

test('only the recovery that was taken is charged for', () => {
  assert.deepEqual(spend(EMPTY_BUDGET, { kind: 'reload', reason: '' }), {
    reloads: 1,
    mediaRecoveries: 0,
  });
  assert.deepEqual(spend(EMPTY_BUDGET, { kind: 'recover-media', reason: '' }), {
    reloads: 0,
    mediaRecoveries: 1,
  });
  assert.deepEqual(spend(EMPTY_BUDGET, { kind: 'escalate', reason: '' }), EMPTY_BUDGET);
  assert.deepEqual(spend(EMPTY_BUDGET, { kind: 'ignore' }), EMPTY_BUDGET);
});

/**
 * A whole stream's worth of trouble ends in an escalation, never in a loop.
 * The budget is what guarantees it, so it is asserted end to end rather than
 * only per-rung.
 */
test('repeated fetch failures terminate at an escalation', () => {
  let budget = EMPTY_BUDGET;
  const seen: string[] = [];
  for (let i = 0; i < 6; i++) {
    const action = hls('fragLoadError', { type: 'networkError', spent: budget });
    seen.push(action.kind);
    budget = spend(budget, action);
    if (action.kind === 'escalate') break;
  }
  assert.equal(seen.at(-1), 'escalate');
  assert.equal(seen.filter((k) => k === 'reload').length, RECOVERY_LIMITS.reloads);
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
