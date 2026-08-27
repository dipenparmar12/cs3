/**
 * Tests for Media History grouping and consolidation logic.
 *
 *   node --experimental-strip-types src/utils/historyGrouping.test.mts
 */
import assert from 'node:assert/strict';
import {
  deriveGroupKey,
  groupHistoryEvents,
  getActionAccents,
  formatEventActionText,
} from './historyGrouping.ts';
import type { HistoryEvent } from '../types/history.ts';

const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

function createEvent(overrides: Partial<HistoryEvent> = {}): HistoryEvent {
  return {
    id: `ev-${Math.random().toString(36).substring(2, 9)}`,
    mediaKey: 'inception:2010',
    title: 'Inception',
    year: 2010,
    mediaUrl: 'https://example.com/inception',
    action: 'playback_started',
    status: 'Played',
    timestamp: Date.now(),
    ...overrides,
  };
}

// --- 1. Deriving group identity key ---------------------------------------

test('deriveGroupKey prefers mediaKey and falls back to normalized title', () => {
  const evWithKey = createEvent({ mediaKey: 'custom-key:123' });
  assert.equal(deriveGroupKey(evWithKey), 'custom-key:123');

  const evWithoutKey = createEvent({ mediaKey: '', title: 'The Dark Knight', year: 2008 });
  assert.equal(deriveGroupKey(evWithoutKey), 'the-dark-knight:2008');
});

// --- 2. Grouping duplicate and revisited entries ----------------------------

test('multiple events of the same movie are consolidated into 1 item', () => {
  const ev1 = createEvent({ timestamp: 1000, action: 'detail_opened', status: 'Unchecked' });
  const ev2 = createEvent({ timestamp: 2000, action: 'playback_started', status: 'Played' });
  const ev3 = createEvent({ timestamp: 3000, action: 'download_completed', status: 'Downloaded' });

  const grouped = groupHistoryEvents([ev1, ev2, ev3]);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].visitCount, 3);
  assert.equal(grouped[0].title, 'Inception');
  assert.equal(grouped[0].latestEvent.id, ev3.id);
  assert.equal(grouped[0].events.length, 3);
});

test('distinct movies produce separate grouped items', () => {
  const inception1 = createEvent({ mediaKey: 'inception:2010', title: 'Inception', year: 2010 });
  const inception2 = createEvent({ mediaKey: 'inception:2010', title: 'Inception', year: 2010 });
  const interstellar = createEvent({ mediaKey: 'interstellar:2014', title: 'Interstellar', year: 2014 });

  const grouped = groupHistoryEvents([inception1, inception2, interstellar]);
  assert.equal(grouped.length, 2);
  const incGroup = grouped.find((g) => g.title === 'Inception');
  const intGroup = grouped.find((g) => g.title === 'Interstellar');
  assert.equal(incGroup?.visitCount, 2);
  assert.equal(intGroup?.visitCount, 1);
});

// --- 2. Action accents / tags computation -----------------------------------

test('action accents reflect distinct actions and counts', () => {
  const ev1 = createEvent({ action: 'playback_completed', status: 'Played' });
  const ev2 = createEvent({ action: 'playback_completed', status: 'Played' });
  const ev3 = createEvent({ action: 'download_completed', status: 'Downloaded' });
  const ev4 = createEvent({ action: 'playback_failed', status: 'Failed', failureReason: 'Timeout' });

  const grouped = groupHistoryEvents([ev1, ev2, ev3, ev4]);
  assert.equal(grouped.length, 1);

  const accents = getActionAccents(grouped[0]);
  const streamAcc = accents.find((a) => a.key === 'played');
  const dlAcc = accents.find((a) => a.key === 'downloaded');
  const failAcc = accents.find((a) => a.key === 'failed');

  assert.ok(streamAcc, 'Should have played accent');
  assert.equal(streamAcc?.count, 2);
  assert.ok(dlAcc, 'Should have downloaded accent');
  assert.equal(dlAcc?.count, undefined); // 1 does not need count badge
  assert.ok(failAcc, 'Should have failed accent');
});

// --- 3. Sorting behavior ---------------------------------------------------

test('sorting by played puts played items first', () => {
  const failedOnly = createEvent({
    mediaKey: 'movie-fail',
    title: 'Fail Movie',
    status: 'Failed',
    action: 'playback_failed',
    timestamp: 5000,
  });
  const playedOld = createEvent({
    mediaKey: 'movie-play',
    title: 'Played Movie',
    status: 'Played',
    action: 'playback_completed',
    timestamp: 1000,
  });

  const grouped = groupHistoryEvents([failedOnly, playedOld], 'played');
  assert.equal(grouped[0].title, 'Played Movie');
  assert.equal(grouped[1].title, 'Fail Movie');
});

// --- 4. Action text formatting ---------------------------------------------

test('formatEventActionText formats played stream with quality and provider', () => {
  const ev = createEvent({
    status: 'Played',
    source: {
      providerName: 'Cineb',
      quality: '1080p',
    },
    durationSeconds: 120,
  });
  const text = formatEventActionText(ev);
  assert.ok(text.includes('Streamed'));
  assert.ok(text.includes('1080p'));
  assert.ok(text.includes('Cineb'));
});

test('formatEventActionText formats failure reason', () => {
  const ev = createEvent({
    status: 'Failed',
    failureReason: 'Stream link expired (403)',
  });
  const text = formatEventActionText(ev);
  assert.equal(text, 'Playback failed: Stream link expired (403)');
});

// --- Run suite -------------------------------------------------------------

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
