import { contextBridge, ipcRenderer } from 'electron';
import type { SearchResponse } from '../src/types/api';
import type { DownloadTask } from '../src/types/download';
import type { SitePlugin, PluginCompatibilityReport } from '../src/types/plugin';
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
import type { SourceResponse } from './contentService';
import type { RepositoryFetchResult } from './pluginManager';
import type { StreamHandle } from './torrent/torrentEngine';

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
  searchAll: (query: string) => Promise<Envelope & { results: SearchResponse[] }>;
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

  // Torrent streaming
  startStream: (
    source: TorrentResult,
    season?: number,
    episode?: number
  ) => Promise<Envelope & { handle: StreamHandle | null }>;
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
  revealInFolder: (filePath: string) => Promise<void>;
  onDownloadProgress: (callback: (tasks: DownloadTask[]) => void) => () => void;

  // Binaries
  checkBinaries: () => Promise<{ aria2: boolean; ytdlp: boolean }>;
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

  // Datastore
  getSetting: (key: string, defaultValue?: unknown) => Promise<string>;
  setSetting: (key: string, value: unknown) => Promise<void>;
  getObject: <T>(key: string, defaultValue?: T) => Promise<T>;
  setObject: <T>(key: string, value: T) => Promise<void>;
  importBackup: (filePath: string) => Promise<boolean>;
  exportBackup: () => Promise<string>;
  selectDirectory: () => Promise<string | null>;
}

export type { TorrentFileEntry };

const api: CloudStreamElectronAPI = {
  searchAll: (query) => ipcRenderer.invoke('api:searchAll', query),
  loadMedia: (url) => ipcRenderer.invoke('api:loadMedia', url),
  getSources: (request) => ipcRenderer.invoke('api:getSources', request),
  getPluginRuntimeStatus: () => ipcRenderer.invoke('api:getPluginRuntimeStatus'),

  startStream: (source, season, episode) =>
    ipcRenderer.invoke('torrent:startStream', source, season, episode),
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

  checkBinaries: () => ipcRenderer.invoke('binary:check'),
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

  getSetting: (key, defaultValue) => ipcRenderer.invoke('datastore:getSetting', key, defaultValue),
  setSetting: (key, value) => ipcRenderer.invoke('datastore:setSetting', key, value),
  getObject: (key, defaultValue) => ipcRenderer.invoke('datastore:getObject', key, defaultValue),
  setObject: (key, value) => ipcRenderer.invoke('datastore:setObject', key, value),
  importBackup: (filePath) => ipcRenderer.invoke('datastore:importBackup', filePath),
  exportBackup: () => ipcRenderer.invoke('datastore:exportBackup'),
  selectDirectory: () => ipcRenderer.invoke('dialog:selectDirectory'),
};

contextBridge.exposeInMainWorld('cloudstream', api);
