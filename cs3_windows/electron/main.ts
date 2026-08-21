import { app, BrowserWindow, Menu, net, shell } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { DatastoreManager } from './datastore';
/**
 * Envelope semantics live in `ipc/`, not here.
 *
 * `handle` owns the try/catch and the `{ ok, error, …payload }` shape that
 * sixty-eight handlers in this file used to spell out individually; `failure` is
 * the same normalisation for the handful of places that build a reply by hand.
 */
import { HomeProviderRegistry } from './cs3/homeProviderRegistry';
import { Logger, LOG_LEVELS, setLogger, type LogLevel } from './logging/logger';
import { Aria2Engine } from './aria2Engine';
import { DownloadService } from './downloadService';
import { PluginManager } from './pluginManager';
import { NetworkSettingsStore } from './networkSettings';
import { setHttpFetch } from './torrent/http';
import { ResilientFetch, classifyNetworkError } from './networkResilience';
import { BinaryDownloader } from './binaryDownloader';
import { MpvEngine } from './media/mpvEngine';
import { MpvSurface } from './media/mpvSurface';
import { TorrentEngine } from './torrent/torrentEngine';
import { ContentService } from './contentService';
import { PlaybackSessionManager } from './playbackSession';
import { SearchSuggestionService } from './searchSuggestions';
import { SearchHistoryStore } from './searchHistory';
import { SubtitleService } from './subtitleService';
import { MediaTranscoder } from './mediaTranscoder';
import { PlaybackEngine } from './media/playbackEngine';
import { InspectionStore } from './media/inspectionStore';
import { detectExtensionPicky } from './media/mediaInspector';
import { runTool } from './media/runTool';
import { describeUnreadableSource } from './media/unreadableSource';
import { nativeEnginePolicy } from './media/nativeEnginePolicy';
import { ExtensionUpdater } from './cs3/extensionUpdater';
import { BatchDownloader } from './cs3/batchDownloader';
import { BootstrapService } from './cs3/bootstrap';
import { TitleOutcomeStore } from './cs3/titleOutcomes';
import { DiagnosticsLog } from './cs3/diagnostics';
import { ProviderAnalytics } from './cs3/providerAnalytics';
import { ProviderRanking } from './cs3/providerRanking';
import { ProviderRecommender } from './cs3/providerRecommendations';
import { ExternalPlayerService } from './externalPlayer';
import { LibraryStore } from './cs3/libraryStore';
import { HistoryStore } from './cs3/historyStore';
import { BookmarkStore } from './cs3/bookmarkStore';
import { DiscoveryService } from './cs3/discovery';
import { SourcePrefetcher } from './cs3/sourcePrefetcher';
import { TitleEnricher } from './cs3/titleEnricher';
import type { DownloadTask } from '../src/types/download';

import type { Services } from './ipc/services.ts';
import { registerContentHandlers } from './ipc/content.ts';
import { registerDiagnosticsHandlers } from './ipc/diagnostics.ts';
import { registerPrefetchHandlers } from './ipc/prefetch.ts';
import { registerDiscoveryHandlers } from './ipc/discovery.ts';
import { registerBookmarkHandlers } from './ipc/bookmarks.ts';
import { registerAnalyticsHandlers } from './ipc/analytics.ts';
import { registerRuntimeHandlers } from './ipc/runtime.ts';
import { registerPlaybackHandlers } from './ipc/playback.ts';
import { registerCapabilityHandlers } from './ipc/capabilities.ts';
import { registerExternalPlayerHandlers } from './ipc/externalPlayers.ts';
import { registerNativeEngineHandlers } from './ipc/nativeEngine.ts';
import { registerIndexerHandlers } from './ipc/indexers.ts';
import { registerDownloadHandlers } from './ipc/downloads.ts';
import { registerBinaryHandlers } from './ipc/binaries.ts';
import { registerExtensionHandlers } from './ipc/extensions.ts';
import { registerNetworkHandlers } from './ipc/network.ts';
import { registerLibraryHandlers } from './ipc/library.ts';
import { registerHomeHandlers } from './ipc/home.ts';
import { registerHistoryHandlers } from './ipc/history.ts';
import { registerDatastoreHandlers } from './ipc/datastore.ts';

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
/**
 * The home screen's catalogue source, and the rows built from it.
 *
 * The registry is constructed first because `DiscoveryService` resolves the
 * active provider on every call rather than holding one — a provider that goes
 * down mid-session falls back on the next request, not on the next restart.
 */
const homeProviders = new HomeProviderRegistry(datastore);
const discovery = new DiscoveryService(homeProviders);
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
/**
 * The structured log, constructed before the services that write to it.
 *
 * The directory is passed in rather than resolved inside `Logger`, which
 * deliberately does not import `electron` — that import would make the module
 * unloadable under Node's type stripping, which is where its tests run.
 */
const logger = new Logger({ directory: path.join(app.getPath('userData'), 'logs') });
setLogger(logger);
/**
 * The level survives a restart, because what it is turned up for has not
 * happened yet: a `trace` setting that reset on launch would be back to normal
 * by the time anyone managed to reproduce the thing they turned it up for.
 */
const savedLogLevel = datastore.getString('log_level_key', '');
if (LOG_LEVELS.includes(savedLogLevel as LogLevel)) logger.setLevel(savedLogLevel as LogLevel);

logger.info('app', 'session_started', {
  version: app.getVersion(),
  electron: process.versions.electron,
  platform: `${process.platform}-${process.arch}`,
  logFile: logger.logFile,
});

/**
 * Anything that reaches the top of the stack is recorded before it is lost.
 *
 * An unhandled rejection in the main process is invisible: there is no console
 * a user can see, and the renderer carries on as though nothing happened. These
 * two handlers are the difference between "it just stopped working" and a
 * record naming what threw.
 */
process.on('unhandledRejection', (reason) => {
  logger.error('app', 'unhandled_rejection', {
    error: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack?.slice(0, 2000) : undefined,
  });
});
process.on('uncaughtException', (error) => {
  logger.fatal('app', 'uncaught_exception', { error: error.message, stack: error.stack?.slice(0, 2000) });
});

const diagnostics = new DiagnosticsLog();

/**
 * Every diagnostic also becomes a structured record.
 *
 * The two logs answer different questions and both are worth having:
 * `DiagnosticsLog` is shaped to be pasted to a provider maintainer, this one to
 * be filtered and grouped. Mirroring rather than replacing means a failure is
 * in the timeline beside the search that led to it, without the call sites
 * having to write it twice.
 */
diagnostics.setListener((record) => {
  logger.write(
    record.level === 'error' ? 'error' : record.level === 'warn' ? 'warn' : 'info',
    'provider',
    `diagnostic_${record.stage}`,
    {
      provider: record.source,
      mediaTitle: record.title,
      url: record.url,
      operation: record.stage,
      error: record.level === 'error' ? record.message : undefined,
      message: record.level === 'error' ? undefined : record.message,
    }
  );
});
const externalPlayers = new ExternalPlayerService();
externalPlayers.setSnapshotListener((snapshot) =>
  mainWindow?.webContents.send('external:update', snapshot)
);
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

/**
 * The native playback engine, and how eagerly it is used.
 *
 * `auto` by default: mpv takes the streams the in-app player handles badly — any
 * video re-encode, and lossless or object-based audio — and leaves everything
 * else alone. See `shouldRouteToNativeEngine` for what each policy costs.
 *
 * The policy is read from the datastore per decision rather than captured once,
 * because both halves of the answer move while the app runs: the setting is a
 * setting, and mpv itself can be installed mid-session.
 */
const mpvEngine = new MpvEngine({
  resolveBinary: (name) => binaryDownloader.resolveBinary(name),
  onUpdate: (snapshot) => mainWindow?.webContents.send('mpv:update', snapshot),
  diagnostics,
  /**
   * The embedded video surface, wired here because this is the only layer that
   * holds a `BrowserWindow`.
   *
   * `undefined` on platforms that cannot do it, which is how `MpvEngine`
   * answers `canEmbed` without knowing anything about windows. The main window
   * is resolved at call time rather than captured: it is created after the
   * services are wired and, on macOS, the app outlives it.
   */
  createSurface: MpvSurface.supported
    ? () => {
        const parent = mainWindow;
        if (!parent || parent.isDestroyed()) return null;
        const surface = new MpvSurface();
        return {
          attach: (bounds) => surface.attach(parent, bounds),
          setBounds: (bounds) => surface.setBounds(bounds),
          detach: () => surface.detach(),
          get attached() {
            return surface.attached;
          },
        };
      }
    : undefined,
});

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
  nativeEngine: () => ({ available: mpvEngine.isAvailable(), policy: nativeEnginePolicy(datastore) }),
  inspections: new InspectionStore(datastore),
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
  describeUnreadable: (url) => describeUnreadableSource(resilientFetch, url),
  diagnostics,
});

/**
 * Asks the probe binary which HLS options it understands.
 *
 * FFmpeg 7.1 introduced `-extension_picky` and defaulted it to *on*, which made
 * the long-standing `-allowed_extensions ALL` fix inert — every provider serving
 * segments from `.png` or extensionless URLs started failing again, with the
 * very message that fix was written against. The flag cannot be passed blindly:
 * an older binary rejects the entire command line and every probe dies, not just
 * the ones this was meant to rescue. So it is detected once, and again whenever
 * ffmpeg is installed or replaced.
 */
function refreshFfmpegOptionSupport(): void {
  const ffprobe = mediaTranscoder.resolveFfprobe();
  if (!ffprobe) return;
  void detectExtensionPicky(ffprobe, (command, args, timeoutMs) =>
    runTool(command, args, timeoutMs)
  );
}
refreshFfmpegOptionSupport();

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
    logger.info('app', 'session_ending');
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
    // A child process with its own window: without this it survives the app and
    // keeps playing, with nothing left on screen to stop it.
    await mpvEngine.shutdown();
    // A controlled VLC is our child process; without this it outlives the app.
    await externalPlayers.shutdown();
    contentService.shutdown();
    await torrentEngine.destroy();
  } catch (error) {
    // Shutdown is best-effort; never block quit on it. It is still worth
    // recording, because a service that throws here is one that leaked
    // something — and the next launch is where that shows up.
    logger.warn('app', 'shutdown_incomplete', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  // Last, and synchronous: nothing after this point gets written.
  logger.shutdown();
  app.exit(0);
});

// --- the IPC surface -------------------------------------------------------

/**
 * Everything the renderer can ask for, grouped by what it is asking about.
 *
 * These 229 handlers used to sit in this file below the singletons they call,
 * which made `main.ts` both the composition root and the entire controller
 * layer — and made "what does the download surface depend on?" a question with
 * no answer short of reading three thousand lines.
 *
 * Each module now declares its own dependencies out of {@link Services}, and
 * `main.ts` is back to what it should be: construct the graph, own the window,
 * hand both to the registrars.
 */
const services: Services = {
  datastore,
  aria2,
  downloadService,
  pluginManager,
  binaryDownloader,
  torrentEngine,
  contentService,
  extensionUpdater,
  batchDownloader,
  libraryStore,
  historyStore,
  bookmarks,
  homeProviders,
  discovery,
  titleEnricher,
  sourcePrefetcher,
  bootstrap,
  titleOutcomes,
  logger,
  diagnostics,
  externalPlayers,
  providerAnalytics,
  providerRanking,
  providerRecommender,
  playbackSessions,
  searchSuggestions,
  searchHistory,
  subtitles,
  mpvEngine,
  playbackEngine,
  network,
  resilientFetch,
  // Resolved per call rather than captured: the window is created after the
  // services are wired, it is replaced on reload, and on macOS the app outlives
  // it. A handler holding a startup reference would push at a destroyed window.
  getWindow: () => mainWindow,
  refreshFfmpegOptionSupport,
};

registerContentHandlers(services);
registerDiagnosticsHandlers(services);
registerPrefetchHandlers(services);
registerDiscoveryHandlers(services);
registerBookmarkHandlers(services);
registerAnalyticsHandlers(services);
registerRuntimeHandlers(services);
registerPlaybackHandlers(services);
registerCapabilityHandlers(services);
registerExternalPlayerHandlers(services);
registerNativeEngineHandlers(services);
registerIndexerHandlers(services);
registerDownloadHandlers(services);
registerBinaryHandlers(services);
registerExtensionHandlers(services);
registerNetworkHandlers(services);
registerLibraryHandlers(services);
registerHomeHandlers(services);
registerHistoryHandlers(services);
registerDatastoreHandlers(services);
