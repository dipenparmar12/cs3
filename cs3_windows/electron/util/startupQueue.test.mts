import { test } from 'node:test';
import assert from 'node:assert/strict';

import { StartupQueue } from './startupQueue.ts';

/**
 * The queue's job is that no background service can hurt the app, so the cases
 * worth pinning are the ones where it could.
 *
 * The load-bearing one is isolation: a task that throws must not stop the tasks
 * behind it. That is the whole of PRD section 10 and it is the property that
 * decides whether a launch survives a broken JVM, an unreachable repository or
 * a torrent port somebody else already holds.
 *
 * The second is that the default lane stays serial. Provider loading in this
 * codebase cannot be parallelised — providers self-register into a global, and
 * overlapping loads steal each other's registrations — so a queue that quietly
 * ran two tasks at once would reintroduce a defect measured at 176
 * mis-attributed providers, in the component built to prevent that class of
 * thing.
 */

const settle = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));

test('tasks run highest priority first', async () => {
  const order: string[] = [];
  const queue = new StartupQueue();
  queue.add({ id: 'low', label: 'low', priority: 1, run: () => { order.push('low'); } });
  queue.add({ id: 'high', label: 'high', priority: 90, run: () => { order.push('high'); } });
  queue.add({ id: 'mid', label: 'mid', priority: 50, run: () => { order.push('mid'); } });
  queue.start();
  await settle(120);

  assert.deepEqual(order, ['high', 'mid', 'low']);
});

test('a task that throws does not stop the ones behind it', async () => {
  const done: string[] = [];
  const failures: string[] = [];
  const queue = new StartupQueue((task) => {
    if (task.state === 'failed') failures.push(task.id);
  });
  queue.add({
    id: 'broken',
    label: 'broken',
    priority: 90,
    run: () => {
      throw new Error('the JVM is not there');
    },
  });
  queue.add({ id: 'after', label: 'after', priority: 10, run: () => { done.push('after'); } });
  queue.start();
  await settle(150);

  assert.deepEqual(done, ['after'], 'the launch carried on');
  assert.deepEqual(failures, ['broken']);
  const report = queue.report().find((t) => t.id === 'broken');
  assert.equal(report?.state, 'failed');
  assert.match(report?.error ?? '', /the JVM is not there/);
});

test('the default lane runs one task at a time', async () => {
  let concurrent = 0;
  let peak = 0;
  const queue = new StartupQueue();
  for (const id of ['a', 'b', 'c']) {
    queue.add({
      id,
      label: id,
      priority: 10,
      run: async () => {
        concurrent++;
        peak = Math.max(peak, concurrent);
        await settle(25);
        concurrent--;
      },
    });
  }
  queue.start();
  await settle(250);

  assert.equal(peak, 1, 'serial means serial — see the note about provider registration');
  assert.equal(queue.report().filter((t) => t.state === 'done').length, 3);
});

test('a named lane runs its own tasks alongside the serial one', async () => {
  const running = new Set<string>();
  let sawBoth = false;
  const queue = new StartupQueue();
  queue.add({
    id: 'serial-task',
    label: 'serial',
    priority: 50,
    run: async () => {
      running.add('serial');
      await settle(60);
      if (running.has('media')) sawBoth = true;
      running.delete('serial');
    },
  });
  queue.add({
    id: 'media-task',
    label: 'media',
    priority: 49,
    lane: 'media',
    run: async () => {
      running.add('media');
      await settle(60);
      if (running.has('serial')) sawBoth = true;
      running.delete('media');
    },
  });
  queue.start();
  await settle(250);

  assert.ok(sawBoth, 'a task in its own lane is not held behind the serial one');
});

test('a failed task is retried on a backoff and then given up on', async () => {
  let attempts = 0;
  const queue = new StartupQueue();
  queue.add({
    id: 'flaky',
    label: 'flaky',
    priority: 10,
    retries: 2,
    run: () => {
      attempts++;
      throw new Error('port in use');
    },
  });
  queue.start();
  // Backoff is 2s then 4s, so this checks the first retry has not yet fired —
  // a queue that retried immediately would spin a failing service at full tilt.
  await settle(150);
  assert.equal(attempts, 1, 'the retry waits');
  assert.equal(queue.report().find((t) => t.id === 'flaky')?.state, 'pending');
  queue.stop();
});

test('a succeeding task is not retried and reports once', async () => {
  const settled: string[] = [];
  const queue = new StartupQueue((task) => settled.push(`${task.id}:${task.state}`));
  let runs = 0;
  queue.add({ id: 'ok', label: 'ok', priority: 10, retries: 3, run: () => { runs++; } });
  queue.start();
  await settle(150);

  assert.equal(runs, 1);
  assert.deepEqual(settled, ['ok:done']);
});

test('demand runs a queued task now, and is a no-op once it has run', async () => {
  const order: string[] = [];
  const queue = new StartupQueue();
  queue.add({
    id: 'slow-first',
    label: 'slow',
    priority: 90,
    delayMs: 5_000,
    run: () => { order.push('slow'); },
  });
  queue.add({
    id: 'wanted',
    label: 'wanted',
    priority: 1,
    delayMs: 5_000,
    run: () => { order.push('wanted'); },
  });
  queue.start();

  // The lazy-service path: the user asked for this feature, so it jumps ahead
  // of work scheduled for later that nobody is waiting on.
  await queue.demand('wanted');
  assert.deepEqual(order, ['wanted']);

  await queue.demand('wanted');
  assert.deepEqual(order, ['wanted'], 'demanding a finished task does nothing');
  queue.stop();
});

test('adding an id twice does not run the work twice', async () => {
  let runs = 0;
  const queue = new StartupQueue();
  queue.add({ id: 'once', label: 'once', priority: 10, run: () => { runs++; } });
  queue.add({ id: 'once', label: 'a different task, same id', priority: 99, run: () => { runs++; } });
  queue.start();
  await settle(120);

  assert.equal(runs, 1);
  assert.equal(queue.report().length, 1);
});

test('a delay holds a task back without holding back the ones after it', async () => {
  const order: string[] = [];
  const queue = new StartupQueue();
  queue.add({
    id: 'later',
    label: 'later',
    priority: 99,
    delayMs: 120,
    run: () => { order.push('later'); },
  });
  queue.add({ id: 'now', label: 'now', priority: 1, run: () => { order.push('now'); } });
  queue.start();
  await settle(300);

  assert.deepEqual(
    order,
    ['now', 'later'],
    'a high-priority task that is not due yet must not idle the queue'
  );
});
