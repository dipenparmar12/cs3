import { test } from 'node:test';
import assert from 'node:assert/strict';

import { attemptMark } from './attemptMark.ts';

test('failures are always marked, whenever they happened', () => {
  assert.equal(attemptMark({ outcome: 'wrong-match', at: 1, detail: 'Answered with “Dune: Part Two”' }, 'HDO', 100)?.kind, 'wrong');
  assert.equal(attemptMark({ outcome: 'no-sources', at: 1 }, 'HDO', 100)?.kind, 'empty');
  assert.equal(attemptMark({ outcome: 'error', at: 1 }, 'HDO', 100)?.kind, 'error');
});

test('sources found is drawn only for an answer from this launch', () => {
  assert.equal(attemptMark({ outcome: 'sources', at: 150 }, 'HDO', 100)?.kind, 'found');
  assert.equal(attemptMark({ outcome: 'sources', at: 50 }, 'HDO', 100), null);
});

test('no attempt, no mark', () => {
  assert.equal(attemptMark(undefined, 'HDO', 100), null);
});

test('the tooltip carries the provider and its own words', () => {
  const mark = attemptMark({ outcome: 'wrong-match', at: 1, detail: 'Answered with “Dune: Part Two”' }, 'HDO', 0);
  assert.match(mark!.tooltip, /HDO/);
  assert.match(mark!.tooltip, /Dune: Part Two/);
});
