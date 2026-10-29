# Work summary: branch `feat/26-10-misc-updates` (2026-10-20 → 2026-10-29)

**What this is.** One record of everything built, fixed, measured and documented on this branch, grouped by topic. Each item names its commit, the files that matter, how it was checked, and what was *not* checked. Status of each PRD still lives in `ROADMAP.md` (AGENTS §13); this file is the history behind those rows.

**Scale.** 107 commits since `master` at `cecd99f`; 220 files changed, +18,521 / −1,153 lines:

| Area | Files | Lines added | Lines removed |
|---|---|---|---|
| `desktop/electron` | 108 | 7,515 | 294 |
| `desktop/src` | 65 | 4,384 | 769 |
| `docs` | 29 | 4,522 | 50 |
| `tools` | 7 | 1,771 | 2 |
| `sidecar` | 4 | 177 | 6 |
| `.github` | 2 | 106 | 3 |

- **Tests:** fast suites went from 160 (2026-10-21) to **197**, all passing. `tsc -b` is clean at the branch tip `9dce815`.
- **Not pushed:** nothing has been pushed to `master`.

**Rules followed throughout:**
- One task per commit.
- Every pure decision has a `*.test.mts`, and each new rule was mutation-checked: the test fails with the rule removed.
- "Checked in the built app" means it was run there. "Unit-tested" means only that.
- Live runs used the scratch userData profile, never the developer's own.

Legend: ✅ checked in the built app or live · 🧪 unit-tested only · ⚠️ not run against the real case.

---

## 1. Search

### 1.1 Results at scale (High-Performance Search Results PRD, *In Progress*)

- **Coalescing and virtualisation** (`a89d58a`, `b5f157c`, `6750bd8`):
  - `searchSession.ts` coalesces `search:update` emissions to 150 ms windows. The opening plan and the final snapshot are never delayed.
  - `searchVirtualGrid.ts` bounds how many cards are mounted, and keeps a focused card mounted even outside the overscan.
- **Scroll fixes** (`7c25192`):
  - `overflow-anchor: none` on the viewport and grid.
  - CSS grid columns follow the JS column count.
  - The layout effect no longer re-runs on every scroll frame.
  - Start and end rows are clamped, so the last rows stay mounted at the scroll limit.
  - The coalescing throttle could be bypassed; that is fixed.
- **Measured in the built app** (`803a83a`) ✅: 247 titles from 17 sources.
  - While results stream in: 182 ms of long tasks.
  - Scrolling the whole grid: frame p95 36 ms, 0 long tasks, at most 42 posters mounted.
  - Measurement trap: a hidden window gets no animation frames, so the virtual window never moves.
- **Research doc:** architecture and bottlenecks (`4e54f24`).

### 1.2 Search Sources panel (H1 closed)

- **Chips are stored intent** (`226252a`) 🧪:
  - The bug: ticking Movies also lit Series and every language, and the NSFW preset lit a dozen languages.
  - Now `search:setScope` carries `languages`/`contentTypes`, and `intentFromSnapshot` reads them back.
  - A chip selects `providersForIntent`: any-of within a row, all-of across rows. A combination nothing matches is refused.
  - Customize's rail only filters the list.
  - Presets are chip sets; the active one is derived (`matchingPreset`).
  - A summary line states the scope ("Sources in Hindi that carry Movies. Searching 12 of 300.").
  - 19 tests.
- **Default search profile** (`79e65f0`): `profiles:setDefault`; a launch opens with that profile. Deleting it, or choosing All sources, clears it.

### 1.3 Results screen

- **Live TV tab** (`35eb653`): IPTV and radio rows leave All whenever anything else was found. Home keeps them.
- **Right-click menu** (`472fe42`) ✅: Save to Plan to watch; for a provider row, hide its results, leave the provider out of the sources, or turn it off.
- **Ask <provider> again** (`5d2eb9e`): forgets that provider's answer for the work (`interactions:forgetAttempt`) and opens the title.
- **"Also returned by these sources"** (`1ef36f0`) ✅: a framed panel with a six-poster preview and Show all N.
- **Provider answers on cards** (`17fb37a`) ✅:
  - `cs3/providerAttempts.ts` records each provider's answer per work: sources, none, wrong match, or no answer.
  - Per viewer profile, never in incognito, each outcome with its own expiry.
  - A card shows a dot with the reason in the tooltip.
- **Torrents in All** (`8bb7369`): raw torrent rows also leave All when anything else was found.
- **Search mode setting** (`ec90e0e`): Settings → General → Search mode (`cs3_discovery_mode`).
  - *Best providers first* (default): the ranked walk.
  - *Search all providers*: every widen is exhaustive.

## 2. Playback source resolution (PRD v2, *In Progress*)

| Part | Commit | What changed |
|---|---|---|
| Phase 1a | `6cc8d96` | When every origin source failed, widened results are **offered, not auto-started**; they could be a sequel or a trending film. Tests: 7 pass, and 2 fail with the old auto-start restored. |
| Phase 1b | `ccd2e1b` | `cs3/providerHitMatch.ts` judges each widened hit: match / mismatch / unknown. Refused hits go to `filtered` with the reason. 15 labelled cases; removing any of the 7 rules fails a named case. ⚠️ Not yet checked against live provider answers. |
| Year fix | `3510238` | "Blade Runner 2049" no longer reads as "Blade Runner": only the year taken is stripped, and a number on one side alone counts as another instalment. |
| Phase 2a | `b35cb24` | The widened search is a ranked walk (`cs3/discoveryWalk.ts`): played-for-this-work providers first, batches of 4 then of the search concurrency, a 45 s budget, and an early stop on a judged match. Find more sources then becomes exhaustive. Also fixed a double widen in `refresh`. ✅ run against 19 providers; the early stop is unit-tested only. |
| Phase 2b | `17fb37a`, `5d2eb9e`, `ec90e0e` | Provider attempts, Ask again, and Search mode (§1.3). |
| Provider pinning | `f0126b1` | Play on provider B's page never starts what last played through provider A (`playedThroughProvider`). ⚠️ |
| Episode identity | `54227ce` | Two causes of "Episode 2 plays Episode 1": a missing episode fell back to the series page, and a season pack trusted the file of the episode it was found for. Both rules are in `cs3/episodeMatch.ts`. ⚠️ No series provider was available. |
| Page recovery | `bd44628` | Recovering a failed page never swaps a film for a series of the same name. |
| Part D: link refresh | `acae8af` | `cs3/linkOrigins.ts` plus `ContentService.linkResolver`. A link that expires mid-film (401/403) is asked for again from the same provider handle, and only the *same* link is accepted. Built-in providers and cached links have no resolver. ⚠️ Not run against a real expiry. |

**Sidecar and request plumbing behind it:**
- **JVM worker lanes** (`01bd2e9`, `RpcLanes.java`): *sources* and *background* lanes, so a Play press's `loadLinks` no longer waits behind a search fan-out.
  - Every reply carries `queuedMs`; `providerLatencyMs` subtracts it, and waits of 1 s or more log `rpc_queued`.
  - Measured before the change: 84 discoveries, p50 3.5 s, p90 84 s.
  - `RpcLanesTest` fails with one shared lane. `mvn package`: 56 tests pass.
- **Shared `loadLinks`** (`5e964ca`): identical in-flight calls share one provider request; each caller gets its own copy of the list.
- **Per-provider slots** (`c73a756`, `cs3/providerSlots.ts`): at most 4 background requests per provider. Opening a page and a Play press never queue. The wait is added to `queuedMs`.

## 3. Content validation and provider reliability (PRD, *Partial*)

- **Phase 0** (`0d79912`): maps each PRD area to the code that already covers part of it.
- **Phase 1** (`81e6189`): `contentValidation.ts` answers two separate questions.
  - Identity: validated, likely, unverified, possible mismatch, or confirmed mismatch.
  - Playability: playable, restricted, temporarily unavailable, or invalid.
  - A missing length is *unverified*, never a rejection.
  - `mediaSanity` delegates to it with identical thresholds; its 8 tests are unchanged.
- **Phase 2** (`fca83dd`) ✅: an HTML answer where media was expected is classified (`nonMediaResponse.ts`) as an update notice, a sign-in page or a web page, and the source is marked dead. A 429 is named as a rate limit.
- **§9.1 warning** (`2431981`) ⚠️: a stream far shorter than the title shows one banner (Choose another source / Keep watching). Playback is never stopped for it.
- **Phase 4 cooldown** (`08de431`, `cs3/providerCooldown.ts`): 2 transient failures in a row → 1, 5, 15, 60 min. A paused provider is reported as paused and never charged to analytics.
- **§5.4** (`9bb3e32`): a source the probe already measured as a clip is skipped *before* it plays.
- **Skip reasons on rows** (`499a8e3`): `playback:skipSource(id, reason, verdict?)` carries the reason (`src/utils/sourceVerdict.ts`), and the source row shows it.
- **Phase 5a** (`7b93d64`):
  - `cs3/validationCounts.ts` counts skip states per provider: counters only, nothing in private mode.
  - New ranking criterion **Right content**.
- **§11** (`6843b38`): telemetry records whether the viewer kept watching past a mismatch warning.

## 4. Player and media

- **HLS audio inside segments** (`e7bccfb`): the segment read retries once before giving up; the read timeout is 8 s. A read that fails is not stored as a measurement.
- **Audio track switch in place** (`3ad5489`, `player/audioTrackSwitch.ts`):
  - The `AudioVideoTracks` Blink feature is enabled. Measured in Electron 43: without it the API is absent; with it a two-track file switches 440 → 880 Hz in place.
  - The cheapest route is chosen: live track → nothing → remux with `preferredAudioIndex` → forced conversion only for unmeasured contents.
  - `preferredAudioIndex` joined the capability cache key.
  - ⚠️ Not played through a real provider link.
- **PRD-40.1 telemetry** (`2197370`, `e16bbf5`, `9f9ca78`) ✅:
  - One record per session.
  - `VideoPlayer` reports first frame, play time, seeks and stalls (`player/playbackStats.ts`).
  - Settings → Everything → **Playback sessions**. Checked against a dead link (`fatal-error`) and a test clip (`completed`, 820 ms to first frame).
- **Source lists grouped by provider** (`9186661` picker, `e4893b6` player) ✅: foldable sections, jump chips, Expand/Collapse all. Checked on Inception's 102 sources.
- **Torrent that never starts** (`39ffd13`, `player/torrentStall.ts`): before the first frame, no peers and no data for 20 s (or a stall flag) hands over to the next source once. ⚠️
- **"File not ready"** (`ad35314`): its own torrent state, with "Getting the start of the file · 40%".
- **Saved playback** (`ac1aba7`) ✅: it also lands in Watching, Continue watching and History.

## 5. Library, bookmarks, detail page

- **Bookmark titles** (`81df07a`, `36ad242`): every saved page gets a readable title (`bookmarkTitle`, `usableTitle`), and old rows are repaired on read.
- **Poster placeholder bug** (`36ad242`): an empty placeholder once covered the whole window and swallowed clicks. Fixed with `:where(:has(> .poster-image--empty)) { position: relative }`.
- **Detail page on failure** (`2f1c974`): when the provider page fails, the search card's poster, title and metadata stay in the masthead, with Find again / Back / Copy.
- **Resume** (`1ebf802`): a saved link with no stated deadline is tried first while discovery runs alongside. A film's resume waits at most 4 s for the provider page.
- **Shelf order** (`6fc4641`): Watching, Plan to watch, Completed, On hold, Dropped, from one `BUCKET_ORDER`.
- **Library card** (`32cc502`): an × on the poster corner to remove the title, and a saved-sources chip on the poster.
- **Saved pages** (`a95c925`): a re-save moves the page to the top (`updatedAt`).

## 6. Profiles, privacy and adult content

- **Adult detection** (`b3b7837`, `64a232a`): "ecchi" no longer blocks mainstream anime. Adult types and URL path segments are detected, and adult content can be enabled from the gated detail page.
- **Per viewer profile** (`dd8efc9`): the adult mode, Do Not Ask Again, the session unlock and blur, and incognito are kept per profile and pushed again on a switch.
- **Blank-window fix** (`4faf44d`) ✅: the profile context (`AsyncLocalStorage`) leaked into the renderer bundle and the window stayed blank. `main.ts` now passes `currentProfileId` into `PrivacyMode` instead.

## 7. Extensions, regions and providers

- **Newly published extensions** (`b424f95`, `cs3/newExtensions.ts`): the scheduled check installs what a maintainer adds to a repository the viewer installed from.
  - A repository's first look only records its list.
  - An uninstalled extension never returns.
  - Status-0 and adult-only plugins are skipped and logged.
  - ⚠️ Not run against a live repository change.
- **Bulk bar** (`913bb3b`) ✅: one line with nothing ticked; Turn on / Turn off / Uninstall N with a selection; the rest under More.
- **Shared services** (`7d62ea8`, `cs3/sharedServices.ts`): switching Internet Archive off applies to every provider of that service.
- **Regions** (`1ccbe8c`, `cs3/languageMatch.ts`): the "Matches your languages" ranking criterion is now measured, and torrent ranking takes the regions' languages until the viewer sets their own.

## 8. Torrents (Torrent and Magnet Link PRD, *Partial*, audited `f43e470`)

- **Seeder counts** (`f29ab7f`): an unreported count is `seedersUnknown`, not 0. Only a known zero is rejected, and an exact title outranks a close one.
- **Folding** (`8bb7369`): 5 torrents beside streams, 8 when torrents are all there is. Copies of the same release (same name and resolution, size within 1 %) fold behind it. Nothing is removed from fallback.
- **History** (`9e774ba`, `4700128`): a History row reopens `torrent://<infohash>/<fileIndex>` and resumes it, re-importing a removed torrent from its magnet or through the DHT.
- **Failure kinds** (`c41d0e9`, `58f64bf`, `torrent/torrentFailure.ts`): a closed set of kinds, each with its pipeline stage; logged as `torrent_play_failed` and `torrent_start_failed`.

## 9. Downloads (Download Progress PRD, *Partial*)

- **Per-file progress** (`60c6146`): each torrent download task reads its own file's stats. Speed is smoothed, so the ETA stops swinging. ⚠️ Not run against a real download.
- **Choose episodes** (`895d2c9`, `src/components/downloads/episodeSelection.ts`): episodes across seasons, each with its own quality, plus a filter (`s2e3`, `2x03`, name). ⚠️ No series page was available.
- **Attempt tokens** (`332511d`, `download/attemptTokens.ts`): a paused or replaced transfer can no longer change its task.

## 10. App updates (App Update PRD, Phases 1–3 built)

- **Phase 1** (`32c2c93`):
  - `releaseSelection.ts` reads the channel from the tag and compares by semver, then date.
  - `AppUpdateService` checks at most once a day with `If-None-Match` and backs off on 403/429.
  - A notice, plus Settings → About & support → App updates.
  - ✅ Checked live against GitHub: up to date, twice. The notice itself was not seen, since no newer release exists.
- **Phase 2** (`094d8db`): `.github/workflows/beta.yml` (manual, `master` only) calls `release.yml`, which is now callable. Versions look like `1.1.0-beta.<date>.<run>`; the newest 5 betas are kept. ⚠️ Not run on GitHub.
- **Phase 3** (`2e24d7b`): the download is verified against `SHA256SUMS.txt` through `FastChunkDownloader`, and Install runs only a verified file. 🧪

## 11. Provider Compatibility Audit (the last PRD, *Partial*: S0–S10 built and run live)

**Goal:** a repeatable, evidence-based check of every installed community provider, through the app's own code paths.

### 11.1 Pure core (`4552292`, `desktop/electron/cs3/audit/`)

| Module | What it does |
|---|---|
| `schema.ts` | Stages S0–S10; closed sets of outcomes, reasons and owners; journal-line validation; redacted URL and header shapes; `printable()` |
| `stageResult.ts` | Journal reduction (a resumed run rewrites, never adds), deepest stage, §6.3 verdict, conservation |
| `attribution.ts` | Who owns a failure |
| `sourceSniff.ts` | Body classes from magic numbers |
| `budget.ts` | Byte caps, `ByteMeter`, `HostLimiter` |
| `quirks.ts` | Detectors for N-1…N-17 |
| `diff.ts` | Run comparison, including `NOT_COMPARED` and `FLAKY` |
| `stageEvidence.ts` | What each sidecar reply means |
| `networkEvidence.ts` | `judgeSite`, `judgeReach` |
| `mediaEvidence.ts` | `judgeInspection`; `judgeRoute` over 8 machine profiles |
| `playbackEvidence.ts` | Tier choice, `judgePlayback`, `fmp4MediaSeconds` |

All mutation-checked: 22/22 (core), 11/11 (network and media), 11/11 (playback).

### 11.2 Runner (`65f2af3`, `tools/audit/provider-audit.mjs`, `bun run audit:providers`)

- **Modes:** `list`, `full`, `target`, `resume`, `report`, `diff`.
- **Flags:** `--offline` (S0–S6) and `--verify none|element|ffmpeg|mpv|all`.
- **Isolation:** archives are copied into `runs/<id>/work/`, so the profile is never touched.
- **JVM heap:** the app's own rule (`cs3/jvmHeap.ts`). At 768 MB, AniSnatch ran out of memory and was wrongly called broken.
- **Output:** a journal (one fsync'd line per stage), `summary.md`, `causes.json`, `extractors.json`, `providers/*.json`.

### 11.3 Network worker (`981b7f9`, `tools/audit/net-worker.cjs` + `net-client.mjs`)

- **What it is:** headless Electron with a throwaway userData and an in-memory session. It uses Chromium's `net`, with the app's referrer policy and user agent.
- **Control channel:** a token-guarded loopback port, because Electron's main process has no usable stdin on Windows. `ELECTRON_RUN_AS_NODE` must be deleted, not blanked.
- **Redirects:** `session.fetch` refuses `redirect:'manual'`, so redirects are read from `onBeforeRedirect`.
- **Streaming:** source bodies **stream** (`op: stream`), counted per chunk. At the cap the socket is destroyed, never ended. A fixed-slice cut had read as end-of-file: a false `app-gap`, fixed in `9dce815`.

### 11.4 Stages

| Stage | What it does |
|---|---|
| S0 | Discover the archive |
| S1 | Load |
| S2 | Site: one GET of `mainUrl`, cached per host |
| S3 | Catalogue |
| S4 | Round-trip search on a title the provider listed |
| S5 | Detail |
| S6 | Links |
| S7 | Reach: HEAD, a one-byte range, a 64 KB read, a Referer/UA differential |
| S8 | Inspect: the shipping `MediaProxy` + `MediaInspector`, 16 MB cap |
| S9 | Route: `decideStrategy` on 8 profiles, checking AC-3/DTS-never-DIRECT and DRM-never-ffmpeg |
| S10 | Play, opt-in, 32 MB and 12 s per tier, 2 s of playhead to pass (`9dce815`) |

S10's three tiers:
- **element:** `<video>`/hls.js in a hidden window (`play.html`).
- **ffmpeg:** the `MediaTranscoder`, timed by the media seconds in its fMP4 output.
- **mpv:** `--vo=null --ao=null`, read over its IPC pipe.

### 11.5 Verdict rules learned from live data

- A failed S2 is `site-down` only when no content stage passed (CineStream's API host 404s at its front page).
- A `mainUrl` of `NONE` skips S2.
- "Not logged in" is `skipped: needs-credentials`.
- A failed S10 on the app's own route is `app-gap`.
- The runner sets up ffmpeg as `main.ts` does (`-extension_picky`, `zscale`). Without it, every HLS conversion failed.

### 11.6 Live results (scratch profile, 17 archives, 19 providers)

| Run | Time | Verdicts |
|---|---|---|
| S0–S6 | 391 s | 12 reached links |
| S0–S9 | 524 s | compatible 11 · walled 3 · extraction-only 2 · plugin-broken 2 · site-down 1 |
| S0–S10, `--verify all` | 551 s | verified-playback 11 · walled 3 · plugin-broken 2 · extraction-only 1 · site-down 1 · compatible 1 |

- **Bytes:** playing 12 sources read 99.5 MB, at most 15.1 MB for one. S8 read 15.5 MB in all.
- **Secrets:** grepping the run output for tokens and signatures found 0 matches.
- **Not built:** fixture origin (§12.2), expectations file, `retry-failed`, `--webview`, `--torrents`; DASH and EME routes in S10.
- **Not investigated:** AllWish's `net::ERR_FAILED`, and Animexin's `levelParsingError`.

## 12. Documentation and roadmap housekeeping

- **PRDs and plans filed or updated:**
  - Playback Source Resolution, v1 and v2.
  - Content Validation (with its Phase 0 audit).
  - Download Progress and Series Batch.
  - App Update Notifications.
  - EXT Torrents and Torrent/Magnet.
  - Extension Reliability roadmap.
  - Renderer Data Layer / TanStack Query plan.
  - Provider ranking canary scorecard.
- **Roadmap closures:**
  - H1: default search profile.
  - H3, M1, M3, M4: superseded headers, the PRD 42 file name, recounts.
  - M2: PRD status kept in `ROADMAP.md` only, partly.
  - L1: upstream Android links pinned to GitHub at submodule `eb962b4f`.
  - L2: the five `unverified/` notes checked against the code.
- **Field notes and AGENTS:**
  - `fn:extensions` gained "The provider audit's first live runs", with the S0–S9 and S10 sections.
  - AGENTS.md was kept current with each change: IPC rows, rules, the audit entry and §5 rules.
- **Chores:**
  - Android submodule and `cloudstream-extensions-uk` updated.
  - Shim jar rebuilt twice.
  - `.freebuff/project-id` ignored.

## 13. What is open (from this work)

- **Playback source resolution:** labelled-set checks against live provider answers; a resolver for built-in providers and cached links; a measured lease refresh.
- **Content validation:** the rest of Phase 5 and the viewer-feedback parts.
- **Audit:** the items in §11.6, plus §12 of its PRD.
- **Not exercised in the app:** episode identity, batch episode picker, torrent stall hand-over, the update notice and download, beta CI, audio switch on a real link, and new-extension install. Each is marked ⚠️ above.
- **Proposed only:** EXT Torrents, PRD 41 (extension platform), Renderer data layer.
