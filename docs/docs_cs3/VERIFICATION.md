# Verification Record (2026-10-07)

Honest account of what the desktop documentation set was checked against. No accuracy "score" is claimed: a score
would imply a full line-by-line audit of ~100k lines, which this was not.

## Method
1. Inventoried `cs3_windows/electron`, `cs3_windows/src`, `sidecar/` (file lists, line counts, IPC registrations by script).
2. Read the code for the claims below (greps and targeted reads), then wrote the documents from that plus `CLAUDE.md`/`AGENTS.md`.
3. Validation pass: a script confirmed that **every backticked file name in the new documents exists in the repository**
   (exceptions: `manifest.json` is inside plugin archives) and that every relative link resolves.
4. Not done: running the app (Electron cannot launch here), running tests, or any live-network harness.

## Verified directly in code this pass
* 334 `ipcMain.handle` channels in 42 namespaces (scripted scan, multi-line registrations included); channel names in `api-services.md` are generated.
* Service files exist and their line counts (`main.ts` 6,220; `preload.ts` 2,473; `contentService.ts` 2,591; `mediaProxy.ts` 1,920; `downloadService.ts` 1,462; `VideoPlayer.tsx` 5,339; `App.tsx` 2,350…).
* `RUNTIME_GENERATION = 16`; `BOOTSTRAP_VERSION = 2`; `PLUGINS_PER_REPOSITORY = 16`; sidecar RPC method names; region ids.
* Strategy names (`DIRECT … EME_NATIVE`), `DownloadState` values, download engine selection order (`startTask`), segmented detection (including its URL-suffix fallback), the Incognito download gate (`allowDownloads`).
* Cache constants: source cache 7 d entry / 20 min link / 300 entries / 3 failures; detail cache 12 h / 30 d / 300; discovery 6 h / 30 d; catalogue ≤120/160; listing ≤80; snapshots ≤600; search history 50; saved searches 50×200; history 10,000; bookmarks 2,000; played sources 400; progress rows 500; stored sources 30.
* Indexer count (19 built-ins), budget clamps (4 s–20 s, ×2.5), search concurrency default 8 (1–32).
* UI structure: sidebar items, navbar controls, `ActiveTab` switch, settings tab ids/labels, extension tab ids/labels (four), library modes, history status pills, download-center controls, detail-hero actions, player aria-labels, player shortcut table, native menu items and accelerators, mpv launch flags, logger event names and scopes.
* `MediaProxy.wrapLease` has no callers; `sourceLease`/`playbackTelemetry` appear only as type imports (PRD-40.1 leases are not wired).

## Carried over from `CLAUDE.md`/`docs/agents/*` and **not re-read in code this pass**
These are written as facts because the project's own notes state them as measured, but they were not independently re-verified here — treat as *requires verification* before relying on them for a change:
* Extension lifecycle details: DEX translation/`KotlinNameRepair`/tiers, jar-lane detection, sandbox gaps, archive placement, rollback semantics, updater rules (own-repository republish rule, auto-install defaults).
* `MediaProxy` internals (HLS/DASH rewriting, token/Host checks, `boundedRanges`, PNG-wrapped TS unwrapping, route eviction) and the decision-engine rules (mpv routing policy detail, HDR chain, 4K guard).
* Resume probe (64 KB window), `request()` six-outcome table, download identity key composition.
* Metadata merge rules, source adapters, Wikipedia/Wikidata behaviour, trailer popup/autoplay details, rating handling.
* Provider ranking weights (e.g. 0.4 maintainer status), unscored failure kinds, adult-gate screening details, regions cross-region behaviour, Jellyfin/Stremio specifics.
* Which stores check `isPrivateSession()` beyond the per-file call counts found by grep; the exact backup-restore merge/snapshot semantics.
* Section contents of Settings panels beyond component names; per-screen empty/loading/error states beyond the strings found.
* Timings and measurements quoted from the project notes (e.g. 6.6 s → 8 ms registry hydration).

## Known limits of the UI documentation
`ui/wireframes.md` is schematic. Layout positions are inferred from component order and class names, not from rendering
the app; visual placement may differ. Labels were taken from JSX where noted in `screens.md`.

## Documents outside this set
* `docs/docs_cs3/android/*` — describe the upstream Android app; their only cross-check is `android/VERIFICATION_REPORT.md`
  (which compared them to the Android reference, not to this repository). Not re-audited here; they were moved, not rewritten.
* `docs/PRD/*` — intent documents; several are marked stale/proposed in `CLAUDE.md §13`. Not changed.
* `docs/agents/*` — domain notes; read for depth, same authority as `CLAUDE.md`. Not changed.
* Dated working notes at `docs/` root (`2026-10-0*…md`) and `docs/PRD/2026-10-*` — design notes for specific features
  (startup cache, ratings, reviews/related media, franchise navigation, buffer indicator, subtitles, updates, adult-only hiding);
  not audited against code. **Requires verification** before being treated as current behaviour.

## Corrections made to existing docs this pass
* `AGENTS.md` (= `CLAUDE.md`): IPC channel count (~70 → 334), namespace list (+14 namespaces), Extensions tabs (two → four), removed hard-coded suite counts.
* `docs/docs_cs3/`: Android reference moved to `android/`; desktop documentation added.

## Open issues found, not fixed
* `AGENTS.md` is 361 KB and contains duplicated tables (the build/test table and the service table each appear twice) and
  stale historical counts in prose (e.g. "17 built-in adapters" vs the 19 now registered, noted elsewhere in the same file).
  A consolidation pass is recommended; it was not attempted here to avoid corrupting a file every session loads.
* `isSegmented` in `downloadService.ts` consults URL suffixes as a fallback, which sits uneasily with the "nothing decided
  from a URL string" rule. Documented as-is; not changed (source is the authority).
