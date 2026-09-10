/**
 * Timeout budgeting, circuit escalation, and search order.
 *
 *   bun run test indexer-budget
 *   node --experimental-strip-types electron/torrent/indexerBudget.test.mts
 *
 * The two rules worth protecting are the ones that look like over-engineering
 * until an indexer is on the wrong side of them:
 *
 *  - **An unmeasured indexer gets the full budget.** Deriving a deadline from
 *    one or two samples is how a slow-but-working source gets designated dead
 *    on its first bad afternoon and never asked again.
 *  - **A success clears the trip count.** Without that, an indexer that came
 *    back after an outage carries a 45-minute cooldown for its next single
 *    hiccup, months later.
 */
import assert from 'node:assert/strict';
import {
  COOLDOWN_LADDER_MS,
  EMPTY_OBSERVATION,
  LATENCY_SAMPLES,
  MIN_SAMPLES_FOR_BUDGET,
  TIMEOUT_CEILING_MS,
  TIMEOUT_FLOOR_MS,
  cooldownMs,
  describeSkip,
  isSkipped,
  observe,
  searchOrder,
  timeoutFor,
  type IndexerObservation,
} from './indexerBudget.ts';

const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

/** An observation built by feeding it `n` successes at `ms`. */
const answering = (ms: number, n = LATENCY_SAMPLES): IndexerObservation => {
  let obs = EMPTY_OBSERVATION;
  for (let i = 0; i < n; i++) obs = observe(obs, 'ok', ms);
  return obs;
};

const failing = (
  outcome: 'timeout' | 'error',
  n: number,
  from: IndexerObservation = EMPTY_OBSERVATION
): IndexerObservation => {
  let obs = from;
  for (let i = 0; i < n; i++) obs = observe(obs, outcome, TIMEOUT_CEILING_MS);
  return obs;
};

// --- the deadline -----------------------------------------------------------

test('an indexer with no history gets the whole budget', () => {
  assert.equal(timeoutFor(EMPTY_OBSERVATION), TIMEOUT_CEILING_MS);
});

test('one or two samples are still not enough to judge on', () => {
  for (let n = 1; n < MIN_SAMPLES_FOR_BUDGET; n++) {
    assert.equal(timeoutFor(answering(400, n)), TIMEOUT_CEILING_MS, `${n} samples`);
  }
});

test('a consistently fast indexer is held to the floor, not to 20s', () => {
  const budget = timeoutFor(answering(400));
  assert.equal(budget, TIMEOUT_FLOOR_MS);
  assert.ok(budget < TIMEOUT_CEILING_MS);
});

test('a moderately slow indexer gets room above its own latency', () => {
  const budget = timeoutFor(answering(4_000));
  assert.ok(budget > 4_000, `budget ${budget} must exceed the observed 4000ms`);
  assert.ok(budget <= TIMEOUT_CEILING_MS);
});

test('the budget never exceeds the ceiling however slow the indexer is', () => {
  assert.equal(timeoutFor(answering(30_000)), TIMEOUT_CEILING_MS);
});

/**
 * The reason it is p90 and not the mean: an indexer that usually answers in
 * 500 ms and occasionally takes 3 s is a normal indexer. Its deadline has to
 * cover the tail it depends on, or the tail becomes a timeout that counts
 * against it.
 */
test('an occasional slow answer is inside the budget, not cut off by it', () => {
  let obs = EMPTY_OBSERVATION;
  for (let i = 0; i < 9; i++) obs = observe(obs, 'ok', 500);
  obs = observe(obs, 'ok', 3_000);
  assert.ok(timeoutFor(obs) >= 3_000, `budget ${timeoutFor(obs)} must cover the 3s tail`);
});

test('only successes shape the budget', () => {
  const fast = answering(400);
  const afterTimeouts = failing('timeout', 2, fast);
  assert.equal(
    timeoutFor(afterTimeouts),
    timeoutFor(fast),
    'a timeout must not buy an indexer a longer deadline'
  );
});

test('the latency window is bounded', () => {
  let obs = EMPTY_OBSERVATION;
  for (let i = 0; i < LATENCY_SAMPLES * 3; i++) obs = observe(obs, 'ok', 100);
  assert.equal(obs.latencies.length, LATENCY_SAMPLES);
});

// --- opening the circuit ----------------------------------------------------

test('three ordinary errors open the circuit', () => {
  assert.ok(!failing('error', 2).openedAt, 'two errors is not yet a verdict');
  assert.ok(failing('error', 3).openedAt);
});

/**
 * A timeout costs the whole search to discover and an error costs one round
 * trip. Treating them as the same evidence is what made a blocked scraper cost
 * a full minute before it was skipped.
 */
test('two timeouts open it, because a timeout costs fifty times as much', () => {
  assert.ok(!failing('timeout', 1).openedAt);
  assert.ok(failing('timeout', 2).openedAt);
});

test('a success clears the failures without opening anything', () => {
  const recovered = observe(failing('error', 2), 'ok', 800);
  assert.equal(recovered.consecutiveFailures, 0);
  assert.equal(recovered.consecutiveTimeouts, 0);
  assert.equal(recovered.openedAt, undefined);
});

// --- the cooldown ladder ----------------------------------------------------

test('the first trip is the shortest cooldown', () => {
  assert.equal(cooldownMs(failing('error', 3)), COOLDOWN_LADDER_MS[0]);
});

test('re-tripping costs longer each time, up to the cap', () => {
  let obs = failing('error', 3);
  const seen = [cooldownMs(obs)];
  for (let trip = 0; trip < 5; trip++) {
    // Out of cooldown, tries again, fails again.
    obs = { ...obs, openedAt: undefined, consecutiveFailures: 0, consecutiveTimeouts: 0 };
    obs = failing('error', 3, obs);
    seen.push(cooldownMs(obs));
  }
  for (let i = 1; i < seen.length; i++) {
    assert.ok(seen[i] >= seen[i - 1], `cooldown must not shrink: ${seen.join(', ')}`);
  }
  assert.equal(seen.at(-1), COOLDOWN_LADDER_MS.at(-1), 'and it stops at the cap');
});

/**
 * The rule that keeps the ladder from becoming a punishment: an indexer that is
 * answering again starts from the bottom rung.
 */
test('answering again resets the ladder', () => {
  let obs = failing('error', 3);
  obs = { ...obs, openedAt: undefined };
  obs = failing('error', 3, obs);
  assert.equal(cooldownMs(obs), COOLDOWN_LADDER_MS[1]);

  const recovered = observe(obs, 'ok', 500);
  assert.equal(recovered.trips, 0);
  assert.equal(cooldownMs(failing('error', 3, recovered)), COOLDOWN_LADDER_MS[0]);
});

// --- being skipped ----------------------------------------------------------

test('a healthy indexer is never skipped', () => {
  assert.equal(isSkipped(answering(500)), false);
  assert.equal(isSkipped(EMPTY_OBSERVATION), false);
});

test('a tripped indexer is skipped, and stops being skipped', () => {
  const obs = failing('error', 3);
  const opened = obs.openedAt ?? 0;
  assert.equal(isSkipped(obs, opened + 1_000), true);
  assert.equal(isSkipped(obs, opened + COOLDOWN_LADDER_MS[0] + 1), false);
});

test('the skip explains itself, and names the cause', () => {
  const timedOut = failing('timeout', 2);
  const opened = timedOut.openedAt ?? 0;
  assert.match(describeSkip(timedOut, opened + 1_000), /timing out/);
  assert.match(describeSkip(failing('error', 3), Date.now()), /failing/);
  assert.equal(describeSkip(EMPTY_OBSERVATION), '', 'nothing to say about a healthy indexer');
});

// --- ordering ---------------------------------------------------------------

test('proven and fast comes before proven and slow', () => {
  const observations = new Map([
    ['slow', answering(6_000)],
    ['fast', answering(300)],
  ]);
  const order = searchOrder([{ id: 'slow' }, { id: 'fast' }], observations);
  assert.deepEqual(order.map((e) => e.id), ['fast', 'slow']);
});

/**
 * The interesting band. A newly added Torznab endpoint goes ahead of a site
 * that timed out an hour ago — putting the unproven last is how an indexer
 * never accumulates the history that would let it be ranked at all.
 */
test('an unproven indexer outranks one that is recovering from failure', () => {
  const observations = new Map([
    ['recovering', failing('error', 1, answering(500))],
    ['new', EMPTY_OBSERVATION],
  ]);
  const order = searchOrder([{ id: 'recovering' }, { id: 'new' }], observations);
  assert.deepEqual(order.map((e) => e.id), ['new', 'recovering']);
});

test('proven still outranks unproven', () => {
  const observations = new Map([['proven', answering(900)]]);
  const order = searchOrder([{ id: 'new' }, { id: 'proven' }], observations);
  assert.deepEqual(order.map((e) => e.id), ['proven', 'new']);
});

/**
 * The guard `searchOrder` shares with `cs3/searchOrder.ts`: an ordering that
 * silently drops a source turns "we searched fewer places" into "there are no
 * results", which is the worst failure this app has.
 */
test('ordering is a permutation — nothing is dropped or invented', () => {
  const entries = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
  const observations = new Map([
    ['a', answering(5_000)],
    ['c', failing('timeout', 1)],
  ]);
  const order = searchOrder(entries, observations);
  assert.equal(order.length, entries.length);
  assert.deepEqual(
    order.map((e) => e.id).sort(),
    entries.map((e) => e.id).sort()
  );
});

test('ordering an empty list is not an error', () => {
  assert.deepEqual(searchOrder([], new Map()), []);
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
