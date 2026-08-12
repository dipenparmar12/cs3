# 02 — System Architecture

**Generated:** 2026-08-10
**Baseline:** commit `a72f9e6c`, CloudStream `4.8.0`

This document describes the Android architecture as it actually exists, then specifies the target Electron architecture. The two are deliberately not isomorphic — the goal is functional equivalence, not architectural duplication.

---

## PART A — THE ANDROID APPLICATION AS BUILT

## A1. Module structure

```
CloudStream (Gradle root)
├── :app        Android application. 232 Kotlin files. UI, playback, downloads,
│               plugin loading, persistence, sync, services.
├── :library    Kotlin Multiplatform. The public provider API + shared logic.
│               Published to Maven as com.lagradost.api. Version 1.0.1.
└── :docs       Dokka aggregation only.
```

**Evidence:** `settings.gradle.kts:23`; `library/build.gradle.kts:20-21`; `app/build.gradle.kts:8-12`. **Confidence: High.**

### A1.1 The `:library` module is already multiplatform

| Source set | Files | Purpose |
|---|---|---|
| `commonMain` | 146 | `MainAPI`, `ExtractorApi`, extractors, metaproviders, network, utils, `BasePlugin` |
| `jvmCommonMain` | 3 | Shared JVM+Android (`kotlin-reflect`, NewPipeExtractor) |
| `androidMain` | 6 | Android actuals |
| `jvmMain` | 5 | Desktop-JVM actuals (`WebViewResolver.jvm.kt`, `Log`, `Coroutines`, `SubtitleHelperPlatform`) |
| `webMain` | 6 | **Web actuals — present in source but no `js()`/`wasmJs()` target is declared in the build file** |
| `commonTest` / `webTest` | 7 / 1 | Tests |

Declared targets are `android { }` and `jvm()` only (`library/build.gradle.kts:23-42`). `webMain` is therefore staged-but-dormant: upstream has written the actuals ahead of enabling the target (commit `#3072`, 2026-07-15).

**Why this matters for the migration — this is the single most consequential fact in the document.** A JVM artifact of the provider API already builds today (`library-jvm.jar`, produced by `:app:copyJar`, `app/build.gradle.kts:305-317`), and upstream's `makeJar` already merges it into the very classpath every community provider compiles against (`app/build.gradle.kts:319-325`). The desktop app therefore **links upstream's real provider API rather than reimplementing it**, and existing `.cs3` plugins run drop-in on a bundled JVM. That is the technical basis for Runtime 3 in [27](27-plugin-and-extension-architecture.md) §6.2 and [31-cs3-dropin-compatibility.md](31-cs3-dropin-compatibility.md).

**Confidence: High** for the source-set facts; **Medium** for the inference that a JS target is imminent.

---

## A2. Runtime layers

```
┌────────────────────────────────────────────────────────────────┐
│ Activities        MainActivity · DownloadedPlayerActivity ·    │
│                   ControllerActivity · PackageInstallerService │
├────────────────────────────────────────────────────────────────┤
│ Navigation        Single-Activity + Jetpack Navigation,        │
│                   mobile_navigation.xml (69 destinations)      │
├────────────────────────────────────────────────────────────────┤
│ UI (MVVM)         Fragments + ViewBinding + ViewModels +       │
│                   LiveData. Two layouts: PHONE / TV / EMULATOR │
├────────────────────────────────────────────────────────────────┤
│ Domain            APIRepository · SyncRepo · SubtitleRepo ·    │
│                   AuthRepo · IGenerator implementations        │
├────────────────────────────────────────────────────────────────┤
│ Provider layer    APIHolder → MainAPI instances (from plugins) │
│                   extractorApis → ExtractorApi instances       │
├────────────────────────────────────────────────────────────────┤
│ Plugin runtime    PluginManager (PathClassLoader/DEX)          │
│                   RepositoryManager (repo JSON, SHA-256)       │
├────────────────────────────────────────────────────────────────┤
│ Services          VideoDownloadService · DownloadQueueService ·│
│                   SubscriptionWorkManager · BackupWorkManager  │
├────────────────────────────────────────────────────────────────┤
│ Persistence       SharedPreferences ×2  ("rebuild_preference"  │
│                   = data;  default prefs = settings)           │
├────────────────────────────────────────────────────────────────┤
│ Media             ExoPlayer/Media3 + nextlib FFmpeg +          │
│                   CustomSubtitleDecoderFactory + torrServer    │
├────────────────────────────────────────────────────────────────┤
│ Network           NiceHttp/OkHttp + Conscrypt + DoH            │
└────────────────────────────────────────────────────────────────┘
```

**Evidence:** `app/src/main/java/com/lagradost/cloudstream3/` package tree; `app/src/main/res/navigation/mobile_navigation.xml`; `app/.../ui/settings/Globals.kt:14-16`; `app/.../utils/DataStore.kt:103-124`. **Confidence: High.**

### A2.1 There is no relational database

This surprises most readers. CloudStream stores **everything** in two `SharedPreferences` files:

| Store | Android name | Accessor | Contains |
|---|---|---|---|
| Data store | `rebuild_preference` | `DataStore.getSharedPrefs()` | All user data, as JSON strings under `folder/path` keys |
| Settings store | default prefs | `PreferenceManager.getDefaultSharedPreferences()` | Preference-screen settings, as native primitives |

`setKey` serializes any value to a JSON literal and calls `putString`; `getKey` parses it back. There is no Room, no SQLite schema, no migration framework.

**Evidence:** `app/.../utils/DataStore.kt:26` (`PREFERENCES_NAME = "rebuild_preference"`), `:103-124`, `:173-190`. **Confidence: High.**

**Consequence for desktop:** there is no schema to port. There is a *key grammar* to port. See [06-data-models.md](06-data-models.md).

### A2.2 Profile scoping

Most user data keys are prefixed with the current profile index: `"$currentAccount/$KEY/$id"`, where `currentAccount` is `selectedKeyIndex.toString()` — an integer, default `"0"`.

**Evidence:** `app/.../utils/DataStoreHelper.kt:67, 179-181, 516, 616-618`. **Confidence: High.**

### A2.3 Entry points

| Entry point | Trigger |
|---|---|
| `MainActivity` | Launcher, `LEANBACK_LAUNCHER` (Android TV) |
| Deep-link schemes | `cloudstreamplayer://`, `cloudstreamapp://`, `cloudstreamrepo://`, `csshare://`, `cloudstreamsearch://`, `cloudstreamcontinuewatching://`, and `https://cs.repo` |
| File/intent | `VIEW` on `video/*`, `application/x-mpegURL`, `application/vnd.apple.mpegurl`, `content://` video, `magnet:`, `application/x-bittorrent`; `SEND` on `*/*` |
| `DownloadedPlayerActivity` | External video file opened with the app |

**Evidence:** `app/src/main/AndroidManifest.xml:32-45, 101-243`; `app/.../MainActivity.kt:281-400`. **Confidence: High.**

---

## A3. Key subsystem notes

### A3.1 Provider layer
`MainAPI` is an abstract class (2,860-line file) whose subclasses are supplied by plugins. Core operations: `getMainPage`, `search`/`quickSearch`, `load`, `loadLinks`, `getLoadUrl`, `getVideoInterceptor`. Providers declare capabilities via open vals (`hasMainPage`, `hasQuickSearch`, `hasDownloadSupport`, `hasChromecastSupport`, `usesWebView`, `supportedTypes`, `lang`, `vpnStatus`, `providerType`) and per-operation timeouts.

**Evidence:** `library/.../MainAPI.kt:494-886`. **Confidence: High.**

### A3.2 Plugin runtime
`.cs3` files are ZIPs containing Android DEX bytecode plus a `manifest.json` (`name`, `pluginClassName`, `requiresResources`, `version`). Loading: set file read-only → `PathClassLoader(filePath, context.classLoader)` → read `manifest.json` from the loader → `loadClass(pluginClassName)` → reflective no-arg construction → `load(context)`. The plugin then self-registers providers/extractors/actions.

**Evidence:** `app/.../plugins/PluginManager.kt:593-686`; `library/.../plugins/BasePlugin.kt:14-78`. **Confidence: High.**

### A3.3 Playback
`CS3IPlayer` (2,023 lines) wraps ExoPlayer behind an `IPlayer` interface. Notable customizations: `UpdatedMatroskaExtractor` (3,242 lines), `UpdatedDefaultExtractorsFactory` (678), `CustomSubtitleDecoderFactory` (417) with charset detection via juniversalchardet, `nextlib` FFmpeg software decoders, `PreviewGenerator` for seekbar thumbnails, `PlayerGestureHelper` (1,220 lines). `GeneratorPlayer` (2,402 lines) drives link generation via `IGenerator` implementations (`RepoLinkGenerator`, `LinkGenerator`, `DownloadFileGenerator`).

**Evidence:** `app/.../ui/player/` file sizes; `gradle/libs.versions.toml:43,45`. **Confidence: High.**

### A3.4 Torrent
`torrServer` (a Go torrent server, `com.github.recloudstream:torrentserver`) is started in-process on an ephemeral loopback port; playback then targets `http://127.0.0.1:<port>`.

**Evidence:** `app/.../ui/player/Torrent.kt:14, 206-210`; `gradle/libs.versions.toml:51`. **Confidence: High.**

### A3.5 Network
`NiceHttp` over OkHttp, with Conscrypt to repair TLS on old Android, a DoH selector, response caching (`cacheTime`/`cacheUnit`), and per-provider interceptors. Repository fetches use a 5-minute cache; `raw.githubusercontent.com` URLs are optionally rewritten to jsDelivr.

**Evidence:** `gradle/libs.versions.toml:48,12`; `app/.../plugins/RepositoryManager.kt:124-178`. **Confidence: High.**

---

## PART B — THE TARGET ELECTRON ARCHITECTURE

## B1. Process topology

**Revised 2026-08-12 (ADR-10).** The topology gained a third child-process class — a bundled JVM sidecar — when drop-in `.cs3` compatibility became a P0 product commitment. See [31-cs3-dropin-compatibility.md](31-cs3-dropin-compatibility.md).

```
┌──── MAIN PROCESS (Node.js, full privilege) ────────────────────┐
│  App lifecycle · windows · menus · tray · protocol handlers    │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ StorageService     canonical data model, atomic writes   │  │
│  │ MigrationService   import/export, validation, rollback   │  │
│  │ NetworkService     HTTP, cookies, DoH, cache, throttling │  │
│  │ DownloadService    queue, segments, HLS/DASH muxing      │  │
│  │ UpdateService      auto-update, channels                 │  │
│  │ MediaService       external player control, thumbnails   │  │
│  │ LogService         rotating logs, crash capture          │  │
│  │ ExtensionManager   install · verify · analyze · tier     │  │
│  │ Supervisor         spawn · timeout · kill · quarantine   │  │
│  └──────────────────────────────────────────────────────────┘  │
└──────┬────────────────────┬─────────────────────┬──────────────┘
       │ contextBridge IPC  │ child process       │ child process
       │ (typed, allowlist) │ + typed JSON-RPC    │ + typed JSON-RPC
┌──────▼─────────────┐ ┌────▼───────────────┐ ┌───▼────────────────┐
│ RENDERER (UI)      │ │ V8 PLUGIN HOST     │ │ JVM SIDECAR        │
│ contextIsolation   │ │ Runtimes 1 & 2     │ │ Runtime 3          │
│ nodeIntegration:no │ │ TS SDK · KMP/JS    │ │ .cs3 drop-in       │
│ sandbox: true      │ │ No Electron APIs.  │ │ jlink'd JRE 17     │
│ CSP enforced       │ │ No filesystem.     │ │ OS-level sandbox   │
│ No provider code.  │ │ Broker-only net.   │ │ Broker-only net.   │
└────────────────────┘ └────────────────────┘ └────────────────────┘
                                                        │ IPC
                                              ┌─────────▼──────────┐
                                              │ OFFSCREEN WINDOW   │
                                              │ WebViewResolver    │
                                              │ per-plugin session │
                                              └────────────────────┘
```

**Requirement ARCH-1 (P0).** Provider code never executes in the UI renderer and never receives Node.js capabilities. Rationale in [11-security-and-compliance.md](11-security-and-compliance.md) §3.

**Requirement ARCH-1b (P0).** The JVM sidecar is subject to every constraint the V8 plugin host is, enforced by OS-level sandboxing and class-loader denial rather than by V8 isolate limits — Java's `SecurityManager` is deprecated and disabled (JEP 411/486), so no design may assume it. Mechanism mapping in [31](31-cs3-dropin-compatibility.md) §6.

**Requirement ARCH-2 (P0).** All IPC crosses a typed, allow-listed `contextBridge` surface. No `remote`, no `nodeIntegration`, no wildcard channel names.

**Requirement ARCH-3 (P0).** A plugin-host crash degrades to "provider unavailable", never to application termination.

---

## B2. Subsystem specifications

Each subsystem below is specified as: responsibility · inputs · outputs · dependencies · lifecycle · errors · security boundary · platform differences · testing.

### B2.1 StorageService

- **Responsibility.** Sole owner of persisted user state. Implements the canonical model in [06-data-models.md](06-data-models.md).
- **Inputs.** Typed mutations from main-process services (never directly from renderer).
- **Outputs.** Query results; change events for reactive UI.
- **Dependencies.** Filesystem, app-data directory resolution.
- **Lifecycle.** Opened at app start before any window; flushed and closed on quit; journaled so an interrupted write cannot corrupt state.
- **Errors.** Corrupt store ⇒ load most recent good snapshot, surface a recovery dialog, never silently reset.
- **Security.** Main process only. No path arrives from a renderer without validation.
- **Platform.** Path resolution per [29-platform-compatibility.md](29-platform-compatibility.md) §2.
- **Testing.** Crash-during-write; concurrent mutation; 50k-record load; corruption recovery.

**Implementation note (ADR-1, [15](15-upgrade-and-modernization.md)).** SQLite (better-sqlite3) for indexed collections + a JSON document for settings. Android's flat key/value model is a constraint of `SharedPreferences`, not a product requirement; the migration layer translates between the two.

### B2.2 MigrationService

- **Responsibility.** Detect, validate, transform, stage, and commit imports; produce exports.
- **Inputs.** A file path chosen through a native dialog, plus user-selected scope.
- **Outputs.** A migration report (imported / transformed / skipped / unsupported / conflicted, itemized).
- **Dependencies.** StorageService, filesystem, path-portability rules ([18](18-technical-reference.md) §5).
- **Lifecycle.** Read-only analysis → preview → pre-import snapshot → staged write → atomic commit or full rollback.
- **Errors.** Any failure rolls back to the pre-import snapshot. Partial commits are not permitted.
- **Security.** Import files are untrusted input: size caps, depth caps, key-count caps, no path escape, no code execution.
- **Testing.** All of [30-migration-test-cases.md](30-migration-test-cases.md).

**This subsystem is built in Phase 4, before the UI is finished.** It defines the canonical model.

### B2.3 NetworkService

- **Responsibility.** All outbound HTTP. Broker for plugin-host requests.
- **Inputs.** Request descriptors (URL, method, headers, body, timeout, cache policy).
- **Outputs.** Responses, with the same caching semantics as `NiceHttp`'s `cacheTime`/`cacheUnit`.
- **Requirements.** Per-provider cookie jars; configurable DoH ([FEAT-NET-2](03-feature-specifications.md)); jsDelivr rewrite for `raw.githubusercontent.com`; per-request timeouts honoring `MainAPI` timeout fields; redirect control; rate limiting; retry with backoff.
- **Security.** Plugin-host requests pass through the broker, which applies allow/deny policy and strips privileged headers. No plugin gets a raw socket.
- **Platform.** Proxy resolution differs per OS ([29](29-platform-compatibility.md) §6).

### B2.4 PluginHost

- **Responsibility.** Execute provider code under isolation; expose the `MainAPI`-equivalent contract.
- **Inputs.** Provider operation calls (`getMainPage`, `search`, `load`, `loadLinks`, …).
- **Outputs.** Typed responses matching [07-apis-and-contracts.md](07-apis-and-contracts.md) §3.
- **Lifecycle.** Spawn on first use → warm pool → idle eviction → forced kill on timeout.
- **Errors.** Timeout, crash, and malformed response are all recoverable and attributed to the specific provider.
- **Security.** The critical boundary. Full model in [27](27-plugin-and-extension-architecture.md) §7.

### B2.4b JvmSidecar (Runtime 3 — `.cs3` drop-in)

- **Responsibility.** Execute unmodified `.cs3` plugins from the existing Android ecosystem. Full specification in [31-cs3-dropin-compatibility.md](31-cs3-dropin-compatibility.md).
- **Inputs.** The same provider operation calls as B2.4, over typed JSON-RPC.
- **Outputs.** The same typed responses as B2.4. **Callers cannot tell which runtime served a request** — that is the point of the adapter boundary.
- **Dependencies.** A bundled `jlink`-minimized JRE 17; upstream's `library-jvm.jar`; `cs3-app-shim.jar` (22 `:app` types); `cs3-android-shim.jar` (5 core `android.*` stubs); a DEX→`.class` translator; the offscreen `BrowserWindow` bridge for `WebViewResolver`.
- **Lifecycle.** Spawned lazily on first `.cs3` provider use, so it stays out of the PERF-1 cold-start budget (DSK-57). Idle-evicted. Force-killed on timeout. A quarantined plugin may be given its own sidecar process.
- **Errors.** Translation failure, unimplemented `android.*` API, timeout, OOM, and crash are each distinct, attributable, reportable outcomes — never a bare stack trace and never a silent empty result (AC-D5).
- **Security.** The critical boundary, and the one most likely to be got wrong: it hosts translated third-party Android bytecode. ARCH-1b; [31](31-cs3-dropin-compatibility.md) §6.
- **Platform.** Windows is the P0 target; the sandbox uses an AppContainer/job-object restricted token. macOS and Linux need equivalent mechanisms (sandbox-exec, seccomp/namespaces) before those platforms ship — see [29](29-platform-compatibility.md) §1.
- **Testing.** TC-D1..TC-D12 in [30](30-migration-test-cases.md); differential testing against Android output (AC-D7).

### B2.5 MediaService and playback

Specified in full in [28-media-playback-requirements.md](28-media-playback-requirements.md). Architectural requirement here: playback is behind an `IPlayer`-equivalent interface with at least two backends — Chromium `<video>`/MSE, and an embedded native player (mpv or libVLC) — selectable per-source and per-user-preference.

### B2.6 DownloadService

Owns the queue, concurrency limits (mapping `download_parallel_key` and `download_concurrent_key`), segmented HTTP downloads, HLS/DASH segment fetch and remux, pause/resume/cancel/retry, disk-space checks, and duplicate detection. Detail in [18](18-technical-reference.md) §4.

### B2.7 UpdateService

Auto-update over a signed channel, with stable and prerelease tracks mirroring Android's product flavors. Detail in [14-deployment-and-ci.md](14-deployment-and-ci.md) §4.

### B2.8 LogService

Rotating file logs in the platform log directory, in-app log viewer (parity with `show_logcat_key`), crash capture, and redaction of tokens/credentials before anything is written or shared.

---

## B3. Android → Electron mapping table

| Android mechanism | Desktop mechanism | Strategy |
|---|---|---|
| `SharedPreferences` ×2 | SQLite + JSON settings document | Replace with Electron equivalent |
| Jetpack Navigation | Renderer-side router | Replace |
| Fragments + ViewBinding | Component tree | Replace |
| ViewModel + LiveData | Renderer state store | Replace |
| `PathClassLoader` / DEX | JVM sidecar: install-time DEX→`.class` + `URLClassLoader` ([31](31-cs3-dropin-compatibility.md)) | **Drop-in — plugins run unmodified** |
| `MainAPI` / `ExtractorApi` / `M3u8Helper` | Upstream `library-jvm.jar`, linked as-is | **Reused, not reimplemented** |
| `:app` provider-facing types (22) | `cs3-app-shim.jar`, ABI-diffed against upstream in CI | Shim |
| `android.util.Log`, `Base64`, `Context`, `SharedPreferences`, `CookieManager` | `cs3-android-shim.jar` | Shim |
| `WebViewResolver` / `CloudflareKiller` | Offscreen `BrowserWindow` over IPC — upstream's JVM actual is a `TODO` stub | Reimplement natively |
| Plugin app-level privilege (`MANAGE_EXTERNAL_STORAGE`) | **Not granted at any runtime** | Deliberate security divergence |
| ExoPlayer/Media3 | `<video>`/MSE + embedded native player | Reimplement natively |
| `nextlib` FFmpeg decoders | Native player's decoders | Replace |
| `torrServer` (Go, in-process) | Bundled torrent engine as a child process | Replace |
| Google Cast SDK | **Unsupported**; DLNA/FCast as an alternative workflow | Alternative workflow + documented limitation |
| `WorkManager` | Main-process schedulers with persistence | Replace |
| Foreground services + notifications | OS notifications + in-app progress | Desktop-specific UX |
| `SafeFile` / SAF URIs | Native paths + native dialogs | Replace |
| Android intents | Protocol handlers + file associations | Replace |
| `BiometricPrompt` | OS credential/biometric API where available; PIN fallback | Desktop-specific UX |
| `PackageInstaller` (self-update) | `electron-updater` | Replace |
| Conscrypt | Node/Chromium TLS | Not needed |
| Coil image loading | Renderer image pipeline + disk cache | Replace |
| Android TV D-pad layout | Keyboard navigation + optional 10-foot mode | Desktop adaptation |
| `PictureInPicture` | Always-on-top mini-player window | Desktop adaptation |
| Battery-optimization exemption | **Not applicable** | Unsupported, documented |

---

## B4. Cross-cutting architectural requirements

| ID | Requirement | Priority |
|---|---|---|
| ARCH-4 | Every long-running operation is cancellable and reports progress. | P0 |
| ARCH-5 | No renderer receives a filesystem path it did not obtain from a main-process dialog handshake. | P0 |
| ARCH-6 | All persisted writes are atomic (temp file + rename), mirroring the plugin-download pattern at `RepositoryManager.kt:222-236`. | P0 |
| ARCH-7 | The canonical data model is defined once, in the main process, and is the only source of truth. | P0 |
| ARCH-8 | Provider-facing contracts are versioned independently of the app version. | P1 |
| ARCH-9 | The app starts and remains fully usable with no network, exposing local library, downloads, and settings. | P1 |
| ARCH-10 | Feature flags gate experimental subsystems (torrent, native player backend, plugin strategies). | P2 |

---

## Next steps

1. Ratify the process topology in B1 — it is the security foundation and is expensive to retrofit.
2. Prototype the PluginHost boundary in Phase 1 to de-risk RISK-1, and run the DEX→JVM translation spike (OQ-27) to de-risk RISK-D1. The second gates whether B2.4b exists at all.
3. Confirm ADR-1 (SQLite + JSON) against the dataset sizes in [12-performance-and-limits.md](12-performance-and-limits.md).
4. Produce interface definitions for B2.1–B2.8 as the Phase 2/3 deliverable.
