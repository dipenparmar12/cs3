/**
 * Viewer profiles — separate libraries, histories and preferences on one
 * installation (`electron/profiles/`). Not to be confused with *source*
 * profiles (`SourceProfile`), which are named search set-ups inside one viewer
 * profile.
 */

/** The avatars a profile can wear. Drawn by `src/utils/profileAvatars.ts`. */
export const PROFILE_AVATAR_IDS = [
  'smile',
  'star',
  'rocket',
  'cat',
  'dog',
  'ghost',
  'gamepad',
  'music',
  'leaf',
  'sun',
  'moon',
  'flame',
  'zap',
  'heart',
  'crown',
  'bird',
] as const;

export type ProfileAvatarId = (typeof PROFILE_AVATAR_IDS)[number];

export interface UserProfile {
  /** Stable, never shown, independent of the name. `default` for the profile every install has. */
  id: string;
  name: string;
  avatar: ProfileAvatarId;
  /** The profile every installation has. It cannot be deleted. */
  isDefault: boolean;
  /** Has a PIN or password. The secret itself never leaves the main process. */
  locked: boolean;
  createdAt: number;
}

export interface UserProfilesState {
  profiles: UserProfile[];
  /** The profile the window shows — or, while `gated`, the locked one waiting for its PIN. */
  activeId: string;
  /**
   * The app opened on a locked profile. Nothing of it is shown, and nothing is
   * recorded, until it is unlocked or another profile is chosen.
   */
  gated: boolean;
}

export type ProfileFailureReason = 'locked' | 'wrong-secret' | 'throttled' | 'invalid' | 'not-found';

export type ProfileActionResult =
  | { ok: true; state: UserProfilesState; profileId?: string }
  | {
      ok: false;
      error: string;
      reason: ProfileFailureReason;
      /** With `throttled`: how long until another attempt is accepted. */
      retryAfterMs?: number;
    };

export interface ProfileDraft {
  name: string;
  avatar: ProfileAvatarId;
  /** A PIN or password to lock the new profile with. Optional, always. */
  secret?: string;
}

/** Shortest and longest PIN or password a lock accepts. Digits, words, anything. */
export const PROFILE_SECRET_MIN = 4;
export const PROFILE_SECRET_MAX = 128;
export const PROFILE_NAME_MAX = 32;
export const MAX_PROFILES = 12;
