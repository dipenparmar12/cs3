# 24 — Feature Parity Matrix

**Generated:** 2026-08-10
**Baseline:** commit `a72f9e6c`

Every meaningful Android feature, classified. Full specifications in [03](03-feature-specifications.md).

**Classification:** `Parity` required · `Adapt` desktop adaptation required · `Enhance` desktop enhancement · `Android-only` · `Desktop-only` · `Unsupported` · `Investigate`

**Strategy:** R1 reimplement natively · R2 Electron/Node equivalent · R3 browser/Web API · R4 desktop UX, same behavior · R5 alternative workflow · R6 unsupported

**Status:** all rows are `Specified` at this baseline; the column tracks implementation as the project proceeds.

---

## Setup and onboarding

| Feature | Android behavior | Desktop requirement | Strategy | Data impact | Platform difference | Class | Prio |
|---|---|---|---|---|---|---|---|
| FEAT-SETUP-1 Setup wizard | 5 fragments; re-runnable | Same + an import step | R4 | 4 settings keys | Layout step reframed | Adapt | P1 |
| FEAT-SETUP-2 Layout mode | Phone/TV/Emulator, auto-detected | Desktop / 10-foot; key preserved | R4 | `app_layout_key` | No auto-TV detection | Adapt | P1 |
| FEAT-SETUP-3 Localization | ~100 locales via Weblate | Same catalogue, same key | R2 | `app_locale` | Resource system differs | Parity | P1 |

## Accounts and profiles

| Feature | Android | Desktop | Strategy | Data | Platform | Class | Prio |
|---|---|---|---|---|---|---|---|
| FEAT-ACCT-1 Local profiles | Index-prefixed key scoping | Identical model and keys | R1 | All `<p>/*` | None | Parity | P1 |
| FEAT-ACCT-2 PIN + biometrics | Plaintext PIN; `BiometricPrompt` | PIN + OS credential; none on Linux | R4 | `account.lockPin`; `biometric_key` ❌ | Biometric availability | Adapt | P2 |
| FEAT-ACCT-3 Create/edit profile | Name + avatar index 0–6 | Same; custom image copied in | R1 | `account` | Avatar assets | Parity | P1 |
| FEAT-ACCT-4 Delete profile | Removes the entry | Same + orphan warning | R1 | `<p>/*` | None | Parity | P2 |
| FEAT-ACCT-5 Skip startup selector | Preference | Same | R1 | Settings | None | Parity | P2 |

## Home

| Feature | Android | Desktop | Strategy | Data | Platform | Class | Prio |
|---|---|---|---|---|---|---|---|
| FEAT-HOME-1 Provider homepage | `getMainPage`, sequential mode | Same contract, responsive grid | R1 | `home_api_used` | Pull-to-refresh → button | Adapt | **P0** |
| FEAT-HOME-2 Continue watching | Progress cards, long-press remove | Hover + right-click | R4 | resume, progress | Interaction | Adapt | **P0** |
| FEAT-HOME-3 Bookmarks row | Filtered by watch types | Same + multi-select filter | R1 | `home_bookmarked_last_list` | None | Parity | P1 |
| FEAT-HOME-4 Media-type filter | TvType list | Same | R1 | `home_pref_homepage` | None | Parity | P1 |
| FEAT-HOME-5 Random button | Toggle | Same + shortcut | R1 | Settings | None | Parity | P3 |

## Search

| Feature | Android | Desktop | Strategy | Data | Platform | Class | Prio |
|---|---|---|---|---|---|---|---|
| FEAT-SEARCH-1 Multi-provider search | Parallel, per-provider timeouts | Same + incremental render | R1 | search prefs, history | Layout | Adapt | **P0** |
| FEAT-SEARCH-2 Quick search | `quickSearch` dropdown | Combobox | R1 | — | None | Parity | P1 |
| FEAT-SEARCH-3 Filters | Provider + type | Persistent panel | R4 | search prefs | Layout | Adapt | P1 |
| FEAT-SEARCH-4 Search history | Per-profile keys | Same + right-click | R1 | `<p>/search_history/*` | None | Parity | P1 |
| FEAT-SEARCH-5 Quality-badge filter | Preference | Same | R1 | Settings | None | Parity | P2 |
| FEAT-SEARCH-6 Sync-provider search | Tracker search | Distinct tab | R1 | — | None | Parity | P2 |

## Result / detail

| Feature | Android | Desktop | Strategy | Data | Platform | Class | Prio |
|---|---|---|---|---|---|---|---|
| FEAT-RESULT-1 Detail page | `load()` + local state merge | Two-column layout | R1 | season/episode/dub/sort | Layout | Adapt | **P0** |
| FEAT-RESULT-2 Episodes & seasons | List with progress + filler flags | Virtualized sortable table | R4 | — | Layout | Adapt | **P0** |
| FEAT-RESULT-3 Watch state | 6 states; NONE deletes | Identical semantics | R1 | watch state + data | None | Parity | **P0** |
| FEAT-RESULT-4 Favourites | Per-id record | Same | R1 | favourites | None | Parity | P1 |
| FEAT-RESULT-5 Subscriptions | + 6 h new-episode worker | Same + main-process scheduler | R2 | subscriptions | Background execution | Adapt | P1 |
| FEAT-RESULT-6 Episode watched flag | `None` deletes | Identical | R1 | `video_watch_state` | None | Parity | P1 |
| FEAT-RESULT-7 Trailers | NewPipeExtractor | Needs a desktop path | R2 | Settings | Java-only library | Investigate | P2 |
| FEAT-RESULT-8 Cast & recommendations | Actor data | Same | R1 | Settings | None | Parity | P2 |
| FEAT-RESULT-9 Filler marking | anime-db | Same data | R2 | Settings | None | Parity | P3 |

## Library

| Feature | Android | Desktop | Strategy | Data | Platform | Class | Prio |
|---|---|---|---|---|---|---|---|
| FEAT-LIB-1 Library view | Pages from local or tracker | Grid + sort bar + multi-select | R4 | sorting mode, last sync | Layout | Adapt | P1 |
| FEAT-LIB-2 Local aggregation | Bookmarks+favs+subs | Same | R1 | — | None | Parity | P1 |
| FEAT-LIB-3 Library search | Filter | Same + instant | R1 | — | None | Parity | P2 |
| FEAT-LIB-4 Continue-watching mgmt | Remove one/all | Same + bulk | R4 | resume | Interaction | Adapt | P1 |
| FEAT-LIB-5 Watch progress | 30 s guard; `fixVisual` | **Identical thresholds** | R1 | `video_pos_dur` | None | Parity | **P0** |
| FEAT-LIB-6 Resume records | + legacy key migration | Same + same migration | R1 | resume | None | Parity | **P0** |
| FEAT-LIB-7 Bulk actions | Absent | Multi-select bulk ops | — | — | — | **Desktop-only** | P3 |

## Playback

| Feature | Android | Desktop | Strategy | Data | Platform | Class | Prio |
|---|---|---|---|---|---|---|---|
| FEAT-PLAY-1 Link resolution | Streaming callbacks | Same, streamed over IPC | R1 | progress, resume | IPC boundary | Adapt | **P0** |
| FEAT-PLAY-2 Quality profiles | 7 profiles | Same model and keys | R4 | 5 `video_*` keys | Metered detection | Adapt | P1 |
| FEAT-PLAY-3 Transport controls | Touch | + full keyboard | R4 | — | Input | Adapt | **P0** |
| FEAT-PLAY-4 Playback speed | Per-profile Float | Same | R1 | `playback_speed` | None | Parity | P1 |
| FEAT-PLAY-5 Resize mode | Per-profile Int | Same | R1 | `resize_mode` | None | Parity | P1 |
| FEAT-PLAY-6 Resume position | `fixVisual` thresholds | Identical | R1 | `video_pos_dur` | None | Parity | **P0** |
| FEAT-PLAY-7 Autoplay next | Threshold-driven | Same threshold | R1 | resume | None | Parity | P1 |
| FEAT-PLAY-8 Gestures | 5 gesture settings incl. brightness | Mouse equivalents; **no brightness** | R4/R6 | Gesture keys | No brightness API | Adapt | P1 |
| FEAT-PLAY-9 Fullscreen | Immersive | Native + multi-monitor | R4 | — | Window mgmt | Adapt | **P0** |
| FEAT-PLAY-10 PiP | Android PiP | Always-on-top mini-player | R4 | `pip_enabled_key` | Different mechanism | Adapt | P2 |
| FEAT-PLAY-11 Seek thumbnails | ExoPlayer frames | Backend-dependent | R1 | Settings | Extraction differs | Investigate | P2 |
| FEAT-PLAY-12 Audio tracks | Media3 selection | Same UI | R1 | — | Backend | Adapt | P1 |
| FEAT-PLAY-13 Software decoding | nextlib FFmpeg | Backend selection | R4 | `software_decoding_key2` | Different mechanism | Adapt | P1 |
| FEAT-PLAY-14 Buffer config | 4 keys | Mapped to backend | R4 | 4 keys | Backend | Adapt | P2 |
| FEAT-PLAY-15 Rotation | 2 keys | Inert | R6 | 2 keys | N/A on desktop | **Unsupported** | P3 |
| FEAT-PLAY-16 Torrent streaming | In-process Go server | Child-process engine | R2 | — | Process model | Adapt | P2 |
| FEAT-PLAY-17 Intro/outro skip | 3–4 services | Same + shortcut | R1 | — | None | Parity | P2 |
| FEAT-PLAY-18 Metadata overlay | 4 keys | Same | R1 | 4 keys | None | Parity | P3 |

## Subtitles

| Feature | Android | Desktop | Strategy | Data | Platform | Class | Prio |
|---|---|---|---|---|---|---|---|
| FEAT-SUB-1 Rendering & formats | 8 MIME types + charset detection | Text formats both backends; **bitmap native-only** | R1 | — | Backend capability | Adapt | **P0** |
| FEAT-SUB-2 Caption styling | `SaveCaptionStyle` | Same key, equivalent render | R1 | `subtitle_settings` | Rendering engine | Parity | P1 |
| FEAT-SUB-3 Chromecast style | Separate key | Preserved, inert | R6 | `chome_subtitle_settings` | No Cast | **Unsupported** | P3 |
| FEAT-SUB-4 Timing offset | In-player adjust | Same + shortcuts | R4 | — | None | Parity | P2 |
| FEAT-SUB-5 Auto-download | 4 services | Same | R1 | `subs_auto_download` | None | Parity | P1 |
| FEAT-SUB-6 Auto-select | Single tag | Same | R1 | `subs_auto_select` | None | Parity | P1 |
| FEAT-SUB-7 Language filter | Preference | Same | R1 | Settings | None | Parity | P2 |

## Downloads

| Feature | Android | Desktop | Strategy | Data | Platform | Class | Prio |
|---|---|---|---|---|---|---|---|
| FEAT-DL-1 Download queue | Services + notifications | Main-process service | R2 | Download keys ❌ | Process model, SAF | Adapt | P1 |
| FEAT-DL-2 Storage location | SAF content URI | Native folder picker | R2 | Path keys ❌ | **Not migratable** | Adapt | P1 |
| FEAT-DL-3 Downloads browser | List | Same + reveal in folder | R4 | — | OS integration | Adapt | P1 |
| FEAT-DL-4 Offline playback | Local file generator | Same | R1 | — | None | Parity | P1 |
| FEAT-DL-5 Queue UI | Fragment | Panel + drag reorder | R4 | — | Interaction | Adapt | P2 |
| FEAT-DL-6 Auto-download | `AutoDownloadMode` | Same | R1 | — | None | Parity | P2 |
| FEAT-DL-7 Download button | Custom view | Equivalent component | R4 | — | None | Parity | P2 |
| FEAT-DL-8 Disk-space checks | Implicit | Explicit pre-flight + monitoring | — | — | — | **Desktop-only** | P1 |
| FEAT-DL-9 Metadata sidecars | Absent | Per-directory metadata | — | — | — | **Desktop-only** | P3 |

## Extensions

| Feature | Android | Desktop | Strategy | Data | Platform | Class | Prio |
|---|---|---|---|---|---|---|---|
| FEAT-EXT-1 Repositories | 4 URL forms, jsDelivr rewrite | Identical grammar | R1 | `REPOSITORIES_KEY` ✅ | None | Parity | **P0** |
| FEAT-EXT-2 Install/update/load | DEX via `PathClassLoader` | **Drop-in** — lifecycle and install-path grammar preserved exactly; DEX translated at install, run on a bundled JVM sidecar ([31](31-cs3-dropin-compatibility.md)) | R1 | `PLUGINS_KEY` ✅ | Sandbox mechanism only (XP-0d) | **Parity** | **P0** |
| FEAT-EXT-2a Plugin settings (`openSettings`) | Android View / Dialog | Declarative schema; hand-built View UI disabled with an explanation (DROP-18/19) — **~2.7% of providers** | R4 | — | **Fundamental** | Adapt | P1 |
| FEAT-EXT-2b Plugin compatibility tiering | None — Android just loads it | Analyzer assigns T1–T4 at install, re-verified on first call; surfaced in the Extension Manager (DROP-28/29) | desktop-only | — | None | Desktop-only | **P0** |
| FEAT-EXT-2c `WebViewResolver` / `CloudflareKiller` | Android `WebView` | Offscreen `BrowserWindow` per plugin session (DROP-13..17). Upstream's JVM actual is a `TODO` stub, so this is net-new | R2 | — | Reimplementation | Adapt | **P0** |
| FEAT-EXT-3 Plugin browser | Two fragments | Two-pane | R4 | — | Layout | Adapt | P1 |
| FEAT-EXT-4 Voting | `VotingApi` | Same | R1 | — | None | Parity | P3 |
| FEAT-EXT-5 Auto-update | On start | + scheduled | R2 | Settings | Background | Adapt | P1 |
| FEAT-EXT-6 Auto-download missing | Preference ❌ | Same, still excluded | R2 | Settings ❌ | None | Parity | P2 |
| FEAT-EXT-7 Manual update | Action | Same | R1 | — | None | Parity | P2 |
| FEAT-EXT-8 Provider override | `ProvidersInfoJson` | Same | R1 | `user_custom_sites` ✅ | None | Parity | P2 |
| FEAT-EXT-9 Provider pinning | String array | Same | R1 | `user_pinned_providers` ✅ | None | Parity | P2 |
| FEAT-EXT-10 Provider testing | In-app tool | Same, more valuable | R1 | — | None | Parity | P2 |

## Sync and trackers

| Feature | Android | Desktop | Strategy | Data | Platform | Class | Prio |
|---|---|---|---|---|---|---|---|
| FEAT-SYNC-1 Account linking | OAuth via custom scheme | System browser + handler/loopback | R4 | Tokens ❌ | Keychain; protocol reliability | Adapt | P1 |
| FEAT-SYNC-2 Tracker library | `SyncAPI.Page` | Same | R1 | — | None | Parity | P1 |
| FEAT-SYNC-3 Progress push | Preference | Same | R1 | Settings | None | Parity | P1 |
| FEAT-SYNC-4 Sync-id mapping | `<prefix>_sync/<id>` | Same | R1 | ✅ | None | Parity | P1 |
| FEAT-SYNC-5 Cached lists | 3 caches ❌ | Same, excluded | R1 | ❌ | None | Parity | P2 |
| FEAT-SYNC-6 Subtitle accounts | 4 services | Same | R1 | Tokens ❌ | Keychain | Adapt | P1 |

## Settings

| Feature | Android | Desktop | Strategy | Class | Prio |
|---|---|---|---|---|---|
| FEAT-SET-1 General | `settings_general.xml` | Same minus battery optimization | R4 | Adapt | P1 |
| FEAT-SET-2 Player | `settings_player.xml` | Same; buffers → backend | R4 | Adapt | P1 |
| FEAT-SET-3 Providers | `settings_providers.xml` | Same | R1 | Parity | P1 |
| FEAT-SET-4 UI | `settings_ui.xml` | Same + OS theme following | R4 | Adapt | P1 |
| FEAT-SET-5 Updates & backup | `settings_updates.xml` | APK installer → update channel | R4 | Adapt | P1 |
| FEAT-SET-6 Accounts | `settings_account.xml` | Same | R4 | Adapt | P1 |
| FEAT-SET-7 Gestures | Gesture group | Mouse/keyboard; brightness inert | R4 | Adapt | P2 |
| FEAT-SET-8 Android TV | TV group | Under 10-foot mode | R4 | Adapt | P2 |
| FEAT-SET-9 Security | Security group | Same | R4 | Parity | P2 |
| FEAT-SET-10 Card display | 9 keys | Same | R1 | Parity | P2 |
| FEAT-SET-11 Easter egg | `benene_count` | Preserved (it is user data) | R1 | Parity | P3 |
| FEAT-SET-12 Settings search | Absent | Searchable settings | — | **Desktop-only** | P3 |

## Network

| Feature | Android | Desktop | Strategy | Class | Prio |
|---|---|---|---|---|---|
| FEAT-NET-1 HTTP client | NiceHttp/OkHttp | Node stack, same semantics | R2 | Adapt | **P0** |
| FEAT-NET-2 DoH | `dns_key` | Same | R2 | Parity | P2 |
| FEAT-NET-3 WebView resolution | `WebViewResolver` | Offscreen isolated window | R3 | Adapt | P1 |
| FEAT-NET-4 JS execution | Rhino; Zipline staged | Native JS, sandboxed | R3 | Adapt | P1 |

## Backup and migration

| Feature | Android | Desktop | Strategy | Class | Prio |
|---|---|---|---|---|---|
| FEAT-BKP-1 Manual backup | Versionless JSON | Both formats | R1 | Parity | **P0** |
| FEAT-BKP-2 Restore | Blind merge + `recreate()` | Full validated pipeline | R1 | **Enhance** | **P0** |
| FEAT-BKP-3 Automatic backup | `BackupWorkManager` | Scheduler + retention | R2 | Adapt | P2 |
| FEAT-BKP-4 Backup location | Path keys ❌ | Native picker | R2 | Adapt | P2 |
| FEAT-BKP-5 Exclusion filter | Substring matching | **Identical semantics** | R1 | Parity | **P0** |

## Updates, sharing, external targets, diagnostics

| Feature | Android | Desktop | Strategy | Class | Prio |
|---|---|---|---|---|---|
| FEAT-UPD-1 In-app update | GitHub API + APK install | `electron-updater` | R2 | Adapt | P1 |
| FEAT-UPD-2 Prerelease channel | Product flavor | Update channel | R4 | Adapt | P2 |
| FEAT-UPD-3 Manual check | Action | Same | R1 | Parity | P2 |
| FEAT-SHARE-1 Share a title | `csshare://` grammar | Identical grammar | R1 | Parity | P2 |
| FEAT-SHARE-2 Protocol handlers | 6 schemes + cs.repo | All registered | R2 | Adapt | P1 |
| FEAT-SHARE-3 File associations | Video, magnet, torrent | Same per OS | R2 | Adapt | P2 |
| FEAT-SHARE-4 Search deep link | Scheme | Same | R1 | Parity | P3 |
| FEAT-CAST-1 Chromecast | Cast SDK | **None**; DLNA/FCast alternative | R5/R6 | **Unsupported** | P2 |
| FEAT-CAST-2 External players | 16 action packages | Desktop equivalents | R4 | Adapt | P1 |
| FEAT-CAST-3 FCast | Protocol implementation | Same | R2 | Parity | P2 |
| FEAT-CAST-4 TV watch-next EPG | `WRITE_EPG_DATA` | **None** | R6 | **Unsupported** | P3 |
| FEAT-DIAG-1 Log viewer | Logcat | Own logs, redacted | R4 | Adapt | P2 |
| FEAT-DIAG-2 Crash reporting | ACRA | Opt-in, off by default | R4 | Adapt | P2 |
| FEAT-DIAG-3 Provider self-test | In-app tool | Same | R1 | Parity | P2 |

---

## Summary

| Class | Count | Note |
|---|---|---|
| Parity | ~44 | Direct behavioral reproduction |
| Adapt | ~40 | Same behavior, desktop mechanism |
| Desktop-only | 4 | FEAT-LIB-7, FEAT-DL-8, FEAT-DL-9, FEAT-SET-12 |
| Unsupported | 4 | FEAT-PLAY-15, FEAT-SUB-3, FEAT-CAST-1, FEAT-CAST-4 |
| Investigate | 2 | FEAT-RESULT-7 (trailers), FEAT-PLAY-11 (thumbnails) |
| Android-only | 0 | Everything Android-only became Unsupported with a documented reason |

**P0 features: 20.** These define the release-blocking surface.

**Legend.** ✅ transferable in backup · ❌ excluded from backup.

---

## Next steps

1. Track the Status column per feature from Phase 5 onward.
2. Resolve the two `Investigate` rows in Phase 7 and Phase 12.
3. Confirm the four `Unsupported` rows with the sponsor — they are user-visible regressions.
4. Keep this matrix and [23-manifest.json](23-manifest.json) synchronized.
