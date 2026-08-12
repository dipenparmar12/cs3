# 13 — Testing and QA Strategy

**Generated:** 2026-08-10
**Baseline:** commit `a72f9e6c`

Two things must be proven: **feature parity** with Android, and **data compatibility** with Android. Ordinary application testing is necessary but does not address either.

---

## 1. Upstream's testing posture

| Aspect | Android |
|---|---|
| Unit tests | `app/src/test/java/` — JUnit 4 |
| Instrumented tests | `app/src/androidTest/java/` — Espresso, AndroidX Test |
| Property/data testing | **Instancio** is an androidTest dependency, and a `@SkipSerializationTest` annotation exists on models — strong evidence of automated serialization round-trip testing |
| CI | 6 GitHub Actions workflows: `pull_request`, `prerelease`, `build_to_archive`, `instrumented-tests`, `generate_dokka`, `update_locales` |
| Provider testing | An in-app tool (`TestingUtils`, `ui/settings/testing/`) rather than CI — providers depend on live third-party sites |
| Lint | `checkReleaseBuilds = false`; ABI validation on `:library` via `abiValidation` |

**Evidence.** `app/build.gradle.kts:212-219`; `app/.../utils/downloader/DownloadObjects.kt:164-165`; `.github/workflows/` (6 files); `library/build.gradle.kts:90-99`; `app/build.gradle.kts:194-196`. **Confidence: High** for the inventory; **Medium** for the inferred purpose of Instancio.

**Adopt:** serialization round-trip property testing, the in-app provider tester, and ABI validation on the plugin API.

---

## 2. Test pyramid

| Layer | Scope | Target |
|---|---|---|
| Unit | Pure logic: hash, serializers, key grammar, `fixVisual`, path sanitization, quality ranking | 80%+ on the migration and data layers; 60%+ overall |
| Integration | Storage, migration pipeline, network, plugin host, download engine | All contracts in [07](07-apis-and-contracts.md) |
| Component | Renderer components in isolation | Key screens |
| End-to-end | Workflows from [09](09-user-workflows.md) | All 13 |
| Cross-platform | Same suites on Windows, macOS, Linux | E2E + migration |
| Manual | Playback fidelity, subtitle rendering, 10-foot mode, accessibility | Per release |

---

## 3. Category 1 — Data compatibility (highest priority)

### 3.1 Hash equivalence
The foundation. Generate vectors from a **real JVM**, assert the JS implementation matches.

| Test | Content |
|---|---|
| TEST-HASH-1 | ASCII strings, 0–1,000 chars |
| TEST-HASH-2 | Empty string → 0 |
| TEST-HASH-3 | Unicode BMP (CJK, Cyrillic, Arabic, Hebrew) |
| TEST-HASH-4 | Surrogate pairs (emoji, rare CJK) — Java iterates UTF-16 units |
| TEST-HASH-5 | Strings long enough to overflow 32 bits repeatedly |
| TEST-HASH-6 | Real provider URLs after `mainUrl` stripping |
| TEST-HASH-7 | Property test: 100,000 random strings vs. JVM oracle |

**Gate.** 100% pass. A single mismatch blocks release.

### 3.2 Serialization round-trip
For every entity in [06](06-data-models.md) §6: generate → serialize → parse → compare. Plus:

| Test | Content |
|---|---|
| TEST-SER-1 | Unknown fields survive a round trip untouched |
| TEST-SER-2 | Missing optional fields take documented defaults |
| TEST-SER-3 | Legacy `rating` is accepted on read, converted to `score`, never emitted |
| TEST-SER-4 | Enum ordinals match the frozen table in [06](06-data-models.md) §5 — this test fails if anyone reorders an enum |
| TEST-SER-5 | `TvType` persists by name; `ListSorting`/`DubStatus` by ordinal |
| TEST-SER-6 | Values land in the correct Android type bucket on export |

### 3.3 Key grammar
| Test | Content |
|---|---|
| TEST-KEY-1 | Folder enumeration appends `/`, so `result_watch_state` does not match `result_watch_state_data` |
| TEST-KEY-2 | Profile prefixes are applied and stripped correctly for all three key forms |
| TEST-KEY-3 | The non-transferable filter uses **substring** matching, matching Android exactly |
| TEST-KEY-4 | Every key in [18](18-technical-reference.md) §2 has a defined transferability classification |

### 3.4 Migration
The full corpus is [30-migration-test-cases.md](30-migration-test-cases.md) — 32 cases covering empty/small/large profiles, corrupt files, interrupted imports, conflicts, disk-full, and the desktop→Android direction.

---

## 4. Category 2 — Feature parity

Each acceptance criterion in [03](03-feature-specifications.md) becomes at least one test. Parity-specific techniques:

| Test | Content |
|---|---|
| TEST-PAR-1 | **Golden-state comparison.** Perform an identical action sequence on Android and desktop against the same provider; compare the resulting data-store state key-by-key. |
| TEST-PAR-2 | `fixVisual` thresholds: 0%, 1%, 5%, 50%, 95%, 100% → expected snapped values |
| TEST-PAR-3 | The 30-second write guard: 29,999 ms is not persisted; 30,000 ms is |
| TEST-PAR-4 | Watch state NONE deletes rather than storing 5 |
| TEST-PAR-5 | Video watch state `None` deletes the key |
| TEST-PAR-6 | Quality-profile ranking produces the same selection as Android for fixed link sets |
| TEST-PAR-7 | `ExtractorLinkType` inference matches for `.m3u8`, `.mpd`, `.torrent`, `magnet:`, and default |
| TEST-PAR-8 | Sequential-homepage providers issue strictly serialized requests with declared delays |
| TEST-PAR-9 | Deep-link URI grammar matches for all six schemes, including `csshare://`'s unusual apiName-then-url ordering |
| TEST-PAR-10 | Repository URL grammar: full URL, `cloudstreamrepo://`, `cs.repo`, cutt.ly code, `!`py.md code, and both 404 sentinels |

---

## 5. Category 3 — Plugin and provider

| Test | Content |
|---|---|
| TEST-PLG-1 | Install → verify hash → load → register → uninstall lifecycle |
| TEST-PLG-2 | Hash mismatch aborts and deletes the temp file |
| TEST-PLG-3 | Interrupted install leaves nothing loadable |
| TEST-PLG-4 | Remote `status == 0` disables without uninstalling |
| TEST-PLG-5 | `version == -1` always updates |
| TEST-PLG-6 | A crashing plugin does not crash the app |
| TEST-PLG-7 | A hanging plugin is killed at its timeout |
| TEST-PLG-8 | **Hostile plugin suite** — attempts `require`, `process`, filesystem, raw sockets, loopback, `file://`, prototype pollution. All must fail. Permanent CI fixture. |
| TEST-PLG-9 | Zip-slip, symlink, and decompression-bomb archives are rejected |
| TEST-PLG-10 | Safe mode disables all plugins and is discoverable |
| TEST-PLG-11 | Plugin API conformance suite — a reference provider exercising every operation |
| TEST-PLG-12 | Plugin API ABI stability across app versions (mirrors upstream's `abiValidation`) |

### 5.1 `.cs3` drop-in (ADR-10)

Runtime 3 hosts translated third-party Android bytecode, so it needs its own suite. Test cases are TC-D1..TC-D15 in [30](30-migration-test-cases.md) §10b; criteria are AC-D1..AC-D9 in [17](17-acceptance-criteria.md) §3.1.

| ID | Test |
|---|---|
| TEST-PLG-13 | **DEX→JVM translation corpus** — every `.cs3` producible from the 26 vendored repositories, asserting specifically on Kotlin `suspend` call paths, default arguments, and inline classes (RISK-D1). Permanent CI fixture |
| TEST-PLG-14 | **Hostile JVM plugin suite** — the sidecar counterpart to TEST-PLG-8: attempts filesystem escape, raw sockets, `Runtime.exec`, `ProcessBuilder`, `System.exit`, `System.loadLibrary`, and reflection into shim internals. All must fail (SEC-28..31) |
| TEST-PLG-15 | **Differential provider testing** — fixed provider+query corpus run on Android and on the sidecar; outputs compared structurally (AC-D7). Catches the failure mode where a provider "works" but returns different links |
| TEST-PLG-16 | **`:app` shim ABI diff** against upstream `master`, on a schedule. Drift fails CI before it breaks a user's plugin at link time (DROP-10/11) |
| TEST-PLG-17 | Unimplemented `android.*` API produces a typed, named, aggregated report — never a stack trace, never a silent empty result (DROP-7/8) |
| TEST-PLG-18 | Tier re-verification: a plugin that statically analyzes as T1 but throws at runtime is automatically reclassified T4 (DROP-28) |
| TEST-PLG-19 | Offscreen `WebViewResolver` bridge — interception, `additionalUrls` matching, script injection, timeout destruction, per-plugin session isolation (DROP-13..17, SEC-32) |
| TEST-PLG-20 | Sidecar unavailable (blocked by endpoint protection): the app launches and degrades to "extensions unavailable" (DSK-56a/DROP-34) |

---

## 6. Category 4 — Playback

Playback quality cannot be fully automated. A **stream corpus** is required.

| Test | Content | Method |
|---|---|---|
| TEST-PLAY-1 | Container/codec matrix: MP4/H.264+AAC, MKV/H.265+AC3, WebM/VP9, MKV/AV1, TS/HLS, DASH | Automated playability, manual quality |
| TEST-PLAY-2 | Subtitle formats: SRT, VTT, ASS, SSA, TTML, TX3G, PGS, DVB | Automated load, manual visual |
| TEST-PLAY-3 | Subtitle encodings: UTF-8, UTF-16, CP1251, Shift-JIS, Big5, ISO-8859-1 | Automated correctness |
| TEST-PLAY-4 | Mislabelled subtitles (VTT content named `.srt`) | Automated |
| TEST-PLAY-5 | Resume accuracy within ±1 s | Automated |
| TEST-PLAY-6 | Mirror failover on a deliberately broken first source | Automated |
| TEST-PLAY-7 | Seek accuracy and responsiveness | Semi-automated |
| TEST-PLAY-8 | Audio/subtitle track switching mid-playback | Automated |
| TEST-PLAY-9 | Autoplay-next at the correct percentage threshold | Automated |
| TEST-PLAY-10 | Network interruption mid-playback preserves progress | Automated |
| TEST-PLAY-11 | Torrent/magnet playback | Manual + fixture torrent |
| TEST-PLAY-12 | External player handoff on each OS | Manual |

---

## 7. Category 5 — Downloads

| Test | Content |
|---|---|
| TEST-DL-1 | Simple HTTP download completes with a correct checksum |
| TEST-DL-2 | HLS segments download and remux to a playable file |
| TEST-DL-3 | Pause/resume mid-file |
| TEST-DL-4 | App kill mid-download; resume on restart |
| TEST-DL-5 | Disk full — no file is reported complete |
| TEST-DL-6 | Link expiry triggers re-resolution |
| TEST-DL-7 | Concurrency respects both settings |
| TEST-DL-8 | Duplicate detection |
| TEST-DL-9 | Filenames are valid on all three platforms, including reserved Windows names |
| TEST-DL-10 | 1,000-item queue stays responsive |

---

## 8. Category 6 — Security

Enumerated in [11](11-security-and-compliance.md) §8. All are CI gates. The Electron configuration audit (SEC-1..14) runs on every commit.

---

## 9. Category 7 — Cross-platform

| Test | Content |
|---|---|
| TEST-XP-1 | Full E2E suite on Windows 10/11, macOS 12+ (Intel and Apple Silicon), Ubuntu LTS, Fedora |
| TEST-XP-2 | Path handling: spaces, Unicode, very long paths, reserved names |
| TEST-XP-3 | A desktop-native export from one OS restores on the other two |
| TEST-XP-4 | Native dialogs, notifications, protocol handlers, and file associations on each OS |
| TEST-XP-5 | Multi-monitor and DPI-scaling behavior |
| TEST-XP-6 | Wayland and X11 on Linux |

---

## 10. Category 8 — Upgrade

| Test | Content |
|---|---|
| TEST-UPG-1 | Every released schema version migrates forward to current |
| TEST-UPG-2 | Migration failure rolls back to the pre-migration snapshot |
| TEST-UPG-3 | An export from version N restores in version N+1 |
| TEST-UPG-4 | An export from version N+1 is **refused** by version N with a clear message |
| TEST-UPG-5 | Auto-update happy path and signature-failure path |

---

## 11. Regression protocol

| ID | Requirement |
|---|---|
| QA-1 | Every fixed bug gets a regression test before the fix merges. |
| QA-2 | The parity tests in §4 run on every release candidate. |
| QA-3 | The migration corpus ([30](30-migration-test-cases.md)) runs on every release candidate on every release-gating configuration ([29](29-platform-compatibility.md) §10). Windows-first: macOS and Linux join when their phases open. |
| QA-4 | Performance gates ([12](12-performance-and-limits.md) PERF-46) run nightly. |
| QA-5 | Security gates run on every commit. |
| QA-6 | A real Android device is used to validate WF-10 each release. There is no substitute. |

---

## 12. Test data

| Fixture | Purpose |
|---|---|
| `backup-empty.txt` | Fresh Android install |
| `backup-small.txt` | ~50 titles, 1 profile |
| `backup-typical.txt` | ~500 titles, 2 profiles, 10 providers |
| `backup-large.txt` | ~10,000 titles, 5 profiles |
| `backup-huge.txt` | ~500,000 records — the PERF-11 stress case |
| `backup-legacy-*.txt` | Older Android versions with `rating` and the old resume key |
| `backup-corrupt-*.txt` | Truncated, invalid JSON, wrong types, hostile paths |
| `hash-vectors.json` | JVM-generated hash oracle |
| `streams/` | Container/codec corpus |
| `subtitles/` | Format and encoding corpus |
| `plugins/hostile/` | Sandbox-escape suite |
| `plugins/reference/` | API conformance provider |

**Requirement QA-7.** Real backups contributed for testing must be **anonymized** — they contain browsing history. Document the process and obtain consent.

---

## Next steps

1. Build the hash oracle and `hash-vectors.json` first. Nothing else is trustworthy without it.
2. Assemble the real backup corpus ([30](30-migration-test-cases.md) §2) with consent and anonymization.
3. Stand up cross-platform CI in Phase 2 — retrofitting three-OS CI later is painful.
4. Write the hostile plugin suite while the sandbox is being built, not after.
