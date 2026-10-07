# API and Service Architecture

## 1. The IPC contract

`electron/preload.ts` is the only bridge (`contextIsolation: true`, `nodeIntegration: false`), exposing
`window.cloudstream` typed as `CloudStreamElectronAPI`. **Four things change together** when crossing it:
1. the service in `electron/`, 2. `ipcMain.handle('ns:name', …)` in `main.ts`, 3. the method + type in
`CloudStreamElectronAPI` (`preload.ts`), 4. the caller in `src/`. Shared types live in `src/types/*.ts`.

Rules:
* Fallible handlers return `{ ok, error?, …payload }` via `fail()` and never reject.
* **`ipcRenderer.invoke` on an unregistered channel rejects** (no envelope). `electron/ipcSurface.test.mts`
  (`bun run test ipc`, runs first) pins channel parity lexically (invoked-not-registered, registered-not-invoked,
  pushed-not-listened). Exceptions go in commented allow-lists.
* Push channels use `subscribe()` in preload (teardown prevents listener accumulation across remounts).
* Stores return **whole state**, never deltas (`profiles:*`, scope trio, jobs queue).
* The renderer never gets a playable URL except from `media:prepare`, and never gets credentials (`natives:addServer` takes a key, returns none).

## 2. IPC surface {#ipc-surface}

Generated from `ipcMain.handle(...)` registrations on 2026-10-07: **334 channels, 42 namespaces**. Regenerate rather than
editing by hand (a lexical scan of `electron/**/*.ts`, multi-line registrations included).

| Namespace | Count | Channels |
|---|---|---|
| `extension:` | 48 | addRepository, analyzePlugin, cancelJob, cancelQueuedJobs, checkUpdates, clearFinishedJobs, enqueueJobs, fetchRepository, getAdultAllowed, getAdultMode, getBootstrapProgress, getCachedUpdates, getIgnoredUpdates, getInstalledPlugins, getInstalledRepositories, getJobs, getOfficialRepositories, getProviderTree, getProviders, getRuntimeReport, getUpdateSettings, hasPreviousVersion, ignoreUpdate, installPlugin, installRepository, lockAdultForSession, peekRepository, planProviderRecovery, planProviderRecoveryBulk, recoverProvider, recoverProviders, removeRepository, retryJob, rollback, saveUpdateSettings, setAdultAllowed, setAdultMode, setExtensionEnabled, setExtensionsEnabled, setProviderEnabled, setProvidersEnabled, setRepositoriesEnabled, setRepositoryEnabled, unignoreUpdate, uninstallPlugin, unlockAdultForSession, update, updateAll |
| `library:` | 27 | clearContinueWatching, clearProgress, dismissContinueWatching, export, forgetPlayedSource, getContinueWatching, getContinueWatchingEnabled, getEntries, getEntryForUrl, getPlayedSource, getPlayedSourcesForKey, getProgressForKey, getSources, import, listPlayedSources, recallSource, recordPlayedSource, recordProgress, refreshSources, rememberSource, removeEntry, resolvePlayedSource, setContinueWatchingEnabled, setSources, setStatus, setUserRating, upsertEntry |
| `torrent:` | 20 | autoPlay, clearCache, downloadFile, getActiveStreams, getCachePath, getContents, getStats, getSwarmReport, importFiles, importMagnet, isMagnet, listImports, pickFiles, playFile, removeImport, resolveMagnet, selectFile, startBestStream, startStream, stopStream |
| `mpv:` | 20 | addSubtitle, getPolicy, open, seek, setAudioTrack, setFullscreen, setMuted, setOnTop, setPaused, setPolicy, setSpeed, setSubtitleDelay, setSubtitleStyle, setSubtitleTrack, setVideoEnabled, setVideoTrack, setVolume, snapshot, status, stop |
| `download:` | 16 | cancelBatch, enqueue, getActiveBatches, getConfirmPreference, getDeletePreference, getPlayableUrl, getQueue, pause, preview, remove, request, resume, revealInFolder, setConfirmPreference, setDeletePreference, startBatch |
| `api:` | 13 | browse, clearSearchHistory, getPluginRuntimeStatus, getProviderProvenance, getProviderProvenanceMap, getSearchHistory, getSources, getTitleOutcomes, loadMedia, recordTitleOutcome, removeSearchHistory, searchAll, suggest |
| `ott:` | 13 | getCatalog, getCatalogPage, getCatalogs, getMetadataCatalog, getProviderCatalog, getSearchScope, getSuggestions, installSuggestion, listAllPlatforms, listPlatforms, setPinnedPlatforms, setPlatformEnabled, setPlatformsEnabled |
| `search:` | 10 | cancel, getConcurrency, getSaved, getScopeOptions, listSaved, removeSaved, saveResults, setConcurrency, setScope, start |
| `analytics:` | 10 | applyAutoEnable, getLeaderboard, getRecommendations, getSettings, observe, reset, resetWeights, setPreference, setSettings, setWeight |
| `playback:` | 10 | cancelSourceSearch, playNow, recordBufferHeartbeat, recordBufferStall, refreshSources, selectSource, skipSource, start, startDiscovery, stop |
| `external:` | 10 | capability, open, seek, setFullscreen, setMuted, setPaused, setSpeed, setVolume, snapshot, stop |
| `media:` | 9 | closeStream, getCodecProbes, getPlaybackDiagnostics, getProbeConfig, inspect, prepare, setCapabilities, setProbeConfig, switchAudio |
| `history:` | 9 | clearAll, deleteItem, deleteItems, exportAll, get, getStats, list, recordEvent, updateEvent |
| `sources:` | 8 | cancelPrefetch, clearCache, getCacheStats, getPreferences, getPrefetchSetting, prefetch, savePreferences, setPrefetchSetting |
| `binary:` | 8 | checkBinaries, remove, setupAll, setupFfmpeg, setupMpv, setupYtDlp, testAll, testOne |
| `subtitles:` | 6 | download, fetch, find, listSaved, readSaved, removeSaved |
| `discover:` | 6 | enrich, more, refresh, resolveTitle, rows, sections |
| `bookmarks:` | 6 | get, list, markOpened, remove, setNote, toggle |
| `indexer:` | 6 | getConfigs, getHealth, removeConfig, saveConfig, saveConfigs, test |
| `natives:` | 6 | addAddon, addServer, list, removeAddon, removeServer, setEnabled |
| `profiles:` | 6 | activate, create, delete, duplicate, list, rename |
| `datastore:` | 6 | exportBackup, getObject, getSetting, importBackup, setObject, setSetting |
| `log:` | 5 | exportSession, query, reveal, sessions, setLevel |
| `runtime:` | 5 | clean, getStatus, provision, repair, test |
| `metadata:` | 5 | clearCache, findRelatedMedia, findTrailers, getExtended, peekExtended |
| `diagnostics:` | 4 | clear, list, record, report |
| `issues:` | 4 | annotate, clear, list, report |
| `home:` | 4 | listProviders, selectProvider, setCustomCatalogUrl, setTmdbKey |
| `player:` | 4 | getPreferences, listExternal, openExternal, setPreferences |
| `network:` | 4 | get, reset, set, test |
| `backup:` | 4 | export, inspect, restore, undoRestore |
| `interactions:` | 3 | clearVisits, summarise, visit |
| `privacy:` | 3 | getState, setActive, updateSettings |
| `pages:` | 3 | getSnapshot, remember, setPinned |
| `app:` | 3 | getStartupProfile, relaunch, reload |
| `ratings:` | 2 | get, refresh |
| `window:` | 2 | getAlwaysOnTop, setAlwaysOnTop |
| `regions:` | 2 | get, set |
| `components:` | 1 | getStatus |
| `videos:` | 1 | resolve |
| `shell:` | 1 | openExternal |
| `dialog:` | 1 | selectDirectory |

Channel groups with non-obvious semantics:

| Group | Shape |
|---|---|
| `playback:*` | **Push.** `start` returns a session id immediately; `update` snapshots follow. `{ persistent }` walks every source then widens once. |
| `search:*` | **Push.** `start` → opening snapshot, `update`, `cancel`, `suggestUpdate`; saved searches `saveResults/listSaved/getSaved/removeSaved`. |
| `media:*` | `inspect` classifies; **`prepare` is the only source of a playable URL**; `switchAudio/closeStream`; `setCapabilities/getCodecProbes`; `getPlaybackDiagnostics`. |
| `mpv:*` | `open` (prepared URL only), transport/track controls, `update` push, `get/setPolicy`. No raw-link channel. |
| `extension:*` | Repos, installs, updates, jobs (`enqueueJobs`, `jobsUpdate` push, `cancel*`, `retryJob`), `rollback`, runtime reports, regions bootstrap. Direct handlers remain for callers that await one result. |
| `download:*` | `request` (button press, state-aware) vs `enqueue`; `preview`; confirm preference. |
| `history:*`, `library:*`, `bookmarks:*`, `interactions:*`, `pages:*` | user-data reads/writes; `interactions:summarise` is a batched read for one screen's cards; `pages:*` capture is **not exposed** (happens in `ContentService.load`). |
| `ott:*`, `natives:*`, `home:*`, `discover:*`, `regions:*` | platform/provider/catalogue/region surfaces; `ott:installSuggestion` takes a repository id, never a URL. |
| `backup:*`, `datastore:*` | `backup:*` is the whole-installation backup; `datastore:*` includes the Android-format import/export. |
| `app:getStartupProfile` | Read-shaped, unconditional (not gated by developer mode). |

## 3. Service reference

Format: purpose · dependencies · storage · callers. Source of truth is the file named; line counts from 2026-10-07.

| Service (file) | Purpose | Depends on | Storage | Called by |
|---|---|---|---|---|
| `ContentService` (`contentService.ts`, 2,591 L) | search → detail → sources → stream orchestration; routes/alternates; promo videos | PluginManager, TorrentEngine, IndexerRegistry, SourceCache, NativeProviderRegistry, MediaProxy, SearchScopeStore | source cache, page snapshots (via setters) | `api:*`, `sources:*`, `playback:*`, `search:*`, `videos:*` |
| `PlaybackSessionManager` (`playbackSession.ts`, 1,060 L) | one "Play" interaction; discovery progress; source switching/refresh | ContentService | memory | `playback:*` |
| `SearchSessionManager` (`searchSession.ts`) | one search; fan-out; push snapshots | PluginManager, IndexerRegistry, native registry, scope | memory | `search:*` |
| `PluginManager` (`pluginManager.ts`) | repos, install, enable cascade, provider RPC, explain | SidecarSupervisor, ProviderRegistry, DatastoreManager | extensions dir, datastore | most `extension:*`, search, playback |
| `SidecarSupervisor` (`cs3/sidecarSupervisor.ts`) | JVM lifecycle + JSON-RPC both ways | RuntimeProvisioner, WebViewHost | — | PluginManager |
| `PlaybackEngine` (`media/playbackEngine.ts`) | inspect → decide → open; capabilities; telemetry | MediaInspector, MediaProxy, MediaTranscoder, MpvEngine | InspectionStore | `media:*` |
| `MediaProxy` (`mediaProxy.ts`, 1,920 L) | loopback proxy with headers, manifest rewrite, ranges | net.fetch | memory (routes) | ContentService, PlaybackEngine, subtitles |
| `MpvEngine` (`media/mpvEngine.ts`) | native player over JSON IPC | mpv binary | — | `mpv:*`, PlaybackEngine |
| `TorrentEngine` (`torrent/torrentEngine.ts`) | WebTorrent + loopback HTTP | webtorrent (lazy) | DHT cache, metadata cache | ContentService, DownloadService, `torrent:*` |
| `DownloadService` (`downloadService.ts`, 1,462 L) | queue, engines, resume, verify | Aria2Engine, YtDlpEngine, ContentService, HistoryStore | datastore | `download:*`, BatchDownloader |
| `DatastoreManager` (`datastore.ts`) | typed key-value store, Android grammar | fs | `cs3_datastore.json` | everything |
| `LibraryStore` (`cs3/libraryStore.ts`, 1,046 L) | library, progress, played sources, stored sources | DatastoreManager, PrivacyMode | datastore | `library:*` |
| `HistoryStore` (`cs3/historyStore.ts`) | event log | DatastoreManager, PrivacyMode | datastore | `history:*`, DownloadService |
| `BackupService` (`cs3/backupService.ts`) | whole-install backup/restore | section table | files chosen by user | `backup:*` |
| `DiscoveryService` (`cs3/discovery.ts`) + `HomeProviderRegistry` | Home catalogues, SWR | catalogue hosts, natives | discovery cache | `discover:*`, `home:*` |
| `MetadataEnrichmentService` (`metadata/enrichmentService.ts`) | extended metadata, push | TitleEnricher, source adapters | metadata cache | `metadata:*` |
| `BootstrapService` (`cs3/bootstrap.ts`) | first-run installs, adult gate, regions | PluginManager | datastore | `extension:*`, `regions:*` |
| `ExtensionUpdater` / `ExtensionJobQueue` | OTA updates; background jobs | PluginManager | datastore | `extension:*` |
| `ProviderAnalytics` / `Ranking` / `Recommender` | measure, score, advise | — | `cs3-provider-analytics.json` | SearchSession, settings panel |
| `Logger` / `DiagnosticsLog` / `ExtensionIssueLog` | transcript / failure tuples / durable tally | — | logs dir, `cs3-diagnostics.json`, `cs3-extension-issues.json` | `log:*`, `diagnostics:*`, `issues:*` |
| `PrivacyMode` (`cs3/privacyMode.ts`) | Incognito | DatastoreManager | memory (+ flag if remembered) | every automatic-activity store |
| `ExternalPlayerService` (+Control) | detect/launch/drive external players | child_process, VLC HTTP | — | `external:*`, `player:*` |
| `StartupQueue` / `startupProfile` | prioritised background tasks; startup stages & stalls | — | memory | `main.ts`, `app:getStartupProfile` |

## 4. Error-handling conventions
* `describeError` (`src/utils/errors.ts`) everywhere — never `x instanceof Error ? x.message : String(x)`; the real reason is in `error.cause`.
* Timeout ≠ cancellation: `AbortSignal.timeout()` → `TimeoutError`; the caller's controller → `AbortError`.
* A GraphQL 200 can be a failure (AniList): check `errors`.
* Anything reaching a third-party host goes through `electron/torrent/http.ts` (Electron `net.fetch`; honours DoH and the system proxy).
* A catch that reassures is worse than no catch — surface the reason.
