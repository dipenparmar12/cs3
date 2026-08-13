import { app, BrowserWindow, ipcMain, dialog, Menu, net, shell } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { DatastoreManager } from './datastore';
import { Aria2Engine } from './aria2Engine';
import { DownloadService } from './downloadService';
import { PluginManager } from './pluginManager';
import type { SearchScope } from './searchScope';
import {
  DNS_PRESETS,
  NetworkSettingsStore,
  type NetworkSettings,
} from './networkSettings';
import { setHttpFetch } from './torrent/http';
import { BinaryDownloader } from './binaryDownloader';
import { OFFICIAL_REPOSITORIES } from './officialRepositories';
import { TorrentEngine } from './torrent/torrentEngine';
import { ContentService, type SourceQuery } from './contentService';
import { PlaybackSessionManager } from './playbackSession';
import { SearchSuggestionService } from './searchSuggestions';
import { SearchHistoryStore } from './searchHistory';
import { SubtitleService } from './subtitleService';
import { AudioTranscoder } from './audioTranscoder';
import { ExtensionUpdater, type UpdateSettings } from './cs3/extensionUpdater';
import { BatchDownloader, type BatchDownloadRequest } from './cs3/batchDownloader';
import { LibraryStore, type WatchStatus } from './cs3/libraryStore';
import type { DownloadTask } from '../src/types/download';
import type { SitePlugin } from '../src/types/plugin';
import type { IndexerConfig, SourcePreferences, TorrentResult } from '../src/types/torrent';
import type { SearchOptions } from '../src/types/api';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;

const datastore = new DatastoreManager();
const aria2 = new Aria2Engine();
const downloadService = new DownloadService(datastore, aria2);
const pluginManager = new PluginManager(datastore);
const binaryDownloader = new BinaryDownloader();
const torrentEngine = new TorrentEngine(
  datastore.getString('torrent_cache_path', '', true) || undefined
);
const contentService = new ContentService(datastore, pluginManager, torrentEngine);
const extensionUpdater = new ExtensionUpdater(datastore, pluginManager);
const batchDownloader = new BatchDownloader(contentService, downloadService);
const libraryStore = new LibraryStore(datastore);
const playbackSessions = new PlaybackSessionManager(contentService);
const searchSuggestions = new SearchSuggestionService();
const searchHistory = new SearchHistoryStore(datastore);
const subtitles = new SubtitleService();
const audioTranscoder = new AudioTranscoder(binaryDownloader);
const network = new NetworkSettingsStore(datastore);

downloadService.setTorrentEngine(torrentEngine);
downloadService.setContentService(contentService);

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: 'CloudStream 3 Desktop',
    backgroundColor: '#0c0f17',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  Menu.setApplicationMenu(null);

  // Register developer keyboard shortcuts (F5, Ctrl+R, F12, Ctrl+Shift+I) so reloads & DevTools always work
  mainWindow.webContents.on('before-input-event', (event, input) => {
    // F5 or Ctrl+R / Cmd+R -> Reload window
    if ((input.key.toLowerCase() === 'r' && (input.control || input.meta)) || input.key === 'F5') {
      if (input.shift) {
        mainWindow?.webContents.reloadIgnoringCache();
      } else {
        mainWindow?.webContents.reload();
      }
      event.preventDefault();
    }
    // F12 or Ctrl+Shift+I / Cmd+Option+I -> Toggle Chromium DevTools
    if (input.key === 'F12' || (input.key.toLowerCase() === 'i' && (input.control || input.meta) && input.shift)) {
      mainWindow?.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  // External links open in the system browser, never in-app (SEC-7 / DSK-36).
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  /**
   * Main-process scraping moves onto Chromium's network stack.
   *
   * Two things depend on this. `app.configureHostResolver` — and therefore the
   * whole DNS setting — reaches Chromium and not Node, so requests issued with
   * Node's `fetch` would ignore it entirely. And the system proxy comes for
   * free, which Node's `fetch` also does not honour.
   */
  setHttpFetch((input, init) => net.fetch(input, init));
  network.apply();

  try {
    await downloadService.start();
  } catch (e) {
    console.warn('DownloadService lazy-start warning:', e);
  }

  downloadService.setProgressCallback((tasks: DownloadTask[]) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('download:progress', tasks);
    }
  });

  createWindow();

  // Extension updates flow from the original Android maintainers straight to the
  // user's install, so a provider fix never waits on an app release.
  extensionUpdater.setNotifier((event, payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('extension:updateEvent', event, payload);
    }
  });
  extensionUpdater.schedule();

  batchDownloader.setNotifier((progress) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('download:batchProgress', progress);
    }
  });

  // The player renders from these snapshots, so they must keep flowing for the
  // whole life of a session — source discovery, failover and switching alike.
  playbackSessions.setNotifier((snapshot) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('playback:update', snapshot);
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  downloadService.stop();
  extensionUpdater.stop();
  // The sidecar is a child process; leaving it running would orphan a JVM.
  pluginManager.shutdown();
  if (process.platform !== 'darwin') app.quit();
});

// The torrent client holds sockets and file handles; tearing it down cleanly
// prevents a zombie process and a locked cache directory on next launch.
app.on('before-quit', async (event) => {
  if (!torrentEngine) return;
  event.preventDefault();
  try {
    // Owns child processes and a socket, so it has to be torn down explicitly
    // or a killed app leaves orphaned ffmpeg processes behind.
    audioTranscoder.shutdown();
    await torrentEngine.destroy();
  } catch {
    // Shutdown is best-effort; never block quit on it.
  }
  app.exit(0);
});

/** Normalises a thrown value into an IPC-safe result envelope. */
function fail(error: unknown): { ok: false; error: string } {
  return { ok: false, error: error instanceof Error ? error.message : String(error) };
}

// --- content -------------------------------------------------------------

ipcMain.handle('api:searchAll', async (_, query: string, options?: SearchOptions) => {
  try {
    const results = await contentService.search(query, options ?? {});
    // Recorded on success only: a query that failed transport is not something
    // the user asked to remember.
    searchHistory.record(query, results.length);
    return { ok: true, results };
  } catch (error) {
    return { ...fail(error), results: [] };
  }
});

/**
 * Title autocomplete. Called on every debounced keystroke, so it never rejects
 * and never blocks — an empty list is an acceptable answer for a search box.
 */
ipcMain.handle('api:suggest', async (_, query: string) => {
  try {
    return { ok: true, suggestions: await searchSuggestions.suggest(query) };
  } catch (error) {
    return { ...fail(error), suggestions: [] };
  }
});

ipcMain.handle(
  'subtitles:search',
  async (_, imdbId: string, season?: number, episode?: number) => {
    try {
      return { ok: true, results: await subtitles.search(imdbId, season, episode) };
    } catch (error) {
      return { ...fail(error), results: [] };
    }
  }
);

/**
 * Fetches one subtitle as WebVTT text.
 *
 * The renderer cannot fetch these directly — third-party origin, and the files
 * are SubRip, which `<track>` rejects. Conversion happens here and the renderer
 * turns the returned text into a blob URL.
 */
ipcMain.handle('subtitles:fetch', async (_, url: string) => {
  try {
    return { ok: true, vtt: await subtitles.fetchAsVtt(url) };
  } catch (error) {
    return { ...fail(error), vtt: '' };
  }
});

ipcMain.handle('api:getSearchHistory', async () => searchHistory.list());

ipcMain.handle('api:removeSearchHistory', async (_, query: string) =>
  searchHistory.remove(query)
);

ipcMain.handle('api:clearSearchHistory', async () => searchHistory.clear());

ipcMain.handle('api:loadMedia', async (_, url: string) => {
  try {
    return { ok: true, detail: await contentService.load(url) };
  } catch (error) {
    return { ...fail(error), detail: null };
  }
});

ipcMain.handle('api:getSources', async (_, request: SourceQuery) => {
  try {
    return { ok: true, ...(await contentService.getSources(request)) };
  } catch (error) {
    return {
      ...fail(error),
      sources: [],
      filtered: [],
      indexerOutcomes: [],
      query: { title: '' },
    };
  }
});

ipcMain.handle('api:getPluginRuntimeStatus', async () => pluginManager.getRuntimeStatus());

ipcMain.handle('extension:getRuntimeReport', async (_, internalName: string) =>
  pluginManager.getRuntimeReport(internalName)
);

// --- torrent streaming ---------------------------------------------------

ipcMain.handle(
  'torrent:startStream',
  async (_, source: TorrentResult, season?: number, episode?: number) => {
    try {
      return { ok: true, handle: await contentService.startStream(source, season, episode) };
    } catch (error) {
      return { ...fail(error), handle: null };
    }
  }
);

// Automatic start: tries the ranked sources in order until one actually
// delivers bytes. This is what "next episode" and "play" use, so a dead swarm
// costs a few seconds rather than dead-ending the viewer on a black screen.
ipcMain.handle(
  'torrent:startBestStream',
  async (_, sources: TorrentResult[], season?: number, episode?: number) => {
    try {
      return { ok: true, ...(await contentService.startBestStream(sources, season, episode)) };
    } catch (error) {
      return { ...fail(error), handle: null, source: null, attempts: [] };
    }
  }
);

ipcMain.handle('torrent:autoPlay', async (_, request: SourceQuery) => {
  try {
    return { ok: true, ...(await contentService.autoPlay(request)) };
  } catch (error) {
    return { ...fail(error), handle: null, source: null, attempts: [], query: null };
  }
});

/**
 * Opens a playback session and returns immediately.
 *
 * The renderer shows the player on this return, not on a stream being ready;
 * everything after this point arrives as `playback:update` snapshots.
 */
ipcMain.handle(
  'playback:start',
  async (_, request: SourceQuery, title: string, episodeTitle?: string) => {
    try {
      return { ok: true, snapshot: playbackSessions.start(request, title, episodeTitle) };
    } catch (error) {
      return { ...fail(error), snapshot: null };
    }
  }
);

ipcMain.handle('playback:playNow', async (_, sessionId: string) => {
  try {
    return { ok: true, snapshot: await playbackSessions.playNow(sessionId) };
  } catch (error) {
    return { ...fail(error), snapshot: null };
  }
});

ipcMain.handle('playback:selectSource', async (_, sessionId: string, infoHash: string) => {
  try {
    return { ok: true, snapshot: await playbackSessions.selectSource(sessionId, infoHash) };
  } catch (error) {
    return { ...fail(error), snapshot: null };
  }
});

ipcMain.handle('playback:refreshSources', async (_, sessionId: string) => {
  try {
    return { ok: true, snapshot: await playbackSessions.refresh(sessionId) };
  } catch (error) {
    return { ...fail(error), snapshot: null };
  }
});

ipcMain.handle('playback:stop', async (_, sessionId: string, keepFiles?: boolean) => {
  try {
    await playbackSessions.stop(sessionId, keepFiles ?? true);
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
});

// --- audio compatibility ---------------------------------------------------

/**
 * Inspects a stream's audio tracks and reports which the player can decode.
 *
 * Called before playback so the UI can name the tracks — including ones
 * Chromium cannot decode, which a `<video>` element does not expose at all.
 */
ipcMain.handle('audio:probe', async (_, url: string) => {
  try {
    if (!audioTranscoder.isAvailable()) {
      return {
        ok: false,
        probe: null,
        error:
          'Media components are not installed, so audio tracks cannot be inspected. ' +
          'Install them from Settings to enable audio for all formats.',
        needsComponents: true,
      };
    }
    return { ok: true, probe: await audioTranscoder.probe(url), needsComponents: false };
  } catch (error) {
    return { ...fail(error), probe: null, needsComponents: false };
  }
});

ipcMain.handle('audio:openTranscode', async (_, url: string, audioIndex: number) => {
  try {
    const streamUrl = await audioTranscoder.createSession(url, audioIndex);
    if (!streamUrl) {
      return { ok: false, url: null, error: 'Media components are not installed.' };
    }
    return { ok: true, url: streamUrl };
  } catch (error) {
    return { ...fail(error), url: null };
  }
});

ipcMain.handle('audio:closeTranscode', async (_, token: string) => {
  audioTranscoder.closeSession(token);
  return { ok: true };
});

ipcMain.handle('sources:getCacheStats', async () => contentService.getCache().stats());

ipcMain.handle('sources:clearCache', async () => {
  contentService.getCache().clear();
  return { ok: true };
});

ipcMain.handle('torrent:getStats', async (_, infoHash: string) =>
  torrentEngine.getStats(infoHash)
);

ipcMain.handle('torrent:selectFile', async (_, infoHash: string, fileIndex: number) =>
  torrentEngine.selectFile(infoHash, fileIndex)
);

ipcMain.handle('torrent:stopStream', async (_, infoHash: string, keepFiles?: boolean) => {
  await torrentEngine.stopStream(infoHash, keepFiles ?? false);
});

ipcMain.handle('torrent:getActiveStreams', async () => torrentEngine.getActiveStreams());

ipcMain.handle('torrent:clearCache', async () => {
  try {
    return { ok: true, removed: await torrentEngine.clearCache() };
  } catch (error) {
    return { ...fail(error), removed: 0 };
  }
});

ipcMain.handle('torrent:getCachePath', async () => torrentEngine.getCachePath());

// --- indexers and source preferences -------------------------------------

ipcMain.handle('indexer:getConfigs', async () => contentService.getRegistry().getConfigs());

ipcMain.handle('indexer:saveConfig', async (_, config: IndexerConfig) => {
  contentService.getRegistry().upsertConfig(config);
  return contentService.getRegistry().getConfigs();
});

ipcMain.handle('indexer:removeConfig', async (_, id: string) => {
  contentService.getRegistry().removeConfig(id);
  return contentService.getRegistry().getConfigs();
});

ipcMain.handle('indexer:test', async (_, config: IndexerConfig) =>
  contentService.getRegistry().testIndexer(config)
);

ipcMain.handle('indexer:getHealth', async () => contentService.getRegistry().getHealth());

ipcMain.handle('sources:getPreferences', async () => contentService.getPreferences());

ipcMain.handle('sources:savePreferences', async (_, prefs: Partial<SourcePreferences>) =>
  contentService.savePreferences(prefs)
);

// --- downloads -----------------------------------------------------------

ipcMain.handle('download:enqueue', async (_, task: DownloadTask) => downloadService.enqueue(task));
ipcMain.handle('download:pause', async (_, id: string) => downloadService.pause(id));
ipcMain.handle('download:resume', async (_, id: string) => downloadService.resume(id));
ipcMain.handle('download:remove', async (_, id: string) => downloadService.remove(id));
ipcMain.handle('download:getQueue', async () => downloadService.getTasks());

// Season and series downloads. Resolution runs here rather than in the
// renderer so a long season survives the user navigating away mid-run.
ipcMain.handle('download:startBatch', async (_, request: BatchDownloadRequest) => {
  try {
    return { ok: true, progress: await batchDownloader.start(request) };
  } catch (error) {
    return { ...fail(error), progress: null };
  }
});

ipcMain.handle('download:cancelBatch', async (_, batchId: string) =>
  batchDownloader.cancel(batchId)
);

ipcMain.handle('download:getActiveBatches', async () => batchDownloader.getActive());

ipcMain.handle('download:revealInFolder', async (_, filePath: string) => {
  shell.showItemInFolder(filePath);
});

// --- binaries ------------------------------------------------------------

ipcMain.handle('binary:check', async () => binaryDownloader.checkBinaries());

/**
 * One-click FFmpeg. Progress is pushed so a ~100 MB download can show its
 * state rather than freezing a dialog.
 */
ipcMain.handle('binary:setupFfmpeg', async () => {
  try {
    const ok = await binaryDownloader.setupFfmpeg((status, percent) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('binary:setupProgress', { status, percent });
      }
    });
    return {
      ok,
      message: ok
        ? 'Media components are installed.'
        : 'The media components could not be installed.',
    };
  } catch (error) {
    return { ...fail(error), message: 'The media components could not be installed.' };
  }
});

ipcMain.handle('binary:setup', async () => {
  try {
    const aria2Ok = await binaryDownloader.setupAria2();
    const ytdlpOk = await binaryDownloader.setupYtDlp();
    if (aria2Ok) await aria2.start();

    return {
      success: aria2Ok || ytdlpOk,
      message: aria2Ok
        ? 'aria2c and yt-dlp downloaded and configured.'
        : ytdlpOk
          ? 'yt-dlp configured; aria2c setup failed.'
          : 'Binary setup failed.',
    };
  } catch (e: any) {
    return { success: false, message: e?.message || 'Failed to set up binaries' };
  }
});

// --- extensions ----------------------------------------------------------

ipcMain.handle('extension:getOfficialRepositories', async () => OFFICIAL_REPOSITORIES);

ipcMain.handle('extension:fetchRepository', async (_, repoUrl: string) => {
  try {
    return { ok: true, repository: await pluginManager.fetchRepository(repoUrl) };
  } catch (error) {
    return { ...fail(error), repository: null };
  }
});

ipcMain.handle('extension:analyzePlugin', async (_, plugin: SitePlugin) =>
  pluginManager.analyzePlugin(plugin)
);

ipcMain.handle('extension:installPlugin', async (_, plugin: SitePlugin, repoUrl?: string) =>
  pluginManager.installPlugin(plugin, repoUrl)
);

ipcMain.handle('extension:uninstallPlugin', async (_, internalName: string) =>
  pluginManager.uninstallPlugin(internalName)
);

ipcMain.handle('extension:getInstalledRepositories', async () =>
  pluginManager.getInstalledRepositories()
);

ipcMain.handle('extension:removeRepository', async (_, repoUrl: string) => {
  pluginManager.removeRepository(repoUrl);
  return pluginManager.getInstalledRepositories();
});

ipcMain.handle('extension:getInstalledPlugins', async () => pluginManager.getInstalledPlugins());

// --- provider selection ---------------------------------------------------

/**
 * Loads plugins if needed so the provider list is real rather than empty.
 *
 * One `.cs3` commonly registers several providers, and which ones it registers
 * is only knowable by running its `load()`. There is no manifest to read them
 * from — so the list cannot be built without loading.
 */
ipcMain.handle('extension:getProviders', async () => {
  try {
    await pluginManager.loadProviders();
    return {
      ok: true,
      providers: pluginManager.getProviders(),
      disabled: pluginManager.getDisabledProviders(),
    };
  } catch (error) {
    return { ...fail(error), providers: [], disabled: [] };
  }
});

ipcMain.handle(
  'extension:setProviderEnabled',
  async (_, name: string, enabled: boolean) => pluginManager.setProviderEnabled(name, enabled)
);

/** Bulk toggle, so "enable this whole repository" is one call not twenty. */
ipcMain.handle(
  'extension:setProvidersEnabled',
  async (_, names: string[], enabled: boolean) => pluginManager.setProvidersEnabled(names, enabled)
);

// --- search scope ---------------------------------------------------------

/**
 * Everything the scope picker needs to draw itself, in one call.
 *
 * Loading plugins is part of it, for the same reason `extension:getProviders`
 * does: which providers an archive registers is only knowable by running it.
 * The picker opening is a good moment to pay that cost, and it is paid once.
 */
ipcMain.handle('search:getScopeOptions', async () => {
  try {
    await pluginManager.loadProviders();
    return {
      ok: true,
      repositories: pluginManager.getProviderTree(),
      disabledProviders: pluginManager.getDisabledProviders(),
      indexers: contentService
        .getRegistry()
        .getConfigs()
        .filter((config) => config.enabled)
        .map((config) => ({ id: config.id, name: config.name })),
      scope: contentService.getScope().get(),
    };
  } catch (error) {
    return {
      ...fail(error),
      repositories: [],
      disabledProviders: [],
      indexers: [],
      scope: { providers: [], indexers: [] },
    };
  }
});

ipcMain.handle('search:setScope', async (_, scope: Partial<SearchScope>) =>
  contentService.getScope().set(scope)
);

// --- network / DNS --------------------------------------------------------

ipcMain.handle('network:get', async () => ({
  settings: network.get(),
  presets: DNS_PRESETS,
}));

ipcMain.handle('network:set', async (_, settings: Partial<NetworkSettings>) =>
  network.set(settings)
);

ipcMain.handle('network:reset', async () => network.reset());

/**
 * Answers "can this machine actually reach the sites the app needs".
 *
 * Deliberately tests the real indexer hosts rather than a generic connectivity
 * endpoint: the failure being diagnosed is selective, and a machine that can
 * reach example.com while every torrent site is blocked is exactly the case
 * this setting exists for. Reporting per-host is what makes the difference
 * between "no internet" and "your ISP blocks these" visible.
 */
ipcMain.handle('network:test', async () => {
  const hosts = [
    { name: 'Torrentio', url: 'https://torrentio.strem.fun/manifest.json' },
    { name: 'Cinemeta', url: 'https://v3-cinemeta.strem.io/manifest.json' },
    { name: 'Knaben', url: 'https://knaben.eu/' },
    { name: 'The Pirate Bay API', url: 'https://apibay.org/precompiled/data_top100_recent.json' },
    { name: '1337x', url: 'https://1337x.to/' },
  ];

  const results = await Promise.all(
    hosts.map(async (host) => {
      const started = Date.now();
      try {
        const response = await net.fetch(host.url, {
          method: 'GET',
          signal: AbortSignal.timeout(8_000),
        });
        return {
          name: host.name,
          ok: true,
          status: response.status,
          latencyMs: Date.now() - started,
        };
      } catch (error) {
        return {
          name: host.name,
          ok: false,
          latencyMs: Date.now() - started,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    })
  );

  return { ok: true, results, dnsMode: network.get().dnsMode };
});

// --- extension updates (over-the-air) ------------------------------------

ipcMain.handle('extension:checkUpdates', async () => {
  try {
    return { ok: true, result: await extensionUpdater.checkForUpdates() };
  } catch (error) {
    return { ...fail(error), result: null };
  }
});

ipcMain.handle('extension:getCachedUpdates', async () => extensionUpdater.getCachedUpdates());

ipcMain.handle('extension:update', async (_, internalName: string) =>
  extensionUpdater.updatePlugin(internalName)
);

ipcMain.handle('extension:updateAll', async (_, internalNames?: string[]) =>
  extensionUpdater.updateAll(internalNames)
);

ipcMain.handle('extension:getUpdateSettings', async () => extensionUpdater.getSettings());

ipcMain.handle('extension:saveUpdateSettings', async (_, patch: Partial<UpdateSettings>) =>
  extensionUpdater.saveSettings(patch)
);

// --- library, watch progress and source memory ---------------------------

ipcMain.handle('library:getEntries', async (_, status?: WatchStatus) =>
  libraryStore.getEntries(status)
);

ipcMain.handle('library:upsertEntry', async (_, input: Parameters<LibraryStore['upsertEntry']>[0]) =>
  libraryStore.upsertEntry(input)
);

ipcMain.handle('library:setStatus', async (_, key: string, status: WatchStatus) =>
  libraryStore.setStatus(key, status)
);

ipcMain.handle('library:setUserRating', async (_, key: string, rating?: number) =>
  libraryStore.setUserRating(key, rating)
);

ipcMain.handle('library:removeEntry', async (_, key: string) => libraryStore.removeEntry(key));

ipcMain.handle('library:getEntryForUrl', async (_, mediaUrl: string) =>
  libraryStore.getEntryForUrl(mediaUrl)
);

ipcMain.handle(
  'library:recordProgress',
  async (_, input: Parameters<LibraryStore['recordProgress']>[0]) =>
    libraryStore.recordProgress(input)
);

ipcMain.handle('library:getProgressForKey', async (_, key: string) =>
  libraryStore.getProgressForKey(key)
);

ipcMain.handle('library:getContinueWatching', async (_, limit?: number) =>
  libraryStore.getContinueWatching(limit)
);

ipcMain.handle('library:clearProgress', async (_, key: string, season?: number, episode?: number) =>
  libraryStore.clearProgress(key, season, episode)
);

ipcMain.handle('library:rememberSource', async (_, input: Parameters<LibraryStore['rememberSource']>[0]) => {
  libraryStore.rememberSource(input);
});

ipcMain.handle('library:recallSource', async (_, key: string, season?: number, episode?: number) =>
  libraryStore.recallSource(key, season, episode)
);

ipcMain.handle('library:export', async () => libraryStore.exportAll());

ipcMain.handle('library:import', async (_, payload: Parameters<LibraryStore['importAll']>[0]) =>
  libraryStore.importAll(payload)
);

// --- datastore -----------------------------------------------------------

ipcMain.handle('datastore:getSetting', async (_, key: string, defaultValue: any) =>
  datastore.getString(key, defaultValue, true)
);

ipcMain.handle('datastore:setSetting', async (_, key: string, value: any) => {
  datastore.setString(key, String(value), true);
});

ipcMain.handle('datastore:getObject', async (_, key: string, defaultValue: any) =>
  datastore.getObject(key, defaultValue)
);

ipcMain.handle('datastore:setObject', async (_, key: string, value: any) => {
  datastore.setObject(key, value);
});

ipcMain.handle('datastore:importBackup', async (_, filePath: string) =>
  datastore.importBackupFile(filePath)
);

ipcMain.handle('datastore:exportBackup', async () => datastore.exportBackup());

ipcMain.handle('dialog:selectDirectory', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
});

ipcMain.handle('app:reload', async () => {
  mainWindow?.webContents.reload();
});

ipcMain.handle('app:relaunch', async () => {
  app.relaunch();
  app.exit(0);
});
