import { useEffect, useSyncExternalStore } from 'react';

export type AdultMode = 'off' | 'ask' | 'on';

export interface AdultState {
  mode: AdultMode;
  /** Whether adult providers are offered *now*. Differs from `mode` under `ask`. */
  allowed: boolean;
  loaded: boolean;
}

/**
 * The renderer's one copy of the adult gate.
 *
 * The main process owns the decision (`BootstrapService`); this only mirrors
 * it. Every screen that shows or changes the setting reads from here, so a
 * change made in Settings, the Extensions footer, onboarding or a backup
 * restore reaches all of them through `adult:changed` instead of each holding a
 * private copy that goes stale.
 */
let state: AdultState = { mode: 'off', allowed: false, loaded: false };
const listeners = new Set<() => void>();
let started = false;

const publish = (next: Partial<AdultState>) => {
  const merged = { ...state, ...next, loaded: true };
  if (merged.mode === state.mode && merged.allowed === state.allowed && state.loaded) return;
  state = merged;
  listeners.forEach((listener) => listener());
};

export const refreshAdultState = async (): Promise<void> => {
  const response = await window.cloudstream?.getAdultMode?.();
  if (response?.ok) publish({ mode: response.mode, allowed: response.allowed });
};

const start = () => {
  if (started) return;
  started = true;
  window.cloudstream?.onAdultChanged?.((next) => publish(next));
  void refreshAdultState();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useAdultState = (): AdultState => {
  useEffect(start, []);
  return useSyncExternalStore(subscribe, () => state);
};

/** Every write goes through the main process; the push brings the new state back. */
export const setAdultMode = async (mode: AdultMode): Promise<boolean> => {
  const response = await window.cloudstream?.setAdultMode?.(mode);
  if (response?.ok) publish({ mode: response.mode, allowed: response.allowed ?? false });
  return Boolean(response?.ok);
};

export const revealAdultForSession = async (reveal: boolean): Promise<void> => {
  const response = reveal
    ? await window.cloudstream?.unlockAdultForSession?.()
    : await window.cloudstream?.lockAdultForSession?.();
  if (response?.ok) publish({ mode: response.mode, allowed: response.allowed });
};
