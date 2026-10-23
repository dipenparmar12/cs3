# PRD: Content Validation, Source Verification, and Provider Reliability

**Status (2026-10-23):** Phase 0 audit done (§0); **Phase 1 built**: `src/utils/contentValidation.ts` (identity and playability as separate answers, §7.2 states, per-kind tolerances, a show average can warn but never confirm, short/trailer/live never judged on length, an identity-gate mismatch confirms; 9 tests). `mediaSanity.looksLikeWrongMedia` now delegates to it with identical thresholds (its 8 tests unchanged). Phases 2–6 not built. The register entry is in `ROADMAP.md`.

**Relationship:** extends the Playback Source Resolution PRD (`2026-10-Playback-Source-Resolution-Priority-Match-Verification-and-Viewer-Feedback-2.md`), whose Part B (identity gates) and Phase 2 (ranked walk, provider attempts) are the base this builds on. It does not replace them.

---

## 0. Phase 0: what the code already does (audited 2026-10-23)

The PRD's own first step is "map the existing mechanisms and extend them, not a parallel system". This is that map. Each row names the module to extend and the gap the PRD's later phases fill.

| PRD area | What exists | Where | Gap |
|---|---|---|---|
| Expected runtime (§4) | Runtime from four catalogues, merged: Cinemeta `runtime`, TVmaze `averageRuntime`, AniList `duration`, Wikidata `P2047` | `cinemeta.ts`, `metadata/cinemetaExtras.ts`, `metadata/tvmaze.ts`, `metadata/wikidata.ts`, `metadata/enrichmentService.ts:825` | One number, no confidence or disagreement flag (§4.2); TVmaze's is a show average, not the episode's |
| Duration check (§5) | A converted or direct stream under 6 min and under 15% of an expected ≥ 20 min skips to the next source with a reason; only a measured length is judged | `src/utils/mediaSanity.ts` (`looksLikeWrongMedia`, `judgeableDuration`), `VideoPlayer.tsx` | Runs after playback starts, not before a source is offered; one fixed rule for every type; no "possible" vs "confirmed" |
| Identity of a hit (§7.1) | IMDb id, season, movie/series, year ±1, sequel tokens, Dice ≥ 0.8; `unknown` kept | `cs3/providerHitMatch.ts` | Hit-level only (the provider's search row), not the resolved stream |
| Per-episode identity | Episode handle picked by season and episode, refused when absent; season-pack file must be the requested episode | `cs3/episodeMatch.ts` (2026-10-23) | — |
| Failure categories (§6.3) | One closed set: `blocked` (401/403, challenge), `timeout`, `expired`, `not-found`, `server-error`, `network`, `unreadable-reply`, `provider-error`, … | `cs3/failureTaxonomy.ts` | No `UPDATE_REQUIRED`, `AUTHENTICATION_REQUIRED` as distinct from a bot wall, `ADVERTISEMENT`, `SUSPICIOUS_DURATION`, `INVALID_MEDIA_RESPONSE`; no provider-specific pattern table |
| Challenge vs block vs rate limit (§10.2) | 429, and 503 with `Retry-After`, are rate limits; a challenge is recognised even as HTTP 200; a block never opens a browser | `torrent/botChallenge.ts`, `cs3/clearance.ts` (10-minute cooldown after a failed solve) | Applied to indexers and clearances, not to extension provider calls; `Retry-After` seconds not honoured as a wait |
| Backoff and circuit breaker (§10.3–10.4) | Indexers: deadline from their own p90 × 2.5, escalating cooldown, reset on success | `torrent/indexerBudget.ts` | Extension providers have none: a rate-limited provider is asked again on the next search |
| Concurrency (§10.1) | 8 provider searches in flight (setting 1–32); JVM lanes keep source lookups ahead of searches; widened search is a ranked walk with a budget | `pluginManager.searchEach`, `RpcLanes.java`, `cs3/discoveryWalk.ts` | Global, not per provider; no per-host request-frequency limit |
| In-flight dedupe (§10.1) | Provider activation, catalogue refresh, extension update checks, clearance solves, shared discovery | `pluginManager.ts:3157`, `cs3/discovery.ts:155`, `cs3/extensionUpdater.ts:443`, `cs3/clearance.ts` | Not for `loadLinks` of the same handle from two callers |
| Non-media responses (§6.2) | The inspector reads the first 64 KB: `#EXTM3U`, `<MPD`, ffprobe; a 404/403 to a one-byte range is a dead link before ffmpeg | `media/mediaInspector.ts`, `PlaybackEngine.prepare` (`capability.failure.dead`) | An HTML page answered with 200 is not named as such; no update or login page recognition |
| Outcomes and ranking (§11) | Provider analytics (aggregates only), weighted ranking, per-work provider attempts (sources, no sources, wrong match, error) per profile | `cs3/providerAnalytics.ts`, `cs3/providerRanking.ts`, `cs3/providerAttempts.ts` | No "played the wrong content" outcome feeding ranking; no record of a user proceeding past a warning |
| Playback telemetry (§11) | One record per session with first frame, stalls, seeks | `media/playbackTelemetry.ts`, `player/playbackStats.ts` | No validation state on the record |
| Warnings (§9) | "Find more sources" offer after a self-widened search; wrong-media skip toast | `playbackSession.ts`, `VideoPlayer.tsx` | No pre-play warning with expected vs detected duration |

**Conclusion of the audit.** No new subsystem is needed. Phase 1 is a pure `validation` module beside `mediaSanity.ts` that turns the signals above into the §7.2 states; Phase 2 adds the missing failure categories to `failureTaxonomy.ts` and HTML/update/login recognition to the inspector; Phase 4 brings `indexerBudget`'s cooldown and `botChallenge`'s rate-limit reading to extension provider calls. Baselines to measure first (Phase 0 deliverable still open): how often `looksLikeWrongMedia` fires per 100 plays, and how many provider calls answer 429 or a challenge, from `playback_session_telemetry` and the issue ledger.

---

## 1. Objective

Build an application-wide validation system that decides whether a provider's response contains the movie or episode the viewer intends to watch, rather than merely checking that the provider returned a result or a URL.

It protects viewers from irrelevant videos, advertisements, promotional content, update-required messages, authentication walls, invalid streams and other misleading responses. It protects providers from request bursts and uncontrolled retries that trigger rate limits.

> A successful provider response does not mean the requested content is available, and a returned URL does not mean it holds the correct, playable media.

## 2. Problem

- A provider returns a short advertisement or unrelated clip instead of the film.
- A poster resolves, but Play produces no usable or resumable stream.
- A provider returns an "update the app", API-update, login or promotional page.
- A valid-looking media URL fails during probing or playback start.
- A provider answers correctly at first, then restricted or incomplete because of rate limiting.
- Concurrent requests trigger temporary restrictions that make later searches less reliable.
- A source that works intermittently keeps ranking high despite repeated validation or playback failures.

## 3. Design principles

1. Validate content, not responses. HTTP success, a non-empty URL or a scraper callback is not proof.
2. Several independent signals: identity, runtime, stream properties, provider errors, history.
3. Missing metadata or an unavailable probe is **inconclusive**, never a rejection.
4. Warn in proportion. A validated source never interrupts.
5. Prefer verified alternatives.
6. Protect providers: per-provider concurrency, caching, in-flight dedupe, bounded retries.
7. Keep the viewer's choice: an inconclusive source can be played after a warning.
8. Extend what exists (§0), never a parallel resolution path.

## 4. Expected content metadata

### 4.1 Fields

Canonical and alternate titles, type, year or release date, IMDb/TMDB or another stable id, season and episode, expected runtime (per episode where the catalogue has it), language and release information. Provider metadata is useful but never overrides a more reliable canonical identity.

### 4.2 Confidence

Each field is authoritative, corroborated, provider-supplied, inferred or unavailable. An approximate runtime or ambiguous title is not definitive. When catalogues disagree, keep the disagreement rather than a falsely precise number.

## 5. Runtime validation

### 5.1 Expected versus detected

Expected 120 min, detected 3 min: strong evidence of a mismatch. Expected 120, detected 116: consistent. Tolerances are configurable, never equality.

### 5.2 Rules

Account for cuts and editions, intros and credits, varying episode lengths, short films, trailers and clips, wrong or missing runtime metadata, and streams whose length cannot be read. A short runtime alone never establishes an advertisement.

### 5.3 Discrepancy

Absolute and relative differences, thresholds per content type (not one universal percentage), and a result that carries expected, detected, difference, tolerance and reason.

### 5.4 Unavailable

An unprobeable source records the runtime check as inconclusive. Never probe again just to learn a duration if that costs provider requests or delays playback.

## 6. Misleading responses and restrictions

### 6.1 Conditions

Advertisement or unrelated video; promotional or landing page; update required; authentication required; rate limited; expired or invalid URL; unsupported format; probe failure; playback start failure; valid stream with the wrong film or episode.

### 6.2 Evidence

HTTP status and headers, content type, page content and known provider patterns, HTML where media was expected, duration and stream properties, probe and start results, provider history, earlier outcomes for the same source. Never download a whole file to validate it.

### 6.3 Categories

`CONTENT_MISMATCH`, `SUSPICIOUS_DURATION`, `ADVERTISEMENT_OR_PROMOTIONAL_RESPONSE`, `UPDATE_REQUIRED`, `AUTHENTICATION_REQUIRED`, `RATE_LIMITED`, `TEMPORARILY_UNAVAILABLE`, `SOURCE_EXPIRED`, `INVALID_MEDIA_RESPONSE`, `UNSUPPORTED_MEDIA`, `MEDIA_PROBE_FAILED`, `PLAYBACK_START_FAILED`, `METADATA_UNAVAILABLE`, `VALIDATION_INCONCLUSIVE`. Implemented as additions to `failureTaxonomy.ts`'s closed set (§0), keeping confirmed and suspected apart: a three-minute response is a duration discrepancy, not an advertisement, until more evidence says so.

### 6.4 Provider-specific recognition

Known update notices and restrictions per provider, isolated in the provider integration so one provider's rule cannot break another. A login or update requirement is explained once and not replayed.

## 7. Confidence and classification

### 7.1 Signals

Title and alternate-title match, stable ids, year, movie/series, season and episode, expected versus detected duration, whether the response is media, probe results, playback start, provider-specific patterns, provider history, earlier outcomes for this source, temporary availability and rate-limit state. No single signal decides when others exist.

### 7.2 States

| State | Meaning |
|---|---|
| Validated | Strong evidence of the requested content, technical checks passed |
| Likely match | Identity supported, some checks incomplete |
| Unverified | Not enough evidence either way |
| Possible mismatch | A meaningful signal conflicts, not conclusively |
| Confirmed mismatch | Strong evidence it is not the requested content |
| Restricted | Login, app update or another user action required |
| Temporarily unavailable | Transient failure, rate limit, network |
| Invalid source | Conclusively unusable as media |

Content identity and technical playability are separate axes: the right film can fail to play, and a playable stream can be the wrong film.

### 7.3 Scoring

Weights and thresholds configurable. Provider history supports, never proves, the current source. No automatic weight training from unverified outcomes.

## 8. Source selection

On Play: identify the work, discover through the existing walk (`discoveryWalk.ts`), reuse valid cached evidence, check cheaply first, probe only when needed, rank by relevance, confidence, compatibility and reliability, prefer verified, move past a clear mismatch within the walk's budget, and explain when nothing reliable is left.

### 8.1 Staged validation

1. Existing metadata and cached outcomes.
2. Response type, structure, known error patterns.
3. Probe duration and stream properties when justified.
4. Playback start as the technical confirmation.

Independent cheap checks may run concurrently within per-provider limits. Not every source is probed before anything can play.

## 9. Warnings

### 9.1 Possible mismatch

> This source may not contain the requested movie.
> Requested: The Matrix · Expected: about 2 hours · Detected: 3 minutes · Provider: *name*
> The detected media is much shorter than the film's runtime.

Actions: Choose another source · Refresh sources · Play anyway (when appropriate).

### 9.2 Confirmed mismatch

Not offered as a normal option. If still reachable for diagnosis, labelled as a mismatch.

### 9.3 Inconclusive

> CS3 could not confirm this source contains the requested movie. It may still play.

### 9.4 Restrictions

Explained once; not retried against.

### 9.5 Repetition

Outcomes cached per source identity; the same warning is not shown again for an unchanged source until new evidence or expiry.

## 10. Request protection

### 10.1 Concurrency and frequency

Per-provider concurrency and frequency limits, bounded repeats for the same content and provider, in-flight dedupe where the cache identity allows, coordination across search, refresh and validation, no bursts from background work.

### 10.2 Rate limits

HTTP 429 and known provider patterns; honour `Retry-After`. A 403 is not assumed to be a rate limit (`botChallenge.ts` already keeps these apart).

### 10.3 Backoff

Bounded exponential backoff with jitter; no simultaneous retries of one request from several tasks; reduce traffic to failing providers and restore it gradually; transient never becomes permanent.

### 10.4 Circuit breaker

Per provider, modelled on `indexerBudget.ts`'s escalating cooldown: suspend after repeated transient failures, allow controlled recovery probes, never mark the provider broken permanently.

### 10.5 Cache

Reuse existing identities and expiry: metadata, discovery results, validation outcomes, provider health and temporary restrictions, expired references. A rate limit is never cached as permanent; a stale link is never cached as valid.

## 11. Reliability analytics

Record provider and source identity, requested work, expected and detected duration, match confidence, classification and reasons, probe and start outcome, error category and status, retries and recovery, rate-limit and breaker events, and whether the viewer played past a warning. Aggregated and time-aware into ranking; one bad source never condemns a provider. No secrets, cookies or unnecessary personal data. Per-work rows are personal data (per profile, erasable), as `providerAttempts.ts` already is.

## 12. Integration

Extend, per §0: metadata and identity, provider search and discovery, ranking and selection, probing and duration, playback start and errors, refresh and resume, cache identity and expiry, provider concurrency and retries, analytics and diagnostics, and the IPC contract (four places change together, AGENTS §4.1). Provider identity and provenance are preserved end to end. Outcomes and categories are the same on every screen.

## 13. Tests

**Identity:** a film resolving to a 2–3 minute advertisement; a valid film a few minutes off its metadata; a legitimate short film; an episode matched to the wrong season or episode; two films with similar titles and different years; right runtime, wrong content; catalogues disagreeing or giving no runtime.

**Provider responses:** update-required page; login required; promotional page; HTML where media was expected; an unprobeable media URL; a valid source failing at start; an expired source working again after refresh.

**Request protection:** 429 with `Retry-After`; rate-limited concurrency; identical simultaneous requests; recovery after a temporary failure; still unavailable after the retry budget; validation cache expiry and refresh.

**Experience:** an understandable warning for a suspicious source; no prompt for a validated one; an inconclusive source not rejected; choosing another source or refreshing; no endless repeat of one warning.

## 14. Phases

| Phase | Work | Deliverable |
|---|---|---|
| 0 | Audit and baselines | §0 above (baselines still to measure) |
| 1 | Validation model: states, categories, expected runtime with confidence, per-type tolerances, identity separate from playability | Pure module beside `mediaSanity.ts`, tested |
| 2 | Response and media verification: HTML, update and login recognition in the inspector; probe and start signals; provenance kept | Shared verification step for candidates |
| 3 | Ranking and warnings: prefer verified; §9 warnings with actions; no repeats | Viewer-facing behaviour |
| 4 | Request protection: per-provider limits, rate-limit reading, backoff, in-flight dedupe of `loadLinks`, breaker | Fewer avoidable rate limits |
| 5 | Analytics: outcomes into ranking; diagnostics for recurring provider problems | Measured improvement |
| 6 | End-to-end and regression: movies, episodes, short form, missing metadata, refresh, resume, fallback; overhead measured | Full integration |

## 15. Acceptance criteria

1. A successful provider response is not proof the content is available.
2. Reliable runtime metadata detects significant duration discrepancies.
3. A film resolving to a short unrelated clip is flagged before it is presented as a match, when the evidence allows.
4. A few minutes' difference never rejects legitimate content on its own.
5. Missing metadata or duration is inconclusive, not a rejection.
6. Update-required, login-required and non-media responses are classified clearly.
7. Identity and playability are judged separately where needed.
8. Suspicious sources get actionable warnings with the reason and durations.
9. Reliable alternatives are preferred when a candidate is suspicious or unusable.
10. Per-provider limits, bounded retries and rate-limit handling cut repeated requests.
11. Temporary failures do not permanently lower a provider's ranking.
12. Outcomes are recorded without sensitive data.
13. Results are consistent across search, selection, playback, refresh and resume.
14. Existing behaviour stays compatible; validation overhead is measured and bounded.

## 16. Outcome

CS3 moves from finding provider responses to judging whether they are relevant, playable and trustworthy: misleading content is caught and explained, reliable alternatives win, provider restrictions are handled responsibly, and traffic goes down, all on measured evidence rather than assumption.
