import { app, BrowserWindow, ipcMain, dialog, Menu, shell } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { DatastoreManager } from './datastore';
import { Aria2Engine } from './aria2Engine';
import { DownloadService } from './downloadService';
import { PluginManager } from './pluginManager';
import { BinaryDownloader } from './binaryDownloader';
import { OFFICIAL_REPOSITORIES } from './officialRepositories';
import { TorrentEngine } from './torrent/torrentEngine';
import { ContentService, type SourceQuery } from './contentService';
import type { DownloadTask } from '../src/types/download';
import type { SitePlugin } from '../src/types/plugin';
import type { IndexerConfig, SourcePreferences, TorrentResult } from '../src/types/torrent';

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

downloadService.setTorrentEngine(torrentEngine);

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
    },
  });

  Menu.setApplicationMenu(null);
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

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  downloadService.stop();
  if (process.platform !== 'darwin') app.quit();
});

// The torrent client holds sockets and file handles; tearing it down cleanly
// prevents a zombie process and a locked cache directory on next launch.
app.on('before-quit', async (event) => {
  if (!torrentEngine) return;
  event.preventDefault();
  try {
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

ipcMain.handle('api:searchAll', async (_, query: string) => {
  try {
    return { ok: true, results: await contentService.search(query) };
  } catch (error) {
    return { ...fail(error), results: [] };
  }
});

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

ipcMain.handle('download:revealInFolder', async (_, filePath: string) => {
  shell.showItemInFolder(filePath);
});

// --- binaries ------------------------------------------------------------

ipcMain.handle('binary:check', async () => binaryDownloader.checkBinaries());

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
