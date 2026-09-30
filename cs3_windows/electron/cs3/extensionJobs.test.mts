import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ExtensionJobQueue,
  targetOf,
  type ExtensionJobRequest,
  type JobOutcome,
} from './extensionJobs.ts';

/**
 * The extension job queue: many presses pending at once, one job per target.
 *
 * Runners are gated promises rather than timers — a scheduling test that sleeps
 * passes on the machine that wrote it and flakes everywhere else.
 */

function install(name: string): ExtensionJobRequest {
  return {
    kind: 'install',
    plugin: { internalName: name, name, url: `https://example.test/${name}.cs3`, status: 1, version: 1 },
    repositoryUrl: 'https://example.test/repo.json',
  };
}

/** A runner whose jobs finish only when the test says so. */
function gatedRunner() {
  const pending = new Map<string, (outcome: JobOutcome) => void>();
  const started: string[] = [];
  const run = (request: ExtensionJobRequest) => {
    const target = targetOf(request);
    started.push(target);
    return new Promise<JobOutcome>((resolve) => pending.set(target, resolve));
  };
  const finish = async (target: string, outcome: JobOutcome = { ok: true, message: 'done' }) => {
    const resolve = pending.get(target);
    assert.ok(resolve, `${target} is not running`);
    pending.delete(target);
    resolve(outcome);
    // Let the queue observe the settlement and start whatever is next.
    await new Promise((r) => setImmediate(r));
  };
  return { run, started, finish };
}

test('a press returns immediately and every press is kept, not refused', () => {
  const gate = gatedRunner();
  const queue = new ExtensionJobQueue({ run: gate.run, concurrency: 2 });

  const { snapshot } = queue.enqueue([install('a'), install('b'), install('c'), install('d')]);

  assert.equal(snapshot.jobs.length, 4);
  assert.equal(snapshot.running, 2);
  assert.equal(snapshot.queued, 2);
  assert.deepEqual(gate.started, ['ext:a', 'ext:b']);
});

test('the next queued job starts as soon as a slot frees', async () => {
  const gate = gatedRunner();
  const queue = new ExtensionJobQueue({ run: gate.run, concurrency: 2 });
  queue.enqueue([install('a'), install('b'), install('c')]);

  await gate.finish('ext:a');

  assert.deepEqual(gate.started, ['ext:a', 'ext:b', 'ext:c']);
  const states = Object.fromEntries(queue.snapshot().jobs.map((job) => [job.target, job.state]));
  assert.deepEqual(states, { 'ext:a': 'done', 'ext:b': 'running', 'ext:c': 'running' });
});

test('pressing Install twice on one extension joins the existing job', () => {
  const gate = gatedRunner();
  const queue = new ExtensionJobQueue({ run: gate.run, concurrency: 1 });

  const first = queue.enqueue([install('a'), install('b')]);
  const second = queue.enqueue([install('b')]);

  assert.equal(second.ids[0], first.ids[1]);
  assert.equal(queue.snapshot().jobs.length, 2);
});

test('an update of an extension already being installed joins it', () => {
  const gate = gatedRunner();
  const queue = new ExtensionJobQueue({ run: gate.run, concurrency: 1 });

  queue.enqueue([install('a')]);
  queue.enqueue([{ kind: 'update', internalName: 'a' }]);

  assert.equal(queue.snapshot().jobs.length, 1, 'two jobs replacing one archive would race');
});

test('a failure stays visible with its reason and does not stop the queue', async () => {
  const gate = gatedRunner();
  const queue = new ExtensionJobQueue({ run: gate.run, concurrency: 1 });
  queue.enqueue([install('a'), install('b')]);

  await gate.finish('ext:a', { ok: false, message: 'SHA-256 mismatch' });

  const [a, b] = queue.snapshot().jobs;
  assert.equal(a.state, 'failed');
  assert.equal(a.message, 'SHA-256 mismatch');
  assert.equal(b.state, 'running');
});

test('a runner that throws is a failed job, not a stuck one', async () => {
  const queue = new ExtensionJobQueue({
    run: async () => {
      throw new Error('socket hang up');
    },
  });
  queue.enqueue([install('a')]);
  await queue.whenIdle();

  const [job] = queue.snapshot().jobs;
  assert.equal(job.state, 'failed');
  assert.equal(job.message, 'socket hang up');
});

test('retry runs a failed job again without the renderer resending it', async () => {
  let attempts = 0;
  const queue = new ExtensionJobQueue({
    run: async () => {
      attempts++;
      return attempts === 1 ? { ok: false, message: 'timed out' } : { ok: true, message: 'installed' };
    },
  });
  queue.enqueue([install('a')]);
  await queue.whenIdle();

  const failed = queue.snapshot().jobs[0];
  queue.retry(failed.id);
  await queue.whenIdle();

  const jobs = queue.snapshot().jobs;
  assert.equal(jobs.length, 1, 'the failed row is replaced, not duplicated');
  assert.equal(jobs[0].state, 'done');
  assert.equal(attempts, 2);
});

test('a queued job can be cancelled; a running one is left to finish', () => {
  const gate = gatedRunner();
  const queue = new ExtensionJobQueue({ run: gate.run, concurrency: 1 });
  const { ids } = queue.enqueue([install('a'), install('b')]);

  queue.cancel(ids[0]);
  queue.cancel(ids[1]);

  const states = queue.snapshot().jobs.map((job) => job.state);
  assert.deepEqual(states, ['running', 'cancelled']);
  assert.deepEqual(gate.started, ['ext:a'], 'a cancelled job never reaches the runner');
});

test('cancelQueued stops everything still waiting', () => {
  const gate = gatedRunner();
  const queue = new ExtensionJobQueue({ run: gate.run, concurrency: 1 });
  queue.enqueue([install('a'), install('b'), install('c')]);

  const snapshot = queue.cancelQueued();

  assert.equal(snapshot.running, 1);
  assert.equal(snapshot.queued, 0);
  assert.equal(snapshot.jobs.filter((job) => job.state === 'cancelled').length, 2);
});

test('progress lands on the running job for that target', () => {
  const gate = gatedRunner();
  const queue = new ExtensionJobQueue({ run: gate.run, concurrency: 1 });
  queue.enqueue([install('a'), install('b')]);

  queue.progress('ext:a', { percent: 42, step: 'Downloading' });
  // Not running yet, so there is nothing for this to describe.
  queue.progress('ext:b', { percent: 90 });

  const [a, b] = queue.snapshot().jobs;
  assert.equal(a.percent, 42);
  assert.equal(a.step, 'Downloading');
  assert.equal(b.percent, undefined);
});

test('clearFinished keeps what is still working', async () => {
  const gate = gatedRunner();
  const queue = new ExtensionJobQueue({ run: gate.run, concurrency: 1 });
  queue.enqueue([install('a'), install('b')]);
  await gate.finish('ext:a');

  const snapshot = queue.clearFinished();

  assert.deepEqual(
    snapshot.jobs.map((job) => job.target),
    ['ext:b']
  );
});

test('every change reaches the notifier as the whole queue', async () => {
  const seen: number[] = [];
  const gate = gatedRunner();
  const queue = new ExtensionJobQueue({
    run: gate.run,
    concurrency: 1,
    notify: (snapshot) => seen.push(snapshot.jobs.length),
  });
  queue.enqueue([install('a'), install('b')]);
  await gate.finish('ext:a');

  assert.ok(seen.length >= 3);
  assert.ok(seen.every((count) => count === 2), 'a snapshot is never a delta');
});

test('Install all after Add installs, rather than joining the Add', () => {
  const gate = gatedRunner();
  const queue = new ExtensionJobQueue({ run: gate.run, concurrency: 3 });

  queue.enqueue([{ kind: 'addRepository', url: 'https://r.test/repo.json' }]);
  queue.enqueue([{ kind: 'installRepository', url: 'https://r.test/repo.json' }]);
  queue.enqueue([{ kind: 'installRepository', url: 'https://r.test/repo.json' }]);

  assert.deepEqual(
    queue.snapshot().jobs.map((job) => job.kind),
    ['addRepository', 'installRepository']
  );
});

test('enqueued jobs preserve their repositoryUrl', () => {
  const gate = gatedRunner();
  const queue = new ExtensionJobQueue({ run: gate.run, concurrency: 2 });

  queue.enqueue([
    install('pluginA'),
    { kind: 'addRepository', url: 'https://r.test/repo.json' },
  ]);

  const jobs = queue.snapshot().jobs;
  assert.equal(jobs[0].repositoryUrl, 'https://example.test/repo.json');
  assert.equal(jobs[1].repositoryUrl, 'https://r.test/repo.json');
});
