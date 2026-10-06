# PRD: On-Demand Movie Reviews, Explanations and Related Media

## 1. Overview

Add a new **on-demand media section** to the movie and TV show details page that allows users to discover publicly available content related to the currently selected media.

The section should include content such as:

- Reviews
- Movie explanations
- Ending explanations
- Story breakdowns
- Analysis
- Ratings and review discussions
- Recaps
- Critiques
- Interviews
- Discussions
- Related videos
- Other publicly available media related to the title

Potential sources can include:

- YouTube
- Dailymotion
- Other publicly accessible video platforms
- Public review websites
- Public articles
- Other permitted public resources

The key requirement is that this content **must not be fetched automatically when the details page opens**.

It should only be fetched when the user explicitly requests it.

---

# 2. User Experience

Add a section to the details page similar to the existing Trailer section.

For example:

```text
Trailers
[Trailer 1] [Trailer 2] [Trailer 3]

Reviews & Explanations
[View Reviews & Explanations]
```

The user clicks the button:

```text
View Reviews & Explanations
```

Only then should the application start discovering and fetching the related content.

---

# 3. On-Demand Requirement

This feature must be **lazy-loaded**.

Normal details-page loading should remain:

```text
Open Movie Details
        ↓
Load normal metadata
        ↓
Load posters/backdrops
        ↓
Load trailers where currently supported
        ↓
Display page
```

It must **not** automatically do:

```text
Open Movie Details
        ↓
Search YouTube
        ↓
Search Dailymotion
        ↓
Search review websites
        ↓
Fetch dozens of external resources
```

Instead:

```text
Open Movie Details
        ↓
User clicks "Reviews & Explanations"
        ↓
Start discovery
        ↓
Fetch results
        ↓
Display results progressively
```

---

# 4. Why On-Demand

The feature should not negatively affect:

- Initial details-page loading
- Network usage
- API rate limits
- Search performance
- Provider discovery
- Startup performance
- Metadata loading
- User privacy

The external-media discovery process should be completely independent from the core movie details loading pipeline.

---

# 5. Section Design

Recommended section:

```text
Reviews & Explanations

Discover reviews, explanations, analysis and other
publicly available content about this title.

[ Search Reviews & Explanations ]
```

After clicking:

```text
Reviews & Explanations

[All] [Reviews] [Explanations] [Recaps] [Analysis]

------------------------------------------------

[Thumbnail]
Movie Ending Explained
YouTube
12:43
...

[Thumbnail]
Movie Review
YouTube
18:21
...

[Thumbnail]
Complete Story Breakdown
Dailymotion
25:10
...
```

---

# 6. Discovery Categories

The discovery system should classify results into useful categories.

Suggested categories:

### Reviews

Content focused primarily on reviewing the movie.

Examples:

- Movie reviews
- Critical reviews
- User reviews
- Rating discussions

### Explanations

Content explaining the movie or its ending.

Examples:

- Ending explained
- Movie explained
- Story explained
- Plot explained

### Recaps

Content summarizing the movie.

Examples:

- Movie recap
- Story recap
- Full story summary

### Analysis

More detailed discussions.

Examples:

- Movie analysis
- Character analysis
- Story analysis
- Hidden details
- Easter eggs
- Fan theories

### Interviews

Relevant interviews involving:

- Actors
- Directors
- Writers
- Producers

### Discussions

Public discussions and commentary about the movie.

---

# 7. Related Media

The section should not be restricted to videos.

Where supported and permitted, results may include:

```text
Videos
Articles
Reviews
Interviews
Analysis
Public discussions
```

Each result should clearly identify its source type.

Example:

```text
YouTube
Dailymotion
Article
Review
```

---

# 8. Search Query Generation

Search queries should be generated from canonical movie metadata rather than blindly using the provider title.

For example:

```text
Title:
The Dark Knight

Year:
2008

Search queries:
"The Dark Knight 2008 review"
"The Dark Knight 2008 ending explained"
"The Dark Knight 2008 movie explanation"
"The Dark Knight 2008 analysis"
"The Dark Knight 2008 recap"
```

For TV episodes, include:

```text
Series
Season
Episode
Episode title
```

Example:

```text
Breaking Bad
Season 5
Episode 14
Ozymandias
```

---

# 9. Title Normalization

Provider titles may contain additional information:

```text
The Dark Knight 2008 1080p BluRay Hindi
```

The discovery system should not use the entire provider title as the search query.

It should first resolve:

```text
Canonical title
Year
Season
Episode
Original title
```

and construct clean search queries.

---

# 10. Search Result Deduplication

The same video may appear through multiple search queries.

For example:

```text
Batman Review
Batman 2008 Review
The Dark Knight Review
The Dark Knight Movie Review
```

may all return the same video.

The system should deduplicate results using signals such as:

- Canonical URL
- Video ID
- Platform ID
- Normalized title
- Source
- Published date

---

# 11. Progressive Loading

Results should appear progressively rather than waiting for every provider to finish.

Example:

```text
Search started

YouTube
  ✓ 12 results

Dailymotion
  Searching...

Public resources
  Searching...
```

Results can be appended as they arrive.

The UI should not remain blocked while a slower source is being queried.

---

# 12. Loading State

Display a clear loading state:

```text
Searching for reviews and explanations...
```

Optionally show:

```text
Searching:
✓ YouTube
⟳ Dailymotion
⟳ Public resources
```

---

# 13. Cancellation

Because discovery may involve multiple external sources, provide a way to cancel the operation.

Example:

```text
Searching for related media...

[Cancel]
```

Cancellation should stop pending discovery where technically possible.

---

# 14. Result Card

Each media result should provide:

```text
Thumbnail
Title
Source
Content type
Duration
Published date
Creator/channel
```

Example:

```text
┌──────────────────────────────────┐
│                                  │
│          Thumbnail               │
│                                  │
├──────────────────────────────────┤
│ The Ending Explained             │
│ YouTube                          │
│ Explanation · 14:32              │
│ Channel Name · 2026              │
└──────────────────────────────────┘
```

---

# 15. Playback / Opening Behavior

When the user clicks a video:

```text
Related Media
      ↓
Select Video
      ↓
Open supported player / external source
```

The implementation should respect the source platform's playback restrictions.

If the content cannot be embedded:

```text
Open in Browser
```

should be provided instead of attempting to bypass the platform restriction.

---

# 16. External Resources

For articles and public review pages:

```text
Select Result
      ↓
Open resource
```

Depending on the source and existing application architecture, the application can:

- Open an internal web view
- Open an application browser
- Open the system browser

The behavior should be consistent with the existing application's web-resource handling.

---

# 17. YouTube Integration

YouTube should be treated as one of the primary sources for this feature.

Search should support queries such as:

```text
<title> review
<title> ending explained
<title> movie explained
<title> recap
<title> analysis
<title> easter eggs
```

The system should use canonical metadata whenever available.

---

# 18. Dailymotion Integration

Dailymotion can be treated as another supported video source.

The architecture should not hard-code the feature around YouTube.

Instead:

```text
RelatedMediaProvider
       |
       +-- YouTubeProvider
       +-- DailymotionProvider
       +-- PublicWebProvider
       +-- FutureProvider
```

This makes additional sources easier to add later.

---

# 19. Provider Isolation

Failure of one source must not prevent other sources from working.

For example:

```text
YouTube       → SUCCESS
Dailymotion   → FAILED
Public Web    → SUCCESS
```

should result in:

```text
Display YouTube results
Display Public Web results
Show Dailymotion failure only if useful
```

Do not fail the complete section because one provider is unavailable.

---

# 20. Search Provider Interface

Introduce a common interface:

```typescript
interface RelatedMediaProvider {
  id: string;
  name: string;

  search(request: RelatedMediaSearchRequest):
    Promise<RelatedMediaResult[]>;
}
```

Request:

```typescript
interface RelatedMediaSearchRequest {
  title: string;
  originalTitle?: string;
  year?: number;

  season?: number;
  episode?: number;

  type:
    | "review"
    | "explanation"
    | "recap"
    | "analysis"
    | "interview"
    | "discussion"
    | "all";
}
```

---

# 21. Unified Result Model

Normalize results from all sources into one model.

```typescript
interface RelatedMediaResult {
  id: string;

  title: string;
  description?: string;

  source: {
    provider: string;
    url: string;
    externalId?: string;
  };

  type:
    | "video"
    | "article"
    | "review"
    | "interview"
    | "discussion";

  category:
    | "review"
    | "explanation"
    | "recap"
    | "analysis"
    | "interview"
    | "discussion"
    | "other";

  thumbnailUrl?: string;

  durationSeconds?: number;
  publishedAt?: string;

  creator?: {
    name?: string;
    id?: string;
  };
}
```

---

# 22. Result Ranking

Results should be ranked based on relevance.

Potential signals:

```text
Exact title match
+
Year match
+
Season/episode match
+
Search category match
+
Creator/source quality
+
Publication date
+
Platform relevance
```

For example, when the user selects:

```text
Ending Explained
```

results containing:

```text
ending explained
movie explained
ending
story explained
```

should receive higher relevance.

---

# 23. Avoid Generic Results

Search results should not contain unrelated videos simply because they contain the same actor or a similar keyword.

For example:

```text
Actor Name Interview
```

should not automatically appear for every movie starring that actor.

The title/media relationship should remain the primary matching signal.

---

# 24. Related Media Cache

Because this is on-demand content, results can be cached after the user requests them.

Suggested structure:

```text
RelatedMediaCache
  |
  +-- mediaIdentity
  +-- searchType
  +-- provider
  +-- results[]
  +-- fetchedAt
  +-- expiresAt
```

This prevents repeated searches every time the user opens and closes the section.

---

# 25. Cache Strategy

Initial request:

```text
User clicks section
       ↓
Check cache
       ↓
Cached results available?
       ├── YES → Display immediately
       │          ↓
       │      Background refresh
       │
       └── NO → Fetch providers
```

The cache should not become a permanent source of stale external links.

Results should have an appropriate expiration time.

---

# 26. No Automatic Fetch on Details Page

This requirement is critical.

Opening:

```text
Movie Details
```

must not automatically trigger:

```text
YouTube search
Dailymotion search
Review search
Explanation search
```

Only explicit user interaction should initiate this operation.

This should also be reflected in the architecture so that accidental background calls cannot occur.

---

# 27. Privacy and Incognito

The feature must respect the existing Incognito architecture.

In Incognito mode:

- Related-media searches should not automatically become search history.
- External search queries should not be persisted as normal search history.
- Related-media browsing should not create watch history for the related content.
- Sensitive titles/URLs should not be unnecessarily written to diagnostics.
- Temporary discovery state may remain in memory for the session.

Explicit user actions should follow the application's existing privacy rules.

---

# 28. Adult Content Filtering

Related-media discovery must respect the application's 18+ content setting.

When 18+ content is disabled:

- Do not intentionally search for adult-related reviews or media.
- Filter adult results where classification is available.
- Do not expose adult resources through generic related-media results.
- Apply the same content filtering policy used elsewhere in the application.

---

# 29. Search Settings

Eventually provide settings for:

```text
Related Media

Enabled providers:
☑ YouTube
☑ Dailymotion
☑ Public Web

Categories:
☑ Reviews
☑ Explanations
☑ Recaps
☑ Analysis
☑ Interviews
☑ Discussions
```

However, these settings should not be required for the initial implementation.

---

# 30. Details Page Integration

Recommended structure:

```text
Movie Details

[Play]
[Download]
[Add to Library]

Description

Trailers
[Trailer 1] [Trailer 2] [Trailer 3]

Movies in This Series
[Movie 1] [Movie 2] [Movie 3]

Reviews & Explanations
[Search Reviews & Explanations]

More Like This
[Movie 1] [Movie 2] [Movie 3]

Cast
...
```

The section should follow the existing details-page design language.

---

# 31. Button Behavior

Before fetching:

```text
Reviews & Explanations

[Search Reviews & Explanations]
```

After fetching:

```text
Reviews & Explanations

[Refresh]
[Filters]

[Result]
[Result]
[Result]
...
```

If no results are found:

```text
No related reviews or explanations were found.
```

Provide:

```text
[Search Again]
```

rather than treating it as an application error.

---

# 32. Filters

Once results are available, provide lightweight filters:

```text
[All]
[Reviews]
[Explanations]
[Recaps]
[Analysis]
[Interviews]
```

Optional:

```text
[Videos]
[Articles]
```

The filters should operate on already fetched results where possible rather than triggering another network request.

---

# 33. Pagination / Load More

Do not load hundreds of results at once.

Initial result set:

```text
Top 10-20 relevant results
```

Then:

```text
Load More
```

or progressive pagination.

This keeps the details page responsive.

---

# 34. Search Across Multiple Sources

The system should search multiple providers concurrently:

```text
                    RelatedMediaService
                           |
          ┌────────────────┼────────────────┐
          ↓                ↓                ↓
       YouTube        Dailymotion       Public Web
          |                |                |
          └────────────────┼────────────────┘
                           ↓
                     Normalize
                           ↓
                     Deduplicate
                           ↓
                       Rank
                           ↓
                       Display
```

---

# 35. Source Attribution

Every result must clearly show its source.

Examples:

```text
YouTube
Dailymotion
Website Name
```

Do not present external content as though it was hosted by CS3.

---

# 36. External Platform Restrictions

The implementation must respect each platform's:

- API requirements
- Embedding restrictions
- Terms of service
- Rate limits
- Authentication requirements
- Copyright requirements

Do not implement scraping or playback bypasses that violate platform restrictions.

If embedding is not permitted:

```text
Open Source
```

should be used.

---

# 37. Search Query Privacy

Search queries should be generated carefully.

For example:

```text
"The Dark Knight 2008 ending explained"
```

should be sent only when the user explicitly requests related-media discovery.

The application should not send such queries during ordinary details-page loading.

---

# 38. Diagnostics

The system should log technical failures such as:

```text
Provider timeout
API failure
Invalid response
Rate limit
Malformed result
Deduplication failure
```

but should avoid unnecessarily logging:

- Full search URLs
- User queries
- Sensitive titles
- Authentication information

especially under Incognito.

---

# 39. Future Enhancement: Reviews

A future iteration could provide structured review information directly inside the details page:

```text
Reviews

IMDb: 8.2/10
TMDB: 8.1/10

[Read Reviews]
[Watch Review Videos]
```

This should remain separate from video/article discovery.

---

# 40. Future Enhancement: AI or Local Summaries

A later phase could allow the application to summarize publicly available reviews or explanation content.

This should not be part of the initial implementation.

The first objective is:

```text
Discover
→ List
→ Categorize
→ Open
```

not:

```text
Fetch everything
→ Analyze everything
→ Generate summaries
```

---

# 41. Acceptance Criteria

The feature is complete when:

- A new Reviews & Explanations section exists on the details page.
- The section does not fetch external data by default.
- User interaction explicitly triggers discovery.
- YouTube results can be discovered.
- Dailymotion results can be supported.
- Additional public sources can be added through a provider interface.
- Reviews can be categorized separately.
- Explanations can be categorized separately.
- Recaps and analysis can be categorized.
- Results are normalized into a common model.
- Duplicate results are removed.
- Results are ranked by relevance.
- Results load progressively.
- One provider failure does not break the entire section.
- Results can be opened using the appropriate playback/browser behavior.
- External source attribution is visible.
- Results are cached after an explicit user request.
- Cached results can be refreshed.
- The feature respects Incognito mode.
- The feature respects 18+ content filtering.
- The feature does not slow down normal details-page loading.
- API/platform restrictions are respected.

## Core Principle

```text
Normal Details Page
        ↓
No related-media network requests
        ↓
User explicitly clicks
"Reviews & Explanations"
        ↓
Fetch on demand
        ↓
Search multiple public sources
        ↓
Normalize
        ↓
Deduplicate
        ↓
Rank
        ↓
Display progressively
        ↓
User selects content
        ↓
Play / Open externally
```

The important distinction is that this should behave like an **on-demand discovery feature**, similar to the existing trailer listing concept, while remaining completely independent from the critical media playback and details-page loading pipeline.