> **Checked 2026-10-28: superseded in substance by the Playback Source Resolution PRD (v2) and the Content Validation PRD.** Built: RPC lanes put Play work ahead of background work (`RpcLanes.java`, §128.1, 128.10); the ranked, budgeted discovery walk with early stop (`cs3/discoveryWalk.ts`, §128.2, 128.5); hit judging (`cs3/providerHitMatch.ts`, §128.3–128.4); per-source cache expiry (`sourceCache.ts`, §128.7); played-source resume and same-provider replacement (`cs3/playedSource.ts`, §128.9); provider back-off (`cs3/providerCooldown.ts`). Not built: automatic link refresh on 401/403 (§128.8, needs the `SourceLease` resolver, Part D).

### 128. Intelligent Source Discovery, Search Prioritization, Content Matching, and Automatic Source Refresh

#### Objective

Redesign the source discovery workflow to prioritize fast, accurate playback instead of waiting for every enabled provider, extension, and repository to finish searching. The system must intelligently prioritize which sources to fetch, improve the accuracy of content matching, cache discovered sources for future visits, and automatically recover expired or unavailable playback links.

The primary goal is to reduce the time between a user selecting a title and successfully starting playback while minimizing incorrect matches, unnecessary provider requests, and manual intervention.

Use the existing source code as the primary reference. Audit the current search, metadata, provider, repository, source caching, playback, and recovery pipelines before making changes. Reuse existing services and mechanisms wherever possible instead of introducing duplicate implementations.

#### 128.1. Prioritize Playback-Related Work Over Background Operations

Source discovery is a core responsibility of CS3. When a user is actively trying to play media, playback-related work must receive higher priority than background operations that are not necessary for immediate playback.

- Prioritize source discovery, source validation, and playback initialization when the user opens a media detail page or initiates playback.
- Avoid allowing background metadata enrichment, recommendations, unrelated catalogue searches, or other nonessential API requests to delay playback unnecessarily.
- Preserve background functionality, but schedule it around active user operations.
- Use appropriate concurrency limits, cancellation, deduplication, and request prioritization to prevent excessive simultaneous requests from enabled providers and repositories.
- When the user navigates away from a title or starts another playback request, cancel or deprioritize obsolete work where safe.
- Avoid starving background tasks indefinitely. Resume or schedule them when foreground demand decreases.
- Provide progressive results and meaningful loading states rather than forcing users to wait for the entire source discovery pipeline to complete.

#### 128.2. Intelligent Source Discovery Based on Search Result Order

Currently, when the selected provider does not return usable sources, CS3 may search across all enabled providers, extensions, and repositories. Although this can discover additional sources, it can also create long waits and return unrelated media, particularly when a title has many similar or ambiguous matches.

Introduce an ordered, progressive source discovery strategy that uses the user's original search results as a starting point.

For example, when a user searches for *Spider-Man* and receives ten results from different providers:

1. The user selects the fifth result.
2. CS3 first attempts to retrieve and validate sources for that exact selected result.
3. If no usable source is found, CS3 evaluates the other search results in a defined fallback order, prioritizing the most relevant candidates.
4. Each candidate is checked for identity and compatibility before its sources are accepted.
5. As soon as a suitable source is found, CS3 should make it available for playback without waiting for every remaining candidate or provider to finish.
6. Additional discovery may continue in the background when useful, without blocking playback.

The fallback order must be configurable through a well-defined ranking strategy rather than hard-coded assumptions about result positions.

- Preserve the exact identity and provenance of the selected result, including its provider, external identifiers, title, year, media type, and season or episode information when available.
- Prefer the selected result first, followed by candidates with strong evidence that they represent the same underlying media.
- Use search-result position as one relevance signal, not as proof of identity.
- Do not automatically accept the second, third, or fourth result simply because it appears near the selected result.
- Avoid searching unrelated results when stronger metadata or identity checks indicate that they represent different content.
- If no sufficiently reliable alternative exists, report that no suitable source was found rather than silently playing unrelated media.
- Allow users to access broader source discovery when the initial prioritized attempts fail.

The objective is to improve the likelihood of finding a valid source quickly while maintaining strict content identity.

#### 128.3. Distinguish Provider Results from Actual Media Identity

A search result returned by an extension or provider is not necessarily the canonical identity of the media the user wants to watch. Different providers may return duplicate titles, alternate editions, remakes, adaptations, unrelated works, or incorrect metadata.

CS3 must distinguish between:

- **Canonical media identity:** The actual movie, series, season, episode, or other intended content.
- **Search result identity:** The individual catalogue entry returned by a provider.
- **Provider identity:** The extension, repository, or provider responsible for the result.
- **Source identity:** The specific stream, torrent, file, manifest, or other playable resource.
- **Playback resource:** The current URL and associated headers, session information, and expiry details required to access the media.

Use the existing metadata matching and source resolution architecture to compare candidates conservatively.

Matching signals should include, where available:

- Canonical external IDs, such as IMDb or TMDB identifiers.
- Normalized titles and known alternate titles.
- Original release year and release type.
- Movie versus series classification.
- Season and episode identifiers, including episode titles when available.
- Original language and other relevant metadata.
- Provider-specific identifiers and source metadata.
- Additional evidence that helps distinguish remakes, adaptations, regional titles, and similarly named content.

Canonical identifiers and reliable episode metadata should take precedence over superficial title similarity. Missing metadata should not automatically disqualify an otherwise valid candidate, but it must not be treated as evidence of a match either.

A year mismatch, conflicting media type, incompatible episode information, or other strong contradiction should significantly reduce the candidate's eligibility or disqualify it where appropriate.

#### 128.4. Handle Ambiguous and Older Content More Carefully

Some titles are particularly difficult to match because they have many adaptations, remakes, animated versions, and unrelated works sharing similar names.

For example, B. R. Chopra's *Mahabharat* (1988–1990), identified by IMDb title ID `tt0158417`, is an important regression case. Broad source discovery frequently returns unrelated content, including animated adaptations, other television series, and entirely different works associated with the Mahabharata name.

For such titles:

- Preserve the identity of the specific series or movie selected by the user.
- Prefer exact external identifiers and compatible media type, release period, and episode metadata.
- Do not treat every title containing `Mahabharat` or `Mahabharata` as an acceptable match.
- Do not merge unrelated adaptations merely because they share characters, subject matter, or a franchise name.
- Use broader title-based matching only when stronger identifiers are unavailable, with appropriate confidence thresholds.
- Require stronger matching evidence before automatically switching to an alternative result for historically ambiguous or highly duplicated titles.
- If a candidate is ambiguous, allow further discovery without automatically selecting it for playback.

Build a regression test set containing *Mahabharat* (1988–1990) and other ambiguous titles with remakes, adaptations, similarly named series, and multiple releases.

#### 128.5. Progressive Discovery and Early Playback

Source discovery must support early playback rather than behaving as a single blocking operation.

- Start with the selected result and the highest-priority source candidates.
- Validate each candidate as soon as its source information becomes available.
- Expose usable sources progressively to the player.
- Start playback as soon as a sufficiently reliable source is available, without waiting for unrelated providers to complete.
- Continue lower-priority discovery in the background when it can provide additional alternatives.
- Update the source picker as more results arrive without resetting the active playback session or disrupting the user.
- Keep the user informed about whether sources are being searched, whether usable sources have been found, and whether additional discovery is continuing.
- Support cancellation and navigation without leaving obsolete requests running unnecessarily.

Do not interpret a provider's successful API response as proof that its returned media is playable or correct. Source validation and media identity checks must remain separate from provider response handling.

#### 128.6. Source Discovery When the User Has Not Opened a Detail Page

The system must also support cases where the user initiates playback directly from a search result, Home screen, catalogue, or another screen without first visiting the media detail page.

In these cases, CS3 may not have the same detailed metadata or preloaded source context that is available on the detail page.

Implement an appropriate strategy that:

- Uses the selected item's available metadata and provider provenance immediately.
- Starts source discovery for that item without requiring the user to open its detail page first.
- Retrieves additional identity information only when necessary to improve matching confidence.
- Uses the same source prioritization, candidate ranking, validation, and caching logic as the detail-page workflow.
- Falls back to relevant alternatives when the selected provider has no usable source.
- Avoids requiring every enabled provider and repository to finish before playback can begin.
- Preserves the selected media identity throughout fallback discovery and playback.

Do not duplicate source discovery logic for different navigation entry points. Use a shared orchestration layer with appropriate context supplied by each entry point.

#### 128.7. Cache Discovered Sources for Fast Reuse

Persist useful source discovery results so that revisiting the same media does not require repeating the entire provider search unnecessarily.

- Cache source metadata, provider provenance, canonical media identity, source identity, quality information, language information, and season or episode identity where applicable.
- Preserve the relationship between the selected media and any alternative candidate that produced a usable source.
- Store source results independently from temporary playback URLs, authentication headers, session credentials, and other expiring information.
- Use the existing source cache and its per-source expiry mechanisms wherever possible.
- Deduplicate equivalent discovery requests and reuse valid cached results across compatible entry points.
- Restore cached source candidates promptly when the user revisits a title.
- Validate cached results against the requested media identity before offering or playing them.
- Cache useful alternative-source mappings so the system can reuse previously successful fallback discoveries without repeating broad searches.
- Invalidate or refresh individual stale resources without unnecessarily discarding valid metadata or unrelated cached sources.
- Ensure cache persistence and invalidation are consistent with the existing application lifecycle and user-data management behavior.

A cached result must not be considered playable merely because it was playable during an earlier session. Its resource may have expired, its session may have ended, or the provider may have removed it.

#### 128.8. Automatically Refresh Expired or Unavailable Playback Links

Playback links returned by providers may be temporary, session-based, signed, or otherwise time-sensitive. A link that works during the initial session may fail when the user returns several hours later.

For example, a user may watch a title for ten minutes, close or leave CS3, and return five or ten hours later. The previously stored link may have expired, but the cached source metadata may still be useful.

Implement automatic source recovery so users do not need to understand caching, manually clear caches, or repeatedly press refresh.

- Before playback, determine whether the cached resource is known to be expired or requires refresh.
- If a cached link fails during playback, classify the failure and invoke the appropriate recovery path.
- Use the existing source refresh and recovery mechanisms, including `contentService.getSources` with `{ bypassCache: true }` where appropriate.
- Re-resolve the resource through its original provider when possible, preserving the media identity and provider context.
- If the original provider cannot produce a usable resource, try the next eligible cached or newly discovered alternative.
- Reuse valid cached metadata and source identities even when the associated URL has expired.
- Do not repeatedly retry a resource that has already been confirmed unusable unless there is evidence that a retry could succeed.
- Avoid infinite retry loops, repeated full-provider searches, and unnecessary network requests.
- Distinguish expired URLs, authentication or session failures, network interruptions, provider errors, missing resources, and unsupported media formats where possible.
- Preserve playback position and relevant playback settings during recovery.
- Show a clear, nontechnical message only when automatic recovery cannot proceed or requires user action.

Automatic refresh should be transparent during normal operation. Advanced source and cache diagnostics may remain available for troubleshooting, but they must not be prerequisites for ordinary playback.

#### 128.9. Remember Successful Sources and Learn from Provider Performance

Use existing source-selection and provider-ranking mechanisms to improve future discovery.

- Record which source was actually played successfully, rather than assuming that the first returned source was used.
- Preserve the association between successful sources and the exact media, season, or episode.
- Reuse a previously successful source when its identity still matches and its playback resource is valid.
- If the resource has expired, refresh it through the original provider before falling back to unrelated candidates.
- Update provider reliability and ranking data based on meaningful playback outcomes, using existing analytics where available.
- Distinguish provider API success from actual playback success.
- Avoid rewarding providers for returning many results if those results are frequently unrelated or unplayable.
- Account for false matches, failed playback, expired links, repeated network errors, and successful recovery.
- Prevent one failure caused by a temporary network issue or an expired link from permanently penalizing an otherwise reliable provider.
- Ensure that historical provider performance never overrides strong media identity checks.

The goal is to make future source discovery faster and more accurate without allowing historical rankings to cause incorrect media selection.

#### 128.10. Source Discovery Scheduling, Concurrency, and Cancellation

Audit the current provider and repository request orchestration before implementing new scheduling logic.

- Establish a shared prioritization policy for foreground playback, detail-page source discovery, user-initiated refreshes, and background work.
- Give active playback requests priority over nonessential metadata enrichment and unrelated searches.
- Avoid launching redundant requests when multiple components request sources for the same media.
- Apply bounded concurrency and appropriate timeouts to slow or unresponsive providers.
- Ensure that one provider failure does not prevent other providers from returning results.
- Support cancellation when the user changes the selected title or no longer needs the pending results.
- Preserve useful completed results even if the broader search is cancelled.
- Avoid allowing lower-priority requests to block high-priority playback work.
- Ensure that provider timeouts and partial failures are handled consistently.
- Keep request scheduling compatible with progressive search, existing caching, provider analytics, and playback recovery.

Do not simply reduce the number of providers queried through a fixed limit. The system should select the most relevant candidates first and expand discovery intelligently when necessary.

#### 128.11. User Experience and Transparency

Source discovery and recovery are implementation details that should require minimal user effort.

- A user should be able to select a title and begin watching as quickly as possible.
- Do not require users to understand providers, repositories, extensions, source caches, URL expiry, or manual refresh procedures.
- Keep loading indicators concise and informative.
- Distinguish initial source discovery from background discovery of additional alternatives.
- Make available sources usable as soon as they have passed the necessary checks.
- Do not display false success states when a source has only been discovered but not validated.
- Avoid interrupting active playback when additional sources become available.
- Offer broader discovery or manual source selection when automated recovery cannot find a suitable result.
- Keep technical diagnostics available in appropriate advanced or developer-facing interfaces.

#### 128.12. Implementation and Regression Testing

Before implementation, inspect the existing search pipeline, metadata provider, `ContentService`, `IndexerRegistry`, source cache, provider ranking and analytics, `playedSource.ts`, playback session management, and recovery mechanisms. Identify which responsibilities already exist and extend them rather than creating competing systems.

Test at least the following scenarios:

1. The selected provider immediately returns a valid source.
2. The selected provider returns no sources, but a highly relevant alternative does.
3. The selected provider returns sources that are invalid, unplayable, or unrelated to the requested media.
4. A user selects the fifth result from a list of ten results, and discovery prioritizes that selection before considering relevant alternatives.
5. An alternative source is found quickly while slower providers are still running.
6. The user starts playback directly from a search result without opening the detail page.
7. A movie has many similar titles, remakes, or adaptations.
8. B. R. Chopra's *Mahabharat* (1988–1990, IMDb `tt0158417`) is searched and played without automatically substituting unrelated adaptations.
9. Cached sources are reused on a subsequent visit.
10. A cached playback URL expires after several hours and is refreshed automatically.
11. A source fails during playback and recovery preserves the playback position.
12. The original provider is unavailable, but a previously discovered alternative remains valid.
13. One provider times out or returns malformed data while other providers continue to respond.
14. The user changes titles or cancels discovery while requests are running.
15. Background metadata or catalogue operations do not unnecessarily delay active playback.
16. Repeated visits do not trigger duplicate provider searches or unbounded cache growth.
17. Provider reliability rankings improve from verified outcomes without overriding media identity checks.

#### Acceptance Criteria

- Playback-oriented source discovery receives priority over nonessential background operations.
- The selected media result is always evaluated first.
- Alternative candidates are evaluated progressively and in a relevance-aware order.
- Playback can begin as soon as a sufficiently reliable source is available, without waiting for all providers to finish.
- Incorrectly matched media is rejected rather than accepted solely because its title is similar or it appears near the selected search result.
- Ambiguous titles, including *Mahabharat* (1988–1990), receive stricter identity validation.
- Discovered source metadata and successful alternative mappings are cached and reused where appropriate.
- Expired playback URLs are refreshed automatically without requiring users to clear the cache manually.
- Recovery preserves the requested media identity and playback position wherever possible.
- Provider ranking reflects meaningful playback outcomes rather than raw result counts alone.
- The implementation reuses existing services and integrates with the current search, caching, analytics, and playback architecture.
- Tests demonstrate measurable improvements in time to first usable source, playback success rate, incorrect-match rate, and unnecessary provider requests.
- The system remains responsive, cancellable, fault-tolerant, and understandable to nontechnical users.