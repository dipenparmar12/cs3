import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { PrivacyMode, isPrivateSession, resetPrivacyModeForTests } from './privacyMode.ts';
import { SearchHistoryStore } from '../searchHistory.ts';

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
