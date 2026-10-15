import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TitleInteractionStore,
  entryMatchesQuery,
  watchMatchesQuery,
} from './titleInteractions.ts';
import type { LibraryEntry, WatchProgress } from './libraryStore.ts';
import { canonicalKey } from './libraryStore.ts';
import { WatchStatus } from '../../src/types/api.ts';
import type { PlayedSource } from '../../src/types/library.ts';
import { buildExtensionUrl } from './extensionAddress.ts';

function createMockDatastore() {
  const store = new Map<string, any>();
  return {
    getObject: <T,>(key: string, def: T): T => (store.has(key) ? store.get(key) : def),
    setObject: (key: string, val: any) => store.set(key, val),
    getString: (key: string, def = '') => (store.has(key) ? String(store.get(key)) : def),
    setString: (key: string, val: string) => store.set(key, val),
  } as any;
}

test('entryMatchesQuery matches only the provider whose URL was saved', () => {
  const castleUrl = buildExtensionUrl('Castle TV', 'https://castle.test/madame-web');
  const cineUrl = buildExtensionUrl('CineTv', 'https://cinetv.test/madame-web');
  const movixUrl = 'https://movix.test/madame-web-2024';

  const entry: LibraryEntry = {
    key: canonicalKey('Madame Web', 2024),
    title: 'Madame Web',
    year: 2024,
    urls: [castleUrl],
    status: WatchStatus.Watching,
    addedAt: 1000,
    updatedAt: 1000,
  };

  // Castle TV matches because its URL is in entry.urls
  assert.equal(
    entryMatchesQuery(entry, { url: castleUrl, title: 'Madame Web', year: 2024, apiName: 'Castle TV' }),
    true
  );

  // CineTv DOES NOT match even though it has the exact same title and year
  assert.equal(
    entryMatchesQuery(entry, { url: cineUrl, title: 'Madame Web', year: 2024, apiName: 'CineTv' }),
    false
  );

  // Movix DOES NOT match
  assert.equal(
    entryMatchesQuery(entry, { url: movixUrl, title: 'Madame Web', year: 2024, apiName: 'Movix' }),
    false
  );

  // LibraryView fallback: direct key match matches
  assert.equal(
    entryMatchesQuery(entry, { url: entry.key, title: 'Madame Web', year: 2024 }),
    true
  );

  // Different movie with overlapping title does not match
  assert.equal(
    entryMatchesQuery(entry, { url: castleUrl, title: 'Madame Web 2', year: 2026 }),
    false
  );
});

test('entryMatchesQuery supports multi-saved entries across distinct providers', () => {
  const castleUrl = buildExtensionUrl('Castle TV', 'https://castle.test/madame-web');
  const cineUrl = buildExtensionUrl('CineTv', 'https://cinetv.test/madame-web');
  const hdhubUrl = 'https://4khdhub.test/madame-web';

  const entry: LibraryEntry = {
    key: canonicalKey('Madame Web', 2024),
    title: 'Madame Web',
    year: 2024,
    urls: [castleUrl, cineUrl],
    status: WatchStatus.PlanToWatch,
    addedAt: 1000,
    updatedAt: 1000,
  };

  // Both Castle TV and CineTv match
  assert.equal(entryMatchesQuery(entry, { url: castleUrl, title: 'Madame Web', year: 2024 }), true);
  assert.equal(entryMatchesQuery(entry, { url: cineUrl, title: 'Madame Web', year: 2024 }), true);

  // 4K HDHUB does not match
  assert.equal(entryMatchesQuery(entry, { url: hdhubUrl, title: 'Madame Web', year: 2024 }), false);
});

test('watchMatchesQuery matches only the provider that was actually played', () => {
  const castleUrl = buildExtensionUrl('Castle TV', 'https://castle.test/madame-web');
  const cineUrl = buildExtensionUrl('CineTv', 'https://cinetv.test/madame-web');
  const movixUrl = 'https://movix.test/madame-web';

  const key = canonicalKey('Madame Web', 2024);
  const progress: WatchProgress = {
    key,
    mediaUrl: castleUrl,
    positionSeconds: 1200,
    durationSeconds: 6000,
    completed: false,
    title: 'Madame Web',
    updatedAt: 2000,
  };

  const playedSources: PlayedSource[] = [
    {
      key,
      source: { providerName: 'Castle TV' } as any,
      origin: { mediaUrl: castleUrl, title: 'Madame Web', provider: 'Castle TV' },
      playedAt: 1000,
      playCount: 1,
    },
  ];

  // Castle TV matches
  assert.equal(
    watchMatchesQuery(progress, playedSources, { url: castleUrl, title: 'Madame Web', year: 2024, apiName: 'Castle TV' }),
    true
  );

  // CineTv DOES NOT match
  assert.equal(
    watchMatchesQuery(progress, playedSources, { url: cineUrl, title: 'Madame Web', year: 2024, apiName: 'CineTv' }),
    false
  );

  // Movix DOES NOT match
  assert.equal(
    watchMatchesQuery(progress, playedSources, { url: movixUrl, title: 'Madame Web', year: 2024, apiName: 'Movix' }),
    false
  );

  // Different year DOES NOT match
  assert.equal(
    watchMatchesQuery(progress, playedSources, { url: castleUrl, title: 'Madame Web', year: 1999 }),
    false
  );
});

test('TitleInteractionStore.summarise isolates state across multiple providers for the same title', () => {
  const castleUrl = buildExtensionUrl('Castle TV', 'https://castle.test/madame-web');
  const cineUrl = buildExtensionUrl('CineTv', 'https://cinetv.test/madame-web');
  const movixUrl = buildExtensionUrl('Movix', 'https://movix.test/madame-web');
  const hdhubUrl = buildExtensionUrl('4K HDHUB', 'https://4khdhub.test/madame-web');

  const key = canonicalKey('Madame Web', 2024);

  const libraryEntry: LibraryEntry = {
    key,
    title: 'Madame Web',
    year: 2024,
    urls: [castleUrl],
    status: WatchStatus.Watching,
    addedAt: 1000,
    updatedAt: 1000,
  };

  const progressRow: WatchProgress = {
    key,
    mediaUrl: castleUrl,
    positionSeconds: 1500,
    durationSeconds: 6000,
    completed: false,
    title: 'Madame Web',
    updatedAt: 2000,
  };

  const playedSource: PlayedSource = {
    key,
    source: { providerName: 'Castle TV' } as any,
    origin: { mediaUrl: castleUrl, title: 'Madame Web', provider: 'Castle TV' },
    playedAt: 1000,
    playCount: 1,
  };

  const mockLibrary = {
    getEntry: (k: string) => (k === key ? libraryEntry : null),
    getProgressForKey: (k: string) => (k === key ? [progressRow] : []),
    getPlayedSourcesForKey: (k: string) => (k === key ? [playedSource] : []),
  };

  const store = new TitleInteractionStore({
    datastore: createMockDatastore(),
    library: mockLibrary as any,
    outcomes: { list: () => ({}) } as any,
    sourceReadiness: () => undefined,
    downloadTasks: () => [],
  });

  const queries = [
    { url: castleUrl, title: 'Madame Web', year: 2024, apiName: 'Castle TV' },
    { url: cineUrl, title: 'Madame Web', year: 2024, apiName: 'CineTv' },
    { url: movixUrl, title: 'Madame Web', year: 2024, apiName: 'Movix' },
    { url: hdhubUrl, title: 'Madame Web', year: 2024, apiName: '4K HDHUB' },
  ];

  const results = store.summarise(queries);

  // 1. Castle TV has BOTH library status and watch progress
  const castleState = results[castleUrl];
  assert.ok(castleState);
  assert.deepEqual(castleState.library, { key, status: WatchStatus.Watching });
  assert.ok(castleState.watch);
  assert.equal(castleState.watch.percent, 25);
  assert.equal(castleState.watch.completed, false);
  assert.equal(castleState.lastProvider, 'Castle TV');

  // 2. CineTv has NEITHER library status NOR watch progress
  const cineState = results[cineUrl];
  assert.ok(cineState);
  assert.equal(cineState.library, undefined, 'CineTv must not inherit library/bookmark state');
  assert.equal(cineState.watch, undefined, 'CineTv must not inherit Continue Watching state');

  // 3. Movix has NEITHER library status NOR watch progress
  const movixState = results[movixUrl];
  assert.ok(movixState);
  assert.equal(movixState.library, undefined, 'Movix must not inherit library/bookmark state');
  assert.equal(movixState.watch, undefined, 'Movix must not inherit Continue Watching state');

  // 4. 4K HDHUB has NEITHER library status NOR watch progress
  const hdhubState = results[hdhubUrl];
  assert.ok(hdhubState);
  assert.equal(hdhubState.library, undefined, '4K HDHUB must not inherit library/bookmark state');
  assert.equal(hdhubState.watch, undefined, '4K HDHUB must not inherit Continue Watching state');
});

test('TitleInteractionStore.summarise respects Continue Watching dismissal', () => {
  const castleUrl = buildExtensionUrl('Castle TV', 'https://castle.test/madame-web');
  const key = canonicalKey('Madame Web', 2024);

  const progressRow: WatchProgress = {
    key,
    mediaUrl: castleUrl,
    positionSeconds: 1500,
    durationSeconds: 6000,
    completed: false,
    title: 'Madame Web',
    updatedAt: 2000,
    dismissedAt: 3000, // Dismissed AFTER being updated
  };

  const mockLibrary = {
    getEntry: () => null,
    getProgressForKey: (k: string) => (k === key ? [progressRow] : []),
    getPlayedSourcesForKey: () => [],
  };

  const store = new TitleInteractionStore({
    datastore: createMockDatastore(),
    library: mockLibrary as any,
    outcomes: { list: () => ({}) } as any,
    sourceReadiness: () => undefined,
    downloadTasks: () => [],
  });

  const results = store.summarise([
    { url: castleUrl, title: 'Madame Web', year: 2024, apiName: 'Castle TV' },
  ]);

  // Because it was dismissed, watch progress must not be returned
  assert.equal(results[castleUrl]?.watch, undefined);
});
