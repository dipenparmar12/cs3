import { useEffect, useSyncExternalStore } from 'react';
import type { AdultStateSnapshot } from '../../electron/cs3/bootstrap';

export type AdultMode = 'off' | 'ask' | 'on';

export interface AdultState {
  mode: AdultMode;
  /** Whether adult content is permitted in the current session right now. */
  allowed: boolean;
  /** Persistent preference: whether adult content is enabled by default. */
  savedEnabled: boolean;
  /** Persistent preference: whether the startup confirmation prompt is suppressed. */
  doNotAskAgain: boolean;
  /** True when the startup confirmation prompt is awaiting a user decision in this session. */
  promptPending: boolean;
  /** Session-only visual privacy state: true when adult visual assets are blurred/protected. */
  blurred: boolean;
  /** Set of installed adult-only provider names. */
  adultProviders: ReadonlySet<string>;
  /** Keys of individual adult items the user has explicitly revealed in this session. */
  revealedKeys: ReadonlySet<string>;
  /** Count of adult content items or surfaces currently mounted on screen. */
  visibleAdultCount: number;
  loaded: boolean;
}

const EMPTY_PROVIDERS: ReadonlySet<string> = new Set();
const EMPTY_REVEALED: ReadonlySet<string> = new Set();

/**
 * The renderer's single source of truth for adult content availability,
 * session visual privacy (`blurred`), and startup confirmation (`promptPending`).
 *
 * Initialized with `allowed: false` and `blurred: true` so sensitive content
 * can never flash on screen before persisted settings load (§129.1, §129.3).
 */
let state: AdultState = {
  mode: 'off',
  allowed: false,
  savedEnabled: false,
  doNotAskAgain: false,
  promptPending: false,
  blurred: true,
  adultProviders: EMPTY_PROVIDERS,
  revealedKeys: EMPTY_REVEALED,
  visibleAdultCount: 0,
  loaded: false,
};

const listeners = new Set<() => void>();
let started = false;

const emit = () => {
  listeners.forEach((listener) => listener());
};

const publish = (
  next: Partial<AdultStateSnapshot> & { mode?: AdultMode; allowed?: boolean },
  options?: { clearRevealed?: boolean }
) => {
  const nextAllowed = next.allowed !== undefined ? Boolean(next.allowed) : state.allowed;
  const nextBlurred = !nextAllowed
    ? true
    : next.blurred !== undefined
      ? Boolean(next.blurred)
      : state.blurred;
  const nextProviders = Array.isArray(next.adultProviders)
    ? new Set(next.adultProviders)
    : state.adultProviders;
  const shouldClearRevealed =
    options?.clearRevealed ||
    !nextAllowed ||
    (nextBlurred && !state.blurred);
  const nextRevealed = shouldClearRevealed ? EMPTY_REVEALED : state.revealedKeys;

  state = {
    ...state,
    mode: next.mode ?? state.mode,
    allowed: nextAllowed,
    savedEnabled:
      next.savedEnabled !== undefined ? Boolean(next.savedEnabled) : state.savedEnabled,
    doNotAskAgain:
      next.doNotAskAgain !== undefined ? Boolean(next.doNotAskAgain) : state.doNotAskAgain,
    promptPending:
      next.promptPending !== undefined ? Boolean(next.promptPending) : state.promptPending,
    blurred: nextBlurred,
    adultProviders: nextProviders,
    revealedKeys: nextRevealed,
    loaded: true,
  };
  emit();
};

export const refreshAdultState = async (): Promise<void> => {
  const response = await window.cloudstream?.getAdultMode?.();
  if (response?.ok) publish(response);
};

const start = () => {
  if (started) return;
  if (typeof window === 'undefined' || !window.cloudstream) return;
  started = true;
  window.cloudstream.onAdultChanged?.((next) => publish(next));
  void refreshAdultState();
};

// Start immediately if the preload bridge is ready so state resolves as early as possible.
start();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useAdultState = (): AdultState => {
  useEffect(start, []);
  return useSyncExternalStore(subscribe, () => state);
};

export const useAdultMode = useAdultState;

/**
 * Returns true if an adult item's visual assets should currently be blurred.
 */
export const isAdultItemBlurred = (
  adult: Pick<AdultState, 'allowed' | 'blurred' | 'revealedKeys'>,
  itemKeyOrIsAdult?: string | boolean | null,
  maybeItemKey?: string | null
): boolean => {
  if (typeof itemKeyOrIsAdult === 'boolean') {
    if (!itemKeyOrIsAdult) return false;
    if (!adult.allowed) return true;
    if (!adult.blurred) return false;
    if (maybeItemKey && adult.revealedKeys.has(maybeItemKey)) return false;
    return true;
  }
  if (!adult.allowed) return true;
  if (!adult.blurred) return false;
  if (itemKeyOrIsAdult && adult.revealedKeys.has(itemKeyOrIsAdult)) return false;
  return true;
};

/**
 * Reveals an individual adult item's visual assets for the current session.
 * Refused when adult content is not permitted for the session (§129.4).
 */
export const revealAdultItem = (itemKey: string): void => {
  if (!itemKey || !state.allowed) return;
  if (state.revealedKeys.has(itemKey)) return;
  const next = new Set(state.revealedKeys);
  next.add(itemKey);
  state = { ...state, revealedKeys: next };
  emit();
};

export const hideAdultItem = (itemKey: string): void => {
  if (!itemKey || !state.revealedKeys.has(itemKey)) return;
  const next = new Set(state.revealedKeys);
  next.delete(itemKey);
  state = { ...state, revealedKeys: next };
  emit();
};

/**
 * Tracks whether adult content is currently mounted on screen so the contextual
 * top navigation Unblur/Blur control knows when it is relevant (§129.5).
 */
export const useRegisterAdultPresence = (present: boolean): void => {
  useEffect(() => {
    if (!present) return;
    state = { ...state, visibleAdultCount: state.visibleAdultCount + 1 };
    emit();
    return () => {
      state = {
        ...state,
        visibleAdultCount: Math.max(0, state.visibleAdultCount - 1),
      };
      emit();
    };
  }, [present]);
};

/** Every write goes through the main process; the push brings the new state back. */
export const setAdultMode = async (mode: AdultMode): Promise<boolean> => {
  const response = await window.cloudstream?.setAdultMode?.(mode);
  if (response?.ok) publish(response, { clearRevealed: true });
  return Boolean(response?.ok);
};

/**
 * Updates adult content availability (both persistent default and current session).
 * Enabling adult content keeps visual protection active (`blurred: true`).
 */
export const setAdultAvailability = async (enabled: boolean): Promise<boolean> => {
  const response = await window.cloudstream?.setAdultAllowed?.(enabled);
  if (response?.ok) publish(response, { clearRevealed: true });
  return Boolean(response?.ok);
};

/**
 * Toggles session-only visual protection (`blurred: true` vs `false`) without
 * modifying persistent adult content or startup prompt preferences (§129.5).
 */
export const setAdultVisualBlurred = async (blurred: boolean): Promise<boolean> => {
  if (!state.allowed && !blurred) return false;
  const response = await window.cloudstream?.setAdultAllowed?.({ blurred });
  if (response?.ok) publish(response, { clearRevealed: blurred });
  return Boolean(response?.ok);
};

/**
 * Updates the persistent "Do Not Ask Again" startup confirmation preference.
 */
export const setAdultDoNotAskAgain = async (doNotAskAgain: boolean): Promise<boolean> => {
  const response = await window.cloudstream?.setAdultAllowed?.({ doNotAskAgain });
  if (response?.ok) publish(response);
  return Boolean(response?.ok);
};

export const revealAdultForSession = async (
  reveal = true,
  options?: { doNotAskAgain?: boolean; blurred?: boolean }
): Promise<void> => {
  const response = reveal
    ? await window.cloudstream?.unlockAdultForSession?.(options)
    : await window.cloudstream?.lockAdultForSession?.(options);
  if (response?.ok) publish(response, { clearRevealed: true });
};

