# 07 — APIs and Contracts

**Generated:** 2026-08-10
**Baseline:** commit `a72f9e6c`

Four contract families: external network services, the provider (plugin) API, the extractor API, and desktop-internal IPC.

---

## 1. External network dependencies

CloudStream ships with **no first-party backend**. Every network dependency is either a third-party service or a user-supplied provider.

### 1.1 First-party-ish infrastructure

| Service | Endpoint | Purpose | Auth | Cache | Failure behavior |
|---|---|---|---|---|---|
| GitHub Releases API | `api.github.com/repos/<user>/<repo>/releases` | App update check | None (rate-limited) | — | Silent skip; update check retried later |
| GitHub prerelease tag | `.../git/ref/tags/pre-release` | Prerelease channel | None | — | As above |
| Plugin repositories | User-supplied URLs | Repository + plugin manifests | None | **5 minutes** | Repository shows as unreachable; installed plugins keep working |
| jsDelivr CDN | `cdn.jsdelivr.net/gh/<user>/<repo>@<rest>` | Optional mirror of `raw.githubusercontent.com` | None | CDN-controlled | Falls back to the original URL |
| cutt.ly | `https://cutt.ly/<code>` | Short-code repository resolution; 302 `Location` read with redirects disabled | None | — | `404` sentinel and bare-host results are rejected |
| py.md | `https://py.md/<code>` | Same, for `!`-prefixed codes | None | — | Same sentinel checks |
| Plugin voting | `VotingApi` | Plugin up/down votes | Device-scoped | — | Non-fatal |

**Desktop requirement.** All of the above are reusable unchanged. The **5-minute repository cache and the redirect-disabled short-code resolution must be reproduced** — the sentinel checks (`https://cutt.ly/404`, bare `https://py.md`) prevent bogus repositories from being added.

**Evidence.** `app/.../utils/InAppUpdater.kt:101, 155-156`; `app/.../plugins/RepositoryManager.kt:103-104, 124-178`. **Confidence: High.**

### 1.2 Tracker services

| Service | Auth | Notes |
|---|---|---|
| MyAnimeList | OAuth 2 (PKCE); `MAL_KEY` build secret | Deprecated legacy keys `mal_token`, `mal_refresh_token`, `mal_unixtime`, `mal_user` are backup-excluded |
| AniList | OAuth 2; `ANILIST_KEY` build secret | GraphQL |
| Kitsu | Token | `KITSU_CACHED_LIST` backup-excluded |
| Simkl | OAuth 2; `SIMKL_CLIENT_ID` + `SIMKL_CLIENT_SECRET` | `SimklSyncServices` enum enumerates linked services |
| Trakt | `TRAKT_CLIENT_ID` in the **library** BuildKonfig | **No `TraktApi` exists under `app/.../syncproviders/providers/`** at this commit, yet git history shows a `TraktProvider` serialization migration (2026-07-12). Trakt support is therefore provided by an **extension**, not the core app. |
| MyDramaList | `MDL_API_KEY` in the library BuildKonfig | Same pattern — extension-provided metadata |

**Requirement API-1 (P0).** Desktop builds must register **their own** OAuth client credentials. Reusing upstream's is inappropriate and will break when upstream rotates them. See [21](21-open-issues-and-assumptions.md) OQ-5.

**Evidence.** `app/build.gradle.kts:118-137`; `library/build.gradle.kts:105-118`; `app/.../syncproviders/AccountManager.kt:20-31`; `app/.../utils/BackupUtils.kt:79-87`; `library/.../MainAPI.kt:2664-2674`; git log `#2872`. **Confidence: High** for the mechanism; **Medium** for the exact Trakt provisioning path.

### 1.3 Subtitle services

OpenSubtitles, Addic7ed, SubDL, SubSource — REST, credential- or key-based. Legacy keys `open_subtitles_user` and `subdl_user` are backup-excluded. All four are directly reusable.

### 1.4 Skip-timestamp services

AniSkip, AnimeSkip (which has its own auth via `AnimeSkipAuth`), TheIntroDB. Reusable.

### 1.5 Anime metadata

`anime-db` supplies filler-episode data. Kitsu posters are fetched when `show_kitsu_posters_key` is enabled.

### 1.6 Provider endpoints

Entirely defined by installed plugins. The core app knows nothing about them. This means **the desktop app's network layer must be as permissive and as configurable as Android's** — arbitrary headers, cookies, per-request user agents, redirect control, and per-provider interceptors (`MainAPI.getVideoInterceptor`).

---

## 2. Network layer requirements

| ID | Requirement | Priority |
|---|---|---|
| NET-1 | Arbitrary request headers, including `Referer` and `User-Agent` overrides per request. | P0 |
| NET-2 | Per-provider cookie jars, isolated from each other and from the app's own requests. | P0 |
| NET-3 | Response caching with `cacheTime`/`cacheUnit` semantics matching NiceHttp. | P1 |
| NET-4 | Per-request timeouts honoring `MainAPI`'s five timeout fields (`loadLinksTimeoutMs`, `getMainPageTimeoutMs`, `searchTimeoutMs`, `quickSearchTimeoutMs`, `loadTimeoutMs`). | P0 |
| NET-5 | Redirect control, including "do not follow" (required by short-code resolution). | P0 |
| NET-6 | Configurable DoH resolver (`dns_key`). | P2 |
| NET-7 | Per-host concurrency caps and backoff — Android's unbounded `amap` fan-out is a rate-limit hazard. | P1 |
| NET-8 | An interceptor hook equivalent to `getVideoInterceptor`, applied to media requests. | P1 |
| NET-9 | Plugin requests are brokered: policy-checked, attributed, and rate-limited. No raw sockets for plugins. | P0 |
| NET-10 | No request may target `file://`; loopback targets are denied to plugins (the torrent server listens there). | P0 |

---

## 3. Provider API contract

The desktop plugin API must be **behaviorally equivalent** to `MainAPI`, whatever language it is expressed in.

### 3.1 Provider metadata

| Property | Type | Default | Meaning |
|---|---|---|---|
| `name` | string | `"NONE"` | Display name |
| `mainUrl` | string | `"NONE"` | Base URL; **participates in id derivation** |
| `storedCredentials` | string? | null | Provider-specific credential blob |
| `canBeOverridden` | bool | true | Whether "clone site" may repoint it |
| `lang` | string | `"en"` | IETF BCP 47 |
| `supportedTypes` | set of `TvType` | Movie+TvSeries | |
| `hasMainPage` | bool | false | |
| `hasQuickSearch` | bool | false | |
| `hasDownloadSupport` | bool | true | False when links are encrypted |
| `hasChromecastSupport` | bool | true | Desktop: repurpose as "external-player safe" |
| `usesWebView` | bool | false | Requires a browser context |
| `instantLinkLoading` | bool | false | Link is embedded in `data` |
| `sequentialMainPage` | bool | false | **Serialize homepage requests** |
| `sequentialMainPageDelay` | long | 0 | ms between homepage requests |
| `sequentialMainPageScrollDelay` | long | 0 | ms between scroll-triggered requests |
| `vpnStatus` | `VPNStatus` | None | Advisory |
| `providerType` | `ProviderType` | DirectProvider | |
| `supportedSyncNames` | set of `SyncIdName` | empty | |
| `mainPage` | list of `MainPageData` | one blank entry | Homepage sections |
| `loadLinksTimeoutMs` / `getMainPageTimeoutMs` / `searchTimeoutMs` / `quickSearchTimeoutMs` / `loadTimeoutMs` | long? | null | Per-operation timeouts |

### 3.2 Provider operations

| Operation | Signature (logical) | Notes |
|---|---|---|
| `getMainPage` | `(page: int, request: MainPageRequest) → HomePageResponse?` | |
| `search` | `(query: string) → SearchResponse[]?` | |
| `search` (paged) | `(query: string, page: int) → SearchResponseList?` | Defaults to wrapping the unpaged form |
| `quickSearch` | `(query: string) → SearchResponse[]?` | |
| `load` | `(url: string) → LoadResponse?` | |
| `loadLinks` | `(data, isCasting, subtitleCallback, callback) → bool` | **Streaming callbacks** |
| `getLoadUrl` | `(name: SyncIdName, id: string) → string?` | Sync-id → provider URL |
| `getVideoInterceptor` | `(link: ExtractorLink) → Interceptor?` | |
| `extractorVerifierJob` | `(extractorData: string?)` | Background keep-alive while playing |

**Requirement API-2 (P0).** `loadLinks` callbacks must stream across the desktop process boundary incrementally. Collecting results and returning them in one batch changes user-visible behavior — links currently appear as they are found.

### 3.3 Response types

- `SearchResponse` implementations: `MovieSearchResponse`, `TvSeriesSearchResponse`, `AnimeSearchResponse`, `LiveSearchResponse`, `TorrentSearchResponse`. Common fields: `name`, `url`, `apiName`, `type`, `posterUrl`, `id`, `quality`, `posterHeaders`, `score`.
- `LoadResponse` implementations: `MovieLoadResponse`, `TvSeriesLoadResponse`, `AnimeLoadResponse`, `LiveStreamLoadResponse`, `TorrentLoadResponse`.
- `EpisodeResponse` supplies `getLatestEpisodes()`, consumed by the subscription system.
- Supporting types: `Episode`, `SeasonData`, `NextAiring`, `Actor`/`ActorData`/`ActorRole`, `TrailerData`, `Tracker`/`AniSearch`/`TrackerType`, `Score`, `SubtitleFile`, `AudioFile`, `HomePageResponse`/`HomePageList`, `GenreResponse`/`TagSelector`/`BoolSelector`/`InputField`.

**Evidence.** `library/.../MainAPI.kt:335-2860` throughout; specifically `:494-702` (provider surface), `:1406-1523` (`SearchResponse`), `:1814-2215` (`LoadResponse`), `:2234-2267` (`EpisodeResponse`), `:2268-2783` (concrete types). **Confidence: High.**

### 3.4 Plugin registration

`BasePlugin` exposes `registerMainAPI(element)`, `registerExtractorAPI(element)`, `load()`, `beforeUnload()`, and a `filename` field the host sets. The Android `Plugin` subclass adds `load(context)`, `registerVideoClickAction(element)`, `resources`, and `openSettings`.

The manifest (`manifest.json` inside the archive) has four fields: `name`, `pluginClassName`, `requiresResources`, `version`.

**Requirement API-3 (P0).** The desktop plugin contract must offer equivalents for registration, lifecycle, per-plugin settings (`openSettings`), and action registration — otherwise ported providers lose capabilities.

**Evidence.** `library/.../plugins/BasePlugin.kt:14-78`; `app/.../plugins/Plugin.kt:10-39`. **Confidence: High.**

---

## 4. Extractor API contract

`ExtractorApi` instances resolve embed/host URLs into playable links, independently of providers. `extractorApis` is a global registry; plugins add to it.

`ExtractorLink` fields: `source`, `name`, `url`, `referer`, `quality`, `type` (`ExtractorLinkType`), `headers`, `extractorData`. `ExtractorLinkType` ∈ {`VIDEO`, `M3U8`, `DASH`, `TORRENT`, `MAGNET`} with MIME mapping `video/mp4`, `application/x-mpegURL`, `application/dash+xml`, `application/x-bittorrent`, `application/x-bittorrent`.

Type inference when `INFER_TYPE` is passed:
```
path ends .m3u8  → M3U8
path ends .mpd   → DASH
path ends .torrent → TORRENT
url starts magnet: → MAGNET
otherwise        → VIDEO
```

`ExtractorLink.hashCode()` delegates to `data.hashCode()` — another Java-hash dependency (UTIL-1).

`ExtractorLinkPlayList` supports multi-part sources.

**Evidence.** `library/.../utils/ExtractorApi.kt:368-458, 578-834, 923`. **Confidence: High.**

---

## 5. Desktop IPC contract

All renderer↔main communication crosses a typed `contextBridge` surface. Channels are grouped; every call is validated at the boundary.

| Channel group | Direction | Purpose |
|---|---|---|
| `app.*` | R→M | Version, paths, platform, quit, window controls |
| `library.*` | R→M | Query/mutate library, progress, states |
| `library.changed` | M→R | Invalidation events (replaces UTIL-15's `Event<T>`) |
| `provider.*` | R→M | Homepage, search, load, loadLinks — **proxied to the plugin host** |
| `provider.linkFound` / `provider.subtitleFound` | M→R | **Streaming** callbacks (API-2) |
| `plugin.*` | R→M | Repository/plugin management |
| `download.*` | R→M | Enqueue, pause, resume, cancel |
| `download.progress` | M→R | Throttled progress (≤4 Hz; Android uses 1 s) |
| `player.*` | R→M | Backend control, external handoff |
| `migration.*` | R→M | Analyze, preview, import, export |
| `migration.progress` | M→R | Progress and cancellation acknowledgement |
| `settings.*` | R→M | Get/set, verbatim value passthrough |
| `dialog.*` | R→M | Native file/folder pickers |
| `update.*` | R→M / M→R | Update lifecycle |

### IPC rules

| ID | Rule | Priority |
|---|---|---|
| IPC-1 | Every payload is schema-validated at the boundary. Renderer input is untrusted. | P0 |
| IPC-2 | No channel accepts an arbitrary filesystem path from the renderer. Paths originate from main-process dialogs and are referenced by handle thereafter. | P0 |
| IPC-3 | No channel exposes command execution, module loading, or `eval`. | P0 |
| IPC-4 | Long operations are (a) cancellable and (b) progress-reporting. | P0 |
| IPC-5 | Provider results are sanitized before reaching the renderer: no HTML injection through `name`/`plot`/`description`. | P0 |
| IPC-6 | Progress events are throttled and coalesced to protect renderer frame budget. | P1 |
| IPC-7 | Every channel is versioned; unknown versions are rejected with a clear error. | P2 |

---

## 6. Migration file format contract

Specified in full in [25-data-portability-and-migration.md](25-data-portability-and-migration.md). Summary of the two formats:

**Android-compatible export** — byte-shape identical to Android's `BackupFile`:
```
{ "datastore": { "_Bool":{}, "_Int":{}, "_String":{}, "_Float":{}, "_Long":{}, "_StringSet":{} },
  "settings":  { "_Bool":{}, "_Int":{}, "_String":{}, "_Float":{}, "_Long":{}, "_StringSet":{} } }
```
No version field, because adding one would risk Android's parser. Filename convention `CS3_Backup_yyyy_MM_dd_HH_mm.txt`.

**Desktop-native export** — a versioned container carrying the same logical data plus desktop-only state, with explicit `formatVersion`, `schemaVersion`, `appVersion`, `platform`, and a checksum.

**Requirement API-4 (P0).** The export UI must state unambiguously which format is being produced and where it can be restored: Android, desktop, or both.

---

## Next steps

1. Freeze the §3 provider contract as the desktop plugin API's behavioral specification before Phase 9.
2. Generate TypeScript definitions for §3–§5 as a Phase 3 deliverable.
3. Register desktop OAuth clients (API-1) — this has lead time and blocks FEAT-SYNC-1.
4. Resolve the Trakt provisioning question ([21](21-open-issues-and-assumptions.md) OQ-6).
