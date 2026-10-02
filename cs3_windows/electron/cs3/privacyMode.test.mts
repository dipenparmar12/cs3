import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  PrivacyMode,
  isPrivateSession,
  allowsExplicitSaves,
  allowsDownloads,
  resetPrivacyModeForTests,
} from './privacyMode.ts';
import { SearchHistoryStore } from '../searchHistory.ts';
import { LibraryStore, WatchStatus } from './libraryStore.ts';
import { HistoryStore } from './historyStore.ts';
import { BookmarkStore } from './bookmarkStore.ts';

function memoryStore() {
  const bools = new Map<string, boolean>();
  const strings = new Map<string, string>();
  return {
    bools,
    getBool: (k: string, d = false) => bools.get(k) ?? d,
    setBool: (k: string, v: boolean) => void bools.set(k, v),
    getString: (k: string, d?: string) => strings.get(k) ?? d,
    setString: (k: string, v: string) => void strings.set(k, v),
    getObject: (k: string, d: unknown) => (strings.has(k) ? JSON.parse(strings.get(k)!) : d),
    setObject: (k: string, v: unknown) => void strings.set(k, JSON.stringify(v)),
  };
}

beforeEach(() => resetPrivacyModeForTests());

test('no service means not private', () => {
  assert.equal(isPrivateSession(), false);
});

test('starts off, and the active flag is not persisted by default', () => {
  const store = memoryStore();
  const privacy = new PrivacyMode(store);
  assert.equal(privacy.isActive(), false);
  privacy.setActive(true);
  assert.equal(isPrivateSession(), true);
  assert.equal(store.bools.has('incognito_active'), false);
  assert.equal(new PrivacyMode(store).isActive(), false);
});

test('remembered preference survives a restart, and forgetting it clears the flag', () => {
  const store = memoryStore();
  const privacy = new PrivacyMode(store);
  privacy.updateSettings({ rememberPreference: true });
  privacy.setActive(true);
  assert.equal(new PrivacyMode(store).isActive(), true);
  const again = new PrivacyMode(store);
  again.updateSettings({ rememberPreference: false });
  assert.equal(store.bools.get('incognito_active'), false);
});

test('every state answer is whole, and listeners get it', () => {
  const privacy = new PrivacyMode(memoryStore());
  const seen: boolean[] = [];
  privacy.onChange((s) => {
    assert.ok(s.settings);
    seen.push(s.active);
  });
  privacy.setActive(true);
  privacy.setActive(true);
  privacy.setActive(false);
  assert.deepEqual(seen, [true, false]);
});

test('session clearers run on both edges', () => {
  const privacy = new PrivacyMode(memoryStore());
  let cleared = 0;
  privacy.onClearSession(() => cleared++);
  privacy.setActive(true);
  privacy.setActive(false);
  assert.equal(cleared, 2);
});

test('disabling downloads also disables the download prompt', () => {
  const privacy = new PrivacyMode(memoryStore());
  const state = privacy.updateSettings({ askBeforeDownload: true, allowDownloads: false });
  assert.equal(state.settings.askBeforeDownload, false);
});

test('search history is not written during a private session', () => {
  const store = memoryStore();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const history = new SearchHistoryStore(store as any);
  history.record('before');
  const privacy = new PrivacyMode(store);
  privacy.setActive(true);
  history.record('secret');
  privacy.setActive(false);
  assert.deepEqual(history.list().map((e) => e.query), ['before']);
});

test('a private session discovers into memory and forgets it after', async () => {
  const { SourceCache } = await import('../sourceCache.ts');
  const store = memoryStore();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cache = new SourceCache(store as any);
  const source = { title: 'Dune 1080p', infoHash: 'a'.repeat(40), magnetUri: 'magnet:?xt=urn:btih:' + 'a'.repeat(40), seeders: 10 };
  let heard = 0;
  cache.onWrite(() => heard++);
  cache.setVolatileMode(true);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cache.write('cs3meta://dune', [source as any]);
  assert.equal(cache.peek('cs3meta://dune').hit, true);
  assert.equal(store.getString('source_cache_v1', ''), '');
  assert.equal(heard, 0);
  cache.setVolatileMode(false);
  assert.equal(cache.peek('cs3meta://dune').hit, false);
});

test('allowsExplicitSaves and allowsDownloads reflect active state and settings', () => {
  const store = memoryStore();
  assert.equal(allowsExplicitSaves(), true);
  assert.equal(allowsDownloads(), true);

  const privacy = new PrivacyMode(store);
  privacy.setActive(true);
  assert.equal(allowsExplicitSaves(), true);
  assert.equal(allowsDownloads(), true);

  privacy.updateSettings({ allowExplicitSaves: false, allowDownloads: false });
  assert.equal(allowsExplicitSaves(), false);
  assert.equal(allowsDownloads(), false);

  privacy.setActive(false);
  // In normal mode, actions are always allowed
  assert.equal(allowsExplicitSaves(), true);
  assert.equal(allowsDownloads(), true);
});

test('libraryStore blocks automatic upserts and respects explicit saves setting in private session', () => {
  const store = memoryStore();
  const privacy = new PrivacyMode(store);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lib = new LibraryStore(store as any);

  // Normal mode: automatic upsert (without status) succeeds
  const normal = lib.upsertEntry({ title: 'Interstellar', year: 2014, mediaUrl: 'https://example.com/interstellar' });
  assert.ok(normal);
  assert.equal(normal.status, WatchStatus.Watching);

  // Enter private mode
  privacy.setActive(true);

  // Automatic upsert on playback (no status) must return null and not persist
  const autoPrivate = lib.upsertEntry({ title: 'Dune', year: 2021, mediaUrl: 'https://example.com/dune' });
  assert.equal(autoPrivate, null);
  assert.equal(lib.getEntry('dune::2021'), null);

  // Explicit user addition (status provided) is allowed when allowExplicitSaves is true
  const explicitSave = lib.upsertEntry({
    title: 'Dune',
    year: 2021,
    mediaUrl: 'https://example.com/dune',
    status: WatchStatus.PlanToWatch,
  });
  assert.ok(explicitSave);
  assert.equal(explicitSave.status, WatchStatus.PlanToWatch);

  // Explicit save when allowExplicitSaves is disabled is blocked
  privacy.updateSettings({ allowExplicitSaves: false });
  const blockedSave = lib.upsertEntry({
    title: 'Blade Runner',
    year: 2049,
    mediaUrl: 'https://example.com/br',
    status: WatchStatus.PlanToWatch,
  });
  assert.equal(blockedSave, null);
  assert.equal(lib.getEntry('bladerunner::2049'), null);
});

test('historyStore.update returns null and does not mutate in private session', () => {
  const store = memoryStore();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hist = new HistoryStore(store as any);

  // Record an event in normal mode
  const event = hist.record({ title: 'Test Movie', action: 'play_started', status: 'Played' });
  assert.ok(event.id);

  // In private session, update must return null and not change status
  const privacy = new PrivacyMode(store);
  privacy.setActive(true);
  const updated = hist.update(event.id, { status: 'Failed' });
  assert.equal(updated, null);

  privacy.setActive(false);
  const current = hist.get(event.id);
  assert.equal(current?.status, 'Played');
});

test('bookmarkStore does not track opened counts in private session and respects allowExplicitSaves', () => {
  const store = memoryStore();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bms = new BookmarkStore(store as any);

  // Save a bookmark in normal mode
  bms.save({
    mediaUrl: 'https://example.com/movie',
    title: 'Movie',
    origin: { provider: 'Test' },
  });

  const privacy = new PrivacyMode(store);
  privacy.setActive(true);

  // Mark opened during private session must not increment count or lastOpenedAt
  bms.markOpened('https://example.com/movie');
  const bm = bms.get('https://example.com/movie');
  assert.equal(bm?.openCount, 0);
  assert.equal(bm?.lastOpenedAt, undefined);

  // Toggling bookmark when explicit saves are disallowed returns null
  privacy.updateSettings({ allowExplicitSaves: false });
  const result = bms.toggle({
    mediaUrl: 'https://example.com/secret',
    title: 'Secret',
    origin: { provider: 'Test' },
  });
  assert.equal(result.saved, false);
  assert.equal(result.bookmark, null);
  assert.equal(bms.isSaved('https://example.com/secret'), false);
});
