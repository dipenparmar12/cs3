/**
 * First, and deliberately before `electron` itself.
 *
 * The recorder's clock starts when this line runs, and everything after it —
 * the electron binding, 136 of our own modules, every service constructed at
 * module scope — is inside what it measures. An import above it is work it
 * cannot see, which is precisely the work that used to be invisible.
 */
import { startup } from './startupProfile.ts';
import { StartupQueue } from './util/startupQueue.ts';

/**
 * Both of these run *after* every import above has been evaluated — ESM hoists
 * import declarations above any statement, whatever their order in the file.
 * That is not a limitation here, it is the measurement: `modules_loaded` is the
 * cost of the electron binding plus our own 136 modules, and the recorder's
 * clock started when `startupProfile.ts` itself was evaluated, which being the
 * first import declaration makes it the earliest point in this process we can
 * name.
 *
 * The stall monitor cannot observe that window either, and for the same reason
 * nothing else can: a timer does not fire while the loop is blocked. What it
 * does catch is the block *ending*, reported as one long stall on its first
 * tick, which is the honest shape of it.
 */
startup.mark('modules_loaded');
startup.watch();

/**
 * Everything below, until `services_constructed`, is one measured span.
 *
 * The service graph is module-scope `const`s — there is no callback to wrap, so
 * `span` is the only way to give a stall in here a name. Without it the first
 * measured launch reported 443ms of blocked main thread as `uninstrumented`,
 * which is a true statement and a useless one.
 */
const endServiceGraph = startup.span('constructServices');

import { app, BrowserWindow, ipcMain, dialog, Menu, net, screen, shell } from 'electron';
import { BackupService } from './cs3/backupService.ts';
import { createBackupSections } from './cs3/backupSections.ts';
import type { RestorePlan } from '../src/types/backup.ts';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { DatastoreManager } from './datastore';
import { HomeProviderRegistry, DEFAULT_PROVIDER_ID } from './cs3/homeProviderRegistry';
import { Logger, LOG_LEVELS, setLogger, type LogLevel, type LogScope } from './logging/logger';
import {
  ExtensionIssueLog,
  setIssueLog,
  type IssueQuery,
} from './cs3/extensionIssues';
import { Aria2Engine } from './aria2Engine';
import { DownloadService } from './downloadService';
import { PluginManager } from './pluginManager';
import type { SearchScope } from './searchScope';
import {
  DNS_PRESETS,
  NetworkSettingsStore,
  type NetworkSettings,
} from './networkSettings';
import { setChallengeSolver, setHttpFetch } from './torrent/http';
import { ResilientFetch, classifyNetworkError } from './networkResilience';
import { BinaryDownloader } from './binaryDownloader';
import { MpvEngine } from './media/mpvEngine';
import { TorrentEngine } from './torrent/torrentEngine';
import { ContentService, type SourceQuery } from './contentService';
import { PlaybackSessionManager, type ResumePreference } from './playbackSession';
import { SearchSuggestionService } from './searchSuggestions';
import { SearchHistoryStore } from './searchHistory';
import { SavedSearchStore, type SaveSearchInput } from './savedSearches';
import { SubtitleService, languageName, type SubtitleQuery, type SubtitleSearchResult } from './subtitleService';
import {
  PrivacyMode,
  isPrivateSession,
  allowsExplicitSaves,
  type IncognitoSettings,
} from './cs3/privacyMode';
import { SubtitleLibrary, type SaveRequest as SubtitleSaveRequest } from './subtitles/subtitleLibrary';
import { MediaTranscoder, VIDEO_CODEC_PROBES } from './mediaTranscoder';
import { PlaybackEngine } from './media/playbackEngine';
import { InspectionStore } from './media/inspectionStore';
import {
  answered,
  fingerprintOf,
  runToolOffThread,
  sameBinary,
  type ToolCapabilities,
} from './media/toolCapabilities';
import {
  detectExtensionPicky,
  detectToneMapSupport,
  setFfmpegExtensionPicky,
  setFfmpegToneMapSupport,
  setProbeConfig,
  getProbeConfig,
  type ProbeConfig,
} from './media/mediaInspector';
import type {
  NativeEngineCapability,
  PlaybackStreamRequest,
  RendererCapabilities,
} from '../src/types/media';
import type { MpvOpenRequest } from '../src/types/mpv';
import { ExtensionUpdater, type UpdateSettings } from './cs3/extensionUpdater';
import {
  DEFAULT_JOB_CONCURRENCY,
  ExtensionJobQueue,
  type ExtensionJobRequest,
} from './cs3/extensionJobs';
import { OttService } from './cs3/ottService';
import { CatalogueCache } from './cs3/catalogueCache';
import { RepositoryListingCache } from './cs3/repositoryListingCache';
import {
  MetadataEnrichmentService,
  type EnrichmentRequest,
} from './metadata/enrichmentService';
import { searchYouTubeTrailers } from './metadata/youtube';
import { relatedMediaService } from './metadata/relatedMedia/relatedMediaService.ts';
import type { RelatedMediaSearchRequest } from '../src/types/relatedMedia';
import { mediaRatingService } from './metadata/ratings/mediaRatingService.ts';
import type { CanonicalMediaIdentity } from '../src/types/ratings.ts';
import { OttCatalogService } from './cs3/ottCatalog';
import { TorrentImportService, classifyDroppedPath, looksLikeMagnet } from './torrent/torrentImport';
import { parseReleaseName } from './torrent/releaseParser';
import { buildDownloadTask } from '../src/utils/downloadIdentity';
import { BatchDownloader, type BatchDownloadRequest } from './cs3/batchDownloader';
import { BootstrapService } from './cs3/bootstrap';
import { TitleOutcomeStore, type TitleOutcomeKind } from './cs3/titleOutcomes';
import { TitleInteractionStore } from './cs3/titleInteractions';
import { DiagnosticsLog } from './cs3/diagnostics';
import { ProviderAnalytics } from './cs3/providerAnalytics';
import { ProviderRanking } from './cs3/providerRanking';
import { ProviderRecommender } from './cs3/providerRecommendations';
import { ExternalPlayerService } from './externalPlayer';
import {
  continueWatchingEnabled,
  setContinueWatchingEnabled,
} from './cs3/continueWatching';
import { isLinkUsable, pickReplacement, pickSibling } from './cs3/playedSource';
import {
  LibraryStore,
  type WatchStatus,
  canonicalKey,
  torrentResultToStoredSource,
  storedSourceToTorrentResult,
} from './cs3/libraryStore';
import { deadlineFromUrl } from './sourceCache';
import { configureAppStorage, migratePath } from './storage/appStorage.ts';
import { areaSize, sweepCacheArea, sweepTemp } from './storage/storageCleanup.ts';
import { HistoryStore } from './cs3/historyStore';
import { BookmarkStore } from './cs3/bookmarkStore';
import { PageSnapshotStore, type PageSnapshotInput } from './cs3/pageSnapshot.ts';
import { WebViewHost, type WebViewResolveRequest } from './cs3/webViewHost';
import { CLEARANCE_COOKIE, ClearanceService } from './cs3/clearance.ts';
import { relayInSession } from './cs3/clearanceRelay.ts';
import { DiscoveryService } from './cs3/discovery';
import { SourcePrefetcher } from './cs3/sourcePrefetcher';
import { TitleEnricher } from './cs3/titleEnricher';
import type { DownloadTask } from '../src/types/download';
import type { SitePlugin } from '../src/types/plugin';
import type { IndexerConfig, SourcePreferences, TorrentResult } from '../src/types/torrent';
import type { SearchOptions } from '../src/types/api';
import type { HistoryEvent, HistoryFilter } from '../src/types/history';
import type {
  StoredSource,
  PlaybackPreferences,
} from '../src/types/library';
import type { ExternalPlaybackSnapshot } from '../src/types/player';
import type { MpvSnapshot } from '../src/types/mpv';
import { describeError } from '../src/utils/errors.ts';
import type { TitleInteractionQuery } from '../src/types/interactions';
import { SHARE_SCHEME } from '../src/utils/shareLink.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const IS_DEV = !app.isPackaged;
export const APP_NAME = IS_DEV ? 'CloudStream 3 Desktop (Dev)' : 'CloudStream 3 Desktop';
export const APP_ID = IS_DEV
  ? 'com.lagradost.cloudstream3.desktop.dev'
  : 'com.lagradost.cloudstream3.desktop';
export const APP_TITLE = IS_DEV ? 'CloudStream 3 Desktop [Dev]' : 'CloudStream 3 Desktop';

/**
 * Configure app name and Windows AppUserModelID before accessing paths or creating windows.
 * This ensures distinct taskbar grouping, toast notifications, and user data directories
 * between development and production environments, preventing profile and cache conflicts.
 */
app.name = APP_NAME;
app.setAppUserModelId(APP_ID);

let mainWindow: BrowserWindow | null = null;

/**
 * Where everything lives on disk — configured before any service that stores
 * something is constructed. See `storage/appStorage.ts` for the layout.
 *
 * Downloads: an existing `~/Downloads/CloudStream` is kept (that is where
 * every earlier build put things, and moving a person's films is not ours to
 * do); otherwise the platform's own Downloads folder, which follows a
 * redirected or localised one where a home-directory guess would not.
 */
const legacyDownloadsDir = path.join(os.homedir(), 'Downloads', 'CloudStream');
const downloadsDir = fs.existsSync(legacyDownloadsDir)
  ? legacyDownloadsDir
  : path.join(app.getPath('downloads'), 'CloudStream');
/** The viewer's chosen folder (Settings → Downloads), else the default above. */
const DOWNLOAD_DIRECTORY_KEY = 'download_directory';
const storage = configureAppStorage({
  root: app.getPath('userData'),
  downloads: () => datastore.getString(DOWNLOAD_DIRECTORY_KEY, '', true) || downloadsDir,
});
/*
 * Re-creatable caches that earlier builds wrote beside the persistent data.
 * Moved once into `cache/`, before the services below read them; a file that
 * cannot be moved stays put and its service starts a fresh cache.
 */
const CACHE_FILES = [
  'cs3-detail-cache.json',
  'cs3-discovery-cache.json',
  'cs3-metadata-cache.json',
  'cs3-related-media-cache.json',
  'cs3-ratings-cache.json',
  'cs3-catalogue-cache.json',
  'cs3-repository-listings.json',
  'cs3-ffmpeg-capabilities.json',
] as const;
for (const name of CACHE_FILES) storage.migrateIntoCache(path.join(storage.dataDir, name));
migratePath(path.join(storage.dataDir, 'torrent-state'), path.join(storage.cacheRoot, 'torrent-state'));

const datastore = new DatastoreManager();
// Constructed before every store that records activity, so the first write any
// of them makes already sees the right answer (PRD-52).
const privacyMode = new PrivacyMode(datastore);
privacyMode.onChange((state) => {
  BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('privacy:changed', state));
  const item = Menu.getApplicationMenu()?.getMenuItemById('incognito-toggle');
  if (item) item.checked = state.active;
});

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
 * How long after the window opens the background provider warm-up begins.
 *
 * Long enough that the first frame and the home screen's own fetches are done
 * competing for the machine; short enough that a viewer who goes straight to
 * the search box still benefits. Same reasoning as `SourcePrefetcher`'s settle
 * delay, and the same failure if it is too short — speculative work in front of
 * what the user is actually looking at.
 */
const PROVIDER_WARMUP_DELAY_MS = 8_000;

/**
 * When the torrent client is brought up, if nothing has asked for it first.
 *
 * After the provider warm-up rather than beside it: both are background work
 * competing with a window that has just opened, and a DHT bootstrap is a burst
 * of UDP to a dozen hosts that gains nothing from sharing a moment with 56 jars
 * of JVM class loading.
 */
const TORRENT_WARMUP_DELAY_MS = 16_000;

const diagnostics = new DiagnosticsLog();

/**
 * The third log, and the one you read when you sit down to fix extensions.
 *
 * `logger` is a transcript and `diagnostics` is a report; neither is a tally,
 * and a tally is what this codebase's one reliable workflow needs — count the
 * log before fixing anything. Measured on a real user's 21 session files:
 * 6,069 records, 5,407 of them sidecar stderr, collapsing to ~200 distinct
 * problems. That last number is the actionable one and no per-session file can
 * show it, because the sessions are separate files and old ones rotate away.
 *
 * Keyed to the logger's session so a row can count *launches* it appeared in,
 * which distinguishes a retry loop inside one session from a site that has been
 * down for a month.
 */
const issueLog = new ExtensionIssueLog({
  file: path.join(app.getPath('userData'), 'cs3-extension-issues.json'),
  sessionId: logger.session,
  appVersion: app.getVersion(),
});
setIssueLog(issueLog);

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

const aria2 = new Aria2Engine();
const downloadService = new DownloadService(datastore, aria2);
const pluginManager = new PluginManager(datastore);

/*
 * The browser extensions could never open for themselves (PRD-36 step 7).
 *
 * Registered before anything starts the sidecar, because the handshake that
 * tells the JVM a browser exists is sent while starting: register it after and
 * the first session's providers each spend a full browser timeout finding out
 * that nothing was listening.
 *
 * The handler is the whole reverse-RPC surface. It is deliberately a closed set
 * of named methods rather than anything general — this is plugin code reaching
 * into the app, and "run this in a browser" is a large enough capability to
 * grant without also granting whatever the next method would be.
 */
const webViewHost = new WebViewHost();
/**
 * Bot-wall clearances for the JVM and the indexers alike — see `clearance.ts`.
 * The browser partition's cookie jar is the store, so a clearance earned by
 * one is used by the other and survives a restart for as long as it is valid.
 */
const clearance = new ClearanceService({
  readCookies: (url) => webViewHost.jarCookies(url),
  removeCookie: (url, name) => webViewHost.removeCookie(url, name),
  solve: async (url) => {
    if (!webViewHost.isAvailable()) return { ok: false, error: 'No browser is available to solve the challenge.' };
    // Upstream's own shape: there is no URL to wait for, only the cookie.
    const answer = await webViewHost.resolve({ url, interceptUrl: '.^', awaitCookie: CLEARANCE_COOKIE, timeoutMs: 45_000 });
    return { ok: answer.ok, error: answer.error };
  },
  userAgent: () => webViewHost.userAgent(),
});
pluginManager.getSidecar().setHostCallHandler(async (method, params) => {
  if (method === 'webview.resolve') {
    return webViewHost.resolve(params as unknown as WebViewResolveRequest);
  }
  if (method === 'clearance.get') {
    return clearance.get(String(params.url ?? ''), { solve: params.solve !== false });
  }
  if (method === 'clearance.invalidate') {
    await clearance.invalidate(String(params.url ?? ''));
    return { ok: true };
  }
  if (method === 'clearance.fetch') {
    return relayInSession(params, { clearance, host: webViewHost });
  }
  return { ok: false, error: `The desktop app does not implement ${method}.` };
});
const binaryDownloader = new BinaryDownloader();
const torrentEngine = new TorrentEngine({
  // The viewer's chosen folder, else `cache/torrent-pieces` — never the
  // system temp directory, which is where every earlier build put it.
  downloadPath:
    datastore.getString('torrent_cache_path', '', true) || storage.cacheDir('torrent-pieces'),
  /**
   * Warm-start state lives under `userData`, never under the piece cache.
   *
   * "Clear the torrent cache" is a button the user is meant to press, and it
   * deletes whatever sits in `torrent_cache_path`. The DHT routing table and
   * the `.torrent` metadata cache are not per-film data and losing them costs a
   * cold start on the next launch, so they are deliberately somewhere that
   * button cannot reach.
   */
  statePath: storage.cacheDir('torrent-state'),
  /**
   * A getter, not a value. Read once at construction this would need a restart
   * to take effect, and a privacy switch that only applies next launch is one
   * the user has to be told about to trust. Consulted per magnet instead, so
   * Settings → Connection stops the very next request.
   */
  httpMetadataCache: () => datastore.getBool('torrent_http_metadata_cache', true, true),
});
const contentService = new ContentService(datastore, pluginManager, torrentEngine);
const extensionUpdater = new ExtensionUpdater(datastore, pluginManager);
/**
 * Opening `.torrent` files and magnets as browsable content.
 *
 * Shares the engine's own metadata cache rather than pointing a second one at
 * the same directory: an imported `.torrent` written there is what makes the
 * first Play skip the BEP-9 fetch, and a directory named in two places is a
 * directory that eventually disagrees.
 */
const torrentImports = new TorrentImportService(
  torrentEngine.metadata,
  app.getPath('userData')
);

/**
 * Cast, crew, ratings and production notes, from the keyless catalogues.
 *
 * Constructed beside `contentService` rather than inside it, and that placement
 * is the design: enrichment must never be on the path that decides what gets
 * searched for or played. `ContentService.load` answers the question "what can
 * I play"; this answers "what is this", on its own schedule, and a page renders
 * from the first long before the second arrives.
 */
/**
 * Declared here rather than beside `discovery`, because the enrichment service
 * below takes it: a detail page whose provider published no IMDb id is resolved
 * through this before any catalogue is asked. It has no dependencies of its own,
 * so the move costs nothing.
 */
const titleEnricher = new TitleEnricher();
// A widened source search asks every other site for the work, not for one
// provider's file name — see `ContentService.searchTitleFor`.
contentService.setTitleResolver((raw, hint) => titleEnricher.resolve(raw, hint));

const metadataEnrichment = new MetadataEnrichmentService(storage.cacheDir(), titleEnricher);
metadataEnrichment.setListener((metadata) =>
  mainWindow?.webContents.send('metadata:extendedUpdate', metadata)
);

const catalogueCache = new CatalogueCache(storage.cacheFile('cs3-catalogue-cache.json'));
const repositoryListings = new RepositoryListingCache(
  storage.cacheFile('cs3-repository-listings.json')
);
const ottService = new OttService(pluginManager, datastore, catalogueCache);
/** Metadata catalogues for the platforms no installed provider can describe. */
const ottCatalog = new OttCatalogService();
const batchDownloader = new BatchDownloader(contentService, downloadService);
const libraryStore = new LibraryStore(datastore);
const historyStore = new HistoryStore(datastore);
const bookmarks = new BookmarkStore(datastore);
/**
 * The last-known-good copy of every detail page that has been opened.
 *
 * Wired into `contentService` rather than called from the IPC layer because
 * that class is the single funnel every detail load passes through; capturing
 * at the handler would miss the revalidation path and the native provider
 * path, which are exactly the ones whose answers go stale. See
 * `cs3/pageSnapshot.ts` for what a snapshot is and is not.
 */
const pageSnapshots = new PageSnapshotStore(app.getPath('userData'));
const savedSearches = new SavedSearchStore(app.getPath('userData'));
contentService.setSnapshotStore(pageSnapshots);
relatedMediaService.setDirectory(storage.cacheDir());
mediaRatingService.setDirectory(storage.cacheDir());
mediaRatingService.setDatastore(datastore);
/**
 * The home screen's catalogue source, and the rows built from it.
 *
 * The registry is constructed first because `DiscoveryService` resolves the
 * active provider on every call rather than holding one — a provider that goes
 * down mid-session falls back on the next request, not on the next restart.
 */
const homeProviders = new HomeProviderRegistry(datastore);
/**
 * The built-in providers publish home rows too, so the roster is handed over.
 *
 * `contentService` owns the registry because it is the thing that resolves
 * their addresses; passing the same instance rather than building a second one
 * matters — a provider switched off in the extensions screen must disappear
 * from the home screen in the same moment, and two rosters would drift.
 */
const discovery = new DiscoveryService(
  homeProviders,
  storage.cacheDir(),
  contentService.getNativeProviders()
);
/**
 * Warms the source cache while a detail page is being read.
 *
 * Safe to race with Play because `ContentService` shares in-flight discovery —
 * pressing Play during a prefetch joins it rather than starting a second scrape.
 */
const sourcePrefetcher = new SourcePrefetcher(contentService, datastore);

// Every discovery that finds something for a library title is kept on it, so
// the library can show — and play — what was found without searching again.
contentService.onSourcesFound((pageUrl, sources, season, episode) => {
  libraryStore.mergeDiscoveredSources(pageUrl, sources, season, episode);
});

/**
 * Looks for sources for a film just added to the library with none known yet.
 *
 * Adding a title is a stronger statement of intent than opening its page, which
 * already prefetches — so this runs under the same switch ("Load sources while
 * you read"), one at a time, without widening past the providers the title came
 * from. A series without an episode on screen is left alone — there is nothing
 * precise to look for — and its episodes are captured as they are played.
 */
let libraryCapture: Promise<unknown> = Promise.resolve();
const libraryCapturing = new Set<string>();
const SERIES_TYPES = new Set<string>(['TvSeries', 'Anime', 'AsianDrama', 'Live']);

function captureLibrarySources(
  target: { mediaUrl: string; season?: number; episode?: number },
  title: string,
  type?: string
): void {
  const { mediaUrl, season, episode } = target;
  if (!sourcePrefetcher.isEnabled() || libraryCapturing.has(mediaUrl)) return;
  if (type && SERIES_TYPES.has(type)) return;
  libraryCapturing.add(mediaUrl);
  libraryCapture = libraryCapture
    .then(() =>
      contentService.getSources({ mediaUrl, season, episode, titleOverride: title }, undefined, {
        autoWiden: false,
      })
    )
    // Finding nothing leaves the entry as it was; the results, if any, arrive
    // through `onSourcesFound` above.
    .catch(() => undefined)
    .finally(() => libraryCapturing.delete(mediaUrl));
}
const bootstrap = new BootstrapService(datastore, pluginManager);

/**
 * Install, update and add-repository presses, run behind the screen.
 *
 * Pushed to the renderer at most every 120ms: install progress arrives per
 * downloaded chunk, and the tray does not need to repaint for each one.
 */
let jobsPushTimer: NodeJS.Timeout | null = null;
const JOB_STEP_LABEL: Record<string, string | undefined> = {
  downloading: 'Downloading',
  verifying: 'Checking the download',
  analyzing: 'Setting up',
  complete: 'Finishing',
};
const extensionJobs: ExtensionJobQueue = new ExtensionJobQueue({
  concurrency: DEFAULT_JOB_CONCURRENCY,
  notify: () => {
    if (jobsPushTimer) return;
    jobsPushTimer = setTimeout(() => {
      jobsPushTimer = null;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('extension:jobsUpdate', extensionJobs.snapshot());
      }
    }, 120);
  },
  run: async (request, report) => {
    switch (request.kind) {
      case 'install':
        return pluginManager.installPlugin(request.plugin, request.repositoryUrl);
      case 'update':
        return extensionUpdater.updatePlugin(request.internalName);
      case 'uninstall':
        return pluginManager.uninstallPluginExclusive(request.internalName);
      case 'addRepository':
        return pluginManager.addRepository(request.url);
      case 'installRepository': {
        report({ step: 'Reading the repository' });
        // The adult setting is read here, never taken from the renderer.
        const plan = await pluginManager.planRepositoryInstall(request.url, {
          limit: request.limit,
          adultAllowed: bootstrap.isAdultAllowed(),
        });
        if (!plan.ok) return plan;
        // One job per extension, so they download side by side and a failure
        // can be retried on its own.
        extensionJobs.enqueue(
          plan.plugins.map((plugin) => ({
            kind: 'install' as const,
            plugin,
            repositoryUrl: plan.repositoryUrl,
          }))
        );
        const parts = [
          plan.plugins.length > 0
            ? `${plan.plugins.length} extension${plan.plugins.length === 1 ? '' : 's'} queued`
            : 'Nothing new to install',
        ];
        if (plan.alreadyInstalled > 0) parts.push(`${plan.alreadyInstalled} already installed`);
        if (plan.skipped > 0) parts.push(`${plan.skipped} adult skipped`);
        return { ok: true, message: `${plan.name}: ${parts.join(', ')}` };
      }
    }
  },
});

const titleOutcomes = new TitleOutcomeStore(datastore);

/**
 * What every media card in the app knows about a title already.
 *
 * A join over the stores above rather than a store of its own — see the file
 * header for why the one fact it does own (that a details page was opened)
 * could not be derived from `PageSnapshotStore`. Dependencies are thunks where
 * they change under it: the download queue is mutated by the service on every
 * progress tick, and readiness is `ContentService`'s to answer because it owns
 * the cache key rules.
 */
const titleInteractions = new TitleInteractionStore({
  datastore,
  library: libraryStore,
  outcomes: titleOutcomes,
  sourceReadiness: (url) => contentService.peekSourceReadiness(url),
  downloadTasks: () => downloadService.getTasks(),
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

/**
 * The maintainer's own health flag, quoted into the ranking.
 *
 * Read live from the install records rather than snapshotted, so an extension
 * whose author marks it down in the repository stops being recommended at the
 * next update check rather than at the next app release. Indexed per call is
 * cheap enough — this runs once per provider when a ranking is computed, not
 * per search.
 */
providerRanking.setContext({
  declaredStatus: (internalName) => {
    const record = pluginManager
      .getInstalledPluginRecords()
      .find((entry) => entry.internalName === internalName);
    const status = record?.meta?.status;
    return typeof status === 'number' ? status : undefined;
  },
});

/**
 * The ranking decides who a search asks first.
 *
 * Wired here rather than inside `PluginManager` because that class must stay
 * constructible without analytics — the provider harnesses build one with no
 * Electron app around it. It is an ordering and nothing more: `applySearchOrder`
 * refuses any answer that is not the same set of providers, so a scoring bug
 * can cost a little latency and can never quietly shrink a search.
 */
pluginManager.setSearchOrder((names) => providerRanking.rank(names));
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
try {
  contentService.getProxy().addAllowedDirectory(app.getPath('userData'));
  contentService.getProxy().addAllowedDirectory(app.getPath('downloads'));
} catch {}
// A private session discovers into memory only; leaving it drops what was found.
contentService.getCache().setVolatileMode(privacyMode.isActive());
privacyMode.onChange((state) => contentService.getCache().setVolatileMode(state.active));
privacyMode.onClearSession(() => pageSnapshots.discardPrivate());
const playbackSessions = new PlaybackSessionManager(contentService);
const searchSuggestions = new SearchSuggestionService();
const searchHistory = new SearchHistoryStore(datastore);
const subtitles = new SubtitleService();
downloadService.setSubtitleFetcher((url) => subtitles.fetchAsVtt(url));
// Beside the media downloads, so a viewer who opens the folder finds both.
const subtitleLibrary = new SubtitleLibrary(path.join(downloadsDir, 'Subtitles'));
const mediaTranscoder = new MediaTranscoder(binaryDownloader);
/**
 * Lets `resolvePromoVideo` mux a video and an audio address into one stream.
 *
 * Injected rather than owned: both are built here, and each would otherwise
 * need the other first. See `pickPromoStream` for the measurement that made a
 * two-input path necessary at all.
 */
contentService.setTranscoder(mediaTranscoder);
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
const NATIVE_ENGINE_POLICY_KEY = 'native_engine_policy';

function mpvToExternalSnapshot(snapshot: MpvSnapshot): ExternalPlaybackSnapshot {
  return {
    playerId: 'mpv',
    capability: 'full',
    state:
      snapshot.state === 'loading' || snapshot.state === 'buffering'
        ? 'loading'
        : snapshot.state === 'playing'
        ? 'playing'
        : snapshot.state === 'paused'
        ? 'paused'
        : snapshot.state === 'ended'
        ? 'ended'
        : snapshot.state === 'error'
        ? 'error'
        : 'idle',
    positionSeconds: snapshot.positionSeconds,
    durationSeconds: snapshot.durationSeconds,
    paused: snapshot.paused,
    volume: Math.round(snapshot.volume),
    muted: snapshot.muted,
    error: snapshot.error,
  };
}

const mpvEngine = new MpvEngine({
  resolveBinary: (name) => binaryDownloader.resolveBinary(name),
  onUpdate: (snapshot) => {
    mainWindow?.webContents.send('mpv:update', snapshot);
    mainWindow?.webContents.send('external:update', mpvToExternalSnapshot(snapshot));
  },
  // A key pressed in mpv's window asking for something only the app has — the
  // subtitle search. The app window comes forward so the panel is seen.
  onAction: (action) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send('mpv:action', action);
  },
  diagnostics,
});

function nativeEnginePolicy(): NativeEngineCapability['policy'] {
  const stored = datastore.getString(NATIVE_ENGINE_POLICY_KEY, 'auto', true);
  return stored === 'off' || stored === 'aggressive' ? stored : 'auto';
}
const network = new NetworkSettingsStore(datastore);

downloadService.setTorrentEngine(torrentEngine);
downloadService.setContentService(contentService);
downloadService.setHistoryStore(historyStore);

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

/**
 * Ask Chromium for the decoders the platform already has.
 *
 * HEVC is the one that matters and the reason this exists. Chromium has shipped
 * platform HEVC decoding since Chrome 104 behind
 * `PlatformHEVCDecoderSupport`, and this app had never asked for it — so every
 * HEVC stream was re-encoded on machines whose GPU decodes it for free. HEVC is
 * routine at 4K and in 10-bit encodes, which is precisely the population the
 * software encoder cannot hold realtime on.
 *
 * Enabling it cannot make a decision worse, and that is a property of the
 * design rather than optimism: `App.tsx` measures `canPlayType` against
 * {@link VIDEO_CODEC_PROBES} at startup and `media:setCapabilities` overrides
 * the engine's static table **in both directions**. A machine without a
 * hardware decoder still answers `""` and still gets the transcode; a machine
 * with one stops paying for a conversion it never needed. The verdict follows
 * the measurement either way.
 *
 * One switch, one comma-joined list: `appendSwitch('enable-features', …)`
 * replaces rather than merges, so a second call elsewhere would silently drop
 * whatever the first one asked for.
 */
const CHROMIUM_FEATURES = [
  'PlatformHEVCDecoderSupport',
];
app.commandLine.appendSwitch('enable-features', CHROMIUM_FEATURES.join(','));

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
  /*
   * `unsafe-url`: send the provider's `Referer` exactly as given, as OkHttp does
   * on Android. Under Chromium's default policy a full-path referrer on a
   * cross-site request is not trimmed but refused outright with
   * `ERR_BLOCKED_BY_CLIENT` — measured 2026-10-02 on NetMirror/Jio Hotstar,
   * whose `https://net52.cc/mobile/home?app=1` referrer killed every variant
   * playlist on `freecdn34.top` while the same-site master played. Downloads
   * (aria2) worked throughout, which is what made it look like a stream bug.
   */
  primary: (input, init) => net.fetch(input, { referrerPolicy: 'unsafe-url', ...init }),
  fallback: (input, init) => fetch(input, init),
  diagnostics,
});
setHttpFetch((input, init) => resilientFetch.fetch(input, init));

/**
 * The browser, lent to the torrent indexers.
 *
 * `WebViewHost` has solved Cloudflare challenges for `.cs3` extensions since
 * 2026-08-24, and nothing in the torrent lane could reach it — so the scrapers
 * that get challenged most (1337x, BitSearch, TheRARBG) answered `HTTP 403`,
 * were counted as failures, and were eventually skipped for good. The same
 * browser, the same persistent session, the same `cf_clearance`.
 *
 * Only the solvable kind gets here: `withRetry` asks once, for a verdict
 * `botChallenge.ts` has already decided a browser can pass. A WAF block or a
 * rate limit never opens a window.
 *
 * The User-Agent is returned alongside the cookie because a `cf_clearance` is
 * bound to the one that earned it — reissuing the request under our default UA
 * would be challenged again, which is indistinguishable from the bypass having
 * failed.
 */
setChallengeSolver(async (url, { stale }) => {
  // A clearance the site just refused is dropped first, or the jar would hand
  // the same dead cookie straight back.
  if (stale) await clearance.invalidate(url);
  const answer = await clearance.get(url);
  if (!answer.ok) return null;
  return {
    cookie: Object.entries(answer.cookies)
      .map(([name, value]) => `${name}=${value}`)
      .join('; '),
    userAgent: answer.userAgent,
  };
});

/**
 * The Universal Media Compatibility Engine (PRD-37).
 *
 * Constructed here rather than beside the transcoder because it needs
 * `resilientFetch` to sniff manifests: an `.m3u8` served from a `.php` URL and an
 * `.mpd` served as `application/octet-stream` are both routine, and the only
 * reliable classifier is the first few bytes of the body.
 */
const inspectionStore = new InspectionStore(datastore);
privacyMode.onClearSession(() => inspectionStore.clearVolatile());

const playbackEngine = new PlaybackEngine({
  proxy: contentService.getProxy(),
  transcoder: mediaTranscoder,
  nativeEngine: () => ({ available: mpvEngine.isAvailable(), policy: nativeEnginePolicy() }),
  inspections: inspectionStore,
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
async function refreshFfmpegOptionSupport(): Promise<void> {
  /*
   * Remembered per binary, and asked off the main thread when it has to be
   * asked. Spawning an 87MB ffmpeg from here blocked the loop ~590ms per binary
   * on a cold cache — the 1.1–1.8s freeze every cold launch log recorded as its
   * worst stall. See `media/toolCapabilities.ts`.
   */
  const file = storage.cacheFile('cs3-ffmpeg-capabilities.json');
  let known: ToolCapabilities = {};
  try {
    known = (JSON.parse(fs.readFileSync(file, 'utf8')) as ToolCapabilities) ?? {};
  } catch {
    known = {};
  }
  const next: ToolCapabilities = {};

  const ffprobe = mediaTranscoder.resolveFfprobe();
  const probeId = ffprobe ? fingerprintOf(ffprobe) : null;
  if (ffprobe && probeId) {
    if (known.ffprobe && sameBinary(known.ffprobe, probeId)) {
      setFfmpegExtensionPicky(known.ffprobe.extensionPicky);
      next.ffprobe = known.ffprobe;
    } else {
      let complete = true;
      const extensionPicky = await detectExtensionPicky(ffprobe, async (command, args, timeoutMs) => {
        const result = await runToolOffThread(command, args, timeoutMs);
        complete = answered(result);
        return result;
      });
      // A timeout is not an answer, and remembering it as "unsupported" would
      // hold until the binary changed.
      if (complete) next.ffprobe = { ...probeId, extensionPicky };
    }
  }

  /**
   * `zscale` is asked of ffmpeg rather than ffprobe: it is a filter, and only
   * ffmpeg lists filters. Same reasoning as the option above — a filter this
   * binary does not have fails the whole command line, so the HDR tone-map is
   * only ever emitted where it will run.
   */
  const ffmpeg = mediaTranscoder.resolveFfmpeg();
  const mpegId = ffmpeg ? fingerprintOf(ffmpeg) : null;
  if (ffmpeg && mpegId) {
    if (known.ffmpeg && sameBinary(known.ffmpeg, mpegId)) {
      setFfmpegToneMapSupport(known.ffmpeg.toneMap);
      next.ffmpeg = known.ffmpeg;
    } else {
      let complete = true;
      const toneMap = await detectToneMapSupport(ffmpeg, async (command, args, timeoutMs) => {
        const result = await runToolOffThread(command, args, timeoutMs);
        complete = answered(result);
        return result;
      });
      if (complete) next.ffmpeg = { ...mpegId, toneMap };
    }
  }

  try {
    fs.writeFileSync(file, JSON.stringify(next), 'utf8');
  } catch {
    // Asked again next launch; nothing is lost but the saving.
  }
}
// Not called here. At module scope it would run before `app.whenReady()`,
// competing for disk with the very module loading that delays the window. The
// background queue runs it once the window is up; `resolveFfprobe` answers from
// a path check, so nothing that needs the result earlier is blocked on this.

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
    logger.fatal('app', 'uncaught_exception', { error: error.message, stack: error.stack?.slice(0, 2000) });
    diagnostics.record({
      level: 'error',
      stage: 'runtime',
      source: 'main',
      message: describeError(error),
      detail: error instanceof Error ? error.stack : undefined,
    });
    diagnostics.flush();
    providerAnalytics.flush();
    // The ledger's write is debounced by two seconds, and the failures worth
    // keeping cluster at shutdown — a session that ended badly is exactly the
    // one whose last few seconds matter.
    issueLog.flush();
    throw error;
  });

  process.on('unhandledRejection', (reason) => {
    if (swallow(reason, 'unhandledRejection')) return;
    console.error('Unhandled rejection in main process:', reason);
    logger.error('app', 'unhandled_rejection', {
      error: describeError(reason),
      stack: reason instanceof Error ? reason.stack?.slice(0, 2000) : undefined,
    });
    diagnostics.record({
      level: 'error',
      stage: 'runtime',
      source: 'main',
      message: describeError(reason),
      detail: reason instanceof Error ? reason.stack : undefined,
    });
  });
}

installProcessGuards();

/**
 * The application menu, which was `null`.
 *
 * Removing it looked like a clean-chrome decision and cost three things:
 *
 * 1. **On macOS it removed Cut, Copy, Paste, Select All and Undo entirely.**
 *    Those are menu *roles* there, not native text-field behaviour — so `Cmd+C`
 *    did nothing in the search box, and there was no Quit item and no About.
 *    This is the reason the menu is back, and it is not a small one.
 * 2. **No zoom reset.** Chromium's `Ctrl+Wheel` zoom is live; a user who zoomed
 *    by accident had no way back without opening DevTools.
 * 3. **Every shortcut became undiscoverable**, which is why the app's own
 *    provider inspector was invisible even before F12 was being swallowed.
 *
 * Reload is deliberately absent on a packaged build for the reason given at the
 * `before-input-event` handler: it destroys live playback, and a viewer reaching
 * for browser muscle memory should not lose the film they are watching.
 */
function buildApplicationMenu(): Menu {
  const isMac = process.platform === 'darwin';

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ] as Electron.MenuItemConstructorOptions[])
      : []),
    {
      label: '&File',
      submenu: [
        {
          label: 'Open File…',
          accelerator: 'CmdOrCtrl+O',
          click: () => void openLocalMediaDialog(),
        },
        {
          id: 'incognito-toggle',
          label: 'Incognito',
          type: 'checkbox',
          checked: privacyMode.isActive(),
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => void privacyMode.setActive(!privacyMode.isActive()),
        },
        { type: 'separator' },
        {
          label: 'Settings…',
          accelerator: 'CmdOrCtrl+,',
          click: () => mainWindow?.webContents.send('app:openSettings'),
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      // The whole point on macOS: these roles are what make the standard
      // clipboard shortcuts work in a text field at all.
      label: '&Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...(isMac
          ? ([{ role: 'pasteAndMatchStyle' }, { role: 'delete' }, { role: 'selectAll' }] as Electron.MenuItemConstructorOptions[])
          : ([{ role: 'delete' }, { type: 'separator' }, { role: 'selectAll' }] as Electron.MenuItemConstructorOptions[])),
      ],
    },
    {
      label: '&View',
      submenu: [
        ...(app.isPackaged
          ? []
          : ([{ role: 'reload' }, { role: 'forceReload' }, { type: 'separator' }] as Electron.MenuItemConstructorOptions[])),
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: '&Help',
      submenu: [
        {
          label: 'Provider Inspector',
          accelerator: 'F12',
          click: () => mainWindow?.webContents.send('app:toggleInspector'),
        },
        {
          label: 'Open Log Folder',
          click: () => void shell.openPath(logger.directory()),
        },
        { type: 'separator' },
        {
          label: 'Licences',
          click: () => mainWindow?.webContents.send('app:showLicences'),
        },
      ],
    },
  ];

  return Menu.buildFromTemplate(template);
}

/**
 * Open a file the user already has.
 *
 * The engine has always been able to do this — `MediaProxy` serves local files
 * and the inspect→decide→play path is source-agnostic — and there was no way to
 * ask for it. So the app could download a film and then not play it, and a
 * user's own 10-bit HEVC MKV, the exact file this engine exists for, could not
 * be opened at all.
 *
 * The renderer does the opening, through `media:prepare` like every other
 * source. Nothing here hands back a raw URL (INV-RACE-1).
 */
async function openLocalMediaDialog(): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open a video or torrent',
    properties: ['openFile'],
    filters: [
      {
        // Both in one filter, because "open" is one gesture. The renderer sends
        // each to the handler its extension names, and each verifies.
        name: 'Video and torrents',
        extensions: [
          'mkv', 'mp4', 'avi', 'mov', 'm4v', 'webm', 'ts', 'm2ts', 'wmv', 'flv', 'mpg', 'mpeg',
          'torrent',
        ],
      },
      { name: 'Torrent', extensions: ['torrent'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) return;
  mainWindow.webContents.send('app:openLocalFile', result.filePaths[0]);
}

/** Where the window was last time, so it opens where it was left. */
interface WindowBounds {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized: boolean;
}

const WINDOW_BOUNDS_KEY = 'window_bounds';
const DEFAULT_BOUNDS: WindowBounds = { width: 1360, height: 860, maximized: false };

/**
 * Restore the window where the user left it — on a display that still exists.
 *
 * The clamp is the part that matters and the part usually left out. A window
 * remembered at x=2400 on a second monitor is, once that monitor is unplugged,
 * *invisible*: it opens off-screen with no way to reach it and the app looks
 * like it failed to start. This app already learned that lesson for the mini
 * player (`useMiniFrame` clamps on window resize); it is the same lesson.
 */
function loadWindowBounds(): WindowBounds {
  try {
    const stored = datastore.getObject<WindowBounds>(WINDOW_BOUNDS_KEY, DEFAULT_BOUNDS);
    if (!stored || typeof stored.width !== 'number' || typeof stored.height !== 'number') {
      return DEFAULT_BOUNDS;
    }
    const bounds: WindowBounds = {
      width: Math.max(960, Math.round(stored.width)),
      height: Math.max(640, Math.round(stored.height)),
      maximized: Boolean(stored.maximized),
    };
    if (typeof stored.x === 'number' && typeof stored.y === 'number') {
      const visible = screen.getAllDisplays().some((display) => {
        const a = display.workArea;
        // Any meaningful overlap counts: a window half off the edge of a display
        // is still reachable, and refusing that would be its own annoyance.
        return (
          stored.x! < a.x + a.width &&
          stored.x! + bounds.width > a.x &&
          stored.y! < a.y + a.height &&
          stored.y! + bounds.height > a.y
        );
      });
      if (visible) {
        bounds.x = Math.round(stored.x);
        bounds.y = Math.round(stored.y);
      }
    }
    return bounds;
  } catch {
    return DEFAULT_BOUNDS;
  }
}

function saveWindowBounds(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    // `getNormalBounds` rather than `getBounds`: the latter reports the
    // maximized rectangle, so un-maximizing after a restart would restore to a
    // full-screen-sized "restored" window and the un-maximize would do nothing.
    const normal = mainWindow.getNormalBounds();
    datastore.setObject(WINDOW_BOUNDS_KEY, {
      x: normal.x,
      y: normal.y,
      width: normal.width,
      height: normal.height,
      maximized: mainWindow.isMaximized(),
    } satisfies WindowBounds);
  } catch {
    // Losing a window position is never worth throwing over.
  }
}

/**
 * One line per launch, so startup is measurable without anyone opening a panel.
 *
 * Written from a user's captured log, which is the only place a slow machine's
 * numbers ever come from — and that is why it is a single record with fixed
 * field names rather than the whole profile: it has to survive being grepped.
 *
 * Fired by whichever of `ready-to-show` and `did-finish-load` happens *second*,
 * and guarded so it happens once. Those two arrive in either order — measured,
 * `did-finish-load` came first — and logging from a fixed one of them reported
 * `firstPaintMs: -1` for a paint that had simply not happened yet.
 *
 * `blockedMs` is the figure to read first. It is the part a viewer experiences
 * as the window greying out, and the only one here that tells an app which was
 * busy apart from one which had stopped answering.
 */
let startupReported = false;

function reportStartupOnce(): void {
  if (startupReported) return;
  if (startup.snapshot().marks.first_paint === undefined) return;
  if (startup.snapshot().marks.interactive === undefined) return;
  startupReported = true;
  startup.finish();

  const profile = startup.snapshot();
  const worst = [...profile.stalls].sort((a, b) => b.durationMs - a.durationMs)[0];
  logger.info('app', 'startup_complete', {
    beforeMainMs: Math.round(profile.beforeMainMs ?? -1),
    modulesMs: Math.round(profile.marks.modules_loaded ?? -1),
    readyMs: Math.round(profile.marks.app_ready ?? -1),
    firstPaintMs: Math.round(profile.marks.first_paint ?? -1),
    interactiveMs: Math.round(profile.marks.interactive ?? -1),
    blockedMs: Math.round(profile.stalledMs),
    stalls: profile.stalls.length,
    // Named, because "something blocked for half a second" is not actionable
    // and "constructServices blocked for half a second" is.
    worstStall: worst ? (worst.during ?? 'uninstrumented') : null,
    worstStallMs: worst ? Math.round(worst.durationMs) : 0,
  });
}

function createWindow() {
  const bounds = loadWindowBounds();

  mainWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: 960,
    minHeight: 640,
    title: APP_TITLE,
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

  // Preserve proper contextual branding and avoid raw dev/bundle titles leaking
  mainWindow.on('page-title-updated', (event, title) => {
    event.preventDefault();
    const cleanTitle = title?.trim();
    if (
      cleanTitle &&
      cleanTitle !== 'cs3_windows' &&
      cleanTitle !== 'CloudStream 3 Desktop' &&
      cleanTitle !== 'CloudStream 3' &&
      cleanTitle !== 'CloudStream 3 Desktop [Dev]' &&
      cleanTitle !== 'CloudStream 3 Desktop (Dev)'
    ) {
      mainWindow?.setTitle(`${cleanTitle} — ${APP_TITLE}`);
    } else {
      mainWindow?.setTitle(APP_TITLE);
    }
  });

  if (bounds.maximized) mainWindow.maximize();

  // Debounced, because `resize` and `move` fire continuously while dragging and
  // this writes through the datastore, which is the user's backup file.
  let boundsTimer: NodeJS.Timeout | null = null;
  const rememberBounds = () => {
    if (boundsTimer) clearTimeout(boundsTimer);
    boundsTimer = setTimeout(saveWindowBounds, 400);
    boundsTimer.unref?.();
  };
  mainWindow.on('resize', rememberBounds);
  mainWindow.on('move', rememberBounds);
  mainWindow.on('maximize', rememberBounds);
  mainWindow.on('unmaximize', rememberBounds);
  // Closing is the one moment the position definitely matters, and the debounce
  // above will not have fired for whatever the user did in the last 400ms.
  mainWindow.on('close', () => {
    if (boundsTimer) clearTimeout(boundsTimer);
    saveWindowBounds();
  });

  Menu.setApplicationMenu(buildApplicationMenu());
  // Hidden behind Alt on Windows and Linux, so the app keeps its clean chrome
  // while every command above stays reachable and discoverable.
  mainWindow.setAutoHideMenuBar(true);
  mainWindow.setMenuBarVisibility(false);

  /**
   * Developer shortcuts, and two rules that are easy to get wrong.
   *
   * **F12 is not bound here.** It used to toggle Chromium DevTools *and* call
   * `preventDefault()`, which suppresses the page keyboard event — so the
   * renderer's own F12 handler never fired and `ProviderInspector`, which has no
   * other entry point, was unreachable. DevTools is `Ctrl+Shift+I` only; F12
   * belongs to the app's own inspector.
   *
   * **Reload is gated on a packaged build.** `Ctrl+R` is muscle memory from a
   * browser, and in a packaged app it destroys the renderer: playback stops, the
   * open page is lost, an in-flight search is abandoned. A viewer reaching for it
   * while typing in the search box should not lose the film they are watching.
   * DevTools stays available everywhere — this app's whole diagnostic story
   * depends on being able to open it on a user's machine.
   */
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;

    // F5 or Ctrl+R / Cmd+R -> Reload window. Development builds only.
    if ((input.key.toLowerCase() === 'r' && (input.control || input.meta)) || input.key === 'F5') {
      if (!app.isPackaged) {
        if (input.shift) {
          mainWindow?.webContents.reloadIgnoringCache();
        } else {
          mainWindow?.webContents.reload();
        }
      }
      event.preventDefault();
    }
    // Ctrl+Shift+I / Cmd+Option+I -> Toggle Chromium DevTools.
    if (input.key.toLowerCase() === 'i' && (input.control || input.meta) && input.shift) {
      mainWindow?.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  /**
   * The window appears when the renderer has something to paint.
   *
   * `ready-to-show` rather than `show: true`, because a window shown before its
   * first paint is a white rectangle — and with `backgroundColor` set the wait
   * costs nothing visible. What made this slow was never the event: it was how
   * much the renderer had to evaluate before it fired. The renderer now splits
   * its routes, so this arrives with the home screen rather than with every
   * screen in the app.
   */
  mainWindow.once('ready-to-show', () => {
    startup.mark('first_paint');
    mainWindow?.show();
    reportStartupOnce();
  });

  /*
   * A launch argument is delivered once the *renderer* exists, not when the
   * window does. `app:openLocalFile` is a `webContents.send`, and a send to a
   * page that has not run its subscription yet is dropped with no error — so
   * double-clicking a `.torrent` would open the app to the home screen and
   * silently forget what was asked for.
   */
  mainWindow.webContents.once('did-finish-load', () => {
    /**
     * Startup ends when the app is usable, not when it has finished loading.
     *
     * The background queue keeps working for another half-minute after this;
     * folding that in would make the headline number *grow* every time work was
     * moved off the critical path, which is exactly backwards. The queue
     * reports its own progress separately.
     */
    startup.mark('interactive');
    reportStartupOnce();
    deliverPendingOpen();
  });

  // External links open in the system browser, never in-app (SEC-7 / DSK-36).
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  /**
   * The window may never navigate away from the app it is showing.
   *
   * `setWindowOpenHandler` covers `window.open` and target=_blank; it does not
   * cover a top-level navigation, and Electron's default for one is to perform
   * it. **Dropping a file on the window is a top-level navigation** — and for a
   * media player, dragging a video onto the picture is the most natural gesture
   * a user has. The React app would be replaced by the file, and with no
   * application menu there is no View → Reload to get back: the app is bricked
   * until it is relaunched.
   *
   * The renderer's own drop handler still sees the event (see `src/main.tsx`),
   * so opening a dropped file remains possible — it just goes through
   * `media:prepare` like every other source rather than through the address bar.
   */
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const current = mainWindow?.webContents.getURL();
    if (current && url !== current) {
      event.preventDefault();
      // A dragged http(s) link is a link, and links open in the browser.
      if (/^https?:\/\//.test(url) && !url.startsWith('http://127.0.0.1')) {
        void shell.openExternal(url);
      }
    }
  });

  // A subframe cannot navigate the app away either.
  mainWindow.webContents.on('will-frame-navigate', (event) => {
    if (event.isMainFrame) return;
    event.preventDefault();
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

/**
 * A `.torrent` or magnet given on the command line, or by a file association.
 *
 * Windows passes both as ordinary `argv` entries, so this is one scan rather
 * than two mechanisms. Electron's own switches are skipped: `--inspect` and the
 * rest are not files, and a naive "last argument" read opens whatever flag the
 * launcher happened to append.
 */
function openableFromArgv(argv: string[]): string | null {
  for (const argument of argv.slice(1)) {
    if (argument.startsWith('-')) continue;
    if (/^magnet:\?/i.test(argument)) return argument;
    if (/\.torrent$/i.test(argument)) return argument;
    // A share link arrives the same way on Windows: as an argv entry, because
    // the registered protocol handler is this executable.
    if (new RegExp(`^${SHARE_SCHEME}://`, 'i').test(argument)) return argument;
  }
  return null;
}

/** Held until the renderer exists, since a launch beats the window. */
let pendingOpen: string | null = openableFromArgv(process.argv);

/**
 * Hands whatever we were launched with to the renderer.
 *
 * Two kinds travel this one path because they arrive by the same mechanisms — a
 * command-line argument on Windows, `open-file`/`open-url` on macOS — and
 * splitting them into two pending slots would mean a share link and a dropped
 * torrent could each silently discard the other.
 *
 * They are told apart *here* rather than in the renderer, because the channel a
 * message arrives on is what the renderer keys its behaviour on, and a single
 * channel carrying two unrelated payload shapes is how one of them ends up
 * handled by the wrong screen.
 */
function deliverPendingOpen(): void {
  if (!pendingOpen || !mainWindow || mainWindow.isDestroyed()) return;
  const target = pendingOpen;
  pendingOpen = null;
  /**
   * Two literal sends rather than one computed channel name.
   *
   * `ipcSurface.test.mts` pins the channel surface by scanning for these
   * literals on both sides, and a computed name is invisible to it — which is
   * how a channel ends up sent and never listened for. The duplication is the
   * price of that guarantee, and it is two lines.
   */
  if (new RegExp(`^${SHARE_SCHEME}://`, 'i').test(target)) {
    mainWindow.webContents.send('app:openShareLink', target);
  } else {
    mainWindow.webContents.send('app:openLocalFile', target);
  }
}

/*
 * One instance, and a second launch hands its argument to the first.
 *
 * Without this, double-clicking a second `.torrent` starts a whole second app:
 * two windows, two sidecars, two torrent clients contending for one cache
 * directory — which is the locked-cache failure `before-quit` already exists to
 * prevent, arriving from the other direction.
 */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    pendingOpen = openableFromArgv(argv) ?? pendingOpen;
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      deliverPendingOpen();
    }
  });
}

// macOS delivers an associated file this way rather than through argv.
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  pendingOpen = filePath;
  deliverPendingOpen();
});

// And a magnet or a share link, which arrive as a protocol rather than a file.
app.on('open-url', (event, url) => {
  event.preventDefault();
  pendingOpen = url;
  deliverPendingOpen();
});

/**
 * Registering as the handler for `cloudstream://`.
 *
 * Done unconditionally rather than only when packaged, because the dev build is
 * where the flow is actually exercised — but the dev build is launched *through*
 * Electron, so Windows has to be told which executable and which argument to
 * pass, or it registers `electron.exe` with no script and the link opens an
 * empty app.
 *
 * Failure here is not fatal and is deliberately quiet: on Linux this depends on
 * a desktop entry the packager owns, and an app that refused to start because
 * it could not claim a protocol would be worse than one that cannot be opened
 * from a chat window.
 */
function registerShareProtocol(): void {
  try {
    if (process.defaultApp && process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(SHARE_SCHEME, process.execPath, [
        path.resolve(process.argv[1]),
      ]);
    } else {
      app.setAsDefaultProtocolClient(SHARE_SCHEME);
    }
  } catch {
    // Sharing still works; only opening a link from outside the app does not.
  }
}
registerShareProtocol();

/**
 * The work that happens after the window is on screen.
 *
 * Constructed here rather than inside `whenReady` so a service can register a
 * task from its own module-scope wiring; nothing runs until `start()`.
 */
const background = new StartupQueue((task) => {
  if (task.state === 'failed') {
    // A background service that never came up is a feature that is missing,
    // not a launch that failed. Recorded so the next session can see it; the
    // app is already running without it.
    logger.warn('app', 'startup_task_failed', {
      task: task.id,
      attempts: task.attempts,
      error: task.error,
    });
  } else {
    logger.debug('app', 'startup_task_done', {
      task: task.id,
      durationMs: task.durationMs ?? undefined,
    });
  }
});

endServiceGraph();
startup.mark('services_constructed');

app.whenReady().then(async () => {
  startup.mark('app_ready');
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

  startup.stage('createWindow', () => createWindow());

  downloadService.setProgressCallback((tasks: DownloadTask[]) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('download:progress', tasks);
    }
  });

  void downloadService.start().catch((e) => {
    console.warn('DownloadService lazy-start warning:', e);
  });

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
    // Installs and updates both come through here, so one listener feeds the
    // job tray for both. An error carries no step: the job's own outcome says it.
    extensionJobs.progress(`ext:${progress.internalName}`, {
      percent: progress.percent,
      step: JOB_STEP_LABEL[progress.step],
    });
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
  bootstrap.start(app.getLocale());

  /**
   * The cold JVM load, moved off the path where anyone is waiting for it.
   *
   * Providers are addressable the moment the app starts — they hydrate from
   * `cs3-provider-registry.json` — but calling one still needs its archive live
   * in the JVM, and that is where the real cost is: **57 seconds of class
   * loading across a 124-archive install**, almost none of it the plugins' own
   * work. `ensureProviderActive` will pay it per-archive on demand, which is
   * already far better than the 66.8s the first search used to cost. This is
   * better again: the same work, done while the viewer is reading the home
   * screen, so by the time they search most of it is done.
   *
   * Deliberately late and deliberately not awaited. It must not delay the first
   * frame, and it must not delay `bootstrap` above it — on a first run there is
   * nothing installed yet to warm, and the archives bootstrap installs are
   * loaded by bootstrap's own pass.
   *
   * The delay is not tuning. It is the same reasoning as `SourcePrefetcher`'s
   * settle: a window that has just opened is still laying out, and starting a
   * JVM plus 56 jars of class loading underneath it competes with exactly the
   * thing the user is looking at.
   */
  /**
   * Everything expensive that is not needed for the first frame.
   *
   * Both of these used to be a bare `setTimeout` with a hand-picked delay, and
   * the delays were the only thing keeping them apart. A queue makes the order
   * explicit instead, runs one task at a time with the loop given a turn in
   * between, and keeps a failure from costing anything but that one feature —
   * see `util/startupQueue.ts` for why the default lane is serial.
   *
   * The priorities are the order a viewer notices them in. Providers first,
   * because a search is what people do after the home screen; the torrent
   * client after, because a Play press is later still and its own
   * `ensureStarted` covers the case where it has not got there yet.
   */
  background.add({
    id: 'ffmpeg-options',
    label: 'Checking which options this ffmpeg build understands',
    priority: 80,
    // Its own lane: two short-lived child processes that share nothing with the
    // JVM warm-up or the DHT bootstrap, and holding the serial lane for them
    // would delay both for no reason.
    lane: 'media',
    run: () => refreshFfmpegOptionSupport(),
  });

  background.add({
    id: 'providers',
    label: 'Loading installed extensions',
    priority: 70,
    delayMs: PROVIDER_WARMUP_DELAY_MS,
    /**
     * Its own lane. On the serial one the torrent client queued behind the
     * whole warm-up — measured at fourteen minutes on a 468-archive install
     * whose JVM had run out of memory — so a magnet pressed in that window paid
     * the cold start the warm-up was supposed to have done. The JVM is touched
     * by nothing else in this queue, so serial within the lane is all the
     * ordering provider loading needs.
     */
    lane: 'extensions',
    // The providers people actually use load first; a search before the pass
    // finishes then usually finds its archives already live.
    run: () =>
      pluginManager.warmProviders({
        usage: (name) => {
          const record = providerAnalytics.get(name);
          return record ? providerAnalytics.totalSamples(record) : 0;
        },
      }),
  });

  background.add({
    id: 'torrent-engine',
    label: 'Starting the torrent client',
    priority: 40,
    delayMs: TORRENT_WARMUP_DELAY_MS,
    // `startStream` calls `ensureStarted` itself, so a failed warm-up costs
    // latency on the first play and nothing else — but a transient bind failure
    // is worth one more try before the first Play pays for it.
    retries: 1,
    run: () => torrentEngine.warmUp(),
  });

  // Every catalogue card opens from a stored listing, so the first expand of a
  // session never says "Reading the list…". Own lane: it shares nothing with
  // the JVM warm-up, and one failing repository costs only itself.
  background.add({
    id: 'storage-sweep',
    label: 'Tidying the app’s cache and temporary files',
    priority: 10,
    delayMs: 45_000,
    lane: 'storage',
    run: runStorageSweep,
  });

  background.add({
    id: 'repository-listings',
    label: 'Refreshing the lists of add-ons you can install',
    priority: 20,
    delayMs: 20_000,
    lane: 'catalogue',
    run: async () => {
      const day = 24 * 60 * 60 * 1000;
      for (const repository of bootstrap.visibleRepositories()) {
        if (repositoryListings.isFresh(repository.url, day)) continue;
        try {
          repositoryListings.put(
            repository.url,
            await pluginManager.fetchRepository(repository.url, { remember: false })
          );
        } catch {
          // An unreachable repository keeps whatever listing it already has.
        }
      }
    },
  });

  background.start();

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

/**
 * Closing the last window is not the same thing as quitting.
 *
 * This used to tear down the download queue, the extension updater and the JVM
 * sidecar *unconditionally*, with only `app.quit()` guarded by platform. On
 * macOS the app then stayed alive in the dock holding a dead sidecar and a
 * stopped queue, and `activate` opened a fresh window onto all of it — zero
 * providers, every search empty, downloads silently halted, and nothing on
 * screen explaining any of it. Every teardown now lives in `before-quit`, which
 * is the event that actually means "we are going away".
 */
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/** How long the whole shutdown may take before the process leaves anyway. */
const SHUTDOWN_DEADLINE_MS = 5_000;

/**
 * Tear down everything that owns a socket, a file handle, a timer or a child
 * process. Ordered cheapest-first so a hang late in the list still lets the
 * earlier flushes land.
 */
async function shutdownServices(): Promise<void> {
  // Nothing else may schedule work once we are going away.
  background.stop();
  downloadService.stop();
  extensionUpdater.stop();
  // Installs already running finish or die with the sidecar; nothing new starts.
  extensionJobs.cancelQueued();
  /**
   * The datastore's writes are coalesced on a 250ms timer now, so the last
   * change of a session — a window position, a finished episode, a setting just
   * changed — is routinely still in memory when quit arrives. Flushed first,
   * before the teardowns that can hang, so it is durable even when the deadline
   * below fires.
   */
  datastore.flushSync();
  diagnostics.flush();
  providerAnalytics.flush();
  // The pages opened in the last few seconds of a session are the ones most
  // likely to be reopened in the first few of the next.
  pageSnapshots.flush();
  // A search saved a moment before quitting is one the viewer expects to find.
  savedSearches.flush();
  // The ledger's write is debounced, and the failures worth keeping cluster at
  // shutdown — a session that ended badly is the one whose last seconds matter.
  issueLog.flush();
  // Cast lists arrive over seconds and the write is debounced, so a viewer who
  // opens a title and quits would otherwise re-fetch four hosts next launch.
  metadataEnrichment.flush();
  // Streaming-service rows fetched this session draw instantly next launch.
  catalogueCache.flush();
  repositoryListings.flush();
  mediaTranscoder.shutdown();
  contentService.shutdown();
  // Imported torrents are debounced to disk; without this the last few opens
  // are lost on a clean quit, which reads as the list forgetting them.
  torrentImports.shutdown();
  // Hidden windows keep running their pages — timers, requests and all — with
  // nothing on screen to reveal them.
  webViewHost.destroy();
  // The sidecar is a child process; leaving it running orphans a JVM.
  pluginManager.shutdown();
  // A child process with its own window: without this it survives the app and
  // keeps playing, with nothing left on screen to stop it.
  await mpvEngine.shutdown();
  // A controlled VLC is our child process; without this it outlives the app.
  await externalPlayers.shutdown();
  // The torrent client holds sockets and file handles; tearing it down cleanly
  // prevents a zombie process and a locked cache directory on next launch.
  await torrentEngine.destroy();
}

let quitting = false;

app.on('before-quit', async (event) => {
  if (quitting) return;
  quitting = true;
  event.preventDefault();
  privacyMode.shutdown();

  /**
   * Shutdown is raced against a deadline, and that is not belt-and-braces.
   *
   * WebTorrent's `destroy()` and an unresponsive mpv both hang in the wild, and
   * this handler is the only thing between them and the process exiting. When
   * one hung, the window was gone and the process was not, and the user's only
   * recourse was Task Manager — after which the next launch hit the locked cache
   * directory this very handler exists to prevent.
   *
   * Which service was still pending is logged, because that is the fact that
   * makes the *next* fix possible and it costs one line.
   */
  let settled = false;
  try {
    await Promise.race([
      shutdownServices().then(() => {
        settled = true;
      }),
      new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_DEADLINE_MS)),
    ]);
    if (!settled) {
      logger.warn('app', 'shutdown_timeout', { deadlineMs: SHUTDOWN_DEADLINE_MS });
    }
  } catch (error) {
    // Never block quit on a failed teardown. It is still worth recording,
    // because a service that throws here is one that leaked something — and the
    // next launch is where that shows up.
    logger.warn('app', 'shutdown_incomplete', {
      error: describeError(error),
    });
  }
  // Every service has let go of its working files by now. Anything still
  // locked stays, and the next launch's sweep removes it.
  storage.disposeSession();
  // Last, and synchronous: nothing after this point gets written.
  logger.shutdown();
  app.exit(0);
});

/** Normalises a thrown value into an IPC-safe result envelope. */
function fail(error: unknown): { ok: false; error: string } {
  return { ok: false, error: describeError(error) };
}

/**
 * Card states for one screen's worth of rows.
 *
 * Batched rather than per card, for `api:getProviderProvenanceMap`'s reason: a
 * catalogue page is forty posters, and forty round trips to read five in-memory
 * maps is the cost of drawing one screen.
 */
ipcMain.handle('interactions:summarise', async (_, queries: TitleInteractionQuery[]) => {
  try {
    return { ok: true, interactions: titleInteractions.summarise(queries ?? []) };
  } catch (error) {
    return { ...fail(error), interactions: {} };
  }
});

/**
 * Records that a details page was opened.
 *
 * Takes the title and year rather than the address: the record is about the
 * work, so the same film opened from a search result and from a home rail is
 * one visit and dims both cards.
 */
ipcMain.handle('interactions:visit', async (_, title: string, year?: number) => {
  try {
    return { ok: true, visit: titleInteractions.recordVisit(title, year) };
  } catch (error) {
    return { ...fail(error), visit: null };
  }
});

/** Forgets which titles have been opened. The only control over this ledger. */
ipcMain.handle('interactions:clearVisits', async () => {
  try {
    return { ok: true, cleared: titleInteractions.clearVisits() };
  } catch (error) {
    return { ...fail(error), cleared: 0 };
  }
});

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
 * The fan-out behind the search box, so a superseded one can be dropped.
 *
 * One controller, not a map: a search box has exactly one current query, and
 * every keystroke makes the previous one worthless. Without this, typing
 * "spider man" leaves nine fan-outs running against three third-party hosts and
 * the answers for "spid" arrive to be discarded — which is the cost the
 * renderer's debounce was trying, and failing, to control on its own.
 */
let suggestRun: AbortController | null = null;

/**
 * Title autocomplete. Called on every debounced keystroke, so it never rejects
 * and never blocks — an empty list is an acceptable answer for a search box.
 *
 * **Answers immediately and finishes later.** The reply carries whatever is
 * already known (this query's cached rows, or a shorter query's re-filtered),
 * and `search:suggestUpdate` carries each catalogue as it lands. Measured, the
 * three catalogues answer 170–935 ms apart, so a reply that waited for all of
 * them would spend the fastest two on the slowest — see `searchSuggestions.ts`.
 */
ipcMain.handle('api:suggest', async (event, query: string) => {
  suggestRun?.abort();
  const run = new AbortController();
  suggestRun = run;

  const trimmed = (query ?? '').trim();
  const instant = searchSuggestions.instant(trimmed);

  if (!instant.done) {
    // The asking window, not `mainWindow`: an update belongs to whoever typed.
    const webContents = event.sender;
    void searchSuggestions
      .suggest(trimmed, run.signal, (suggestions, done) => {
        // The query travels with the rows: this outlives the keystroke that
        // asked for it, and a reply landing on a box that now says something
        // else must be dropped rather than rendered.
        if (run.signal.aborted || webContents.isDestroyed()) return;
        webContents.send('search:suggestUpdate', { query: trimmed, suggestions, done });
      })
      .catch(() => {
        // A catalogue outage is not an error for a search box, and there is no
        // longer a caller waiting on this promise to reject to.
      });
  }

  return { ok: true, suggestions: instant.suggestions, done: instant.done };
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
  'subtitles:find',
  async (_, query: SubtitleQuery & { mediaUrl?: string }) => {
    try {
      const mediaUrl = query?.mediaUrl;
      // Asked in parallel with the catalogues, never instead of them.
      const providerResults: Promise<SubtitleSearchResult[]> = mediaUrl?.startsWith('cs3ext://')
        ? pluginManager
            .loadSubtitles(mediaUrl)
            .then((entries) =>
              entries.map((entry) => ({
                id: `provider:${entry.url}`,
                lang: entry.lang,
                langName: languageName(entry.lang),
                url: entry.url,
                origin: 'provider' as const,
              }))
            )
            .catch(() => [])
        : Promise.resolve([]);
      const found = await subtitles.find(query ?? {}, providerResults);
      return { ok: true, ...found };
    } catch (error) {
      return { ...fail(error), results: [], sources: undefined };
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

/**
 * Subtitles kept on disk for reuse. `download` fetches (or takes the VTT the
 * renderer already has), converts and saves; a second press on the same result
 * answers with the existing file unless `refresh` is set. Failures here never
 * touch playback — the renderer already has the cues it is showing.
 */
ipcMain.handle(
  'subtitles:download',
  async (_, request: Omit<SubtitleSaveRequest, 'vtt'> & { vtt?: string }) => {
    try {
      if (!request?.title || !request.sourceUrl) throw new Error('A subtitle needs a title and a source to be saved.');
      const existing = request.refresh ? undefined : subtitleLibrary.findBySource(request.sourceUrl);
      if (existing) return { ok: true, entry: existing, reused: true };
      const vtt = request.vtt || (await subtitles.fetchAsVtt(request.sourceUrl));
      const { entry, reused } = subtitleLibrary.save({ ...request, vtt });
      return { ok: true, entry, reused };
    } catch (error) {
      return { ...fail(error), entry: null, reused: false };
    }
  }
);

ipcMain.handle(
  'subtitles:listSaved',
  async (_, title: string, year?: number, season?: number, episode?: number) => {
    try {
      return { ok: true, entries: title ? subtitleLibrary.list(title, year, season, episode) : [] };
    } catch (error) {
      return { ...fail(error), entries: [] };
    }
  }
);

ipcMain.handle('subtitles:readSaved', async (_, id: string) => {
  const vtt = subtitleLibrary.read(id);
  return vtt === null
    ? { ok: false, error: 'That saved subtitle is no longer on disk.', vtt: '' }
    : { ok: true, vtt };
});

ipcMain.handle('subtitles:removeSaved', async (_, id: string) => ({ ok: subtitleLibrary.remove(id) }));

/** Incognito (PRD-52). Every answer is the whole state, never a delta. */
ipcMain.handle('privacy:getState', async () => privacyMode.getState());
ipcMain.handle('privacy:setActive', async (_, active: boolean) => privacyMode.setActive(active === true));
ipcMain.handle('privacy:updateSettings', async (_, partial: Partial<IncognitoSettings>) =>
  privacyMode.updateSettings(partial ?? {})
);

ipcMain.handle('api:getSearchHistory', async () => searchHistory.list());

ipcMain.handle('api:removeSearchHistory', async (_, query: string) =>
  searchHistory.remove(query)
);

ipcMain.handle('api:clearSearchHistory', async () => searchHistory.clear());

/**
 * Search results kept on request — see `savedSearches.ts` for why these are
 * safe to keep when history deliberately keeps only queries.
 *
 * The scope is taken from the caller's snapshot rather than the stored scope:
 * a search is saved as it was run, and the stored scope may have changed since.
 */
ipcMain.handle('search:saveResults', async (_, input: SaveSearchInput) => {
  try {
    if (isPrivateSession() && !allowsExplicitSaves()) {
      return { ok: false, error: 'Explicit saves are disabled in Incognito mode.', saved: null };
    }
    const saved = savedSearches.save(input);
    return saved
      ? { ok: true, saved }
      : { ok: false, error: 'There were no results to save.', saved: null };
  } catch (error) {
    return { ...fail(error), saved: null };
  }
});

ipcMain.handle('search:listSaved', async () => savedSearches.list());

ipcMain.handle('search:getSaved', async (_, id: string) => {
  const search = savedSearches.get(id);
  if (search) contentService.rememberSearchRows(search.results);
  return search;
});

ipcMain.handle('search:removeSaved', async (_, id: string) => savedSearches.remove(id));

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

// --- the extension issue ledger --------------------------------------------

/**
 * `issues:*` is the "what is actually broken" surface.
 *
 * Distinct from `log:*` and `diagnostics:*` in what it answers rather than in
 * how it is stored. The log says what happened and in what order; the
 * diagnostics say enough about one failure to hand it to a maintainer; this
 * says **how many distinct problems there are and which of them matter**, which
 * is the only one of the three that can be acted on as a list.
 */
ipcMain.handle('issues:list', async (_, query?: IssueQuery) => {
  try {
    return {
      ok: true,
      issues: issueLog.list(query ?? {}),
      summary: issueLog.summary(),
      sources: issueLog.bySource(),
    };
  } catch (error) {
    return { ...fail(error), issues: [], summary: [], sources: [] };
  }
});

/**
 * Triage, kept rather than deleted.
 *
 * A muted row that starts happening again is the regression signal; deleting it
 * means the next occurrence looks new and gets investigated a second time.
 */
ipcMain.handle(
  'issues:annotate',
  async (_, id: string, changes: { muted?: boolean; note?: string }) => {
    try {
      return { ok: issueLog.annotate(id, changes ?? {}) };
    } catch (error) {
      return fail(error);
    }
  }
);

ipcMain.handle('issues:report', async () => {
  try {
    return {
      ok: true,
      report: issueLog.report({
        app: app.getVersion(),
        electron: process.versions.electron,
        platform: `${process.platform}-${process.arch}`,
      }),
    };
  } catch (error) {
    return { ...fail(error), report: '' };
  }
});

ipcMain.handle('issues:clear', async () => {
  try {
    return { ok: true, removed: issueLog.clear() };
  } catch (error) {
    return { ...fail(error), removed: 0 };
  }
});

// --- the structured log ----------------------------------------------------

/**
 * `log:*` is the developer-facing surface, deliberately thin.
 *
 * The log's job is to be on disk when something goes wrong, not to be browsed;
 * a large UI over it would be effort spent on the wrong half. What is exposed
 * is what a person actually needs at the moment they are debugging: query the
 * recent past, find the file, open the folder, and turn the level up for the
 * next reproduction attempt.
 */
ipcMain.handle(
  'log:query',
  async (
    _,
    filter?: {
      level?: LogLevel;
      scopes?: LogScope[];
      event?: string;
      search?: string;
      since?: number;
      limit?: number;
    }
  ) => {
    try {
      return {
        ok: true,
        records: logger.query(filter ?? {}),
        session: logger.session,
        level: logger.level,
        file: logger.logFile,
      };
    } catch (error) {
      return { ...fail(error), records: [], session: '', level: 'info' as LogLevel, file: '' };
    }
  }
);

ipcMain.handle('log:sessions', async () => {
  try {
    // Flushed first, or the current session under-reports its own size by
    // however much is sitting in the write buffer.
    logger.flush();
    return { ok: true, sessions: logger.sessions(), directory: path.dirname(logger.logFile) };
  } catch (error) {
    return { ...fail(error), sessions: [], directory: '' };
  }
});

/**
 * The level is persisted, because the thing it is turned up for is a bug that
 * has not happened yet. A `trace` setting that reset on restart would be off
 * again by the time the user managed to reproduce anything.
 */
ipcMain.handle('log:setLevel', async (_, level: LogLevel) => {
  try {
    logger.setLevel(level);
    datastore.setString('log_level_key', level);
    logger.info('app', 'log_level_changed', { level });
    return { ok: true, level };
  } catch (error) {
    return { ...fail(error), level: logger.level };
  }
});

ipcMain.handle('log:reveal', async () => {
  try {
    logger.flush();
    shell.showItemInFolder(logger.logFile);
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
});

/**
 * The whole current session as text, for attaching to a report.
 *
 * Read back off disk rather than served from the ring: the ring holds the last
 * couple of thousand records and the file holds the session, and a report that
 * silently omits the beginning is worse than one that is large.
 */
ipcMain.handle('log:exportSession', async () => {
  try {
    logger.flush();
    const text = fs.readFileSync(logger.logFile, 'utf8');
    return { ok: true, text, file: logger.logFile };
  } catch (error) {
    return { ...fail(error), text: '', file: logger.logFile };
  }
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

/**
 * Clears the cached sources for one title or episode from its details page.
 *
 * Scoped to that title's cache entries only — `sources:clearCache` is the
 * global one in Settings. The prefetcher is told too, so the page's "ready"
 * badge does not keep describing sources that no longer exist.
 */
ipcMain.handle('sources:clearForMedia', async (_, request: SourceQuery) => {
  try {
    if (!request?.mediaUrl) return { ok: false, error: 'No title was given.', removed: 0 };
    const removed = contentService.clearCachedSources(request);
    sourcePrefetcher.forget(request);
    return { ok: true, removed };
  } catch (error) {
    return { ...fail(error), removed: 0 };
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
ipcMain.handle(
  'discover:sections',
  async (_, options?: { includeAnime?: boolean; hidden?: string[] }) => {
    try {
      const genres = topGenresFromHistory();
      const sections = await discovery.sections({
        genres,
        includeAnime: options?.includeAnime,
        hidden: Array.isArray(options?.hidden) ? options.hidden.map(String) : [],
      });
      return { ok: true, sections, personalGenres: genres };
    } catch (error) {
      return { ...fail(error), sections: [], personalGenres: [] };
    }
  }
);

/**
 * Every row the home screen could show, including the ones switched off, so
 * the row picker can offer them. Answered without fetching anything.
 */
ipcMain.handle('discover:rows', async () => {
  try {
    return { ok: true, rows: discovery.rows({ genres: topGenresFromHistory() }) };
  } catch (error) {
    return { ...fail(error), rows: [] };
  }
});

ipcMain.handle(
  'discover:more',
  async (_, section: string, cursor?: { skip?: number; page?: number }) => {
    try {
      const items = await discovery.more(section as never, {
        skip: Math.max(0, Number(cursor?.skip) || 0),
        page: Math.max(1, Number(cursor?.page) || 1),
      });
      return { ok: true, items };
    } catch (error) {
      return { ...fail(error), items: [] };
    }
  }
);

/** Forces the next fetch to hit the network. The "refresh" button. */
ipcMain.handle('discover:refresh', async () => {
  discovery.invalidate();
  return { ok: true };
});

/**
 * `home:*` is the surface over `HomeProviderRegistry`.
 *
 * `check` is separate from `list` and forced, because "is it working *now*" is
 * a different question from "what is available" and the answer to the first is
 * cached for ten minutes. Someone who has just pasted an addon URL wants it
 * probed, not told what a probe said before the URL existed.
 */
ipcMain.handle('home:listProviders', async (_, force?: boolean) => {
  try {
    return {
      ok: true,
      providers: await homeProviders.summaries(Boolean(force)),
      selected: homeProviders.selectedId,
      tmdbKeySet: homeProviders.hasTmdbKey(),
      customUrl: homeProviders.customCatalogUrl(),
    };
  } catch (error) {
    return { ...fail(error), providers: [], selected: DEFAULT_PROVIDER_ID, tmdbKeySet: false, customUrl: '' };
  }
});

/**
 * Selecting refuses a provider that is not answering, and says why.
 *
 * Accepting it and letting the home screen come up empty would make the health
 * check a decoration. The refusal can name the cause; the empty screen could
 * not.
 */
ipcMain.handle('home:selectProvider', async (_, id: string) => {
  try {
    const result = await homeProviders.select(id);
    if (result.ok) {
      // The cache is keyed by provider, so the old rows are not wrong — they
      // are someone else's catalogue, and leaving them would keep the previous
      // provider on screen until each row aged out six hours later.
      discovery.invalidateForProviderChange();
      mainWindow?.webContents.send('discover:invalidated');
    }
    return result;
  } catch (error) {
    return { ...fail(error), id: homeProviders.selectedId };
  }
});

ipcMain.handle('home:setTmdbKey', async (_, key: string) => {
  try {
    homeProviders.setTmdbKey(key);
    // Probed immediately: a key is pasted in order to find out whether it
    // works, and making the user hunt for a refresh button to learn that is a
    // gap they will read as the field not saving.
    return { ok: true, health: await homeProviders.checkOne('tmdb', true) };
  } catch (error) {
    return { ...fail(error), health: null };
  }
});

ipcMain.handle('home:setCustomCatalogUrl', async (_, url: string) => {
  try {
    homeProviders.setCustomCatalogUrl(url);
    return { ok: true, health: url.trim() ? await homeProviders.checkOne('custom', true) : null };
  } catch (error) {
    return { ...fail(error), health: null };
  }
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

/**
 * The same mapping for a whole source list, in one call.
 *
 * `provenanceOf` reads two in-memory Maps, so the cost here is entirely the IPC
 * round trip — which is why thirty rows asking individually was worth removing.
 * An unknown name still answers, with just itself: a provider that has since
 * been uninstalled must still be attributable in a list captured before it was.
 */
ipcMain.handle('api:getProviderProvenanceMap', async (_, providerNames: string[]) => {
  try {
    const provenance: Record<
      string,
      { provider: string; repositoryName?: string; extensionName?: string }
    > = {};
    for (const name of new Set((providerNames ?? []).filter(Boolean))) {
      const record = pluginManager.provenanceOf(name);
      provenance[name] = {
        provider: record.provider,
        repositoryName: record.repositoryName,
        extensionName: record.extensionName,
      };
    }
    return { ok: true, provenance };
  } catch (error) {
    return { ...fail(error), provenance: {} };
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
      if (isPrivateSession() && !allowsExplicitSaves()) {
        return { ok: false, error: 'Explicit saves are disabled in Incognito mode.', saved: false, bookmark: null };
      }
      const result = bookmarks.toggle(input);
      // Saving a page is the same statement as adding a title to the library:
      // keep the copy that lets it open. Unsaving releases it to the cache
      // again rather than deleting it — the page is still worth drawing fast.
      if (!isPrivateSession()) {
        pageSnapshots.setPinned(
          { url: input?.mediaUrl, title: input?.title, year: input?.year },
          result.saved
        );
      }
      return { ok: true, ...result };
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

// --- saved page snapshots --------------------------------------------------

/**
 * The copy of a page that lets it draw before — and without — a provider.
 *
 * Read-shaped rather than push-shaped, unlike search and playback: there is no
 * progress to stream, the answer is already on disk, and the caller wants it in
 * the same tick it decides to render. Capture is not exposed at all; it happens
 * in `ContentService.load` where every detail load already passes.
 */
ipcMain.handle(
  'pages:getSnapshot',
  async (_, query: { url?: string; title?: string; year?: number }) => {
    try {
      return { ok: true, snapshot: pageSnapshots.find(query ?? {}) };
    } catch (error) {
      return { ...fail(error), snapshot: null };
    }
  }
);

/**
 * Context only the renderer has: which search produced this page, and which
 * other addresses the merged row said would reach it.
 *
 * Marked unverified, because it is annotation rather than evidence — nothing
 * here says the page still loads, and letting it move `verifiedAt` would make
 * a stale copy claim to be fresh.
 */
ipcMain.handle('pages:remember', async (_, input: PageSnapshotInput) => {
  try {
    return { ok: true, snapshot: pageSnapshots.capture({ ...input, verified: false }) };
  } catch (error) {
    return { ...fail(error), snapshot: null };
  }
});

/**
 * Keeps a page out of the eviction pool, or lets it back in.
 *
 * Addressed by title as well as URL because the two stores that pin disagree on
 * identity: a bookmark keys on the address, the library on the canonical title.
 */
ipcMain.handle(
  'pages:setPinned',
  async (_, query: { url?: string; title?: string; year?: number }, pinned: boolean) => {
    try {
      if (pinned !== false && privacyMode.isActive() && !privacyMode.getState().settings.allowExplicitSaves) {
        return { ok: false, error: 'Saving pages is turned off in Incognito.', pinned: false };
      }
      return { ok: true, pinned: pageSnapshots.setPinned(query ?? {}, pinned !== false) };
    } catch (error) {
      return { ...fail(error), pinned: false };
    }
  }
);

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

/**
 * The one verb a user actually has: "fix it".
 *
 * `clean`, `provision` and `test` are three technical steps, and a runtime that
 * reports `stale` or names a blocked class needs all three in that order. Asking
 * someone looking at a broken extension runtime to work out which button applies
 * is asking them to understand the provisioner, and the answer is always the
 * same sequence — so this is that sequence, under the name of the outcome.
 *
 * Clean is best-effort on purpose: a first install has nothing to remove, and
 * failing the repair because the thing being repaired was absent is the opposite
 * of what was asked for.
 */
ipcMain.handle('runtime:repair', async () => {
  try {
    const provisioner = pluginManager.getSidecar().getProvisioner();
    await provisioner.cleanRuntime().catch((error) => {
      logger.warn('runtime', 'repair_clean_failed', {
        error: describeError(error),
      });
    });
    const ready = await provisioner.provisionRuntime();
    if (ready) {
      // `force`, because hydration answers from disk: without it the reload
      // re-reads the same provider descriptions and the repair changes nothing
      // observable, which is the opposite of what the caller asked for.
      await pluginManager.loadProviders(true).catch((err) => {
        console.warn('[runtime:repair] Post-repair provider load failed:', err);
      });
    }
    return { ok: ready, ready };
  } catch (error) {
    return { ...fail(error), ready: false };
  }
});

ipcMain.handle('components:getStatus', async () => {
  try {
    const runtime = pluginManager.getSidecar().getProvisioner().getStatus();
    const binaries = binaryDownloader.checkBinaries();
    const mediaReady = Boolean(binaries.ffmpeg && binaries.ffprobe);
    const downloadReady = Boolean(binaries.aria2 && binaries.ytdlp);
    const runtimeReady = Boolean(runtime.ready);

    /**
     * The native engine is deliberately not counted here.
     *
     * `missingCount` drives a "components missing" prompt, and mpv is optional
     * by design — someone who only watches H.264 web releases never needs it,
     * and nagging them into a 32 MB download to clear a warning badge would be
     * asking for bandwidth to fix a problem they do not have. `binaries.mpv` is
     * still reported so a screen that wants to show its state can.
     */
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

// --- extended metadata ---------------------------------------------------

/*
 * Cast, crew, ratings, the debut date and production notes, from the keyless
 * catalogues. Deliberately its own namespace rather than part of `api:*`:
 * `api:loadMedia` answers what the app can *play*, on the path a Play press
 * waits for, and this answers what the title *is* — four third-party hosts, on
 * a schedule nothing blocks on.
 *
 * Push-shaped for the same reason `search:*` is. `metadata:getExtended`
 * answers at once with whatever is cached, and `metadata:extendedUpdate`
 * carries a fuller record as each source lands. A request/response version
 * would spend the slowest of four hosts' latency showing a spinner over data it
 * already had.
 */
ipcMain.handle('metadata:getExtended', async (_, request: EnrichmentRequest) => {
  try {
    return { ok: true, metadata: await metadataEnrichment.enrich(request) };
  } catch (error) {
    return { ...fail(error), metadata: null };
  }
});

/**
 * What is already known, without contacting anything.
 *
 * A `peek`: the renderer uses it to decide whether to render a cast rail on
 * first paint, and a read that started a fetch would make that decision have
 * side effects.
 */
ipcMain.handle('metadata:peekExtended', async (_, url: string) => {
  const hit = metadataEnrichment.peek(url);
  return { ok: true, metadata: hit?.metadata ?? null, stale: hit?.stale ?? false };
});

/**
 * A trailer, turned into something the ordinary player can open.
 *
 * Its own channel rather than part of `metadata:*` because it answers a
 * different question at a different cost: `metadata:getExtended` is a record
 * nothing waits for, and this is a press of a play button that spawns a
 * process. Separate from `media:prepare` in the other direction — this returns
 * a *provider-level* address, proxied for its headers and not yet inspected,
 * and the renderer hands it to `media:prepare` like any other stream so that
 * channel stays the only source of a playable URL.
 */
ipcMain.handle('videos:resolve', async (_, pageUrl: string) => {
  try {
    return await contentService.resolvePromoVideo(pageUrl);
  } catch (error) {
    return { ...fail(error) };
  }
});

ipcMain.handle('metadata:clearCache', async () => {
  try {
    return { ok: true, cleared: metadataEnrichment.clear() };
  } catch (error) {
    return { ...fail(error), cleared: 0 };
  }
});

ipcMain.handle('metadata:findTrailers', async (_, title: string, year?: number) => {
  try {
    const query = `${title || ''} ${year ? year : ''} official trailer`.trim();
    const videos = await searchYouTubeTrailers(query, { maxResults: 8 });
    return { ok: true, videos };
  } catch (error) {
    return { ...fail(error), videos: [] };
  }
});

ipcMain.handle('metadata:findRelatedMedia', async (_, request: RelatedMediaSearchRequest) => {
  try {
    const res = await relatedMediaService.search(request);
    return res;
  } catch (error) {
    return { ...fail(error), results: [], cached: false };
  }
});

ipcMain.handle('ratings:get', async (_, identity: CanonicalMediaIdentity) => {
  try {
    return await mediaRatingService.getRatings(identity);
  } catch (error) {
    return { ...fail(error), ok: false, ratings: [] };
  }
});

ipcMain.handle('ratings:refresh', async (_, identity: CanonicalMediaIdentity) => {
  try {
    return await mediaRatingService.refreshRatings(identity);
  } catch (error) {
    return { ...fail(error), ok: false, ratings: [] };
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
  async (
    _,
    request: SourceQuery,
    title: string,
    episodeTitle?: string,
    options?: { persistent?: boolean; resumeKey?: string }
  ) => {
    try {
      return {
        ok: true,
        snapshot: playbackSessions.start(request, title, episodeTitle, {
          persistent: Boolean(options?.persistent),
          resume: options?.resumeKey
            ? resumePreference(options.resumeKey, request.season, request.episode)
            : undefined,
        }),
      };
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

ipcMain.handle(
  'playback:refreshSources',
  /**
   * `widen` is what turns a refresh into "look everywhere".
   *
   * Without it a refresh re-asks the providers this title was found on, which
   * is the right default and the Android behaviour. With it the search reaches
   * every enabled provider and every torrent indexer — the superset, entered
   * deliberately rather than by accident.
   */
  async (_, sessionId: string, widen = false) => {
    try {
      return { ok: true, snapshot: await playbackSessions.refresh(sessionId, { widen }) };
    } catch (error) {
      return { ...fail(error), snapshot: null };
    }
  }
);

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
    /**
     * mpv is deliberately *not* stopped here.
     *
     * Not every session owns a stream: the detail page's source picker starts
     * one through `startSourceDiscovery` purely to scrape, and stops it when the
     * picker closes. Quitting mpv on that would kill the film the viewer is
     * watching in the mini player from a screen that never played anything.
     *
     * Closing the player is the event that must close mpv, and it is handled
     * where it is known: `handleClosePlayer`, `VideoPlayer`'s unmount, and
     * `NativeEngineStage`'s teardown all call `mpv:stop` directly.
     */
    await playbackSessions.stop(sessionId, keepFiles ?? true);
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
});

ipcMain.handle(
  'playback:recordBufferHeartbeat',
  (_, sessionId: string, bufferedSeconds: number, currentBitrate?: number) => {
    try {
      playbackSessions.recordBufferHeartbeat(sessionId, bufferedSeconds, currentBitrate);
      return { ok: true };
    } catch (error) {
      return fail(error);
    }
  }
);

ipcMain.handle('playback:recordBufferStall', (_, sessionId: string) => {
  try {
    playbackSessions.recordBufferStall(sessionId);
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

ipcMain.handle('media:setProbeConfig', async (_, config: Partial<ProbeConfig>) => {
  try {
    setProbeConfig(config);
    return { ok: true, config: getProbeConfig() };
  } catch (error) {
    return fail(error);
  }
});

ipcMain.handle('media:getProbeConfig', async () => {
  return { ok: true, config: getProbeConfig() };
});

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

/**
 * Hands a stream to an external player **and keeps a channel to it** where one
 * exists.
 *
 * The capability comes back with the result so the renderer knows which player
 * it got: one it can drive, or one it can only report as running. A UI that
 * offers a seek bar it cannot honour is worse than one that says so.
 */
ipcMain.handle('external:open', async (_, playerId: string, url: string) => {
  if (playerId === 'mpv') {
    /**
     * mpv is ours already. Routing it through `MpvEngine` instead of spawning a
     * second, dumber client gets the full contract — track lists, property
     * observation, seek that reports back — from code that is already tested.
     */
    const result = await mpvEngine.open({ url, title: 'CloudStream' });
    return { ...result, capability: result.ok ? 'full' : 'none', engine: 'mpv' };
  }
  const result = await externalPlayers.openControlled(playerId, url);
  if (!result.ok) {
    diagnostics.record({
      level: 'error',
      stage: 'playback',
      source: playerId,
      url,
      message: result.error ?? 'The external player could not be started.',
    });
  }
  return { ...result, engine: 'external' };
});

/**
 * Manual rollback, for an update that installed and then misbehaved in a way
 * the load check could not see — a scraper that returns nothing, rather than an
 * archive that will not link.
 */
ipcMain.handle(
  'extension:rollback',
  async (_, repositoryUrl: string, internalName: string) => {
    try {
      return await pluginManager.rollbackPlugin(repositoryUrl, internalName);
    } catch (error) {
      return { ...fail(error), message: 'The previous version could not be restored.' };
    }
  }
);

ipcMain.handle(
  'extension:hasPreviousVersion',
  async (_, repositoryUrl: string, internalName: string) => ({
    ok: true,
    available: pluginManager.hasPreviousVersion(repositoryUrl, internalName),
  })
);

ipcMain.handle('external:capability', async (_, playerId: string) => ({
  ok: true,
  capability: playerId === 'mpv' ? (mpvEngine.isAvailable() ? 'full' : 'none') : externalPlayers.capabilityFor(playerId),
}));

ipcMain.handle('external:snapshot', async () => {
  if (mpvEngine.isRunning()) {
    return { ok: true, snapshot: mpvToExternalSnapshot(mpvEngine.snapshot()) };
  }
  return {
    ok: true,
    snapshot: externalPlayers.controller()?.current() ?? null,
  };
});

ipcMain.handle('external:setPaused', async (_, paused: boolean) => {
  if (mpvEngine.isRunning()) {
    const res = await mpvEngine.setPaused(paused);
    return { ok: res.ok };
  }
  return {
    ok: (await externalPlayers.controller()?.setPaused(paused)) ?? false,
  };
});
ipcMain.handle('external:seek', async (_, seconds: number) => {
  if (mpvEngine.isRunning()) {
    const res = await mpvEngine.seek(seconds);
    return { ok: res.ok };
  }
  return {
    ok: (await externalPlayers.controller()?.seek(seconds)) ?? false,
  };
});
ipcMain.handle('external:setVolume', async (_, percent: number) => {
  if (mpvEngine.isRunning()) {
    const res = await mpvEngine.setVolume(percent);
    return { ok: res.ok };
  }
  return {
    ok: (await externalPlayers.controller()?.setVolume(percent)) ?? false,
  };
});
ipcMain.handle('external:setMuted', async (_, muted: boolean) => {
  if (mpvEngine.isRunning()) {
    const res = await mpvEngine.setMuted(muted);
    return { ok: res.ok };
  }
  return {
    ok: (await externalPlayers.controller()?.setMuted(muted)) ?? false,
  };
});
ipcMain.handle('external:setSpeed', async (_, rate: number) => {
  if (mpvEngine.isRunning()) {
    const res = await mpvEngine.setSpeed(rate);
    return { ok: res.ok };
  }
  return {
    ok: (await externalPlayers.controller()?.setSpeed(rate)) ?? false,
  };
});
ipcMain.handle('external:setFullscreen', async () => {
  if (mpvEngine.isRunning()) {
    const s = mpvEngine.snapshot();
    const res = await mpvEngine.setFullscreen(!s.fullscreen);
    return { ok: res.ok };
  }
  return {
    ok: (await externalPlayers.controller()?.setFullscreen()) ?? false,
  };
});
ipcMain.handle('external:stop', async () => {
  if (mpvEngine.isRunning()) {
    await mpvEngine.stop();
  }
  await externalPlayers.shutdown();
  return { ok: true };
});

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
    /*
     * A 502 from our own proxy is not the host's answer — it is ours, saying the
     * host could not be reached, with the reason as the body. Measured
     * 2026-10-02 on MovieBlast's `move.mbaccess.site`: the name has no address
     * record at all, and the viewer was told the link "may have expired, or need
     * credentials". Read the (short) body so the sentence names the real cause.
     */
    let proxyReason = '';
    if (response.status === 502 && /^https?:\/\/127\.0\.0\.1[:/]/i.test(url)) {
      proxyReason = (await response.text().catch(() => '')).slice(0, 500);
    } else {
      try {
        await response.body?.cancel();
      } catch {
        // Nothing to cancel.
      }
    }

    if (proxyReason) {
      const unresolved = /ENOTFOUND|EAI_AGAIN|NAME_NOT_RESOLVED|name resolution|getaddrinfo|no such host/i.test(
        proxyReason
      );
      return {
        status: response.status,
        dead: true,
        reason: unresolved
          ? "This source's server can't be found any more — its web address no longer exists. Try another source."
          : `This source's server could not be reached (${proxyReason.split('\n')[0]}). Try another source.`,
      };
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
      reason: `The source could not be reached: ${describeError(error)}`,
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

// --- native playback engine (mpv) -----------------------------------------

/**
 * The native engine's surface, and the one thing it does not have.
 *
 * There is deliberately **no** `mpv:play(url)` that takes a raw link. Everything
 * playable still comes out of `media:prepare`, which inspects first — the same
 * gate INV-RACE-1 puts in front of the `<video>` element. A second entry point
 * that skipped inspection would reintroduce the original bug in a new engine:
 * playback started against unclassified content, with the diagnosis arriving
 * afterwards if at all.
 */
ipcMain.handle('mpv:status', async () => ({ ok: true, status: await mpvEngine.status() }));

ipcMain.handle('mpv:open', async (_, request: MpvOpenRequest) => {
  const result = await mpvEngine.open(request);
  if (!result.ok) {
    diagnostics.record({
      level: 'error',
      stage: 'playback',
      url: request?.url,
      source: 'mpv',
      message: result.error ?? 'The native engine could not open this source.',
    });
  }
  return result;
});

ipcMain.handle('mpv:setPaused', async (_, paused: boolean) => mpvEngine.setPaused(paused));
ipcMain.handle('mpv:seek', async (_, seconds: number) => mpvEngine.seek(seconds));
ipcMain.handle('mpv:setVolume', async (_, volume: number) => mpvEngine.setVolume(volume));
ipcMain.handle('mpv:setMuted', async (_, muted: boolean) => mpvEngine.setMuted(muted));
ipcMain.handle('mpv:setSpeed', async (_, speed: number) => mpvEngine.setSpeed(speed));
ipcMain.handle('mpv:setFullscreen', async (_, on: boolean) => mpvEngine.setFullscreen(on));
ipcMain.handle('mpv:setVideoTrack', async (_, id: number | 'auto' | 'no') =>
  mpvEngine.setVideoTrack(id)
);
ipcMain.handle('mpv:setAudioTrack', async (_, id: number | null) => mpvEngine.setAudioTrack(id));
ipcMain.handle('mpv:setSubtitleTrack', async (_, id: number | null) =>
  mpvEngine.setSubtitleTrack(id)
);
ipcMain.handle('mpv:addSubtitle', async (_, url: string, title?: string, language?: string) => {
  let target = url;
  if (url && (url.startsWith('WEBVTT') || url.includes('-->') || url.startsWith('blob:'))) {
    try {
      // This launch's temp directory: removed on quit, swept after a crash.
      const tempPath = storage.tempFile('mpv-subtitle', 'vtt');
      fs.writeFileSync(tempPath, url, 'utf8');
      target = tempPath;
    } catch {
      // If write fails, leave as-is
    }
  }
  return mpvEngine.addSubtitle(target, title, language);
});
ipcMain.handle('mpv:setSubtitleDelay', async (_, seconds: number) =>
  mpvEngine.setSubtitleDelay(seconds)
);
/**
 * The renderer sends already-translated mpv properties rather than the
 * preference record, so the mapping from one stored setting to two very
 * different renderers lives in exactly one module.
 */
ipcMain.handle('mpv:setSubtitleStyle', async (_, properties: Record<string, unknown>) =>
  mpvEngine.setSubtitleStyle(properties)
);
ipcMain.handle('mpv:stop', async () => mpvEngine.stop());

/** A pull for the current state, for a player that mounted mid-playback. */
ipcMain.handle('mpv:snapshot', async () => ({ ok: true, snapshot: mpvEngine.snapshot() }));

/**
 * Pins the application window above everything else on the desktop.
 *
 * The third of three mechanisms, and the only one that always works. Native
 * Picture-in-Picture detaches the `<video>` element's surface and therefore
 * cannot help a stream routed to mpv or handed to VLC; mpv's own `ontop` cannot
 * help a stream playing in the element. This changes a window level and is
 * indifferent to what is inside the window — so a torrent stream, a 4K HEVC
 * file the native engine is decoding, and an ordinary MP4 all float equally.
 *
 * `'floating'` rather than the default level: on macOS the plain level sits
 * below full-screen applications, which is exactly where a film someone pinned
 * on purpose must not go.
 */
ipcMain.handle('window:setAlwaysOnTop', async (_, onTop: boolean) => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { ok: false, error: 'The window is gone.', alwaysOnTop: false };
  }
  mainWindow.setAlwaysOnTop(onTop === true, 'floating');
  return { ok: true, alwaysOnTop: mainWindow.isAlwaysOnTop() };
});

ipcMain.handle('window:getAlwaysOnTop', async () => ({
  ok: true,
  alwaysOnTop: Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isAlwaysOnTop()),
}));

ipcMain.handle('mpv:setVideoEnabled', async (_, enabled: boolean) => {
  try {
    if (!mpvEngine.isRunning()) return { ok: true, applied: false };
    const result = await mpvEngine.setVideoEnabled(enabled !== false);
    return { ok: result.ok, applied: result.ok, error: result.error };
  } catch (error) {
    return { ...fail(error), applied: false };
  }
});

ipcMain.handle('mpv:setOnTop', async (_, onTop: boolean) => {
  try {
    // Not an error when mpv is not running: the caller is applying a preference
    // across every engine, and only one of them is holding the stream.
    if (!mpvEngine.isRunning()) return { ok: true, applied: false };
    const result = await mpvEngine.setOnTop(onTop === true);
    return { ok: result.ok, applied: result.ok, error: result.error };
  } catch (error) {
    return { ...fail(error), applied: false };
  }
});

ipcMain.handle('mpv:getPolicy', async () => ({
  ok: true,
  policy: nativeEnginePolicy(),
  available: mpvEngine.isAvailable(),
}));

ipcMain.handle('mpv:setPolicy', async (_, policy: NativeEngineCapability['policy']) => {
  if (policy !== 'off' && policy !== 'auto' && policy !== 'aggressive') {
    return { ok: false, error: `Unknown native engine policy: ${policy}` };
  }
  datastore.setString(NATIVE_ENGINE_POLICY_KEY, policy, true);
  /**
   * Every cached verdict was reached under the old policy and is now wrong in
   * whichever direction the policy moved. Without this, changing the setting
   * appears to do nothing for the next ten minutes on any source already seen.
   */
  playbackEngine.invalidateCapabilityCache();
  return { ok: true, policy };
});

/**
 * Installs mpv on demand.
 *
 * Kept out of `binary:setupAll` on purpose — see `setupMpv`. It is the largest
 * download the app makes and it is only worth making for someone who actually
 * meets the streams that need it.
 */
ipcMain.handle('binary:setupMpv', async () => {
  try {
    const ok = await binaryDownloader.setupMpv((status, percent) => {
      mainWindow?.webContents.send('binary:setupProgress', { component: 'mpv', status, percent });
    });
    /**
     * The engine that was absent a moment ago now exists, and every capability
     * record in the cache was decided on the assumption that it did not.
     */
    if (ok) playbackEngine.invalidateCapabilityCache();
    return { ok, status: await mpvEngine.status() };
  } catch (error) {
    return { ...fail(error), status: await mpvEngine.status() };
  }
});

// --- storage: where things live, and cleaning what may be cleaned ---------

const DAY_MS = 24 * 60 * 60 * 1000;

/*
 * The caches the storage report lists and the sweep looks after. Each names
 * the owning service's own clear, because emptying a JSON store's file while
 * the service holds it in memory would be undone by its next write.
 */
storage.registerCacheArea({
  id: 'torrent-pieces',
  label: 'Torrent streaming cache',
  path: torrentEngine.getCachePath(),
  kind: 'dir',
  // Pieces of something streamed a week ago are not worth keeping, and a
  // runaway cache must not fill a disk: oldest go first beyond 20 GB.
  maxAgeMs: 7 * DAY_MS,
  maxBytes: 20 * 1024 ** 3,
  isActive: (entry) => torrentEngine.isCacheEntryActive(path.basename(entry)),
  clear: () => torrentEngine.clearCache(),
});
storage.registerCacheArea({
  id: 'torrent-state',
  label: 'Torrent metadata and DHT contacts',
  path: storage.cacheDir('torrent-state'),
  // `torrentMetadata` sweeps its own files; DHT contacts are rewritten live.
  kind: 'self-managed',
});
storage.registerCacheArea({
  id: 'yt-dlp',
  label: 'Video page helper cache',
  path: storage.cacheDir('yt-dlp'),
  kind: 'dir',
  maxAgeMs: 30 * DAY_MS,
  // yt-dlp re-creates it on the next run; nothing in it is ever in use between runs.
  clear: () => fs.promises.rm(storage.cacheDir('yt-dlp'), { recursive: true, force: true }),
});
const selfManaged: Array<[string, string, string, (() => unknown) | undefined]> = [
  ['details', 'Title pages', 'cs3-detail-cache.json', () => contentService.clearDetailCache()],
  ['home', 'Home rows', 'cs3-discovery-cache.json', () => discovery.invalidate()],
  ['metadata', 'Cast, crew and production notes', 'cs3-metadata-cache.json', () => metadataEnrichment.clear()],
  ['related', 'Related titles', 'cs3-related-media-cache.json', () => relatedMediaService.clearCache()],
  ['ratings', 'Ratings', 'cs3-ratings-cache.json', () => mediaRatingService.clearCache()],
  ['catalogues', 'Streaming-service catalogues', 'cs3-catalogue-cache.json', undefined],
  ['repository-listings', 'Add-on lists', 'cs3-repository-listings.json', undefined],
  ['ffmpeg', 'Media tool capabilities', 'cs3-ffmpeg-capabilities.json', undefined],
];
for (const [id, label, file, clear] of selfManaged) {
  storage.registerCacheArea({ id, label, path: storage.cacheFile(file), kind: 'self-managed', clear });
}

/** Where every earlier build put the piece cache: the system temp directory. */
const LEGACY_TEMP_DIRS = ['torrent-cache', 'torrent-state'].map((name) =>
  path.join(os.tmpdir(), 'cloudstream-desktop', name)
);

/**
 * The background sweep: abandoned temp sessions, aged JVM temp files, and the
 * piece cache's age and size rules. Never on the path to the first frame, and
 * every step tolerates locked or vanished files.
 */
async function runStorageSweep(): Promise<void> {
  // Sessions only. The JVM's temp area is aged by the supervisor just before
  // the runtime starts, when nothing can be holding a file in it.
  const temp = await sweepTemp(storage.tempRoot, { currentPid: storage.processId });
  let freed = temp.freedBytes;
  const errors = [...temp.errors];
  for (const area of storage.cacheAreas()) {
    const swept = await sweepCacheArea(area, storage.cacheRoot);
    freed += swept.freedBytes;
    errors.push(...swept.errors);
  }
  logger.info('app', 'storage_sweep', {
    removedTemp: temp.removed.length,
    freedBytes: freed,
    errors: errors.length,
  });
}

/**
 * Where CS3 keeps cache, temp, downloads and data, with sizes. Read-shaped;
 * the Storage panel in Settings draws it, and the Developer view shows paths.
 */
ipcMain.handle('storage:getReport', async () => {
  try {
    const areas = await Promise.all(
      storage.cacheAreas().map(async (area) => ({
        id: area.id,
        label: area.label,
        path: area.path,
        kind: area.kind,
        managed: area.managed,
        clearable: Boolean(area.clear),
        bytes: await areaSize(area),
        maxAgeDays: area.maxAgeMs ? Math.round(area.maxAgeMs / DAY_MS) : undefined,
        maxBytes: area.maxBytes,
      }))
    );
    const tempBytes = await areaSize({ path: storage.tempRoot });
    const legacy = await Promise.all(
      LEGACY_TEMP_DIRS.filter((dir) => fs.existsSync(dir)).map(async (dir) => ({
        path: dir,
        bytes: await areaSize({ path: dir }),
      }))
    );
    return { ok: true, locations: storage.locations(), areas, tempBytes, legacy };
  } catch (error) {
    return fail(error);
  }
});

/** Empties one cache area through its owning service. Nothing persistent is reachable from here. */
ipcMain.handle('storage:clearArea', async (_, id: string) => {
  const area = storage.cacheArea(String(id));
  if (!area?.clear) return { ok: false, error: 'That cache cannot be cleared from here.' };
  try {
    await area.clear();
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
});

/**
 * Removes what earlier builds left in the system temp directory.
 *
 * Only on the viewer's request, and only the exact folders those builds
 * created — a name match alone is not ownership enough to delete on a timer.
 */
ipcMain.handle('storage:removeLegacyTemp', async () => {
  let removed = 0;
  for (const dir of LEGACY_TEMP_DIRS) {
    if (!fs.existsSync(dir)) continue;
    try {
      await fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 1 });
      removed += 1;
    } catch {
      // Held by something; it stays and is offered again next time.
    }
  }
  return { ok: true, removed };
});

ipcMain.handle('storage:openLocation', async (_, which: string) => {
  const where = storage.locations() as Record<string, string>;
  const target = where[String(which)];
  if (!target) return { ok: false, error: 'Unknown location.' };
  fs.mkdirSync(target, { recursive: true });
  const error = await shell.openPath(target);
  return error ? { ok: false, error } : { ok: true };
});

ipcMain.handle('sources:getCacheStats', async () => contentService.getCache().stats());

ipcMain.handle('sources:clearCache', async () => {
  contentService.getCache().clear();
  return { ok: true };
});

/**
 * `torrent:import*` opens a torrent as *content*, not as a download.
 *
 * Import and read are separate calls, and separate for the reason Add and
 * Install are separate on the repositories screen: importing a file is a read
 * and a cache write, and a magnet whose metadata is not here yet has to join a
 * swarm. Folding them together would make opening a page block on a swarm that
 * may be dead.
 */
ipcMain.handle('torrent:importFiles', async (_, filePaths: string[]) => {
  try {
    if (!Array.isArray(filePaths) || filePaths.length === 0) {
      return { ok: false, error: 'No files were given.' };
    }
    const results = filePaths
      .filter((filePath) => classifyDroppedPath(filePath) === 'torrent')
      .map((filePath) => ({ path: filePath, ...torrentImports.importFile(filePath) }));
    if (results.length === 0) return { ok: false, error: 'None of those were .torrent files.' };
    return { ok: true, results };
  } catch (error) {
    return fail(error);
  }
});

/** The same import, reached through a dialog rather than a drop. */
ipcMain.handle('torrent:pickFiles', async () => {
  try {
    if (!mainWindow) return { ok: false, error: 'No window to ask from.' };
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Open torrent files',
      // Several at once, matching what a drop allows. Picking three and being
      // given one would be a worse version of the gesture it stands in for.
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Torrent', extensions: ['torrent'] }],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, cancelled: true };
    }
    return {
      ok: true,
      results: result.filePaths.map((filePath) => ({
        path: filePath,
        ...torrentImports.importFile(filePath),
      })),
    };
  } catch (error) {
    return fail(error);
  }
});

ipcMain.handle('torrent:importMagnet', async (_, uri: string) => {
  try {
    if (!uri) return { ok: false, error: 'No magnet link was given.' };
    return torrentImports.importMagnet(uri);
  } catch (error) {
    return fail(error);
  }
});

/**
 * What is inside a torrent, from metadata this machine already holds.
 *
 * `resolved: false` is an ordinary answer for a magnet, not a failure — the
 * page renders its name and asks the engine to fetch the rest.
 */
ipcMain.handle('torrent:getContents', async (_, infoHash: string) => {
  try {
    if (!/^[a-f0-9]{40}$/i.test(infoHash ?? '')) {
      return { ok: false, error: 'That is not a torrent hash.' };
    }
    const hash = infoHash.toLowerCase();
    torrentImports.touch(hash);
    const contents = torrentImports.contents(hash);
    return {
      ok: true,
      resolved: contents !== null,
      record: torrentImports.get(hash),
      contents,
    };
  } catch (error) {
    return fail(error);
  }
});

/**
 * Joins the swarm for the sole purpose of fetching metadata.
 *
 * The engine owns every swarm timeout, the dead-swarm bail and the `xs` mirror
 * race, so this asks it rather than resolving alongside it. `mode: 'download'`
 * is deliberate: nothing is being watched yet, and the sequential piece
 * ordering a stream asks for is wrong for a metadata fetch.
 */
ipcMain.handle('torrent:resolveMagnet', async (_, infoHash: string) => {
  try {
    const record = torrentImports.get((infoHash ?? '').toLowerCase());
    if (!record?.source) return { ok: false, error: 'That torrent has no magnet to resolve.' };

    await torrentEngine.startStream({ torrentId: record.source, mode: 'download' });
    // The engine writes resolved metadata into the shared cache, so reading is
    // the whole handshake — see `TorrentImportService.load`.
    const contents = torrentImports.contents(record.infoHash);
    return {
      ok: contents !== null,
      resolved: contents !== null,
      contents,
      record: torrentImports.get(record.infoHash),
      error: contents === null ? 'No peer offered this torrent’s file list.' : undefined,
    };
  } catch (error) {
    return fail(error);
  }
});

ipcMain.handle('torrent:listImports', async () => {
  try {
    return { ok: true, records: torrentImports.list() };
  } catch (error) {
    return fail(error);
  }
});

ipcMain.handle('torrent:removeImport', async (_, infoHash: string) => {
  try {
    return { ok: torrentImports.remove((infoHash ?? '').toLowerCase()) };
  } catch (error) {
    return fail(error);
  }
});

/** Whether a pasted string is a magnet, so the UI can offer to open it. */
ipcMain.handle('torrent:isMagnet', async (_, text: string) => ({
  ok: true,
  magnet: looksLikeMagnet(text ?? ''),
}));

/**
 * Streams one file out of an imported torrent.
 *
 * `mode: 'stream'` and an explicit `fileIndex` together are what make this
 * different from adding the torrent: the engine orders pieces sequentially from
 * that file's start and deselects the rest, so a 40 GB season pack delivers one
 * episode rather than splitting the swarm's bandwidth across ten.
 *
 * The magnet is preferred as the id when the record has one, because it carries
 * the trackers the link named. A bare infohash still works — the `.torrent` is
 * in the shared metadata cache — but it would join with only the DHT.
 */
ipcMain.handle('torrent:playFile', async (_, infoHash: string, fileIndex: number) => {
  try {
    const hash = (infoHash ?? '').toLowerCase();
    const record = torrentImports.get(hash);
    if (!record) return { ok: false, error: 'That torrent is not imported.' };
    if (!Number.isInteger(fileIndex) || fileIndex < 0) {
      return { ok: false, error: 'No file was chosen.' };
    }

    const handle = await torrentEngine.startStream({
      torrentId: record.origin === 'magnet' && record.source ? record.source : hash,
      fileIndex,
      mode: 'stream',
    });
    torrentImports.touch(hash);
    return { ok: true, handle };
  } catch (error) {
    return fail(error);
  }
});

/**
 * Queues one file out of a torrent as an ordinary download.
 *
 * Built here rather than in the renderer because the queue's identity rules
 * live here: `download:request` keys on the *variant*, so re-pressing Download
 * on an episode already queued resumes or reports it instead of starting a
 * second copy of the same bytes. The infohash plus the file index is that
 * variant — durable in a way a provider URL is not, since it addresses content
 * rather than an address that expires.
 */
ipcMain.handle(
  'torrent:downloadFile',
  async (
    _,
    request: {
      infoHash: string;
      fileIndex: number;
      fileName: string;
      title: string;
      season?: number;
      episode?: number;
      totalSize?: number;
    }
  ) => {
    try {
      const hash = (request?.infoHash ?? '').toLowerCase();
      const record = torrentImports.get(hash);
      if (!record) return { ok: false, error: 'That torrent is not imported.' };

      const magnet = record.origin === 'magnet' && record.source ? record.source : `magnet:?xt=urn:btih:${hash}`;
      const source: TorrentResult = {
        infoHash: hash,
        title: request.fileName,
        magnet,
        sizeBytes: request.totalSize ?? 0,
        seeders: 0,
        leechers: 0,
        indexerId: 'imported-torrent',
        // Named for what it is. This travels into the download list and the
        // history, where "which torrent did this come from" is the question.
        indexerName: 'Imported torrent',
        // The file inside the archive. Left unset for a provider magnet — see
        // AGENTS.md — precisely because there it would select an arbitrary
        // episode; here it is the whole point and is the viewer's own choice.
        fileIndex: request.fileIndex,
        parsed: parseReleaseName(request.fileName),
      } as TorrentResult;

      const task = buildDownloadTask(source, {
        title: request.title,
        mediaUrl: `torrent://${hash}/${request.fileIndex}`,
        episodeTitle:
          request.season !== undefined && request.episode !== undefined
            ? `S${String(request.season).padStart(2, '0')}E${String(request.episode).padStart(2, '0')}`
            : undefined,
        season: request.season,
        episode: request.episode,
      });
      if (!task) return { ok: false, error: 'That file could not be queued.' };

      return await downloadService.request(task);
    } catch (error) {
      return fail(error);
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

/**
 * Why this torrent is as fast or as slow as it is.
 *
 * Surfaced rather than logged because most of the answer is not something the
 * app can change — a swarm with four seeders is a swarm with four seeders, and
 * a machine that no peer can dial stays that way until a router is configured.
 * An unnamed limitation reads as "this app is slow"; a named one can be worked
 * around or knowingly accepted.
 */
ipcMain.handle('torrent:getSwarmReport', async (_, infoHash: string) =>
  torrentEngine.getSwarmReport(infoHash)
);

// --- indexers and source preferences -------------------------------------

ipcMain.handle('indexer:getConfigs', async () => contentService.getRegistry().getConfigs());

ipcMain.handle('indexer:saveConfig', async (_, config: IndexerConfig) => {
  contentService.getRegistry().upsertConfig(config);
  return contentService.getRegistry().getConfigs();
});

ipcMain.handle('indexer:saveConfigs', async (_, configs: IndexerConfig[]) => {
  contentService.getRegistry().saveConfigs(configs);
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

ipcMain.handle('download:enqueue', async (_, task: DownloadTask) => {
  if (privacyMode.isActive() && !privacyMode.getState().settings.allowDownloads) {
    throw new Error('Downloads are turned off in Incognito.');
  }
  return downloadService.enqueue(task);
});
/**
 * The state-aware Download press.
 *
 * `download:enqueue` still exists and still means "create this task" — the
 * season batcher wants exactly that. This one means "make this variant make
 * progress", which is what a button press actually is, and answers with which
 * of six things happened rather than leaving the renderer to guess from a list
 * it matched on the title.
 */
ipcMain.handle('download:request', async (_, task: DownloadTask) => {
  try {
    if (privacyMode.isActive() && !privacyMode.getState().settings.allowDownloads) {
      return { ok: false, error: 'Downloads are turned off in Incognito.', action: 'refused', message: 'Downloads are turned off in Incognito. Change this in Settings → General → Privacy.' };
    }
    return await downloadService.request(task);
  } catch (error) {
    return {
      ...fail(error),
      action: 'started',
      message: 'Could not start that download.',
    };
  }
});
ipcMain.handle('download:pause', async (_, id: string) => downloadService.pause(id));
ipcMain.handle('download:resume', async (_, id: string) => downloadService.resume(id));
ipcMain.handle('download:remove', async (_, id: string, deleteFile?: boolean) =>
  downloadService.remove(id, deleteFile === true)
);

/**
 * How "Delete" should behave, remembered.
 *
 * Three values rather than a boolean, because "ask me" is a real answer and the
 * only safe default: removing a finished film from the list and deleting a
 * finished film off the disk are unrecoverably different, and guessing wrong in
 * the destructive direction cannot be undone. The prompt is where the user opts
 * out of being asked, and Settings is where they opt back in — a preference that
 * can only be set from a confirmation dialog is one nobody can reverse.
 */
const DELETE_PREFERENCE_KEY = 'download_delete_behavior';
type DeletePreference = 'ask' | 'list-only' | 'list-and-file';

/**
 * Whether pressing Download asks first.
 *
 * Two values, not three, and the asymmetry with the delete preference above is
 * deliberate. Deleting is unrecoverable, so its safe default is to ask.
 * Downloading is not: the worst outcome of a mistaken press is a file in the
 * wrong folder and some bandwidth, both of which the queue already lets you
 * cancel. So the default stays `immediate`, which is what the button has always
 * done — a preference that changes existing behaviour on upgrade is a bug
 * report, not a feature.
 *
 * What makes asking worth offering at all is that a press commits to a
 * *particular* variant: this 16 GB 2160p release from this provider in this
 * language, into this folder. Someone downloading over a metered connection or
 * onto a small disk is choosing between rows that all read "Download", and the
 * dialog is where those differences become visible before the bytes start.
 */
const DOWNLOAD_CONFIRM_KEY = 'download_confirm_behavior';
type DownloadConfirmPreference = 'ask' | 'immediate';

/**
 * Player preferences that belong to the viewer rather than to a film.
 *
 * Volume, mute and speed persist across media and across restarts because they
 * describe the room, not the title. Track *languages* persist for the same
 * reason; track **indices** deliberately do not — audio track 2 is the Hindi dub
 * on one release and the director's commentary on the next, so restoring an
 * index would confidently select the wrong thing on every file.
 */
const PLAYER_PREFERENCES_KEY = 'player_preferences';

interface StoredPlayerPreferences {
  volume: number;
  muted: boolean;
  speed: number;
  audioLanguage?: string;
  subtitleLanguage?: string;
  /**
   * How subtitles are drawn.
   *
   * Default `<track>` rendering is small white text with no outline, which
   * disappears completely over a bright scene — snow, a white wall, credits on
   * a light background. Android has shipped a caption editor for years and it
   * is the single most-adjusted screen in that app; having none here made
   * subtitles something to endure rather than read.
   *
   * Stored as plain numbers and enum strings rather than a composed CSS string,
   * because the same settings have to drive two very different renderers: CSS
   * `::cue` for the browser path and mpv properties for the native one.
   */
  subtitleScale: number;
  subtitleColor: string;
  subtitleBackground: 'none' | 'shadow' | 'outline' | 'box';
  subtitleWeight: 'normal' | 'bold';
  subtitlePosition: number;
  /**
   * What "minimise the player" does.
   *
   * Four different things people mean by it, and they are not orderable on one
   * scale, so this is a choice rather than a level:
   *
   *  - `mini` — a small window inside the app. Cheap, always available, and
   *    useless the moment the app is not the front window.
   *  - `floating` — the mini player plus the *application* window pinned above
   *    everything else. The only one of the four that works while the video is
   *    a torrent stream or an mpv-routed 4K file, because it moves no surface
   *    anywhere: it changes a window level.
   *  - `pip` — Chromium's native Picture-in-Picture. A real OS-level floating
   *    window with the system's own controls, and the closest thing to what
   *    people mean when they say "like Chrome". Only reachable when the
   *    `<video>` element is what is playing; mpv and an external player have
   *    their own windows and PiP has nothing to detach.
   *  - `background` — no picture at all, playback continues.
   */
  floatingMode: 'mini' | 'floating' | 'pip' | 'background';
  /**
   * What happens to playback when the player is out of sight.
   *
   * Separate from `floatingMode` because they answer different questions —
   * where the picture goes, versus whether the film keeps running — and the
   * combinations are all meaningful: a floating window that pauses when you
   * click away is a perfectly reasonable thing to want, and so is audio
   * continuing with nothing on screen.
   *
   * `audio-only` is not a codec decision. Nothing is re-negotiated; the video
   * track keeps decoding and is simply not drawn, which is what the browser
   * does for an offscreen element anyway. It exists as a distinct setting
   * because it is what people ask for by name.
   */
  backgroundPlayback: 'continue' | 'audio-only' | 'pause';
  /**
   * Keep the app above other windows whenever a floating player is showing.
   *
   * Stored rather than toggled per session: someone who wants their film on top
   * of a spreadsheet wants that every evening, and a pin that resets on every
   * launch is one people stop using.
   */
  alwaysOnTop: boolean;
}

const DEFAULT_PLAYER_PREFERENCES: StoredPlayerPreferences = {
  volume: 1,
  muted: false,
  speed: 1,
  subtitleScale: 1,
  subtitleColor: '#ffffff',
  // Outline rather than a box: a box is the most legible and the most
  // intrusive, and an outline reads cleanly over almost everything without
  // covering the picture.
  subtitleBackground: 'outline',
  subtitleWeight: 'normal',
  subtitlePosition: 0,
  // `mini` is the pre-existing behaviour, so an install that upgrades into this
  // setting keeps the player it had rather than acquiring a new one nobody
  // asked for.
  floatingMode: 'mini',
  backgroundPlayback: 'continue',
  alwaysOnTop: false,
};

const FLOATING_MODES = new Set(['mini', 'floating', 'pip', 'background']);
const BACKGROUND_MODES = new Set(['continue', 'audio-only', 'pause']);

/** Only these values mean anything to either renderer. */
const SUBTITLE_BACKGROUNDS = new Set(['none', 'shadow', 'outline', 'box']);
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

ipcMain.handle('player:getPreferences', async () => {
  const stored = datastore.getObject<StoredPlayerPreferences>(PLAYER_PREFERENCES_KEY, null);
  /**
   * Clamped on read, not just on write. A datastore edited by hand — or carried
   * in from an Android backup — can hold a volume of 40 or -1, and either one
   * makes the element throw `IndexSizeError` the moment it is assigned.
   */
  const preferences: StoredPlayerPreferences = {
    ...DEFAULT_PLAYER_PREFERENCES,
    ...(stored ?? {}),
  };
  preferences.volume = Math.min(1, Math.max(0, Number(preferences.volume) || 0));
  preferences.speed = Math.min(4, Math.max(0.25, Number(preferences.speed) || 1));
  preferences.muted = preferences.muted === true;
  // Same rule as volume, for the same reason: a scale of 0 renders nothing at
  // all and looks exactly like subtitles failing to load.
  preferences.subtitleScale = Math.min(3, Math.max(0.5, Number(preferences.subtitleScale) || 1));
  preferences.subtitlePosition = Math.min(40, Math.max(0, Number(preferences.subtitlePosition) || 0));
  if (!HEX_COLOR.test(String(preferences.subtitleColor))) {
    preferences.subtitleColor = DEFAULT_PLAYER_PREFERENCES.subtitleColor;
  }
  if (!SUBTITLE_BACKGROUNDS.has(String(preferences.subtitleBackground))) {
    preferences.subtitleBackground = DEFAULT_PLAYER_PREFERENCES.subtitleBackground;
  }
  if (preferences.subtitleWeight !== 'bold') preferences.subtitleWeight = 'normal';
  // Validated on read for the same reason as volume: an unknown mode arriving
  // from a hand-edited datastore would reach a `switch` in the renderer that
  // handles four cases and silently do nothing.
  if (!FLOATING_MODES.has(String(preferences.floatingMode))) {
    preferences.floatingMode = DEFAULT_PLAYER_PREFERENCES.floatingMode;
  }
  if (!BACKGROUND_MODES.has(String(preferences.backgroundPlayback))) {
    preferences.backgroundPlayback = DEFAULT_PLAYER_PREFERENCES.backgroundPlayback;
  }
  preferences.alwaysOnTop = preferences.alwaysOnTop === true;
  return { ok: true, preferences };
});

ipcMain.handle(
  'player:setPreferences',
  async (_, patch: Partial<StoredPlayerPreferences>) => {
    const current =
      datastore.getObject<StoredPlayerPreferences>(PLAYER_PREFERENCES_KEY, null) ??
      DEFAULT_PLAYER_PREFERENCES;
    // Merged rather than replaced: the player writes volume/mute/speed while the
    // track panels write languages, and a whole-record write from either would
    // erase the other's choice.
    const merged = { ...current, ...patch };
    datastore.setObject(PLAYER_PREFERENCES_KEY, merged, true);
    mainWindow?.webContents.send('player:preferencesChanged', merged);
    return { ok: true };
  }
);

ipcMain.handle('download:getDeletePreference', async () => {
  const stored = datastore.getString(DELETE_PREFERENCE_KEY, 'ask', true);
  const preference: DeletePreference =
    stored === 'list-only' || stored === 'list-and-file' ? stored : 'ask';
  return { ok: true, preference };
});

ipcMain.handle('download:setDeletePreference', async (_, preference: DeletePreference) => {
  if (preference !== 'ask' && preference !== 'list-only' && preference !== 'list-and-file') {
    return { ok: false, error: `Unknown delete preference: ${preference}` };
  }
  datastore.setString(DELETE_PREFERENCE_KEY, preference, true);
  return { ok: true, preference };
});

ipcMain.handle('download:getConfirmPreference', async () => {
  const stored = datastore.getString(DOWNLOAD_CONFIRM_KEY, 'immediate', true);
  const preference: DownloadConfirmPreference = stored === 'ask' ? 'ask' : 'immediate';
  return { ok: true, preference };
});

ipcMain.handle('download:setConfirmPreference', async (_, preference: DownloadConfirmPreference) => {
  if (preference !== 'ask' && preference !== 'immediate') {
    return { ok: false, error: `Unknown download confirmation preference: ${preference}` };
  }
  datastore.setString(DOWNLOAD_CONFIRM_KEY, preference, true);
  return { ok: true, preference };
});

/**
 * Where this download would land, and what pressing Download would actually do.
 *
 * The confirmation dialog cannot work this out for itself: the folder layout,
 * the variant segment and the collision suffix are all decided in
 * `MediaDownloadResolver` and `DownloadService`, from the rest of the queue —
 * which the renderer has never seen. A dialog that guessed the path would be
 * wrong exactly when it matters (the second release of one film), and a dialog
 * that showed no path would be answering a different question from the one the
 * viewer is asking.
 *
 * It also reports the existing task, if there is one, because "Download" on a
 * paused transfer means resume and on a finished one means nothing at all —
 * `download:request` has known that since it replaced the old "Already
 * downloading" refusal, and the dialog should say it before the press rather
 * than after.
 *
 * Read-only: it claims no path and creates no task.
 */
ipcMain.handle('download:preview', async (_, task: DownloadTask) => {
  try {
    return { ok: true, ...downloadService.preview(task) };
  } catch (error) {
    return fail(error);
  }
});
ipcMain.handle('download:getQueue', async () => downloadService.getTasks());

/**
 * Hands a finished download back as something the player can open.
 *
 * A completed film used to leave the app entirely — `shell.openPath` to the
 * OS default player — costing the viewer resume position, subtitle search,
 * track selection and the compatibility engine, for a file already on their
 * disk. The engine was built for local input all along: `mediaInspector`
 * has always withheld `-user_agent` for non-HTTP paths precisely because a
 * local file was expected to arrive one day.
 *
 * A loopback URL rather than the path itself, so everything downstream —
 * ffprobe, the media element, mpv — takes it through the same door as a
 * stream, and so `media:prepare` still classifies it before anything is
 * attached. INV-RACE-1 applies here exactly as it does to a provider link.
 */
ipcMain.handle('download:getPlayableUrl', async (_, filePath: string) => {
  try {
    if (!filePath) return { ok: false, error: 'That download has no file path recorded.' };
    return { ok: true, url: await contentService.serveLocalFile(filePath) };
  } catch (error) {
    logger.warn('download', 'local_playback_failed', { error: String(error) });
    return fail(error);
  }
});

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
  const defaultDir = storage.downloadsDir();
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

ipcMain.handle('binary:checkBinaries', async () => binaryDownloader.checkBinaries());

ipcMain.handle('binary:testAll', async () => binaryDownloader.testAllBinaries());

ipcMain.handle('binary:testOne', async (_, name: 'aria2c' | 'yt-dlp' | 'ffmpeg' | 'ffprobe' | 'mpv') => {
  return await binaryDownloader.testBinary(name);
});

ipcMain.handle('binary:remove', async (_, name: 'aria2c' | 'yt-dlp' | 'ffmpeg' | 'ffprobe' | 'mpv' | 'media' | 'downloads' | 'all') => {
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
    // A different binary may have arrived with a different option set.
    if (ok) void refreshFfmpegOptionSupport();
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

/*
 * There was a second setup handler here (`binary:setup`), reporting
 * `{ success, message }` where every other binary handler reports
 * `{ ok, message }`, installing only aria2 and yt-dlp, and pushing no progress
 * at all. The preload invoked a third spelling that nothing registered, so the
 * setup modal — the first thing a new user is offered — rejected on every press
 * and rendered `No handler registered for 'binary:setupBinaries'` as a friendly
 * notice. `binary:setupAll` above is the one that installs everything and
 * reports per-component progress; it is now the only one.
 */

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

/** One push for every change to the adult gate, whoever made it. */
bootstrap.onAdultChange(() => {
  const state = { mode: bootstrap.adultMode(), allowed: bootstrap.isAdultAllowed() };
  BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('adult:changed', state));
});

ipcMain.handle('extension:getAdultAllowed', async () => bootstrap.isAdultAllowed());

/**
 * Turning adult content off must take effect at once, not at next launch: the
 * provider registry is re-read so anything already loaded stops being offered.
 */
ipcMain.handle('extension:setAdultAllowed', async (_, enabled: boolean) => {
  const value = bootstrap.setAdultAllowed(Boolean(enabled));
  return { ok: true, enabled: value, providers: await pluginManager.listEnabledProviders() };
});

/**
 * PRD-54: the viewer's content regions. `regions:set` answers at once with
 * what a removed region leaves behind (for review — nothing is disabled here);
 * the additions run in the background on `extension:bootstrapProgress`.
 */
ipcMain.handle('regions:get', async () => bootstrap.getRegionState());

ipcMain.handle('regions:set', async (_, selection: string[], options?: { crossRegion?: boolean }) => {
  try {
    const crossRegion = typeof options?.crossRegion === 'boolean' ? options.crossRegion : undefined;
    return { ok: true, ...bootstrap.setRegions(Array.isArray(selection) ? selection : [], { crossRegion }) };
  } catch (error) {
    return { ...fail(error), state: bootstrap.getRegionState(), affected: [] };
  }
});

/**
 * The three-state gate.
 *
 * `allowed` and `mode` are both reported because they answer different
 * questions: the mode is the setting, `allowed` is whether adult providers are
 * being offered *right now*, and under `ask` those differ until someone asks.
 */
ipcMain.handle('extension:getAdultMode', async () => ({
  ok: true,
  mode: bootstrap.adultMode(),
  allowed: bootstrap.isAdultAllowed(),
}));

ipcMain.handle('extension:setAdultMode', async (_, mode: 'off' | 'ask' | 'on') => {
  if (mode !== 'off' && mode !== 'ask' && mode !== 'on') {
    return { ...fail(new Error(`Unknown adult content mode: ${mode}`)), mode: bootstrap.adultMode() };
  }
  const value = bootstrap.setAdultMode(mode);
  return {
    ok: true,
    mode: value,
    allowed: bootstrap.isAdultAllowed(),
    providers: await pluginManager.listEnabledProviders(),
  };
});

/**
 * Reveals adult providers for the rest of this run of the app.
 *
 * Refused unless the setting is `ask` — `BootstrapService.unlockAdultForSession`
 * enforces that, and it matters because this channel is reachable from the
 * renderer: revealing must never be a way to change the setting, which is where
 * the consent step lives.
 */
ipcMain.handle('extension:unlockAdultForSession', async () => {
  const allowed = bootstrap.unlockAdultForSession();
  return {
    ok: true,
    mode: bootstrap.adultMode(),
    allowed,
    providers: await pluginManager.listEnabledProviders(),
  };
});

ipcMain.handle('extension:lockAdultForSession', async () => {
  bootstrap.lockAdultForSession();
  return {
    ok: true,
    mode: bootstrap.adultMode(),
    allowed: bootstrap.isAdultAllowed(),
    providers: await pluginManager.listEnabledProviders(),
  };
});

/** What a repository offered last time, instantly. Fetches nothing. */
ipcMain.handle('extension:peekRepository', async (_, repoUrl: string) => {
  const entry = repositoryListings.peek(repoUrl);
  return { ok: true, repository: entry?.value ?? null, fetchedAt: entry?.fetchedAt ?? null };
});

ipcMain.handle('extension:fetchRepository', async (_, repoUrl: string) => {
  try {
    const repository = await pluginManager.fetchRepository(repoUrl);
    repositoryListings.put(repoUrl, repository);
    return { ok: true, repository };
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
/**
 * Adds a repository without installing from it, and installs one wholesale.
 *
 * The pair matters more than either half. Adding is cheap and reversible, so it
 * is what "I want to look at this repository" costs; installing forty archives
 * is neither, so it stays a separate, explicit action. Folding them together
 * would mean a user who wanted to browse has committed to a catalogue.
 *
 * The adult setting is read here rather than passed by the renderer: it is the
 * kind of gate that must not be decidable by its caller.
 */
ipcMain.handle('extension:addRepository', async (_, repoUrl: string) => {
  try {
    return await pluginManager.addRepository(repoUrl);
  } catch (error) {
    return fail(error);
  }
});

/**
 * The background queue behind the extensions screen.
 *
 * `enqueueJobs` returns as soon as the work is queued — the reply is the whole
 * queue, and `extension:jobsUpdate` carries every change after it. The direct
 * `installPlugin`/`installRepository` handlers remain for callers that need to
 * await one result (OTT setup, the first-run bootstrap).
 */
ipcMain.handle('extension:enqueueJobs', async (_, requests: ExtensionJobRequest[]) => {
  try {
    const { snapshot, refused } = extensionJobs.enqueue(Array.isArray(requests) ? requests : []);
    return { ok: true, snapshot, refused };
  } catch (error) {
    return { ...fail(error), snapshot: extensionJobs.snapshot() };
  }
});

ipcMain.handle('extension:getJobs', async () => extensionJobs.snapshot());

ipcMain.handle('extension:cancelJob', async (_, id: string) => extensionJobs.cancel(id));

ipcMain.handle('extension:cancelQueuedJobs', async () => extensionJobs.cancelQueued());

ipcMain.handle('extension:retryJob', async (_, id: string) => extensionJobs.retry(id));

ipcMain.handle('extension:clearFinishedJobs', async () => extensionJobs.clearFinished());

ipcMain.handle(
  'extension:installRepository',
  async (_, repoUrl: string, options?: { limit?: number }) => {
    try {
      return await pluginManager.installRepository(repoUrl, {
        limit: options?.limit,
        adultAllowed: bootstrap.isAdultAllowed(),
      });
    } catch (error) {
      return { ...fail(error), installed: 0, failed: 0, skipped: 0 };
    }
  }
);

/**
 * The OTT platform destinations.
 *
 * A separate namespace from `extension:*` because it answers a different
 * question. `extension:*` is "what have I installed?", an inventory keyed on
 * repositories and archives. This is "can I watch Netflix?", keyed on the
 * platform — and it has to answer even when the answer is no, so the list
 * always contains every platform, each carrying how it is reachable rather
 * than being omitted when it is not.
 */
/**
 * The providers that ship with the app.
 *
 * A separate surface from `extension:*` because it answers a different
 * question. `extension:*` is an inventory keyed on repositories and archives —
 * things that were downloaded, can be updated, and can fail to link. These are
 * compiled in: there is nothing to install, nothing to verify and nothing that
 * can be at a compatibility tier. The only thing a user does to one is switch it
 * off, and the only thing they need told is why one is unavailable.
 */
ipcMain.handle('natives:list', async () => {
  try {
    return { ok: true, providers: contentService.getNativeProviders().summaries() };
  } catch (error) {
    return { ...fail(error), providers: [] };
  }
});

ipcMain.handle('natives:setEnabled', async (_event, id: string, enabled: boolean) => {
  try {
    const registry = contentService.getNativeProviders();
    registry.setEnabled(id, enabled);
    // The whole roster comes back, not just the row that changed — the same
    // rule `util/disabledSet.ts` owns: a failed write then shows up as the
    // toggle springing back rather than as a lie on screen.
    return { ok: true, providers: registry.summaries() };
  } catch (error) {
    return { ...fail(error), providers: [] };
  }
});

/**
 * Adds one Stremio addon by its manifest URL.
 *
 * The manifest is fetched and validated here rather than lazily, so a wrong
 * address fails in front of the person who typed it. A URL that is not an addon
 * would otherwise become a provider that is listed, enabled, asked on every
 * search and silently answers nothing — indistinguishable from a source that
 * genuinely has nothing for this title.
 *
 * A URL is accepted here, unlike `ott:installSuggestion`, and the difference is
 * real: this points the app at a **data** endpoint it will parse, where that
 * one would have made "set up Netflix" a way to install *code* from anywhere.
 */
ipcMain.handle('natives:addAddon', async (_event, url: string) => {
  try {
    const registry = contentService.getNativeProviders();
    const addon = await registry.addAddon(String(url ?? ''));
    return { ok: true, addon, providers: registry.summaries() };
  } catch (error) {
    return { ...fail(error), providers: contentService.getNativeProviders().summaries() };
  }
});

ipcMain.handle('natives:removeAddon', async (_event, localId: string) => {
  try {
    const registry = contentService.getNativeProviders();
    registry.removeAddon(String(localId ?? ''));
    return { ok: true, providers: registry.summaries() };
  } catch (error) {
    return { ...fail(error), providers: [] };
  }
});

/**
 * Adds the user's own Jellyfin or Emby server.
 *
 * The key is accepted here, kept in the main process, and **never sent back**:
 * `listServers` strips it. A long-lived credential for somebody's own server has
 * no business crossing the context bridge, where one careless log or error
 * report writes it down permanently.
 */
ipcMain.handle('natives:addServer', async (_event, url: string, apiKey: string) => {
  try {
    const registry = contentService.getNativeProviders();
    const server = await registry.addServer(String(url ?? ''), String(apiKey ?? ''));
    return { ok: true, server, providers: registry.summaries() };
  } catch (error) {
    return { ...fail(error), providers: contentService.getNativeProviders().summaries() };
  }
});

ipcMain.handle('natives:removeServer', async (_event, localId: string) => {
  try {
    const registry = contentService.getNativeProviders();
    registry.removeServer(String(localId ?? ''));
    return { ok: true, providers: registry.summaries() };
  } catch (error) {
    return { ...fail(error), providers: [] };
  }
});

ipcMain.handle('ott:listPlatforms', async () => {
  try {
    return { ok: true, platforms: await ottService.listPlatforms() };
  } catch (error) {
    return { ...fail(error), platforms: [] };
  }
});

/**
 * Which streaming services appear in the sidebar.
 *
 * `includeHidden` is what the settings screen asks with: it has to list the
 * ones that are off in order to offer to switch them on, and every other
 * caller wants the user's chosen set.
 */
/**
 * What is on this service, when no installed provider can say.
 *
 * Separate channel from `ott:getCatalog`, which asks a provider. These rows are
 * a claim about the *platform* and carry no source — opening one runs the
 * app's ordinary search — so folding them into the provider catalogue would
 * make a grid of unplayable posters indistinguishable from a working one.
 */
ipcMain.handle('ott:getMetadataCatalog', async (_, platformId: string) => {
  try {
    if (!platformId) return { ok: false, error: 'No platform was named.' };
    return {
      ok: true,
      supported: OttCatalogService.supports(platformId),
      sections: await ottCatalog.getCatalog(platformId),
    };
  } catch (error) {
    return fail(error);
  }
});

ipcMain.handle('ott:listAllPlatforms', async () => {
  try {
    const platforms = await ottService.listPlatforms(true);
    return { ok: true, platforms, enabled: ottService.shownPlatformIds(platforms) };
  } catch (error) {
    return fail(error);
  }
});

ipcMain.handle('ott:setPlatformEnabled', async (_, platformId: string, enabled: boolean) => {
  try {
    if (!platformId) return { ok: false, error: 'No platform was named.' };
    ottService.setPlatformEnabled(platformId, enabled);
    return { ok: true, enabled: ottService.shownPlatformIds(await ottService.listPlatforms(true)) };
  } catch (error) {
    return fail(error);
  }
});

ipcMain.handle('ott:setPinnedPlatforms', async (_, ids: string[]) => {
  try {
    return { ok: true, pinned: ottService.setPinnedPlatformIds(ids) };
  } catch (error) {
    return fail(error);
  }
});

ipcMain.handle('ott:setPlatformsEnabled', async (_, changes: Record<string, boolean>) => {
  try {
    if (!changes || typeof changes !== 'object') return { ok: false, error: 'No platforms were named.' };
    ottService.setPlatformsEnabled(changes);
    return { ok: true, enabled: ottService.shownPlatformIds(await ottService.listPlatforms(true)) };
  } catch (error) {
    return fail(error);
  }
});

ipcMain.handle(
  'ott:getProviderCatalog',
  async (_, platformId: string, provider: string, options?: { refresh?: boolean }) => {
    try {
      const catalog = await ottService.getProviderCatalog(platformId, provider, {
        refresh: options?.refresh === true,
      });
      if (!catalog) {
        return { ok: false, error: `${provider} is not part of this service.`, catalog: null };
      }
      return { ok: true, catalog };
    } catch (error) {
      return { ...fail(error), catalog: null };
    }
  }
);

ipcMain.handle('ott:getCatalogs', async (_, platformId: string) => {
  try {
    return { ok: true, ...(await ottService.getCatalogs(platformId)) };
  } catch (error) {
    return { ...fail(error), catalogs: [], unavailable: [] };
  }
});

ipcMain.handle('ott:getCatalog', async (_, platformId: string) => {
  try {
    return { ok: true, catalog: await ottService.getCatalog(platformId) };
  } catch (error) {
    return { ...fail(error), catalog: null };
  }
});

ipcMain.handle(
  'ott:getCatalogPage',
  async (
    _,
    provider: string,
    section: { name: string; data: string; horizontalImages?: boolean },
    page: number,
    options?: { refresh?: boolean }
  ) => {
    try {
      return {
        ok: true,
        page: await ottService.getCatalogPage(provider, section, page, {
          refresh: options?.refresh === true,
        }),
      };
    } catch (error) {
      return { ...fail(error), page: null };
    }
  }
);

/**
 * Which providers a search from this platform's page may ask.
 *
 * Returned to the renderer rather than resolved inside `search:start`, because
 * the page needs the same list to say what it is about to search — and a page
 * that claims to search two providers while the main process asks a different
 * two is the class of disagreement `SearchScopePicker` already had once.
 */
ipcMain.handle('ott:getSearchScope', async (_, platformId: string) => {
  try {
    return { ok: true, providers: await ottService.providersFor(platformId) };
  } catch (error) {
    return { ...fail(error), providers: [] };
  }
});

ipcMain.handle('ott:getSuggestions', async (_, platformId: string) => {
  try {
    return { ok: true, suggestions: ottService.suggestionsFor(platformId) };
  } catch (error) {
    return { ...fail(error), suggestions: [] };
  }
});

ipcMain.handle('ott:installSuggestion', async (_, platformId: string, repositoryId: string) => {
  try {
    return await ottService.installSuggestion(platformId, repositoryId);
  } catch (error) {
    return { ...fail(error), installed: 0, failed: 0 };
  }
});

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

/**
 * Scope edits route through the profile store, not straight at the scope.
 *
 * `SearchScopeStore` is downstream of profiles now: every profile switch writes
 * the effective scope into it, so a direct write here would be overwritten by
 * the next switch. Sending the edit through the profiles layer is what makes
 * "tick a box" and "switch profile" the same kind of event, and is why the
 * five paths that read scope did not have to change.
 */
ipcMain.handle('search:setScope', async (_, scope: Partial<SearchScope>) => {
  const profiles = contentService.getProfiles();
  profiles.edit({ providers: scope.providers, indexers: scope.indexers });
  return contentService.getScope().get();
});

// --- source profiles ------------------------------------------------------

/**
 * Named search configurations.
 *
 * Every one of these answers with the whole state rather than an
 * acknowledgement, for the same reason `disabledSet.ts` returns the whole list
 * on every mutation: the renderer holds a list, a selection and an active id
 * that have to agree, and reconstructing that from a delta is how they come to
 * disagree.
 */
function profileSnapshot() {
  const profiles = contentService.getProfiles();
  const state = profiles.get();
  return {
    ok: true as const,
    profiles: state.profiles,
    activeId: state.activeId,
    draft: state.draft,
    label: profiles.activeLabel(),
    narrowed: profiles.isNarrowed(),
  };
}

ipcMain.handle('profiles:list', async () => {
  // Adopting here rather than at construction: a user upgrading into this
  // feature has a selection in the old store and no profiles, and overwriting
  // one with the other at startup would silently widen their next search.
  contentService.getProfiles().adoptExistingScope();
  return profileSnapshot();
});

ipcMain.handle('profiles:activate', async (_, id: string) => {
  contentService.getProfiles().activate(String(id ?? ''));
  return profileSnapshot();
});

ipcMain.handle('profiles:create', async (_, name: string) => {
  contentService.getProfiles().create(String(name ?? ''));
  return profileSnapshot();
});

ipcMain.handle('profiles:rename', async (_, id: string, name: string) => {
  contentService.getProfiles().rename(String(id ?? ''), String(name ?? ''));
  return profileSnapshot();
});

ipcMain.handle('profiles:duplicate', async (_, id: string) => {
  contentService.getProfiles().duplicate(String(id ?? ''));
  return profileSnapshot();
});

ipcMain.handle('profiles:delete', async (_, id: string) => {
  contentService.getProfiles().remove(String(id ?? ''));
  return profileSnapshot();
});

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
          error: describeError(error),
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

ipcMain.handle('extension:getIgnoredUpdates', async () =>
  extensionUpdater.getIgnoredUpdates()
);

ipcMain.handle(
  'extension:ignoreUpdate',
  async (_, internalName: string, reason?: string) => {
    extensionUpdater.ignoreUpdate(internalName, reason, false);
    return { ok: true };
  }
);

ipcMain.handle('extension:unignoreUpdate', async (_, internalName: string) => {
  extensionUpdater.unignoreUpdate(internalName);
  return { ok: true };
});

// --- library, watch progress and source memory ---------------------------

ipcMain.handle('library:getEntries', async (_, status?: WatchStatus) =>
  libraryStore.getEntries(status)
);

ipcMain.handle(
  'library:upsertEntry',
  async (
    _,
    input: Parameters<LibraryStore['upsertEntry']>[0] & {
      sourceQuery?: { mediaUrl: string; season?: number; episode?: number };
    }
  ) => {
    const { sourceQuery, ...fields } = input ?? ({} as typeof input);
    const entry = libraryStore.upsertEntry(fields);
    if (!entry) return null;
    if (isPrivateSession()) return entry;

    /*
     * Adding a title to the library is the statement that its page must keep
     * opening. Pinning here rather than in the store keeps `LibraryStore` free of
     * a dependency on the snapshot cache, and by title rather than URL because
     * that is the identity a library entry actually has.
     */
    pageSnapshots.setPinned({ url: input?.mediaUrl, title: entry?.title, year: entry?.year }, true);

    /*
     * The sources come with it. Whatever discovery already found is saved on the
     * entry now, and a deliberate add (a bucket was chosen) with nothing found yet
     * goes looking in the background. A series is searched by its episode's own
     * address, not its page — that address is linked to the entry so the
     * episode's sources, now and later, are recognised as this title's.
     */
    if (entry && input?.mediaUrl) {
      const target = sourceQuery?.mediaUrl ? sourceQuery : { mediaUrl: input.mediaUrl };
      if (sourceQuery?.mediaUrl) {
        libraryStore.linkSourceAddress(entry.key, sourceQuery.mediaUrl);
      }
      const cached = contentService.peekCachedSources(target.mediaUrl, target.season, target.episode);
      if (cached.length > 0) {
        libraryStore.mergeDiscoveredSources(target.mediaUrl, cached, target.season, target.episode);
      } else if (input.status && !entry.sources?.length) {
        captureLibrarySources(target, entry.title, sourceQuery ? undefined : entry.type);
      }
    }
    return entry;
  }
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

// Enforced in the main process: off means the rows are never assembled, not
// merely not drawn. See `cs3/continueWatching.ts`.
ipcMain.handle('library:getContinueWatching', async (_, limit?: number) =>
  continueWatchingEnabled(datastore) ? libraryStore.getContinueWatching(limit) : []
);

/**
 * Removes one title from the row, keeping where it got to.
 *
 * A dismissal rather than a deletion: "take this off my home screen" and
 * "forget where I was" are different intentions, and the destructive reading of
 * the first is unrecoverable — someone tidying the row would silently lose the
 * resume point on a film they were halfway through.
 */
ipcMain.handle('library:dismissContinueWatching', async (_, key: string) => {
  try {
    const removed = libraryStore.dismissFromContinueWatching(key);
    logger.info('library', 'continue_watching_dismissed', { mediaId: key, removed });
    return { ok: true, removed };
  } catch (error) {
    return { ...fail(error), removed: false };
  }
});

ipcMain.handle('library:clearContinueWatching', async () => {
  try {
    const cleared = libraryStore.clearContinueWatching();
    logger.info('library', 'continue_watching_cleared', { cleared });
    return { ok: true, cleared };
  } catch (error) {
    return { ...fail(error), cleared: 0 };
  }
});

ipcMain.handle('library:getContinueWatchingEnabled', async () => ({
  ok: true,
  enabled: continueWatchingEnabled(datastore),
}));

ipcMain.handle('library:setContinueWatchingEnabled', async (_, enabled: boolean) => {
  setContinueWatchingEnabled(datastore, enabled);
  return { ok: true, enabled };
});

// --- the source that actually played ---------------------------------------

/**
 * Saving and re-opening the exact stream that worked.
 *
 * The library already remembers *what* was watched and the bookmarks remember
 * *which page* it came from. Neither remembers **which of thirty sources
 * actually delivered it** — so returning to a title meant picking again from a
 * list, with no record that the fourth one down is the only one that ever
 * played.
 *
 * The link is stored, but it is never the identity: a provider URL is a signed
 * address on someone else's CDN, good for minutes. What makes the record
 * durable is the `origin` query beside it, which is replayed to obtain a fresh
 * link for the same release when the stored one has died.
 */
ipcMain.handle(
  'library:recordPlayedSource',
  async (
    _,
    input: {
      title: string;
      year?: number;
      mediaUrl: string;
      episodeTitle?: string;
      season?: number;
      episode?: number;
      source: TorrentResult;
      positionSeconds?: number;
      durationSeconds?: number;
      provenance?: { provider?: string; extensionName?: string; repositoryName?: string };
      originalTitle?: string;
      posterUrl?: string;
      imdbId?: string;
      preferences?: PlaybackPreferences;
    }
  ) => {
    try {
      const key = canonicalKey(input.title, input.year);
      const stored = torrentResultToStoredSource(input.source);

      /**
       * The deadline is read from the URL now, while we have it.
       *
       * `SourceCache` already knows how to find one — CloudFront's `Expires`,
       * a JWT `exp`, and the handful of other schemes providers actually use.
       * Recording it here is what lets `isLinkUsable` answer later without
       * another request; without it every saved source would be re-resolved on
       * every open, which is the cost this feature exists to avoid.
       */
      if (stored.directUrl && stored.expiresAt === undefined) {
        const deadline = deadlineFromUrl(stored.directUrl);
        if (deadline) stored.expiresAt = deadline;
      }

      const record = libraryStore.recordPlayedSource({
        key,
        season: input.season,
        episode: input.episode,
        source: stored,
        origin: {
          mediaUrl: input.mediaUrl,
          title: input.title,
          year: input.year,
          episodeTitle: input.episodeTitle,
          provider: input.provenance?.provider,
          extensionName: input.provenance?.extensionName,
          repositoryName: input.provenance?.repositoryName,
          originalTitle: input.originalTitle,
          posterUrl: input.posterUrl,
          imdbId: input.imdbId,
        },
        positionSeconds: input.positionSeconds,
        durationSeconds: input.durationSeconds,
        preferences: input.preferences,
      });
      return { ok: true, record };
    } catch (error) {
      return { ...fail(error), record: null };
    }
  }
);

/**
 * The viewer changed a track (or kept watching) on a source already recorded.
 *
 * Separate from recording because the record is written once, at ten seconds
 * of real playback — and the dub or subtitle a viewer settles on is usually
 * chosen after that. Nothing is created here: a source that never reached the
 * threshold is not one worth resuming.
 */
ipcMain.handle(
  'library:updatePlayedSourcePreferences',
  async (
    _,
    input: {
      title: string;
      year?: number;
      season?: number;
      episode?: number;
      preferences?: PlaybackPreferences;
      positionSeconds?: number;
    }
  ) => {
    try {
      const updated = libraryStore.updatePlayedSourcePreferences(
        canonicalKey(input.title, input.year),
        input.season,
        input.episode,
        { preferences: input.preferences, positionSeconds: input.positionSeconds }
      );
      return { ok: true, updated };
    } catch (error) {
      return { ...fail(error), updated: false };
    }
  }
);

ipcMain.handle(
  'library:getPlayedSource',
  async (_, key: string, season?: number, episode?: number) => ({
    ok: true,
    record: libraryStore.getPlayedSource(key, season, episode),
  })
);

ipcMain.handle('library:listPlayedSources', async (_, limit?: number) => ({
  ok: true,
  records: libraryStore.listPlayedSources(limit),
}));

ipcMain.handle('library:getPlayedSourcesForKey', async (_, key: string) => ({
  ok: true,
  records: libraryStore.getPlayedSourcesForKey(key),
}));

ipcMain.handle(
  'library:forgetPlayedSource',
  async (_, key: string, season?: number, episode?: number) => ({
    ok: true,
    removed: libraryStore.forgetPlayedSource(key, season, episode),
  })
);

/**
 * Hands back a playable source for a saved record, refreshing it if it has died.
 *
 * Three outcomes, and the caller is told which — because they mean different
 * things to the viewer and a single "here is a stream" would hide the one that
 * matters:
 *
 * - `reused` — the stored link still holds. Instant; no provider was contacted.
 * - `refreshed` — the link had expired, so the *same release* was re-resolved
 *   from the same provider and the record updated in place.
 * - `unavailable` — the provider no longer offers that release. The record is
 *   marked rather than deleted, because "the one that used to work is gone" is
 *   more useful than an entry that silently vanishes, and the full source list
 *   comes back so the viewer can choose again.
 */
/**
 * The source a resumed title last played from, as a playback session takes it.
 *
 * Local reads only: a Play press must not wait on a provider to decide what to
 * try first. A saved link that has expired is not refreshed here — the
 * session's own discovery is already re-asking, and `pickReplacement` finds the
 * same release in its answer.
 */
function resumePreference(key: string, season?: number, episode?: number): ResumePreference | undefined {
  const record = libraryStore.getPlayedSource(key, season, episode);
  if (record && record.source.status !== 'Unavailable') {
    return {
      start: isLinkUsable(record.source) ? storedSourceToTorrentResult(record.source) : undefined,
      match: (candidates) => pickReplacement(record.source, candidates),
    };
  }

  /*
   * Nothing played for this exact episode — the usual case for "next episode"
   * or a series resumed after finishing one. The most recent source played for
   * any episode of the title still says which provider, resolution and dub the
   * viewer settled on, so it orders the walk without pinning anything.
   */
  const sibling = libraryStore
    .getPlayedSourcesForKey(key)
    .filter((entry) => entry.source.status !== 'Unavailable')
    .sort((a, b) => b.playedAt - a.playedAt)[0];
  if (!sibling) return undefined;
  return { match: (candidates) => pickSibling(sibling.source, candidates) };
}

ipcMain.handle(
  'library:resolvePlayedSource',
  async (_, key: string, season?: number, episode?: number) => {
    try {
      const record = libraryStore.getPlayedSource(key, season, episode);
      if (!record) {
        return {
          ok: false,
          error: 'No source has been saved for this item.',
          resolution: null,
          sources: [],
        };
      }

      if (isLinkUsable(record.source)) {
        return {
          ok: true,
          resolution: 'reused' as const,
          record,
          source: storedSourceToTorrentResult(record.source),
          sources: [],
        };
      }

      /**
       * The saved link is dead, so the query that produced it is replayed.
       * `bypassCache` because a cached answer is what just failed.
       */
      const discovered = await contentService.getSources(
        {
          mediaUrl: record.origin.mediaUrl,
          titleOverride: record.origin.title,
          season: record.season,
          episode: record.episode,
        },
        undefined,
        { bypassCache: true }
      );

      const replacement = pickReplacement(record.source, discovered.sources);
      if (!replacement) {
        libraryStore.markPlayedSourceUnavailable(
          key,
          'The provider no longer offers this release.',
          season,
          episode
        );
        return {
          ok: false,
          resolution: 'unavailable' as const,
          error:
            'The exact source you saved is no longer offered by that provider. ' +
            'Pick another from the list below.',
          record,
          // The alternatives, so this is a choice rather than a dead end.
          sources: discovered.sources,
        };
      }

      const refreshed = torrentResultToStoredSource(replacement);
      const updated = libraryStore.updatePlayedSourceLink(
        key,
        {
          directUrl: refreshed.directUrl,
          directHeaders: refreshed.directHeaders,
          magnet: refreshed.magnet,
          isM3u8: refreshed.isM3u8,
          expiresAt: refreshed.directUrl ? deadlineFromUrl(refreshed.directUrl) ?? undefined : undefined,
        },
        season,
        episode
      );

      return {
        ok: true,
        resolution: 'refreshed' as const,
        record: updated ?? record,
        source: replacement,
        sources: discovered.sources,
      };
    } catch (error) {
      return { ...fail(error), resolution: null, sources: [] };
    }
  }
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

ipcMain.handle('history:exportAll', async () =>
  historyStore.exportAll()
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

// --- whole-app backup ------------------------------------------------------

/**
 * Every store that makes an installation *this* installation, each registered
 * as a section with its own rows, schema version and restore rules — see
 * `cs3/backupSections.ts` for the table and `BackupService` for the design.
 */
const backupService = new BackupService(
  createBackupSections({
    datastore,
    library: libraryStore,
    history: historyStore,
    bookmarks,
    pageSnapshots,
    searchHistory,
    savedSearches,
    titleOutcomes,
    providerAnalytics,
    downloads: downloadService,
    plugins: pluginManager,
    enqueueExtensionJobs: (requests) => {
      extensionJobs.enqueue(requests);
    },
    isAdultAllowed: () => bootstrap.isAdultAllowed(),
    indexers: contentService.getRegistry(),
    adult: bootstrap,
  }),
  app.getVersion(),
  `${process.platform} ${os.release()}`,
  { recoveryDir: path.join(app.getPath('userData'), 'backups') }
);

ipcMain.handle('backup:export', async (_, only?: string[]) => {
  try {
    if (!mainWindow) return { ok: false, error: 'No window to ask from.' };
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export CloudStream data',
      defaultPath: BackupService.suggestedFilename(),
      filters: [{ name: 'CloudStream backup', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, cancelled: true };
    return backupService.write(result.filePath, only);
  } catch (error) {
    return fail(error);
  }
});

/**
 * Chooses a file and compares it with this installation, changing nothing —
 * the summary, the counts and the conflicts the restore screen shows.
 */
ipcMain.handle('backup:inspect', async () => {
  try {
    if (!mainWindow) return { ok: false, error: 'No window to ask from.' };
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose a CloudStream backup',
      properties: ['openFile'],
      filters: [{ name: 'CloudStream backup', extensions: ['json'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return { ok: false, cancelled: true };
    return backupService.analyze(result.filePaths[0]);
  } catch (error) {
    return fail(error);
  }
});

ipcMain.handle('backup:restore', async (_, filePath: string, plan: RestorePlan) => {
  try {
    if (!filePath) return { ok: false, error: 'No backup file was chosen.', sections: [] };
    if (!plan || !Array.isArray(plan.sections)) {
      return { ok: false, error: 'Nothing was chosen to restore.', sections: [] };
    }
    return await backupService.restore(filePath, plan);
  } catch (error) {
    return { ...fail(error), sections: [] };
  }
});

/**
 * What it would take to make a provider answer again, and doing it.
 *
 * Two channels rather than one, and deliberately: the plan can name a
 * repository fetch and an extension install, which is real time and real
 * bandwidth. Folding them together would commit a user who pressed a button
 * labelled "why is this not working?".
 */
ipcMain.handle('extension:planProviderRecovery', async (_, provider: string) => {
  try {
    if (!provider) return { ok: false, error: 'No provider was named.' };
    return { ok: true, plan: pluginManager.planProviderRecovery(provider) };
  } catch (error) {
    return fail(error);
  }
});

ipcMain.handle('extension:planProviderRecoveryBulk', async (_, providers: string[]) => {
  try {
    if (!Array.isArray(providers) || providers.length === 0) {
      return { ok: true, plans: [] };
    }
    return { ok: true, plans: pluginManager.planProviderRecoveryBulk(providers) };
  } catch (error) {
    return fail(error);
  }
});

ipcMain.handle('extension:recoverProviders', async (_, providers: string[]) => {
  try {
    if (!Array.isArray(providers) || providers.length === 0) {
      return { ok: true, results: [] };
    }
    return { ok: true, results: await pluginManager.runProviderRecoveryBulk(providers) };
  } catch (error) {
    return fail(error);
  }
});

ipcMain.handle('extension:recoverProvider', async (_, provider: string) => {
  try {
    if (!provider) return { ok: false, error: 'No provider was named.' };
    return await pluginManager.runProviderRecovery(provider);
  } catch (error) {
    return fail(error);
  }
});

/** Puts back what the last restore changed, from the copy it saved first. */
ipcMain.handle('backup:undoRestore', async () => {
  try {
    return await backupService.undo();
  } catch (error) {
    return { ...fail(error), sections: [] };
  }
});

/**
 * Where new downloads go. It used to be a field in Settings that remembered
 * nothing and changed nothing while saying "Download folder updated."
 * Existing downloads keep their paths; this decides new ones only.
 */
ipcMain.handle('download:getDirectory', async () => ({
  ok: true,
  directory: storage.downloadsDir(),
  isDefault: !datastore.getString(DOWNLOAD_DIRECTORY_KEY, '', true),
}));

ipcMain.handle('download:setDirectory', async (_, directory: string | null) => {
  try {
    if (directory) {
      const resolved = path.resolve(String(directory));
      fs.mkdirSync(resolved, { recursive: true });
      fs.accessSync(resolved, fs.constants.W_OK);
      datastore.setString(DOWNLOAD_DIRECTORY_KEY, resolved, true);
    } else {
      datastore.setString(DOWNLOAD_DIRECTORY_KEY, '', true);
    }
    return { ok: true, directory: storage.downloadsDir() };
  } catch (error) {
    return { ...fail(error), directory: storage.downloadsDir() };
  }
});

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

/**
 * What this launch cost, and what blocked the main thread while it happened.
 *
 * Developer mode only on the renderer side, and that is a presentation choice
 * rather than a guard: the numbers name internal stages and mean nothing to a
 * viewer. The channel itself is unconditional, because a reporter being asked
 * to turn developer mode on before they can answer "why is it slow" is the
 * diagnostic being unavailable exactly when it is wanted.
 *
 * The background queue travels with it. A startup that looks fine and a feature
 * that never arrived are the same report, and splitting them across two
 * channels would mean the panel could show one without the other.
 */
ipcMain.handle('app:getStartupProfile', async () => {
  try {
    return { ok: true, profile: startup.snapshot(), tasks: background.report() };
  } catch (error) {
    return fail(error);
  }
});
