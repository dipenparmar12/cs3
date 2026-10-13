import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  isLockedFileError,
  placeArchive,
  samePath,
  sideBySidePath,
  sweepDisplaced,
  type PlacementFs,
} from './archivePlacement.ts';

/**
 * Replacing an extension archive that Windows will not let go of.
 *
 * The real lock cannot be produced from Node — libuv opens files with
 * `FILE_SHARE_DELETE`, so a handle held here never blocks a rename the way the
 * JVM's does. The filesystem is faked instead, with the one behaviour that
 * matters: a held path refuses rename-over and unlink with `EPERM`, exactly
 * the error a user's update log recorded twice for the same extension.
 */

function lockError(): NodeJS.ErrnoException {
  const error = new Error('EPERM: operation not permitted, rename') as NodeJS.ErrnoException;
  error.code = 'EPERM';
  return error;
}

function fakeFs(initial: string[], held: Set<string> = new Set()) {
  const files = new Set(initial);
  const renames: Array<[string, string]> = [];
  const fsImpl: PlacementFs = {
    existsSync: (file) => files.has(file),
    chmodSync: () => {},
    renameSync: (from, to) => {
      if (held.has(to) || held.has(from)) throw lockError();
      if (!files.has(from)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      files.delete(from);
      files.add(to);
      renames.push([from, to]);
    },
    unlinkSync: (file) => {
      if (held.has(file)) throw lockError();
      files.delete(file);
    },
  };
  return { fsImpl, files, renames, held };
}

const TARGET = 'C:/ext/repo.1/Ultima.-1758189056.cs3';
const TEMP = `${TARGET}.1234.tmp`;
const DIGEST = 'ABCDEF0123456789aaaa';
const noWait = async () => {};

test('an unheld target is replaced in place, as it always was', async () => {
  const { fsImpl, files } = fakeFs([TARGET, TEMP]);
  const placed = await placeArchive({ tempPath: TEMP, target: TARGET, digest: DIGEST, fs: fsImpl, sleep: noWait });
  assert.deepEqual(placed, { path: TARGET, lockedTarget: false });
  assert.ok(files.has(TARGET) && !files.has(TEMP));
});

test('a hold that clears within the retries still lands in place', async () => {
  const { fsImpl, held } = fakeFs([TARGET, TEMP], new Set([TARGET]));
  let waits = 0;
  const placed = await placeArchive({
    tempPath: TEMP,
    target: TARGET,
    digest: DIGEST,
    fs: fsImpl,
    // An antivirus scan that finishes after the second wait.
    sleep: async () => {
      waits += 1;
      if (waits === 2) held.delete(TARGET);
    },
  });
  assert.deepEqual(placed, { path: TARGET, lockedTarget: false });
});

test('a hold that outlasts the retries puts the update beside the locked copy', async () => {
  const { fsImpl, files } = fakeFs([TARGET, TEMP], new Set([TARGET]));
  const placed = await placeArchive({ tempPath: TEMP, target: TARGET, digest: DIGEST, fs: fsImpl, sleep: noWait });

  assert.equal(placed.lockedTarget, true);
  assert.equal(placed.path, 'C:/ext/repo.1/Ultima.-1758189056.abcdef012345.cs3');
  assert.ok(files.has(placed.path), 'the new bytes are on disk under the new name');
  assert.ok(files.has(TARGET), 'the held copy is left for the sweep, not fought over');
  assert.ok(!files.has(TEMP));
});

test('a second attempt at the same bytes reuses the copy already placed beside', async () => {
  const beside = sideBySidePath(TARGET, DIGEST);
  // The side-by-side copy is itself loaded now, so it is held too.
  const { fsImpl, files } = fakeFs([TARGET, TEMP, beside], new Set([TARGET, beside]));
  const placed = await placeArchive({ tempPath: TEMP, target: TARGET, digest: DIGEST, fs: fsImpl, sleep: noWait });
  assert.deepEqual(placed, { path: beside, lockedTarget: true });
  assert.ok(!files.has(TEMP), 'the duplicate download is discarded');
});

test('a failure that is not a lock is reported, not retried around', async () => {
  const fsImpl: PlacementFs = {
    existsSync: () => false,
    chmodSync: () => {},
    renameSync: () => {
      throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' });
    },
    unlinkSync: () => {},
  };
  await assert.rejects(
    placeArchive({ tempPath: TEMP, target: TARGET, digest: DIGEST, fs: fsImpl, sleep: noWait }),
    /ENOSPC/
  );
});

test('the sweep deletes what has been released and keeps what is still held', () => {
  const released = 'C:/ext/repo.1/Old.1.cs3';
  const stillHeld = 'C:/ext/repo.1/Held.2.cs3';
  const pointedAtAgain = 'C:/ext/repo.1/Back.3.cs3';
  const { fsImpl, files } = fakeFs([released, stillHeld, pointedAtAgain], new Set([stillHeld]));

  const remaining = sweepDisplaced(
    [released, stillHeld, pointedAtAgain, 'C:/ext/gone.cs3'],
    (file) => file === pointedAtAgain,
    fsImpl
  );

  assert.deepEqual(remaining, [stillHeld]);
  assert.ok(!files.has(released));
  assert.ok(files.has(pointedAtAgain), 'an archive a record points at is never deleted');
});

test('lock detection covers what Windows answers for a held or read-only file', () => {
  for (const code of ['EPERM', 'EBUSY', 'EACCES']) {
    assert.equal(isLockedFileError(Object.assign(new Error(code), { code })), true, code);
  }
  assert.equal(isLockedFileError(Object.assign(new Error('x'), { code: 'ENOENT' })), false);
  assert.equal(isLockedFileError(null), false);
});

test('path comparison follows the platform', () => {
  assert.equal(samePath('/a/b/../c.cs3', '/a/c.cs3'), true);
  if (process.platform === 'win32') {
    assert.equal(samePath('C:\\Ext\\A.cs3', 'c:/ext/a.cs3'), true);
  }
});
