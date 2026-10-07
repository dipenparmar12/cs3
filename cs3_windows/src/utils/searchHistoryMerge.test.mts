import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeHistoryAndSaved } from './searchHistoryMerge.ts';
import type { SearchHistoryEntry } from '../types/api.ts';
import type { SavedSearchSummary } from '../../electron/savedSearches.ts';

test('mergeHistoryAndSaved with empty inputs returns empty array', () => {
  const result = mergeHistoryAndSaved([], []);
  assert.deepEqual(result, []);
});

test('un-saved history entries are preserved in chronological order', () => {
  const history: SearchHistoryEntry[] = [
    { query: 'inception', at: 2000, resultCount: 15 },
    { query: 'interstellar', at: 1000, resultCount: 20 },
  ];
  const result = mergeHistoryAndSaved(history, []);
  assert.equal(result.length, 2);
  assert.equal(result[0].query, 'inception');
  assert.equal(result[0].isSaved, undefined);
  assert.equal(result[1].query, 'interstellar');
});

test('history entry matching saved search is decorated with saved metadata', () => {
  const history: SearchHistoryEntry[] = [
    { query: 'Dune', at: 1000, resultCount: 50 },
  ];
  const saved: SavedSearchSummary[] = [
    {
      id: 'saved_dune',
      query: 'dune',
      savedAt: 1500,
      resultCount: 48,
      posters: [],
      scoped: false,
    },
  ];

  const result = mergeHistoryAndSaved(history, saved);
  assert.equal(result.length, 1);
  assert.equal(result[0].query, 'Dune');
  assert.equal(result[0].isSaved, true);
  assert.equal(result[0].savedId, 'saved_dune');
  assert.equal(result[0].savedResultCount, 48);
  assert.equal(result[0].at, 1500); // Updated to latest interaction time
});

test('saved search not present in history is included in the unified list', () => {
  const history: SearchHistoryEntry[] = [
    { query: 'batman', at: 1000, resultCount: 10 },
  ];
  const saved: SavedSearchSummary[] = [
    {
      id: 'saved_avatar',
      query: 'avatar',
      savedAt: 2000,
      resultCount: 30,
      posters: [],
      scoped: false,
    },
  ];

  const result = mergeHistoryAndSaved(history, saved);
  assert.equal(result.length, 2);
  // Avatar is newer (2000 > 1000), so it appears first
  assert.equal(result[0].query, 'avatar');
  assert.equal(result[0].isSaved, true);
  assert.equal(result[0].savedId, 'saved_avatar');

  // Batman appears second
  assert.equal(result[1].query, 'batman');
  assert.equal(result[1].isSaved, undefined);
});

test('newer un-saved search appears before older saved search (no artificial pinning)', () => {
  const history: SearchHistoryEntry[] = [
    { query: 'superman', at: 3000, resultCount: 5 },
    { query: 'batman', at: 1000, resultCount: 12 },
  ];
  const saved: SavedSearchSummary[] = [
    {
      id: 'saved_batman',
      query: 'batman',
      savedAt: 1000,
      resultCount: 12,
      posters: [],
      scoped: false,
    },
  ];

  const result = mergeHistoryAndSaved(history, saved);
  assert.equal(result.length, 2);
  assert.equal(result[0].query, 'superman');
  assert.equal(result[0].isSaved, undefined);
  assert.equal(result[1].query, 'batman');
  assert.equal(result[1].isSaved, true);
});

test('case and whitespace normalization deduplicates history and saved queries', () => {
  const history: SearchHistoryEntry[] = [
    { query: '  The Matrix  ', at: 1000 },
  ];
  const saved: SavedSearchSummary[] = [
    {
      id: 'saved_matrix',
      query: 'the matrix',
      savedAt: 2000,
      resultCount: 4,
      posters: [],
      scoped: false,
    },
  ];

  const result = mergeHistoryAndSaved(history, saved);
  assert.equal(result.length, 1);
  assert.equal(result[0].isSaved, true);
  assert.equal(result[0].savedId, 'saved_matrix');
  assert.equal(result[0].at, 2000);
});
