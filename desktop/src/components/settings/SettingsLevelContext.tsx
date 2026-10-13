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

/**
 * What is typed in "Find a setting". Empty means no search is running.
 *
 * Beside the level because it is the same kind of thing — a filter over rows
 * that each row applies to itself — and every row already reads this file.
 */
const QueryContext = createContext('');

export const SettingsQueryProvider: React.FC<{ query: string; children: React.ReactNode }> = ({
  query,
  children,
}) => <QueryContext.Provider value={query}>{children}</QueryContext.Provider>;

export function useSettingsQuery(): string {
  return useContext(QueryContext);
}

/**
 * True inside a group whose own title or keywords matched the query.
 *
 * Searching "downloads" should show the whole Downloads group, not only the
 * rows that happen to repeat the word; rows read this to stand down.
 */
export const GroupMatchContext = createContext(false);
