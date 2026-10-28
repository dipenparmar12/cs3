import { test } from 'node:test';
import assert from 'node:assert/strict';

import { diffRuns, hasRegressions, type RunEntry } from './diff.ts';

const entry = (over: Partial<RunEntry> = {}): RunEntry => ({
  providerId: 'X/P',
  deepest: 'S8',
  verdict: 'compatible',
  blame: { archiveSha256: 'a1', runtime: '17', appSha: 'abc', siteAlive: true },
  ...over,
});
const only = (previous: RunEntry[], current: RunEntry[]) => diffRuns(previous, current)[0];

test('a regression names the dimension that moved and its owner', () => {
  const plugin = only([entry()], [entry({ deepest: 'S6', verdict: 'extraction-only', blame: { ...entry().blame, archiveSha256: 'a2' } })]);
  assert.equal(plugin.change, 'REGRESSED');
  assert.deepEqual(plugin.moved, ['plugin']);
  assert.equal(plugin.owner, 'provider');
  const ours = only([entry()], [entry({ deepest: 'S7', verdict: 'reachable-only', blame: { ...entry().blame, runtime: '18' } })]);
  assert.equal(ours.owner, 'ours');
  const site = only([entry()], [entry({ deepest: 'S1', verdict: 'site-down', blame: { ...entry().blame, siteAlive: false } })]);
  assert.equal(site.owner, 'site');
  assert.equal(hasRegressions([plugin]), true);
});

test('improvements, flakes, drift, new and gone', () => {
  assert.equal(only([entry({ deepest: 'S6', verdict: 'extraction-only' })], [entry()]).change, 'IMPROVED');
  assert.equal(only([entry()], [entry({ deepest: 'S6', verdict: 'extraction-only', flaky: true })]).change, 'FLAKY');
  assert.equal(only([entry({ shapeFingerprint: 'a' })], [entry({ shapeFingerprint: 'b' })]).change, 'SHAPE_DRIFT');
  assert.equal(only([entry({ capabilities: ['dash'] })], [entry({ capabilities: ['dash', 'subtitles'] })]).change, 'NEW_SUPPORT');
  assert.equal(only([], [entry({ verdict: 'plugin-broken', deepest: null })]).change, 'NEW_BROKEN');
  assert.equal(only([], [entry()]).change, 'NEW_SUPPORT');
  assert.equal(only([entry()], []).change, 'GONE');
  assert.equal(only([entry()], [entry()]).change, 'UNCHANGED');
});

test('the same stage with a worse verdict is a regression; a flaky one is not', () => {
  assert.equal(only([entry()], [entry({ verdict: 'app-gap' })]).change, 'REGRESSED');
  assert.equal(hasRegressions(diffRuns([entry()], [entry({ verdict: 'app-gap', flaky: true })])), false);
});

test('two empty runs differ in nothing', () => {
  assert.deepEqual(diffRuns([], []), []);
});
