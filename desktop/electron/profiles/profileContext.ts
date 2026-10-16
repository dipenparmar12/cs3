import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Which viewer profile a piece of work belongs to.
 *
 * There are two answers and the difference is the point of this module:
 *
 * - the **active** profile is the one the window is showing now;
 * - the **current** profile is the one the work in progress was started for.
 *
 * `main.ts` runs every IPC handler as the profile that was active when it was
 * called, and `AsyncLocalStorage` carries that answer through every await,
 * timer and callback the handler starts. So a discovery begun on one profile's
 * detail page that lands after a switch still writes to the profile that asked
 * for it, not to whoever is active by then — which is the whole of "background
 * work cannot write to the wrong profile". Work that begins outside a handler
 * (an engine event, a download finishing) and belongs to one profile pins it
 * with {@link runAsProfile}.
 *
 * Imports nothing from Electron, so the stores and their tests can use it under
 * Node's type stripping.
 */

/** The profile every installation has, holding everything recorded before profiles existed. */
export const DEFAULT_PROFILE_ID = 'default';

/**
 * Stands in while the app waits for a locked profile's PIN.
 *
 * Reads find nothing and writes are dropped (`DatastoreManager`), so no screen
 * can show — and no background task can record into — a profile nobody has
 * unlocked yet.
 */
export const LOCKED_PROFILE_ID = '~locked';

const context = new AsyncLocalStorage<string>();
let active = DEFAULT_PROFILE_ID;
const listeners = new Set<(next: string, previous: string) => void>();

export function activeProfileId(): string {
  return active;
}

export function currentProfileId(): string {
  return context.getStore() ?? active;
}

export function runAsProfile<T>(profileId: string, work: () => T): T {
  return context.run(profileId, work);
}

export function setActiveProfileId(profileId: string): void {
  if (profileId === active) return;
  const previous = active;
  active = profileId;
  for (const listener of listeners) listener(profileId, previous);
}

export function onActiveProfileChange(listener: (next: string, previous: string) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
