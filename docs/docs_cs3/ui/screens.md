# Screens (as implemented)

Each entry: entry points · layout · actions · states · data. File = `src/views/` unless noted. Wireframes:
[wireframes.md](wireframes.md).

## Sidebar (`components/Sidebar.tsx`)
* **Nav items:** Home, Search, Library, History, Downloads (badge = active+queued), Extensions (badge = running/waiting
  extension jobs; warn badge when components need setup), Settings. A "Clear search results" affordance appears under Search when results exist.
* **Streaming services:** discovered OTT platforms (`ott:<id>` tabs; Netflix, Prime Video, Disney+ plus any discovered), with
  a "Find a streaming service" button and "Choose which services appear here" (`StreamingServicePicker`). Row context menu: Pin/Unpin to top, Remove (hides; provider stays enabled). Adult-flagged platforms show an 18+ badge.
* Data: `ottPlatforms` from `ott:listPlatforms`, `downloadQueue`, `missingComponentCount`.

## Navbar (`components/Navbar.tsx`)
Search input (placeholder varies), clear (Esc), **Open a .torrent file**, clear current results, **Stop searching**, Search; the
**Source scope picker** (`SearchScopePicker`, with `SourceProfileBar` and `SourceScopeDialog`); **Incognito** toggle
(`Ctrl+Shift+N`); **provider inspector** (`F12`, developer mode). Suggestions appear in a dropdown (`api:suggest`).

## Home (`HomeView.tsx`)
* Hero (top of the first section — not a separate fetch), type tabs (counts; only tabs that leave something), toolbar
  with `CataloguePicker` (which home catalogue) and `RowPicker` (hide/show rows; hidden rows are not fetched).
* **Continue watching** rail (collapsible, clearable, dismiss per item; absent when the setting is off).
* Rows: `HomeRow` (rail capped at 20, draws near the viewport) → "Show all" opens `CategoryGrid` (infinite, `discover:more`).
* States: loading ("Loading what's popular right now"), stale cache shown instantly then replaced, offline from cache, empty.
* Cards: `PosterCard` with card state (`cardState.ts`), `ContentHoverCard`.

## Search (`SearchView.tsx`)
Header "Search Results for “q”" with live progress (bar, count, "N failed"), `FacetMenu` filters (type tabs with counts,
source filter), grouped results (`resultGroups.ts`), hidden dead rows with a "show them" toggle, **Save results**
(saved search), "Search all sources" action in the empty state (clears the stored scope and re-runs). Rows are
`PosterCard`s; opening one goes to Detail. States: searching, partial, done, nothing found (`explainEmpty` reason), saved view.

## Detail (`DetailView.tsx`, `components/detail/*`)
* **DetailHero:** poster/backdrop, title, year/runtime/genres, `MediaRatings`, **Play** ("Play the first episode" for series, or
  resume), `LibraryBucketSelector` (Watching/Completed/On hold/Plan to watch/Dropped), Download, Share, Trailer, bookmark, and
  a "more" menu: **Find more sources**, **Refresh sources**, **Search title**, **Download season**.
* Source-readiness badge on the artwork ("Finding sources…", "N sources ready") from the prefetcher.
* Series: season selector + episode list; resume position; per-episode play/download.
* **TitleMetadata** (cast with characters/photos, crew, notes, awards; four-state `looking | fallback | content | nothing`),
  **TrailerGallery** + `TrailerPopup` (own popup, autoplay offer with a 5 s countdown), **FranchiseRail**, **ReviewsAndExplanations**.
* **SourcePicker** (`components/SourcePicker.tsx`, `SourceFilterBar`): chain `repository ▸ extension ▸ provider`, export (CSV default), copy.
* Failure: `ProviderRecoveryPanel`, "Showing your saved copy of this page." notice, "Find <title> again", `CopyErrorButton`.
* Data: `api:loadMedia` (+ `DetailCache`, `PageSnapshotStore`), `metadata:getExtended` (push), `library:*`, `bookmarks:*`, `playback:*`.

## Library (`LibraryView.tsx`)
Chips: **Watching** (progress + buckets), **Saved** (`SavedSourcesList`, `PlayedSourcePanel`: playable when the link is usable,
"Find again" when expired), **Searches** (`SavedSearchesList`). Empty states via `EmptyState`.

## History (`HistoryView.tsx`)
Status pills: All Activity, Played, Failed, Downloaded, Attempted, Unchecked (with counts); items grouped by day/title
(`historyGrouping.ts`), per-item actions (reopen, delete, copy details), export (`historyExport.ts`), clear all. Paged via `history:list`.

## Downloads (`components/DownloadCenter.tsx`)
Search downloads, sort (Recent first/Oldest first/Title A–Z/Size), state sections (Downloading/Paused/Completed/Failed), **Pause All /
Resume All / Retry Failed / Clear Completed / Open Downloads Folder / Set up faster downloads**, per-item Pause/Cancel & Remove/
Show in Folder/Play here/open media details/copy debug info; batch rows with Cancel & Remove Batch. Empty: "No downloads yet".
Dialogs: `DownloadConfirmDialog`, `DeleteDownloadDialog`.

## Extensions (`components/extensions/ExtensionsScreen.tsx`)
`JobsTray` always on top. Tabs: **Installed** (`SourceTree` of repository ▸ extension ▸ provider with enable switches,
`FilterBar`, `BulkActionBar`, provenance and compatibility panels), **Browse** (`RepositoryCatalog` with a full-width listing panel;
`ExtensionCatalog`), **Built-in Sources** (`BuiltInSources`: native providers, Stremio addons, Jellyfin/Emby), **Updates**
(`ExtensionUpdates`: check, update one/all, policy). Search reaches through a repository to its extensions/providers.

## Streaming service page (`OttPlatformView.tsx`)
Platform header, provider rows loaded one provider at a time (progressive), "Load more" button (not infinite scroll),
platform-scoped search, adult age gate dialog, availability states (`ready/disabled/aggregate/missing`) with install/enable actions.

## Torrent view (`TorrentView.tsx`)
Opened from Navbar (.torrent) or a magnet: "Reading the torrent…", file list with filter and in-torrent search, per-file
**Stream this file now** and **Download only this file**, info hash.

## Settings (`SettingsView.tsx`)
Left column nav (+ search "Find a setting"): **General**, **Playback**, **Torrent & Indexer Sources**, **Downloads**, **Connection**,
**Setup & repair** (components: ffmpeg/ffprobe/mpv/aria2c/yt-dlp), **Advanced**, **Everything on one page**. Panels include
Search, adult content, provider ranking & privacy, Storage/Starting downloads/Removing downloads/Download engines, Torrents,
Developer mode, diagnostics (logs, startup profile, extension issues), backup/restore, About/Licences, region settings,
subtitle appearance, and (inside Playback) the player shortcuts reference and Incognito settings. Simple vs Everything switch states what it is holding back.

## Player — see [../architecture/player.md](../architecture/player.md)

## First run
`FirstRunBanner`, `RegionOnboarding` (pre-ticked from locale), `BinarySetupModal` (components), bootstrap progress.
