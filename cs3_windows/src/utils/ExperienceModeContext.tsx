import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import {
  EXPERIENCE_MODE_KEY,
  LEGACY_SETTINGS_LEVEL_KEY,
  readMode,
  shouldReveal,
  type Audience,
  type ExperienceMode,
} from './experienceMode';

/**
 * The React half of the experience mode. The rule and the reasoning live in
 * `experienceMode.ts` — Node's type stripping cannot load JSX, and the rule is
 * the part worth testing.
 *
 * The `Context` suffix is load-bearing on Windows, exactly as it is for
 * `SettingsLevelContext`: a `.tsx` and a `.ts` differing only in case are one
 * name on a case-insensitive filesystem, module resolution tries `.ts` first,
 * and the missing export is an ESM *link* error that takes down the whole
 * `App.tsx` import graph and blanks the window.
 *
 * **The default is `standard`.** `SettingsLevelContext` defaults to
 * `everything`, which is right for a screen that is always inside its provider
 * and wrong for a mode read from anywhere: a component rendered outside the
 * provider — a portal, a test, a new tree — would otherwise reveal every
 * internal by accident, and that failure is invisible because it looks like the
 * feature working.
 */
const ModeContext = createContext<{
  mode: ExperienceMode;
  setMode: (next: ExperienceMode) => void;
}>({ mode: 'standard', setMode: () => {} });

/** Reads the stored preference, tolerating storage that throws or is cleared. */
function loadMode(): ExperienceMode {
  try {
    return readMode(
      localStorage.getItem(EXPERIENCE_MODE_KEY),
      localStorage.getItem(LEGACY_SETTINGS_LEVEL_KEY)
    );
  } catch {
    // Private windows and cleared profiles throw rather than return null.
    return 'standard';
  }
}

export const ExperienceModeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [mode, setStored] = useState<ExperienceMode>(loadMode);

  const setMode = useCallback((next: ExperienceMode) => {
    setStored(next);
    try {
      localStorage.setItem(EXPERIENCE_MODE_KEY, next);
      /**
       * The legacy key is kept in step rather than left to rot.
       *
       * It is what `SettingsView` read before this existed, and a stale value
       * there would restore the old answer the next time that code path runs —
       * the same "two records of one decision disagreeing" shape the adult gate
       * had to fix.
       */
      localStorage.setItem(
        LEGACY_SETTINGS_LEVEL_KEY,
        next === 'developer' ? 'everything' : 'simple'
      );
    } catch {
      // A preference that cannot be persisted still applies to this session.
    }
  }, []);

  const value = useMemo(() => ({ mode, setMode }), [mode, setMode]);
  return <ModeContext.Provider value={value}>{children}</ModeContext.Provider>;
};

export function useExperienceMode(): ExperienceMode {
  return useContext(ModeContext).mode;
}

export function useSetExperienceMode(): (next: ExperienceMode) => void {
  return useContext(ModeContext).setMode;
}

/** True when the viewer has asked to see how the app is built. */
export function useIsDeveloper(): boolean {
  return useContext(ModeContext).mode === 'developer';
}

/**
 * Whether to render something written for `audience`.
 *
 * The hook rather than `shouldReveal` directly, so a component does not have to
 * hold the mode just to ask one question about it.
 */
export function useReveal(audience: Audience = 'everyone'): boolean {
  return shouldReveal(useContext(ModeContext).mode, audience);
}

/**
 * Renders its children only in developer mode.
 *
 * For whole panels, where a hook plus an early return would be the same three
 * lines at every call site. `fallback` is for the rare case where standard mode
 * needs something in place of the technical thing rather than nothing.
 */
export const DeveloperOnly: React.FC<{
  children: React.ReactNode;
  fallback?: React.ReactNode;
}> = ({ children, fallback = null }) => (useIsDeveloper() ? <>{children}</> : <>{fallback}</>);
