import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { isInside, mayServeLocalFile } from './localFiles.ts';

const W = path.win32;

test('a video or subtitle plays wherever the viewer keeps it', () => {
  assert.equal(mayServeLocalFile('D:\\Films\\Dune (2021).mkv', [], 'win32'), true);
  assert.equal(mayServeLocalFile('/home/a/Videos/clip.MP4', [], 'linux'), true);
  assert.equal(mayServeLocalFile('/home/a/Videos/film.srt', [], 'linux'), true);
});

test('anything else only from the download folders — never app data or secrets', () => {
  const downloads = ['D:\\Movies'];
  assert.equal(mayServeLocalFile('C:\\Users\\a\\AppData\\Roaming\\CloudStream 3 Desktop\\cs3_datastore.json', downloads, 'win32'), false);
  assert.equal(mayServeLocalFile('C:\\Users\\a\\.ssh\\id_ed25519', downloads, 'win32'), false);
  // A download a provider named without a media extension still plays.
  assert.equal(mayServeLocalFile('D:\\Movies\\Some Film', downloads, 'win32'), true);
});

test('inside means inside: no prefix tricks, no climbing out, case-folded on Windows', () => {
  assert.equal(path.sep === '\\' ? isInside('D:\\Movies2\\x', 'D:\\Movies', 'win32') : !isInside('/m2/x', '/m'), false);
  assert.equal(isInside('/data/movies/../secret', '/data/movies', 'linux'), false);
  assert.equal(isInside('/data/movies/a/b.bin', '/data/movies', 'linux'), true);
  if (path.sep === '\\') {
    assert.equal(isInside('d:\\MOVIES\\x.bin', 'D:\\Movies', 'win32'), true);
    assert.equal(W.isAbsolute('D:\\'), true);
  }
});

test('null bytes are refused', () => {
  assert.equal(mayServeLocalFile('/a/b.mkv\0.json', [], 'linux'), false);
});
