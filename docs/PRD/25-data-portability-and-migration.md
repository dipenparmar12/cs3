# 25 — Data Portability and Migration

**Generated:** 2026-08-10
**Baseline:** commit `a72f9e6c`

**The heart of this PRD.** Data portability is a release-blocking requirement, not a feature. A desktop application that cannot migrate a supported Android export is incomplete.

---

## 1. Android's export mechanism, exactly as implemented

### 1.1 Producing a backup
- Trigger: Settings → Updates → Backup (`backup_key`), or the periodic `BackupWorkManager` when `automatic_backup_key` is set.
- Filename: `CS3_Backup_<yyyy_MM_dd_HH_mm>` with extension `txt`.
- Destination: `backup_path_key` if set, else the platform Downloads directory.
- Content: `getBackup(context).toJson()` written through a `PrintWriter`.

### 1.2 The document
```
{
  "datastore": { "_Bool":…, "_Int":…, "_String":…, "_Float":…, "_Long":…, "_StringSet":… },
  "settings":  { "_Bool":…, "_Int":…, "_String":…, "_Float":…, "_Long":…, "_StringSet":… }
}
```
- `datastore` = `SharedPreferences("rebuild_preference")`, filtered.
- `settings` = default `SharedPreferences`, filtered.
- Bucketing is by runtime type at export time.
- **All six buckets are nullable.**
- `datastore` values are JSON *strings* containing nested JSON — double-encoded. `settings` values are native primitives.
- **No version, no app version, no platform marker, no checksum.**

### 1.3 The filter
```
isTransferable(key) = NOT nonTransferableKeys.any { key.contains(it) }
```
**Substring matching.** The excluded list is enumerated in [18](18-technical-reference.md) §1.

### 1.4 Restoring
- `ActivityResultContracts.OpenDocument` with seven accepted MIME types.
- Read fully into a string, `parseJson<BackupFile>`.
- `restore(...)` writes each bucket through `DataStore.editor`, re-applying `isTransferable` on the way in.
- All sync APIs get `requireLibraryRefresh = true`.
- `activity.recreate()`.

**No validation. No preview. No backup-before-restore. No rollback.** Whatever is in the file is merged into live preferences.

**Evidence.** `app/.../utils/BackupUtils.kt:50-348` throughout — `:55-118` filter, `:123-166` format and construction, `:169-198` restore, `:200-247` write, `:249-317` picker and merge. **Confidence: High.**

---

## 2. The migration contract

### 2.1 Supported directions

| Direction | Support | Format |
|---|---|---|
| Android → Desktop | **Mandatory** | Android backup JSON |
| Desktop → Desktop | **Mandatory** | Desktop-native (versioned) |
| Desktop → Android | **Mandatory, best-effort** | Android-compatible export |
| Desktop N → Desktop N+1 | **Mandatory** | Schema migration |
| Desktop N+1 → Desktop N | Refused with a clear message | — |
| Android → Android | Upstream's own concern | — |

### 2.2 The two export formats

**Android-compatible.** Byte-shape identical to §1.2. No version field — adding one risks Android's parser, which was never designed for unknown top-level keys and performs a blind merge. Contains only the portable cross-platform layer ([06](06-data-models.md) §9 layers 1, 2, 4, 6), with Android's exact substring filter applied.

**Desktop-native.** A versioned container:
```
{
  "meta": {
    "formatVersion": "1.0.0",
    "schemaVersion": 1,
    "appVersion": "x.y.z",
    "platform": "win32|darwin|linux",
    "createdAt": "ISO-8601",
    "sourceApp": "cloudstream-desktop",
    "checksum": "sha256-…",
    "recordCounts": { "<category>": n, … }
  },
  "portable": { … the cross-platform layer, in canonical form … },
  "desktopOnly": { … window state, resolved paths, desktop settings … },
  "unrecognized": { … verbatim keys the app did not understand … }
}
```

**Requirement MIG-FMT-1 (P0).** The export UI states, unambiguously and before the user commits, which format is being written and where it can be restored.

---

## 3. Import pipeline

Nine stages. Nothing is written before stage 6.

```
1 SELECT      Native dialog. No path from the renderer (IPC-2).
2 PROBE       Read a bounded prefix. Reject over-size (>1 GB) immediately.
3 DETECT      Android backup / desktop-native / unknown.
              Android: top-level "datastore" and/or "settings" with type buckets.
              Desktop: a "meta" object with formatVersion.
4 VALIDATE    Structure, depth (≤64), key count (≤2,000,000), value size (≤10 MB),
              type-bucket consistency, checksum if present.
              Desktop-native: refuse a formatVersion newer than supported.
5 ANALYZE     Stream-parse into an in-memory plan. Classify every key against
              the grammar. Count per category. Detect conflicts. Infer source
              version from the key set. NOTHING IS WRITTEN.
6 PREVIEW     Present the plan (§7). User chooses conflict strategy and scope.
              User confirms.
7 SNAPSHOT    Create a full pre-import snapshot. Verify it is readable.
              Abort here if it cannot be created — before any mutation.
8 STAGE       Apply transformations and write into a staging area inside a
              transaction. Batched (1,000–5,000 rows). Progress ≥ every 500 ms.
              Cancellable within 1 s.
9 COMMIT      Atomic commit, or full rollback. Then report (§8).
```

| ID | Requirement | Priority |
|---|---|---|
| MIG-P-1 | Stages 1–6 never mutate persisted state. | P0 |
| MIG-P-2 | Stage 7 is mandatory and unskippable. | P0 |
| MIG-P-3 | Stage 8 is transactional; partial commits are impossible. | P0 |
| MIG-P-4 | Cancellation at any point leaves state exactly as before. | P0 |
| MIG-P-5 | A crash during 8 or 9 is detected on next launch, which offers rollback or resume. | P0 |
| MIG-P-6 | Parsing is streaming (PERF-19). | P0 |
| MIG-P-7 | The UI stays responsive throughout (PERF-23). | P0 |

---

## 4. Version handling

There is no version to read from an Android backup, so it must be **inferred**.

| Signal | Inference |
|---|---|
| `result_resume_watching` present, `result_resume_watching_2` absent | Pre-id-change build |
| `rating` present in library records, `score` absent | Pre-scoring-change build |
| `prefer_media_type_key` present, `prefer_media_type_key_2` absent | Older build |
| `auth_tokens` present | Post-account-refactor build |
| `data_store_helper/account` present | Multi-profile-capable build |
| `video_profile_types_2` present | Newer quality-profile model |

| ID | Requirement | Priority |
|---|---|---|
| MIG-V-1 | Inferred source version is shown in the preview, labelled as an estimate. | P1 |
| MIG-V-2 | Inference never gates the import — an unrecognized combination still imports, with unknown keys preserved. | P0 |
| MIG-V-3 | Every desktop export records app, format, and schema version. | P0 |
| MIG-V-4 | A newer desktop format is refused with both versions named. Never partially apply a future format. | P0 |
| MIG-V-5 | Every schema version ever released has a forward migration; migrations are chained. | P0 |
| MIG-V-6 | A pre-migration snapshot is created before any schema upgrade. | P0 |

---

## 5. Transformation rules

| ID | Rule | Trigger | Action | Reported as |
|---|---|---|---|---|
| **MIG-1** | Legacy rating | `rating` present, `score` absent | Apply `Score.fromOld`; never emit `rating` | Transformed |
| **MIG-2** | Legacy resume key | `<p>/result_resume_watching/<id>` | Migrate to `result_resume_watching_2`; set the migrated flag | Transformed |
| **MIG-3** | Ids | Any content id | **Preserve verbatim. Never recompute.** | Imported |
| **MIG-4** | Download-backed resume | `ResumeWatching.isFromDownload = true` | Import; mark unresolved | Transformed |
| **MIG-5** | Path keys | `download_path_key`, `download_path_key_visual`, `backup_path_key`, `backup_dir_path_key` | Do not import; set desktop defaults | Skipped, with reason |
| **MIG-6** | Plugin records | `PLUGINS_KEY`, `PLUGINS_KEY_LOCAL` | Not present in Android backups; if present, ignore the binaries and keep repository URLs | Skipped, with reason |
| **MIG-7** | Layout mode | `app_layout_key` | `-1`/`0`/`2` → Desktop; `1` → 10-foot. Store the original value | Transformed |
| **MIG-8** | Inert settings | `rotate_video_key`, `auto_rotate_video_key`, `battery_optimisation`, `use_system_brightness_key`, `extra_brightness_enabled`, `quality_pref_mobile_data_key`, `apk_installer_key` | Import verbatim; mark inert; hide in UI | Imported (inert) |
| **MIG-9** | Profile avatars | `defaultImageIndex` | Map 0–6 to the desktop avatar set at identical indices | Imported |
| **MIG-10** | Unknown keys | Any unrecognized key | **Preserve verbatim** in a passthrough store; re-emit on export | Unrecognized |
| **MIG-11** | Type-bucket mismatch | A value in the wrong bucket | Coerce if unambiguous; otherwise skip | Transformed or Skipped |
| **MIG-12** | Malformed nested JSON | A `datastore` value that will not parse | Skip that record only; continue | Skipped, with reason |
| **MIG-13** | Empty profile array | `account` absent | Synthesize profile 0, matching Android's `getDefaultAccount` | Transformed |
| **MIG-14** | Orphan detection | Progress whose parent has no library record | Import anyway — Android does; the parent may simply not be bookmarked | Imported |
| **MIG-15** | Duplicate keys | Same key twice in the document | Last wins, matching JSON semantics; report | Transformed |
| **MIG-16** | Id collision | Two different records resolving to the same id | Do not overwrite. Keep both, disambiguate, and report | Conflict |
| **MIG-17** | Excluded-by-design keys | Tokens, caches, download state, biometric | Do not import even if present | Skipped, with reason |

---

## 6. Conflict resolution

Applies when importing into an installation that already has data.

| Strategy | Behavior |
|---|---|
| **Merge, prefer imported** (default) | Imported values win on collision |
| **Merge, prefer existing** | Existing values win |
| **Replace all** | Wipe the target scope, then import. **Requires explicit typed confirmation.** |
| **Import only new** | Only keys absent locally are written |

| ID | Requirement | Priority |
|---|---|---|
| MIG-C-1 | The strategy is chosen **before** the snapshot, and shown in the preview. | P0 |
| MIG-C-2 | Per-category overrides are supported (e.g. replace settings, merge library). | P2 |
| MIG-C-3 | For watch progress, "prefer imported" still keeps the **greater** position when durations match — a user who watched further on either device should not lose ground. | P1 |
| MIG-C-4 | Every conflict is counted and itemizable in the report. | P0 |
| MIG-C-5 | "Replace all" requires typed confirmation, not a single click. | P0 |

**MIG-C-3 note.** This is a deliberate, documented divergence from a naive merge. It is the behavior users expect and cannot cause data loss. It must be stated in the preview.

---

## 7. Import UX

### Preview screen
```
┌─ Import from CS3_Backup_2026_07_14_09_31.txt ─────────────────┐
│ Source: CloudStream for Android (estimated 4.6–4.8)  ·  12.4 MB│
│                                                                │
│ WILL IMPORT                                                    │
│   Profiles                    3                                │
│   Watch progress          2,847                                │
│   Bookmarks                 214    Favourites            88    │
│   Subscriptions              12    Resume watching       47    │
│   Search history            156    Sync mappings        392    │
│   Repositories                4    Settings              73    │
│   Subtitle style, quality profiles                             │
│                                                                │
│ WILL BE CHANGED                                                │
│   Old rating → score          88   [why?]                      │
│   Old resume key → new         9   [why?]                      │
│   Downloads-based resume       3   imported as unavailable     │
│   Layout mode                  1   TV → 10-foot mode           │
│                                                                │
│ CANNOT BE IMPORTED                                             │
│   Downloaded files & queue         not included in Android     │
│                                    backups by design           │
│   Login sessions                   excluded for your security  │
│   Installed extensions             Android-only; your 4 repos  │
│                                    will be imported so you can │
│                                    reinstall in a few clicks   │
│   Fingerprint setting              device-specific             │
│                                                                │
│ NOT RECOGNISED (kept, and included in future exports)          │
│   2 keys                            [show]                     │
│                                                                │
│ CONFLICTS                                                      │
│   41 items already exist    Strategy: [Prefer imported  ▾]     │
│                                                                │
│ A backup of your current data will be saved first.             │
│                                                                │
│              [ Cancel ]            [ Import ]                  │
└────────────────────────────────────────────────────────────────┘
```

| ID | Requirement | Priority |
|---|---|---|
| MIG-UX-1 | Categories, not raw keys. Raw keys available behind "show". | P0 |
| MIG-UX-2 | Every "cannot import" line states a **reason in plain language**. | P0 |
| MIG-UX-3 | Preview counts match the final report exactly. | P0 |
| MIG-UX-4 | Progress shows the current category and running counts. | P0 |
| MIG-UX-5 | Cancel is always available and always honored. | P0 |
| MIG-UX-6 | The report is inspectable after the fact and exportable as text. | P1 |
| MIG-UX-7 | The snapshot location is shown and openable. | P1 |
| MIG-UX-8 | Non-technical language throughout. "Login sessions" beats "auth_tokens". | P1 |

---

## 8. Migration report

```
Import completed 2026-08-10 14:22:07
Source: CS3_Backup_2026_07_14_09_31.txt (Android, estimated 4.6–4.8)
Strategy: merge, prefer imported
Snapshot: <app data>/snapshots/pre-import-2026-08-10T14-21-55/

IMPORTED       3 profiles · 2,847 progress · 214 bookmarks · 88 favourites
               12 subscriptions · 47 resume · 156 history · 392 sync mappings
               4 repositories · 73 settings · subtitle style · 7 quality profiles
TRANSFORMED    88 rating→score · 9 legacy resume key · 3 downloads-based resume
               (imported as unavailable) · 1 layout mode
SKIPPED        4 path settings (platform-specific) · 6 excluded-by-design keys
UNRECOGNISED   2 keys, preserved verbatim: <listed>
CONFLICTS      41 resolved by strategy; 0 id collisions
ERRORS         none
```

| ID | Requirement | Priority |
|---|---|---|
| MIG-R-1 | The report is written to disk and retained. | P1 |
| MIG-R-2 | Every skipped item names its reason. | P0 |
| MIG-R-3 | Every unrecognized key is listed individually. | P0 |
| MIG-R-4 | Errors identify the affected record, not just a count. | P0 |

---

## 9. Export pipeline

```
1 SCOPE     All / user data / settings only / single profile
2 FORMAT    Android-compatible or desktop-native. Consequences stated.
3 ESTIMATE  Record counts and approximate size.
4 DESTINATION  Native save dialog.
5 GENERATE  Stream to a temp file with progress.
6 VALIDATE  Re-read and verify. Android-compatible: verify it parses as
            Android's BackupFile and that no excluded key is present.
7 FINALIZE  Atomic rename to the destination.
8 SUMMARY   What was included, what was intentionally excluded, and where
            this file can be restored.
```

| ID | Requirement | Priority |
|---|---|---|
| MIG-E-1 | Exports stream to disk; never built whole in memory. | P0 |
| MIG-E-2 | Every export is validated by re-reading it before being presented. | P0 |
| MIG-E-3 | Android-compatible exports apply Android's **substring** filter exactly. | P0 |
| MIG-E-4 | Automated secret-scanning runs on generated exports in CI. | P0 |
| MIG-E-5 | Values are placed in the correct type bucket; a wrong bucket breaks Android's typed reads. | P0 |
| MIG-E-6 | The summary states restorability: Android, desktop, or both. | P0 |
| MIG-E-7 | Failed exports leave no partial file at the destination. | P0 |

---

## 10. Desktop → Android specifics

Android will accept whatever it is given. That makes the exporter solely responsible for correctness.

| ID | Requirement | Priority |
|---|---|---|
| MIG-A-1 | Emit only keys Android understands. Desktop-only keys are excluded — not because Android breaks, but because polluting a user's Android install is unacceptable. | P0 |
| MIG-A-2 | Type buckets must match Android's expectations per key. | P0 |
| MIG-A-3 | `datastore` values are JSON strings (double-encoded); `settings` values are native primitives. Mixing them breaks Android's readers. | P0 |
| MIG-A-4 | Apply the non-transferable filter, substring-matched. | P0 |
| MIG-A-5 | Ids are emitted exactly as stored. | P0 |
| MIG-A-6 | Enum values use Android's convention per field — name or ordinal ([06](06-data-models.md) §5). | P0 |
| MIG-A-7 | Verified on **real Android hardware** each release (TC-30). Emulator verification is not sufficient for the file-picker path. | P0 |

---

## 11. Failure handling

| Failure | Behavior |
|---|---|
| File not readable | Report the OS error; no mutation |
| Not a recognized format | Explain what was expected; offer to show the first bytes |
| Malformed JSON | Report byte offset; offer partial import of the salvageable portion, clearly labelled as partial |
| Over size/depth/count limits | Refuse with the actual value and the limit |
| Snapshot creation fails | **Abort before any mutation** |
| Disk full during staging | Roll back; report free vs. required space |
| Crash during staging | Detected next launch; offer rollback or resume |
| Crash during commit | Transaction guarantees atomicity; verify on next launch |
| User cancels | Roll back within 1 s |
| Individual record fails | Skip it, continue, report it individually |
| More than 10% of records fail | Pause and ask whether to continue — this signals a systemic problem |

---

## 12. Backup and snapshot policy

| ID | Requirement | Priority |
|---|---|---|
| MIG-B-1 | Pre-import snapshot before every import. | P0 |
| MIG-B-2 | Pre-migration snapshot before every schema upgrade. | P0 |
| MIG-B-3 | Retain 5 snapshots; delete oldest. | P1 |
| MIG-B-4 | Snapshots are restorable from the UI, not only programmatically. | P1 |
| MIG-B-5 | Snapshot creation is verified (readable, complete) before proceeding. | P0 |
| MIG-B-6 | Automatic scheduled backup honoring `automatic_backup_key`, with retention. | P2 |
| MIG-B-7 | Snapshots never contain credentials. | P0 |

---

## 13. Acceptance

Governed by [17](17-acceptance-criteria.md) AC-1..AC-22 and validated by [30](30-migration-test-cases.md).

The single-sentence test: **a user with a real Android backup installs the desktop app, imports, and finds their library, history, and settings intact — with everything that did not transfer explicitly listed and explained.**

---

## Next steps

1. Build this subsystem in Phase 4, before the UI is complete.
2. Collect the real backup corpus first — it resolves eight open questions in [21](21-open-issues-and-assumptions.md).
3. Prototype the streaming parser in Phase 1 (MIG-P-6).
4. Secure a real Android device for MIG-A-7 verification.
5. Design-review the §7 preview screen with the P1 persona before implementation.
