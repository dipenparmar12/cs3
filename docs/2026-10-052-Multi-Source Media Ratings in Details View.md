# PRD: Multi-Source Media Ratings in Details View

## 1. Overview

Add a dedicated **Ratings** section to the Media Details View that displays ratings from multiple trusted public sources.

The initial supported rating sources should be:

- IMDb
- Rotten Tomatoes
- Metacritic
- TMDB

The goal is to give users a quick, consolidated view of how the media is rated across different platforms without requiring them to leave the application.

---

## 2. Details View

Add the ratings section near the primary media metadata, preferably below the title and basic metadata.

Example:

```text
The Dark Knight
2008 · Action · Crime · Drama

IMDb             9.0/10
Rotten Tomatoes   94%
Metacritic        84/100
TMDB              8.5/10
```

The design should be compact and visually consistent with the existing Details View.

---

## 3. Rating Sources

Each source must remain clearly identifiable.

Recommended presentation:

```text
Ratings

IMDb              9.0/10
Rotten Tomatoes   94%
Metacritic        84/100
TMDB              8.5/10
```

Do not normalize all ratings into a single number in the UI.

The original rating scale should always be preserved.

---

## 4. Preserve Native Rating Scales

Different services use different rating systems.

Examples:

```text
IMDb             8.7 / 10
TMDB              8.4 / 10
Rotten Tomatoes   92%
Metacritic        84 / 100
```

Do not convert these into a common score and replace the original values.

Users should understand exactly what each source reports.

---

## 5. Rotten Tomatoes

Where available, display the relevant Rotten Tomatoes scores separately.

For example:

```text
Rotten Tomatoes

Critics     94%
Audience    91%
```

If only one score is available, display the available score.

Do not invent a missing audience or critics score.

---

## 6. Metacritic

Display the Metacritic score using its native scale:

```text
Metacritic
84/100
```

Where both critic and user scores are legitimately available and supported by the data source, they may be displayed separately:

```text
Metacritic

Metascore       84/100
User Score      8.5/10
```

---

## 7. IMDb

Display the IMDb rating using the native IMDb scale:

```text
IMDb
9.0/10
```

Where supported, optionally display the number of votes:

```text
IMDb
9.0/10
2.9M votes
```

Vote counts should only be shown when reliable data is available.

---

## 8. TMDB

Display the TMDB rating using the native TMDB scale:

```text
TMDB
8.5/10
```

Optionally display vote count when available:

```text
TMDB
8.5/10
12,450 votes
```

---

## 9. Missing Ratings

Not every movie will have ratings from every source.

For example:

```text
Ratings

IMDb              7.8/10
Rotten Tomatoes   82%
Metacritic        N/A
TMDB              7.6/10
```

Do not hide the entire Ratings section because one source is unavailable.

Only the unavailable source should be marked unavailable or omitted according to the final UI design.

---

## 10. Rating Data Model

Create a normalized internal model while preserving the original source values.

```typescript
interface MediaRating {
  source:
    | "imdb"
    | "rottenTomatoes"
    | "metacritic"
    | "tmdb";

  score: number;
  maxScore: number;

  displayValue: string;

  voteCount?: number;

  criticsScore?: number;
  audienceScore?: number;

  url?: string;

  fetchedAt: number;
}
```

For example:

```typescript
{
  source: "imdb",
  score: 9.0,
  maxScore: 10,
  displayValue: "9.0/10"
}
```

---

## 11. Canonical Media Matching

Ratings must be associated with the correct movie or TV show.

Do not rely only on title matching.

Use available identifiers such as:

```text
TMDB ID
IMDb ID
Original title
Release year
Season / Episode
```

Preferred matching:

```text
CS3 Media
    ↓
Canonical Metadata
    ↓
IMDb ID / TMDB ID
    ↓
Rating Source
    ↓
Rating
```

This is especially important for movies with:

- Remakes
- Reboots
- Multiple versions
- Similar titles
- Regional titles
- Different release years

---

## 12. Rating Service

Introduce a centralized service:

```text
MediaRatingService
```

Responsibilities:

```text
resolveMediaIdentity()
fetchIMDbRating()
fetchRottenTomatoesRating()
fetchMetacriticRating()
fetchTMDBRating()
normalizeRatings()
cacheRatings()
refreshRatings()
```

The Details View should not directly communicate with each rating provider.

---

## 13. Provider Adapter Architecture

Use independent adapters:

```text
MediaRatingService
        |
        +-- IMDbRatingProvider
        +-- RottenTomatoesRatingProvider
        +-- MetacriticRatingProvider
        +-- TMDBRatingProvider
```

This allows individual providers to be changed or disabled without affecting the rest of the rating system.

---

## 14. API and Licensing Research

Before implementation, verify the current official API/data-access options and licensing requirements for each source.

Do not assume that IMDb or Rotten Tomatoes can be freely scraped for production use.

The implementation should prefer:

1. Official APIs
2. Licensed data
3. Existing permitted metadata services
4. Existing project integrations

Only use scraping where it is technically and legally appropriate.

---

## 15. TMDB Integration

If TMDB metadata is already available for the current media, reuse the existing TMDB movie/show ID and fetch the rating without performing another unnecessary search.

The TMDB rating should therefore integrate naturally with the existing metadata pipeline.

---

## 16. Rating Cache

Ratings do not need to be fetched repeatedly.

Use a persistent cache:

```text
RatingCache
    |
    +-- media identity
    +-- source
    +-- rating
    +-- vote count
    +-- fetchedAt
    +-- expiresAt
```

Example:

```text
Movie ID: tmdb:155
Source: imdb
Rating: 9.0
Fetched: 2026-10-06
```

---

## 17. Cache Strategy

Details View:

```text
Open Media
     ↓
Check rating cache
     ↓
Cached?
 ┌───┴────┐
YES       NO
 │         │
Display    Fetch
 │         │
Refresh    Cache
in         │
background │
 └────┬────┘
      ↓
   Update UI
```

Previously fetched ratings should be displayed immediately.

---

## 18. Avoid Blocking Details View

Rating requests must never block the primary Details View.

The page should load:

```text
Title
Poster
Description
Metadata
Play
Sources
```

without waiting for all rating providers.

Ratings can appear progressively:

```text
Ratings

IMDb              Loading...
Rotten Tomatoes   Loading...
Metacritic        Loading...
TMDB              8.5/10
```

Then update each source as its data becomes available.

---

## 19. Provider Failure Isolation

If one rating provider fails:

```text
IMDb             ✓
Rotten Tomatoes  ✓
Metacritic       ✗
TMDB             ✓
```

the remaining ratings should still be displayed.

Do not fail the entire Ratings section because one provider is unavailable.

---

## 20. Refresh Behavior

Provide a way to refresh ratings when necessary.

For example:

```text
Ratings                         ↻

IMDb             9.0/10
Rotten Tomatoes  94%
Metacritic       84/100
TMDB             8.5/10
```

Manual refresh should bypass the normal cache TTL where appropriate.

---

## 21. Rating Updates

Ratings can change over time, especially:

- IMDb ratings
- Rotten Tomatoes audience scores
- Metacritic user scores
- Vote counts

The cache should therefore use an expiration policy rather than treating ratings as permanent metadata.

---

## 22. Rating Source Links

Where permitted, each rating can optionally provide a source link.

Example:

```text
IMDb              9.0/10    ↗
Rotten Tomatoes   94%       ↗
Metacritic        84/100    ↗
TMDB              8.5/10    ↗
```

Clicking the source should open the corresponding official source page where appropriate.

---

## 23. Visual Design

The rating cards should be compact.

Recommended:

```text
┌───────────────────────────────────────────────┐
│ Ratings                                       │
│                                               │
│ IMDb              9.0/10                     │
│ Rotten Tomatoes   94%                        │
│ Metacritic        84/100                     │
│ TMDB              8.5/10                     │
└───────────────────────────────────────────────┘
```

Avoid large cards that consume significant vertical space.

---

## 24. Optional Rating Indicators

The UI may use subtle visual indicators to make scores easier to scan.

For example:

```text
IMDb              9.0/10
Rotten Tomatoes   94%
Metacritic        84/100
TMDB              8.5/10
```

Do not use aggressive colors or labels such as "Excellent" or "Bad" unless the application has a consistent rating interpretation system.

The original score should remain the primary information.

---

## 25. Critics vs Audience

Where the source provides separate scores, preserve the distinction.

For example:

```text
Rotten Tomatoes

Critics      94%
Audience     91%
```

Do not combine them into one score.

---

## 26. TV Shows and Episodes

The rating system should distinguish between:

- Movie
- TV series
- Season
- Episode

For example, a series rating should not accidentally be displayed as an episode rating.

The metadata resolver must determine the correct entity type before requesting ratings.

---

## 27. Regional and Alternate Titles

Rating matching should support:

- Original title
- English title
- Translated title
- Regional title
- Alternate title

Canonical external IDs should always be preferred over title-only matching.

---

## 28. Rating Source Availability

The system should expose provider capabilities internally:

```typescript
interface RatingProvider {
  id: string;
  name: string;

  supports(type: MediaType): boolean;

  getRating(
    media: CanonicalMediaIdentity
  ): Promise<MediaRating | null>;
}
```

This allows unsupported content types to be skipped cleanly.

---

## 29. Incognito Compatibility

Rating retrieval should respect the existing privacy architecture.

Ratings may be fetched when the user opens a media page in Incognito, but:

- Rating searches must not create search history.
- Rating URLs should not be persisted as browsing history.
- User activity should not be added to personalization.
- Sensitive media information should not unnecessarily appear in persistent diagnostics.

---

## 30. Adult Content Filtering

The Ratings section must respect the application's 18+ content policy.

If adult content is disabled, rating discovery must not bypass the existing content restrictions.

The rating system should only operate on media that the user is already allowed to view.

---

## 31. Integration With Existing Details Metadata

The rating system should integrate with the existing canonical media metadata rather than creating a second media identity system.

Recommended:

```text
Media Details
      |
      +-- Canonical Metadata
      |
      +-- Ratings
      |     +-- IMDb
      |     +-- Rotten Tomatoes
      |     +-- Metacritic
      |     +-- TMDB
      |
      +-- Trailers
      +-- Franchise
      +-- Reviews & Explanations
      +-- More Like This
      +-- Cast
```

---

## 32. Acceptance Criteria

The feature is complete when:

- IMDb ratings can be displayed.
- Rotten Tomatoes ratings can be displayed.
- Metacritic ratings can be displayed.
- TMDB ratings can be displayed.
- Each source retains its native rating scale.
- Critics and audience ratings remain separate where available.
- Missing ratings do not break the section.
- Incorrect movie matching is prevented through canonical IDs where possible.
- Ratings are cached.
- Cached ratings appear immediately.
- Ratings can refresh in the background.
- Rating requests do not block the Details View.
- Provider failures are isolated.
- Ratings can be refreshed manually.
- Rating data respects Incognito behavior.
- 18+ filtering is respected.
- Official/licensed APIs or permitted data sources are preferred.
- Existing metadata and Details View functionality remain unaffected.

## Final Details View

The target experience should be approximately:

```text
┌────────────────────────────────────────────────────┐
│                    MOVIE DETAILS                    │
│                                                    │
│ The Dark Knight                                   │
│ 2008 · Action · Crime · Drama                     │
│                                                    │
│ [Play] [Download] [Library]                       │
│                                                    │
│ Ratings                                            │
│ IMDb              9.0/10                          │
│ Rotten Tomatoes   94%                             │
│ Metacritic        84/100                          │
│ TMDB              8.5/10                          │
│                                                    │
│ Description                                        │
│                                                    │
│ Trailers                                           │
│ [Trailer] [Trailer] [Trailer]                     │
│                                                    │
│ Movies in This Series                              │
│ [Movie] [Movie] [Movie] [Movie]                   │
│                                                    │
│ Reviews & Explanations                             │
│ [Search Reviews & Explanations]                   │
│                                                    │
│ More Like This                                     │
│ [Movie] [Movie] [Movie]                           │
└────────────────────────────────────────────────────┘
```

The key principle is to make the **Ratings section a lightweight, reliable aggregation of trusted sources**, while keeping external requests asynchronous, cached, independently fault-tolerant, and separate from the critical media playback pipeline.