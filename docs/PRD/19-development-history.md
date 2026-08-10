# 19 — Development History

**Generated:** 2026-08-10
**Baseline:** commit `a72f9e6c`; 3,753 commits from 2021-04-30 to 2026-08-05

History explains *why* the current architecture looks the way it does, and — more importantly here — where it is heading. The single most consequential finding in this PRD came from reading git history rather than code.

---

## 1. Timeline

| Period | Theme |
|---|---|
| 2021 | Project inception (`init`, 2021-04-30). Android-only, Kotlin, ExoPlayer. |
| 2022–2023 | Plugin ecosystem matures; `.cs3` format; repository system; extractors; JS execution via Rhino. |
| 2024 | **First multiplatform steps** — "First steps for multiplatform API" (#1003, 2024-04-16), "Ported more files for multiplatform" (#1056, 2024-05-18). |
| 2025 | Dokka multiplatform compatibility (#1493). Late 2025: **"Use new KMP plugin for library" (#2251, 2025-12-21)** and **"Replace QuickJS with Zipline" (#2256, 2025-12-24)**. |
| 2026 H1 | Aggressive KMP preparation: `jvmCommonMain` source set (#2863), crypto moved off `javax` (#2813), dates moved to `kotlinx-datetime` (#2798), and a sweeping Jackson→kotlinx.serialization migration across ~25 subsystems. |
| 2026 H2 | **"Add actual declarations for webMain/webTest" (#3072, 2026-07-15)** — web actuals land. KMP Coroutines API (#2836), KMP locale API (#2833), improved `ContextHelper` for KMP (#2834). A migration guide is added (#3058). |

---

## 2. The dominant trend: upstream is going cross-platform

This is not speculation. Four independent lines of evidence converge:

**1. Explicit documentation.** `COMPOSE.md` states the migration to MVI is "part of the effort to make CloudStream cross platform, as it allows us to decouple UI and logic," and requires that all new code use KMP-compatible libraries only.

**2. Module structure.** `:library` is a Kotlin Multiplatform module with `commonMain` (146 files), `jvmCommonMain`, `androidMain`, `jvmMain`, and **`webMain`** — with `commonTest` and `webTest` alongside.

**3. Systematic dependency migration.** Jackson (JVM-only) → kotlinx.serialization (multiplatform) across ~25 subsystems in roughly six weeks. `javax.crypto` → `cryptography-kotlin`. Java date utilities → `kotlinx-datetime`. Each of these is a hard prerequisite for a non-JVM target, and none has any other purpose.

**4. Runtime choice.** QuickJS was replaced by **Zipline**, Cash App's runtime for shipping Kotlin/JS into QuickJS. That is a very specific bet: it makes sense if you intend to distribute Kotlin code compiled to JavaScript and execute it in a sandbox. `zipline` is a declared app dependency but is **not referenced from any Kotlin source** at this commit — it is staged, not yet used.

**Interpretation.** Upstream appears to be building toward a Kotlin Multiplatform + Compose Multiplatform application with a Kotlin/JS plugin runtime. A desktop target from that work would be a natural output.

**Confidence: High** that the KMP effort is real and active. **Medium** on its timeline and on whether a desktop build is an explicit near-term goal.

**Implication for this project.** An Electron rewrite is not a complement to upstream's roadmap; it is a parallel one. That is a legitimate choice — different technology, different contributor pool, potentially faster to a usable desktop build — but it should be made with this in view. See [21](21-open-issues-and-assumptions.md) OQ-1.

---

## 3. What history explains about current design

| Observation | Historical explanation | Migration consequence |
|---|---|---|
| Models carry **both** `@JsonProperty` and `@SerialName` | Mid-migration from Jackson to kotlinx.serialization; both names are identical so the wire format never changed | The desktop app can target one JSON shape and be correct for both eras |
| `rating` deprecated to `ERROR` but still read | A scoring-system change; old backups still contain it | The importer **must** apply `Score.fromOld` (UTIL-3) |
| `result_resume_watching_2` with an explicit migration from `result_resume_watching` | An id-scheme change forced a new key | The desktop importer must run the same legacy migration |
| `prefer_media_type_key_2`, `double_tap_seek_time_key2`, `software_decoding_key2`, `auto_download_plugins_key2` | Semantics changed; a new key avoided misreading old values | Never "clean up" these names — they are data keys |
| `chome_subtitle_settings` misspelling persists | Renaming it would orphan user data | Preserve verbatim |
| Minification disabled for release | Reflection-based plugin loading breaks under R8 | Desktop bundler must not mangle reflectively-resolved names (CI-8) |
| `WriteOnlySerializer` | Needed to accept a deprecated field without re-emitting it | Replicate the read-accept/write-omit behavior |
| `___DO_NOT_CALL_FROM_A_PLUGIN_` method prefixes | Plugins caused infinite recursion by calling loader entry points | The desktop plugin API must draw the same boundary explicitly |
| Safe mode via a `safe` file | Bad plugins bricked installs | Preserve; it is a proven recovery mechanism |
| `assertNonRecursiveCallstack()` in `PluginManager` | Same class of incident | Same |
| Conscrypt pinned to 2.5.2 with "2.5.3 crashes everything" | A painful upgrade | Irrelevant on desktop |
| Jackson/Rhino/Coil pins with minSdk comments | Old-device support | Do not inherit these constraints |

---

## 4. Removed and superseded features

| Item | Status |
|---|---|
| QuickJS | Replaced by Zipline (#2256) |
| `javax` crypto | Replaced by cryptography-kotlin (#2813) |
| Java date utilities | Replaced by kotlinx-datetime (#2798) |
| `gson` | Deprecated; retained only until extensions migrate |
| `fuzzywuzzy` | Deprecated; same reason |
| `DataStore.mapper` | `DeprecationLevel.ERROR`; extensions were misusing it |
| `BasePlugin.__filename` | Renamed to `filename`; `ERROR`-level deprecation |
| `String.toKotlinObject()` | Deprecated in favour of `parseJson<T>` |
| `LibrarySearchResponse.rating` | Superseded by `score` |
| CEA-608/708 subtitle decoders | Commented out |
| `WATCH_HEADER_CACHE` | Commented out in `DataStore.kt` |

**Note.** The number of `ERROR`-level deprecations aimed at *extension authors* shows how tightly the app and its ecosystem are coupled. A desktop plugin API will face the same pressure and should plan its deprecation policy from day one.

---

## 5. Signals for the desktop project

| Signal | What to do |
|---|---|
| The plugin ecosystem is the product | Treat ADR-2 as the defining decision, not an implementation detail |
| Serialization compatibility is treated as sacred upstream | Adopt the same discipline; property-test round-trips |
| Key renames always add a suffix rather than migrate | Follow the same convention for any desktop-only key |
| Backups deliberately exclude secrets and downloads | Keep both exclusions; they are correct |
| Safe mode and recursion guards exist because plugins broke things | Build the equivalent guardrails before shipping plugins |
| `makeJar` publishes an extension SDK per release | Publish a desktop plugin SDK with the same cadence (CI-7) |
| Weblate drives ~100 locales | Localization is a real commitment, not a checkbox |

---

## 6. Contribution norms

`AI-POLICY.md` requires disclosure of AI usage in PRs, testing before submission, deference to human contributors' knowledge of the codebase, and the ability to explain and fix submitted code.

**This PRD is AI-generated analysis of a codebase governed by that policy.** If any of this work is contributed upstream, that must be disclosed. The policy is also a reasonable norm for the desktop project to adopt.

**Evidence.** `AI-POLICY.md`; `COMPOSE.md`. **Confidence: High.**

---

## 7. Analysis caveat

Upstream moves quickly — 3,753 commits, with roughly 25 subsystem migrations in a six-week window during 2026. Any claim in this PRD is anchored to commit `a72f9e6c`. Before implementation begins, re-run the analysis and diff against this baseline, paying particular attention to:

- whether a `js()`/`wasmJs()` target has been enabled in `library/build.gradle.kts`;
- whether Zipline has moved from a declared dependency to actual use;
- whether the backup format has gained a version field;
- whether a desktop target has appeared upstream.

Any of these changes the calculus materially.

---

## Next steps

1. Re-run this analysis immediately before Phase 1 and record the diff.
2. Watch upstream's KMP progress quarterly; it is the main input to re-evaluating ADR-2.
3. Adopt `AI-POLICY.md`-equivalent norms for the desktop project.
4. Establish contact with upstream maintainers before finalizing the plugin format — a shared format benefits both projects.
