# 21 — Open Issues and Assumptions

**Generated:** 2026-08-10
**Baseline:** commit `a72f9e6c`

Everything not confirmed. Nothing here is presented as settled. **Open questions are ordered by how much they change the project if answered differently.**

---

## 1. Blocking decisions

### OQ-1 ★ — Electron, or contribute to upstream's Kotlin Multiplatform desktop target?
**Status: Blocking. Requires a sponsor decision before Phase 1.**

Upstream is actively building a cross-platform foundation: `COMPOSE.md` states the intent explicitly; `:library` is already KMP with a populated `webMain`; ~25 subsystems moved from Jackson to kotlinx.serialization in six weeks; QuickJS was replaced with Zipline; crypto and date handling moved to multiplatform libraries.

| Path | Advantage | Cost |
|---|---|---|
| Electron (this PRD) | Familiar web stack; large contributor pool; fast UI iteration; full control | Forks the ecosystem; duplicates upstream effort; every provider needs porting; permanent divergence maintenance |
| Contribute to upstream KMP desktop | Shared ecosystem; shared provider maintenance; upstream's own direction | Kotlin/Compose expertise required; less control over timeline; the desktop target may not be a near-term upstream priority |

**Recommendation.** Ask upstream directly what their desktop timeline is before committing. If a KMP desktop build is 6–12 months out, an Electron fork is hard to justify. If it is not on the roadmap, Electron is defensible.

**Impact if answered differently:** the project does not exist in this form.
**Owner:** Sponsor. **Confidence in the premise: High.**

### OQ-2 ★ — Which plugin-runtime strategy is funded?
**Status: Blocking for Phase 6; prototype in Phase 1.**
Options and analysis in [27](27-plugin-and-extension-architecture.md) §6. Determines whether existing providers can be reused, how much porting effort the ecosystem must absorb, and the bundle size.
**Recommendation.** Strategy C (native JS/TS API) behind an adapter boundary, with a Phase 1 spike validating strategy A (JVM sidecar) as a possible later addition.
**Owner:** Sponsor + engineering + provider-developer representatives.

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
| **OQ-27** | Can DEX→JVM conversion produce working providers from real `.cs3` files? | Phase 1 spike; test against 10 real providers |
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
| A-2 | The `.cs3` format does not change fundamentally. | Plugin strategy A becomes invalid |
| A-3 | Provider developers will engage with a desktop plugin API. | The app ships with little content (OQ-21) |
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
| Provider portability | **Medium** | Cannot be known without porting |
| Real-world codec distribution | **Low** | Not measurable from source |
| Upstream desktop timeline | **Low** | Not stated anywhere |

---

## 8. Issue register

| ID | Type | Severity | Owner | Needed by |
|---|---|---|---|---|
| OQ-1 | Decision | Blocking | Sponsor | Phase 0 |
| OQ-2 | Decision | Blocking | Sponsor | Phase 0 |
| OQ-23 | Legal | Blocking | Legal | Phase 0 |
| OQ-24 | Legal | Blocking | Legal | Phase 0 |
| OQ-5 | Product | High | Product | Phase 10 |
| OQ-3, 4, 7–12 | Data | High | Engineering | Phase 4 |
| OQ-13–20 | Behavior | Medium | Engineering | Phase 1 |
| OQ-27–33 | Technical | High | Engineering | Phase 1–7 |
| OQ-6, 21, 22, 25, 26 | Strategic | Medium | Sponsor | Phase 9 |

---

## Next steps

1. Escalate OQ-1, OQ-2, OQ-23, and OQ-24 to the sponsor immediately.
2. Begin backup corpus collection now — it unblocks eight questions.
3. Resolve OQ-13..OQ-20 in Phase 1 from the source already in this workspace.
4. Re-run the confidence audit at the end of each phase and record movement.
