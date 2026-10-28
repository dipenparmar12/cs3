import { test } from 'node:test';
import assert from 'node:assert/strict';

import { attribute } from './attribution.ts';

test('the owner table, row by row', () => {
  assert.equal(attribute({ stage: 'S2', cause: 'not-found' }), 'site');
  assert.equal(attribute({ stage: 'S2' }), 'site');
  assert.equal(attribute({ stage: 'S4', cause: 'provider-error', siteAlive: true }), 'provider-plugin');
  assert.equal(attribute({ stage: 'S5', cause: 'runtime-unavailable' }), 'runtime');
  assert.equal(attribute({ stage: 'S1', cause: 'provider-error' }), 'runtime');
  assert.equal(attribute({ stage: 'S8', cause: 'unreadable-reply', sourceValid: true }), 'app-media');
  assert.equal(attribute({ stage: 'S7', reason: 'needs-webview' }), 'app-host');
  assert.equal(attribute({ stage: 'S3', reason: 'challenge' }), 'app-host');
  assert.equal(attribute({ stage: 'S7', reason: 'geo-blocked' }), 'environment');
  assert.equal(attribute({ stage: 'S4', cause: 'timeout', siteAlive: false }), 'environment');
  assert.equal(attribute({ stage: 'S7', reason: 'budget-exhausted' }), 'inconclusive-audit');
});

test('a timeout from a provider whose site answers is the provider', () => {
  assert.equal(attribute({ stage: 'S4', cause: 'timeout', siteAlive: true }), 'provider-plugin');
});

test('a runtime class error is ours at every stage', () => {
  for (const stage of ['S2', 'S6', 'S8'] as const) {
    assert.equal(attribute({ stage, cause: 'runtime-unavailable' }), 'runtime');
  }
});

test('the media stages are only ours when the source itself was valid', () => {
  assert.equal(attribute({ stage: 'S8', cause: 'unreadable-reply' }), 'provider-plugin');
});
