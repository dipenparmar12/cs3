# Core Concepts and Patterns

## 1. Glossary (one meaning per term)

| Term | Meaning in this codebase |
|---|---|
| **Repository** | A published index of extensions (`repo.json` → `plugins.json`). Identified by URL. Catalogue entries live in `official_repositories.json`-style data; installed ones in the datastore/`repos.json`. |
| **Extension** | One installed `.cs3` archive (DEX) or published jar. Contains zero or more providers and extractors. |
| **Provider** | A `MainAPI` instance registered by an extension. **Its `name` is the global identity** (scope key, `cs3ext://` address, enable key). |
| **Native provider** | A provider compiled into the app (`electron/cs3/nativeProviders/*`). Addressed `cs3native://`. |
| **Indexer** | A torrent search adapter (`torrent/indexers/*`) or Torznab endpoint. Answers at source-discovery time. |
| **Catalogue** | Two meanings, kept apart: *metadata catalogue* (Cinemeta, TVmaze, AniList — titles only, nothing playable) and *provider catalogue* (a provider's `getMainPage` rows). |
| **Title / work** | A film or series, keyed by `canonicalKey(title, year)`. |
| **Media URL** | The address of a *page* (`cs3ext://…`, `cs3meta://…`, `cs3native://…`, `http(s)://`, `magnet:`). Not playable. |
| **Links handle** | The opaque blob a provider's `loadLinks` takes; often JSON. **Not a page address** — never pass to `load()`. |
| **Source** | One playable candidate for a title: a torrent or a direct link. The TypeScript type is `TorrentResult` (a historical name; it also carries direct links). |
| **Stream** | A live, prepared session: the loopback URL plus its plan. Minted only by `media:prepare`. |
| **Session** | A main-process object for one user interaction: `PlaybackSession`, `SearchSession`. |
| **Scope** | Which sources a search/discovery may ask (`SearchScope`; discovery `origin` vs `all`). |

## 2. Patterns that actually exist

Each entry: why, where, how to extend.

### Registry
* **Why:** many interchangeable members behind one lookup that also owns enablement.
* **Where:** `ProviderRegistry` (what each archive registered), `NativeProviderRegistry`,
  `IndexerRegistry` (`indexerRegistry.ts`), `HomeProviderRegistry`, `PluginManager.providers` (a `Map` keyed by name).
* **Extend:** add an entry in the table/switch, and make sure it passes through the enable cascade
  (`enabledProviderNames`) rather than being queried directly.

### Provider abstraction + adapter
* **Why:** every source type must look the same to search/playback.
* **Where:** `NativeProvider` interface (`nativeProviders/types.ts`) — Internet Archive, PeerTube, iptv-org,
  Stremio addon, Jellyfin/Emby. Extension providers are adapted by the Kotlin bridge (`sidecar/bridge`) into
  primitives-in/JSON-out calls. Indexers adapt via `RawTorrent` → `finaliseResult`.
* **Extend:** native providers return `ExtractorLink`-shaped values (read by `providerLinks.ts`) and failures as a
  *reason*, never a bare empty list. Prefer `cs3native://`.

### Service layer + singletons
* **Why:** one owner per concern; IPC handlers stay thin.
* **Where:** constructed in `main.ts`; late-bound with `setX()` setters where two services need each other
  (e.g. `contentService.setSnapshotStore`, `providerRanking.setContext`).

### Strategy (decision as a pure function)
* **Where:** `media/decisionEngine.ts` `decideStrategy(...)` → `TransformationPlan` (`DIRECT`, `REMUX_CONTAINER`,
  `AUDIO_TRANSCODE`, `VIDEO_TRANSCODE`, `FULL_TRANSCODE`, `HLS_NATIVE`, `DASH_REMUX`, `DASH_NATIVE`,
  `NATIVE_MPV`, `EME_NATIVE`). `resumePlan.ts`, `compatibilityVerdict.ts`, `providerRanking.ts`,
  `sourceScope.ts` follow the same shape: pure, tested, mutation-checked.
* **Extend:** add the rule to the pure function and a test; do not branch in the caller.

### Table-driven criteria
* **Where:** `providerRanking.ts` (rows: id, weight, sample floor, fn → `0..1 | null`; `null` leaves the
  denominator), `backupSections` (a table of sections), `PRESET_ALIASES` in the test runner.

### Cache-aside and stale-while-revalidate
* **Where:** `DiscoveryService`, `CatalogueCache`, `DetailCache`, `RepositoryListingCache`, `SourceCache`.
  Details in [caching.md](caching.md).

### Event-driven push
* **Why:** work whose cost is unbounded (scrapes, installs, metadata) must not block a reply.
* **Where:** `search:*`, `playback:*`, `extension:jobs*`, `metadata:extended*`. Whole-state snapshots, coalesced.

### Single-flight / shared work
* **Where:** `sharedDiscovery.ts` (consensus cancellation: work stops only when every caller withdrew),
  `ensureProviderActive` in-flight map, clearance single-flight per host.

### Gate / funnel
* **Where:** `PluginManager.enabledProviderNames` — the one place the enable cascade
  (provider ∧ extension ∧ repository ∧ adult gate) is evaluated; `PrivacyMode.isPrivateSession()` — checked at
  write time by every automatic-activity store; `media:prepare` — the one source of a playable URL.

### Error isolation and fallback
* Per-provider isolation in fan-outs; `classifyFailure` gives one closed cause set shared by ranking,
  diagnostics and the issue ledger; `RpcResult`/`isTransportFailure` separates "runtime never answered" from "answer was no";
  scope escalation falls back to the narrow answer on failure; `homeProviderRegistry.active()` falls back to the
  default without rewriting the stored choice.

### Persistent vs volatile
Persistent: datastore, JSON stores, `userData` files. Volatile: sessions, proxy routes, in-flight maps, the
adult unlock, Incognito's in-memory source cache (`SourceCache.setVolatileMode`).

## 3. Source provenance

A source carries enough to trace it: provider (not the extractor), extension, repository, release name, size,
quality, headers, expiry. `api:getProviderProvenanceMap` resolves `repository ▸ extension ▸ provider` in one
batched call. Exports always emit the provider's address, never the loopback one (`sourceExport.ts`).
Standard mode shows the provider only; developer mode shows the chain (`experienceMode.ts`).

## 4. Media metadata normalisation

Release names are parsed (`torrent/releaseParser.ts`), messy titles are resolved to canonical works
(`cs3/titleEnricher.ts`, conservative: a disagreeing year disqualifies), and ratings are stored as published with
their scale (`normalisedRating` scales at read time only). See [search.md](search.md#metadata).

## 5. Retry and fallback mechanisms

| Where | Behaviour |
|---|---|
| `playbackSession` | walks sources; when all fail, widens to every provider/indexer **once** |
| Source cache | 3 non-definitive failures drop a source; 404/410 drop immediately |
| Indexers | per-indexer deadline (p90×2.5, 4–20 s) + escalating cooldown |
| Downloads | retry budget, `RefreshingSource` re-resolve, verified resume ([downloading.md](downloading.md)) |
| Player | `playbackRecovery.ts` decides the next step after a transport failure ([player.md](player.md)) |
