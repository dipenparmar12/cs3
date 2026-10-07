/**
 * Incognito — the single source of truth for whether this session is private
 * (PRD-52 §5).
 *
 * Enforcement is at the persistence boundary: every store that records
 * *automatic* activity (history, progress, played source, search history,
 * title outcomes, visits, provider analytics) asks `isPrivateSession()` at
 * write time and turns the write into a no-op. Asking the main process at the
 * moment of the write, never a renderer copy, is what makes a stale UI unable
 * to leak anything.
 *
 * Explicit actions — a bookmark, a download, a subtitle the viewer pressed
 * Download on — are not gated here; they are choices, not activity.
 *
 * No second datastore: private state lives in memory and dies with the process.
 * The active flag itself is persisted only when `rememberPreference` is on.
 */

export interface IncognitoSettings {
  allowDownloads: boolean;
  askBeforeDownload: boolean;
  allowExplicitSaves: boolean;
  rememberPreference: boolean;
  clearSessionOnExit: boolean;
}

export interface PrivacyState {
  active: boolean;
  settings: IncognitoSettings;
}

/** The subset of `DatastoreManager` this needs, so tests need no Electron. */
export interface PrivacyBackingStore {
  getBool(key: string, defaultValue?: boolean, isSetting?: boolean): boolean;
  setBool(key: string, value: boolean, isSetting?: boolean): void;
}

export const DEFAULT_INCOGNITO_SETTINGS: IncognitoSettings = {
  allowDownloads: true,
  askBeforeDownload: false,
  allowExplicitSaves: true,
  rememberPreference: false,
  clearSessionOnExit: true,
};

const KEYS: Record<keyof IncognitoSettings, string> = {
  allowDownloads: 'incognito_allow_downloads',
  askBeforeDownload: 'incognito_ask_download',
  allowExplicitSaves: 'incognito_allow_saves',
  rememberPreference: 'incognito_remember',
  clearSessionOnExit: 'incognito_clear_on_exit',
};
const ACTIVE_KEY = 'incognito_active';

let current: PrivacyMode | null = null;

/**
 * The gate every store calls. Module-level rather than injected so that a
 * store constructed before the service — or in a test with no service — is
 * simply "not private", which is the pre-existing behaviour.
 */
export function isPrivateSession(): boolean {
  return current?.isActive() ?? false;
}

export function allowsExplicitSaves(): boolean {
  return !current?.isActive() || (current?.getState().settings.allowExplicitSaves ?? true);
}

export function allowsDownloads(): boolean {
  return !current?.isActive() || (current?.getState().settings.allowDownloads ?? true);
}

export class PrivacyMode {
  private active: boolean;
  private settings: IncognitoSettings;
  private readonly store: PrivacyBackingStore;
  private readonly listeners = new Set<(state: PrivacyState) => void>();
  private readonly sessionClearers = new Set<() => void>();

  constructor(store: PrivacyBackingStore) {
    this.store = store;
    this.settings = { ...DEFAULT_INCOGNITO_SETTINGS };
    for (const key of Object.keys(KEYS) as Array<keyof IncognitoSettings>) {
      this.settings[key] = store.getBool(KEYS[key], DEFAULT_INCOGNITO_SETTINGS[key], true);
    }
    // Starts off unless the viewer asked for the choice to be remembered.
    this.active = this.settings.rememberPreference ? store.getBool(ACTIVE_KEY, false, true) : false;
    current = this;
  }

  isActive(): boolean {
    return this.active;
  }

  getState(): PrivacyState {
    return { active: this.active, settings: { ...this.settings } };
  }

  setActive(active: boolean): PrivacyState {
    if (active !== this.active) {
      // Both edges start from nothing: on, a clean private session; off, the
      // private session's volatile data goes.
      this.clearSession();
      this.active = active;
      if (this.settings.rememberPreference) this.store.setBool(ACTIVE_KEY, active, true);
      this.emit();
    }
    return this.getState();
  }

  updateSettings(partial: Partial<IncognitoSettings>): PrivacyState {
    for (const key of Object.keys(partial) as Array<keyof IncognitoSettings>) {
      const value = partial[key];
      if (typeof value !== 'boolean' || !(key in KEYS)) continue;
      this.settings[key] = value;
      this.store.setBool(KEYS[key], value, true);
    }
    if (!this.settings.allowDownloads) this.settings.askBeforeDownload = false;
    // Forgetting the preference must also forget the stored active flag.
    this.store.setBool(ACTIVE_KEY, this.settings.rememberPreference && this.active, true);
    this.emit();
    return this.getState();
  }

  /** Volatile private caches register here and are emptied on each edge. */
  onClearSession(clear: () => void): () => void {
    this.sessionClearers.add(clear);
    return () => this.sessionClearers.delete(clear);
  }

  clearSession(): void {
    for (const clear of this.sessionClearers) {
      try {
        clear();
      } catch {}
    }
  }

  onChange(listener: (state: PrivacyState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Called on quit: a private session never outlives the process. */
  shutdown(): void {
    if (this.active && this.settings.clearSessionOnExit) this.clearSession();
  }

  private emit(): void {
    const state = this.getState();
    for (const listener of this.listeners) listener(state);
  }
}

/** Test hook: forget the registered service. */
export function resetPrivacyModeForTests(): void {
  current = null;
}
