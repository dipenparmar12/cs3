import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { ProviderAnalyticsRecord } from '../../src/types/analytics';
import { countVerdict, rightContentRate } from './validationCounts.ts';

function record(playbackSuccesses = 0): ProviderAnalyticsRecord {
  const counters = () => ({ attempts: 0, successes: 0, empty: 0, failures: 0, produced: 0, latencySumMs: 0, latencySamples: 0 });
  return {
    provider: 'P',
    firstSeenAt: 0,
    lastSeenAt: 0,
    stages: {
      search: counters(),
      detail: counters(),
      links: counters(),
      playback: { ...counters(), attempts: playbackSuccesses, successes: playbackSuccesses },
      download: counters(),
    } as ProviderAnalyticsRecord['stages'],
    failureKinds: {},
  };
}

test('each verdict that says something is counted; "did not play" is not', () => {
  const r = record();
  assert.equal(countVerdict(r, 'confirmed-mismatch'), true);
  assert.equal(countVerdict(r, 'confirmed-mismatch'), true);
  assert.equal(countVerdict(r, 'restricted'), true);
  assert.equal(countVerdict(r, 'unplayable'), false);
  assert.deepEqual(r.validation, { 'confirmed-mismatch': 2, restricted: 1 });
});

test('nothing played is no evidence either way', () => {
  assert.deepEqual(rightContentRate(record(), 5, 0.5), { rate: null, samples: 0, mismatches: 0 });
});

test('a provider whose plays were the title outranks one that served adverts', () => {
  const good = record(10);
  const bad = record(10);
  for (let i = 0; i < 6; i++) countVerdict(bad, 'confirmed-mismatch');
  const goodRate = rightContentRate(good, 5, 0.5).rate!;
  const badRate = rightContentRate(bad, 5, 0.5).rate!;
  assert.ok(goodRate > badRate, `${goodRate} > ${badRate}`);
  assert.equal(rightContentRate(bad, 5, 0.5).mismatches, 6);
});

test('one advert does not condemn a provider', () => {
  const once = record(1);
  countVerdict(once, 'confirmed-mismatch');
  // Smoothed toward neutral: well above zero.
  assert.ok(rightContentRate(once, 5, 0.5).rate! > 0.4);
});
