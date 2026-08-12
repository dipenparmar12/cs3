# 21 — Open Issues and Assumptions

**Generated:** 2026-08-10
**Baseline:** commit `a72f9e6c`

Everything not confirmed. Nothing here is presented as settled. **Open questions are ordered by how much they change the project if answered differently.**

---

## 1. Blocking decisions

### OQ-1 ★ — Electron, or contribute to upstream's Kotlin Multiplatform desktop target?
**Status: RESOLVED 2026-08-12 as ADR-10 — Electron host + bundled JVM sidecar, Windows-first.** Retained below as a decision record.

**What the decision was.** Electron for the application and UI layer; a sandboxed, bundled JVM child process for Runtime 3, which executes existing `.cs3` plugins drop-in ([31](31-cs3-dropin-compatibility.md)).

**Why the trade-off table below is less stark than it looks.** Its "forks the ecosystem / every provider needs porting" cost was the decisive argument against Electron, and ADR-10 removes most of it: Runtime 3 consumes upstream's own `library-jvm.jar` rather than reimplementing the provider API, existing plugins run unmodified, and Runtime 2 (KMP/JS) is positioned to absorb upstream's cross-platform work as it lands. What genuinely remains divergent is the UI and application layer — a rewrite under either option.

**What is still open.** Whether to eventually contribute the desktop UI layer upstream rather than maintain it separately. Not blocking; revisit when upstream's Compose Desktop target is real. **Owner: Sponsor.**

---

**Original analysis, retained:**

Upstream is actively building a cross-platform foundation: `COMPOSE.md` states the intent explicitly; `:library` is already KMP with a populated `webMain`; ~25 subsystems moved from Jackson to kotlinx.serialization in six weeks; QuickJS was replaced with Zipline; crypto and date handling moved to multiplatform libraries.

| Path | Advantage | Cost |
|---|---|---|
| Electron (this PRD) | Familiar web stack; large contributor pool; fast UI iteration; full control | Forks the ecosystem; duplicates upstream effort; every provider needs porting; permanent divergence maintenance |
| Contribute to upstream KMP desktop | Shared ecosystem; shared provider maintenance; upstream's own direction | Kotlin/Compose expertise required; less control over timeline; the desktop target may not be a near-term upstream priority |

**Recommendation.** Ask upstream directly what their desktop timeline is before committing. If a KMP desktop build is 6–12 months out, an Electron fork is hard to justify. If it is not on the roadmap, Electron is defensible.

**Impact if answered differently:** the project does not exist in this form.
**Owner:** Sponsor. **Confidence in the premise: High.**

### OQ-2 ★ — Which plugin-runtime strategy is funded?
**Status: RESOLVED 2026-08-12 — all three runtimes in [27](27-plugin-and-extension-architecture.md) §6.2, with Runtime 3 (`.cs3` drop-in) as the P0 day-one path.**

The prior recommendation was "Strategy C (native JS/TS) behind an adapter boundary, with a Phase 1 spike validating the JVM sidecar as a *possible later addition*". The evidence in [31](31-cs3-dropin-compatibility.md) §2 inverted the ordering: the JVM sidecar is what makes the app non-empty at launch, and TS/KMP are where the ecosystem goes afterward. The adapter boundary from the original recommendation is retained and is what makes serving three runtimes tractable.

**Owner:** Sponsor + engineering + provider-developer representatives. **Superseded by ADR-10.**

### OQ-2a ★★ — Does DEX→JVM translation survive Kotlin coroutine state machines?
**Status: OPEN. Blocking for everything. Phase 1, deliverable 1.**

This is now the project's highest-severity unknown (RISK-D1). Every provider in the ecosystem is coroutine-heavy, so a translator failure here is systemic, not long-tail — it would invalidate ADR-10's drop-in premise and return the project to an empty-catalogue launch with a provider-porting campaign.

**Resolution.** Run the candidate translators against every `.cs3` producible from the 26 vendored repositories, asserting specifically on `suspend` call paths, default arguments, and inline classes. Cheap to run; decisive either way.
**Owner:** Engineering. **Needed by: Phase 1, before Phase 2 starts.**

---

## 2. Data questions — resolvable with a real backup corpus

These are cheap to answer and expensive to guess. **Collect real backups before Phase 4.**

| ID | Question | Why it matters | Confidence today |
|---|---|---|---|
| **OQ-3** | What is the exact JSON encoding of `SubscribedData.lastSeenEpisodeCount` (a `Map<DubStatus, Int?>`)? Are keys enum names or ordinals-as-strings? Are null values present or omitted? | Subscriptions import incorrectly if guessed wrong | Low |
| **OQ-4** | What is the exact shape of a `search_history` record, and how is its key derived? | Search history import | Low |
| **OQ-7** | What is the concrete shape of `user_custom_sites` (provider overrides)? | Provider override migration | Low |
| **OQ-8** | What are the shapes of `video_profile_settings` and `video_profile_types_2`? | Quality-profile migration | Low |
| **OQ-9** | How exactly does `DataStore.setKey` serialize primitives via `toJsonLiteral()` — is a String stored as `"value"` with quotes, or bare? | Affects every value parse | Medium |
| **OQ-10** | Do real backups contain `_StringSet` entries, and for which keys? | The bucket exists but its users are unclear | Low |
| **OQ-11** | How large are real-world backups from heavy users? | Validates the [12](12-performance-and-limits.md) §1 sizing | Low |
| **OQ-12** | Which key shapes appear in older Android versions that no longer appear today? | Legacy migration completeness | Low |

**Action.** [30](30-migration-test-cases.md) §2 defines the corpus. Every one of these resolves to High confidence once real files exist.

---

## 3. Behavioral questions — resolvable by deeper source reading or experiment

| ID | Question | Current understanding | Confidence |
|---|---|---|---|
| **OQ-13** | What exactly happens to `<index>/*` keys when a profile is deleted? Are they purged or orphaned? | Appears to orphan them — no purge logic was found | Medium |
| **OQ-14** | What is the precise value of `NEXT_WATCH_EPISODE_PERCENTAGE`? | Referenced in `DataStoreHelper` and defined in the player package; must be read exactly, not assumed | Medium |
| **OQ-15** | How does `sanitizeFilename(name, allowDot)` transform its input character-by-character? | Must be read precisely to reproduce plugin paths | Medium |
| **OQ-16** | What is the exact `EpisodeSortType` enum order? | Only `NUMBER_ASC` (the default) was confirmed | Low |
| **OQ-17** | Does the download-queue key (`QUEUE_KEY`) have a profile prefix? | Appears global | Medium |
| **OQ-18** | How are duplicate downloads detected? | Possibly via `DownloadedFileInfo.linkHash` | Low |
| **OQ-19** | What is the `SearchQuality` enum order and its int values? | Enum exists with int values; order unconfirmed | Low |
| **OQ-20** | Are there user-data keys written by code paths not surveyed here? | The survey covered the main paths; completeness unproven | Medium |

**Action.** Resolve OQ-13..OQ-20 by targeted source reading during Phase 1. All are answerable from the repository already present in this workspace.

---

## 4. Strategic and external questions

| ID | Question | Impact | Owner |
|---|---|---|---|
| **OQ-5** | Which OAuth client credentials will the desktop app use? Upstream's are compiled into the APK and must not be reused. | Blocks FEAT-SYNC-1; registration has lead time | Product |
| **OQ-6** | How is Trakt actually provided? `TRAKT_CLIENT_ID` exists in the library BuildKonfig and git history shows a `TraktProvider`, but no `TraktApi` exists in `app/.../syncproviders/providers/`. Extension-provided is the likely answer. | Affects the sync-provider inventory | Engineering |
| **OQ-21** | Will provider developers port to the desktop plugin API? | Determines whether the app has content | Community |
| **OQ-22** | Should the desktop project engage upstream about a shared plugin format? | Could avoid a permanent fork | Sponsor |
| **OQ-23** | What is the FFmpeg/mpv/libVLC licensing outcome? | Determines the playback backend | Legal |
| **OQ-24** | What is the distribution posture per platform and jurisdiction? | Determines channels | Legal |
| **OQ-25** | Can upstream's Weblate translation catalogue be reused? | ~100 locales of work | Legal + community |
| **OQ-26** | Will the project rebrand? "CloudStream" is not GPL-licensed. | Naming, domains, assets | Sponsor |

---

## 5. Technical questions requiring prototyping

| ID | Question | Resolution |
|---|---|---|
| **OQ-27** ★★ | Can DEX→JVM conversion produce working providers from real `.cs3` files? | **Elevated to blocking (OQ-2a / RISK-D1).** Phase 1 spike against the **full** vendored corpus, not 10 samples |
| **OQ-34** | Can an offscreen Electron `BrowserWindow` reproduce `WebViewResolver` semantics — request interception, `additionalUrls` matching, custom script injection — well enough for the ~7% of providers that need it, including Cloudflare challenges? | Phase 1/6 spike; no upstream JVM implementation exists to copy (DROP-13..17) |
| **OQ-35** | Does a Windows job object + AppContainer restricted token actually deny sockets, process spawn, and `System.loadLibrary` to a JVM child, given `SecurityManager` is unavailable (DROP-25)? | Phase 1 spike; four separate escape tests |
| **OQ-36** | How large is the `jlink`-minimized JRE in practice, and does the installer stay under the AC-D8 250 MB cap? | Phase 2 |
| **OQ-37** | Which behavioral differences exist between `library-jvm.jar`'s JVM actuals and the Android actuals, beyond the known `WebViewResolver` stub? | Differential testing (AC-D7); ongoing |
| **OQ-38** | What is the measured tier distribution (T1–T4) across the 299 surveyed providers? The [31](31-cs3-dropin-compatibility.md) §7 shares are static-analysis projections. | Phase 1 analyzer corpus run (DROP-30) |
| **OQ-28** | Which native player embeds most cleanly in Electron — mpv via libmpv, or libVLC? | Phase 1/7 spike on all three OSes |
| **OQ-29** | Can Chromium `<video>` handle a usable fraction of real-world streams? | Measure against a real stream corpus |
| **OQ-30** | What is the IPC overhead for chatty providers making hundreds of requests? | Phase 6 benchmark; may require request batching |
| **OQ-31** | Can a streaming JSON parser meet PERF-19 on a 400 MB backup within the memory bound? | Phase 1 spike |
| **OQ-32** | Does `better-sqlite3` (a native module) package cleanly for all six platform/arch targets? | Phase 2 |
| **OQ-33** | How much does the native player backend add to bundle size in practice? | Phase 7 |

---

## 6. Assumptions this PRD makes

Stated so they can be challenged.

| ID | Assumption | Risk if wrong |
|---|---|---|
| A-1 | Upstream's backup format remains stable during development. | Importer needs rework; **monitor upstream** |
| A-2 | The `.cs3` format does not change fundamentally. | **Runtime 3 becomes invalid** — now a P0 dependency, not a fallback. Monitor upstream `PluginManager.kt` |
| A-3 | ~~Provider developers will engage with a desktop plugin API.~~ **Largely retired by ADR-10** — drop-in means content does not depend on maintainer engagement. Engagement still determines whether providers eventually *migrate* to Runtimes 1/2. | Migration stalls and the app stays dependent on translated Android bytecode indefinitely (RISK-D5) |
| A-13 | Upstream's `:app` public signatures stay stable enough for the 22-type shim to keep linking. | Every translated plugin fails at link time; mitigated by the automated ABI diff (DROP-10/11, RISK-D3) |
| A-14 | Import presence predicts runtime Android-API usage well enough for the analyzer's static tiering to be useful. | Tiers mis-predict; mitigated by re-verification on first call (DROP-28) — static analysis predicts, execution decides |
| A-15 | A GPL-3.0-compatible JRE can be bundled and redistributed (Classpath Exception). | Packaging blocked pending legal (DROP-32, OQ-23) |
| A-4 | Users are willing to re-authenticate trackers after migrating. | Migration feels lossy; unavoidable given L-4 |
| A-5 | An embedded native player is acceptable in bundle size and licensing. | ADR-3 needs revisiting; L-9 worsens |
| A-6 | The Electron path has been chosen deliberately (OQ-1). | The project premise |
| A-7 | Sizing in [12](12-performance-and-limits.md) §1 is representative. | Performance targets are mis-set (OQ-11) |
| A-8 | Android's blind-merge restore accepts desktop-generated files without harm. | Desktop→Android migration is unsafe; **must be tested on real hardware** (TC-30) |
| A-9 | GPL-3.0 permits the intended distribution model. | Legal restructuring required |
| A-10 | The seven profile avatars can be visually reproduced at stable indices. | Imported profiles look different; cosmetic |
| A-11 | The key catalogue in [18](18-technical-reference.md) §1–2 is complete. | Unknown keys are preserved verbatim, so the failure mode is graceful (OQ-20) |
| A-12 | Provider APIs and third-party sites remain reachable during development. | Testing becomes unreliable; keep recorded fixtures |

---

## 7. Confidence audit

Where this PRD's claims sit.

| Area | Confidence | Basis |
|---|---|---|
| Backup file format | **High** | Read directly from `BackupUtils.kt` |
| Data-store key names | **High** | Read from constants and resource files |
| Id derivation | **High** | Read from `ResultViewModel2.kt` |
| Settings key catalogue | **High** | Read from `donottranslate-strings.xml` |
| Plugin format and lifecycle | **High** | Read from `PluginManager.kt`, `RepositoryManager.kt` |
| Provider API surface | **High** | Read from `MainAPI.kt` |
| Subtitle format support | **High** | Read from `CustomSubtitleDecoderFactory.kt` |
| Enum ordinals | **High** | Read from source |
| Upstream KMP direction | **High** | `COMPOSE.md` + module structure + commit history |
| Nested value JSON shapes | **Medium** | Inferred from model annotations; not verified against real files |
| Dataset sizing | **Medium** | Extrapolated |
| Provider Android-API surface | **High** | Measured across all 26 vendored repositories, 2026-08-12 |
| `:library` JVM target exists | **High** | Read from `library/build.gradle.kts` and `library/src/jvmMain/` |
| DEX→JVM translation success rate | **Low** | **Untested. The single largest unknown (RISK-D1)** |
| Measured compatibility tier distribution | **Low** | Static-analysis projection only until the Phase 1 corpus run |
| Provider portability | **Medium** | Cannot be known without porting |
| Real-world codec distribution | **Low** | Not measurable from source |
| Upstream desktop timeline | **Low** | Not stated anywhere |

---

## 8. Issue register

| ID | Type | Severity | Owner | Needed by |
|---|---|---|---|---|
| OQ-1 | Decision | ✅ Resolved (ADR-10) | Sponsor | Phase 0 |
| OQ-2 | Decision | ✅ Resolved (ADR-10) | Sponsor | Phase 0 |
| **OQ-2a / OQ-27** | **Technical** | **Blocking — highest severity** | Engineering | **Phase 1, first** |
| OQ-34, 35 | Technical | High | Engineering | Phase 1 |
| OQ-36, 37, 38 | Technical | Medium | Engineering | Phase 1–2 |
| OQ-23 | Legal | Blocking | Legal | Phase 0 |
| OQ-24 | Legal | Blocking | Legal | Phase 0 |
| OQ-5 | Product | High | Product | Phase 10 |
| OQ-3, 4, 7–12 | Data | High | Engineering | Phase 4 |
| OQ-13–20 | Behavior | Medium | Engineering | Phase 1 |
| OQ-27–33 | Technical | High | Engineering | Phase 1–7 |
| OQ-6, 21, 22, 25, 26 | Strategic | Medium | Sponsor | Phase 9 |

---

## Next steps

1. **Run OQ-2a / OQ-27 first.** It is the only remaining blocking technical question, it is cheap, and a negative answer changes the project's premise, budget, and launch story.
2. Escalate OQ-23 and OQ-24 (legal) to the sponsor immediately; add the bundled-JRE licensing question (A-15 / DROP-32) to the same engagement.
3. Begin backup corpus collection now — it unblocks eight questions.
3. Resolve OQ-13..OQ-20 in Phase 1 from the source already in this workspace.
4. Re-run the confidence audit at the end of each phase and record movement.
