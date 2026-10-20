# PRD: Playback Source Resolution, Foreground Prioritization, Content Verification, and Provider Feedback Ranking

**Status:** Proposed  
**Priority:** Critical  
**Scope:** CS3 Desktop playback, source discovery, provider scheduling, content matching, source refresh, and provider ranking  
**Implementation approach:** Incremental, measurable, and backward-compatible
**Canonical document:** this PRD supersedes [the first version](./2026-10-Playback-Source-Resolution-Priority-Match-Verification-and-Viewer-Feedback.md). Its unique material is carried into §1.1, §5.9 to §9.8, §10.6, "Phase 7 detail" and Appendix A.  
**Validated against the code:** 2026-10-21 (§1.1). Register: [`ROADMAP.md`](./ROADMAP.md).

## 1. Executive Summary

CS3 can return hundreds or thousands of results across enabled extensions and providers. A single title may appear multiple times because different providers return their own catalogue entries for the same content.

The application currently has two related problems:

1. **Playback waits behind background activity.** Provider calls, metadata enrichment, extension updates, catalogue refreshes, prefetching, and other network tasks compete for shared resources. When a user presses Play, the requests required to start playback should take priority.
2. **Automatic source discovery can return unrelated content.** When the selected title has no playable sources, the application searches additional providers. Some providers return trending, related, or incorrectly matched titles. If those results are treated as valid playback candidates, a user who selected *Charlie (2015)* could receive a stream for a completely different movie.
3. **Provider ranking can reward incorrect results.** A provider may successfully deliver a video without delivering the requested movie. Technical playback success must not be treated as proof of content identity.
4. **Expired and one-time links can interrupt playback and downloads.** Some providers issue temporary URLs or links that work only once. CS3 needs to recover by obtaining a fresh source when possible, without forcing users to navigate back and repeat the entire process.
5. **Users cannot easily communicate whether a source is correct.** A lightweight feedback mechanism should allow users to flag a wrong title or confirm a useful source. That feedback should improve future source selection without interrupting playback.

This PRD introduces five coordinated capabilities:

- A foreground-aware request scheduler that prioritizes the content the user is actively trying to play.
- A content-identity verification pipeline that prevents unverified fallback results from starting automatically.
- Sequential provider discovery as the default fallback strategy, with visible per-provider attempt status and a configurable alternative for searching all providers.
- Automatic source refresh and recovery for expired links, failed requests, and single-use URLs.
- A discreet user feedback and provider-ranking system that distinguishes content correctness from technical playback success.

**Core principle:** CS3 must prioritize the content the user requested, not merely the first source that returns a playable video.

The baseline findings below were validated against the current source on 2026-10-21; the evidence, line references and verdicts are in §1.1.

### 1.1 Validation against the code (2026-10-21)

Every baseline claim in this PRD was checked against the repository on 2026-10-21. Verdicts: **Confirmed** (the code does this), **Partly** (some of it exists), **Unverified** (no evidence either way; Phase 0 must settle it), **Not built** (does not exist). Line numbers are for the tree as read; re-check them before editing.

| # | Claim in this PRD | Evidence | Verdict |
|---|---|---|---|
| C1 | The persistent fallback can start unrelated content (§2.1, §6.7) | Standard-mode sessions are persistent: `desktop/src/App.tsx:1385` (`persistent: !isDeveloper`). `playbackSession.ts:741` `widenAndContinue` sets scope `all` and calls `beginStream(candidates, { failover: true })`. The rule "a self-widened result is offered, never auto-started" exists only on the empty-result path, `playbackSession.ts:491–495` (`if (session.widened) return;`) | **Confirmed** |
| C2 | Fallback provider results are not verified against the requested work (§2.1, §6.3) | `desktop/electron/contentService.ts:1658`: `for (const match of extMatches.slice(0, 2))` takes the first two hits of each provider and calls `extensionSources(match.url, …)`. The only filters are the `cs3ext://` scheme and "already asked through a route". Torrent indexers, by contrast, get `expectedYear` and the ranker (`contentService.ts:1612`) | **Confirmed** |
| C3 | Technical success is treated as identity (§1 item 3, §9.4) | `providerRanking.ts:199` `playback-success` is "a link … actually delivered video", weighted highest; a source is recorded as played after 10 s (`PlayedSource`). The only identity evidence on a playing stream is runtime: `src/utils/mediaSanity.ts:28–39` (expected ≥ 20 min, actual < 6 min and < 15%) | **Confirmed** |
| C4 | Playback waits behind other work (§2.2, §5.1) | JVM RPC workers are a bounded first-come pool (`sidecar/.../Main.java:33`, `newFixedThreadPool(max(2, cores))`) with no priority field; one fan-out is capped at 8 (`pluginManager.ts:663`), **per fan-out**, so concurrent fan-outs multiply it; `ResilientFetch` has no limiter, per-host cap or priority (`main.ts:921`, `networkResilience.ts:253`) | **Confirmed** (mechanism). The size of the delay is **Unverified**: nothing records queue wait today |
| C5 | Speculative work can be promoted instead of duplicated (§5.3, §5.8) | `SourcePrefetcher` waits 1.2 s (`sourcePrefetcher.ts:47`) and runs one at a time; `ContentService.getSources` shares in-flight runs; `sharedDiscovery.ts` cancels by consensus. There is **no priority concept** to promote | **Partly** (sharing exists; promotion does not) |
| C6 | The new modules are new (§10.5) | `electron/cs3/requestScheduler.ts`, `workMatch.ts`, `feedbackStore.ts` do not exist. `electron/util/startupQueue.ts` is a priority-and-lanes queue, a pattern to follow, but a one-shot startup queue, not reusable as is | **Not built** |
| C7 | Sequential discovery can be the default fallback (§4.4, §7.1) | One-at-a-time is expressible: `searchEach` concurrency is a setting, `cs3_provider_search_concurrency`, 1 to 32 (`pluginManager.ts:663–666`). **But not as a literal one-by-one walk of every provider.** Measured on this machine's own analytics, 506 providers: mean search latency p50 9.0 s, p90 32.8 s, p99 58.2 s (these means include failures and timeouts, and were recorded under today's contention). Summed, one at a time ≈ **6,958 s (1 h 56 min)**; in groups of 8, ideally ≈ **870 s (14.5 min)** | **Partly.** Workable only as ranked, early-stopping, time-budgeted batches (§7.9) |
| C8 | Per-work, per-provider attempt history exists or is easy (§4.3, §7.7) | Today: aggregate counters per provider and stage (`providerAnalytics.ts`, no work key, by design) and a per-address outcome ledger (`titleOutcomes.ts`: `played`, `no-sources`, `app-error`), joined per card by `interactions:summarise` (`titleInteractions.ts`). **No record says "provider P was tried for work W and returned X"** | **Not built.** Needs a new bounded store (§10.6) |
| C9 | Cards can show per-provider status, including "Sources found" (§4.2) | `src/utils/cardState.ts` states the rule "**failure is always marked and success almost never is**". A permanent "Sources found" mark contradicts it | **Partly conflicting.** Reconciled in §4.2 note below |
| C10 | Expired or one-time links can be refreshed without going back (§8) | Pieces exist, none joined for playback. `SourceLease` (`media/sourceLease.ts`: `maxRefreshes 4`, `minIntervalMs 30 000`) wraps every prepare (`playbackEngine.ts:235`) and the proxy tries it on 401/403 (`mediaProxy.ts` ~1100), **but the only `new SourceLease` passes no `resolve` function, so `refreshSource()` throws "not refreshable" and the original error falls through.** `PlaybackSession.refresh()` (`playbackSession.ts:653`) is manual. Downloads already recover: `isRecoverableError` (`downloadService.ts:920`: expired token, 401, 403, 404, 410, reset, timeout, range mismatch, 5xx) and `resume` re-resolves the source (`DownloadAction.Recovering`, `:523–531`) | **Partly.** Downloads yes, playback no |
| C11 | Some links are single-use and a probe consumes them (§8.4) | No code mentions single-use handling. The playback path inspects (probe or segment sniff) and then plays: at least two fetches of the same address. The provider issue ledger (1,500 distinct issues) records causes `network` 404, `unreadable-reply` 254, `provider-error` 231, `unknown` 182, `timeout` 132, `resource-leak` 129, `runtime-unavailable` 113, `blocked` 40, `not-found` 11; **no `expired`** | **Unverified.** No evidence that any provider does this. Do not build single-use logic before Phase 0 finds a case |
| C12 | A sidecar priority field is a contract change (§5.5) | The RPC frame is the contract; any change bumps `RUNTIME_GENERATION` (currently 17, `electron/cs3/runtimeProvisioner.ts:202`) and needs a sidecar contract test (AGENTS §3.5) | **Confirmed** (constraint) |
| C13 | Transport priority hints may help (§5.6) | Electron 43.4.0 declares `priority` (`throttled` … `highest`) on `ClientRequest` options (`electron.d.ts`). The app fetches with `net.fetch` (`main.ts:921`); whether `net.fetch` honours a hint is not documented there | **Unverified.** Design must not depend on it |
| C14 | Aliases and alternate titles can feed `WorkIdentity` (§6.2) | AniList provides `alternateTitles` (synonyms) and `originalTitle` (`metadata/anilist.ts:204–205, 416–423`). For films and series, alias lists from Cinemeta, TVmaze or Wikidata are **not fetched today** | **Partly** (anime yes; others need a fetch or hit-side tolerance) |
| C15 | Feedback can follow profile, Incognito, backup and erase rules (§9.6) | Per-person keys `profiles/profileKeys.ts` (`PERSONAL_KEYS`); erase areas `cs3/userDataReset.ts`; backup table `cs3/backupService.ts` and `backup/datastoreCategories.ts`; write-time Incognito check `cs3/privacyMode.ts` `isPrivateSession()` | **Confirmed** (all available as the PRD describes) |
| C16 | The ranking can take new dimensions (§9.4–9.5) | `providerRanking.ts`: criteria are table rows (id, weight, sample floor, function to `0..1` or `null`; `null` is excluded from the denominator); smoothing toward a neutral prior exists | **Confirmed** |
| C17 | Existing matchers can seed Gate 1 (§6.3) | `torrent/releaseParser.ts` `normaliseTitleForMatch`, `titleSimilarity` (token-set); `cs3/titleEnricher.ts` scoring with `STRONG_MATCH 0.86`, `MATCH_WITH_YEAR 0.72` (`:50`, `:53`), year and type terms (`:235–238`); `searchMerge.ts` identity keys. The Search screen already filters "Also returned" rows with `resultGroups.ts` (`isRelevant`) | **Confirmed.** Reuse; do not add a third copy of the rule (§6.10) |
| C18 | Per-card status fits the search grid (§4.2, §7.6) | The grid is now virtualised (`SearchView.tsx` `VirtualCardGrid`, keys from `searchVirtualGrid.ts` `cardKeyOf`); only about a screenful of cards is mounted | **Confirmed** (constraint): status must come from the batched summary keyed by `cardKeyOf`, never one IPC call per card |
| C19 | No labelled data exists to tune matching (§12 Phase 0, §13.1) | Diagnostics record failures, never identity errors; the ledger has no "wrong title" cause | **Confirmed.** The golden set must be assembled deliberately (§15) |

**What this validation changes in the plan**
1. Part C's default must be *ranked, batched and time-budgeted* sequential discovery, not a literal one-provider-at-a-time walk (C7, §7.9).
2. Part D is smaller than it reads for downloads (already built) and is mostly **supplying a resolver to the existing lease** for playback (C10, §8.8). The single-use branch is held until evidence exists (C11).
3. Per-card status needs a policy that agrees with `cardState.ts` (C9).
4. Gate 1 and the Search screen's relevance filter must become one function (C17).
5. Earlier project notes said the lease "refreshes expired signed URLs". It does not: it is wired but inert (C10). AGENTS §4.3, §6 and `docs/agents/media.md` §6.11 were corrected on 2026-10-21.

## 2. Problem Statement

### 2.1 Incorrect content is offered or played

Consider this scenario:

1. A user searches for *Charlie (2015)*.
2. Search results contain several cards returned by different providers.
3. The user opens the correct title and reviews its details.
4. The selected provider does not return any playable sources.
5. CS3 automatically searches other enabled providers.
6. Some providers return unrelated films, trending content, remakes, sequels, or generic search fallbacks.
7. CS3 treats those results as playback candidates without sufficiently verifying their identity.

The user may then receive a stream that plays successfully but contains the wrong film.

This is a correctness failure, not merely a search-quality problem. Playback should never silently substitute a different work just because it is available.

### 2.2 Background activity delays playback

The application performs multiple kinds of work simultaneously:

- Playback source discovery and link resolution.
- Search across extensions and providers.
- Detail-page metadata retrieval.
- Catalogue and homepage refreshes.
- Extension and repository update checks.
- Source prefetching.
- Download and torrent activity.
- Subtitle discovery.
- History and library enrichment.
- Analytics and maintenance tasks.

These tasks do not have equal urgency. A request needed to start the video currently requested by the user has a much stronger latency requirement than a background extension update.

### 2.3 Provider results lack a unified outcome model

A provider can:

- Return the correct title and valid sources.
- Return the correct title but no sources.
- Return an unrelated title.
- Return a correct-looking result with broken links.
- Return a valid link that has expired.
- Return a link that works for playback but fails during downloading.
- Fail because of a network issue, provider outage, or unsupported format.

These outcomes must be recorded separately. Otherwise, provider reliability scores become misleading and users cannot understand what happened.

## 3. Goals and Non-Goals

### 3.1 Goals

- Prioritize active playback requests over nonessential background requests.
- Stop or demote obsolete work when the user changes the selected title.
- Prevent unverified fallback candidates from starting automatically.
- Preserve access to all available results without silently discarding uncertain candidates.
- Make sequential provider discovery the default fallback behavior.
- Show users which providers have been attempted and what happened.
- Allow users to retry or refresh failed and expired sources automatically when possible.
- Improve provider rankings using correctness, reliability, and user feedback as separate signals.
- Keep feedback controls discreet, optional, and accessible.
- Instrument each stage so performance and correctness improvements can be measured.

### 3.2 Non-Goals

- Do not reduce the set of enabled providers searched merely to improve latency.
- Do not silently disable providers because they have low scores.
- Do not remove search results solely because a provider has low historical reliability.
- Do not require users to rate sources before watching.
- Do not automatically switch to an unrelated title to avoid displaying a no-source state.
- Do not introduce a community-wide ranking service in the initial implementation.
- Do not change provider extension formats unless a specific compatibility requirement makes it unavoidable.
- Do not guarantee recovery when a provider is offline, a link has been revoked, or no valid source exists.

## 4. User Experience

### 4.1 Source discovery from a selected result

When a user selects a title from search results or opens its detail page, CS3 should retain the selected title's canonical identity and provider origin.

When the user presses Play:

1. Promote any existing source-discovery operation for the same title to foreground priority.
2. Start or continue source discovery for the selected title.
3. Attempt sources returned by the selected provider first.
4. If those sources fail or no sources are returned, start the configured fallback strategy.
5. Verify fallback results against the requested title before resolving their links.
6. Automatically start only candidates that satisfy the applicable confidence policy.
7. Present uncertain matches in a source-selection interface with clear identity labels.
8. Continue to show progress and cancellation controls while discovery is running.

The user should not have to repeat the search or navigate back to the detail page to recover from an unsuccessful provider.

### 4.2 Per-provider status on search-result cards

The existing search interface displays multiple cards for the same title, each associated with a different provider. Extend this interface with a compact provider-attempt status indicator next to the title or provider attribution.

Illustrative states:

| State | Meaning |
|---|---|
| Not checked | CS3 has not attempted source discovery for this card. |
| Checking | The provider is currently being queried. |
| Sources found | The provider returned one or more candidate sources. |
| No sources | The provider responded successfully but returned no usable sources. |
| Wrong match | The provider returned content that failed identity verification. |
| Temporary error | The attempt failed because of a timeout, network problem, or provider error. |
| Expired source | A previously obtained source was determined to be expired or unusable. |
| Refreshed | CS3 obtained a replacement source successfully. |

Use small, restrained icons and tooltips rather than large labels that clutter the poster grid.

A status must not imply that a source is playable merely because the provider returned a URL. Source discovery, content identity, and playback validation are separate stages.

**Policy note (validated 2026-10-21, see §7.9):** the app already follows "failure is always marked and success almost never is" (`src/utils/cardState.ts`). So *Checking*, *No sources*, *Wrong match*, *Temporary error*, *Expired* and *Refreshed* are marked, and *Sources found* is shown only during the session in which discovery ran, as the quietest state, never as a permanent badge.

### 4.3 Persist provider-attempt outcomes

CS3 should retain useful attempt information so that users and the application can understand previous failures.

For each attempt, record the provider, canonical work key, outcome, timestamp, and relevant failure category. Where practical, retain a short-lived status for the search session and a bounded history for diagnostic and ranking purposes.

Do not persist raw URLs, credentials, session cookies, or sensitive request headers in general analytics.

The application must distinguish:

- An attempt that has never occurred.
- An attempt that returned no sources.
- An attempt that returned an incorrect title.
- An attempt that failed technically.
- A successful discovery whose link later expired.
- A source that was actually played and verified.

Previous failure must not permanently prevent a retry. Provider results and temporary links can change.

### 4.4 Search modes

Add a setting that controls the fallback discovery strategy.

**Sequential provider search, default**

Attempt providers in ranked order, one at a time or in small controlled batches where parallelism is beneficial. Verify each provider's results before moving to the next provider. Stop early when an acceptable source is available and the configured policy permits it.

**Search all providers**

Attempt all eligible providers using bounded concurrency. Continue collecting results progressively. Do not automatically play uncertain results. Every candidate must pass the same identity and source-validation rules regardless of discovery mode.

The sequential mode is the default because it reduces unnecessary work and makes the discovery process easier to understand. Search-all mode remains available for users who prefer broad coverage or when sequential attempts do not find a suitable source.

Both modes must support cancellation, progress reporting, and access to all results collected during the session.

## 5. Part A: Foreground-Aware Request Scheduling

### 5.1 Why scheduling is necessary

Improving individual provider response times will not solve the problem if playback requests wait behind unrelated work.

CS3 needs a shared scheduling policy that controls when work starts, how much concurrency it consumes, and whether it still matters to the current user interaction.

Priority must be attached to the user's intent and current context, not permanently assigned to a provider.

### 5.2 Priority classes

| Priority | Class | Examples |
|---|---|---|
| P0 | Active playback | Source discovery after Play, link resolution, required stream probes, manifests and segments, selected-source recovery |
| P1 | Foreground navigation | Current detail page, active search, visible catalogue content |
| P2 | Speculative | Source prefetch, next-episode preparation, near-viewport catalogue content |
| P3 | Maintenance | Extension updates, hidden catalogue refreshes, library enrichment, analytics flushes |
| Bulk | Throughput-oriented | Downloads, torrent transfers, and other long-running transfers |

P0 must receive preferential access to shared resources. P1 should remain responsive while P0 is active. P2 and P3 must not consume all available capacity needed by foreground work.

Downloads and torrent transfers need a separate bandwidth policy because request scheduling alone cannot prevent a saturated connection from slowing playback.

### 5.3 Foreground context

Maintain a central context representing the current user activity.

Conceptually:

`ForegroundContext { kind, workKey, sessionId, startedAt }`

Possible context kinds include playback, detail, search, browse, and idle.

Each scheduled operation carries:

- Its priority class.
- Its owning session or task.
- The canonical work key when applicable.
- An abort signal or cancellation token.
- Its enqueue timestamp and operation type.

When a user moves from title A to title B, new playback work for B becomes the foreground priority. Queued work for A must not continue starting as P0.

If an operation is already running and cannot be safely cancelled, its result must be ignored if it no longer belongs to the active context. Where cancellation is supported, cancel it or demote it according to the operation's lifecycle.

### 5.4 Shared scheduler

Implement a main-process request scheduler that coordinates provider calls, indexer calls, and other supported network operations.

Requirements:

- Maintain queues by priority.
- Apply global and per-provider concurrency limits.
- Reserve sufficient capacity for active playback.
- Prevent every concurrent fan-out from independently consuming its own full concurrency allowance.
- Support cancellation of queued work.
- Support context-aware promotion and demotion.
- Prevent starvation by allowing maintenance work to progress when foreground capacity is available.
- Record queue wait time, execution time, and cancellation reasons.

Concurrency budgets must be calibrated from measured baselines. Avoid hard-coding unverified values as permanent performance targets.

### 5.5 JVM and sidecar scheduling

The main-process scheduler cannot guarantee priority if provider requests have already entered a first-come, first-served JVM queue.

If measurements confirm this bottleneck, extend the sidecar RPC contract with a backward-compatible priority field. Older messages should retain their existing default behavior.

The JVM worker pool should select queued work according to priority and reserve capacity for urgent playback requests where necessary.

Do not interrupt an already-running provider operation solely because a higher-priority operation arrives unless that operation has a safe cancellation mechanism. Prioritize queued work first.

Any RPC contract change must update the runtime generation/version and associated contract tests.

### 5.6 Network scheduling

Extend the shared network layer to support:

- Bounded global concurrency.
- Per-host concurrency.
- Priority-aware queued requests.
- Abort signals.
- Request deadlines.
- Consistent retry classification.
- Queue and network timing instrumentation.

Playback-critical manifest and segment requests should not be trapped behind nonessential requests to the same host.

Native transport priority hints may be used if supported, but the design must not depend on undocumented or unverified behavior.

### 5.7 Downloads and bandwidth

Playback and downloads share network capacity. When playback is active, downloads may need to yield bandwidth.

Introduce an optional, measured download-throttling policy that can reduce background transfer rates during active playback and restore them afterward.

Do not silently change download behavior without an explicit, understandable setting. The initial implementation should establish a baseline before enabling aggressive throttling by default.

### 5.8 Acceptance criteria

- Playback source discovery receives preferential scheduling under defined background load.
- P95 time to first acceptable source under background load is targeted at no more than 1.25 times the idle baseline, subject to confirmation after baseline measurements.
- Queued P0 work for a title the user has left does not start unnecessarily.
- A speculative request for the same title can be promoted rather than duplicated.
- Maintenance work eventually progresses when foreground demand subsides.
- Scheduler metrics identify which queue or resource is responsible for excess latency.

### 5.9 Code anchors and feasibility (validated 2026-10-21)

**Where each piece attaches**
- **One funnel for provider work.** Every extension call goes `PluginManager` → `cs3/sidecarSupervisor.ts` (`pending` map). That is the single place to tag a class and a context before a frame is sent.
- **One funnel for third-party HTTP.** `setHttpFetch((input, init) => resilientFetch.fetch(input, init))` (`main.ts` ~935) is the only entry; the queue belongs inside `ResilientFetch` (`networkResilience.ts:253`).
- **The context is already known in main.** `playback:start`, `search:start` and `api:loadMedia` each create or identify the interaction (session ids). `ForegroundContext` can be set there with no renderer change; the renderer only needs to say when a screen is left.
- **Cancellation already flows.** `ContentService.getSources` takes `options.signal` and checks it per provider (`contentService.ts` ~1648); `sharedDiscovery.ts` cancels by consensus and never joins an aborted run. The scheduler adds queued-work cancellation; it does not invent cancellation.

**Reuse, do not duplicate**
- `electron/util/startupQueue.ts` already expresses *priority numbers and named lanes with serial-by-default*. Model the scheduler's classes on it, but it is a one-shot startup queue, so it is a pattern, not a dependency.
- The "8 in flight" cap and its setting (`cs3_provider_search_concurrency`, `pluginManager.ts:663–666`) move under the scheduler as a *global* budget; the user-visible setting keeps its meaning ("Providers searched at once").
- `cs3/searchOrder.ts` `applySearchOrder` already orders providers by measured health and refuses an ordering that is not the same set. The scheduler must not reorder providers; it only decides *when* a call starts.

**Feasibility and constraints**
- A sidecar priority field changes the RPC frame: bump `RUNTIME_GENERATION` (17 → 18) and add a sidecar contract test (C12). Older frames default to normal priority.
- `net.fetch` priority is **unverified** (C13); the queue must work without it.
- **Bandwidth yielding is new work.** `aria2Engine.ts` has no runtime rate-limit call today. aria2 documents `aria2.changeGlobalOption` (`max-overall-download-limit`), so it is feasible, but the HTTP fallback downloader and yt-dlp would each need their own throttle. Off by default until measured.
- **The latencies in this PRD were recorded under today's contention.** Phase 0's idle-versus-loaded comparison is therefore the first thing to build; budgets before it are guesses.

## 6. Part B: Content Identity and Source Verification

### 6.1 Core rule

**A source that plays is not necessarily a source for the requested title.**

CS3 must distinguish between a technically playable stream and a stream whose identity matches the selected work.

The identity checks apply to automatic fallback discovery. A source explicitly selected by the user must remain accessible, but the UI should still show known identity warnings and must not silently relabel it as verified.

### 6.2 Work identity

Build a canonical `WorkIdentity` once per playback session.

Conceptually:

`WorkIdentity { titles, year, type, season, episode, externalIds, runtimeMinutes, languagePreferences }`

Include the best available information from the selected search result and existing metadata services:

- Display title.
- Original title.
- Known translated and alternate titles.
- Release year.
- Media type.
- Season and episode where applicable.
- External IDs when available.
- Expected runtime when reliable.
- Language preferences when specified.

If metadata is incomplete, retain the title and type information that is available. Missing metadata should lower confidence rather than fabricate certainty.

### 6.3 Gate 1: Verify provider search hits

Before resolving links from a fallback provider, compare its result against the requested `WorkIdentity`.

Evaluate:

- Normalized title similarity against available aliases.
- Year agreement.
- Media type agreement.
- Season and episode agreement.
- Sequel, part, chapter, and numbered-franchise markers.
- External IDs when both sides provide them.
- Known alternate or regional titles.

Reject clear identity conflicts. Do not reject a candidate solely because optional metadata is absent.

A provider that returns unrelated trending content must not have those results silently treated as matches.

Record a rejection reason for diagnostics. A provider returning no matching results should be classified separately from a provider that failed to respond.

### 6.4 Gate 2: Verify resolved source metadata

Even a correct provider result can expose unrelated links. Where a provider returns multiple links, parse available source names, release names, or other identifying metadata and compare them against the requested work.

Check for:

- A conflicting title.
- An incompatible release year.
- A different sequel or part.
- A different season or episode.
- A multi-title or compilation page where the requested work cannot be established.

A URL by itself is not evidence that the underlying media matches the selected title.

### 6.5 Gate 3: Verify media evidence

Use available technical evidence after resolving or opening a source:

- Runtime plausibility.
- Container metadata when it contains a title.
- Known stream metadata.
- Language information when relevant to the user's selection.
- Existing media-sanity checks.

Runtime disagreement should generally reduce confidence rather than independently reject a legitimate extended edition, theatrical cut, or regional version.

Do not introduce invasive content analysis or claim that media identity has been verified when the application has only checked basic stream properties.

### 6.6 Confidence states

Every candidate should have a consistent confidence classification.

| Confidence | Meaning | Automatic fallback behavior |
|---|---|---|
| Verified | Strong identity evidence supports the requested work | May start automatically if technically playable |
| Probable | Evidence supports the match but important identity data is missing | Offer for selection, except where an explicitly defined and tested policy allows automatic use |
| Unverified | Insufficient evidence to establish identity | Never start automatically |
| Mismatch | Evidence conflicts with the requested work | Exclude from automatic playback and clearly label if retained for inspection |

The default policy should be conservative: automatically start verified fallback candidates only. A candidate selected explicitly by the user can be opened after the user sees its identity and any known warning.

If the chosen provider returns a source, preserve the user's ability to play it, but do not pretend that the source is verified if evidence contradicts the selected title.

### 6.7 Persistent fallback behavior

Update the persistent playback fallback path so that it follows the same identity rules as every other path.

The sequence must be:

1. Attempt the selected provider's sources.
2. If unsuccessful, begin fallback discovery according to the configured mode.
3. Verify provider hits before resolving their links.
4. Verify resolved source metadata when available.
5. Rank eligible candidates by identity confidence first.
6. Automatically start only candidates permitted by the confidence policy.
7. If only uncertain candidates remain, stop automatic playback and show the source-selection interface.
8. Clearly explain that no verified match was found.

Example:

"No verified source found for Charlie (2015). We found 3 possible matches. Review them before playing."

Do not automatically play an unrelated movie merely because it is the first result.

### 6.8 Preserve result coverage

Identity verification must not become a reason to silently discard every uncertain result.

Keep uncertain results available where useful, label their actual matched title, and allow users to inspect them. Continue searching eligible providers when the selected strategy requires broader discovery.

The system must preserve provider coverage while separating verified candidates from uncertain ones.

### 6.9 Acceptance criteria

- Zero unverified or mismatched fallback candidates start automatically.
- Every rejected candidate has a diagnosable reason.
- Correct alternate-language titles can pass identity verification.
- Missing years and optional metadata do not automatically invalidate legitimate matches.
- Sequels, remakes, different media types, and different episodes are tested explicitly.
- Providers that return no matching title are not penalized as technically broken.
- The explicitly selected provider remains usable, subject to normal source errors and visible identity warnings.

### 6.10 Code anchors and feasibility (validated 2026-10-21)

**Where each gate attaches**
| Gate | Insertion point |
|---|---|
| 1, search hit | `contentService.ts:1658`, before `extensionSources(match.url, …)`. Replace `slice(0, 2)` with "hits above the accept threshold, best first" |
| 2, resolved source | After the fan-out merge into `deduped` (`contentService.ts` ~1690), using `releaseParser` on each source's name |
| 3, media | Extend `src/utils/mediaSanity.ts` (it returns reject/accept today; it must return a confidence adjustment as well) and the unplayable path `onSourceUnplayable` |
| Policy | `playbackSession.ts:741–787` (`widenAndContinue`): filter candidates, stop before the first one that may not start; `:495` (`session.widened`) keeps its rule; `MAX_AUTO_ADVANCES = 2` (`:44`) and `WIDEN_SETTLE_MS = 1_500` (`:54`) stay the walk's bounds |

**One matcher, not three.** The Search screen already hides "Also returned" rows with `src/utils/resultGroups.ts` (`isRelevant`, the exact-match flag), `titleEnricher` scores catalogue hits, and `searchMerge` groups on IMDb id or title+year. `workMatch.ts` must be the single function all three call, because two places computing the same verdict will disagree in front of one viewer (the simplifier skill's rule). Start from the existing helpers and constants (`normaliseTitleForMatch`, `titleSimilarity`, `STRONG_MATCH 0.86`, `MATCH_WITH_YEAR 0.72`), and treat the numbers as starting points to tune on the golden set, not targets.

**Types.** `TorrentResult` already carries `scoreReasons` (`src/types/torrent.ts:167`). Add `matchConfidence` and `matchReasons` beside it; this is an IPC type change, so all four sides change together (AGENTS §4.1).

**Feasibility**
- Aliases (C14): AniList supplies synonyms; for films and series the alias list is not fetched today. Either add one cheap lookup per session (Wikidata aliases) or make Gate 1 tolerant on the hit side (compare against display and original titles only, and let "Probable" cover the gap). Decide in Phase 0 from the golden set.
- A provider whose search is exact but whose catalogue uses a different regional title will land at **Probable**. Under §6.6 that is *offered, not started*, which is the intended cost of the conservative policy.
- The explicitly chosen provider is exempt from the hard rule (§6.1) and gets labels only.
- **No labelled data exists** (C19), so thresholds cannot be validated yet. The first deliverable of Phase 1 is a small, hand-labelled set of (query, provider hit, expected verdict) from real provider answers (`searchEach` outcomes), including the "trending fallback" and sequel cases named in §13.1.

## 7. Part C: Sequential Provider Discovery

### 7.1 Why sequential discovery should be the default

The current search interface may show many cards for the same work, each originating from a different provider. Searching every provider immediately can waste requests, increase network contention, and expose more incorrect fallback results.

Sequential discovery provides a controlled way to determine which providers can supply the requested work while preserving broad coverage.

It should not mean that every provider is always called one after another regardless of usefulness. Provider order should be informed by measured reliability, historical identity accuracy, previous results for the work, and technical compatibility.

### 7.2 Provider selection and ordering

Construct the candidate provider queue using:

1. The provider associated with the selected result.
2. Sources previously verified for the same work, where available.
3. Provider performance for the relevant media category.
4. Historical content-match accuracy.
5. Technical success and source freshness.
6. A neutral exploration policy for providers without sufficient history.

Ranking must not cause a provider to disappear from the search. It controls attempt order, not permanent eligibility.

### 7.3 Sequential workflow

For each provider:

1. Check whether the task is still relevant to the active playback context.
2. Check whether the result can be reused safely from cache.
3. Query the provider.
4. Normalize and verify returned title candidates.
5. Resolve links only for eligible candidates.
6. Validate available source metadata.
7. Record the outcome and latency.
8. Add usable candidates to the result list.
9. If an acceptable source is available, apply the configured stop-or-continue policy.
10. If no acceptable source is found, proceed to the next provider.

The user should see progressive status updates instead of waiting for the entire provider list to finish.

### 7.4 Stop conditions

Sequential discovery can stop early when:

- A verified, playable source is available and the configured policy allows early completion.
- The user cancels discovery.
- The user changes the selected work and the previous task is no longer relevant.
- The session reaches a configured deadline or resource budget.

If no acceptable source exists, continue through eligible providers according to the selected strategy. A temporary error should not be treated as proof that a provider never has the title.

### 7.5 Search-all mode

When search-all mode is enabled:

- Use bounded global concurrency.
- Verify every candidate before automatic playback.
- Stream results progressively.
- Keep per-provider status visible.
- Prevent a single slow provider from blocking already completed results.
- Apply cancellation and stale-context protections.
- Preserve every valid result that the application has collected.

Search-all mode must not bypass identity verification.

### 7.6 Per-card provider state

The search-result interface should make it possible to understand the status of each provider without requiring a user to open every card.

Provide:

- A small status icon next to the title or provider attribution.
- A tooltip or accessible label explaining the state.
- A way to retry a failed attempt.
- A way to inspect the matched title and rejection reason.
- A clear distinction between "sources found" and "verified playable source".

Keep the existing compact visual style. Status indicators should not overwhelm poster artwork or compete with the primary navigation.

### 7.7 Attempt history and cache

Store provider attempt outcomes with an appropriate expiry policy.

- Successful source discovery may be cached, but temporary links must obey their own freshness and reuse constraints.
- No-source results should have a shorter expiry than stable metadata.
- Network failures should use a short retry cooldown.
- Wrong-match results can be retained as ranking evidence but must not permanently blacklist a provider for the work.
- A new search session can refresh stale outcomes.
- Explicit retry must be available where the user wants another attempt.

Cache keys must include the canonical work identity and provider identity. Do not reuse a source simply because its title string matches.

### 7.8 Acceptance criteria

- Sequential search is the default fallback mode.
- Provider attempts and results update progressively.
- All eligible providers remain reachable through sequential discovery or the optional search-all mode.
- A provider's unrelated result never bypasses the identity gates.
- Cancellation stops queued attempts and prevents stale results from altering the current playback session.
- Provider attempt statuses remain accurate across retries and source refreshes.

### 7.9 Code anchors and feasibility (validated 2026-10-21)

**The arithmetic that shapes the design.** From this machine's analytics (506 providers; search-stage mean latency including failures): p50 9.0 s, p90 32.8 s, p99 58.2 s. A literal one-at-a-time walk of every provider is about 6,958 s; in groups of 8 about 870 s. Sequential discovery is therefore only viable as:

1. **A ranked queue** in the order of §7.2: the selected provider; routes already known for the work (`ContentService.alternateRoutes`); providers whose source previously played for this work (`PlayedSource`, `cs3/playedSource.ts`); then `applySearchOrder` and the ranking.
2. **Small batches inside the ranked queue** (for example the first batch is the selected provider plus its known routes; later batches of 4 to 8), so a slow provider does not hold up a fast one behind it.
3. **A time budget per widening session**, after which the player shows what it has and offers "Keep looking". The existing `MAX_AUTO_ADVANCES` and `WIDEN_SETTLE_MS` bounds show where that decision already lives.
4. **Early stop on the first Verified source** (§7.4), the case that makes ranked batches cheap in practice.

Both modes use the same gates; "search all" is the same queue with the configured global budget and no early stop.

**Per-card status**
- The grid is virtualised (C18). Status must come from the batched `interactions:summarise` join (`titleInteractions.ts`, `useTitleInteractions.ts`) keyed by `cardKeyOf`, never one call per card.
- **Policy reconciled with `cardState.ts`:** statuses *Checking*, *No sources*, *Wrong match*, *Temporary error*, *Expired* and *Refreshed* are marked, because failure is always marked. **"Sources found" is not a permanent badge**: it is shown only during the session in which discovery ran, and as the quietest state. A title that has played keeps the existing dimming, never a badge.
- `deadRows.ts` hides `no-sources` rows and never hides `app-error`. A **Wrong match** from one provider must not hide the title; it describes a candidate, not the work. Define `wrong-match` as a source-level verdict that is not a title outcome.

**Attempt history**
- Nothing per work exists (C8). The new `ProviderAttempt` store holds work keys, so it is **personal data**: profile-scoped (`profileKeys.ts`), bounded, expiring, erasable, and never in installation-level aggregates.
- Reuse the expiry ideas already in `sourceCache.ts` (links carry deadlines read from the URL; short TTL otherwise) rather than inventing new numbers; see §7.7 for what must differ (no-sources shorter than metadata, network failures a short cooldown).

**The setting**
- "Search mode" is a fallback strategy and is separate from the existing "Providers searched at once" setting; do not merge them. Add it to the datastore categories (`backup/datastoreCategories.ts`) so backup carries it.

## 8. Part D: Automatic Source Refresh and Recovery

### 8.1 Problem

Some providers return URLs that are short-lived, session-bound, or intended for a single use. A source can be valid when discovered but fail later when playback or downloading begins.

The user should not have to return to the search screen, reopen the title, and manually repeat source discovery whenever a recoverable link failure occurs.

### 8.2 Recovery workflow

When a selected source fails:

1. Classify the failure.
2. Determine whether the failure is recoverable by refreshing the source.
3. Check whether a fresh link is already available and safe to reuse.
4. If not, request fresh sources from the originating provider using the existing content-service flow.
5. Preserve the original `WorkIdentity` and re-run identity verification.
6. Prefer a fresh source matching the same work and variant.
7. Retry playback or download within a bounded recovery budget.
8. If recovery fails, present the source-selection interface and explain what happened.

Do not retry indefinitely, repeatedly invoke an unresponsive provider, or silently switch to unrelated content.

### 8.3 Failure classification

| Failure category | Expected behavior |
|---|---|
| Expired or invalid direct URL | Refresh the source and retry within the recovery budget |
| HTTP 401 or 403 | Check whether session or required request context can be refreshed; otherwise report access failure |
| HTTP 404 or removed resource | Attempt fresh source discovery if appropriate |
| Temporary network error | Retry with bounded backoff where safe |
| Provider timeout | Mark the attempt as a timeout and continue according to the discovery strategy |
| Unsupported media format | Use a supported playback or conversion path if available; otherwise offer another source |
| Invalid or inaccessible media | Re-probe or refresh where appropriate, then move to the next eligible candidate |
| User cancellation | Stop recovery immediately |
| Wrong title | Reject the candidate; do not treat the problem as a temporary link failure |

HTTP status alone does not always establish that a link is expired. Some providers use access restrictions, anti-bot responses, or session requirements. Recovery logic should use available evidence and avoid repeating the same failed request without a meaningful change.

### 8.4 Single-use link handling

A source may be consumed when first requested. CS3 must not assume that every discovered URL can be probed, played, and downloaded repeatedly.

Requirements:

- Preserve provider-specific headers and session context where needed.
- Avoid unnecessary probes that consume single-use URLs.
- Track whether a link has already been used when the provider's behavior is known.
- Prefer re-resolving a fresh URL instead of replaying a consumed one.
- Do not share single-use URLs between independent playback and download operations unless the provider explicitly supports that behavior.
- Ensure refresh requests are associated with the same work and source variant.
- Redact credentials and sensitive URL parameters from logs.

### 8.5 Recovery limits

Define configurable limits for:

- Maximum refresh attempts per playback attempt.
- Maximum time spent recovering a source.
- Retry backoff.
- Maximum provider retries within a session.
- Duplicate failure suppression.

Defaults should be established through testing and telemetry rather than arbitrary assumptions.

When the limit is reached, stop retrying and show a useful error with the option to select another source or retry manually.

### 8.6 Playback and download integration

Playback and download should use a shared source-refresh capability where technically appropriate, but maintain independent operation state.

A failed download must not unexpectedly interrupt a working playback session. A failed playback attempt must not corrupt a download's source state.

Both flows must verify that a refreshed source still belongs to the requested work.

### 8.7 Acceptance criteria

- Recoverable expired-link failures trigger automatic refresh without requiring the user to repeat navigation.
- Refreshed sources pass the same identity checks as newly discovered sources.
- Retry limits prevent infinite loops.
- User cancellation prevents additional refresh attempts.
- Single-use URLs are not unnecessarily consumed by probes or duplicate operations.
- Unsupported formats and permanent provider failures produce clear fallback behavior.

### 8.8 Code anchors and feasibility (validated 2026-10-21)

**What exists and what is missing**

| Need | Exists | Missing |
|---|---|---|
| Classify a failure | `failureTaxonomy.ts` has `expired`, `blocked` (401/403), `not-found`, `timeout`, `network` (`:74–110`); `playbackRecovery.ts` classifies *transport* failures (refetch within a budget versus hand to another engine) | A `wrong-title` cause; a mapping from player and proxy errors to these causes |
| Re-resolve a source | `ContentService.extensionSources`, `PlaybackSession.refresh()` (`playbackSession.ts:653`, manual), `PlayedSource.pickReplacement` (same release, fresh link, `cs3/playedSource.ts:96`), `pickSibling` (same provider required, `:120`) | An automatic call from the failure path, keyed to the **variant** that failed |
| Refresh inside a running stream | `SourceLease` with budget (`maxRefreshes 4`, `minIntervalMs 30 000`) and the proxy's 401/403 branch | **A resolver.** `playbackEngine.ts:235` passes only `initialSource`, so the branch is inert (C10) |
| Downloads | `isRecoverableError` and `resume` re-resolve (`downloadService.ts:920`, `:523–531`) | Sharing the classifier with playback, and re-verifying identity on the refreshed source |

**The resolver cannot ride on the request.** `PlaybackStreamRequest` (`src/types/media.ts:366`) is plain data that crosses IPC. Give `PlaybackEngine` a dependency (like `fetchBytes` in its constructor) that, from a **source reference** (session id plus source identity), re-runs discovery for that variant and returns a `ResolvedSource`; `prepare` builds the lease's `resolve` from it. This is also where the identity gates re-run (§8.2 step 5) and where `pickReplacement` is used.

**One classifier.** Playback (`playbackRecovery.ts`, `PlaybackSession`), proxy refresh and `downloadService.isRecoverableError` each decide recoverability today. Part D should collapse them to one source of truth (the failure taxonomy), because two classifiers will disagree about the same 403.

**Layers stay distinct.** `playbackRecovery.ts` is transport recovery (what would change the outcome for these bytes). Part D is *source* recovery (get different bytes). Do not merge them.

**Single-use links (§8.4) are held.** No code handles them and no ledger entry shows one (C11). Phase 0 must look for a case: a provider whose first fetch succeeds and whose second fails with the same address. If none is found, §8.4's rules reduce to "do not re-probe an address you already hold a lease on", which the lease already provides.

**Budgets.** Start from the lease's defaults (4 refreshes, 30 s between refreshes) and the existing transport budget in `playbackRecovery.ts`; set final values from Phase 0.

## 9. Part E: Viewer Feedback and Provider Ranking

### 9.1 Why feedback is needed

Internal telemetry can establish that a provider returned a URL and that a player opened it. It cannot reliably establish that the stream contained the requested work or that the user found the source useful.

The viewer is the strongest available source of explicit feedback about content correctness.

CS3 should use this feedback to improve future ordering while retaining independent measurements of technical reliability.

### 9.2 Feedback interface

Add a compact, optional control in the player interface.

Suggested prompt:

**"Was this the right title?"**

Provide two actions:

- Thumbs up: correct and useful.
- Thumbs down: incorrect or not useful.

After a thumbs-down, optionally offer a small set of reasons:

- Wrong title.
- Video does not play.
- Poor quality.
- Wrong language or version.
- Other.

The "Wrong title" action must be available from the source-selection list as well as the player. It should immediately prevent the same candidate from being automatically selected again for that work during the current session.

The control must never interrupt playback, steal keyboard focus, block player controls, or require a response.

### 9.3 Display frequency

Feedback should be discreet and infrequent.

- Show it only after playback has been stable for a short period.
- Ask at most once per playback session.
- Do not ask again for a work the user has already rated, unless they explicitly choose to update their rating.
- Do not show it during immediate resume or short playback attempts.
- Respect the user's setting to disable feedback prompts.
- Respect Incognito and protected-content UI rules.
- Do not infer a thumbs-up from playback alone.

The control should fade or remain unobtrusive when not in use and remain accessible through keyboard navigation and screen readers.

### 9.4 Separate ranking dimensions

Provider ranking must not treat every successful video response as proof of a good result.

Track these dimensions separately:

| Dimension | What it measures |
|---|---|
| Discovery reliability | Whether the provider responds successfully |
| Content-match accuracy | Whether returned titles match the requested work |
| Source availability | Whether usable sources are returned |
| Playback success | Whether a source can be opened and played |
| Link freshness | Whether links remain usable when requested |
| Viewer approval | Explicit user feedback |
| Technical quality | Relevant resolution, format, audio, and playback characteristics |

A provider may be technically reliable but poor at matching titles. Another may return correct results but frequently expose expired URLs. The ranking must preserve these distinctions.

### 9.5 Ranking integration

Extend the existing provider-ranking system with match accuracy and viewer approval signals.

Suggested ranking order:

1. Hard content-identity eligibility.
2. User-specific feedback for the current work and source.
3. Provider match accuracy for the relevant category.
4. Provider discovery and playback reliability.
5. Source freshness and technical suitability.
6. Exploration of providers with insufficient historical data.

Identity confidence must never be traded against resolution or speed. A fast, high-resolution stream of the wrong movie is not a better candidate.

Use smoothing, minimum sample thresholds, and time decay to prevent small sample sizes from producing extreme rankings. Unknown scores should remain neutral rather than being treated as failures.

Do not automatically disable providers. Rankings affect ordering and recommendation, not whether an enabled provider can ever be searched.

### 9.6 Feedback storage and privacy

Store work-specific feedback separately from installation-level provider aggregates.

Per-profile information may record a user's explicit verdict for a particular source or title, allowing the app to avoid repeatedly offering a source they marked as incorrect.

Installation-level aggregates should avoid storing titles, queries, viewing history, raw URLs, and other unnecessary personal data.

- Incognito feedback must not persist after the session.
- Feedback must respect the selected user profile.
- Users must be able to clear their stored feedback.
- Feedback storage must participate in the application's established backup and erase behavior.
- Community-wide aggregation must not be introduced without a separate privacy and abuse review.

The first release should learn locally. A shared ranking service or repository-published scorecard can be evaluated later if local evidence is insufficient.

### 9.7 Acceptance criteria

- Users can submit feedback in one click.
- Feedback never blocks playback or steals focus.
- Wrong-title feedback affects the current work immediately.
- Wrong-title feedback reduces match-accuracy scores, not just general playback scores.
- Provider scores use minimum sample thresholds and smoothing.
- No provider is automatically disabled.
- Incognito and profile-isolation behavior is tested.
- Users can review and clear stored feedback.

### 9.8 Code anchors and feasibility (validated 2026-10-21)

**Ranking.** Add two rows to the `providerRanking.ts` criteria table: `match-accuracy` and `viewer-approval` (id, weight, sample floor, function to `0..1` or `null`). Reduce `playback-success` when Gate 3 or the viewer flags a mismatch, so a wrong film that plays stops counting as a win (C3). The existing smoothing and `null` handling cover §9.5's sample thresholds; time decay is new. Add counters to `providerAnalytics.ts` as aggregates only.

**Storage.** Work-level verdicts: a new personal key in `profiles/profileKeys.ts` (`PERSONAL_KEYS`), carried by `backupService.ts`, erasable as a `cs3/userDataReset.ts` area. Provider aggregates: installation-level, no titles or queries. Incognito: `isPrivateSession()` at write time (`cs3/privacyMode.ts`), held in memory only.

**One gesture.** "Wrong title" shares its path with `playback:skipSource` (`main.ts:3741`), which already records a diagnostic and advances to the next candidate. Extend it with a reason and a verdict rather than adding a parallel channel. New channels (`feedback:submit`, `feedback:summary`, `feedback:forgetWork`) follow the four-sides rule and the `{ ok, error? }` envelope.

**Where the UI goes**
- The player: `VideoPlayer.tsx` is over 4,000 lines; the control is a separate component under `src/components/player/` mounted from it, never inline.
- The source list: `SourcePicker.tsx` and the saved-sources list.
- Privacy: hidden when `playbackPrivacy` says `protected` or `blocked`; honours Incognito.
- Focus: it takes none by itself (§9.2), and Escape handling must follow the capture-phase rule in AGENTS §9–11.

**Cold start.** The first release is local only (§3.2), which is already this PRD's position. There is no labelled data today (C19), so every ranking weight for the new rows starts low until sample floors are met.

## 10. Data Model and Architecture

The following are proposed logical contracts, not a finalized implementation. Adapt them to the repository's existing conventions.

### 10.1 Work identity

`WorkIdentity`

Contains the canonical work key, display and alternate titles, media type, year, episode information, external IDs, and available runtime or language information.

### 10.2 Provider attempt

`ProviderAttempt`

Contains:

- Attempt ID.
- Search or playback session ID.
- Work key.
- Provider key.
- Attempt strategy.
- Start and finish timestamps.
- Outcome.
- Candidate count.
- Rejected-match count.
- Failure category where applicable.
- Queue wait and execution duration.

### 10.3 Source candidate

`SourceCandidate`

Contains:

- Candidate identity.
- Provider identity.
- Work identity or matched-work metadata.
- Match confidence and reasons.
- Source type and technical metadata.
- Discovery timestamp and freshness state.
- Playback validation state.
- Recovery state.

Sensitive URL data and authentication context should be handled by the existing secure source pipeline, not exposed in general analytics records.

### 10.4 Feedback event

`FeedbackEvent`

Contains the timestamp, work key, provider key, source identity, verdict, optional reasons, match confidence at the time, discovery strategy, and relevant playback engine.

### 10.5 Suggested modules

Indicative locations to verify against the current repository:

- `electron/cs3/requestScheduler.ts`
- `electron/cs3/workMatch.ts`
- `electron/cs3/feedbackStore.ts`
- Existing playback-session orchestration.
- Existing content/source discovery service.
- Existing provider-ranking and analytics modules.
- Existing network-resilience layer.
- Player and search-result UI components.
- Existing IPC handlers, preload bridge, and sidecar RPC contracts where required.

Reuse existing services, caches, cancellation mechanisms, and ranking infrastructure whenever possible. Avoid introducing parallel abstractions that duplicate existing functionality.

All new IPC channels must follow existing validation, error-envelope, and security conventions. Update the applicable architecture documentation and agent instructions alongside each implementation phase.

### 10.6 Verified module map (2026-10-21)

| Proposed | Exists now | Build on |
|---|---|---|
| `requestScheduler.ts` | No (C6) | Priority-and-lanes pattern of `util/startupQueue.ts`; budgets from `pluginManager.ts:663`; cancellation from `sharedDiscovery.ts` and `AbortSignal`s |
| `workMatch.ts` | No (C6) | `releaseParser` helpers, `titleEnricher` scoring, `searchMerge` keys; replaces the rule in `resultGroups.ts` `isRelevant` |
| `feedbackStore.ts` | No (C6) | `perProfile` stores (`profiles/perProfile.ts`), `util/jsonFileStore.ts` for debounced persistence |
| `ProviderAttempt` store | No (C8) | Same pattern as `feedbackStore`; profile-scoped, bounded, expiring |
| `SourceCandidate` | Partly: `TorrentResult` | Add `matchConfidence`, `matchReasons`, `validation` state beside `scoreReasons` |
| Lease resolver | No (C10) | `SourceLease` (`media/sourceLease.ts`), `PlaybackEngine` constructor dependency, `playedSource.pickReplacement` |
| Sidecar priority | No (C12) | RPC frame in `sidecarSupervisor.ts` and `Main.java`; `RUNTIME_GENERATION` bump |

## 11. Instrumentation and Observability

Collect measurements that can establish whether the changes improve latency and correctness.

### 11.1 Playback latency

Measure:

- Play-button press to source-discovery start.
- Scheduler queue wait.
- Time to first provider response.
- Time to first verified candidate.
- Time to first playable source.
- Time to first frame.
- Time spent refreshing failed links.

Report results separately for idle conditions and defined background workloads.

### 11.2 Discovery correctness

Measure:

- Provider attempts per work.
- Correct candidates accepted.
- Incorrect candidates rejected.
- Candidates left unverified.
- Fallback sessions with no verified source.
- Incorrect-title feedback rate.
- Candidate identity confidence at automatic start.

### 11.3 Scheduler behavior

Measure:

- Queue depth by priority.
- Concurrency by provider and class.
- Work cancelled after its context became stale.
- Requests started after cancellation.
- Foreground wait time under background load.
- Maintenance starvation and queue age.

### 11.4 Recovery behavior

Measure:

- Source failures by category.
- Refresh attempts per failure.
- Refresh success rate.
- Time spent recovering.
- Duplicate or exhausted retries.
- Failures that require user selection.

Use aggregate measurements wherever possible. Do not introduce new transmission of titles or viewing history for performance monitoring.

## 12. Implementation Phases

### Phase 0: Verify and establish baselines

- Revalidate the documented code findings against the current source.
- Instrument current playback latency and background contention.
- Build a representative content-match test set from existing diagnostics.
- Establish the current rate of wrong-title fallback.
- Establish source-expiry and refresh failure patterns.
- Confirm existing cancellation, caching, ranking, and IPC capabilities.

**Exit criteria:** Baselines are recorded and the proposed architecture is mapped to actual repository modules.

### Phase 1: Prevent incorrect automatic playback

- Apply title, year, type, sequel, and episode checks to widened fallback search.
- Extend the safe fallback rule to every persistent playback path.
- Prevent unverified or mismatched fallback candidates from starting automatically.
- Display the actual matched title and a clear selection state.
- Add regression tests for unrelated and trending results.

**Exit criteria:** No unverified or mismatched fallback candidate starts automatically in the test matrix.

### Phase 2: Sequential discovery and provider statuses

- Implement sequential fallback search as the default.
- Add provider-attempt status indicators to search-result cards.
- Persist bounded attempt outcomes with expiry.
- Add retry and inspection actions.
- Keep search-all mode available behind a setting.
- Ensure both modes use identical identity gates.

**Exit criteria:** Users can understand which providers were attempted, what they returned, and which sources remain unverified.

### Phase 3: Source refresh and recovery

- Classify source and playback failures.
- Add bounded source refresh and retry behavior.
- Handle known single-use URL behavior.
- Integrate refresh into playback and download flows where appropriate.
- Add tests for expired links, timeouts, permanent errors, and cancellation.

**Exit criteria:** Recoverable source failures refresh automatically without repeated navigation or infinite retry loops.

### Phase 4: Foreground request scheduler

- Add priority classes and foreground context.
- Move provider fan-out limits into shared scheduling.
- Promote matching speculative work when Play is pressed.
- Cancel or demote obsolete work.
- Add priority-aware network scheduling.

**Exit criteria:** Foreground latency improves under measured background load without reducing provider coverage.

### Phase 5: JVM and bandwidth prioritization

- Implement sidecar request priority if required by Phase 0 measurements.
- Add bounded priority-aware JVM queues and reserved playback capacity.
- Integrate download bandwidth yielding if measurements justify it.
- Update runtime contracts and regression tests.

**Exit criteria:** Playback priority remains effective across process boundaries and shared network resources.

### Phase 6: Feedback and provider ranking

- Add the discreet player and source-list feedback controls.
- Store profile-scoped verdicts and installation-level aggregates.
- Add match-accuracy and viewer-approval ranking signals.
- Apply smoothing, sample thresholds, and time decay.
- Ensure wrong-title feedback changes the current candidate order.

**Exit criteria:** Explicit feedback improves ranking without affecting privacy, playback continuity, or provider availability.

### Phase 7: Evaluate optional shared scorecards

Only after local feedback and provider diagnostics have been evaluated:

- Determine whether shared scores materially improve ranking.
- Assess data quality, privacy, abuse prevention, and maintenance cost.
- Consider a repository-published provider scorecard as a low-weight ranking hint.
- Require a separate decision before introducing any remote feedback submission.

**Exit criteria:** A documented decision is made to ship or defer shared rankings.

### Phase 7 detail (carried over from the first PRD, which this one supersedes)

The first release learns from this installation only. A shared ranking needs two things that are easy to confuse: a way to **write** signals in and a way to **read** the totals back into the app. Most analytics services do only the first.

**No server is built or hosted.** The read path is a static `provider-scores.json` published from the repository and fetched the way the app already fetches extension repositories from GitHub: provider key, category, score, sample count, no titles and no user data. It is a low-weight ranking hint and can never disable a provider or change what is searched.

1. **7a, canary scorecard (no user data).** A scheduled job in the public repository (GitHub Actions) runs the existing harnesses (`tools/e2e/provider-e2e.mjs`, `links-e2e.mjs`) against a fixed set of known titles and records, per provider, whether it returned the right work and a playable link. This measures match accuracy directly and needs nobody's feedback. Limits: a data-centre run cannot see region-locked providers or ones behind a Cloudflare challenge (those need the app's browser host), so it is a partial signal; keep the checks few and light.
2. **7b, optional anonymous votes** only if 7a and local feedback prove insufficient: aggregate counts (provider key and category only) posted to a public web form that writes to a sheet, folded into the same static file by a scheduled job. No server, no cost; no rate limiting or abuse protection, the form host sees the sender's IP address, and a form endpoint is not a documented API. Opt-in, off by default, behind a privacy review.

**Services considered and why they are not the plan** (limits checked 2026-10-21):
- *Google Analytics 4 (Measurement Protocol):* write-only for this purpose; events are sent with an `api_secret` that would ship inside the app and reports come back through a separate authenticated API, so the app cannot read totals.
- *Firebase (Firestore):* could write and read with no server inside the free tier (20,000 writes and 50,000 reads a day), but writes would be open to anyone, and App Check lists attestation providers for Apple and Android only, none for an Electron desktop app, so fake votes or quota exhaustion would break ranking for everyone.
- *Cloudflare Workers:* 100,000 requests a day free, but the free KV store allows only 1,000 writes a day; D1 was not verified, and in the end it is a small backend. The fallback if the form route is abused.
- *Self-hosted analytics (PostHog, Plausible, Umami):* need hosting, or a private key to read data back that cannot ship in the app.

**Decision for this PRD:** Phase 7 stays optional and last. 7a is the only part that fixes a real blind spot (match accuracy) without collecting anything.

## 13. Testing Strategy

### 13.1 Content matching

Test:

- Exact title and year matches.
- Alternate and regional titles.
- Missing or conflicting years.
- Sequels and numbered franchises.
- Remakes and reboots.
- Movies versus series.
- Season and episode mismatches.
- Trending fallback results.
- Correct search hits containing unrelated links.
- Missing or incomplete metadata.

### 13.2 Scheduling

Test:

- Play during extension updates.
- Play during metadata enrichment.
- Play during a large provider search.
- Play while downloads consume bandwidth.
- Switch from title A to title B during discovery.
- Press Play while matching prefetch work is already running.
- Cancel discovery and immediately start another title.
- Confirm that background work eventually resumes.

### 13.3 Source recovery

Test:

- Expired direct links.
- One-time URLs.
- Missing headers or session context.
- Network interruptions.
- HTTP authorization failures.
- Removed resources.
- Unsupported media formats.
- Provider timeouts.
- Repeated failures and retry exhaustion.
- Playback and download attempts using the same original source.

### 13.4 Feedback and ranking

Test:

- Thumbs up and thumbs down.
- Wrong-title action from the source list.
- Duplicate feedback suppression.
- Minimum sample thresholds.
- Score decay and neutral cold-start behavior.
- Profile isolation.
- Incognito non-persistence.
- Feedback disabled in settings.
- Ensuring no provider is automatically disabled.

### 13.5 Regression requirements

All existing search, provider selection, source selection, download, history, profile, Incognito, and playback behaviors must remain functional unless a change is explicitly required by this PRD.

## 14. Definition of Done

The work is complete when:

1. Active playback requests receive measurable priority over nonessential background work.
2. Moving to a different title prevents obsolete work from interfering with the new session.
3. Unverified or mismatched fallback candidates never start automatically.
4. Sequential discovery is the default, and search-all remains available as an option.
5. Users can see per-provider discovery status and inspect uncertain results.
6. Recoverable expired links are refreshed automatically within bounded retry limits.
7. Wrong-title feedback immediately affects the current work and informs future provider ranking.
8. Provider reliability, content-match accuracy, and viewer approval are measured separately.
9. All valid results remain accessible, and providers are not silently disabled.
10. Performance, correctness, cancellation, recovery, and privacy requirements pass their regression tests.
11. Documentation, IPC contracts, runtime versions, and agent instructions are updated with the relevant implementation phases.

## 15. Open Decisions

Resolve these during Phase 0 rather than assuming answers:

- What existing cache and attempt-history mechanisms can be reused?
- Which metadata fields are available reliably for each content category?
- Which source types can be refreshed safely without consuming single-use URLs?
- What provider concurrency and priority budgets are justified by measured latency?
- Which source failures should trigger immediate refresh versus a short retry delay?
- How long should provider attempt outcomes remain cached?
- What is the smallest useful feedback prompt that fits the current player UI?
- Should the optional shared scorecard be implemented at all?
- Which performance and correctness thresholds can be supported by the baseline test data?

### Answers the code already gives to §15

- **Reusable cache and attempt-history mechanisms.** `SourceCache` (per-source expiry, `forget`), `titleOutcomes` (per-address kinds), `providerAnalytics` (aggregates per provider and stage), `interactions:summarise` (the per-card join). **Nothing records an attempt per work and provider**; that part is new (C8).
- **Reliable metadata per category.** Cinemeta and AniList supply title, year, type and (for anime) synonyms; runtime availability and film/series alias lists are not confirmed by the code and are Phase 0 questions (C14).
- **Single-use sources.** No evidence (C11).
- **Budgets.** None can be justified yet: no queue wait is recorded today (C4). The latency distribution in C7 sets the scale.
- **Immediate refresh versus delay.** The taxonomy already separates `expired` (refresh at once) from `blocked` 401/403 (refresh only if a resolver exists), `not-found` (re-discover) and `timeout`/`network` (bounded backoff); `playbackRecovery.ts` already budgets transport retries.
- **Attempt-outcome expiry.** Reuse `sourceCache.ts`'s per-source deadline logic; `no-sources` shorter than metadata; network failures a short cooldown (§7.7).
- **Smallest feedback prompt.** A one-line control in the player chrome, with the reason chips only after a thumbs-down (§9.2); a UI review in Phase 6 settles the placement.
- **Shared scorecard.** See "Phase 7 detail" below.
- **Thresholds the baseline can support.** Currently none: no labelled data exists (C19). The golden set must be assembled first (§6.10).

**Final product requirement:** CS3 must make a best-effort attempt to deliver the exact work selected by the user, prioritize that attempt over unrelated activity, recover automatically from recoverable source failures, and ask for confirmation rather than silently substituting an uncertain title.

## Appendix A. Carried over from the first PRD

**A.1 Edge cases the matching design must handle** (§6.3, §13.1): sequels and numbered franchises (*Charlie* versus *Charlie 2*); remakes and reboots with the same title (year decides); translated or dubbed titles (Hindi, Tamil and Telugu titles for one film); anime romaji versus English; a missing year on either side; series (season packs, specials, absolute episode numbers); compilation and multi-title pages; live TV (no work identity, so the rule does not apply); a provider whose search is right but whose link list is wrong; a catalogue page whose own title is a file name (use the enricher's result and mark lower confidence).

**A.2 Implicit feedback signals.** §9.3 forbids inferring a thumbs-up. Behavioural signals may still be recorded as *weak counters on separate dimensions*, never as a verdict:

| Signal | Effect |
|---|---|
| Finished (≥ 80%) | Mild positive for playback success |
| Abandoned in under 60 s | Mild negative for playback success |
| Switched source within 30 s | Negative for the source left |
| Replayed or resumed later | Mild positive for playback success |

Explicit verdicts always outweigh these; none can raise `match-accuracy`.

**A.3 Downloads yield bandwidth to playback** (§5.7): while a P0 context is active, cap the global download rate to a configurable share and restore it when playback ends or after a timeout. Off by default until measured; the setting must state what it does. Needs new code (aria2 `changeGlobalOption`, plus a throttle for the HTTP fallback and yt-dlp), see §5.9.