import { contextBridge, ipcRenderer } from 'electron';
import type { SearchResponse, LoadResponse, ExtractorLink } from '../src/types/api';
import type { DownloadTask } from '../src/types/download';
import type { SitePlugin, PluginCompatibilityReport } from '../src/types/plugin';
import type { OfficialRepository } from './officialRepositories';

export interface CloudStreamElectronAPI {
  // Core Media & Providers
  searchAll: (query: string) => Promise<SearchResponse[]>;
  loadMedia: (apiName: string, url: string) => Promise<LoadResponse | null>;
  loadLinks: (apiName: string, url: string) => Promise<ExtractorLink[]>;
  getProvidersList: () => Promise<string[]>;

  // Download Service
  enqueueDownload: (task: DownloadTask) => Promise<string>;
  pauseDownload: (id: string) => Promise<void>;
  resumeDownload: (id: string) => Promise<void>;
  removeDownload: (id: string) => Promise<void>;
  getDownloadQueue: () => Promise<DownloadTask[]>;
  onDownloadProgress: (callback: (tasks: DownloadTask[]) => void) => void;

  // Binary Setup & Auto-Downloader
  checkBinaries: () => Promise<{ aria2: boolean; ytdlp: boolean }>;
  setupBinaries: () => Promise<{ success: boolean; message: string }>;

  // Extensions & Repositories
  getOfficialRepositories: () => Promise<OfficialRepository[]>;
  fetchRepository: (repoUrl: string) => Promise<SitePlugin[]>;
  analyzePlugin: (plugin: SitePlugin) => Promise<PluginCompatibilityReport>;
  installPlugin: (plugin: SitePlugin) => Promise<boolean>;
  getInstalledRepositories: () => Promise<string[]>;
  getInstalledPlugins: () => Promise<SitePlugin[]>;

  // Datastore & Backup
  getSetting: (key: string, defaultValue?: any) => Promise<any>;
  setSetting: (key: string, value: any) => Promise<void>;
  importBackup: (filePath: string) => Promise<boolean>;
  exportBackup: () => Promise<string>;
  selectDirectory: () => Promise<string | null>;
}

const api: CloudStreamElectronAPI = {
  searchAll: (query) => ipcRenderer.invoke('api:searchAll', query),
  loadMedia: (apiName, url) => ipcRenderer.invoke('api:loadMedia', apiName, url),
  loadLinks: (apiName, url) => ipcRenderer.invoke('api:loadLinks', apiName, url),
  getProvidersList: () => ipcRenderer.invoke('api:getProvidersList'),

  enqueueDownload: (task) => ipcRenderer.invoke('download:enqueue', task),
  pauseDownload: (id) => ipcRenderer.invoke('download:pause', id),
  resumeDownload: (id) => ipcRenderer.invoke('download:resume', id),
  removeDownload: (id) => ipcRenderer.invoke('download:remove', id),
  getDownloadQueue: () => ipcRenderer.invoke('download:getQueue'),
  onDownloadProgress: (callback) => {
    ipcRenderer.on('download:progress', (_, tasks) => callback(tasks));
  },

  checkBinaries: () => ipcRenderer.invoke('binary:check'),
  setupBinaries: () => ipcRenderer.invoke('binary:setup'),

  getOfficialRepositories: () => ipcRenderer.invoke('extension:getOfficialRepositories'),
  fetchRepository: (repoUrl) => ipcRenderer.invoke('extension:fetchRepository', repoUrl),
  analyzePlugin: (plugin) => ipcRenderer.invoke('extension:analyzePlugin', plugin),
  installPlugin: (plugin) => ipcRenderer.invoke('extension:installPlugin', plugin),
  getInstalledRepositories: () => ipcRenderer.invoke('extension:getInstalledRepositories'),
  getInstalledPlugins: () => ipcRenderer.invoke('extension:getInstalledPlugins'),

  getSetting: (key, defaultValue) => ipcRenderer.invoke('datastore:getSetting', key, defaultValue),
  setSetting: (key, value) => ipcRenderer.invoke('datastore:setSetting', key, value),
  importBackup: (filePath) => ipcRenderer.invoke('datastore:importBackup', filePath),
  exportBackup: () => ipcRenderer.invoke('datastore:exportBackup'),
  selectDirectory: () => ipcRenderer.invoke('dialog:selectDirectory'),
};

contextBridge.exposeInMainWorld('cloudstream', api);
