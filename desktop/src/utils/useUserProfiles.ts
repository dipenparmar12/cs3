import { useSyncExternalStore } from 'react';
import type {
  ProfileActionResult,
  ProfileAvatarId,
  ProfileDraft,
  UserProfile,
  UserProfilesState,
} from '../types/profiles';
import { describeError } from './errors';
import { copyProfileStorage, forgetProfileStorage, setStorageProfile } from './profileStorage';
import { clearSessionState } from './useSessionState';
import { forgetScreenQueries } from './screenSearch';

/**
 * The renderer's one copy of the viewer profiles, and the only way to switch.
 *
 * A switch is three steps, in order, and the order is the point: the app is
 * unmounted, the writes its teardown sends (the player's last progress, a
 * history update) are given time to reach the main process, and only then is
 * the switch asked for. Main runs every handler as the profile that was active
 * when it was called (`electron/profiles/profileContext.ts`), so those last
 * writes land in the profile they belong to — and the app that mounts again
 * starts with nothing held over from the previous one.
 */

interface ProfilesView {
  state: UserProfilesState | null;
  /** Set while the window is torn down for a switch: the profile being opened. */
  switchingTo: UserProfile | null;
}

const DEFAULT_ID = 'default';
let view: ProfilesView = { state: null, switchingTo: null };
const listeners = new Set<() => void>();
let loading: Promise<UserProfilesState> | null = null;

function publish(next: Partial<ProfilesView>): void {
  view = { ...view, ...next };
  for (const listener of listeners) listener();
}

function adopt(state: UserProfilesState): void {
  const previous = view.state;
  const changedProfile = !previous || previous.activeId !== state.activeId || previous.gated !== state.gated;
  if (changedProfile) {
    // What one person filtered, sorted and searched on each screen is theirs.
    if (previous) {
      clearSessionState();
      forgetScreenQueries();
    }
    setStorageProfile(state.gated ? DEFAULT_ID : state.activeId);
  }
  publish({ state });
}

/** The state when the main process cannot answer: the default profile, unlocked — the app before profiles. */
function fallbackState(): UserProfilesState {
  return {
    profiles: [{ id: DEFAULT_ID, name: 'Default', avatar: 'smile', isDefault: true, locked: false, createdAt: 0 }],
    activeId: DEFAULT_ID,
    gated: false,
  };
}

export function loadUserProfiles(): Promise<UserProfilesState> {
  if (loading) return loading;
  const api = window.cloudstream;
  api?.onUserProfilesChanged?.((state) => adopt(state));
  loading = Promise.resolve(api?.getUserProfiles?.())
    .then((state) => state ?? fallbackState())
    .catch(() => fallbackState())
    .then((state) => {
      adopt(state);
      return state;
    });
  return loading;
}

export function useUserProfiles(): ProfilesView {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => view
  );
}

export function activeProfile(state: UserProfilesState | null = view.state): UserProfile | null {
  return state?.profiles.find((profile) => profile.id === state.activeId) ?? null;
}

const missing = (): ProfileActionResult => ({
  ok: false,
  reason: 'not-found',
  error: 'That profile no longer exists.',
});

function settle(): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 30)))
  );
}

async function call(work: () => Promise<ProfileActionResult> | undefined): Promise<ProfileActionResult> {
  try {
    const result = await work();
    if (!result) return { ok: false, reason: 'invalid', error: 'Profiles are not available in this window.' };
    if (result.ok) adopt(result.state);
    return result;
  } catch (error) {
    return { ok: false, reason: 'invalid', error: describeError(error) };
  }
}

async function tearDownThen(
  target: UserProfile,
  work: () => Promise<ProfileActionResult> | undefined
): Promise<ProfileActionResult> {
  publish({ switchingTo: target });
  await settle();
  const result = await call(work);
  publish({ switchingTo: null });
  return result;
}

/**
 * Opens another profile. A locked one needs its secret, which is checked
 * before anything is torn down — a wrong PIN must not cost the viewer the
 * screen they were on.
 */
export async function switchProfile(profileId: string, secret?: string): Promise<ProfileActionResult> {
  const state = view.state;
  const target = state?.profiles.find((profile) => profile.id === profileId);
  if (!state || !target) return missing();
  if (profileId === state.activeId && !state.gated) return { ok: true, state };
  const api = window.cloudstream;
  if (target.locked) {
    const checked = await call(() => api?.verifyUserProfile(profileId, secret ?? ''));
    if (!checked.ok) return checked;
  }
  return tearDownThen(target, () => api?.activateUserProfile(profileId, secret));
}

export function createProfile(draft: ProfileDraft) {
  return call(() => window.cloudstream?.createUserProfile(draft));
}

export function updateProfile(
  profileId: string,
  patch: { name?: string; avatar?: ProfileAvatarId },
  secret?: string
) {
  return call(() => window.cloudstream?.updateUserProfile(profileId, patch, secret));
}

export function setProfileLock(profileId: string, secret: string, currentSecret?: string) {
  return call(() => window.cloudstream?.setUserProfileLock(profileId, secret, currentSecret));
}

export function removeProfileLock(profileId: string, currentSecret: string) {
  return call(() => window.cloudstream?.removeUserProfileLock(profileId, currentSecret));
}

/** Verifies a secret without switching — for acting on a locked profile from another one. */
export function verifyProfile(profileId: string, secret: string) {
  return call(() => window.cloudstream?.verifyUserProfile(profileId, secret));
}

export async function duplicateProfile(profileId: string, secret?: string): Promise<ProfileActionResult> {
  const result = await call(() => window.cloudstream?.duplicateUserProfile(profileId, secret));
  if (result.ok && result.profileId) copyProfileStorage(profileId, result.profileId);
  return result;
}

/** Deleting the profile in use leaves it first, the same way a switch does. */
export async function deleteProfile(profileId: string, secret?: string): Promise<ProfileActionResult> {
  const state = view.state;
  if (!state?.profiles.some((profile) => profile.id === profileId)) return missing();
  const remove = () => window.cloudstream?.deleteUserProfile(profileId, secret);
  const fallback = state.profiles.find((profile) => profile.isDefault);
  const result =
    profileId === state.activeId && !state.gated && fallback
      ? await tearDownThen(fallback, remove)
      : await call(remove);
  if (result.ok) forgetProfileStorage(profileId);
  return result;
}
