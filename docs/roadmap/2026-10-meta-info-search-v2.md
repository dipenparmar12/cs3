# PRD: Unified Metadata Search, Advanced Search Filters, and Intelligent Autocomplete

## 1. Objective

Rebuild and significantly improve CS3's metadata-based search experience so users can discover movies and TV shows through titles, actors, directors, writers, producers, composers, studios, production companies, and other people or organizations involved in creating content.

The current implementation is a useful starting point, but it is not yet reliable or intuitive enough. People-based suggestions sometimes appear and sometimes do not, and the suggestion panel can flicker while results update.

We should go beyond the search capabilities available in CloudStream 3 Android while retaining its existing functionality and compatibility.

**CS3 should own and control its extended metadata discovery experience.** It should use publicly available APIs, open datasets, and reliable metadata relationships to provide a more complete search experience without depending exclusively on CloudStream's existing search implementation.

The experience should remain simple: users enter a name, optionally select a category, and discover the relevant content.

## 2. Current Implementation and Problems

Based on the existing project architecture:

- `searchSuggestions.ts` currently merges title suggestions from Cinemeta, TVmaze, and AniList.
- Suggestions use instant cache results and progressive updates.
- The renderer debounces requests, and obsolete suggestion requests can be cancelled.
- `SearchSession` handles full search requests, provider execution, catalogues, result merging, and cancellation.
- `metadata/enrichmentService.ts` supplies extended metadata such as cast and crew.
- Existing search results are merged and deduplicated through `searchMerge.ts`.

These are valuable foundations, but title autocomplete and metadata enrichment are separate capabilities. The application does not yet provide a consistently reliable, unified people-and-organization discovery workflow.

### Problems to resolve

1. People suggestions are inconsistent. Searching for John Cena or Christopher Nolan does not always produce the expected person result.
2. The suggestion panel flickers as different metadata sources respond.
3. Search categories are not sufficiently integrated into the search input.
4. Users cannot easily restrict suggestions and results to a specific role, such as Director or Producer.
5. Searching a person's name can return unrelated title matches.
6. Writer, producer, director, composer, and studio relationships are not consistently discoverable.
7. The current experience does not provide a sufficiently clear distinction between searching for a person and searching for a movie.
8. The implementation needs stronger metadata normalization, identity resolution, caching, and result ranking.

The solution must address the underlying search architecture as well as the visible UI.

## 3. Search Input and Category Chips

### 3.1 Unified search input

Keep one primary search input for all supported search categories.

When the user focuses the input, display a compact row of available category chips within or immediately adjacent to the search input.

Suggested categories:

- All
- Title
- Cast
- Director
- Writer
- Producer
- Composer
- Studio

Additional categories can be introduced when the metadata coverage supports them, such as cinematographer, editor, creator, or production company.

Do not display unsupported categories merely to make the interface appear more comprehensive.

### 3.2 Visual behavior

The chips must remain visually quiet.

- They should not compete with the search text or suggestions.
- They should use compact spacing and familiar selection styling.
- They should not introduce a large toolbar or another prominent panel.
- The search input must remain the primary focus.
- Keep the chips visible while the input is focused so users can discover the available filters.
- Hide or collapse them appropriately when the search interaction ends, following the existing search layout.

The user should understand their purpose without needing a tutorial.

### 3.3 Selection behavior

Support selecting one or multiple categories.

**All** is the default unrestricted mode.

When the user selects a specific category, the search should be restricted to that category or the selected categories.

Examples:

| Selected category | Search behavior |
|---|---|
| All | Search all supported entity types |
| Title | Search movies and TV titles |
| Cast | Search actors and cast members |
| Director | Search directors |
| Writer | Search writers and screenwriters |
| Producer | Search producers |
| Composer | Search music composers |
| Studio | Search studios and production companies |
| Director + Writer | Search people matching either selected role |

Selecting a specific category should remove the unrestricted All selection. Selecting All should clear the individual category selections.

When multiple categories are selected, use OR behavior between categories unless the user explicitly selects an advanced combination that requires different semantics.

Do not confuse these category filters with the existing provider source-scope selection. They control what kind of metadata entity is being searched, not which scraper providers are allowed to respond.

### 3.4 Category-aware search examples

**Example 1:**

User types `Christopher` with Director selected.

Expected suggestions:

- Christopher Nolan
- Other matching directors, ranked by relevance

Do not return unrelated movies containing Christopher in their title.

**Example 2:**

User types `John Cena` with Cast selected.

Expected suggestions:

- John Cena
- Relevant matching cast/person records

After selecting John Cena, show movies and TV shows in which he has a verified cast credit.

**Example 3:**

User types `Yash Raj` with Studio selected.

Expected suggestions:

- Matching production companies or studios
- Relevant identifying information

After selection, show associated productions supported by the metadata.

**Example 4:**

User selects Director and Writer together, then types `Christopher Nolan`.

Search for people who match either selected role. Do not mix in ordinary title matches.

## 4. Intelligent Autocomplete

### 4.1 Suggestion categories

Autocomplete should support distinct entity types:

- Movies.
- TV shows and series.
- People.
- Production companies and studios, where supported.

Each suggestion should clearly identify its category.

### 4.2 Suggestion presentation

Keep suggestions compact and recognizable.

| Entity | Display information |
|---|---|
| Movie | Poster, title, year |
| TV show | Poster, title, first-air year |
| Person | Profile image, name, primary role |
| Studio/company | Logo or suitable image, company name |

Avoid long biographies, descriptions, and multiple lines of unnecessary metadata.

### 4.3 Progressive loading without flickering

The current flickering behavior must be investigated and corrected.

Do not rebuild the entire suggestion list whenever another metadata source responds.

Requirements:

- Preserve already displayed suggestions while new results arrive.
- Merge incoming results into the current suggestion state.
- Deduplicate by stable entity identity, not display name alone.
- Update existing entries when more reliable metadata arrives.
- Avoid changing the order unnecessarily between updates.
- Keep the selected suggestion and keyboard highlight stable.
- Do not clear the panel between provider responses.
- Ignore results from obsolete queries.
- Cancel unnecessary requests when the query or selected categories change.
- Use a small loading indicator rather than repeatedly replacing the suggestion panel.

A suggestion should not disappear and reappear simply because another metadata source has returned.

### 4.4 Keyboard and interaction

Support:

- Arrow Up and Arrow Down to navigate suggestions.
- Enter to select the highlighted suggestion or submit the search.
- Escape to dismiss the suggestion panel.
- Mouse selection.
- Existing search shortcuts and focus behavior.

Category selection must not unexpectedly steal focus from the input.

## 5. Metadata Search and Discovery Engine

Build a shared metadata search layer that is independent of the CloudStream Android provider-search limitations.

It should reuse the existing CS3 metadata and search architecture wherever possible.

### 5.1 Supported metadata entities

Create a normalized representation for:

- Work: movie or TV show.
- Person: actor, director, writer, producer, composer, and other crew.
- Organization: studio, production company, network, or other supported organization.

Every entity should retain its metadata source and stable external identifier.

### 5.2 Person relationships

A person record must preserve the relationship between the person and each associated work.

Examples:

- Actor → Cast credit → Movie.
- Director → Director credit → Movie.
- Writer → Writing credit → TV show.
- Composer → Music credit → Movie.
- Producer → Production credit → Series.

Do not infer a person's role merely from a text match or a person's general profession. Use actual credits whenever available.

### 5.3 Organization relationships

Support relationships such as:

- Production company → Movie.
- Production company → TV show.
- Studio → Production.
- Network → TV show.

Keep organization relationships distinct from person credits.

### 5.4 Search result identity

Use stable identifiers to distinguish people and organizations with similar names.

For example, two people may share the same name but have different profile images, professions, external IDs, and credited works.

Do not merge them merely because their names match.

## 6. Public APIs and Open Metadata Sources

Research and evaluate publicly available metadata sources. Prefer official APIs and structured datasets over scraping HTML pages.

### 6.1 TMDB

<badge color="success">Primary candidate</badge>

<Entity value="The Movie Database (TMDB)" category="software" disambig="Movie and television metadata API"/> provides several relevant capabilities:

- Search for movies, TV shows, and people.
- Retrieve person details.
- Retrieve combined movie and TV credits for a person.
- Retrieve cast and crew credits for titles.
- Search production companies.
- Discover movies using cast, crew, people, and production-company identifiers.

Relevant documentation:

- [Finding Data](https://developer.themoviedb.org/docs/finding-data)
- [Search and Query for Details](https://developer.themoviedb.org/docs/search-and-query-for-details)
- [Person Combined Credits](https://developer.themoviedb.org/reference/person-combined-credits)
- [Discover Movies](https://developer.themoviedb.org/reference/discover-movie)

Use stable TMDB IDs to connect person and company searches to their related productions.

### 6.2 TVmaze

<Entity value="TVmaze" category="software" disambig="Television metadata API"/> provides:

- People search.
- Person details.
- Cast credits.
- Crew credits.
- Show cast and crew.
- Episode-level guest credits.

Official documentation:

[TVmaze API](https://www.tvmaze.com/api)

Use it as an additional source for television-related discovery and metadata coverage. Normalize its records against existing CS3 metadata identifiers wherever possible.

### 6.3 IMDb datasets

<Entity value="IMDb" category="software" disambig="Film and television database"/> provides downloadable datasets containing:

- Person identities.
- Title identities.
- Principal cast and crew relationships.
- Known-for titles.
- Professional categories.
- Alternative titles.

Official resources:

- [IMDb Non-Commercial Datasets](https://developer.imdb.com/non-commercial-datasets/)
- [IMDb Data Usage Conditions](https://help.imdb.com/article/imdb/general-information/can-i-use-imdb-data-in-my-software/G5JTRESSHJBBHTGX)

Important: IMDb's published datasets are subject to specific non-commercial use and redistribution restrictions. Do not assume they can be incorporated into a commercial or publicly distributed CS3 database without reviewing the applicable terms and obtaining appropriate permission.

### 6.4 Wikidata

<Entity value="Wikidata" category="software" disambig="Open structured knowledge graph"/> can provide additional structured relationships for people, organizations, and creative works.

It may help with:

- Alternate names.
- Person identity resolution.
- Organization relationships.
- External identifiers.
- Additional creator and production relationships.

Official resources:

- [Wikidata Query Service](https://query.wikidata.org/)
- [Wikidata SPARQL User Manual](https://www.mediawiki.org/wiki/Wikidata_Query_Service/User_Manual/en)

Do not make live Wikidata SPARQL requests for every search keystroke. Its public service has query execution and concurrency limits. Use bounded requests, caching, or an optional indexed dataset if this source is adopted.

### 6.5 Source selection strategy

Do not integrate every source simultaneously.

Evaluate each source for:

- Data completeness.
- Person and company coverage.
- Search quality.
- Role accuracy.
- API availability and authentication requirements.
- Rate limits.
- Licensing and attribution.
- Response latency.
- Long-term maintenance requirements.

Choose a primary metadata source and complementary sources based on measured coverage.

Keep each metadata integration behind a common adapter so sources can be added or replaced without changing the search UI.

## 7. Unified Search Architecture

Implement a dedicated metadata discovery layer that can work independently of scraper-provider search.

Suggested conceptual flow:

`Search Input → Category Selection → Metadata Search Coordinator → Metadata Adapters → Entity Normalization → Deduplication → Ranking → Suggestions`

When the user submits a full search:

`Search Query + Selected Categories → Search Session → Metadata Discovery + Existing Search Sources → Result Merge → Search Results`

Requirements:

- Reuse existing `searchSuggestions.ts` where appropriate.
- Extend the existing `SearchSession` and result-merging architecture rather than creating an unrelated search workflow.
- Keep metadata discovery separate from provider source discovery.
- Preserve existing provider search and source-scope behavior.
- Support cancellation and progressive results.
- Retain source provenance and external identifiers.
- Make metadata source failures independent so one unavailable API does not break the entire search.

The metadata discovery system must not depend on whether a CloudStream scraper provider supports searching by people or production companies.

## 8. Full Search Results

Autocomplete is only the entry point. Selecting a person or organization must lead to a meaningful discovery experience.

### 8.1 Person search

When a user selects a person, display their associated movies and TV shows.

Provide compact role filters such as:

- All credits.
- Acting.
- Directing.
- Writing.
- Producing.
- Music.

Only show filters supported by the person's available credits.

### 8.2 Company search

When a user selects a studio or production company, show its associated movies and TV shows.

Provide relevant sorting and filtering using existing CS3 result controls where possible.

### 8.3 Match explanations

Each result should communicate why it appeared.

Examples:

- `Cast: John Cena`
- `Directed by Christopher Nolan`
- `Written by Christopher Nolan`
- `Produced by Yash Raj Films`
- `Music by Hans Zimmer`

Keep these labels compact and avoid adding large descriptions to poster cards.

### 8.4 Navigation

Selecting a movie or TV show should open the existing CS3 detail screen.

Selecting a person or organization should open a dedicated discovery view or a reusable filtered search view.

Do not create duplicate movie or TV detail pages.

## 9. Search Semantics and Result Correctness

The selected categories must be enforced throughout autocomplete and submitted search.

Examples:

| Query | Selected categories | Expected behavior |
|---|---|---|
| Christopher Nolan | Director | Return matching directors and their relevant works |
| Christopher Nolan | Writer | Return matching writers and their relevant works |
| John Cena | Cast | Return matching cast members and their credits |
| Hans Zimmer | Composer | Return matching composers and their credits |
| Yash Raj Films | Studio | Return matching companies and associated productions |
| The Matrix | Title | Return movie and series title matches |
| Christopher Nolan | All | Return relevant person, title, and supported organization matches |

Important rules:

- A category filter must not silently fall back to title search.
- A failed person lookup must not be converted into an unrelated title result.
- If no matching entity exists in the selected category, show an honest empty result.
- All mode may combine entity types, but must distinguish them clearly.
- Preserve the user's category selection between autocomplete and submitted search.
- Do not allow provider-search results to override the user's metadata category restrictions.

## 10. Performance, Caching, and Reliability

### 10.1 Caching

Reuse existing caches where appropriate and introduce metadata-specific cache entries only where needed.

Cache:

- Person search results.
- Company search results.
- Person details and credits.
- Company details and productions.
- Normalized entity identities.
- Search suggestions.

Apply different expiry policies according to the stability of each data type.

### 10.2 Request management

- Debounce input.
- Deduplicate identical in-flight requests.
- Cancel obsolete requests.
- Limit concurrency per metadata source.
- Respect API rate limits.
- Use bounded retries.
- Avoid repeatedly fetching person credits during autocomplete.
- Retrieve detailed credits only after the user selects a person or submits a relevant search.

### 10.3 Reliability and fallback

If one metadata source fails:

- Preserve results already received from other sources.
- Do not clear the suggestion panel.
- Do not show duplicate or stale entries.
- Continue with supported sources.
- Display a concise error only when the failure materially affects the result.

Normal title search and existing provider search must remain functional when all optional people or company metadata services are unavailable.

## 11. User Experience Requirements

The final interface should be minimal, predictable, and self-explanatory.

- One search input.
- Quiet category chips.
- Stable autocomplete suggestions.
- Clear distinction between people, organizations, movies, and TV shows.
- Compact profile images and relevant labels.
- No unnecessary paragraphs or large descriptions.
- No flickering or full-list replacement during progressive updates.
- No unexpected focus changes.
- No unnecessary loading screens.
- No forced selection of a category before ordinary title search.
- No additional navigation just to activate common search filters.

The advanced metadata functionality should be available without making the normal title-search experience more complicated.

## 12. Implementation Phases

### Phase 0: Existing Code Audit and Failure Analysis

- Trace current autocomplete and metadata search behavior.
- Reproduce the John Cena and Christopher Nolan suggestion failures.
- Identify the cause of panel flickering.
- Inspect current metadata enrichment and available cast/crew data.
- Verify existing TMDB, TVmaze, Cinemeta, and AniList integrations.
- Confirm API availability, licensing, and missing relationship types.
- Establish search latency and suggestion-quality baselines.

**Deliverable:** A code-grounded implementation plan with reproduced issues and verified metadata capabilities.

### Phase 1: Stabilize Existing Autocomplete

- Fix suggestion state replacement and flickering.
- Improve entity identity and deduplication.
- Preserve suggestions during progressive updates.
- Fix request cancellation and stale-response handling.
- Add regression tests for partial and complete person names.

**Deliverable:** Stable existing title and people suggestions before introducing additional UI complexity.

### Phase 2: Category Chips and Search Filtering

- Add quiet, compact category chips.
- Implement All and multi-category selection.
- Connect selected categories to autocomplete requests.
- Preserve category selection through full search.
- Ensure category filters exclude unrelated entity types.

**Deliverable:** Predictable category-aware search.

### Phase 3: Unified Metadata Search

- Implement or extend the metadata search coordinator.
- Add normalized person and company entities.
- Integrate the verified primary metadata API.
- Add person and organization identity resolution.
- Implement stable result merging and ranking.

**Deliverable:** Unified metadata discovery independent of scraper-provider search capabilities.

### Phase 4: Person and Company Discovery

- Add person-focused discovery.
- Retrieve and display combined movie and TV credits.
- Add role-based filtering.
- Add company-focused production discovery.
- Connect title results to existing detail pages.

**Deliverable:** Complete discovery workflows for supported people and organizations.

### Phase 5: Performance and UX Refinement

- Improve caching and request scheduling.
- Validate behavior under slow and failing metadata services.
- Remove unnecessary loading transitions.
- Refine visual hierarchy and keyboard interactions.
- Test large result sets and repeated queries.

**Deliverable:** A polished search experience suitable for everyday use.

### Phase 6: Regression and Release Validation

Test all existing title search, catalogue, provider search, filters, metadata enrichment, navigation, and search history behavior.

**Deliverable:** A reliable unified search system with no regressions in existing CS3 functionality.

## 13. Testing Requirements

### Autocomplete

- Search John Cena.
- Search Christopher Nolan.
- Search partial names such as Christopher and John.
- Search people with identical names.
- Search people with alternate or translated names.
- Change categories while suggestions are loading.
- Type rapidly and verify stale requests cannot replace newer results.
- Verify keyboard navigation and selection.

### Category filters

- All mode.
- Title-only mode.
- Cast-only mode.
- Director-only mode.
- Writer-only mode.
- Producer-only mode.
- Composer-only mode.
- Studio-only mode.
- Multiple selected categories.
- Empty result for an unsupported or unmatched category.
- Switching from a specific category back to All.

### Metadata relationships

- Person with acting credits.
- Person with directing credits.
- Person with writing credits.
- Person with production credits.
- Person with music credits.
- Company with associated productions.
- Duplicate identities from different metadata sources.
- Conflicting or incomplete credits.

### Reliability

- One metadata service is unavailable.
- Multiple services respond at different speeds.
- Cached suggestions are available immediately.
- A slow response arrives after the user changes the query.
- Rate limits and temporary failures occur.
- Existing title search continues when metadata discovery fails.

## 14. Acceptance Criteria

The implementation is complete when:

1. John Cena and Christopher Nolan searches consistently produce relevant person suggestions when supported by the connected metadata sources.
2. Autocomplete no longer flickers or repeatedly replaces its existing results.
3. Users can see and select quiet category chips directly from the search interaction.
4. Selecting Director, Writer, Cast, Producer, Composer, or Studio restricts suggestions and full search to the intended entity categories.
5. Selecting multiple categories returns matches from those categories without unrelated title results.
6. All restores unrestricted discovery.
7. Person and organization searches work independently of CloudStream scraper-provider search capabilities.
8. Person results lead to verified movie and TV credits.
9. Company results lead to productions supported by actual metadata relationships.
10. Search results identify why a title matched a person or organization.
11. Existing title search, provider search, source-scope selection, and navigation continue to work.
12. Search requests are cancellable, deduplicated, cached, and rate-limited appropriately.
13. Metadata-source failures do not break normal CS3 search.
14. The experience remains visually minimal and requires no learning before use.

## 15. Expected Outcome

CS3 should have its own powerful metadata discovery system that extends beyond CloudStream 3 Android's existing search capabilities.

Users should be able to search by the content itself or by the people and organizations behind it. They should be able to select Director, Cast, Writer, Producer, Composer, or Studio directly from the search input and receive results relevant to that selection.

The implementation must be reliable behind the scenes and simple in front of the user.

**Build a more capable search engine without building a more complicated search experience.**