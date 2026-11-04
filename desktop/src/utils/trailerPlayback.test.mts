import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_RECOVERIES,
  clampSeek,
  controlsFor,
  isLiveConversionUrl,
  playheadSeconds,
  recoveryPlan,
  seekBase,
  timeAtPointer,
} from './trailerPlayback.ts';

test('clampSeek keeps a target inside the trailer', () => {
  assert.equal(clampSeek(-4, 120), 0);
  assert.equal(clampSeek(200, 120), 120);
  assert.equal(clampSeek(30, 120), 30);
  // Duration not known yet: only the lower bound applies.
  assert.equal(clampSeek(500, 0), 500);
  assert.equal(clampSeek(Number.NaN, 120), 0);
});

test('relative seeks start from the pending target, so presses accumulate', () => {
  let pending: number | null = null;
  const playhead = 10; // has not moved: the conversion is still restarting
  for (let i = 0; i < 3; i++) pending = clampSeek(seekBase(pending, playhead) + 5, 120);
  assert.equal(pending, 25);
  assert.equal(seekBase(null, playhead), 10);
});

test('timeAtPointer maps the scrubber to the timeline and clamps outside it', () => {
  assert.equal(timeAtPointer(150, 100, 200, 120), 30);
  assert.equal(timeAtPointer(50, 100, 200, 120), 0);
  assert.equal(timeAtPointer(400, 100, 200, 120), 120);
  assert.equal(timeAtPointer(150, 100, 0, 120), 0);
  assert.equal(timeAtPointer(150, 100, 200, 0), 0);
});

test('a live conversion adds the seek offset; any other stream does not', () => {
  assert.equal(playheadSeconds(4, 60, true), 64);
  assert.equal(playheadSeconds(4, 60, false), 4);
});

test('only the transcoder session URL is a live conversion', () => {
  assert.equal(isLiveConversionUrl('http://127.0.0.1:51234/media/7'), true);
  assert.equal(isLiveConversionUrl('http://127.0.0.1:51234/media/7?t=30'), true);
  assert.equal(isLiveConversionUrl('http://127.0.0.1:51234/stream/7'), false);
  assert.equal(isLiveConversionUrl('https://cdn.example.com/media/trailer.mp4'), false);
  assert.equal(isLiveConversionUrl(''), false);
});

test('an error after playback started restarts at the position', () => {
  assert.deepEqual(recoveryPlan({ hasPlayed: true, recoveries: 0, position: 47.3, duration: 150 }), {
    action: 'restart',
    at: 47.3,
  });
});

test('an entry that never started fails at once', () => {
  assert.deepEqual(recoveryPlan({ hasPlayed: false, recoveries: 0, position: 0, duration: 150 }), { action: 'fail' });
});

test('restarts are bounded per entry', () => {
  assert.deepEqual(
    recoveryPlan({ hasPlayed: true, recoveries: MAX_RECOVERIES, position: 40, duration: 150 }),
    { action: 'fail' }
  );
  assert.equal(
    recoveryPlan({ hasPlayed: true, recoveries: MAX_RECOVERIES - 1, position: 40, duration: 150 }).action,
    'restart'
  );
});

test('an error at the very end is the end, not a failure', () => {
  assert.deepEqual(recoveryPlan({ hasPlayed: true, recoveries: 0, position: 149.2, duration: 150 }), {
    action: 'ended',
  });
  // Unknown duration: never read as the end.
  assert.equal(recoveryPlan({ hasPlayed: true, recoveries: 0, position: 149.2, duration: 0 }).action, 'restart');
});

test('controls other than the transport work before the stream is ready', () => {
  for (const phase of ['resolving', 'error'] as const) {
    const c = controlsFor(phase);
    assert.equal(c.transport, false);
    assert.equal(c.volume && c.fullscreen && c.queue, true);
  }
  assert.equal(controlsFor('ready').transport, true);
});
