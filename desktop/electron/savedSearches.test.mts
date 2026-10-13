import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { MAX_SAVED_RESULTS, SavedSearchStore } from './savedSearches.ts';
import type { SearchResponse } from '../src/types/api.ts';

/**
 * Saved search results: kept on request, dated, and never duplicated by a
 * second press of Save.
 */

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cs3-saved-searches-'));
}

function row(name: string, posterUrl?: string): SearchResponse {
  return { name, url: `cs3meta://${name}`, apiName: 'Catalogue', posterUrl } as SearchResponse;
}

let clock = 1_000;
const tick = () => (clock += 1_000);

test('a saved search keeps its rows and says when it was saved', () => {
  const store = new SavedSearchStore(tempDir(), tick);
  const summary = store.save({ query: 'dune', results: [row('Dune', 'p1'), row('Dune Part Two', 'p2')] });

  assert.ok(summary);
  assert.equal(summary.resultCount, 2);
  assert.deepEqual(summary.posters, ['p1', 'p2']);
  assert.equal(store.get(summary.id)?.results[1].name, 'Dune Part Two');
  assert.ok(summary.savedAt > 0);
});

test('saving the same query again updates it in place', () => {
  const store = new SavedSearchStore(tempDir(), tick);
  const first = store.save({ query: 'Dune', results: [row('Dune')] })!;
  const second = store.save({ query: '  dune ', results: [row('Dune'), row('Dune: Prophecy')] })!;

  assert.equal(second.id, first.id);
  assert.equal(store.list().length, 1);
  assert.equal(store.list()[0].resultCount, 2);
  assert.ok(second.savedAt > first.savedAt);
});

test('the same query in a different scope is a different list', () => {
  const store = new SavedSearchStore(tempDir(), tick);
  store.save({ query: 'dune', results: [row('Dune')] });
  store.save({ query: 'dune', results: [row('Dune')], providers: ['VegaMovies'] });

  const list = store.list();
  assert.equal(list.length, 2);
  assert.equal(list[0].scoped, true);
});

test('nothing to keep is not saved', () => {
  const store = new SavedSearchStore(tempDir(), tick);
  assert.equal(store.save({ query: 'dune', results: [] }), null);
  assert.equal(store.save({ query: '   ', results: [row('Dune')] }), null);
  assert.equal(store.list().length, 0);
});

test('a very long result list is capped', () => {
  const store = new SavedSearchStore(tempDir(), tick);
  const results = Array.from({ length: MAX_SAVED_RESULTS + 50 }, (_, i) => row(`Title ${i}`));
  const summary = store.save({ query: 'title', results })!;
  assert.equal(summary.resultCount, MAX_SAVED_RESULTS);
});

test('saved searches survive a restart, newest first', () => {
  const directory = tempDir();
  const store = new SavedSearchStore(directory, tick);
  store.save({ query: 'first', results: [row('A')] });
  store.save({ query: 'second', results: [row('B')] });
  store.flush();

  const reopened = new SavedSearchStore(directory, tick);
  assert.deepEqual(
    reopened.list().map((search) => search.query),
    ['second', 'first']
  );
});

test('a corrupt file starts empty rather than failing', () => {
  const directory = tempDir();
  fs.writeFileSync(path.join(directory, 'saved-searches.json'), '{ not json');
  const store = new SavedSearchStore(directory, tick);
  assert.deepEqual(store.list(), []);
});

test('remove forgets one search and keeps the rest', () => {
  const store = new SavedSearchStore(tempDir(), tick);
  const a = store.save({ query: 'a', results: [row('A')] })!;
  store.save({ query: 'b', results: [row('B')] });

  const left = store.remove(a.id);
  assert.deepEqual(
    left.map((search) => search.query),
    ['b']
  );
});

test('a restore keeps the newer copy of a search that exists on both sides', () => {
  const store = new SavedSearchStore(tempDir(), tick);
  const kept = store.save({ query: 'dune', results: [row('Dune'), row('Dune Part Two')] })!;
  const older = { ...store.get(kept.id)!, savedAt: 1, results: [row('stale')] };

  assert.equal(store.importAll([older, { nonsense: true }]), 0);
  assert.equal(store.get(kept.id)?.results.length, 2);
});
