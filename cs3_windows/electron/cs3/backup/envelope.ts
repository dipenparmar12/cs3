import {
  categorySectionId,
  classifyKey,
  rowsFromBuckets,
  type DatastoreRow,
} from './datastoreCategories.ts';

/**
 * The backup file's outer shape, and reading every shape it has ever had.
 *
 * ## Format 2
 *
 * ```
 * { format, formatVersion: 2, createdAt, app: { version, platform },
 *   sections: { <id>: { schemaVersion, count, data: { <part>: rows[] } } } }
 * ```
 *
 * Each section carries its own schema version, so one store can change shape
 * without the whole file changing format — and a reader that does not know a
 * section, or knows only an older shape of it, skips that section rather than
 * refusing the file. That is what lets a backup written by a newer app still
 * restore everything this version understands.
 *
 * ## Format 1
 *
 * One `contents` object, each store in its own ad-hoc shape, and the whole
 * datastore as a single `settings` blob. It is upgraded here on read, once,
 * so nothing past this module ever sees it.
 */

export const BACKUP_FORMAT = 'cloudstream-desktop-backup';
export const BACKUP_FORMAT_VERSION = 2;

export interface SectionPayload {
  schemaVersion: number;
  count: number;
  data: Record<string, unknown[]>;
}

export interface BackupEnvelope {
  format: typeof BACKUP_FORMAT;
  formatVersion: number;
  createdAt: number;
  app: { version: string; platform: string };
  sections: Record<string, SectionPayload>;
  /** Set on an envelope read from an older format. Never written. */
  migratedFrom?: number;
}

export type ReadResult = { ok: true; envelope: BackupEnvelope } | { ok: false; error: string };

/**
 * Checks a parsed file and brings it to the current format.
 *
 * Refused by the `format` marker rather than by shape: a JSON file that
 * happens to have a `sections` key would otherwise be fed to every section,
 * and "restored 0 rows from 9 categories" is a much worse answer than "that
 * is not a CloudStream backup".
 */
export function readEnvelope(parsed: unknown): ReadResult {
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: 'That file is not readable as a backup.' };
  }
  const raw = parsed as Record<string, unknown>;
  if (raw.format !== BACKUP_FORMAT) {
    return { ok: false, error: 'That is not a CloudStream Desktop backup file.' };
  }
  if (typeof raw.formatVersion !== 'number') {
    return { ok: false, error: 'That backup has no format version.' };
  }
  const app = (raw.app && typeof raw.app === 'object' ? raw.app : {}) as Record<string, unknown>;
  const base = {
    format: BACKUP_FORMAT,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : 0,
    app: {
      version: typeof app.version === 'string' ? app.version : 'unknown',
      platform: typeof app.platform === 'string' ? app.platform : 'unknown',
    },
  } as const;

  if (raw.formatVersion === 1) {
    if (!raw.contents || typeof raw.contents !== 'object') {
      return { ok: false, error: 'That backup has no contents.' };
    }
    return {
      ok: true,
      envelope: {
        ...base,
        formatVersion: BACKUP_FORMAT_VERSION,
        sections: upgradeFormat1(raw.contents as Record<string, unknown>),
        migratedFrom: 1,
      },
    };
  }

  /*
   * Format 2 and anything newer. A newer file is read as long as it keeps the
   * section map — which is the whole point of having one — and each section
   * is then judged on its own schema version.
   */
  if (!raw.sections || typeof raw.sections !== 'object' || Array.isArray(raw.sections)) {
    return {
      ok: false,
      error:
        raw.formatVersion > BACKUP_FORMAT_VERSION
          ? `That backup was written by a newer version of the app (format ${raw.formatVersion}) in a shape this one cannot read. Update and try again.`
          : 'That backup has no contents.',
    };
  }
  const sections: Record<string, SectionPayload> = {};
  for (const [id, value] of Object.entries(raw.sections as Record<string, unknown>)) {
    const payload = normalisePayload(value);
    if (payload) sections[id] = payload;
  }
  return { ok: true, envelope: { ...base, formatVersion: raw.formatVersion, sections } };
}

function normalisePayload(value: unknown): SectionPayload | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const data: Record<string, unknown[]> = {};
  if (raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data)) {
    for (const [part, rows] of Object.entries(raw.data as Record<string, unknown>)) {
      if (Array.isArray(rows)) data[part] = rows;
    }
  }
  return {
    schemaVersion: typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 1,
    count: typeof raw.count === 'number' ? raw.count : countRows(data),
    data,
  };
}

export function countRows(data: Record<string, unknown[]>): number {
  return Object.values(data).reduce((sum, rows) => sum + rows.length, 0);
}

function payload(data: Record<string, unknown[]>): SectionPayload {
  return { schemaVersion: 1, count: countRows(data), data };
}

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

function parseStoredJson(row: DatastoreRow | undefined): unknown {
  if (!row || typeof row.value !== 'string') return undefined;
  try {
    return JSON.parse(row.value);
  } catch {
    return undefined;
  }
}

/**
 * Format 1 → 2.
 *
 * Mostly a reshaping, with two real changes. The `settings` blob is split by
 * key ownership (see `datastoreCategories.ts`), which drops the caches it
 * should never have carried. And two things that only ever travelled inside
 * that blob — the sources that actually played, and the services' order —
 * move to the sections that now own them, so an old backup restores them
 * through the same path a new one does.
 */
export function upgradeFormat1(contents: Record<string, unknown>): Record<string, SectionPayload> {
  const sections: Record<string, SectionPayload> = {};

  const dump = contents.settings as Record<string, unknown> | null | undefined;
  const dumpRows: DatastoreRow[] = [];
  if (dump && typeof dump === 'object') {
    const { settings, ...datastore } = dump;
    dumpRows.push(
      ...rowsFromBuckets({
        datastore: datastore as never,
        settings: (settings && typeof settings === 'object' ? settings : {}) as never,
      })
    );
  }
  const byKey = new Map(dumpRows.map((row) => [row.key, row]));

  const byCategory = new Map<string, DatastoreRow[]>();
  for (const row of dumpRows) {
    const owner = classifyKey(row.key);
    if (owner === 'owned' || owner === 'excluded') continue;
    const rows = byCategory.get(owner) ?? [];
    rows.push(row);
    byCategory.set(owner, rows);
  }

  // The adult mode was carried twice; the extensions copy fills a gap only.
  const extensions = contents.extensions as Record<string, unknown> | null | undefined;
  const adultMode = extensions?.adultMode;
  if (
    (adultMode === 'off' || adultMode === 'ask' || adultMode === 'on') &&
    !byKey.has('cs3_adult_content_mode')
  ) {
    const rows = byCategory.get('contentFilters') ?? [];
    rows.push({ bucket: 'datastore', type: '_String', key: 'cs3_adult_content_mode', value: adultMode });
    byCategory.set('contentFilters', rows);
  }
  for (const [category, rows] of byCategory) {
    sections[categorySectionId(category)] = payload({ entries: rows });
  }

  const library = contents.library as Record<string, unknown> | null | undefined;
  const played = asArray(parseStoredJson(byKey.get('played_sources')));
  if (library && typeof library === 'object') {
    sections.library = payload({
      entries: asArray(library.entries),
      sources: asArray(library.sources),
      played,
    });
    sections.continueWatching = payload({ progress: asArray(library.progress) });
  } else if (played.length) {
    sections.library = payload({ entries: [], sources: [], played });
  }

  if (Array.isArray(contents.history)) sections.history = payload({ events: contents.history });

  const bookmarks = asArray(contents.bookmarks);
  const snapshots = asArray(contents.pageSnapshots);
  if (contents.bookmarks || contents.pageSnapshots) {
    sections.bookmarks = payload({ pages: bookmarks, content: snapshots });
  }

  if (Array.isArray(contents.searchHistory)) {
    sections.searchHistory = payload({ queries: contents.searchHistory });
  }
  if (Array.isArray(contents.savedSearches)) {
    sections.savedSearches = payload({ searches: contents.savedSearches });
  }
  if (contents.titleOutcomes && typeof contents.titleOutcomes === 'object') {
    sections.titleOutcomes = payload({
      outcomes: Object.values(contents.titleOutcomes as Record<string, unknown>),
    });
  }

  const analytics = contents.providerAnalytics as Record<string, unknown> | null | undefined;
  if (analytics && typeof analytics === 'object') {
    const preferences = Object.entries(
      (analytics.preferences && typeof analytics.preferences === 'object'
        ? analytics.preferences
        : {}) as Record<string, unknown>
    ).map(([provider, preference]) => ({ provider, preference }));
    const settings =
      analytics.settings && typeof analytics.settings === 'object'
        ? [{ id: 'settings', ...(analytics.settings as Record<string, unknown>) }]
        : [];
    sections.providerPreferences = payload({ preferences, settings });
  }

  if (Array.isArray(contents.downloads)) sections.downloads = payload({ tasks: contents.downloads });

  if (extensions && typeof extensions === 'object') {
    sections.repositories = payload({
      repositories: asArray(extensions.repositories)
        .filter((url): url is string => typeof url === 'string' && url.length > 0)
        .map((url) => ({ url })),
    });
    const origins = Object.entries(
      (extensions.providerOrigins && typeof extensions.providerOrigins === 'object'
        ? extensions.providerOrigins
        : {}) as Record<string, { internalName?: string; pluginName?: string }>
    ).map(([provider, origin]) => ({ provider, ...origin }));
    sections.extensions = payload({ plugins: asArray(extensions.plugins), origins });
    const names = (value: unknown) =>
      asArray(value).filter((name): name is string => typeof name === 'string' && name.length > 0);
    sections.extensionSwitches = payload({
      switches: [
        ...names(extensions.disabledRepositories).map((name) => ({ kind: 'repository', name })),
        ...names(extensions.disabledExtensions).map((name) => ({ kind: 'extension', name })),
        ...names(extensions.disabledProviders).map((name) => ({ kind: 'provider', name })),
      ],
    });
  }

  if (Array.isArray(contents.indexers)) sections.indexers = payload({ configs: contents.indexers });

  return sections;
}

/** How a section reads data stored under an older schema version. */
export type SectionMigrations = Record<number, (data: Record<string, unknown[]>) => Record<string, unknown[]>>;

export type UpgradeResult =
  | { ok: true; data: Record<string, unknown[]>; migratedFrom?: number }
  | { ok: false; reason: string };

/**
 * Brings one section's data up to the version this app writes, one step at
 * a time. A newer schema, or a gap in the ladder, skips the section with a
 * reason — the rest of the file still restores.
 */
export function upgradeSection(
  stored: SectionPayload,
  current: number,
  migrations: SectionMigrations = {}
): UpgradeResult {
  if (stored.schemaVersion > current) {
    return {
      ok: false,
      reason: 'Saved by a newer version of the app in a form this version cannot read.',
    };
  }
  let data = stored.data;
  let version = stored.schemaVersion;
  while (version < current) {
    const step = migrations[version];
    if (!step) {
      return { ok: false, reason: `This version of the app cannot read the form it was saved in (v${version}).` };
    }
    try {
      data = step(data);
    } catch {
      return { ok: false, reason: 'It could not be converted from the form it was saved in.' };
    }
    version++;
  }
  return {
    ok: true,
    data,
    migratedFrom: stored.schemaVersion < current ? stored.schemaVersion : undefined,
  };
}
