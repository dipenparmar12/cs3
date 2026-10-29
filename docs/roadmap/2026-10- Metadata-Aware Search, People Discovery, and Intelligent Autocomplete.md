# PRD: Metadata-Aware Search, People Discovery, and Intelligent Autocomplete

> **Status (2026-10-29): Partial.** Phases 0–3 built; criterion 7 only inside the person view. See "Built" below.
>
> **Phase 0 findings.** Title autocomplete (`electron/searchSuggestions.ts`: Cinemeta, TVmaze, AniList, push-shaped, cached, aborted per keystroke) and person/studio discovery (`metadata/filmography.ts` + `FilmographyDialog`, opened from a detail page's cast and studios) already existed; nothing connected them. TMDB needs a key, against the app's keyless rule, so people come from **Wikidata**: `wbsearchentities` (name, description) then one SPARQL check that each hit is a human credited (cast, voice, director, writer, producer, composer, cinematographer, editor, creator) on a work with an IMDb id, or a non-human that produced one. Measured live: "John Cena" 745 ms search + 809 ms check, offers only Q44437 (not Cenatiempo); "Christopher Nolan" only Q25191; "Yash Raj Films" the studio; "Inception" nobody; a bare "Nolan" check 2.4 s.
>
> **Built.** A fourth suggestion source (`metadata/entitySearch.ts`, ≥ 3 characters, at most 3 people or companies, an exact name pushes out near names of its kind) travels on `api:suggest` / `search:suggestUpdate` as `entities`, narrowed from cache like titles. The dropdown draws **People and companies** (round photo, Person/Company, one-line description); they lead only when the query *is* the name and no title is called that (`src/utils/suggestionLayout.ts`), so "Inception" keeps the film first. Arrow keys and the drawn order come from one function. Picking one opens the existing filmography (role and type filters; each card names the role or character). Enter without a highlight is the ordinary search. A failed or slow lookup holds back no title row.
>
> **Checked** in the built app on the scratch profile: the four queries above; Arrow Down + Enter on John Cena opened 46 titles (Acting 38, Voice 8) in 2 s; clicking Yash Raj Films opened 66 titles; plain Enter ran the normal search (146 titles, 9 sources). Tests: `entitySearch.test.mts` (8), `suggestionLayout.test.mts` (4), each rule mutation-checked; `bun run test --fast` 200 suites pass.
>
> **Not built.** Match reasons on the main results grid ("Cast: John Cena" on a title found by pressing Enter); people in the Search screen itself; TVmaze or AniList people in autocomplete (Wikidata only). Not checked: screen reader, a Wikidata outage in the app (the source's failure path is the existing `.catch`).

## 1. Objective

Enhance CS3 search so users can discover movies and TV shows through titles, actors, directors, writers, producers, production companies, and other available metadata relationships.

Currently, users may search for a movie or series by its title. The improved search should also understand the people and organizations connected to that content.

Examples:

- Searching **John Cena** should offer the person and help users discover movies and TV shows featuring him.
- Searching **Christopher Nolan** should surface relevant movies and shows associated with him as a director, writer, or producer.
- Searching **Yash Raj Films** should help users discover productions associated with that company when reliable company metadata is available.
- Searching a movie title should continue to return the correct title results without being overwhelmed by unrelated people or metadata matches.

The goal is to make CS3 search more powerful without making it more complicated.

## 2. Core UX Principles

- **One familiar search bar:** Users should not need to learn separate search modes for titles, people, or companies.
- **Useful autocomplete:** Suggestions should help users recognize the intended person, title, or organization while typing.
- **Minimal visual noise:** Show concise labels, names, and relevant images rather than lengthy descriptions.
- **Direct discovery:** Users should be able to select a person or company and explore its related content.
- **Relevant results:** Prioritize strong metadata relationships instead of returning loosely related titles.
- **Fast response:** Suggestions must not make typing, scrolling, or normal search feel slower.
- **Preserve existing behavior:** Title search, provider search, catalogues, filters, and existing navigation must continue to work.

## 3. Unified Search Experience

### 3.1 Search input

Extend the existing search system rather than introducing a second search bar or a separate discovery screen.

As users type, use the query to identify relevant candidates from supported categories:

- Movies.
- TV shows and series.
- People, including actors and crew.
- Production companies and other organizations, where supported.

Do not show every category indiscriminately for every query. Rank suggestions according to relevance, query intent, and available metadata.

### 3.2 Autocomplete suggestions

Use a compact suggestion panel similar to the familiar autocomplete experience in modern search products.

Each suggestion should display only the information necessary to recognize it:

- **Movie or TV show:** Poster or thumbnail, title, and release year when available.
- **Person:** Profile image, name, and primary known role or department when available.
- **Company:** Logo or other suitable image, name, and organization type when available.

Use small category labels or icons to distinguish a person from a movie, series, or company.

The user should be able to navigate suggestions using the keyboard, select one with a click, or continue typing without interruption.

### 3.3 Keep autocomplete unobtrusive

- Debounce requests while the user types.
- Do not trigger requests for every keystroke.
- Cancel or ignore obsolete requests when the query changes.
- Avoid opening an oversized panel that covers the application.
- Keep the current query and keyboard focus intact.
- Show a small loading state only when necessary.
- Display concise empty or error states without large explanatory paragraphs.
- Respect the application's existing keyboard shortcuts and search behavior.

Autocomplete is an aid, not a requirement. Users must still be able to type a complete query and press Enter to perform a normal search.

## 4. People-Based Content Discovery

### 4.1 Person suggestions

When the user enters a person's name, show matching people separately from title matches when the available evidence supports that classification.

For example, searching `John Cena` might offer:

- John Cena — Person
- Movies featuring John Cena
- TV appearances featuring John Cena, where available

Selecting the person should open a person-focused discovery view or an equivalent filtered search experience consistent with the existing application.

### 4.2 Person discovery results

Display relevant movies and TV shows associated with the selected person.

Use available metadata to distinguish roles such as:

- Actor or cast member.
- Director.
- Writer or screenwriter.
- Producer.
- Other credited crew roles supported by the metadata source.

Where practical, let users filter the results by role. Avoid forcing them to choose a role before seeing useful results.

The initial results should be ranked by relevance, role match, and available metadata. Provide a clear way to browse the complete supported filmography.

### 4.3 Explain why a title matched

When a title is found through a person relationship rather than its title, provide a compact match reason.

Examples:

- `Cast: John Cena`
- `Directed by Christopher Nolan`
- `Written by Christopher Nolan`
- `Produced by Yash Raj Films`

Keep this information visually secondary to the title itself. Use existing information icons or contextual popovers for longer explanations when needed.

This helps users understand why a result appeared without cluttering every result card.

## 5. Company and Organization Discovery

Support production-company and organization searches where the existing metadata providers expose reliable identifiers and relationships.

When a user selects a company, display the associated movies and TV shows that can be verified from the available metadata.

Requirements:

- Distinguish organizations from people and titles.
- Preserve company identity using stable metadata IDs when available.
- Use production-company relationships rather than relying only on text appearing in a title or description.
- Avoid claiming that a company produced a title when the relationship is not supported by metadata.
- Handle similarly named organizations carefully.
- Provide a sensible fallback to ordinary title search if company metadata is unavailable.

Do not assume that searching a company name will automatically reveal every associated production. The result depends on the completeness and coverage of the underlying metadata source.

## 6. Metadata and Search Architecture

### 6.1 Audit the existing implementation first

Inspect the current search pipeline, including:

- Search input and autocomplete components.
- Search orchestration and result normalization.
- Existing metadata services and provider integrations.
- Cinemeta, AniList, TMDB, or other services already used by CS3.
- Title enrichment and alternate-title handling.
- Search caching, cancellation, and concurrency controls.
- Existing result grouping and relevance ranking.
- Navigation from search results to details pages.

Identify which required capabilities already exist and which need to be added.

Do not introduce a new metadata provider or duplicate service when an existing integration can supply the required data.

### 6.2 Metadata capabilities to investigate

TMDB provides search capabilities for movies, TV shows, and people, along with person-credit endpoints for discovering a person's movie and television work. Its documentation also describes combining related details into a single response using `append_to_response`. These capabilities can reduce unnecessary network requests when used appropriately.

References:

- [TMDB: Finding Data](https://developer.themoviedb.org/docs/finding-data)
- [TMDB: Search and Query for Details](https://developer.themoviedb.org/docs/search-and-query-for-details)
- [TMDB: Person Combined Credits](https://developer.themoviedb.org/reference/person-combined-credits)
- [TMDB: Append to Response](https://developer.themoviedb.org/docs/append-to-response)

Before implementation, verify which endpoints and data are already integrated into CS3, which require new work, and which API terms or attribution requirements apply.

### 6.3 Normalize results

Use a consistent internal search-result representation for the supported categories.

Conceptually, a result should contain:

- Entity type: movie, TV show, person, or company.
- Stable entity identifier and metadata source.
- Display name or title.
- Relevant image, when available.
- Release year or other concise identifying information.
- Relevant person role or company relationship, where applicable.
- Match reason and confidence.
- Navigation target.

Reuse existing result models where practical. Introduce new fields only where required.

Avoid treating a person's name as a movie title or mixing people and media records without a clear type distinction.

## 7. Relevance and Ranking

A unified search must not reduce the quality of existing title search.

Use relevance signals appropriate to each entity type:

- Exact and partial name matches.
- Original and alternate titles.
- Person-name matches.
- Company-name matches.
- Metadata relationships.
- Release year and media type.
- Existing provider and metadata ranking signals.

Prefer an exact title match when the query clearly identifies a title. Prefer a person result when the query clearly identifies a person. When intent is ambiguous, show a small, balanced set of useful suggestions rather than making an unjustified assumption.

For person-based results, prioritize titles with verified relationships to the selected person. Do not treat general popularity as proof of relevance.

Deduplicate the same movie or series when it appears through multiple metadata paths, while preserving useful match reasons.

## 8. Performance, Caching, and Failure Handling

- Reuse existing metadata caches.
- Cache autocomplete results with an appropriate expiry.
- Avoid fetching full filmographies for every keystroke.
- Load person or company details only when needed.
- Use bounded concurrency and cancellation.
- Ignore responses belonging to obsolete queries.
- Handle metadata-service rate limits and temporary failures gracefully.
- Allow normal title search to work when a people or company lookup fails.
- Avoid blocking search while nonessential metadata enrichment is running.

Autocomplete should feel immediate, and additional metadata should enhance the experience rather than delay the core search results.

## 9. Implementation Phases

### Phase 0: Code Audit and Metadata Verification

Map the existing search flow and confirm the actual capabilities of the current metadata integrations.

**Deliverable:** A code-grounded plan identifying reusable components, missing capabilities, and required data relationships.

### Phase 1: Unified Search Suggestions

Extend the existing autocomplete to support relevant people and other supported entity types alongside movie and TV title suggestions.

**Deliverable:** A compact, keyboard-friendly suggestion panel that preserves existing title search.

### Phase 2: People-Based Discovery

Add person-focused navigation and retrieve related movie and TV credits using existing or verified metadata integrations.

**Deliverable:** Users can search for a person and discover relevant titles from their credited work.

### Phase 3: Company Discovery

Add company suggestions and associated-production discovery where the metadata coverage supports it.

**Deliverable:** Users can find productions through verified company relationships.

### Phase 4: Ranking, Caching, and UX Polish

Improve result ordering, deduplication, cancellation, loading states, and match-reason presentation.

**Deliverable:** A responsive and consistent search experience across entity types.

### Phase 5: Regression Testing

Verify title search, people search, company search, navigation, caching, performance, and failure handling.

**Deliverable:** Unified search with no regressions in existing functionality.

## 10. Acceptance Criteria

The feature is complete when:

1. Users can search for movies and TV shows by title as before.
2. Users can discover people through autocomplete.
3. Selecting a person reveals associated movies and TV shows supported by the metadata.
4. Relevant cast and crew roles are identified accurately when available.
5. Company-based discovery works when reliable company metadata is available.
6. Suggestions clearly distinguish people, companies, movies, and series.
7. Search results explain metadata-based matches concisely.
8. Existing title matches remain relevant and are not buried by unrelated entity suggestions.
9. Autocomplete supports keyboard navigation and does not interrupt typing.
10. Slow or unavailable metadata services do not block normal search.
11. Duplicate results, stale requests, and unnecessary API calls are handled appropriately.
12. Existing search, filters, provider search, and navigation continue to work.

## 11. Expected Outcome

CS3 search should become a discovery experience rather than a title-only lookup.

Users should be able to enter a name, recognize the relevant person or organization, and explore associated movies and TV shows without manually knowing every title. The interface should remain minimal and intuitive, while metadata relationships provide the additional discovery power behind the scenes.

**The implementation principle is simple: expand what users can find without increasing the effort required to find it.**