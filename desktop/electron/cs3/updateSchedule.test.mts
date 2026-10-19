/**
 * The automatic extension update check runs at most once per calendar day.
 *
 *   node --experimental-strip-types electron/cs3/updateSchedule.test.mts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { automaticCheckDelay, nextLocalMidnight, sameLocalDay } from './updateSchedule.ts';

const settleMs = 30_000;
const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();

test('a launch on a day with no automatic check yet checks soon after launch', () => {
  const now = at(2026, 10, 19, 9);
  assert.equal(automaticCheckDelay({ policy: 'startup', lastAutoCheckAt: at(2026, 10, 18, 23), now, settleMs }), settleMs);
  assert.equal(automaticCheckDelay({ policy: 'daily', lastAutoCheckAt: 0, now, settleMs }), settleMs);
});

test('a second launch the same day does not check again — it waits for tomorrow', () => {
  const now = at(2026, 10, 19, 11);
  const delay = automaticCheckDelay({ policy: 'startup', lastAutoCheckAt: at(2026, 10, 19, 9), now, settleMs });
  assert.equal(delay, at(2026, 10, 20, 0) - now + settleMs);
});

test('it is the calendar day, not 24 hours: 23:00 then 09:00 checks both times', () => {
  const now = at(2026, 10, 20, 9);
  assert.equal(automaticCheckDelay({ policy: 'daily', lastAutoCheckAt: at(2026, 10, 19, 23), now, settleMs }), settleMs);
});

test('an app left open past midnight checks shortly after it', () => {
  const now = at(2026, 10, 19, 23, 50);
  const delay = automaticCheckDelay({ policy: 'daily', lastAutoCheckAt: at(2026, 10, 19, 9), now, settleMs })!;
  assert.ok(sameLocalDay(now + delay, at(2026, 10, 20, 0, 1)));
  assert.equal(now + delay, nextLocalMidnight(now) + settleMs);
});

test('automatic updates switched off never schedule a check', () => {
  assert.equal(automaticCheckDelay({ policy: 'manual', lastAutoCheckAt: 0, now: Date.now(), settleMs }), null);
});

test('a clock that moved backwards is not trusted to mean "already checked today"', () => {
  const now = at(2026, 10, 19, 9);
  assert.equal(automaticCheckDelay({ policy: 'daily', lastAutoCheckAt: at(2026, 10, 19, 12), now, settleMs }), settleMs);
});
