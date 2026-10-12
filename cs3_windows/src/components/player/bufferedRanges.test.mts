import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  bufferedEndAt,
  mpvBufferedRanges,
  normaliseRanges,
  rangeSegments,
  readTimeRanges,
  sameRanges,
} from './bufferedRanges.ts';

function timeRanges(pairs: Array<[number, number]>) {
  return {
    length: pairs.length,
    start: (i: number) => pairs[i][0],
    end: (i: number) => pairs[i][1],
  };
}

test('every range is read, not just the last one', () => {
  // Watched the start, then seeked to the middle: two separate spans.
  assert.deepEqual(readTimeRanges(timeRanges([[0, 120], [3000, 3060]])), [
    { start: 0, end: 120 },
    { start: 3000, end: 3060 },
  ]);
});

test('a remuxed stream is shifted by its seek offset', () => {
  assert.deepEqual(readTimeRanges(timeRanges([[0, 30]]), 600), [{ start: 600, end: 630 }]);
});

test('after a seek back, buffer ahead is read from the range the playhead is in', () => {
  const ranges = normaliseRanges([{ start: 0, end: 40 }, { start: 3000, end: 3300 }], 7200);
  // The old single-number model reported 3300 here and drew the bar to it.
  assert.equal(bufferedEndAt(ranges, 10), 40);
  assert.equal(bufferedEndAt(ranges, 3100), 3300);
});

test('a playhead in a hole has nothing banked ahead', () => {
  const ranges = normaliseRanges([{ start: 0, end: 40 }, { start: 3000, end: 3300 }], 7200);
  assert.equal(bufferedEndAt(ranges, 1000), null);
});

test('ranges are sorted, merged across tiny gaps, and clamped to the timeline', () => {
  assert.deepEqual(
    normaliseRanges(
      [
        { start: 50, end: 80 },
        { start: -2, end: 10 },
        { start: 10.2, end: 20 },
        { start: 7190, end: 7300 },
        { start: 30, end: 30 },
        { start: Number.NaN, end: 5 },
      ],
      7200,
    ),
    [
      { start: 0, end: 20 },
      { start: 50, end: 80 },
      { start: 7190, end: 7200 },
    ],
  );
});

test('segments are drawn where the ranges are, not from zero', () => {
  assert.deepEqual(rangeSegments([{ start: 50, end: 75 }], 100), [{ left: 50, width: 25 }]);
  assert.deepEqual(rangeSegments([{ start: 0, end: 10 }], 0), []);
});

test('mpv: seekable ranges win; a stale cache end behind the playhead is ignored', () => {
  assert.deepEqual(
    mpvBufferedRanges({
      positionSeconds: 10,
      bufferedSeconds: 3300,
      bufferedRanges: [{ start: 0, end: 40 }, { start: 3000, end: 3300 }],
    }),
    [
      { start: 0, end: 40 },
      { start: 3000, end: 3300 },
    ],
  );
  assert.deepEqual(mpvBufferedRanges({ positionSeconds: 100, bufferedSeconds: 130 }), [{ start: 100, end: 130 }]);
  // Seeked forward past the old cache end: nothing is known to be buffered yet.
  assert.deepEqual(mpvBufferedRanges({ positionSeconds: 500, bufferedSeconds: 130 }), []);
});

test('ranges that did not visibly move are the same', () => {
  assert.equal(sameRanges([{ start: 0, end: 10 }], [{ start: 0.02, end: 10.05 }]), true);
  assert.equal(sameRanges([{ start: 0, end: 10 }], [{ start: 0, end: 12 }]), false);
  assert.equal(sameRanges([], [{ start: 0, end: 1 }]), false);
});
