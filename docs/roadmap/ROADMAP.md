# Roadmap — open work register

**Single source for what is not finished.** Built work lives in [`docs/done/`](../done/); the evidence for each status is in [`docs-audit-2026-10-20.md`](./docs-audit-2026-10-20.md). When an item ships, move its line to the audit's done list and delete it here. Do not keep the same status in a second place.

Written 2026-10-20 to the review standard in `.claude/skills/cs3-architecture-simplifier/SKILL.md`: facts with a file reference, one severity scale, and the simplest next step for each item.

## 1. Context

Requirement: finish the PRDs that are partly built, decide the ones that are not started, and keep the docs true to the code. Shipped behaviour is in `AGENTS.md`. Most open items are scope decisions, not code defects.

## 2. Requirement coverage

| Item | Source | Status | Evidence |
|---|---|---|---|
| Playback telemetry | [40.1](./40.1-playback-reliability-observability-and-routing-baseline.md) §4.3 | Built; checked in the app 2026-10-23 | One record per session: opened at prepare, ended by the player's `media:reportPlayback` (first frame, play time, seeks, stalls; `player/playbackStats.ts`), else by `close` or the next prepare. Tests fail with the supersession or the late-report rule removed. Checked in the built app (scratch profile): a dead link recorded as `fatal-error`, a public test clip as `completed` with first frame 820 ms, both shown in Settings → Playback sessions. Not yet seen from a real film in the player. Open: lease refreshes and reconnects (needs the Part D resolver), mpv runtime |
| Lease refresh acceptance | 40.1 §6 DoD | Not measured | `sourceLease.ts` is wired (`playbackEngine.ts`, `mediaProxy.ts`) but has no resolver, so it never refreshes; the 2-hour / zero-403 check cannot pass until Part D of the Playback Source Resolution PRD supplies one |
| Extension platform standard | [41](./41-desktop-extension-platform-and-community-standard.md) | Pending | Nothing built (§6–23) |
| Native standards (superseded) | [39](./39-native-extension-and-playback-standards.md) | Superseded by 41 | Header and index say so (2026-10-23) |
| Resume continuity | [42](./42-resume-continuity-and-seekable-sources.md) | Partial | `resumePoint.ts`, `playedSource.ts` built. The PRD now points at `resumePoint.ts` (fixed 2026-10-23) |
| Source & provider expansion | [43](./43-source-and-provider-expansion.md) | Partial | Items 1–4 built (`nativeProviders/*`); later items not started |
| UX & developer research | [44](./44-user-and-developer-experience-research-and-roadmap.md) | Partial | Startup profile and inspector built; §6–8 not built |
| New source integration | [45](./45-new-source-integration-movies-series-documentaries.md) | Partial | §6–7 not built |
| Platform catalogue discovery | [53](./53-research-platform-catalogue-discovery.md) | Partial | `ottService` discovers platforms and pins; the PRD still says "nothing built" |
| Trailers & provider verification | [55](./55-media-sources-discovery-ux-trailer-and-provider-verification.md) | Partial | `videoTitles.ts`, `youtube.ts`, `TrailerPopup.tsx` built; the rest is unchecked |
| Subtitles requirements | 2026-10 subtitle note | Partial | `subtitles/*` built; requirements not checked one by one |
| Search sources panel | 2026-10 panel UI/UX | Partial | Guided view and profile bar shipped; decisions below are open |
| Provider test harness | 2026-10 providers-support-testing | Pending | Names eight files that do not exist: `attribution.ts`, `budget.ts`, `diff.ts`, `quirks.ts`, `schema.ts`, `sourceSniff.ts`, `stageResult.ts`, `test.mts` |
| Unverified notes (five) | `unverified/` | Unverified | Not checked against the code. Errors backlog, session handoff, PRD-CloudStream meta, source-discovery priority, and PRD 40 (duplicates 37) |
| High-performance search results | [2026-10 High-Performance Search Results](./2026-10-High-Performance%20Search%20Results%20and%20Large-Scale%20Rendering.md) | In Progress | Phases 1–3 built (coalesced emissions, stable card keys + memoization, virtualized grid in `SearchView.tsx` via `searchVirtualGrid.ts`). Unit tests pass; measured 2026-10-23 in the built app (scratch profile, 17 extensions, query "batman": 247 titles from 17 sources): streaming in, 2 long tasks totalling 182 ms (worst 91 ms) over about 20 s; scrolling the whole grid (11,840 px, 99 frames) frame p50 17 ms, p95 36 ms, max 54 ms (1 frame over 50 ms), 0 long tasks, at most 42 posters mounted, about 1,030 DOM nodes. Measure with `--disable-renderer-backgrounding --disable-backgrounding-occluded-windows`: a hidden window gets no animation frames, so the virtual window never moves. Not measured: a search returning thousands of rows. |
| Multi-audio switching (viewer report, 2026-10-21) | — | Built, not run in the app | Direct MP4/WebM with several dubs: the menu sent every pick to the forced conversion (mpv or a software encode). Now the element switches in place (`AudioVideoTracks`, measured 440 → 880 Hz in Electron 43), else a remux with `preferredAudioIndex`; live tracks enabled by id alone. Tests: `audioTrackSwitch.test.mts`, `decisionEngine.test.mts`, `playbackEngine.test.mts`, each failing on the old code. Open: DASH via Shaka has no audio selection; `ExtractorLink.audioTracks` (separate audio files) is read and never played, though no community provider in `repositories/` sets it. Next: play a real dual-audio provider link in the app |
| Playback source resolution: priority, match verification, viewer feedback | [2026-10 Playback Source Resolution (canonical, v2)](./2026-10-Playback-Source-Resolution-Priority-Match-Verification-and-Viewer-Feedback-2.md) | In Progress | **Phase 1 built 2026-10-21, not run against live providers.** (1) The persistent walk's widening (`widenAndContinue`) offers what it finds (`widened`, phase `searching`: the overlay's Play now / Choose source) instead of starting it; `playNow` skips sources that already failed (`playbackFailover.test.mts`, fails with the old auto-start restored). (2) The widened provider search judges each hit before taking the first two (`cs3/providerHitMatch.ts`: IMDb id, season, movie/series, year, sequel tokens, title similarity); refused hits land in `filtered` with the reason; unreadable titles (another script, anime romaji) are kept as `unknown`. Labelled set: 15 cases over every §13.1 category, each rule mutation-checked; written by hand, **not yet drawn from real `searchEach` answers** (do that before tuning `SAME_TITLE`). Fixed 2026-10-23: a hit named *Blade Runner 2049* with no year read as *Blade Runner* (`parseReleaseTitle` dropped every four-digit number; now only the year it took, and any number on one side only is another instalment; each half mutation-checked). **Part A, first step built 2026-10-21:** the JVM's one FIFO worker pool is two lanes (`RpcLanes.java`: sources = `providerLoad`, `providerLoadLinks`, `load`, control calls; background = search, main page, everything else), so a detail page's or a Play press's lookups no longer queue behind a search fan-out or catalogue rows; replies carry `queuedMs`, provider latency excludes it, and waits ≥ 1 s log `rpc_queued`. Measured first, from 14 local logs: 84 discoveries, p50 3.5 s, p90 84 s, max 213 s, but no log could tell queue wait from provider time (both clocks start at submission), which is why the lanes ship with the measurement. Next for Part A: read `rpc_queued` from real sessions; host-side gates (pausing the search fan-out, catalogue refresh and extension updates while playback resolves) only if it still shows waits. **Phase 2, first step built 2026-10-23:** the widened provider search walks ranked batches (played-for-this-work first, then the ranking; 4, then search-concurrency-sized) inside 45 s and stops at the first verified source; a second Find more sources asks everyone (`exhaustive`). Checked against 19 providers in the built app; the early stop is unit-tested only. **Per-card statuses built 2026-10-23:** each provider's answer per work is kept (`cs3/providerAttempts.ts`: sources 6 h, no sources 24 h, wrong match 7 d, error 10 min; 1,000 rows; per profile; not written in incognito; erased with Viewed titles and results), joined into `interactions:summarise` as `attempt`, and drawn as a dot beside the card's provider (`attemptMark.ts`; sources found only for this launch). Seen in the built app (Batman: Gotham Knight, five providers marked). Not built: retry and inspect actions on the card, a stored search-mode setting. Earlier finding (2026-10-21): standard-mode playback auto-started widened results; the widened provider search took each provider's first two hits with no identity check (`contentService.ts:1658`); ranking counts a wrong film that plays as a success; no priority between playback and background work. Phase 1 (stop auto-starting unverified results) fixes the reported bug without scheduler work. Validation also found: a one-at-a-time walk of this machine's 506 providers is about 1 h 56 min, so discovery must be ranked, batched and time-budgeted; and `SourceLease` is wired but inert (no resolver), so Part D is largely supplying one |
| Content validation, source verification, provider reliability | [2026-10 Content Validation](./2026-10-Content-Validation-Source-Verification-and-Provider-Reliability.md) | Proposed; Phase 0 audit done 2026-10-23 | Audit maps every PRD area to existing code (`mediaSanity.ts`, `providerHitMatch.ts`, `failureTaxonomy.ts`, `botChallenge.ts`, `indexerBudget.ts`, `providerAttempts.ts`, `playbackTelemetry.ts`) and names the gaps: no pre-play duration check, no update/login/HTML-page categories, no rate-limit backoff or breaker for extension providers, global rather than per-provider concurrency. Baselines still to measure |
| Renderer data layer and fetch patterns | [analysis, review and migration plan](./2026-10-Renderer-Data-Layer-and-Fetch-Patterns.md) | Proposed (for review) | No data-fetching library: 567 `window.cloudstream` calls across 82 renderer files, about 284 `useEffect`s, and no cancellation across IPC. Inventory of 14 fetch patterns with replace/adapt/keep verdicts. TanStack Query fits the renderer; the main-process scheduler (playback PRD Part A) is still required for priority. Nothing built; not measured in Electron |

## 3. Findings by severity

### High

**H0. Wrong content plays automatically in standard mode.** After a source fails, the session widens to every provider and starts what it finds; the widened search takes each provider first two hits without checking they are the requested work. See the Playback Source Resolution PRD (v2), Phase 1; its section 1.1 lists 19 claims checked against the code. It needs no scheduler change to fix.

**H1. Search sources panel: one decision left.**
- Fixed 2026-10-21: the chips were rebuilt from the selected providers after every change, so ticking Movies ticked Series and every language, and NSFW ticked a dozen languages. Customize's filter rail also rewrote the selection, presets went dark right after being picked, and a preset picked over a named profile overwrote it. Chips are now stored intent (`languages`/`contentTypes` on the profile or draft), the rail only filters, presets are chip sets, and quick setup shows one line ("Sources in Hindi that carry Movies. Searching 12 of 300."), the option chosen over an Apply step. Pure half tested and mutation-checked (`sourceScopeModel.test.mts`); not yet exercised in the running app.
- Decision needed: what "set as default" means (launch profile, or the profile new searches start from). The model has no default concept (`electron/cs3/sourceProfiles.ts`).

**H2. PRD 40.1 playback telemetry: wired and readable (2026-10-23).**
- Done: `PlaybackEngine` opens one record per session at prepare; `VideoPlayer` reports what the element measured (`media:reportPlayback`) when it leaves the stream, which ends the record (`completed` only when the film ended). Without a report, `close` or the next prepare ends it; a late report amends. The `moduleReachability` allow-list is empty.
- Readable: `media:getPlaybackDiagnostics` carries `telemetry` and `summary`; Settings → Everything → Playback sessions draws them. Checked in the built app with IPC-driven prepares (dead link → `fatal-error`; test clip → `completed`, 820 ms first frame).
- Open: lease refresh counts (no resolver yet, Part D) and mpv runtime (no element events). Next: play a real film in the player and check that its row has a first frame and stalls.

**H3. Closed 2026-10-23.** 39 carries "Superseded by 41" in its header and in `PRD/00-index.md`. Original finding: **PRD 41 vs 39: two standards, one is already superseded.**
- What: 39 says "superseded by 41" and 41 is pending. Keeping both invites someone to implement the wrong one.
- Simpler alternative: keep 41; mark 39 superseded in the file header and in the index; do not delete (both are cited from `AGENTS.md`).

### Medium

**M1. Closed 2026-10-23** (the PRD now names `resumePoint.ts`). **PRD 42 named a file that does not exist** (`cs3/seriesContext.ts`). The furthest-episode rule is in `resumePoint.ts` (AGENTS §9). Fix the reference in the PRD; no code change.

**M2. Partly closed 2026-10-23:** `AGENTS.md` §13 no longer lists PRD statuses and points here. Still repeated: each PRD's own "Filed" stamp and the 2026-10-20 audit. **Status in four places.** The same status is written in the audit, in each PRD's stamp, in the `AGENTS.md` §13 table and in this file. They will drift.
- Simpler alternative: this file is the status; the audit keeps only the evidence; `AGENTS.md` §13 links here and does not repeat statuses.

**M3. Closed 2026-10-23** (40 is marked superseded by 37 in its header). **PRD 40 duplicates 37.** Same title and contract. Mark 40 superseded by 37 in its header; do not delete.

**M4. Closed 2026-10-23:** 56 sidecar `@Test` methods; 20 `case` labels are 19 adapters (`1337x` has an alias). Both recounted in `AGENTS.md`. **Sidecar test count and indexer count drift.** `AGENTS.md` says 19 indexer adapters; `indexerRegistry.ts` has 20 `case` labels. Measure once and write the number with its date.

### Low

**L1. Closed 2026-10-23:** all 12 now link to upstream GitHub at the submodule commit (eb962b4f; every target checked to exist there). **Twelve broken links in `docs_cs3/android/08` and `09`.** They point at upstream Android files (gradle, `.github/`, fastlane) not in this repo. Remove them or link to upstream.

**L2. The five unverified notes** (`unverified/`). Each needs one decision: verify, or delete with its content already recorded in the audit.

## 4. Simplification opportunities

- One status register (this file) replaces four status records (M2).
- Done PRDs need no status stamp beyond "done, see audit"; drop the stamp body text once the register is authoritative.
- `docs/roadmap/` holds one file per PRD (about 10). Pending PRDs that have no work scheduled could be merged into a single "parked" section with a link each.

## 5. Proposed structure

```
docs/done/            built PRDs (stamped "Done")
docs/roadmap/
  ROADMAP.md          this register: open items, severity, next step
  docs-audit-…md      evidence for statuses
  <PRD>.md            partial or pending PRDs (the specification)
  unverified/         not yet checked
```

## 6. Verification for each item when it is closed

- [ ] Requirement met, checked against the shipped code (not the PRD text)
- [ ] Module is reachable: a caller exists outside tests (`moduleReachability.test.mts` passes without an allow-list entry)
- [ ] Any new IPC channel changes all four sides (AGENTS §4)
- [ ] `docs/agents/*.md` and `AGENTS.md` updated in the same change
- [ ] The line is removed from this file and the PRD is moved to `docs/done/`

## 7. Decision

**APPROVED WITH REFACTOR REQUIRED.** The status set is correct, but it is written in four places (M2), and two items (H1, H2) need a product or code decision before the next change. Fix M2 first; it stops the other records drifting.
