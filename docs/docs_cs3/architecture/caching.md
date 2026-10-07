# Caching and Refresh

General policy: **successes are cached, failures never replace a good copy; reads answer from cache and revalidate
behind the viewer.** All paths are under Electron's `userData` unless noted.

## 1. Inventory

| Cache | Class / file | Store | Key | Lifetime / cap | Refresh |
|---|---|---|---|---|---|
| **Source cache** | `sourceCache.ts` | datastore `source_cache_v1` (≈2–3 MB) | media URL + season/episode + scope (`#all` suffix for widened) | entry 7 days; **per-source** expiry; ≤300 entries | on demand; `refresh` bypass; prefetcher warms |
| Detail cache | `detailCache.ts` | `cs3-detail-cache.json` | page address | fresh 12 h, max age 30 d, ≤300 | revalidate on open (`revalidateDetail`) |
| Page snapshots | `cs3/pageSnapshot.ts` | `page-snapshots.json` | page address | ≤600 | captured in `ContentService.load` |
| Discovery (home) | `cs3/discovery.ts` | `cs3-discovery-cache.json` | section | 6 h TTL, 30 d offline | stale-while-revalidate; `discover:invalidated` push |
| Provider catalogues | `cs3/catalogueCache.ts` | `cs3-catalogue-cache.json` | provider + row + page | ≤120 catalogs / 160 pages | answered from cache unless `refresh`; successes only |
| Repository listings | `cs3/repositoryListingCache.ts` | `cs3-repository-listings.json` | repo address as used | ≤80 | revalidate behind the viewer |
| Provider registry | `cs3/providerRegistry.ts` | `cs3-provider-registry.json` | `size:mtime:RUNTIME_GENERATION` | until archive/generation changes | rewritten on load; failed activation withdraws the row |
| Extended metadata | `metadata/enrichmentService.ts` | `cs3-metadata-cache.json` | IMDb/AniList id | see file | push-refill as sources land |
| Ratings / related | ratings & related services | `cs3-ratings-cache.json`, `cs3-related-media-cache.json` | title | see files | `ratings:refresh` |
| Probe findings | `media/inspectionStore.ts` | datastore | **origin** URL + headers (never loopback) | persistent | verdict always recomputed |
| ffmpeg options | `media/toolCapabilities.ts` | `cs3-ffmpeg-capabilities.json` | binary path+size+mtime | until binary changes | startup task (off-thread) |
| Torrent metadata | `torrent/torrentMetadata.ts` | per-infohash `.torrent` | infohash (verified) | persistent | — |
| DHT table | `torrent/dhtNodeCache.ts` | `dht-nodes.json` | — | persistent | added via `addNode()` |
| Translations | sidecar | hash-keyed | archive SHA-256 | dropped when sidecar/generation changes | — |
| Clearances | `cs3/clearance.ts` | webview partition cookie jar | host | cookie lifetime | single-flight solve; 10-min cooldown after failed solve |
| Title enrichment | `cs3/titleEnricher.ts` | in-store | normalised title+year | 1 week | — |

## 2. Source cache {#source-cache}
* Magnets never expire. A direct link takes its deadline from the URL (`Expires`, `exp`, or a JWT claim, matched
  case-insensitively) else `DEFAULT_LINK_TTL_MS` = 20 min. A direct link with **no recorded deadline is treated as expired**.
* `read()` can return a partially stale entry and reports the split (good magnets beside dead links).
* **Learns from playback:** `recordFailure` drops a source immediately on a definitive answer (404/410, "gone") and
  otherwise counts; `MAX_VALIDATION_FAILURES = 3` drops it. 403 is *not* definitive (expired signed URLs and hotlink
  protection both 403 and are fixed by re-resolving). `recordSuccess` clears the count. Removing the last source
  removes the entry.
* `hasFreshSources` is a `peek` (no write, no promotion). `SourceCache.onWrite` → `LibraryStore.mergeDiscoveredSources`
  copies discovered sources onto the library title (≤30, identity = provider + release + resolution).
* The scope is part of the cache key and the in-flight key, so a widened run is not answered by the scoped result.
* Incognito: `SourceCache.setVolatileMode` keeps private discovery in memory.
* Read-only per-row queries use a parse memoised on the stored string (`SourceCache.snapshot`) — `datastore.getObject`
  re-parses every call; 738 cards took 14.7 s of main thread before this.

## 3. Prefetch
`cs3/sourcePrefetcher.ts` runs discovery ~1.2 s after a detail page settles, one at a time, never when
`hasFreshSources`, with `autoWiden: false`; switchable in settings ("Load sources while you read"). It joins/starts the
same shared run Play uses, so Play joins instead of duplicating the scrape.

## 4. Atomicity and durability
`DatastoreManager` is debounced (250 ms) and writes temp-file-plus-rename; `flush()/flushSync()` at backup, import,
rollback, `before-quit`. `util/jsonFileStore.ts` provides the same for standalone stores. Stores that are big and
write-heavy hydrate on first use (`DiagnosticsLog`, `PageSnapshotStore`), with **every** entry point (including
write-only ones) calling the hydrator.

## 5. Startup behaviour {#startup}
Nothing heavy at module scope: `webtorrent`, `cheerio`, `fast-xml-parser` are lazily imported behind their features;
`chardet` is a lazy `createRequire`; ffmpeg is probed in the background queue, off the main thread. First-paint JS is
~311 kB (route chunks + manual chunks for hls.js, shaka-player). The provider list is hydrated from disk, so the first search
does not start the JVM. `bun run test reachability` does **not** catch a heavy module-scope import — check the graph.
`app:getStartupProfile` reports stages, stalls and queue state (Settings → Advanced, Developer mode).

## 6. Offline
Home, details, saved pages, repository browse and history answer from disk. Provider scrapes and streaming need network;
an offline banner states it once instead of thirty provider errors.

## 7. Invalidation cheat-sheet
| Event | What is invalidated |
|---|---|
| Sidecar/shim/bridge change | bump `RUNTIME_GENERATION` → provider registry rows and translations drop |
| Archive replaced | registry row (size/mtime changed) |
| Home catalogue switched | `discover:invalidated` |
| `loadProviders(force)` | registry cache cleared |
| Clear history / Incognito toggle | stores respect `isPrivateSession()` at write time |
| Backup restore | datastore snapshot taken first (`before-restore.json`) |
