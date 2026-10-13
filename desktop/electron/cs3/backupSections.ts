import type { BackupSection } from './backupService.ts';
import type { BackupPart } from './backup/collection.ts';
import { canonical } from './backup/collection.ts';
import {
  DATASTORE_CATEGORIES,
  categorySectionId,
  classifyKey,
  comparableValue,
  datastoreRowKey,
  describeKey,
  describeValue,
  isDatastoreRow,
  type DatastoreRow,
} from './backup/datastoreCategories.ts';
import { isAdultPlugin } from './starterPlugins.ts';
import type { RestoreFailure } from '../../src/types/backup.ts';
import type { DownloadTask } from '../../src/types/download.ts';
import type { HistoryEvent } from '../../src/types/history.ts';
import type { LibraryEntry, PlayedSource } from '../../src/types/library.ts';
import type { SearchHistoryEntry } from '../../src/types/api.ts';
import type { IndexerConfig } from '../../src/types/torrent.ts';
import type { SitePlugin } from '../../src/types/plugin.ts';
import type { AnalyticsSettings, ProviderPreference } from '../../src/types/analytics.ts';
import type { WatchProgress, SourceMemory } from './libraryStore.ts';
import type { Bookmark } from './bookmarkStore.ts';
import type { PageSnapshot } from './pageSnapshot.ts';
import type { TitleOutcome } from './titleOutcomes.ts';
import type { SavedSearch } from '../savedSearches.ts';
import type { ExtensionJobRequest } from './extensionJobs.ts';

/**
 * Every store's backup registration, in one table.
 *
 * Order is display order *and* restore order, and the second matters:
 * repositories are added before extensions are installed from them, and both
 * before the switches that turn some of them off.
 *
 * Dependencies are the narrowest shape each section touches, so the table can
 * be built against fakes in a test without Electron.
 */
export interface BackupSectionDeps {
  datastore: {
    rows(): DatastoreRow[];
    writeRows(put: DatastoreRow[], remove: Array<Pick<DatastoreRow, 'bucket' | 'key'>>): void;
  };
  library: {
    exportAll(): { entries: LibraryEntry[]; progress: WatchProgress[]; sources: SourceMemory[] };
    exportPlayedSources(): PlayedSource[];
    replaceEntries(rows: LibraryEntry[]): void;
    replaceProgress(rows: WatchProgress[]): void;
    replaceSourceMemory(rows: SourceMemory[]): void;
    replacePlayedSources(rows: PlayedSource[]): void;
  };
  history: { exportAll(): HistoryEvent[]; replaceAll(rows: HistoryEvent[]): void };
  bookmarks: { list(): Bookmark[]; replaceAll(rows: Bookmark[]): void };
  pageSnapshots: { list(): PageSnapshot[]; replacePinned(rows: PageSnapshot[]): void };
  searchHistory: { list(limit?: number): SearchHistoryEntry[]; replaceAll(rows: SearchHistoryEntry[]): void };
  savedSearches: { exportAll(): SavedSearch[]; replaceAll(rows: unknown[]): void };
  titleOutcomes: { list(): Record<string, TitleOutcome>; replaceAll(rows: TitleOutcome[]): void };
  providerAnalytics: {
    getSettings(): AnalyticsSettings;
    setSettings(next: Partial<AnalyticsSettings>): unknown;
    getPreferences(): Record<string, ProviderPreference>;
    setPreference(provider: string, preference: ProviderPreference | null): void;
  };
  downloads: {
    getTasks(): DownloadTask[];
    restoreTasks(tasks: DownloadTask[]): { added: number; verified: number; partial: number; missing: number };
  };
  plugins: {
    getInstalledRepositories(): string[];
    addRepository(url: string): Promise<{ ok: boolean; message: string }>;
    getInstalledPlugins(): SitePlugin[];
    fetchRepository(url: string, options?: { remember?: boolean }): Promise<{ plugins: SitePlugin[] }>;
    rememberKnownPlugins(rows: Array<Partial<KnownPluginRow>>): number;
    exportProviderOrigins(): Record<string, { internalName: string; pluginName: string }>;
    importProviderOrigins(origins: Record<string, { internalName: string; pluginName: string }>): number;
    getDisabledProviders(): string[];
    getDisabledExtensions(): string[];
    getDisabledRepositories(): string[];
    setProvidersEnabled(names: string[], enabled: boolean): unknown;
    setExtensionsEnabled(names: string[], enabled: boolean): unknown;
    setRepositoriesEnabled(names: string[], enabled: boolean): unknown;
  };
  /** Queues extension installs and updates on the background job queue. */
  enqueueExtensionJobs(requests: ExtensionJobRequest[]): void;
  isAdultAllowed(): boolean;
  indexers: { getConfigs(): IndexerConfig[]; saveConfigs(configs: IndexerConfig[]): void };
  adult: { adultMode(): 'off' | 'ask' | 'on'; setAdultMode(mode: 'off' | 'ask' | 'on'): unknown };
}

export interface KnownPluginRow {
  internalName: string;
  name: string;
  repositoryUrl: string;
  url?: string;
  version?: number;
}

const isObject = (row: unknown): row is Record<string, unknown> => !!row && typeof row === 'object';
const hasString = (row: unknown, field: string): boolean =>
  isObject(row) && typeof row[field] === 'string' && (row[field] as string).length > 0;

/** `key|season|episode`, the slot one watch-progress or source row occupies. */
function slotOf(row: { key: string; season?: number; episode?: number }): string {
  return `${row.key}|${row.season ?? ''}|${row.episode ?? ''}`;
}

function episodeLabel(title: string, season?: number, episode?: number): string {
  if (season === undefined && episode === undefined) return title;
  return `${title} · S${season ?? '?'}E${episode ?? '?'}`;
}

/** Equality that ignores fields describing when a row was looked at, not what it is. */
function sameExcept<T>(...volatile: string[]) {
  return (a: T, b: T): boolean => {
    const strip = (row: T) => {
      const copy = { ...(row as Record<string, unknown>) };
      for (const field of volatile) delete copy[field];
      return copy;
    };
    return canonical(strip(a)) === canonical(strip(b));
  };
}

const dateOnly = (at: number | undefined) =>
  typeof at === 'number' && at > 0 ? `Changed ${new Date(at).toISOString().slice(0, 10)}` : 'Different';

export function createBackupSections(deps: BackupSectionDeps): BackupSection[] {
  const sections: BackupSection[] = [
    // --- your content -----------------------------------------------------
    {
      id: 'library',
      label: 'Library',
      description: 'Titles you added, their lists and ratings, and which source played each one.',
      group: 'content',
      schemaVersion: 1,
      parts: [
        {
          id: 'entries',
          label: 'titles',
          local: () => deps.library.exportAll().entries,
          identify: (row: LibraryEntry) => (hasString(row, 'key') ? row.key : null),
          describe: (row: LibraryEntry) => (row.year ? `${row.title} (${row.year})` : row.title),
          updatedAt: (row: LibraryEntry) => row.updatedAt,
          preview: (row: LibraryEntry) => `${row.status ?? 'In library'} · ${dateOnly(row.updatedAt)}`,
          // Addresses only this computer knows are still ways to reach the title.
          combine: (backup: LibraryEntry, local: LibraryEntry) => ({
            ...backup,
            urls: [...new Set([...(backup.urls ?? []), ...(local.urls ?? [])])],
          }),
          commit: ({ next }) => deps.library.replaceEntries(next),
        } satisfies BackupPart<LibraryEntry>,
        {
          id: 'played',
          label: 'sources that played',
          local: () => deps.library.exportPlayedSources(),
          identify: (row: PlayedSource) => (hasString(row, 'key') && isObject(row.source) ? slotOf(row) : null),
          describe: (row: PlayedSource) => episodeLabel(row.origin?.title ?? row.key, row.season, row.episode),
          updatedAt: (row: PlayedSource) => row.playedAt,
          commit: ({ next }) => deps.library.replacePlayedSources(next),
        } satisfies BackupPart<PlayedSource>,
        {
          id: 'sources',
          label: 'remembered source choices',
          local: () => deps.library.exportAll().sources,
          identify: (row: SourceMemory) => (hasString(row, 'key') ? slotOf(row) : null),
          describe: (row: SourceMemory) => row.sourceTitle || row.key,
          updatedAt: (row: SourceMemory) => row.chosenAt,
          commit: ({ next }) => deps.library.replaceSourceMemory(next),
        } satisfies BackupPart<SourceMemory>,
      ],
    },
    {
      id: 'continueWatching',
      label: 'Continue Watching',
      description: 'How far you got in each film and episode.',
      group: 'content',
      schemaVersion: 1,
      parts: [
        {
          id: 'progress',
          label: 'positions',
          local: () => deps.library.exportAll().progress,
          identify: (row: WatchProgress) => (hasString(row, 'key') ? slotOf(row) : null),
          describe: (row: WatchProgress) => episodeLabel(row.title || row.key, row.season, row.episode),
          updatedAt: (row: WatchProgress) => row.updatedAt,
          preview: (row: WatchProgress) =>
            row.completed
              ? 'Finished'
              : `${Math.round((row.positionSeconds / Math.max(1, row.durationSeconds)) * 100)}% watched`,
          commit: ({ next }) => deps.library.replaceProgress(next),
        } satisfies BackupPart<WatchProgress>,
      ],
    },
    {
      id: 'history',
      label: 'Watch history',
      description: 'Everything you played and downloaded, and when.',
      group: 'content',
      schemaVersion: 1,
      parts: [
        {
          id: 'events',
          label: 'events',
          local: () => deps.history.exportAll(),
          identify: (row: HistoryEvent) => (hasString(row, 'id') && hasString(row, 'title') ? row.id : null),
          describe: (row: HistoryEvent) => episodeLabel(row.title, row.season, row.episode),
          updatedAt: (row: HistoryEvent) => row.timestamp,
          commit: ({ next }) => deps.history.replaceAll(next),
        } satisfies BackupPart<HistoryEvent>,
      ],
    },
    {
      id: 'bookmarks',
      label: 'Saved pages',
      description: 'Pages you saved, with their content so they open even when the site is down.',
      group: 'content',
      schemaVersion: 1,
      parts: [
        {
          id: 'pages',
          label: 'saved pages',
          local: () => deps.bookmarks.list(),
          identify: (row: Bookmark) => (hasString(row, 'mediaUrl') ? row.mediaUrl : null),
          describe: (row: Bookmark) => row.title || row.mediaUrl,
          updatedAt: (row: Bookmark) => row.savedAt,
          same: sameExcept<Bookmark>('openCount', 'lastOpenedAt', 'id'),
          preview: (row: Bookmark) => (row.note ? `Note: ${row.note.slice(0, 40)}` : dateOnly(row.savedAt)),
          commit: ({ next }) => deps.bookmarks.replaceAll(next),
        } satisfies BackupPart<Bookmark>,
        {
          id: 'content',
          label: 'page copies',
          local: () => deps.pageSnapshots.list().filter((snapshot) => snapshot.pinned),
          identify: (row: PageSnapshot) => (hasString(row, 'url') && hasString(row, 'title') ? row.url : null),
          describe: (row: PageSnapshot) => row.title,
          updatedAt: (row: PageSnapshot) => row.verifiedAt,
          same: sameExcept<PageSnapshot>('lastUsedAt'),
          commit: ({ next }) => deps.pageSnapshots.replacePinned(next),
        } satisfies BackupPart<PageSnapshot>,
      ],
    },
    {
      id: 'searchHistory',
      label: 'Search history',
      description: 'The searches you typed.',
      group: 'content',
      schemaVersion: 1,
      parts: [
        {
          id: 'queries',
          label: 'searches',
          local: () => deps.searchHistory.list(),
          identify: (row: SearchHistoryEntry) =>
            hasString(row, 'query') ? row.query.trim().toLowerCase() : null,
          describe: (row: SearchHistoryEntry) => row.query,
          updatedAt: (row: SearchHistoryEntry) => row.at,
          same: sameExcept<SearchHistoryEntry>('resultCount'),
          commit: ({ next }) => deps.searchHistory.replaceAll(next),
        } satisfies BackupPart<SearchHistoryEntry>,
      ],
    },
    {
      id: 'savedSearches',
      label: 'Saved searches',
      description: 'Result lists you chose to keep.',
      group: 'content',
      schemaVersion: 1,
      parts: [
        {
          id: 'searches',
          label: 'saved searches',
          local: () => deps.savedSearches.exportAll(),
          identify: (row: SavedSearch) => (hasString(row, 'id') && hasString(row, 'query') ? row.id : null),
          describe: (row: SavedSearch) => row.query,
          updatedAt: (row: SavedSearch) => row.savedAt,
          commit: ({ next }) => deps.savedSearches.replaceAll(next),
        } satisfies BackupPart<SavedSearch>,
      ],
    },
    {
      id: 'downloads',
      label: 'Downloads',
      description:
        'Your download list. Files are not in a backup; each one is checked on this computer and only marked done if it is here.',
      group: 'content',
      schemaVersion: 1,
      parts: [
        {
          id: 'tasks',
          label: 'download records',
          local: () => deps.downloads.getTasks(),
          identify: (row: DownloadTask) =>
            hasString(row, 'id') && hasString(row, 'targetFilePath') && isObject(row.link) ? row.id : null,
          describe: (row: DownloadTask) => episodeLabel(row.parentTitle ?? row.title, row.seasonNumber, row.episodeNumber),
          // This computer's record describes this computer's file; a backup
          // never overwrites it, and a restore never deletes one.
          same: () => true,
          removable: false,
          commit: ({ put }) => {
            const counts = deps.downloads.restoreTasks(put);
            const notes: string[] = [];
            if (counts.verified) notes.push(`${counts.verified} finished download${counts.verified === 1 ? ' was' : 's were'} found on this computer.`);
            if (counts.partial) notes.push(`${counts.partial} partly downloaded — paused, ready to resume.`);
            if (counts.missing) notes.push(`${counts.missing} not on this computer — listed so you can download ${counts.missing === 1 ? 'it' : 'them'} again.`);
            return { notes };
          },
        } satisfies BackupPart<DownloadTask>,
      ],
    },
    {
      id: 'titleOutcomes',
      label: 'Titles with nothing to play',
      description: 'Which titles found no sources last time, so those results stay hidden.',
      group: 'content',
      schemaVersion: 1,
      parts: [
        {
          id: 'outcomes',
          label: 'results',
          local: () => Object.values(deps.titleOutcomes.list()),
          identify: (row: TitleOutcome) => (hasString(row, 'url') && typeof row.at === 'number' ? row.url : null),
          describe: (row: TitleOutcome) => row.url,
          updatedAt: (row: TitleOutcome) => row.at,
          commit: ({ next }) => deps.titleOutcomes.replaceAll(next),
        } satisfies BackupPart<TitleOutcome>,
      ],
    },

    // --- sources and extensions ------------------------------------------
    repositoriesSection(deps),
    extensionsSection(deps),
    switchesSection(deps),
    {
      id: 'indexers',
      label: 'Torrent indexers',
      description: 'Which indexers are on, and your Jackett or Prowlarr connections.',
      group: 'sources',
      schemaVersion: 1,
      parts: [
        {
          id: 'configs',
          label: 'indexers',
          local: () => deps.indexers.getConfigs(),
          identify: (row: IndexerConfig) => (hasString(row, 'id') ? row.id : null),
          describe: (row: IndexerConfig) => row.name || row.id,
          preview: (row: IndexerConfig) => (row.enabled ? 'On' : 'Off') + (row.baseUrl ? ` · ${row.baseUrl}` : ''),
          // A connection carries this machine's host and API key. Merge keeps
          // working credentials rather than overwriting them with another
          // machine's; the failure otherwise is a search that finds nothing.
          mergePrefers: 'local',
          commit: ({ next }) => deps.indexers.saveConfigs(next),
        } satisfies BackupPart<IndexerConfig>,
      ],
    },
    {
      id: 'providerPreferences',
      label: 'Provider rankings',
      description:
        'Providers you always use or never use, and how ranking works. Measurements of this computer are not restored.',
      group: 'sources',
      schemaVersion: 1,
      parts: [
        {
          id: 'preferences',
          label: 'provider choices',
          local: () =>
            Object.entries(deps.providerAnalytics.getPreferences()).map(([provider, preference]) => ({
              provider,
              preference,
            })),
          valid: (row) =>
            hasString(row, 'provider') &&
            ((row as { preference?: unknown }).preference === 'preferred' ||
              (row as { preference?: unknown }).preference === 'blocked'),
          identify: (row: { provider: string }) => (hasString(row, 'provider') ? row.provider : null),
          describe: (row: { provider: string }) => row.provider,
          preview: (row: { preference: ProviderPreference }) =>
            row.preference === 'preferred' ? 'Always use' : 'Never use',
          commit: ({ put, remove }) => {
            for (const provider of remove) deps.providerAnalytics.setPreference(provider, null);
            for (const row of put) deps.providerAnalytics.setPreference(row.provider, row.preference);
          },
        } satisfies BackupPart<{ provider: string; preference: ProviderPreference }>,
        {
          id: 'settings',
          label: 'ranking settings',
          local: () => [{ id: 'settings', ...deps.providerAnalytics.getSettings() }],
          identify: (row: { id: string }) => (row?.id === 'settings' ? 'settings' : null),
          describe: () => 'Ranking settings',
          removable: false,
          commit: ({ put }) => {
            for (const { id: _id, ...settings } of put) deps.providerAnalytics.setSettings(settings);
          },
        } satisfies BackupPart<{ id: string } & AnalyticsSettings>,
      ],
    },

    // --- settings, split by what they are about ---------------------------
    ...DATASTORE_CATEGORIES.map((category) => datastoreSection(deps, category.id)),
  ];
  return sections.sort(byGroup);
}

const GROUP_ORDER = { content: 0, sources: 1, settings: 2 } as const;

/** Stable within a group, so the table above is the order inside each. */
function byGroup(a: BackupSection, b: BackupSection): number {
  return GROUP_ORDER[a.group] - GROUP_ORDER[b.group];
}

function repositoriesSection(deps: BackupSectionDeps): BackupSection {
  const normalise = (url: string) => url.trim().replace(/\/+$/, '');
  return {
    id: 'repositories',
    label: 'Repositories',
    description: 'The extension repositories you added, including your own.',
    group: 'sources',
    schemaVersion: 1,
    parts: [
      {
        id: 'repositories',
        label: 'repositories',
        local: () => deps.plugins.getInstalledRepositories().map((url) => ({ url })),
        identify: (row: { url: string }) => (hasString(row, 'url') ? normalise(row.url) : null),
        describe: (row: { url: string }) => row.url,
        // Removing a repository uninstalls everything it brought. That is not
        // something a restore can give back, so it is never part of one.
        removable: false,
        commit: async ({ put }) => {
          const failed: RestoreFailure[] = [];
          await Promise.all(
            put.map(async ({ url }) => {
              try {
                const added = await deps.plugins.addRepository(url);
                if (!added.ok) failed.push({ label: url, reason: added.message || 'It is no longer available.' });
              } catch (error) {
                failed.push({ label: url, reason: error instanceof Error ? error.message : String(error) });
              }
            })
          );
          return { failed };
        },
      } satisfies BackupPart<{ url: string }>,
    ],
  };
}

function extensionsSection(deps: BackupSectionDeps): BackupSection {
  return {
    id: 'extensions',
    label: 'Extensions',
    description:
      'Which extensions you had, at which version. Missing ones are installed in the background from their repositories.',
    group: 'sources',
    schemaVersion: 1,
    parts: [
      {
        id: 'plugins',
        label: 'extensions',
        local: () =>
          deps.plugins.getInstalledPlugins().map((plugin) => ({
            internalName: plugin.internalName,
            name: plugin.name,
            repositoryUrl: plugin.repositoryUrl ?? '',
            url: plugin.url,
            version: plugin.version,
          })),
        identify: (row: KnownPluginRow) => (hasString(row, 'internalName') ? row.internalName : null),
        describe: (row: KnownPluginRow) => row.name || row.internalName,
        // The version is the only change that means anything here, and it is
        // ordered: a higher version is the newer copy.
        same: (a: KnownPluginRow, b: KnownPluginRow) => (a.version ?? 0) === (b.version ?? 0),
        updatedAt: (row: KnownPluginRow) => row.version ?? 0,
        preview: (row: KnownPluginRow) => `Version ${row.version ?? '?'}`,
        removable: false,
        commit: ({ put }) => restoreExtensions(deps, put),
      } satisfies BackupPart<KnownPluginRow>,
      {
        id: 'origins',
        label: 'provider origins',
        local: () =>
          Object.entries(deps.plugins.exportProviderOrigins()).map(([provider, origin]) => ({
            provider,
            ...origin,
          })),
        identify: (row: { provider: string; internalName: string }) =>
          hasString(row, 'provider') && hasString(row, 'internalName') ? row.provider : null,
        describe: (row: { provider: string }) => row.provider,
        removable: false,
        quiet: true,
        // Bookkeeping: what extension a saved `cs3ext://` address needs.
        commit: ({ put }) => {
          const origins: Record<string, { internalName: string; pluginName: string }> = {};
          for (const row of put) {
            origins[row.provider] = { internalName: row.internalName, pluginName: row.pluginName ?? row.internalName };
          }
          deps.plugins.importProviderOrigins(origins);
        },
      } satisfies BackupPart<{ provider: string; internalName: string; pluginName: string }>,
    ],
  };
}

/**
 * Installs what the backup had and this computer does not, through the same
 * background queue the extensions screen uses — never inline, because that is
 * a download and a DEX translation each. What cannot be found is reported by
 * name; nothing here fails the restore.
 */
async function restoreExtensions(
  deps: BackupSectionDeps,
  rows: KnownPluginRow[]
): Promise<{ failed: RestoreFailure[]; notes: string[]; unchanged: number }> {
  const installed = new Map(deps.plugins.getInstalledPlugins().map((plugin) => [plugin.internalName, plugin]));
  const failed: RestoreFailure[] = [];
  const jobs: ExtensionJobRequest[] = [];
  let unchanged = 0;

  // Known first, so a saved `cs3ext://` page can name what to install even if
  // the install below does not happen.
  deps.plugins.rememberKnownPlugins(rows.filter((row) => row.repositoryUrl));

  const wanted: KnownPluginRow[] = [];
  for (const row of rows) {
    const current = installed.get(row.internalName);
    if (!current) wanted.push(row);
    else if ((row.version ?? 0) > (current.version ?? 0)) jobs.push({ kind: 'update', internalName: row.internalName, name: row.name });
    else unchanged++;
  }

  const byRepository = new Map<string, KnownPluginRow[]>();
  for (const row of wanted) {
    if (!row.repositoryUrl) {
      failed.push({ label: row.name || row.internalName, reason: 'The backup does not say which repository it came from.' });
      continue;
    }
    const list = byRepository.get(row.repositoryUrl) ?? [];
    list.push(row);
    byRepository.set(row.repositoryUrl, list);
  }

  await Promise.all(
    [...byRepository].map(async ([repositoryUrl, list]) => {
      let offered: SitePlugin[];
      try {
        offered = (await deps.plugins.fetchRepository(repositoryUrl, { remember: false })).plugins;
      } catch (error) {
        const reason = `Its repository could not be reached (${error instanceof Error ? error.message : String(error)}).`;
        for (const row of list) failed.push({ label: row.name || row.internalName, reason });
        return;
      }
      const byName = new Map(offered.map((plugin) => [plugin.internalName, plugin]));
      for (const row of list) {
        const plugin = byName.get(row.internalName);
        if (!plugin) {
          failed.push({ label: row.name || row.internalName, reason: 'Its repository no longer offers it.' });
        } else if (isAdultPlugin(plugin) && !deps.isAdultAllowed()) {
          failed.push({ label: row.name || row.internalName, reason: 'Adult content is switched off.' });
        } else {
          jobs.push({ kind: 'install', plugin, repositoryUrl });
        }
      }
    })
  );

  if (jobs.length) deps.enqueueExtensionJobs(jobs);
  const notes = jobs.length
    ? [`${jobs.length} extension${jobs.length === 1 ? ' is' : 's are'} being installed or updated in the background.`]
    : [];
  return { failed, notes, unchanged };
}

type SwitchRow = { kind: 'provider' | 'extension' | 'repository'; name: string };

function switchesSection(deps: BackupSectionDeps): BackupSection {
  const setters: Record<SwitchRow['kind'], (names: string[], enabled: boolean) => unknown> = {
    repository: (names, enabled) => deps.plugins.setRepositoriesEnabled(names, enabled),
    extension: (names, enabled) => deps.plugins.setExtensionsEnabled(names, enabled),
    provider: (names, enabled) => deps.plugins.setProvidersEnabled(names, enabled),
  };
  const kinds = new Set(Object.keys(setters));
  return {
    id: 'extensionSwitches',
    label: 'Sources you switched off',
    description: 'Which repositories, extensions and providers are turned off.',
    group: 'sources',
    schemaVersion: 1,
    parts: [
      {
        id: 'switches',
        label: 'switched-off sources',
        local: () => [
          ...deps.plugins.getDisabledRepositories().map((name) => ({ kind: 'repository' as const, name })),
          ...deps.plugins.getDisabledExtensions().map((name) => ({ kind: 'extension' as const, name })),
          ...deps.plugins.getDisabledProviders().map((name) => ({ kind: 'provider' as const, name })),
        ],
        identify: (row: SwitchRow) => (kinds.has(row?.kind) && hasString(row, 'name') ? `${row.kind}:${row.name}` : null),
        describe: (row: SwitchRow) => `${row.name} (${row.kind})`,
        // A row present means "off". Removing one turns it back on — which is
        // Replace's whole reason to exist here: merge can only ever add
        // exclusions, never undo one.
        commit: ({ put, remove }) => {
          for (const kind of Object.keys(setters) as SwitchRow['kind'][]) {
            const on = remove.filter((key) => key.startsWith(`${kind}:`)).map((key) => key.slice(kind.length + 1));
            const off = put.filter((row) => row.kind === kind).map((row) => row.name);
            if (on.length) setters[kind](on, true);
            if (off.length) setters[kind](off, false);
          }
        },
      } satisfies BackupPart<SwitchRow>,
    ],
  };
}

function datastoreSection(deps: BackupSectionDeps, categoryId: string): BackupSection {
  const category = DATASTORE_CATEGORIES.find((entry) => entry.id === categoryId)!;
  const mine = (row: DatastoreRow) => classifyKey(row.key) === categoryId;
  const part: BackupPart<DatastoreRow> = {
    id: 'entries',
    label: 'settings',
    local: () => deps.datastore.rows().filter(mine),
    valid: (row) => isDatastoreRow(row) && classifyKey(row.key) === categoryId,
    identify: (row) => datastoreRowKey(row),
    describe: (row) => describeKey(row.key),
    same: (a, b) => a.type === b.type && canonical(comparableValue(a)) === canonical(comparableValue(b)),
    preview: (row) => describeValue(row),
    commit: ({ put, remove }) =>
      deps.datastore.writeRows(
        put,
        remove.map((key) => {
          const split = key.indexOf(':');
          return { bucket: key.slice(0, split) as DatastoreRow['bucket'], key: key.slice(split + 1) };
        })
      ),
  };
  return {
    id: categorySectionId(category.id),
    label: category.label,
    description: category.description,
    group: category.group,
    schemaVersion: 1,
    parts: [part],
    // These are read by services that keep them in memory from startup.
    restartAfterRestore: category.id !== 'activity',
    afterRestore:
      category.id === 'contentFilters'
        ? () => {
            // Through the owner, so every surface showing the adult setting
            // hears about it; a bare datastore write would tell nobody.
            deps.adult.setAdultMode(deps.adult.adultMode());
          }
        : undefined,
  };
}
