import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ProviderSlots } from './providerSlots.ts';

/** A piece of work that finishes when told to. */
function gate() {
  let open!: () => void;
  const done = new Promise<void>((resolve) => (open = resolve));
  return { open, work: () => done };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test('background work past the limit waits, and starts in order as slots free', async () => {
  const slots = new ProviderSlots(2);
  const started: number[] = [];
  const gates = [gate(), gate(), gate(), gate()];
  const runs = gates.map((g, i) => slots.run('A', () => (started.push(i), g.work())));
  await tick();
  assert.deepEqual(started, [0, 1]);
  assert.equal(slots.queued('A'), 2);
  gates[1].open();
  await tick();
  assert.deepEqual(started, [0, 1, 2]);
  assert.equal(slots.inFlight('A'), 2);
  gates[0].open();
  gates[2].open();
  gates[3].open();
  await Promise.all(runs);
  assert.deepEqual(started, [0, 1, 2, 3]);
  assert.equal(slots.inFlight('A'), 0);
  assert.equal(slots.queued('A'), 0);
});

test('urgent work never waits, and background work waits behind it', async () => {
  const slots = new ProviderSlots(1);
  const first = gate();
  const urgent = gate();
  const started: string[] = [];
  const a = slots.run('A', () => (started.push('bg1'), first.work()));
  const b = slots.run('A', () => (started.push('play'), urgent.work()), { urgent: true });
  const c = slots.run('A', () => (started.push('bg2'), Promise.resolve()));
  await tick();
  assert.deepEqual(started, ['bg1', 'play']);
  first.open();
  await tick();
  // The urgent call still holds the provider's only slot.
  assert.deepEqual(started, ['bg1', 'play']);
  urgent.open();
  await Promise.all([a, b, c]);
  assert.deepEqual(started, ['bg1', 'play', 'bg2']);
});

test('providers do not share slots, and a failure frees its slot', async () => {
  const slots = new ProviderSlots(1);
  await assert.rejects(slots.run('A', () => Promise.reject(new Error('boom'))), /boom/);
  assert.equal(slots.inFlight('A'), 0);
  const held = gate();
  const a = slots.run('A', held.work);
  let bRan = false;
  await slots.run('B', async () => {
    bRan = true;
  });
  assert.equal(bRan, true);
  held.open();
  await a;
});

test('the first call to a provider runs at once', async () => {
  const slots = new ProviderSlots(1);
  assert.equal(await slots.run('A', async () => 7), 7);
});
