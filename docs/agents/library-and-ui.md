# Library, downloads, UI and lifecycle

Domain notes for CloudStream 3 Desktop, covering §9, §10 and §11.

**Read `AGENTS.md` first.** It carries the repository map, the build and test commands, the
IPC contract, the service table and the rules that cut across every area. This file assumes it.

Section numbers here match `AGENTS.md`'s, so a cross-reference like `§6.10` resolves whichever
file you are in. **If this contradicts the code, the code wins — fix this file in the same commit.**

---

## 9. Library, pages, downloads

### 9.1 A links handle is not a page address

Upstream's `MainAPI` has two incompatible handle kinds under one `String` type: `load(url)` (a page address, fetched) and `loadLinks(data)` (an opaque provider-built blob, often JSON). Handing a links blob to `load()` reached OkHttp's `HttpUrl.get`, threw, **was scored against the provider** and shown as the reason playback failed — while the provider was fine. Reached from 3 directions, unified into `cs3/extensionAddress.ts`'s `looksLikeLinksHandle`. The test is narrow: JSON is definitely not a page; anything else might be (Internet Archive's `load()` takes a URL while `loadLinks` takes a bare id).

**The persisted form of the same bug**: `DetailView` recorded the playback handle as `progress.mediaUrl`, breaking library and Continue-Watching rows on the *second* visit. `libraryStore.recordProgress` keys on `canonicalKey(title, year)` + season + episode, **never `mediaUrl`**, so nothing is orphaned. Pre-fix rows are unrecoverable (a page address isn't derivable from a links blob); the failure screen offers "Find `<title>` again".

Two Play buttons wrote the same bug: `App.handleQuickPlay` and `DetailView.handlePlaySource` wrote `episode.url` into `progress.mediaUrl`, so series played that way always wrote a dead address and disabled next-episode prefetch. Fixed centrally — **`LibraryStore` refuses a links handle on the way in.**

**Play must not restart a series at episode one.** `src/utils/resumePoint.ts` (pure): **a null episode means "Play"**, not "play the series URL"; the rule is **furthest episode with history wins**, never most-recently-updated — otherwise re-watching an early episode of a finished show sends every later Play backwards.

### 9.2 A saved page had nothing behind it

A library row carries a title, poster and year copied when it was added, so the **list** always looked right. The **page** behind it was drawn entirely from what the provider answered at that moment — and when the provider was switched off, uninstalled, throttled or had changed shape, that was nothing. Reported as "the app lost my saved content". It was never lost; it was never written down.

`cs3/pageSnapshot.ts` writes it down, captured in **`ContentService.load`** — the one funnel catalogue, native-provider and extension pages all pass through, and the only side that knows a provider's ancestry (`provenanceOf`). A page is kept by being *looked at*; saving or adding to the library only **pins** it against eviction (`MAX_SNAPSHOTS` 600, unpinned LRU).

Stored: the display copy, the repository ▸ extension ▸ provider chain, the search query, and **every address known to reach the work**. Those addresses are half the fix — a merged row's `alternates` live only as long as the row is on screen, so a page saved in March had one address in June and it was the one that had stopped working. `DetailView` tries the row's alternates *and* the snapshot's routes. **No playable link is stored** (that is `SourceCache`/`PlayedSource`, which have deadlines; a page that opens and cannot play is worse than one that re-resolves).

**The one rule: a later load may add and may correct, but may never blank.** A provider answering with a title and no poster has said nothing about the poster; reading that silence as "there is no poster" is what made a complete page degrade every time it was opened. Implemented twice on purpose — `mergeSnapshot` (main) and `savedPage.ts`'s `mergeDetail` (display). **Episode listings are all-or-nothing, never field-merged** — splicing two partial scrapes invents a season no provider offers.

The page draws from the copy **before** the provider is asked, so a revisit is instant; the live answer folds over it. When every route fails the copy **stands**, with a banner naming the reason and the copy's **age** — "saved today" beside a failing provider and "saved 8 months ago" call for different responses.

Its own file, not the datastore (episode lists run to hundreds of rows, and the datastore round-trips through Android backups) — but **a backup section of its own**, since restoring a library without the pages behind it reproduces the whole bug on a new machine. Only pinned rows are exported; the rest is cache.

### 9.3 The library remembers which source actually played

`PlayedSource` (per title + season + episode — episode-level, else ep6 overwrites ep5) holds the full `StoredSource` plus an `origin` query. **The link is stored but never the identity** — `origin` re-resolves a fresh link for the same release. Recorded on playback (10s of real play, past every "started then stopped" failure), not on selection. `library:resolvePlayedSource` returns `reused`/`refreshed`/`unavailable` — marked, not deleted, and alternatives offered.

`cs3/playedSource.ts`: torrents match a real infohash; everything else matches the **durable triple** (provider, normalised release name, resolution) — never the synthetic per-URL `infoHash`. Strict, with containment allowed either direction for decoration drift like `[Dual Audio]`; **a wrong-release match is worse than no match**. **No recorded deadline is treated as expired** — guessing "expired" costs one provider call, guessing "still good" costs a full ffmpeg startup and player timeout before failing over anyway.

### 9.4 Downloads

- **A download is addressed by its source variant, not its title.** Duplicate detection once matched by title prefix, so one film at any resolution collapsed into one slot — and the target path was title-derived, so allowing two would corrupt one file via interleaved writes. `src/utils/downloadIdentity.ts`: torrents key on a real infohash; everything else on the durable description (media + season + episode + provider + release name + resolution + quality + language + audio), **never** on `infoHash` (synthesised per-URL, changes on re-resolve). The provider is stored, not the extractor host (`indexerName` changes between resolves). Recovery matches the variant key first, resolution-bound after — the old unconditional `directSources[0]` could silently rebind 2160p→480p and report success. The target path carries the variant, de-duped with a numbered suffix at enqueue. **The batch downloader must not stamp a run-specific batch id into the identity field** (it broke recovery and caused duplicate re-queues).
- **aria2 says `complete`, not `completed`.** A literal string-comparison typo meant `pollAria2Tasks` never matched, so finished transfers sat at 100% "Downloading" forever and the gid was never released. `removed`/`paused` were unhandled too.
- **Completion is verified, not reported.** `finalizeCompletion` on all 3 engines checks the file exists, no `.part` remains, and the size is within 1% (many sources send no `Content-Length`) — else `Failed` with a retryable reason.
- **Delete is two actions** (`remove(id, deleteFile)`); "remember my choice" defaults off — a preference learned from one click nobody consciously set.
- **A partial download must be *proved* to match before resuming.** The old check compared provider-declared size and restarted if >20% different — both wrong (the declared size is often absent, so the check never ran; and 20% is huge, so wrong-encode tail-appends silently corrupted files that "finished"). **One ranged 64KB request at the resume point** answers Range support (206), real length (`Content-Range`) and byte-identity in one shot. `download/resumePlan.ts` (pure) checks cheapest-first: identity → exact size → Range support → byte comparison. `no-range` is its own cause (the server always sends the whole file — nothing is wrong with either file). An unreadable comparison window **restarts**, never "assume match".
- **`res.resume()` discards data but does not stop the transfer** — this trap has appeared **three times**. `FastChunkDownloader.probeUrl`'s `bytes=0-0` request used it, harmless against Range-honouring hosts and catastrophic against one that ignores Range and returns the whole 6GB (measured: 5.6MB pulled in the 5s after "resolving", competing with the real download for the same throttled URL). Destroy both response **and** request once headers are read. Also: a chunk worker accepting `200` mid-transfer now **fails that chunk with a reason** instead of writing whole-file bytes at a chunk offset.
- **Pressing Download is a request, not a command** (`download:request`). Old behaviour: any existing entry → "Already downloading" regardless of state. Now: `Downloading/Retrying/RefreshingSource` → no-op and says so; `Queued` → says when; `Paused` → resumes; `Failed` → recovers (clears the retry budget, re-resolves, retries); `Completed` → checked against the filesystem and re-downloaded if gone; nothing → starts.
- The confirm gate lives in `App.handleEnqueueDownload`, the one funnel all four press sites reach, and works by resolving a promise the callers already awaited. Default `immediate` — the delete prompt asks because deletion is unrecoverable; a download is a cancellable transfer.

### 9.5 Backup

`electron/cs3/backupService.ts`. **Sections are a table**, not switch statements — a store added to export-but-not-restore silently drops rows. Deliberately excluded: `.cs3` archives and media (large, re-fetchable — the backup records *which*), tokens and device ids (filtered on export by `DatastoreManager.snapshot`), diagnostics and logs (they describe the wrong machine), caches (stale is worse than empty). **Restore merges, never replaces** (snapshots first, undoable); a throwing section is recorded while the rest still restore. Unrelated JSON is refused **by format marker**, else you get "restored 0 of 9 sections" instead of "not a CloudStream backup".

### 9.6 Source list provenance and export

`indexerName` on an extension link is the file **host** ("Voe"), not the provider — both lists also carry `repository ▸ extension ▸ provider`, batched via `api:getProviderProvenanceMap`. `src/utils/sourceExport.ts` defaults to CSV (sortable/filterable). **The exported address is always the provider's, never loopback** (`sourceAddress` — loopback dies when the app closes). RFC 4180 quoting matters: `Dune, Part Two` unquoted silently shifts every later column, attributing links to the wrong provider.

---

---

## 10. UI conventions

- **Settings is a level, not an Advanced tab.** Advanced-vs-simple isn't a *category* — it cuts across every subject, so an Advanced tab splits one topic across two places. Grouping stays by subject; a **level** filters within it (`SettingRow`/`SettingGroup` take `level`; an all-hidden group hides itself). **`advanced` means one specific thing: understanding the label requires knowing how the app is built** — not "rare", not "dangerous". `settingsLevel.test.mts` enforces it (refuses >50% advanced; catches redundant per-row+per-group marking; caught rows hidden for jargon labels **when renaming the label was the actual fix** — 6 renamed, e.g. "Detected native players" → "Players found on this computer"). **Simple is the default**, and **an unclassified row is basic** — backwards would silently lose every future setting from Simple mode. Stored in `localStorage`, not the datastore (a per-viewer UI preference, not app behaviour). `shouldShow` lives in a plain `.ts` because JSX can't load under Node's type-stripping.
- **Never name a `.tsx` and `.ts` alike but for casing.** `SettingsLevel.tsx` beside `settingsLevel.ts` are **one name on Windows' case-insensitive filesystem**, and module resolution tries `.ts` first — so the import silently resolved to the pure module. A missing named export is an ESM **link** error, not catchable by `ErrorBoundary`: it failed the whole `App.tsx` import graph and **blanked the entire window**. `tsc -b` and `vite build` both refuse it; the gap was shipping without running either. `componentReachability.test.mts` folds every module path to lowercase and checks uniqueness.
- **Reachability has four failure directions**, all invisible to `tsc` and to every passing test:

  | # | Shape | Real consequence | Guard |
  |---|---|---|---|
  | 1 | channel **invoked, never registered** | first-run installer always failed | `electron/ipcSurface.test.mts` |
  | 2 | channel **registered, never invoked** | runtime repair path unreachable | same |
  | 3 | component **built, never mounted** | `ExtensionUpdates` | `src/componentReachability.test.mts` |
  | 4 | module **built, tested, never constructed** | see below | `electron/moduleReachability.test.mts` |

  **The fourth is the most deceptive, because the test suite is what hides it.** A green suite over an unreachable module answers "is this correct?" when the question was "does this run?". The guard checks two shapes: no production importer at all, and — the subtler one — **every production import being `import type`**, which is erased at build time and therefore carries no behaviour. Orphans are allow-listed **with a reason**; an entry without one becomes precedent, and a second test fails on stale entries. Mutation-verified in both directions.
- **Escape is consumed in capture phase, only when it actually closed something.** `VideoPlayer` binds `keydown` on `window` as "leave playback"; 5 of 8 hand-rolled dismiss effects listened on `document` in **bubble** phase without stopping the event, so a menu's Escape also reached the player and called `onBack()` — closing a menu ended playback. `useDismissable` uses `pointerdown`, not `click` (click fires after release, so outside-click-close plus the trigger's own toggle would reopen it).
- **The app is dark-only and must say so.** `.btn-ghost` had no colour and nothing set `color-scheme`, so twenty ghost buttons fell through to Chromium's `buttontext` — near-black on `--bg-card` — along with every native `<select>` popup. `.btn` also had no `:disabled` rule while a dozen bespoke buttons each grew their own.
- Global `:focus-visible` floor (8 `outline:none` sites had no replacement); `prefers-reduced-motion` honoured everywhere; poster cards keyboard-reachable; window bounds persist and clamp to an existing display; one offline banner beats 30 separate provider errors.
- `src/components/Poster.tsx` has an `onError` for the actually-common case (expired/hotlink-blocked scraped posters) — otherwise Chromium's broken-image icon everywhere. Per-call-site `fallback` kept, not one glyph.
- `src/components/EmptyState.tsx` gives every empty route an *action* (search-empty offers "Search all sources", clearing the stored scope).
- `useFlash` replaced 20+ hand-rolled toast timers that **crossed** (a second flash's timer cleared by the first) and leaked past unmount. Durations stay per-call-site (1500–5000ms, deliberate).

---

---

## 11. Lifecycle, navigation, shipping behaviour

- **Closing a window is not quitting.** `window-all-closed` used to tear down every service unconditionally (macOS: a dock icon holding a dead sidecar; `activate` reopened onto the wreckage). All teardown lives in `before-quit`, which calls `preventDefault()` and races a 5s deadline — else the window closes but the process survives, locking the cache dir for next launch. The pending service is logged as `shutdown_timeout`.
- **Shutdown is explicit**: `downloadService.stop()`, `extensionUpdater.stop()`, `pluginManager.shutdown()` (kills the JVM), `torrentEngine.destroy()`, mpv. **Any new service owning a socket, handle, timer or child process must wire in here.**
- **A dropped file used to replace the whole app.** `setWindowOpenHandler` doesn't cover top-level navigation (Electron's default for a dropped file), and `setApplicationMenu(null)` meant no View→Reload existed to recover. `will-navigate`/`will-frame-navigate` refuse it; the renderer's `drop` handler routes the file through `media:prepare` instead — this was always possible via `/local/<token>`, the capability existed with no entry point.
- **F12 was bound twice** — `before-input-event`'s `preventDefault()` suppressed the page's own F12 handler, making `ProviderInspector` unreachable. DevTools is `Ctrl+Shift+I` only. Reload is gated on `app.isPackaged` (`Ctrl+R` in a packaged build destroys the renderer mid-playback).
- **A real menu is back** (it was `null`, which broke `Cmd+C` in the search box on macOS since Cut/Copy/Paste are menu *roles* there, and removed Quit/About/zoom-reset). Hidden behind Alt via `autoHideMenuBar`.
- **aria2 probes upward from 6800 by test-binding**, captures stderr, and confirms via a `getVersion` RPC before reporting success. It was pinned to 6800 (which collides most with aria2's own users), used `stdio:'ignore'` so the reason was discarded, and returned `true` from `spawn` returning — but a port conflict is not a spawn error, aria2 dies milliseconds later and `isRunning()` lied. `getLastError()` carries the reason.
- **External links open in the system browser**, never in-app (`setWindowOpenHandler`).
- **The font is vendored.** `@import url('https://fonts.googleapis.com/…')` in `src/index.css` meant a packaged desktop app phoned a third party on every start, invisibly, plus a hang or silent failure offline. Inter is in `src/assets/fonts/` (7 variable-font subsets, 213KB — non-latin subsets kept because provider titles aren't English).

---
