import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SubtitleLibrary, subtitleFileName, workKey } from './subtitleLibrary.ts';

function tempLibrary() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs3-subs-'));
  return { dir, lib: new SubtitleLibrary(dir) };
}

const VTT = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello\n';

test('file name carries title, episode, language and origin', () => {
  assert.equal(
    subtitleFileName({ title: 'Severance', season: 1, episode: 2, lang: 'eng', origin: 'opensubtitles' }),
    'Severance S01E02.eng.opensubtitles.vtt'
  );
  assert.equal(
    subtitleFileName({ title: 'Dune: Part Two', year: 2024, lang: 'eng', origin: 'provider' }),
    'Dune Part Two (2024).eng.provider.vtt'
  );
});

test('work key ignores punctuation and case', () => {
  assert.equal(workKey('Dune: Part Two', 2024), workKey('dune part two', 2024));
  assert.notEqual(workKey('Show', undefined, 1, 1), workKey('Show', undefined, 1, 2));
});

test('saving the same result twice reuses the file', () => {
  const { lib } = tempLibrary();
  const req = { title: 'Dune', year: 2021, lang: 'eng', langName: 'English', origin: 'opensubtitles' as const, sourceUrl: 'https://x/1', vtt: VTT };
  const first = lib.save(req);
  const second = lib.save(req);
  assert.equal(first.reused, false);
  assert.equal(second.reused, true);
  assert.equal(second.entry.filePath, first.entry.filePath);
  assert.equal(lib.list('Dune', 2021).length, 1);
});

test('refresh rewrites in place', () => {
  const { lib } = tempLibrary();
  const req = { title: 'Dune', lang: 'eng', langName: 'English', origin: 'opensubtitles' as const, sourceUrl: 'https://x/1', vtt: VTT };
  const first = lib.save(req);
  const again = lib.save({ ...req, vtt: `${VTT}\n`, refresh: true });
  assert.equal(again.reused, false);
  assert.equal(again.entry.id, first.entry.id);
  assert.equal(lib.read(first.entry.id), `${VTT}\n`);
});

test('two results for one work and language do not overwrite each other', () => {
  const { lib } = tempLibrary();
  const base = { title: 'Dune', lang: 'eng', langName: 'English', origin: 'opensubtitles' as const, vtt: VTT };
  const a = lib.save({ ...base, sourceUrl: 'https://x/1' });
  const b = lib.save({ ...base, sourceUrl: 'https://x/2' });
  assert.notEqual(a.entry.filePath, b.entry.filePath);
  assert.equal(lib.list('Dune').length, 2);
});

test('list is per episode and survives a missing year', () => {
  const { lib } = tempLibrary();
  const base = { title: 'Show', year: 2020, lang: 'eng', langName: 'English', origin: 'provider' as const, vtt: VTT };
  lib.save({ ...base, season: 1, episode: 1, sourceUrl: 'a' });
  lib.save({ ...base, season: 1, episode: 2, sourceUrl: 'b' });
  assert.equal(lib.list('Show', undefined, 1, 1).length, 1);
  assert.equal(lib.list('Show', 2020, 1, 2)[0].sourceUrl, 'b');
});

test('an entry whose file was deleted is dropped from the index', () => {
  const { dir, lib } = tempLibrary();
  const { entry } = lib.save({ title: 'Dune', lang: 'eng', langName: 'English', origin: 'opensubtitles', sourceUrl: 'u', vtt: VTT });
  fs.unlinkSync(entry.filePath);
  assert.equal(lib.list('Dune').length, 0);
  assert.equal(new SubtitleLibrary(dir).list('Dune').length, 0);
});
