import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isTransientFailure, ProviderCooldown } from './providerCooldown.ts';

function clock() {
  let t = 1_000_000;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

test('two transient failures in a row start a cooldown; one does not', () => {
  const time = clock();
  const cooldown = new ProviderCooldown(time.now);
  cooldown.record('HDO', 'HTTP 429 Too Many Requests');
  assert.equal(cooldown.remaining('HDO'), 0);
  cooldown.record('HDO', 'timed out after 20s');
  assert.equal(cooldown.remaining('HDO'), 60_000);
  assert.deepEqual(cooldown.partition(['HDO', 'Other']).ask, ['Other']);
});

test('the cooldown escalates, and any success resets it', () => {
  const time = clock();
  const cooldown = new ProviderCooldown(time.now);
  for (const expected of [60_000, 300_000, 900_000, 3_600_000, 3_600_000]) {
    cooldown.record('X', 'Connection reset');
    cooldown.record('X', 'Connection reset');
    assert.equal(cooldown.remaining('X'), expected);
    time.advance(expected);
  }
  cooldown.record('X', undefined);
  cooldown.record('X', 'ECONNRESET');
  assert.equal(cooldown.remaining('X'), 0, 'one failure after a success is not a cooldown');
});

test('a provider that answers with an error that is not "not now" is never cooled', () => {
  const cooldown = new ProviderCooldown();
  for (let i = 0; i < 5; i++) cooldown.record('Y', 'does not implement search');
  assert.equal(cooldown.remaining('Y'), 0);
  assert.equal(isTransientFailure('NullPointerException in parser'), false);
  assert.equal(isTransientFailure('403 Forbidden'), true);
});

test('cooling providers are reported with how long they wait', () => {
  const time = clock();
  const cooldown = new ProviderCooldown(time.now);
  cooldown.record('Z', '503 Service Unavailable');
  cooldown.record('Z', '503 Service Unavailable');
  time.advance(20_000);
  assert.deepEqual(cooldown.partition(['Z']).cooling.map((c) => [c.provider, c.ms]), [['Z', 40_000]]);
});
