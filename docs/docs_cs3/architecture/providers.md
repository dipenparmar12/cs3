# Providers, Repositories → Extensions → Providers

The authoritative description of the chain and of how a provider is chosen, ranked, gated and explained.
Runtime mechanics are in [extensions.md](extensions.md); repository mechanics in [repositories.md](repositories.md).

```
Repository ──► Extension ──► Provider ──► Catalogue / Search ──► Title (detail) ──► Source ──► Stream
 (repo.json)   (.cs3 / jar)   (MainAPI)    (getMainPage/search)    (load)        (loadLinks)   (media:prepare)
```

Relationships (code is the authority; the hierarchy is exactly three levels, provider is the selectable leaf):
* One repository lists many extensions (`plugins.json`, per-entry `status`, `language`, optional `jarUrl/jarHash`).
* One extension archive registers **0..n providers** and 0..n `ExtractorApi`s (extractor-only bundles register no provider — recorded as `[]` so they do not reload every launch).
* A provider's **name is globally unique** (`PluginManager.providers` is a `Map`). Two extensions claiming one name: the first keeps it, the loser is reported via `unavailableReason`.
* A provider yields search rows (re-addressed `cs3ext://<provider>/<handle>`), catalogue rows, a detail (`load`), and links (`loadLinks`).

## 1. Provider kinds

| Kind | Address | Runs in | Defined by |
|---|---|---|---|
| Extension provider | `cs3ext://<provider>/<handle>` | JVM sidecar | `.cs3` from a repository |
| Native provider | `cs3native://<id>/<handle>` | main process | `electron/cs3/nativeProviders/*` |
| Metadata catalogue | `cs3meta://…` | main process | Cinemeta/TVmaze/AniList (`metadataProvider.ts`) — nothing playable |
| Indexer | (torrent rows) | main process | `torrent/indexers/*`; 19 built-ins + Torznab |

Native providers: Internet Archive (query form `title:("…")`, `format:(MPEG4)` quality gate), PeerTube (SepiaSearch;
files live on the video's own instance), iptv-org (live), any **Stremio addon** by manifest URL
(`idPrefixes` is a hard constraint; `externalUrl`/`ytId` streams dropped; two deployments of one addon are two
providers), and the user's **Jellyfin/Emby** server (key sent as `X-Emby-Token`, never in a URL, never reaches the
renderer; `static=true`). They share the `providers` scope dimension and the enable cascade via
`NativeProviderRegistry.enabledProviderNames()`.

## 2. Enablement — one funnel
`PluginManager.enabledProviderNames()` is the only place that decides whether a provider may answer:

`provider on ∧ extension on ∧ repository on ∧ adult gate`.

Switches are stored as **exceptions** (`cs3_disabled_providers/_extensions/_repositories/_native_providers`,
`util/disabledSet.ts`) so new things default to enabled. `getProviderTree` recomputes the predicate as
`effectivelyEnabled`; the UI keeps `enabled` (own switch) and `effectivelyEnabled` (cascade result) separate so a
provider greyed out by its repository is not mistaken for one the user turned off. Anything that reads the tree to
decide what may be searched must use `effectivelyEnabled`.

### Adult content
Setting `cs3_adult_content_mode` (`off | ask | on`; `get/setAdultMode`, `unlock/lockAdultForSession`) owned by
`BootstrapService`; `onAdultChange` → `adult:changed` → `src/utils/useAdultMode.ts` is the renderer's only copy.
The gate removes only **adult-only** providers (`NSFW` with no general type). **Mixed** providers stay and
their 18+ rows/titles are screened (`src/utils/adultContent.ts`; `screenSections/screenLists` after the cache).
The unlock is in-memory, never persisted, and refused unless the mode is already `ask`.

## 3. Search order, scope and ranking
* **Scope** (`searchScope.ts`, `SearchScopeStore`, `cs3_search_scope`): a selection is a strict filter. Providers
  selected ⇒ exactly those, no catalogues; indexers selected ⇒ those are title-searched; unresolvable selections are
  reported (`missingProviders/missingIndexers`), never widened. Profiles (`profiles:*`, `sourceProfiles.ts`) sit *above* the scope and write through to it.
* **Order** (`searchOrder.ts`): the fan-out asks healthier providers first; falls back to the original order if the
  ranking is not the same set.
* **Ranking** (`providerAnalytics.ts` → `providerRanking.ts` → `providerRecommendations.ts`): counts → weighted
  criteria (rows in a table) → advice. `empty` is tracked apart from `failure`; unscored failure kinds
  (`provider-missing`, `cancelled`, `resource-leak`, …) are not recorded; rates are smoothed toward a neutral
  prior; the maintainer's `status` (0 down, 1 ok, 2 slow, 3 beta) is a 0.4-weight criterion with no sample floor.
  Nothing is auto-disabled; auto-enable is opt-in (`autoEnableProven`). Analytics stores aggregates only.
* **Concurrency:** `searchEach` runs one RPC per provider, default 8 in flight (`cs3_provider_search_concurrency`, 1–32).

## 4. Failure and explanation
* `failureTaxonomy.classifyFailure` is the single cause set (`provider-error`, `runtime-unavailable`,
  `provider-missing`, `cancelled`, `resource-leak`, network kinds…). It classifies from the head and `Caused by:`
  lines, not stack frames.
* `PluginManager.explainMissingProvider` turns `PROVIDER_NOT_LOADED` into a sentence that names the cause
  (switch off, adult gate, name clash, uninstalled, blocked at load, not loaded yet). Provider origins are persisted
  (`cs3_provider_origins`) so this works after an extension is removed.
* `providerRecovery.ts` `planRecovery` (pure) lists the ordered steps to make a saved page's provider answer again;
  it never adds a repository the app was not already told about. UI: `ProviderRecoveryPanel`, `FixProvidersModal`.
* `extensionIssues.ts` is the durable tally `(cause, source, groupingForm(message))`; no URLs/queries/titles stored.
  `diagnostics.ts` keeps pasteable failure tuples; the `Logger` is the per-launch NDJSON transcript.

## 5. OTT platforms
`cs3/ottPlatforms.ts` (table + name matcher), `ottService.ts` (availability, search scope, install offers,
discovered platforms, pins), `ottCatalog.ts` (fallback catalogue when no provider can say), `catalogueCache.ts`.
Only Netflix, Prime Video and Disney+ are hand-listed; everything else is **discovered** from enabled providers
with `hasMainPage` (`provider:<name>`), flagged adult from `NSFW`. Availability: `ready | disabled | aggregate | missing`.
Browse asks **one** provider; search is scoped through `SearchOptions.providers` and never written to the stored scope.
`ott:installSuggestion` takes a repository **id**, never a URL.

## 6. Regional providers
`cs3/regions.ts` (see [repositories.md](repositories.md#regions)). Content regions
(`cs3_content_regions`, `cs3_content_regions_cross`) decide which repositories are added and which starter
extensions installed.

## 7. Never do
* Reintroduce a synthetic/placeholder source — return an empty list *and a reason*.
* Call a provider without `ensureProviderActive(name)`.
* Register a provider anywhere but through the registries (re-opens the adult gate and the disable switch).
* Pass a links handle to `load()` (`cs3/extensionAddress.ts` `looksLikeLinksHandle`).
