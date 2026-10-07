# Architecture Overview

CloudStream 3 Desktop (`cs3_windows/`) is an Electron 43 + React 19 + TypeScript application that ports the
Android CloudStream 3 app and keeps the community `.cs3` extension ecosystem working. This is the
authoritative map; deeper topics are linked, not repeated.

> Source of truth: `cs3_windows/electron/`, `cs3_windows/src/`, `sidecar/`. Verified against the tree on
> 2026-10-07 (see [../VERIFICATION.md](../VERIFICATION.md) for what was checked and what is inherited).

## 1. Process model

```
┌───────────────────────── RENDERER  (src/, React 19, Vite) ─────────────────────────┐
│ App.tsx (tab state, player state) · views/* · components/* · utils/*               │
└───────────────┬────────────────────────────────────────────────────────────────────┘
                │ window.cloudstream.*   (contextBridge, electron/preload.ts, 2,473 lines)
┌───────────────┴────────────────────────────────────────────────────────────────────┐
│ MAIN PROCESS  electron/main.ts (6,220 lines): constructs every service as a         │
│ singleton and registers 334 ipcMain.handle channels                                 │
│                                                                                     │
│  ContentService ─ PlaybackSessionManager ─ SearchSessionManager ─ DownloadService   │
│  PluginManager ── SidecarSupervisor ══ stdio JSON-RPC ══► JVM sidecar (child proc)  │
│  TorrentEngine (WebTorrent + loopback HTTP) · MediaProxy · MediaTranscoder          │
│  PlaybackEngine → MediaInspector/decisionEngine → MpvEngine (child proc)            │
│  DatastoreManager · LibraryStore · HistoryStore · many JSON stores                  │
└────────────────────────────────────────────────────────────────────────────────────┘
        child processes: JVM sidecar · mpv · ffmpeg/ffprobe · aria2c · yt-dlp · VLC (external)
```

| Layer | Location | Notes |
|---|---|---|
| Renderer | `cs3_windows/src/` | `contextIsolation: true`, `nodeIntegration: false`. Routes are `React.lazy` chunks. |
| Preload | `cs3_windows/electron/preload.ts` | The **only** bridge. Typed as `CloudStreamElectronAPI`. |
| Main | `cs3_windows/electron/` | Services; `electron/cs3/` holds the CloudStream-specific domain, `electron/media/`, `electron/torrent/`, `electron/metadata/`, `electron/download/`, `electron/logging/`. |
| Shared types | `cs3_windows/src/types/*.ts` | Imported by both sides on purpose. |
| Sidecar | `sidecar/` (Java 21, Maven) + `sidecar/bridge/` (Kotlin) | Runs Android `.cs3` extensions. See [extensions.md](extensions.md). |
| Tooling | `tools/package`, `tools/e2e`, `tools/research` | Packaging and live-network harnesses. |

## 2. Service map (main process)

Constructed in `electron/main.ts`. Responsibilities are one line each; interfaces are in
[api-services.md](api-services.md).

| Area | Services (file) |
|---|---|
| Content pipeline | `ContentService` (`contentService.ts`), `PlaybackSessionManager` (`playbackSession.ts`), `SearchSessionManager` (`searchSession.ts`), `SourceCache` (`sourceCache.ts`), `SourcePrefetcher`, `SearchScopeStore`, `SourceProfileStore` |
| Providers | `PluginManager` (`pluginManager.ts`), `SidecarSupervisor`, `ProviderRegistry`, `NativeProviderRegistry`, `ProviderAnalytics/Ranking/Recommender`, `BootstrapService`, `ExtensionUpdater`, `ExtensionJobQueue`, `RuntimeProvisioner` |
| Torrent / indexers | `TorrentEngine`, `IndexerRegistry` + `torrent/indexers/*`, `TorrentMetadataCache`, `DhtNodeCache` |
| Media | `PlaybackEngine`, `MediaInspector`, `decisionEngine`, `MpvEngine`, `MediaProxy`, `MediaTranscoder`, `ExternalPlayerService` |
| Metadata | `MetadataProvider`/`Cinemeta`/`AniList`, `MetadataEnrichmentService`, `DiscoveryService`, `TitleEnricher`, `DetailCache`, `CatalogueCache` |
| User data | `DatastoreManager`, `LibraryStore`, `HistoryStore`, `BookmarkStore`, `PageSnapshotStore`, `SavedSearches`, `SearchHistory`, `TitleOutcomeStore`, `TitleInteractionStore`, `BackupService` |
| Downloads | `DownloadService`, `Aria2Engine`, `YtDlpEngine`, `FastChunkDownloader`, `httpDownloader`, `BatchDownloader` |
| Platform | `Logger`, `DiagnosticsLog`, `ExtensionIssueLog`, `PrivacyMode`, `StartupQueue`, `startupProfile`, `WebViewHost`, `ClearanceStore` |

## 3. How the pieces talk

* **Renderer → main:** `ipcRenderer.invoke('ns:method')` through `window.cloudstream`. 334 channels across
  42 namespaces (see [api-services.md](api-services.md#ipc-surface)). Fallible handlers return an envelope
  `{ ok, error?, …payload }` via `fail()` and never reject. **An unregistered channel rejects** — there is no envelope.
* **Main → renderer (push):** long-running work is push-shaped: `playback:update`, `search:update`,
  `search:suggestUpdate`, `extension:jobsUpdate`, `metadata:extendedUpdate`, `mpv:update`, `external:update`,
  `adult:changed`, `privacy:changed`, `discover:invalidated`. The start call returns an id immediately.
* **Main ↔ JVM:** line-delimited JSON-RPC over the sidecar's stdio, in both directions. stdout carries RPC
  frames only; logs go to stderr. The reverse direction lets the JVM ask the host for a browser
  (`webViewHost.ts`) and for bot-wall clearances (`clearance.ts`).
* **Main ↔ players:** the renderer and mpv/VLC are handed **loopback** URLs from `MediaProxy` (or the torrent
  server), never provider URLs.

## 4. Startup sequence

1. `startupProfile.ts` is the first import (records stages and main-thread stalls).
2. Services are constructed at module scope; nothing heavy may run here (see [caching.md](caching.md#startup)).
3. `app.whenReady()` → window + menu. The renderer paints a ~311 kB first chunk.
4. A prioritised `StartupQueue` (`util/startupQueue.ts`) runs background tasks serially, with named lanes
   (`media`, `extensions`, `catalogue`): ffmpeg capability probe (priority 80) → load installed extensions
   (70) → start torrent client (40) → refresh repository listings (20).
5. First run: `FirstRunBanner`, `RegionOnboarding`, and `BootstrapService` install starter extensions
   (see [repositories.md](repositories.md)).
6. Shutdown is on `before-quit`, raced against a 5 s deadline; a service still pending is logged as `shutdown_timeout`.

## 5. Where state lives (summary)

Detail in [persistence.md](persistence.md) and [caching.md](caching.md).

| Kind | Mechanism |
|---|---|
| Preferences, library, history, source cache | `cs3_datastore.json` through `DatastoreManager` (debounced 250 ms, atomic rename) |
| Large/independent stores | their own `cs3-*.json` files under `userData` |
| Extensions | `userData` install tree + `cs3-provider-registry.json` + provisioned runtime in `userData/cs3-runtime/` |
| Volatile | in-memory session maps: playback sessions, search sessions, proxy routes, in-flight discovery |

## 6. Cross-cutting rules

* Nothing is decided from a URL string; transport/codec/DRM come from the body or the provider's declaration.
* `media:prepare` is the only source of a playable URL.
* A scope selection is a strict filter, never a preference.
* `empty` is not `failure`; nothing is auto-disabled.
* Heavy modules load behind the feature that needs them.

Full rule list: [../ai/coding-agent-guide.md](../ai/coding-agent-guide.md) and `CLAUDE.md` §12.

## 7. Related documents

[core-concepts.md](core-concepts.md) · [streaming.md](streaming.md) · [downloading.md](downloading.md) ·
[providers.md](providers.md) · [extensions.md](extensions.md) · [repositories.md](repositories.md) ·
[search.md](search.md) · [caching.md](caching.md) · [persistence.md](persistence.md) · [player.md](player.md) ·
[api-services.md](api-services.md) · [../ui/overview.md](../ui/overview.md)
