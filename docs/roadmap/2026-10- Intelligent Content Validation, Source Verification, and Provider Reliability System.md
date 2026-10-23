# PRD: Intelligent Content Validation, Source Verification, and Provider Reliability System

## 1. Objective

Build an intelligent, application-wide validation system for CS3 that determines whether a provider's response contains the actual movie or episode the user intends to watch, rather than merely checking whether the provider returned a result or a URL.

The system must protect users from irrelevant videos, advertisements, promotional content, update-required messages, authentication restrictions, invalid streams, and other misleading responses. It must also protect providers from excessive requests, concurrent scraping bursts, and uncontrolled retries that can trigger rate limits or temporary restrictions.

The core principle is:

**A successful provider response does not mean the requested content is available, and a returned URL does not mean the URL contains the correct, playable media.**

CS3 must evaluate content identity, media properties, provider behavior, and playback evidence before treating a source as trustworthy.

## 2. Current Problem

CS3 searches across multiple providers to find playable sources. However, some providers return responses that appear successful but do not provide the intended content.

Common scenarios include:

- The provider returns a short advertisement or unrelated video instead of the requested movie.
- A movie poster resolves successfully, but clicking Play produces no usable stream or resumable source.
- A provider returns an application-update message, an API-update notice, an authentication page, or a generic promotional banner.
- A provider returns a valid-looking media URL that fails during probing or playback initialization.
- A provider responds correctly at first but subsequently returns restricted or incomplete results because of rate limiting.
- Repeated concurrent requests trigger temporary restrictions, making subsequent searches less reliable.
- A source works intermittently, but CS3 continues to rank it highly despite repeated validation or playback failures.

The application currently needs a consistent mechanism to distinguish these conditions and guide users toward trustworthy alternatives.

## 3. Design Principles

1. **Validate content, not just responses.** HTTP success, a non-empty URL, or a successful scraper callback must not be treated as proof of a valid source.
2. **Use multiple independent signals.** Content identity, runtime, stream properties, provider errors, and historical reliability should contribute to the decision.
3. **Prefer confidence over assumptions.** Missing metadata or an unavailable media probe must produce an inconclusive result, not an automatic rejection.
4. **Warn proportionately.** Clearly suspicious sources should trigger a warning. Validated sources should not create unnecessary interruptions.
5. **Prefer verified alternatives.** When a source is suspicious or unusable, prioritize alternatives with stronger evidence of relevance and playability.
6. **Protect provider availability.** Apply provider-aware concurrency, caching, request deduplication, and bounded retry policies.
7. **Preserve user choice.** Where evidence is inconclusive, allow the user to proceed after an appropriate warning.
8. **Reuse existing CS3 infrastructure.** Inspect and extend the current source resolution, metadata, media probing, caching, playback, and provider analytics mechanisms instead of creating parallel systems.

## 4. Expected Content Metadata

Before validating a source, establish the expected identity and media characteristics of the requested content whenever reliable information is available.

### 4.1 Metadata sources

Reuse existing CS3 metadata integrations and supported external metadata services, including IMDb and TMDB where available.

Collect the following fields when available:

- Canonical title and alternate titles.
- Content type, such as movie or series.
- Release year or original release date.
- IMDb ID, TMDB ID, or another stable content identifier.
- Season and episode identifiers for episodic content.
- Expected runtime for a movie or episode.
- Language and release information where relevant.
- Other existing metadata that can help distinguish different versions or adaptations.

Metadata from a provider may be useful, but it must not automatically override a more reliable canonical identity.

### 4.2 Metadata confidence

Track whether each relevant metadata field is authoritative, corroborated, provider-supplied, inferred, or unavailable.

Avoid treating an approximate runtime or ambiguous title as definitive evidence.

If multiple metadata services disagree, preserve that uncertainty and avoid presenting a misleadingly precise validation result.

## 5. Runtime-Based Content Validation

### 5.1 Expected versus actual duration

Compare the expected runtime with the actual media duration when the resolved source can be inspected.

Examples:

- Expected movie duration: approximately 120 minutes.
- Detected media duration: 3 minutes.
- Result: strong evidence of a possible mismatch.

Another example:

- Expected movie duration: approximately 120 minutes.
- Detected media duration: 116 minutes.
- Result: potentially valid, depending on the content, metadata quality, and other available signals.

The runtime comparison must use configurable tolerances rather than exact equality.

### 5.2 Runtime validation rules

Implement validation rules that account for:

- Normal differences between releases, cuts, and editions.
- Intro sequences, outro sequences, and additional credits.
- Episodes with varying lengths.
- Movies, episodes, trailers, clips, short films, and other content types.
- Incorrect or incomplete runtime metadata.
- Media streams whose duration cannot be determined reliably.

Do not reject legitimate content merely because its runtime differs slightly from the expected value.

A short runtime can be a strong mismatch signal for a full-length movie, but duration alone must not establish that a source is an advertisement. Content type and other evidence must be considered.

### 5.3 Duration discrepancy

Calculate the absolute and relative runtime differences when both values are available.

Use configurable thresholds appropriate to the content type. Do not hard-code a single universal percentage for movies and episodes.

The validation result should include the expected duration, detected duration, discrepancy, applicable tolerance, and reason for the classification.

### 5.4 Runtime unavailable

If the actual duration cannot be obtained because a source is protected, unsupported, unreachable, or otherwise unprobeable, record the runtime check as inconclusive.

Do not repeatedly probe a source merely to obtain duration if doing so would cause unnecessary provider requests or delay playback.

## 6. Detect Misleading Responses and Access Restrictions

The system must distinguish actual media from responses that only appear to be successful.

### 6.1 Conditions to detect

Identify the following conditions where technically feasible:

- Advertisement or unrelated video returned instead of the requested content.
- Promotional banner or generic landing page.
- Application-update or API-update requirement.
- Authentication-required or access-restricted response.
- Rate limiting or temporary provider restriction.
- Expired or invalid media URL.
- Unsupported or unrecognized stream format.
- Media-probe failure.
- Playback startup failure.
- A valid stream that appears to contain the wrong movie or episode.

### 6.2 Evidence collection

Use available signals such as:

- HTTP status and response headers.
- Response content type.
- Page content and known provider-specific error patterns.
- Whether the response is an HTML page rather than media.
- Media duration and stream properties.
- Media-probe results.
- Playback initialization and startup errors.
- Existing provider reliability history.
- Previous validation outcomes for the same source, where applicable.

Do not download an entire media file just to determine whether it is valid. Use existing probing and streaming capabilities, bounded inspection, and metadata whenever possible.

### 6.3 Structured failure categories

Represent failures using structured, actionable categories rather than a generic error message.

Suggested categories:

- `CONTENT_MISMATCH`
- `SUSPICIOUS_DURATION`
- `ADVERTISEMENT_OR_PROMOTIONAL_RESPONSE`
- `UPDATE_REQUIRED`
- `AUTHENTICATION_REQUIRED`
- `RATE_LIMITED`
- `TEMPORARILY_UNAVAILABLE`
- `SOURCE_EXPIRED`
- `INVALID_MEDIA_RESPONSE`
- `UNSUPPORTED_MEDIA`
- `MEDIA_PROBE_FAILED`
- `PLAYBACK_START_FAILED`
- `METADATA_UNAVAILABLE`
- `VALIDATION_INCONCLUSIVE`

Keep the distinction between confirmed conditions and suspected conditions. For example, a three-minute response is not automatically an advertisement; it is a duration discrepancy until further evidence establishes more.

### 6.4 Provider-specific response recognition

Support provider-specific rules for known update notices, access restrictions, and misleading responses.

Keep these rules isolated within the existing provider integration architecture so that changes to one provider do not break other providers.

When a provider requires authentication or an application update, explain the restriction rather than repeatedly attempting to play the returned response.

## 7. Content Confidence and Validation Classification

Create a shared validation mechanism that combines available evidence into a confidence assessment.

### 7.1 Signals

The assessment should consider:

- Title and alternate-title match.
- Stable metadata identifiers.
- Release year.
- Movie versus series classification.
- Season and episode identity.
- Expected versus detected duration.
- Whether the response is actually a media resource.
- Media-probe results and stream properties.
- Playback startup outcome.
- Known provider-specific failure patterns.
- Historical provider reliability.
- Previous validation outcomes for the source.
- Temporary availability and rate-limit state.

No single signal should determine the final classification when other meaningful evidence is available.

### 7.2 Validation states

Use the following conceptual states:

**Validated**

Strong evidence indicates that the source matches the requested content and has passed the applicable technical checks.

**Likely Match**

Available evidence supports the requested identity, but one or more checks remain incomplete.

**Unverified**

Insufficient evidence is available to make a reliable determination.

**Possible Mismatch**

One or more meaningful signals conflict with the expected content, but the mismatch is not conclusively established.

**Confirmed Mismatch**

Strong evidence indicates that the source is not the requested content.

**Restricted**

The provider requires authentication, an application update, or another user action before content can be accessed.

**Temporarily Unavailable**

The source cannot currently be used because of a transient failure, rate limit, network issue, or similar condition.

**Invalid Source**

The returned resource is conclusively unusable as a media source under the applicable playback requirements.

Keep content identity confidence separate from technical playability where appropriate. A source may contain the correct movie but fail technically, or be technically playable while containing the wrong content.

### 7.3 Scoring

If a numerical confidence score is used, make its weights and thresholds configurable.

Avoid assigning a high confidence score simply because a provider has historically been reliable. Historical reliability is supporting evidence, not proof of the current source's identity.

Do not automatically train or adjust confidence weights from unverified outcomes. Use clearly labelled validation evidence and recorded outcomes.

## 8. Source Selection and Alternative Discovery

Integrate validation into the existing source-resolution and source-ranking mechanisms.

When the user clicks Play:

1. Identify the requested movie or episode using available metadata.
2. Discover sources using the existing provider architecture.
3. Reuse valid cached evidence when applicable.
4. Validate candidate sources using inexpensive checks first.
5. Probe media only when needed and when the source can be inspected safely and efficiently.
6. Rank candidates using relevance, validation confidence, technical compatibility, and provider reliability.
7. Prefer a verified source over an unverified or suspicious source.
8. If the best candidate is clearly mismatched or unusable, continue with appropriate alternatives within the configured search budget.
9. If no reliable candidate is available, explain the situation and let the user retry, refresh sources, or choose another available option.

Do not assume that a provider's successful search callback makes its result the preferred playback source.

### 8.1 Avoid excessive validation delays

Use staged validation:

- **Stage 1:** Inspect existing metadata and cached validation evidence.
- **Stage 2:** Validate response type, source structure, and known error patterns.
- **Stage 3:** Probe media duration and stream properties when justified.
- **Stage 4:** Use playback startup feedback to confirm technical usability.

Run independent, safe checks concurrently where appropriate, but preserve provider-specific concurrency limits.

Do not make every source undergo an expensive media probe before any playback can begin. Use the strongest available low-cost evidence to prioritize candidates, and reserve expensive checks for ambiguous or suspicious sources.

## 9. User Experience and Warnings

Warnings must explain what CS3 detected and why it matters.

### 9.1 Possible mismatch warning

Example:

**This source may not contain the requested movie.**

- Requested content: The Matrix
- Expected duration: approximately 2 hours
- Detected duration: 3 minutes
- Provider: Provider name
- Reason: The detected media is significantly shorter than the expected movie runtime.

Actions:

- **Choose another source**
- **Refresh sources**
- **Play anyway**, when appropriate

The user should be able to understand the discrepancy without needing to interpret internal technical errors.

### 9.2 Confirmed mismatch

When strong evidence establishes that the source contains unrelated content, do not present it as a normal, verified playback option.

Prefer another source. If the user can still explicitly access a suspicious source for diagnostic purposes, clearly label it as a mismatch and avoid implying that it is the requested movie.

### 9.3 Inconclusive validation

When the source cannot be validated but no meaningful mismatch has been established, use a proportionate warning rather than a definitive accusation.

For example:

"CS3 could not verify that this source contains the requested movie. Playback may still work."

Allow the user to proceed where appropriate.

### 9.4 Provider restrictions

When an update or authentication requirement is detected, explain the restriction clearly. Do not repeatedly attempt playback against a known restriction.

### 9.5 Avoid repetitive prompts

Cache recent validation outcomes using the existing cache infrastructure and appropriate source identity.

Avoid showing the same warning repeatedly for the same unchanged source unless new evidence changes the classification or the cached result expires.

## 10. Provider Request Protection and Rate Limiting

Build provider-aware request management into the existing request and source-discovery architecture.

### 10.1 Concurrency and request frequency

- Enforce configurable per-provider concurrency limits.
- Limit repeated requests for the same content and provider.
- Deduplicate identical in-flight requests when their semantics and cache identity permit.
- Coordinate requests across relevant search, refresh, and validation workflows where the existing architecture allows.
- Avoid uncontrolled bursts from background tasks and repeated user actions.

### 10.2 Rate-limit detection

Detect HTTP 429 and other known provider-specific rate-limit responses.

Respect `Retry-After` and other applicable server guidance.

Do not assume every HTTP 403 response is a rate limit. It may represent authentication, anti-bot protection, access restrictions, or another condition.

### 10.3 Backoff and recovery

For retryable failures:

- Apply bounded exponential backoff with jitter.
- Avoid immediate repeated retries across multiple concurrent tasks.
- Reduce requests to providers that are failing or rate-limiting.
- Gradually restore request activity when the provider recovers.
- Preserve the distinction between transient failures and permanent provider problems.

Never create infinite retry loops or uncontrolled request bursts.

### 10.4 Circuit breaker

Where justified by existing architecture, introduce a provider-level circuit breaker.

When a provider repeatedly returns transient failures or rate limits, temporarily reduce or suspend requests to it. Permit controlled recovery checks rather than repeatedly probing it at full concurrency.

A temporary circuit-breaker state must not permanently mark the provider as broken.

### 10.5 Cache integration

Reuse existing cache identity and invalidation rules.

Cache only appropriate data, distinguishing between:

- Content metadata.
- Source-discovery results.
- Validation outcomes.
- Provider health and temporary restriction state.
- Expired or unusable source references.

Do not cache a temporary rate limit as a permanent failure, or treat stale source links as permanently valid.

## 11. Provider Reliability Analytics

Record structured validation and playback outcomes to help identify reliable providers and recurring failures.

Capture, where available:

- Provider and source identity.
- Requested content identity.
- Expected and detected duration.
- Metadata match confidence.
- Validation classification and reasons.
- Media-probe outcome.
- Playback startup outcome.
- Error category and relevant HTTP status.
- Retry count and recovery result.
- Rate-limit and circuit-breaker events.
- Whether a user proceeded after a warning.

Use aggregated, time-aware reliability signals to improve source ranking.

Avoid allowing a single failed source to invalidate an entire provider. Distinguish content-specific failures, temporary provider failures, and broader reliability patterns.

Do not store authentication secrets, session cookies, or unnecessary personal information in analytics.

## 12. Integration Requirements

Before implementation, inspect the existing source code and identify the current implementation of:

- Metadata lookup and content identity.
- Provider search and source discovery.
- Source ranking and selection.
- Media probing and duration extraction.
- Playback initialization and error handling.
- Source refresh and resume flows.
- Cache identity, expiry, and invalidation.
- Provider concurrency and retry management.
- Provider reliability analytics and diagnostics.
- Renderer-to-main-process communication, where relevant.

Extend these existing mechanisms rather than introducing a separate source-resolution subsystem.

Preserve provider identity and source provenance throughout discovery, validation, caching, playback, and analytics.

Keep validation outcomes and failure categories consistent across search results, details pages, source selection, and playback.

## 13. Testing Requirements

Cover at least the following scenarios.

### Content identity

- A full-length movie resolves to a two- or three-minute advertisement.
- A valid movie has a slightly different runtime from metadata.
- A legitimate short film is returned.
- A series episode is matched against the wrong season or episode.
- Two films have similar titles but different release years.
- A source has the correct runtime but incorrect content.
- Metadata sources disagree or provide no runtime.

### Provider responses

- The provider returns an update-required page.
- The provider requires authentication.
- The provider returns a promotional page instead of media.
- A URL returns HTML instead of a media resource.
- A media URL exists but cannot be probed.
- A valid source fails during playback startup.
- An expired source becomes available again after refreshing it.

### Request protection

- A provider returns HTTP 429 with `Retry-After`.
- A provider rate-limits concurrent requests.
- Multiple identical requests occur simultaneously.
- A provider recovers after temporary failure.
- A provider remains unavailable after the retry budget is exhausted.
- Cached validation expires and is refreshed correctly.

### User experience

- A suspicious source triggers an understandable warning.
- A validated source does not trigger unnecessary prompts.
- An inconclusive source is not automatically rejected.
- The user can select another source or refresh discovery.
- Repeated attempts do not produce an endless stream of identical warnings.

## 14. Implementation Phases

### Phase 0: Source-Code Audit and Baseline

- Map the existing metadata, source-resolution, probing, playback, caching, and provider request flows.
- Identify reusable mechanisms and missing capabilities.
- Record current source-validation and playback failure behavior.
- Establish a baseline for startup delay, probe overhead, provider requests, and playback success.

**Deliverable:** A code-grounded implementation plan that identifies the exact modules to extend.

### Phase 1: Shared Validation Model

- Define structured validation states and failure categories.
- Implement metadata-based expected runtime retrieval.
- Add duration comparison and configurable tolerance rules.
- Distinguish content identity confidence from technical playability.
- Add tests for metadata gaps and runtime discrepancies.

**Deliverable:** A reusable validation service with deterministic unit tests.

### Phase 2: Response and Media Verification

- Detect common non-media responses and provider restrictions.
- Integrate existing media probing and playback startup signals.
- Identify strong mismatch evidence and inconclusive outcomes.
- Preserve provider identity and source provenance.

**Deliverable:** A shared verification pipeline for source candidates.

### Phase 3: Source Ranking and User Warnings

- Integrate validation into source selection and fallback behavior.
- Prefer verified sources.
- Add clear warnings for suspicious sources.
- Provide alternative-source and refresh actions.
- Prevent repeated warnings for unchanged validation results.

**Deliverable:** A user-facing experience that avoids presenting suspicious sources as confirmed matches.

### Phase 4: Provider Request Protection

- Add or refine per-provider concurrency and request-frequency limits.
- Implement rate-limit detection and bounded backoff.
- Deduplicate suitable in-flight requests.
- Add circuit-breaker behavior where justified.
- Verify recovery after temporary restrictions.

**Deliverable:** A provider-aware request management mechanism that reduces avoidable rate limits and repeated failures.

### Phase 5: Analytics and Reliability Ranking

- Record validation and playback outcomes.
- Aggregate reliability signals.
- Incorporate sufficiently reliable historical evidence into source ranking.
- Add diagnostics for recurring provider-specific problems.

**Deliverable:** Measurable source-quality improvements based on actual validation evidence.

### Phase 6: Integration and Regression Testing

- Test the full search-to-playback flow.
- Verify movies, episodes, alternate releases, short-form content, and incomplete metadata.
- Verify source refresh, playback resume, and fallback behavior.
- Measure validation overhead and ensure request protection does not unnecessarily delay playback.
- Confirm that all existing provider and player functionality remains compatible.

**Deliverable:** A fully integrated validation and reliability system with regression coverage.

## 15. Acceptance Criteria

The implementation is complete when:

1. A successful provider response is no longer treated as proof that the intended content is available.
2. Reliable expected runtime metadata is used to detect significant duration discrepancies.
3. A movie resolving to a very short unrelated clip is identified as suspicious before it is presented as a confirmed match, whenever the available evidence permits.
4. Legitimate content with slightly different runtime is not rejected solely because of that difference.
5. Missing metadata or unavailable duration produces an inconclusive result rather than an automatic rejection.
6. Known update-required, authentication-required, and non-media responses are classified clearly.
7. Content identity and technical playability are evaluated separately where necessary.
8. Suspicious sources produce actionable warnings with the reason and available duration details.
9. Reliable alternative sources are prioritized when a candidate is suspicious or unusable.
10. Per-provider concurrency, request-frequency limits, bounded retries, and rate-limit handling reduce unnecessary repeated requests.
11. Temporary provider failures do not permanently damage provider rankings.
12. Validation and playback outcomes are recorded without storing unnecessary sensitive information.
13. Validation results are consistent across search, source selection, playback, refresh, and resume flows.
14. Existing CS3 functionality remains compatible, and validation overhead is measured and controlled.

## 16. Final Outcome

CS3 should evolve from a system that finds provider responses into a system that evaluates whether those responses are relevant, technically usable, and trustworthy.

The application should protect users from misleading content, explain suspicious results clearly, favor reliable alternatives, and handle provider restrictions responsibly. It should simultaneously reduce unnecessary traffic and improve long-term provider reliability through measured, evidence-based validation rather than assumptions.