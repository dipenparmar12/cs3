import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { AppStorage, OWNER_MARKER, isInside, migratePath, readMarker } from './appStorage.ts';
import { sweepCacheArea, sweepTemp } from './storageCleanup.ts';

const DAY = 86_400_000;

function root(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cs3-storage-'));
}

function write(file: string, bytes = 10, ageMs = 0): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.alloc(bytes));
  if (ageMs) {
    const when = new Date(Date.now() - ageMs);
    fs.utimesSync(file, when, when);
  }
}

// --- layout ------------------------------------------------------------------

test('every location is under the data root, built from path segments', () => {
  const dir = root();
  const storage = new AppStorage({ root: dir, downloads: () => path.join(dir, 'Downloads') });
  const where = storage.locations();
  for (const key of ['cache', 'temp', 'logs'] as const) {
    assert.ok(isInside(dir, where[key]), key);
  }
  assert.equal(where.data, path.resolve(dir));
  assert.equal(where.downloads, path.join(dir, 'Downloads'));
  // Downloads are never under cache or temp, so no sweep can reach them.
  assert.equal(isInside(where.cache, where.downloads), false);
  assert.equal(isInside(where.temp, where.downloads), false);
});

test('created directories carry the ownership marker', () => {
  const dir = root();
  const storage = new AppStorage({ root: dir, pid: 4242 });
  storage.cacheDir('torrent-pieces');
  const session = storage.sessionTempDir();
  assert.equal(readMarker(storage.cacheRoot)?.kind, 'cache-root');
  assert.equal(readMarker(session)?.kind, 'temp-session');
  assert.equal(readMarker(session)?.pid, 4242);
});

test('temp files are unique and inside this launch’s session', () => {
  const storage = new AppStorage({ root: root() });
  const a = storage.tempFile('cs3 sub/../x', 'vtt');
  const b = storage.tempFile('cs3 sub/../x', 'vtt');
  assert.notEqual(a, b);
  assert.ok(isInside(storage.sessionTempDir(), a));
  assert.ok(a.endsWith('.vtt'));
  assert.ok(!path.basename(a).includes('/'));
});

test('disposing the session removes it and tolerates it being gone already', () => {
  const storage = new AppStorage({ root: root() });
  write(storage.tempFile('x', 'bin'));
  const session = storage.sessionTempDir();
  storage.disposeSession();
  assert.equal(fs.existsSync(session), false);
  storage.disposeSession();
});

// --- temp sweep --------------------------------------------------------------

test('a dead process’s session goes; this one and a live one stay', async () => {
  const dir = root();
  const dead = new AppStorage({ root: dir, pid: 111, now: () => 1 });
  const live = new AppStorage({ root: dir, pid: 222, now: () => 2 });
  const mine = new AppStorage({ root: dir, pid: 333, now: () => 3 });
  write(dead.tempFile('a'));
  write(live.tempFile('b'));
  write(mine.tempFile('c'));
  // Captured before the sweep: asking afterwards would recreate them.
  const [deadDir, liveDir, mineDir] = [dead, live, mine].map((s) => s.sessionTempDir());

  const result = await sweepTemp(mine.tempRoot, { currentPid: 333, isAlive: (pid) => pid === 222 });
  assert.deepEqual(result.removed, [deadDir]);
  assert.equal(fs.existsSync(deadDir), false);
  assert.ok(fs.existsSync(liveDir));
  assert.ok(fs.existsSync(mineDir));
});

test('an unmarked directory or file in temp is never touched', async () => {
  const storage = new AppStorage({ root: root(), pid: 1 });
  storage.sessionTempDir();
  const stranger = path.join(storage.tempRoot, 'session-looks-like-ours-999');
  write(path.join(stranger, 'precious.txt'));
  write(path.join(storage.tempRoot, 'loose-file.txt'));

  await sweepTemp(storage.tempRoot, { currentPid: 1, isAlive: () => false });
  assert.ok(fs.existsSync(path.join(stranger, 'precious.txt')));
  assert.ok(fs.existsSync(path.join(storage.tempRoot, 'loose-file.txt')));
});

test('a temp root without a marker is not swept at all', async () => {
  const dir = root();
  const fake = path.join(dir, 'temp');
  fs.mkdirSync(path.join(fake, 'session-x-1'), { recursive: true });
  fs.writeFileSync(
    path.join(fake, 'session-x-1', OWNER_MARKER),
    JSON.stringify({ app: 'cloudstream-desktop', kind: 'temp-session', pid: 1, createdAt: 0 })
  );
  const result = await sweepTemp(fake, { currentPid: 2, isAlive: () => false });
  assert.equal(result.removed.length, 0);
  assert.ok(fs.existsSync(path.join(fake, 'session-x-1')));
});

test('a stable temp area loses old files only, and keeps itself', async () => {
  const storage = new AppStorage({ root: root(), pid: 5 });
  const jvm = storage.tempArea('jvm');
  write(path.join(jvm, 'old.tmp'), 10, 40 * DAY);
  write(path.join(jvm, 'new.tmp'), 10);
  await sweepTemp(storage.tempRoot, { currentPid: 5, areaMaxAgeMs: 30 * DAY });
  assert.equal(fs.existsSync(path.join(jvm, 'old.tmp')), false);
  assert.ok(fs.existsSync(path.join(jvm, 'new.tmp')));
  assert.ok(readMarker(jvm));
});

// --- cache sweep -------------------------------------------------------------

test('cache entries age out, active ones stay whatever their age', async () => {
  const storage = new AppStorage({ root: root() });
  const pieces = storage.cacheDir('torrent-pieces');
  write(path.join(pieces, 'Old Film', 'a.mkv'), 100, 10 * DAY);
  write(path.join(pieces, 'Streaming Now', 'b.mkv'), 100, 10 * DAY);
  write(path.join(pieces, 'Recent', 'c.mkv'), 100);
  // A directory's own mtime is a use too (a file was added); age those as well.
  for (const name of ['Old Film', 'Streaming Now']) {
    const when = new Date(Date.now() - 10 * DAY);
    fs.utimesSync(path.join(pieces, name), when, when);
  }
  const area = storage.registerCacheArea({
    id: 'torrent-pieces',
    label: 'Torrent pieces',
    path: pieces,
    kind: 'dir',
    maxAgeMs: 7 * DAY,
    isActive: (entry) => path.basename(entry) === 'Streaming Now',
  });

  const result = await sweepCacheArea(area, storage.cacheRoot);
  assert.deepEqual(result.removed.map((p) => path.basename(p)), ['Old Film']);
  assert.equal(result.freedBytes, 100);
  assert.ok(fs.existsSync(path.join(pieces, 'Streaming Now')));
  assert.ok(fs.existsSync(path.join(pieces, 'Recent')));
});

test('over the size limit, the least recently used go first', async () => {
  const storage = new AppStorage({ root: root() });
  const dir = storage.cacheDir('things');
  write(path.join(dir, 'oldest'), 100, 3 * DAY);
  write(path.join(dir, 'middle'), 100, 2 * DAY);
  write(path.join(dir, 'newest'), 100, 1 * DAY);
  const area = storage.registerCacheArea({ id: 't', label: 't', path: dir, kind: 'dir', maxBytes: 150 });
  const result = await sweepCacheArea(area, storage.cacheRoot);
  assert.deepEqual(result.removed.map((p) => path.basename(p)).sort(), ['middle', 'oldest']);
  assert.ok(fs.existsSync(path.join(dir, 'newest')));
});

test('a folder the viewer chose, outside cache/, is never swept automatically', async () => {
  const dir = root();
  const storage = new AppStorage({ root: dir });
  storage.cacheDir();
  const chosen = path.join(dir, 'MyMovies');
  write(path.join(chosen, 'keep.mkv'), 10, 100 * DAY);
  const area = storage.registerCacheArea({ id: 'p', label: 'p', path: chosen, kind: 'dir', maxAgeMs: 1 });
  assert.equal(area.managed, false);
  const result = await sweepCacheArea(area, storage.cacheRoot);
  assert.equal(result.removed.length, 0);
  assert.ok(fs.existsSync(path.join(chosen, 'keep.mkv')));
});

test('a self-managed file store is reported, never swept', async () => {
  const storage = new AppStorage({ root: root() });
  const file = storage.cacheFile('cs3-detail-cache.json');
  write(file, 10, 100 * DAY);
  const area = storage.registerCacheArea({ id: 'd', label: 'd', path: file, kind: 'self-managed', maxAgeMs: 1 });
  await sweepCacheArea(area, storage.cacheRoot);
  assert.ok(fs.existsSync(file));
});

test('a symlink inside the cache is removed as a link; its target survives', async () => {
  const dir = root();
  const storage = new AppStorage({ root: dir });
  const cache = storage.cacheDir('links');
  const outside = path.join(dir, 'outside');
  write(path.join(outside, 'precious.txt'));
  try {
    fs.symlinkSync(outside, path.join(cache, 'link'), 'junction');
  } catch {
    return; // No permission to make links here; nothing to prove.
  }
  const old = new Date(Date.now() - 10 * DAY);
  fs.lutimesSync(path.join(cache, 'link'), old, old);
  const area = storage.registerCacheArea({ id: 'l', label: 'l', path: cache, kind: 'dir', maxAgeMs: DAY });
  await sweepCacheArea(area, storage.cacheRoot);
  assert.ok(fs.existsSync(path.join(outside, 'precious.txt')));
});

// --- migration ---------------------------------------------------------------

test('a legacy cache file moves once, and never over a newer copy', () => {
  const dir = root();
  const storage = new AppStorage({ root: dir });
  const legacy = path.join(dir, 'cs3-catalogue-cache.json');
  fs.writeFileSync(legacy, 'old');
  const target = storage.migrateIntoCache(legacy);
  assert.equal(fs.readFileSync(target, 'utf8'), 'old');
  assert.equal(fs.existsSync(legacy), false);

  fs.writeFileSync(legacy, 'stale');
  storage.migrateIntoCache(legacy);
  assert.equal(fs.readFileSync(target, 'utf8'), 'old', 'the cache copy wins');
  assert.equal(fs.readFileSync(legacy, 'utf8'), 'stale', 'and the other is left, not deleted');
});

test('migrating something absent is a no-op', () => {
  assert.equal(migratePath(path.join(root(), 'nope'), path.join(root(), 'x')), false);
});
