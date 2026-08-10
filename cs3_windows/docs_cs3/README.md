# CloudStream Android Architecture & Codebase Documentation

Welcome to the comprehensive technical documentation for **CloudStream 3** (`cloudstream_ref_android`), generated from in-depth codebase analysis of the repository located at `D:\dipen\cs3\cloudstream_ref_android`.

---

## 📚 Master Index & Documentation Structure

Click on any section below to view the detailed document:

1. [**01. Executive Summary & Core Purpose**](file:///D:/dipen/cs3/cs3_windows/docs/01_executive_summary_and_purpose.md)
   * What is CloudStream?
   * What problems does it solve?
   * Decoupled plugin architecture model
   * Target devices (Android Mobile, Tablets, Android TV, FireStick)
   * Architectural high-level diagram

2. [**02. Architecture & Module Breakdown**](file:///D:/dipen/cs3/cs3_windows/docs/02_architecture_and_modules.md)
   * Multi-module project structure (`:app` vs `:library`)
   * Kotlin Multiplatform (KMP) setup
   * Target SDKs, JDK 17 toolchain, build variants (`stable`, `prerelease`)
   * MVVM & Unidirectional Data Flow patterns

3. [**03. Extension & Plugin System Architecture**](file:///D:/dipen/cs3/cs3_windows/docs/03_extension_and_plugin_system.md)
   * Plugin DEX packaging (`.cs3` / `.zip`)
   * Dynamic loading at runtime via `dalvik.system.PathClassLoader`
   * Base API contracts (`MainAPI`, `ExtractorApi`, `CloudstreamPlugin`)
   * Repository infrastructure, SHA-256 checksum validation, auto-updates, OAT clearing

4. [**04. UI & Presentation Layer Architecture**](file:///D:/dipen/cs3/cs3_windows/docs/04_ui_and_presentation_layer.md)
   * Single Activity Pattern (`MainActivity`, `AccountSelectActivity`)
   * Navigation Graph (`nav_graph.xml`) & ViewBinding
   * Dual-Mode Interface: Phone/Tablet Touch UI vs Android TV Remote / Leanback UI
   * Core UI Fragments (`HomeFragment`, `SearchFragment`, `ResultFragment2`, `LibraryFragment`, `SettingsFragment`)
   * Anime-DB filler checking integration

5. [**05. Playback Media & Torrent Engine Architecture**](file:///D:/dipen/cs3/cs3_windows/docs/05_playback_media_and_torrent_engine.md)
   * AndroidX Media3 ExoPlayer integration
   * Software audio decoding via `nextlib` FFmpeg extensions (AC3, EAC3, DTS)
   * Integrated BitTorrent engine (`torrentserver`) for direct magnet streaming
   * Custom Subtitle pipeline (SRT, VTT, SSA/ASS, JUniversalChardet encoding, timing sync)
   * Player controls (Video Skip intro/outro, SeekBar preview, Chromecast, Picture-in-Picture)

6. [**06. Trackers, Sync & Data Persistence Architecture**](file:///D:/dipen/cs3/cs3_windows/docs/06_trackers_sync_and_data_persistence.md)
   * Local key-value storage engine (`DataStore.kt`, `DataStoreHelper.kt`)
   * Multi-profile account isolation
   * Third-party tracking services (AniList GraphQL, MyAnimeList REST, SIMKL, Trakt.tv, Kitsu)
   * Cloud backup and restore (`BackupUtils.kt`)

7. [**07. Security, Network Services & Utility Architecture**](file:///D:/dipen/cs3/cs3_windows/docs/07_security_services_and_utilities.md)
   * Network stack (`NiceHttp`, Jsoup/Ksoup, Conscrypt SSL layer, DNS-over-HTTPS)
   * In-app updater framework (`InAppUpdater.kt`, `PackageInstallerService`)
   * Background foreground services (`VideoDownloadService`, `DownloadQueueService`)
   * Security (Biometric unlock, PIN authentication, WakeLocks)

8. [**08. Key Files & Codebase Reference Map**](file:///D:/dipen/cs3/cs3_windows/docs/08_key_files_and_codebase_reference.md)
   * Complete directory map of `:app` and `:library`
   * Comprehensive catalog of critical Kotlin classes, interfaces, viewmodels, and services with file path links

9. [**09. CI/CD, DevOps & Future Architectural Roadmap**](file:///D:/dipen/cs3/cs3_windows/docs/09_ci_cd_devops_and_future_roadmap.md)
   * GitHub Actions automation (`prerelease.yml`, `build_to_archive.yml`, `update_locales.yml`, `generate_dokka.yml`)
   * Hosted Weblate localization pipeline (`locales.py`)
   * AI contribution policy (`AI-POLICY.md`)
   * Future architectural roadmap: MVI pattern migration, Compose Multiplatform, and KMP library adoption (`COMPOSE.md`)

---

## 🛠️ Quick Repository Summary

| Item | Value |
|---|---|
| **Repository Location** | `D:\dipen\cs3\cloudstream_ref_android` |
| **Documentation Root** | `D:\dipen\cs3\cs3_windows\docs` |
| **App Name** | CloudStream (`com.lagradost.cloudstream3`) |
| **SDK Module** | CloudStream Library (`com.lagradost.api`) |
| **Primary Language** | Kotlin (100%), Kotlin Multiplatform (KMP) |
| **Target Platforms** | Android 6.0+ (Phone, Tablet, Android TV, Fire TV) |
| **Build System** | Gradle Kotlin DSL (`build.gradle.kts` + `libs.versions.toml`) |
