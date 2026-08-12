# 30 — Migration Test Cases

**Generated:** 2026-08-10

The concrete corpus that validates [25](25-data-portability-and-migration.md). Every case has a fixture, steps, and a pass condition. **The entire corpus runs on every commit, and on every release-gating configuration ([29](29-platform-compatibility.md) §10) for release candidates.**

---

## 1. How to read this

- **Fixture** — the input file or state.
- **Pass** — objectively checkable.
- **AC** — the [17](17-acceptance-criteria.md) criterion validated.
- ★ marks release-blocking cases.

---

## 2. Building the corpus

**This is a prerequisite, not a task.** Several Medium/Low-confidence claims in this PRD resolve the moment real files exist.

| Source | Method |
|---|---|
| Real Android installs | Ask volunteers to run Settings → Backup and contribute the file, **with consent** |
| Version spread | Seek backups from at least three CloudStream versions, including pre-4.0 |
| Volume spread | At least one heavy user (1,000+ titles) |
| Multi-profile | At least one backup with 3+ profiles |
| Synthetic | Generate the extremes (empty, 500,000 records) programmatically |

**Requirement.** Contributed backups **must be anonymized** before entering the repository — they contain complete viewing history. Strip or hash URLs and titles where possible; if a case needs real values, keep it out of version control and reference it from a private fixture store. Document the process and record consent.

---

## 3. Happy-path imports

### TC-1 ★ — Empty Android profile
**Fixture** `backup-empty.txt` — a backup from a fresh install.
**Steps** Import into a fresh desktop install.
**Pass** Completes without error; report shows 0 user records and N settings; app remains usable; profile 0 exists.
**AC** AC-2

### TC-2 ★ — Small profile
**Fixture** `backup-small.txt` — ~50 titles, 1 profile, ~200 progress records, 2 repositories.
**Pass** Every record imports; counts match the preview exactly; spot-checked values match byte-for-byte.
**AC** AC-2, AC-3, AC-20

### TC-3 ★ — Typical profile
**Fixture** `backup-typical.txt` — ~500 titles, 2 profiles, ~2,000 progress, 10 repositories, subscriptions, favourites, search history, quality profiles, subtitle style.
**Pass** All categories import; report is accurate; library renders correctly for both profiles.
**AC** AC-2, AC-3, AC-16

### TC-4 — Bookmarks only
**Fixture** Bookmarks but no progress.
**Pass** Library populates; continue-watching is empty; no errors.

### TC-5 — Progress only
**Fixture** Progress but no bookmarks.
**Pass** Continue-watching populates; library is empty; orphan progress is imported, not dropped (MIG-14).

### TC-6 ★ — Multiple profiles
**Fixture** 5 profiles with distinct data, distinct avatars, one PIN-locked.
**Pass** All 5 exist at their original indices with correct names and avatars; data is correctly scoped; the PIN works; no cross-profile leakage.
**AC** AC-16

### TC-7 — Settings only
**Fixture** Settings populated, no user data.
**Pass** All settings apply; path keys are reset and reported; inert keys are stored but hidden.

### TC-8 ★ — Very large profile
**Fixture** `backup-huge.txt` — ~500,000 records, ~400 MB, synthetic.
**Pass** Completes within PERF-11 (3 min) and PERF-15 (1 GB peak); UI stays responsive; progress updates throughout; cancel works at any point.
**AC** AC-19

---

## 4. Malformed and hostile input

### TC-9 ★ — Truncated file
**Fixture** A valid backup cut at 50%.
**Pass** Rejected or partially imported **with explicit labelling**; zero mutation on rejection; the error names the byte offset.
**AC** AC-10

### TC-10 ★ — Invalid JSON
**Fixture** Random bytes; HTML; an empty file; a valid JSON array instead of an object.
**Pass** Each rejected with a clear message; zero mutation; no crash.
**AC** AC-10

### TC-11 ★ — Unknown keys
**Fixture** A valid backup plus 20 keys the desktop app does not recognize.
**Pass** All 20 are listed individually in the report and preserved verbatim; none is silently dropped.
**AC** AC-4

### TC-12 ★ — Unknown-key round trip
**Fixture** TC-11's result.
**Steps** Import, then export Android-compatible.
**Pass** All 20 unknown keys reappear in the export with identical values and type buckets.
**AC** AC-5

### TC-13 ★ — Legacy formats
**Fixture** A backup containing `rating` (no `score`), the old `result_resume_watching` key, and `prefer_media_type_key` (no `_2`).
**Pass** `rating` converts via `Score.fromOld`; the legacy resume key migrates to `_2`; both are reported as transformed; no `rating` appears in any subsequent export.
**AC** AC-17

### TC-14 ★ — Id fidelity
**Fixture** A backup with known URLs and JVM-computed ids.
**Pass** Every imported id matches the JVM oracle bit-for-bit; ids are stored as signed 32-bit; **no id is recomputed** during import.
**AC** AC-1, AC-11

### TC-15 — Download-backed resume
**Fixture** Resume records with `isFromDownload = true`.
**Pass** Imported and marked unresolved; reported as transformed; not dropped.
**AC** AC-18

### TC-16 ★ — Wrong type buckets
**Fixture** Values placed in incorrect buckets (a number in `_String`, a string in `_Int`).
**Pass** Unambiguous cases are coerced and reported; ambiguous cases are skipped and reported; no crash.

### TC-17 ★ — Path traversal
**Fixture** Path-like values containing `../../etc/passwd`, `C:\Windows\System32`, `\\server\share`, `file:///etc/shadow`.
**Pass** All rejected; nothing is written outside the app data directory; each is reported.
**AC** AC-62, SEC-31

### TC-18 ★ — Oversized file
**Fixture** A 2 GB backup.
**Pass** Refused before parsing, with the actual size and the limit stated; memory does not spike.

### TC-19 ★ — Deeply nested JSON
**Fixture** 1,000 levels of nesting.
**Pass** Refused at the depth limit; no stack overflow; no crash.

### TC-20 ★ — Decompression / expansion bomb
**Fixture** A file whose parsed representation vastly exceeds its size.
**Pass** Refused at the key-count or memory limit.

---

## 5. Interruption and recovery

### TC-21 ★ — User cancels mid-import
**Fixture** `backup-large.txt`.
**Steps** Start import, cancel at ~50%.
**Pass** Cancellation acknowledged within 1 s; state is byte-identical to before the import; report states it was cancelled.
**AC** AC-8

### TC-22 ★ — Process killed mid-import
**Steps** Kill the process during staging.
**Pass** Next launch detects incomplete staging and offers rollback or resume; choosing rollback restores the pre-import state exactly; no partial data is visible.
**AC** AC-9

### TC-23 ★ — Preview accuracy
**Fixture** `backup-typical.txt`.
**Pass** Every count in the preview matches the final report exactly.
**AC** AC-20

### TC-24 ★ — Snapshot restore
**Steps** Import, then restore the pre-import snapshot from the UI.
**Pass** State returns exactly to pre-import; verified key-by-key.
**AC** AC-6

### TC-25 ★ — Disk full during snapshot
**Fixture** A filesystem with insufficient free space.
**Pass** Import aborts **before any mutation**; message states free vs. required space.

### TC-26 — Disk full during staging
**Pass** Rolls back completely; clear message; no partial state.

---

## 6. Conflicts

### TC-27 ★ — Merge, prefer imported
**Fixture** Desktop has 100 titles; backup has 150, of which 50 overlap with different values.
**Pass** 150 titles result; overlapping records take the imported values; 50 conflicts reported.

### TC-28 — Merge, prefer existing
**Pass** 150 titles; overlapping records keep the existing values; 50 conflicts reported.

### TC-29 — Import only new
**Pass** 150 titles; overlapping records unchanged; 50 skipped and reported.

### TC-30a — Replace all
**Pass** Requires typed confirmation; result is exactly the backup's 150; a snapshot exists.

### TC-30b ★ — Progress conflict favours greater position
**Fixture** The same title with a further position locally than in the backup, same duration.
**Pass** Under "prefer imported", the **greater** position is retained (MIG-C-3), and the behavior is stated in the preview.

### TC-31 — Id collision
**Fixture** Two different URLs hashing to the same id.
**Pass** Neither record is silently overwritten; both are retained and disambiguated; the collision is reported.
**AC** MIG-16

---

## 7. Export

### TC-32 ★ — Desktop → Android, on real hardware
**Steps** Populate desktop with a full dataset; export Android-compatible; transfer to a **physical Android device**; restore in CloudStream.
**Pass** Android shows the library, history, progress, favourites, subscriptions, repositories, and settings correctly; no crash; no visible corruption.
**AC** AC-12
**Note.** Emulator verification is **not** sufficient — the document-picker path and MIME handling differ on real devices.

### TC-33 ★ — Export excludes secrets
**Steps** Link every tracker and subtitle service, set a PIN and biometric, then export both formats.
**Pass** Automated secret-scanning finds no token, cookie, or credential; `biometric_key` is absent; the substring filter matches Android's behavior exactly.
**AC** AC-13, AC-14

### TC-34 ★ — Round trip, desktop → desktop
**Steps** Export desktop-native; wipe; import.
**Pass** State is identical, including desktop-only settings and window state; verified key-by-key.
**AC** AC-15

### TC-35 ★ — Round trip via Android format
**Steps** Export Android-compatible; wipe; re-import.
**Pass** All portable data is identical; excluded categories are absent and reported as expected.

### TC-36 — Three-way round trip
**Steps** Android → desktop → Android → desktop.
**Pass** Portable data is stable across all four states; no drift, no duplication, no loss.

### TC-37 ★ — Cross-platform export
**Steps** Export desktop-native on each OS; import on the other two.
**Pass** Portable data imports identically; platform-specific paths are reset and reported.
**AC** AC-70

### TC-38 — Export scope
**Steps** Export each scope: all, user data only, settings only, single profile.
**Pass** Each contains exactly its scope; the summary is accurate.

---

## 8. Version compatibility

### TC-39 ★ — Older desktop export into a newer app
**Fixture** An export at each previously released schema version.
**Pass** Each migrates forward cleanly; a pre-migration snapshot is created.
**AC** TEST-UPG-3

### TC-40 ★ — Newer desktop export into an older app
**Fixture** A `formatVersion` above the app's supported maximum.
**Pass** **Refused** with both versions named; zero mutation; no partial application.
**AC** AC-21

### TC-41 ★ — Schema upgrade on app update
**Steps** Populate at schema N; upgrade the app to schema N+1.
**Pass** Migration runs after a snapshot; data is correct afterwards; a failed migration rolls back.
**AC** TEST-UPG-1/2

### TC-42 — Checksum mismatch
**Fixture** A desktop-native export with a corrupted checksum.
**Pass** Refused; read-only inspection offered; zero mutation.

---

## 9. End-to-end journeys

### TC-43 ★ — Full migration journey
**Steps** Fresh desktop install → wizard → choose import → import `backup-typical.txt` → complete wizard → verify library, history, resume, settings → re-install providers from the imported repositories → play a title → confirm resume works from the imported position.
**Pass** Every step succeeds; imported progress resumes at the correct position; providers reinstall from imported repositories.
**AC** WF-2 complete

### TC-44 — Migration into an existing install
**Steps** Use desktop for a week, then import an Android backup.
**Pass** Conflict handling works; nothing existing is lost; the report is complete and accurate.

### TC-45 — Repeated import
**Steps** Import the same backup twice.
**Pass** The second import produces no duplicates; all records report as conflicts resolved by strategy.

---

## 10. Regression corpus

Every migration bug ever fixed becomes a permanent case here.

| Field | Content |
|---|---|
| `TC-R-<n>` | Sequential id |
| Fixture | The minimal file reproducing the bug |
| Symptom | What went wrong |
| Fixed in | Version |
| Pass | The correct behavior |

**Requirement QA-8.** No migration bug is closed without a corresponding `TC-R-*` case merged in the same change.

---

## 10b. `.cs3` drop-in corpus (TC-D1..TC-D12)

**Added 2026-08-12 (ADR-10).** These are not migration cases in the backup sense, but they belong in the same corpus discipline: a fixed, version-controlled body of real inputs, run in CI, whose failures block the merge. The inputs are real community `.cs3` artifacts, built from the 26 repositories vendored at `repositories/`.

### Corpus construction

| ID | Requirement |
|---|---|
| MTC-5 | The drop-in corpus is built by resolving each vendored repository's published repository JSON and downloading its actual `.cs3` artifacts — **the same bytes a user would install**. Locally rebuilding from source would test a different artifact than the one that ships. |
| MTC-6 | Artifact hashes are pinned. A silently updated upstream plugin must show up as a corpus change, not as a mysterious CI failure. |
| MTC-7 | Providers that require live third-party sites use recorded HTTP fixtures for CI, with a separate nightly live run whose failures warn rather than block. |

### Cases

| ID | Case | Validates | Expected |
|---|---|---|---|
| **TC-D1 ★** | Install one unmodified community `.cs3` from a real repository URL; search; open a title | AC-D1 | Works end to end, no rebuild, no source change |
| **TC-D2 ★** | Run the full corpus through install → tier → search | AC-D2 | ≥60% of 299 providers at T1/T2 return correct results |
| **TC-D3** | Differential: fixed provider+query pairs, Android output vs sidecar output | AC-D7 | Structurally equal — same result count, URLs, quality labels |
| **TC-D4 ★** | Plugin attempts to read a file outside its scoped directory | AC-D3 | Denied by the OS sandbox |
| **TC-D5 ★** | Plugin attempts a raw socket connection | AC-D3 | Denied; only brokered HTTP succeeds |
| **TC-D6 ★** | Plugin attempts `Runtime.exec` / `ProcessBuilder` / `System.exit` | AC-D3 | Denied by the class loader and the job object |
| **TC-D7 ★** | Plugin attempts `System.loadLibrary` | AC-D3 | Denied |
| **TC-D8 ★** | Plugin hangs, then a second plugin OOMs, then a third throws | AC-D4 | App survives; each failure attributed to its plugin; other providers usable |
| **TC-D9 ★** | Plugin calls an `android.*` API the shim does not implement | AC-D5 | Typed `UnsupportedAndroidApiException`, class and method named to the user, recorded for DROP-8 aggregation |
| **TC-D10 ★** | A T4 plugin is installed | AC-D6 | Never silently enabled; blocking reason shown |
| **TC-D11** | Measure the signed Windows installer with the bundled JRE | AC-D8 | ≤250 MB |
| **TC-D12** | Measure app cold start and sidecar cold start separately | AC-D9 | App <2 s (PERF-1); sidecar→first response <3 s; sidecar outside the app budget |
| **TC-D13** | Translation of a deliberately malformed / bomb `.cs3` | DROP-4/DROP-5 | Reported as `TRANSLATION_FAILED` with the offending class named; no host memory exhaustion |
| **TC-D14** | Upstream `:app` signature drift simulated in the shim | DROP-10/RISK-D3 | ABI diff fails CI before any plugin breaks at runtime |
| **TC-D15** | Sidecar blocked from starting (simulating endpoint protection) | DSK-56a/DROP-34 | App launches, reports "extensions unavailable" actionably; does **not** fail to launch |

★ = release-blocking.

---

## 11. Execution

Revised 2026-08-12 for Windows-first scope and the drop-in corpus.

| When | Scope |
|---|---|
| Every commit | Full migration corpus + TC-D1, TC-D4..D10, TC-D13..D15 on Windows |
| Every merge to main | Full migration corpus on Windows, plus the Linux unit/integration canary (XP-0c) |
| Every release candidate | Full migration corpus + **full drop-in corpus (TC-D2, TC-D3)** on every release-gating configuration, **plus TC-32 on real Android hardware** |
| Nightly | TC-8 (large-dataset performance); TC-D2/TC-D3 against **live** provider sites, warning rather than blocking (MTC-7) |

macOS and Linux acquire their own gating runs when their phases open ([29](29-platform-compatibility.md) §10).

| ID | Requirement |
|---|---|
| MTC-1 | The corpus is version-controlled; anonymized fixtures live in-repo, sensitive ones in a private store. |
| MTC-2 | Failures block the merge. |
| MTC-3 | Each case reports which AC it validates. |
| MTC-4 | Synthetic fixtures are regenerated reproducibly from a seed. |

---

## Next steps

1. **Begin backup corpus collection immediately** — it is on the critical path and depends on volunteers.
2. **Build the drop-in corpus in Phase 1**, before the translation spike, so the spike runs against real artifacts rather than a hand-picked sample. It needs no volunteers — the repositories are already vendored.
3. Build the synthetic generator (TC-8, TC-18..20) in Phase 1.
4. Secure a physical Android device for TC-32 and for the TC-D3 differential baseline.
5. Wire the migration corpus into CI during Phase 4, and the drop-in corpus during Phase 1.
