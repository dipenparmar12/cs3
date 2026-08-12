# CS3 Desktop Additional Features & Architecture Specification

> **Document ID**: `PRD-32-CS3-DESKTOP-FEATURE-ADDITIONS`  
> **Status**: Active / Implemented  
> **Scope**: CloudStream 3 Desktop Application (`cs3_windows`)  
> **Last Updated**: 2026-08-12  

---

## 1. Executive Summary

This document specifies the additional features, architectural subsystems, and user experience enhancements implemented in the **CloudStream 3 Desktop** application (`cs3_windows`) that extend beyond the baseline requirements outlined in earlier PRD sections.

These additions establish:
1. A **3-Tier Plugin Strategy** bridging Android `.cs3` packages to desktop JVM runtimes without `RISK-D1` translation risks.
2. An **Official 26-Repository Catalog** with a dedicated JSON dataset (`official_repositories.json`).
3. A **Two-Layer Provider System** providing pre-search scoping and post-search result filtering.
4. A **1-Click Downloader Engine Setup & Auto-Downloader** backed by a zero-crash **Native HTTP Stream Fallback Pipeline**.
5. A **Developer Mode & Live Content Streaming Engine** with toggleable live vs. demo media modes.
6. A **Robust Android Datastore & CS3 Backup Migration Engine** with 6-bucket key-grammar parsing and rollback snapshots.
7. **Player UX Enhancements** including timed Skip Intro overlays and multi-source quality controls.

---

## 2. 3-Tier Plugin System & Runtime Architecture

### 2.1 Overview
To execute CloudStream 3's 299 provider extensions across 26 community repositories on Windows desktop without relying on fragile DEX-to-JAR decompilation, CloudStream Desktop implements a **3-Tier Plugin Strategy**:

```text
                                  +---------------------------------------+
                                  |         Plugin Ingestion Engine       |
                                  +---------------------------------------+
                                                      |
                   +----------------------------------+----------------------------------+
                   |                                  |                                  |
                   v                                  v                                  v
        Tier A: Source Rebuild             Tier B: JVM Sidecar Executor         Tier C: Native Desktop SDK
     (299 Vendored Providers)                 (User Custom .cs3 URLs)                (TypeScript / KMP)
                   |                                  |                                  |
                   v                                  v                                  v
       kotlinc-jvm Compilation              classes.dex -> JVM Bytecode             Native JavaScript /
      against library-jvm.jar                 Sidecar IPC Execution                Node.js Multi-Provider
```

### 2.2 Tier Specifications
* **Tier A (Source Rebuild)**: Compiles Kotlin source directly from the 26 known provider repositories against `library-jvm.jar` and `:app` stubs using `kotlinc-jvm`. Eliminates `RISK-D1` coroutine state-machine issues.
* **Tier B (JVM Sidecar Executor)**: Spawns a Java sub-process (`JVMProviderBridge`) for user-added runtime `.cs3` files.
* **Tier C (Native Desktop SDK)**: Native TypeScript provider SDK (`@cloudstream/sdk`) for direct Node.js/Electron media extraction.

---

## 3. Official 26 Repositories Catalog & Data Model

### 3.1 Overview
The desktop app incorporates a dedicated, structured dataset ([`electron/official_repositories.json`](file:///D:/dipen/cs3/cs3_windows/electron/official_repositories.json)) listing all 26 official community extension repositories.

### 3.2 Repository Classification
Repositories are categorized into 6 distinct categories:
1. **Official**: `MegaRepo` (42 providers), `Official Extensions` (68 providers).
2. **Regional**: `GermanProviders` (14), `ItaliaInStreaming` (18), `re-3arabi` (22), `cloudstream-vietnamese` (12), `FStream` (11), `IndoStream` (8), `cloudstream-extensions-uk` (7), `ItalianProvider` (8).
3. **Anime**: `Luna712-CloudStream-Extensions` (13).
4. **Movies & Shows**: `cartoonyrepo` (10), `cinephile` (14).
5. **Community**: `CSX` (16), `CuxPlug` (9), `Redowan-CloudStream` (17), `storm-ext` (12), `ReflexRepo` (11), `Pitipitii` (6), `cs-Karma` (9), `cs-kraptor` (8), `doGiorsHadEnough` (5), `cloudstream-extensions-phisher` (7), `SkillShare-Repo` (6), `saimuelrepo` (5).
6. **Compatibility**: `AniyomiCompatExtension` (15).

---

## 4. Two-Layer Provider System

```text
                            +-------------------------------------------+
                            |          Navbar Search Input              |
                            +-------------------------------------------+
                                                  |
                                                  v
                            +-------------------------------------------+
                            |   Layer 1: Pre-Search Provider Scope      |
                            |  [All] [MegaRepo] [Official Anime] [...]  |
                            +-------------------------------------------+
                                                  |
                                                  v
                            +-------------------------------------------+
                            |    PluginManager.searchAll(query, scope)  |
                            +-------------------------------------------+
                                                  |
                                                  v
                            +-------------------------------------------+
                            |  Layer 2: Post-Search Result Filter Chips |
                            | [All (18)] [MegaRepo (8)] [Anime (6)]     |
                            +-------------------------------------------+
```

### 4.1 Layer 1: Pre-Search Provider Scope
* Located in [`src/components/Navbar.tsx`](file:///D:/dipen/cs3/cs3_windows/src/components/Navbar.tsx).
* Allows selecting 1, multiple, or all active providers prior to initiating a search query.
* Passes `targetProviders?: string[]` to `PluginManager.searchAll()`.

### 4.2 Layer 2: Post-Search Result Filtering
* Located in [`src/views/SearchView.tsx`](file:///D:/dipen/cs3/cs3_windows/src/views/SearchView.tsx).
* Renders dynamic filter chips above the search results grid showing badge counts for each provider that returned results.
* Allows instant, zero-latency filtering of the displayed media grid without triggering new network requests.

---

## 5. 1-Click Downloader Engine & Fallback Pipeline

### 5.1 Portable Binary Downloader (`BinaryDownloader`)
* Located in [`electron/binaryDownloader.ts`](file:///D:/dipen/cs3/cs3_windows/electron/binaryDownloader.ts).
* Automatically downloads and configures portable `aria2c.exe` (16-thread multi-connection engine) and `yt-dlp.exe` into `%APPDATA%\cloudstream-desktop\bin\` upon prompt confirmation.
* Resolves file handle locking via `fileStream.on('finish')` event synchronization before zip extraction.

### 5.2 Native HTTP Stream Fallback Downloader
* Located in [`electron/downloadService.ts`](file:///D:/dipen/cs3/cs3_windows/electron/downloadService.ts).
* AutomaticallyStreams downloads via Node.js `http`/`https` pipelines if `aria2c` binary is missing or uninitialized.
* Eliminates `"aria2c engine binary not initialized"` errors.

### 5.3 Conditional Banner Hiding
* Setup banners and 1-click prompt triggers are automatically hidden once `hasBinaries === true`, leaving a clean Download Manager UI.
* Re-installation and binary update options remain available under Settings.

---

## 6. Developer Options & Live Streaming Mode

### 6.1 Developer Mode Toggle
* Located in [`src/views/SettingsView.tsx`](file:///D:/dipen/cs3/cs3_windows/src/views/SettingsView.tsx).
* Toggle switch: **Live Content Streaming Mode (ON)** vs. **Demo Content Streaming Mode (OFF)**.
* Persisted in `cs3_datastore.json` under `use_live_streaming_sources`.

### 6.2 Live Streaming Media Sources
When Live Mode is active, `PluginManager` queries real public media search APIs (TVMaze for Movies/TV, AniList for Anime) and serves real master HLS/MP4 streams:
* **Adaptive 1080p HLS Stream**: `https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8`
* **Sintel 1080p Feature Film**: `https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4`
* **Tears of Steel 1080p Sci-Fi**: `https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4`
* **Big Buck Bunny Direct Mirror**: `https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4`
* **yt-dlp Universal Extractor**: Resolves live stream URLs from pasted web links.

---

## 7. Robust Datastore & CS3 Android Backup Migration

### 7.1 6-Bucket Key-Grammar Parsing
Located in [`electron/datastore.ts`](file:///D:/dipen/cs3/cs3_windows/electron/datastore.ts). Parses Android CS3's 6 data buckets:
* `_Bool`: Boolean settings and preference toggles.
* `_Int`: Integer counts, watch positions, and timestamps.
* `_String`: String preferences, URLs, and datastore entries.
* `_Float`: Floating point rating values.
* `_Long`: Extended timestamps and byte lengths.
* `_StringSet`: Array string sets (bookmarks, history IDs).

### 7.2 Non-Transferable Key Filtering & Snapshots
* Filters out device-specific tokens (`token`, `session_id`, `device_id`, `cache_path`).
* Creates automated rollback snapshots (`cs3_datastore_snapshot.json`) prior to backup imports, restoring state automatically if an import fails.

---

## 8. Player UX Enhancements

* **Timed Skip Intro Display**: Skip Intro button (`src/components/VideoPlayer.tsx`) is dynamically rendered ONLY during the intro window (`currentTime >= 10s` and `currentTime <= 120s`).
* **Source Quality Selector**: In-player dropdown allowing real-time switching between 1080p HLS, 4K Mirrors, and 720p Direct streams.
