import { test } from 'node:test';
import assert from 'node:assert/strict';

import { etaSeconds, smoothSpeed } from './progressSmoothing.ts';

test('one noisy sample moves the speed a little, not all the way', () => {
  const steady = smoothSpeed(undefined, 1_000_000);
  assert.equal(steady, 1_000_000, 'the first sample is taken as it is');
  const spike = smoothSpeed(steady, 10_000_000);
  assert.ok(spike < 4_000_000, `one spike to 10 MB/s reads as ${spike}`);
});

test('a zero sample decays toward a stall instead of dropping to nothing', () => {
  const after = smoothSpeed(1_000_000, 0);
  assert.ok(after > 0 && after < 1_000_000);
});

test('no ETA without a known size or a moving transfer', () => {
  assert.equal(etaSeconds(10, 0, 1000), 0, 'unknown size');
  assert.equal(etaSeconds(10, 100, 0), 0, 'nothing moving');
  assert.equal(etaSeconds(100, 100, 1000), 0, 'done');
  assert.equal(etaSeconds(0, 10_000, 1000), 10);
});
