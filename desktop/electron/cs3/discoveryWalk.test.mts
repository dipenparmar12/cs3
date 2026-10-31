import { test } from 'node:test';
import assert from 'node:assert/strict';

import { planDiscoveryWalk, walkDiscovery } from './discoveryWalk.ts';

const ranked = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];

test('the plan asks every provider exactly once, preferred ones first', () => {
  const batches = planDiscoveryWalk({ ranked, preferred: ['g', 'x'], firstBatch: 3, batchSize: 4 });
  assert.deepEqual(batches, [['g', 'a', 'b'], ['c', 'd', 'e', 'f'], ['h', 'i', 'j']]);
  assert.deepEqual(batches.flat().sort(), [...ranked].sort(), 'ranking orders, never drops');
});

test('more preferred providers than fit the first batch lead the next one', () => {
  const batches = planDiscoveryWalk({ ranked, preferred: ['j', 'i', 'h'], firstBatch: 2, batchSize: 3 });
  assert.deepEqual(batches[0], ['j', 'i']);
  assert.deepEqual(batches[1], ['h', 'a', 'b']);
  assert.equal(batches.flat().length, ranked.length);
});

test('nothing to ask is no batches', () => {
  assert.deepEqual(planDiscoveryWalk({ ranked: [], preferred: ['a'], firstBatch: 3, batchSize: 4 }), []);
});

function clock() {
  let t = 0;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

test('the walk stops before the next batch once a verified source is in', async () => {
  let verified = false;
  const outcome = await walkDiscovery({
    batches: [['a'], ['b'], ['c']],
    runBatch: async (names) => {
      if (names.includes('a')) verified = true;
    },
    verifiedFound: () => verified,
    budgetMs: 60_000,
    now: () => 0,
  });
  assert.equal(outcome.stoppedBy, 'verified');
  assert.deepEqual(outcome.asked, ['a']);
  assert.deepEqual(outcome.remaining, ['b', 'c']);
});

test('the walk stops at its budget, and says what was never asked', async () => {
  const time = clock();
  const outcome = await walkDiscovery({
    batches: [['a'], ['b'], ['c']],
    runBatch: async () => void time.advance(30_000),
    verifiedFound: () => false,
    budgetMs: 45_000,
    now: time.now,
  });
  assert.equal(outcome.stoppedBy, 'budget');
  assert.deepEqual(outcome.asked, ['a', 'b']);
  assert.deepEqual(outcome.remaining, ['c']);
});

test('the first batch always runs, even on a spent budget or an early verified source', async () => {
  const outcome = await walkDiscovery({
    batches: [['a'], ['b']],
    runBatch: async () => {},
    verifiedFound: () => true,
    budgetMs: 0,
    now: () => 0,
  });
  assert.deepEqual(outcome.asked, ['a']);
});

test('nothing verified and time to spare walks to the end', async () => {
  const outcome = await walkDiscovery({
    batches: [['a', 'b'], ['c']],
    runBatch: async () => {},
    verifiedFound: () => false,
    budgetMs: 60_000,
    now: () => 0,
  });
  assert.equal(outcome.stoppedBy, 'finished');
  assert.deepEqual(outcome.asked, ['a', 'b', 'c']);
});

test('a cancelled walk asks nothing further', async () => {
  const controller = new AbortController();
  const outcome = await walkDiscovery({
    batches: [['a'], ['b']],
    runBatch: async () => controller.abort(),
    verifiedFound: () => false,
    budgetMs: 60_000,
    now: () => 0,
    signal: controller.signal,
  });
  assert.equal(outcome.stoppedBy, 'cancelled');
  assert.deepEqual(outcome.remaining, ['b']);
});
