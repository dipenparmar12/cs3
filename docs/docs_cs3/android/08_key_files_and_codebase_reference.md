# 08. Key Files & Codebase Reference Map

This document provides a comprehensive mapping of key files across the CloudStream project modules, explaining their exact location and code responsibilities. All paths are relative to the repository root.

---

## 1. Top-Level Project Configuration Files

| File Path | Description & Responsibilities |
|---|---|
| [`build.gradle.kts`](build.gradle.kts) | Top-level Gradle script defining plugins catalog (`android.application`, `kotlin.multiplatform`, `dokka`, `buildkonfig`). |
| [`settings.gradle.kts`](settings.gradle.kts) | Gradle settings declaring root project name (`CloudStream`) and included modules (`:app`, `:library`, `:shared`, `:desktopApp`, `:docs`). |
| [`gradle/libs.versions.toml`](gradle/libs.versions.toml) | Gradle Version Catalog declaring all dependency versions (AndroidX Media3, Coil 3, Jsoup, Conscrypt, NiceHttp, TorrentServer, Zipline). |

---

## 2. Core SDK Module (`:library`)

**Location root:** `library/src/`

The `:library` module is a Kotlin Multiplatform (KMP) module that serves as the independent SDK and contract for all extension developers. It contains base abstract classes, shared data models, network utilities, and 100+ built-in extractor implementations.

### A. KMP Source Sets in `:library`

```
library/src/
├── commonMain/         # Core API models, MainAPI, ExtractorApi, NiceHttp, Jsoup, Cryptography
├── jvmCommonMain/      # Shared JVM/Android logic, NewPipeExtractor integration, Reflect
├── androidMain/        # Android-specific extensions
├── jvmMain/            # Desktop/JVM-specific targets
├── webMain/            # Web/WASM-specific targets
└── commonTest/         # Multiplatform unit test suites
```

### B. Core API Contracts

| Relative Path | Key Class / Interface | Responsibilities |
|---|---|---|
| `library/src/commonMain/kotlin/com/lagradost/cloudstream3/MainAPI.kt` | `abstract class MainAPI` | Core contract for media provider extensions. Defines `name`, `mainUrl`, `supportedTypes`, `hasMainPage`, `getMainPage()`, `search()`, `load()`, `loadLinks()`. |
| `library/src/commonMain/kotlin/com/lagradost/cloudstream3/plugins/BasePlugin.kt` | `open class BasePlugin` | Base lifecycle class for dynamically loaded Kotlin extensions. Provides `registerMainAPI()` and `registerExtractorAPI()` methods. |
| `library/src/commonMain/kotlin/com/lagradost/cloudstream3/utils/ExtractorApi.kt` | `abstract class ExtractorApi` | Base class for video link extractor modules (e.g. Filemoon, StreamSB). Defines `name`, `mainUrl`, `requiresReferer`, `getUrl()`. |

### C. Built-in Video Extractors

**Location:** `library/src/commonMain/kotlin/com/lagradost/cloudstream3/extractors/`

This directory contains **104+ ExtractorApi implementations** for universal video hosters, including but not limited to:

- **DoodStream variants:** DoodCx, DoodLa, DoodPm, DoodSh, DoodSo, DoodTo, DoodWatch, DoodWf, DoodWs, DoodYt
- **Filemoon variants:** FileMoon, FileMoonIn, FileMoonSx, FilemoonV2
- **StreamSB and related:** StreamSB, StreamTape, StreamVid, etc.
- **Cloud-based:** Google Drive (Gdriveplayer and variants), Mega, etc.
- **Specialized:** MixDrop, Voe, OkRu, Rabbitstream, FEmbed, etc.
- **Adult content:** Doodporn, etc.
- **CDN services:** CDNplayer, GDMirrorbot, etc.

Each extractor implements the `ExtractorApi` contract and handles the specific logic for extracting playable video URLs from its target hoster service.

### D. Utility and Helper Classes

| Relative Path | Key Class / Utility | Responsibilities |
|---|---|---|
| `library/src/commonMain/kotlin/com/lagradost/cloudstream3/APIHolder.kt` | `object APIHolder` | Global holder for all registered MainAPI instances and ExtractorApi instances. Provides thread-safe access to plugin APIs. |
| `library/src/commonMain/kotlin/com/lagradost/cloudstream3/utils/AppUtils.kt` | `object AppUtils` | Utility functions for JSON parsing, string manipulation, and common operations. |
| `library/src/commonMain/kotlin/com/lagradost/cloudstream3/utils/SubtitleHelper.kt` | `object SubtitleHelper` | Subtitle language code conversion, IETF BCP 47 tag handling, and language detection. |

---

## 3. Main Application Module (`:app`)

**Location root:** `app/src/main/java/com/lagradost/cloudstream3/`

The `:app` module contains the entire Android application, including the UI layer, plugin management, media playback, data persistence, and third-party integrations.

### A. Application Entry & Core Activities

| Relative Path | Key Class | Responsibilities |
|---|---|---|
| `app/src/main/java/com/lagradost/cloudstream3/CloudStreamApp.kt` | `class CloudStreamApp : Application()` | Global Application class. Initializes Conscrypt SSL provider, DataStore key-value engine, notification channels, and global exception handlers. |
| `app/src/main/java/com/lagradost/cloudstream3/MainActivity.kt` | `class MainActivity : AppCompatActivity()` | Main single-activity host for all primary UI fragments. Manages Navigation Controller, dynamic UI theme loading, TV mode detection, and plugin loading events. |
| `app/src/main/java/com/lagradost/cloudstream3/CommonActivity.kt` | `class CommonActivity` | Common base activity with shared functionality used across multiple screens. |
| `app/src/main/java/com/lagradost/cloudstream3/ui/account/AccountSelectActivity.kt` | `class AccountSelectActivity` | Initial launcher activity for user profile selection, PIN authentication, fingerprint biometric authentication, and TV QR login. |

### B. Extension & Plugin System

| Relative Path | Key Class | Responsibilities |
|---|---|---|
| `app/src/main/java/com/lagradost/cloudstream3/plugins/PluginManager.kt` | `object PluginManager` | Core extension loader. Instantiates `PathClassLoader` to load `.cs3`/`.zip` DEX files at runtime, registers `MainAPI` instances, handles plugin auto-updates and OAT cache clearing. |
| `app/src/main/java/com/lagradost/cloudstream3/plugins/RepositoryManager.kt` | `object RepositoryManager` | Manages third-party extension repositories, downloads plugin manifests, verifies SHA-256 checksums, and queries updates. |

### C. UI Presentation Layer (Fragments & ViewModels)

| Relative Path | Component Name | Responsibilities |
|---|---|---|
| `app/src/main/java/com/lagradost/cloudstream3/ui/home/` | `HomeFragment` & `HomeViewModel` | Displays home screen rows, hero banners, content filters, and provider selectors. |
| `app/src/main/java/com/lagradost/cloudstream3/ui/search/` | `SearchFragment` & `SearchViewModel` | Handles multi-provider search queries, history, and provider selection tags. |
| `app/src/main/java/com/lagradost/cloudstream3/ui/result/` | `ResultFragment2` & `ResultViewModel2` | Media details view (episodes list, server list, trailers, cast info, tracker status, anime filler indicator). |
| `app/src/main/java/com/lagradost/cloudstream3/ui/library/` | `LibraryFragment` & `LibraryViewModel` | Manages user watchlists (Watching, Completed, On Hold, Dropped, Plan to Watch, Rewatching). |
| `app/src/main/java/com/lagradost/cloudstream3/ui/download/` | `DownloadFragment` & `DownloadViewModel` | Displays offline downloaded video files and active download tasks. |
| `app/src/main/java/com/lagradost/cloudstream3/ui/settings/` | `SettingsFragment` | Central settings screen with sub-screens for General, Player, Provider, Extensions, Network, and Backup settings. |

### D. Media Playback & Player Sub-System

| Relative Path | Key Class | Responsibilities |
|---|---|---|
| `app/src/main/java/com/lagradost/cloudstream3/ui/player/PlayerActivity.kt` | `class PlayerActivity` | Central online video player powered by AndroidX Media3 ExoPlayer. Controls stream resolution, subtitle tracks, audio tracks, picture-in-picture, skip intro/outro, and BitTorrent streaming. |
| `app/src/main/java/com/lagradost/cloudstream3/ui/player/DownloadedPlayerActivity.kt` | `class DownloadedPlayerActivity` | Standalone player activity for watching local downloaded video files. |
| `app/src/main/java/com/lagradost/cloudstream3/ui/player/CS3IPlayer.kt` | `interface CS3IPlayer` | Abstract interface encapsulating player functionality for ExoPlayer and custom player engines. |

### E. Data Tracking & Third-Party Integrations

**Location:** `app/src/main/java/com/lagradost/cloudstream3/syncproviders/providers/`

| Relative Path | Provider | Protocol / Auth Method | Capabilities |
|---|---|---|---|
| `app/src/main/java/com/lagradost/cloudstream3/syncproviders/providers/AniListApi.kt` | AniList | GraphQL API + OAuth2 | Anime watchlist sync, episode scrobbling, ratings, custom lists, recommendations. |
| `app/src/main/java/com/lagradost/cloudstream3/syncproviders/providers/MALApi.kt` | MyAnimeList (MAL) | REST API + OAuth2 | MAL anime watchlist sync, episode status updates, score syncing. |
| `app/src/main/java/com/lagradost/cloudstream3/syncproviders/providers/SimklApi.kt` | SIMKL | REST API + Client ID/Secret | Anime, TV Series, and Movies tracking, auto-scrobble, watch next sync. |
| `app/src/main/java/com/lagradost/cloudstream3/syncproviders/providers/TraktApi.kt` | Trakt.tv | REST API + OAuth2 | Movies and TV show scrobbling, watch status sync, history logging. |
| `app/src/main/java/com/lagradost/cloudstream3/syncproviders/providers/KitsuApi.kt` | Kitsu | REST API | Kitsu anime tracking and progress updates. |
| `app/src/main/java/com/lagradost/cloudstream3/syncproviders/providers/OpenSubtitlesApi.kt` | OpenSubtitles | REST API | Auto-fetching subtitles for videos. |
| `app/src/main/java/com/lagradost/cloudstream3/syncproviders/providers/Subdl.kt` | Subdl | Web scraping | Online subtitle search and download. |
| `app/src/main/java/com/lagradost/cloudstream3/syncproviders/providers/SubSource.kt` | SubSource | Web scraping | Online subtitle search and download. |
| `app/src/main/java/com/lagradost/cloudstream3/syncproviders/providers/Addic7ed.kt` | Addic7ed | Web scraping | Online subtitle search and download. |

### F. Services, Utilities & System Helpers

| Relative Path | Class / Component | Responsibilities |
|---|---|---|
| `app/src/main/java/com/lagradost/cloudstream3/utils/DataStore.kt` | `object DataStore` | Generic SharedPreferences + Jackson JSON storage wrapper. |
| `app/src/main/java/com/lagradost/cloudstream3/utils/BackupUtils.kt` | `object BackupUtils` | Import/Export zip and json backup files for user data. |
| `app/src/main/java/com/lagradost/cloudstream3/utils/InAppUpdater.kt` | `object InAppUpdater` | GitHub releases updater checking and APK downloader. |
| `app/src/main/java/com/lagradost/cloudstream3/services/VideoDownloadService.kt` | `VideoDownloadService` | Foreground service executing video file downloads with persistent notifications. |
| `app/src/main/java/com/lagradost/cloudstream3/services/DownloadQueueService.kt` | `DownloadQueueService` | Foreground service managing serial execution of queued episode downloads. |
| `app/src/main/java/com/lagradost/cloudstream3/utils/BiometricAuthenticator.kt` | `BiometricAuthenticator` | Native Android fingerprint/biometric security prompt handler. |
| `app/src/main/java/com/lagradost/cloudstream3/utils/CastHelper.kt` | `CastHelper` | Chromecast session manager and stream controller. |
| `app/src/main/java/com/lagradost/cloudstream3/utils/PowerManagerAPI.kt` | `PowerManagerAPI` | Battery optimization and wake lock management to prevent OS from killing long-running operations. |

### G. Network Stack

| Relative Path | Class / Component | Responsibilities |
|---|---|---|
| `app/src/main/java/com/lagradost/cloudstream3/utils/NiceHttp.kt` | NiceHttp utilities | Kotlin-first wrapper over OkHttp for simplified HTTP requests with cookie persistence. |
| `app/src/main/java/com/lagradost/cloudstream3/utils/ConscryptHelper.kt` | Conscrypt integration | Injects Conscrypt security provider on older Android versions to fix SSL handshake issues. |

---

## 4. Shared Module (`:shared`)

**Location root:** `shared/src/`

The `:shared` module contains code shared between the Android app and other platforms (like the desktop port).

| Relative Path | Key Class / Component | Responsibilities |
|---|---|---|
| `shared/src/main/java/...` | Various shared utilities | Common code used across different platform implementations. |

---

## 5. Desktop App Module (`:desktopApp`)

**Location root:** `desktopApp/src/`

The `:desktopApp` module contains the desktop-specific implementation for CloudStream, allowing it to run on desktop platforms while sharing the core library code.

---

## 6. Documentation Module (`:docs`)

**Location root:** `docs/`

The `:docs` module contains the project documentation, including this file and other technical documentation.

---

## Navigation Guide

This codebase reference map is organized by:

1. **Module** - Each major Gradle module
2. **Package/Directory** - Logical grouping within each module
3. **File** - Individual source files
4. **Class/Object** - The primary Kotlin declarations

To find a specific file, use the relative path from the repository root. For example:
- MainAPI: `library/src/commonMain/kotlin/com/lagradost/cloudstream3/MainAPI.kt`
- PluginManager: `app/src/main/java/com/lagradost/cloudstream3/plugins/PluginManager.kt`
- AniListApi: `app/src/main/java/com/lagradost/cloudstream3/syncproviders/providers/AniListApi.kt`

All paths in this document are relative to the CloudStream repository root and will work from any machine with the repository cloned.
