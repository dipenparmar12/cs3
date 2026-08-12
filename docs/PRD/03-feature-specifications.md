# 03 — Feature Specifications

**Generated:** 2026-08-10
**Baseline:** commit `a72f9e6c`, CloudStream `4.8.0`

Every feature carries the mandated fields: ID, name, description, Android behavior, desktop behavior, actors, trigger, preconditions, main/alternative/error workflows, postconditions, data affected, dependencies, platform differences, acceptance criteria, priority, implementation strategy, evidence, confidence, risks, recommended tests.

Major features use the long form. Cohesive families of small features use the compact form, which carries the same fields in tabular columns.

Implementation strategy codes: **R1** reimplement natively · **R2** Electron/Node equivalent · **R3** browser/Web API equivalent · **R4** desktop-specific UX, same behavior · **R5** alternative workflow · **R6** unsupported, documented.

---

## Index

| Area | Features |
|---|---|
| Setup | FEAT-SETUP-1..3 |
| Accounts & profiles | FEAT-ACCT-1..5 |
| Home | FEAT-HOME-1..5 |
| Search | FEAT-SEARCH-1..6 |
| Result / detail | FEAT-RESULT-1..9 |
| Library | FEAT-LIB-1..7 |
| Playback | FEAT-PLAY-1..18 |
| Subtitles | FEAT-SUB-1..7 |
| Downloads | FEAT-DL-1..9 |
| Extensions | FEAT-EXT-1..10 |
| Sync & trackers | FEAT-SYNC-1..6 |
| Settings | FEAT-SET-1..12 |
| Network | FEAT-NET-1..4 |
| Backup & migration | FEAT-BKP-1..5 |
| Updates | FEAT-UPD-1..3 |
| Sharing & deep links | FEAT-SHARE-1..4 |
| External targets | FEAT-CAST-1..4 |
| Diagnostics | FEAT-DIAG-1..3 |

---

# 1. Setup

## FEAT-SETUP-1 — First-run setup wizard

**Description.** A guided first-launch flow that collects the decisions the app cannot infer: language, layout, preferred media types, provider languages, and initial extensions.

**Android behavior.** Five sequential fragments: `SetupFragmentLanguage`, `SetupFragmentLayout`, `SetupFragmentMedia`, `SetupFragmentProviderLanguage`, `SetupFragmentExtensions`. Re-runnable later via the `redo_setup_key` preference. Layout choice writes `app_layout_key` (`-1` auto, `0` phone, `1` TV, `2` emulator).

**Desktop behavior.** Equivalent wizard as a modal, resizable window. The "layout" step is replaced by a **UI density / 10-foot mode** choice, since phone-vs-TV is not a desktop distinction; the underlying preference key is preserved for backup compatibility. Adds a sixth step: *"Import data from Android?"*, wired directly to FEAT-BKP-2.

**Actors.** New user.
**Trigger.** First launch with no existing profile; or Settings → Redo setup.
**Preconditions.** None. Must work offline except the extensions step.

**Main workflow.**
1. Language selection → writes `app_locale`.
2. UI density / 10-foot mode → writes `app_layout_key`.
3. Preferred media types → writes `prefer_media_type_key_2`.
4. Provider languages → writes `provider_lang_key`.
5. Extension repository setup → offers prebuilt repositories.
6. **Desktop addition:** offer Android backup import.
7. Land on Home.

**Alternative workflows.** Skip any step (defaults apply). Enter the wizard again later from Settings. Import-first: choosing import in step 6 applies imported settings *over* wizard choices, with an explicit warning.

**Error workflows.** No network at step 5 ⇒ step is skippable with a note that extensions can be added later. Import failure at step 6 ⇒ wizard completes with wizard-chosen defaults; import can be retried from Settings.

**Postconditions.** Profile 0 exists; the five preference keys are written; the app is usable.

**Data affected.** Settings store: `app_locale`, `app_layout_key`, `prefer_media_type_key_2`, `provider_lang_key`. Data store: repository list under `REPOSITORIES_KEY`.

**Dependencies.** FEAT-EXT-1, FEAT-BKP-2, FEAT-SET-1.

**Platform differences.** The Android TV auto-detection path (`isAutoTv()`, checks for Fire TV device names) has no desktop analogue; desktop defaults to standard density.

**Acceptance criteria.**
- AC: A fresh install with no network completes the wizard and reaches Home.
- AC: Each step writes exactly the key named above, with the value domain Android uses.
- AC: Re-running setup does not delete library data.
- AC: The import step, if used, produces the same result as importing from Settings.

**Priority.** P1. **Strategy.** R4.

**Evidence.**
- Path `app/src/main/java/com/lagradost/cloudstream3/ui/setup/` — five fragments define the step sequence.
- Path `app/src/main/res/values/donottranslate-strings.xml`, keys `locale_key`, `app_layout_key`, `prefer_media_type_key`, `provider_lang_key`, `redo_setup_key` — establishes exact persisted key names.
- Path `app/.../ui/settings/Globals.kt:14-40` — layout constants and auto-detection semantics.

**Confidence: High.**

**Risks.** Import-over-wizard ordering can confuse users if not clearly worded.

**Tests.** Fresh install offline; fresh install with import; redo-setup preserves library; each key's written value.

---

## FEAT-SETUP-2 — Layout mode (Phone / TV / Emulator)

Compact form.

| Field | Value |
|---|---|
| Description | A tri-state UI mode altering navigation, focus behavior, and component sizing. |
| Android behavior | `app_layout_key`: `-1` auto (device-detected), `0` PHONE, `1` TV, `2` EMULATOR. Bit flags `PHONE=0b001`, `TV=0b010`, `EMULATOR=0b100`; `isLayout(TV or EMULATOR)` gates 10-foot behavior. |
| Desktop behavior | Two modes: **Desktop** (default) and **10-foot / TV**, the latter enabling large targets, focus rings, and full keyboard/gamepad navigation. Key and value domain preserved for backup round-tripping; `-1` maps to Desktop. |
| Actors / Trigger | User; Settings → UI, or setup wizard. |
| Preconditions | None. |
| Main workflow | Select mode → UI re-renders → preference persisted. |
| Alt workflows | Launch flag to force a mode (useful for HTPC autostart). |
| Error workflows | Unknown stored value ⇒ fall back to Desktop, log a warning, do not overwrite the stored value. |
| Postconditions | `app_layout_key` written. |
| Data affected | Settings store `app_layout_key`. |
| Dependencies | FEAT-SET-4, all UI features. |
| Platform differences | Android auto-detect uses device model heuristics; desktop has no equivalent and never auto-selects TV mode. |
| Acceptance | Switching modes does not require a restart; an imported Android value of `1` yields 10-foot mode. |
| Priority / Strategy | P1 / R4 |
| Evidence | `app/.../ui/settings/Globals.kt:14-60`; `donottranslate-strings.xml` key `app_layout_key`. |
| Confidence | High |
| Risks | Preserving Android's value domain while changing its meaning must be documented, or backup round-trips will surprise users. |
| Tests | Mode switch without restart; unknown-value fallback; imported value mapping. |

---

## FEAT-SETUP-3 — Localization

| Field | Value |
|---|---|
| Description | Full UI localization with a user-selectable language independent of OS locale. |
| Android behavior | `app_locale` preference; extensive translation catalogue maintained through Weblate (the analyzed HEAD commit is itself a Weblate translation commit). Fastlane metadata exists for ~100 locales. |
| Desktop behavior | Same catalogue, same language list, same key. Locale changes apply without restart. Right-to-left layouts must be supported (the catalogue includes Arabic, Hebrew, Persian). |
| Actors / Trigger | User; Settings → General → Language, or setup. |
| Preconditions | None. |
| Main workflow | Select language → strings swap → `app_locale` persisted. |
| Alt workflows | "System default" follows the OS locale. |
| Error workflows | Missing translation key ⇒ fall back to English, never render the raw key. |
| Postconditions | `app_locale` written. |
| Data affected | Settings store `app_locale`. |
| Dependencies | None. |
| Platform differences | Android resource qualifiers vs. desktop runtime string catalogues; the *set* of languages must match. |
| Acceptance | Every Android-supported locale is selectable; RTL renders correctly; imported `app_locale` is honored. |
| Priority / Strategy | P1 / R2 |
| Evidence | `app/src/main/res/values-*/` locale directories; `fastlane/metadata/android/*` (~100 locale dirs); `donottranslate-strings.xml` key `locale_key`; HEAD commit `a72f9e6c` "Translated using Weblate (Albanian)". |
| Confidence | High |
| Risks | Translation pipeline must be re-established for desktop; reusing upstream's catalogue has GPL/attribution implications ([11](11-security-and-compliance.md) §6). |
| Tests | Locale switch without restart; RTL snapshot; missing-key fallback. |

---

# 2. Accounts and profiles

## FEAT-ACCT-1 — Local profiles

**Description.** Multiple local profiles on one installation, each with its own library, history, settings scope, and tracker logins. Not a cloud account — purely local partitioning.

**Android behavior.** An `Account` record has `keyIndex: Int`, `name`, `customImage: String?`, `defaultImageIndex: Int`, `lockPin: String?`. The array lives at data-store key `data_store_helper/account`; the active index at `data_store_helper/account_key_index`. `currentAccount` is that index as a string, and **prefixes almost every user-data key**. Profile 0 is synthesized as a default if absent. Switching profiles fires bookmark/library/home reload events.

**Desktop behavior.** Identical model and identical key layout — this is required for migration fidelity. Profile switching is exposed in the title bar / sidebar rather than a full-screen selector, and does not require an app restart.

**Actors.** User.
**Trigger.** App start (unless `skip_startup_account_select_key`), or explicit switch.
**Preconditions.** None.

**Main workflow.** Open profile switcher → select profile → PIN prompt if `lockPin` set → active index updated → library/home/bookmarks reload.

**Alternative workflows.** Create profile (name + avatar). Edit profile. Delete profile (must warn: profile-scoped data becomes unreachable). Skip the startup selector.

**Error workflows.** Wrong PIN ⇒ re-prompt, no lockout specified upstream. Missing profile index ⇒ fall back to profile 0.

**Postconditions.** `data_store_helper/account_key_index` updated; profile-scoped reads now resolve against the new prefix.

**Data affected.** Everything keyed `<profileIndex>/...` — see [06-data-models.md](06-data-models.md) §3.

**Dependencies.** FEAT-ACCT-2 (PIN), FEAT-LIB-*, FEAT-HOME-1.

**Platform differences.** Android backs the avatar with drawable resource indices (`profileImages`, 7 entries, index-stable by explicit comment). Desktop must ship 7 visually equivalent avatars **at the same indices**, or imported profiles change appearance.

**Acceptance criteria.**
- AC: An imported backup with N profiles yields N profiles with matching names, indices, and avatars.
- AC: Profile-scoped data is never visible from another profile.
- AC: `defaultImageIndex` 0–6 maps to the same seven avatars as Android.
- AC: Deleting a profile requires explicit confirmation naming what will be lost.

**Priority.** P1. **Strategy.** R1.

**Evidence.**
- `app/.../utils/DataStoreHelper.kt:163-241` — `Account` shape, key names, default-profile synthesis.
- `app/.../utils/DataStoreHelper.kt:86-94` — `profileImages`, with the in-code warning not to change indices.
- `app/.../utils/DataStoreHelper.kt:62-82` — `UserPreferenceDelegate` demonstrates the `<currentAccount>/<key>` prefix rule.
- `app/.../ui/account/` — profile UI.

**Confidence: High.**

**Risks.** Getting the prefix rule wrong silently hides all imported data — it will look like an empty import rather than an error.

**Tests.** Multi-profile import; per-profile isolation; avatar index fidelity; profile deletion warning; missing-index fallback.

---

## FEAT-ACCT-2 — Profile PIN lock and biometrics

| Field | Value |
|---|---|
| Description | Optional per-profile PIN, plus device biometric unlock for the app. |
| Android behavior | `lockPin` stored on the `Account` record. Separate app-level biometric gate via `BiometricAuthenticator` and the `biometric_key` preference. `biometric_key` is **explicitly excluded from backups** with the stated reason that it "can lock down users if backup is shared on an incompatible device". |
| Desktop behavior | PIN preserved. Biometric replaced by the OS credential prompt where available (Windows Hello, macOS Touch ID / local authentication); Linux has no dependable equivalent, so PIN-only there. `biometric_key` remains backup-excluded. |
| Actors / Trigger | User; profile switch or app unlock. |
| Preconditions | A PIN or an enrolled OS credential. |
| Main workflow | Prompt → verify → unlock. |
| Alt workflows | Fall back from biometric to PIN. |
| Error workflows | Biometric unavailable ⇒ silently fall back to PIN. Repeated failures ⇒ remain locked; **no data destruction**. |
| Postconditions | Session unlocked for that profile. |
| Data affected | `data_store_helper/account` (`lockPin`); settings `biometric_key` (never exported). |
| Dependencies | FEAT-ACCT-1. |
| Platform differences | Windows Hello / Touch ID / none-on-Linux. |
| Acceptance | `biometric_key` never appears in an export; PIN survives round-trip; Linux degrades cleanly. |
| Priority / Strategy | P2 / R4 |
| Evidence | `app/.../utils/DataStoreHelper.kt:169`; `app/.../utils/BiometricAuthenticator.kt`; `app/.../utils/BackupUtils.kt:68` and its adjacent comment; `donottranslate-strings.xml` key `biometric_key`. |
| Confidence | High |
| Risks | A PIN is a UX gate, not a security control — it must not be presented as encryption. State this in the UI. |
| Tests | Export excludes `biometric_key`; PIN round-trip; biometric-unavailable fallback. |

---

## FEAT-ACCT-3 · FEAT-ACCT-4 · FEAT-ACCT-5 — compact

| ID | Feature | Android | Desktop | Data | Prio | Strat | Evidence | Conf |
|---|---|---|---|---|---|---|---|---|
| FEAT-ACCT-3 | Create / edit profile | Name, avatar index 0–6 or custom image | Same; custom image via native file dialog, copied into app data (never referenced by external path) | `data_store_helper/account` | P1 | R1 | `DataStoreHelper.kt:163-176` | High |
| FEAT-ACCT-4 | Delete profile | Removes the account entry | Same, plus explicit orphaned-data warning and optional purge of `<index>/*` keys | All `<index>/*` keys | P2 | R1 | `DataStoreHelper.kt:198-241` | Medium — deletion side-effects on scoped keys are not fully specified upstream |
| FEAT-ACCT-5 | Skip startup selector | `skip_startup_account_select_key` | Same key, same behavior | Settings | P2 | R1 | `settings_account.xml`; `donottranslate-strings.xml` | High |

---

# 3. Home

## FEAT-HOME-1 — Homepage from selected provider

**Description.** The landing screen renders paginated, categorized content lists supplied by one selected provider.

**Android behavior.** The active provider is at data-store key `<profile>/home_api_used`. `MainAPI.getMainPage(page, MainPageRequest)` returns `HomePageResponse` → `HomePageList` rows. Providers can request sequential (non-parallel) loading with `sequentialMainPage` plus configurable delays (`sequentialMainPageDelay`, `sequentialMainPageScrollDelay`) to avoid being rate-limited, and can set `getMainPageTimeoutMs`. `lastHomepageRequest` tracks request time. Rows are horizontally scrolling carousels; a preview header shows a featured item.

**Desktop behavior.** Same data contract. Presentation becomes a responsive grid/carousel hybrid that uses the extra width — more items per row at larger window sizes, with row virtualization. Provider selection moves to a persistent dropdown in the header. Sequential-loading and delay semantics are preserved exactly, because they exist to keep providers from being blocked.

**Actors.** User.
**Trigger.** App start, provider change, pull/press refresh, profile switch.
**Preconditions.** At least one provider installed and enabled.

**Main workflow.** Resolve active provider → `getMainPage(1, …)` per configured `mainPage` entry → render rows → lazy-load page N+1 on horizontal scroll.

**Alternative workflows.** No provider installed ⇒ empty state directing the user to Extensions. Provider switch ⇒ full reload. Genre/category selector where the provider supplies one (`GenreResponse`, `TagSelector`, `BoolSelector`, `InputField`).

**Error workflows.** Provider throws ⇒ row-level error with retry, not a whole-screen failure. Timeout ⇒ honor `getMainPageTimeoutMs`, then show a retry affordance. Offline ⇒ show cached content if available plus an offline banner.

**Postconditions.** `<profile>/home_api_used` persisted on change.

**Data affected.** Data store `<profile>/home_api_used`, `<profile>/home_pref_homepage` (TvType filter), `<profile>/home_bookmarked_last_list`.

**Dependencies.** FEAT-EXT-*, FEAT-NET-1, FEAT-LIB-1 (bookmark row).

**Platform differences.** Android's pull-to-refresh becomes a refresh button plus `F5`/`Ctrl+R`. Carousel gestures become mouse wheel, drag, and arrow keys.

**Acceptance criteria.**
- AC: Row content matches what the same provider returns on Android for the same query.
- AC: `sequentialMainPage` providers issue strictly sequential requests with the declared delays.
- AC: A failing provider degrades one row, never the screen.
- AC: 1,000-item rows scroll at 60 fps via virtualization.

**Priority.** P0. **Strategy.** R1.

**Evidence.**
- `library/.../MainAPI.kt:630-638` — `getMainPage` contract and `mainPage` defaults.
- `library/.../MainAPI.kt:522-534, 580` — sequential loading, delays, timeout.
- `library/.../MainAPI.kt:380-416` — `GenreResponse`, `MainPageData`, `MainPageRequest`.
- `library/.../MainAPI.kt:1270-1292` — `HomePageResponse`, `HomePageList`.
- `app/.../utils/DataStore.kt:24` — `USER_SELECTED_HOMEPAGE_API = "home_api_used"`.
- `app/.../ui/home/HomeViewModel.kt`, `HomeFragment.kt`.

**Confidence: High.**

**Risks.** Ignoring sequential-loading semantics will get users' IP addresses blocked by providers.

**Tests.** Sequential-timing assertions; row-level failure isolation; virtualization performance; offline cached render.

---

## FEAT-HOME-2..5 — compact

| ID | Feature | Android | Desktop | Prio | Strat | Evidence | Conf |
|---|---|---|---|---|---|---|---|
| FEAT-HOME-2 | Continue-watching row | Built from `<profile>/result_resume_watching_2` + `<profile>/video_pos_dur`; each card shows a progress bar; long-press offers removal | Same data; hover reveals progress and a remove affordance; right-click context menu | P0 | R4 | `DataStoreHelper.kt:53, 534-614, 691-756`; `HomeViewModel.getResumeWatching()` | High |
| FEAT-HOME-3 | Bookmarks row | Filtered by `home_bookmarked_last_list` (an `IntArray` of `WatchType` ids) | Same, with a multi-select filter control | P1 | R1 | `DataStoreHelper.kt:140-143`; `WatchType.kt:7-18` | High |
| FEAT-HOME-4 | Media-type filter | `<profile>/home_pref_homepage`, a list of `TvType` names | Same key, same values | P1 | R1 | `DataStoreHelper.kt:130-138`; `MainAPI.kt:1120-1142` | High |
| FEAT-HOME-5 | Random-item button | `random_button_key` toggles a shuffle action | Same; also bind to a keyboard shortcut | P3 | R1 | `donottranslate-strings.xml` key `random_button_key` | High |

---

# 4. Search

## FEAT-SEARCH-1 — Multi-provider search

**Description.** A query is dispatched across selected providers; results are grouped and presented per provider or merged.

**Android behavior.** `MainAPI.search(query)` and the paginated `search(query, page)` returning `SearchResponseList`; `quickSearch(query)` is a lighter variant gated by `hasQuickSearch`. Provider participation is chosen per profile at `<profile>/search_pref_providers`; when empty it defaults to providers filtered by preferred media type. Type filters live at `<profile>/search_pref_tags` (`TvType` names, default `Movie` + `TvSeries`). Separate timeouts: `searchTimeoutMs`, `quickSearchTimeoutMs`.

**Desktop behavior.** Same contracts. Desktop gains a persistent results layout with a provider sidebar/filter panel (window width permits it), live incremental rendering as each provider returns, and full keyboard control (`Ctrl+F`/`Ctrl+K` focus, arrows, `Enter`).

**Actors.** User.
**Trigger.** Typing in the search field; `cloudstreamsearch://` deep link; global shortcut.
**Preconditions.** ≥1 provider enabled.

**Main workflow.** Enter query → dispatch in parallel to selected providers (respecting per-provider timeouts) → render results per provider as they arrive → click opens the detail page.

**Alternative workflows.** Quick search (suggestion dropdown) for providers advertising `hasQuickSearch`. Search history reuse (FEAT-SEARCH-4). Deep-link search pre-fills and executes.

**Error workflows.** A provider erroring or timing out is marked failed **in its own section**; others still render. All providers failing ⇒ actionable empty state. Offline ⇒ history and downloads remain searchable.

**Postconditions.** Query appended to `<profile>/search_history/<key>`.

**Data affected.** `<profile>/search_pref_providers`, `<profile>/search_pref_tags`, `<profile>/search_history/*`.

**Dependencies.** FEAT-EXT-*, FEAT-SEARCH-4, FEAT-NET-1.

**Platform differences.** Android's dedicated search tab becomes a persistent desktop search field plus a results view.

**Acceptance criteria.**
- AC: Results appear incrementally; one slow provider never blocks the rest.
- AC: Per-provider timeouts from `MainAPI` are honored.
- AC: Failed providers are individually attributed with a retry affordance.
- AC: Provider and type selections round-trip through backup.

**Priority.** P0. **Strategy.** R1.

**Evidence.**
- `library/.../MainAPI.kt:646-660` — `search`, paginated `search`, `quickSearch`.
- `library/.../MainAPI.kt:564, 587, 594` — `hasQuickSearch`, `searchTimeoutMs`, `quickSearchTimeoutMs`.
- `app/.../utils/DataStoreHelper.kt:96-128` — search provider and tag preference keys and defaults.
- `app/.../ui/search/SearchViewModel.kt:33` — `SEARCH_HISTORY_KEY = "search_history"`.
- `library/.../MainAPI.kt:1292-1302` — `SearchResponseList`.

**Confidence: High.**

**Risks.** Unbounded parallel fan-out across many providers is a rate-limit and memory hazard; cap concurrency.

**Tests.** Incremental render; slow-provider isolation; timeout honoring; 50-provider fan-out under concurrency cap.

---

## FEAT-SEARCH-2..6 — compact

| ID | Feature | Android | Desktop | Prio | Strat | Evidence | Conf |
|---|---|---|---|---|---|---|---|
| FEAT-SEARCH-2 | Quick search / suggestions | `quickSearch` + `SearchSuggestionApi` drive a dropdown | Same, as a combobox with keyboard selection | P1 | R1 | `MainAPI.kt:658-660`; `ui/search/SearchSuggestionApi.kt` | High |
| FEAT-SEARCH-3 | Provider & type filters | `search_pref_providers`, `search_pref_tags` per profile | Persistent filter panel; same keys | P1 | R4 | `DataStoreHelper.kt:96-128` | High |
| FEAT-SEARCH-4 | Search history | Stored under `<profile>/search_history/<key>`; open / remove-one / clear-all actions | Same storage and actions; right-click to remove | P1 | R1 | `SearchViewModel.kt:33,86,214`; `SearchFragment.kt:573,585`; `SearchHistoryAdaptor.kt:32-34` | High |
| FEAT-SEARCH-5 | Quality-badge filtering | `pref_filter_search_quality_key` hides selected `SearchQuality` badges | Same key, same domain | P2 | R1 | `settings_ui.xml`; `MainAPI.kt:1303` | High |
| FEAT-SEARCH-6 | Sync-provider search | `SyncSearchViewModel` searches trackers (MAL/AniList/…) rather than content providers | Same; presented as a distinct tab | P2 | R1 | `ui/search/SyncSearchViewModel.kt`; `syncproviders/SyncAPI.kt` | High |

---

# 5. Result / detail page

## FEAT-RESULT-1 — Detail page

**Description.** The page for a single title: metadata, poster/backdrop, cast, tags, plot, trailers, season/episode list, and the actions that operate on it.

**Android behavior.** `MainAPI.load(url)` returns a `LoadResponse` — one of `MovieLoadResponse`, `TvSeriesLoadResponse`, `AnimeLoadResponse`, `LiveStreamLoadResponse`, `TorrentLoadResponse`. `ResultViewModel2` (2,000+ lines) composes it with local state: watch progress, watch state, bookmark/favourite/subscribe status, sync IDs, filler-episode flags, and recommendations. **Identity is `LoadResponse.getId()`** — `url.replace(mainUrl,"").replace("/","").hashCode()` unless the response came from search with an id already attached.

**Desktop behavior.** Same data contract, re-laid out for width: a two-column layout with metadata on the left and the episode list on the right, no accordion collapsing needed. Actions move to a toolbar plus right-click context menus.

**Actors.** User.
**Trigger.** Result click; `csshare://` deep link; continue-watching card; library item.
**Preconditions.** The owning provider is installed and enabled.

**Main workflow.** `load(url)` → merge local state by ID → render → user acts (play / bookmark / favourite / subscribe / download / sync).

**Alternative workflows.** Season switch (persists to `<profile>/result_season/<id>`). Dub/sub switch (`<profile>/result_dub/<id>`, a `DubStatus` ordinal). Episode sort (`result_sort`, an `EpisodeSortType` ordinal). Trailer playback. Sync-provider metadata overlay.

**Error workflows.** Provider missing ⇒ explain which extension is required and offer to open Extensions. `load` fails ⇒ retry with the error surfaced. Partial metadata ⇒ render what exists; never blank the page.

**Postconditions.** Season/dub/sort selections persisted per ID.

**Data affected.** `<profile>/result_season/<id>`, `<profile>/result_episode/<id>`, `<profile>/result_dub/<id>`, `result_sort`, plus everything the actions write.

**Dependencies.** FEAT-RESULT-2..9, FEAT-PLAY-1, FEAT-DL-1, FEAT-LIB-*, FEAT-SYNC-*.

**Platform differences.** Android long-press → desktop right-click. Bottom sheets → modals or side panels.

**Acceptance criteria.**
- AC: `getId()` produces bit-identical values to Android for the same URL and provider — this is what makes imported progress attach to the right title.
- AC: Every `LoadResponse` subtype renders with its type-appropriate affordances.
- AC: Missing-provider state is explanatory and actionable.

**Priority.** P0. **Strategy.** R1.

**Evidence.**
- `library/.../MainAPI.kt:1814-2215` — `LoadResponse` interface and shared fields.
- `library/.../MainAPI.kt:2268-2783` — the five concrete load-response types.
- `app/.../ui/result/ResultViewModel2.kt:370-380` — `getId()` / `getLoadResponseIdFromUrl`, the identity rule.
- `app/.../utils/DataStoreHelper.kt:56-59, 773-815` — season/episode/dub/sort keys.

**Confidence: High.**

**Risks.** ID derivation is the single highest-risk detail in the entire migration ([06](06-data-models.md) §4).

**Tests.** ID equality against JVM-computed vectors; all five response types; missing-provider path; season/dub persistence.

---

## FEAT-RESULT-2..9 — compact

| ID | Feature | Android | Desktop | Prio | Strat | Evidence | Conf |
|---|---|---|---|---|---|---|---|
| FEAT-RESULT-2 | Episode list & seasons | `Episode` + `SeasonData`; sorting by `EpisodeSortType`; per-episode progress bars, watched marks, filler flags | Same, as a dense virtualized table with sortable columns | P0 | R4 | `MainAPI.kt:2227-2233, 2552-2653`; `ResultFragment.kt:39-66` | High |
| FEAT-RESULT-3 | Watch state (bookmark) | `WatchType` ids `0..5` (WATCHING, COMPLETED, ONHOLD, DROPPED, PLANTOWATCH, NONE); `NONE` **deletes** the record rather than storing 5 | Identical semantics — storing `5` instead of deleting would corrupt parity | P0 | R1 | `ui/WatchType.kt:7-18`; `DataStoreHelper.kt:782-799` | High |
| FEAT-RESULT-4 | Favourites | `<profile>/result_favorites_state_data/<id>` → `FavoritesData` | Same | P1 | R1 | `DataStoreHelper.kt:434-491, 668-689` | High |
| FEAT-RESULT-5 | Subscriptions | `<profile>/result_subscribed_state_data/<id>` → `SubscribedData` incl. `lastSeenEpisodeCount: Map<DubStatus,Int?>`; a 6-hour worker checks for new episodes | Same data; worker becomes a main-process scheduler; OS notifications | P1 | R2 | `DataStoreHelper.kt:309-369, 633-666`; `services/SubscriptionWorkManager.kt:46` | High |
| FEAT-RESULT-6 | Per-episode watched flag | `<profile>/video_watch_state/<id>` → `VideoWatchState`; `None` deletes the key | Identical | P1 | R1 | `DataStoreHelper.kt:758-771`; `ResultFragment.kt:33-37` | High |
| FEAT-RESULT-7 | Trailers | NewPipeExtractor resolves YouTube trailers; gated by `show_trailers_key` | Requires a desktop YouTube resolution path; same toggle | P2 | R2 | `MainAPI.kt:1779-1813`; `libs.versions.toml:44`; key `show_trailers_key` | High |
| FEAT-RESULT-8 | Cast & recommendations | `ActorData`, `Actor`, `ActorRole`; toggled by `show_cast_in_details_key` | Same | P2 | R1 | `MainAPI.kt:1524-1554`; key `show_cast_in_details_key` | High |
| FEAT-RESULT-9 | Filler-episode marking | anime-db library flags filler episodes; `show_fillers_key` | Same library data via a desktop HTTP/dataset path; same toggle | P3 | R2 | `utils/FillerEpisodeCheck.kt`; `libs.versions.toml:9`; key `show_fillers_key` | High |

---

# 6. Library

## FEAT-LIB-1 — Library view

**Description.** A paged, sortable, searchable view of the user's saved titles, sourced either from local state or from a connected tracker.

**Android behavior.** `LibraryFragment` + `LibraryViewModel` render `SyncAPI.Page`s. The source is selectable among `LocalList` and connected sync providers; the last choice is at `last_sync_api`. Sorting is `ListSorting` (`Query`, `RatingHigh`, `RatingLow`, `UpdatedNew`, `UpdatedOld`, `AlphabeticalA`, `AlphabeticalZ`, `ReleaseDateNew`, `ReleaseDateOld`), persisted per profile at `library_sorting_mode` as an **ordinal**. `LocalList` aggregates bookmarks, favourites, and subscriptions.

**Desktop behavior.** Same model. Desktop uses a multi-column grid with a persistent sort/filter bar, column-header sorting, and multi-select with bulk actions (a desktop enhancement Android lacks).

**Actors.** User.
**Trigger.** Library navigation; profile switch; `requireLibraryRefresh` set by any mutation.
**Preconditions.** None (local list always exists).

**Main workflow.** Choose source → load pages → sort/filter → open item.

**Alternative workflows.** Switch to a tracker-backed list. Search within the library. Bulk select and act (desktop-only).

**Error workflows.** Tracker unreachable ⇒ show cached list plus a staleness indicator; never delete cached entries. Sort ordinal out of range ⇒ fall back to `AlphabeticalA`, preserve the stored value.

**Postconditions.** `library_sorting_mode`, `last_sync_api` persisted.

**Data affected.** `<profile>/library_sorting_mode`, `last_sync_api`, and the underlying bookmark/favourite/subscription keys.

**Dependencies.** FEAT-RESULT-3/4/5, FEAT-SYNC-*.

**Platform differences.** Android's swipe-between-pages becomes tabs plus `Ctrl+Tab`.

**Acceptance criteria.**
- AC: Sorting ordinals match Android exactly, so an imported `library_sorting_mode` selects the same order.
- AC: A tracker outage never mutates local data.
- AC: 10,000 items scroll smoothly (virtualized).

**Priority.** P1. **Strategy.** R4.

**Evidence.**
- `app/.../ui/library/LibraryViewModel.kt:19-30` — `ListSorting` order (ordinals are the persisted values).
- `app/.../ui/library/LibraryViewModel.kt:31` — `LAST_SYNC_API_KEY = "last_sync_api"`.
- `app/.../utils/DataStoreHelper.kt:147-150` — `library_sorting_mode` default `AlphabeticalA.ordinal`.
- `app/.../syncproviders/providers/LocalList.kt` — local aggregation.

**Confidence: High.**

**Risks.** Reordering the `ListSorting` enum in the desktop implementation silently changes every imported user's sort order.

**Tests.** Ordinal fidelity; tracker-outage read-only behavior; 10k virtualization; sort stability.

---

## FEAT-LIB-2..7 — compact

| ID | Feature | Android | Desktop | Prio | Strat | Evidence | Conf |
|---|---|---|---|---|---|---|---|
| FEAT-LIB-2 | Local list aggregation | `LocalList` merges bookmarks + favourites + subscriptions into `SyncAPI.Page`s | Same | P1 | R1 | `syncproviders/providers/LocalList.kt`; `DataStoreHelper.kt:348-368, 409-429, 470-490` | High |
| FEAT-LIB-3 | Library search | Filters the loaded page set | Same, plus instant filtering | P2 | R1 | `ui/library/LibraryFragment.kt` | High |
| FEAT-LIB-4 | Continue-watching management | Remove a single entry; `deleteAllResumeStateIds()` clears all | Same, with right-click and a bulk clear | P1 | R4 | `DataStoreHelper.kt:522-525, 595-598` | High |
| FEAT-LIB-5 | Watch-progress persistence | `<profile>/video_pos_dur/<id>` → `PosDur{position,duration}`; **writes are skipped when duration < 30 s**; `fixVisual()` snaps ≤1%→0, ≤5%→5%, ≥95%→100% | Identical, including the 30-second guard and snapping thresholds | P0 | R1 | `DataStoreHelper.kt:243-258, 691-695, 753-756` | High |
| FEAT-LIB-6 | Resume-watching records | `<profile>/result_resume_watching_2/<parentId>` → `ResumeWatching`; a migration from the older `result_resume_watching` key exists | Same; the desktop importer must run the same legacy migration | P0 | R1 | `DataStoreHelper.kt:53-55, 541-614`; `DownloadObjects.kt:174-182` | High |
| FEAT-LIB-7 | Bulk actions | Not present | **Desktop-only enhancement:** multi-select, bulk bookmark/remove/export | P3 | Desktop-only | — | High (new) |

---

# 7. Playback

## FEAT-PLAY-1 — Link resolution and playback start

**Description.** Turning a chosen episode into a playing stream.

**Android behavior.** `IGenerator` implementations produce playable links: `RepoLinkGenerator` (provider `loadLinks`), `LinkGenerator` (direct URLs, e.g. from deep links), `DownloadFileGenerator` (local files). `MainAPI.loadLinks(data, isCasting, subtitleCallback, callback)` streams `ExtractorLink`s and `SubtitleFile`s via callbacks as they are found, subject to `loadLinksTimeoutMs`. Links carry a type: `VIDEO`, `M3U8`, `DASH`, `TORRENT`, `MAGNET`, inferred from the URL when `INFER_TYPE` is used. Selection is driven by quality profiles (FEAT-PLAY-2).

**Desktop behavior.** Same generator abstraction and the same streaming-callback contract, with the provider side running in the PluginHost. Because callbacks now cross a process boundary, the IPC contract must stream incrementally rather than batch — otherwise the "links appear as they are found" behavior is lost.

**Actors.** User.
**Trigger.** Play on an episode/movie; continue-watching; deep link; opening a local file.
**Preconditions.** A provider that can resolve the item, or a direct/local source.

**Main workflow.** Select episode → `loadLinks` streams links + subtitles → rank by quality profile → open the best in the chosen backend → restore position (FEAT-PLAY-6).

**Alternative workflows.** Manual source switch mid-playback. External player handoff (FEAT-CAST-2). Torrent/magnet path (FEAT-PLAY-16). Offline downloaded playback.

**Error workflows.** No links ⇒ explicit "no sources" state with retry and provider attribution. Timeout ⇒ honor `loadLinksTimeoutMs`, present partial results. Playback failure ⇒ auto-advance to the next-ranked mirror, with the failure logged and visible.

**Postconditions.** Position tracking begins; resume-watching updated.

**Data affected.** `<profile>/video_pos_dur/<id>`, `<profile>/result_resume_watching_2/<parentId>`, `<profile>/video_watch_state/<id>`.

**Dependencies.** FEAT-EXT-*, FEAT-PLAY-2, FEAT-SUB-*, [28](28-media-playback-requirements.md).

**Platform differences.** Chromium natively plays a narrower set of containers/codecs than ExoPlayer+FFmpeg; the native-player backend closes the gap. See [28](28-media-playback-requirements.md) §3.

**Acceptance criteria.**
- AC: Links render incrementally, matching Android's perceived responsiveness.
- AC: All five `ExtractorLinkType` values are handled or explicitly reported as unsupported.
- AC: Mirror auto-advance on failure works without user action.
- AC: `loadLinksTimeoutMs` is honored per provider.

**Priority.** P0. **Strategy.** R1.

**Evidence.**
- `library/.../MainAPI.kt:690-700` — `loadLinks` signature and callback semantics.
- `library/.../MainAPI.kt:573` — `loadLinksTimeoutMs`.
- `library/.../utils/ExtractorApi.kt:413-458` — `ExtractorLinkType`, MIME mapping, inference rules.
- `app/.../ui/player/IGenerator.kt`, `RepoLinkGenerator.kt`, `LinkGenerator.kt`, `DownloadFileGenerator.kt`.

**Confidence: High.**

**Risks.** Batching links across IPC destroys the incremental UX; specify streaming explicitly.

**Tests.** Incremental link arrival; each link type; timeout; mirror failover; offline local playback.

---

## FEAT-PLAY-2 — Quality profiles and source priority

| Field | Value |
|---|---|
| Description | User-defined profiles that rank sources and qualities so the "best" link is auto-selected. |
| Android behavior | `QualityDataHelper` with **7 profiles** (`PROFILE_COUNT = 7`); keys `video_source_priority`, `video_quality_priority`, `video_profile_name`, `video_profile_types_2`, `video_profile_settings`; default source priority `1`; `AUTO_SKIP_PRIORITY = 10` marks sources to skip. Profiles can be typed (e.g. metered vs unmetered). Complementary preferences `quality_pref_key` and `quality_pref_mobile_data_key`. |
| Desktop behavior | Same model and keys. `quality_pref_mobile_data_key` has no desktop meaning as "mobile data", but is retained and repurposed as a **metered-connection** preference where the OS reports one (Windows does; macOS/Linux generally do not) — otherwise hidden but preserved for round-trip. |
| Actors / Trigger | User; Settings → Player, or the in-player profile switcher. |
| Preconditions | None. |
| Main workflow | Edit profile → order sources/qualities → save → playback selection follows the ranking. |
| Alt workflows | Per-session override without saving. |
| Error workflows | Corrupt profile ⇒ fall back to defaults, keep the stored value, warn. |
| Postconditions | Profile keys written. |
| Data affected | The five `video_*` keys plus the two `quality_pref_*` settings. |
| Dependencies | FEAT-PLAY-1. |
| Platform differences | Metered-connection detection availability differs per OS ([29](29-platform-compatibility.md) §7). |
| Acceptance | 7 profiles supported; imported priorities produce the same selection as Android for the same link set. |
| Priority / Strategy | P1 / R4 |
| Evidence | `app/.../ui/player/source_priority/QualityDataHelper.kt:20-42`; `settings_player.xml`; keys `quality_pref_key`, `quality_pref_mobile_data_key`. |
| Confidence | High |
| Risks | Silent divergence in ranking logic yields "wrong quality" reports that are hard to diagnose. |
| Tests | Ranking equivalence against fixed link sets; 7-profile round-trip; corrupt-profile fallback. |

---

## FEAT-PLAY-3..18 — compact

| ID | Feature | Android | Desktop | Prio | Strat | Evidence | Conf |
|---|---|---|---|---|---|---|---|
| FEAT-PLAY-3 | Transport controls | Play/pause, seek, ±N s skip (`fast_forward_button_time`), next/previous episode | Same + full keyboard map (space, ←/→, J/K/L, `,`/`.` frame step) | P0 | R4 | `ui/player/FullScreenPlayer.kt`; key `fast_forward_button_time_key` | High |
| FEAT-PLAY-4 | Playback speed | Persisted per profile at `playback_speed` (Float, default 1.0); toggled by `playback_speed_enabled_key` | Same key/default; `<` `>` shortcuts | P1 | R1 | `DataStoreHelper.kt:145`; key `playback_speed_enabled_key` | High |
| FEAT-PLAY-5 | Resize / aspect mode | `resize_mode` Int per profile (default 0) | Same key; fit/fill/zoom cycling | P1 | R1 | `DataStoreHelper.kt:146`; key `player_resize_enabled_key` | High |
| FEAT-PLAY-6 | Resume position | On open, seek to `video_pos_dur/<id>.position`, subject to the `fixVisual` thresholds | Identical | P0 | R1 | `DataStoreHelper.kt:249-258, 691-756` | High |
| FEAT-PLAY-7 | Autoplay next episode | `autoplay_next_key`; a next-episode record is written once progress ≥ `NEXT_WATCH_EPISODE_PERCENTAGE` | Same key, same threshold constant | P1 | R1 | `DataStoreHelper.kt:697-751`; key `autoplay_next_key` | High |
| FEAT-PLAY-8 | Gestures | `PlayerGestureHelper` (1,220 lines): horizontal seek, vertical volume/brightness, double-tap seek/pause; keys `swipe_enabled_key`, `swipe_vertical_enabled_key`, `double_tap_enabled_key`, `double_tap_pause_enabled_key`, `double_tap_seek_time_key2` | Mouse equivalents: drag-seek on the bar, wheel volume, double-click fullscreen. Touch gestures retained for touchscreen laptops. **Brightness control is not available** — desktop apps cannot set display brightness portably; the key is preserved but inert | P1 | R4/R6 | `ui/player/PlayerGestureHelper.kt`; the five gesture keys; `use_system_brightness_key`, `extra_brightness_enabled` | High |
| FEAT-PLAY-9 | Fullscreen | Immersive fullscreen | Native fullscreen, `F`/`F11`, `Esc`; multi-monitor aware | P0 | R4 | `ui/player/FullScreenPlayer.kt` | High |
| FEAT-PLAY-10 | Picture-in-picture | Android PiP via `PlayerPipHelper`; `pip_enabled_key` | Always-on-top mini-player window with its own bounds, persisted separately | P2 | R4 | `ui/player/PlayerPipHelper.kt`; key `pip_enabled_key` | High |
| FEAT-PLAY-11 | Seekbar preview thumbnails | `PreviewGenerator` (545 lines) + previewseekbar-media3; `preview_seekbar_key` | Requires a desktop thumbnail pipeline (native player screenshot API or a decode worker); same toggle | P2 | R1 | `ui/player/PreviewGenerator.kt`; `libs.versions.toml:47`; key `preview_seekbar_key` | Medium — feasible, but the extraction mechanism is backend-dependent |
| FEAT-PLAY-12 | Audio-track selection | Media3 track selection; `AudioFile` model in the provider API | Same UI; backend-dependent implementation | P1 | R1 | `MainAPI.kt:1247-1269`; `ui/player/CS3IPlayer.kt` | High |
| FEAT-PLAY-13 | Software decoding toggle | `software_decoding_key2` switches to `nextlib` FFmpeg decoders | Maps to "use embedded native player" / force-software-decode | P1 | R4 | key `software_decoding_key2`; `libs.versions.toml:45` | High |
| FEAT-PLAY-14 | Buffer configuration | `video_buffer_size_key`, `video_buffer_length_key`, `video_buffer_disk_key`, `video_buffer_clear_key` | Same keys mapped onto the chosen backend's cache settings; "clear" purges the media cache directory | P2 | R4 | `settings_player.xml`; the four keys | High |
| FEAT-PLAY-15 | Playback rotation | `rotate_video_key`, `auto_rotate_video_key` | **Not applicable** — no device rotation on desktop. Keys preserved, inert | P3 | R6 | keys `rotate_video_key`, `auto_rotate_video_key` | High |
| FEAT-PLAY-16 | Torrent / magnet streaming | In-process Go `torrServer` on an ephemeral loopback port; playback targets `http://127.0.0.1:<port>` | Bundled torrent engine as a supervised child process exposing the same loopback-HTTP shape | P2 | R2 | `ui/player/Torrent.kt:14, 206-210`; `libs.versions.toml:51` | High |
| FEAT-PLAY-17 | Intro/outro skip | `AniSkip`, `AnimeSkip`, `TheIntroDBSkip`, `IntroDbSkip` provide timestamps; a skip button appears | Same services, same UX, plus a keyboard shortcut | P2 | R1 | `utils/videoskip/` (5 files) | High |
| FEAT-PLAY-18 | Player metadata overlay | `show_player_metadata_key`, `prefer_limit_title_key`, `prefer_limit_show_player_info`, `hide_player_control_names_key` | Same keys | P3 | R1 | `settings_player.xml`; `settings_ui.xml` | High |

---

# 8. Subtitles

## FEAT-SUB-1 — Subtitle rendering and formats

**Description.** Loading, decoding, and rendering subtitles from provider-supplied files, embedded tracks, or local files.

**Android behavior.** `CustomSubtitleDecoderFactory` supports `TEXT_VTT`, `TEXT_SSA` (ASS/SSA), `APPLICATION_TTML`, `APPLICATION_MP4VTT`, `APPLICATION_SUBRIP`, `APPLICATION_TX3G`, `APPLICATION_DVBSUBS`, `APPLICATION_PGS`. CEA-608/708 paths exist but are commented out. A `CustomSubripParser` handles malformed SRT, including VTT content mislabelled as SRT. Charset is auto-detected with juniversalchardet; `subtitles_encoding_key` allows an override. `SubtitleData` carries `origin: SubtitleOrigin` (`URL`, `EMBEDDED_IN_VIDEO`, and a local variant).

**Desktop behavior.** Text formats (SRT/VTT/ASS/SSA/TTML) must render with full styling parity. **Bitmap subtitle formats (PGS, DVB) require the native-player backend** — they cannot be rendered through Chromium's `<track>` element. Charset detection and override must be preserved; mis-encoded subtitles are a very common real-world case.

**Actors.** User.
**Trigger.** Playback start (auto-select) or manual selection.
**Preconditions.** A subtitle source exists.

**Main workflow.** Collect subtitles (provider callbacks, embedded tracks, downloaded files) → auto-select per `subs_auto_select` → decode with detected charset → render with the user's caption style.

**Alternative workflows.** Manual track switch. Load a local subtitle file (drag-and-drop on desktop). Auto-download from a subtitle provider (FEAT-SUB-5). Timing offset adjustment (FEAT-SUB-4).

**Error workflows.** Undecodable charset ⇒ fall back to UTF-8, warn, offer manual override. Unsupported bitmap format on the Chromium backend ⇒ explicit message offering to switch backends. Malformed cues ⇒ skip the cue, keep the track.

**Postconditions.** Selection remembered for the session; style persisted globally.

**Data affected.** `subtitle_settings` (`SaveCaptionStyle`), `subs_auto_select`, `subs_auto_download`, `subtitles_encoding_key`.

**Dependencies.** FEAT-PLAY-1, [28](28-media-playback-requirements.md) §5.

**Platform differences.** Bitmap subtitle support is backend-conditional.

**Acceptance criteria.**
- AC: SRT, VTT, ASS/SSA, TTML render with styling equivalent to Android.
- AC: A mislabelled VTT-as-SRT file still renders (Android explicitly handles this).
- AC: Non-UTF-8 subtitles are detected, not mojibake.
- AC: PGS/DVB either render or produce an explicit, actionable message.

**Priority.** P0. **Strategy.** R1.

**Evidence.**
- `app/.../ui/player/CustomSubtitleDecoderFactory.kt:250-280, 365-380` — the supported MIME list and parser mapping.
- `app/.../ui/player/CustomSubtitleDecoderFactory.kt:111` — the comment documenting VTT-parsed-as-SRT handling.
- `app/.../ui/player/PlayerSubtitleHelper.kt:20-52, 100-118` — `SubtitleStatus`, `SubtitleOrigin`, `SubtitleData`, extension→MIME mapping.
- `gradle/libs.versions.toml:27` — juniversalchardet for charset detection.
- `app/.../ui/subtitles/SubtitlesFragment.kt:61-63` — the three subtitle keys.

**Confidence: High.**

**Risks.** ASS/SSA styling fidelity is frequently underestimated; positioning, karaoke, and font overrides are where naive implementations fail.

**Tests.** A format corpus (SRT/VTT/ASS/TTML/PGS); mislabelled-extension corpus; CP1251/Shift-JIS/Big5 encodings; styled-ASS visual comparison.

---

## FEAT-SUB-2..7 — compact

| ID | Feature | Android | Desktop | Prio | Strat | Evidence | Conf |
|---|---|---|---|---|---|---|---|
| FEAT-SUB-2 | Caption styling | `SaveCaptionStyle` at data-store key `subtitle_settings`: font, size, colors, edge, elevation (`DEF_SUBS_ELEVATION = 20`), background | Same key, same shape — imported styles must render equivalently | P1 | R1 | `ui/subtitles/SubtitlesFragment.kt:61-92, 263-267` | High |
| FEAT-SUB-3 | Chromecast caption style | Separate `chome_subtitle_settings` key (note the upstream spelling) with `SaveChromeCaptionStyle` | Preserved for round-trip; inert unless a casting path exists | P3 | R6 | `ui/subtitles/ChromecastSubtitlesFragment.kt:44, 95-104` | High |
| FEAT-SUB-4 | Subtitle timing offset | `SubtitleOffsetItemAdapter` provides ± offset during playback | Same, with `Shift+G`/`Shift+H`-style shortcuts | P2 | R4 | `ui/player/SubtitleOffsetItemAdapter.kt` | High |
| FEAT-SUB-5 | Subtitle auto-download | `subs_auto_download` (a language list, default `["en"]`) drives fetches from OpenSubtitles / Addic7ed / SubDL / SubSource | Same key, same providers | P1 | R1 | `SubtitlesFragment.kt:299`; `syncproviders/providers/{OpenSubtitlesApi,Addic7ed,Subdl,SubSource}.kt` | High |
| FEAT-SUB-6 | Subtitle auto-select | `subs_auto_select`, a single IETF tag, default `"en"` | Same | P1 | R1 | `SubtitlesFragment.kt:303` | High |
| FEAT-SUB-7 | Subtitle language filter | `filter_sub_lang_key` restricts offered languages | Same | P2 | R1 | key `filter_sub_lang_key` | High |

---

# 9. Downloads

## FEAT-DL-1 — Download queue

**Description.** Queued, resumable, concurrent downloading of episodes/movies to local storage.

**Android behavior.** `VideoDownloadManager` (2,095 lines) plus `DownloadQueueManager` and two services (`VideoDownloadService`, `DownloadQueueService`). A queue item is a `DownloadQueueWrapper` wrapping either a `DownloadResumePackage` (resume) or a `DownloadQueueItem` (new), with `id`/`parentId` derived from the episode. State keys: `download_resume_2` (`KEY_RESUME_PACKAGES`), `download_info` (`KEY_DOWNLOAD_INFO`), `download_resume_queue_key`, and the queue key. `DOWNLOAD_PARTIAL_MIN_SIZE` is 50 MiB. Concurrency is governed by `download_parallel_key` and `download_concurrent_key`. Progress is reported through notifications at a 1 s update rate.

**Desktop behavior.** TypeScript `DownloadService` main-process manager backed by `MediaDownloadResolver`.
- **Progressive HTTP/BitTorrent:** Routed to embedded `aria2c` daemon over loopback JSON-RPC (`UTIL-17`).
- **HLS/DASH Segmented:** Dedicated segment downloader + `FFmpeg` remuxing pipeline.
- **Provider-Attributed Errors:** Surfacing provider error context ("Source URL expired", "Choose alternate mirror") rather than generic failures.
- **Auto-Resume Queue:** Queue state stored in `better-sqlite3` DB; automatically resumes transfers on app launch.
- **Desktop System Folder Organization:** Default path `%USERPROFILE%\Downloads\CloudStream\MediaCategory\Title\S01E01.mp4`.
- **Direct Dialog Action:** Integrated "Download" button directly inside the episode quality/source selector dialog.

**Actors.** User.
**Trigger.** Download action on an episode/season/movie.
**Preconditions.** The provider advertises `hasDownloadSupport`; a writable download directory; sufficient free space.

**Main workflow.** Enqueue → `MediaDownloadResolver` checks `ExtractorLink` → dispatch to `aria2c` or `HLS/DASH Engine` → update progress → `FFmpeg` remux if needed → complete → record metadata in `better-sqlite3`.

**Alternative workflows.** Pause / resume / cancel / retry. Bulk-enqueue a season. Reorder queue via drag-and-drop. Auto-download for subscribed shows (`AutoDownloadMode`).

**Error workflows.** Network loss ⇒ retry with backoff, then park as resumable. Disk full ⇒ pause queue and surface low-space notification; never write incomplete truncated files. Link expiry ⇒ auto-re-resolve via provider `loadLinks`. Corrupt partial ⇒ restart chunk. Source error ⇒ attribute provider and offer alternative mirror.

**Postconditions.** Download metadata written; the item becomes offline-playable.

**Data affected.** `download_header_cache`, `download_episode_cache` (+ their `BACKUP_` variants), `download_info`, `download_resume_2`, `download_resume_queue_key`, queue key. **All except the download-header caches are excluded from backup.**

**Dependencies.** FEAT-PLAY-1 (link resolution), FEAT-EXT-*, UTIL-17 (`aria2`), UTIL-18 (`yt-dlp`).

**Platform differences.** Android SAF/`SafeFile` URIs are replaced by native absolute paths. Android's `MANAGE_EXTERNAL_STORAGE` model has no desktop analogue. Path rules in [18](18-technical-reference.md) §5.

**Acceptance criteria.**
- AC: Pause/resume survives an app restart automatically.
- AC: Concurrency honors both parallel and concurrent settings.
- AC: A disk-full condition never produces a file that is reported complete.
- AC: Downloaded items play offline with their subtitles.
- AC: The download directory is user-selectable through a native dialog and follows automatic subfolder organization.
- AC: `aria2` engine details remain 100% hidden from the end user.

**Priority.** P0. **Strategy.** R2.

**Evidence.**
- `app/.../utils/downloader/DownloadManager.kt:113, 191-204, 683` — manager object, size threshold, state keys, update rate.
- `app/.../utils/downloader/DownloadObjects.kt:26-73, 109-163` — queue and metadata models.
- `app/.../utils/downloader/DownloadQueueManager.kt` — queue key and ordering.
- `app/.../utils/BackupUtils.kt:90-109` — the explicit exclusion of download state from backups, with reasons.
- `donottranslate-strings.xml` — `download_parallel_key`, `download_concurrent_key`, `download_path_key`.

**Confidence: High.**

**Risks.** Resumable segmented downloading with correct HLS/DASH remuxing is a large, easily underestimated subsystem.

**Tests.** Restart-mid-download; disk-full; link expiry; 20-item queue; HLS remux integrity; offline playback of the result.

---

## FEAT-DL-2..10 — compact

| ID | Feature | Android | Desktop | Prio | Strat | Evidence | Conf |
|---|---|---|---|---|---|---|---|
| FEAT-DL-2 | Download storage location | `download_path_key` + `download_path_key_visual`; SAF content URIs via `SafeFile` | Native folder picker; absolute path. **Both keys are backup-excluded on Android and must be excluded on desktop too** | P1 | R2 | `BackupUtils.kt:72-75`; `utils/downloader/DownloadFileManagement.kt` | High |
| FEAT-DL-3 | Downloaded-media browser | `ui/download/` fragments list downloaded titles/episodes | Same, plus "reveal in file manager" | P1 | R4 | `ui/download/` (5 files) | High |
| FEAT-DL-4 | Offline playback | `OfflinePlaybackHelper` + `DownloadFileGenerator` | Same | P1 | R1 | `ui/player/OfflinePlaybackHelper.kt`, `DownloadFileGenerator.kt` | High |
| FEAT-DL-5 | Download queue UI | `ui/download/queue/` + `download_queue.xml` menu | Dedicated queue panel with drag-reorder, Pause All, Resume All, and provider error attribution | P2 | R4 | `ui/download/queue/`; `res/menu/download_queue.xml` | High |
| FEAT-DL-6 | Auto-download for subscriptions | `AutoDownloadMode` enum | Same | P2 | R1 | `MainAPI.kt:1144-1150` | High |
| FEAT-DL-7 | Download button component | `ui/download/button/` custom progress control | Equivalent component embedded in media detail & source/quality picker | P2 | R4 | `ui/download/button/` (4 files) | High |
| FEAT-DL-8 | Disk-space awareness | Implicit | **Explicit desktop requirement:** pre-flight free-space check and a live low-space warning | P1 | Desktop-only | — | High (new) |
| FEAT-DL-9 | Download metadata export | Not supported (deliberately) | **Desktop-only:** an optional sidecar metadata file per download directory, enabling library reconstruction after a move | P3 | Desktop-only | `BackupUtils.kt:90-94` | High |
| FEAT-DL-10 | `yt-dlp` Fallback Extraction & Universal Link Paste | Not supported | **Desktop Enhancement:** Used as an optional fallback extractor (`ExtractorApi` fallback) when native provider scripts fail, and for direct URL paste in search bar | P2 | Desktop-only | `https://github.com/yt-dlp/yt-dlp` | High (new) |

---

# 10. Extensions

## FEAT-EXT-1 — Repository management

**Description.** Users add repository URLs that list installable plugins.

**Android behavior.** A `RepositoryData` list at data-store key `REPOSITORIES_KEY`; a `PREBUILT_REPOSITORIES` array ships with the app. A repository URL resolves to a `Repository` JSON (`iconUrl`, `name`, `description`, `manifestVersion`, `pluginLists[]`), each `pluginLists` entry returning an array of `SitePlugin`. Fetches are cached 5 minutes. URL entry accepts full URLs, the `cloudstreamrepo://` scheme, `https://cs.repo/?…`, and **short codes** resolved through `cutt.ly`, or `py.md` when prefixed with `!`. `raw.githubusercontent.com` URLs are optionally rewritten to `cdn.jsdelivr.net` when `jsdelivr_proxy_key` is set. Repository add/remove is mutex-guarded and de-duplicated by URL.

**Desktop behavior.** Identical model, identical keys, identical URL grammar including short codes and the jsDelivr rewrite. Desktop adds drag-and-drop of a repository URL and a paste-from-clipboard affordance.

**Actors.** User.
**Trigger.** Settings → Extensions → Add repository; `cloudstreamrepo://` deep link; `https://cs.repo` link.
**Preconditions.** Network.

**Main workflow.** Enter URL/code → resolve → fetch repository JSON → fetch plugin lists → display installable plugins.

**Alternative workflows.** Add via deep link. Remove a repository (which also deletes its downloaded plugins and their data).

**Error workflows.** Unreachable ⇒ error with retry; the repository is still added if the user confirms. Malformed JSON ⇒ reject with a clear reason. Short-code resolution failing (404 sentinels are explicitly checked) ⇒ explain that the code is invalid.

**Postconditions.** `REPOSITORIES_KEY` updated.

**Data affected.** Data store `REPOSITORIES_KEY` — **this is transferable and must migrate.**

**Dependencies.** FEAT-EXT-2, FEAT-NET-1.

**Platform differences.** None material.

**Acceptance criteria.**
- AC: All four URL entry forms work, including `!`-prefixed py.md codes.
- AC: The jsDelivr rewrite matches Android's regex behavior exactly.
- AC: Removing a repository removes its plugins and their stored data.
- AC: Repository lists survive Android → desktop import.

**Priority.** P0. **Strategy.** R1.

**Evidence.**
- `app/.../plugins/RepositoryManager.kt:33-76` — `Repository` and `SitePlugin` shapes.
- `app/.../plugins/RepositoryManager.kt:100-104, 124-130` — prebuilt repos, GitHub regex, jsDelivr rewrite.
- `app/.../plugins/RepositoryManager.kt:132-159` — the URL grammar including cutt.ly and py.md short codes.
- `app/.../plugins/RepositoryManager.kt:242-284` — add/remove, mutex, de-duplication, cascade delete.
- `app/.../ui/settings/extensions/` — `REPOSITORIES_KEY`, `RepositoryData`.

**Confidence: High.**

**Risks.** Repository URLs are attacker-controlled input that leads to code download; validation is a security boundary ([11](11-security-and-compliance.md) §4).

**Tests.** All four URL forms; 404 sentinel handling; jsDelivr rewrite equivalence; cascade delete; import round-trip.

---

## FEAT-EXT-2 — Plugin install, update, and load

**Description.** Downloading, verifying, storing, and executing provider plugins.

**Android behavior.** A plugin is a `.cs3` (or `.zip`) file. Download goes to a temp file, is SHA-256 verified against `fileHash` when present (format `"sha256-<hex>"`), then **atomically moved** into place (`ATOMIC_MOVE`, falling back to a plain move). Install path is deterministic: `filesDir/Extensions/<sanitized(repoUrl)>.<repoUrl.hashCode()>/<sanitized(internalName)>.<internalName.hashCode()>.cs3` — and the code notes this path *is* the installed-detection mechanism. Loading: set read-only → `PathClassLoader` → read `manifest.json` → `loadClass(pluginClassName)` → no-arg construct → `load(context)`. Installed plugins are recorded as `PluginData{internalName,url,isOnline,filePath,version}` under `PLUGINS_KEY` (online) or `PLUGINS_KEY_LOCAL` (local). Auto-update triggers when the remote `version` exceeds the stored one, or equals `-1` (`PLUGIN_VERSION_ALWAYS_UPDATE`); `status == 0` disables a plugin remotely. A **safe mode** exists: a file named `safe` in `<externalStorage>/Cloudstream3/`, or a prior load error, suppresses all plugin loading.

**Desktop behavior.** The install/verify/store lifecycle is preserved almost exactly — atomic move, SHA-256 verification, deterministic paths, `PluginData` records, remote-disable, always-update, and safe mode. **Execution is entirely different** and is specified in [27-plugin-and-extension-architecture.md](27-plugin-and-extension-architecture.md).

**Actors.** User; automatic updater.
**Trigger.** Install action; app start with `auto_update_plugins`; missing-plugin auto-download with `auto_download_plugins_key2`.
**Preconditions.** A resolvable repository.

**Main workflow.** Select plugin → download to temp → verify hash → atomic move → record `PluginData` → load → register providers.

**Alternative workflows.** Local plugin from disk (Android watches `<externalStorage>/Cloudstream3/plugins`). Hot reload (used by the upstream Gradle `deployWithAdb` task, triggered by the bare `cloudstreamapp:` intent). Manual update-all.

**Error workflows.** Hash mismatch ⇒ delete the temp file and abort with an explicit message (Android throws `IllegalStateException` naming expected vs actual). Load failure ⇒ toast, continue with other plugins, record the error so safe mode engages next start. Missing `manifest.json` ⇒ refuse to load.

**Postconditions.** `PLUGINS_KEY` / `PLUGINS_KEY_LOCAL` updated; providers registered.

**Data affected.** `PLUGINS_KEY`, `PLUGINS_KEY_LOCAL` — **both explicitly excluded from backup**, along with `auto_download_plugins_key2` (to prevent a restore from mass-downloading plugins).

**Dependencies.** FEAT-EXT-1, [27](27-plugin-and-extension-architecture.md).

**Platform differences.** The entire execution model. Also: Android's plugin directory lives on external storage; desktop uses the app-data directory.

**Acceptance criteria.**
- AC: SHA-256 verification is mandatory when the repository supplies a hash, and failure aborts installation.
- AC: Installation is atomic — an interrupted install never leaves a loadable partial plugin.
- AC: Remote `status == 0` disables a plugin without uninstalling it.
- AC: `version == -1` always updates.
- AC: Safe mode suppresses all plugin loading and is user-discoverable.
- AC: Plugin binaries are never written into a backup; repository URLs are.

**Priority.** P0. **Strategy.** R1 for lifecycle; see [27](27-plugin-and-extension-architecture.md) for execution.

**Evidence.**
- `app/.../plugins/PluginManager.kt:79-108` — `PluginData` shape and `toSitePlugin`.
- `app/.../plugins/PluginManager.kt:109-112` — `PLUGIN_VERSION_NOT_SET`, `PLUGIN_VERSION_ALWAYS_UPDATE`.
- `app/.../plugins/PluginManager.kt:225-243` — `OnlinePluginData`, `isOutdated`, `isDisabled`.
- `app/.../plugins/PluginManager.kt:593-686` — the load sequence.
- `app/.../plugins/PluginManager.kt:571-587` — safe mode.
- `app/.../plugins/PluginManager.kt:737-756` — deterministic path derivation.
- `app/.../plugins/RepositoryManager.kt:107-122, 193-240` — SHA-256 helper and atomic download.
- `app/.../utils/BackupUtils.kt:60-62, 110-112` — plugin-related backup exclusions.

**Confidence: High.**

**Risks.** This is the primary code-execution surface. Any weakening of hash verification or the sandbox is a critical vulnerability.

**Tests.** Hash-mismatch abort; interrupted install; remote disable; always-update; safe-mode engagement; backup exclusion.

---

## FEAT-EXT-3..10 — compact

| ID | Feature | Android | Desktop | Prio | Strat | Evidence | Conf |
|---|---|---|---|---|---|---|---|
| FEAT-EXT-3 | Plugin browser UI | `ExtensionsFragment` + `PluginsFragment`, searchable, with status badges | Same, as a two-pane desktop layout | P1 | R4 | `ui/settings/extensions/` (7 files) | High |
| FEAT-EXT-4 | Plugin voting | `VotingApi` (101 lines) submits/reads plugin votes | Same service | P3 | R1 | `plugins/VotingApi.kt` | High |
| FEAT-EXT-5 | Auto-update plugins | `auto_update_plugins` on start | Same key; runs on start and on a schedule | P1 | R2 | key `auto_update_plugins_key`; `PluginManager.kt:274` | High |
| FEAT-EXT-6 | Auto-download missing plugins | `auto_download_plugins_key2`; downloads plugins referenced by data but not installed | Same; **the key stays backup-excluded** so a restore cannot trigger mass downloads | P2 | R2 | `PluginManager.kt:352`; `BackupUtils.kt:112` | High |
| FEAT-EXT-7 | Manual update check | `manual_update_plugins` | Same | P2 | R1 | key `manual_update_plugins_key` | High |
| FEAT-EXT-8 | Provider override / clone site | `override_site_key` + `ProvidersInfoJson{name,url,credentials}` lets a user repoint a provider's `mainUrl`, gated by `canBeOverridden` | Same model and key | P2 | R1 | `MainAPI.kt:398-408, 494-521`; key `override_site_key` | High |
| FEAT-EXT-9 | Provider pinning | `user_pinned_providers`, a `String[]` | Same key | P2 | R1 | `DataStoreHelper.kt:60, 827-829` | High |
| FEAT-EXT-10 | Provider testing tool | `ui/settings/testing/` runs provider self-tests; `test_providers_key` | Same, valuable for a forked ecosystem | P2 | R1 | `ui/settings/testing/` (4 files); `utils/TestingUtils.kt` | High |

---

# 11. Sync and trackers

## FEAT-SYNC-1 — Tracker account linking

**Description.** OAuth linking to MyAnimeList, AniList, Kitsu, and Simkl, plus API-key/credential linking to subtitle services and AnimeSkip.

**Android behavior.** `AccountManager` holds all API singletons and an `allApis` array of repositories (`SyncRepo`, `SubtitleRepo`, `PlainAuthRepo`). Credentials live at `auth_tokens/<idPrefix>/<profileIndex>` as an `AuthData[]`; the active account id at `auth_ids/<idPrefix>/<profileIndex>`; `NONE_ID = -1`. OAuth redirects arrive via the `cloudstreamapp://` scheme and are dispatched by `isValidRedirectUrl`. Older per-service token keys (`anilist_token`, `mal_token`, `mal_refresh_token`, `simkl_token`, …) are deprecated but still explicitly excluded from backups.

**Desktop behavior.** Same providers, same key layout. OAuth uses the system browser with a registered custom protocol handler (loopback redirect where a provider permits it — preferable, since protocol registration is unreliable on some Linux desktops). **Tokens are stored in the OS keychain, not in the data store** — a security improvement over Android, with the data-store key kept empty for shape compatibility.

**Actors.** User.
**Trigger.** Settings → Accounts → link.
**Preconditions.** Network; a registered client id (build-time secrets).

**Main workflow.** Choose service → open system browser → user authorizes → redirect returns to the app → token exchanged and stored → account id recorded.

**Alternative workflows.** Multiple accounts per service (the storage is an array). Manual API-key entry for subtitle services. Unlink.

**Error workflows.** Redirect never returns ⇒ timeout with a manual-paste fallback. Token expired ⇒ refresh; if refresh fails, prompt re-auth without destroying local library data.

**Postconditions.** `auth_tokens/...`, `auth_ids/...` written (desktop: keychain + id record).

**Data affected.** `auth_tokens`, `auth_ids` — **both excluded from backup by design, on both platforms.**

**Dependencies.** FEAT-SYNC-2..6, FEAT-SHARE-2 (protocol handling).

**Platform differences.** Client secrets are compiled into the Android APK (`SIMKL_CLIENT_ID`, `SIMKL_CLIENT_SECRET`, `MAL_KEY`, `ANILIST_KEY`, and `TRAKT_CLIENT_ID`/`MDL_API_KEY` in the library). A desktop build must obtain its own credentials — reusing upstream's is not appropriate. See [21](21-open-issues-and-assumptions.md) OQ-5.

**Acceptance criteria.**
- AC: A user can link each supported service and see their remote library.
- AC: Tokens never appear in any export.
- AC: Token loss never destroys local library data.
- AC: Multiple accounts per service are supported.

**Priority.** P1. **Strategy.** R4.

**Evidence.**
- `app/.../syncproviders/AccountManager.kt:19-108` — API singletons, `allApis`, `ACCOUNT_TOKEN`/`ACCOUNT_IDS`, the `<idPrefix>/<profile>` key layout, `NONE_ID`.
- `app/.../MainActivity.kt:296-326` — redirect dispatch through `isValidRedirectUrl`.
- `app/.../utils/BackupUtils.kt:64-65, 79-87` — token exclusions.
- `app/build.gradle.kts:118-137` — build-time client secrets.
- `library/build.gradle.kts:105-118` — `MDL_API_KEY`, `TRAKT_CLIENT_ID`.

**Confidence: High.**

**Risks.** Protocol-handler registration is unreliable on Linux; design the loopback fallback from the start.

**Tests.** Each provider's OAuth round-trip; export excludes tokens; refresh failure preserves local data; multi-account.

---

## FEAT-SYNC-2..6 — compact

| ID | Feature | Android | Desktop | Prio | Strat | Evidence | Conf |
|---|---|---|---|---|---|---|---|
| FEAT-SYNC-2 | Tracker library as a Library page | Each `SyncAPI` supplies `Page`s consumed by the Library | Same | P1 | R1 | `syncproviders/SyncAPI.kt`; `library/.../syncproviders/SyncAPI.kt` | High |
| FEAT-SYNC-3 | Episode-progress push | `episode_sync_enabled_key` pushes watched progress to the tracker | Same key | P1 | R1 | key `episode_sync_enabled_key` | High |
| FEAT-SYNC-4 | Sync-id mapping | `<idPrefix>_sync/<id>` → URL, letting a local title map to MAL/AniList/Kitsu/Simkl ids | Same key shape; **transferable and must migrate** | P1 | R1 | `DataStoreHelper.kt:817-825`; `utils/SyncUtil.kt` | High |
| FEAT-SYNC-5 | Cached tracker lists | `ANILIST_CACHED_LIST`, `MAL_CACHED_LIST`, `KITSU_CACHED_LIST` — **all backup-excluded** | Same caches, same exclusion | P2 | R1 | `BackupUtils.kt:56-58` | High |
| FEAT-SYNC-6 | Subtitle-service accounts | OpenSubtitles, SubDL, Addic7ed, SubSource; legacy `open_subtitles_user`/`subdl_user` keys backup-excluded | Same | P1 | R1 | `AccountManager.kt:28-31, 69-73`; `BackupUtils.kt:85-86` | High |

---

# 12. Settings

Settings are specified individually rather than as one "Settings" feature. The complete key catalogue with types and defaults is in [18-technical-reference.md](18-technical-reference.md) §2.

| ID | Setting group | Android screen | Desktop treatment | Prio | Strat | Conf |
|---|---|---|---|---|---|---|
| FEAT-SET-1 | General (language, downloads path, parallel/concurrent downloads, DNS, jsDelivr proxy, site override, legal notice) | `settings_general.xml` | Same, minus `battery_optimisation` (**R6**, no desktop analogue) | P1 | R4 | High |
| FEAT-SET-2 | Player (quality prefs, default player, buffers, subtitle entry points, TV category) | `settings_player.xml` | Same; buffer keys map onto the chosen backend | P1 | R4 | High |
| FEAT-SET-3 | Providers (provider language, preferred media type, display sub, NSFW toggle, provider testing) | `settings_providers.xml` | Same | P1 | R1 | High |
| FEAT-SET-4 | UI (primary color, theme, layout, poster size/style, bottom title, overscan, trailers, Kitsu posters, cast in details, fillers, player metadata, TV clock, confirm exit, search-quality filter) | `settings_ui.xml` | Same, plus a desktop-native theme following the OS light/dark preference. `overscan_key` is TV-specific but retained for 10-foot mode | P1 | R4 | High |
| FEAT-SET-5 | Updates & backup (APK installer, backup, automatic backup, restore, backup path, plugin auto-update/auto-download/manual update, logcat) | `settings_updates.xml` | `apk_installer_key` becomes an update-channel/installer preference (**R4**); the rest map directly | P1 | R4 | High |
| FEAT-SET-6 | Accounts (MAL, Kitsu, AniList, Simkl, OpenSubtitles, SubDL, AnimeSkip, skip startup selector, biometric) | `settings_account.xml` | Same | P1 | R4 | High |
| FEAT-SET-7 | Gesture settings | `pref_category_gestures_key` group | Mouse/keyboard equivalents; brightness inert (see FEAT-PLAY-8) | P2 | R4 | High |
| FEAT-SET-8 | Android TV settings | `pref_category_android_tv_key`, `android_tv_interface_off_seek_key`, `android_tv_interface_on_seek_key`, `tv_layout_clock_key` | Retained under 10-foot mode | P2 | R4 | High |
| FEAT-SET-9 | Security settings | `pref_category_security_key` | Retained | P2 | R4 | High |
| FEAT-SET-10 | Poster/card display (`show_hd_key`, `show_dub_key`, `show_sub_key`, `show_rating_key`, `show_title_key`, `show_episode_text_key`, `poster_size_key`, `poster_ui_key`, `bottom_title_key`) | `settings_ui.xml` + card builder | Same keys | P2 | R1 | High |
| FEAT-SET-11 | Easter egg (`benene_count`) | A counter incremented by repeated taps | Preserved — it is user data and appears in backups | P3 | R1 | High |
| FEAT-SET-12 | Settings search | Not present upstream | **Desktop-only enhancement:** searchable settings, valuable given ~100 keys | P3 | Desktop-only | High (new) |

**Evidence for §12.** `app/src/main/res/xml/settings_*.xml` (6 files); `app/src/main/res/values/donottranslate-strings.xml` (full key catalogue); `app/.../ui/settings/` (10 files).

---

# 13. Network

| ID | Feature | Android | Desktop | Prio | Strat | Evidence | Conf |
|---|---|---|---|---|---|---|---|
| FEAT-NET-1 | HTTP client | NiceHttp/OkHttp with `cacheTime`/`cacheUnit`, per-provider interceptors, custom headers/cookies | Node HTTP stack with identical caching semantics and per-provider cookie jars | P0 | R2 | `libs.versions.toml:48`; `MainAPI.kt:702-706`; `RepositoryManager.kt:164,172` | High |
| FEAT-NET-2 | DNS-over-HTTPS | `dns_key` selects a DoH provider | Same key; DoH in the main process | P2 | R2 | key `dns_key`; `settings_general.xml` | High |
| FEAT-NET-3 | WebView-based resolution | Providers set `usesWebView`; `WebViewResolver` runs JS and intercepts requests; a JVM actual already exists | An offscreen, isolated `BrowserWindow` acting as a resolver, driven from the main process. **Never the UI renderer** | P1 | R3 | `MainAPI.kt:558`; `library/src/jvmMain/.../WebViewResolver.jvm.kt`; `library/.../network/` | High |
| FEAT-NET-4 | JS execution for extraction | Rhino in `:library` (`JsInterpreter`, `JsUnpacker`, `JsHunter`); Zipline is a declared app dependency but **not referenced anywhere in Kotlin source** | Native JS execution is trivially available; must remain sandboxed | P1 | R3 | `library/.../utils/{JsInterpreter,JsUnpacker,JsHunter}.kt`; `libs.versions.toml:49,58`; grep shows `zipline` only at `app/build.gradle.kts:277` | High |

---

# 14. Backup and migration

| ID | Feature | Android | Desktop | Prio | Strat | Evidence | Conf |
|---|---|---|---|---|---|---|---|
| FEAT-BKP-1 | Manual backup | Writes `CS3_Backup_<yyyy_MM_dd_HH_mm>.txt` — JSON with `datastore` + `settings`, each in six type buckets — to `backup_path_key` or the Downloads folder | Same format available as an **Android-compatible export**, plus a richer native desktop export | P0 | R1 | `BackupUtils.kt:123-137, 200-247` | High |
| FEAT-BKP-2 | Restore | `OpenDocument` picker accepting 7 MIME types; parses `BackupFile`; blind key/value merge; **then calls `activity.recreate()`** | Full validated import pipeline per [25](25-data-portability-and-migration.md) — preview, pre-import snapshot, staged commit, rollback, and a migration report | P0 | R1 | `BackupUtils.kt:249-317` | High |
| FEAT-BKP-3 | Automatic backup | `automatic_backup_key` schedules `BackupWorkManager` periodic work | Same key; a main-process scheduler with retention limits | P2 | R2 | `services/BackupWorkManager.kt:20-58`; key `automatic_backup_key` | High |
| FEAT-BKP-4 | Backup location | `backup_path_key`, `backup_dir_path_key` — **both backup-excluded** | Native folder picker; keys preserved and still excluded | P2 | R2 | `BackupUtils.kt:74-75, 331-347` | High |
| FEAT-BKP-5 | Non-transferable key filter | `nonTransferableKeys` filtered by **substring `contains`**, not exact match | Must reproduce the substring semantics exactly, or exports will differ | P0 | R1 | `BackupUtils.kt:55-118` | High |

> **Note on FEAT-BKP-5.** Android's filter is `!nonTransferableKeys.any { key.contains(it) }`. Substring matching means any key *containing* e.g. `"mal_token"` is excluded. Implementing this as equality would leak keys Android excludes. This is a subtle but load-bearing detail.

---

# 15. Updates

| ID | Feature | Android | Desktop | Prio | Strat | Evidence | Conf |
|---|---|---|---|---|---|---|---|
| FEAT-UPD-1 | In-app update | Polls `api.github.com/repos/<user>/<repo>/releases`; downloads and installs an APK via `PackageInstaller`; `auto_update_key`, `skip_update_key`, `apk_installer_key` | `electron-updater` against a signed feed; same user-facing toggles | P1 | R2 | `utils/InAppUpdater.kt:101, 155-156`; `utils/PackageInstaller.kt`; `services/PackageInstallerService.kt` | High |
| FEAT-UPD-2 | Prerelease channel | A `prerelease` product flavor with its own applicationId suffix, signing config, `-PRE` version suffix, and a timestamp versionCode; `install_prerelease_key` | Stable and prerelease update channels; same preference key | P2 | R4 | `app/build.gradle.kts:163-178`; key `install_prerelease_key` | High |
| FEAT-UPD-3 | Manual update check | `manual_check_update` | Same | P2 | R1 | key `manual_check_update_key` | High |

---

# 16. Sharing and deep links

| ID | Feature | Android | Desktop | Prio | Strat | Evidence | Conf |
|---|---|---|---|---|---|---|---|
| FEAT-SHARE-1 | Share a title | `csshare://<base64(apiName)>?<base64(url)>` — note the **unusual order**: the segment before `?` is the api name, after is the url | Same URI grammar so links interoperate with Android | P2 | R1 | `MainActivity.kt:383-396` | High |
| FEAT-SHARE-2 | Protocol handlers | Six custom schemes plus `https://cs.repo` | Register all six as OS protocol handlers | P1 | R2 | `AndroidManifest.xml:180-243`; `MainActivity.kt:281-400` | High |
| FEAT-SHARE-3 | File associations | `VIEW` on video MIME types, `magnet:`, `.torrent`, `content://` video | Register video extensions, `magnet:`, and `.torrent` per OS | P2 | R2 | `AndroidManifest.xml:32-45, 112-145` | High |
| FEAT-SHARE-4 | Search deep link | `cloudstreamsearch://<urlencoded query>` navigates to search and pre-fills | Same | P3 | R1 | `MainActivity.kt:340-355` | High |

---

# 17. External playback targets

| ID | Feature | Android | Desktop | Prio | Strat | Evidence | Conf |
|---|---|---|---|---|---|---|---|
| FEAT-CAST-1 | Chromecast | Google Cast SDK: `CastHelper`, `CastOptionsProvider`, `MiniControllerFragment`, `ControllerActivity`, expanded-controller menu, and a dedicated chromecast subtitle style | **Unsupported.** The Cast SDK has no Electron binding. Offer DLNA and FCast as alternatives, and preserve `chome_subtitle_settings` for round-trip | P2 | R5/R6 | `utils/CastHelper.kt`, `utils/CastOptionsProvider.kt`, `ui/ControllerActivity.kt`, `ui/MiniControllerFragment.kt`; `res/menu/cast_expanded_controller_menu.xml` | High |
| FEAT-CAST-2 | External player handoff | `VideoClickAction` framework with packages for VLC, MPV (3 variants), Just Player, Next Player, Web Video Cast, Aria2, BiglyBT, LibreTorrent, plus copy-link, play-in-browser, view-M3U8, play-mirror, and always-ask | Desktop equivalents: launch VLC/mpv/IINA/etc. with the URL and headers; copy link; open in browser. The action framework itself should be preserved so plugins can register actions | P1 | R4 | `actions/` and `actions/temp/` (16 files); `actions/VideoClickAction.kt`; `plugins/Plugin.kt:22-29` | High |
| FEAT-CAST-3 | FCast | `actions/temp/fcast/` (4 files) implements the FCast protocol | Same protocol, fully implementable in Node | P2 | R2 | `actions/temp/fcast/` | High |
| FEAT-CAST-4 | Android TV "watch next" | `TvChannelUtils` writes to the Android TV EPG via `WRITE_EPG_DATA` | **Unsupported** — no desktop analogue | P3 | R6 | `utils/TvChannelUtils.kt`; `AndroidManifest.xml:13,19` | High |

---

# 18. Diagnostics

| ID | Feature | Android | Desktop | Prio | Strat | Evidence | Conf |
|---|---|---|---|---|---|---|---|
| FEAT-DIAG-1 | In-app log viewer | `show_logcat_key` + `LogcatAdapter` show recent logs | Same, reading the app's own rotating log; **must redact tokens before display or export** | P2 | R4 | `ui/settings/LogcatAdapter.kt`; key `show_logcat_key` | High |
| FEAT-DIAG-2 | Crash reporting | ACRA (`AcraApplication`) | Opt-in crash reporting; **must default to off** and never transmit provider URLs or tokens without consent | P2 | R4 | `AcraApplication.kt` | High |
| FEAT-DIAG-3 | Provider self-test | `TestingUtils` + `ui/settings/testing/` exercise providers and report failures | Same; more valuable on desktop given a forked provider ecosystem | P2 | R1 | `utils/TestingUtils.kt`; `ui/settings/testing/` | High |

---

## Next steps

1. Review P0 features first — they define the release-blocking surface.
2. Confirm the FEAT-PLAY-8 brightness and FEAT-CAST-1 Chromecast limitations with the sponsor; both are visible regressions users will notice.
3. Feed every feature ID into [24-feature-parity-matrix.md](24-feature-parity-matrix.md) and [23-manifest.json](23-manifest.json) for traceability.
4. Convert acceptance criteria here into executable tests per [13-testing-and-qa.md](13-testing-and-qa.md).
