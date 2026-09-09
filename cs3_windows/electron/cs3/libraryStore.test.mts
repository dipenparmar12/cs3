/**
 * The address a library row is reopened by.
 *
 *   node --experimental-strip-types electron/cs3/libraryStore.test.mts
 *
 * `mediaUrl` arrives here from the renderer under one field name carrying two
 * different kinds of address. `load()` takes a **page**; `loadLinks()` takes an
 * opaque blob the provider built for itself, which for much of the corpus is
 * JSON. Both are strings, so nothing in the type system separates them — and
 * three separate renderer call sites have written the wrong one.
 *
 * The user-visible shape is the reason this is worth a test: the row is written
 * successfully, watched successfully, and comes up **blank** when it is clicked
 * a week later. That reads as data rot rather than as a wrong address, so it
 * gets diagnosed as a broken provider or a lost database — and it is neither.
 * Nothing about it is visible at the moment the mistake is made.
 *
 * The store is the last place that can tell, and the only one every call site
 * passes through, so the rule is enforced here rather than at each of them.
 */
import assert from 'node:assert/strict';
import { LibraryStore } from './libraryStore.ts';
import type { DatastoreManager } from '../datastore.ts';

const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

/** Enough of the datastore to hold objects in memory. */
function fakeDatastore(): DatastoreManager {
  const values = new Map<string, unknown>();
  return {
    getObject: <T,>(key: string, fallback: T): T =>
      values.has(key) ? (values.get(key) as T) : fallback,
    setObject: (key: string, value: unknown) => {
      values.set(key, value);
    },
  } as unknown as DatastoreManager;
}

const store = () => new LibraryStore(fakeDatastore());

/** VegaMovies and HDHub4U, verbatim in shape — the two corpus forms. */
const LINKS_HANDLES = [
  '[{"source":"https://vcloud.fit/ubvtmxgdjbx1xxu"}]',
  '["https://greenmountmotors.com/?id=THdEbjN","https://hubstream.art/#mlvoou"]',
  '{"id":"abc","server":"1"}',
];

const PAGES = [
  'https://vegamovies.example/dune-part-two/',
  'cs3ext://VegaMovies/https%3A%2F%2Fvegamovies.example%2Fdune%2F',
  // Internet Archive's `load()` takes a page; its `loadLinks` takes a bare id.
  // A rule like "must start with http" would refuse addresses that work.
  'archive-id-without-a-scheme',
];

test('a page address is stored unchanged', () => {
  for (const page of PAGES) {
    const s = store();
    const entry = s.upsertEntry({ title: 'Dune', year: 2024, mediaUrl: page });
    assert.deepEqual(entry.urls, [page], page);
  }
});

test('a bare links blob is refused as a library address', () => {
  for (const handle of LINKS_HANDLES) {
    const s = store();
    const entry = s.upsertEntry({ title: 'Dune', year: 2024, mediaUrl: handle });
    assert.deepEqual(entry.urls, [], handle);
  }
});

test('a links blob wrapped in cs3ext:// is refused too', () => {
  // The scheme does not record which kind of handle it carries, so unwrapping
  // is the only way to tell. This is the form the renderer actually sends.
  for (const handle of LINKS_HANDLES) {
    const s = store();
    const url = `cs3ext://VegaMovies/${encodeURIComponent(handle)}`;
    assert.deepEqual(s.upsertEntry({ title: 'Dune', year: 2024, mediaUrl: url }).urls, [], url);
  }
});

test('a refused address does not displace one already stored', () => {
  const s = store();
  const page = 'https://vegamovies.example/dune/';
  s.upsertEntry({ title: 'Dune', year: 2024, mediaUrl: page });
  const after = s.upsertEntry({
    title: 'Dune',
    year: 2024,
    mediaUrl: `cs3ext://VegaMovies/${encodeURIComponent(LINKS_HANDLES[0])}`,
  });
  assert.deepEqual(after.urls, [page]);
});

test('watch progress still records when the address is refused', () => {
  /**
   * The point of dropping it rather than rejecting the write. Progress is keyed
   * on title + year + season + episode and never on the URL, so the resume
   * point survives intact — what is lost is a link that was going to fail.
   */
  const s = store();
  const row = s.recordProgress({
    title: 'Reacher',
    year: 2023,
    season: 2,
    episode: 3,
    mediaUrl: `cs3ext://HDHub4U/${encodeURIComponent(LINKS_HANDLES[1])}`,
    positionSeconds: 900,
    durationSeconds: 3000,
  });
  assert.ok(row, 'progress must still be recorded');
  assert.equal(row.positionSeconds, 900);
  assert.equal(row.mediaUrl, '', 'the dead address must not be carried');
  assert.equal(s.getProgress(row.key, 2, 3)?.positionSeconds, 900);
});

test('progress keeps a real page address', () => {
  const s = store();
  const page = 'https://hdhub4u.example/reacher/';
  const row = s.recordProgress({
    title: 'Reacher',
    year: 2023,
    season: 2,
    episode: 3,
    mediaUrl: page,
    positionSeconds: 900,
    durationSeconds: 3000,
  });
  assert.equal(row?.mediaUrl, page);
});

test('an entry created by recordProgress carries no dead address either', () => {
  // recordProgress upserts the library entry when none exists; that path has
  // to be covered by the same rule or the row is unreachable from the library
  // while Continue Watching looks fine.
  const s = store();
  s.recordProgress({
    title: 'Reacher',
    year: 2023,
    mediaUrl: `cs3ext://HDHub4U/${encodeURIComponent(LINKS_HANDLES[0])}`,
    positionSeconds: 900,
    durationSeconds: 3000,
  });
  const entries = s.getEntries();
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0].urls, []);
});

// --- runner ----------------------------------------------------------------

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failed++;
    console.log(`  FAIL ${name}`);
    console.log(`       ${error instanceof Error ? error.message : String(error)}`);
  }
}
console.log(failed === 0 ? `\n${tests.length} passed` : `\n${failed} of ${tests.length} FAILED`);
process.exit(failed === 0 ? 0 : 1);
