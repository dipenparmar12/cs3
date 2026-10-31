import { test } from 'node:test';
import assert from 'node:assert/strict';

import { asSourceVerdict, verdictForProbeFailure, verdictLabel } from './sourceVerdict.ts';

test("the probe's finding names the row's state", () => {
  assert.equal(verdictForProbeFailure({ reason: '', dead: false, kind: 'login' }), 'restricted');
  assert.equal(verdictForProbeFailure({ reason: '', dead: false, kind: 'update-required' }), 'restricted');
  assert.equal(verdictForProbeFailure({ reason: '', dead: false, kind: 'rate-limited' }), 'temporarily-unavailable');
  assert.equal(verdictForProbeFailure({ reason: '', dead: false, kind: 'html' }), 'invalid');
  assert.equal(verdictForProbeFailure({ reason: '', dead: true, status: 404 }), 'invalid');
});

test('a failure nothing explains is only "did not play"', () => {
  assert.equal(verdictForProbeFailure({ reason: 'decoder', dead: false }), 'unplayable');
  assert.equal(verdictLabel(undefined), 'Did not play');
  assert.equal(verdictLabel('unplayable'), 'Did not play');
});

test('each state has its own words', () => {
  const labels = (['confirmed-mismatch', 'restricted', 'temporarily-unavailable', 'invalid', 'unplayable'] as const).map(
    verdictLabel
  );
  assert.equal(new Set(labels).size, labels.length);
});

test('only known states cross the boundary', () => {
  assert.equal(asSourceVerdict('restricted'), 'restricted');
  assert.equal(asSourceVerdict('validated'), undefined);
  assert.equal(asSourceVerdict(undefined), undefined);
  assert.equal(asSourceVerdict({}), undefined);
});
