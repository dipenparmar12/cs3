# PRD: Franchise and Chronological Movie Navigation

## 1. Overview

We should research and implement a **Franchise / Movie Series navigation system** that automatically identifies movies belonging to the same movie franchise or collection and displays them in a meaningful chronological order on the movie details page.

The goal is to solve a common discovery problem where movies are part of a larger series but their titles do not contain explicit numbering.

For example, a user may search for:

```text
Harry Potter and the Chamber of Secrets
```

The application should recognize that it belongs to the Harry Potter franchise and provide navigation such as:

```text
Harry Potter and the Philosopher's Stone
        ↓
Harry Potter and the Chamber of Secrets
        ↓
Harry Potter and the Prisoner of Azkaban
        ↓
Harry Potter and the Goblet of Fire
        ↓
...
```

The user should be able to select any movie directly from this section.


### 1. The Problem & Use Case (Section 34)

Major film universes and franchises often do not follow sequential numbering in their titles. Instead, they use subtitles or different character titles:
* **Harry Potter:** *Philosopher's Stone (2001)* $\to$ *Chamber of Secrets (2002)* $\to$ *Prisoner of Azkaban (2004)* $\to$ *Goblet of Fire (2005)* $\to$ *Order of the Phoenix (2007)* $\to$ *Half-Blood Prince (2009)* $\to$ *Deathly Hallows: Part 1 (2010)* $\to$ *Deathly Hallows: Part 2 (2011)*.
* **The Dark Knight / Batman:** *Batman Begins (2005)* $\to$ *The Dark Knight (2008)* $\to$ *The Dark Knight Rises (2012)*.
* **X-Men:** *X-Men (2000)* $\to$ *X2 (2003)* $\to$ *The Last Stand (2006)* $\to$ *First Class (2011)* $\to$ *Days of Future Past (2014)* $\to$ *Apocalypse (2016)* $\to$ *Logan (2017)* $\to$ *Dark Phoenix (2019)*.
* **Spider-Man:** Raimi Trilogy ($1, 2, 3$) $\to$ Webb Amazing Spider-Man ($1, 2$) $\to$ MCU Trilogy (*Homecoming, Far From Home, No Way Home*).
* **Star Wars:** Chronological release order across the original trilogy, prequels, sequels, and anthology stories (*Rogue One, Solo*).
* **Marvel Cinematic Universe (MCU):** Character arcs (*Iron Man 1–3, Captain America, Thor, Guardians of the Galaxy*).

When viewing any installment (e.g. *Harry Potter and the Chamber of Secrets*), users currently only see generic genre recommendations in "More like this". They have no native way to browse prequels, sequels, or view the entire franchise in chronological order.

---

### 2. Public Keyless Metadata Sourcing Strategy (Section 35)

To uphold CS3's strict architectural principles (no user API keys, no proprietary tokens, no license violations):

1. **Wikidata SPARQL Knowledge Graph (100% Keyless, CC0):**
   * **`wdt:P179` (Part of the Series):** Connects the movie to its overarching franchise entity (e.g., *Harry Potter film series*, *Star Wars*, *X-Men*).
   * **`pq:P1545` (Series Ordinal):** Direct integer position within the series (`1`, `2`, `3`...).
   * **`wdt:P155` (Follows / Prequel):** Explicitly identifies the immediate predecessor film.
   * **`wdt:P156` (Followed By / Sequel):** Explicitly identifies the immediate successor film.
   * **`wdt:P577` (Publication Date):** Official release timestamp to guarantee strictly chronological release ordering.
   * **`wdt:P345` (IMDb ID):** Universally maps the items to Cinemeta and CS3's media resolution layer.
   * *Architecture Advantage:* CS3 already utilizes Wikidata via [`wikidata.ts`](/cs3/cs3_windows/electron/metadata/wikidata.ts), so franchise queries require zero new external infrastructure.

2. **Artwork & Item Resolution via Cinemeta:**
   * Resolved franchise IMDb IDs are cross-referenced with Cinemeta (`https://v3-cinemeta.strem.io/`) to obtain high-resolution posters, synopses, and release years.
   * Each item is addressed via `cs3meta://cinemeta/movie/{imdbId}`, allowing immediate one-click navigation and streaming.

3. **TMDB Collection Support (`belongs_to_collection`):**
   * For configurations with TMDB data, the `belongs_to_collection` identifier returns all `parts`, which are sorted by `release_date` ascending.

4. **Lexical Franchise Clustering Fallback:**
   * When remote knowledge graphs lack an explicit collection entry for an obscure franchise, a prefix clustering heuristic groups titles from installed providers and orders them by release year.

---

### 3. Detail View UI/UX Specification (Section 36)

```text
Harry Potter and the Chamber of Secrets
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Part of the Harry Potter Film Series (Part 2 of 8)

┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐
│   Part 1   │  │   Part 2   │  │   Part 3   │  │   Part 4   │
│  (Prequel) │  │  CURRENT   │  │  (Sequel)  │  │            │
│ Philosopher│  │  Chamber   │  │  Prisoner  │  │   Goblet   │
│   (2001)   │  │   (2002)   │  │   (2004)   │  │   (2005)   │
└────────────┘  └────────────┘  └────────────┘  └────────────┘
```

* **Visual Placement:** Positioned directly below media trailers/facts and above "More like this" recommendations.
* **Contextual Heading:** Clearly displays the franchise name and position (e.g. *"Part of the Harry Potter Series (Part 2 of 8)"* or *"The Dark Knight Trilogy (Part 2 of 3)"*).
* **Card Presentation & Badges:**
  * **Currently Viewing:** Highlighted border with an active indicator badge (`● Current`).
  * **Prequels & Sequels:** Clearly tagged as predecessor/successor installments with their release years.
  * **Ordinal Numbering:** Displays `Part 1`, `Part 2`, `Part 3`...
* **One-Click Traversal:** Clicking any poster navigates directly to that movie's detail page via `onSelectMedia`.

---

### 4. File Reference Directory (Section 37)

The module responsibilities are mapped as follows:

| Component / Requirement | File Path | Line Range | Architectural Role |
|---|---|---|---|
| **Media Details Page View** | [`DetailView.tsx`](/cs3/cs3_windows/src/views/DetailView.tsx) | `L1930–L1960`, `L165–L175` | Renders the chronological franchise rail, cards, active movie badge, and installment navigation. |
| **Poster Card Component** | [`PosterCard.tsx`](/cs3/cs3_windows/src/components/PosterCard.tsx) | `L1–L120` | Renders individual movie poster cards with custom franchise badges and chronological labels. |
| **Extended Metadata Types** | [`metadata.ts`](/cs3/cs3_windows/src/types/metadata.ts) | `L410–L460` | Type definitions for `ExtendedMetadata`, including `MovieCollection` and `CollectionPart` schemas. |
| **Wikidata Franchise Enrichment** | [`wikidata.ts`](/cs3/cs3_windows/electron/metadata/wikidata.ts) | `L60–L120`, `L200–L250` | SPARQL query definitions for series entities (`P179`), ordinals (`P1545`), prequels (`P155`), and sequels (`P156`). |
| **Metadata Enrichment Service** | [`enrichmentService.ts`](/cs3/cs3_windows/electron/metadata/enrichmentService.ts) | `L55–L110`, `L250–L310` | Coordinates franchise fetching, caching, and merging into the title's extended metadata record. |
| **Cinemeta Metadata & Artwork** | [`cinemeta.ts`](/cs3/cs3_windows/electron/cinemeta.ts) | `L55–L85`, `L160–L200` | Resolves posters, titles, and release years for franchise IMDb IDs without requiring API keys. |
| **Detail View Styles** | [`sources.css`](/cs3/cs3_windows/src/sources.css) | `L2800–L2850`, `L7150–L7190` | Layout, badges, and typography for `.detail-collection`, franchise headings, and active borders. |

---

### Documentation Updated

1. [`docs/2026-10-051-App-updates-prd-info.md`](/cs3/docs/2026-10-051-App-updates-prd-info.md): Added Sections 34, 35, 36, and 37.
2. [`docs/2026-10-052-session-handoff.md`](/cs3/docs/2026-10-052-session-handoff.md): Added Item 13 to the prioritized backlog.

---

# 2. Problem

Currently, movie discovery is primarily based on the movie returned by search.

This works poorly for franchises where:

- Movies do not contain numeric titles.
- Sequels use completely different names.
- Release order is important.
- The user may not know the names of other movies.
- A franchise contains many movies.
- Different sub-series exist within the same larger universe.
- Spin-offs and crossover movies exist.
- Chronological story order differs from release order.

Examples include:

- Harry Potter
- Spider-Man
- X-Men
- Star Wars
- Marvel
- Batman
- Iron Man
- Hulk
- Mission: Impossible
- Fast & Furious
- Jurassic Park / Jurassic World
- Planet of the Apes
- The Lord of the Rings
- The Hobbit
- Transformers

The application should make discovering these related movies much easier.

---

# 3. Desired User Experience

On the movie details page, alongside sections such as:

- More Like This
- Cast
- Trailers
- Recommendations
- Similar Movies

add a dedicated section:

```text
Movies in This Series
```

or:

```text
Franchise
```

Example:

```text
Harry Potter and the Chamber of Secrets

[Poster] [Poster] [Poster] [Poster] [Poster]

1. Harry Potter and the Philosopher's Stone
2. Harry Potter and the Chamber of Secrets
3. Harry Potter and the Prisoner of Azkaban
4. Harry Potter and the Goblet of Fire
5. Harry Potter and the Order of the Phoenix
...
```

The currently opened movie should be visually highlighted.

---

# 4. Research Finding

TMDB is a strong candidate for the primary source for this feature.

TMDB provides a dedicated **Collection** concept and an API endpoint for retrieving collection details. [The Movie Database (TMDB)](https://developer.themoviedb.org/reference/collection-details?utm_source=chatgpt.com)

TMDB also provides movie search, discovery, and lookup functionality. Its search system considers original, translated, alternative names and titles, which makes it useful for resolving movies whose displayed title may differ from the user's search title. [The Movie Database (TMDB)](https://developer.themoviedb.org/docs/finding-data?utm_source=chatgpt.com)

This means the preferred architecture should **not attempt to infer franchises solely from movie titles**.

Instead, the application should use structured franchise/collection metadata whenever available.

---

# 5. Primary Metadata Source: TMDB

The preferred flow should be:

```text
Current Media
     ↓
Resolve external metadata ID
     ↓
TMDB Movie ID
     ↓
Movie Details
     ↓
Check Collection / Franchise
     ↓
Collection ID
     ↓
Fetch Collection Details
     ↓
Get All Collection Movies
     ↓
Sort
     ↓
Display Franchise Section
```

TMDB's collection endpoint is specifically designed to retrieve collection details by collection ID. [The Movie Database (TMDB)](https://developer.themoviedb.org/reference/collection-details?utm_source=chatgpt.com)

This is considerably more reliable than trying to determine relationships through title similarity.

---

# 6. Metadata Resolution

The application may already have metadata from:

- Provider metadata
- IMDb ID
- TMDB ID
- Original title
- Local catalog metadata
- Search result metadata

The system should reuse existing metadata where possible.

If a TMDB ID already exists:

```text
Use TMDB ID directly
```

If only IMDb ID exists:

```text
IMDb ID
   ↓
TMDB Find API
   ↓
TMDB Movie ID
```

TMDB explicitly supports finding movies, TV shows and people using existing external IDs. [The Movie Database (TMDB)](https://developer.themoviedb.org/docs/finding-data?utm_source=chatgpt.com)

---

# 7. Do Not Depend on Scraped Provider Titles

Provider titles can be inconsistent.

Examples:

```text
Spider-Man No Way Home 2021 1080p
Spider Man: No Way Home
Spider-Man: No Way Home
Spiderman NWH
Spider-Man No Way Home Hindi Dubbed
```

These should resolve to the same underlying movie where possible.

The franchise system should therefore operate on canonical metadata IDs rather than raw provider titles.

---

# 8. Collection-Based Relationship

When TMDB identifies a collection for the current movie, use that collection as the primary franchise relationship.

Conceptually:

```text
Movie
  |
  +-- belongs_to_collection
          |
          +-- Collection
                |
                +-- Movie A
                +-- Movie B
                +-- Movie C
                +-- Movie D
```

This gives us a structured way to identify the movies belonging to the same collection.

---

# 9. Chronological Ordering

The collection results should not simply be displayed in API response order.

We should explicitly calculate the display order.

Default order:

```text
Release date ascending
```

For example:

```text
2001 → 2002 → 2004 → 2005 → 2007
```

This provides an intuitive "watch from the beginning" experience.

TMDB movie discovery data includes release dates, which can also be used for ordering where needed. [The Movie Database (TMDB)](https://developer.themoviedb.org/reference/discover-movie?utm_source=chatgpt.com)

---

# 10. Release Order vs Story Chronological Order

An important distinction must be maintained.

There are two possible meanings of "chronological":

### Release order

```text
Movie released in 2001
Movie released in 2002
Movie released in 2004
...
```

### Story timeline order

```text
Movie occurring first in the fictional timeline
Movie occurring second
Movie occurring third
...
```

These are not always the same.

For example, some franchises contain prequels, spin-offs and origin stories that take place earlier in the fictional timeline but were released later.

Therefore the system should initially use:

**Release order as the default canonical order.**

Story chronology can be introduced later if a reliable metadata source provides explicit ordering.

---

# 11. Franchise Position

Where a franchise has an obvious numbered position, the UI can optionally display it.

For example:

```text
1. Iron Man
2. Iron Man 2
3. Iron Man 3
```

For titles without explicit numbering:

```text
1. Harry Potter and the Philosopher's Stone
2. Harry Potter and the Chamber of Secrets
3. Harry Potter and the Prisoner of Azkaban
```

Do not invent numbers merely from title text.

The position should represent the application's calculated franchise ordering.

---

# 12. Current Movie Highlight

The movie currently being viewed should be clearly highlighted.

Example:

```text
Movies in This Series

[✓ Philosopher's Stone]
[● Chamber of Secrets]
[  Prisoner of Azkaban]
[  Goblet of Fire]
```

The current movie should remain visible when the user horizontally scrolls through the section.

---

# 13. Navigation

Clicking another franchise movie should open its normal details page.

Example:

```text
Current Movie
     ↓
Franchise
     ↓
Click "Prisoner of Azkaban"
     ↓
Movie Details
     ↓
Play / Download / Sources
```

The user should not be forced to return to search.

---

# 14. More Like This Integration

This feature should be separate from **More Like This**.

### More Like This

Answers:

> "What other content might I like?"

### Franchise

Answers:

> "What other movies belong to this same movie series?"

These are different relationships and should not be mixed.

---

# 15. Franchise Section Placement

Recommended details-page order:

```text
Movie Details
   ↓
Play / Sources
   ↓
Description
   ↓
Trailers
   ↓
Movies in This Series
   ↓
More Like This
   ↓
Cast
   ↓
Other Recommendations
```

The exact placement can be adjusted based on the existing details-page design.

---

# 16. Franchise Section Should Be Conditional

Do not display an empty section.

Only show:

```text
Movies in This Series
```

when a reliable franchise relationship exists and there are additional relevant movies.

For a standalone movie:

```text
No franchise section
```

For a franchise containing only the current movie:

```text
No franchise section
```

For a franchise with multiple movies:

```text
Show franchise section
```

---

# 17. Large Franchises

Some franchises contain many movies.

For example:

```text
X-Men
Star Wars
Marvel
Batman
Spider-Man
```

The section should therefore support horizontal scrolling and not attempt to display every movie vertically.

Initial design:

```text
Movies in This Series                         See All >

[Poster] [Poster] [Poster] [Poster] [Poster] →
```

Clicking **See All** should open a dedicated franchise page.

---

# 18. Dedicated Franchise Page

The dedicated page should display the complete collection.

Example:

```text
Harry Potter

8 Movies

1. Harry Potter and the Philosopher's Stone
   2001

2. Harry Potter and the Chamber of Secrets
   2002

3. Harry Potter and the Prisoner of Azkaban
   2004

...
```

The page can use either:

- Grid view
- Vertical list
- Compact poster list

depending on the existing application design.

---

# 19. Franchise Page Features

The dedicated page should provide:

- Franchise title
- Franchise poster/backdrop
- Description where available
- Total number of movies
- Release years
- Chronological/release ordering
- Current movie indicator
- Watched state
- Library state
- Available playback state
- Click-through to details
- Search/filter where the franchise is very large

---

# 20. Provider Availability

An important requirement is that franchise metadata and provider availability remain separate.

For example:

```text
TMDB:
Movie exists
```

does not mean:

```text
CS3:
Movie has playable sources
```

Therefore each franchise item can optionally show whether the application currently has playable content.

Example:

```text
Harry Potter and the Goblet of Fire

TMDB metadata: Available
CS3 sources: Available
```

or:

```text
TMDB metadata: Available
CS3 sources: Not currently found
```

The movie should still be displayed because the purpose of this section is discovery.

---

# 21. Source Resolution When User Clicks

When the user clicks a franchise movie:

```text
TMDB Movie
    ↓
Resolve canonical metadata
    ↓
Search existing local/catalog providers
    ↓
Display normal CS3 details page
```

Do not assume that the TMDB movie ID itself is the application's provider ID.

The metadata layer and content-provider layer should remain separate.

---

# 22. Multiple Metadata Sources

TMDB should be the preferred structured source.

Additional metadata sources can be used as fallback or verification.

Potential sources:

1. TMDB
2. IMDb
3. Existing metadata services already integrated into CS3
4. Provider metadata
5. Other licensed/public metadata sources where permitted

IMDb offers structured entertainment metadata and has a commercial metadata product, so licensing and usage restrictions must be reviewed before treating IMDb as a general free production API. [IMDb Developer](https://developer.imdb.com/?rf=mProPublic\&utm_source=chatgpt.com)

Therefore:

**Do not design the production architecture around scraping IMDb pages.**

---

# 23. IMDb Usage

IMDb can be useful as an external identity and metadata source where legally and technically appropriate.

However, we should not assume that IMDb can simply be scraped for unlimited production use.

The preferred approach is:

```text
TMDB structured API
        ↓
Primary franchise relationship

IMDb
        ↓
External ID / secondary metadata where permitted
```

---

# 24. Fallback Relationship Discovery

Some movies may not belong to a TMDB collection even though they are clearly part of a franchise.

For these cases, introduce a fallback relationship resolver.

Potential signals:

```text
Shared collection
      +
Shared franchise metadata
      +
Shared keywords
      +
Shared characters
      +
Shared production relationships
      +
External IDs
      +
Title similarity
```

However, fallback matching must be conservative.

---

# 25. Avoid False Franchise Matches

This is extremely important.

For example, movies can share:

- Actor
- Director
- Genre
- Character name
- Studio
- Keywords

without belonging to the same franchise.

Therefore:

```text
Same actor ≠ same franchise
Same genre ≠ same franchise
Same studio ≠ same franchise
Similar title ≠ same franchise
```

These signals should not independently create a franchise relationship.

---

# 26. Confidence-Based Relationship Resolver

A fallback resolver should return:

```text
HIGH CONFIDENCE
MEDIUM CONFIDENCE
LOW CONFIDENCE
NO RELATIONSHIP
```

Only high-confidence relationships should automatically appear as a franchise.

Medium-confidence relationships may be considered only after additional verification.

Low-confidence relationships should not be shown as franchise relationships.

---

# 27. Separate Franchise and Universe

Some larger cinematic universes contain multiple independent franchises.

For example:

```text
Marvel Cinematic Universe
    |
    +-- Iron Man
    +-- Captain America
    +-- Thor
    +-- Avengers
    +-- Guardians of the Galaxy
```

These should not necessarily be treated as one simple chronological movie series.

The architecture should distinguish:

```text
Collection / Series
Franchise
Shared Universe
```

The first implementation should focus on **direct movie collections/series**.

Shared-universe chronology can be a later feature.

---

# 28. Example: Spider-Man

When the user opens a Spider-Man movie, the system should avoid blindly combining every Spider-Man-related movie into one list.

For example, different Spider-Man continuities may exist.

The system should preserve the metadata source's collection boundaries where possible.

This avoids creating an incorrect sequence such as:

```text
Spider-Man 2002
The Amazing Spider-Man 2012
Spider-Man: Homecoming 2017
```

as though they were direct sequels.

They may all relate to Spider-Man but belong to different series/continuities.

---

# 29. Example: X-Men

X-Men is another case where release order and story chronology can differ significantly.

The initial implementation should therefore show:

```text
X-Men Collection
```

using the authoritative collection relationship and release order.

Do not attempt to invent a complete MCU-style story chronology from release dates alone.

---

# 30. Example: Star Wars

Star Wars contains:

- Main saga
- Spin-offs
- Anthology films
- Related content

The system should avoid mixing all related titles into one direct sequel chain.

The initial feature should prefer the specific collection associated with the current movie.

---

# 31. Example: Harry Potter

Harry Potter is an ideal use case.

If the user opens:

```text
Harry Potter and the Chamber of Secrets
```

the system should identify the collection and display the complete movie sequence.

The current movie should be highlighted.

The user can then click:

```text
Philosopher's Stone
Prisoner of Azkaban
Goblet of Fire
...
```

without performing another search.

---

# 32. Example: Iron Man

For a movie such as:

```text
Iron Man 2
```

the section should provide:

```text
1. Iron Man
2. Iron Man 2
3. Iron Man 3
```

This demonstrates that explicit numbering can be supported naturally but does not need to drive the relationship logic.

---

# 33. Metadata Caching

Franchise information should be cached locally.

Suggested cache:

```text
FranchiseCache
  |
  +-- metadataSource
  +-- collectionId
  +-- collectionName
  +-- movies[]
  +-- fetchedAt
  +-- expiresAt
  +-- schemaVersion
```

The application should not request the same collection repeatedly every time the user opens a movie.

---

# 34. Local-First Behavior

This should follow the existing local-first/cache architecture.

```text
Open Details Page
      ↓
Check local franchise cache
      ↓
If available:
    Display immediately
      ↓
Background refresh
```

If no cached data exists:

```text
Open Details Page
      ↓
Load normal metadata
      ↓
Fetch franchise metadata
      ↓
Display section progressively
```

The franchise lookup must not block the main movie details page.

---

# 35. Background Refresh

Cached franchise metadata should be refreshed in the background.

If the API is temporarily unavailable:

```text
Existing cached franchise
        ↓
Continue displaying cached data
```

Do not remove a previously valid franchise because a background request failed.

---

# 36. API Failure Handling

If TMDB is unavailable:

```text
Movie details still load
Franchise section may use cached data
```

If no cached data exists:

```text
Hide franchise section
```

Do not display an error dialog for a non-critical recommendation feature.

---

# 37. API Rate Limiting

TMDB enforces API rate limiting. [The Movie Database (TMDB)](https://developer.themoviedb.org/docs/getting-started?utm_source=chatgpt.com)

Therefore the implementation must:

- Cache collection metadata
- Avoid duplicate requests
- Deduplicate concurrent requests
- Use request coalescing
- Avoid fetching the same collection for every movie independently
- Apply appropriate retry/backoff
- Avoid blocking the UI

---

# 38. Concurrent Request Deduplication

If several components request the same franchise simultaneously:

```text
DetailsPage
   ├── FranchiseSection
   ├── RecommendationSection
   └── MetadataService
```

they should share the same in-flight request.

Conceptually:

```text
getCollection(collectionId)
        ↓
Existing request?
   YES → await existing request
   NO  → create request
```

---

# 39. Metadata Identity

Each franchise movie should maintain canonical identity information.

Example:

```text
{
  tmdbId,
  imdbId,
  title,
  originalTitle,
  releaseDate,
  year,
  poster,
  backdrop,
  collectionId,
  collectionName
}
```

Provider-specific IDs should be stored separately.

---

# 40. Integration With Existing Source Provenance

This feature should integrate with the existing source-provenance architecture.

A franchise movie should retain:

```text
Metadata source
TMDB ID
IMDb ID where available
Provider ID
Repository
Extension
Provider
Resolved source
```

When the user navigates from the franchise section into a movie, the normal provenance chain should remain intact.

---

# 41. Search Integration

Eventually, search results can also recognize franchise context.

For example:

```text
Search:
Spider-Man
```

could potentially show:

```text
Spider-Man

Franchise:
Spider-Man Collection
```

However, this should be secondary to the initial details-page implementation.

---

# 42. "Next" and "Previous" Navigation

A useful extension of the feature would be:

```text
Previous Movie
        |
Current Movie
        |
Next Movie
```

For example:

```text
← Prisoner of Azkaban

Harry Potter and the Chamber of Secrets

Goblet of Fire →
```

This can be displayed inside the details page or player.

---

# 43. Continue to Next Movie

Eventually, the player could optionally provide:

```text
Next in Series
```

after a movie finishes.

Example:

```text
Harry Potter and the Chamber of Secrets
              ↓
Playback finished
              ↓
Next in Series:
Harry Potter and the Prisoner of Azkaban

[Play Next]
```

This should be a later phase, not required for the first implementation.

---

# 44. User Watch State

Where a franchise section is displayed, optionally show:

```text
✓ Watched
▶ Continue Watching
○ Not Watched
```

This must reuse the application's existing watch-history/library state.

It should not introduce another independent tracking system.

---

# 45. Incognito Compatibility

Franchise metadata discovery itself can remain functional in Incognito.

However, opening a franchise movie must not create:

- Search history
- Watch history
- Continue Watching
- Personalization data

unless the user explicitly performs an action that is allowed to persist under the existing privacy rules.

---

# 46. Adult/18+ Filtering

The franchise section must respect the application's existing 18+ content setting.

If 18+ content is disabled:

- Do not expose adult-only franchise items.
- Do not bypass repository/provider filtering.
- Do not reveal hidden adult content through franchise relationships.
- Mixed franchises should be filtered according to the existing adult-content rules.

This should use the same centralized filtering behavior already applied elsewhere in the application.

---

# 47. Recommended Implementation Architecture

Introduce a dedicated service:

```text
FranchiseService
```

Responsibilities:

```text
resolveMovieMetadata()
resolveCollection()
getCollectionMovies()
sortCollection()
buildFranchiseModel()
cacheCollection()
refreshCollection()
```

Potential architecture:

```text
                    FranchiseService
                          |
              ┌───────────┴───────────┐
              │                       │
        MetadataResolver       FranchiseCache
              │
       ┌──────┴──────┐
       │             │
      TMDB          IMDb
       │
       ▼
Collection Resolver
       │
       ▼
Chronology Resolver
       │
       ▼
Franchise Model
       │
       ├── Details Page
       ├── Franchise Page
       └── Future Player Navigation
```

---

# 48. Suggested Data Model

```typescript
interface FranchiseMovie {
  tmdbId?: number;
  imdbId?: string;

  title: string;
  originalTitle?: string;

  releaseDate?: string;
  releaseYear?: number;

  posterPath?: string;
  backdropPath?: string;

  collectionId?: number;
  collectionName?: string;

  position: number;

  isCurrent: boolean;

  providerAvailability?: {
    hasSources: boolean;
    providerCount?: number;
  };
}

interface Franchise {
  id: string;
  name: string;

  source: "tmdb" | "imdb" | "internal" | "combined";

  movies: FranchiseMovie[];

  ordering: "release" | "story" | "metadata";

  fetchedAt: number;
  expiresAt: number;
}
```

---

# 49. Ordering Algorithm

Initial algorithm:

```text
1. Use authoritative collection membership.
2. Remove duplicate movie IDs.
3. Remove invalid/deleted metadata.
4. Apply adult-content filtering.
5. Sort by release date ascending.
6. Use metadata position where explicitly available.
7. Use title as a deterministic fallback.
8. Mark the currently opened movie.
```

Do not infer story chronology unless the metadata source explicitly provides enough information.

---

# 50. Metadata Conflict Resolution

If multiple sources provide different information:

```text
TMDB collection relationship
        ↓
Preferred

Provider relationship
        ↓
Secondary verification

Title similarity
        ↓
Fallback only
```

The system should never allow a weak title match to override an authoritative collection relationship.

---

# 51. Research Tasks Before Implementation

Before coding, research and document:

### TMDB

- Movie details
- Collection relationship
- Collection details
- Collection movie ordering
- External IDs
- Search
- Regional metadata
- Rate limits
- API caching requirements
- API licensing/attribution requirements

TMDB provides official API authentication and API access through application credentials. [The Movie Database (TMDB)](https://developer.themoviedb.org/docs/authentication-application?utm_source=chatgpt.com)

### IMDb

- External ID resolution
- Available public datasets
- Commercial metadata options
- Licensing restrictions
- Whether the required franchise relationship data is actually available
- Whether it is appropriate for a production desktop application

IMDb currently describes its structured metadata products as licensed data products, including essential metadata and ratings. [IMDb Developer](https://developer.imdb.com/?rf=mProPublic\&utm_source=chatgpt.com)

### Existing CS3 Metadata

- Existing metadata resolver
- Existing TMDB integration
- Existing IMDb integration
- Existing title normalization
- Existing external-ID mapping
- Existing cache
- Existing recommendation system

---

# 52. Phase 1: Research and Proof of Concept

Before integrating into the UI, create a small proof of concept.

Input:

```text
Harry Potter and the Chamber of Secrets
```

Expected:

```text
Resolve movie
    ↓
Find TMDB ID
    ↓
Find collection
    ↓
Fetch collection
    ↓
Return all movies
    ↓
Sort by release date
```

Repeat with:

- Harry Potter
- Spider-Man
- X-Men
- Star Wars
- Iron Man
- Batman

The proof of concept should demonstrate that the approach works across multiple franchise structures.

---

# 53. Phase 2: Backend Integration

Implement:

```text
FranchiseService
FranchiseCache
MetadataResolver integration
TMDB collection adapter
Chronology resolver
Adult-content filtering
Provider availability resolver
```

No UI redesign should be required during this phase.

---

# 54. Phase 3: Details Page

Add:

```text
Movies in This Series
```

to the movie details page.

Requirements:

- Horizontal poster cards
- Current movie highlighted
- Release year
- Movie title
- Click to open details
- Loading skeleton
- Cached-first loading
- Background refresh
- Hide when no valid franchise exists

---

# 55. Phase 4: Dedicated Franchise Page

Add:

```text
See All
```

and create a reusable franchise page.

The page should support:

- Full movie list
- Release ordering
- Current movie
- Watch state
- Provider availability
- Navigation

---

# 56. Phase 5: Future Enhancements

After the core implementation works, consider:

- Story chronology
- Franchise vs universe distinction
- Previous/next movie navigation
- Play next movie
- Automatic next-in-series
- Franchise search
- Franchise bookmarks
- Franchise progress
- "Start from beginning"
- "Continue series"
- Cross-universe navigation

---

# 57. Definition of Done

This feature is complete when:

- A movie can be resolved to canonical metadata.
- The system can identify a reliable franchise/collection.
- All relevant movies can be retrieved.
- Movies are displayed in chronological release order.
- The current movie is highlighted.
- Users can open any franchise movie directly.
- Franchise discovery does not depend on numeric titles.
- Harry Potter-style titles work correctly.
- Spider-Man/X-Men/Star Wars-style franchises do not get incorrectly merged.
- Missing franchise metadata does not break the movie details page.
- API failures do not break playback or details.
- Franchise metadata is cached.
- Duplicate API requests are avoided.
- 18+ filtering is respected.
- Incognito behavior remains compliant with existing privacy rules.
- Provider availability remains separate from metadata availability.
- Existing movie search and details functionality remains unchanged.

---

# 58. Recommended Direction

**Yes, this feature is technically feasible and is a very good fit for CS3.**

The strongest implementation is **not to build a custom scraper that tries to guess movie relationships from titles**.

The preferred architecture is:

```text
CS3 Movie
   ↓
Canonical Metadata
   ↓
TMDB Movie ID
   ↓
TMDB Collection ID
   ↓
Collection Movies
   ↓
Release-date ordering
   ↓
Franchise UI
   ↓
Click any movie
   ↓
Normal CS3 Details / Sources / Playback
```

TMDB's structured collection model is specifically suited to this use case, while its search and external-ID lookup mechanisms can help resolve provider titles to canonical movies. [The Movie Database (TMDB)](https://developer.themoviedb.org/reference/collection-details?utm_source=chatgpt.com)

For the first implementation, **TMDB Collection + release order should be the source of truth**. IMDb should be treated as a secondary identity/metadata source only after its licensing and available relationship data are confirmed.