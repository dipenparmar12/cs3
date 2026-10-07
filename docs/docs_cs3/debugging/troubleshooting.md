# Troubleshooting Guide (symptom → owner → steps)

Each entry: **Start** · **Owner** (service/component/channel/store) · **Common causes** · **Sequence**. Architecture
references: [streaming](../architecture/streaming.md), [downloading](../architecture/downloading.md),
[providers](../architecture/providers.md), [caching](../architecture/caching.md).

## Search failures / no results
* **Owner:** `searchSession.ts` (`plan`, `runProviders`, `explainEmpty`), `PluginManager.searchEach`, `searchScope.ts`; channel `search:start/update`; store `cs3_search_scope`.
* **Causes:** a stored scope selecting nothing installed (reported via `missingProviders`); providers not yet loaded (first launch / warm-up); offline; adult gate off; every provider returned `empty` (legitimate).
* **Sequence:** header progress ("N failed") → scope picker (is a selection active? "All sources") → Extensions ▸ Installed (is the provider `effectivelyEnabled`?) → log (scope-tagged records such as `native_search_failed`; per-provider failures are in the issue ledger) → provider inspector.

## Provider failures
* **Owner:** `PluginManager` + sidecar; `failureTaxonomy`; `cs3-extension-issues.json`.
* **Sequence:** issues panel (cause + source) → `runtime:getStatus` (stale? sidecar up?) → run `provider-e2e.mjs --only <ext>` → if the harness fails, it is the extension/host/shim.
* **Quick table:** `provider-missing` ⇒ switched off/uninstalled/clash (`explainMissingProvider` names it); `runtime-unavailable` ⇒ sidecar down/timeout (never a verdict on the extension); `resource-leak`, `cancelled` ⇒ not scored; `NoClassDefFoundError`/`NoSuchMethodError` ⇒ a shim gap, **check the stale runtime first**.

## No sources found
* **Owner:** `ContentService.getSources/discover`, `sourceScope.ts`, `SourceCache`.
* **Causes:** origin scope with a provider that has nothing (auto-widening should run; check `scopeUsed`/`widened`); stale cached empty; links handle misused; title not resolvable (no IMDb id for indexers).
* **Sequence:** "Find more sources" (scope `all`) → Refresh sources (cache bypass) → `sources:getCacheStats` → log `source_resolution_failed` / `escalation_failed` → `explainEmptyResult` text.

## Source downloads but will not play
See [downloading.md §8](../architecture/downloading.md). **Owner:** `PlaybackEngine.prepare`, `decisionEngine`, `MediaProxy`. Check, in order: (1) Developer-mode plan — which strategy? (2) `media:getPlaybackDiagnostics` — probe result; (3) `describeUnreadableSource` — dead (4xx) vs undecodable; (4) range behaviour of the host (Range-ignoring origins cannot seek); (5) route to mpv (policy `native_engine_policy`, `mpv` installed?).

## Playback failure / codec or format failure
* **Owner:** player (`playbackRecovery.ts`, `PlaybackErrorPanel`), `PlaybackEngine`, `MediaTranscoder`.
* **Causes:** AC-3/E-AC-3/DTS or HEVC with no decoder (element silent/black) → mpv or transcode; DASH payload undecodable → `DASH_REMUX`; DRM (Widevine/PlayReady unsupported — reported by name); expired signed URL; ffmpeg option unsupported (`-extension_picky` detected per binary).
* **Sequence:** error panel text (+ original in developer mode) → plan/explanation overlay → ffprobe result → try external player/mpv → source failover.

## MPV failure
* **Owner:** `media/mpvEngine.ts`, `mpv:*`, `binaryDownloader.setupMpv`; tests `bun run test native` (needs mpv).
* **Causes:** mpv missing (`components:getStatus`; bundled under `resources/media/`), `mpv.exe` vs `mpv.com` (console front-end needed for diagnostics), concurrent open/stop race (serialised on one queue), a user's own `mpv.conf` (we pass `--no-config`), hwdec fallback (`hwdec-current`).
* **Sequence:** Settings → Setup & repair → test → `mpv:status` → log records with scope `mpv` (e.g. `engine_failed`) → hand-run `mpv.com --hwdec=help`.

## Subtitle failure
* **Owner:** `subtitleService.ts`, `subtitles/convert.ts`, `SubtitlePanel`. **Causes:** `.srt` served to `<track>` without conversion; non-UTF-8 charset; ASS conversion; no IMDb id; Incognito; timing offset applied to the wrong engine. **Sequence:** subtitle panel → saved library (`subtitles:listSaved`) → `subtitles:find` → converted VTT.

## Audio/video synchronisation
* **Owner:** engine in use. Element: check the transcode plan and `-itsoffset`/remux path; mpv: `sub-delay`/audio delay; first suspect a re-mux of a variable-frame-rate source. Compare with mpv (`NATIVE_MPV`) — if it plays in sync there, it is the browser/transcode path.

## Download failure
* **Owner:** `downloadService.ts` (`markFailed`, `decideResume`, `finalizeCompletion`), engine in use. **Causes:** expired URL (`RefreshingSource`), Range ignored (restart), size mismatch >1% (`Failed` with reason), aria2 port conflict (`getLastError`), disk path. **Sequence:** download row → "Copy debug info" → log `download_finalising`, `download_info_files_written`, `download_subtitle_failed` → `download:getQueue` task fields.

## Expired source URLs
Provider links carry `Expires`/`exp`/JWT; otherwise 20 min. A viewer-visible 403/400/410 → re-resolve (Refresh sources). `SourceCache.recordFailure` drops definitive failures; three soft failures drop a source. googleusercontent links expire in ~8 h and answer 400 after.

## Cloud / security verification (bot walls)
* **Owner:** `webViewHost.ts`, `clearance.ts`, `torrent/botChallenge.ts`. A Cloudflare challenge can arrive as HTTP 200. Block ≠ challenge ≠ rate limit; only a genuine challenge opens a browser. **Sequence:** log `webview_pattern_rejected`, `webview_script_failed`, `webview_cookies_unreadable`, `host_call_reply_failed` → check cooldown (10 min after a failed solve) → is the host the right one (clearances are per host)?

## Repository failure
* **Owner:** `pluginManager` repo fetch, `repositoryListingCache`. **Causes:** project-page URL not resolvable to a raw doc; DNS block of `raw.githubusercontent.com` (use DoH — default `automatic`); repository retired (GitHub 451). **Sequence:** Browse tab (cached listing shows?) → Settings → Connection → test → `survey-repositories.mjs`.

## Extension failure (install/update/load)
* **Owner:** `extensionUpdater.ts`, `extensionJobs.ts`, `archivePlacement.ts`. **Causes:** SHA mismatch (the error names the index that published the hash and declared vs arrived size — a mirror-metadata mismatch is the publisher's), `EPERM` rename (held archive → placed beside, swept later), `T4_BLOCKED` ⇒ rolled back. **Sequence:** Jobs tray row (reason, retry) → log `extension_update_failed/_rejected`, `extension_archive_locked`, `extension_cold_load_failed` → `extension:getRuntimeReport` → issues panel.

## Startup performance
* **Owner:** `startupProfile.ts`, `StartupQueue`. Read stalls first (they name the stage), then slowest stages, then queue state. Look for heavy module-scope imports (`webtorrent`, `cheerio`), synchronous spawns of big binaries, store hydration in constructors. See [caching.md §5](../architecture/caching.md#startup).

## Cache issues
Stale detail → open and wait for revalidation; clear via `sources:clearCache`, `metadata:clearCache`, Settings storage. A stale *provider list* → `loadProviders(force)`/bump generation. Remember: `getObject` re-parses JSON every call — do not call it per card.

## UI state issues
* Wrong enabled/disabled display → compare `enabled` vs `effectivelyEnabled`. Blank window after a split of a module → case-collision (`componentReachability`). A control with no effect → `ipcSurface` (unregistered channel). Stale card badge → `interactions:summarise` coalescing; `cardState.ts` retires disproved failures.

## IPC failures
`ipcRenderer.invoke` rejects on an unregistered channel; run `bun run test ipc`. Four edits must agree (service, `ipcMain.handle`, `preload.ts`, caller). Fallible handlers should return the `{ok,error}` envelope via `fail()`.
