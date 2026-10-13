import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPlan,
  defaultSelection,
  describeCounts,
  reviewCounts,
} from './restoreReview.ts';
import type { BackupAnalysis, BackupSectionAnalysis } from '../../types/backup.ts';

/**
 * The restore screen's forecast. A review that says "3 updated" and a restore
 * that updates thirty is the failure: the reader confirmed something else.
 */

const zero = { add: 0, update: 0, remove: 0, keep: 0, same: 0, invalid: 0 };

function section(overrides: Partial<BackupSectionAnalysis> = {}): BackupSectionAnalysis {
  return {
    id: 's',
    label: 'S',
    description: '',
    group: 'content',
    status: 'ok',
    backupCount: 10,
    localCount: 10,
    counts: { same: 0, new: 0, localOnly: 0, backupNewer: 0, localNewer: 0, conflict: 0, invalid: 0 },
    projection: { smart: { ...zero, add: 2 }, merge: { ...zero }, replace: { ...zero } },
    conflicts: [],
    conflictTotal: 0,
    canKeepBoth: false,
    canRemove: true,
    parts: [],
    restartAfterRestore: false,
    ...overrides,
  };
}

test('unanswered conflicts are counted as kept, matching what the restore will do', () => {
  const counts = reviewCounts(section({ conflictTotal: 3 }), 'smart');
  assert.equal(counts.keep, 3);
  assert.equal(counts.add, 2);
});

test('a category choice and per-row choices both reach the forecast', () => {
  const s = section({
    conflictTotal: 5,
    conflicts: [
      { key: 'p:a', label: 'a', backup: '', current: '' },
      { key: 'p:b', label: 'b', backup: '', current: '' },
    ],
  });
  const counts = reviewCounts(s, 'smart', { default: 'backup', items: { 'p:a': 'local', 'p:gone': 'local' } });
  assert.equal(counts.update, 4, 'four follow the category choice');
  assert.equal(counts.keep, 1, 'one was chosen row by row; an unknown key is ignored');
});

test('keep both is only an addition where the category supports it', () => {
  assert.equal(reviewCounts(section({ conflictTotal: 1 }), 'smart', { default: 'both' }).keep, 1);
  assert.equal(reviewCounts(section({ conflictTotal: 1, canKeepBoth: true }), 'smart', { default: 'both' }).add, 3);
});

test('merge and replace forecasts come straight from the main process', () => {
  const s = section({ conflictTotal: 4, projection: { smart: zero, merge: { ...zero, update: 4 }, replace: { ...zero, remove: 1 } } });
  assert.equal(reviewCounts(s, 'merge').update, 4);
  assert.equal(reviewCounts(s, 'replace').remove, 1);
});

test('only restorable categories with something in them start ticked', () => {
  const analysis = {
    sections: [
      section({ id: 'a' }),
      section({ id: 'empty', backupCount: 0 }),
      section({ id: 'future', status: 'unsupported' }),
    ],
  } as BackupAnalysis;
  assert.deepEqual([...defaultSelection(analysis)], ['a']);
});

test('conflict choices are sent only for smart restore, and only for chosen categories', () => {
  const resolutions = { a: { default: 'backup' as const }, b: { default: 'local' as const } };
  assert.deepEqual(buildPlan('smart', ['a'], resolutions), { mode: 'smart', sections: ['a'], resolutions: { a: { default: 'backup' } } });
  assert.deepEqual(buildPlan('replace', ['a'], resolutions), { mode: 'replace', sections: ['a'] });
});

test('a forecast with nothing in it says so', () => {
  assert.equal(describeCounts(zero), 'Nothing to change');
  assert.equal(describeCounts({ ...zero, add: 3, same: 9 }), '3 added · 9 already the same');
});
