import type { DatastoreManager } from '../datastore.ts';

/**
 * Whether the Continue Watching rail is assembled at all.
 *
 * **The setting is enforced in the main process, not the renderer.** A home
 * screen that fetched the rows and then declined to draw them would still have
 * read the watch history to build them, and "do not show me what I have been
 * watching" is a request about the data as much as about the pixels — on a
 * shared machine that is the whole point. Off means the rows are never
 * assembled.
 *
 * Its own module because two IPC surfaces read it: the library, which builds the
 * rail, and the home screen, which owns the switch. One of them would otherwise
 * have to reach into the other for a string constant, which is how a setting
 * ends up stored under two spellings and silently stops working.
 */

const KEY = 'home_show_continue_watching';

/** On by default: the rail is the fastest route back to a half-watched film. */
export function continueWatchingEnabled(datastore: DatastoreManager): boolean {
  return datastore.getBool(KEY, true);
}

/**
 * Nothing is deleted either way.
 *
 * The history is what the rest of the library is built on — resume points, the
 * played-source records, the ranking — so hiding a row must not discard it.
 * Turning the rail back on brings it back exactly as it was.
 */
export function setContinueWatchingEnabled(
  datastore: DatastoreManager,
  enabled: boolean
): void {
  datastore.setBool(KEY, enabled);
}
