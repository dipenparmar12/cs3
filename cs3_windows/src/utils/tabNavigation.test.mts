/**
 * Each sidebar screen keeps its own place.
 *
 *   node --experimental-strip-types src/utils/tabNavigation.test.mts
 */
import assert from 'node:assert/strict';
import { depthOf, emptyNavigation, pop, push, reset, scrollKey, topOf } from './tabNavigation.ts';

const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

test('a page opened from Search is still there after visiting History', () => {
  let state = emptyNavigation<string>();
  state = push(state, 'search', 'The Matrix');
  // Visiting another screen does not touch Search's stack.
  assert.equal(topOf(state, 'history'), null);
  assert.equal(topOf(state, 'search'), 'The Matrix');
});

test('Back walks the chain of related titles, then returns to the list', () => {
  let state = emptyNavigation<string>();
  state = push(state, 'search', 'The Matrix');
  state = push(state, 'search', 'The Matrix Reloaded');
  assert.equal(depthOf(state, 'search'), 2);
  state = pop(state, 'search');
  assert.equal(topOf(state, 'search'), 'The Matrix');
  state = pop(state, 'search');
  assert.equal(topOf(state, 'search'), null);
  assert.equal(pop(state, 'search'), state, 'popping the root changes nothing');
});

test('screens are independent', () => {
  let state = emptyNavigation<string>();
  state = push(state, 'search', 'A');
  state = push(state, 'library', 'B');
  state = reset(state, 'search');
  assert.equal(topOf(state, 'search'), null);
  assert.equal(topOf(state, 'library'), 'B');
});

test('history is bounded, dropping the oldest', () => {
  let state = emptyNavigation<number>();
  for (let i = 0; i < 40; i++) state = push(state, 'home', i, 30);
  assert.equal(depthOf(state, 'home'), 30);
  assert.equal(topOf(state, 'home'), 39);
});

test('scroll keys separate screens and depths', () => {
  assert.notEqual(scrollKey('search', 0), scrollKey('search', 1));
  assert.notEqual(scrollKey('search', 0), scrollKey('library', 0));
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failed++;
    console.log(`  FAIL ${name}`);
    console.log(`       ${error instanceof Error ? error.message : String(error)}`);
  }
}
console.log(failed === 0 ? `\n${tests.length} passed` : `\n${failed} of ${tests.length} FAILED`);
process.exit(failed === 0 ? 0 : 1);
