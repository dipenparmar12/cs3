import { app, BrowserWindow, ipcMain, dialog, Menu } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { DatastoreManager } from './datastore';
import { Aria2Engine } from './aria2Engine';
import { DownloadService } from './downloadService';
import { PluginManager } from './pluginManager';
import { BinaryDownloader } from './binaryDownloader';
import { OFFICIAL_REPOSITORIES } from './officialRepositories';
import type { DownloadTask } from '../src/types/download';
import type { SitePlugin } from '../src/types/plugin';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;

const datastore = new DatastoreManager();
const aria2 = new Aria2Engine();
const downloadService = new DownloadService(datastore, aria2);
const pluginManager = new PluginManager(datastore);
const binaryDownloader = new BinaryDownloader();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'CloudStream 3 Desktop',
    frame: true,
    backgroundColor: '#0c0f17',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  Menu.setApplicationMenu(null);

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
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  downloadService.stop();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// --- IPC Handlers ---

ipcMain.handle('binary:check', async () => {
  return binaryDownloader.checkBinaries();
});

ipcMain.handle('binary:setup', async () => {
  try {
    const aria2Ok = await binaryDownloader.setupAria2();
    const ytdlpOk = await binaryDownloader.setupYtDlp();

    // Re-initialize aria2 engine if binary is now ready
    if (aria2Ok) {
      await aria2.start();
    }

    return {
      success: aria2Ok || ytdlpOk,
      message: aria2Ok ? 'aria2c and yt-dlp engines downloaded & auto-configured successfully!' : 'Binary setup complete.'
    };
  } catch (e: any) {
    return { success: false, message: e.message || 'Failed to setup binaries' };
  }
});

ipcMain.handle('api:searchAll', async (_, query: string) => {
  return await pluginManager.searchAll(query);
});

ipcMain.handle('api:loadMedia', async (_, apiName: string, url: string) => {
  return await pluginManager.loadMedia(apiName, url);
});

ipcMain.handle('api:loadLinks', async (_, apiName: string, url: string) => {
  return await pluginManager.loadLinks(apiName, url);
});

ipcMain.handle('api:getProvidersList', async () => {
  return pluginManager.getProvidersList();
});

ipcMain.handle('download:enqueue', async (_, task: DownloadTask) => {
  return await downloadService.enqueue(task);
});

ipcMain.handle('download:pause', async (_, id: string) => {
  await downloadService.pause(id);
});

ipcMain.handle('download:resume', async (_, id: string) => {
  await downloadService.resume(id);
});

ipcMain.handle('download:remove', async (_, id: string) => {
  await downloadService.remove(id);
});

ipcMain.handle('download:getQueue', async () => {
  return downloadService.getTasks();
});

ipcMain.handle('extension:getOfficialRepositories', async () => {
  return OFFICIAL_REPOSITORIES;
});

ipcMain.handle('extension:fetchRepository', async (_, repoUrl: string) => {
  return await pluginManager.fetchRepository(repoUrl);
});

ipcMain.handle('extension:analyzePlugin', async (_, plugin: SitePlugin) => {
  return pluginManager.analyzePlugin(plugin);
});

ipcMain.handle('extension:installPlugin', async (_, plugin: SitePlugin) => {
  return await pluginManager.installPlugin(plugin);
});

ipcMain.handle('extension:getInstalledRepositories', async () => {
  return pluginManager.getInstalledRepositories();
});

ipcMain.handle('extension:getInstalledPlugins', async () => {
  return pluginManager.getInstalledPlugins();
});

ipcMain.handle('datastore:getSetting', async (_, key: string, defaultValue: any) => {
  return datastore.getString(key, defaultValue, true);
});

ipcMain.handle('datastore:setSetting', async (_, key: string, value: any) => {
  datastore.setString(key, String(value), true);
});

ipcMain.handle('datastore:importBackup', async (_, filePath: string) => {
  return datastore.importBackupFile(filePath);
});

ipcMain.handle('datastore:exportBackup', async () => {
  return datastore.exportBackup();
});

ipcMain.handle('dialog:selectDirectory', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});
