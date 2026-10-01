# PRD-53 (research): Streaming-service catalogues discovered from extensions

Status: **research only, 2026-10-01. Nothing built.** Next session implements from §5.

## 1. The ask

The sidebar's "Streaming services" must stop being a hand-maintained list. Keep
**exactly three hardcoded** platforms — Netflix, Prime Video, Disney+ — and
discover every other one from what installed extensions register and what
repository indexes publish, with our own index over it (the Android model). Each
platform opens a broad, paged catalogue; a title opens the normal detail page
and finds sources through the normal provider system. Catalogue ≠ source.

An attempt that added seven more hardcoded rows to `ottPlatforms.ts` was
rejected and reverted. **Do not add platform rows.**

## 2. What Android actually does (verified in `repositories/_cloudstream_ref_android`)

Android has **no streaming-service concept**. Its home screen is a *provider
picker*:

| Where | What it does |
|---|---|
| `library/.../MainAPI.kt:563` | `open val hasMainPage = false` — a provider opts in to having a home page |
| `utils/AppContextUtils.kt:473` `filterProviderByPreferredMedia` | candidate list = `apis.filter { (hasUniversal \|\| langs.contains(api.lang)) && (api.hasMainPage \|\| !hasHomePageIsRequired) }` — **language setting + hasMainPage** |
| `ui/home/HomeFragment.kt:384,494` | the picker dialog: `validAPIs`, kept if `hasMainPage && (isPinned \|\| supportedTypes.any(<selected media types>))` — **pinned providers + media-type chips** |
| `ui/home/HomeViewModel.kt:136,214,501` | `loadAndCancel(api)` loads the chosen provider's `getMainPage`; default is the first with `hasMainPage` |
| `HomeViewModel.kt:348` | `filterHomePageListByFilmQuality` — rows filtered by quality setting |

So "Netflix" on Android is just a provider whose `name` is "Netflix" (NetMirror,
CNC Verse) and whose `mainPage` rows are that service's catalogue. The platform
list is **whatever is installed with `hasMainPage`**, narrowed by language,
media type and pins.

## 3. What desktop already has (reuse, don't rebuild)

| Piece | Reuse for |
|---|---|
| `cs3/providerRegistry.ts` → `%APPDATA%/<app>/cs3-provider-registry.json` | per-provider `{name, mainUrl, lang, hasMainPage, hasQuickSearch, supportedTypes}` **without starting the JVM**. This *is* the installed half of the index. |
| `PluginManager.loadCatalog/loadCatalogPage` (`providerMainPageSections` / `providerMainPage` RPC) | rows + paging (1-based) of one provider |
| `PluginManager.enabledProviderNames` | the enable cascade + adult gate — the index must filter through it |
| `official_repositories.json` (43 repos) + each repo's `plugins.json` (`name`, `tvTypes`, `language`, `status`, `iconUrl`) | the not-installed half of the index ("available — install") |
| `cs3/ottPlatforms.ts` / `ottService.ts` | keep for the 3 fixed platforms only (anchored matching, PrimeWire rule) |
| `ott:*` IPC, `OttPlatformView.tsx`, Sidebar `ott:${id}` tabs | the surface; `ott:` is already a template-literal id, so dynamic ids fit |

Measured on the dev machine: **256 archives / 291 providers** (packaged install),
253 / 300 (dev). Caveat: the registry reported `hasMainPage: true` for **all**
of them — verify whether that is real or a default written by the registry
before using it as the filter (check `pluginManager.ts:796` and `:3524`).

## 4. Design

```
Repository indexes (plugins.json) ─┐
                                   ├─► PlatformIndex (main process, cached)
providerRegistry (installed) ──────┘        │
                                            ▼
            entries: { id: providerName, name, lang, supportedTypes,
                       iconUrl?, extension, repository,
                       state: 'browsable' | 'disabled' | 'installable',
                       pinned: boolean, fixed: boolean }
                                            │
         Sidebar "Streaming services"  ◄────┤  fixed 3 + pinned + filters
         Platform page (catalogue)     ◄────┘  getMainPage rows, paged
                       │
                       ▼ open title → DetailView (normal) → source discovery (normal)
```

Rules:
- **Fixed three** keep `ottPlatforms.ts` matching (they aggregate several providers, e.g. NetMirror + CNC Verse "Netflix").
- **Everything else is one provider = one entry**, named by the provider itself. No name-pattern guessing → no PrimeWire-class false positives, and no table to maintain.
- **Filters = Android's**: language (existing provider-language setting if any, else viewer locale + English like `starterPlugins.ts`), media types (`supportedTypes`), **pins** (user-pinned providers always shown). Without filters 300 entries is a phone book; the sidebar shows fixed + pinned, and a "More services" page shows the whole filtered index with search.
- **Adult gate and disable cascade** apply via `enabledProviderNames`; `installable` entries with `tvTypes` containing `NSFW` are hidden unless adult mode allows.
- **Installable entries** offer install through `extension:enqueueJobs` (repository id, never a URL — same rule as `ott:installSuggestion`).
- **Catalogue page**: rows from `loadCatalog`, "Show all" pages with `loadCatalogPage`; card metadata from the provider's `SearchResponse` (poster, title, year, type) and filled by the existing `TitleEnricher`/extended metadata on open — never block the grid on enrichment.
- **Origin**: every card carries provider → extension → repository (existing provenance map).
- **Search within platform**: `SearchOptions.providers = [providerName]` override (already exists for OTT pages; strict filter).

## 5. Implementation order (next session)

1. Verify `hasMainPage` truth in the registry (§3 caveat). Count how many providers really have main-page sections.
2. `electron/cs3/platformIndex.ts` — pure join of registry rows + repository plugin entries + enabled set + adult gate + pins → entries. Tests (`platformIndex.test.mts`): fixed three stay first; a disabled provider is `disabled` not gone; NSFW hidden; installed beats installable for the same name; no entry is invented.
3. Persist pins (`ott_pinned_providers`, whole-state bulk like `disabledSet`).
4. IPC: extend `ott:listPlatforms` to return fixed + index entries (whole state), add `ott:setPinned`, `ott:listIndex({query, lang, types})`. Update `preload.ts`, `src/types/api.ts`, `ipcSurface.test.mts`.
5. Sidebar: fixed three + pinned; "More services…" entry → index page with search, language and type chips, pin toggles, install buttons.
6. `OttPlatformView` accepts a single-provider platform id (`provider:<name>`) and reuses its browse/search code.
7. Docs: AGENTS.md map rows for `platformIndex.ts`; this PRD's status.

## 6. Open questions

- Does the user want *every* `hasMainPage` provider in the index, or only ones that look like services? (Android: every one.) Default to Android's behaviour, filtered.
- Repository `plugins.json` has no `hasMainPage` field, so installable entries can't be pre-filtered on it; show them as "install to browse".
