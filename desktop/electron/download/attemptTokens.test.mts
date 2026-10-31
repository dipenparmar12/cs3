import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AttemptTokens } from './attemptTokens.ts';

test('a replaced transfer is silenced; the current one is heard', () => {
  const tokens = new AttemptTokens();
  const heard: string[] = [];
  const first = tokens.begin('t');
  const late = tokens.guard('t', first, (what: string) => void heard.push(`first:${what}`));
  const second = tokens.begin('t');
  const live = tokens.guard('t', second, (what: string) => void heard.push(`second:${what}`));
  late('error');
  live('progress');
  assert.deepEqual(heard, ['second:progress']);
});

test('a withdrawn task hears nothing, and tasks never share a token', () => {
  const tokens = new AttemptTokens();
  const heard: string[] = [];
  const a = tokens.begin('a');
  const b = tokens.begin('b');
  const fromA = tokens.guard('a', a, () => void heard.push('a'));
  const fromB = tokens.guard('b', b, () => void heard.push('b'));
  tokens.withdraw('a');
  fromA();
  fromB();
  assert.deepEqual(heard, ['b']);
});

test('a task that never started hears nothing', () => {
  const tokens = new AttemptTokens();
  let called = false;
  tokens.guard('x', 1, () => void (called = true))();
  assert.equal(called, false);
});
