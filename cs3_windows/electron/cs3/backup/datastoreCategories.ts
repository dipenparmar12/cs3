import type { BackupGroup } from '../../../src/types/backup.ts';

/**
 * Which backup category owns each datastore key.
 *
 * The first backup format carried the datastore as one `settings` blob — every
 * key, including the ones a dedicated section already carried and the caches
 * the format said it left out. Two consequences, both silent: restoring
 * "settings" overwrote `library_entries` wholesale with the backup's copy, and
 * it restored `source_cache_v1` (3 MB of links that had expired weeks earlier)
 * on top of a working one.
 *
 * So every key now has exactly one owner:
 *
 * - **owned** — a dedicated section carries it through its store, which knows
 *   how to merge it row by row. Writing the raw key as well would be a second,
 *   coarser restore of the same data racing the first.
 * - **excluded** — a cache or a fact about this machine. Restored elsewhere it
 *   is wrong (a window position on a display that does not exist) or worse
 *   than nothing (expired links served first).
 * - a **category** — a group a person can recognise and choose.
 *
 * A key nobody has classified lands in `other`, never nowhere. A setting added
 * after this table was written still travels; it is just filed generically
 * until someone gives it a home.
 */

export type DatastoreBucketName = 'datastore' | 'settings';
export type DatastoreValueType = '_Bool' | '_Int' | '_String' | '_Float' | '_Long' | '_StringSet';

export const DATASTORE_VALUE_TYPES: DatastoreValueType[] = [
  '_Bool',
  '_Int',
  '_String',
  '_Float',
  '_Long',
  '_StringSet',
];

/** One stored key as a backup row. */
export interface DatastoreRow {
  bucket: DatastoreBucketName;
  type: DatastoreValueType;
  key: string;
  value: unknown;
}

export interface DatastoreCategory {
  id: string;
  label: string;
  description: string;
  group: BackupGroup;
  keys?: string[];
  prefixes?: string[];
}

/** Carried by a dedicated section; see the section named beside each. */
const OWNED_KEYS = new Set([
  'library_entries', // library
  'source_memory', // library
  'played_sources', // library
  'watch_progress', // continueWatching
  'media_history_events_v1', // history
  'saved_detail_pages', // bookmarks
  'search_history', // searchHistory
  'cs3_title_outcomes', // titleOutcomes
  'download_queue_list', // downloads
  'installed_repositories_urls', // repositories
  'installed_plugins_list', // extensions
  'cs3_known_plugins', // extensions
  'cs3_provider_origins', // extensions
  'cs3_disabled_providers', // extensionSwitches
  'cs3_disabled_extensions', // extensionSwitches
  'cs3_disabled_repositories', // extensionSwitches
  'torrent_indexer_configs', // indexers
  'torrent_indexer_configs_version', // indexers
]);

/** Caches and machine-local facts. */
const EXCLUDED_KEYS = new Set([
  'source_cache_v1',
  'media_inspection_v1',
  'torrent_http_metadata_cache',
  'torrent_cache_path',
  'download_directory',
  'extension_available_updates',
  'extension_displaced_archives',
  'cs3_bootstrap_completed_version',
  'window_bounds',
]);

export const DATASTORE_CATEGORIES: DatastoreCategory[] = [
  {
    id: 'streaming',
    label: 'Streaming services',
    description: 'Which streaming services are shown, their order, and which are pinned.',
    group: 'sources',
    keys: ['ott_enabled_platforms', 'ott_pinned_platforms'],
  },
  {
    id: 'searchFilters',
    label: 'Search filters',
    description: 'The sources a search is limited to.',
    group: 'sources',
    keys: ['cs3_search_scope'],
  },
  {
    id: 'searchProfiles',
    label: 'Search profiles',
    description: 'Your named search set-ups and which one is active.',
    group: 'sources',
    keys: ['cs3_source_profiles'],
  },
  {
    id: 'builtInSources',
    label: 'Built-in sources and media servers',
    description: 'Stremio add-ons, Jellyfin and Emby servers, and which built-in sources are on.',
    group: 'sources',
    keys: ['cs3_stremio_addons', 'cs3_media_servers', 'cs3_disabled_native_providers'],
  },
  {
    id: 'sourcePrefs',
    label: 'Source preferences',
    description: 'How sources are found and ranked.',
    group: 'sources',
    keys: ['torrent_source_preferences', 'prefetch_sources_on_detail', 'cs3_provider_search_concurrency'],
  },
  {
    id: 'extensionPrefs',
    label: 'Extension update settings',
    description: 'When extensions check for and install updates.',
    group: 'sources',
    keys: ['extension_update_settings'],
  },
  {
    id: 'contentFilters',
    label: 'Regions and adult content',
    description: 'The regions you chose and whether adult content is shown.',
    group: 'settings',
    keys: [
      'cs3_adult_content_mode',
      'cs3_adult_content_enabled',
      'cs3_content_regions',
      'cs3_content_regions_cross',
    ],
  },
  {
    id: 'playback',
    label: 'Playback preferences',
    description: 'Player volume, speed, languages, subtitles and which player is used.',
    group: 'settings',
    keys: ['player_preferences', 'native_engine_policy'],
  },
  {
    id: 'downloadPrefs',
    label: 'Download preferences',
    description: 'Whether downloads ask before starting and what deleting one does.',
    group: 'settings',
    keys: ['download_confirm_behavior', 'download_delete_behavior'],
  },
  {
    id: 'home',
    label: 'Home screen',
    description: 'Which catalogue the home screen uses and how it is laid out.',
    group: 'settings',
    prefixes: ['home_'],
  },
  {
    id: 'privacy',
    label: 'Incognito and privacy',
    description: 'How incognito behaves and whether it stays on.',
    group: 'settings',
    prefixes: ['incognito_'],
  },
  {
    id: 'network',
    label: 'Network',
    description: 'DNS and connection settings.',
    group: 'settings',
    keys: ['cs3_network_settings'],
  },
  {
    id: 'activity',
    label: 'Recently opened titles',
    description: 'Which titles you have opened, so they show as visited.',
    group: 'content',
    keys: ['cs3_title_visits'],
  },
  {
    id: 'other',
    label: 'Other settings',
    description: 'Everything else you have changed in Settings.',
    group: 'settings',
  },
];

const CATEGORY_IDS = new Set(DATASTORE_CATEGORIES.map((category) => category.id));

/** Section id for a category, so it cannot collide with a store's own section. */
export function categorySectionId(categoryId: string): string {
  return `settings.${categoryId}`;
}

export function classifyKey(key: string): string | 'owned' | 'excluded' {
  if (OWNED_KEYS.has(key)) return 'owned';
  if (EXCLUDED_KEYS.has(key)) return 'excluded';
  for (const category of DATASTORE_CATEGORIES) {
    if (category.keys?.includes(key)) return category.id;
    if (category.prefixes?.some((prefix) => key.startsWith(prefix))) return category.id;
  }
  return 'other';
}

export function isCategoryId(id: string): boolean {
  return CATEGORY_IDS.has(id);
}

/** Flattens bucket-shaped storage into rows, keeping only real values. */
export function rowsFromBuckets(
  buckets: Partial<Record<DatastoreBucketName, Partial<Record<DatastoreValueType, Record<string, unknown>>>>>
): DatastoreRow[] {
  const rows: DatastoreRow[] = [];
  for (const bucket of ['datastore', 'settings'] as const) {
    const source = buckets[bucket];
    if (!source || typeof source !== 'object') continue;
    for (const type of DATASTORE_VALUE_TYPES) {
      const entries = source[type];
      if (!entries || typeof entries !== 'object') continue;
      for (const [key, value] of Object.entries(entries)) {
        if (value === undefined) continue;
        rows.push({ bucket, type, key, value });
      }
    }
  }
  return rows;
}

export function datastoreRowKey(row: Pick<DatastoreRow, 'bucket' | 'key'>): string {
  return `${row.bucket}:${row.key}`;
}

export function isDatastoreRow(raw: unknown): raw is DatastoreRow {
  if (!raw || typeof raw !== 'object') return false;
  const row = raw as Partial<DatastoreRow>;
  return (
    (row.bucket === 'datastore' || row.bucket === 'settings') &&
    typeof row.key === 'string' &&
    row.key.length > 0 &&
    DATASTORE_VALUE_TYPES.includes(row.type as DatastoreValueType) &&
    row.value !== undefined
  );
}

const KEY_LABELS: Record<string, string> = {
  ott_enabled_platforms: 'Services shown',
  ott_pinned_platforms: 'Pinned services and their order',
  cs3_search_scope: 'Search filter',
  cs3_source_profiles: 'Search profiles',
  cs3_stremio_addons: 'Stremio add-ons',
  cs3_media_servers: 'Media servers',
  cs3_disabled_native_providers: 'Built-in sources switched off',
  torrent_source_preferences: 'Torrent source preferences',
  prefetch_sources_on_detail: 'Load sources while you read',
  cs3_provider_search_concurrency: 'Providers searched at once',
  extension_update_settings: 'Extension updates',
  cs3_adult_content_mode: 'Adult content',
  cs3_adult_content_enabled: 'Adult content (older setting)',
  cs3_content_regions: 'Regions',
  cs3_content_regions_cross: 'Search other regions',
  player_preferences: 'Player preferences',
  native_engine_policy: 'Native player',
  download_confirm_behavior: 'Ask before downloading',
  download_delete_behavior: 'What deleting a download does',
  cs3_network_settings: 'Network settings',
  cs3_title_visits: 'Opened titles',
};

/** A readable name for a key, from the table or from the key itself. */
export function describeKey(key: string): string {
  if (KEY_LABELS[key]) return KEY_LABELS[key];
  const words = key
    .replace(/^cs3_/, '')
    .replace(/_v\d+$/, '')
    .replace(/[_-]+/g, ' ')
    .trim();
  return words ? words[0].toUpperCase() + words.slice(1) : key;
}

/** A few words for one value, so a conflict can be read without opening JSON. */
export function describeValue(row: DatastoreRow): string {
  const { value } = row;
  if (typeof value === 'boolean') return value ? 'On' : 'Off';
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? '' : 's'}`;
  if (typeof value !== 'string') return 'Set';
  const parsed = parseJsonish(value);
  if (Array.isArray(parsed)) return `${parsed.length} item${parsed.length === 1 ? '' : 's'}`;
  if (parsed && typeof parsed === 'object') {
    const count = Object.keys(parsed).length;
    return `${count} setting${count === 1 ? '' : 's'}`;
  }
  if (value === 'true' || value === 'false') return value === 'true' ? 'On' : 'Off';
  return value.length > 48 ? `${value.slice(0, 45)}…` : value || '(empty)';
}

function parseJsonish(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

/**
 * The comparable form of a value. Objects are stored as JSON strings
 * (`setObject`), and two serialisations of one object can order their keys
 * differently; comparing the strings would report a conflict for nothing.
 */
export function comparableValue(row: DatastoreRow): unknown {
  return typeof row.value === 'string' ? (parseJsonish(row.value) ?? row.value) : row.value;
}
