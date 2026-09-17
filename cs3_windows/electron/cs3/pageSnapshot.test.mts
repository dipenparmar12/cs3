import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PageSnapshotStore, mergeSnapshot, type PageSnapshot } from './pageSnapshot.ts';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cs3-page-snapshot-'));
}

const NOW = 1_700_000_000_000;

/**
 * The rule the whole store exists for. A provider that answers with a title and
 * nothing else is the routine case — a page shape changed, a field moved, a
 * request was throttled — and it must not be allowed to blank a page the app
 * already knew how to draw.
 */
test('mergeSnapshot never blanks a known field with an empty one', () => {
  const stored = mergeSnapshot(
    undefined,
    {
      url: 'cs3ext://Provider/dune',
      title: 'Dune',
      year: 2021,
      posterUrl: 'https://example.test/poster.jpg',
      plot: 'A noble family becomes embroiled in a war.',
      tags: ['Sci-Fi'],
      rating: 82,
      actors: ['Timothée Chalamet'],
      imdbId: 'tt1160419',
    },
    NOW
  );

  const afterThinLoad = mergeSnapshot(
    stored,
    { url: 'cs3ext://Provider/dune', title: 'Dune', plot: '', tags: [], posterUrl: undefined },
    NOW + 1000
  );

  assert.equal(afterThinLoad.posterUrl, 'https://example.test/poster.jpg');
  assert.equal(afterThinLoad.plot, 'A noble family becomes embroiled in a war.');
  assert.deepEqual(afterThinLoad.tags, ['Sci-Fi']);
  assert.deepEqual(afterThinLoad.actors, ['Timothée Chalamet']);
  assert.equal(afterThinLoad.imdbId, 'tt1160419');
  assert.equal(afterThinLoad.year, 2021, 'A year the reload omitted is not dropped');
});

test('mergeSnapshot lets a real answer correct a stored one', () => {
  const stored = mergeSnapshot(
    undefined,
    { url: 'cs3ext://Provider/dune', title: 'Dune', plot: 'Wrong plot.', rating: 10 },
    NOW
  );
  const corrected = mergeSnapshot(
    stored,
    { url: 'cs3ext://Provider/dune', title: 'Dune: Part One', plot: 'Right plot.', rating: 82 },
    NOW + 1000
  );

  assert.equal(corrected.title, 'Dune: Part One');
  assert.equal(corrected.plot, 'Right plot.');
  assert.equal(corrected.rating, 82);
  assert.equal(corrected.capturedAt, NOW, 'First capture time survives');
  assert.equal(corrected.verifiedAt, NOW + 1000);
});

/**
 * Splicing two partial episode listings together would invent a season no
 * provider offers, so the list is taken whole or left alone.
 */
test('mergeSnapshot keeps an episode list whole rather than splicing', () => {
  const stored = mergeSnapshot(
    undefined,
    {
      url: 'cs3ext://Provider/show',
      title: 'Show',
      episodes: [
        { name: 'One', url: 'e1', season: 1, episode: 1 },
        { name: 'Two', url: 'e2', season: 1, episode: 2 },
      ],
    },
    NOW
  );

  const noEpisodes = mergeSnapshot(
    stored,
    { url: 'cs3ext://Provider/show', title: 'Show', episodes: [] },
    NOW + 1
  );
  assert.equal(noEpisodes.episodes?.length, 2, 'An empty listing does not erase the stored one');

  const rescraped = mergeSnapshot(
    stored,
    {
      url: 'cs3ext://Provider/show',
      title: 'Show',
      episodes: [{ name: 'Only', url: 'e9', season: 2, episode: 1 }],
    },
    NOW + 2
  );
  assert.deepEqual(
    rescraped.episodes?.map((e) => e.url),
    ['e9'],
    'A real listing replaces the stored one entirely'
  );
});

test('mergeSnapshot leads the route list with the page own address', () => {
  const stored = mergeSnapshot(
    undefined,
    { url: 'cs3ext://A/x', title: 'X', routes: ['cs3ext://B/x', 'cs3ext://C/x'] },
    NOW
  );
  assert.deepEqual(stored.routes, ['cs3ext://A/x', 'cs3ext://B/x', 'cs3ext://C/x']);

  const later = mergeSnapshot(stored, { url: 'cs3ext://A/x', title: 'X', routes: ['cs3ext://B/x'] }, NOW + 1);
  assert.deepEqual(later.routes, ['cs3ext://A/x', 'cs3ext://B/x', 'cs3ext://C/x'], 'No duplicates, nothing lost');
});

test('mergeSnapshot merges origin without overwriting a known value with nothing', () => {
  const stored = mergeSnapshot(
    undefined,
    {
      url: 'cs3ext://A/x',
      title: 'X',
      origin: { provider: 'A', repositoryName: 'Repo', searchQuery: 'x' },
    },
    NOW
  );
  const later = mergeSnapshot(
    stored,
    { url: 'cs3ext://A/x', title: 'X', origin: { provider: 'A', repositoryName: '', extensionName: 'Ext' } },
    NOW + 1
  );

  assert.equal(later.origin.repositoryName, 'Repo');
  assert.equal(later.origin.searchQuery, 'x');
  assert.equal(later.origin.extensionName, 'Ext');
});

test('mergeSnapshot marked unverified does not claim the page still works', () => {
  const stored = mergeSnapshot(undefined, { url: 'u', title: 'T' }, NOW);
  const annotated = mergeSnapshot(
    stored,
    { url: 'u', title: 'T', origin: { searchQuery: 'later' }, verified: false },
    NOW + 60_000
  );
  assert.equal(annotated.verifiedAt, NOW, 'Only a live load moves the age forward');
  assert.equal(annotated.origin.searchQuery, 'later');
});

// --- store ----------------------------------------------------------------

test('PageSnapshotStore finds a page by title when the address has changed', () => {
  const store = new PageSnapshotStore(tempDir());
  store.capture({ url: 'cs3ext://OldProvider/dune', title: 'Dune', year: 2021, posterUrl: 'p.jpg' });

  // The library opens whichever URL it recorded first, which is routinely not
  // the one the page was captured under.
  const found = store.find({ url: 'cs3ext://SomethingElse/dune', title: 'Dune', year: 2021 });
  assert.ok(found, 'Falls back to the canonical title key');
  assert.equal(found?.posterUrl, 'p.jpg');
});

test('PageSnapshotStore finds a page by an alternate route', () => {
  const store = new PageSnapshotStore(tempDir());
  store.capture({
    url: 'cs3ext://A/x',
    title: 'X',
    routes: ['cs3ext://B/x'],
  });
  const found = store.find({ url: 'cs3ext://B/x' });
  assert.equal(found?.url, 'cs3ext://A/x');
});

test('PageSnapshotStore prefers the most recently verified copy of one work', () => {
  const store = new PageSnapshotStore(tempDir());
  store.capture({ url: 'cs3ext://A/x', title: 'X', year: 2020, plot: 'old' });
  store.capture({ url: 'cs3ext://B/x', title: 'X', year: 2020, plot: 'new' });

  const found = store.find({ title: 'X', year: 2020 });
  assert.equal(found?.plot, 'new');
});

test('PageSnapshotStore keeps pinned pages and evicts the rest', () => {
  const store = new PageSnapshotStore(tempDir());
  store.capture({ url: 'keep', title: 'Kept' });
  store.setPinned({ url: 'keep' }, true);

  for (let i = 0; i < 700; i++) store.capture({ url: `u${i}`, title: `T${i}` });

  assert.ok(store.find({ url: 'keep' }), 'A saved page survives eviction pressure');
  assert.ok(store.size() <= 601, `Unpinned entries are capped (size ${store.size()})`);
});

test('PageSnapshotStore reloads what it wrote', () => {
  const dir = tempDir();
  const store = new PageSnapshotStore(dir);
  store.capture({
    url: 'cs3ext://A/x',
    title: 'X',
    year: 1999,
    plot: 'kept across restarts',
    origin: { provider: 'A', searchQuery: 'x' },
  });
  store.flush();

  const reopened = new PageSnapshotStore(dir);
  const found = reopened.find({ title: 'X', year: 1999 });
  assert.equal(found?.plot, 'kept across restarts');
  assert.equal(found?.origin.provider, 'A');
});

test('PageSnapshotStore replaceAll rebuilds the title index', () => {
  const store = new PageSnapshotStore(tempDir());
  const entry: PageSnapshot = {
    url: 'cs3ext://A/x',
    key: 'x:2001',
    title: 'X',
    year: 2001,
    routes: ['cs3ext://A/x'],
    origin: {},
    capturedAt: NOW,
    verifiedAt: NOW,
    lastUsedAt: NOW,
  };
  assert.equal(store.replaceAll([entry]), 1);
  assert.ok(store.find({ title: 'X', year: 2001 }), 'A restored page is findable by title');
});
