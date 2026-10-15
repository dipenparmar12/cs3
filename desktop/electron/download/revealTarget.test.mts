import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { resolveSafeRevealTarget } from './revealTarget.ts';

const downloads = path.resolve('C:/Users/test/Downloads/CloudStream');
const osDownloads = path.resolve('C:/Users/test/Downloads');
const dataDir = path.resolve('C:/Users/test/AppData/Roaming/CloudStream');
const roots = [downloads, osDownloads, dataDir];

test('defaults to the download folder when no path is given', () => {
  assert.equal(resolveSafeRevealTarget(undefined, roots), downloads);
  assert.equal(resolveSafeRevealTarget(null, roots), downloads);
  assert.equal(resolveSafeRevealTarget('', roots), downloads);
});

test('permits paths inside any download root or the data folder', () => {
  const film = path.join(downloads, 'SciFi', 'Dune.mkv');
  assert.equal(resolveSafeRevealTarget(film, roots), film);
  const logFile = path.join(dataDir, 'logs', 'session.json');
  assert.equal(resolveSafeRevealTarget(logFile, roots), logFile);
});

test('a file this app downloaded is revealed even after the download folder changed', () => {
  const oldFile = path.resolve('D:/Old Movies/Heat (1995).mkv');
  assert.equal(resolveSafeRevealTarget(oldFile, roots, [oldFile]), oldFile);
  assert.equal(resolveSafeRevealTarget(path.dirname(oldFile), roots, [oldFile]), path.dirname(oldFile));
  // A sibling the app never wrote is not.
  assert.equal(resolveSafeRevealTarget(path.resolve('D:/Old Movies/other.exe'), roots, [oldFile]), downloads);
});

test('rejects traversal and arbitrary directories, falling back to downloads', () => {
  assert.equal(resolveSafeRevealTarget(path.join(downloads, '..', '..', '..', 'Windows', 'System32'), roots), downloads);
  assert.equal(resolveSafeRevealTarget(path.resolve('C:/Windows/System32'), roots), downloads);
  // A prefix is not containment.
  assert.equal(resolveSafeRevealTarget(path.resolve('C:/Users/test/DownloadsEvil'), [downloads, osDownloads]), downloads);
});

test('case-folded on Windows, as the filesystem is', () => {
  const film = path.join(downloads, 'Dune.mkv');
  assert.equal(resolveSafeRevealTarget(film.toUpperCase(), roots, [], 'win32'), path.resolve(film.toUpperCase()));
});
