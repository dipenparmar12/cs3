# 08. Key Files & Codebase Reference Map

This document provides a comprehensive mapping of key files across the `:app` and `:library` modules, explaining their exact location and code responsibilities.

---

## 1. Top-Level Project Configuration Files

| File Path | Description & Responsibilities |
|---|---|
| [`build.gradle.kts`](file:///D:/dipen/cs3/cloudstream_ref_android/build.gradle.kts) | Top-level Gradle script defining plugins catalog (`android.application`, `kotlin.multiplatform`, `dokka`, `buildkonfig`). |
| [`settings.gradle.kts`](file:///D:/dipen/cs3/cloudstream_ref_android/settings.gradle.kts) | Gradle settings declaring root project name (`CloudStream`) and included modules (`:app`, `:library`, `:docs`). |
| [`gradle/libs.versions.toml`](file:///D:/dipen/cs3/cloudstream_ref_android/gradle/libs.versions.toml) | Gradle Version Catalog declaring all dependency versions (AndroidX Media3, Coil 3, Jsoup, Conscrypt, NiceHttp, TorrentServer, Zipline). |

---

## 2. Core SDK Module (`:library`) Key Files

Location root: `library/src/commonMain/kotlin/com/lagradost/cloudstream3/`

| Relative Path | Key Class / Interface | Responsibilities |
|---|---|---|
| [`MainAPI.kt`](file:///D:/dipen/cs3/cloudstream_ref_android/library/src/commonMain/kotlin/com/lagradost/cloudstream3/MainAPI.kt) | `abstract class MainAPI` | Core contract for media provider extensions. Defines `search()`, `getMainPage()`, `load()`, `loadLinks()`. |
| [`utils/ExtractorApi.kt`](file:///D:/dipen/cs3/cloudstream_ref_android/library/src/commonMain/kotlin/com/lagradost/cloudstream3/utils/ExtractorApi.kt) | `abstract class ExtractorApi` | Base class for video link extractor modules (e.g. Filemoon, StreamSB). |
| [`plugins/BasePlugin.kt`](file:///D:/dipen/cs3/cloudstream_ref_android/library/src/commonMain/kotlin/com/lagradost/cloudstream3/plugins/BasePlugin.kt) | `open class BasePlugin` | Base lifecycle class for dynamically loaded Kotlin extensions. |
| [`extractors/*`](file:///D:/dipen/cs3/cloudstream_ref_android/library/src/commonMain/kotlin/com/lagradost/cloudstream3/extractors) | 100+ Extractor Classes | Implementations for video hosting services (DoodStream, MixDrop, OkRu, Filemoon, Voe, etc.). |

---

## 3. Main Application Module (`:app`) Key Files

Location root: `app/src/main/java/com/lagradost/cloudstream3/`

### A. Application Entry & Core Activities

| Relative Path | Key Class | Responsibilities |
|---|---|---|
| [`CloudStreamApp.kt`](file:///D:/dipen/cs3/cloudstream_ref_android/app/src/main/java/com/lagradost/cloudstream3/CloudStreamApp.kt) | `class CloudStreamApp : Application()` | Global Application class. Initializes Conscrypt SSL provider, DataStore key-value engine, notification channels, and global exception handlers. |
| [`MainActivity.kt`](file:///D:/dipen/cs3/cloudstream_ref_android/app/src/main/java/com/lagradost/cloudstream3/MainActivity.kt) | `class MainActivity : AppCompatActivity()` | Main single-activity host for all primary UI fragments. Manages Navigation Controller, dynamic UI theme loading, TV mode detection, and plugin loading events. |
| [`ui/account/AccountSelectActivity.kt`](file:///D:/dipen/cs3/cloudstream_ref_android/app/src/main/java/com/lagradost/cloudstream3/ui/account/AccountSelectActivity.kt) | `class AccountSelectActivity` | Initial launcher activity for user profile selection, PIN authentication, fingerprint biometric authentication, and TV QR login. |

### B. Extension & Plugin System

| Relative Path | Key Class | Responsibilities |
|---|---|---|
| [`plugins/PluginManager.kt`](file:///D:/dipen/cs3/cloudstream_ref_android/app/src/main/java/com/lagradost/cloudstream3/plugins/PluginManager.kt) | `object PluginManager` | Core extension loader. Instantiates `PathClassLoader` to load `.cs3`/`.zip` DEX files at runtime, registers `MainAPI` instances, handles plugin auto-updates and OAT cache clearing. |
| [`plugins/RepositoryManager.kt`](file:///D:/dipen/cs3/cloudstream_ref_android/app/src/main/java/com/lagradost/cloudstream3/plugins/RepositoryManager.kt) | `object RepositoryManager` | Manages third-party extension repositories, downloads plugin manifests, verifies SHA-256 checksums, and queries updates. |

### C. UI Presentation Layer (Fragments & ViewModels)

| Relative Path | Component Name | Responsibilities |
|---|---|---|
| [`ui/home/HomeFragment.kt`](file:///D:/dipen/cs3/cloudstream_ref_android/app/src/main/java/com/lagradost/cloudstream3/ui/home/HomeFragment.kt) | `HomeFragment` & `HomeViewModel` | Displays home screen rows, hero banners, content filters, and provider selectors. |
| [`ui/search/SearchFragment.kt`](file:///D:/dipen/cs3/cloudstream_ref_android/app/src/main/java/com/lagradost/cloudstream3/ui/search/SearchFragment.kt) | `SearchFragment` & `SearchViewModel` | Handles multi-provider search queries, history, and provider selection tags. |
| [`ui/result/ResultFragment2.kt`](file:///D:/dipen/cs3/cloudstream_ref_android/app/src/main/java/com/lagradost/cloudstream3/ui/result/ResultFragment2.kt) | `ResultFragment2` & `ResultViewModel2` | Media details view (episodes list, server list, trailers, cast info, tracker status, anime filler indicator). |
| [`ui/library/LibraryFragment.kt`](file:///D:/dipen/cs3/cloudstream_ref_android/app/src/main/java/com/lagradost/cloudstream3/ui/library/LibraryFragment.kt) | `LibraryFragment` & `LibraryViewModel` | Manages user watchlists (Watching, Completed, On Hold, Dropped, Plan to Watch). |
| [`ui/download/DownloadFragment.kt`](file:///D:/dipen/cs3/cloudstream_ref_android/app/src/main/java/com/lagradost/cloudstream3/ui/download/DownloadFragment.kt) | `DownloadFragment` & `DownloadViewModel` | Displays offline downloaded video files and active download tasks. |

### D. Media Playback & Player Sub-System

| Relative Path | Key Class | Responsibilities |
|---|---|---|
| [`ui/player/PlayerActivity.kt`](file:///D:/dipen/cs3/cloudstream_ref_android/app/src/main/java/com/lagradost/cloudstream3/ui/player/PlayerActivity.kt) | `class PlayerActivity` | Central online video player powered by AndroidX Media3 ExoPlayer. Controls stream resolution, subtitle tracks, audio tracks, picture-in-picture, skip intro/outro, and BitTorrent streaming. |
| [`ui/player/DownloadedPlayerActivity.kt`](file:///D:/dipen/cs3/cloudstream_ref_android/app/src/main/java/com/lagradost/cloudstream3/ui/player/DownloadedPlayerActivity.kt) | `class DownloadedPlayerActivity` | Standalone player activity for watching local downloaded video files. |
| [`ui/player/CS3IPlayer.kt`](file:///D:/dipen/cs3/cloudstream_ref_android/app/src/main/java/com/lagradost/cloudstream3/ui/player/CS3IPlayer.kt) | `interface CS3IPlayer` | Abstract interface encapsulating player functionality for ExoPlayer and custom player engines. |

### E. Data Tracking & Third-Party Integrations

| Relative Path | Provider | Capabilities |
|---|---|---|
| [`syncproviders/providers/AniListApi.kt`](file:///D:/dipen/cs3/cloudstream_ref_android/app/src/main/java/com/lagradost/cloudstream3/syncproviders/providers/AniListApi.kt) | AniList | GraphQL API integration for syncing anime progress, score, and watch lists. |
| [`syncproviders/providers/MALApi.kt`](file:///D:/dipen/cs3/cloudstream_ref_android/app/src/main/java/com/lagradost/cloudstream3/syncproviders/providers/MALApi.kt) | MyAnimeList | Official REST API integration for MAL watchlist sync. |
| [`syncproviders/providers/SimklApi.kt`](file:///D:/dipen/cs3/cloudstream_ref_android/app/src/main/java/com/lagradost/cloudstream3/syncproviders/providers/SimklApi.kt) | SIMKL | REST API integration for tracking movies, TV series, and anime. |
| [`syncproviders/providers/OpenSubtitlesApi.kt`](file:///D:/dipen/cs3/cloudstream_ref_android/app/src/main/java/com/lagradost/cloudstream3/syncproviders/providers/OpenSubtitlesApi.kt) | OpenSubtitles | REST API integration for auto-fetching subtitles. |

### F. Services, Utilities & System Helpers

| Relative Path | Class / Component | Responsibilities |
|---|---|---|
| [`utils/DataStore.kt`](file:///D:/dipen/cs3/cloudstream_ref_android/app/src/main/java/com/lagradost/cloudstream3/utils/DataStore.kt) | `object DataStore` | Generic SharedPreferences + Jackson JSON storage wrapper. |
| [`utils/BackupUtils.kt`](file:///D:/dipen/cs3/cloudstream_ref_android/app/src/main/java/com/lagradost/cloudstream3/utils/BackupUtils.kt) | `object BackupUtils` | Import/Export zip and json backup files. |
| [`utils/InAppUpdater.kt`](file:///D:/dipen/cs3/cloudstream_ref_android/app/src/main/java/com/lagradost/cloudstream3/utils/InAppUpdater.kt) | `object InAppUpdater` | GitHub releases updater checking and APK downloader. |
| [`services/VideoDownloadService.kt`](file:///D:/dipen/cs3/cloudstream_ref_android/app/src/main/java/com/lagradost/cloudstream3/services/VideoDownloadService.kt) | `VideoDownloadService` | Foreground service executing video file downloads. |
| [`utils/BiometricAuthenticator.kt`](file:///D:/dipen/cs3/cloudstream_ref_android/app/src/main/java/com/lagradost/cloudstream3/utils/BiometricAuthenticator.kt) | `BiometricAuthenticator` | Native Android fingerprint/biometric security prompt handler. |
| [`utils/CastHelper.kt`](file:///D:/dipen/cs3/cloudstream_ref_android/app/src/main/java/com/lagradost/cloudstream3/utils/CastHelper.kt) | `CastHelper` | Chromecast session manager and stream controller. |
