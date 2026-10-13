import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';

/**
 * `useState` that outlives the component for the rest of the session.
 *
 * A screen is unmounted when another one is shown, and every filter, tab and
 * toggle it held in local state went with it — Library came back on
 * "Watching" after you had been in "Saved pages", History forgot it was
 * sorted by failures. These are decisions about *how you are looking*, and
 * they should still be there when you come back, the way a browser tab keeps
 * its page. Kept in memory only: a restart starts each screen fresh, which is
 * what a new session means.
 *
 * The key names the screen and the field (`library.mode`). Values must be
 * plain data; a `Set` or `Map` is stored as-is and shared by reference.
 */
const store = new Map<string, unknown>();

export function useSessionState<T>(key: string, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() =>
    store.has(key) ? (store.get(key) as T) : typeof initial === 'function' ? (initial as () => T)() : initial
  );
  const set = useCallback<Dispatch<SetStateAction<T>>>(
    (next) => {
      setValue((current) => {
        const resolved = typeof next === 'function' ? (next as (previous: T) => T)(current) : next;
        store.set(key, resolved);
        return resolved;
      });
    },
    [key]
  );
  return [value, set];
}

/** Forgets every screen's remembered state — for "Erase my data" and tests. */
export function clearSessionState(): void {
  store.clear();
}
