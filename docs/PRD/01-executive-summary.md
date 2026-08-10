# 01 — Executive Summary

**Generated:** 2026-08-10
**Baseline:** CloudStream Android `4.8.0` (versionCode 68), commit `a72f9e6c`

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

A cross-platform Electron desktop application for Windows, macOS, and Linux that delivers the same product behavior, and that can **import a user's Android backup and let them carry on where they left off**.

Data portability is a release-blocking requirement, not a feature. The desktop application is incomplete if a supported Android export cannot be migrated.

---

## 3. The honest assessment

This migration is **feasible for the application shell and the user-data layer, and hard for the two subsystems that carry the product's actual value.**

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
| **Extensions (`.cs3`)** | Android DEX bytecode loaded by `PathClassLoader`. Cannot execute in Chromium or Node.js under any configuration. Without a solution, the desktop app ships with an empty catalogue and is useless. |
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

**This PRD proceeds on the assumption that the Electron path has been chosen deliberately.** It documents that path completely and honestly. But the decision should be made with F-2 in view, not by default. See [21-open-issues-and-assumptions.md](21-open-issues-and-assumptions.md) OQ-1.

**Evidence:** `COMPOSE.md` (whole file); `library/build.gradle.kts`; `git log` commits `#2256`, `#2251`, `#2813`, `#2798`, `#3072`. **Confidence: High.**

---

## 5. Plugin runtime — the decision that sets the budget

Four viable strategies, detailed in [27-plugin-and-extension-architecture.md](27-plugin-and-extension-architecture.md) §6:

| Strategy | Ecosystem continuity | Effort | Verdict |
|---|---|---|---|
| **A. JVM sidecar** — bundle a JRE, run existing `.cs3` after DEX→JVM conversion | Highest — most providers could work | High | Best continuity; ~60–100 MB bundle; DEX→JVM conversion is fragile and each provider needs verification |
| **B. Zipline/QuickJS runtime** — align with upstream's own direction | Medium — shares upstream's future, not its present | High | Strategically correct if upstream ships Kotlin/JS providers; premature today |
| **C. Native JS/TS plugin API** — clean-room provider SDK | None — full ecosystem fork | Medium | Fastest to a working app, but every provider must be rewritten by someone |
| **D. Headless-browser provider host** — run provider logic in a locked-down renderer | Medium | Medium-High | Fits Chromium's strengths (many providers already need a WebView); weakest for CPU-bound extraction |

**Recommendation:** start with **C** for a working product, architected behind an adapter boundary so **A** or **B** can be added later without re-plumbing the app. Do not promise `.cs3` compatibility in any public communication until a strategy is proven against a real corpus of providers.

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
| RISK-1 | No plugin runtime ⇒ no content ⇒ no product | Fatal | Decide §5 before Phase 5; prototype in Phase 1 |
| RISK-2 | Codec gap makes real-world streams unplayable in Chromium | Severe | Ship an embedded mpv/libVLC path; validate against a real stream corpus early |
| RISK-3 | `hashCode` mismatch orphans every imported record | Severe | Reproduce Java semantics exactly with `Math.imul`; property-test against JVM output ([30](30-migration-test-cases.md) TC-14) |
| RISK-4 | Ecosystem fork splits provider maintenance | Severe, slow | Prefer strategies that preserve upstream compatibility; engage upstream early |
| RISK-5 | GPL-3.0 obligations mishandled in a packaged Electron app | Legal | See [11-security-and-compliance.md](11-security-and-compliance.md) §6 |
| RISK-6 | Untrusted plugins get Node.js access | Critical security | Non-negotiable sandbox boundary, [11](11-security-and-compliance.md) §3 |
| RISK-7 | Upstream KMP desktop ships first, stranding this work | Strategic | Resolve OQ-1 with the sponsor now |

---

## 9. Definition of done, in one line

The desktop application is complete when a user can install it on Windows, macOS, or Linux; import an Android backup and see their library, history, and settings intact; install providers; search, browse, play with subtitles, resume where they left off, and download; and export data that restores correctly on both desktop and Android — with every unsupported item explicitly reported rather than silently dropped.

Full criteria: [17-acceptance-criteria.md](17-acceptance-criteria.md).

---

## 10. Next steps

1. Resolve OQ-1 (Electron vs. upstream KMP) — **blocking**.
2. Choose a plugin-runtime strategy from §5 — **blocking for Phase 9, prototype in Phase 1**.
3. Gather a real Android backup corpus ([30](30-migration-test-cases.md) §2).
4. Ratify [17-acceptance-criteria.md](17-acceptance-criteria.md).
5. Commission legal review of GPL-3.0 redistribution and provider-ecosystem posture.
