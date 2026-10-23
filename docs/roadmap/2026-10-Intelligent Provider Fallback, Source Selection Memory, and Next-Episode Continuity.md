# PRD: Intelligent Provider Fallback, Source Selection Memory, and Next-Episode Continuity

## 1. Objective

Improve CS3's provider search, source discovery, and playback continuity so users can find a reliable source once and continue watching subsequent episodes or related parts without repeatedly searching through providers and manually selecting a source.

The system must investigate and improve the existing behavior when the preferred provider fails, CS3 searches other providers, and multiple candidate links are returned.

The key requirements are:

1. Verify that the current provider fallback and source-validation logic behaves correctly.
2. Preserve provider and source metadata throughout provider discovery, validation, ranking, and playback.
3. Remember the provider and source characteristics the user selected for a particular movie, series, or episode.
4. Prioritize that successful provider when resolving subsequent episodes or related content.
5. Fall back intelligently when the preferred provider does not have a valid source for the next episode.
6. Avoid repeating unnecessary provider searches and source checks when reliable, reusable information is already available.

## 2. Current Problem

CS3 searches across multiple providers to find playable sources. When the preferred provider fails to respond or does not provide usable links, the application may search other providers.

A provider can return multiple candidate links, and CS3 may validate or attempt to resolve them individually before identifying a suitable source.

This behavior needs to be audited to determine:

- Whether provider fallback starts at the correct time.
- Whether all relevant providers are searched or only a subset.
- Whether valid candidate links are checked efficiently.
- Whether invalid or unrelated sources are filtered out correctly.
- Whether provider results and their metadata remain available after source selection.
- Whether the application remembers the provider the user successfully selected.
- Whether the next episode can reuse that provider preference rather than restarting discovery from scratch.

The intended improvement is to make source selection increasingly efficient across a viewing session while preserving content correctness and allowing automatic recovery when the previously successful provider cannot supply the next episode.

## 3. Phase 0: Audit the Existing Search and Fallback Logic

Before changing behavior, inspect the current source code and trace the complete source-resolution flow.

Review:

- Provider discovery and search orchestration.
- Preferred-provider selection and fallback behavior.
- Provider response handling and timeout behavior.
- Candidate source extraction and deduplication.
- Link validation and media probing.
- Source ranking and selection.
- Playback initialization and failure recovery.
- Provider identity propagation through the application.
- Source metadata persistence and cache behavior.
- Episode navigation and next-episode source resolution.
- Existing provider reliability analytics.

Establish what happens when:

1. The preferred provider returns no response.
2. The provider responds but returns no links.
3. The provider returns links that are invalid or expired.
4. The provider returns multiple links with different qualities.
5. The provider returns a playable source for the correct content.
6. The user selects a source and starts playback.
7. The user advances to the next episode.
8. The preferred provider has no matching source for that episode.

Do not assume the current implementation is wrong or correct without tracing the actual code paths.

**Deliverable:** A code-grounded report describing the current behavior, identified inefficiencies, missing metadata, and the smallest safe changes needed.

## 4. Provider Fallback and Candidate Validation

### 4.1 Provider fallback

When the preferred provider fails to provide a usable source, CS3 should continue with suitable alternatives according to the existing provider-ranking and fallback policies.

Differentiate between:

- Provider timeout or no response.
- Successful response with no results.
- Results containing invalid or expired links.
- Sources that fail media probing.
- Sources that fail playback initialization.
- Sources that appear to contain unrelated content.
- Sources that are valid but do not meet the user's quality or language preferences.

A successful provider response must not automatically be treated as a successful source resolution.

### 4.2 Candidate link validation

Investigate whether CS3 currently checks candidate links individually and whether that process is efficient.

Reuse existing source-validation mechanisms to assess:

- Content identity.
- Provider identity.
- Quality and resolution.
- Language and supported media properties.
- URL validity and expiration.
- Stream compatibility.
- Expected versus detected runtime when available.
- Playback or media-probe outcomes.
- Historical provider reliability.

Do not repeatedly probe the same unchanged source unnecessarily. Reuse valid cached evidence when appropriate, and refresh it when the source expires or the relevant conditions change.

### 4.3 Search strategy

Use a staged, bounded strategy rather than blindly checking every provider and every candidate link before playback can begin.

A suitable strategy is:

1. Try the preferred provider when appropriate.
2. Validate its returned candidates using inexpensive checks first.
3. Prioritize the strongest candidates.
4. If no suitable candidate is found, search additional providers according to provider ranking and request budgets.
5. Stop unnecessary discovery once a sufficiently reliable source is selected, unless the user explicitly requests more alternatives.
6. Preserve the remaining search state where appropriate so source refresh and fallback do not restart the entire process.

The strategy must respect provider-specific concurrency limits and rate limits. It must not sacrifice correctness merely to minimize search time.

### 4.4 Preserve all useful results

When multiple providers return candidate sources, preserve their provider identity and relevant metadata until the source-selection process has completed.

Do not discard the relationship between a source and the provider that produced it during normalization, deduplication, caching, or IPC serialization.

The application should be able to explain which provider supplied a source, what quality it offers, and why it was selected or rejected.

## 5. Preserve Provider and Source Metadata

Create or extend a shared source metadata model using the existing application architecture.

For each candidate source, retain the relevant fields that are actually available:

- Provider identifier and display name.
- Original provider result identity, where available.
- Requested content identity.
- Movie or series identifier.
- Season and episode identifiers where applicable.
- Source title or release name.
- Quality and resolution.
- Audio and subtitle language information, when available.
- Source URL or reference, subject to existing security and persistence rules.
- Source type and media format, when available.
- Validation state and failure reason.
- Discovery timestamp and freshness information.
- Source-selection outcome.
- Playback outcome.
- Whether the user explicitly selected the source or the system selected it automatically.

Treat volatile direct links separately from stable provider identity and source preferences. A source URL may expire, while the provider preference can remain useful.

Do not store unnecessary authentication data or assume that a direct media URL will remain valid indefinitely.

## 6. Remember the User's Successful Provider Choice

When a user selects a source and playback successfully begins, record that choice as a preference for resolving related content.

The goal is not to force the user to use the same provider forever. It is to prioritize a provider that has already delivered a satisfactory source for the current viewing context.

### 6.1 Preference scope

Support a preference hierarchy based on the available content and source identifiers:

1. Current playback session.
2. Current series and season.
3. Current series.
4. Related content or another episode of the same series, when the relationship is established.
5. General provider preference, only if CS3 already supports such a concept and the user expects it.

The current series is the most important scope for next-episode continuity.

Do not assume that a provider that works for one movie will necessarily be suitable for unrelated movies.

### 6.2 What to remember

Store the minimum useful preference information, such as:

- Selected provider identifier.
- Selected quality or resolution preference.
- Relevant language or source characteristics.
- Series or content identity.
- Last successfully selected source characteristics.
- Last successful playback outcome.
- Preference timestamp and freshness.

Record a successful playback outcome only when the existing player lifecycle provides sufficient evidence that playback actually started. Merely clicking a source must not count as success.

Where supported, use playback failure feedback to update the preference and reduce the priority of a provider that repeatedly fails.

### 6.3 Preference persistence

Reuse the existing persistence layer where possible.

Keep provider preferences distinct from temporary source URLs, expired-link caches, and playback-resume state.

Preferences should survive navigation and, where appropriate, application restarts. They should also expire or be reconsidered when the provider repeatedly fails, content identity changes, or the user explicitly selects a different provider.

## 7. Intelligent Next-Episode Source Resolution

When the user advances to the next episode, CS3 should use the previous successful source selection to reduce unnecessary searching.

### 7.1 Preferred resolution flow

1. Identify the next episode using the canonical series, season, and episode metadata.
2. Retrieve the most relevant successful provider preference for that series.
3. Check whether that provider can supply the requested episode.
4. Resolve fresh candidate links from that provider rather than blindly reusing an expired direct URL.
5. Validate the candidate against the intended episode and the user's quality preferences.
6. If a suitable source is available, prioritize it and continue playback with minimal additional interaction.
7. If the preferred provider cannot supply a valid source, fall back to other suitable providers.
8. If all alternatives fail, explain that no reliable source was found and offer source refresh or manual selection.

The user should not have to manually search the provider list again simply because the episode changed.

### 7.2 Maintain continuity without forcing a provider

The previous provider is a preference, not an absolute requirement.

If the preferred provider has no source for the next episode, returns the wrong episode, or provides an unusable link, CS3 should attempt an appropriate alternative.

Do not repeatedly retry a known-broken source or prevent playback merely because the previous provider is unavailable.

If the user explicitly selected a provider-only mode or otherwise restricted source selection, honor that constraint and explain when the provider cannot supply the episode.

### 7.3 Quality and language continuity

Where possible, preserve the user's previous quality and language preferences for subsequent episodes.

If the preferred quality is unavailable, follow the existing fallback policy. Do not silently downgrade quality if the user has configured strict quality requirements.

When an alternative provider is selected, validate the episode identity and apply the user's configured quality and language preferences.

### 7.4 Related content and multipart movies

Apply the same principle to multipart content or explicitly related titles when CS3 can establish their relationship reliably.

Do not assume that similarly named titles, sequels, remakes, or unrelated movies share a provider preference unless metadata establishes the relevant relationship.

## 8. Source Ranking and Reliability Feedback

Extend the existing provider-ranking mechanism to consider both historical reliability and the current source's validation evidence.

Potential ranking signals include:

- Successful playback history for the provider.
- Successful source resolution for the current series.
- Availability of the requested episode.
- Content identity confidence.
- Quality and language match.
- Media-probe success.
- Recent failures, expired links, and rate limits.
- The user's explicit provider preference.

Prefer current, content-specific evidence over a provider's general historical reputation.

A provider that reliably supplies one series should receive a stronger preference for that series, but should not automatically outrank every other provider for all content.

Do not permanently penalize a provider because of a single temporary failure.

## 9. User Experience

### 9.1 Automatic continuation

When a suitable source is found through the remembered provider preference, continue playback using the existing next-episode behavior.

Avoid unnecessary provider-selection dialogs when the user has enabled automatic continuation and the candidate source meets the required validation criteria.

### 9.2 Source fallback notification

If CS3 switches to another provider because the previous provider cannot supply the next episode, keep the experience unobtrusive when fallback succeeds.

Where useful, expose the provider used in the source information or playback details so the user can understand what happened.

### 9.3 Manual control

Users should still be able to open source selection and choose a different provider or quality.

A manual selection should update the relevant preference after successful playback, allowing subsequent episodes to follow the user's latest choice.

### 9.4 Failure feedback

When no reliable source can be found, provide a useful message rather than a generic playback failure.

Where available, explain whether the issue is:

- No matching episode found.
- Preferred provider unavailable.
- Candidate links expired or invalid.
- Content validation failed.
- Playback initialization failed.
- Other providers were searched without finding a suitable source.

Offer retry, refresh, or manual source selection where appropriate.

## 10. Caching and Performance

Use existing caching mechanisms to avoid redundant provider searches and repeated validation.

Distinguish between:

- Stable provider preferences.
- Provider search results.
- Source metadata.
- Temporary direct source URLs.
- Validation outcomes.
- Provider health and rate-limit state.

Apply appropriate expiry and invalidation rules to each category.

A remembered provider preference should not be invalidated merely because a direct link expires. Instead, resolve a fresh source from that provider.

Avoid launching duplicate searches when the same episode and provider are already being resolved. Reuse compatible in-flight work where the current architecture supports it.

Respect cancellation when the user changes episodes, stops playback, or initiates a new source search. Obsolete results must not overwrite the current playback state.

## 11. Testing Requirements

### Provider fallback

- Preferred provider returns no response.
- Preferred provider responds but returns no results.
- Preferred provider returns invalid links.
- Preferred provider returns multiple candidates.
- Another provider returns the correct, playable source.
- Multiple providers return duplicate candidates.
- Provider search is cancelled while fallback is in progress.

### Source metadata

- Provider identity survives source normalization and IPC.
- Source metadata remains associated with the correct candidate.
- Expired links do not invalidate stable provider preferences.
- Duplicate or stale source results are handled correctly.
- Validation failures are attributed to the correct provider.

### Next-episode continuity

- User selects a provider and successfully plays an episode.
- Next episode is available from the same provider.
- Next episode is unavailable from the preferred provider.
- Preferred provider returns an incorrect episode.
- Preferred provider returns an expired link.
- Alternative provider supplies a valid episode.
- User manually selects a different provider and successfully plays.
- Subsequent episodes prioritize the new successful preference.
- Strict provider or quality preferences are honored.

### Performance and reliability

- Repeated episode navigation does not trigger unnecessary full-provider searches.
- Existing source cache and validation logic are reused correctly.
- Rate limits and provider concurrency limits are respected.
- Stale search results do not replace current episode results.
- Temporary provider failures do not permanently damage ranking.
- Preferences persist according to the intended scope and lifecycle.

## 12. Implementation Phases

### Phase 0: Audit Current Behavior

Trace provider fallback, candidate validation, source metadata, playback success, and next-episode resolution.

**Deliverable:** A source-code-based assessment of the current implementation and identified gaps.

### Phase 1: Preserve Source Metadata

Ensure provider identity and relevant source characteristics survive discovery, normalization, ranking, caching, and playback.

**Deliverable:** Reliable source provenance throughout the playback pipeline.

### Phase 2: Record Successful Source Preferences

Persist the provider and source characteristics associated with successful playback at the appropriate content scope.

**Deliverable:** A reliable record of the user's successful provider choice.

### Phase 3: Implement Next-Episode Continuity

Prioritize the remembered provider for the next episode, resolve a fresh link, validate it, and fall back when necessary.

**Deliverable:** Reduced repeated source searching and smoother episode-to-episode playback.

### Phase 4: Improve Ranking and Efficiency

Use content-specific success history, validation results, and provider health to improve source ordering while respecting request budgets.

**Deliverable:** Faster and more reliable source selection without unnecessary provider traffic.

### Phase 5: Regression and Integration Testing

Verify source selection, fallback, metadata preservation, preference persistence, episode navigation, cancellation, and playback recovery.

**Deliverable:** A fully integrated implementation that preserves existing CS3 playback functionality.

## 13. Acceptance Criteria

The implementation is complete when:

1. The existing provider fallback and candidate-validation behavior has been audited against the actual source code.
2. Provider identity and source metadata are preserved for every relevant candidate.
3. The application records the provider preference associated with successful playback.
4. Next-episode resolution prioritizes the previously successful provider for the same series.
5. The application resolves fresh source links instead of blindly reusing expired direct URLs.
6. Every selected source is checked against the intended episode and applicable quality preferences.
7. The system falls back intelligently when the preferred provider cannot provide a suitable source.
8. User-selected provider and quality restrictions are honored.
9. Source discovery avoids unnecessary repeated work while respecting provider limits.
10. Manual source selection updates the relevant preference after successful playback.
11. Temporary failures do not permanently damage provider ranking or continuity.
12. Existing movie playback, series playback, source selection, and playback-resume behavior remain compatible.

## 14. Expected Outcome

CS3 should remember what works for the user and use that information intelligently.

When a user finds a reliable source for a series, the application should prioritize that provider for subsequent episodes, validate the newly resolved source, and continue playback with minimal interaction. If the provider cannot supply the correct episode, CS3 should find a suitable alternative without making the user repeat the entire search process.

The result should be a faster, more consistent viewing experience built on verified source metadata, reliable provider preferences, and intelligent fallback rather than repeated manual source selection.