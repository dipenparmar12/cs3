import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applySearchOrder } from './searchOrder.ts';

test('applySearchOrder uses the ranking when it answers with the same set', () => {
  const targets = ['Slow', 'Fast', 'Middling'];
  const ranked = applySearchOrder(targets, () => ['Fast', 'Middling', 'Slow']);
  assert.deepEqual(ranked, ['Fast', 'Middling', 'Slow']);
});

test('applySearchOrder leaves one provider and an absent ranking alone', () => {
  assert.deepEqual(applySearchOrder(['Only'], () => []), ['Only']);
  assert.deepEqual(applySearchOrder(['A', 'B'], null), ['A', 'B']);
  assert.deepEqual(applySearchOrder(['A', 'B'], undefined), ['A', 'B']);
});

/**
 * The guard, from all four directions. A reordering that quietly changes the
 * set makes a search ask fewer sources than the user selected and report the
 * difference as "no results" — the worst failure this app has, reached through
 * an optimisation nobody would suspect.
 */
test('applySearchOrder refuses an ordering that is not the same set', () => {
  const targets = ['A', 'B', 'C'];

  assert.deepEqual(applySearchOrder(targets, () => ['A', 'B']), targets, 'dropped a provider');
  assert.deepEqual(
    applySearchOrder(targets, () => ['A', 'B', 'C', 'D']),
    targets,
    'added a provider'
  );
  assert.deepEqual(
    applySearchOrder(targets, () => ['A', 'A', 'B']),
    targets,
    'duplicated one, hiding a drop behind the right length'
  );
  assert.deepEqual(
    applySearchOrder(targets, () => ['A', 'B', 'Z']),
    targets,
    'swapped one for a name that was never asked'
  );
});

test('applySearchOrder survives a ranking that throws', () => {
  const targets = ['A', 'B'];
  assert.deepEqual(
    applySearchOrder(targets, () => {
      throw new Error('scores unavailable');
    }),
    targets
  );
});

test('applySearchOrder does not hand the ranking its caller array to mutate', () => {
  const targets = ['A', 'B', 'C'];
  applySearchOrder(targets, (names) => {
    names.length = 0;
    return ['C', 'B', 'A'];
  });
  assert.deepEqual(targets, ['A', 'B', 'C']);
});
