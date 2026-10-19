/**
 * `localStorage` for the preferences that belong to a person rather than to
 * this computer — which home rows are hidden, which detail sections are
 * folded, how the player's clock reads.
 *
 * The default profile keeps the plain keys every install already has, so its
 * choices are where they always were; another profile's live under
 * `key@<profileId>`. Device-level conveniences (the experience mode, the mini
 * player's position, the inspector pin) keep using `localStorage` directly.
 *
 * The datastore-backed preferences are separated in the main process
 * (`electron/profiles/profileKeys.ts`); this is the renderer's half.
 */

const DEFAULT_PROFILE_ID = 'default';

/** Every key read through {@link profileStorage}, for Duplicate to copy. */
const PER_PROFILE_KEYS = [
  'home_hidden_rows',
  'home_include_anime',
  'home_continue_watching_collapsed',
  'cs3.detailSections.collapsed',
  'cs3.player.timeDisplay',
] as const;

let profileId = DEFAULT_PROFILE_ID;

/** Set by the profile root before the app renders, and on every switch. */
export function setStorageProfile(id: string): void {
  profileId = id;
}

export function storageProfileId(): string {
  return profileId;
}

function keyFor(key: string, id: string): string {
  return id === DEFAULT_PROFILE_ID ? key : `${key}@${id}`;
}

export const profileStorage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = {
  getItem: (key) => localStorage.getItem(keyFor(key, profileId)),
  setItem: (key, value) => localStorage.setItem(keyFor(key, profileId), value),
  removeItem: (key) => localStorage.removeItem(keyFor(key, profileId)),
};

/** Gives a duplicated profile the same layout preferences as its source. */
export function copyProfileStorage(from: string, to: string): void {
  try {
    for (const key of PER_PROFILE_KEYS) {
      const value = localStorage.getItem(keyFor(key, from));
      if (value !== null) localStorage.setItem(keyFor(key, to), value);
    }
  } catch {
    // Storage refused: the copy simply starts with the defaults.
  }
}

/** Removes what a deleted profile kept here. */
export function forgetProfileStorage(id: string): void {
  if (id === DEFAULT_PROFILE_ID) return;
  try {
    for (const key of PER_PROFILE_KEYS) localStorage.removeItem(keyFor(key, id));
  } catch {
    // Nothing to report: the keys are unreachable once the profile is gone.
  }
}
