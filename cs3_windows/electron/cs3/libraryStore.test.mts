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
import { LibraryStore, mergeStoredSources } from './libraryStore.ts';
import type { DatastoreManager } from '../datastore.ts';
import type { TorrentResult } from '../../src/types/torrent.ts';

const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

/**
 * Enough of the datastore to hold objects in memory — as JSON text, the way the
 * real one does, so a read never shares objects with the last write.
 */
function fakeDatastore(): DatastoreManager {
  const values = new Map<string, string>();
  return {
    getString: (key: string, fallback = '') => values.get(key) ?? fallback,
    getObject: <T,>(key: string, fallback: T): T =>
      values.has(key) ? (JSON.parse(values.get(key) as string) as T) : fallback,
    setObject: (key: string, value: unknown) => {
      values.set(key, JSON.stringify(value));
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

// --- saved sources ---------------------------------------------------------

function found(overrides: Partial<TorrentResult> = {}): TorrentResult {
  return {
    infoHash: 'ext-aaaaaaaaaaaaaaaa',
    title: 'Dune Part Two 2024 1080p WEB-DL',
    magnet: '',
    sizeBytes: 0,
    seeders: 1,
    leechers: 0,
    indexerId: 'provider',
    indexerName: 'Voe',
    providerName: 'VegaMovies',
    directUrl: 'https://cdn.example/dune.mkv?Expires=9999999999',
    parsed: { resolution: 1080 } as TorrentResult['parsed'],
    score: 10,
    scoreReasons: ['a reason'],
    ...overrides,
  };
}

test('a discovery for a library title is saved on that title', () => {
  const s = store();
  s.upsertEntry({ title: 'Dune Part Two', year: 2024, mediaUrl: PAGES[0] });

  const key = s.mergeDiscoveredSources(PAGES[0], [found()]);

  assert.ok(key);
  const saved = s.getStoredSources(key);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].providerName, 'VegaMovies');
  assert.equal(saved[0].parsed, undefined, 'the bulky derived fields are not persisted');
  assert.equal(saved[0].scoreReasons, undefined);
});

test('a discovery for a title not in the library saves nothing', () => {
  const s = store();
  s.upsertEntry({ title: 'Dune Part Two', year: 2024, mediaUrl: PAGES[0] });
  assert.equal(s.mergeDiscoveredSources('https://elsewhere.example/other/', [found()]), null);
});

test('an episode discovery matches the page it was keyed by, query and all', () => {
  const s = store();
  s.upsertEntry({ title: 'Reacher', year: 2022, mediaUrl: 'cs3meta://tt9288030' });
  const key = s.mergeDiscoveredSources('cs3meta://tt9288030?season=1&episode=2', [found()], 1, 2);
  assert.ok(key);
  assert.equal(s.getStoredSources(key)[0].episode, 2);
});

test('a re-resolved link replaces its release rather than adding a row', () => {
  const s = store();
  s.upsertEntry({ title: 'Dune Part Two', year: 2024, mediaUrl: PAGES[0] });
  const key = s.mergeDiscoveredSources(PAGES[0], [found()])!;
  const firstSeen = s.getStoredSources(key)[0].discoveredAt;

  // Same release, new signed URL — and so a new synthetic infoHash.
  s.mergeDiscoveredSources(PAGES[0], [
    found({ infoHash: 'ext-bbbbbbbbbbbbbbbb', directUrl: 'https://cdn.example/dune.mkv?Expires=9999999998' }),
  ]);

  const saved = s.getStoredSources(key);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].directUrl, 'https://cdn.example/dune.mkv?Expires=9999999998');
  assert.equal(saved[0].discoveredAt, firstSeen, 'when it was first found is kept');
});

test('saved sources are capped, newest first', () => {
  const existing = Array.from({ length: 10 }, (_, i) => ({
    id: `old-${i}`,
    infoHash: `old${i}`,
    title: `Old ${i}`,
    status: 'Available' as const,
    discoveredAt: i,
  }));
  const incoming = [{ id: 'new', infoHash: 'new', title: 'New', status: 'Available' as const, discoveredAt: 99 }];
  const merged = mergeStoredSources(existing, incoming, 5);
  assert.equal(merged.length, 5);
  assert.equal(merged[0].id, 'new');
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
