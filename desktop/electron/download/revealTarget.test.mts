import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { resolveSafeRevealTarget } from './revealTarget.ts';

const downloads = path.resolve('C:/Users/test/Downloads/CloudStream');
const dataDir = path.resolve('C:/Users/test/AppData/Roaming/CloudStream');

test('defaults to downloads folder when targetPath is omitted or null', () => {
  assert.equal(resolveSafeRevealTarget(undefined, downloads, dataDir), downloads);
  assert.equal(resolveSafeRevealTarget(null, downloads, dataDir), downloads);
  assert.equal(resolveSafeRevealTarget('', downloads, dataDir), downloads);
});

test('permits paths directly inside the downloads folder', () => {
  const film = path.join(downloads, 'SciFi', 'Dune.mkv');
  assert.equal(resolveSafeRevealTarget(film, downloads, dataDir), film);
});

test('permits paths directly inside the userData directory', () => {
  const logFile = path.join(dataDir, 'logs', 'session.json');
  assert.equal(resolveSafeRevealTarget(logFile, downloads, dataDir), logFile);
});

test('rejects path traversal attempting to escape the downloads folder', () => {
  const escapeAttempt = path.join(downloads, '..', '..', 'Windows', 'System32');
  assert.equal(resolveSafeRevealTarget(escapeAttempt, downloads, dataDir), downloads);
});

test('rejects arbitrary external directories and defaults safely to downloads folder', () => {
  const externalFolder = path.resolve('C:/Windows/System32');
  assert.equal(resolveSafeRevealTarget(externalFolder, downloads, dataDir), downloads);
});
