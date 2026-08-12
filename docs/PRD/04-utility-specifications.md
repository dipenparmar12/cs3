# 04 — Utility Specifications

**Generated:** 2026-08-10
**Baseline:** commit `a72f9e6c`

Cross-cutting utilities that features depend on. Each must exist on desktop with equivalent behavior, because feature correctness depends on them. Several are subtly load-bearing — `UTIL-1` in particular determines whether migration works at all.

---

## UTIL-1 — Java-compatible string hash

**Purpose.** Derive stable content identity.

**Android behavior.** `String.hashCode()` — the JVM's `s[0]*31^(n-1) + s[1]*31^(n-2) + … + s[n-1]`, computed in 32-bit signed arithmetic with wraparound. Used for:
- **Content identity:** `LoadResponse.getId()` → `url.replace(mainUrl,"").replace("/","").hashCode()`
- **Plugin file naming:** `getPluginSanitizedFileName(name)` → `sanitizeFilename(name, true) + "." + name.hashCode()`
- **Deep-link player identity:** `LinkGenerator(..., id = url.hashCode())`
- **Download link identity:** `DownloadedFileInfo.linkHash`
- **`ExtractorLink.hashCode()`** → delegates to `this.data.hashCode()`

**Desktop requirement (P0).** A JavaScript implementation producing **bit-identical** results for all inputs, including non-BMP characters (Java iterates UTF-16 code units, so surrogate pairs contribute two units — a naive `for…of` over code points is wrong). Use `Math.imul(31, h) + charCodeAt(i) | 0` semantics. The result is a signed 32-bit integer and must be stored and compared as such.

**Acceptance.** Property-tested against a JVM-generated vector file covering ASCII, empty string, Unicode BMP, surrogate pairs, and strings long enough to overflow repeatedly ([30](30-migration-test-cases.md) TC-14).

**Evidence.** `app/.../ui/result/ResultViewModel2.kt:370-380`; `app/.../plugins/PluginManager.kt:737-742`; `app/.../MainActivity.kt:362-368`; `app/.../utils/downloader/DownloadObjects.kt:161`; `library/.../utils/ExtractorApi.kt:923`. **Confidence: High.**

**Risk.** Getting this wrong produces an import that appears to succeed and silently orphans every record. It is the highest-leverage 20 lines in the project.

---

## UTIL-2 — JSON serialization compatibility

**Purpose.** Read and write the same JSON shapes Android reads and writes.

**Android behavior.** Historically Jackson (`jackson-module-kotlin`, pinned to 2.13.1 for minSdk reasons); since mid-2026 progressively migrated to kotlinx.serialization. Models carry **both** `@JsonProperty` and `@SerialName` with identical names, so the wire format is unchanged by the migration. `DataStore.setKey` writes `value.toJsonLiteral()`; `getKey` parses it back.

**Desktop requirement (P0).**
- Unknown fields must be ignored on read, never fatal (Android tolerates them via `parsedSafe`/lenient parsing).
- Absent optional fields take the documented defaults, not `undefined`.
- Enums serialize by **name** for `TvType`/`DubStatus`-style fields but by **ordinal** where Android stores ordinals (`result_dub`, `library_sorting_mode`, `results_sorting_mode`, `resize_mode`). The distinction is per-field and is catalogued in [06](06-data-models.md) §5.
- A `WriteOnlySerializer` pattern exists upstream to suppress the deprecated `rating` field on write while still accepting it on read. Desktop must replicate: **accept `rating` on read, convert to `score`, never emit `rating`.**

**Evidence.** `gradle/libs.versions.toml:25`; `app/.../utils/DataStore.kt:173-190`; `app/.../utils/DataStoreHelper.kt:291-305, 343-346, 404-407, 465-468`; `app/.../utils/serializers/WriteOnlySerializer` (referenced at `DataStoreHelper.kt:35`); `library/.../utils/serializers/`. **Confidence: High.**

---

## UTIL-3 — Score model

**Purpose.** Represent ratings consistently after an upstream scoring-system change.

**Android behavior.** A `Score` type with `Score.fromOld(int)` converting the legacy 0–10000 integer `rating` into the new representation. The legacy field is marked `DeprecationLevel.ERROR` and is write-only on deserialization.

**Desktop requirement (P1).** Implement `Score` with the same conversion. **Backups from older Android versions will contain `rating`, not `score`** — the importer must apply `fromOld` rather than dropping the field. Emitting `rating` in exports is forbidden.

**Evidence.** `library/.../MainAPI.kt` (`Score`, imported at `DataStoreHelper.kt:20`); `app/.../utils/DataStoreHelper.kt:291-305`; `app/.../utils/downloader/DownloadObjects.kt:91-107`. **Confidence: High.**

---

## UTIL-4 — Position/duration normalization (`fixVisual`)

**Purpose.** Snap watch progress to sensible visual boundaries.

**Android behavior.** Given `PosDur(position, duration)`:
- `duration <= 0` → `PosDur(0, duration)`
- percentage ≤ 1 → `PosDur(0, duration)`
- percentage ≤ 5 → `PosDur(5·duration/100, duration)`
- percentage ≥ 95 → `PosDur(duration, duration)`
- otherwise unchanged

A parallel pair of helpers exists on `ResultEpisode`: `getRealPosition()` returns 0 outside the 5–95% band; `getDisplayPosition()` applies the same snapping as `fixVisual`.

Additionally, **`setViewPos` refuses to write when `duration < 30_000` ms.**

**Desktop requirement (P0).** Reproduce all thresholds exactly, including the 30-second write guard. These are user-visible: they determine whether a title shows as "not started", "in progress", or "finished".

**Evidence.** `app/.../utils/DataStoreHelper.kt:249-258, 691-695`; `app/.../ui/result/ResultFragment.kt:67-81`. **Confidence: High.**

---

## UTIL-5 — Filename sanitization

**Purpose.** Convert arbitrary titles into filesystem-safe names for downloads and plugin files.

**Android behavior.** `sanitizeFilename(name, allowDot)` used for plugin paths and download filenames; the plugin variant appends `"." + name.hashCode()` to guarantee uniqueness.

**Desktop requirement (P0).** Must additionally handle Windows-specific constraints Android does not face:
- Reserved device names (`CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`), including with extensions.
- Trailing dots and spaces (silently stripped by Windows).
- Reserved characters `< > : " / \ | ? *`.
- The 260-character `MAX_PATH` default, and the long-path opt-in.
- Case-insensitive collisions on Windows/macOS that are distinct on Linux.

**Requirement.** Sanitization must be **deterministic and identical across platforms** so a download directory is portable. Full rules in [18](18-technical-reference.md) §5.

**Evidence.** `app/.../plugins/PluginManager.kt:737-742`; `app/.../utils/downloader/DownloadFileManagement.kt`. **Confidence: High** for Android behavior, **High** for the desktop constraints (platform facts).

---

## UTIL-6 — Safe execution wrappers

**Android behavior.** `safe {}`, `safeAsync {}`, `ioSafe {}`, `logError()` in `mvvm/` wrap operations so a provider throwing never crashes the app. Used pervasively — `RepositoryManager`, `PluginManager`, `BackupUtils`, and all provider calls.

**Desktop requirement (P0).** Equivalent wrappers, with the additional requirement that failures are **attributed to the responsible provider** and surfaced in the UI rather than only logged. Android's tolerance for silent failure is a known usability weakness; desktop should improve on it without changing behavior.

**Evidence.** `library/.../mvvm/`, `app/.../mvvm/`; usage at `RepositoryManager.kt:143, 162, 199, 276`; `BackupUtils.kt:200, 255`. **Confidence: High.**

---

## UTIL-7 — Subtitle language helper

**Android behavior.** `SubtitleHelper` in `:library` maps IETF BCP 47 tags to display names, with `expect/actual` platform implementations (`SubtitleHelperPlatform.kt` in `commonMain`, `jvmMain`, `webMain`). Referenced by `MainAPI.lang` documentation.

**Desktop requirement (P1).** Same tag set and same display names, so `subs_auto_select`, `subs_auto_download`, and `provider_lang_key` values imported from Android resolve identically. Note that a `webMain` actual **already exists upstream** — useful as a reference implementation.

**Evidence.** `library/.../utils/SubtitleHelper.kt`, `SubtitleHelperPlatform.kt`; `library/src/webMain/.../SubtitleHelperPlatform.web.kt`; `library/src/jvmMain/.../SubtitleHelperPlatform.jvm.kt`; `library/.../MainAPI.kt:536-546`. **Confidence: High.**

---

## UTIL-8 — HLS/M3U8 and DASH parsing

**Android behavior.** `M3u8Helper` and `HlsPlaylistParser` in `:library` `commonMain` parse master and media playlists for quality enumeration and download segmentation, independently of ExoPlayer.

**Desktop requirement (P0 for downloads, P1 for playback).** Equivalent parsing is required for the download subsystem regardless of which playback backend is used, since downloading HLS means fetching and remuxing segments rather than a single file.

**Evidence.** `library/.../utils/M3u8Helper.kt`, `HlsPlaylistParser.kt`; `library/.../utils/ExtractorApi.kt:413-458` (type inference from `.m3u8`/`.mpd`). **Confidence: High.**

---

## UTIL-9 — JavaScript execution for extraction

**Android behavior.** Rhino powers `JsInterpreter`, `JsUnpacker` (packed/obfuscated JS), and `JsHunter` in `:library`. Rhino is pinned to 1.8.1 because 1.9.0 requires minSdk 26. Zipline replaced QuickJS in commit `#2256` and is a declared app dependency, but **no Kotlin source references it** at the analyzed commit.

**Desktop requirement (P1).** JS execution is native to the platform, but must run **inside the plugin-host sandbox**, never with Node globals in scope. Untrusted provider-supplied JS with `require`/`process` access is a full compromise.

**Evidence.** `library/.../utils/{JsInterpreter,JsUnpacker,JsHunter}.kt`; `gradle/libs.versions.toml:49,58`; `app/build.gradle.kts:277`; repository-wide grep for `zipline` returns only the dependency declaration. **Confidence: High.**

---

## UTIL-10 — String similarity

**Android behavior.** `Levenshtein.kt` in `:library`, plus `me.xdrop:fuzzywuzzy` in `:app` (explicitly marked deprecated, retained only until extensions migrate away from it). Used for matching titles across providers and trackers.

**Desktop requirement (P2).** Equivalent implementation. Note that `fuzzywuzzy` is part of the **provider-facing surface** — if plugins call it, the desktop plugin API must offer an equivalent or the port will break providers.

**Evidence.** `library/.../utils/Levenshtein.kt`; `app/build.gradle.kts:280-281` and its deprecation comments. **Confidence: High.**

---

## UTIL-11 — URL unshortening

**Android behavior.** `UnshortenUrl.kt` in `:library` resolves shortened links encountered during extraction.

**Desktop requirement (P2).** Same behavior. Must respect redirect limits and never follow redirects to `file://` or loopback addresses — an SSRF consideration that matters more on desktop, where loopback hosts the torrent server.

**Evidence.** `library/.../utils/UnshortenUrl.kt`. **Confidence: High** for existence; **High** for the desktop SSRF concern (platform reasoning).

---

## UTIL-12 — Parallel collection helpers

**Android behavior.** `ParCollections.kt` in `:library` provides `amap` and related parallel operators, used heavily for fan-out (e.g. `RepositoryManager.getRepoPlugins` maps plugin lists in parallel).

**Desktop requirement (P1).** Equivalent concurrency primitives **with a configurable concurrency cap**. Android's unbounded `amap` over many providers is a rate-limiting hazard that desktop should bound.

**Evidence.** `library/.../ParCollections.kt`; usage at `RepositoryManager.kt:185-189`. **Confidence: High.**

---

## UTIL-13 — Image loading and caching

**Android behavior.** Coil 3 (strictly pinned to 3.3.0 for jvmTarget reasons) with an OkHttp network layer, `ImageModuleCoil`/`ImageUtil` wrappers, `PercentageCropImageView`, and Palette for extracting colors from posters.

**Desktop requirement (P1).** An image pipeline with a bounded disk cache, `posterHeaders` support (providers supply per-image HTTP headers — see `SearchResponse.posterHeaders`), lazy loading, and placeholder/error states. Palette-equivalent color extraction is P3.

**Evidence.** `gradle/libs.versions.toml:11`; `app/.../utils/ImageModuleCoil.kt`, `ImageUtil.kt`, `PercentageCropImageView.kt`; `library/.../MainAPI.kt:1406-1523` (`posterHeaders`). **Confidence: High.**

---

## UTIL-14 — Text and UI-string abstraction

**Android behavior.** `UiText` / `txt()` abstract over string resources vs. literals; `UiImage` does the same for drawables vs. URLs. Both appear in persisted models (`Account.image` returns `UiImage`).

**Desktop requirement (P1).** Equivalent abstraction. **`UiImage.Drawable(resourceId)` cannot be persisted portably** — the seven profile avatars must be addressed by index, not by resource id, in any exported format ([06](06-data-models.md) §6).

**Evidence.** `app/.../utils/TextUtil.kt`; `app/.../utils/DataStoreHelper.kt:171-176`. **Confidence: High.**

---

## UTIL-15 — Event bus

**Android behavior.** `Event<T>` (`utils/Event.kt`) plus `MainActivity` companion events (`bookmarksUpdatedEvent`, `reloadLibraryEvent`, `reloadHomeEvent`, `reloadAccountEvent`, `afterPluginsLoadedEvent`) coordinate cross-screen invalidation.

**Desktop requirement (P1).** An equivalent event/subscription mechanism spanning main→renderer. Note that these events cross the process boundary on desktop, so they must be part of the IPC contract ([07](07-apis-and-contracts.md) §4).

**Evidence.** `app/.../utils/Event.kt`; `app/.../MainActivity.kt:270-275`; `app/.../utils/DataStoreHelper.kt:203-208`; `app/.../plugins/PluginManager.kt:566`. **Confidence: High.**

---

## UTIL-16 — Power / wake management

**Android behavior.** `PowerManagerAPI` keeps the screen awake during playback; `battery_optimisation` requests an exemption.

**Desktop requirement (P1).** Use the OS "prevent display sleep" facility during playback and release it on pause/stop. The battery-optimization exemption has no desktop analogue (**R6**).

**Evidence.** `app/.../utils/PowerManagerAPI.kt`; `AndroidManifest.xml:18`; key `battery_optimisation_key`. **Confidence: High.**

---

## UTIL-17 — aria2 Multi-Threaded & Multi-Protocol Download Engine

**Purpose.** High-performance, resilient downloading for media content (progressive HTTP/HTTPS MP4/MKV files and BitTorrent magnet links).

**Android behavior.** Native `VideoDownloadService`, `DownloadManager`, and custom socket stream fetchers with single/multi-stream chunking and `torrentserver` daemon.

**Desktop requirement (P0).** Embedded **`aria2` C++ binary (`aria2c`)** managed by Electron Main Process over secure JSON-RPC (loopback `127.0.0.1` with WebSocket/RPC secret auth token).
- **Multi-Connection Segmented Download:** Multiplies download speeds (up to 16 threads per video file) to bypass CDN per-IP throttling on video hosts.
- **Unified Engine:** Handles both progressive video files (HTTP/HTTPS) and BitTorrent/Magnet links in a single binary.
- **HTTP Header Injection:** Applies per-download `Referer`, `User-Agent`, and Cookie headers (`--header`) supplied by `ExtractorLink` / `MainAPI`.
- **HLS/DASH Pairing:** Combined with `ffmpeg` or `N_m3u8DL-RE` for `.m3u8` segment stitching.
- **Dynamic Control:** Full pause, resume, queue reordering, and global/per-file bandwidth throttling without process restarts.

**Evidence.** `aria2` GitHub repository (`https://github.com/aria2/aria2`); `app/.../utils/downloader/DownloadManager.kt:109-204`. **Confidence: High.**

---

## UTIL-18 — yt-dlp Fallback Extraction & Universal URL Parsing Adapter

**Purpose.** Secondary metadata and media stream extraction fallback utility to boost DX/UX when native provider extractors fail or when users submit direct video page URLs.

**Android behavior.** Extractors strictly inherit `ExtractorApi` Kotlin classes in `:library`.

**Desktop requirement (P2).** Embedded `yt-dlp` executable adapter wrapping the `ExtractorApi` contract (`YtDlpExtractorAdapter`).
- **Fallback Extraction:** If a native `ExtractorApi` script fails or encounters broken obfuscation, `yt-dlp --dump-json <url>` executes as an automated fallback to parse stream URLs, headers (`Referer`/`User-Agent`), formats, and subtitles.
- **Universal URL Paste:** Allows users to paste any video webpage URL into the desktop search bar for instant extraction and playback/download.
- **Strict Decoupling:** `yt-dlp` is used **only for link/metadata extraction**. Actual file downloading is handed off to `DownloadService` (`aria2c` / `HlsDashEngine`), preserving a unified download queue.

**Evidence.** `yt-dlp` GitHub repository (`https://github.com/yt-dlp/yt-dlp`). **Confidence: High.**

---

## Next steps

1. Implement and property-test **UTIL-1** in Phase 1. Nothing else in the migration is trustworthy until it is proven.
2. Build the JVM vector-generation harness alongside it ([30](30-migration-test-cases.md) TC-14).
3. Catalogue every enum whose **ordinal** is persisted (UTIL-2) before writing the importer; see [06](06-data-models.md) §5.
4. Integrate **aria2** (`UTIL-17`) into the main-process IPC download service with `--rpc-secret` token authentication.
5. Implement `YtDlpExtractorAdapter` (`UTIL-18`) as an optional secondary fallback link extractor inside `MediaDownloadResolver`.
