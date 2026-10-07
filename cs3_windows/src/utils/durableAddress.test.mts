import { test } from 'node:test';
import assert from 'node:assert/strict';
import { durableAddress, isLoopbackUrl } from './durableAddress.ts';

test('loopback addresses are recognised', () => {
  assert.equal(isLoopbackUrl('http://127.0.0.1:4312/stream/abc'), true);
  assert.equal(isLoopbackUrl('http://localhost:9000/x'), true);
  assert.equal(isLoopbackUrl('cs3ext://HDO/page'), false);
  assert.equal(isLoopbackUrl('not a url'), false);
});

test('the first non-loopback candidate wins', () => {
  assert.equal(durableAddress(undefined, 'http://127.0.0.1:1/stream/a', 'cs3ext://P/page'), 'cs3ext://P/page');
  assert.equal(durableAddress('cs3meta://tt1'), 'cs3meta://tt1');
  assert.equal(durableAddress('http://127.0.0.1:1/x'), '');
});
