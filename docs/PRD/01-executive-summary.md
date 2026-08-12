# 01 — Executive Summary

**Generated:** 2026-08-10 · **Revised:** 2026-08-12
**Baseline:** CloudStream Android `4.8.0` (versionCode 68), commit `a72f9e6c`

> **What changed on 2026-08-12 (ADR-10).** Two decisions were taken, and they change this document's central conclusion.
>
> 1. **Existing `.cs3` extensions run drop-in.** The desktop app bundles a sandboxed JVM sidecar, translates DEX at install time, and links upstream's own `library-jvm.jar`. The previous assessment — that the app would launch with an empty catalogue and require the whole ecosystem to be ported — was based on a Node/V8-only reading and is withdrawn. **The app has content on day one, with no maintainer action.**
> 2. **Windows-first.** Windows 10/11 x64 is the P0 shipping target; macOS and Linux stay specified but phased.
>
> The residual risk did not disappear, it moved: drop-in depends on DEX→JVM translation surviving Kotlin coroutine state machines, which is **untested** and which every provider depends on. That spike (OQ-2a/OQ-27) is the first thing the project should fund. See [31-cs3-dropin-compatibility.md](31-cs3-dropin-compatibility.md).

---

## 1. The product being migrated

CloudStream is a GPL-3.0 Android application for discovering and streaming video content. It ships with **no content of its own**. Its entire catalogue comes from user-installed extensions ("providers") distributed as `.cs3` plugin files through user-added repository URLs.

Functionally it is four products fused into one:

1. **An extensible content aggregator.** Providers implement a documented Kotlin API (`MainAPI`) exposing homepage, search, detail, and link-resolution operations.
2. **A media player.** A heavily customized ExoPlayer/Media3 stack with software fallback decoding, six subtitle formats, per-source quality profiles, gesture control, PiP, and a bundled torrent streaming server.
3. **A personal media library.** Bookmarks with watch states, favourites, subscriptions with new-episode notifications, per-episode watch progress, resume-watching, search history — all scoped to a local multi-profile account system.
4. **A tracker sync client.** Two-way integration with MyAnimeList, AniList, Kitsu, and Simkl, plus four subtitle providers and three intro/outro skip services.

It runs on phones, tablets, and Android TV, with a distinct TV layout and a full D-pad/remote interaction model.

**Evidence:** `README.md`; `library/.../MainAPI.kt:494-886`; `app/.../ui/player/` (15,531 lines across 29 files); `app/.../utils/DataStoreHelper.kt:47-60`; `app/.../syncproviders/AccountManager.kt:64-74`; `app/.../ui/settings/Globals.kt:14-16`. **Confidence: High.**

---

## 2. What is being built

An Electron desktop application — **Windows 10/11 first**, with macOS and Linux phased — that delivers the same product behavior, runs the user's **existing extensions unmodified**, and can **import a user's Android backup and let them carry on where they left off**.

Data portability is a release-blocking requirement, not a feature. The desktop application is incomplete if a supported Android export cannot be migrated.

---

## 3. The honest assessment

**Revised 2026-08-12.** This migration is **feasible for the application shell and the user-data layer, tractable for extensions, and hard for playback.**

The original assessment named two subsystems as hard: extensions and playback. Extensions moved. Three facts, each verified against source, did it:

- `:library` **already declares a `jvm()` target** with JVM actuals (`library/build.gradle.kts:23-42`; `library/src/jvmMain/`).
- Upstream's `makeJar` **already merges `library-jvm.jar`** into the classpath providers compile against (`app/build.gradle.kts:305-325`).
- Across all 26 vendored community repositories, **202 of 299 `MainAPI` providers (67.6%) import no `android.*` at all**, and five stubbable classes cover ~93%. The `:app`-side surface is **22 named types**.

The desktop app therefore *links* upstream's provider API rather than reimplementing it. **Playback remains the genuinely hard subsystem.**

### 3.1 What ports cleanly

| Area | Why it is straightforward |
|---|---|
| User data model | Plain JSON in SharedPreferences. No Room database, no binary blobs, no encryption. Every user record is a JSON string under a namespaced key. |
| Settings | Flat primitives with stable, greppable key names — fully enumerated in [18-technical-reference.md](18-technical-reference.md) §2. |
| Library, bookmarks, favourites, subscriptions, history, resume state | Pure data, no platform coupling beyond the ID hash. |
| Tracker sync (MAL/AniList/Kitsu/Simkl) | Standard OAuth + REST over HTTPS; no Android dependency. |
| Subtitle providers | Standard REST. |
| Home / search / detail UI | Behavior is well-defined and platform-neutral; only the presentation layer changes. |

### 3.2 What does not port

| Area | The problem |
|---|---|
| ~~**Extensions (`.cs3`)**~~ | **Resolved by ADR-10.** DEX cannot execute in Chromium or Node.js — but it does on a bundled JVM sidecar after install-time translation. Existing plugins run unmodified ([31](31-cs3-dropin-compatibility.md)). **What does not port:** plugin *privileges* (Android grants `MANAGE_EXTERNAL_STORAGE`; desktop grants nothing), Android-View settings UI (~2.7% of providers, degrades settings only), and native `.so` dependencies. **Unproven:** translation of Kotlin coroutine state machines (RISK-D1). |
| **Playback stack** | ExoPlayer/Media3 with `nextlib` FFmpeg software decoders, a custom Matroska extractor (3,242 lines), and a custom subtitle decoder factory. Chromium's `<video>` element supports a materially narrower codec and container set. |
| **Torrent streaming** | A Go-based torrent server (`torrServer`) started in-process on `127.0.0.1`. Needs a full desktop replacement. |
| **Chromecast** | Google Cast SDK is Android/iOS/Web-app only; no Electron-native equivalent. |
| **Downloaded content** | Excluded from backups by design; not migratable. |

**Evidence:** `app/.../plugins/PluginManager.kt:611`; `gradle/libs.versions.toml:43,51,57`; `app/.../ui/player/UpdatedMatroskaExtractor.kt`; `app/.../ui/player/Torrent.kt:206-210`; `app/.../utils/BackupUtils.kt:90-109`. **Confidence: High.**

---

## 4. The strategic question that must be answered first

**Upstream CloudStream is already building a cross-platform desktop version — using Kotlin Multiplatform and Compose Multiplatform, not Electron.**

`COMPOSE.md` is unambiguous: the project is migrating from MVVM to MVI specifically "to make CloudStream cross platform, as it allows us to decouple UI and logic," and mandates that all new code use KMP-compatible libraries only. The evidence of execution is substantial:

- `:library` is a Kotlin Multiplatform module with `commonMain` (146 files), `jvmMain`, `androidMain`, and a populated **`webMain`** source set (`library/build.gradle.kts:20-88`, `library/src/webMain/`).
- Across June–July 2026, roughly 25 subsystems were migrated from Jackson to kotlinx.serialization — a hard prerequisite for non-JVM targets.
- QuickJS was replaced with **Zipline**, Cash App's Kotlin/JS-over-QuickJS runtime (commit `#2256`, 2025-12-24), and `zipline` is a declared app dependency (`app/build.gradle.kts:277`).
- Crypto moved from `javax` to `cryptography-kotlin` (`#2813`); date handling moved to `kotlinx-datetime` (`#2798`).

An Electron rewrite duplicates this effort in a different language, forks the extension ecosystem, and inherits none of upstream's ongoing provider maintenance.

**Revised 2026-08-12 — ADR-10 answers most of that objection, though not all of it.** The "forks the ecosystem" and "inherits none of upstream's maintenance" arguments were the strongest case against Electron, and drop-in largely dissolves them: Runtime 3 **consumes upstream's `library-jvm.jar` as a dependency**, so upstream's provider-API work flows straight into the desktop app, and existing plugins run unmodified rather than being reimplemented. Runtime 2 (KMP/JS) is positioned to absorb upstream's cross-platform work as it lands.

What remains genuinely duplicated is the **UI and application layer** — and that is a rewrite under either option, since upstream has no desktop UI to contribute to yet. The residual strategic question is whether to eventually contribute that layer upstream instead of maintaining it separately. Not blocking; revisit when upstream's Compose Desktop target is real. See [21](21-open-issues-and-assumptions.md) OQ-1.

**Evidence:** `COMPOSE.md` (whole file); `library/build.gradle.kts`; `git log` commits `#2256`, `#2251`, `#2813`, `#2798`, `#3072`. **Confidence: High.**

---

## 5. Plugin runtime — decided (ADR-10, 2026-08-12)

**All three runtimes are funded, behind one adapter boundary. Runtime 3 is P0 because it is what makes the app non-empty at launch.**

| Runtime | Engine | Ecosystem | Role |
|---|---|---|---|
| **3. CS3 Drop-In** | Bundled JVM sidecar; install-time DEX→`.class`; links upstream's `library-jvm.jar` | **The existing ecosystem, unmodified** — 303 plugin classes across 26 repositories | **P0.** Day-one content, zero maintainer action |
| **2. KMP/JS** | V8 isolate | Kotlin maintainers wanting one source for Android and desktop | P1. Tracks upstream's cross-platform direction |
| **1. TypeScript SDK** | V8 isolate | New authors | P1. Fastest iteration |

Drop-in is the **on-ramp, not the destination**: Runtime 3 is supported indefinitely and expected to shrink as providers migrate to 1 and 2 via `cli migrate`.

**The prior recommendation was Strategy C (TypeScript only), with the JVM sidecar as "a possible later addition."** The evidence in [31](31-cs3-dropin-compatibility.md) §2 inverted that ordering. The adapter boundary from that recommendation is retained and is exactly what makes serving three runtimes tractable.

**One piece of the old advice still stands, and should be honored literally:** do not promise `.cs3` compatibility in any public communication until it is proven against the real corpus. The Phase 1 spike (OQ-2a) is that proof. Until it passes, drop-in is a plan, not a feature.

---

## 6. Data portability — the contract

| Direction | Supported? | Notes |
|---|---|---|
| Android → Desktop | **Yes, mandatory** | Parse `CS3_Backup_*.txt`; apply the key grammar; transform paths and platform-specific values. |
| Desktop → Desktop | **Yes, mandatory** | Native format, versioned. |
| Desktop → Android | **Yes, best-effort** | Emit a byte-compatible legacy backup file. Android's restore is a blind key/value merge with no validation, so this works — but Android silently drops nothing and blindly accepts everything, which makes correctness entirely the desktop app's responsibility. |
| Downloads | **No** | Excluded from Android backups by design. |
| Credentials / tokens | **No** | Deliberately stripped from Android backups. Users re-authenticate. |
| Installed plugins | **Metadata only** | Plugin binaries are never backed up; repository URLs are. |

The desktop app must never silently discard a field. Anything it cannot map is reported in a migration summary the user can inspect.

**Evidence:** `app/.../utils/BackupUtils.kt:55-118, 169-198, 306-317`. **Confidence: High.**

---

## 7. Effort and sequencing

Detailed in [16-implementation-plan.md](16-implementation-plan.md). Summarized:

| Phase group | Content | Relative weight |
|---|---|---|
| Foundation (P1–P4) | Electron shell, storage, canonical data model, **migration subsystem** | 20% |
| Core product (P5–P7) | Navigation, home/search/detail, playback | 30% |
| Ecosystem (P8–P9) | Downloads, plugin runtime | 25% |
| Completion (P10–P16) | Settings, export, packaging, hardening, performance, parity validation | 25% |

The migration subsystem is scheduled **early, not late**. It defines the canonical data model, and building it last is how migration projects end up with two incompatible data models.

---

## 8. Top risks

| ID | Risk | Impact | Mitigation |
|---|---|---|---|
| RISK-1 | No plugin runtime ⇒ no content ⇒ no product | Fatal | **Mitigated by ADR-10** — Runtime 3 delivers the existing ecosystem on day one. Residual risk moved to RISK-D1 |
| **RISK-D1** | **DEX→JVM translation fails on Kotlin coroutine state machines. Every provider is coroutine-heavy, so failure is systemic, not long-tail** | **Critical — now the project's top technical risk** | **Phase 1 spike (OQ-2a/OQ-27) against the full vendored corpus, before Phase 2 starts. A negative result returns the project to an empty-catalogue launch and a porting campaign — a different budget the sponsor must be told about immediately** |
| RISK-D3 | Upstream `:app` signature drift breaks every translated plugin at link time | Severe | Automated ABI diff against upstream `master` in CI (DROP-10/11) |
| RISK-D4 | Bundled JRE inflates the installer and trips endpoint-protection heuristics on Windows | Medium | `jlink` minimization; EV signing of every binary including the sidecar; EPP validation pre-release (DROP-31..35) |
| RISK-2 | Codec gap makes real-world streams unplayable in Chromium | Severe | Ship an embedded mpv/libVLC path; validate against a real stream corpus early |
| RISK-3 | `hashCode` mismatch orphans every imported record | Severe | Reproduce Java semantics exactly with `Math.imul`; property-test against JVM output ([30](30-migration-test-cases.md) TC-14) |
| RISK-4 | Ecosystem fork splits provider maintenance | **Reduced by ADR-10** | Runtime 3 runs upstream's artifacts and links upstream's library; engage upstream early regardless |
| RISK-5 | GPL-3.0 obligations mishandled in a packaged Electron app | Legal | See [11-security-and-compliance.md](11-security-and-compliance.md) §6 |
| RISK-6 | Untrusted plugins get Node.js access | Critical security | Non-negotiable sandbox boundary, [11](11-security-and-compliance.md) §3 |
| RISK-7 | Upstream KMP desktop ships first, stranding this work | Strategic | Resolve OQ-1 with the sponsor now |

---

## 9. Definition of done, in one line

The desktop application is complete when a user can install it on Windows; import an Android backup and see their library, history, and settings intact; **install the extensions they already use, unmodified**; search, browse, play with subtitles, resume where they left off, and download; and export data that restores correctly on both desktop and Android — with every unsupported item and every incompatible plugin explicitly reported rather than silently dropped.

Full criteria: [17-acceptance-criteria.md](17-acceptance-criteria.md).

---

## 10. Next steps

1. **Run the DEX→JVM translation spike (OQ-2a/OQ-27) against the full vendored corpus — blocking, and cheap.** Everything below assumes it passes.
2. ~~Resolve OQ-1~~ · ~~Choose a plugin-runtime strategy~~ — **both resolved as ADR-10 on 2026-08-12.**
3. Build the drop-in test corpus ([30](30-migration-test-cases.md) §10b) — needs no volunteers; the repositories are already vendored.
4. Gather a real Android backup corpus ([30](30-migration-test-cases.md) §2) — this one does need volunteers, so start it in parallel.
5. Order the Windows EV code-signing certificate — weeks of lead time (SIGN-1).
6. Ratify [17-acceptance-criteria.md](17-acceptance-criteria.md), including the new AC-D1..AC-D9.
7. Commission legal review of GPL-3.0 redistribution, the **bundled JRE's Classpath Exception** (DROP-32), and provider-ecosystem posture.
