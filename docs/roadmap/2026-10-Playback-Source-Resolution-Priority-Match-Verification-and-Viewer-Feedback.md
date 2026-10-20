> **Superseded 2026-10-21** by [2026-10-Playback-Source-Resolution-Priority-Match-Verification-and-Viewer-Feedback-2.md](./2026-10-Playback-Source-Resolution-Priority-Match-Verification-and-Viewer-Feedback-2.md). That document covers everything below and adds sequential discovery, source refresh and recovery, per-card status, a data model, instrumentation and a test plan, and it was validated against the code. Kept for the evidence in section 2 and the original reasoning; do not implement from this file.

> **Status 2026-10-21: Proposed. Nothing in §5–§8 is built.** Code references in §2 were read on 2026-10-21 and are the evidence for the problem statements. Register entry: [`ROADMAP.md`](./ROADMAP.md).

# PRD: Playback Source Resolution — Foreground Priority, Content-Match Verification and Viewer Feedback Ranking

## 1. Summary

When a viewer presses Play, three things decide whether they get the film they chose, and how fast:

1. **Priority.** The app resolves sources for the title being played in the same queues as background work (extension updates, catalogue refreshes, enrichment, speculative prefetch, downloads). The person waiting is not served first.
2. **Match.** When the chosen page has no playable source, the app widens to every enabled provider and **plays what it finds**. Providers are not checked for returning the requested work, so a different film can start playing. Search for *Charlie (2015)*, open it, and a stream of an unrelated movie plays.
3. **Feedback.** Provider ranking counts a link as a success when it delivers video. A wrong film that plays counts as a win and raises the provider that supplied it. The viewer, who is the only one who knows, is never asked.

This PRD specifies, in this order of dependence: **(A)** a priority scheduler so interactive playback work runs first and stale work is cancelled when the viewer moves on; **(B)** a content-match verification pipeline so a stream is started automatically only when it is shown to be the requested work; **(C)** a silent, one-click feedback control that feeds provider ranking.

## 2. What the code does today (verified 2026-10-21)

| # | Finding | Where |
|---|---|---|
| F1 | In standard mode every playback session is `persistent`: when every source fails, it widens to every provider and indexer once, by itself, and **starts the results** | `src/App.tsx:1385` (`persistent: !isDeveloper`); `electron/playbackSession.ts:741` (`widenAndContinue` → `beginStream(candidates, { failover: true })`) |
| F2 | The rule "a self-widened result is offered, never auto-started, because a title match can be a different work" exists, but only for the *empty* path (`if (session.widened) return;`). The persistent failure path does not use it | `playbackSession.ts:491–495` vs `:741–787` |
| F3 | In the widened provider search, the first **two** hits of each provider are accepted and their links merged into the candidate list. **There is no check that a hit is the requested work** (no title, year or type comparison). Torrent indexers get `expectedYear` and a ranker; extension providers get nothing | `electron/contentService.ts:1658` (`extMatches.slice(0, 2)`) |
| F4 | Many scrapers answer a query with recent or trending items when nothing matches. The Search screen already files these under "Also returned". The widened playback search has no equivalent filter | `src/utils/resultGroups.ts`; F3 |
| F5 | The only identity check on a playing stream is runtime: expected ≥ 20 min and actual < 6 min and < 15% of it. A different feature-length film passes | `src/utils/mediaSanity.ts:28–39` |
| F6 | `playback-success` is "a link from this provider actually delivered video", weighted highest; a source is recorded as played after 10 s. A wrong film that plays counts as success | `electron/cs3/providerRanking.ts:199`; AGENTS §9 |
| F7 | Provider calls go to one JVM. Its RPC worker pool is bounded by core count and first-come first-served; a second pool waits on results. There is no priority on a call | `sidecar/.../Main.java:33`; `electron/cs3/sidecarSupervisor.ts` (`pending` map) |
| F8 | One search fan-out is capped at 8 provider searches in flight. The cap is **per fan-out**, so concurrent fan-outs (search, prefetch, widening, catalogue rows) each get 8 | `electron/pluginManager.ts:663` |
| F9 | Third-party HTTP goes through one `ResilientFetch` with no concurrency limit, per-host limit or priority | `electron/main.ts:921`; `electron/networkResilience.ts:253` |
| F10 | Speculative source discovery already exists for the detail page: it starts after a 1.2 s settle, runs one at a time, and a Play press during it joins the in-flight run | `electron/cs3/sourcePrefetcher.ts:47`; `ContentService.getSources` shared runs |
| F11 | Background work that shares these paths: extension update checks and installs (job queue, 3 at once), catalogue and provider `getMainPage` refresh, metadata enrichment, provider analytics, subtitle search, indexer fan-outs, torrent engine, downloads (aria2/yt-dlp), startup queue tasks | AGENTS §4.3 |
| F12 | The player has no viewer feedback control. Per-title outcomes (`played`, `no-sources`, `app-error`) are recorded by the app, not by the viewer | `electron/cs3/titleOutcomes.ts` |

## 3. Problems

**P1 — Wrong content plays.** F1+F3+F4. Provider search is fuzzy by nature; the first two hits are not the film. Sources for them are ranked and walked like real candidates, so the viewer sees a stream that is not what they asked for. The failure is frequent because every title that has no source on its own page takes this path.

**P2 — Ranking rewards the wrong thing.** F6. A provider that serves the wrong film reliably scores well. The ranking cannot see identity errors, so it cannot correct them. The viewer's own judgement is the missing signal.

**P3 — The waiting viewer queues behind background work.** F7+F8+F9+F11. Latency to the first source, and to the first frame, grows with whatever else is running. Nothing distinguishes work a person is waiting for from work nobody will notice.

**P4 — Work for content the viewer left keeps running.** A fan-out started for one title continues after the viewer opens another. It costs bandwidth and JVM workers that the new title needs.

## 4. Goals and non-goals

**Goals**
- G1. Work a viewer is waiting on is served before any other work, measurably.
- G2. Work for content the viewer has left stops, or drops to background priority.
- G3. A stream starts automatically only when it is shown to be the requested work. Anything uncertain is offered, with the reason, never started.
- G4. The viewer can say "wrong film" or "good" in one click without leaving playback. The answer improves what is chosen next time.
- G5. Ranking separates *delivers video* from *is the right work* from *the viewer liked it*.
- G6. Each stage can be measured, so the claims in this PRD can be checked.

**Non-goals**
- No reduction in the set of providers searched. The scope rules (a selection is a strict filter) stay as they are.
- No automatic disabling of any provider, ever (AGENTS §7–8).
- No new network service in the first release. Community-wide aggregation is a later, opt-in phase (§9, Phase 7) and needs a separate decision.
- No change to how torrent swarms or downloads work, other than their yielding bandwidth to playback (§5.7).

## 5. Part A — Request priority and scheduling

### 5.1 Why

A viewer's wait is dominated by the slowest thing in their critical path, and that path currently shares workers and sockets with work that has no deadline. Measured elsewhere: provider scrapes range from 350 ms to 20 s; first-source time is "the slowest of two hundred sites" unless streamed. Making the critical path first in line is cheaper than making every call faster.

### 5.2 Priority classes

Priority attaches to **intent**, not to a provider or a channel. Each request carries a class and the context it belongs to.

| Class | Meaning | Examples |
|---|---|---|
| **P0 Playback** | The viewer pressed Play or is in a player and is waiting | Source discovery for the session title; link resolution; widening for that session; stream inspection and probe; manifest and segment fetches the player needs; torrent metadata for the chosen source |
| **P1 Navigation** | The viewer is on a screen and sees it filling | Detail page load; typed search; suggestions; catalogue rows currently on screen; ratings and extended metadata for the open page |
| **P2 Speculative** | Likely wanted soon | Source prefetch while the detail page is read; next-episode resolve; rows just off screen |
| **P3 Maintenance** | Nobody is waiting | Extension update check and install; catalogue refresh for hidden rows; enrichment of library rows; analytics flush; subtitle library; repository liveness |
| **Bulk** | Throughput, not latency | Downloads, torrent seeding. Governed by a bandwidth rule (§5.7), not by queue position |

### 5.3 The foreground context

A single `ForegroundContext` records what the viewer is doing: `{ kind: 'playback' | 'detail' | 'search' | 'browse' | 'idle', workKey, startedAt }`. `workKey` is the canonical title key already used by the library. Every scheduled request is tagged with the context it was created under.

Rules:
- A request tagged with the **current** context keeps its class.
- A request whose context is **no longer current** is demoted one class (P0→P2, P1→P3) and, if it has not started, cancelled when its owner calls for it (the `AbortSignal` already carried by `ContentService` runs). The viewer moving from title A to title B must not leave A's fan-out competing with B's.
- Pressing Play **promotes** an in-flight speculative run for the same `workKey` to P0 instead of starting a second one (builds on F10's shared runs).
- Leaving the player returns the context to the screen underneath.

### 5.4 The scheduler (main process)

One `RequestScheduler`, the only way provider and indexer work is started:
- **Queues per class**, with a concurrency budget per class and a global ceiling. Starting budgets are hypotheses to be set from the Phase 0 baseline, not decisions.
- **Reserved capacity.** A fixed share of the global ceiling is only ever available to P0 and P1, so maintenance can never fill it.
- **No preemption of running work.** A running call is never killed to make room (a half-done scrape wastes more than it saves); low classes simply stop *starting* while a higher class has waiting work.
- **Aging.** A queued P3 job that has waited past a limit is started anyway when the system is otherwise idle, so maintenance is delayed, not starved.
- **Per-fan-out caps become shared.** The "8 in flight" cap (F8) moves under the scheduler so it is a global budget, not a number each fan-out multiplies.
- **Cancellation by context** (§5.3).

### 5.5 The JVM side

The scheduler decides what to *send*. The JVM is a second queue (F7), so a P0 call sent after thirty P3 calls still waits there. Required:
- A `priority` field on the JSON-RPC frame (older frames default to normal, so the contract stays compatible).
- The bounded worker pool takes work from a priority queue and reserves a worker for P0.
- The unbounded waiter pool is unchanged (it exists to avoid a deadlock; AGENTS §5).
- Bump `RUNTIME_GENERATION`. The sidecar contract changed (AGENTS §3.5).

### 5.6 The network side

`ResilientFetch` (F9) gains a queue with per-host concurrency and a priority, so a P0 playlist fetch is not stuck behind a P3 bulk fetch to the same host. Chromium's own per-host connection limit still applies below it. Where Electron's `net.fetch` honours a fetch `priority` hint, it is set as well; whether it does is to be verified, and the design does not depend on it.

### 5.7 Downloads and torrents

Bulk transfers continue, but yield: while a P0 context is active, the global download rate is capped to a configurable share (aria2 supports changing the global limit at runtime), and restored when playback ends or after a timeout. The cap is off by default until measured, because a download the viewer asked for should not stall silently. The setting states what it does.

### 5.8 Requirements

- A1. Every provider call, indexer call and third-party fetch is created through the scheduler or `ResilientFetch` with a class and a context.
- A2. Under a defined background load, p95 time to first source for a P0 request is no worse than 1.25× the idle figure (target to confirm in Phase 0).
- A3. After the viewer opens a different title, no more than N of the previous title's calls start (N from the baseline; target 0 for P0/P1 work).
- A4. No class is starved: a P3 job starts within a bounded time once the foreground is idle.
- A5. The scheduler never changes which providers a search covers, or the results returned.
- A6. Every class, queue wait and cancellation is counted (§10).

## 6. Part B — Content-match verification

### 6.1 Why

A viewer's request names a work. The app's job is to deliver that work or say plainly that it could not. The widened path (F1–F4) replaced that rule with "deliver whatever plays". Matching a *title string* is a heuristic that this app already distrusts elsewhere (`searchOrder`, `titleEnricher`: "an unenriched row is a small loss; a mislabelled one reads as data corruption"). The fix is identity evidence at each stage, with a hard rule for what may start on its own.

### 6.2 The target

`WorkIdentity`, built once per session and carried with the request:
`{ titles: string[] (display, original, aliases), year?, type, season?, episode?, imdbId?, runtimeMinutes?, languages? }`.
Aliases come from catalogues the app already queries (Cinemeta, TVmaze, AniList, Wikidata); a title with no catalogue match uses what the viewer opened, and says its confidence is lower.

### 6.3 Three gates

**Gate 1 — the search hit** (replaces F3's blind first-two). For each provider hit, score against the target:
- normalised title similarity against *every* alias, with the existing title normaliser and similarity function;
- year: both known and differing by more than one → reject; one unknown → neutral;
- type: movie vs series vs anime vs live; a mismatch → reject;
- season/episode terms where the request has them;
- sequel and part markers (`2`, `II`, `Part 2`, `Chapter`) must agree, so *Charlie* does not match *Charlie 2*;
- remakes share titles; year decides.
Only hits above the accept threshold have their links resolved. If **none** of a provider's hits pass, that provider is recorded as `empty`, not `failure` (a provider with nothing for this title is working). The count of hits rejected is recorded, which is also what identifies the "trending fallback" scrapers (F4).

**Gate 2 — the source** (links already resolved). Parse each source's release or display name (the existing release parser) and compare title tokens, year and season/episode with the target. This catches a correct hit whose link list contains other titles (multi-title pages, "related" links).

**Gate 3 — the stream** (media evidence, after inspection or the first seconds of playback):
- runtime against the expected runtime. The current rule (F5) catches only a clip in place of a film. For a movie with a reliable runtime, a much wider disagreement (for example more than ±25%) lowers confidence; it does not reject on its own, because cuts, extended editions and credits vary;
- an embedded title tag in the container metadata, when present, compared like Gate 2;
- audio or subtitle language when the request has a language preference.
No fingerprinting and no content analysis: the app does not look at what is on screen.

### 6.4 Confidence and the one hard rule

Each candidate carries `matchConfidence: verified | probable | unverified | mismatch` and a list of reasons (the same shape as the existing `scoreReasons`, so diagnostics and the source list can show why).

**Rule: only `verified` candidates, or `probable` ones from the provider the viewer chose, may start automatically. Anything else is offered.** The widened persistent path (F1) follows this rule:
- candidates are filtered by Gate 1 and Gate 2 before they enter the list;
- the automatic walk stops at the first candidate it may not start, and the player shows what it found and why it paused ("No exact match found. 3 possible matches — choose one."), with the existing "Choose source" list;
- an `unverified` source in the list is labelled with the name it matched, so the viewer sees "Charlie 2 (2019)" before pressing it.

This is the rule already written for the empty path (F2), extended to the path that was missed.

### 6.5 Showing identity

- The player header and the source list show **what the source is**, not only what was asked for, when they differ.
- A **"Wrong title"** action in the player (and on each source row) marks the candidate `mismatch`, advances to the next, and records the event (§7). It is the same control as the feedback verdict (§7.3), so the viewer has one gesture.

### 6.6 Edge cases the design must handle

Sequels and numbered franchises; remakes and reboots with the same title; translated or dubbed titles (Hindi, Tamil and Telugu titles for the same film); anime romaji vs English; year missing on either side; series (season packs, specials, absolute episode numbers); compilations and multi-title pages; live TV (no work identity; the rule does not apply); a provider whose search is correct but whose link list is wrong; a viewer who opened a catalogue page whose own title is a file name (use the enricher's result, flag lower confidence).

### 6.7 Requirements

- B1. In standard mode, no widened candidate below `verified` (or `probable` from the chosen provider) starts without a viewer action.
- B2. On a golden set of real (query, provider hit, expected verdict) cases drawn from the app's own diagnostics, Gate 1 accepts the correct hit with recall ≥ 90% and accepts an incorrect hit with precision loss ≤ 1% of auto-started streams (targets to confirm on the data).
- B3. Rejection reasons are visible to a developer in diagnostics and to a viewer in plain words.
- B4. A provider that returns only rejected hits is `empty`, never `failure`, and never penalised for it by search reliability.
- B5. Matching is pure and tested (AGENTS §3.2): a `workMatch` module with a test per rule in §6.3, each mutation-checked.
- B6. The gates change no behaviour for the provider the viewer chose, other than adding labels.

## 7. Part C — Viewer feedback and ranking

### 7.1 Why

Internal measurement can tell that a link played. It cannot tell that it was right, or good. The viewer can, at the cost of one click, if the app asks in a way that never gets in the way. The ranking today measures delivery (F6); this adds identity and approval as separate, smoothed signals.

### 7.2 Principles

- **Silent.** Never modal, never a toast that must be dismissed, never blocks playback or a key.
- **One click.** Thumbs up, thumbs down. Reasons are optional chips shown only after a thumbs-down.
- **Rare.** Not on every play. A cooldown and a per-session limit; none on a resume under a minute, none for content the viewer already rated, none in a protected adult state.
- **Honest.** The control says what it is for ("Was this the right film?"), not "Rate your experience".
- **Private.** Respects Incognito (nothing persisted) and viewer profiles.
- **Optional.** A setting turns it off; ranking still works from implicit signals.

### 7.3 Where it appears

- **In the player:** a small control in the player chrome, similar to other players' like/dislike. It appears after playback has been steady for a short time, stays dimmed until hovered or focused, and fades after a few seconds. It reappears at the end of playback or on close if no answer was given.
- **On the source list:** a per-source thumbs control and the "Wrong title" action (§6.5).
- **Detail page:** a one-line "Was this the right page?" only when a verification gate had to guess.
- Keyboard and screen-reader accessible; labels state the action.

### 7.4 Signals

| Signal | Kind | Weight idea |
|---|---|---|
| Thumbs up | Explicit | Positive for provider, source variant, and work |
| Thumbs down | Explicit | Negative; optional reason chip |
| **Wrong title** | Explicit | Strong negative for *match accuracy* of the provider **for this work**; suppresses this exact source for this viewer |
| Doesn't play / bad quality / wrong language / subtitles off | Explicit reason | Negative on the matching criterion only |
| Finished (≥ 80%) | Implicit | Mild positive |
| Abandoned < 60 s | Implicit | Mild negative |
| Switched source within 30 s | Implicit | Negative for the source left |
| Replayed or resumed later | Implicit | Mild positive |

Implicit signals are weaker than explicit ones, and a thumbs-up is never inferred.

### 7.5 Data

`FeedbackEvent { ts, workKey, providerKey (provider/extension/repository), sourceIdentity, verdict, reasons[], matchConfidenceAtTime, strategy, engine }`.
- **Per viewer profile:** verdicts about a specific work and source ("never show me this source for this title again"). A new datastore key in `profiles/profileKeys.ts` (PERSONAL_KEYS), carried by the backup, erasable as a `userData` area.
- **Per installation:** counters per provider and category, with **aggregates only, no titles or queries**, the same rule as `providerAnalytics`.
- Incognito: events are held in memory and discarded with the session.

### 7.6 Ranking integration

New criteria rows in the `providerRanking` table (a row is an id, weight, sample floor and a function to `0..1` or `null`):
- `match-accuracy`: share of events where the provider's offered source was confirmed or not marked "wrong title", plus the Gate 1/2 rejection rate. `null` below the sample floor.
- `viewer-approval`: smoothed thumbs ratio.
- `playback-success` is **reduced** when Gate 3 or the viewer flagged a mismatch, so a wrong film that plays no longer counts as a win.

Rules carried over: rates are smoothed toward a neutral prior (a Beta prior), events decay (half-life of a few months) so a fixed provider recovers, a `null` is excluded from the denominator rather than scored zero, nothing is auto-disabled.

**Order within a candidate list** is, in this sequence: identity confidence (hard), then the viewer's own verdicts for this work, then provider score, then technical quality. Identity is never traded against speed or resolution.

**Per-work effect.** A "wrong title" verdict removes that source for that work immediately, and lowers the provider's match score for *that work* only, so one bad title does not condemn a provider that is right for everything else.

### 7.7 Cold start and community data

The first release learns **from this installation only**. It starts neutral and improves as the viewer rates. A shared ranking needs two things that are easy to confuse: a way to **write** signals in, and a way to **read** the totals back into the app. Most analytics services do only the first.

**No server is built or hosted by this project.** The read path is a static file published from the repository, fetched the way the app already fetches extension repositories from GitHub (`provider-scores.json`: provider key, category, score, sample count; no titles, no user data). It is a ranking *hint* with a low weight; it can never disable a provider or change what is searched.

Two stages, in this order:

1. **Canary scorecard — no user data.** A scheduled job in the public repository (GitHub Actions) runs the existing e2e harnesses (`tools/e2e/provider-e2e.mjs`, `links-e2e.mjs`) against a fixed set of known titles and records, per provider, whether it returned the right work and a playable link. This measures *match accuracy* directly, which is the reported problem, and needs nobody's feedback. Limits: a data-centre run cannot see region-locked providers or ones behind a Cloudflare challenge (those need the app's browser host), so it is a partial signal; the checks are few and light so they do not hammer provider sites.
2. **Optional anonymous votes — only if stage 1 and local feedback prove insufficient.** The app submits aggregate counts (provider key and category only) to a public web form that writes to a sheet; a scheduled job folds the sheet into the same static file. No server, no cost. Known weaknesses: no rate limiting or abuse protection, the form host sees the sender's IP address, and a form endpoint is not a documented API. Opt-in, off by default, and subject to a privacy review.

**Services considered and why they are not the plan** (limits checked 2026-10-21):
- *Google Analytics 4 / Measurement Protocol*: write-only for this purpose (events are sent with an `api_secret` that would ship inside the app; reports come back through a separate authenticated API), so the app cannot read the totals. Useful only for developer insight.
- *Firebase (Firestore)*: could write and read with no server, within 20,000 writes and 50,000 reads a day on the free tier. But writes would be open to anyone, and App Check lists attestation providers for Apple and Android platforms only, with none for an Electron desktop app, so fake votes or quota exhaustion would break ranking for everyone. It also ties a community project to a Google project and policy.
- *Cloudflare Workers*: free up to 100,000 requests a day, but the free KV store allows only 1,000 writes a day; it would need D1 (not verified) and is, in the end, a small backend. Kept as the fallback if the form route is abused.
- *Self-hosted analytics (PostHog, Plausible, Umami)*: need hosting; their cloud tiers need a private key to read data, which cannot ship in the app.

### 7.8 Requirements

- C1. The control never blocks playback, takes no focus by itself, and is dismissible by ignoring it.
- C2. Asked at most once per play, with a cooldown, and never for already-rated work.
- C3. Hidden in a protected adult state and in Incognito persistence.
- C4. A thumbs-down with "Wrong title" takes effect on the next candidate immediately.
- C5. Feedback data can be viewed in aggregate, cleared, and is included in backup/erase like other personal data.
- C6. With the control off, ranking behaves exactly as today plus the implicit signals.

## 8. Cross-cutting

**Contract and files (indicative, not a design freeze).**
- New pure modules: `electron/cs3/workMatch.ts` (identity and gates), `electron/cs3/requestScheduler.ts` (queues, classes, contexts), `electron/cs3/feedbackStore.ts`.
- Changed: `playbackSession.ts` (widen rule), `contentService.ts` (Gate 1 at the search-hit step), `pluginManager.ts` (shared budgets), `sidecarSupervisor.ts` and `Main.java` (priority), `networkResilience.ts` (queue), `providerRanking.ts` and `providerAnalytics.ts` (criteria, counters), `mediaSanity.ts` (confidence, not only reject), `VideoPlayer.tsx` and the source list (control, labels).
- IPC: `feedback:submit`, `feedback:summary`, `feedback:forgetWork` (all four sides change together, AGENTS §4.1; envelopes, never rejections).
- `RUNTIME_GENERATION` bump when the RPC frame changes.
- `AGENTS.md` and `docs/agents/*.md` updated in the same change as each phase.

**Privacy.** No titles, queries or viewing history in shared aggregates. Diagnostics may carry a work key only in the existing per-session transcript, as they do today.

**Compatibility.** Providers (`.cs3`) are unchanged. All matching is done in the host.

## 9. Phases (each verifiable alone)

| Phase | Work | Done when |
|---|---|---|
| 0 | **Baseline.** Instrument queue wait, time to first source and first frame, per class and per context, with and without background load; build the golden match set from diagnostics; no behaviour change | Numbers recorded in the stated environment |
| 1 | **Stop the bleeding.** The persistent widened path never auto-starts below the §6.4 rule; Gate 1 with title, year, type and sequel markers in the widened provider search; "no exact match" state in the player | B1 test passes; golden set shows target precision |
| 2 | Gates 2 and 3; labels and reasons in the source list and header; the "Wrong title" action | B3, B5 |
| 3 | Scheduler with classes, contexts, cancellation; shared fan-out budget; prefetch promotion | A1, A3, A4 |
| 4 | JVM priority and reserved worker; `ResilientFetch` queue; download yield | A2 measured |
| 5 | Feedback control, storage, IPC, Incognito and profile behaviour | C1–C5 |
| 6 | Ranking criteria and per-work effects; reduce `playback-success` on mismatch | C6; ranking tests |
| 7a | Canary scorecard: scheduled repository job, static `provider-scores.json`, low-weight ranking input | Scorecard published; app reads it; no user data involved |
| 7b | *Optional, only if needed:* anonymous aggregate votes via a public form and sheet | Own privacy review; off by default |

Phases 1 and 2 fix the reported bug and can ship before any scheduling work. Phase 0 comes first because the priorities and thresholds above are hypotheses until measured.

## 10. Measurement and acceptance

Recorded per stage, aggregate only: queue wait by class; time to first source; time to first frame; calls started for a context after it stopped being current; gate accept and reject counts by reason; auto-started streams by confidence; "Wrong title" rate; feedback shown, answered, ignored; provider score before and after.

Acceptance:
1. In the standard-mode test matrix, **zero** widened candidates below the rule start automatically.
2. On the golden set, Gate 1 meets B2.
3. Under background load, P0 p95 time to first source ≤ 1.25× idle (A2).
4. After switching titles, the previous title's P0/P1 calls started ≤ the Phase 0 target (A3).
5. The control meets C1–C3 in a manual accessibility and interruption review.
6. Existing search scope, provider coverage and result counts are unchanged (A5).
7. Every new pure module has a test that fails when its rule is removed.

## 11. Risks and open questions

- **Threshold tuning** trades precision for recall: too strict hides a real source behind "choose". Mitigation: the choice list always contains everything, labelled; thresholds set on the golden set, not guessed.
- **Aliases are incomplete** for regional titles, so a correct hit can fail Gate 1. Mitigation: the chosen provider is exempt from the hard rule (B6); widened hits fall back to "offered".
- **Priority inversion across the JVM boundary** if only the main side is changed; hence Phase 4 and the reserved worker.
- **Feedback fatigue** if shown too often; hence C2 and the off switch.
- **Gaming and noise** in a local-only first release is limited to the viewer's own choices; a community phase needs its own abuse model.
- **Open:** does Electron's `net.fetch` honour a priority hint? What reserved share and class budgets does the baseline justify? Should "Wrong title" also feed the saved-page/bookmark system? Is stage 7b ever needed once 7a and local feedback exist, given its privacy cost? Which known titles make a fair canary set across languages and regions?
