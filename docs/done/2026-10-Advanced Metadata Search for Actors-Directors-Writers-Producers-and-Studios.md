> **Filed 2026-10-20: Done.** Built; the main modules exist in the code (full line-by-line check not done). See [docs-audit-2026-10-20](../roadmap/docs-audit-2026-10-20.md).

# PRD: Advanced Metadata Search for Actors, Directors, Writers, Producers, and Studios

## 1. Objective

Expand CS3 Desktop search beyond exact movie and TV-series titles by enabling users to discover content through people, production companies, and other metadata.

Users should be able to find films and series associated with a particular actor, director, writer, producer, or studio without knowing the titles beforehand.

For example, searching for the Russo brothers should help users discover films and series associated with Joe Russo and Anthony Russo, including works they directed or produced. Searching for an actor should return their filmography, while searching for a production studio should discover content associated with that company.

This capability must be optional and unobtrusive. The existing title-search experience must remain the default.

**Core principle:** Metadata identifies relevant content; CS3's existing providers determine whether that content has available sources.

## 2. Current Architecture and Areas to Improve

Based on the current project documentation, CS3 already has several components that can support this feature.

| Existing component | Current documented responsibility | Proposed use |
|---|---|---|
| `SearchSessionManager` and `search:*` | Provider search sessions and progressive updates | Preserve the existing provider-search workflow |
| `MetadataEnrichmentService` | Extended metadata and metadata updates | Reuse for metadata retrieval and enrichment where appropriate |
| `TitleEnricher` and source adapters | Metadata-enrichment integration | Inspect existing adapters before adding new ones |
| `ContentService` | Search, details, sources, and playback orchestration | Reuse the existing source-discovery and playback path |
| `metadata:*` | Extended metadata, related media, and trailers | Evaluate for reuse or extension |
| `home:setTmdbKey` | TMDB API-key configuration | Reuse the existing configuration mechanism if it is appropriate for this feature |

These responsibilities are documented in the API and service architecture. The exact current capabilities of each metadata adapter and whether any already support person-based searching must be verified against the source code before implementation.

Do not create a parallel metadata subsystem or duplicate existing enrichment and caching logic without demonstrating that the current architecture cannot support the requirement.

## 3. User Experience

### 3.1 Keep the Default Search Simple

The existing search box should continue searching titles through the user's selected providers.

Add a subtle search-mode control near the search field. It should remain visually secondary until the user chooses to use it.

Suggested modes:

- **Titles**: Existing default search.
- **People**: Search actors, directors, writers, and producers.
- **Studios**: Search production companies and studios.
- **Advanced**: Optional combination of metadata criteria, if supported without making the interface unnecessarily complicated.

Use a compact dropdown, popover, or secondary filter control rather than a large permanent toolbar.

Requirements:
- Title search remains the default for new and existing users.
- The current mode is clearly identifiable when it differs from the default.
- Changing modes does not silently change source profiles or installed-provider settings.
- Search mode is preserved while the user explores results and returns to the search screen.
- The mode resets according to a predictable policy when starting a new search.
- Keyboard navigation and accessibility are supported.

### 3.2 People Search

When the user selects People, search for people by name.

Examples:
- Robert Downey Jr.
- Christopher Nolan
- Steven Spielberg
- Joe Russo
- Anthony Russo

Because different people can share the same name, show a compact person-selection interface before loading their filmography when the match is ambiguous.

A person result should contain:
- Name.
- Profile image, when available.
- Primary profession or known-for category.
- A small number of recognizable works, when available.
- Relevant external metadata identity.

After the user selects a person, display their associated movies and TV series.

Where metadata supports it, allow the user to narrow the results by role:
- Acting.
- Directing.
- Writing.
- Producing.
- All credited work.

Do not assume that every API provides complete credits or all roles equally well.

### 3.3 Studio Search

Allow users to search for production companies and studios, then discover movies and series associated with the selected company.

Examples include Marvel Studios, Warner Bros., Universal Pictures, and other production companies supported by the metadata source.

Requirements:
- Resolve the company name to a stable external company ID.
- Display relevant company information and an optional logo when available.
- Show associated films and series.
- Support result sorting and pagination.
- Avoid confusing distributors, broadcasters, networks, and production companies when the metadata distinguishes them.
- Preserve the distinction between a company involved in production and a service that distributes or streams the content.

### 3.4 Advanced Filters

Keep advanced criteria optional and compact.

Potential filters include:
- Person and credited role.
- Studio or production company.
- Movie or TV series.
- Release year or date range.
- Original language.
- Genre.
- Region, where relevant metadata is available.

Do not expose every possible filter immediately. Prioritize the most useful options and progressively reveal additional controls when needed.

## 4. Public Metadata API Strategy

### 4.1 Primary Candidate: The Movie Database (TMDB)

Evaluate TMDB as the primary metadata provider because its documented API supports movie and TV discovery, person search, credits, production-company filters, and metadata lookup.

Relevant official documentation:

- [TMDB API reference and getting started](https://developer.themoviedb.org/reference/intro/getting-started)
- [TMDB search and query workflow](https://developer.themoviedb.org/docs/search-and-query-for-details)
- [TMDB movie discovery](https://developer.themoviedb.org/reference/discover-movie)
- [TMDB TV discovery](https://developer.themoviedb.org/reference/discover-tv)
- [TMDB combined person credits](https://developer.themoviedb.org/reference/person-combined-credits)

Recommended workflow:

1. Search for the person or company.
2. Let the user select the intended entity when multiple matches exist.
3. Retrieve associated credits or use discovery filters where appropriate.
4. Normalize the resulting movie and TV metadata into CS3's existing media model.
5. Display metadata results progressively.
6. Allow the user to open a title's details page.
7. Reuse the existing provider and source-discovery pipeline to find playable sources.

For people, use person IDs instead of repeatedly matching their names against title strings. The combined-credits endpoint can return a person's movie and TV credits.

For studio discovery, evaluate the company's search endpoint and the `with_companies` discovery filter. For person-based discovery, evaluate `with_people`, `with_cast`, and `with_crew`, together with person credits. Use credit-specific role information to distinguish acting, directing, writing, and producing accurately.

These endpoints and filters have documented support, but their precise coverage and behavior should be validated against representative queries before finalizing the implementation.

### 4.2 Secondary Candidate: IMDb

Evaluate IMDb as a potential supplemental source where its data provides meaningful coverage beyond the primary provider.

Official resources:

- [IMDb developer documentation](https://data.imdb.com/documentation/api-documentation/)
- [IMDb non-commercial datasets](https://www.imdb.com/interfaces/)

IMDb offers non-commercial downloadable datasets containing title, person, crew, and principal-credit information. It also documents a separate API offering real-time entertainment data through AWS Data Exchange.

Important considerations:
- The real-time API is a separate commercial data product and should not be assumed to be free.
- Downloadable datasets require local storage, indexing, updates, and additional maintenance.
- IMDb's dataset licensing and API access terms must be reviewed before adoption.
- Do not scrape undocumented IMDb endpoints or depend on unofficial APIs for a core feature.

Treat IMDb as a later enhancement unless a measured metadata-coverage gap justifies its additional cost and complexity.

### 4.3 Additional Sources

Consider other public metadata sources only when they fill a demonstrated gap.

Potential candidates include:
- Wikidata Query Service for structured knowledge and supplementary person or production relationships.
- Other reputable film and television metadata APIs with documented terms and stable identifiers.

Wikidata exposes a public SPARQL query service, but query performance, completeness, availability, and rate limits need to be considered. It should not be used as the default synchronous search backend without suitable testing and caching.

Official documentation: [Wikidata SPARQL query service](https://www.wikidata.org/wiki/Wikidata:SPARQL_query_service/en).

Avoid integrating multiple metadata providers simultaneously without a clear reason. Start with one primary source, establish measurable coverage, and add secondary sources only where they improve real user outcomes.

## 5. API Access, Licensing, and Security

Before implementation, verify the licensing and operational requirements for the selected metadata provider.

For TMDB:
- Register and configure the required API credentials.
- Review the current usage terms, attribution requirements, and rate limits.
- The documented free API access is for non-commercial use subject to attribution. Commercial applications require the appropriate commercial licensing arrangement.
- Include the required attribution notice and branding in the appropriate application credits or About section.
- Do not assume that an API being publicly documented means unrestricted commercial use.

Official references:
- [TMDB FAQ and attribution requirements](https://developer.themoviedb.org/docs/faq)
- [TMDB authentication](https://developer.themoviedb.org/docs/authentication-application)

Implementation requirements:
- Reuse the existing TMDB configuration path where suitable.
- Validate API-key storage, exposure, and transport against the Electron main-process architecture.
- Do not introduce a new bundled secret or expose private credentials through renderer state or logs.
- If users supply their own keys, clearly communicate that configuration and provide a validation mechanism.
- Handle missing credentials gracefully without breaking title search.
- Review the appropriate licensing model before enabling a shared application-level API credential for a distributed desktop application.

## 6. Search Pipeline and Result Handling

### 6.1 Separate Metadata Discovery from Provider Search

Metadata search must not fan out a person's name directly to hundreds of streaming providers and assume that the results represent the person's filmography.

Instead, implement the following logical flow:

**Person or studio query → metadata entity resolution → filmography or company titles → normalized media results → optional provider availability lookup → details and playback**

This provides more accurate results and avoids wasting provider requests on queries such as actor names, company names, or ambiguous people.

### 6.2 Preserve Existing Title Search

The existing title search must remain unchanged unless a specific shared improvement is required.

Requirements:
- Do not force users to use metadata search.
- Do not alter source-selection profiles or provider preferences.
- Do not trigger a full provider search for every metadata query.
- Do not duplicate existing provider orchestration.
- Ensure metadata-search failures do not prevent normal title search.

### 6.3 Source Availability

Metadata results are not proof that a title can be played.

Provide a clear distinction between:
- Metadata found.
- Source lookup pending.
- Sources available.
- No sources found.
- Source lookup failed or was unavailable.

Where practical, check provider availability lazily or in bounded batches instead of querying every provider for every filmography entry.

Requirements:
- Reuse existing source prefetching and source-discovery mechanisms.
- Do not block the filmography from rendering while availability checks run.
- Allow the user to open the title details page and use the existing source-refresh actions.
- Do not label a title unavailable merely because one provider failed.
- Avoid automatically starting playback or downloads from metadata-search results.

### 6.4 Matching and Deduplication

Normalize metadata results using stable identifiers and carefully designed matching rules.

Requirements:
- Use metadata provider IDs to identify entities and titles where possible.
- Preserve external IDs, title type, original title, release year, and source metadata.
- Avoid treating titles with the same name as the same work without sufficient evidence.
- Handle alternate titles, localized names, remakes, films released in different years, and TV adaptations.
- Merge duplicate metadata records only when identity is sufficiently established.
- Preserve multiple provider sources for the same media title.

## 7. Performance, Caching, and Reliability

The feature must remain responsive even when a person has hundreds of credits.

Requirements:
- Use debounced requests for live person and studio suggestions.
- Do not fetch full filmographies on every keystroke.
- Cache metadata responses using the existing metadata caching infrastructure where appropriate.
- Apply request timeouts, cancellation, and stale-response protection.
- Prevent old requests from overwriting the results of a newer query.
- Use bounded concurrency for metadata and availability requests.
- Support pagination or incremental loading for large filmographies.
- Batch or coalesce state updates to avoid excessive renderer work.
- Preserve useful cached results when the network is temporarily unavailable, subject to cache freshness rules.
- Distinguish empty results from API failures, rate limiting, and missing configuration.

Metadata search must not create a second unbounded search pipeline.

## 8. Privacy and NSFW Policy

All metadata search must respect the application's existing adult-content visibility and access rules.

Requirements:
- Do not expose NSFW titles, artwork, or identifying metadata when NSFW content is disabled.
- Apply the visibility policy to people filmographies, studio results, cached metadata, suggestions, and source-availability results.
- Ensure API responses cannot bypass the application's shared NSFW visibility rules.
- Do not interpret missing adult-content metadata as proof that a title is safe.
- Avoid logging raw search queries or sensitive viewing activity unnecessarily.

## 9. Acceptance Criteria

1. Existing title search remains the default and continues to work as before.
2. Users can opt into people-based and studio-based search through a subtle, discoverable control.
3. Person searches can resolve ambiguous names and retrieve associated movie and TV credits.
4. Users can filter supported person results by credited role.
5. Studio searches can retrieve associated movies and series through stable company identifiers.
6. Metadata results are normalized and displayed using the existing media presentation patterns.
7. Metadata discovery is separate from provider source resolution.
8. The existing details and playback flow remains the source of truth for finding and playing content.
9. Metadata results load progressively and support cancellation, pagination, and large result sets.
10. API errors and missing credentials do not break existing title search.
11. Caching, rate-limit handling, and stale-response protection are tested.
12. Duplicate titles, remakes, alternate titles, and ambiguous people are handled without silently merging distinct entities.
13. NSFW visibility rules apply to every metadata-search surface.
14. Licensing, attribution, API-key handling, and any commercial-use requirements are documented and verified.
15. Automated tests cover API adapters, entity resolution, role filtering, deduplication, cancellation, caching, and source-availability integration.

## 10. Implementation Plan

### Phase 1: Source Audit and API Validation
- Inspect `MetadataEnrichmentService`, `TitleEnricher`, source adapters, metadata IPC handlers, and TMDB configuration.
- Determine which person, credit, and company capabilities already exist.
- Validate representative searches against the chosen API.
- Confirm API terms, credentials, and attribution requirements.

### Phase 2: Metadata Search Foundation
- Add a dedicated metadata-search service or extend the existing metadata layer.
- Define typed interfaces for people, companies, credits, and normalized media results.
- Add entity resolution, caching, cancellation, and error handling.
- Expose only the necessary operations through the existing Electron IPC architecture.

### Phase 3: Minimal Search UI
- Add the optional search-mode control.
- Implement people and studio search.
- Add an ambiguity-resolution step when necessary.
- Display filmography and production-company results using existing cards and navigation.

### Phase 4: Provider Availability Integration
- Reuse the existing source-discovery pipeline.
- Add bounded availability checks where useful.
- Clearly distinguish metadata discovery from playable-source availability.
- Preserve existing details, source selection, and playback behavior.

### Phase 5: Validation and Optimization
- Test broad filmographies, ambiguous names, and partial metadata.
- Test cancellation, caching, network failures, and rate limits.
- Validate performance with large result sets.
- Verify NSFW filtering, licensing compliance, and regression behavior.

## 11. Definition of Done

CS3 users can optionally search by actor, director, writer, producer, or studio and discover relevant movies and TV series without knowing their titles. The feature uses reliable public metadata APIs, resolves entities correctly, handles large result sets efficiently, and integrates with the existing provider and playback architecture.

The default search experience remains simple, existing functionality is preserved, and metadata discovery never implies that a title has playable sources until CS3's own source-discovery pipeline establishes availability.