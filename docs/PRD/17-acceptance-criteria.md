# 17 — Acceptance Criteria

**Generated:** 2026-08-10
**Baseline:** commit `a72f9e6c`

The contractual definition of done. Every criterion is objectively verifiable. **Release-blocking criteria are marked ★.**

---

## 1. Data portability ★

The project's premise. Failure on any of these means the desktop application is incomplete regardless of everything else.

| ID | Criterion | Verification |
|---|---|---|
| **AC-1 ★** | The Java `String.hashCode()` implementation produces bit-identical results to the JVM for 100% of a 100,000-string property test, including surrogate pairs and overflow cases. | TEST-HASH-1..7 |
| **AC-2 ★** | Every backup in the real Android corpus is recognized, parsed, and imported without error. | TC-1..8 |
| **AC-3 ★** | All data classified "fully portable" in [06](06-data-models.md) §7 imports with values preserved exactly. | Golden-state comparison |
| **AC-4 ★** | No supported data is silently discarded. Every unmapped key appears in the migration report. | TC-11 |
| **AC-5 ★** | Unrecognized keys are preserved verbatim and reappear in a subsequent export. | TC-12 |
| **AC-6 ★** | A pre-import snapshot is created before any mutation, and its location is shown to the user. | TC-16 |
| **AC-7 ★** | Any import failure rolls back completely. No partial state is ever committed. | TC-17..20 |
| **AC-8 ★** | Cancelling an import restores the exact prior state within 1 second of the request. | TC-21 |
| **AC-9 ★** | An interrupted import (process kill, power loss) is detected on next launch and offers rollback or resume. | TC-22 |
| **AC-10 ★** | A corrupt, truncated, or malformed file is rejected with an actionable message and **zero** mutation. | TC-9, TC-10 |
| **AC-11 ★** | Imported ids are preserved verbatim and never recomputed. | TC-14 |
| **AC-12 ★** | A desktop Android-compatible export restores successfully on a **real Android device**, with library, history, and settings intact. | TC-30 |
| **AC-13 ★** | Exports contain no tokens, credentials, cookies, or the biometric key — verified by automated secret-scanning of every generated export. | SEC-29 test |
| **AC-14 ★** | The non-transferable filter uses substring matching identical to Android's. | TEST-KEY-3 |
| **AC-15** | A desktop-native export restores on desktop with 100% fidelity, including desktop-only state. | TC-24 |
| **AC-16** | A multi-profile backup reproduces every profile at its original index, name, and avatar. | TC-6 |
| **AC-17** | Legacy `rating` values convert to `score`; legacy `result_resume_watching` migrates to `result_resume_watching_2`. | TC-13 |
| **AC-18** | Resume entries with `isFromDownload=true` import as unresolved and are reported, not dropped. | TC-15 |
| **AC-19** | Import of a 500,000-record backup completes within PERF-11 and PERF-15 bounds. | TC-8 |
| **AC-20** | The import preview accurately predicts what the import will do — counts match the final report. | TC-23 |
| **AC-21** | A future-version desktop export is refused by an older app with a clear message naming both versions. | TEST-UPG-4 |
| **AC-22** | The export UI states unambiguously whether each format restores on Android, desktop, or both. | Manual review |

---

## 2. Feature parity ★

| ID | Criterion | Verification |
|---|---|---|
| **AC-23 ★** | Every P0 feature in [03](03-feature-specifications.md) is implemented and its acceptance criteria pass. | Feature test suite |
| **AC-24 ★** | Every P1 feature is implemented, or is listed in the published limitations with a reason. | [24](24-feature-parity-matrix.md) review |
| **AC-25 ★** | `fixVisual` thresholds match exactly at 0%, 1%, 5%, 50%, 95%, 100%. | TEST-PAR-2 |
| **AC-26 ★** | Progress is not persisted below 30,000 ms duration; it is at exactly 30,000 ms. | TEST-PAR-3 |
| **AC-27 ★** | Watch state NONE deletes the record; video watch state `None` deletes the key. | TEST-PAR-4/5 |
| **AC-28 ★** | Enum ordinals match the frozen table in [06](06-data-models.md) §5. | TEST-SER-4 |
| **AC-29** | Sequential-homepage providers issue strictly serialized requests with their declared delays. | TEST-PAR-8 |
| **AC-30** | Quality-profile ranking selects the same source as Android for fixed link sets. | TEST-PAR-6 |
| **AC-31** | All six deep-link schemes plus `https://cs.repo` work, with grammar matching Android. | TEST-PAR-9 |
| **AC-32** | The repository URL grammar accepts all four forms and rejects both 404 sentinels. | TEST-PAR-10 |
| **AC-33** | A provider failure degrades one row or section; it never fails the screen or prevents app start. | WF-12 |

---

## 3. Plugin ecosystem ★

| ID | Criterion | Verification |
|---|---|---|
| **AC-34 ★** | A user can add a repository, install a provider, and search with it. | WF-3 |
| **AC-35 ★** | SHA-256 verification is enforced when the repository supplies a hash; mismatch aborts and deletes the temp file. | TEST-PLG-2 |
| **AC-36 ★** | An interrupted install never leaves a loadable partial plugin. | TEST-PLG-3 |
| **AC-37 ★** | Every hostile-plugin escape attempt fails: `require`, `process`, filesystem, raw sockets, loopback, `file://`, prototype pollution. | TEST-PLG-8 |
| **AC-38 ★** | A crashing or hanging plugin does not crash or hang the application. | TEST-PLG-6/7 |
| **AC-39 ★** | Archive extraction rejects zip-slip, symlinks, and decompression bombs. | TEST-PLG-9 |
| **AC-40** | Remote `status == 0` disables a plugin; `version == -1` always updates. | TEST-PLG-4/5 |
| **AC-41** | Safe mode disables all plugins and is discoverable from the UI. | TEST-PLG-10 |
| **AC-42** | The plugin SDK is published, versioned, and documented; an external developer can port a provider from documentation alone. | M5 demo |
| **AC-43** | At least 5 real providers are ported and validated before release. | Manual |

### 3.1 `.cs3` drop-in ★ (ADR-10)

Full specification in [31](31-cs3-dropin-compatibility.md) §9. These are the criteria that decide whether the app has content on day one.

| ID | Criterion | Verification |
|---|---|---|
| **AC-D1 ★** | A `.cs3` downloaded from any of the 26 vendored community repositories installs and runs on Windows with **no rebuild and no source change**. | TC-D1 |
| **AC-D2 ★** | ≥60% of the 299 surveyed `MainAPI` providers reach tier T1 or T2 and return correct search results against live or recorded fixtures. | TC-D2 |
| **AC-D3 ★** | No plugin, at any tier, can read outside its scoped directory, open a socket, spawn a process, or load a native library. Four separate passing tests. | TC-D4..D7 |
| **AC-D4 ★** | A plugin that hangs, OOMs, or crashes the sidecar leaves the app running and other providers usable. | TC-D8 |
| **AC-D5 ★** | An unsupported `android.*` API produces a named, actionable message — never a stack trace, never a silent empty result. | TC-D9 |
| **AC-D6 ★** | A T4 plugin is never silently enabled. | TC-D10 |
| **AC-D7** | Differential test: for a fixed provider+query corpus, sidecar output matches Android output structurally (same result count, same URLs, same quality labels). | TC-D3 |
| **AC-D8** | The Windows installer with the bundled JRE stays under 250 MB. | TC-D11 |
| **AC-D9** | Sidecar cold start to first provider response under 3 s, and it does not delay app cold start (DSK-57). | TC-D12 |

---

## 4. Playback

| ID | Criterion | Verification |
|---|---|---|
| **AC-44 ★** | Every container/codec combination in the stream corpus either plays, or produces a specific actionable message naming the limitation. | TEST-PLAY-1 |
| **AC-45 ★** | SRT, VTT, ASS/SSA, and TTML render with styling equivalent to Android. | TEST-PLAY-2 |
| **AC-46 ★** | Non-UTF-8 subtitles are correctly detected and decoded. | TEST-PLAY-3 |
| **AC-47 ★** | Resume restores position within ±1 second. | TEST-PLAY-5 |
| **AC-48** | A failed source auto-advances to the next-ranked mirror without user action. | TEST-PLAY-6 |
| **AC-49** | Mislabelled subtitles (VTT content in a `.srt`) still render. | TEST-PLAY-4 |
| **AC-50** | Network interruption mid-playback preserves progress. | TEST-PLAY-10 |
| **AC-51** | Autoplay-next fires at the correct percentage threshold. | TEST-PLAY-9 |
| **AC-52** | Bitmap subtitles (PGS, DVB) either render or produce an explicit message offering the native backend. | TEST-PLAY-2 |

---

## 5. Downloads

| ID | Criterion | Verification |
|---|---|---|
| **AC-53 ★** | A file is **never** reported complete when it is truncated, including on disk-full. | TEST-DL-5 |
| **AC-54 ★** | Downloads resume after an application restart. | TEST-DL-4 |
| **AC-55** | HLS downloads remux to a playable file. | TEST-DL-2 |
| **AC-56** | Generated filenames are valid on all three platforms, including Windows reserved names. | TEST-DL-9 |
| **AC-57** | Downloaded items play offline with their subtitles. | WF-6 |
| **AC-58** | Concurrency honors both download settings. | TEST-DL-7 |

---

## 6. Security ★

| ID | Criterion | Verification |
|---|---|---|
| **AC-59 ★** | SEC-1..14 are enforced and verified by a blocking CI audit. | CI |
| **AC-60 ★** | Tracker tokens are stored in the OS keychain and never written to the data store in plaintext. | SEC-28 test |
| **AC-61 ★** | Logs and crash reports are redacted; crash reporting defaults off. | SEC-33/34 |
| **AC-62 ★** | Import resource limits ([12](12-performance-and-limits.md) §4) are enforced. | Fuzzing |
| **AC-63 ★** | Provider-supplied strings cannot inject markup or script into the UI. | XSS corpus |
| **AC-64 ★** | Plugin network requests cannot reach `file://`, loopback, or private ranges without explicit consent. | SSRF corpus |
| **AC-65 ★** | Update packages are signature-verified; verification failure aborts and reports. | TEST-UPG-5 |
| **AC-66 ★** | No unresolved critical or high findings from the external security review. | Phase 14 |

---

## 7. Platform ★

| ID | Criterion | Verification |
|---|---|---|
| **AC-67 ★** | Full E2E and migration suites pass on Windows, macOS (Intel and Apple Silicon), and Linux. | TEST-XP-1 |
| **AC-68 ★** | Installers are signed on all platforms; macOS builds are notarized. | Phase 13 |
| **AC-69 ★** | Uninstall never deletes downloaded media, and offers to keep user data (defaulting to keep). | REL-4 |
| **AC-70** | A desktop-native export from one OS restores on the other two. | TEST-XP-3 |
| **AC-71** | Paths with spaces, Unicode, and extreme length are handled on all platforms. | TEST-XP-2 |
| **AC-72** | Protocol handlers, file associations, notifications, and native dialogs work on each OS. | TEST-XP-4 |

---

## 8. Performance

| ID | Criterion | Verification |
|---|---|---|
| **AC-73 ★** | PERF-1 (cold start), PERF-4/5 (library at 10k items), PERF-10/11 (import) are met on all platforms. | CI gates |
| **AC-74** | The application remains fully responsive during import, export, and download. | PERF-23 |
| **AC-75** | Memory stays within PERF-13..15 bounds. | Profiling |
| **AC-76** | All lists are virtualized; none renders every item. | Code review + profiling |

---

## 9. Quality and compliance

| ID | Criterion | Verification |
|---|---|---|
| **AC-77 ★** | GPL-3.0 compliance: license shipped, source offered, notices present, in-app license screen complete. | LIC-1..4 |
| **AC-78 ★** | Legal sign-off obtained on FFmpeg/native-player licensing and distribution posture. | Phase 13 |
| **AC-79 ★** | The application ships with no preinstalled content providers and no copy implying it provides content. | LEG-1/2 |
| **AC-80** | Every interactive element is keyboard-operable; no focus trap exists. | A11Y-1/6 |
| **AC-81** | Documented limitations are published with the release. | [20](20-limitations-and-constraints.md) |
| **AC-82** | An SBOM is published per release. | CI-6 |

---

## 10. What "complete" explicitly does **not** mean

The application is **not** complete merely because:
- Electron launches and shows screens.
- Search returns results.
- A video plays.
- A backup file can be opened.

It is complete when a real user with a real Android backup can migrate, use the product for a week, and export data that restores on both platforms — with every unsupported item explicitly reported.

---

## 11. Partial-parity declaration

Where 100% parity is impossible, the exact fields and reasons must be enumerated in [20](20-limitations-and-constraints.md). Known at authoring time:

| Item | Reason |
|---|---|
| Downloaded media and download queue | Excluded from Android backups by upstream design (`BackupUtils.kt:90-109`) |
| Auth tokens | Excluded from Android backups by upstream design |
| Plugin binaries | Android bytecode; repositories migrate instead |
| Chromecast | No Electron binding for the Cast SDK |
| Android TV "watch next" EPG | No desktop analogue |
| Screen brightness gesture | Not portably controllable from a desktop application |
| Device rotation settings | Not applicable |
| Battery-optimization exemption | Not applicable |
| Biometric key | Excluded from backups by upstream design |

**No claim of 100% compatibility may be made in any user-facing material.** Where verification has not been performed against real Android hardware, that must be stated rather than assumed.

---

## Next steps

1. Ratify this document as the contractual definition of done before Phase 1.
2. Map each criterion to a specific automated test in [13](13-testing-and-qa.md).
3. Track ★ criteria on a visible release dashboard from Phase 4 onward.
