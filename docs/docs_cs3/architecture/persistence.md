# Persistence, History, Library and Backup

## 1. Where data lives

| Mechanism | File | Contents |
|---|---|---|
| `DatastoreManager` (`datastore.ts`) | `cs3_datastore.json` | Android-compatible 6-bucket key grammar (`_Bool/_Int/_String/_Float/_Long/_StringSet`) so Android backups import losslessly; preferences, library, played sources, progress, source cache, probe findings, title outcomes/visits, scope, profiles, disabled sets, provider origins, queue |
| Standalone stores | `cs3-*.json`, `page-snapshots.json`, `saved-searches.json`, `dht-nodes.json` | see [caching.md](caching.md#1-inventory) |
| Logs | `userData/logs/` | NDJSON per launch (`logging/logger.ts`), buffered, rotated; `redact.ts` |
| Extensions | `userData/extensions/<repo-dir>/…` | archives (+ `.previous` rollback copy), displaced archives |
| Runtime | `userData/cs3-runtime/` | provisioned sidecar + provider runtime + `runtime-stamp.json` |
| Downloads | user's `Downloads/CloudStream/…` (Movies/Series/Subtitles) | media files, `.part`, sidecar info files |

Key datastore keys (non-exhaustive, from the code): `cs3_adult_content_mode`, `cs3_content_regions`,
`cs3_disabled_{providers,extensions,repositories,native_providers}`, `cs3_provider_origins`, `cs3_known_plugins`,
`cs3_search_scope`, `cs3_source_profiles`, `cs3_provider_search_concurrency`, `cs3_stremio_addons`,
`cs3_media_servers`, `cs3_network_settings`, `cs3_title_outcomes`, `cs3_title_visits`, `source_cache_v1`,
`media_history_events_v1`, `native_engine_policy`, `incognito_*`.

Non-transferable keys (tokens, device ids, cache paths) are filtered on import by regex and on export by `snapshot`.

## 2. What is stored, and what is not

| Data | Store | Notes |
|---|---|---|
| **Library** (`libraryStore.ts`) | datastore | entries keyed `canonicalKey(title, year)` + season/episode — never a URL; watch buckets Watching, Completed, On hold, Plan to watch, Dropped (`LibraryBucketSelector`); per-title stored sources (≤30) |
| **Played source** | datastore (≤400) | one slot per (title, season, episode); recorded after **10 s** of real playback; link stored but *identity is the durable triple* |
| **Progress / Continue Watching** | datastore (≤500 rows) | resume floor 30 s; null episode means "Play"; furthest episode with history wins |
| **History** (`cs3/historyStore.ts`) | datastore `media_history_events_v1` | event log (≤10,000): played, playback failed, downloaded, download failed, attempted, unchecked; paged ≤200/request (`history:*`) |
| **Search history** | datastore (≤50) | queries only |
| **Saved searches** | `saved-searches.json` | rows are page addresses |
| **Bookmarks** (`cs3/bookmarkStore.ts`) | datastore (≤2,000) | detail *pages* with provider/extension/repository/query; resolved links are not stored (they expire) |
| **Page snapshots** | `page-snapshots.json` (≤600) | last-known-good detail copy + routes + origin; a later load may add/correct but never blank |
| **Title outcomes / visits** | datastore | how each title last behaved; visited marker; `interactions:clearVisits` is the only control |
| **Provider analytics** | `cs3-provider-analytics.json` | aggregates only — no queries, titles or history |
| **Subtitles** | `Downloads/CloudStream/Subtitles` `.vtt` | indexed by work, never by stream URL |
| **Settings** | datastore | UI preference levels (Simple/Everything) live in `localStorage`, deliberately not in backups |

Deliberately **not** persisted: the adult unlock (memory only), resolved links in bookmarks, proxy routes, in-flight
sessions, anything in Incognito, `.cs3` archives and media in backups, diagnostics/logs/caches in backups.

## 3. Incognito (PRD-52) {#incognito}
`cs3/privacyMode.ts`. `isPrivateSession()` is checked **at write time** by every automatic-activity store
(`historyStore`, `libraryStore` ×13, search history, played source, title outcomes/visits, analytics, bookmark/page
snapshots where automatic, probe store, diagnostics). Private state lives in memory and dies with the process
(`SourceCache.setVolatileMode`). Settings (`incognito_*`): `allowDownloads` (default true), `askBeforeDownload`,
`allowExplicitSaves` (default true; bookmarks and bucket selection stay available), `rememberPreference`, `clearSessionOnExit`.
Toggle: Navbar button, File → Incognito, `Ctrl+Shift+N`; `privacy:getState/setActive/updateSettings`, push `privacy:changed`.

## 4. Backup and restore {#backup-and-restore}
`cs3/backupService.ts` + `backupSections.ts`: **a table of sections**, so a store cannot be half-added.
Sections seen in the table: library (entries, played, sources), continueWatching, history, bookmarks (pages, content),
searchHistory, savedSearches, downloads (tasks; export-only), titleOutcomes, indexers, providerPreferences, settings,
repositories, extensions (plugins, origins), extensionSwitches. Channels: `backup:export`, `backup:inspect`,
`backup:restore`, `backup:undoRestore`. Restore **merges** (a preference added since the backup does not revert), takes
a pre-restore snapshot (`before-restore.json`), records a section that throws while the rest restore, and refuses an unrelated JSON by its
format marker. `datastore:exportBackup` writes the **Android** format separately for phone↔desktop moves.
Review UI: `BackupPanel.tsx`, `restoreReview.ts`.

## 5. Distinguishing data kinds
| Kind | Examples |
|---|---|
| Persistent user-created | bookmarks, library buckets, saved searches, settings |
| Persistent automatic | history, progress, played source, outcomes, analytics, source/detail caches |
| Temporary/cached | all `cs3-*-cache.json`, probe findings |
| Volatile session | playback/search sessions, proxy routes, adult unlock, Incognito data |
