import { DEFAULT_PROFILE_ID, LOCKED_PROFILE_ID } from './profileContext.ts';

/**
 * Which datastore keys belong to a viewer profile, and how they are stored.
 *
 * The default profile keeps the unprefixed keys every installation already has,
 * so "migrating" an existing install into it moves nothing: its library, history
 * and preferences simply *are* the default profile's. A key can therefore never
 * be lost to a half-finished copy, and the Android backup import and the backup
 * restore — which write the plain names — land in the profile they were run in.
 * Every other profile stores the same names under `profile:<id>:`.
 *
 * A key not listed here belongs to the installation and is shared: extensions,
 * repositories, network, downloads, the adult gate, caches. Adding a per-person
 * value means adding its key to one of these two sets, and nothing else.
 */

/** What this person watched, saved and searched. Kept per profile and never copied. */
export const PERSONAL_KEYS: ReadonlySet<string> = new Set([
  'library_entries',
  'watch_progress',
  'source_memory',
  'played_sources',
  'media_history_events_v1',
  'saved_detail_pages',
  'search_history',
  'cs3_title_outcomes',
  'cs3_title_visits',
]);

/** How this person likes the app set up. Kept per profile and copied by Duplicate. */
export const PREFERENCE_KEYS: ReadonlySet<string> = new Set([
  // Languages, subtitle look, volume — `player:get/setPreferences`.
  'player_preferences',
  // The player's own switches (Settings → Player).
  'playback_speed_enabled_key',
  'player_resize_enabled_key',
  'player_show_playback_speed',
  'player_show_aspect_ratio',
  'default_aspect_ratio',
  'default_playback_speed',
  'player_subtitles_enabled_key',
  'player_show_subtitles',
  'player_show_native_player_btn',
  'home_show_continue_watching',
  // Which streaming services the sidebar shows, and in what order.
  'ott_enabled_platforms',
  'ott_pinned_platforms',
  // Which sources a search asks, and the named set-ups behind it.
  'cs3_search_scope',
  'cs3_source_profiles',
]);

const PREFIX = 'profile:';

export function isProfileKey(key: string): boolean {
  return PERSONAL_KEYS.has(key) || PREFERENCE_KEYS.has(key);
}

/**
 * The name a key is stored under for one profile.
 *
 * `null` for the locked placeholder: there is nowhere to read from or write to
 * until a profile is unlocked.
 */
export function storedKey(key: string, profileId: string): string | null {
  if (!isProfileKey(key)) return key;
  if (profileId === LOCKED_PROFILE_ID) return null;
  if (profileId === DEFAULT_PROFILE_ID) return key;
  return `${PREFIX}${profileId}:${key}`;
}

/**
 * The profile and plain name behind a stored key.
 *
 * `profileId` is null for an installation key; an unprefixed profile key is the
 * default profile's.
 */
export function parseStoredKey(stored: string): { profileId: string | null; key: string } {
  if (stored.startsWith(PREFIX)) {
    const rest = stored.slice(PREFIX.length);
    const split = rest.indexOf(':');
    if (split > 0) return { profileId: rest.slice(0, split), key: rest.slice(split + 1) };
  }
  return { profileId: isProfileKey(stored) ? DEFAULT_PROFILE_ID : null, key: stored };
}

/**
 * What one profile can see of a set of stored values, under plain names: every
 * installation key, plus its own copy of the per-person ones and nobody else's.
 */
export function visibleEntries<T>(entries: Record<string, T>, profileId: string): Record<string, T> {
  const kept: Record<string, T> = {};
  for (const [stored, value] of Object.entries(entries)) {
    const { profileId: owner, key } = parseStoredKey(stored);
    if (owner !== null && owner !== profileId) continue;
    kept[key] = value;
  }
  return kept;
}

/** Every stored key of one profile starts with this — the default profile excepted. */
export function profileKeyPrefix(profileId: string): string {
  return `${PREFIX}${profileId}:`;
}
