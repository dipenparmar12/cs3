import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { answered, fingerprintOf, runToolOffThread, sameBinary } from './toolCapabilities.ts';

/**
 * The ffmpeg capability probe: remembered per binary, run off the main thread.
 *
 * Both halves exist because of one measurement — a cold `spawn` of the bundled
 * 87MB ffprobe blocks its calling thread ~590ms on Windows, and the startup
 * task used to do two of them on the main thread.
 */

test('a remembered answer holds only for the same binary', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs3-tools-'));
  const file = path.join(dir, 'ffprobe.exe');
  fs.writeFileSync(file, 'build one');
  const first = fingerprintOf(file);
  assert.ok(first);
  assert.equal(sameBinary(first!, fingerprintOf(file)), true);

  // A different build of the same name: the size moves, and so must the answer.
  fs.writeFileSync(file, 'a longer build two');
  assert.equal(sameBinary(first!, fingerprintOf(file)), false);

  assert.equal(fingerprintOf(path.join(dir, 'absent.exe')), null);
  assert.equal(sameBinary(undefined, fingerprintOf(file)), false);
});

test('a process started from the worker answers like runTool', async () => {
  const started = performance.now();
  const pending = runToolOffThread(process.execPath, ['--version'], 20_000);
  const blocked = performance.now() - started;

  const result = await pending;
  assert.equal(result.ok, true);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /^v\d+\./);
  assert.equal(answered(result), true);
  // The point of the worker. Creating it is a few milliseconds; the process
  // creation that used to cost ~590ms happens over there.
  assert.ok(blocked < 250, `the caller was blocked ${blocked.toFixed(0)}ms`);
});

test('a binary that cannot be run is not an answer worth remembering', async () => {
  const result = await runToolOffThread(path.join(os.tmpdir(), 'no-such-ffprobe.exe'), ['-h'], 5_000);
  assert.equal(result.ok, false);
  assert.equal(answered(result), false);
});
