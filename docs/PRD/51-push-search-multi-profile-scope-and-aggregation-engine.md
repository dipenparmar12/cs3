# PRD-51 — Push Search, Multi-Profile Scopes & Real-Time Aggregation Engine

> **Document ID**: `PRD-51-PUSH-SEARCH-SCOPES-AGGREGATION`  
> **Status**: Active / Implemented  
> **Scope**: CloudStream 3 Desktop Application (`cs3_windows`)  
> **Source Files**: `electron/searchSession.ts`, `searchMerge.ts`, `searchHistory.ts`, `searchSuggestions.ts`, `cs3/sourceProfiles.ts`, `cs3/sourceProfileStore.ts`, `cs3/sourceScope.ts`, `cs3/hostDeadline.ts`  
> **Test Suites**: `electron/cs3/sourceProfiles.test.mts` (17 cases), `electron/cs3/sourceScope.test.mts` (17 cases), `electron/cs3/hostDeadline.test.mts` (15 cases), `electron/cs3/searchOrder.test.mts`  
> **Date**: 2026-09-17  

---

## 1. Executive Summary

Searching across 15–30 disparate community providers presents severe latency asymmetry: fast metadata indexers and Stremio addons respond in 250ms–500ms, while complex web scrapers (bypassing redirects and cloudflare protections) can take 15–25 seconds. A traditional request-response search API forces the user to wait for the slowest scraper before rendering any results.

The **Push Search, Multi-Profile Scopes & Real-Time Aggregation Engine** implements a **reactive push-based streaming search architecture** (`searchSession.ts`). Searches return an active session ID immediately, streaming result cards and provider progress over `search:update` events. In addition, it provides **Multi-Profile Source Scopes** (`sourceProfiles.ts`) enabling users to organize providers into tailored search profiles (e.g. Movies, Anime, Fast Only).

```text
                                  User Enters Search Query
                                              │
                                              ▼
+───────────────────────────────────────────────────────────────────────────────────────────────────+
|                                Active Search Profile Resolution                                   |
|                (Resolves active profile: e.g. "Anime Only" vs "All Providers")                    |
+───────────────────────────────────────────────────────────────────────────────────────────────────+
                                              │
                                              ▼
+───────────────────────────────────────────────────────────────────────────────────────────────────+
|                         SearchSession Manager (electron/searchSession.ts)                         |
|        Dispatches parallel searches capped at 8 concurrent RPCs across provider pool              |
+───────────────────────────────────────────────────────────────────────────────────────────────────+
       │                             │                             │                        │
       ▼                             ▼                             ▼                        ▼
Fast Provider (300ms)         Torrent Indexer (800ms)       Standard Scraper (3s)    Slow Scraper (18s)
       │                             │                             │                        │
       ▼                             ▼                             ▼                        ▼
+───────────────────────────────────────────────────────────────────────────────────────────────────+
|                      HostDeadline Manager (electron/cs3/hostDeadline.ts)                          |
|             Enforces per-host deadline circuit breakers; slow scrapers never block pool           |
+───────────────────────────────────────────────────────────────────────────────────────────────────+
                                              │
                                              ▼
+───────────────────────────────────────────────────────────────────────────────────────────────────+
|                           SearchMerge Engine (electron/searchMerge.ts)                            |
|             Deduplicates identical media titles, merges qualities, normalizes release years       |
+───────────────────────────────────────────────────────────────────────────────────────────────────+
                                              │
                                              ▼
+───────────────────────────────────────────────────────────────────────────────────────────────────+
|                         Push Stream to Renderer: search:update                                    |
|              Renders media cards progressively; UI is interactive from frame 1                     |
+───────────────────────────────────────────────────────────────────────────────────────────────────+
```

---

## 2. Push-Based Streaming Search Architecture (`searchSession.ts`)

### 2.1 The Push Lifecycle
1. **Initiation (`search:start`)**:
   * Renderer dispatches query with target profile ID.
   * Main process creates a new `SearchSession`, allocates a UUID session handle, and returns `{ ok: true, sessionId }` within $<5$ms.
2. **Streaming Snapshots (`search:update`)**:
   * As individual providers complete, the session aggregates new cards and emits `search:update` events.
   * Payload carries: `results` (deduplicated cards), `completedProviders`, `totalProviders`, `inFlightCount`, and `isFinished: boolean`.
3. **Cancellation (`search:cancel`)**:
   * If user types a new query or navigates away, `search:cancel` aborts pending HTTP requests and sidecar coroutines immediately, freeing socket resources.

### 2.2 Concurrency Capping & Host Deadlines (`hostDeadline.ts`)
* **Concurrency Limit**: To prevent CPU and network saturation, simultaneous sidecar search RPCs are strictly capped at **8 in flight**.
* **Host Deadlines**:
  * Each host has a measured latency budget.
  * If a provider fails to return within its allocated deadline (default 15s), the request is cancelled and the provider is flagged in the session report without stalling the remaining searches.

---

## 3. Multi-Profile Source Scopes (`sourceProfiles.ts`, `sourceProfileStore.ts`)

Users require different provider scopes depending on viewing intent (e.g. streaming anime requires different scrapers than searching 4K HDR movie torrents).

* **Profile Structure**:
  * Named configurations (e.g. `Default`, `Anime`, `Bollywood`, `Fast / Torrents`).
  * Explicit provider include/exclude lists.
  * Adult content filtering rules.
* **Atomic State Guarantee**:
  * Profile mutations (`create`, `activate`, `rename`, `duplicate`, `delete`) always return the **entire** profile state (`profiles:list`, `activeProfileId`, `unnamedDraft`). This prevents out-of-sync state between renderer controls and main process search dispatchers.

---

## 4. Search Deduplication & Merge Engine (`searchMerge.ts`)

When multiple providers return the same film or series (e.g. *Interstellar* returned by five different sites), displaying five identical cards clutters the UI.

* **Normalization**:
  * Strips punctuation, non-standard casing, and quality tags (`1080p`, `HDR`) from title strings.
  * Groups results by normalized title and release year.
* **Provider Badge Aggregation**:
  * Combines provider origins onto a single canonical card displaying provider badges and available quality variants.

---

## 5. Live Search Suggestions & History (`searchSuggestions.ts`, `searchHistory.ts`)

* **Query Suggestions**:
  * As the user types in the search bar, `search:getSuggestions` returns matching titles from local media libraries, popular torrent releases, and AniList/Cinemeta indices.
* **Search History**:
  * Persists recent search queries in `cs3_datastore.json`.
  * Provides quick-access chips in the search UI with one-click deletion and history clearing.

---

## 6. IPC Interface

| Channel | Direction | Payload & Action |
|---|---|---|
| `search:start` | Renderer ➔ Main | `({ query, scopeId })` ➔ Spawns streaming search session, returns `sessionId` |
| `search:update` | Main ➔ Renderer | **Push Event**: Emits progressive results, progress stats, and provider tallies |
| `search:cancel` | Renderer ➔ Main | `(sessionId)` ➔ Aborts active session and cleans up pending requests |
| `search:getSuggestions` | Renderer ➔ Main | `(partialQuery)` ➔ Returns real-time search suggestions |
| `search:getHistory` | Renderer ➔ Main | Retrieves recent search query history |
| `search:clearHistory` | Renderer ➔ Main | Clears stored search query history |
| `profiles:list` | Renderer ➔ Main | Returns all search profiles and active selection |
| `profiles:activate` | Renderer ➔ Main | `(profileId)` ➔ Sets active search profile |
| `profiles:create` | Renderer ➔ Main | `({ name, providerIds })` ➔ Creates new search profile |
| `profiles:delete` | Renderer ➔ Main | `(profileId)` ➔ Deletes specified search profile |
