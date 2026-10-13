import { test } from 'node:test';
import assert from 'node:assert/strict';

import { StartupProfiler, STALL_THRESHOLD_MS } from './startupProfile.ts';

/**
 * The profiler is what every other claim in the startup work is measured with,
 * so the thing worth pinning is that it cannot flatter the app.
 *
 * Two properties carry that. A stage that throws must still appear, or a
 * startup that failed halfway reads as a startup that was fast. And a stall
 * must be attributed to whatever was open when the loop stopped turning, or the
 * "Not Responding" report has no owner and the whole exercise is a list of
 * durations that cannot distinguish busy from frozen.
 *
 * Isolated instances rather than the exported singleton: a shared recorder
 * measured by a test that also runs alongside 72 other suites is one whose
 * totals mean nothing.
 */

/** Blocks the loop for real. A timer cannot simulate a stall — it is the thing being detected. */
function block(ms: number): void {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    // Deliberate. `Atomics.wait` would park the thread without holding the
    // loop, which is the opposite of what this reproduces.
  }
}

test('a stage records its duration and its nesting', () => {
  const profiler = new StartupProfiler();
  profiler.stage('outer', () => {
    profiler.stage('inner', () => block(5));
  });

  const { stages } = profiler.snapshot();
  const outer = stages.find((s) => s.name === 'outer');
  const inner = stages.find((s) => s.name === 'outer.inner');

  assert.ok(outer, 'the outer stage is recorded');
  assert.ok(inner, 'a nested stage is named for its parent, not on its own');
  assert.equal(inner.depth, 1);
  assert.ok(inner.durationMs >= 4, `inner took ${inner.durationMs}ms`);
  assert.ok(outer.durationMs >= inner.durationMs, 'a parent contains its child');
});

test('a stage that throws is still recorded, with its error, and the error escapes', () => {
  const profiler = new StartupProfiler();
  assert.throws(
    () => profiler.stage('doomed', () => {
      throw new Error('disk on fire');
    }),
    /disk on fire/
  );

  const stage = profiler.snapshot().stages.find((s) => s.name === 'doomed');
  assert.ok(stage, 'the failed stage is not dropped');
  assert.equal(stage.error, 'disk on fire');
});

test('an async stage that settles out of order does not close the one still running', async () => {
  const profiler = new StartupProfiler();
  let releaseSlow = () => {};
  const slow = profiler.stageAsync('slow', () =>
    new Promise<void>((resolve) => {
      releaseSlow = resolve;
    })
  );
  await profiler.stageAsync('fast', async () => {});
  releaseSlow();
  await slow;

  const names = profiler.snapshot().stages.map((s) => s.name);
  // `fast` was entered while `slow` was open, so it nests; what must not happen
  // is `slow` being closed by `fast` finishing first.
  assert.ok(names.includes('slow'), 'the slow stage closed on its own promise');
  assert.ok(names.includes('slow.fast'), 'the fast stage nested under the open one');
});

test('a block longer than the threshold is recorded and attributed', async () => {
  const profiler = new StartupProfiler();
  profiler.watch();
  // One turn, so the monitor establishes a baseline before anything blocks.
  await new Promise((resolve) => setTimeout(resolve, 40));

  profiler.stage('the-slow-bit', () => block(STALL_THRESHOLD_MS + 120));
  await new Promise((resolve) => setTimeout(resolve, 60));
  profiler.finish();

  const { stalls, stalledMs } = profiler.snapshot();
  assert.ok(stalls.length >= 1, 'the block was noticed');
  assert.ok(
    stalls.some((stall) => stall.during === 'the-slow-bit'),
    `the stall names what was open: ${JSON.stringify(stalls)}`
  );
  assert.ok(stalledMs >= STALL_THRESHOLD_MS, `total stall was ${stalledMs}ms`);
});

test('work that stays under the threshold is not reported as a freeze', async () => {
  const profiler = new StartupProfiler();
  profiler.watch();
  await new Promise((resolve) => setTimeout(resolve, 40));

  // Busy, in short bursts, with the loop given a turn between each — which is
  // exactly the shape the background queue produces and must never be reported
  // as the app having gone grey.
  for (let i = 0; i < 6; i++) {
    profiler.stage(`chunk-${i}`, () => block(20));
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  profiler.finish();

  assert.deepEqual(profiler.snapshot().stalls, [], 'busy is not frozen');
});

test('finish freezes the profile and stops the monitor', async () => {
  const profiler = new StartupProfiler();
  profiler.watch();
  await new Promise((resolve) => setTimeout(resolve, 40));
  profiler.finish();

  assert.equal(profiler.snapshot().running, false);

  block(STALL_THRESHOLD_MS + 120);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.deepEqual(
    profiler.snapshot().stalls,
    [],
    'a block after startup is over belongs to the session, not to the launch'
  );
});

test('marks are instants, and a later mark of the same name wins', async () => {
  const profiler = new StartupProfiler();
  profiler.mark('first_paint');
  const early = profiler.snapshot().marks.first_paint;
  await new Promise((resolve) => setTimeout(resolve, 20));
  profiler.mark('first_paint');

  assert.ok(profiler.snapshot().marks.first_paint > early, 'the mark moved');
});
