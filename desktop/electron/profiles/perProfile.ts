import { currentProfileId } from './profileContext.ts';

/**
 * One instance of a store per viewer profile, behind a single reference.
 *
 * The stores that keep a profile's data in memory (the library, history,
 * bookmarks, saved searches, search set-ups) cannot be switched by re-reading
 * on a profile change: a write that lands after the switch — a discovery begun
 * on the previous profile — would put the new profile's in-memory rows into the
 * old profile's key. So each profile gets its own instance, built on a datastore
 * view pinned to it, and `current` dispatches every call to the instance of the
 * current profile (`profileContext.ts`).
 *
 * Methods are bound to the instance they were looked up on, so an async method
 * finishes against the profile it started on even if the active profile
 * changes while it awaits.
 *
 * `current` is typed as the store itself, which is why none of the services
 * holding a store — or the IPC handlers calling it — had to change.
 */
export interface PerProfile<T extends object> {
  /** The store as everything else sees it: always the current profile's. */
  readonly current: T;
  /** The instance for one profile, built on first use. */
  get(profileId: string): T;
  /** Every instance built so far — for teardown that must reach all of them. */
  each(visit: (store: T, profileId: string) => void): void;
  /** Drops a deleted profile's instance, so nothing can write through it again. */
  forget(profileId: string): void;
}

export function perProfile<T extends object>(create: (profileId: string) => T): PerProfile<T> {
  const instances = new Map<string, T>();

  const get = (profileId: string): T => {
    let store = instances.get(profileId);
    if (!store) {
      store = create(profileId);
      instances.set(profileId, store);
    }
    return store;
  };

  const current = new Proxy({} as T, {
    get(_target, property) {
      const store = get(currentProfileId());
      const value = Reflect.get(store, property, store);
      return typeof value === 'function' ? value.bind(store) : value;
    },
    set(_target, property, value) {
      return Reflect.set(get(currentProfileId()), property, value);
    },
    has(_target, property) {
      return Reflect.has(get(currentProfileId()), property);
    },
  });

  return {
    current,
    get,
    each(visit) {
      for (const [profileId, store] of instances) visit(store, profileId);
    },
    forget(profileId) {
      instances.delete(profileId);
    },
  };
}
