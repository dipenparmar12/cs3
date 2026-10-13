/**
 * Exercises the real {@link SharedDiscovery}, not a copy of it.
 *
 *   bun run test:electron
 *   node --experimental-strip-types electron/sharedDiscovery.test.mts
 *
 * The first tests on this side of the app, and deliberately the cheapest thing
 * that could work: Node strips the types itself — which is possible only
 * because the project enforces `erasableSyntaxOnly` — so there is no framework,
 * no transform and no config to keep working.
 *
 * This module earns tests where the rest of `electron/` has none because it is
 * the one piece whose failure modes are invisible. Everything it does wrong
 * looks like something else: a doubled scrape reads as a slow provider, and a
 * wrongly-cancelled run reads as a flaky site. Neither would ever be traced
 * back here from a bug report.
 */
import assert from 'node:assert/strict';
import { SharedDiscovery } from './sharedDiscovery.ts';

const tests: Array<[string, () => Promise<void>]> = [];
const test = (name: string, fn: () => Promise<void>) => tests.push([name, fn]);

const tick = () => new Promise((r) => setTimeout(r, 5));

/**
 * A run that can be resolved by hand, counting how many times it was started.
 *
 * Every start gets its *own* resolver, recorded in `finishers`. Sharing one
 * across starts leaves the first run's promise orphaned, which deadlocks any
 * test that awaits it — a bug in the harness that looks exactly like a hang in
 * the code under test.
 */
function makeWork() {
  const state = {
    starts: 0,
    aborted: 0,
    emit: null as null | ((p: number) => void),
    finishers: [] as Array<(v: string) => void>,
  };
  const start = (emit: (p: number) => void, signal: AbortSignal) => {
    state.starts++;
    state.emit = emit;
    signal.addEventListener('abort', () => {
      state.aborted++;
    });
    return new Promise<string>((resolve) => {
      state.finishers.push(resolve);
    });
  };
  /** Resolves every run started so far, so nothing is left pending. */
  const finishAll = (value: string) => {
    for (const resolve of state.finishers) resolve(value);
  };
  return { state, start, finishAll };
}

test('a second caller joins instead of starting a second run', async () => {
  const shared = new SharedDiscovery<string, number>();
  const { state, start, finishAll } = makeWork();

  const a = shared.run('k', 'cached', () => true, start);
  const b = shared.run('k', 'cached', () => true, start);

  assert.equal(state.starts, 1, 'the work must only be started once');
  finishAll('done');
  assert.equal(await a, 'done');
  assert.equal(await b, 'done', 'both callers get the same result');
});

test('a late joiner is replayed the most recent progress', async () => {
  const shared = new SharedDiscovery<string, number>();
  const { state, start, finishAll } = makeWork();

  const seenByFirst: number[] = [];
  const first = shared.run('k', 'cached', () => true, start, {
    onProgress: (p) => seenByFirst.push(p),
  });

  state.emit!(3);

  const seenByLate: number[] = [];
  const late = shared.run('k', 'cached', () => true, start, {
    onProgress: (p) => seenByLate.push(p),
  });

  assert.deepEqual(seenByLate, [3], 'joining late must not mean an empty list');

  state.emit!(7);
  assert.deepEqual(seenByFirst, [3, 7]);
  assert.deepEqual(seenByLate, [3, 7]);

  finishAll('done');
  await Promise.all([first, late]);
});

test('one caller withdrawing does not cancel the run for the other', async () => {
  const shared = new SharedDiscovery<string, number>();
  const { state, start, finishAll } = makeWork();

  const prefetch = new AbortController();
  const player = new AbortController();

  const a = shared.run('k', 'cached', () => true, start, { signal: prefetch.signal });
  const b = shared.run('k', 'cached', () => true, start, { signal: player.signal });

  // The detail page unmounts a moment after Play was pressed.
  prefetch.abort();
  await tick();

  assert.equal(state.aborted, 0, 'the run must survive while the player is waiting');

  finishAll('done');
  assert.equal(await b, 'done');
  await a;
});

test('the run is cancelled once every caller has withdrawn', async () => {
  const shared = new SharedDiscovery<string, number>();
  const { state, start, finishAll } = makeWork();

  const one = new AbortController();
  const two = new AbortController();
  const a = shared.run('k', 'cached', () => true, start, { signal: one.signal });
  const b = shared.run('k', 'cached', () => true, start, { signal: two.signal });

  one.abort();
  await tick();
  assert.equal(state.aborted, 0);

  two.abort();
  await tick();
  assert.equal(state.aborted, 1, 'nobody is left waiting, so the work must stop');

  finishAll('done');
  await Promise.all([a, b]);
});

test('an aborted run is never joined', async () => {
  const shared = new SharedDiscovery<string, number>();
  const { state, start, finishAll } = makeWork();

  const only = new AbortController();
  const a = shared.run('k', 'cached', () => true, start, { signal: only.signal });
  only.abort();
  await tick();
  assert.equal(state.aborted, 1);

  // The player arrives just after the page unmounted. It must get fresh work,
  // not a cancelled result.
  const b = shared.run('k', 'cached', () => true, start);
  assert.equal(state.starts, 2, 'a cancelled run must not be handed to a new caller');

  finishAll('second');
  assert.equal(await b, 'second');
  await a;
});

test('a refresh does not join a run that may have answered from cache', async () => {
  const shared = new SharedDiscovery<string, number>();
  const { state, start, finishAll } = makeWork();

  shared.run('k', 'cached', () => true, start);
  // The predicate the ContentService passes for a bypassing caller.
  shared.run('k', 'bypass', (existing) => existing === 'bypass', start);

  assert.equal(state.starts, 2, 'a refresh must not be served by a cached run');
  finishAll('done');
});

test('a plain caller does join a bypassing run', async () => {
  const shared = new SharedDiscovery<string, number>();
  const { state, start, finishAll } = makeWork();

  shared.run('k', 'bypass', (existing) => existing === 'bypass', start);
  shared.run('k', 'cached', () => true, start);

  assert.equal(state.starts, 1, 'fresher work is still the right answer');
  finishAll('done');
});

test('different keys never share', async () => {
  const shared = new SharedDiscovery<string, number>();
  const { state, start, finishAll } = makeWork();

  shared.run('show|1|1', 'cached', () => true, start);
  shared.run('show|1|2', 'cached', () => true, start);

  assert.equal(state.starts, 2, 'episode 1 and episode 2 are different questions');
  finishAll('done');
});

test('a settled run is removed, so the next caller starts fresh', async () => {
  const shared = new SharedDiscovery<string, number>();
  const { state, start, finishAll } = makeWork();

  const a = shared.run('k', 'cached', () => true, start);
  finishAll('done');
  await a;
  await tick();

  assert.equal(shared.size, 0, 'a finished run must not be cached as in-flight');
  shared.run('k', 'cached', () => true, start);
  assert.equal(state.starts, 2);
  finishAll('done');
});

test('a subscriber that throws does not stop the others being told', async () => {
  const shared = new SharedDiscovery<string, number>();
  const { state, start, finishAll } = makeWork();

  shared.run('k', 'cached', () => true, start, {
    onProgress: () => {
      throw new Error('renderer blew up');
    },
  });
  const seen: number[] = [];
  shared.run('k', 'cached', () => true, start, { onProgress: (p) => seen.push(p) });

  state.emit!(5);
  assert.deepEqual(seen, [5]);
  finishAll('done');
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failed++;
    console.log(`  FAIL ${name}`);
    console.log(`       ${error instanceof Error ? error.message : String(error)}`);
  }
}
console.log(failed === 0 ? `\n${tests.length} passed` : `\n${failed} of ${tests.length} FAILED`);
process.exit(failed === 0 ? 0 : 1);
