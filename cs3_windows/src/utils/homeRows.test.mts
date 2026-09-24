import { test } from 'node:test';
import assert from 'node:assert/strict';

import { mergePage, readHiddenRows, setRowVisible, writeHiddenRows } from './homeRows.ts';
import type { SearchResponse } from '../types/api.ts';

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    values,
  };
}

const item = (url: string): SearchResponse =>
  ({ name: url, url, apiName: 'Catalogue', type: 'Movie' }) as SearchResponse;

test('a hidden row stays hidden across launches', () => {
  const storage = memoryStorage();
  writeHiddenRows(storage, ['featured', 'native:iptv-org:news']);
  assert.deepEqual(readHiddenRows(storage), ['featured', 'native:iptv-org:news']);
});

test('the old anime switch is honoured the first time the picker is read', () => {
  assert.deepEqual(readHiddenRows(memoryStorage({ home_include_anime: 'false' })), ['trending-anime']);
  assert.deepEqual(readHiddenRows(memoryStorage({ home_include_anime: 'true' })), []);
  // Once the picker has written its own answer, that answer is the one read.
  assert.deepEqual(
    readHiddenRows(memoryStorage({ home_include_anime: 'false', home_hidden_rows: '[]' })),
    []
  );
});

test('an unreadable preference shows everything rather than failing', () => {
  assert.deepEqual(readHiddenRows(memoryStorage({ home_hidden_rows: '{not json' })), []);
  assert.deepEqual(readHiddenRows(null), []);
  const refusing = { getItem: () => { throw new Error('denied'); } };
  assert.deepEqual(readHiddenRows(refusing), []);
});

test('switching a row on and off is idempotent', () => {
  let hidden = setRowVisible([], 'trending', false);
  hidden = setRowVisible(hidden, 'trending', false);
  assert.deepEqual(hidden, ['trending']);
  assert.deepEqual(setRowVisible(hidden, 'trending', true), []);
});

test('a page that overlaps the last one adds only what is new', () => {
  const merged = mergePage([item('a'), item('b')], [item('b'), item('c'), item('c')]);
  assert.deepEqual(merged.items.map((row) => row.url), ['a', 'b', 'c']);
  assert.equal(merged.added, 1);
});

test('a page of nothing but repeats adds nothing, which is how the end is recognised', () => {
  assert.equal(mergePage([item('a'), item('b')], [item('a'), item('b')]).added, 0);
  assert.equal(mergePage([item('a')], []).added, 0);
});
