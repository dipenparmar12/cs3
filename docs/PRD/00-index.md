# CloudStream Desktop (Electron) — Reverse-Engineering & Migration PRD

**Generated:** 2026-08-10 · **Revised:** 2026-08-12
**Status:** Evidence-based, ready for engineering review. Architecture ratified as ADR-10.
**Document set version:** 1.1.0

**What changed in 1.1.0.** Two decisions were taken and propagated through the set: (a) **`.cs3` drop-in compatibility** via a bundled JVM sidecar is a P0 product commitment — F-1 below is rewritten, and [31](31-cs3-dropin-compatibility.md) is new; (b) **Windows-first** platform scope — Windows 10/11 is the P0 shipping target, with macOS and Linux specified but phased later ([29](29-platform-compatibility.md) §1).

---

## 1. What this document set is

This is a **reverse-engineering and platform-migration PRD**, not a greenfield product spec.

It describes:

1. What the existing **CloudStream Android application** actually does, derived from its source code.
2. How each of those capabilities must be **reproduced, adapted, replaced, or explicitly dropped** in a cross-platform **Electron desktop application** targeting Windows, macOS, and Linux.
3. A **mandatory, lossless-where-possible data portability contract** between Android and desktop.

The governing principle throughout:

> The Android implementation defines the expected product behavior. The Electron implementation defines how that behavior is delivered on desktop.

---

## 2. Analysis baseline

| Item | Value |
|---|---|
| Source repository | `https://github.com/recloudstream/cloudstream` |
| Local analysis path | `cloudstream_ref_android/` (git submodule of this repo) |
| Analyzed commit | `a72f9e6c3f2e25eb74ce0e7d6cc56dc33c130288` |
| Commit date | 2026-08-05 |
| App version name | `4.8.0` |
| App versionCode | `68` |
| Application ID | `com.lagradost.cloudstream3` |
| License | **GPL-3.0** (`LICENSE`, lines 1–2) |
| Total commits in history | 3,753 (first commit 2021-04-30) |
| Gradle modules | `:app`, `:library`, `:docs` (`settings.gradle.kts:23`) |
| Kotlin source files in `:app` | 232 |
| Target desktop project | `cs3_windows/` (this repository) |
| Primary target platform | **Windows 10 (1809+) / 11, x64** — macOS and Linux specified but phased later |
| Community extension corpus | 26 repositories vendored at `repositories/` — 1,009 Kotlin files, 325 Gradle modules, 303 `@CloudstreamPlugin` classes, 299 `MainAPI` providers, 110 `ExtractorApi` classes (surveyed 2026-08-12) |

Every requirement in this document set is traceable to a file path and line range in the analyzed commit. If the upstream repository moves ahead of this commit, re-run the analysis and bump the document set version.

---

## 3. The five findings that shape everything else

These are the conclusions that most strongly determine cost, risk, and scope. Each is expanded in the referenced document.

### F-1 — Android extensions cannot run in Node or V8, but they *can* run drop-in on a bundled JVM
**Revised 2026-08-12 (ADR-10). This finding previously read "cannot run in Electron" and drove the entire PRD toward a provider rewrite. That conclusion was overstated.**

`.cs3` plugin files are ZIP archives containing Android DEX bytecode, loaded through `dalvik.system.PathClassLoader` (`app/.../plugins/PluginManager.kt:611`). No configuration of Node.js or V8 executes such a file — that part stands.

But the barrier is to *JavaScript runtimes*, not to *desktop*. Three facts, each verified against source, invert the conclusion:

1. `:library` **already declares a `jvm()` target** and ships JVM actuals (`library/build.gradle.kts:23-42`; `library/src/jvmMain/`, 5 files).
2. Upstream's `makeJar` **already merges `library-jvm.jar`** into the classpath every community provider compiles against (`app/build.gradle.kts:305-325`).
3. A survey of all 26 vendored community repositories (1,009 Kotlin files, 299 `MainAPI` providers) shows **67.6% import no `android.*` at all**, and five stubbable classes — `Log`, `Base64`, `Context`, `SharedPreferences`, `CookieManager` — cover ~93%. The `:app`-side surface is **22 named types**.

<!-- The desktop app therefore implements a **3-Tier Plugin Architecture**:
- **Tier A (Source Rebuild)**: Known/vendored community providers (299 providers across 26 repos) are compiled directly from Kotlin source against `library-jvm.jar` + 22 `:app` stubs using `kotlinc-jvm`. This **eliminates DEX translation risk (`RISK-D1`) entirely** for all vendored repos.
- **Tier B (Dynamic DEX Translation)**: Custom third-party `.cs3` URLs added by users at runtime are translated dynamically via `dex-translator` / `dex2jar` in the JVM sidecar, guarded by the automated Plugin Compatibility Analyzer.
- **Tier C (Native Desktop SDKs)**: Modern TypeScript SDK (`@cloudstream/sdk`) and KMP/JS SDK for native, sandboxed desktop extension development.

The desktop app therefore bundles a sandboxed JVM sidecar, and existing `.cs3` plugins run **with no rebuild, no source change, and no maintainer action**. The ecosystem is available on day one. See [31-cs3-dropin-compatibility.md](31-cs3-dropin-compatibility.md) and [27-plugin-and-extension-architecture.md](27-plugin-and-extension-architecture.md) §2.

**Two caveats that are not negotiable.** Drop-in applies to plugin *code*, not plugin *privileges* — Android grants plugins `MANAGE_EXTERNAL_STORAGE`; desktop grants nothing. And the whole approach rests on DEX→JVM translation surviving Kotlin coroutine state machines, which is untested and which every provider depends on (RISK-D1). **Fund that spike before anything else.** -->

See [31-cs3-dropin-compatibility.md](31-cs3-dropin-compatibility.md) and [27-plugin-and-extension-architecture.md](27-plugin-and-extension-architecture.md) §6.

### F-2 — Upstream is already building its own cross-platform successor
`COMPOSE.md` states outright that the project is migrating to MVI + Compose Multiplatform, that "this is part of the effort to make CloudStream cross platform," and that new code must use KMP-compatible libraries only. The `:library` module is already a Kotlin Multiplatform module with a populated `webMain` source set (`library/src/webMain/`, 6 files), and the project has replaced QuickJS with **Zipline** (commit `#2256`, 2025-12-24). An independent Electron rewrite therefore competes with, rather than complements, upstream's own roadmap. This is a strategic decision the sponsor must make consciously. See [15-upgrade-and-modernization.md](15-upgrade-and-modernization.md) and [21-open-issues-and-assumptions.md](21-open-issues-and-assumptions.md).

**Revised 2026-08-12.** ADR-10 materially reduces this tension without eliminating it. Runtime 3 **consumes upstream's `library-jvm.jar` as a dependency** rather than reimplementing the provider API, so upstream's KMP investment flows directly into the desktop app; Runtime 2 (KMP/JS) is explicitly positioned to track upstream's direction as it lands. What remains genuinely divergent is the **UI and application layer**, which is a rewrite either way. The residual strategic question — whether to contribute that layer upstream instead — is retained as OQ-1.

### F-3 — The backup format is a versionless flat key/value dump
A backup is a JSON file (`CS3_Backup_<timestamp>.txt`) with exactly two top-level objects, `datastore` and `settings`, each split into six type buckets (`_Bool`, `_Int`, `_String`, `_Float`, `_Long`, `_StringSet`) — `app/.../utils/BackupUtils.kt:123-137`. It carries **no schema version, no app version, and no platform marker**. All structure lives in the shape of the key strings themselves. Importing it safely requires the desktop app to parse a key grammar rather than a declared schema. See [25-data-portability-and-migration.md](25-data-portability-and-migration.md).

### F-4 — Every user record is keyed by a Java `String.hashCode()`
Content identity is `url.replace(mainUrl,"").replace("/","").hashCode()` (`app/.../ui/result/ResultViewModel2.kt:376-379`). Watch progress, bookmarks, favorites, subscriptions, and resume state are all filed under that 32-bit signed integer. The desktop app **must** reproduce Java's exact `hashCode` semantics, including 32-bit overflow, or every imported record becomes orphaned. See [06-data-models.md](06-data-models.md) §4.

### F-5 — Downloads are deliberately excluded from backups
`BackupUtils.kt:55-113` lists `DOWNLOAD_EPISODE_CACHE`, `DOWNLOAD_EPISODE_CACHE_BACKUP`, `KEY_DOWNLOAD_INFO`, `KEY_RESUME_PACKAGES`, `KEY_RESUME_IN_QUEUE` and the download queue key as non-transferable, with the in-code reason that "the download path URI can not be transferred." Downloaded media metadata therefore **cannot** migrate Android → desktop through the supported export path. Notably `DOWNLOAD_HEADER_CACHE` *is* retained, because resume-watching depends on it. See [18-file-and-download-management](18-technical-reference.md) and [20-limitations-and-constraints.md](20-limitations-and-constraints.md).

---

## 4. Document map

### Core specification

| # | Document | What it answers |
|---|---|---|
| 00 | **00-index.md** (this file) | Baseline, findings, how to read the set |
| 01 | [01-executive-summary.md](01-executive-summary.md) | Why, what, cost, risk, go/no-go |
| 02 | [02-system-architecture.md](02-system-architecture.md) | Android architecture as-is; target Electron architecture |
| 03 | [03-feature-specifications.md](03-feature-specifications.md) | Every feature, in the mandated 18-field format |
| 04 | [04-utility-specifications.md](04-utility-specifications.md) | Cross-cutting utilities that features depend on |
| 05 | [05-library-dependencies.md](05-library-dependencies.md) | Android dependency inventory → desktop equivalents |
| 06 | [06-data-models.md](06-data-models.md) | Canonical platform-independent logical data model |
| 07 | [07-apis-and-contracts.md](07-apis-and-contracts.md) | External services, provider API, IPC contracts |
| 08 | [08-ui-and-interactions.md](08-ui-and-interactions.md) | Screen-by-screen mobile→desktop interaction mapping |
| 09 | [09-user-workflows.md](09-user-workflows.md) | End-to-end journeys |
| 10 | [10-user-personas.md](10-user-personas.md) | Who this is for, and what that implies |
| 11 | [11-security-and-compliance.md](11-security-and-compliance.md) | Threat model, Electron hardening, GPL obligations |
| 12 | [12-performance-and-limits.md](12-performance-and-limits.md) | Dataset sizes, budgets, large-operation handling |
| 13 | [13-testing-and-qa.md](13-testing-and-qa.md) | Test strategy across parity, migration, platform |
| 14 | [14-deployment-and-ci.md](14-deployment-and-ci.md) | Packaging, signing, update channels, CI |
| 15 | [15-upgrade-and-modernization.md](15-upgrade-and-modernization.md) | Where to modernize, where to stay compatible |
| 16 | [16-implementation-plan.md](16-implementation-plan.md) | Phased roadmap ordered by dependency and risk |
| 17 | [17-acceptance-criteria.md](17-acceptance-criteria.md) | Definition of done, measurable |
| 18 | [18-technical-reference.md](18-technical-reference.md) | Key catalogs, path rules, download subsystem, algorithms |
| 19 | [19-development-history.md](19-development-history.md) | What git history reveals about current design |
| 20 | [20-limitations-and-constraints.md](20-limitations-and-constraints.md) | What will not work, and why |
| 21 | [21-open-issues-and-assumptions.md](21-open-issues-and-assumptions.md) | Unknowns requiring verification or a decision |
| 22 | [22-contributor-guide.md](22-contributor-guide.md) | How to work on the desktop codebase |
| 23 | [23-manifest.json](23-manifest.json) | Machine-readable index of the whole set |

### Migration-specific supplements

| # | Document | What it answers |
|---|---|---|
| 24 | [24-feature-parity-matrix.md](24-feature-parity-matrix.md) | Every feature classified for parity |
| 25 | [25-data-portability-and-migration.md](25-data-portability-and-migration.md) | The migration contract — the heart of this PRD |
| 26 | [26-electron-desktop-requirements.md](26-electron-desktop-requirements.md) | Desktop-native capabilities |
| 27 | [27-plugin-and-extension-architecture.md](27-plugin-and-extension-architecture.md) | The provider runtime problem and options |
| 28 | [28-media-playback-requirements.md](28-media-playback-requirements.md) | Playback subsystem in depth |
| 29 | [29-platform-compatibility.md](29-platform-compatibility.md) | Windows vs macOS vs Linux differences |
| 30 | [30-migration-test-cases.md](30-migration-test-cases.md) | Concrete migration test corpus |
| 31 | [31-cs3-dropin-compatibility.md](31-cs3-dropin-compatibility.md) | **The drop-in contract** — how unmodified `.cs3` plugins run on Windows, and what that does not cover |
| 32 | [32-cs3-desktop-feature-additions.md](32-cs3-desktop-feature-additions.md) | **Desktop feature additions & architecture** — 3-tier plugin strategy, 26-repo catalog, two-layer provider filters, 1-click downloader, live streaming engine, and 6-bucket datastore migration |

---

## 5. Reading paths

**Deciding whether to fund this project** → 01 → F-1/F-2 above → 20 → 21 → 16.

**Implementing the migration subsystem** → 25 → 06 → 18 → 30.

**Implementing the plugin runtime** → 27 → **31** → 07 → 11 → 05.

**Implementing `.cs3` drop-in specifically** → 31 → 27 §2 → 02 B2.4b → 30 (TC-D*).

**Implementing playback** → 28 → 03 (FEAT-PLAY-*) → 12.

**Implementing UI** → 08 → 09 → 03 → 26.

**QA** → 13 → 30 → 17 → 24.

---

## 6. Conventions used throughout

### Evidence
Every non-obvious claim carries an evidence block naming a repository path, a line range, the relevant symbol, and a one-line rationale. **No source code is reproduced** — paths and line numbers only, per the analysis brief. Paths are relative to `cloudstream_ref_android/` unless stated otherwise.

### Confidence
| Level | Meaning |
|---|---|
| **High** | Directly demonstrated by implementation, test, configuration, or explicit project documentation. |
| **Medium** | Strongly implied by several converging implementation details, but not directly stated. |
| **Low** | A reasonable reading that requires manual verification before being relied upon. |

An inference is never presented as a confirmed requirement.

### Parity classification
`Parity required` · `Desktop adaptation required` · `Desktop enhancement` · `Android-only` · `Desktop-only` · `Unsupported` · `Needs investigation`

### Priority
`P0` blocks release · `P1` required for parity claim · `P2` valuable · `P3` optional.

### Identifiers
`FEAT-<AREA>-<n>` features · `DATA-<n>` data entities · `MIG-<n>` migration rules · `AC-<n>` acceptance criteria · `RISK-<n>` risks · `OQ-<n>` open questions · `ADR-<n>` decision records · `TC-<n>` test cases.

---

## 7. Scope boundary

This PRD specifies a desktop application that:

- reproduces CloudStream's **application behavior**;
- consumes and produces CloudStream-compatible **user data**;
- hosts a **content-provider ecosystem** functionally equivalent to CloudStream's.

This PRD does **not** authorize, specify, or endorse the redistribution of third-party content providers, nor does it evaluate the legality of any particular provider. Provider content is user-supplied at runtime in both the Android app and the desktop target. Legal review is called out in [11-security-and-compliance.md](11-security-and-compliance.md) §7.

---

## 8. Next steps

0. **Run the DEX→JVM translation spike (OQ-27) against the full vendored corpus.** It is cheap, it gates the drop-in commitment that now shapes the whole document set, and RISK-D1 would be systemic rather than long-tail. Nothing else in this list is worth starting until it passes.
1. ~~Sponsor decision on **F-2**~~ — **Resolved 2026-08-12 (ADR-10): Electron host + bundled JVM sidecar, Windows-first.** Retained in [21](21-open-issues-and-assumptions.md) OQ-1 as a decision record. Note that ADR-10 does not *compete* with upstream's KMP direction — Runtime 2 tracks it, and Runtime 3 links upstream's own `library-jvm.jar` rather than forking it.
2. ~~Sponsor decision on **F-1**~~ — **Resolved 2026-08-12: all three runtimes in [27](27-plugin-and-extension-architecture.md) §6.2 are funded, with Runtime 3 (drop-in) as the P0 day-one path.** See [31](31-cs3-dropin-compatibility.md).
3. Collect a **real backup corpus** (see [30-migration-test-cases.md](30-migration-test-cases.md) §2) from live Android installs; several Medium/Low-confidence claims in [25-data-portability-and-migration.md](25-data-portability-and-migration.md) resolve immediately once real files exist.
4. Ratify [17-acceptance-criteria.md](17-acceptance-criteria.md) as the contractual definition of done.
5. Begin Phase 1 of [16-implementation-plan.md](16-implementation-plan.md).
