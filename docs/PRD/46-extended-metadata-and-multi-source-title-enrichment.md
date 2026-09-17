# PRD-46 — Extended Metadata & Multi-Source Title Enrichment Architecture

> **Document ID**: `PRD-46-EXTENDED-METADATA-ENRICHMENT`  
> **Status**: Active / Implemented  
> **Scope**: CloudStream 3 Desktop Application (`cs3_windows`)  
> **Source Files**: `electron/metadata/enrichmentService.ts`, `merge.ts`, `anilist.ts`, `tvmaze.ts`, `wikidata.ts`, `wikipedia.ts`, `cinemetaExtras.ts`, `src/utils/metadataDisplay.ts`  
> **Test Suites**: `electron/metadata/merge.test.mts` (34 cases), `electron/metadata/sources.test.mts` (39 cases), `src/utils/metadataDisplay.test.mts` (19 cases), `tools/e2e/metadata-e2e.mjs`  
> **Date**: 2026-09-17  

---

## 1. Executive Summary

Community `.cs3` providers scrape streaming websites and return minimal title metadata — typically an unstandardized title, a low-resolution thumbnail, and a one-sentence blurb. On a desktop media experience, this produces sparse detail pages lacking cast, crew, voice actors, studio info, ratings, and production context.

The **Extended Metadata & Title Enrichment Subsystem** (`electron/metadata/`) operates as an independent background service that enriches titles using five complementary authoritative metadata sources: **AniList**, **TVMaze**, **Wikidata**, **Wikipedia**, and **Cinemeta**. 

Crucially, metadata enrichment is **push-based and non-blocking**: playback never waits for enrichment, and the detail view updates progressively via `metadata:extendedUpdate` as each source responds.

```text
                                  User Opens Title Detail Page
                                                │
                                                ▼
                          +───────────────────────────────────────────+
                          |   Immediate Render: Basic Scraped Info    |
                          |   (Title, Scraped Poster, Episode List)   |
                          +───────────────────────────────────────────+
                                                │
                                                ▼
+───────────────────────────────────────────────────────────────────────────────────────────────────+
|                                    EnrichmentService (electron/metadata/)                         |
|                                                                                                   |
|  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  ┌─────┐  |
|  │     AniList      │  │      TVMaze      │  │     Wikidata     │  │    Wikipedia     │  │Cine-│  |
|  │ (GraphQL API)    │  │   (REST API)     │  │   (SPARQL API)   │  │    (REST API)    │  │meta │  |
|  │ Romaji/Native,   │  │ TV Cast, Crew,   │  │ IMDb/TMDB Cross- │  │ Production Notes,│  │Extra│  |
|  │ Voice Actors,    │  │ Episode Air Dates│  │ links, Commons   │  │ History, License │  │Cast/│  |
|  │ Studios, Airing  │  │ & Characters     │  │ Photos, Crew     │  │ Attribution      │  │Crew │  |
|  └────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘  └──┬──┘  |
+───────────┼─────────────────────┼─────────────────────┼─────────────────────┼───────────────┼─────+
            └─────────────────────┴──────────┬──────────┴─────────────────────┴───────────────┘
                                             │
                                             ▼
                          +───────────────────────────────────────────+
                          |           Merge Engine (merge.ts)         |
                          |  Confidence ranking, conflict resolution, |
                          |  job classification, image sanitization   |
                          +───────────────────────────────────────────+
                                             │
                                             ▼
                          +───────────────────────────────────────────+
                          |       Push Event: metadata:extendedUpdate  |
                          |    Progressively renders CastList, Crew,  |
                          |      Studios, High-Res Backdrop, Trivia   |
                          +───────────────────────────────────────────+
```

---

## 2. Metadata Sources & Capabilities

### 2.1 AniList (`electron/metadata/anilist.ts`)
* **Target**: Anime series, movies, and OVAs.
* **Transport**: GraphQL POST over HTTPS to `https://graphql.anilist.co`.
* **Extracted Entities**:
  * Romaji, English, and Native titles, plus title synonyms.
  * Characters mapped to voice actors (Seiyuu) across languages (Japanese, English, Spanish, German, French, etc.) with character role tiers (`MAIN` vs `SUPPORTING`).
  * Animation studios and production organizations.
  * Status (`RELEASING`, `FINISHED`, `NOT_YET_RELEASED`, `CANCELLED`), episode counts, formats (`TV`, `MOVIE`, `OVA`), genres, and user ratings.
  * High-resolution banner artwork and cover images.
  * HTML description sanitized into clean plain text via regex parser.
* **Fuzzy Title Matcher (`searchAniListId`)**:
  * For titles lacking AniList IDs, queries AniList by title and verifies matching using string similarity (`titleSimilarity >= 0.86`) and release year tolerance ($\pm 1$ year).

### 2.2 TVMaze (`electron/metadata/tvmaze.ts`)
* **Target**: Western and international television series.
* **Transport**: HTTP GET REST queries to `https://api.tvmaze.com/shows/{id}` and `/search/shows?q=`.
* **Extracted Entities**:
  * Verified cast list with actor names, character names, headshots, and billing order.
  * Crew members classified by site-declared job descriptions.
  * Season and episode lists with official air dates and episode synopses.

### 2.3 Wikidata (`electron/metadata/wikidata.ts`)
* **Target**: Global movies and television shows keyed by IMDb ID (`tt\d+`).
* **Transport**: SPARQL queries to `https://query.wikidata.org/sparql`.
* **Extracted Entities**:
  * Cross-reference entity IDs: links IMDb ID directly to TMDB ID, TVDb ID, AniList ID, and Rotten Tomatoes.
  * Wikimedia Commons actor and director images fetched at specified thumbnail widths (e.g. 300px) over HTTPS.
  * Crew mapping for directors (`P57`), screenwriters (`P58`), producers (`P162`), directors of photography (`P344`), and composers (`P86`).
  * Production companies, distributors, and Wikipedia article sitelinks.

### 2.4 Wikipedia (`electron/metadata/wikipedia.ts`)
* **Target**: Production history, cultural impact, and critical background.
* **Transport**: MediaWiki REST API querying article extracts via sitelinks discovered through Wikidata.
* **Extracted Entities**:
  * Curated production notes, casting notes, and development history.
  * Strictly excludes spoiler-heavy plot summaries.
  * Sentence boundary budgeting: limits text to readable excerpt lengths without breaking mid-sentence.
  * Mandatory CC BY-SA 4.0 license attribution linking directly to the specific Wikipedia article section.

### 2.5 Cinemeta Extras (`electron/metadata/cinemetaExtras.ts`)
* **Target**: Stremio Cinemeta catalog titles.
* **Extracted Entities**: Supplementary IMDb cast and crew records, genre classifications, and release date records.

---

## 3. The Merge Engine (`electron/metadata/merge.ts`)

Conflicting or overlapping metadata from multiple sources is resolved by a deterministic, tested merge module:

1. **Conflict Resolution Strategy**:
   * **Anime Titles**: AniList takes precedence for Japanese titles, native character names, voice actors, and studios.
   * **Television Titles**: TVMaze takes precedence for cast order, character pairings, and air dates.
   * **Feature Films**: Wikidata and Cinemeta take precedence for directors, screenwriters, and box office trivia.
2. **Job Department Classification (`classifyJob`)**:
   Standardizes hundreds of arbitrary role strings into 10 canonical film production departments:
   * `Directing`, `Writing`, `Production`, `Camera`, `Art`, `Sound`, `Editing`, `Visual Effects`, `Costume & Make-Up`, and `Crew`.
3. **Artwork Normalization**:
   * Ensures all image URLs use HTTPS.
   * Transforms Wikimedia Commons file titles into direct CDN links (`Special:FilePath/{filename}?width=400`).
4. **Deduplication**:
   * Cast and crew members appearing across multiple sources are deduplicated by name and role without creating redundant entries.

---

## 4. IPC Architecture & Reactive Push Updates

Extended metadata retrieval is designed to prevent blocking media playback or initial navigation:

| Channel | Direction | Payload & Semantics |
|---|---|---|
| `metadata:getExtended` | Renderer ➔ Main | `({ title, year, imdbId, type })` ➔ Initiates enrichment and returns cached/current metadata |
| `metadata:peekExtended` | Renderer ➔ Main | Non-blocking cache lookup returning enriched record if already available |
| `metadata:clearCache` | Renderer ➔ Main | Clears memory and persistent disk caches for a title |
| `metadata:extendedUpdate` | Main ➔ Renderer | **Push Channel**: Emits partial snapshots as each source (AniList, TVMaze, Wikidata, Wikipedia) completes |

---

## 5. UI Integration & Display Models

* **DetailView (`src/views/DetailView.tsx`)**:
  * Displays high-resolution backdrop art dynamically replacing low-res provider thumbnails.
  * Shows official release status, air dates, production studios, and country of origin.
* **Cast & Crew Section (`src/components/CastList.tsx`, `src/utils/metadataDisplay.ts`)**:
  * Renders horizontal carousel of cast cards with actor photo, actor name, and character name.
  * For anime, displays both character artwork and voice actor headshots with language badges.
  * Crew accordion categorized by department (`Directing`, `Writing`, `Sound`, etc.).
* **Production Notes & Trivia (`src/components/TriviaSection.tsx`)**:
  * Displays verified background notes and Wikipedia production history with license citations.
