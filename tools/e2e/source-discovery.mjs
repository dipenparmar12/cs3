#!/usr/bin/env node
/**
 * Behaviour of source discovery: progressive, cancellable, and honest about
 * which of those happened.
 *
 * The rule worth testing is not obvious from reading the code. `getSources`
 * resolves with the *complete* answer once every provider has settled — so a
 * session that was cancelled part-way through will still, eventually, be handed
 * a full result. Assigning it would silently undo the cancel and fill the list
 * with exactly the results the viewer declined to wait for, several seconds
 * after they pressed stop. What they saw when they stopped is what they keep.
 *
 * A fake ContentService stands in, because what is being checked is the
 * session's decisions rather than any provider's behaviour, and a fake is the
 * only way to hold "a provider answers after the cancel" still enough to assert
 * on it.
 *
 * Usage:
 *   node tools/e2e/source-discovery.mjs
 */

import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(path.resolve(HERE, '..', '..'), 'cs3_windows');

function compile() {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'cs3-disc-'));
  const binDir = path.join(APP, 'node_modules', '.bin');
  const tsc = ['tsc.exe', 'tsc.cmd', 'tsc']
    .map((name) => path.join(binDir, name))
    .find((candidate) => fs.existsSync(candidate));
  if (!tsc) throw new Error(`no tsc found in ${binDir}`);

  const result = spawnSync(
    tsc,
    [
      path.join(APP, 'electron', 'playbackSession.ts'),
      '--ignoreConfig',
      '--outDir', out,
      '--module', 'commonjs',
      '--target', 'es2022',
      '--moduleResolution', 'node10',
      '--ignoreDeprecations', '6.0',
      '--skipLibCheck',
    ],
    { encoding: 'utf8', shell: process.platform === 'win32' }
  );

  const emitted = path.join(out, 'electron', 'playbackSession.js');
  if (!fs.existsSync(emitted)) {
    console.error(result.stdout || result.stderr);
    throw new Error('tsc produced no output');
  }
  return emitted;
}

let passed = 0;
let failed = 0;

function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
    console.log(`  ok    ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        expected ${JSON.stringify(expected)}`);
    console.log(`        actual   ${JSON.stringify(actual)}`);
  }
}

const load = createRequire(import.meta.url);
const { PlaybackSessionManager } = load(compile());

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function source(name) {
  return { infoHash: name, title: name, indexerName: 'fake', sizeBytes: 0, seeders: 1 };
}

/**
 * A ContentService that answers on a schedule.
 *
 * `steps` are emitted one at a time with a gap, and the promise settles with the
 * full set — which is the property the cancel test turns on.
 */
function fakeContent(steps, gapMs = 20) {
  return {
    getSources: async (_request, onProgress, options = {}) => {
      const all = [];
      for (let i = 0; i < steps.length; i++) {
        await sleep(gapMs);
        all.push(...steps[i]);
        onProgress?.({
          results: [...all],
          settled: i + 1,
          totalRelevant: steps.length,
          lastIndexerName: `provider-${i + 1}`,
          done: i === steps.length - 1,
        });
      }
      return { sources: [...all], filtered: [], indexerOutcomes: [], query: {} };
    },
    getEngine: () => ({ stopStream: async () => {} }),
    getCache: () => ({ invalidate: () => {} }),
    startBestStream: async () => {
      throw new Error('discovery-only sessions must never start a stream');
    },
  };
}

// --- progressive arrival ---------------------------------------------------

console.log('\ndiscovering sources progressively');

{
  const manager = new PlaybackSessionManager(
    fakeContent([[source('a')], [source('b')], [source('c')]])
  );
  const snapshots = [];
  manager.setNotifier((s) => snapshots.push(s));

  const opening = manager.startDiscovery({ mediaUrl: 'x' }, 'A Film');
  check('the opening snapshot is returned before anything is found', opening.sources.length, 0);
  check('and it is not marked done', opening.searchDone, false);

  await sleep(150);
  const final = manager.get(opening.sessionId);

  check('every source arrives', final.sources.map((s) => s.infoHash), ['a', 'b', 'c']);
  check('the search is reported finished', final.searchDone, true);
  check('and not as cancelled', final.searchCancelled, false);

  // The point of a session: the list is visible while it is still growing.
  const partial = snapshots.filter((s) => s.sources.length > 0 && !s.searchDone);
  check('partial results were published before the end', partial.length > 0, true);
  check(
    'progress counts up rather than jumping to the total',
    snapshots.filter((s) => s.searched === 1).length > 0,
    true
  );
}

// --- cancelling ------------------------------------------------------------

console.log('\ncancelling a running search');

{
  const manager = new PlaybackSessionManager(
    fakeContent([[source('a')], [source('b')], [source('c')]], 40)
  );
  manager.setNotifier(() => {});

  const opening = manager.startDiscovery({ mediaUrl: 'x' }, 'A Film');

  // Let the first provider answer, then stop.
  await sleep(60);
  const stopped = manager.cancelDiscovery(opening.sessionId);

  check('what had been found is kept', stopped.sources.map((s) => s.infoHash), ['a']);
  check('the search is over', stopped.searchDone, true);
  check('and says it was stopped, not that it finished', stopped.searchCancelled, true);

  // The underlying call resolves with everything a moment later. This is the
  // case the guard exists for.
  await sleep(200);
  const after = manager.get(opening.sessionId);
  check(
    'late results do not undo the cancel',
    after.sources.map((s) => s.infoHash),
    ['a']
  );
  check('and it still reads as cancelled', after.searchCancelled, true);
}

{
  const manager = new PlaybackSessionManager(fakeContent([[source('a')]], 10));
  manager.setNotifier(() => {});
  const opening = manager.startDiscovery({ mediaUrl: 'x' }, 'A Film');
  await sleep(80);

  // Cancelling something already finished must not rewrite it as cancelled.
  const after = manager.cancelDiscovery(opening.sessionId);
  check('cancelling a finished search changes nothing', after.searchCancelled, false);
  check('and keeps its results', after.sources.length, 1);
}

check('cancelling an unknown session is a no-op, not a throw',
  new PlaybackSessionManager(fakeContent([])).cancelDiscovery('nope'), null);

// --- discovery must not start playback -------------------------------------

console.log('\nstaying out of the way');

{
  // `startBestStream` throws in the fake: reaching it at all is the failure.
  const manager = new PlaybackSessionManager(fakeContent([[source('a')]], 10));
  manager.setNotifier(() => {});
  const opening = manager.startDiscovery({ mediaUrl: 'x' }, 'A Film');
  await sleep(120);

  const after = manager.get(opening.sessionId);
  check('a discovery session never auto-starts a stream', after.phase, 'searching');
  check('and reports no error from having declined to', after.error, undefined);
}

{
  // The playing path still does auto-start — the distinction is the whole point
  // of having two entry points.
  let started = false;
  const content = fakeContent([[source('a')]], 10);
  content.startBestStream = async () => {
    started = true;
    return { handle: { infoHash: 'a', streamUrl: 'http://x', mimeType: 'video/mp4' }, attempts: [] };
  };

  const manager = new PlaybackSessionManager(content);
  manager.setNotifier(() => {});
  manager.start({ mediaUrl: 'x' }, 'A Film');
  await sleep(150);

  check('the playing path does start one', started, true);
}

// --- refresh ---------------------------------------------------------------

console.log('\nrefreshing');

{
  const seen = [];
  const content = fakeContent([[source('a')]], 10);
  const inner = content.getSources;
  content.getSources = (request, onProgress, options = {}) => {
    seen.push(Boolean(options.bypassCache));
    return inner(request, onProgress, options);
  };

  const manager = new PlaybackSessionManager(content);
  manager.setNotifier(() => {});
  const opening = manager.startDiscovery({ mediaUrl: 'x' }, 'A Film');
  await sleep(60);
  await manager.refresh(opening.sessionId);

  check('the first search may use the cache', seen[0], false);
  check('a refresh does not', seen[1], true);

  const after = manager.get(opening.sessionId);
  check('and the refreshed search is not marked cancelled', after.searchCancelled, false);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
