# 06 — Data Models

**Generated:** 2026-08-10
**Baseline:** commit `a72f9e6c`

This document defines the **canonical, platform-independent logical data model**. It is the contract that Android storage, desktop storage, and the migration format all map onto.

---

## 1. Android physical storage — what actually exists

There is **no database**. All state lives in two Android `SharedPreferences` files.

| Store | Physical name | Content | Value encoding |
|---|---|---|---|
| **Data store** | `rebuild_preference` | All user data | JSON strings under `folder/path` keys |
| **Settings store** | default shared prefs | Preference-screen settings | Native primitives (Boolean/Int/String/Float/Long/StringSet) |

`DataStore.setKey(path, value)` writes `value.toJsonLiteral()` via `putString`. `getKey(path)` reads the string and parses it. There is no schema, no index, and no migration framework — key naming *is* the schema.

**Evidence.** `app/.../utils/DataStore.kt:26, 103-124, 173-190`. **Confidence: High.**

**Consequence.** The desktop app is free to use any storage technology. What it must preserve is the **key grammar and value shapes**, because those are the migration contract.

---

## 2. The key grammar

Three key forms exist:

```
FORM A  <profileIndex>/<namespace>/<id>     Profile-scoped, per-item      e.g. "0/video_pos_dur/123456"
FORM B  <profileIndex>/<key>                Profile-scoped, singleton     e.g. "0/playback_speed"
FORM C  <key>  or  <key>/<sub>/<sub>        Global                        e.g. "REPOSITORIES_KEY",
                                                                               "auth_tokens/mal/0"
```

`profileIndex` is `DataStoreHelper.selectedKeyIndex` rendered as a decimal string; the default profile is `"0"`.

Folder enumeration is `keys.filter { it.startsWith(folder.trimEnd('/') + "/") }` — the trailing slash is added deliberately to stop `"0/result_watch_state"` from also matching `"0/result_watch_state_data"`. **A desktop importer that omits this guard will merge two distinct namespaces.**

**Evidence.** `app/.../utils/DataStore.kt:111-113, 126-130`; `app/.../utils/DataStoreHelper.kt:67, 179-181`. **Confidence: High.**

---

## 3. Profile-scoped namespaces (FORM A / B)

### 3.1 Per-item namespaces (FORM A)

| Namespace constant | Key literal | Item id | Value type |
|---|---|---|---|
| `VIDEO_POS_DUR` | `video_pos_dur` | episode/movie id | `PosDur` |
| `VIDEO_WATCH_STATE` | `video_watch_state` | episode id | `VideoWatchState` enum (`None` deletes the key) |
| `RESULT_WATCH_STATE` | `result_watch_state` | title id | `Int` = `WatchType.internalId` (`NONE`=5 deletes instead of storing) |
| `RESULT_WATCH_STATE_DATA` | `result_watch_state_data` | title id | `BookmarkedData` |
| `RESULT_SUBSCRIBED_STATE_DATA` | `result_subscribed_state_data` | title id | `SubscribedData` |
| `RESULT_FAVORITES_STATE_DATA` | `result_favorites_state_data` | title id | `FavoritesData` |
| `RESULT_RESUME_WATCHING` | `result_resume_watching_2` | parent id | `ResumeWatching` |
| `RESULT_RESUME_WATCHING_OLD` | `result_resume_watching` | parent id | `ResumeWatching` (**legacy — migrate**) |
| `RESULT_EPISODE` | `result_episode` | title id | `Int` |
| `RESULT_SEASON` | `result_season` | title id | `Int` |
| `RESULT_DUB` | `result_dub` | title id | `Int` = `DubStatus` **ordinal** |
| `SEARCH_HISTORY_KEY` | `search_history` | derived key | search-history record |

### 3.2 Singleton profile keys (FORM B)

| Key | Type | Default |
|---|---|---|
| `home_api_used` | `String` | none |
| `search_pref_providers` | `List<String>` | derived from preferred media type when empty |
| `search_pref_tags` | `List<String>` (`TvType` names) | `["Movie","TvSeries"]` |
| `home_pref_homepage` | `List<String>` (`TvType` names) | `["Movie","TvSeries"]` |
| `home_bookmarked_last_list` | `IntArray` | `[]` |
| `playback_speed` | `Float` | `1.0` |
| `resize_mode` | `Int` | `0` |
| `library_sorting_mode` | `Int` (ordinal) | `ListSorting.AlphabeticalA.ordinal` = **5** |
| `results_sorting_mode` | `Int` (ordinal) | `EpisodeSortType.NUMBER_ASC.ordinal` |

**Evidence.** `app/.../utils/DataStoreHelper.kt:47-60, 96-161`; `app/.../utils/DataStore.kt:17-26`; `app/.../ui/search/SearchViewModel.kt:33`. **Confidence: High.**

### 3.3 Global keys (FORM C)

| Key | Type | Transferable? |
|---|---|---|
| `data_store_helper/account` | `Account[]` | **Yes** |
| `data_store_helper/account_key_index` | `Int` | **Yes** |
| `REPOSITORIES_KEY` | `RepositoryData[]` | **Yes** |
| `PREBUILT_REPOSITORIES` | `RepositoryData[]` | Yes (app-supplied) |
| `user_pinned_providers` | `String[]` | **Yes** |
| `user_custom_sites` | provider overrides | **Yes** |
| `subtitle_settings` | `SaveCaptionStyle` | **Yes** |
| `chome_subtitle_settings` | `SaveChromeCaptionStyle` | **Yes** (note upstream spelling) |
| `subs_auto_select` | `String` | **Yes** |
| `subs_auto_download` | `List<String>` | **Yes** |
| `last_sync_api` | `String` | **Yes** |
| `<idPrefix>_sync/<id>` | `String` (URL) | **Yes** |
| `video_source_priority`, `video_quality_priority`, `video_profile_name`, `video_profile_types_2`, `video_profile_settings` | quality-profile data | **Yes** |
| `download_header_cache`, `BACKUP_download_header_cache` | `DownloadHeaderCached` | **Yes** — deliberately retained because resume-watching depends on it |
| `PLUGINS_KEY`, `PLUGINS_KEY_LOCAL` | `PluginData[]` | **No** |
| `auth_tokens/<idPrefix>/<profile>` | `AuthData[]` | **No** |
| `auth_ids/<idPrefix>/<profile>` | `Int` | **No** |
| `download_episode_cache`, `BACKUP_download_episode_cache` | `DownloadEpisodeCached` | **No** |
| `download_info`, `download_resume_2`, `download_resume_queue_key`, queue key | download state | **No** |
| `ANILIST_CACHED_LIST`, `MAL_CACHED_LIST`, `KITSU_CACHED_LIST` | tracker caches | **No** |

**Evidence.** `app/.../utils/BackupUtils.kt:55-113`; `app/.../utils/DataStoreHelper.kt:178-181, 827-829`; `app/.../plugins/RepositoryManager.kt:100-101, 242-244`; `app/.../ui/player/source_priority/QualityDataHelper.kt:21-31`; `app/.../ui/subtitles/SubtitlesFragment.kt:61-63`. **Confidence: High.**

---

## 4. Identity — the most important section in this document

### 4.1 Title identity

```
id = javaHashCode( url.replace(providerMainUrl, "").replace("/", "") )
```

`providerMainUrl` is resolved by provider name at call time. If the provider is not installed, `getApiFromNameNull(apiName)` returns null and the replacement uses `""` — meaning **the id computed with the provider absent differs from the id computed with it present.**

Additionally, when a `LoadResponse` originates from a search result that already carries an id, that id is used instead of recomputation (`LoadResponseFromSearch`).

**Evidence.** `app/.../ui/result/ResultViewModel2.kt:370-380`. **Confidence: High.**

### 4.2 Requirements this creates

| ID | Requirement | Priority |
|---|---|---|
| DATA-ID-1 | Implement Java `String.hashCode()` bit-exactly, over UTF-16 code units, with 32-bit signed wraparound (UTIL-1). | P0 |
| DATA-ID-2 | Reproduce the `mainUrl` stripping and `/` removal exactly, in that order. | P0 |
| DATA-ID-3 | Preserve imported ids **verbatim**. Never recompute an id during import — the source provider may not be installed on desktop, which would silently change it. | P0 |
| DATA-ID-4 | Store ids as signed 32-bit integers. JavaScript numbers are doubles; unguarded arithmetic will produce values Java never generates. | P0 |
| DATA-ID-5 | Treat an id collision on import as a conflict requiring resolution, not an overwrite. | P1 |

### 4.3 Known weaknesses inherited from Android

- **Collisions are possible.** A 32-bit hash over user-controlled URLs will collide eventually. Android does not detect this. Desktop must at minimum log it.
- **Provider `mainUrl` changes break identity.** If a provider changes its domain — which the "clone site" feature explicitly enables — every existing id for that provider becomes unreachable. This is an existing upstream bug class, not something the migration introduces; the desktop app should not attempt to "fix" it silently, because doing so would diverge from Android.
- **Episode ids** are supplied by providers within `Episode`/`ResultEpisode`, and their stability is the provider's responsibility.

**Confidence: High** for the mechanism; **Medium** for the practical collision rate (not measured upstream).

---

## 5. Enums whose ordinals are persisted

Reordering any of these in the desktop implementation silently corrupts imported data.

| Enum | Persisted as | Order (index → name) |
|---|---|---|
| `WatchType` | `internalId` (explicit, not ordinal) | 0 WATCHING · 1 COMPLETED · 2 ONHOLD · 3 DROPPED · 4 PLANTOWATCH · 5 NONE |
| `SyncWatchType` | `internalId` | −1 NONE · 0 WATCHING · 1 COMPLETED · 2 ONHOLD · 3 DROPPED · 4 PLANTOWATCH · 5 REWATCHING |
| `ListSorting` | **ordinal** | 0 Query · 1 RatingHigh · 2 RatingLow · 3 UpdatedNew · 4 UpdatedOld · 5 AlphabeticalA · 6 AlphabeticalZ · 7 ReleaseDateNew · 8 ReleaseDateOld |
| `DubStatus` | **ordinal** (via `result_dub`) | Has an explicit `id` field; the persisted value is the ordinal, read back with `DubStatus.entries.getOrNull(...)` |
| `EpisodeSortType` | **ordinal** | Default `NUMBER_ASC` |
| `TvType` | **name** (string) | Movie 1 · AnimeMovie 2 · TvSeries 3 · Cartoon 4 · Anime 5 · OVA 6 · Torrent 7 · Documentary 8 · AsianDrama 9 · Live 10 · NSFW 11 · Others 12 · Music 13 · AudioBook 14 · CustomMedia 15 · Audio 16 · Podcast 17 · Video 18 |
| `VideoWatchState` | **name** | None · Watched (`None` deletes the key) |
| `SearchQuality` | name | Carries an int value |
| `ExtractorLinkType` | name | VIDEO · M3U8 · DASH · TORRENT · MAGNET |
| `AutoDownloadMode` | value field | Disable 0, … |

**Note the mixed convention:** `TvType` persists by **name** (`serializeTv` maps to `it.name`, `deserializeTv` matches by name), while `ListSorting` and `DubStatus` persist by **ordinal**. This inconsistency must be reproduced, not normalized.

**Evidence.** `app/.../ui/WatchType.kt:7-33`; `app/.../ui/library/LibraryViewModel.kt:19-29`; `app/.../utils/DataStoreHelper.kt:101-107, 147-161, 773-779`; `library/.../MainAPI.kt:905, 1120-1142, 1303`; `library/.../utils/ExtractorApi.kt:413-427`; `app/.../ui/result/ResultFragment.kt:33-37`. **Confidence: High.**

---

## 6. Canonical entity definitions

Field names are the JSON names Android emits and accepts. Types are logical.

### DATA-1 `Profile` (Android: `Account`)
| Field | Type | Notes |
|---|---|---|
| `keyIndex` | int | The profile index used as a key prefix |
| `name` | string | |
| `customImage` | string? | Image reference |
| `defaultImageIndex` | int | 0–6, indexes a **fixed, index-stable** avatar array |
| `lockPin` | string? | Plaintext PIN — a UX gate, not security |

**Portability: fully portable.** `defaultImageIndex` requires the desktop app to ship 7 avatars at the same indices.

### DATA-2 `PosDur`
| Field | Type |
|---|---|
| `position` | long (ms) |
| `duration` | long (ms) |

Write guard: not persisted when `duration < 30000`. Read normalization: `fixVisual` (UTIL-4). **Fully portable.**

### DATA-3 `LibrarySearchResponse` family — `BookmarkedData`, `FavoritesData`, `SubscribedData`

Shared fields: `id`, `latestUpdatedTime`, `name`, `url`, `apiName`, `type` (`TvType`), `posterUrl`, `year`, `syncData` (map), `quality` (`SearchQuality`), `posterHeaders` (map), `plot`, `score`, `tags`.

Discriminating fields:
- `BookmarkedData.bookmarkedTime: long`
- `FavoritesData.favoritesTime: long`
- `SubscribedData.subscribedTime: long` **and** `lastSeenEpisodeCount: Map<DubStatus, Int?>`

All three accept a deprecated `rating: int` on **read only**, converting it to `score` via `Score.fromOld`; none emit it (UTIL-3).

**Portability: fully portable.** `SubscribedData.lastSeenEpisodeCount` is keyed by `DubStatus` — confirm the map-key encoding against a real backup ([21](21-open-issues-and-assumptions.md) OQ-3).

### DATA-4 `ResumeWatching`
| Field | Type |
|---|---|
| `parentId` | int |
| `episodeId` | int? |
| `episode` | int? |
| `season` | int? |
| `updateTime` | long |
| `isFromDownload` | bool |

**Portable with transformation.** When `isFromDownload` is true, the record points at local media that does not exist on desktop. Import it, mark it unresolved, and report it — do not drop it.

### DATA-5 `ResultEpisode`
`headerName`, `name?`, `poster?`, `episode`, `seasonIndex?`, `season?`, `data`, `apiName`, `id`, `index`, `position`, `duration`, `score?`, `description?`, `isFiller?`, `tvType`, `parentId`, `videoWatchState`, `totalEpisodeIndex?`, `airDate?`, `runTime?`, `seasonData?`.

Appears inside `DownloadQueueItem`. **Not backed up** (download state is excluded), but part of the desktop native format.

### DATA-6 Download entities
- `DownloadHeaderCached{apiName,url,type,name,poster,cacheTime,id}` — **transferable**
- `DownloadEpisodeCached{name,poster,episode,season,parentId,score,description,cacheTime,id}` — **not transferable**
- `DownloadedFileInfo{totalBytes,relativePath,displayName,extraInfo,basePath,linkHash}` — **not transferable** (paths)
- `DownloadItem{source,folder,ep,links}`, `DownloadEpisodeMetadata{...}`, `DownloadResumePackage{item,linkIndex}`, `DownloadQueueItem{...}`, `DownloadQueueWrapper{resumePackage,downloadItem,id,parentId}` — **not transferable**

`basePath` is explicitly documented as nullable "for legacy downloads", so both shapes exist in the wild.

### DATA-7 `PluginData`
`internalName`, `url?`, `isOnline`, `filePath`, `version`. **Non-portable** — `filePath` is an Android absolute path and the plugin binary is Android bytecode. Backup-excluded upstream.

### DATA-8 `RepositoryData` / `Repository` / `SitePlugin`
- `RepositoryData{name, url, ...}` — **fully portable**, and the key mechanism by which a migrated user recovers their providers.
- `Repository{iconUrl,name,description,manifestVersion,pluginLists[]}` — remote document.
- `SitePlugin{url,status,version,apiVersion,name,internalName,authors[],description,repositoryUrl,tvTypes[],language,iconUrl,fileSize,fileHash}` — remote document. `status`: 0 Down, 1 Ok, 2 Slow, 3 Beta-only.

### DATA-9 `SaveCaptionStyle`
Subtitle appearance (font, size, colors, edge type, elevation with `DEF_SUBS_ELEVATION = 20`, background). **Fully portable**, but rendering must be visually equivalent.

### DATA-10 `AuthData`
Tracker credentials at `auth_tokens/<idPrefix>/<profile>`. **Non-portable by design.** On desktop, store in the OS keychain.

### DATA-11 Settings map
~100 flat keys, catalogued in [18](18-technical-reference.md) §2. **Fully portable** except path keys and the excluded set.

---

## 7. Portability classification summary

| Category | Entities |
|---|---|
| **Fully portable** | Profiles, watch progress, watch states, bookmarks, favourites, subscriptions, resume-watching, search history, sync-id mappings, repositories, pinned/custom providers, subtitle styles and language prefs, quality profiles, download header cache, most settings |
| **Portable with transformation** | Resume-watching entries with `isFromDownload=true`; any absolute path; legacy `rating`→`score`; legacy `result_resume_watching`→`result_resume_watching_2`; `app_layout_key` semantic remap |
| **Partially portable** | Provider overrides (`user_custom_sites`) — the data moves, but only works if an equivalent provider exists on desktop |
| **Platform-specific** | `download_path_key`, `backup_path_key`, `backup_dir_path_key`, `download_path_key_visual`, `battery_optimisation`, `apk_installer_key`, `rotate_video_key`, `auto_rotate_video_key`, `nginx_user` |
| **Non-portable** | Plugin binaries and `PluginData`, auth tokens/ids, download queue and file state, tracker list caches, `biometric_key` |
| **Unknown — verify against real data** | Exact `SubscribedData.lastSeenEpisodeCount` map encoding; `search_history` record shape and key derivation; `user_custom_sites` concrete shape; `video_profile_settings` shape ([21](21-open-issues-and-assumptions.md)) |

---

## 8. Recommended desktop physical model

Logical model unchanged; physical storage modernized (ADR-1).

```
SQLite
  profiles(key_index PK, name, custom_image, default_image_index, lock_pin)
  watch_progress(profile, content_id, position, duration, updated_at)          PK(profile,content_id)
  watch_state(profile, content_id, watch_type, updated_at)
  library_items(profile, content_id, kind ∈ {bookmark,favorite,subscription},
                name, url, api_name, type, poster_url, year, plot, score, tags,
                added_time, latest_updated_time, sync_data, poster_headers,
                quality, last_seen_episode_count)                              PK(profile,content_id,kind)
  resume_watching(profile, parent_id, episode_id, episode, season,
                  update_time, is_from_download)                               PK(profile,parent_id)
  search_history(profile, key, query, searched_at)
  sync_mappings(profile, id_prefix, content_id, url)
  repositories(url PK, name, added_at)
  plugins(internal_name, repository_url, version, file_path, is_online, enabled)
  downloads(...)                                                               desktop-native
  download_headers(profile, content_id, api_name, url, type, name, poster, cache_time)

JSON documents
  settings.json          the ~100 flat keys, values preserved verbatim
  quality_profiles.json  the 7 profiles
  subtitle_style.json    SaveCaptionStyle
  window_state.json      desktop-only

OS keychain
  tracker tokens, subtitle-service credentials
```

Indexes on `(profile, content_id)`, `(profile, kind)`, and `library_items.name` are required to meet the performance targets in [12](12-performance-and-limits.md).

**Requirement DATA-STORE-1 (P0).** Settings values import and export **verbatim**, including keys the desktop app does not understand. Round-tripping an unknown key is how forward compatibility is achieved.

---

## 9. Layer separation (§17 of the brief)

| Layer | Contents | Migrates? |
|---|---|---|
| 1 · User data | Progress, states, bookmarks, favourites, subscriptions, resume, history, profiles | **Yes** |
| 2 · Application settings | The ~100 settings keys | Yes, minus platform-specific |
| 3 · Content metadata | Cached posters, plots, episode lists | No — re-fetchable |
| 4 · Provider configuration | Repositories, pinned providers, overrides, homepage selection | **Yes** |
| 5 · Plugin configuration | Installed plugin records, per-plugin settings | Records no; repositories yes |
| 6 · Playback state | Quality profiles, subtitle style, speed, resize | **Yes** |
| 7 · Download state | Queue, file info, resume packages | No |
| 8 · Cache | HTTP cache, images, tracker list caches | No |
| 9 · Platform state | Paths, window geometry, OS integration | No — desktop-only |

Layers 1, 2, 4, 6 constitute the **portable cross-platform layer**.

---

## Next steps

1. Implement UTIL-1 and validate against JVM vectors before writing any importer code.
2. Obtain real backup files to resolve the §7 "unknown" rows — several are cheap to settle and expensive to guess.
3. Freeze the enum ordinal table (§5) as a constant in code with a test that fails if anyone reorders an enum.
4. Review the §8 schema against [12](12-performance-and-limits.md) targets before Phase 4.
