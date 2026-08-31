import React, { createContext, useContext } from 'react';
import type { SettingsLevel } from './settingsLevel';

export { shouldShow } from './settingsLevel';
export type { SettingsLevel } from './settingsLevel';

/**
 * The React half of the settings level. The rule itself, and the reasoning
 * behind it, live in `settingsLevel.ts` — Node's type stripping cannot load
 * JSX, and the rule is the part worth testing.
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
