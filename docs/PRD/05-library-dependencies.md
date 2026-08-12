# 05 — Library and Dependency Analysis

**Generated:** 2026-08-10
**Baseline:** commit `a72f9e6c`; version catalogue at `gradle/libs.versions.toml`

Complete inventory of the Android dependency set, each mapped to a desktop strategy and a license note. **License compliance is not optional** — the source project is GPL-3.0 and several dependencies carry their own obligations.

---

## 1. Build toolchain

| Item | Version | Note |
|---|---|---|
| Android Gradle Plugin | 9.1.1 | — |
| Kotlin | 2.4.0 | — |
| JVM target | 1.8 | Constrains library choices; the reason Coil is pinned |
| JDK toolchain | 17 | Build-time only |
| minSdk / targetSdk / compileSdk | 23 / 36 / 37 | minSdk 23 is why Jackson and Rhino are pinned to old versions |
| versionCode / versionName | 68 / 4.8.0 | The migration baseline |

**Insight.** Several pins exist purely because of Android's minSdk 23 constraint — `jackson-module-kotlin` at 2.13.1 ("Later versions don't support minSdk <26 (Crashes on Android TV's and FireSticks)"), `rhino` at 1.8.1 ("Requires minSdk 26 or later beginning at version 1.9.0"), `conscrypt-android` at 2.5.2 ("2.5.3 crashes everything"), `coil` at 3.3.0 ("Later versions require jvmTarget 11 or later"). **None of these constraints apply to desktop.** A desktop port should not inherit them.

**Evidence.** `gradle/libs.versions.toml:1-66`; `app/build.gradle.kts:104-108`. **Confidence: High.**

---

## 2. Media stack

| Dependency | Version | Purpose | Desktop strategy | License |
|---|---|---|---|---|
| `androidx.media3` (exoplayer, hls, dash, ui, session, cast, common, container, datasource-okhttp, datasource-cronet) | 1.9.3 | Core playback | **Replace.** Chromium `<video>`/MSE + an embedded native player (mpv or libVLC). See [28](28-media-playback-requirements.md) | Apache-2.0 |
| `nextlib-media3ext`, `nextlib-mediainfo` | 1.9.3-0.12.0 | FFmpeg software decoders + media info | **Replace** with the native player's decoders, or bundled FFmpeg | LGPL/GPL — **FFmpeg licensing must be reviewed**; GPL builds impose obligations |
| `previewseekbar-media3` | 1.1.1.0 | Seekbar thumbnail preview | Reimplement (FEAT-PLAY-11) | Apache-2.0 |
| `torrentserver` (recloudstream fork) | commit `7861970` | In-process Go torrent server | **Replace** with a bundled torrent engine as a child process | Verify — fork of a Go project |
| `com.google.android.mediahome:video` | 1.0.0 | Android TV media home integration | **Unsupported** | Apache-2.0 |
| `media3-cast` | 1.9.3 | Chromecast | **Unsupported** (FEAT-CAST-1) | Apache-2.0 |
| `juniversalchardet` | 2.5.0 | Subtitle charset detection | Replace with an equivalent detector — **required**, not optional | MPL/GPL/LGPL tri-license |
| `colorpicker` (recloudstream fork) | commit `6b46b49` | Subtitle color picker | Native color input | Verify |

**Critical note.** FFmpeg is the practical answer to the desktop codec gap, and FFmpeg's licensing (LGPL-2.1+ by default, GPL when built with certain components) interacts with GPL-3.0 in ways that need legal sign-off before packaging. See [11](11-security-and-compliance.md) §6.

**Confidence: High** for the inventory; **Medium** for individual license identifications, which require formal verification.

---

## 3. Networking & Downloads

| Dependency | Version | Purpose | Desktop strategy | License |
|---|---|---|---|---|
| `nicehttp` (Blatzar) | 0.4.18 | HTTP wrapper over OkHttp; the API providers actually call | **Reimplement.** This is part of the provider-facing surface — the desktop plugin API must offer an equivalent shape | Verify |
| `aria2` (`aria2c`) | 1.37.0+ | Multi-connection & multi-protocol download engine (HTTP/BitTorrent) | **Embedded Binary Utility.** Electron Main Process manages daemon over loopback JSON-RPC (`UTIL-17`) | GPL-2.0 |
| `yt-dlp` | Latest | Secondary link extraction fallback & universal URL parsing adapter | **Embedded Executable Adapter.** Wrapped inside `YtDlpExtractorAdapter` (`UTIL-18`) for metadata extraction only | Unlicense / Public Domain |
| `conscrypt-android` | 2.5.2 | TLS fix for Android 9 | **Not needed** | Apache-2.0 |
| `ktor-http` | 3.5.0 | HTTP primitives in `:library` | Node equivalents | Apache-2.0 |
| `okhttp` | transitive | Underlying client | Node HTTP stack | Apache-2.0 |

---

## 4. Parsing and serialization

| Dependency | Version | Purpose | Desktop strategy | License |
|---|---|---|---|---|
| `jsoup` | 1.22.1 | HTML parsing (JVM) | **Reimplement** in the plugin API — providers depend on a jsoup-shaped API for scraping | MIT |
| `ksoup` | 0.2.6 | KMP HTML parser | Same note | Apache-2.0 |
| `jackson-module-kotlin` | 2.13.1 (pinned) | JSON | Native JSON + a schema layer | Apache-2.0 |
| `kotlinx-serialization-json` | 1.11.0 | JSON (migration target) | Same | Apache-2.0 |
| `org.json:json` | 20260522 | Test-only | — | JSON License |
| `gson` | 2.11.0 | Deprecated, retained for extension compatibility | Note in the plugin-API compatibility list | Apache-2.0 |

**Insight.** jsoup/ksoup, nicehttp, gson, and fuzzywuzzy are all **provider-facing**. A desktop plugin API that omits equivalents will break ports even if the app itself works. This materially shapes [27](27-plugin-and-extension-architecture.md).

---

## 5. Scripting and crypto

| Dependency | Version | Purpose | Desktop strategy | License |
|---|---|---|---|---|
| `rhino` | 1.8.1 (pinned) | JS execution for extraction | Native JS **inside the sandbox** (UTIL-9) | MPL-2.0 |
| `zipline` | 1.27.0 | Declared; **unreferenced in source** | Signal of upstream's Kotlin/JS direction | Apache-2.0 |
| `cryptography-core`, `cryptography-provider-optimal` | 0.6.0 | KMP crypto (replaced `javax` in `#2813`) | Node `crypto` / WebCrypto | Apache-2.0 |

---

## 6. Android framework and UI (all replaced)

`core-ktx`, `activity-ktx`, `appcompat`, `fragment-ktx`, `annotation`, lifecycle bundle, navigation bundle, `preference-ktx`, `material`, `constraintlayout`, `databinding/viewbinding`, `palette-ktx`, `tvprovider`, `shimmer`, `overlappingpanels`, `biometric`, `qrcode-kotlin`, `work-runtime-ktx`, `coil` bundle, `safefile`.

All are Android-platform bindings with **no desktop equivalent needed** — the desktop UI layer replaces them wholesale. Three deserve individual notes:

| Dependency | Note |
|---|---|
| `safefile` (LagradOst) | Exists solely to work around Android's Storage Access Framework. Its absence on desktop is a **simplification**, not a gap. |
| `qrcode-kotlin` | Used for PIN auth on TV. A desktop equivalent is worthwhile for 10-foot mode. |
| `work-runtime-ktx` | Backs `SubscriptionWorkManager` (6 h) and `BackupWorkManager`. Desktop needs a persistent scheduler that survives restarts, including missed-run catch-up. |

---

## 7. Content and data

| Dependency | Version | Purpose | Desktop strategy |
|---|---|---|---|
| `anime-db` (recloudstream) | 1.0.2 | Filler-episode data | Same dataset via HTTP or a bundled snapshot |
| `newpipeextractor` | v0.26.3 | YouTube trailer extraction | **Requires a desktop solution.** No direct JS port; options are a JVM sidecar, `yt-dlp` as an optional external binary, or dropping trailers (FEAT-RESULT-7) |
| `desugar_jdk_libs_nio` | 2.1.5 | Java 8 desugaring for NewPipe | Not needed |

**Note on NewPipeExtractor.** It is GPL-3.0 and Java-only. Trailers are a P2 feature; if no clean desktop path exists, it is an acceptable documented limitation rather than a blocker.

---

## 8. Testing

| Dependency | Version | Purpose |
|---|---|---|
| `junit` 4.13.2, `kotlin-test`, `kotlinx-coroutines-test` | — | Unit tests |
| `espresso-core` 3.7.0, `ext-junit`, `junit-ktx`, `androidx.test:core` | — | Instrumented UI tests |
| `instancio-core` 5.6.0 | — | Test data generation — used for serialization round-trip testing |

**Insight.** The presence of Instancio plus a `@SkipSerializationTest` annotation (seen at `DownloadObjects.kt:165`) indicates upstream **property-tests serialization round-trips**. The desktop project should adopt the same discipline for the migration layer; it is exactly the right tool for validating the import/export contract.

**Evidence.** `app/build.gradle.kts:212-219`; `app/.../utils/downloader/DownloadObjects.kt:164-165`; `app/src/test/java/`, `app/src/androidTest/java/`. **Confidence: High** for the dependency; **Medium** for the inferred testing intent.

---

## 9. Proposed desktop dependency set

Indicative, not prescriptive. Final selection belongs to the implementing team.

| Concern | Candidate | Rationale |
|---|---|---|
| Shell | Electron (current stable) | Mandated by the brief |
| Language | TypeScript, `strict` | The data contracts here are intricate; types prevent whole classes of migration bugs |
| Storage | `better-sqlite3` + a JSON settings document | Synchronous, transactional, no server; suits main-process ownership (ADR-1) |
| HTTP | `undici` | Modern, controllable, good proxy/redirect handling |
| HTML parsing | `cheerio` (jsoup-shaped) or `linkedom` | Provider-facing; jsoup familiarity matters |
| Playback (primary) | Chromium `<video>` + `hls.js` / `dash.js` | Zero extra binary weight for common cases |
| Playback (fallback) | `mpv` via libmpv, or libVLC | Closes the codec, ASS, and bitmap-subtitle gaps |
| Torrent | `webtorrent` (JS) or a bundled native engine | JS is simpler to ship; native is faster and more complete |
| Packaging | `electron-builder` | NSIS/MSI, DMG, AppImage/deb/rpm, plus update feeds |
| Updates | `electron-updater` | Matches FEAT-UPD-1/2 |
| Secrets | `keytar`-equivalent / OS keychain APIs | FEAT-SYNC-1 improvement over Android |
| Logging | `pino` + rotation | FEAT-DIAG-1 |
| Testing | `vitest` + Playwright | Unit + end-to-end |

---

## 10. License obligations summary

| Obligation | Source | Action |
|---|---|---|
| **GPL-3.0 copyleft** | CloudStream itself | Any derivative — including one that reuses its data formats, string catalogue, or assets — must be GPL-3.0 and ship complete corresponding source. See [11](11-security-and-compliance.md) §6. |
| MPL-2.0 file-level copyleft | Rhino | Only if Rhino source is reused; unlikely on desktop |
| FFmpeg LGPL/GPL | If bundled for decoding | **Requires legal review.** Determines whether dynamic linking and a written offer suffice |
| Apache-2.0 attribution | Most AndroidX/Kotlin libs | Only relevant if any code is reused |
| Fork provenance | `torrentserver`, `colorpicker`, `safefile`, `anime-db` (recloudstream/LagradOst forks) | Verify upstream licenses individually — forks can carry unclear terms |
| Trademark / branding | "CloudStream" name and icons | A rename may be required for a redistributed fork; **not covered by GPL** |
| Translation catalogue | Weblate-managed strings | Contributor licensing must be confirmed before reuse |

**Confidence: High** that these obligations exist; **Medium** on their precise application — this needs a lawyer, not an architect.

---

## Next steps

1. Produce a formal SBOM for the desktop dependency set at Phase 2.
2. Obtain legal sign-off on FFmpeg bundling and GPL-3.0 derivative status **before** packaging work starts (Phase 13).
3. Verify the licenses of the four recloudstream/LagradOst forks individually.
4. Decide the NewPipeExtractor question (trailers) — reimplement, sidecar, or document as unsupported.
5. Freeze the provider-facing library surface (jsoup/nicehttp/gson/fuzzywuzzy equivalents) as input to [27](27-plugin-and-extension-architecture.md).
