/**
 * The margin that decides whether the browser's work is kept or thrown away.
 *
 *   bun run test host-deadline
 *   node --experimental-strip-types electron/cs3/hostDeadline.test.mts
 *
 * The invariant the module exists to hold is the first test: the worker
 * finishes before the waiter gives up. Everything else is the arithmetic that
 * keeps that true at both ends of the range.
 */
import assert from 'node:assert/strict';
import {
  DELIVERY_RESERVE_MS,
  MIN_WORKING_MS,
  hostBudget,
} from './hostDeadline.ts';

const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

// --- the invariant -----------------------------------------------------------

test('the worker always finishes before the waiter gives up', () => {
  for (const deadline of [1_100, 2_000, 4_000, 8_000, 15_000, 30_000, 60_000, 180_000]) {
    assert.ok(
      hostBudget(deadline) < deadline,
      `${deadline}ms deadline produced a budget of ${hostBudget(deadline)}ms, which is not less`
    );
  }
});

/**
 * The case that was actually happening. `WebViewResolver`'s default deadline is
 * 15s, the host spent all 15s, and answered at 15021–15273ms to a waiter that
 * stopped at 15000ms.
 */
test('the measured failure no longer overruns', () => {
  const budget = hostBudget(15_000);
  assert.equal(budget, 13_500);
  // Every overshoot recorded in the three sessions was under 300ms.
  assert.ok(15_000 - budget > 300, 'the margin must cover the observed overshoot');
});

test('a resolve that used to match still fits comfortably', () => {
  // The slowest match recorded across 214 resolves was 6420ms.
  assert.ok(hostBudget(15_000) > 6_420);
});

// --- the reserve -------------------------------------------------------------

test('a long deadline pays the same flat reserve, not a proportional one', () => {
  assert.equal(hostBudget(60_000), 60_000 - DELIVERY_RESERVE_MS);
  assert.equal(hostBudget(180_000), 180_000 - DELIVERY_RESERVE_MS);
});

test('a short deadline is not eaten by a reserve sized for a long one', () => {
  // A flat 1500ms off 4000ms would leave 62% of the budget; the fraction cap
  // keeps it at three quarters.
  assert.equal(hostBudget(4_000), 3_000);
});

test('at the floor there is nothing left to reserve, and the floor is returned', () => {
  assert.equal(hostBudget(MIN_WORKING_MS), MIN_WORKING_MS);
  assert.equal(hostBudget(0), MIN_WORKING_MS);
  assert.equal(hostBudget(-5), MIN_WORKING_MS);
});

test('a budget is never below the floor, whatever is asked for', () => {
  for (const deadline of [-1, 0, 1, 500, 999, 1_000, 1_001]) {
    assert.ok(hostBudget(deadline) >= MIN_WORKING_MS, `${deadline}`);
  }
});

// --- the ceiling -------------------------------------------------------------

test('a caller asking for a week is bounded, and still gets its margin', () => {
  const budget = hostBudget(7 * 24 * 3_600_000, { ceilingMs: 180_000 });
  assert.equal(budget, 180_000 - DELIVERY_RESERVE_MS);
  assert.ok(budget < 180_000);
});

test('a deadline under the ceiling is not raised to it', () => {
  assert.equal(hostBudget(5_000, { ceilingMs: 180_000 }), 5_000 - 1_250);
});

// --- degenerate input --------------------------------------------------------

/**
 * `timeoutMs` arrives from a JSON document written by a provider, through two
 * class loaders. It is not necessarily a number, and a `NaN` budget would make
 * `setTimeout` fire immediately — every resolve answering "found nothing" in
 * the same tick, which reads exactly like a browser that does not work.
 */
test('a deadline that is not a number does not become an instant timeout', () => {
  assert.equal(hostBudget(Number.NaN), MIN_WORKING_MS);
  assert.equal(hostBudget(Number.POSITIVE_INFINITY, { ceilingMs: 180_000 }), 178_500);
});

// --- runner ------------------------------------------------------------------

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
