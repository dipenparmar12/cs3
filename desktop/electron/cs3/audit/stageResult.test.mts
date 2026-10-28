import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AUDIT_SCHEMA_VERSION, type Outcome, type Owner, type Reason, type Stage, type StageRecord } from './schema.ts';
import { conservation, providerResult, reduceJournal } from './stageResult.ts';

function r(
  stage: Stage,
  outcome: Outcome,
  extra: { candidate?: string; owner?: Owner; reason?: Reason; providerId?: string; bytes?: number } = {}
): StageRecord {
  return {
    schema: AUDIT_SCHEMA_VERSION,
    runId: 'r',
    providerId: extra.providerId ?? 'X/P',
    stage,
    outcome,
    candidate: extra.candidate,
    owner: extra.owner,
    reason: extra.reason,
    evidence: {},
    bytes: extra.bytes ?? 0,
    ms: 1,
    retries: 0,
    at: '',
  };
}

const verdict = (...records: StageRecord[]) => providerResult('X/P', records).verdict;

test('one passing candidate passes a stage; the headline is the deepest pass', () => {
  const result = providerResult('X/P', [
    r('S1', 'pass'),
    r('S6', 'fail', { candidate: 'a', owner: 'provider-plugin' }),
    r('S6', 'pass', { candidate: 'b' }),
    r('S7', 'inconclusive', { reason: 'range-ignored' }),
  ]);
  assert.equal(result.stages.S6, 'pass');
  assert.equal(result.deepest, 'S6');
  assert.equal(result.verdict, 'extraction-only');
});

test('each verdict from its own evidence', () => {
  assert.equal(verdict(r('S1', 'pass'), r('S10', 'pass')), 'verified-playback');
  assert.equal(verdict(r('S1', 'fail', { owner: 'runtime' })), 'plugin-broken');
  assert.equal(verdict(r('S1', 'pass'), r('S2', 'fail', { owner: 'site' })), 'site-down');
  assert.equal(verdict(r('S7', 'pass'), r('S8', 'pass'), r('S9', 'pass')), 'compatible');
  assert.equal(verdict(r('S7', 'pass'), r('S8', 'pass'), r('S9', 'fail', { owner: 'app-media' })), 'app-gap');
  assert.equal(verdict(r('S7', 'pass'), r('S8', 'fail', { owner: 'app-media' })), 'app-gap');
  assert.equal(verdict(r('S7', 'pass'), r('S8', 'inconclusive', { reason: 'probe-incomplete' })), 'reachable-only');
  assert.equal(verdict(r('S3', 'inconclusive', { reason: 'challenge' })), 'walled');
  assert.equal(verdict(r('S3', 'pass'), r('S4', 'fail', { owner: 'provider-plugin' })), 'plugin-broken');
  assert.equal(verdict(r('S3', 'pass'), r('S4', 'pass'), r('S6', 'unsupported', { reason: 'not-offered' })), 'browse-only');
  assert.equal(verdict(r('S3', 'inconclusive', { reason: 'network-flaky' })), 'unverifiable');
  assert.equal(verdict(r('S0', 'skipped', { reason: 'adult-gate' })), 'skipped');
  assert.equal(verdict(), 'skipped');
});

test('a failure the environment caused does not make a plugin broken', () => {
  assert.equal(verdict(r('S3', 'pass'), r('S4', 'fail', { owner: 'environment' })), 'browse-only');
});

test('a resumed run rewrites a stage, never adds to it', () => {
  const reduced = reduceJournal([
    r('S6', 'fail', { candidate: 'a', owner: 'environment', bytes: 10 }),
    r('S6', 'pass', { candidate: 'a', bytes: 20 }),
    r('S6', 'pass', { candidate: 'b', bytes: 5 }),
  ]);
  const list = reduced.get('X/P')!;
  assert.equal(list.length, 2);
  assert.equal(providerResult('X/P', list).bytes, 25);
});

test('every discovered provider is accounted for once (AC-1)', () => {
  const results = [providerResult('A', [r('S1', 'pass', { providerId: 'A' })]), providerResult('B', [])];
  const held = conservation(['A', 'B'], results);
  assert.equal(held.holds, true);
  assert.equal((held.byVerdict.skipped ?? 0) + (held.byVerdict.unverifiable ?? 0), 2);
  const broken = conservation(['A', 'C'], results);
  assert.deepEqual(broken.missing, ['C']);
  assert.deepEqual(broken.extra, ['B']);
  assert.equal(broken.holds, false);
  assert.equal(conservation([], []).holds, true);
});
