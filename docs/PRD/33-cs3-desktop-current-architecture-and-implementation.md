# CloudStream 3 Desktop — Current Architecture & Implementation Specification

> **Document ID**: `PRD-33-CS3-DESKTOP-CURRENT-IMPLEMENTATION`  
> **Status**: Active / Verified  
> **Scope**: CloudStream 3 Desktop Application (`cs3_windows`)  
> **Last Updated**: 2026-08-12  

---

## 1. Executive Summary

This document provides a comprehensive specification of the **CloudStream 3 Desktop Application** (`cs3_windows`) as it exists today. It documents all built services, IPC handlers, plugin execution engines, data storage systems, media search/extraction pipelines, and UI components currently active in the codebase.

The application is built on **Electron**, **React 18**, **TypeScript**, **Vite 8**, and **Bun**, running on Windows (x64) with native background worker processes.

---

## 2. System Architecture Overview

```text
+-----------------------------------------------------------------------------------+
|                                  ELECTRON RENDERER                                |
|  React 18 + Vite UI | Sidebar | Navbar (Layer 1 Scope) | SearchView (Layer 2 Chips)|
|  DetailView | HomeView | LibraryView | SettingsView | VideoPlayer | DownloaderUI |
+-----------------------------------------------------------------------------------+
                                          |
                                 Electron IPC Bridge
                                (electron/preload.ts)
                                          |
+-----------------------------------------------------------------------------------+
|                                   ELECTRON MAIN                                   |
|                                (electron/main.ts)                                 |
+-----------------------------------------------------------------------------------+
      |                  |                    |                   |             |
      v                  v                    v                   v             v
PluginManager      DatastoreManager    DownloadService    BinaryDownloader   JVMBridge
(TVMaze/AniList/   (6-Bucket Key-      (Aria2 RPC +       (Portable aria2c/   (CS3 .cs3
 yt-dlp Scraper)    Grammar JSON)       HTTP Fallback)     yt-dlp Auto-Setup)  Package)
```

---

## 3. Core Modules & Built Services

### 3.1 Plugin & Extension Management Engine ([`electron/pluginManager.ts`](file:///D:/dipen/cs3/cs3_windows/electron/pluginManager.ts))
* **Official 26-Repository Dataset**: Loads provider extension metadata from [`electron/official_repositories.json`](file:///D:/dipen/cs3/cs3_windows/electron/official_repositories.json), cataloging 299 community providers across 26 repositories (MegaRepo, Official Extensions, GermanProviders, ItaliaInStreaming, re-3arabi, Vietnamese, CSX, etc.).
* **3-Tier Plugin Strategy**:
  * **Tier A (Source Rebuild)**: Pre-registers vendor provider definitions compiled against `library-jvm.jar`.
  * **Tier B (JVM Sidecar Loader)**: Unpacks and verifies `.cs3` zip archives via [`electron/cs3ArchiveLoader.ts`](file:///D:/dipen/cs3/cs3_windows/electron/cs3ArchiveLoader.ts) and executes bytecode via [`electron/jvmProviderBridge.ts`](file:///D:/dipen/cs3/cs3_windows/electron/jvmProviderBridge.ts).
  * **Tier C (Native TypeScript SDK)**: Native JavaScript/TypeScript extraction logic.
* **Repository Persistence**: Automatically saves added repository URLs (`installed_repositories_urls`) and installed plugins (`installed_plugins_list`) into `cs3_datastore.json`.

### 3.2 Real Media Search & Dynamic Link Extraction
* **TVMaze & AniList Live Search Integration**:
  * `MegaRepo Movies & TV`: Queries `https://api.tvmaze.com/search/shows?q=` for live movies, TV series, and episode manifests.
  * `Official Extensions Anime`: Queries `https://graphql.anilist.co` for live anime cover art, release metadata, and episode structures.
* **Dynamic Stream Resolution (`YtDlpEngine.searchAndExtract`)**:
  * Located in [`electron/ytdlpEngine.ts`](file:///D:/dipen/cs3/cs3_windows/electron/ytdlpEngine.ts).
  * When `loadLinks(apiName, url)` is invoked for a title, `yt-dlp` dynamically extracts genuine video stream mirrors for that specific show or anime.

### 3.3 Two-Layer Provider System
* **Layer 1: Pre-Search Provider Scope Selection ([`src/components/Navbar.tsx`](file:///D:/dipen/cs3/cs3_windows/src/components/Navbar.tsx))**:
  * Multi-select provider pill dropdown in top navigation allowing users to select 1, multiple, or all providers before running a search query.
  * Passes `targetProviders?: string[]` to `PluginManager.searchAll(query, targetProviders)`.
* **Layer 2: Post-Search Result Provider Filter Banners ([`src/views/SearchView.tsx`](file:///D:/dipen/cs3/cs3_windows/src/views/SearchView.tsx))**:
  * Interactive filter chips rendered above the search results grid displaying badge counts for each provider that returned results.
  * Allows instant, zero-latency filtering of visible media cards without re-fetching.

### 3.4 BitTorrent Search, Sequential Streaming & Download Engine ([`electron/torrent/`](file:///D:/dipen/cs3/cs3_windows/electron/torrent/))
* **Multi-Indexer Aggregator**: Aggregates torrent search across 7 public indexers (1337x, YTS, EZTV, TorrentGalaxy, Nyaa, LimeTorrents, MagnetDL) + Torznab (Jackett / Prowlarr).
* **Release Parser & Quality Ranker**: Parses release names (`resolution`, `codec`, `audio`, `group`) and ranks torrent sources by seeder threshold and video quality.
* **Sequential Streaming (`TorrentEngine`)**: Spawns an internal HTTP streaming server on `127.0.0.1:PORT`, prioritizing moov/header chunks and serving live magnet video streams directly to `<video>`.
* **P2P Download Manager**: Tracks background magnet link downloads with live telemetry (`bytesDownloaded`, `downloadSpeed`, `etaSeconds`, and active `seeders`).

### 3.5 Portable Binary Downloader & Fallback Engine
* **Portable Binary Auto-Setup ([`electron/binaryDownloader.ts`](file:///D:/dipen/cs3/cs3_windows/electron/binaryDownloader.ts))**:
  * Downloads portable `aria2c.exe` and `yt-dlp.exe` into `%APPDATA%\cloudstream-desktop\bin\` via 1-click modal ([`src/components/BinarySetupModal.tsx`](file:///D:/dipen/cs3/cs3_windows/src/components/BinarySetupModal.tsx)).
  * Synchronizes file streams via `fileStream.on('finish')` to prevent Windows file locking during zip extraction.
* **Zero-Crash Native HTTP Fallback ([`electron/downloadService.ts`](file:///D:/dipen/cs3/cs3_windows/electron/downloadService.ts))**:
  * Streams downloads via native Node `http`/`https` pipelines if `aria2c` binary is missing, eliminating `"aria2c engine binary not initialized"` errors.
* **Conditional Setup UI**:
  * Automatically hides setup banners when binaries are ready (`hasBinaries === true`).

### 3.5 Robust Datastore & CS3 Android Backup Migration ([`electron/datastore.ts`](file:///D:/dipen/cs3/cs3_windows/electron/datastore.ts))
* **6-Bucket Key-Grammar Parser**:
  * Mirrors Android CS3 datastore buckets: `_Bool`, `_Int`, `_String`, `_Float`, `_Long`, and `_StringSet`.
  * Includes `getBoolean()` and `setBoolean()` method aliases to guarantee backwards compatibility.
* **Non-Transferable Key Filtering**:
  * Filters out machine-specific tokens (`token`, `session_id`, `device_id`, `cache_path`) during backup import.
* **Rollback Engine**:
  * Creates `cs3_datastore_snapshot.json` prior to backup imports and provides automated rollback if an import fails.

### 3.6 Video Player UX ([`src/components/VideoPlayer.tsx`](file:///D:/dipen/cs3/cs3_windows/src/components/VideoPlayer.tsx))
* **Timed Skip Intro Display**: "Skip Intro (85s)" button renders dynamically ONLY during the intro window (`currentTime >= 10s` and `currentTime <= 120s`).
* **Multi-Source Quality Switcher**: In-player dropdown allowing real-time switching between 1080p Adaptive HLS, 4K Mirrors, and 720p Direct streams.
* **HLS.js & Native HTML5 Fallback**: Automatic HLS manifest parsing with fallback to HTML5 video elements.

---

## 4. File Structure & Component Map

```text
D:\dipen\cs3\cs3_windows\
├── electron/
│   ├── main.ts                       # Electron main process & IPC handlers
│   ├── preload.ts                    # ContextBridge API exposure
│   ├── pluginManager.ts              # Provider registry & TVMaze/AniList scraper
│   ├── cs3ArchiveLoader.ts           # .cs3 zip package & manifest.json loader
│   ├── jvmProviderBridge.ts          # JVM sidecar process runner
│   ├── ytdlpEngine.ts                # yt-dlp search & link extraction
│   ├── downloadService.ts            # Download manager (Aria2 RPC + HTTP fallback)
│   ├── binaryDownloader.ts           # Portable aria2c & yt-dlp auto-downloader
│   ├── datastore.ts                  # 6-Bucket JSON datastore & backup parser
│   ├── officialRepositories.ts       # Repositories loader module
│   └── official_repositories.json    # Dedicated dataset for 26 community repos
├── src/
│   ├── App.tsx                       # Main application shell
│   ├── index.css                     # Custom CSS design system
│   ├── components/
│   │   ├── Navbar.tsx                # Top navigation & Layer 1 Multi-Select Scope
│   │   ├── Sidebar.tsx               # Main navigation drawer
│   │   ├── VideoPlayer.tsx           # HLS video player with timed Skip Intro
│   │   ├── DownloadCenter.tsx        # Download task queue & progress monitor
│   │   ├── BinarySetupModal.tsx      # 1-Click portable binary installer
│   │   ├── ExtensionManagerUI.tsx    # 26-repo extension manager UI
│   │   └── ProviderInspector.tsx     # F12 provider debugging panel
│   └── views/
│       ├── HomeView.tsx              # Live featured media catalog
│       ├── SearchView.tsx            # Search results & Layer 2 Provider Filters
│       ├── DetailView.tsx            # Media detail page & 1-Click Fast Download
│       ├── LibraryView.tsx           # Bookmarks & local collection view
│       └── SettingsView.tsx          # Developer Options & Downloader Status
└── package.json                      # Build scripts & dependencies
```

---

## 5. Verification & Build Benchmarks

* **Build Execution**: `bun run build` compiles 100% cleanly without TypeScript or Vite bundle errors:
  ```text
  ✓ built in 1.20s -> dist/assets/index-CYlypuT-.js (765.13 kB)
  ✓ built in 408ms -> dist-electron/main.js (46.30 kB)
  ✓ built in 264ms -> dist-electron/preload.js (1.56 kB)
  ```
* **Dev Execution**: `bun run dev` verified and running cleanly on Windows desktop.
