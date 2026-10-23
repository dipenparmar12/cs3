import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PlaybackStats } from './playbackStats.ts';

test('a stream that never drew a frame reports nothing played', () => {
  const stats = new PlaybackStats(0);
  stats.waiting(500);
  assert.deepEqual(stats.report(4000, false), {
    firstFrameMs: 0,
    playbackSeconds: 0,
    seekCount: 0,
    stallCount: 0,
    stallTotalMs: 0,
    ended: false,
  });
});

test('first frame, play time and a mid-play stall are measured', () => {
  const stats = new PlaybackStats(1000);
  stats.playing(1800);
  stats.waiting(11800); // 10 s played, then the buffer ran out
  stats.playing(13300); // 1.5 s stalled
  const report = stats.report(23300, true);
  assert.equal(report.firstFrameMs, 800);
  assert.equal(report.playbackSeconds, 20);
  assert.equal(report.stallCount, 1);
  assert.equal(report.stallTotalMs, 1500);
  assert.equal(report.ended, true);
});

test('the wait after a seek is not a stall, and repeated waiting is one stall', () => {
  const stats = new PlaybackStats(0);
  stats.playing(100);
  stats.seekStarted(1000);
  stats.waiting(1000);
  stats.seekFinished();
  stats.playing(1400);
  stats.waiting(2000);
  stats.waiting(2100);
  const report = stats.report(3000, false);
  assert.equal(report.seekCount, 1);
  assert.equal(report.stallCount, 1);
  assert.equal(report.stallTotalMs, 1000);
});

test('paused time is not play time', () => {
  const stats = new PlaybackStats(0);
  stats.playing(0);
  stats.paused(5000);
  stats.playing(65000);
  assert.equal(stats.report(70000, false).playbackSeconds, 10);
});
