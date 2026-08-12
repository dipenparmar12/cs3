# 16 — Implementation Plan

**Generated:** 2026-08-10
**Baseline:** commit `a72f9e6c`

Ordered by **dependency and risk**, not by user-visible value. The two highest-risk items — the plugin runtime and the hash/identity layer — are prototyped in Phase 1, before anything expensive is built on top of assumptions about them.

---

## 0. Sequencing principles

1. **De-risk first.** RISK-1 (plugin runtime) and RISK-3 (hash fidelity) get spike work in Phase 1. If either is unsolvable, the project changes shape and it is far cheaper to learn that in week 3 than in month 8.
2. **Migration is early, not last.** Building the importer in Phase 4 forces the canonical data model to be correct before the UI hard-codes assumptions about it. Migration projects that defer this end up with two incompatible models.
3. **Security is structural.** SEC-1..14 are set up with the shell in Phase 2. They cannot be retrofitted.
4. **Every phase ships something demonstrable.** Phase exits are demos to the P1 and P4 personas, not document reviews.

---

## Phase 0 — Decisions (blocking, ~1 week)

**Not an engineering phase.** Nothing downstream is safe until these are settled.

| Deliverable | Status |
|---|---|
| OQ-1: host architecture | ✅ **Resolved 2026-08-12 (ADR-10)** — Electron host + bundled JVM sidecar, Windows-first |
| ADR-2 / OQ-2: which plugin-runtime strategy is funded | ✅ **Resolved 2026-08-12** — all three runtimes; Runtime 3 (`.cs3` drop-in) is P0 |
| Legal engagement started: GPL-3.0 derivative status, FFmpeg/mpv licensing, **bundled JRE licensing (DROP-32)**, distribution posture | Open |
| Real Android backup corpus collection begun (consent + anonymization) | Open |
| ~~macOS Developer ID enrolment~~ | Deferred to the macOS phase (Windows-first). **Windows EV code-signing certificate procurement started instead — it has the long lead time now** (XP-29) |

**Exit.** ADR-10 recorded; legal engaged; corpus collection underway; EV certificate ordered.

---

## Phase 1 — Reverse-engineering baseline and risk spikes

**Goal.** Prove the three things that could kill the project. **The drop-in spike runs first and gates the rest.**

| # | Deliverable | Notes |
|---|---|---|
| 1 | **★ DEX→JVM translation spike (OQ-27 / RISK-D1)** | Run the candidate translators against **every** `.cs3` producible from the 26 vendored repositories — not a sample. Assert specifically on Kotlin `suspend` call paths, default arguments, and inline classes. **This is the highest-severity unknown in the project** ([31](31-cs3-dropin-compatibility.md) §8) |
| 2 | **Drop-in end-to-end spike** | One real, unmodified community `.cs3` installs and returns real search results from a real site through the JVM sidecar — the minimum proof that AC-D1 is achievable |
| 3 | **Compatibility Analyzer corpus run (DROP-30)** | Produces the measured tier distribution across all 299 providers, replacing the static-analysis projections in [27](27-plugin-and-extension-architecture.md) §6.1 and [31](31-cs3-dropin-compatibility.md) §7 |
| 4 | **UTIL-1 hash implementation + JVM oracle** | `hash-vectors.json` generated from a real JVM; property test over 100k random strings |
| 5 | **Streaming JSON import parser spike** | Proves PERF-19 against a synthetic 400 MB backup |
| 6 | Sandbox spike (DROP-23/24) | Prove a Windows job-object + AppContainer restricted token actually denies sockets, process spawn, and `System.loadLibrary` from inside a plugin |
| 7 | Android backup corpus, anonymized and catalogued | Resolves several Medium/Low confidence items in [21](21-open-issues-and-assumptions.md) |
| 8 | Key-grammar parser | Reads any backup into the canonical model, in memory, read-only |
| 9 | This PRD updated with corpus and tier findings | Replaces every estimated share in [31](31-cs3-dropin-compatibility.md) with a measured one |

**Exit.** Translation succeeds on a large majority of the corpus. One unmodified community plugin returns real results. The sandbox denies all four escape attempts. Hash tests pass 100%. A 400 MB backup parses within the PERF-15 memory bound.

**If deliverable 1 fails**, stop. Do not proceed to Phase 2 on the assumption it can be fixed later — the entire drop-in commitment, and with it the day-one content story, depends on it. The fallback is the pre-ADR-10 position: TypeScript/KMP runtimes only, an empty catalogue at launch, and a provider-porting campaign. That is a different project with a different budget, and the sponsor must be told immediately.

---

## Phase 2 — Electron shell and desktop foundation

| Deliverable |
|---|
| Main/renderer/preload skeleton with SEC-1..14 enforced and audited in CI |
| **JVM sidecar process skeleton**: lazy spawn, typed JSON-RPC, Supervisor kill/timeout, OS sandbox from the Phase 1 spike (DROP-23..27) |
| **`cs3-android-shim` and `cs3-app-shim`** built from the [31](31-cs3-dropin-compatibility.md) §2.3/§2.4 inventories, with the ABI diff against upstream running in CI (DROP-10/11) |
| **`jlink` JRE bundling** proven inside a signed installer (DROP-31..33), including the DSK-56a degradation path when the sidecar is blocked |
| Windows CI matrix (build, test, lint, security audit) + Linux unit/integration canary (XP-0c) |
| Window management: sizing, state persistence, multi-monitor (UI-5/6) |
| Application data directory resolution per [29](29-platform-compatibility.md) §2 |
| Logging with rotation and redaction (SEC-33) |
| Crash capture |
| Native dialog wrappers (UI-8) |
| Typed IPC scaffold with schema validation (IPC-1..7) |
| Windows Authenticode signing pipeline proven end-to-end on a hello-world build (macOS notarization deferred to the macOS phase) |

**Exit.** A signed, empty app installs and launches on Windows 10 and 11, spawns and kills the sidecar cleanly, and degrades correctly when the sidecar is blocked. The security audit is green and blocking.

---

## Phase 3 — Canonical data model and storage

| Deliverable |
|---|
| SQLite schema per [06](06-data-models.md) §8, with indexes |
| Settings document with **verbatim** preservation of unknown keys (DATA-STORE-1) |
| Entity layer for all DATA-1..DATA-11 |
| Serializers with the compatibility rules from UTIL-2/3 |
| Frozen enum-ordinal table with a guard test (TEST-SER-4) |
| Profile scoping enforced at the data layer |
| Synthetic dataset generator (PERF-48) at three size tiers |
| Atomic write and journaling (ARCH-6) |

**Exit.** 500,000 synthetic records load, query, and mutate within PERF-4 targets. Round-trip property tests pass for every entity.

---

## Phase 4 — Migration subsystem ★

**The keystone phase.** Built before the UI so the data model is validated by real data.

| Deliverable |
|---|
| Format detection and version inference |
| Validation with the resource limits from [12](12-performance-and-limits.md) §4 |
| Transformation rules MIG-1..MIG-n ([25](25-data-portability-and-migration.md) §5) |
| Pre-import snapshot and rollback |
| Staged transactional import with progress and cancellation |
| Migration report generation |
| Android-compatible export, including the **substring** non-transferable filter |
| Desktop-native export, versioned |
| The full [30](30-migration-test-cases.md) corpus wired into CI |

**Exit.** Every real backup in the corpus imports correctly, with an accurate report. A desktop export restores on a **real Android device** (TC-30).

---

## Phase 5 — Core UI and navigation

| Deliverable |
|---|
| Sidebar navigation, header, profile switcher (UI-1..4) |
| Routing and back/forward |
| Theming with OS light/dark following (UI-16) |
| Virtualized list and grid primitives (UI-7) |
| Keyboard shortcut framework ([08](08-ui-and-interactions.md) §4) |
| Context menu framework (UI-10) |
| Localization framework with the full language set |
| Setup wizard including the import step |
| Library screen against Phase 3/4 data |
| Accessibility pass (A11Y-1..6) |

**Exit.** A migrated user can install, import, and browse their library — with no providers installed. This is the first genuinely useful build.

---

## Phase 6 — Providers, search, and discovery

| Deliverable |
|---|
| **JVM sidecar promoted from skeleton to production: Runtime 3 serves real `.cs3` providers (AC-D1, AC-D2)** |
| **Offscreen `BrowserWindow` WebView bridge (DROP-13..17) + `CloudflareKiller`** — the largest net-new component, with no upstream JVM implementation to copy |
| **Compatibility Analyzer wired into the install path**, with tier re-verification on first call (DROP-28) and tiers surfaced in the Extension Manager (DX-11, DROP-29) |
| **Differential test harness (AC-D7)**: fixed provider+query corpus, Android output vs sidecar output, structural comparison in CI |
| V8 plugin host (Runtimes 1 & 2) per ADR-2, with the sandbox from [11](11-security-and-compliance.md) §4 |
| Repository management (FEAT-EXT-1), full URL grammar — **unchanged from Android, since drop-in reuses the same repository JSON** |
| Plugin install lifecycle with SHA-256 and atomic move (FEAT-EXT-2), reproducing Android's install-path grammar exactly (DROP-1) |
| Provider API surface ([07](07-apis-and-contracts.md) §3) |
| Network service with brokering (NET-1..10) |
| Home screen with sequential-loading semantics |
| Search with incremental per-provider rendering |
| Detail page with all five `LoadResponse` types |
| Watch states, favourites, subscriptions wired to storage |
| Provider testing tool (FEAT-DIAG-3) |
| Hostile plugin suite in CI (TEST-PLG-8) |

**Exit.** Install an **unmodified community `.cs3`** from a real repository URL, search, open a title, bookmark it. ≥60% of the 299 surveyed providers reach T1/T2 and return correct results (AC-D2). Sandbox escape attempts all fail, in both the V8 host and the JVM sidecar.

---

## Phase 7 — Playback

| Deliverable |
|---|
| `IPlayer`-equivalent abstraction with dual backends (ADR-3) |
| Chromium `<video>`/MSE backend with HLS and DASH |
| Embedded native player backend |
| Link resolution with **streaming** callbacks (API-2) |
| Quality profiles, all 7, with Android-equivalent ranking |
| Subtitle pipeline: formats, charset detection, styling, offset |
| Resume, autoplay-next, watch-state writes with exact thresholds |
| Player UI with the full keyboard map |
| Mini-player / always-on-top window |
| External player handoff (FEAT-CAST-2) |
| Intro/outro skip |

**Exit.** The TEST-PLAY corpus passes. Progress round-trips to Android correctly.

---

## Phase 8 — Downloads

| Deliverable |
|---|
| Queue with concurrency honoring both settings |
| Segmented, resumable HTTP downloads |
| HLS/DASH segment fetch and remux |
| Pause/resume/cancel/retry, surviving restart |
| Disk-space pre-flight and live monitoring (FEAT-DL-8) |
| Cross-platform filename sanitization (UTIL-5) |
| Downloaded-media browser and offline playback |
| Sidecar metadata (FEAT-DL-9) |

**Exit.** TEST-DL-1..10 pass on Windows (and on each further platform as its phase opens).

---

## Phase 9 — Plugin ecosystem maturity

| Deliverable |
|---|
| Published plugin SDK and documentation |
| Reference provider implementation |
| API conformance suite (TEST-PLG-11) |
| Plugin API ABI validation (TEST-PLG-12) |
| Provider porting guide — framed as **optional migration**, not a prerequisite, since drop-in already works |
| `cli analyze` and `cli migrate` (DX-4..7), driven off the Phase 1 tier matrix |
| `cs3-desktop` Gradle bridge (DX-1..3) for Kotlin maintainers' hot-reload workflow |
| At least 5 real providers ported to Runtime 1 or 2 and validated **against their Runtime 3 behavior** |
| Hot-reload developer workflow across all three runtimes; Inspector Panel runtime-agnostic (DX-8) |
| Auto-update and safe mode (safe mode disables the sidecar entirely, DROP-27) |
| Published measured tier statistics for the release (DROP-30) |

**Exit.** An external developer ports a provider using only the published documentation — **and a maintainer who does nothing still has a working provider on desktop.**

---

## Phase 10 — Settings, sync, and personalization

| Deliverable |
|---|
| All settings screens (FEAT-SET-1..12) |
| Settings search |
| Tracker OAuth for MAL, AniList, Kitsu, Simkl, with keychain storage |
| Subtitle service accounts |
| Subscription scheduler with catch-up (ADR-7) |
| Notifications (UI-12) |
| Profile management |
| Automatic backup with retention |

**Exit.** WF-5, WF-7, WF-13 pass end-to-end.

---

## Phase 11 — Deep links, OS integration, and updates

| Deliverable |
|---|
| All six protocol handlers + `https://cs.repo` |
| File associations for video, `magnet:`, `.torrent` |
| Auto-update, both channels, with signature verification |
| Tray, media keys, application menu bar |
| Drag-and-drop (UI-9) |
| Portable mode |

**Exit.** WF-11 passes; deep links work from a browser on Windows (and on each further platform as its phase opens).

---

## Phase 12 — Torrent and optional subsystems

| Deliverable |
|---|
| Torrent engine child process (ADR-8), feature-flagged |
| Magnet and `.torrent` playback |
| Seekbar thumbnail previews (FEAT-PLAY-11) |
| FCast (FEAT-CAST-3) |
| Trailer resolution or a documented limitation (FEAT-RESULT-7) |
| 10-foot mode ([08](08-ui-and-interactions.md) §7) |

**Exit.** TEST-PLAY-11 passes; 10-foot mode is navigable without a mouse.

---

## Phase 13 — Packaging and distribution

| Deliverable |
|---|
| Installers for all platforms and architectures |
| Signing and notarization automated in CI |
| SBOM and in-app license screen (LIC-4) |
| Update feeds for both channels |
| Uninstall preserving user data (REL-4) |
| **Legal sign-off complete** |

**Exit.** Users can install from a signed installer on every target and receive an update.

---

## Phase 14 — Security hardening

| Deliverable |
|---|
| External security review |
| Full [11](11-security-and-compliance.md) §8 suite passing |
| Penetration test of the plugin sandbox |
| Fuzzing of import and archive extraction |
| Electron fuses applied (SEC-14) |
| Dependency and vulnerability scanning in CI |

**Exit.** No unresolved critical or high findings.

---

## Phase 15 — Performance

| Deliverable |
|---|
| All PERF-1..18 targets met |
| Memory profiling on the heavy dataset |
| Startup optimization |
| Performance gates in CI (PERF-46) |
| Low-end HTPC hardware validation |

**Exit.** Targets met on Windows including low-end HTPC hardware; app cold start under PERF-1 with the sidecar excluded, sidecar cold start under AC-D9.

---

## Phase 16 — Parity validation and release

| Deliverable |
|---|
| Full [24](24-feature-parity-matrix.md) verification |
| Full [30](30-migration-test-cases.md) corpus on all platforms |
| Golden-state comparison against Android (TEST-PAR-1) |
| Manual playback, subtitle, and accessibility sign-off |
| Documented limitations published |
| Release notes and migration guide |
| All [17](17-acceptance-criteria.md) criteria met |

**Exit.** Release.

---

## Critical path

```
             ★ DEX→JVM translation spike gates everything below
                │
Phase 0 ──► Phase 1 ──► Phase 2 ──► Phase 3 ──► Phase 4 ──► Phase 5 ──┐
                │                                                      │
                └──► (drop-in spike) ─────────────────► Phase 6 ◄──────┘
                                                          │
                                            Phase 7 ──────┴──► Phase 8
                                                │                 │
                                            Phase 9 ◄─────────────┘
                                                │
                            Phases 10–12 ───────┴──► Phase 13 ──► 14 ──► 15 ──► 16
```

Phases 10, 11, and 12 are parallelizable across teams once Phase 7 lands.

---

## Phase weighting

| Group | Phases | Share |
|---|---|---|
| Foundation | 0–4 | 20% |
| Core product | 5–7 | 30% |
| Ecosystem | 8–9 | 25% |
| Completion | 10–16 | 25% |

Deliberately no calendar estimates — they depend on team size, the ADR-2 outcome, and how many providers must be ported. Weightings let a team apply its own velocity.

---

## Milestone demos

| Milestone | Demonstrates | Audience |
|---|---|---|
| M1 (end P1) | Hash fidelity; a provider returning real results | Sponsor, P4 |
| M2 (end P4) | Import a real Android backup and inspect the report | Sponsor, P1 |
| M3 (end P5) | Migrated library browsable on desktop | P1 |
| M4 (end P7) | Search → play → resume, with subtitles | All |
| M5 (end P9) | An external developer ports a provider | P4 |
| M6 (end P16) | Full parity and migration validation | All |

---

## Next steps

1. Complete Phase 0 — nothing else is safe to start.
2. Staff Phase 1's two spikes with the strongest available engineers; they determine project shape.
3. Set the M1 and M2 demos as contractual checkpoints.
