import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadWatchState } from './seriesContext.ts';
import { resumeSeconds } from '../../utils/resumePoint.ts';

/**
 * Progress is written for anything played; a library entry exists only for a
 * title someone filed in a bucket. Measured on a real install: Extraction II
 * held 1,099s under `extraction-ii:2023` with no library entry, and every
 * return to it — from History, from the detail page — started at 0:00.
 */
function stubStore(entry: { key: string } | null) {
  const asked: string[] = [];
  (globalThis as unknown as { window: unknown }).window = {
    cloudstream: {
      getLibraryEntryForUrl: async () => entry,
      getProgressForKey: async (key: string) => {
        asked.push(key);
        return key === 'extraction-ii:2023'
          ? [{ key, positionSeconds: 1099, durationSeconds: 7437, completed: false }]
          : [];
      },
    },
  };
  return asked;
}

test('a title never added to the library still resumes, by title and year', async () => {
  const asked = stubStore(null);
  const state = await loadWatchState('cs3ext://CineTv/x', { title: 'Extraction II', year: 2023 });
  assert.deepEqual(asked, ['extraction-ii:2023']);
  assert.equal(resumeSeconds(state, null), 1099);
});

test('a library entry still decides the key when there is one', async () => {
  const asked = stubStore({ key: 'extraction-ii:2023' });
  await loadWatchState('cs3ext://CineTv/x', { title: 'Something Else', year: 1999 });
  assert.deepEqual(asked, ['extraction-ii:2023']);
});

test('with neither an entry nor a title there is nothing to look up', async () => {
  const asked = stubStore(null);
  assert.deepEqual(await loadWatchState('cs3ext://CineTv/x'), {});
  assert.deepEqual(asked, []);
});
