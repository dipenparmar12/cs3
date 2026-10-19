/**
 *   node --experimental-strip-types src/components/extensions/updateNotice.test.mts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeAutomaticUpdate } from './updateNotice.ts';

test('a clean automatic run says how many updated and leaves by itself', () => {
  const notice = describeAutomaticUpdate('extension:autoUpdateCompleted', { outcomes: [{ ok: true }, { ok: true }] });
  assert.deepEqual(notice, { tone: 'ok', text: 'Updated 2 extensions.', review: false });
});

test('a run with failures offers Review', () => {
  const notice = describeAutomaticUpdate('extension:autoUpdateCompleted', { outcomes: [{ ok: true }, { ok: false }] });
  assert.equal(notice?.review, true);
  assert.match(notice!.text, /Updated 1 extension\. 1 couldn’t be updated\./);
});

test('updates waiting for approval are announced; nothing found says nothing', () => {
  assert.equal(describeAutomaticUpdate('extension:updatesAvailable', { updates: [1, 2, 3] })?.text, '3 extension updates are ready to install.');
  assert.equal(describeAutomaticUpdate('extension:autoUpdateCompleted', { outcomes: [] }), null);
  assert.equal(describeAutomaticUpdate('extension:updateProgress', {}), null);
});
