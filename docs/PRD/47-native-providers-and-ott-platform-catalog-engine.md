# PRD-47 — Native Providers Lane & OTT Platform Catalog Engine

> **Document ID**: `PRD-47-NATIVE-PROVIDERS-OTT-ENGINE`  
> **Status**: Active / Implemented  
> **Scope**: CloudStream 3 Desktop Application (`cs3_windows`)  
> **Source Files**: `electron/cs3/nativeProviderRegistry.ts`, `nativeProviders/stremio.ts`, `nativeProviders/jellyfin.ts`, `ottService.ts`, `ottCatalog.ts`, `ottPlatforms.ts`, `pageSnapshot.ts`  
> **Test Suites**: `electron/cs3/nativeProviders.test.mts` (50 cases), `electron/cs3/ottCatalog.test.mts` (19 cases), `electron/cs3/ottPlatforms.test.mts` (19 cases), `electron/cs3/pageSnapshot.test.mts`  
> **Date**: 2026-09-17  

---

## 1. Executive Summary

While CloudStream's community ecosystem is largely composed of Android `.cs3` plugins running in the JVM sidecar, modern desktop users require:
1. **Direct, compiled-in providers** that execute without JVM dependencies (e.g. Stremio v3 manifest addons and private media servers like Jellyfin/Emby).
2. **An OTT platform aggregation catalog** allowing users to browse content organized by streaming services (Netflix, Amazon Prime Video, Disney+, Apple TV+, HBO Max, etc.) rather than technical plugin filenames.

The **Native Providers Lane & OTT Catalog Engine** (`electron/cs3/`) solves both requirements by establishing a native Node-based provider infrastructure and a content-centric streaming platform abstraction.

```text
+───────────────────────────────────────────────────────────────────────────────────────────────────+
|                                      USER BROWSE & SEARCH INTERFACE                               |
|                  Browse by Platform (Netflix / Prime / Disney+) or Search by Title                 |
+───────────────────────────────────────────────────────────────────────────────────────────────────+
                                                  │
                                                  ▼
+───────────────────────────────────────────────────────────────────────────────────────────────────+
|                               OttService (electron/cs3/ottService.ts)                             |
|          Maps user-selected OTT platform to installed providers declaring platform coverage       |
+───────────────────────────────────────────────────────────────────────────────────────────────────+
                                                  │
                        ┌─────────────────────────┴─────────────────────────┐
                        │                                                   │
                        ▼                                                   ▼
+────────────────────────────────---------------+ +─────────────────────────────────────────────────+
|            JVM Sidecar Provider Lane          | |                 Native Provider Lane            |
|       (.cs3 Community Plugins via Sidecar)    | |        (electron/cs3/nativeProviderRegistry.ts) |
|   Scrapes provider catalogs via getMainPage() | |                                                 |
|   (e.g. MoviesMod, SuperStream, Cinevood)     | |  ┌───────────────────────┐ ┌──────────────────┐ |
|                                               | |  │     Stremio Addons    │ │  Jellyfin/Emby   │ |
|                                               | |  │  (v3 Manifest HTTPS)  │ │  (LAN Server)    │ |
|                                               | |  └───────────────────────┘ └──────────────────┘ |
+───────────────────────┬───────────────────────+ +─────────────────────────┬───────────────────────+
                        └─────────────────────────┬─────────────────────────┘
                                                  │
                                                  ▼
+───────────────────────────────────────────────────────────────────────────────────────────────────+
|                               PageSnapshotCache (electron/cs3/pageSnapshot.ts)                    |
|      Caches rendered catalog grids to disk for instant zero-latency rendering on next launch       |
+───────────────────────────────────────────────────────────────────────────────────────────────────+
```

---

## 2. The Native Provider Lane (`electron/cs3/nativeProviderRegistry.ts`)

Native providers run directly in the Node main process, offering lower latency, reduced memory overhead, and independence from Java/DEX runtimes.

### 2.1 Stremio Addon Protocol Adapter (`nativeProviders/stremio.ts`)
* **Standard Compatibility**: Implements the official Stremio Addon v3 Protocol (`manifest.json`, `catalog`, `stream`, and `subtitles`).
* **Manifest Ingestion**: Users can paste any Stremio manifest URL (e.g., `https://v3-cinemeta.strem.io/manifest.json`, Torrentio, Cyberflix, MediaFusion, Comet).
* **Dynamic Stream Extraction**: Resolves streams directly to HTTP video URLs, magnet infohashes, or external player targets.
* **Management**: Users can dynamically register and remove custom addons via Settings → Native Providers without restarting the application.

### 2.2 Local & Remote Media Servers (`nativeProviders/jellyfin.ts`)
* **Jellyfin & Emby Integration**: Connects to personal home media servers over local LAN or remote HTTPS.
* **API Key Security**: Securely stores API keys in `cs3_datastore.json` using non-transferable key storage (filtered from backup exports).
* **Catalog Sync**: Ingests movies, TV shows, and episodes into the unified desktop library and search index.

---

## 3. OTT Streaming Platform Catalog (`electron/cs3/ottCatalog.ts`, `ottPlatforms.ts`)

Instead of forcing users to know which community provider scrapes which website, the OTT subsystem presents a content-centric catalog organized by streaming network.

### 3.1 Supported Streaming Platforms
Pre-configured with visual assets, brand colors, and catalog identifiers for:
* **Netflix** (`netflix`)
* **Amazon Prime Video** (`prime`)
* **Disney+** (`disney`)
* **Apple TV+** (`appletv`)
* **HBO Max / Max** (`max`)
* **Hulu** (`hulu`)
* **Paramount+** (`paramount`)
* **Peacock** (`peacock`)
* **Crunchyroll** (`crunchyroll`)
* **BBC iPlayer** (`bbc`)

### 3.2 Provider Discovery & Main Page Ingestion (`getMainPage`)
* Providers declaring support for an OTT network expose structured catalog rows via their `getMainPage()` API implementation.
* The engine queries providers in parallel, aggregating trending, popular, and recently added rows for each platform.
* Users can paginate through platform-specific catalogs (`ott:getCatalogPage`).

### 3.3 Safe Extension Suggestions (`installSuggestion`)
* When an OTT platform has no installed providers capable of serving it, the UI offers vetted community extensions.
* **Security Rule**: `ott:installSuggestion` accepts **only approved repository IDs**, never arbitrary raw URLs. This prevents untrusted external links from injecting unverified code under the guise of setting up a streaming service.

---

## 4. Page Snapshot Caching (`electron/cs3/pageSnapshot.ts`)

Provider home pages and OTT catalogs rely on web scraping that can take between 2 and 20 seconds depending on origin latency and Cloudflare mitigations.

* **Instant Load Architecture**:
  * Scraped catalog grids are stored as atomic snapshots in `%APPDATA%/<app>/page_snapshots/`.
  * On launch, the UI renders the latest cached snapshot instantly (0ms latency).
  * A background re-validation fetches fresh data and updates the view seamlessly if changes are detected.
* **Pinned Pages**: Users can pin specific provider pages or OTT catalogs to their home screen navigation.

---

## 5. IPC Interface

| Channel | Direction | Payload & Functionality |
|---|---|---|
| `natives:list` | Renderer ➔ Main | Returns list of installed native providers and Stremio addons |
| `natives:setEnabled` | Renderer ➔ Main | `({ id, enabled })` ➔ Toggles active state of a native provider |
| `natives:addAddon` | Renderer ➔ Main | `(manifestUrl)` ➔ Verifies and registers a new Stremio addon |
| `natives:removeAddon` | Renderer ➔ Main | `(addonId)` ➔ Removes registered Stremio addon |
| `natives:addServer` | Renderer ➔ Main | `({ url, apiKey, type })` ➔ Registers Jellyfin/Emby server |
| `natives:removeServer` | Renderer ➔ Main | `(serverId)` ➔ Removes registered media server |
| `ott:listPlatforms` | Renderer ➔ Main | Returns all supported OTT platforms with availability status |
| `ott:getCatalog` | Renderer ➔ Main | `(platformId)` ➔ Fetches top catalog rows for platform |
| `ott:getCatalogPage` | Renderer ➔ Main | `({ platformId, page })` ➔ Paginates platform catalog |
| `ott:getSuggestions` | Renderer ➔ Main | Returns recommended providers for unserviced platforms |
| `ott:installSuggestion` | Renderer ➔ Main | `(repoId)` ➔ Installs vetted provider repository for platform |
| `pages:getSnapshot` | Renderer ➔ Main | `(pageId)` ➔ Retrieves cached catalog snapshot for instant display |
| `pages:setPinned` | Renderer ➔ Main | `({ pageId, pinned })` ➔ Pins or unpins page on home dashboard |
