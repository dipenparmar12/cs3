import type { DatastoreManager } from '../datastore.ts';
import type { NativeEngineCapability } from '../../src/types/media.ts';

/**
 * How eagerly mpv is used, and whether it renders inside the window.
 *
 * Its own module because both halves are read from two places that must not
 * import each other: the composition root wires the policy into
 * `PlaybackEngine` at construction, and the `mpv:*` handlers read and write it.
 * Keeping the keys next to one reader and letting the other reach for them is
 * how a setting ends up with two spellings.
 *
 * **Read per decision, never captured.** Both halves of the answer move while
 * the app runs: the setting is a setting, and mpv itself can be installed
 * mid-session. A value captured at startup would leave the engine unused for the
 * rest of a session in which the user had just installed it.
 */

const POLICY_KEY = 'native_engine_policy';
const EMBED_KEY = 'native_engine_embed';

/** Defaults to `auto`, and an unrecognised stored value is treated as `auto`. */
export function nativeEnginePolicy(
  datastore: DatastoreManager
): NativeEngineCapability['policy'] {
  const stored = datastore.getString(POLICY_KEY, 'auto', true);
  return stored === 'off' || stored === 'aggressive' ? stored : 'auto';
}

export function setNativeEnginePolicy(
  datastore: DatastoreManager,
  policy: NativeEngineCapability['policy']
): void {
  datastore.setString(POLICY_KEY, policy, true);
}

/**
 * Whether mpv renders into a child window inside the player.
 *
 * On by default. Turning it off is a real preference rather than a fallback — a
 * second monitor, or an HDR path that only engages for a top-level window, are
 * both reasons to want mpv in its own frame.
 */
export function nativeEngineEmbeds(datastore: DatastoreManager): boolean {
  return datastore.getBool(EMBED_KEY, true);
}

export function setNativeEngineEmbeds(datastore: DatastoreManager, embed: boolean): void {
  datastore.setBool(EMBED_KEY, embed);
}
