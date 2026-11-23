import assert from 'node:assert/strict';
import { foldNewGroups } from './sourceGroupFold.ts';

const none = new Set<string>();

// Vacuous: no groups.
assert.deepEqual([...foldNewGroups(none, none, [], 0, undefined)], []);

// Short list: everything open.
assert.deepEqual([...foldNewGroups(none, none, ['A', 'B'], 10, undefined)], []);

// Long list: best and playing open, the rest folded.
assert.deepEqual([...foldNewGroups(none, none, ['A', 'B', 'C'], 40, 'C')], ['B']);

// A group the viewer opened stays open when another group streams in.
assert.deepEqual([...foldNewGroups(none, new Set(['A', 'B']), ['A', 'B', 'C'], 40, undefined)], ['C']);

// A group the viewer folded stays folded when the list shrinks below 30.
assert.deepEqual([...foldNewGroups(new Set(['A']), new Set(['A', 'B']), ['A', 'B'], 10, undefined)], ['A']);

console.log('sourceGroupFold: ok');
