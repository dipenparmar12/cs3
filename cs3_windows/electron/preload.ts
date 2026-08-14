import { contextBridge, ipcRenderer } from 'electron';
import type {
  SearchHistoryEntry,
  SearchOptions,
  SearchResponse,
  SearchSuggestion,
} from '../src/types/api';
import type { DownloadTask } from '../src/types/download';
import type { SitePlugin, PluginCompatibilityReport, ProviderTreeRepository } from '../src/types/plugin';
import type {
  IndexerConfig,
  IndexerHealth,
  SourcePreferences,
  TorrentFileEntry,
  TorrentResult,
  TorrentStreamStats,
} from '../src/types/torrent';
import type { OfficialRepository } from './officialRepositories';
import type { MetadataDetail } from './metadataProvider';
import type { SourceResponse, StreamAttempt } from './contentService';
import type {
  ExtensionProvider,
  RepositoryFetchResult,
} from './pluginManager';
import type { SearchScope } from './searchScope';
import type { SearchSnapshot } from './searchSession';
import type { DnsPreset, NetworkSettings } from './networkSettings';
import type {
  AvailableUpdate,
  UpdateCheckResult,
  UpdateOutcome,
  UpdateSettings,
} from './cs3/extensionUpdater';
import type { BatchDownloadRequest, BatchProgress } from './cs3/batchDownloader';
import type { BootstrapProgress } from './cs3/bootstrap';
import type { TitleOutcome, TitleOutcomeKind } from './cs3/titleOutcomes';
import type { DiagnosticRecord, DiagnosticStage } from './cs3/diagnostics';
import type {
  LibraryEntry,
  SourceMemory,
  WatchProgress,
  WatchStatus,
} from './cs3/libraryStore';
import type { StreamHandle } from './torrent/torrentEngine';
import type { PlaybackSnapshot } from './playbackSession';
import type { SubtitleSearchResult } from './subtitleService';
import type { MediaProbe } from './audioTranscoder';

/**
 * Typed, allow-listed IPC surface (ARCH-2 / SEC-9).
 *
 * Handlers that can fail return an `{ ok, error }` envelope rather than
 * rejecting, so a transport failure surfaces in the UI as a message the user can
 * act on instead of an unhandled rejection in the renderer.
 */

export interface Envelope {
  ok: boolean;
  error?: string;
}

export interface CloudStreamElectronAPI {
  // Content
  searchAll: (
    query: string,
    options?: SearchOptions
  ) => Promise<Envelope & { results: SearchResponse[] }>;

  /**
   * Opens a search and returns its opening snapshot immediately.
   *
   * Push-shaped, like `startPlayback`: results, per-source outcomes and the
   * resolved scope all arrive afterwards through {@link onSearchUpdate}. The
   * search can be abandoned with {@link cancelSearch} once the viewer has found
   * what they wanted, which stops the providers still scraping.
   */
  startSearch: (
    query: string,
    options?: SearchOptions
  ) => Promise<Envelope & { snapshot: SearchSnapshot | null }>;
  cancelSearch: (id: string) => Promise<Envelope & { snapshot: SearchSnapshot | null }>;
  /** Returns an unsubscribe function. */
  onSearchUpdate: (callback: (snapshot: SearchSnapshot) => void) => () => void;
  /**
   * A catalogue row for browsing, not a search.
   *
   * Answers from the metadata catalogues in a few hundred milliseconds instead
   * of waiting on every installed scraper. Pass a provider name to browse that
   * one provider's own library instead.
   */
  browse: (query: string, provider?: string) => Promise<Envelope & { results: SearchResponse[] }>;
  /**
   * What happened last time each title was opened, keyed by URL.
   *
   * `no-sources` is the source's problem and is worth showing on the row;
   * `app-error` is ours, and is shown as such rather than as the title being
   * unavailable — blaming the content for our own bug is how one broken
   * translation pass came to look like a hundred broken providers.
   */
  getTitleOutcomes: () => Promise<Record<string, TitleOutcome>>;

  /**
   * Recorded provider failures, newest first.
   *
   * What makes one of these actionable is the tuple — which provider, on which
   * query, for which item, at what address — not the message, so all of it is
   * kept and `reportDiagnostics` renders it as pasteable text.
   */
  getDiagnostics: (
    limit?: number
  ) => Promise<Envelope & { records: DiagnosticRecord[]; filePath: string }>;
  clearDiagnostics: () => Promise<Envelope>;
  /** Omit `ids` for the whole log; pass them for the one failure on screen. */
  reportDiagnostics: (ids?: string[]) => Promise<Envelope & { text: string }>;
  recordDiagnostic: (entry: {
    level: 'error' | 'warn';
    stage: DiagnosticStage;
    source?: string;
    query?: string;
    title?: string;
    url?: string;
    message: string;
    detail?: string;
  }) => Promise<Envelope>;
  recordTitleOutcome: (
    url: string,
    kind: TitleOutcomeKind,
    reason?: string
  ) => Promise<Envelope>;
  loadMedia: (url: string) => Promise<Envelope & { detail: MetadataDetail | null }>;
  getSources: (request: {
    mediaUrl: string;
    season?: number;
    episode?: number;
    titleOverride?: string;
  }) => Promise<Envelope & SourceResponse>;
  getPluginRuntimeStatus: () => Promise<{
    available: boolean;
    installedCount: number;
    reason: string;
  }>;

  // Search assistance: what the user probably meant, and what they asked before.
  /** Title autocomplete merged across catalogues; tolerant of misspellings. */
  suggestTitles: (
    query: string
  ) => Promise<Envelope & { suggestions: SearchSuggestion[] }>;
  /**
   * Subtitles for what is playing, from both sources that have them.
   *
   * `imdbId` drives the OpenSubtitles lookup. `mediaUrl` is what unlocks the
   * other half: a `cs3ext://` URL lets the provider be asked for the subtitles
   * it published with the stream, which is often the only set that exists for
   * content the catalogues have never heard of.
   */
  searchSubtitles: (
    imdbId: string,
    season?: number,
    episode?: number,
    mediaUrl?: string
  ) => Promise<Envelope & { results: SubtitleSearchResult[] }>;
  /** Downloads one subtitle, already converted from SubRip to WebVTT. */
  fetchSubtitle: (url: string) => Promise<Envelope & { vtt: string }>;

  getSearchHistory: () => Promise<SearchHistoryEntry[]>;
  removeSearchHistory: (query: string) => Promise<SearchHistoryEntry[]>;
  clearSearchHistory: () => Promise<SearchHistoryEntry[]>;

  // Torrent streaming
  startStream: (
    source: TorrentResult,
    season?: number,
    episode?: number
  ) => Promise<Envelope & { handle: StreamHandle | null }>;
  /** Tries ranked sources in order until one produces playable data. */
  startBestStream: (
    sources: TorrentResult[],
    season?: number,
    episode?: number
  ) => Promise<
    Envelope & {
      handle: StreamHandle | null;
      source: TorrentResult | null;
      attempts: StreamAttempt[];
    }
  >;
  /** Finds sources and starts the first that works, in one round trip. */
  autoPlay: (request: {
    mediaUrl: string;
    season?: number;
    episode?: number;
    titleOverride?: string;
  }) => Promise<
    Envelope & {
      handle: StreamHandle | null;
      source: TorrentResult | null;
      attempts: StreamAttempt[];
    }
  >;
  // Playback sessions — the progressive "press play, watch it resolve" flow.
  /** Opens the session; returns as soon as it exists, not when a stream is ready. */
  startPlayback: (
    request: { mediaUrl: string; season?: number; episode?: number; titleOverride?: string },
    title: string,
    episodeTitle?: string
  ) => Promise<Envelope & { snapshot: PlaybackSnapshot | null }>;
  /** Starts the best source found so far instead of waiting for every indexer. */
  playbackPlayNow: (
    sessionId: string
  ) => Promise<Envelope & { snapshot: PlaybackSnapshot | null }>;
  playbackSelectSource: (
    sessionId: string,
    infoHash: string
  ) => Promise<Envelope & { snapshot: PlaybackSnapshot | null }>;
  playbackRefreshSources: (
    sessionId: string
  ) => Promise<Envelope & { snapshot: PlaybackSnapshot | null }>;
  stopPlayback: (sessionId: string, keepFiles?: boolean) => Promise<Envelope>;
  onPlaybackUpdate: (callback: (snapshot: PlaybackSnapshot) => void) => () => void;

  /** Resolved-source cache: how much is stored, and a way to drop it. */
  /** Providers registered by installed extensions, plus which are switched off. */
  /**
   * How many extension providers a search asks at once.
   *
   * Raising it past the machine's core count mostly moves the queue into the
   * sidecar; lowering it helps a slow connection, where every simultaneous
   * scrape contends for the same bandwidth.
   */
  getSearchConcurrency: () => Promise<{ value: number; min: number; max: number; def: number }>;
  setSearchConcurrency: (
    value: number
  ) => Promise<{ value: number; min: number; max: number; def: number }>;

  /** First-run install of the bundled repositories. Returns an unsubscribe fn. */
  getBootstrapProgress: () => Promise<BootstrapProgress>;
  onBootstrapProgress: (callback: (progress: BootstrapProgress) => void) => () => void;
  /**
   * Adult content, off by default. Turning it off hides adult repositories from
   * the catalogue and withdraws every NSFW provider from search immediately.
   */
  getAdultAllowed: () => Promise<boolean>;
  setAdultAllowed: (
    enabled: boolean
  ) => Promise<Envelope & { enabled: boolean; providers: string[] }>;

  getExtensionProviders: () => Promise<
    Envelope & { providers: ExtensionProvider[]; disabled: string[] }
  >;
  setProviderEnabled: (name: string, enabled: boolean) => Promise<string[]>;
  setProvidersEnabled: (names: string[], enabled: boolean) => Promise<string[]>;
  getProviderTree: () => Promise<Envelope & { tree: ProviderTreeRepository[] }>;

  /** The repository → extension → provider tree, plus the current narrowing. */
  /** DNS configuration, and a reachability check against real indexer hosts. */
  getNetworkSettings: () => Promise<{ settings: NetworkSettings; presets: DnsPreset[] }>;
  setNetworkSettings: (settings: Partial<NetworkSettings>) => Promise<NetworkSettings>;
  resetNetworkSettings: () => Promise<NetworkSettings>;
  /** Probes the catalogues and every configured indexer through the DNS setting. */
  testNetwork: () => Promise<{
    ok: boolean;
    dnsMode: NetworkSettings['dnsMode'];
    results: Array<{
      name: string;
      /** `indexer` rows follow the user's own configuration; `catalogue` are fixed. */
      kind: 'catalogue' | 'indexer';
      /** False for an indexer switched off in Settings → Sources. */
      enabled: boolean;
      ok: boolean;
      status?: number;
      latencyMs: number;
      error?: string;
    }>;
  }>;

  getSearchScopeOptions: () => Promise<
    Envelope & {
      repositories: ProviderTreeRepository[];
      disabledProviders: string[];
      indexers: Array<{ id: string; name: string }>;
      scope: SearchScope;
    }
  >;
  setSearchScope: (scope: Partial<SearchScope>) => Promise<SearchScope>;

  /**
   * Inspects a stream's audio tracks. Reports tracks Chromium cannot decode,
   * which a `<video>` element does not expose at all.
   */
  probeAudio: (
    url: string
  ) => Promise<
    Envelope & { probe: MediaProbe | null; needsComponents: boolean }
  >;
  /** Opens a remuxing session and returns a loopback URL with playable audio. */
  openAudioTranscode: (
    url: string,
    audioIndex: number
  ) => Promise<Envelope & { url: string | null }>;
  closeAudioTranscode: (token: string) => Promise<Envelope>;

  getSourceCacheStats: () => Promise<{ entries: number; sources: number }>;
  clearSourceCache: () => Promise<Envelope>;

  getStreamStats: (infoHash: string) => Promise<TorrentStreamStats | null>;
  selectStreamFile: (infoHash: string, fileIndex: number) => Promise<StreamHandle | null>;
  stopStream: (infoHash: string, keepFiles?: boolean) => Promise<void>;
  getActiveStreams: () => Promise<TorrentStreamStats[]>;
  clearTorrentCache: () => Promise<Envelope & { removed: number }>;
  getTorrentCachePath: () => Promise<string>;

  // Indexers and ranking preferences
  getIndexerConfigs: () => Promise<IndexerConfig[]>;
  saveIndexerConfig: (config: IndexerConfig) => Promise<IndexerConfig[]>;
  removeIndexerConfig: (id: string) => Promise<IndexerConfig[]>;
  testIndexer: (config: IndexerConfig) => Promise<{ ok: boolean; message: string }>;
  getIndexerHealth: () => Promise<IndexerHealth[]>;
  getSourcePreferences: () => Promise<SourcePreferences>;
  saveSourcePreferences: (prefs: Partial<SourcePreferences>) => Promise<SourcePreferences>;

  // Downloads
  enqueueDownload: (task: DownloadTask) => Promise<string>;
  pauseDownload: (id: string) => Promise<void>;
  resumeDownload: (id: string) => Promise<void>;
  removeDownload: (id: string) => Promise<void>;
  getDownloadQueue: () => Promise<DownloadTask[]>;
  revealInFolder: (filePath?: string) => Promise<void>;
  onDownloadProgress: (callback: (tasks: DownloadTask[]) => void) => () => void;

  // Season / series batch downloads
  startBatchDownload: (
    request: BatchDownloadRequest
  ) => Promise<Envelope & { progress: BatchProgress | null }>;
  cancelBatchDownload: (batchId: string) => Promise<boolean>;
  getActiveBatches: () => Promise<BatchProgress[]>;
  onBatchProgress: (callback: (progress: BatchProgress) => void) => () => void;

  // Binaries
  checkBinaries: () => Promise<{
    aria2: boolean;
    ytdlp: boolean;
    ffmpeg: boolean;
    ffprobe: boolean;
  }>;
  /** Installs FFmpeg + FFprobe. No PATH or codec configuration is exposed. */
  setupFfmpeg: () => Promise<Envelope & { message: string }>;
  onBinarySetupProgress: (
    callback: (progress: { status: string; percent: number }) => void
  ) => () => void;
  setupBinaries: () => Promise<{ success: boolean; message: string }>;

  // Extensions
  getOfficialRepositories: () => Promise<OfficialRepository[]>;
  fetchRepository: (
    repoUrl: string
  ) => Promise<Envelope & { repository: RepositoryFetchResult | null }>;
  analyzePlugin: (plugin: SitePlugin) => Promise<PluginCompatibilityReport>;
  installPlugin: (
    plugin: SitePlugin,
    repoUrl?: string
  ) => Promise<{ ok: boolean; message: string; report?: PluginCompatibilityReport }>;
  uninstallPlugin: (internalName: string) => Promise<boolean>;
  getInstalledRepositories: () => Promise<string[]>;
  removeRepository: (repoUrl: string) => Promise<string[]>;
  getInstalledPlugins: () => Promise<SitePlugin[]>;

  // Extension updates (over-the-air; independent of app updates)
  checkExtensionUpdates: () => Promise<Envelope & { result: UpdateCheckResult | null }>;
  getCachedExtensionUpdates: () => Promise<AvailableUpdate[]>;
  updateExtension: (internalName: string) => Promise<UpdateOutcome>;
  updateAllExtensions: (internalNames?: string[]) => Promise<UpdateOutcome[]>;
  getUpdateSettings: () => Promise<UpdateSettings>;
  saveUpdateSettings: (patch: Partial<UpdateSettings>) => Promise<UpdateSettings>;
  /** Subscribes to update lifecycle events; returns an unsubscribe function. */
  onExtensionUpdateEvent: (
    callback: (event: string, payload: unknown) => void
  ) => () => void;

  // Library, watch progress and source memory
  getLibraryEntries: (status?: WatchStatus) => Promise<LibraryEntry[]>;
  upsertLibraryEntry: (input: {
    title: string;
    year?: number;
    type?: string;
    posterUrl?: string;
    mediaUrl: string;
    status?: WatchStatus;
  }) => Promise<LibraryEntry>;
  setLibraryStatus: (key: string, status: WatchStatus) => Promise<LibraryEntry | null>;
  setLibraryUserRating: (key: string, rating?: number) => Promise<LibraryEntry | null>;
  removeLibraryEntry: (key: string) => Promise<boolean>;
  getLibraryEntryForUrl: (mediaUrl: string) => Promise<LibraryEntry | null>;
  recordWatchProgress: (input: {
    title: string;
    year?: number;
    mediaUrl: string;
    posterUrl?: string;
    episodeTitle?: string;
    season?: number;
    episode?: number;
    positionSeconds: number;
    durationSeconds: number;
    type?: string;
  }) => Promise<WatchProgress | null>;
  getProgressForKey: (key: string) => Promise<WatchProgress[]>;
  getContinueWatching: (limit?: number) => Promise<WatchProgress[]>;
  clearWatchProgress: (key: string, season?: number, episode?: number) => Promise<boolean>;
  rememberSource: (input: Omit<SourceMemory, 'chosenAt'>) => Promise<void>;
  recallSource: (key: string, season?: number, episode?: number) => Promise<SourceMemory | null>;
  exportLibrary: () => Promise<{
    entries: LibraryEntry[];
    progress: WatchProgress[];
    sources: SourceMemory[];
  }>;
  importLibrary: (payload: {
    entries?: LibraryEntry[];
    progress?: WatchProgress[];
    sources?: SourceMemory[];
  }) => Promise<{ entries: number; progress: number; sources: number }>;

  // Datastore
  getSetting: (key: string, defaultValue?: unknown) => Promise<string>;
  setSetting: (key: string, value: unknown) => Promise<void>;
  getObject: <T>(key: string, defaultValue?: T) => Promise<T>;
  setObject: <T>(key: string, value: T) => Promise<void>;
  importBackup: (filePath: string) => Promise<boolean>;
  exportBackup: () => Promise<string>;
  selectDirectory: () => Promise<string | null>;
  reloadApp: () => Promise<void>;
  relaunchApp: () => Promise<void>;
}

export type { TorrentFileEntry };

const api: CloudStreamElectronAPI = {
  searchAll: (query, options) => ipcRenderer.invoke('api:searchAll', query, options),
  startSearch: (query, options) => ipcRenderer.invoke('search:start', query, options),
  cancelSearch: (id) => ipcRenderer.invoke('search:cancel', id),
  onSearchUpdate: (callback) => {
    const listener = (_: unknown, snapshot: SearchSnapshot) => callback(snapshot);
    ipcRenderer.on('search:update', listener);
    return () => ipcRenderer.removeListener('search:update', listener);
  },
  browse: (query, provider) => ipcRenderer.invoke('api:browse', query, provider),
  getTitleOutcomes: () => ipcRenderer.invoke('api:getTitleOutcomes'),
  getDiagnostics: (limit) => ipcRenderer.invoke('diagnostics:list', limit),
  clearDiagnostics: () => ipcRenderer.invoke('diagnostics:clear'),
  reportDiagnostics: (ids) => ipcRenderer.invoke('diagnostics:report', ids),
  recordDiagnostic: (entry) => ipcRenderer.invoke('diagnostics:record', entry),
  recordTitleOutcome: (url, kind, reason) =>
    ipcRenderer.invoke('api:recordTitleOutcome', url, kind, reason),
  loadMedia: (url) => ipcRenderer.invoke('api:loadMedia', url),
  getSources: (request) => ipcRenderer.invoke('api:getSources', request),
  getPluginRuntimeStatus: () => ipcRenderer.invoke('api:getPluginRuntimeStatus'),

  suggestTitles: (query) => ipcRenderer.invoke('api:suggest', query),
  searchSubtitles: (imdbId, season, episode, mediaUrl) =>
    ipcRenderer.invoke('subtitles:search', imdbId, season, episode, mediaUrl),
  fetchSubtitle: (url) => ipcRenderer.invoke('subtitles:fetch', url),

  getSearchHistory: () => ipcRenderer.invoke('api:getSearchHistory'),
  removeSearchHistory: (query) => ipcRenderer.invoke('api:removeSearchHistory', query),
  clearSearchHistory: () => ipcRenderer.invoke('api:clearSearchHistory'),

  startStream: (source, season, episode) =>
    ipcRenderer.invoke('torrent:startStream', source, season, episode),
  startBestStream: (sources, season, episode) =>
    ipcRenderer.invoke('torrent:startBestStream', sources, season, episode),
  autoPlay: (request) => ipcRenderer.invoke('torrent:autoPlay', request),
  startPlayback: (request, title, episodeTitle) =>
    ipcRenderer.invoke('playback:start', request, title, episodeTitle),
  playbackPlayNow: (sessionId) => ipcRenderer.invoke('playback:playNow', sessionId),
  playbackSelectSource: (sessionId, infoHash) =>
    ipcRenderer.invoke('playback:selectSource', sessionId, infoHash),
  playbackRefreshSources: (sessionId) =>
    ipcRenderer.invoke('playback:refreshSources', sessionId),
  stopPlayback: (sessionId, keepFiles) =>
    ipcRenderer.invoke('playback:stop', sessionId, keepFiles),
  onPlaybackUpdate: (callback) => {
    const listener = (_: unknown, snapshot: PlaybackSnapshot) => callback(snapshot);
    ipcRenderer.on('playback:update', listener);
    return () => ipcRenderer.removeListener('playback:update', listener);
  },

  getSearchConcurrency: () => ipcRenderer.invoke('search:getConcurrency'),
  setSearchConcurrency: (value) => ipcRenderer.invoke('search:setConcurrency', value),

  getBootstrapProgress: () => ipcRenderer.invoke('extension:getBootstrapProgress'),
  onBootstrapProgress: (callback) => {
    const listener = (_: unknown, progress: BootstrapProgress) => callback(progress);
    ipcRenderer.on('extension:bootstrapProgress', listener);
    return () => ipcRenderer.removeListener('extension:bootstrapProgress', listener);
  },
  getAdultAllowed: () => ipcRenderer.invoke('extension:getAdultAllowed'),
  setAdultAllowed: (enabled) => ipcRenderer.invoke('extension:setAdultAllowed', enabled),

  getExtensionProviders: () => ipcRenderer.invoke('extension:getProviders'),
  setProviderEnabled: (name, enabled) =>
    ipcRenderer.invoke('extension:setProviderEnabled', name, enabled),
  setProvidersEnabled: (names: string[], enabled: boolean) =>
    ipcRenderer.invoke('extension:setProvidersEnabled', names, enabled),
  getProviderTree: () => ipcRenderer.invoke('extension:getProviderTree'),
  getNetworkSettings: () => ipcRenderer.invoke('network:get'),
  setNetworkSettings: (settings) => ipcRenderer.invoke('network:set', settings),
  resetNetworkSettings: () => ipcRenderer.invoke('network:reset'),
  testNetwork: () => ipcRenderer.invoke('network:test'),
  getSearchScopeOptions: () => ipcRenderer.invoke('search:getScopeOptions'),
  setSearchScope: (scope) => ipcRenderer.invoke('search:setScope', scope),

  probeAudio: (url) => ipcRenderer.invoke('audio:probe', url),
  openAudioTranscode: (url, audioIndex) =>
    ipcRenderer.invoke('audio:openTranscode', url, audioIndex),
  closeAudioTranscode: (token) => ipcRenderer.invoke('audio:closeTranscode', token),

  getSourceCacheStats: () => ipcRenderer.invoke('sources:getCacheStats'),
  clearSourceCache: () => ipcRenderer.invoke('sources:clearCache'),

  getStreamStats: (infoHash) => ipcRenderer.invoke('torrent:getStats', infoHash),
  selectStreamFile: (infoHash, fileIndex) =>
    ipcRenderer.invoke('torrent:selectFile', infoHash, fileIndex),
  stopStream: (infoHash, keepFiles) =>
    ipcRenderer.invoke('torrent:stopStream', infoHash, keepFiles),
  getActiveStreams: () => ipcRenderer.invoke('torrent:getActiveStreams'),
  clearTorrentCache: () => ipcRenderer.invoke('torrent:clearCache'),
  getTorrentCachePath: () => ipcRenderer.invoke('torrent:getCachePath'),

  getIndexerConfigs: () => ipcRenderer.invoke('indexer:getConfigs'),
  saveIndexerConfig: (config) => ipcRenderer.invoke('indexer:saveConfig', config),
  removeIndexerConfig: (id) => ipcRenderer.invoke('indexer:removeConfig', id),
  testIndexer: (config) => ipcRenderer.invoke('indexer:test', config),
  getIndexerHealth: () => ipcRenderer.invoke('indexer:getHealth'),
  getSourcePreferences: () => ipcRenderer.invoke('sources:getPreferences'),
  saveSourcePreferences: (prefs) => ipcRenderer.invoke('sources:savePreferences', prefs),

  enqueueDownload: (task) => ipcRenderer.invoke('download:enqueue', task),
  pauseDownload: (id) => ipcRenderer.invoke('download:pause', id),
  resumeDownload: (id) => ipcRenderer.invoke('download:resume', id),
  removeDownload: (id) => ipcRenderer.invoke('download:remove', id),
  getDownloadQueue: () => ipcRenderer.invoke('download:getQueue'),
  revealInFolder: (filePath) => ipcRenderer.invoke('download:revealInFolder', filePath),
  onDownloadProgress: (callback) => {
    const listener = (_: unknown, tasks: DownloadTask[]) => callback(tasks);
    ipcRenderer.on('download:progress', listener);
    // Returning a disposer lets React effects clean up; the previous version
    // registered listeners that accumulated on every remount.
    return () => ipcRenderer.removeListener('download:progress', listener);
  },

  startBatchDownload: (request) => ipcRenderer.invoke('download:startBatch', request),
  cancelBatchDownload: (batchId) => ipcRenderer.invoke('download:cancelBatch', batchId),
  getActiveBatches: () => ipcRenderer.invoke('download:getActiveBatches'),
  onBatchProgress: (callback) => {
    const listener = (_: unknown, progress: BatchProgress) => callback(progress);
    ipcRenderer.on('download:batchProgress', listener);
    return () => ipcRenderer.removeListener('download:batchProgress', listener);
  },

  checkBinaries: () => ipcRenderer.invoke('binary:check'),
  setupFfmpeg: () => ipcRenderer.invoke('binary:setupFfmpeg'),
  onBinarySetupProgress: (callback) => {
    const listener = (_: unknown, progress: { status: string; percent: number }) =>
      callback(progress);
    ipcRenderer.on('binary:setupProgress', listener);
    return () => ipcRenderer.removeListener('binary:setupProgress', listener);
  },
  setupBinaries: () => ipcRenderer.invoke('binary:setup'),

  getOfficialRepositories: () => ipcRenderer.invoke('extension:getOfficialRepositories'),
  fetchRepository: (repoUrl) => ipcRenderer.invoke('extension:fetchRepository', repoUrl),
  analyzePlugin: (plugin) => ipcRenderer.invoke('extension:analyzePlugin', plugin),
  installPlugin: (plugin, repoUrl) =>
    ipcRenderer.invoke('extension:installPlugin', plugin, repoUrl),
  uninstallPlugin: (internalName) =>
    ipcRenderer.invoke('extension:uninstallPlugin', internalName),
  getInstalledRepositories: () => ipcRenderer.invoke('extension:getInstalledRepositories'),
  removeRepository: (repoUrl) => ipcRenderer.invoke('extension:removeRepository', repoUrl),
  getInstalledPlugins: () => ipcRenderer.invoke('extension:getInstalledPlugins'),

  checkExtensionUpdates: () => ipcRenderer.invoke('extension:checkUpdates'),
  getCachedExtensionUpdates: () => ipcRenderer.invoke('extension:getCachedUpdates'),
  updateExtension: (internalName) => ipcRenderer.invoke('extension:update', internalName),
  updateAllExtensions: (internalNames) =>
    ipcRenderer.invoke('extension:updateAll', internalNames),
  getUpdateSettings: () => ipcRenderer.invoke('extension:getUpdateSettings'),
  saveUpdateSettings: (patch) => ipcRenderer.invoke('extension:saveUpdateSettings', patch),
  onExtensionUpdateEvent: (callback) => {
    const listener = (_: unknown, event: string, payload: unknown) => callback(event, payload);
    ipcRenderer.on('extension:updateEvent', listener);
    return () => ipcRenderer.removeListener('extension:updateEvent', listener);
  },

  getLibraryEntries: (status) => ipcRenderer.invoke('library:getEntries', status),
  upsertLibraryEntry: (input) => ipcRenderer.invoke('library:upsertEntry', input),
  setLibraryStatus: (key, status) => ipcRenderer.invoke('library:setStatus', key, status),
  setLibraryUserRating: (key, rating) => ipcRenderer.invoke('library:setUserRating', key, rating),
  removeLibraryEntry: (key) => ipcRenderer.invoke('library:removeEntry', key),
  getLibraryEntryForUrl: (mediaUrl) => ipcRenderer.invoke('library:getEntryForUrl', mediaUrl),
  recordWatchProgress: (input) => ipcRenderer.invoke('library:recordProgress', input),
  getProgressForKey: (key) => ipcRenderer.invoke('library:getProgressForKey', key),
  getContinueWatching: (limit) => ipcRenderer.invoke('library:getContinueWatching', limit),
  clearWatchProgress: (key, season, episode) =>
    ipcRenderer.invoke('library:clearProgress', key, season, episode),
  rememberSource: (input) => ipcRenderer.invoke('library:rememberSource', input),
  recallSource: (key, season, episode) =>
    ipcRenderer.invoke('library:recallSource', key, season, episode),
  exportLibrary: () => ipcRenderer.invoke('library:export'),
  importLibrary: (payload) => ipcRenderer.invoke('library:import', payload),

  getSetting: (key, defaultValue) => ipcRenderer.invoke('datastore:getSetting', key, defaultValue),
  setSetting: (key, value) => ipcRenderer.invoke('datastore:setSetting', key, value),
  getObject: (key, defaultValue) => ipcRenderer.invoke('datastore:getObject', key, defaultValue),
  setObject: (key, value) => ipcRenderer.invoke('datastore:setObject', key, value),
  importBackup: (filePath) => ipcRenderer.invoke('datastore:importBackup', filePath),
  exportBackup: () => ipcRenderer.invoke('datastore:exportBackup'),
  selectDirectory: () => ipcRenderer.invoke('dialog:selectDirectory'),
  reloadApp: () => ipcRenderer.invoke('app:reload'),
  relaunchApp: () => ipcRenderer.invoke('app:relaunch'),
};

contextBridge.exposeInMainWorld('cloudstream', api);
