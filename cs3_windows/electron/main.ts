import { app, BrowserWindow, ipcMain, dialog, Menu, net, shell } from 'electron';
import fs from 'fs';
import os from 'os';
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
import { ResilientFetch, classifyNetworkError } from './networkResilience';
import { BinaryDownloader } from './binaryDownloader';
import { TorrentEngine } from './torrent/torrentEngine';
import { ContentService, type SourceQuery } from './contentService';
import { PlaybackSessionManager } from './playbackSession';
import { SearchSuggestionService } from './searchSuggestions';
import { SearchHistoryStore } from './searchHistory';
import { SubtitleService } from './subtitleService';
import { MediaTranscoder, VIDEO_CODEC_PROBES } from './mediaTranscoder';
import { PlaybackEngine } from './media/playbackEngine';
import type {
  PlaybackStreamRequest,
  RendererCapabilities,
} from '../src/types/media';
import { ExtensionUpdater, type UpdateSettings } from './cs3/extensionUpdater';
import { BatchDownloader, type BatchDownloadRequest } from './cs3/batchDownloader';
import { BootstrapService } from './cs3/bootstrap';
import { TitleOutcomeStore, type TitleOutcomeKind } from './cs3/titleOutcomes';
import { DiagnosticsLog } from './cs3/diagnostics';
import { ProviderAnalytics } from './cs3/providerAnalytics';
import { ProviderRanking } from './cs3/providerRanking';
import { ProviderRecommender } from './cs3/providerRecommendations';
import { ExternalPlayerService } from './externalPlayer';
import { LibraryStore, type WatchStatus, canonicalKey, torrentResultToStoredSource } from './cs3/libraryStore';
import { HistoryStore } from './cs3/historyStore';
import { BookmarkStore } from './cs3/bookmarkStore';
import { DiscoveryService } from './cs3/discovery';
import { SourcePrefetcher } from './cs3/sourcePrefetcher';
import { TitleEnricher } from './cs3/titleEnricher';
import type { DownloadTask } from '../src/types/download';
import type { SitePlugin } from '../src/types/plugin';
import type { IndexerConfig, SourcePreferences, TorrentResult } from '../src/types/torrent';
import type { SearchOptions } from '../src/types/api';
import type { HistoryEvent, HistoryFilter } from '../src/types/history';
import type { StoredSource } from '../src/types/library';

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
const historyStore = new HistoryStore(datastore);
const bookmarks = new BookmarkStore(datastore);
const discovery = new DiscoveryService();
const titleEnricher = new TitleEnricher();
/**
 * Warms the source cache while a detail page is being read.
 *
 * Safe to race with Play because `ContentService` shares in-flight discovery —
 * pressing Play during a prefetch joins it rather than starting a second scrape.
 */
const sourcePrefetcher = new SourcePrefetcher(contentService, datastore);
const bootstrap = new BootstrapService(datastore, pluginManager);
const titleOutcomes = new TitleOutcomeStore(datastore);
const diagnostics = new DiagnosticsLog();
const externalPlayers = new ExternalPlayerService();
pluginManager.setDiagnostics(diagnostics);

/**
 * Provider measurement, and the ordering built on it.
 *
 * Two objects rather than one because they answer different questions and have
 * very different lifetimes: the analytics store accumulates for months and is
 * the thing a privacy control has to be able to erase, while the ranking is a
 * pure function of it that any build may compute differently.
 */
const providerAnalytics = new ProviderAnalytics();
const providerRanking = new ProviderRanking(providerAnalytics);
const providerRecommender = new ProviderRecommender(
  providerAnalytics,
  providerRanking,
  pluginManager
);
pluginManager.setAnalytics(providerAnalytics);
contentService.setAnalytics(providerAnalytics);
downloadService.setAnalytics(providerAnalytics);
// Stream failures are otherwise invisible: the request succeeded, and the break
// happens minutes later with nothing watching.
contentService.getProxy().setDiagnostics(diagnostics);
const playbackSessions = new PlaybackSessionManager(contentService);
const searchSuggestions = new SearchSuggestionService();
const searchHistory = new SearchHistoryStore(datastore);
const subtitles = new SubtitleService();
const mediaTranscoder = new MediaTranscoder(binaryDownloader);
mediaTranscoder.setDiagnostics(diagnostics);
const network = new NetworkSettingsStore(datastore);

downloadService.setTorrentEngine(torrentEngine);
downloadService.setContentService(contentService);
downloadService.setHistoryStore(historyStore);

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

/**
 * Retries, backs off, and downgrades HTTP/2 origins to HTTP/1.1.
 *
 * Node's `fetch` is the fallback because undici speaks HTTP/1.1 only, which is
 * exactly the property wanted: an origin whose HTTP/2 frontend is broken is
 * reachable over HTTP/1.1, and no amount of retrying on Chromium's stack gets
 * there. It is a rescue path rather than the default because it bypasses
 * `configureHostResolver`, and therefore the user's DNS setting.
 */
const resilientFetch = new ResilientFetch({
  primary: (input, init) => net.fetch(input, init),
  fallback: (input, init) => fetch(input, init),
  diagnostics,
});
setHttpFetch((input, init) => resilientFetch.fetch(input, init));

/**
 * The Universal Media Compatibility Engine (PRD-37).
 *
 * Constructed here rather than beside the transcoder because it needs
 * `resilientFetch` to sniff manifests: an `.m3u8` served from a `.php` URL and an
 * `.mpd` served as `application/octet-stream` are both routine, and the only
 * reliable classifier is the first few bytes of the body.
 */
const playbackEngine = new PlaybackEngine({
  proxy: contentService.getProxy(),
  transcoder: mediaTranscoder,
  fetchText: async (url, bytes) => {
    try {
      const response = await resilientFetch.fetch(
        url,
        { headers: { Range: `bytes=0-${bytes - 1}` }, signal: AbortSignal.timeout(12_000) },
        { operation: 'manifest-sniff' }
      );
      if (!response.ok && response.status !== 206) return null;
      const text = await response.text();
      return text.slice(0, bytes);
    } catch {
      // A manifest that cannot be read is classified by its URL instead, which
      // is what happened before this existed and is still a usable answer.
      return null;
    }
  },
  describeUnreadable: (url) => describeUnreadableSource(url),
  diagnostics,
});

/**
 * The last line of defence for the main process.
 *
 * A network failure that arrives after its promise has settled has no call site
 * left to catch it. That is not hypothetical — it is the reported crash, and it
 * was reproduced here against an HTTP/2 origin that answers normally and then
 * fails mid-body:
 *
 *     upstream status=200
 *     UNCAUGHT: net::ERR_CONNECTION_CLOSED
 *       at SimpleURLLoaderWrapper.<anonymous> (node:electron/js2c/browser_init:2:138489)
 *       at SimpleURLLoaderWrapper.emit (node:events:509:28)
 *
 * The individual leaks are fixed where they live — `MediaProxy` was the one that
 * mattered — but "we found them all" is not a claim worth betting a viewer's
 * session on. Electron's default handler puts a modal error dialog over the app;
 * for a dropped connection that is a worse outcome than the dropped connection.
 *
 * Scope is deliberately narrow. Only recognisable transport failures are
 * swallowed. Anything else is logged and rethrown, because silently continuing
 * past a genuine bug is how a corrupt datastore gets written.
 */
function installProcessGuards(): void {
  const swallow = (error: unknown, origin: string): boolean => {
    const failure = classifyNetworkError(error);
    if (!failure.code) return false;

    diagnostics.record({
      level: 'warn',
      stage: 'runtime',
      source: 'network',
      message: `Recovered from an unhandled ${failure.code} (${origin})`,
      detail: [
        `code:   ${failure.code}`,
        `raw:    ${failure.message}`,
        `origin: ${origin}`,
        'The request that produced this had already settled, so no caller could',
        'catch it. Playback and downloads were left running.',
        error instanceof Error && error.stack ? `stack:\n${error.stack}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    });
    console.warn(`[network] contained ${failure.code} from ${origin}`);
    return true;
  };

  process.on('uncaughtException', (error) => {
    if (swallow(error, 'uncaughtException')) return;

    // Not ours to swallow. Report it the way Electron would have, and let the
    // default behaviour stand.
    console.error('Uncaught exception in main process:', error);
    diagnostics.record({
      level: 'error',
      stage: 'runtime',
      source: 'main',
      message: error instanceof Error ? error.message : String(error),
      detail: error instanceof Error ? error.stack : undefined,
    });
    diagnostics.flush();
    providerAnalytics.flush();
    throw error;
  });

  process.on('unhandledRejection', (reason) => {
    if (swallow(reason, 'unhandledRejection')) return;
    console.error('Unhandled rejection in main process:', reason);
    diagnostics.record({
      level: 'error',
      stage: 'runtime',
      source: 'main',
      message: reason instanceof Error ? reason.message : String(reason),
      detail: reason instanceof Error ? reason.stack : undefined,
    });
  });
}

installProcessGuards();

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
  setHttpFetch((input, init) => resilientFetch.fetch(input, init));
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

  // Global extension runtime provisioner notifier
  pluginManager.getSidecar().getProvisioner().addProgressListener((progress) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('runtime:progress', progress);
    }
  });

  // Global extension plugin install progress notifier
  pluginManager.onInstallProgress((progress) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('extension:installProgress', progress);
    }
  });

  /**
   * The one-time provider load, reported as it happens.
   *
   * Every screen that lists sources depends on this pass and none of them could
   * see it. The scope picker is the clearest case: it waited on a load that
   * takes minutes, showed nothing while it ran, and gave the impression that
   * the app had no providers at all.
   */
  pluginManager.onProviderLoadProgress((progress) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('extension:providerLoadProgress', progress);
    }
  });

  // Background source loading, so the detail page can say whether Play will be
  // instant rather than leaving the viewer to find out by pressing it.
  sourcePrefetcher.setNotifier((state) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('sources:prefetch', state);
    }
  });

  /**
   * First launch installs the verified repositories in the background.
   *
   * After the window exists, never before it: this downloads and DEX-translates
   * dozens of archives, and none of that may sit in front of the first frame the
   * user sees. It is a no-op on every launch after the first.
   */
  bootstrap.setNotifier((progress) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('extension:bootstrapProgress', progress);
    }
  });
  bootstrap.start();

  /**
   * A stale title refreshed behind the viewer's back reaches them here.
   *
   * Cached metadata is served instantly and refreshed after; without this push
   * the refreshed copy would sit in the cache until the *next* visit, which is
   * the one case the caching was supposed to make unnecessary.
   */
  contentService.setDetailListener((url, detail) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('detail:update', { url, detail });
    }
  });

  // Search results stream in the same way: one snapshot per source that answers.
  contentService.getSearches().setNotifier((snapshot) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('search:update', snapshot);
    }
    // The query was recorded when the search opened; this only fills in how
    // many results it turned out to have. A cancelled search never reached a
    // meaningful count, so its entry keeps the one it already had.
    if (snapshot.done && !snapshot.cancelled && snapshot.query) {
      searchHistory.setResultCount(snapshot.query, snapshot.results.length);
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
    diagnostics.flush();
    providerAnalytics.flush();
    mediaTranscoder.shutdown();
    contentService.shutdown();
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
 * Opens a search and returns immediately.
 *
 * The renderer renders from the returned snapshot, not from a completed search;
 * every source that answers afterwards arrives as a `search:update`. Fifteen
 * extension providers are fifteen independent scrapes, and the slowest of them
 * should not decide when the first result becomes visible.
 */
ipcMain.handle('search:start', async (_, query: string, options?: SearchOptions) => {
  try {
    const snapshot = contentService.startSearch(query, options ?? {});
    /**
     * Recorded now, not when the search finishes.
     *
     * History is an ordering of *when you searched*, and a streaming search
     * finishes seconds later — long after the user has looked at the list and
     * formed an opinion about whether it is in the right order. Recording on
     * completion meant the newest query was missing from the list for as long
     * as the slowest provider took, which reads as the order being random.
     * The result count is filled in by the notifier once it is known.
     */
    searchHistory.record(query);
    return { ok: true, snapshot };
  } catch (error) {
    return { ...fail(error), snapshot: null };
  }
});

ipcMain.handle('search:cancel', async (_, id: string) => {
  try {
    return { ok: true, snapshot: contentService.cancelSearch(id) };
  } catch (error) {
    return { ...fail(error), snapshot: null };
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

/**
 * Subtitles for the thing being played, from both places they come from.
 *
 * OpenSubtitles is keyed by IMDb id, which extension-sourced content routinely
 * does not have — a provider scraped a site, and the site never printed one. But
 * the provider itself frequently *did* offer subtitles: `loadLinks` yields them
 * alongside the links, upstream collects them, and this app was throwing them
 * away. `PluginManager.loadSubtitles` existed and nothing called it, so a film
 * played from an extension had no subtitles available at all even when the
 * provider had handed them over in the same response as the video.
 *
 * Provider subtitles lead: they belong to the exact release being played, where
 * an OpenSubtitles match is for the work in general and may be out of sync.
 */
ipcMain.handle(
  'subtitles:search',
  async (_, imdbIdOrQuery: string, season?: number, episode?: number, mediaUrl?: string) => {
    try {
      const trimmed = imdbIdOrQuery?.trim() ?? '';
      const [fromProvider, fromCatalogue] = await Promise.all([
        mediaUrl?.startsWith('cs3ext://')
          ? pluginManager.loadSubtitles(mediaUrl).catch(() => [])
          : Promise.resolve([]),
        trimmed
          ? (/^tt\d+$/i.test(trimmed)
              ? subtitles.search(trimmed, season, episode).catch(() => [])
              : subtitles.searchByTitle(trimmed, season, episode).then((r) => r.results).catch(() => []))
          : Promise.resolve([]),
      ]);

      const providerResults = fromProvider.map((entry) => ({
        id: `provider:${entry.url}`,
        lang: entry.lang,
        langName: `${entry.lang} (from this provider)`,
        url: entry.url,
      }));

      return { ok: true, results: [...providerResults, ...fromCatalogue] };
    } catch (error) {
      return { ...fail(error), results: [] };
    }
  }
);

/**
 * Searches subtitles by custom movie/series title or IMDb id, returning the matched title and IMDb id.
 */
ipcMain.handle(
  'subtitles:searchByTitle',
  async (_, query: string, season?: number, episode?: number, mediaUrl?: string) => {
    try {
      const trimmed = query?.trim() ?? '';
      if (!trimmed && !mediaUrl?.startsWith('cs3ext://')) {
        return { ok: true, results: [], imdbId: undefined, matchedTitle: undefined };
      }

      const [fromProvider, titleResult] = await Promise.all([
        mediaUrl?.startsWith('cs3ext://')
          ? pluginManager.loadSubtitles(mediaUrl).catch(() => [])
          : Promise.resolve([]),
        trimmed
          ? subtitles
              .searchByTitle(trimmed, season, episode)
              .catch(() => ({ results: [], imdbId: undefined, matchedTitle: undefined }))
          : Promise.resolve({ results: [], imdbId: undefined, matchedTitle: undefined }),
      ]);

      const providerResults = fromProvider.map((entry) => ({
        id: `provider:${entry.url}`,
        lang: entry.lang,
        langName: `${entry.lang} (from this provider)`,
        url: entry.url,
      }));

      return {
        ok: true,
        imdbId: titleResult.imdbId,
        matchedTitle: titleResult.matchedTitle,
        results: [...providerResults, ...titleResult.results],
      };
    } catch (error) {
      return { ...fail(error), results: [], imdbId: undefined, matchedTitle: undefined };
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

// --- diagnostics ----------------------------------------------------------

/**
 * The environment questions every bug report needs answered first.
 *
 * Collected here rather than asked of the user: "which Java" and "which build"
 * are the two things a reporter is least able to find and the two a maintainer
 * asks for immediately.
 */
async function diagnosticsEnvironment(): Promise<Record<string, string>> {
  let runtime = 'unknown';
  try {
    const status = await pluginManager.getRuntimeStatus();
    runtime =
      `available=${status.available} plugins=${status.installedCount}` +
      (status.javaVersion ? ` java=${status.javaVersion}` : '') +
      (status.reason ? ` — ${status.reason}` : '');
  } catch {
    // A runtime that cannot even be queried is itself worth reporting as such.
  }
  return {
    App: app.getVersion(),
    Electron: process.versions.electron ?? 'unknown',
    Node: process.versions.node ?? 'unknown',
    Platform: `${process.platform} ${os.release()}`,
    'Extension runtime': runtime,
    Providers: String(pluginManager.getProvidersList().length),
  };
}

/**
 * Problems by default, everything on request.
 *
 * The log now records successes too, because reproducing a failure needs the
 * session around it — but a panel where every successful search scrolls past
 * the one error is not a debugging tool.
 */
ipcMain.handle(
  'diagnostics:list',
  async (_, limit?: number, levels?: Array<'error' | 'warn' | 'info'>) => ({
    ok: true,
    records: diagnostics.list(limit ?? 200, levels ?? ['error', 'warn']),
    total: diagnostics.all().length,
    filePath: diagnostics.filePath,
  })
);

ipcMain.handle('diagnostics:clear', async () => {
  diagnostics.clear();
  return { ok: true };
});

/**
 * A pasteable report, in one of two sizes.
 *
 * `mode: 'current'` is the one that was missing. Every report used to be the
 * whole session — up to three hundred entries — which is unusable in both
 * directions: whoever receives it has to find the failure being described, and
 * whoever sends it has pasted their entire evening's viewing into a chat
 * window without meaning to. Narrowing to the failure on screen is the common
 * case; the full log is for an issue about the app itself.
 *
 * Both are deduplicated, and the full one especially: a provider failing on a
 * loop produces the same line hundreds of times, and an occurrence count says
 * everything the repetition did.
 */
ipcMain.handle(
  'diagnostics:report',
  async (
    _,
    options: {
      ids?: string[];
      mode?: 'current' | 'full';
      context?: Parameters<DiagnosticsLog['selectForContext']>[0];
    } = {}
  ) => {
    try {
      const mode = options.mode ?? 'full';
      const all = diagnostics.all();

      let chosen = all;
      let contextMatched: boolean | undefined;

      if (options.ids?.length) {
        chosen = all.filter((record) => options.ids!.includes(record.id));
      } else if (mode === 'current' && options.context) {
        const selection = diagnostics.selectForContext(options.context);
        chosen = selection.records;
        contextMatched = selection.matched;
      } else {
        // Reports carry everything retained, successes included: the run that
        // worked is the control for the one that did not.
        chosen = all.slice(0, 300);
      }

      return {
        ok: true,
        text: diagnostics.report(chosen, await diagnosticsEnvironment(), {
          mode,
          context: options.context,
          contextMatched,
        }),
        records: chosen.length,
      };
    } catch (error) {
      return { ...fail(error), text: '', records: 0 };
    }
  }
);

/** Lets the renderer record what only it can see, such as a playback failure. */
ipcMain.handle(
  'diagnostics:record',
  async (_, entry: Parameters<DiagnosticsLog['record']>[0]) => {
    diagnostics.record(entry);
    return { ok: true };
  }
);

/**
 * What happened last time each title was opened.
 *
 * Read once per search rather than per row, so the grid can mark dead entries
 * without a round trip for every poster on screen.
 */
ipcMain.handle('api:getTitleOutcomes', async () => titleOutcomes.list());

ipcMain.handle(
  'api:recordTitleOutcome',
  async (_, url: string, kind: TitleOutcomeKind, reason?: string) => {
    titleOutcomes.record(url, kind, reason);
    return { ok: true };
  }
);

// --- source prefetch ------------------------------------------------------

/**
 * Begins looking for sources for what this page would play.
 *
 * Fire-and-forget on purpose: the caller is a detail page opening, not someone
 * waiting for an answer. Progress arrives on `sources:prefetch` and the results
 * land in the source cache, where Play finds them.
 */
ipcMain.handle('sources:prefetch', async (_, request: SourceQuery) => {
  try {
    sourcePrefetcher.schedule(request);
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
});

ipcMain.handle('sources:cancelPrefetch', async () => {
  sourcePrefetcher.cancel();
  return { ok: true };
});

ipcMain.handle('sources:getPrefetchSetting', async () => ({
  ok: true,
  enabled: sourcePrefetcher.isEnabled(),
}));

ipcMain.handle('sources:setPrefetchSetting', async (_, enabled: boolean) => ({
  ok: true,
  enabled: sourcePrefetcher.setEnabled(enabled),
}));

// --- discovery (the dynamic home screen) ----------------------------------

/**
 * The home screen's sections.
 *
 * Genres are derived from what the user has watched, on this machine, and are
 * used only to choose which public catalogue URL to fetch. Nothing about the
 * user is sent anywhere: the catalogue is asked "what is popular in Horror",
 * not "what should this person watch".
 */
ipcMain.handle('discover:sections', async (_, options?: { includeAnime?: boolean }) => {
  try {
    const genres = topGenresFromHistory();
    const sections = await discovery.sections({
      genres,
      includeAnime: options?.includeAnime,
    });
    return { ok: true, sections, personalGenres: genres };
  } catch (error) {
    return { ...fail(error), sections: [], personalGenres: [] };
  }
});

ipcMain.handle('discover:more', async (_, section: string, skip: number) => {
  try {
    return { ok: true, items: await discovery.more(section as never, skip) };
  } catch (error) {
    return { ...fail(error), items: [] };
  }
});

/** Forces the next fetch to hit the network. The "refresh" button. */
ipcMain.handle('discover:refresh', async () => {
  discovery.invalidate();
  return { ok: true };
});

/**
 * The genres this user actually watches, most-watched first.
 *
 * Read from the library rather than from a preferences screen nobody fills in.
 * Capped at three sections so the home page does not become a list of one
 * genre per film they have ever opened.
 */
function topGenresFromHistory(): string[] {
  try {
    const tally = new Map<string, number>();
    for (const entry of libraryStore.getEntries()) {
      const bookmark = bookmarks.get(entry.urls[0] ?? '');
      for (const genre of bookmark?.genres ?? []) {
        if (!DiscoveryService.GENRES.includes(genre)) continue;
        tally.set(genre, (tally.get(genre) ?? 0) + 1);
      }
    }
    return [...tally.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([genre]) => genre);
  } catch {
    return [];
  }
}

/**
 * Normalises a provider's release name to its catalogue record.
 *
 * Exposed as its own channel rather than folded into search, because the
 * caller decides when it is worth the round trips — a grid of two hundred rows
 * does not want two hundred lookups before it draws anything.
 */
ipcMain.handle(
  'discover:enrich',
  async (_, results: Parameters<TitleEnricher['enrichAll']>[0], limit?: number) => {
    try {
      return { ok: true, results: await titleEnricher.enrichAll(results, { limit }) };
    } catch (error) {
      return { ...fail(error), results };
    }
  }
);

ipcMain.handle(
  'discover:resolveTitle',
  async (_, rawTitle: string, hint?: { type?: never; year?: number }) => {
    try {
      return { ok: true, metadata: await titleEnricher.resolve(rawTitle, hint ?? {}) };
    } catch (error) {
      return { ...fail(error), metadata: null };
    }
  }
);

/**
 * Where a provider came from, for showing on the detail page.
 *
 * A result carries its provider's name and nothing else, so a page could say
 * which site served it and never whose extension or whose repository that was
 * — which is exactly what someone needs when a provider starts returning
 * nothing and they want to know what to turn off.
 */
ipcMain.handle('api:getProviderProvenance', async (_, providerName: string) => {
  try {
    return { ok: true, provenance: pluginManager.provenanceOf(providerName) };
  } catch (error) {
    return { ...fail(error), provenance: { provider: providerName } };
  }
});

// --- saved detail pages (bookmarks) ---------------------------------------

ipcMain.handle('bookmarks:list', async () => ({
  ok: true,
  bookmarks: bookmarks.list(),
  facets: bookmarks.originFacets(),
}));

ipcMain.handle('bookmarks:get', async (_, mediaUrl: string) => ({
  ok: true,
  bookmark: bookmarks.get(mediaUrl),
}));

/**
 * One channel for save and unsave.
 *
 * The control is a single toggle on the page and modelling it as two calls
 * invites the two to disagree — the button reads "Saved" while the store has
 * already dropped it, because one of the pair failed and the UI only checked
 * the other.
 */
ipcMain.handle(
  'bookmarks:toggle',
  async (_, input: Parameters<BookmarkStore['toggle']>[0]) => {
    try {
      return { ok: true, ...bookmarks.toggle(input) };
    } catch (error) {
      return { ...fail(error), saved: false, bookmark: null };
    }
  }
);

ipcMain.handle('bookmarks:remove', async (_, mediaUrl: string) => ({
  ok: true,
  removed: bookmarks.remove(mediaUrl),
}));

ipcMain.handle('bookmarks:setNote', async (_, mediaUrl: string, note?: string) => ({
  ok: true,
  bookmark: bookmarks.setNote(mediaUrl, note),
}));

ipcMain.handle('bookmarks:markOpened', async (_, mediaUrl: string) => {
  bookmarks.markOpened(mediaUrl);
  return { ok: true };
});

// --- provider analytics and ranking ---------------------------------------

/**
 * Everything measured, plus the score derived from it.
 *
 * One channel rather than two because the UI never wants one without the
 * other: a score with no counters behind it cannot be argued with, and
 * counters with no score are a spreadsheet.
 */
ipcMain.handle('analytics:getLeaderboard', async () => {
  try {
    return {
      ok: true,
      scores: providerRecommender.leaderboard(),
      records: providerAnalytics.all(),
      settings: providerAnalytics.getSettings(),
      criteria: providerRanking.criteria(),
    };
  } catch (error) {
    return { ...fail(error), scores: [], records: [], criteria: [] };
  }
});

ipcMain.handle('analytics:getRecommendations', async (_, limit?: number) => {
  try {
    return { ok: true, recommendations: providerRecommender.recommendations(limit ?? 20) };
  } catch (error) {
    return { ...fail(error), recommendations: [] };
  }
});

ipcMain.handle('analytics:getSettings', async () => ({
  ok: true,
  settings: providerAnalytics.getSettings(),
  criteria: providerRanking.criteria(),
}));

ipcMain.handle(
  'analytics:setSettings',
  async (_, next: Partial<ReturnType<typeof providerAnalytics.getSettings>>) => {
    try {
      return { ok: true, settings: providerAnalytics.setSettings(next) };
    } catch (error) {
      return { ...fail(error), settings: providerAnalytics.getSettings() };
    }
  }
);

ipcMain.handle('analytics:setWeight', async (_, id: string, weight: number) => {
  try {
    providerRanking.setWeight(id, weight);
    return { ok: true, criteria: providerRanking.criteria() };
  } catch (error) {
    return { ...fail(error), criteria: providerRanking.criteria() };
  }
});

ipcMain.handle('analytics:resetWeights', async () => {
  providerRanking.resetWeights();
  return { ok: true, criteria: providerRanking.criteria() };
});

/**
 * The user's thumb on the scale.
 *
 * Explicit preference outranks every measurement, because these are averages
 * over scrapes of third-party sites and someone who knows their region's best
 * source should not have to out-argue a running total.
 */
ipcMain.handle(
  'analytics:setPreference',
  async (_, provider: string, preference: 'preferred' | 'blocked' | null) => {
    providerAnalytics.setPreference(provider, preference);
    return { ok: true, score: providerRanking.score(provider) };
  }
);

/** The privacy control. Erases the history; the settings survive. */
ipcMain.handle('analytics:reset', async (_, provider?: string) => {
  if (provider) providerAnalytics.resetProvider(provider);
  else providerAnalytics.reset();
  return { ok: true };
});

ipcMain.handle('analytics:applyAutoEnable', async () => {
  try {
    return { ok: true, enabled: providerRecommender.applyAutoEnable() };
  } catch (error) {
    return { ...fail(error), enabled: [] };
  }
});

/**
 * Records an outcome only the renderer can see.
 *
 * Playback is the case this exists for: whether a source actually produced
 * pictures is known to the `<video>` element and to nothing in the main
 * process. Downloads report from the main process directly.
 */
ipcMain.handle(
  'analytics:observe',
  async (
    _,
    input: {
      provider: string;
      stage: 'search' | 'detail' | 'links' | 'playback' | 'download';
      outcome: 'success' | 'empty' | 'failure';
      produced?: number;
      latencyMs?: number;
      error?: string;
    }
  ) => {
    providerAnalytics.observe(input);
    return { ok: true };
  }
);

// --- runtime provisioner ---------------------------------------------------

ipcMain.handle('runtime:getStatus', async () => {
  try {
    const status = pluginManager.getSidecar().getProvisioner().getStatus();
    return { ok: true, ...status };
  } catch (error) {
    return { ...fail(error), ready: false, javaReady: false, sidecarReady: false, bridgeReady: false, isAppManaged: false };
  }
});

ipcMain.handle('runtime:provision', async () => {
  try {
    const provisioner = pluginManager.getSidecar().getProvisioner();
    const ready = await provisioner.provisionRuntime();
    if (ready) {
      await pluginManager.loadProviders().catch((err) => {
        console.warn('[runtime:provision] Post-provision provider load failed:', err);
      });
    }
    return { ok: ready, ready };
  } catch (error) {
    return { ...fail(error), ready: false };
  }
});

ipcMain.handle('runtime:test', async () => {
  try {
    const provisioner = pluginManager.getSidecar().getProvisioner();
    const result = await provisioner.testRuntime();
    return { ...result };
  } catch (error) {
    return { ...fail(error), ok: false };
  }
});

ipcMain.handle('runtime:clean', async () => {
  try {
    const provisioner = pluginManager.getSidecar().getProvisioner();
    return await provisioner.cleanRuntime();
  } catch (error) {
    return { ...fail(error), ok: false };
  }
});

ipcMain.handle('components:getStatus', async () => {
  try {
    const runtime = pluginManager.getSidecar().getProvisioner().getStatus();
    const binaries = binaryDownloader.checkBinaries();
    const mediaReady = Boolean(binaries.ffmpeg && binaries.ffprobe);
    const downloadReady = Boolean(binaries.aria2 && binaries.ytdlp);
    const runtimeReady = Boolean(runtime.ready);

    let missingCount = 0;
    if (!runtimeReady) missingCount++;
    if (!downloadReady) missingCount++;
    if (!mediaReady) missingCount++;

    return {
      ok: true,
      allReady: missingCount === 0,
      missingCount,
      runtime,
      binaries,
      suites: {
        runtime: runtimeReady,
        downloads: downloadReady,
        media: mediaReady,
      },
    };
  } catch (error) {
    return { ...fail(error), ok: false, allReady: false, missingCount: 3 };
  }
});

/** Catalogue browsing for the home screen. Fast by construction; see `browse`. */
ipcMain.handle('api:browse', async (_, query: string, provider?: string) => {
  try {
    return { ok: true, results: await contentService.browse(query, provider) };
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

/**
 * The stream started but could not be played; move on.
 *
 * Distinct from `selectSource`, which is a deliberate choice and must not fail
 * over. This is the opposite: the viewer chose nothing and the app owes them
 * the next candidate.
 */
ipcMain.handle('playback:skipSource', async (_, sessionId: string, reason: string) => {
  try {
    diagnostics.record({
      level: 'warn',
      stage: 'playback',
      message: reason,
      detail: 'Source could not be played; advancing to the next.',
    });
    return { ok: true, snapshot: await playbackSessions.skipCurrentSource(sessionId, reason) };
  } catch (error) {
    return { ...fail(error), snapshot: null };
  }
});

ipcMain.handle('playback:playNow', async (_, sessionId: string) => {
  try {
    return { ok: true, snapshot: await playbackSessions.playNow(sessionId) };
  } catch (error) {
    return { ...fail(error), snapshot: null };
  }
});

/**
 * Finds sources without starting one, for the detail screen's picker.
 *
 * Same session type and same `playback:update` stream as playing does, so the
 * picker gets progressive results, a progress count and a cancel for free —
 * rather than a second, worse copy of source discovery living in the renderer.
 */
ipcMain.handle(
  'playback:startDiscovery',
  (
    _,
    request: SourceQuery,
    title: string,
    episodeTitle?: string,
    options?: { bypassCache?: boolean }
  ) => {
    try {
      return {
        ok: true,
        snapshot: playbackSessions.startDiscovery(request, title, episodeTitle, options ?? {}),
      };
    } catch (error) {
      return { ...fail(error), snapshot: null };
    }
  }
);

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

/**
 * Stops waiting for the remaining providers, keeping the sources already found.
 *
 * Synchronous on purpose: the answer is "stop", and making the viewer wait for
 * the search they are cancelling would be its own small joke.
 */
ipcMain.handle('playback:cancelSourceSearch', (_, sessionId: string) => {
  try {
    return { ok: true, snapshot: playbackSessions.cancelDiscovery(sessionId) };
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
/**
 * What this renderer can actually decode.
 *
 * Reported once at startup and believed over any table in the main process:
 * Chromium's HEVC support depends on the build and on platform decoders, so
 * only the renderer can answer for the machine in front of the user. The probe
 * strings live beside the codec table they correct.
 */
ipcMain.handle('media:setCapabilities', async (_, capabilities: RendererCapabilities) => {
  // INV-RACE-4: registered during bootstrap, before any playback session opens.
  playbackEngine.setCapabilities(capabilities);
  return { ok: true };
});

ipcMain.handle('media:getCodecProbes', async () => VIDEO_CODEC_PROBES);

// --- external players -----------------------------------------------------

/**
 * Players already on this machine, and where to get one if there are none.
 *
 * `refresh` exists because someone who follows a download link will install a
 * player while the app is running, and being told to restart for it would be a
 * poor end to the sentence "we cannot play this, try VLC".
 */
/**
 * Opens a link in the system browser.
 *
 * Scheme-checked here as well as in `setWindowOpenHandler`: this one is
 * reachable from the renderer with an arbitrary string, and `shell.openExternal`
 * will happily launch a `file:` or custom-protocol handler if allowed to.
 */
ipcMain.handle('shell:openExternal', async (_, url: string) => {
  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, error: 'Only http and https links can be opened.' };
  }
  await shell.openExternal(url);
  return { ok: true };
});

ipcMain.handle('player:listExternal', async (_, refresh?: boolean) => ({
  ok: true,
  players: refresh ? externalPlayers.refresh() : externalPlayers.list(),
  downloads: externalPlayers.getDownloads(),
}));

ipcMain.handle('player:openExternal', async (_, playerId: string, url: string) => {
  const result = externalPlayers.open(playerId, url);
  if (!result.ok) {
    diagnostics.record({
      level: 'error',
      stage: 'playback',
      source: playerId,
      url,
      message: result.error ?? 'The external player could not be started.',
    });
  }
  return result;
});

/**
 * Asks the source itself why it could not be read.
 *
 * One request, and it distinguishes the case that matters: a 4xx/5xx means the
 * link is gone or refused and no decoder would have helped, while a source that
 * answers 200 and still cannot be probed is a real format problem.
 */
async function describeUnreadableSource(url: string): Promise<{
  status?: number;
  reason: string;
  dead: boolean;
}> {
  if (!/^https?:\/\//i.test(url)) {
    return { reason: 'This source could not be read.', dead: false };
  }
  try {
    // GET with a one-byte range: some hosts refuse HEAD outright, and a range
    // keeps this from pulling a film to find out whether it exists.
    //
    // Through the resilient path deliberately. This function's answer decides
    // whether a link is reported dead, and a single transient HTTP/2 reset would
    // otherwise condemn a source that works perfectly on the next attempt.
    const response = await resilientFetch.fetch(
      url,
      {
        method: 'GET',
        headers: { Range: 'bytes=0-0' },
        signal: AbortSignal.timeout(12_000),
      },
      { operation: 'source-probe' }
    );
    try {
      await response.body?.cancel();
    } catch {
      // Nothing to cancel.
    }

    if (response.status >= 400) {
      return {
        status: response.status,
        dead: true,
        reason:
          response.status === 404 || response.status === 410
            ? `This link no longer exists (HTTP ${response.status}). It has probably expired — try another source.`
            : `The source refused this request (HTTP ${response.status}). The link may have expired, or need credentials this app does not have.`,
      };
    }

    return {
      status: response.status,
      dead: false,
      reason:
        'The source is reachable but its format could not be read. It may use a container or codec that cannot be played here.',
    };
  } catch (error) {
    return {
      dead: true,
      reason: `The source could not be reached: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

/**
 * Classifies a source without starting anything.
 *
 * Used by the detail screen and by anything that wants to say what a source *is*
 * before committing to it — AC-COMPAT-10, which asks the UI to distinguish
 * downloadable from directly playable. A 25 GB HEVC 10-bit MKV downloads at full
 * speed and decodes nothing, and conflating the two is the root of PRD-37 §2.
 */
ipcMain.handle(
  'media:inspect',
  async (_, request: Pick<PlaybackStreamRequest, 'url' | 'headers' | 'isM3u8' | 'refresh'>) => {
    try {
      return { ok: true, capability: await playbackEngine.inspect(request) };
    } catch (error) {
      return { ...fail(error), capability: null };
    }
  }
);

/**
 * Inspect, decide, open — and only then hand back a URL to attach.
 *
 * This replaces a probe that ran *beside* playback. The renderer used to assign
 * `video.src` on mount and start an inspection in parallel; Chromium's parser
 * failed on an unsupported bitstream within ~150 ms, its `error` handler fired
 * while the probe was still in flight, and the fallback therefore ran `-c:v copy`
 * on video it knew nothing about — re-wrapping an undecodable HEVC stream into
 * MP4 and failing identically a second time. There is no longer a code path that
 * attaches an unclassified URL.
 */
ipcMain.handle('media:prepare', async (_, request: PlaybackStreamRequest) => {
  try {
    return await playbackEngine.prepare(request);
  } catch (error) {
    return { ...fail(error), playbackUrl: request?.url ?? '', sessionId: '', subtitles: [] };
  }
});

ipcMain.handle(
  'media:switchAudio',
  async (_, sessionId: string, audioIndex: number, positionSeconds: number) =>
    playbackEngine.switchAudio(sessionId, audioIndex, positionSeconds)
);

ipcMain.handle('media:closeStream', async (_, sessionId: string) => {
  playbackEngine.close(sessionId);
  return { ok: true };
});

ipcMain.handle('media:getPlaybackDiagnostics', async (_, sessionId?: string) => ({
  ok: true,
  events: playbackEngine.getDiagnostics(sessionId),
}));

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

ipcMain.handle('download:revealInFolder', async (_, targetPath?: string) => {
  const defaultDir = path.join(os.homedir(), 'Downloads', 'CloudStream');
  const target = targetPath || defaultDir;
  try {
    const normalized = path.normalize(target);
    if (fs.existsSync(normalized)) {
      const stat = fs.statSync(normalized);
      if (stat.isDirectory()) {
        await shell.openPath(normalized);
      } else {
        shell.showItemInFolder(normalized);
      }
    } else {
      const parentDir = path.dirname(normalized);
      if (fs.existsSync(parentDir)) {
        await shell.openPath(parentDir);
      } else {
        fs.mkdirSync(defaultDir, { recursive: true });
        await shell.openPath(defaultDir);
      }
    }
  } catch (error) {
    console.warn('[main] revealInFolder failed:', error);
    try {
      fs.mkdirSync(defaultDir, { recursive: true });
      await shell.openPath(defaultDir);
    } catch {
      // Best effort fallback
    }
  }
});

// --- binaries ------------------------------------------------------------

ipcMain.handle('binary:check', async () => binaryDownloader.checkBinaries());
ipcMain.handle('binary:checkBinaries', async () => binaryDownloader.checkBinaries());

ipcMain.handle('binary:testAll', async () => binaryDownloader.testAllBinaries());

ipcMain.handle('binary:testOne', async (_, name: 'aria2c' | 'yt-dlp' | 'ffmpeg' | 'ffprobe') => {
  return await binaryDownloader.testBinary(name);
});

ipcMain.handle('binary:remove', async (_, name: 'aria2c' | 'yt-dlp' | 'ffmpeg' | 'ffprobe' | 'media' | 'downloads' | 'all') => {
  const removed = binaryDownloader.removeBinary(name);
  return { ok: removed };
});

ipcMain.handle('binary:setupAria2', async () => {
  try {
    const ok = await binaryDownloader.setupAria2((status, percent) => {
      mainWindow?.webContents.send('binary:setupProgress', { component: 'aria2c', status, percent });
    });
    if (ok) await aria2.start().catch(() => {});
    return { ok, message: ok ? 'aria2c ready' : 'aria2c installation failed' };
  } catch (error) {
    return { ...fail(error), ok: false, message: 'aria2c installation failed' };
  }
});

ipcMain.handle('binary:setupYtDlp', async () => {
  try {
    const ok = await binaryDownloader.setupYtDlp((status, percent) => {
      mainWindow?.webContents.send('binary:setupProgress', { component: 'yt-dlp', status, percent });
    });
    return { ok, message: ok ? 'yt-dlp ready' : 'yt-dlp installation failed' };
  } catch (error) {
    return { ...fail(error), ok: false, message: 'yt-dlp installation failed' };
  }
});

/**
 * One-click FFmpeg. Progress is pushed so a ~100 MB download can show its
 * state rather than freezing a dialog.
 */
ipcMain.handle('binary:setupFfmpeg', async () => {
  try {
    const ok = await binaryDownloader.setupFfmpeg((status, percent) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('binary:setupProgress', { component: 'ffmpeg', status, percent });
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

ipcMain.handle('binary:setupAll', async () => {
  try {
    const res = await binaryDownloader.setupAll((component, status, percent) => {
      mainWindow?.webContents.send('binary:setupProgress', { component, status, percent });
    });
    await aria2.start().catch(() => {});
    return res;
  } catch (error) {
    return { ...fail(error), ok: false, message: 'Component setup failed' };
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

/** Adult repositories are absent from this list until the user opts in. */
ipcMain.handle('extension:getOfficialRepositories', async () => bootstrap.visibleRepositories());

ipcMain.handle('extension:getBootstrapProgress', async () => bootstrap.getProgress());

/** How many extension providers a search asks at once. */
ipcMain.handle('search:getConcurrency', async () => ({
  value: pluginManager.searchConcurrency(),
  ...pluginManager.searchConcurrencyBounds(),
}));

ipcMain.handle('search:setConcurrency', async (_, value: number) => ({
  value: pluginManager.setSearchConcurrency(value),
  ...pluginManager.searchConcurrencyBounds(),
}));

ipcMain.handle('extension:getAdultAllowed', async () => bootstrap.isAdultAllowed());

/**
 * Turning adult content off must take effect at once, not at next launch: the
 * provider registry is re-read so anything already loaded stops being offered.
 */
ipcMain.handle('extension:setAdultAllowed', async (_, enabled: boolean) => {
  const value = bootstrap.setAdultAllowed(Boolean(enabled));
  return { ok: true, enabled: value, providers: await pluginManager.listEnabledProviders() };
});

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

/**
 * Removing a repository now uninstalls the extensions it brought with it, so the
 * reply reports both — the caller needs to be able to say "removed, and 12
 * extensions with it" rather than implying nothing else changed.
 */
ipcMain.handle('extension:removeRepository', async (_, repoUrl: string) => {
  const removedExtensions = pluginManager.removeRepository(repoUrl);
  return { repositories: pluginManager.getInstalledRepositories(), removedExtensions };
});

/**
 * Switch a repository or extension off without deleting anything.
 *
 * The reversible half of the pair above, and the one the UI offers first: a
 * bundled repository the user does not want is silenced instantly and can be
 * brought back without re-downloading ~170 archives.
 */
ipcMain.handle(
  'extension:setRepositoryEnabled',
  async (_, repositoryId: string, enabled: boolean) =>
    pluginManager.setRepositoryEnabled(repositoryId, enabled)
);

ipcMain.handle(
  'extension:setRepositoriesEnabled',
  async (_, repositoryIds: string[], enabled: boolean) =>
    pluginManager.setRepositoriesEnabled(repositoryIds, enabled)
);

ipcMain.handle(
  'extension:setExtensionEnabled',
  async (_, internalName: string, enabled: boolean) =>
    pluginManager.setExtensionEnabled(internalName, enabled)
);

ipcMain.handle(
  'extension:setExtensionsEnabled',
  async (_, internalNames: string[], enabled: boolean) =>
    pluginManager.setExtensionsEnabled(internalNames, enabled)
);

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

/**
 * The tree plus every switched-off set, in one reply.
 *
 * They travel together because they are read together: a row's appearance
 * depends on all three levels, and fetching them separately would render a tree
 * against a stale disabled-set for one frame — visible as toggles flickering
 * into place after the list draws.
 */
ipcMain.handle('extension:getProviderTree', async () => {
  try {
    await pluginManager.loadProviders();
    return {
      ok: true,
      tree: pluginManager.getProviderTree(),
      disabled: pluginManager.getDisabledProviders(),
      disabledExtensions: pluginManager.getDisabledExtensions(),
      disabledRepositories: pluginManager.getDisabledRepositories(),
    };
  } catch (error) {
    return {
      ...fail(error),
      tree: [],
      disabled: [],
      disabledExtensions: [],
      disabledRepositories: [],
    };
  }
});

// --- search scope ---------------------------------------------------------

/**
 * Everything the scope picker needs to draw itself, in one call.
 *
 * `ensureLoaded` is the whole design here. Which providers an archive registers
 * is only knowable by running it, and running all of them takes minutes on a
 * bootstrapped install — so this used to load them unconditionally and the
 * picker had nothing to show until that finished. Since nothing said so, it
 * simply looked empty, and the only thing that appeared to fix it was running a
 * search: that awaited the very same load, and by the time the user reopened
 * the menu it had completed.
 *
 * Two calls instead of one. The picker asks with `ensureLoaded: false` when it
 * mounts, which answers instantly from whatever is already registered, and with
 * `true` when the user opens it — paying the cost at the moment there is a
 * menu open to show progress in.
 */
ipcMain.handle('search:getScopeOptions', async (_, ensureLoaded = true) => {
  try {
    if (ensureLoaded) await pluginManager.loadProviders();
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
      ready: pluginManager.providersReady(),
      progress: pluginManager.getProviderLoadProgress(),
    };
  } catch (error) {
    return {
      ...fail(error),
      repositories: [],
      disabledProviders: [],
      indexers: [],
      scope: { providers: [], indexers: [] },
      ready: false,
      progress: pluginManager.getProviderLoadProgress(),
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
/**
 * Can this machine actually reach the sources it is configured to use?
 *
 * Probes the catalogues plus **every configured indexer**, through `net.fetch`
 * so the DNS setting is the one being tested. The list is derived rather than
 * hardcoded: a fixed five told a Jackett user their connection was fine while
 * the indexer they actually search was unreachable.
 *
 * Disabled indexers are still probed and reported as such. The question being
 * answered is "what can this network reach", and knowing a site is reachable is
 * exactly what tells someone it is worth enabling.
 */
ipcMain.handle('network:test', async () => {
  const targets = [
    { id: 'cinemeta', name: 'Cinemeta (catalogue)', url: 'https://v3-cinemeta.strem.io/manifest.json', enabled: true, kind: 'catalogue' as const },
    { id: 'tvmaze', name: 'TVmaze (catalogue)', url: 'https://api.tvmaze.com/shows/1', enabled: true, kind: 'catalogue' as const },
    ...contentService
      .getRegistry()
      .probeTargets()
      .map((target) => ({ ...target, kind: 'indexer' as const })),
  ];

  const results = await Promise.all(
    targets.map(async (target) => {
      const started = Date.now();
      try {
        const response = await net.fetch(target.url, {
          method: 'GET',
          signal: AbortSignal.timeout(8_000),
        });
        return {
          name: target.name,
          kind: target.kind,
          enabled: target.enabled,
          // A 4xx still proves the host resolved and answered, which is what
          // this test is about; only a transport failure is a "no".
          ok: true,
          status: response.status,
          latencyMs: Date.now() - started,
        };
      } catch (error) {
        return {
          name: target.name,
          kind: target.kind,
          enabled: target.enabled,
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

ipcMain.handle('library:setSources', async (_, key: string, sources: StoredSource[]) =>
  libraryStore.setSources(key, sources)
);

ipcMain.handle('library:getSources', async (_, key: string) =>
  libraryStore.getStoredSources(key)
);

ipcMain.handle(
  'library:refreshSources',
  async (_, mediaUrl: string, title: string, year?: number, season?: number, episode?: number) => {
    try {
      const result = await contentService.getSources(
        { mediaUrl, titleOverride: title, season, episode },
        undefined,
        { bypassCache: true }
      );
      const key = canonicalKey(title, year);
      const stored = result.sources.map(torrentResultToStoredSource);
      libraryStore.setSources(key, stored);
      return { ok: true, sources: result.sources, storedSources: stored };
    } catch (error: any) {
      return {
        ok: false,
        error: error?.message || 'Failed to refresh sources',
        sources: [],
        storedSources: [],
      };
    }
  }
);

// --- media history ----------------------------------------------------------

ipcMain.handle('history:recordEvent', async (_, event: Parameters<HistoryStore['record']>[0]) =>
  historyStore.record(event)
);

ipcMain.handle('history:updateEvent', async (_, id: string, updates: Partial<HistoryEvent>) =>
  historyStore.update(id, updates)
);

ipcMain.handle('history:list', async (_, filter?: HistoryFilter) =>
  historyStore.list(filter)
);

ipcMain.handle('history:get', async (_, id: string) =>
  historyStore.get(id)
);

ipcMain.handle('history:deleteItem', async (_, id: string) =>
  historyStore.delete(id)
);

ipcMain.handle('history:deleteItems', async (_, ids: string[]) =>
  historyStore.deleteMany(ids)
);

ipcMain.handle('history:clearAll', async () => {
  historyStore.clear();
  return { ok: true };
});

ipcMain.handle('history:getStats', async () =>
  historyStore.getStats()
);

// --- datastore -----------------------------------------------------------

ipcMain.handle('datastore:getSetting', async (_, key: string, defaultValue: any) =>
  datastore.getString(key, defaultValue, true)
);

ipcMain.handle('datastore:setSetting', async (_, key: string, value: any) => {
  if (typeof value === 'boolean') {
    datastore.setBool(key, value, true);
  }
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
