# Search, Catalogue and Discovery

## 1. Search: user input → rows

```
Navbar input ─► api:suggest (instant + progressive)         (autocomplete)
     │ Enter
     ▼
search:start ─► SearchSessionManager.start ─► SearchSession.run (searchSession.ts)
                       │  plan(): which providers / indexers / catalogues
                       ├─ runProviders(names)  ─► PluginManager.searchEach (one RPC per provider, ≤8 in flight)
                       ├─ runNativeProvider(name)
                       ├─ runIndexers(ids)     ─► IndexerRegistry (title-searched only when scoped)
                       └─ runCatalogues(on)    ─► Cinemeta / TVmaze / AniList
                       settle()/record() ─► snapshot ─► search:update (push) ─► SearchView
```

* **Push-shaped.** `search:start` returns the opening snapshot; `search:update` carries results and progress;
  `search:cancel` abandons the rest; `api:searchAll` remains for callers needing a full answer.
* **`plan()` rules** (strict scope): nothing selected ⇒ every enabled provider + catalogues; providers selected ⇒
  exactly those, **no catalogues**; indexers selected ⇒ those indexers are title-searched.
  `explainEmpty()` produces the reason shown when nothing came back.
* **Merge** (`searchMerge.ts`): rows from several providers for one work become one row; the catalogue row wins
  primacy and is addressed `cs3meta://…`; the providers behind it are recorded as `alternates`
  (`ContentService.rememberRoutes/alternateRoutes`) — this is what binds a later Play to the originating providers.
* **Dead rows** (`src/utils/deadRows.ts`): `no-sources` rows are held back with the count stated and one click to
  show them; `app-error` is **never** hidden; the whole page is never hidden. Fed by `TitleOutcomeStore`.
* **Cancellation:** one `AbortController` for suggestions in `main.ts`; a new keystroke aborts the previous fan-out. A cancel is not a failure (`cancelled` kind is unscored).
* **Errors:** per-provider failures are isolated and recorded with `classifyFailure`; the header shows "N failed"
  (original exception text in developer mode only).
* **Pasted input:** a magnet becomes its own row; a page URL becomes a row too but is **not fetched from the search box** (typing is not consent).

## 2. Suggestions
`searchSuggestions.ts` merges Cinemeta + TVmaze + AniList, deduped on normalised title+year, misspelling-tolerant.
`instant()` is synchronous (exact cache hit, else longest cached prefix re-filtered, never `done` on a prefix);
`suggest()` publishes per source (`search:suggestUpdate`) and runs genre lookup behind the answer. `SOURCE_PRECEDENCE`
fixes which source names a merged work. Renderer debounce is 110 ms; a single character asks Cinemeta only.

## 3. Scope, profiles, saved searches, history
| Piece | File | Persisted |
|---|---|---|
| Scope | `searchScope.ts` (`SearchScopeStore`) | `cs3_search_scope` |
| Profiles (named scopes; **All sources is a mode, not an erasure**) | `cs3/sourceProfiles.ts`, `sourceProfileStore.ts` | `cs3_source_profiles` |
| Provider order | `cs3/searchOrder.ts` | derived from analytics |
| Query history | `searchHistory.ts` (max 50) | datastore (carried by backup); not written in Incognito |
| Saved searches | `savedSearches.ts` (50 searches × 200 rows; same query+scope updates in place) | `saved-searches.json` |
| Facets | `FacetMenu`, `SourceScopeDialog`, `sourceScopeModel.ts` | OR within a facet, AND across facets |

Saved searches store page addresses (which do not expire), drawn as a finished snapshot with `savedView` set.

## 4. Catalogue and discovery (Home)
* `cs3/discovery.ts` `DiscoveryService`: stale-while-revalidate sections (6 h TTL; kept 30 days as the offline
  fallback), per-row visibility, paging (`discover:more`).
* `cs3/homeProviders.ts` + `homeProviderRegistry.ts`: the active home catalogue is **resolved, not stored** — the
  stored id is a choice, `active()` falls back to the default if it is down without rewriting the choice.
  Default Cinemeta catalogs (`top/year/imdbRating`, 19 genres) + AniList for seasonal anime; custom catalogue URL and
  user TMDB key are supported (`home:*`). No key is ever required.
* Native-provider catalogues appear after the metadata rows. Provider catalogues (`getMainPage`) are cached in
  `CatalogueCache` (`cs3-catalogue-cache.json`, ≤120 catalogs/160 pages; successes only; refresh failure returns the cached copy).
* Continue Watching is assembled in main (`cs3/continueWatching.ts` setting) — off means never assembled.
* Personalised rows count genres from the local library; nothing leaves the machine.

## 5. Metadata and enrichment {#metadata}
| Layer | File | Purpose |
|---|---|---|
| Resolve | `cs3/titleEnricher.ts` | release name → work + IMDb id (1-week cache; conservative) |
| Extended record | `metadata/enrichmentService.ts` | cast, crew, ratings, notes; **push**, partial → full, never on the playback path |
| Sources | `metadata/{wikidata,tvmaze,anilist,wikipedia,cinemetaExtras}.ts` | keyless only; `empty` ≠ `failed` |
| Merge | `metadata/merge.ts` | name + role class; unbilled credits never given an order |
| Ratings | `ratings:get/refresh`, `MediaRatings.tsx`, `cs3-ratings-cache.json` | multi-source, scale preserved |
| Related/franchise | `FranchiseRail.tsx`, `cs3-related-media-cache.json` | More-like-this and franchise navigation (verify details in `docs/2026-10-06-…Related Media.md`) |
| Reviews | `ReviewsAndExplanations.tsx` | On-demand reviews/explanations |
| Trailers | `metadata/videoTitles.ts`, `youtube.ts`, `videos:resolve` | oEmbed titles; trailer plays in `TrailerPopup`, never a source |

Cache: `cs3-metadata-cache.json`. The provider's own answer always wins; enrichment fills gaps and never overwrites.
Wikipedia prose comes from a Wikidata **sitelink**, never a search, and always carries attribution.
