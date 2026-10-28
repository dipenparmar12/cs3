import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BYTE_CAPS, ByteMeter, HostLimiter } from './budget.ts';

test('the meter says stop at the cap, and not before', () => {
  const meter = new ByteMeter(BYTE_CAPS.sniff);
  assert.equal(meter.add(60 * 1024), false);
  assert.equal(meter.remaining, 4 * 1024);
  assert.equal(meter.add(4 * 1024), true);
  assert.equal(meter.exhausted, true);
  assert.equal(meter.bytes, 64 * 1024);
  assert.equal(meter.add(-5), true);
});

test('a cap must be a number: there is no unlimited', () => {
  assert.throws(() => new ByteMeter(Infinity));
  assert.throws(() => new ByteMeter(0));
});

test('a host takes two at once, spaced, and the third waits', () => {
  const hosts = new HostLimiter({ perHost: 2, spacingMs: 400, cooldownsMs: [1000] });
  assert.deepEqual(hosts.check('h', 0), { ok: true });
  hosts.started('h', 0);
  assert.equal((hosts.check('h', 100) as { reason: string }).reason, 'spacing');
  assert.deepEqual(hosts.check('h', 400), { ok: true });
  hosts.started('h', 400);
  assert.equal((hosts.check('h', 900) as { reason: string }).reason, 'busy');
  assert.deepEqual(hosts.check('other', 900), { ok: true });
  hosts.finished('h', 950);
  assert.deepEqual(hosts.check('h', 950), { ok: true });
});

test('a rate limit cools the host down, escalating; any other answer resets it', () => {
  const hosts = new HostLimiter({ perHost: 2, spacingMs: 0, cooldownsMs: [1000, 5000] });
  hosts.started('h', 0);
  hosts.finished('h', 0, true);
  assert.deepEqual(hosts.check('h', 500), { ok: false, waitMs: 500, reason: 'cooldown' });
  assert.equal(hosts.coolingDown('h', 1000), false);
  hosts.started('h', 1000);
  hosts.finished('h', 1000, true);
  assert.equal(hosts.coolingDown('h', 5999), true);
  hosts.started('h', 6000);
  hosts.finished('h', 6000);
  hosts.started('h', 6000);
  hosts.finished('h', 6000, true);
  assert.equal(hosts.coolingDown('h', 7001), false);
});
