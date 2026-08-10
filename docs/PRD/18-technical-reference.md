# 18 — Technical Reference

**Generated:** 2026-08-10
**Baseline:** commit `a72f9e6c`

Lookup tables and algorithms. This is the document the migration implementer keeps open.

---

## 1. Data-store key catalogue

Store: `SharedPreferences("rebuild_preference")`. Values are JSON strings. `<p>` = profile index.

| Key pattern | Constant | Value | Transferable |
|---|---|---|---|
| `<p>/video_pos_dur/<id>` | `VIDEO_POS_DUR` | `PosDur` | ✅ |
| `<p>/video_watch_state/<id>` | `VIDEO_WATCH_STATE` | `VideoWatchState` name | ✅ |
| `<p>/result_watch_state/<id>` | `RESULT_WATCH_STATE` | Int (`WatchType.internalId`) | ✅ |
| `<p>/result_watch_state_data/<id>` | `RESULT_WATCH_STATE_DATA` | `BookmarkedData` | ✅ |
| `<p>/result_subscribed_state_data/<id>` | `RESULT_SUBSCRIBED_STATE_DATA` | `SubscribedData` | ✅ |
| `<p>/result_favorites_state_data/<id>` | `RESULT_FAVORITES_STATE_DATA` | `FavoritesData` | ✅ |
| `<p>/result_resume_watching_2/<pid>` | `RESULT_RESUME_WATCHING` | `ResumeWatching` | ✅ |
| `<p>/result_resume_watching/<pid>` | `RESULT_RESUME_WATCHING_OLD` | `ResumeWatching` | ✅ (migrate) |
| `result_resume_watching_migrated` | `RESULT_RESUME_WATCHING_HAS_MIGRATED` | Bool | ✅ |
| `<p>/result_episode/<id>` | `RESULT_EPISODE` | Int | ✅ |
| `<p>/result_season/<id>` | `RESULT_SEASON` | Int | ✅ |
| `<p>/result_dub/<id>` | `RESULT_DUB` | Int (`DubStatus` ordinal) | ✅ |
| `result_sort` | `KEY_RESULT_SORT` | Int | ✅ |
| `<p>/search_history/<key>` | `SEARCH_HISTORY_KEY` | history record | ✅ |
| `<p>/home_api_used` | `USER_SELECTED_HOMEPAGE_API` | String | ✅ |
| `<p>/search_pref_providers` | — | `List<String>` | ✅ |
| `<p>/search_pref_tags` | — | `List<String>` (TvType names) | ✅ |
| `<p>/home_pref_homepage` | — | `List<String>` (TvType names) | ✅ |
| `<p>/home_bookmarked_last_list` | — | `IntArray` | ✅ |
| `<p>/playback_speed` | — | Float (default 1.0) | ✅ |
| `<p>/resize_mode` | — | Int (default 0) | ✅ |
| `<p>/library_sorting_mode` | — | Int ordinal (default 5) | ✅ |
| `<p>/results_sorting_mode` | — | Int ordinal | ✅ |
| `data_store_helper/account` | — | `Account[]` | ✅ |
| `data_store_helper/account_key_index` | — | Int | ✅ |
| `user_pinned_providers` | `USER_PINNED_PROVIDERS` | `String[]` | ✅ |
| `user_custom_sites` | `USER_PROVIDER_API` | provider overrides | ✅ |
| `REPOSITORIES_KEY` | — | `RepositoryData[]` | ✅ |
| `PREBUILT_REPOSITORIES` | — | `RepositoryData[]` | ✅ |
| `subtitle_settings` | `SUBTITLE_KEY` | `SaveCaptionStyle` | ✅ |
| `chome_subtitle_settings` | `CHROME_SUBTITLE_KEY` | `SaveChromeCaptionStyle` | ✅ |
| `subs_auto_select` | `SUBTITLE_AUTO_SELECT_KEY` | String (default `"en"`) | ✅ |
| `subs_auto_download` | `SUBTITLE_DOWNLOAD_KEY` | `List<String>` (default `["en"]`) | ✅ |
| `last_sync_api` | `LAST_SYNC_API_KEY` | String | ✅ |
| `<idPrefix>_sync/<id>` | — | String (URL) | ✅ |
| `video_source_priority` | — | source ranking | ✅ |
| `video_quality_priority` | — | quality ranking | ✅ |
| `video_profile_name` | — | profile names | ✅ |
| `video_profile_types_2` | — | profile types | ✅ |
| `video_profile_settings` | `VIDEO_PROFILE_SETTINGS` | profile settings | ✅ |
| `download_header_cache` | `DOWNLOAD_HEADER_CACHE` | `DownloadHeaderCached` | ✅ **(retained — resume depends on it)** |
| `BACKUP_download_header_cache` | `DOWNLOAD_HEADER_CACHE_BACKUP` | same | ✅ |
| `video_player_alpha_key` | `VIDEO_PLAYER_BRIGHTNESS` | Float | ✅ (inert on desktop) |
| `benene_count` | — | Int | ✅ |
| `PLUGINS_KEY` | — | `PluginData[]` | ❌ |
| `PLUGINS_KEY_LOCAL` | — | `PluginData[]` | ❌ |
| `auth_tokens/<prefix>/<p>` | `ACCOUNT_TOKEN` | `AuthData[]` | ❌ |
| `auth_ids/<prefix>/<p>` | `ACCOUNT_IDS` | Int | ❌ |
| `download_episode_cache` | `DOWNLOAD_EPISODE_CACHE` | `DownloadEpisodeCached` | ❌ |
| `BACKUP_download_episode_cache` | `DOWNLOAD_EPISODE_CACHE_BACKUP` | same | ❌ |
| `download_info` | `KEY_DOWNLOAD_INFO` | `DownloadedFileInfo` | ❌ |
| `download_resume_2` | `KEY_RESUME_PACKAGES` | resume packages | ❌ |
| `download_resume_queue_key` | `KEY_RESUME_IN_QUEUE` | queue resume | ❌ |
| queue key | `QUEUE_KEY` | download queue | ❌ |
| `ANILIST_CACHED_LIST` / `MAL_CACHED_LIST` / `KITSU_CACHED_LIST` | — | tracker caches | ❌ |

**Evidence.** `app/.../utils/DataStore.kt:17-26`; `app/.../utils/DataStoreHelper.kt:47-60`; `app/.../utils/BackupUtils.kt:55-113`; `app/.../ui/subtitles/SubtitlesFragment.kt:61-63`; `app/.../ui/subtitles/ChromecastSubtitlesFragment.kt:44`; `app/.../ui/library/LibraryViewModel.kt:31`; `app/.../ui/search/SearchViewModel.kt:33`; `app/.../ui/player/source_priority/QualityDataHelper.kt:21-31`; `app/.../utils/downloader/DownloadManager.kt:197-204`. **Confidence: High.**

---

## 2. Settings key catalogue

Store: default `SharedPreferences`. Values are native primitives. Names below are the **actual persisted strings**, which differ from their resource ids in several cases.

### General
`app_locale` · `legal_notice_key` · `benene_count` · `download_path_key` ❌ · `download_path_key_visual` ❌ · `download_parallel_key` · `download_concurrent_key` · `battery_optimisation` ⊘ · `override_site_key` · `dns_key` · `jsdelivr_proxy_key` · `redo_setup_key` · `nginx_user` ❌

### Player
`quality_pref_key` · `quality_pref_mobile_data_key` ⊘ · `player_default_key` · `prefer_limit_title_key` · `prefer_title_limit` · `prefer_limit_show_player_info` · `hide_player_control_names_key` · `subtitle_settings_key` · `subtitle_settings_chromecast_key` · `video_buffer_size_key` · `video_buffer_length_key` · `video_buffer_disk_key` · `video_buffer_clear_key` · `software_decoding_key2` · `autoplay_next_key` · `player_source_priority_key` · `player_resize_enabled_key` · `playback_speed_enabled_key` · `pip_enabled_key` · `preview_seekbar_key` · `fast_forward_button_time` · `speedup_key` · `rotate_video_key` ⊘ · `auto_rotate_video_key` ⊘

### Gestures
`swipe_enabled_key` · `swipe_vertical_enabled_key` · `double_tap_enabled_key` · `double_tap_pause_enabled_key` · `double_tap_seek_time_key2` · `use_system_brightness_key` ⊘ · `extra_brightness_enabled` ⊘ · `pref_category_gestures_key`

### Android TV / 10-foot
`pref_category_android_tv_key` · `android_tv_interface_off_seek_key` · `android_tv_interface_on_seek_key` · `tv_layout_clock_key` · `overscan_key`

### Providers
`provider_lang_key` · `prefer_media_type_key_2` · `display_sub_key` · `enable_nsfw_on_providers_key` · `test_providers_key` · `search_providers_list` · `search_type_list`

### UI
`primary_color_key` · `app_theme_key` · `app_layout_key` · `bottom_title_key` · `poster_size_key` · `poster_ui_key` · `show_trailers_key` · `show_kitsu_posters_key` · `show_cast_in_details_key` · `show_fillers_key` · `show_player_metadata_key` · `confirm_exit_key` · `pref_filter_search_quality_key` · `random_button_key` · `show_hd_key` · `show_dub_key` · `show_sub_key` · `show_rating_key` · `show_title_key` · `show_episode_text_key` · `show_name` · `show_resolution` · `show_media_info`

### Subtitles
`subtitles_encoding_key` · `filter_sub_lang_key`

### Updates & backup
`auto_update` · `skip_update_key` · `install_prerelease_key` · `manual_check_update` · `apk_installer_key` ⊘ · `backup_key` · `automatic_backup_key` · `restore_key` · `backup_path_key` ❌ · `backup_dir_key` · `auto_update_plugins` · `auto_download_plugins_key2` ❌ · `manual_update_plugins` · `show_logcat_key` · `log_enabled_key`

### Accounts & security
`mal_key` · `kitsu_key` · `anilist_key` · `simkl_key` · `opensubtitles_key` · `subdl_key` · `animeskip_key` · `skip_startup_account_select_key` · `biometric_key` ❌ · `pref_category_security_key` · `episode_sync_enabled_key`

**Legend.** ❌ = excluded from backup · ⊘ = no desktop meaning; preserved but inert.

**Evidence.** `app/src/main/res/values/donottranslate-strings.xml` (definitive key→value mapping); `app/src/main/res/xml/settings_*.xml` (screen membership); `app/.../utils/BackupUtils.kt:55-113` (exclusions). **Confidence: High.**

**Requirement.** The desktop app **preserves every settings key verbatim**, including ones it does not understand. Unknown keys round-trip through export unchanged.

---

## 3. Backup file format (Android)

**Filename.** `CS3_Backup_<yyyy_MM_dd_HH_mm>.<ext>`, default extension `txt`.
**Location.** `backup_path_key` if set, else the platform Downloads directory.
**Content type on restore.** Accepts `text/plain`, `text/str`, `text/x-unknown`, `application/json`, `unknown/unknown`, `content/unknown`, `application/octet-stream`.

**Structure.**
```
{
  "datastore": {
    "_Bool":      { "<key>": true|false, ... },
    "_Int":       { "<key>": 0, ... },
    "_String":    { "<key>": "…", ... },
    "_Float":     { "<key>": 0.0, ... },
    "_Long":      { "<key>": 0, ... },
    "_StringSet": { "<key>": ["…"], ... }
  },
  "settings": { … same six buckets … }
}
```

**Notes that matter.**
- Every bucket is **nullable**. A backup may omit any of them.
- There is **no version field**, no app version, no platform marker.
- `datastore` values are JSON *strings* containing nested JSON — double-encoded. `settings` values are native primitives.
- Bucketing is by runtime type at export; a value must be restored into the same bucket or Android's typed getters will fail on read.
- Restore is a blind merge followed by `activity.recreate()`.

**Evidence.** `app/.../utils/BackupUtils.kt:123-166, 200-235, 249-317`. **Confidence: High.**

---

## 4. Download subsystem reference

| Constant | Value | Meaning |
|---|---|---|
| `DOWNLOAD_PARTIAL_MIN_SIZE` | 52,428,800 (50 MiB) | Threshold for partial/segmented handling |
| `UPDATE_RATE_MS` | 1,000 | Notification/progress update interval |
| `KEY_RESUME_PACKAGES` | `download_resume_2` | Resume package storage |
| `KEY_DOWNLOAD_INFO` | `download_info` | File info storage |
| `KEY_RESUME_IN_QUEUE` | `download_resume_queue_key` | Queue resume flag |
| `DOWNLOAD_CHANNEL_ID` | `cloudstream3.general` | Notification channel |
| `EXTENSIONS_CHANNEL_ID` | `cloudstream3.extensions` | Notification channel |
| `SUBSCRIPTION_CHANNEL_ID` | `cloudstream3.subscriptions` | Notification channel |
| `BACKUP_CHANNEL_ID` | `cloudstream3.backups` | Notification channel |
| `SUBSCRIPTION_NOTIFICATION_ID` | 938712897 | — |
| `BACKUP_NOTIFICATION_ID` | 938712898 | — |
| Subscription poll interval | 6 hours | `PeriodicWorkRequest(…, 6, TimeUnit.HOURS)` |

**Download states.** `DownloadStatus{retrySame, tryNext, success}` drives retry policy: retry the same source, try the next mirror, or accept.

**Evidence.** `app/.../utils/downloader/DownloadManager.kt:109-204, 683`; `app/.../utils/downloader/DownloadObjects.kt:184-201`; `app/.../services/SubscriptionWorkManager.kt:29-46`; `app/.../services/BackupWorkManager.kt:20-24`; `app/.../plugins/PluginManager.kt:73-75`. **Confidence: High.**

---

## 5. Path portability rules

### 5.1 Path classification

| Class | Definition | Migration behavior |
|---|---|---|
| **Portable logical** | Relative, app-relative, or symbolic (`{downloads}/Show/S01E01.mp4`) | Migrate as-is |
| **Platform-specific** | Absolute, or an Android SAF `content://` URI | **Do not migrate.** Reset to the desktop default and report |
| **User-configured** | A directory the user chose | Do not migrate; prompt the user to re-select |
| **Generated** | Derived from app data + a name | Recompute on the target platform |

### 5.2 Rules

| ID | Rule | Priority |
|---|---|---|
| PATH-1 | Never write an Android path into desktop storage. All five path keys (`download_path_key`, `download_path_key_visual`, `backup_path_key`, `backup_dir_path_key`, and any plugin `filePath`) are reset on import and reported. | P0 |
| PATH-2 | Desktop exports store **logical** paths where possible: a root token plus a relative remainder. | P0 |
| PATH-3 | Every imported path-like value is validated for traversal (`..`, absolute roots, UNC, `file://`) before use. | P0 |
| PATH-4 | Filename sanitization is identical across platforms so a download directory is portable. | P0 |
| PATH-5 | Windows: reject/replace `< > : " / \ | ? *`; handle reserved device names (`CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`) **including with extensions**; strip trailing dots and spaces; respect `MAX_PATH` unless long paths are enabled. | P0 |
| PATH-6 | macOS: `:` is path-separator-hostile in Finder; normalize Unicode to NFC on write to avoid NFD/NFC duplicates. | P1 |
| PATH-7 | Linux: only `/` and NUL are forbidden, but do not generate names that are invalid on the other two platforms. | P1 |
| PATH-8 | Case-insensitivity on Windows/macOS means `Show` and `show` collide where they do not on Linux; detect and disambiguate. | P1 |
| PATH-9 | Path length budgets are checked before writing, not after failing. | P1 |

### 5.3 Android storage → desktop equivalents

| Android | Windows | macOS | Linux |
|---|---|---|---|
| `context.filesDir` | `%APPDATA%\<App>` | `~/Library/Application Support/<App>` | `~/.config/<app>` |
| `context.cacheDir` | `%LOCALAPPDATA%\<App>\Cache` | `~/Library/Caches/<App>` | `~/.cache/<app>` |
| `Environment.getExternalStorageDirectory()/Cloudstream3/` | `%USERPROFILE%\Documents\<App>` | `~/Documents/<App>` | `~/.local/share/<app>` |
| `filesDir/Extensions/` | `%APPDATA%\<App>\extensions` | `…/Application Support/<App>/extensions` | `~/.local/share/<app>/extensions` |
| `MediaFileContentType.Downloads` | `%USERPROFILE%\Downloads\<App>` | `~/Downloads/<App>` | `$XDG_DOWNLOAD_DIR/<app>` |
| SAF `content://` URI | — | — | — (no analogue; native paths) |

**Evidence.** `app/.../plugins/PluginManager.kt:185-187, 747-756`; `app/.../plugins/RepositoryManager.kt:99, 260`; `app/.../utils/BackupUtils.kt:323-347`. **Confidence: High** for Android; **High** for the desktop conventions (platform standards).

---

## 6. Algorithms to reproduce exactly

### 6.1 Java string hash
```
h = 0
for each UTF-16 code unit c in s:
    h = (31 * h + c) mod 2^32, interpreted as signed 32-bit
return h
```
Empty string → 0. In JavaScript: `h = (Math.imul(31, h) + s.charCodeAt(i)) | 0`. Iterate with an index over `s.length` (UTF-16 units), **not** `for…of` (code points).

### 6.2 Content id
```
id = javaHash( url.replaceAll(providerMainUrl, "").replaceAll("/", "") )
```
Both replacements are literal (not regex) and applied in that order. If the provider is not resolvable, `providerMainUrl` is `""`.

### 6.3 `fixVisual`
```
if duration <= 0            → (0, duration)
pct = position * 100 / duration        [integer division]
if pct <= 1                 → (0, duration)
if pct <= 5                 → (5 * duration / 100, duration)
if pct >= 95                → (duration, duration)
otherwise                   → unchanged
```
Integer division is significant — reproducing this with floating-point division changes boundary behavior.

### 6.4 Progress write guard
```
if duration < 30_000 ms: do not persist
```

### 6.5 Non-transferable filter
```
isTransferable(key) = NOT nonTransferableKeys.any { key.contains(it) }
```
**Substring**, not equality.

### 6.6 Plugin filename
```
sanitizeFilename(name, allowDot = true) + "." + javaHash(name)
```

### 6.7 Plugin install path
```
<appData>/Extensions/<sanitized(repositoryUrl)>.<javaHash(repositoryUrl)>/<sanitized(internalName)>.<javaHash(internalName)>.cs3
```
This path **is** the installed-detection mechanism — `validOnlineData()` compares it against the stored `filePath`.

### 6.8 SHA-256 for plugin verification
```
"sha256-" + lowercase_hex(sha256(fileBytes))
```

### 6.9 jsDelivr rewrite
```
match ^https://raw.githubusercontent.com/([A-Za-z0-9-]+)/([A-Za-z0-9_.-]+)/(.*)$
  → https://cdn.jsdelivr.net/gh/$1/$2@$3
```
Applied only when `jsdelivr_proxy_key` is true; otherwise the URL is returned unchanged.

### 6.10 Repository URL grammar
```
matches ^https?://           → use as-is
matches ^(cloudstreamrepo://)|(https://cs\.repo/\??)
                             → strip prefix, prepend https:// if needed
matches ^[a-zA-Z0-9!_-]+$    → short code:
     starts with "!"         → GET https://py.md/<code>, no redirects, read Location
                               reject if Location starts with https://py.md/404
                               reject if Location (sans trailing /) == https://py.md
     otherwise               → GET https://cutt.ly/<code>, same treatment with cutt.ly sentinels
otherwise                    → invalid
```

### 6.11 `csshare://` grammar
```
csshare:<base64(apiName)>?<base64(url)>
```
Note the ordering: **apiName before `?`, url after**.

### 6.12 `ExtractorLinkType` inference
```
path ends ".m3u8"     → M3U8
path ends ".mpd"      → DASH
path ends ".torrent"  → TORRENT
url starts "magnet:"  → MAGNET
otherwise             → VIDEO
```

**Evidence.** §6.1–6.2 `ResultViewModel2.kt:370-380`; §6.3–6.4 `DataStoreHelper.kt:249-258, 691-695`; §6.5 `BackupUtils.kt:116-118`; §6.6–6.7 `PluginManager.kt:233-243, 737-756`; §6.8 `RepositoryManager.kt:107-122`; §6.9 `RepositoryManager.kt:103-130`; §6.10 `RepositoryManager.kt:132-159`; §6.11 `MainActivity.kt:383-396`; §6.12 `ExtractorApi.kt:445-458`. **Confidence: High.**

---

## 7. Enum reference

Frozen values. See [06](06-data-models.md) §5 for persistence conventions.

**`WatchType`** (internalId): 0 WATCHING · 1 COMPLETED · 2 ONHOLD · 3 DROPPED · 4 PLANTOWATCH · 5 NONE
**`SyncWatchType`** (internalId): −1 NONE · 0 WATCHING · 1 COMPLETED · 2 ONHOLD · 3 DROPPED · 4 PLANTOWATCH · 5 REWATCHING
**`ListSorting`** (ordinal): 0 Query · 1 RatingHigh · 2 RatingLow · 3 UpdatedNew · 4 UpdatedOld · 5 AlphabeticalA · 6 AlphabeticalZ · 7 ReleaseDateNew · 8 ReleaseDateOld
**`TvType`** (name; declared value in parentheses): Movie(1) AnimeMovie(2) TvSeries(3) Cartoon(4) Anime(5) OVA(6) Torrent(7) Documentary(8) AsianDrama(9) Live(10) NSFW(11) Others(12) Music(13) AudioBook(14) CustomMedia(15) Audio(16) Podcast(17) Video(18)
**`ExtractorLinkType`**: VIDEO · M3U8 · DASH · TORRENT · MAGNET
**`VideoWatchState`**: None · Watched
**`ProviderType`**: DirectProvider · MetaProvider
**`VPNStatus`**: None · …
**`ShowStatus`** · **`SearchQuality`** · **`DubStatus`** · **`AutoDownloadMode`** · **`SelectType`** · **`SelectValue`** · **`ActorRole`** · **`TrackerType`** · **`SimklSyncServices`** — see `MainAPI.kt` at the line ranges in [07](07-apis-and-contracts.md) §3.3.

**Layout constants:** `PHONE = 0b001`, `TV = 0b010`, `EMULATOR = 0b100`; stored `app_layout_key` values `-1` auto, `0` phone, `1` TV, `2` emulator.

**Plugin version sentinels:** `PLUGIN_VERSION_NOT_SET = Int.MIN_VALUE`, `PLUGIN_VERSION_ALWAYS_UPDATE = -1`.
**Plugin status codes:** 0 Down · 1 Ok · 2 Slow · 3 Beta-only.
**Quality profiles:** `PROFILE_COUNT = 7`, `DEFAULT_SOURCE_PRIORITY = 1`, `AUTO_SKIP_PRIORITY = 10`.
**Subtitle default:** `DEF_SUBS_ELEVATION = 20`.
**Account sentinel:** `NONE_ID = -1`.

---

## 8. Deep-link schemes

| Scheme | Purpose |
|---|---|
| `cloudstreamapp://` | OAuth redirects; bare `cloudstreamapp:` triggers local plugin hot-reload |
| `cloudstreamplayer://<urlencoded url>?name=…` | Direct playback |
| `cloudstreamrepo://<host/path>` | Add repository |
| `https://cs.repo/?<url>` | Add repository (web-clickable) |
| `cloudstreamsearch://<urlencoded query>` | Search |
| `cloudstreamcontinuewatching://<id>` | Resume a specific item |
| `csshare:<b64 apiName>?<b64 url>` | Share a title |

**Evidence.** `app/src/main/AndroidManifest.xml:180-243`; `app/.../MainActivity.kt:281-400`. **Confidence: High.**

---

## 9. Subtitle MIME support

| MIME | Parser | Desktop backend |
|---|---|---|
| `text/vtt` | WebVTT | Both |
| `application/x-subrip` | Custom SRT (tolerant) | Both |
| `text/x-ssa` | SSA/ASS | Native preferred (styling fidelity) |
| `application/ttml+xml` | TTML | Both |
| `application/x-mp4-vtt` | MP4 WebVTT | Both |
| `application/x-quicktime-tx3g` | TX3G | Native |
| `application/dvbsubs` | DVB bitmap | **Native only** |
| `application/pgs` | PGS bitmap | **Native only** |
| CEA-608 / CEA-708 | Commented out upstream | Not required for parity |

**Evidence.** `app/.../ui/player/CustomSubtitleDecoderFactory.kt:250-280, 365-380`. **Confidence: High.**

---

## Next steps

1. Encode §6 as a single, heavily tested compatibility module. Do not scatter these algorithms.
2. Encode §7 as frozen constants with a guard test.
3. Verify §2 against a real backup to catch any key the resource files do not reveal.
