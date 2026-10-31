import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { ProviderAttemptStore } from './providerAttempts.ts';
import { PrivacyMode, resetPrivacyModeForTests } from './privacyMode.ts';

function memory() {
  const values = new Map<string, unknown>();
  return {
    getObject: <T,>(k: string, d: T) => (values.has(k) ? (values.get(k) as T) : d),
    setObject: (k: string, v: unknown) => void values.set(k, v),
    getBool: () => false,
    setBool: () => {},
  };
}

beforeEach(() => resetPrivacyModeForTests());

test('the newest answer per work and provider wins; other providers are kept', () => {
  let now = 1_000;
  const store = new ProviderAttemptStore(memory(), () => now);
  store.record([
    { work: 'dune|2021', provider: 'HDO', outcome: 'no-sources' },
    { work: 'dune|2021', provider: 'MoviesDrive', outcome: 'sources' },
  ]);
  now += 1_000;
  store.record([{ work: 'dune|2021', provider: 'HDO', outcome: 'wrong-match', detail: 'Dune: Part Two' }]);
  const find = store.lookup();
  assert.equal(find('dune|2021', 'HDO')?.outcome, 'wrong-match');
  assert.equal(find('dune|2021', 'MoviesDrive')?.outcome, 'sources');
  assert.equal(store.count(), 2);
});

test('answers expire on their own clocks: a failure in minutes, a wrong match in days', () => {
  let now = 0;
  const store = new ProviderAttemptStore(memory(), () => now);
  store.record([
    { work: 'w', provider: 'A', outcome: 'error' },
    { work: 'w', provider: 'B', outcome: 'wrong-match' },
  ]);
  now = 11 * 60 * 1000;
  const find = store.lookup();
  assert.equal(find('w', 'A'), undefined, 'a temporary failure is retried soon');
  assert.equal(find('w', 'B')?.outcome, 'wrong-match');
});

test('a card with no provider, or a provider never asked, has no attempt', () => {
  const store = new ProviderAttemptStore(memory());
  const find = store.lookup();
  assert.equal(find('w', undefined), undefined);
  assert.equal(find('w', 'Nobody'), undefined);
});

test('nothing is written in a private session', () => {
  const backing = memory();
  new PrivacyMode(backing).setActive(true);
  const store = new ProviderAttemptStore(backing);
  store.record([{ work: 'w', provider: 'A', outcome: 'sources' }]);
  assert.equal(store.count(), 0);
});

test('clear erases everything', () => {
  const store = new ProviderAttemptStore(memory());
  store.record([{ work: 'w', provider: 'A', outcome: 'sources' }]);
  store.clear();
  assert.equal(store.count(), 0);
});

test('forget drops one provider answer for one work and leaves the rest', () => {
  const backing = memory();
  const store = new ProviderAttemptStore(backing, () => 1_000);
  store.record([
    { work: 'dune|2021', provider: 'A', outcome: 'no-sources' },
    { work: 'dune|2021', provider: 'B', outcome: 'error' },
  ]);
  assert.equal(store.forget('dune|2021', 'A'), true);
  assert.equal(store.forget('dune|2021', 'A'), false, 'nothing left to forget');
  const lookup = store.lookup();
  assert.equal(lookup('dune|2021', 'A'), undefined);
  assert.equal(lookup('dune|2021', 'B')?.outcome, 'error');
});
