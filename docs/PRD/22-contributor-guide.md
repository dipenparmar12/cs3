# 22 — Contributor Guide

**Generated:** 2026-08-10
**Baseline:** commit `a72f9e6c`

For engineers and AI agents working on the desktop application.

---

## 1. Repository layout

```
cs3/
├── cloudstream_ref_android/   Git submodule: the Android source of truth (read-only)
├── cs3_windows/               The Electron desktop application
│   ├── docs/                  Project docs
│   └── docs_cs3/              Prior architecture notes on the Android app
└── docs/PRD/                  This document set
```

Initialize the reference submodule before doing any analysis:
```
git submodule update --init --recursive
```

**Never modify `cloudstream_ref_android/`.** It is the reference. Changes there are lost and confuse provenance.

---

## 2. Before you write code

1. **Read [00-index.md](00-index.md) §3** — the five findings. They explain most design decisions you will encounter.
2. **Read [06-data-models.md](06-data-models.md) §4** — identity. If you touch anything that stores a content id, this is mandatory.
3. **Read [18-technical-reference.md](18-technical-reference.md) §6** — the algorithms that must be reproduced exactly.
4. **Read [11-security-and-compliance.md](11-security-and-compliance.md) §3–4** if you touch IPC, plugins, or imports.

---

## 3. The rules that are not negotiable

| # | Rule | Why |
|---|---|---|
| 1 | **Never recompute a content id during import.** Import verbatim. | The provider may not be installed; recomputing silently changes it (L-18) |
| 2 | **Never reorder a persisted enum.** | Ordinals are stored in user data ([06](06-data-models.md) §5) |
| 3 | **Never rename a data key**, including misspelled ones like `chome_subtitle_settings`. | Renaming orphans user data |
| 4 | **Never silently discard an unknown key.** Preserve it verbatim and report it. | Forward compatibility (AC-4, AC-5) |
| 5 | **Never mutate user data without a snapshot first.** | AC-6 |
| 6 | **Never give provider code Node.js, filesystem, or raw network access.** | [11](11-security-and-compliance.md) §4 |
| 7 | **Never render provider-supplied strings as markup.** | SEC-23 |
| 8 | **Never accept a filesystem path from the renderer.** | IPC-2 |
| 9 | **Never "fix" a behavioral threshold** (`fixVisual`, the 30 s guard, NONE-deletes) without a documented decision. | Parity |
| 10 | **Never claim parity or 100% compatibility** without a passing test. | [17](17-acceptance-criteria.md) §11 |

---

## 4. Working with the Android reference

### Finding things
```
# Where is a preference key actually defined?
grep -n "download_path_key" cloudstream_ref_android/app/src/main/res/values/donottranslate-strings.xml

# Where is a data-store constant defined?
grep -rn "const val RESULT_WATCH_STATE" cloudstream_ref_android/app/src/main/java/

# What does the provider API expose?
less cloudstream_ref_android/library/src/commonMain/kotlin/com/lagradost/cloudstream3/MainAPI.kt
```

### Reference map

| Question | File |
|---|---|
| Backup format | `app/.../utils/BackupUtils.kt` |
| Data-store mechanics | `app/.../utils/DataStore.kt` |
| User-data keys and models | `app/.../utils/DataStoreHelper.kt` |
| Id derivation | `app/.../ui/result/ResultViewModel2.kt` (~line 370) |
| Provider API | `library/.../MainAPI.kt` |
| Extractor API | `library/.../utils/ExtractorApi.kt` |
| Plugin loading | `app/.../plugins/PluginManager.kt` |
| Repositories | `app/.../plugins/RepositoryManager.kt` |
| Download models | `app/.../utils/downloader/DownloadObjects.kt` |
| Download engine | `app/.../utils/downloader/DownloadManager.kt` |
| Player | `app/.../ui/player/CS3IPlayer.kt`, `GeneratorPlayer.kt` |
| Subtitles | `app/.../ui/player/CustomSubtitleDecoderFactory.kt`, `PlayerSubtitleHelper.kt` |
| Settings keys | `app/src/main/res/values/donottranslate-strings.xml` |
| Settings screens | `app/src/main/res/xml/settings_*.xml` |
| Deep links | `app/src/main/AndroidManifest.xml`, `app/.../MainActivity.kt` |
| Sync providers | `app/.../syncproviders/` |

### Citing evidence
When documenting a behavior, cite **path + line range + symbol + rationale**. Do not paste source code — this repository's PRD explicitly avoids reproducing GPL source. Cite and explain instead.

---

## 5. Development workflow

### Adding a feature
1. Find its `FEAT-*` entry in [03](03-feature-specifications.md). If none exists, add one in the same format first.
2. Check its row in [24](24-feature-parity-matrix.md).
3. Verify the Android behavior in the reference — do not trust the PRD alone for details you are about to implement.
4. Implement.
5. Write tests for every acceptance criterion in the feature spec.
6. Update the parity matrix and [23-manifest.json](23-manifest.json).

### Touching persisted data
1. Read [06](06-data-models.md) fully.
2. Bump the schema version.
3. Write the forward migration **in the same commit**.
4. Add a round-trip test.
5. Add an upgrade test from the previous version.
6. Verify the Android-compatible export still round-trips.

### Touching the migration subsystem
1. Read [25](25-data-portability-and-migration.md) fully.
2. Add or update a case in [30](30-migration-test-cases.md).
3. Run the full corpus, not just your new case.
4. Verify against real Android hardware if the export path changed.

### Touching the plugin runtime
1. Read [27](27-plugin-and-extension-architecture.md) and [11](11-security-and-compliance.md) §4.
2. Run the hostile plugin suite (TEST-PLG-8).
3. Consider whether the plugin API version needs a bump.
4. Update the SDK documentation.

---

## 6. Testing expectations

| Change type | Required tests |
|---|---|
| Data model | Round-trip property test + upgrade test |
| Migration | A case in the [30](30-migration-test-cases.md) corpus |
| Algorithm from [18](18-technical-reference.md) §6 | Vector test against JVM-generated output |
| Plugin runtime | Hostile suite + conformance suite |
| UI | Component test + an E2E path |
| Security-relevant | The relevant [11](11-security-and-compliance.md) §8 suite |
| Performance-relevant | The relevant [12](12-performance-and-limits.md) gate |

Run before pushing:
```
lint · typecheck · unit · electron-security-audit · hash-vectors · migration-corpus
```

---

## 7. Commit and PR conventions

- Conventional commits: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`, `perf:`, `security:`.
- Reference the relevant `FEAT-*`, `AC-*`, `MIG-*`, or `OQ-*` id in the body.
- A PR touching persisted data **must** state the schema-version change and link its migration.
- A PR touching the plugin API **must** state the API-version impact.
- **Disclose AI assistance**, following the norm upstream sets in `AI-POLICY.md`. Test your code before submitting; be able to explain and fix it.

---

## 8. Guidance for AI coding agents

This PRD is written to be usable as a primary specification. To use it well:

1. **Ground every claim.** Cite the PRD section or the Android source path. If neither supports a claim, mark it as an assumption and surface it.
2. **Respect confidence levels.** A `Low` confidence statement is a hypothesis to verify, not a requirement to implement.
3. **Never invent a key name, enum order, or algorithm.** Look it up in [18](18-technical-reference.md). If it is not there, read the Android source and add it.
4. **Treat §3's ten rules as hard constraints.** They encode failure modes that are silent and expensive.
5. **When the PRD and the Android source disagree, the source wins** — and the PRD gets a correction in the same change.
6. **Prefer failing loudly.** Silent data loss is the worst outcome this project can produce; a visible error is always better.
7. **Do not claim completion of a migration path without running the corpus.**

---

## 9. Where to add documentation

| Content | Destination |
|---|---|
| A new feature | [03](03-feature-specifications.md) + [24](24-feature-parity-matrix.md) + [23](23-manifest.json) |
| A newly discovered key or algorithm | [18](18-technical-reference.md) |
| A data-model change | [06](06-data-models.md) |
| A migration rule | [25](25-data-portability-and-migration.md) |
| A newly found limitation | [20](20-limitations-and-constraints.md) |
| A resolved question | [21](21-open-issues-and-assumptions.md), with the answer and its evidence |
| A significant technical decision | [15](15-upgrade-and-modernization.md) §4 as a new ADR |

Keep the generation date at the top of each document current when you make substantive changes.

---

## 10. Getting oriented quickly

| If you have | Read |
|---|---|
| 30 minutes | [00](00-index.md) §3, [01](01-executive-summary.md) |
| 2 hours | Add [06](06-data-models.md), [25](25-data-portability-and-migration.md), [20](20-limitations-and-constraints.md) |
| A day | Add [02](02-system-architecture.md), [03](03-feature-specifications.md), [27](27-plugin-and-extension-architecture.md), [18](18-technical-reference.md) |
| A week | All of it, plus a pass over the Android reference for your area |

---

## Next steps

1. Initialize the submodule and confirm the analyzed commit matches [00](00-index.md) §2.
2. Read the §3 rules before your first commit.
3. Run the full local test suite once, to see what green looks like.
