import React, { createContext, useContext } from 'react';
import type { SettingsLevel } from './settingsLevel';

export { shouldShow } from './settingsLevel';
export type { SettingsLevel } from './settingsLevel';

/**
 * The React half of the settings level. The rule itself, and the reasoning
 * behind it, live in `settingsLevel.ts` — Node's type stripping cannot load
 * JSX, and the rule is the part worth testing.
 *
 * The `Context` suffix is load-bearing on Windows. This file was
 * `SettingsLevel.tsx`, which on a case-insensitive filesystem is the same name
 * as `settingsLevel.ts` beside it — and module resolution tries `.ts` before
 * `.tsx`, so every `./SettingsLevel` import silently resolved to the pure rule
 * instead. A missing named export is an ESM *link* error rather than a runtime
 * one, so it took down the whole `App.tsx` import graph and the window came up
 * blank. Never name a `.tsx` and a `.ts` alike but for their casing.
 */
const LevelContext = createContext<SettingsLevel>('everything');

export const SettingsLevelProvider: React.FC<{
  level: SettingsLevel;
  children: React.ReactNode;
}> = ({ level, children }) => (
  <LevelContext.Provider value={level}>{children}</LevelContext.Provider>
);

export function useSettingsLevel(): SettingsLevel {
  return useContext(LevelContext);
}
