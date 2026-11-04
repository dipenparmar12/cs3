# PRD-56: Unified Movie and TV Trailer Discovery, Search, and Playback

**Project:** CS3 Desktop  
**Feature:** Trailer, Teaser, Promotional Clip & Documentary Discovery Engine  
**Document Status:** Proposed (Open Work Register)  
**Document ID:** PRD-56  
**Creation Date:** November 2026  
**Priority:** High  
**Platform:** Windows-first desktop (`desktop`), with cross-platform desktop portability (macOS/Linux)  
**Compatibility:** Additive desktop capability. Strict zero-regression guarantee for existing search providers and Android `.cs3` extension ecosystem.

---

## 1. Executive Summary & Objective

Build a unified, high-performance trailer and promotional-video discovery feature that allows users to search, discover, preview, organize, and watch publicly available trailers, teasers, clips, featurettes, behind-the-scenes footage, and promotional documentaries for movies, TV series, and anime.

### 1.1 The Core Operating Principle: Chip-Gated Discovery vs. Standard Search

To preserve the absolute stability, performance, and predictability of CS3's core media scraping engine, **trailer and promotional metadata discovery is strictly chip-gated in the search interface**:

1. **Default Mode (No Trailer Chip Selected):**
   - Search operates **100% as it does today**.
   - Input queries are routed exclusively to existing CS3 scrapers, installed `.cs3` community extensions in the JVM sidecar, Cinemeta/TVmaze/AniList title autocomplete, and local library/history.
   - Zero trailer-specific API traffic, zero quota consumption, and zero latency overhead are introduced to standard movie/show search.
2. **Trailer & Promotional Mode (User selects the "Trailers" / "Trailers & Clips" chip on the search bar):**
   - The search bar switches into dedicated promotional discovery mode.
   - The search engine independently queries publicly available APIs and open video platforms (TMDB, YouTube, Dailymotion, IMDb public feeds, Vimeo, Wikidata, AniList).
   - Any query typed by the user—whether a full title (`Spider-Man: No Way Home`), a partial prefix (`Spider`, `spi`), a phonetic spelling or typo (`an hull` for The Incredible Hulk), a long multi-word query (even a 1000-word descriptive plot/character query), or general promotional keywords (`upcoming anime trailers 2026`, `Christopher Nolan behind the scenes`)—initiates an independent search for relevant promotional videos, teasers, clips, featurettes, documentaries, and interviews.
3. **Detail Page Integration (Title-Specific Promotional Media):**
   - When a user opens any movie or TV series detail page, a dedicated "Trailers & Promotional Media" section displays all curated promotional videos associated with that canonical title, organized by category (Official Trailers, Teasers, Clips, Featurettes, Behind-the-Scenes).

---

## 2. Existing CS3 Architecture & Codebase Reuse

Before adding new systems, we audit and extend the existing foundation documented in `AGENTS.md` and live in the codebase:

| Module / Component | Existing Responsibility | Planned Extension in PRD-56 |
|---|---|---|
| `desktop/src/components/Navbar.tsx` | Search bar input, query submission, clear button, scope badge, `.torrent` attachment | Add the persistent `Trailers` category chip toggle inside the search input bar. When active, placeholder and submit route to trailer discovery. |
| `desktop/src/utils/searchCategories.ts` | Definition of `SEARCH_CATEGORIES` (`title`, `cast`, `director`, `writer`, `producer`, `composer`, `studio`) | Add `trailer` (`Trailers & Clips`) category definition, scope serialization, and filter predicates (`wantsTrailers(categories)`). |
| `desktop/src/components/SearchSuggestions.tsx` | Dropdown panel below search input rendering category chips, history, and autocomplete | Display the `Trailers` chip in the suggestion header. Offer trailer-specific autocomplete suggestions when trailer mode is active. |
| `desktop/electron/metadata/videoTitles.ts` | Regex & heuristic classification of video titles (`kind`, `label`, `season`, `ordinal`, official publisher detection) | Expand classification grammar to recognize promotional documentaries, TV spots, casting tapes, and international dub trailers. |
| `desktop/electron/metadata/youtube.ts` | Keyless YouTube oEmbed metadata lookup (`title`, `author_name`, `thumbnail_url`) for known video IDs | Retain for fast, zero-quota validation of discovered YouTube video IDs; implement Dailymotion and Vimeo oEmbed equivalents. |
| `desktop/src/components/detail/TrailerGallery.tsx` | Detail page promotional video gallery | Unify data contract with global trailer search results, supporting multi-category tabs and pagination. |
| `desktop/src/components/detail/TrailerPopup.tsx` | In-app trailer playback modal | Refactor from raw stream extraction to official embedded players (YouTube IFrame API, Dailymotion embed) and isolated webview/browser fallbacks to ensure platform compliance. |
| `desktop/electron/searchSession.ts` | Coalesced streaming search orchestrator for extensions | Provide a parallel, non-blocking `TrailerSearchSession` that streams progressive video results without mutating the core provider search session. |

---

## 3. User Experience & Interface Specifications

### 3.1 Search Bar Chip Integration

The primary entry point for trailer discovery is a dedicated chip on the universal search bar.

```text
+-------------------------------------------------------------------------------------------------------+
|  [🔍] [ Search movies, series, trailers, or paste link...     ]  [🎬 Trailers ✕]  [✕]  [ Attach ] [Search]|
+-------------------------------------------------------------------------------------------------------+
|  Suggestion Dropdown (when focused):                                                                  |
|  [ All ] [ Titles ] [🎬 Trailers & Clips ] [ Cast ] [ Director ] [ Writer ] [ Studio ]                |
|  --------------------------------------------------------------------------------------------------- |
|  Recent Searches:                                                                                     |
|  🕒 Spider-Man: Across the Spider-Verse (Trailer)                                                     |
|  🕒 Dune Part Two final trailer                                                                       |
+-------------------------------------------------------------------------------------------------------+
```

#### Behavior & Interaction Rules:
1. **Unselected State (Default):**
   - The chip is dormant. The search bar functions exactly as it does today.
   - Submitting a query executes standard multi-provider scraping across active extension source lists.
2. **Selecting the Chip:**
   - The user clicks `[🎬 Trailers]` either directly inside the search input bar or from the category row in `SearchSuggestions.tsx`.
   - The search input receives a visual pill/badge indicator: `[🎬 Trailers ✕]`.
   - The placeholder dynamically adapts: `"Search trailers, teasers, clips, or enter any title/keyword..."`.
   - The selection persists for the search session or until cleared with `✕` or `Esc`.
3. **Submitting in Trailer Mode:**
   - Pressing Enter or clicking `Search` bypasses standard scraper streams and triggers the **Trailer Discovery Engine**.
   - Navigation routes to the Dedicated Trailer Search View (`SearchView` in trailer mode or a dedicated `TrailerDiscoveryView`).

### 3.2 Tolerant & Deep Query Processing

Users often recall trailers by loose descriptions, actor names, misremembered words, or foreign transliterations. The trailer search parser supports:

| Query Type | Example Query | Search Engine Action |
|---|---|---|
| **Exact Title** | `Spider-Man: No Way Home` | Resolves canonical work ID via TMDB/Wikidata, fetches all official trailers, teasers, TV spots, and clips. |
| **Partial Title** | `Spiderman` or `spi` | Performs prefix autocomplete, suggests matched franchise titles, and returns mixed top trailers for the franchise. |
| **Phonetic / Typo** | `an hull` or `hulk 2008` | Levenshtein/trigram fuzzy match identifies "The Incredible Hulk", retrieves official trailers and clips. |
| **Long Multi-Word / 1000-Word** | `movie where guy gets stuck in black hole near saturn with robot tarc` | Tokenizes salient entities (`black hole`, `saturn`, `robot`), identifies *Interstellar*, and retrieves its official trailers and BTS documentaries. |
| **Person + Category** | `Christopher Nolan behind the scenes` | Detects director entity via Wikidata/filmography, aggregates BTS featurettes and documentaries across his films. |
| **Category Specific** | `Stranger Things season 5 teaser` | Resolves TV series + season 5 context, queries season-specific teaser endpoints and official Netflix uploads. |
| **Generic Topic** | `upcoming anime trailers 2026` | Queries public video platform APIs for recent anime trailers published by verified distributor channels within the specified year window. |

### 3.3 Dedicated Trailer Search Results View

When trailer mode is active, the search view transitions into a responsive, virtualized media grid optimized for video cards:

```text
=========================================================================================================
 TRAILERS & PROMOTIONAL MEDIA
 Query: "Spider-Man"  [ Filter: All Videos ▼ ] [ Source: All Platforms ▼ ] [ Sort: Relevance ▼ ]
 -------------------------------------------------------------------------------------------------------
 [All (24)]  [Official Trailers (6)]  [Teasers (4)]  [Clips (8)]  [Featurettes & BTS (4)]  [Documentaries (2)]
 -------------------------------------------------------------------------------------------------------
 +-----------------------+  +-----------------------+  +-----------------------+  +-----------------------+
 | [   THUMBNAIL 16:9  ] |  | [   THUMBNAIL 16:9  ] |  | [   THUMBNAIL 16:9  ] |  | [   THUMBNAIL 16:9  ] |
 | 02:45                 |  | 01:30                 |  | 03:15                 |  | 14:20                 |
 +-----------------------+  +-----------------------+  +-----------------------+  +-----------------------+
  Spider-Man: No Way Home     Spider-Man: Across Spider   Spider-Man (2002)           Spider-Man: The Making
  Official Trailer 3          Official Teaser             Teaser Trailer (Restored)   Behind the Scenes Promo
  Sony Pictures · YouTube     Sony Animation · YouTube    Sony Pictures · Dailymotion Marvel Studios · YouTube
  [✓ Verified Official]       [✓ Verified Official]       [Community Archive]         [✓ Verified Official]
  [▶ Play] [💾 Save] [ℹ Title] [▶ Play] [💾 Save] [ℹ Title] [▶ Play] [💾 Save] [ℹ Title] [▶ Play] [💾 Save] [ℹ Title]
=========================================================================================================
```

#### Video Card Information Hierarchy:
1. **16:9 High-Resolution Thumbnail** with duration overlay badge (`02:45`).
2. **Canonical Title Association:** The movie/series name linked to the full detail page.
3. **Promotional Asset Title:** Standardized and cleaned (`Official Trailer`, `Teaser 2`, `Sneak Peek Clip`).
4. **Publisher & Platform Badge:** E.g., `Sony Pictures Entertainment • YouTube`, `Warner Bros. • Dailymotion`.
5. **Verification Pill:**
   - `[✓ Official]`: Confirmed studio/network upload.
   - `[Likely Official]`: High confidence uploader matching studio name.
   - `[Community]`: High-quality fan archive or re-upload.
6. **Card Action Buttons:**
   - **Play (▶):** Opens the in-app embedded player modal immediately.
   - **Save (💾):** Adds the trailer to the user's "Watch Later" or "Saved Trailers" collection.
   - **Open Title (ℹ):** Navigates directly to the movie or TV show detail page in CS3.
   - **Copy Link (🔗):** Copies the original public URL to clipboard.

### 3.4 Detail Page Integration ("Trailers & Promotional Media")

Every movie, TV series, and anime detail page features an integrated section:
- Automatically groups discovered promotional media into tabs: `Trailers`, `Teasers`, `Clips`, `Behind the Scenes`, `Soundtracks & Openings`.
- Displays season pills for TV series (`Series Overview`, `Season 1`, `Season 2`, `Season 3`).
- Instant cache load: if the title's promotional videos were fetched previously, they render within 10ms without triggering network requests.
- Subtle non-destructive background revalidation checks for new or removed trailers.

---

## 4. Multi-Source Public Discovery Architecture

Because no single public platform has complete coverage of trailers, teasers, TV spots, and foreign promotional clips, discovery uses a federated, multi-source ingestion pipeline.

```mermaid
flowchart TD
    UserQuery["User Query + Trailer Chip Active"] --> QueryParser["Tolerant Query Parser & Entity Classifier"]
    
    QueryParser --> WorkResolution{"Is Query a Resolvable Work?"}
    
    WorkResolution -->|Yes (e.g. Spider-Man)| StageA["Stage A: Canonical Work Resolution (TMDB, IMDb, Wikidata, AniList)"]
    StageA --> StageB["Stage B: Associated Video Endpoints (TMDB Videos, Dailymotion API, YouTube oEmbed)"]
    
    WorkResolution -->|No (e.g. general keywords)| IndependentSearch["Independent Video Platform Search (YouTube Data API, Dailymotion, Vimeo)"]
    
    StageB --> Ingestion["Normalization & Deduplication Engine"]
    IndependentSearch --> Ingestion
    
    Ingestion --> Classifier["Title & Official Publisher Classifier (videoTitles.ts)"]
    Classifier --> QualityRanker["Quality, Relevance & Language Ranker"]
    QualityRanker --> StreamEmitter["Push Results to UI via IPC (Progressive Stream)"]
```

### 4.1 Supported Public Data Sources & API Protocols

#### 1. TMDB API (The Movie Database)
- **Role:** Primary canonical authority for title-to-video relationships.
- **Endpoints:**
  - `GET /3/movie/{id}/videos`
  - `GET /3/tv/{id}/videos`
  - `GET /3/tv/{id}/season/{season_number}/videos`
- **Provided Data:** Video key, site (`YouTube`, `Vimeo`), video type (`Trailer`, `Teaser`, `Clip`, `Featurette`, `Behind the Scenes`, `Bloopers`), official boolean flag, publication timestamp, ISO-639-1 language code.
- **Usage Strategy:** When the user supplies a personal API key (`home_tmdb_api_key`), full direct API access is utilized. If no key is set, public keyless mirrors and open metadata integrations provide base video mappings.

#### 2. YouTube (Data API v3 & Public oEmbed)
- **Role:** Largest global repository of studio trailers, teasers, clips, and promotional documentaries.
- **Discovery Channels:**
  - **Selective Search:** Used sparingly for independent keyword searches with embeddability filter (`videoEmbeddable=true`, `type=video`).
  - **Keyless oEmbed Validation (`https://www.youtube.com/oembed`):** Used without an API key to validate video title, author/channel, and thumbnail within ~190ms without quota cost.
- **Quota Protection:** Cached per query for 7 days; debounced by 400ms; never fired per-keystroke.

#### 3. Dailymotion Open Graph & Public API
- **Role:** Important fallback and archive source for international trailers, regional teasers, and restored classic film trailers often blocked on other networks.
- **Endpoints:**
  - `GET https://api.dailymotion.com/videos?search={query}&fields=id,title,channel,owner,thumbnail_720_url,duration,created_time`
  - `GET https://api.dailymotion.com/video/{id}?fields=embed_url,title,owner.screenname`
- **Advantage:** Keyless, generous rate limits, native embedded iframe player support.

#### 4. IMDb Public Metadata Datasets & Open Feeds
- **Role:** Canonical entity matching, cross-referencing IMDb IDs (`tt1087260`) to video clips, trailer identifiers, and production companies.

#### 5. Vimeo Public API & oEmbed
- **Role:** High-bitrate indie film trailers, animation shorts, festival teasers, and high-quality cinematographic promotional featurettes.
- **Integration:** Keyless oEmbed endpoint (`https://vimeo.com/api/oembed.json?url=...`).

#### 6. AniList GraphQL API
- **Role:** Dedicated Japanese anime promotional videos (PVs), character teasers, and opening/ending credit sequences.
- **Query:** Public GraphQL endpoint retrieving official YouTube/bilibili trailer keys linked to MAL/AniList entries.

---

## 5. Video Classification, Identity Matching, and Ranking

### 5.1 Normalized Promotional Video Model

All sources are parsed into a single, standardized TypeScript interface:

```typescript
export type PromotionalVideoType =
  | 'trailer'
  | 'teaser'
  | 'final-trailer'
  | 'international-trailer'
  | 'tv-spot'
  | 'clip'
  | 'featurette'
  | 'behind-the-scenes'
  | 'documentary'
  | 'interview'
  | 'opening-credits'
  | 'other';

export type OfficialVerificationStatus =
  | 'verified-official'
  | 'likely-official'
  | 'community-upload'
  | 'unverified';

export type WorkMatchConfidence =
  | 'exact-match'
  | 'franchise-match'
  | 'probable-match'
  | 'unverified';

export interface PromotionalVideo {
  id: string;                         // Unique composite ID: `${platform}:${platformVideoId}`
  platform: 'youtube' | 'dailymotion' | 'vimeo' | 'peertube' | 'direct';
  platformVideoId: string;
  
  title: string;                      // Cleaned promotional title (e.g. "Official Trailer 2")
  originalRawTitle: string;           // Raw uploader title
  description?: string;
  thumbnailUrl: string;
  playbackUrl: string;                // Canonical watch URL
  embedUrl: string;                   // Compliant embed URL for iframe
  
  durationSeconds?: number;
  publishedAt?: string;               // ISO 8601 string
  language?: string;                  // ISO 639-1 code
  
  videoType: PromotionalVideoType;
  officialStatus: OfficialVerificationStatus;
  matchConfidence: WorkMatchConfidence;
  
  // Associated Canonical Work
  work?: {
    title: string;
    year?: number;
    mediaType: 'movie' | 'tv' | 'anime';
    tmdbId?: number;
    imdbId?: string;
  };
  
  // Publishing Channel / Studio
  channel?: {
    id?: string;
    name: string;
    verified: boolean;
  };
  
  sourceMetadata: {
    origin: string;                   // 'tmdb' | 'youtube' | 'dailymotion' | 'cinemeta' | 'anilist'
    retrievedAt: number;
  };
}
```

### 5.2 Heuristic Classifier Extensions (`videoTitles.ts`)

`videoTitles.ts` is expanded to distinguish nuanced promotional formats:
- **Promotional Documentaries & Making-Of:** Patterns matching `making of`, `the making of`, `retrospective documentary`, `production diary`, `behind the camera`.
- **TV Spots:** Short 15s/30s promotional clips matching `tv spot`, `commercial spot`, `promo spot \d+`.
- **Final & Legacy Trailers:** Matching `final trailer`, `main trailer`, `official trailer \d+`, `restored trailer`.
- **Fan Edit / Concept Filter:** Automatically flags and demotes videos containing `concept trailer`, `fan made`, `reaction`, `deepfake`, `parody`, `pitch meeting`.

### 5.3 Multi-Signal Ranking Algorithm

Results in the trailer discovery view are ranked using an 8-factor scoring matrix:

$$\text{Score} = w_1 S_{\text{match}} + w_2 S_{\text{official}} + w_3 S_{\text{type}} + w_4 S_{\text{lang}} + w_5 S_{\text{recency}} + w_6 S_{\text{embed}} + w_7 S_{\text{duration}} - P_{\text{fanmade}}$$

1. **Work Match ($S_{\text{match}}$):** Exact title + release year match = 100 points; franchise match = 70 points.
2. **Official Status ($S_{\text{official}}$):** Verified studio channel (Sony, Warner, Marvel, Netflix) = 80 points; likely official = 40 points; community upload = 10 points.
3. **Category Priority ($S_{\text{type}}$):**
   - Official Trailers: 50 pts
   - Teasers: 40 pts
   - TV Spots / Clips: 30 pts
   - BTS / Documentaries: 25 pts
   - Interviews / Other: 15 pts
4. **Language Alignment ($S_{\text{lang}}$):** Matches user preferred audio/subtitle language setting = 30 points.
5. **Embeddability ($S_{\text{embed}}$):** Verified embeddable in Electron without restriction = 20 points.
6. **Fan-Made Penalty ($P_{\text{fanmade}}$):** Unverified community upload titled "trailer" for an unreleased film = -150 points (preventing fake trailers from topping real searches).

---

## 6. Compliant In-App Playback Architecture

### 6.1 Platform Policy Compliance & Player Coexistence

A core requirement is ensuring zero circumvention of platform terms while delivering a seamless desktop experience:

1. **Embedded Player Standards:**
   - **YouTube:** Loaded via official YouTube IFrame Player API inside a sandboxed, isolated web context. YouTube controls, branding, and required legal links are strictly preserved.
   - **Dailymotion / Vimeo:** Embedded using their official responsive iframe players.
   - **No Stream Extraction or Scraping:** No raw `.mp4`/`.m3u8` video stream scraping or unauthorized downloading of third-party platform videos.
2. **Strict Player Isolation (Coexistence Guarantee):**
   - Trailer playback runs inside a dedicated `TrailerPlayerModal` or floating PiP mini-player.
   - **Never interrupts main media:** If the user is streaming a movie or series in the main CS3 player, opening a trailer will pause (or duck) the main audio, but will **never unmount, destroy, or reset** the active streaming session or its playback buffer.
   - **No Watch History Contamination:** Watching a 2-minute teaser is never recorded as an episode completion or resume-point update for the full movie.
3. **External Browser Fallback:**
   - If an uploader disables third-party iframe embedding (`error 150` on YouTube), the player immediately displays a graceful notice: `"This video requires playback directly on YouTube"` with a one-click button: `"Open in Browser ↗"` (opens in OS default browser via Electron `shell.openExternal`).

### 6.2 Trailer Mini-Player (Picture-in-Picture Mode)

Users can minimize the trailer modal into a bottom-right floating dock (`TrailerMiniPlayer`), allowing them to continue exploring titles, searching catalogues, or modifying settings while the promotional video continues playing.

---

## 7. Caching, Quota Management, and Rate Limiting

To ensure the desktop app never hits public API quota limits or gets IP-banned:

```mermaid
graph LR
    Req[Trailer Query] --> L1{L1: Memory Cache}
    L1 -->|Hit (<5ms)| Ret[Return Cached Trailers]
    L1 -->|Miss| L2{L2: Persistent Disk Cache}
    L2 -->|Hit (<20ms)| Ret
    L2 -->|Miss| Throttle[Rate Limiter & In-Flight Coalescing]
    Throttle --> API[Public APIs / oEmbed]
    API --> Save[Write L1 + L2 Cache with TTL]
    Save --> Ret
```

### 7.1 Cache Invalidation Policies

| Cache Layer | Key Structure | Expiry (TTL) | Eviction Rule |
|---|---|---|---|
| **Canonical Work Cache** | `work:${normalizedQuery}:${type}` | 14 days | LRU (max 10,000 entries) |
| **Title Videos Cache** | `videos:${platform}:${workId}` | 7 days | Stale-while-revalidate |
| **oEmbed Details Cache** | `oembed:${platform}:${videoId}` | 30 days | Immutable unless 404 |
| **Channel Identity Registry** | `channel:${platform}:${channelId}` | 60 days | Periodic background sync |
| **Search Query Stream Cache**| `query:${normalizedQuery}:${chip}` | 24 hours | LRU (max 1,000 queries) |

### 7.2 Safety & Pacing Guards
- **Debounce:** Search inputs while trailer chip is active are debounced by 350ms before initiating remote metadata calls.
- **Request Coalescing:** If two components request promotional videos for the same TMDB ID simultaneously, only one network request is dispatched; both components subscribe to the same promise.
- **Circuit Breaker:** If a provider returns HTTP 429 (Too Many Requests), that source is cooled down automatically for 60 seconds without failing other discovery sources.

---

## 8. Saved Trailers & Personal Collection

Users can bookmark trailers to watch later without leaving CS3:
1. **"Watch Later" Bookmark:** One-click save on any trailer card.
2. **Library Destination Integration:** A dedicated tab inside CS3 Library: `Library -> Trailers & Promos`.
3. **Offline Metadata Persistence:** Video title, thumbnail, channel, and platform link are stored in the user's local SQLite / leveldb profile database.
4. **Playback from Saved:** Replays seamlessly using the embedded player or links to the associated film.

---

## 9. Implementation Phases & Milestones

### Phase 0: Architecture Inspection & Contract Audit (Week 1)
- [ ] Verify `videoTitles.ts` classification rules and write baseline test assertions for new promotional categories (Documentary, TV Spot, Final Trailer).
- [ ] Audit `desktop/src/components/Navbar.tsx` and `searchCategories.ts` to design zero-cost category chip injection.
- [ ] Inspect existing `TrailerGallery.tsx` and `TrailerPopup.tsx` to document migration path to official embedded players.
- [ ] Verify that unselected search chip preserves 100% existing provider execution paths without latency change.

### Phase 1: Search Bar Chip & Category Routing (Week 2)
- [ ] Add `trailer` chip to `SEARCH_CATEGORIES` in `desktop/src/utils/searchCategories.ts`.
- [ ] Update `Navbar.tsx` search input to display the active `[🎬 Trailers ✕]` pill when selected.
- [ ] Implement conditional search dispatcher:
  - If `wantsTrailers(categories) === false`: Invoke standard `SearchSession`.
  - If `wantsTrailers(categories) === true`: Invoke `TrailerSearchSession`.
- [ ] Unit tests for chip selection, deselection, category serialization, and placeholder toggling.

### Phase 2: Federated Discovery Engine & Work Resolver (Week 3)
- [ ] Implement `electron/metadata/trailerDiscovery.ts` combining TMDB video resolver, Dailymotion public search, and YouTube oEmbed validation.
- [ ] Build multi-word and typo-tolerant entity resolver using existing Wikidata / Cinemeta foundations.
- [ ] Implement streaming IPC channel `trailer:search` returning progressive results (`chunk`, `complete`, `error`).
- [ ] Add caching layer for trailer queries, oEmbed records, and resolved canonical titles.

### Phase 3: Dedicated Trailer Search View & UI Components (Week 4)
- [ ] Implement responsive video grid in `desktop/src/views/TrailerSearchView.tsx` (virtualized for 200+ cards).
- [ ] Create `TrailerCard.tsx` featuring 16:9 thumbnail, duration badge, publisher, verification status pill, and action menu.
- [ ] Implement category filter pills (`All`, `Official Trailers`, `Teasers`, `Clips`, `BTS & Documentaries`).
- [ ] Implement progressive loading indicator and stable deduplication during streaming ingestion.

### Phase 4: Embedded Trailer Player & Coexistence Engine (Week 5)
- [ ] Build `desktop/src/components/player/EmbeddedTrailerPlayer.tsx` supporting YouTube IFrame Player API and Dailymotion embed.
- [ ] Implement external browser fallback for restricted or non-embeddable videos.
- [ ] Implement Picture-in-Picture mini-player mode allowing playback while browsing titles.
- [ ] Validate non-interference: verify that playing a trailer does not affect active main player streams or update watch history.

### Phase 5: Detail Page Gallery Enhancement & Library Bookmarks (Week 6)
- [ ] Upgrade `TrailerGallery.tsx` on movie/series detail pages to consume the unified promotional model.
- [ ] Add TV series season filter tabs for season-specific promos and trailers.
- [ ] Implement "Save Trailer" / "Watch Later" bookmarking persisted in user profile.
- [ ] Add "Trailers" collection view in `desktop/src/views/LibraryView.tsx`.

### Phase 6: Edge-Case Hardening, Quota Testing & Documentation (Week 7)
- [ ] Verify test corpus across 50 titles (exact titles, typos, franchises, foreign titles, anime PVs).
- [ ] Test HTTP 429 rate limit recovery, network disconnection, and deleted video handling.
- [ ] Verify zero regressions on standard provider search (`bun run test --fast`).
- [ ] Document final architecture in `docs/agents/` and update `ROADMAP.md`.

---

## 10. Test Strategy & Acceptance Matrix

### 10.1 Unit Tests (Pure Logic, `node:assert/strict`)
- **Query Parser & Chip Detection:** Test that empty category or `['title']` never invokes trailer endpoints; test that `['trailer']` correctly routes to trailer search.
- **Classification (`videoTitles.test.mts`):** 40+ synthetic and real title strings validating correct classification of `trailer`, `teaser`, `clip`, `documentary`, `tv-spot`.
- **Deduplication:** Verify that identical video IDs returned from multiple sources (e.g. TMDB and YouTube search) are merged into one card.
- **Ranking:** Verify that verified official trailers always sort ahead of fan-made concept trailers.

### 10.2 Integration & E2E Validation
- **Search Typo Handling:** Searching `"an hull"` with trailer chip active must successfully discover *The Incredible Hulk* (2008) official trailers.
- **Long Query Handling:** Searching a 50-word plot synopsis must resolve the underlying movie and display its trailers.
- **Platform Embeddability:** Playing an embeddable YouTube trailer plays within 1.5s in the modal; restricted trailer displays the "Open in Browser" button cleanly.
- **Player Coexistence:** Starting a movie stream, then opening and closing a trailer modal, leaves the movie playing with zero buffer eviction.

---

## 11. Acceptance Criteria Checklist

- [ ] **Chip-Gated Isolation:** When the trailer chip is unselected, search executes standard CS3 scrapers with zero behavior or performance difference from today.
- [ ] **Dedicated Trailer Search:** Selecting `[🎬 Trailers]` on the search bar allows freeform title/keyword/partial search and displays promotional video results.
- [ ] **Broad Keyword Support:** Searches for partial words (`Spider`), typos (`an hull`), multi-word queries, and genres successfully return relevant trailers.
- [ ] **Multi-Source Ingestion:** Results are aggregated from publicly available APIs (TMDB, YouTube, Dailymotion, Vimeo, AniList).
- [ ] **Rich Category Tagging:** Videos are accurately categorized as Trailer, Teaser, TV Spot, Clip, BTS, Documentary, or Interview.
- [ ] **Verified vs. Community Labels:** Clear visual distinction between verified studio uploads and community archives.
- [ ] **In-App Playback:** Supported trailers play directly in CS3 using compliant embedded players without unauthorized stream extraction.
- [ ] **Main Player Non-Interference:** Playing a trailer never interrupts or corrupts active movie/series streaming sessions or history.
- [ ] **Detail Page Integration:** Movie and TV detail pages present a rich, categorized promotional video section.
- [ ] **Trailer Bookmarks:** Users can save trailers to their library for later viewing.
- [ ] **Android Extension Compatibility:** Full zero-regression compliance; zero breaking changes to JVM sidecar or Android plugin shims.
