/**
 * Viewer profiles: where each profile's data lives, that one profile's data
 * never reaches another, and the optional lock.
 *
 *   node --experimental-strip-types electron/profiles/profiles.test.mts
 *
 * The failures these guard are silent ones — a library that quietly shows the
 * other profile's titles, a progress write landing in whoever is active by the
 * time it arrives, an upgrade that "loses" the library because it moved — so
 * each is pinned against the code that would produce it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  activeProfileId,
  currentProfileId,
  DEFAULT_PROFILE_ID,
  LOCKED_PROFILE_ID,
  runAsProfile,
  setActiveProfileId,
} from './profileContext.ts';
import { parseStoredKey, PERSONAL_KEYS, PREFERENCE_KEYS, storedKey, visibleEntries } from './profileKeys.ts';
import { perProfile } from './perProfile.ts';
import { UserProfileService, type ProfileStorage } from './userProfiles.ts';
import { HistoryStore } from '../cs3/historyStore.ts';
import type { Datastore } from '../datastore.ts';

/** The real datastore's key resolution over a plain map — enough to build stores on. */
function fakeDatastore() {
  const values = new Map<string, string>();
  const view = (profileOf: () => string): Datastore => {
    const read = (key: string) => {
      const stored = storedKey(key, profileOf());
      return stored === null ? undefined : values.get(stored);
    };
    const write = (key: string, value: string) => {
      const stored = storedKey(key, profileOf());
      if (stored !== null) values.set(stored, value);
    };
    return {
      getString: (key, fallback = '') => read(key) ?? fallback,
      setString: (key, value) => write(key, value),
      getBool: (key, fallback = false) => (read(key) === undefined ? fallback : read(key) === 'true'),
      setBool: (key, value) => write(key, String(value)),
      getBoolean: (key, fallback = false) => (read(key) === undefined ? fallback : read(key) === 'true'),
      setBoolean: (key, value) => write(key, String(value)),
      getInt: (key, fallback = 0) => (read(key) === undefined ? fallback : Number(read(key))),
      setInt: (key, value) => write(key, String(value)),
      getObject: <T,>(key: string, fallback: T | null = null) => {
        const raw = read(key);
        return raw === undefined ? fallback : (JSON.parse(raw) as T);
      },
      setObject: (key, value) => write(key, JSON.stringify(value)),
    };
  };
  return {
    values,
    current: view(currentProfileId),
    forProfile: (profileId: string) => view(() => profileId),
  };
}

function storage(): ProfileStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getObject: <T,>(key: string, fallback: T | null = null) =>
      values.has(key) ? (JSON.parse(values.get(key)!) as T) : fallback,
    setObject: (key, value) => void values.set(key, JSON.stringify(value)),
    getString: (key, fallback = '') => values.get(key) ?? fallback,
    setString: (key, value) => void values.set(key, value),
  };
}

function clock(start = 1_000_000) {
  let now = start;
  return { now: () => now, advance: (ms: number) => void (now += ms) };
}

test.afterEach(() => setActiveProfileId(DEFAULT_PROFILE_ID));

// --- where data lives -------------------------------------------------------

test('the default profile keeps the plain keys, so an existing install is already its data', () => {
  assert.equal(storedKey('library_entries', DEFAULT_PROFILE_ID), 'library_entries');
  assert.equal(storedKey('watch_progress', DEFAULT_PROFILE_ID), 'watch_progress');
  assert.equal(storedKey('player_preferences', DEFAULT_PROFILE_ID), 'player_preferences');
});

test('another profile stores per-person keys under its own prefix, installation keys stay shared', () => {
  assert.equal(storedKey('library_entries', 'p1'), 'profile:p1:library_entries');
  assert.equal(storedKey('cs3_disabled_extensions', 'p1'), 'cs3_disabled_extensions');
  assert.equal(storedKey('cs3_network_settings', 'p1'), 'cs3_network_settings');
  assert.deepEqual(parseStoredKey('profile:p1:library_entries'), { profileId: 'p1', key: 'library_entries' });
  assert.deepEqual(parseStoredKey('library_entries'), { profileId: DEFAULT_PROFILE_ID, key: 'library_entries' });
  assert.deepEqual(parseStoredKey('window_bounds'), { profileId: null, key: 'window_bounds' });
});

test('the locked placeholder has nowhere to read from or write to', () => {
  assert.equal(storedKey('media_history_events_v1', LOCKED_PROFILE_ID), null);
  assert.equal(storedKey('cs3_network_settings', LOCKED_PROFILE_ID), 'cs3_network_settings');
});

test('a profile sees its own copy and the shared keys, never another profile’s', () => {
  const stored = {
    library_entries: 'default library',
    'profile:p1:library_entries': 'p1 library',
    'profile:p2:library_entries': 'p2 library',
    cs3_network_settings: 'dns',
  };
  assert.deepEqual(visibleEntries(stored, 'p1'), { library_entries: 'p1 library', cs3_network_settings: 'dns' });
  assert.deepEqual(visibleEntries(stored, DEFAULT_PROFILE_ID), {
    library_entries: 'default library',
    cs3_network_settings: 'dns',
  });
  assert.deepEqual(visibleEntries(stored, LOCKED_PROFILE_ID), { cs3_network_settings: 'dns' });
});

test('no key is both personal and a preference', () => {
  for (const key of PERSONAL_KEYS) assert.ok(!PREFERENCE_KEYS.has(key), key);
});

// --- isolation ------------------------------------------------------------

test('each profile’s history is its own, and switching shows no stale rows', () => {
  const ds = fakeDatastore();
  const history = perProfile((id) => new HistoryStore(ds.forProfile(id)));

  history.current.record({ title: 'Dune', action: 'play', status: 'completed' } as never);
  setActiveProfileId('p1');
  assert.equal(history.current.list({} as never).total ?? history.current.list({} as never).items.length, 0);
  history.current.record({ title: 'Bluey', action: 'play', status: 'completed' } as never);

  setActiveProfileId(DEFAULT_PROFILE_ID);
  const titles = history.current.list({} as never).items.map((row) => row.title);
  assert.deepEqual(titles, ['Dune']);
  assert.ok(ds.values.has('media_history_events_v1'));
  assert.ok(ds.values.has('profile:p1:media_history_events_v1'));
});

test('work started for one profile keeps writing to it after the window switches', async () => {
  const ds = fakeDatastore();
  const history = perProfile((id) => new HistoryStore(ds.forProfile(id)));

  setActiveProfileId('p1');
  const pending = runAsProfile(activeProfileId(), async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    history.current.record({ title: 'Late discovery', action: 'play', status: 'completed' } as never);
  });
  setActiveProfileId('p2');
  await pending;

  assert.deepEqual(
    history.get('p1').list({} as never).items.map((row) => row.title),
    ['Late discovery']
  );
  assert.equal(history.get('p2').list({} as never).items.length, 0);
});

test('a method looked up on one profile finishes on it even if the switch happens mid-call', async () => {
  const seen: string[] = [];
  const stores = perProfile((id) => ({
    async save() {
      await new Promise((resolve) => setTimeout(resolve, 5));
      seen.push(id);
    },
  }));
  setActiveProfileId('p1');
  const saving = stores.current.save();
  setActiveProfileId('p2');
  await saving;
  assert.deepEqual(seen, ['p1']);
});

test('a forgotten profile gets a fresh, empty store if anything reaches it again', () => {
  const ds = fakeDatastore();
  const history = perProfile((id) => new HistoryStore(ds.forProfile(id)));
  setActiveProfileId('p1');
  history.current.record({ title: 'Gone', action: 'play', status: 'completed' } as never);
  for (const key of [...ds.values.keys()]) if (key.startsWith('profile:p1:')) ds.values.delete(key);
  history.forget('p1');
  assert.equal(history.current.list({} as never).items.length, 0);
});

// --- the default profile and migration ----------------------------------------

test('a fresh install gets the default profile and opens straight into it', () => {
  const store = storage();
  const service = new UserProfileService({ storage: store });
  const state = service.initialise();
  assert.equal(state.profiles.length, 1);
  assert.equal(state.profiles[0].id, DEFAULT_PROFILE_ID);
  assert.equal(state.profiles[0].isDefault, true);
  assert.equal(state.profiles[0].locked, false);
  assert.equal(state.gated, false);
  assert.equal(activeProfileId(), DEFAULT_PROFILE_ID);
});

test('initialising twice changes nothing — the migration is idempotent', () => {
  const store = storage();
  store.values.set('library_entries', JSON.stringify([{ key: 'dune|2021' }]));
  new UserProfileService({ storage: store }).initialise();
  const before = new Map(store.values);
  const state = new UserProfileService({ storage: store }).initialise();
  assert.equal(state.profiles.length, 1);
  assert.deepEqual(new Map(store.values), before);
  // The library an existing install had is untouched and is the default profile's.
  assert.equal(store.values.get('library_entries'), JSON.stringify([{ key: 'dune|2021' }]));
});

// --- managing profiles ------------------------------------------------------

test('profiles are created without a lock unless one is asked for', async () => {
  const service = new UserProfileService({ storage: storage() });
  service.initialise();
  const result = await service.create({ name: '  Kids  ', avatar: 'cat' });
  assert.ok(result.ok);
  const kids = result.state.profiles.find((p) => p.id === result.profileId)!;
  assert.equal(kids.name, 'Kids');
  assert.equal(kids.avatar, 'cat');
  assert.equal(kids.locked, false);
  assert.match(kids.id, /^p[0-9a-f]{10}$/);
});

test('names must be present and unique', async () => {
  const service = new UserProfileService({ storage: storage() });
  service.initialise();
  assert.equal((await service.create({ name: '   ', avatar: 'cat' })).ok, false);
  assert.equal((await service.create({ name: 'default', avatar: 'cat' })).ok, false);
});

test('renaming does not change the id', async () => {
  const service = new UserProfileService({ storage: storage() });
  service.initialise();
  const created = await service.create({ name: 'Sam', avatar: 'dog' });
  assert.ok(created.ok);
  const renamed = await service.update(created.profileId!, { name: 'Samantha', avatar: 'star' });
  assert.ok(renamed.ok);
  const sam = renamed.state.profiles.find((p) => p.id === created.profileId)!;
  assert.equal(sam.name, 'Samantha');
  assert.equal(sam.avatar, 'star');
});

test('duplicating copies preferences only, without the lock', async () => {
  const copies: Array<[string, string]> = [];
  const service = new UserProfileService({ storage: storage(), onDuplicated: (from, to) => copies.push([from, to]) });
  service.initialise();
  const locked = await service.create({ name: 'Alex', avatar: 'moon', secret: '2468' });
  assert.ok(locked.ok);
  assert.equal((await service.duplicate(locked.profileId!)).ok, false, 'a locked profile needs its secret');
  const copy = await service.duplicate(locked.profileId!, '2468');
  assert.ok(copy.ok);
  const made = copy.state.profiles.find((p) => p.id === copy.profileId)!;
  assert.equal(made.name, 'Alex copy');
  assert.equal(made.locked, false);
  assert.deepEqual(copies, [[locked.profileId, copy.profileId]]);
});

test('the default profile cannot be deleted', async () => {
  const service = new UserProfileService({ storage: storage() });
  service.initialise();
  const result = await service.remove(DEFAULT_PROFILE_ID);
  assert.equal(result.ok, false);
});

test('deleting the profile in use returns to the default one and erases what it stored', async () => {
  const deleted: string[] = [];
  const service = new UserProfileService({ storage: storage(), onDeleted: (id) => deleted.push(id) });
  service.initialise();
  const created = await service.create({ name: 'Guest', avatar: 'ghost' });
  assert.ok(created.ok);
  await service.activate(created.profileId!);
  assert.equal(activeProfileId(), created.profileId);
  const result = await service.remove(created.profileId!);
  assert.ok(result.ok);
  assert.equal(result.state.activeId, DEFAULT_PROFILE_ID);
  assert.equal(activeProfileId(), DEFAULT_PROFILE_ID);
  assert.deepEqual(deleted, [created.profileId]);
});

// --- switching and locks ------------------------------------------------------

test('switching waits for the previous profile to stop, then persists the choice', async () => {
  const store = storage();
  const order: string[] = [];
  const service = new UserProfileService({
    storage: store,
    beforeSwitch: async () => {
      order.push(`stop:${activeProfileId()}`);
    },
  });
  service.initialise();
  const created = await service.create({ name: 'Sam', avatar: 'dog' });
  assert.ok(created.ok);
  const result = await service.activate(created.profileId!);
  assert.ok(result.ok);
  assert.deepEqual(order, [`stop:${DEFAULT_PROFILE_ID}`]);
  assert.equal(activeProfileId(), created.profileId);
  assert.equal(store.values.get('cs3_active_user_profile'), created.profileId);
});

test('a locked profile cannot be entered without its secret, and any length of secret works', async () => {
  const service = new UserProfileService({ storage: storage() });
  service.initialise();
  const created = await service.create({ name: 'Private', avatar: 'heart', secret: 'correct horse battery staple' });
  assert.ok(created.ok);
  const id = created.profileId!;

  const none = await service.activate(id);
  assert.equal(none.ok, false);
  assert.equal(!none.ok && none.reason, 'locked');
  const wrong = await service.activate(id, 'nope');
  assert.equal(!wrong.ok && wrong.reason, 'wrong-secret');
  assert.equal(activeProfileId(), DEFAULT_PROFILE_ID);

  const right = await service.activate(id, 'correct horse battery staple');
  assert.ok(right.ok);
  assert.equal(activeProfileId(), id);
});

test('a short PIN is accepted, a too-short one is not', async () => {
  const service = new UserProfileService({ storage: storage() });
  service.initialise();
  assert.equal((await service.create({ name: 'A', avatar: 'sun', secret: '123' })).ok, false);
  assert.ok((await service.create({ name: 'B', avatar: 'sun', secret: '1234' })).ok);
});

test('the secret never leaves the service', async () => {
  const store = storage();
  const service = new UserProfileService({ storage: store });
  service.initialise();
  const created = await service.create({ name: 'Private', avatar: 'heart', secret: '9876' });
  assert.ok(created.ok);
  const wire = JSON.stringify(created.state);
  assert.ok(!wire.includes('9876'));
  assert.ok(!/hash|salt/.test(wire));
  // Stored hashed, not as typed.
  assert.ok(!(store.values.get('cs3_user_profiles') ?? '').includes('9876'));
});

test('repeated wrong guesses pause the profile, and the pause ends', async () => {
  const time = clock();
  const service = new UserProfileService({ storage: storage(), now: time.now });
  service.initialise();
  const created = await service.create({ name: 'Private', avatar: 'heart', secret: '1357' });
  assert.ok(created.ok);
  const id = created.profileId!;
  for (let i = 0; i < 5; i++) await service.activate(id, '0000');
  const paused = await service.activate(id, '1357');
  assert.equal(!paused.ok && paused.reason, 'throttled');
  assert.ok(!paused.ok && (paused.retryAfterMs ?? 0) > 0);
  time.advance(31_000);
  assert.ok((await service.activate(id, '1357')).ok);
});

test('an app that last used a locked profile opens gated, showing and recording nothing', async () => {
  const store = storage();
  const first = new UserProfileService({ storage: store });
  first.initialise();
  const created = await first.create({ name: 'Private', avatar: 'heart', secret: '1357' });
  assert.ok(created.ok);
  await first.activate(created.profileId!, '1357');

  setActiveProfileId(DEFAULT_PROFILE_ID);
  const relaunched = new UserProfileService({ storage: store });
  const state = relaunched.initialise();
  assert.equal(state.gated, true);
  assert.equal(state.activeId, created.profileId);
  assert.equal(activeProfileId(), LOCKED_PROFILE_ID);

  // Another, unlocked profile opens without a secret.
  const other = await relaunched.activate(DEFAULT_PROFILE_ID);
  assert.ok(other.ok);
  assert.equal(other.state.gated, false);
  assert.equal(activeProfileId(), DEFAULT_PROFILE_ID);
});

test('changing or removing a lock needs the current secret', async () => {
  const service = new UserProfileService({ storage: storage() });
  service.initialise();
  const created = await service.create({ name: 'Private', avatar: 'heart', secret: '1357' });
  assert.ok(created.ok);
  const id = created.profileId!;
  assert.equal((await service.setLock(id, '2468')).ok, false);
  assert.ok((await service.setLock(id, '2468', '1357')).ok);
  assert.equal((await service.removeLock(id, '1357')).ok, false);
  const removed = await service.removeLock(id, '2468');
  assert.ok(removed.ok);
  assert.equal(removed.state.profiles.find((p) => p.id === id)!.locked, false);
});

test('the profile in use can be locked without a secret, since you are already in it', async () => {
  const service = new UserProfileService({ storage: storage() });
  service.initialise();
  const result = await service.setLock(DEFAULT_PROFILE_ID, '4321');
  assert.ok(result.ok);
  assert.equal(result.state.profiles[0].locked, true);
  // ...and still in it: locking does not throw you out.
  assert.equal(activeProfileId(), DEFAULT_PROFILE_ID);
});

test('a locked profile you are not in cannot be renamed or deleted without its secret', async () => {
  const service = new UserProfileService({ storage: storage() });
  service.initialise();
  const created = await service.create({ name: 'Private', avatar: 'heart', secret: '1357' });
  assert.ok(created.ok);
  const id = created.profileId!;
  assert.equal((await service.update(id, { name: 'Hacked' })).ok, false);
  assert.equal((await service.remove(id)).ok, false);
  assert.ok((await service.update(id, { name: 'Renamed' }, '1357')).ok);
  assert.ok((await service.remove(id, '1357')).ok);
});
