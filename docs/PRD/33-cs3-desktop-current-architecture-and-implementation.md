# CloudStream 3 Desktop — Current Architecture & Implementation Specification

> **Document ID**: `PRD-33-CS3-DESKTOP-CURRENT-IMPLEMENTATION`  
> **Status**: Active / Verified  
> **Scope**: CloudStream 3 Desktop Application (`cs3_windows`)  
> **Last Updated**: 2026-09-17  
> **Document Version**: 2.0.0 (Updated to reflect React 19, sidecar runtime Gen 14, 4-tier media engine, push search, native providers, OTT aggregator, and complete IPC surface)

---

## 1. Executive Summary

This document provides a comprehensive, 1-to-1 technical specification of the **CloudStream 3 Desktop Application** (`cs3_windows`) as currently implemented in the codebase. It details all active services, IPC channels, plugin and sidecar architectures, streaming and playback engines, BitTorrent pipelines, download subsystems, datastore migration mechanisms, and UI components.

The application is built on **Electron**, **React 19**, **TypeScript (strict)**, **Vite 8**, and **Bun**, running primarily on **Windows 10/11 (x64)** with native background worker processes (Java 21 JVM sidecar, portable aria2c, portable yt-dlp, FFmpeg/ffprobe, and mpv native engine).

---

## 2. System Architecture Overview

```text
+---------------------------------------------------------------------------------------------------+
|                                      ELECTRON RENDERER (React 19)                                 |
|  Views: HomeView · SearchView · DetailView · LibraryView · SettingsView · Extensions · Downloads  |
|  Components: VideoPlayer (HTML5) · MpvPlayer · Audio/SubtitleSelectors · FloatingMiniPlayer       |
|  Search: Multi-Profile Scope Dropdown · Live Search Suggestions · Layer-2 Provider Filter Chips   |
+---------------------------------------------------------------------------------------------------+
                                                  |
                          Preload ContextBridge (electron/preload.ts)
                 Strict Isolation: contextIsolation: true, nodeIntegration: false
                                                  |
+---------------------------------------------------------------------------------------------------+
|                                   ELECTRON MAIN PROCESS (electron/main.ts)                        |
|                        Wires singleton services, ~70 typed ipcMain handlers                       |
+---------------------------------------------------------------------------------------------------+
   │            │               │              │               │              │               │
   ▼            ▼               ▼              ▼               ▼              ▼               ▼
Playback     Plugin &        Torrent        Download       Extended        Datastore &     Logging &
Engine       Sidecar         Engine         Service        Metadata        Android 6-Bucket Security
(HTML5/mpv/  Supervisor     (WebTorrent     (aria2c RPC/   Enrichment      Migration       (Redaction,
Transcoder/  (Gen 14 JVM     Sequential/    FastChunk/     (AniList/TVMaze/ (Datastore/     WebView
Proxy/Lease)  Runtime)       DHT/Indexers)  yt-dlp/Resume) Wikidata/Wiki)   BackupService)  Challenge)
   │            │               │              │               │              │               │
   ▼            ▼               ▼              ▼               ▼              ▼               ▼
mpv /       JVM Sidecar     Swarm /        Disk / P2P     GraphQL /      Local JSON      Anti-Bot
FFmpeg      (Java 21 +      127.0.0.1      Storage        REST APIs      Datastore       Interception
Processes   Android Shim)   HTTP Server
```

---

## 3. Core Subsystems & Service Implementations

### 3.1 Plugin & Extension Management Engine (`electron/cs3/` & `electron/pluginManager.ts`)

* **Repository Inventory & Persistence**:
  * Loads provider metadata from [`electron/official_repositories.json`](file:///cs3_windows/electron/official_repositories.json) cataloging community repositories (MegaRepo, Official Extensions, GermanProviders, ItaliaInStreaming, re-3arabi, Vietnamese, CSX, etc.).
  * User-added repository URLs and plugin installation lists persist in `cs3_datastore.json`.
* **Multi-Lane Provider Strategy**:
  * **Lane 1 (`.cs3` Android Drop-In)**: Executes Android DEX `.cs3` plugins via bundled Java 21 JVM sidecar with runtime Android API shims (`android.util.Log`, `Base64`, `Context`, `SharedPreferences`, `CookieManager`).
  * **Lane 2 (Cross-Platform JAR)**: Executes compiled JVM `.jar` plugins against `library-jvm-4.8.0.jar`.
  * **Lane 3 (Native Providers)**: Compiled-in TypeScript providers, Stremio manifest v3 addons (`nativeProviders/stremio.ts`), and Jellyfin/Emby media servers (`nativeProviders/jellyfin.ts`) running directly in Node without JVM.
* **Runtime Provisioner (`electron/cs3/runtimeProvisioner.ts`)**:
  * Manages isolated runtime in `%APPDATA%/<app>/cs3-runtime/`.
  * Enforces generation stamps (`runtime-stamp.json`, Generation 14) tracking jar fingerprints (name, size, mtime) to eliminate stale shim/bridge execution bugs.
* **Sidecar Supervisor (`electron/cs3/sidecarSupervisor.ts`)**:
  * Spawns and monitors the Java 21 JVM process (`cs3-sidecar.jar`).
  * Manages bi-directional JSON-lines RPC communication, stdio stream parsing, health pings, and automated restart on failure.
* **Extension Updater & Safety Rollback (`electron/cs3/extensionUpdater.ts`)**:
  * Checks repository updates in the background.
  * Archives existing working plugins before applying updates; automatically rolls back if a new version fails verification.
* **Extension Issues Ledger (`electron/cs3/extensionIssues.ts`)**:
  * Records, classifies, and reports provider errors using the 8-shape failure taxonomy (`failureTaxonomy.ts`).

### 3.2 OTT Streaming Platform Aggregator & Discovery (`electron/cs3/ottService.ts`, `ottCatalog.ts`, `ottPlatforms.ts`)

* **Platform Aggregation**:
  * Aggregates catalogs for 10+ major OTT platforms (Netflix, Prime Video, Disney+, Apple TV+, HBO Max, Hulu, Paramount+, etc.).
* **Provider Main Page Integration**:
  * Ingests provider catalogs using `getMainPage` RPCs to build live home feeds and platform browse pages.
* **Page Snapshot Cache (`electron/cs3/pageSnapshot.ts`)**:
  * Caches scraped provider home pages to disk, providing instant cold-boot UI rendering without waiting on network scrapes.

### 3.3 Universal Media Playback Engine (`electron/media/`)

* **4-Tier Adaptive Engine Ladder**:
  1. **Tier 1 (HTML5 `<video>`)**: Chromium hardware/software decoded streams (HLS via hls.js, MP4, WebM, native DASH).
  2. **Tier 2 (FFmpeg Progressive Transcoder)**: Real-time remuxing/transcoding pipeline (`mediaTranscoder.ts`) converting non-Chromium audio/video containers on the fly.
  3. **Tier 3 (Native mpv Engine)**: Standalone native mpv process controlled over JSON IPC socket (`mpvEngine.ts`, `mpvEmitPolicy.ts`) supporting 4K HEVC 10-bit, HDR10/Dolby Vision, AV1, Dolby Atmos, DTS-HD, and complex ASS/SSA styled subtitles.
  4. **Tier 4 (External Player Handoff)**: Direct stream handoff to system players (VLC, MPC-HC, PotPlayer, MPV) via `externalPlayer.ts`.
* **Decision Engine (`electron/media/decisionEngine.ts`)**:
  * Evaluates container, video codec, audio codec, resolution, and renderer capabilities to select the optimal playback path.
* **Media Inspector & Probe Cache (`electron/media/mediaInspector.ts`, `inspectionStore.ts`)**:
  * Probes media streams via ffprobe/container analysis and caches codec parameters to avoid redundant network probes.
* **Media Proxy (`electron/mediaProxy.ts`)**:
  * Local loopback HTTP server (127.0.0.1) injecting required headers (User-Agent, Referer, Cookies), supporting HTTP Range requests, and authenticating via security tokens.
* **Source Lease Management (`electron/media/sourceLease.ts`)**:
  * Manages active stream leases, guaranteeing prompt socket closure and cleanup when streams are paused, stopped, or switched.
* **Played Source Continuity (`electron/cs3/playedSource.ts`)**:
  * Records the exact working provider, stream URL, and quality variant for each title; provides intelligent fallback matching if a saved link expires.

### 3.4 Extended Metadata & Multi-Source Enrichment (`electron/metadata/`)

* **Enrichment Aggregator (`enrichmentService.ts`)**:
  * Combines metadata across multiple independent sources:
    * **AniList**: Anime GraphQL queries for romaji/english/native titles, cast with character voice actors, studios, and airing status.
    * **TVMaze**: TV show manifests, episode lists, air dates, and crew roles.
    * **Wikidata**: SPARQL cross-linking between IMDb, TMDB, and AniList; Commons photo resolution; crew entity extraction.
    * **Wikipedia**: Production history, plot summaries, and background context with license attribution.
    * **Cinemeta**: Extended metadata from Stremio Cinemeta catalog.
* **Conflict-Free Metadata Merger (`merge.ts`)**:
  * Pure tested module that resolves conflicting fields using confidence scoring, normalizing titles, dates, ratings, and artwork.
* **Reactive Push Channel**:
  * Emits `metadata:extendedUpdate` push snapshots so UI renders preliminary data immediately and fills in details progressively.

### 3.5 BitTorrent Search, Sequential Streaming & P2P Engine (`electron/torrent/`)

* **Multi-Indexer Aggregator (`indexerRegistry.ts`)**:
  * Searches public indexers (1337x, YTS, EZTV, TorrentGalaxy, Nyaa, LimeTorrents, MagnetDL) + Torznab (Jackett/Prowlarr).
* **Indexer Budget Manager (`indexerBudget.ts`)**:
  * Enforces rate limits, request timeouts, and error budgets per indexer to prevent IP rate-limiting.
* **DHT Node Routing Cache (`dhtNodeCache.ts`)**:
  * Persists known healthy DHT nodes across sessions for instant peer discovery on cold start.
* **Torrent Release Parser & Ranker (`releaseParser.ts`, `ranker.ts`, `torrentContents.ts`)**:
  * Regex extracts resolution, quality, codec, release group, audio format.
  * Ranks torrents by seeders and quality threshold; parses multi-file torrents to isolate exact episode files inside season packs.
* **Sequential Streaming (`torrentEngine.ts`)**:
  * Prioritizes head (first 16 MB) and tail (last 4 MB, where MP4 `moov` atoms and MKV cues reside) pieces.
  * Streams live video through internal loopback HTTP server (`127.0.0.1:PORT`).
* **Swarm Health & Bot Bypass (`swarmHealth.ts`, `botChallenge.ts`)**:
  * Probes swarm health before playback; detects and mitigates Cloudflare/bot challenges.

### 3.6 Multi-Engine Download Subsystem (`electron/download/` & `downloadService.ts`)

* **Unified Downloader Orchestrator (`downloadService.ts`)**:
  * Routes downloads to optimal engine:
    * **Fast Downloader (`fastDownloader.ts`)**: Pure Node/TS segmented multi-connection concurrent chunk downloader.
    * **aria2c Engine (`aria2Engine.ts`)**: aria2c JSON-RPC with dynamic port binding and process supervision.
    * **yt-dlp Engine (`ytdlpEngine.ts`)**: Direct video hoster extraction and download.
    * **HTTP Downloader (`httpDownloader.ts`)**: Zero-dependency streaming HTTP fallback.
    * **Torrent Engine**: Background magnet/torrent file downloads.
* **Verified Resume Engine (`resumePlan.ts`, `resumeWindow.ts`)**:
  * Performs socket Range probes to verify byte boundaries and ETag/Last-Modified headers without downloading entire files.
  * Eliminates false 100% completion bugs and safely resumes interrupted tasks.

### 3.7 Streaming Push Search & Multi-Profile Scoping (`electron/` & `electron/cs3/`)

* **Push-Based Search Sessions (`searchSession.ts`)**:
  * Dispatches parallel searches across providers (capped at 8 concurrent RPCs).
  * Streams results progressively via `search:update` events.
* **Host Deadlines (`hostDeadline.ts`)**:
  * Per-host timeout circuit breakers preventing slow scrapers from delaying the overall search session.
* **Multi-Profile Source Scopes (`sourceProfiles.ts`, `sourceProfileStore.ts`, `sourceScope.ts`)**:
  * Allows users to create, duplicate, and switch search profiles (e.g. Movies, Anime, Fast, Torrents Only).
* **Live Search Suggestions & History (`searchSuggestions.ts`, `searchHistory.ts`)**:
  * Auto-completes queries and tracks recent searches with instant clear and deletion options.

### 3.8 Anti-Bot Challenge Solving & Headless WebContents Interception (`electron/cs3/webViewHost.ts`, `webViewMatch.ts`)

* **Headless Challenge Solver**:
  * Spawns hidden Electron `BrowserWindow`/`WebContents` to navigate Cloudflare Turnstile, Cloudflare IUAM, and DDoS-Guard challenges.
* **Pattern Matcher (`webViewMatch.ts`)**:
  * Identifies challenge URLs, extracts cleared cookies and User-Agent headers, and synchronizes them to Node fetch and JVM OkHttp pipelines.

### 3.9 Datastore & Android 6-Bucket Migration (`electron/datastore.ts`, `backupService.ts`)

* **Lossless Android Backup Compatibility**:
  * Implements exact Android 6-bucket key-grammar (`_Bool`, `_Int`, `_String`, `_Float`, `_Long`, `_StringSet`).
  * Reproduces Java 32-bit signed `String.hashCode()` content addressing for bookmarks, watch progress, and history.
* **Automated Rollback**:
  * Creates pre-import snapshot `cs3_datastore_snapshot.json` and automatically restores state if backup parsing fails.

---

## 4. IPC Architecture & Preload Contract

All renderer communication crosses `electron/preload.ts` via strictly typed namespaces:

| Namespace | Channel Purpose & Semantics |
|---|---|
| `api:*` | Metadata loading, provider searches, media stream scraping. |
| `playback:*` | Push-based playback session management (`playback:start`, `playback:update`). |
| `media:*` | Stream inspection, capability probes, progressive preparation, audio/subtitle track switching. |
| `mpv:*` | Native mpv playback controls, snapshot events (`mpv:update`), emit policy configuration. |
| `search:*` | Streaming search sessions (`start`, `update`, `cancel`), provider scoping, search profiles. |
| `torrent:*` | Magnet streaming, piece stats, sequential streaming lifecycle, swarm health. |
| `download:*` | Multi-engine task management (`request`, `enqueue`, `preview`, `pause`, `resume`, `cancel`). |
| `extension:*` | Repository browsing, extension installation, update checks, safe rollbacks. |
| `natives:*` | Built-in provider management (Stremio addon manifests, Jellyfin/Emby servers). |
| `ott:*` | OTT platform catalogs, `getMainPage` feeds, platform suggestions, repository installation. |
| `metadata:*` | Extended title metadata (`getExtended`, `peekExtended`, `clearCache`, `extendedUpdate`). |
| `subtitles:*` | Subtitle discovery, downloading, charset conversion, SSA/ASS to WebVTT conversion. |
| `issues:*` | Extension failure ledger (`list`, `annotate`, `report`, `clear`). |
| `datastore:*` | 6-bucket key-value operations, Android backup export and lossless import. |
| `log:*` | Structured log viewing, memory buffer retrieval, log level filtering. |
| `runtime:*` | JVM sidecar status, runtime generation reporting, binary setup verification. |

All IPC handlers return an envelope `{ ok: boolean, error?: string, ...data }` and never throw uncaught rejections across the process boundary.

---

## 5. Verification, Test Suites & Build Benchmarks

### 5.1 Verification Test Corpus (66 Test Suites)
The codebase includes 66 automated test suites executing under Node's native type-stripping ESM runner (`scripts/test-runner.mjs`):
* **Fast Test Suite (`bun run test --fast`)**: 64 unit suites covering datastore, IPC surface, media decision engine, metadata merging, torrent parsers, download resumes, and UI models (~10s).
* **Slow Test Suite**: Spawns real native FFmpeg pipelines (`pipeline.test.mts`) and native mpv player processes (`mpvEngine.test.mts`).
* **Lexical IPC Surface Test (`electron/ipcSurface.test.mts`)**: Pins every IPC handler between `main.ts`, `preload.ts`, and renderer callers to guarantee zero missing channels.

### 5.2 Build & Packaging Benchmarks
* **Typecheck**: `bun run typecheck` (`tsc -b`) compiles cleanly across all project references.
* **Renderer & Main Bundle**: `bun run build` (`tsc && vite build`) generates production bundles in `dist/` and `dist-electron/`.
* **Windows Production Packaging**: `bun run dist:win` packages NSIS installer and portable executable via `electron-builder.yml`, bundling Java 21 JRE, sidecar jars, FFmpeg, ffprobe, and mpv runtimes.
