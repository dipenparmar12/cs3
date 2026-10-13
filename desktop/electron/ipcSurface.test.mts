import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The IPC surface has to agree with itself, and nothing else checks that.
 *
 * Five real bugs were found in one pass by diffing the channel strings in
 * `main.ts` against the ones in `preload.ts`, and every one of them had the same
 * shape: a string that stopped matching a string.
 *
 *   - `binary:setupBinaries` was invoked and never registered, so the first-run
 *     component installer rejected on every press and rendered the raw Electron
 *     message as a friendly notice.
 *   - `runtime:repair` was exposed on the typed API and never registered.
 *   - `discover:invalidated` was pushed by main and listened for by nobody, so
 *     changing the home catalogue left the previous one on screen for six hours.
 *   - `extension:getRuntimeReport`, `media:getProbeConfig` and
 *     `media:setProbeConfig` were registered and unreachable.
 *
 * TypeScript cannot see any of this — the channel is a string literal on both
 * sides and the two files never refer to each other. The tests could not see it
 * either. The user-visible form is always a dead button or a silent no-op, which
 * is the hardest kind of bug to attribute, so this is the cheapest high-value
 * test in the repo.
 *
 * It is deliberately a *lexical* check rather than a runtime one. Loading
 * `main.ts` would boot the whole service graph; the strings are what matters and
 * the strings are right there.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const main = fs.readFileSync(path.join(here, 'main.ts'), 'utf8');
const preload = fs.readFileSync(path.join(here, 'preload.ts'), 'utf8');

function channels(source: string, pattern: RegExp): Set<string> {
  return new Set([...source.matchAll(pattern)].map((match) => match[1]));
}

const registered = channels(main, /ipcMain\.(?:handle|on)\(\s*'([^']+)'/g);
const invoked = channels(preload, /ipcRenderer\.(?:invoke|send)\(\s*'([^']+)'/g);
const pushed = channels(main, /webContents\.send\(\s*'([^']+)'/g);
const listened = new Set([
  ...channels(preload, /ipcRenderer\.on\(\s*'([^']+)'/g),
  // `subscribe()` owns the listener/teardown pair for most push channels.
  ...channels(preload, /subscribe(?:<[^>]*>)?\(\s*'([^']+)'/g),
]);

/**
 * Channels that are deliberately one-sided.
 *
 * Add to this only with a reason, and only for a channel that genuinely has no
 * counterpart by design. "I will wire it later" is not a reason — an entry here
 * is indistinguishable from a working feature to everyone who reads the code.
 */
const ALLOWED_MAIN_ONLY = new Set<string>([]);
const ALLOWED_PUSH_WITHOUT_LISTENER = new Set<string>([]);

const missing = (from: Set<string>, present: Set<string>, allowed: Set<string>) =>
  [...from].filter((channel) => !present.has(channel) && !allowed.has(channel)).sort();

test('every channel the preload invokes is registered in main', () => {
  assert.deepEqual(
    missing(invoked, registered, new Set()),
    [],
    'the renderer would get an unhandled rejection, not a failure envelope'
  );
});

test('every channel main registers is reachable from the preload', () => {
  assert.deepEqual(
    missing(registered, invoked, ALLOWED_MAIN_ONLY),
    [],
    'a registered handler reads as a feature that exists; expose it or delete it'
  );
});

test('every event main pushes has a listener in the preload', () => {
  assert.deepEqual(
    missing(pushed, listened, ALLOWED_PUSH_WITHOUT_LISTENER),
    [],
    'the renderer never learns the thing happened'
  );
});

test('the preload listens for no event main never pushes', () => {
  assert.deepEqual(
    missing(listened, pushed, new Set()),
    [],
    'a listener for a channel nothing sends is a callback that never fires'
  );
});

test('the surface is large enough that the parse is obviously working', () => {
  // A regex that silently stopped matching would make every test above pass.
  assert.ok(registered.size > 200, `only found ${registered.size} handlers — check the pattern`);
  assert.ok(invoked.size > 200, `only found ${invoked.size} invokes — check the pattern`);
  assert.ok(pushed.size > 5, `only found ${pushed.size} push channels — check the pattern`);
});
