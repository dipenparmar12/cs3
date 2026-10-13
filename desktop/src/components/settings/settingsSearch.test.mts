import { test } from 'node:test';
import assert from 'node:assert/strict';

import { matchesSettingQuery, textOf } from './settingsSearch.ts';

/** Shaped like a React element, which is all `textOf` relies on. */
const el = (children: unknown) => ({ type: 'span', props: { children } });

test('nothing typed matches everything', () => {
  assert.equal(matchesSettingQuery('', 'Download folder'), true);
  assert.equal(matchesSettingQuery('   ', 'Download folder'), true);
});

test('a label matches case-insensitively', () => {
  assert.equal(matchesSettingQuery('download', 'Download folder'), true);
  assert.equal(matchesSettingQuery('subtitle', 'Download folder'), false);
});

test('a word found only in the explanation still finds the row', () => {
  const hint = el(['Asks ', el('itorrents.org'), ' for a magnet file list']);
  assert.equal(matchesSettingQuery('magnet', 'Fetch torrent details', hint), true);
});

test('every word has to appear somewhere, in any order', () => {
  assert.equal(matchesSettingQuery('folder download', 'Download folder'), true);
  assert.equal(matchesSettingQuery('download subtitles', 'Download folder'), false);
});

test('accents do not stop a match', () => {
  assert.equal(matchesSettingQuery('prefere', 'Préférences'), true);
});

test('textOf ignores what renders nothing', () => {
  assert.equal(textOf([null, undefined, false, 'a', 3, el(['b'])]).replace(/\s+/g, ' ').trim(), 'a 3 b');
});
