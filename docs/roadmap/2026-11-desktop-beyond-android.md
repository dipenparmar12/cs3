# CS3 Desktop beyond Android: research and roadmap

> **Status (2026-11-02): Research, nothing built from it.** Written against the code on `feat/26-11-misc-updates`. It folds in an external research write-up (pasted 2026-11-02) and corrects it where the code already disagrees (§3). The first target was EXT.to ([2026-10 EXT Torrents Integration](./2026-10-EXT%20Torrents%20Integration%20as%20a%20Built-In%20CS3%20Source.md) §14). A live check on 2026-11-02 found a built-in scraper is not feasible today (a Turnstile checkbox Electron cannot pass), so it is dropped and kept on record.

## 1. Why, and the one rule

- **Why.** The desktop has what a phone lacks: a real browser engine beside the app, mpv and ffmpeg, a disk to cache on, aria2, a keyboard, and the user's attention at a desk. Most of that is already wired (§2). The remaining gains come from closing specific gaps, not from a new platform.
- **The rule.** Android-compatible extensions keep running exactly as they do (`.cs3` → sidecar → `cs3ext://`). Desktop capability is **added beside** them, in the lanes the app already has, and meets them only at the shared result and source models.
- **No new universal provider interface.** Four lanes already coexist and merge at `ContentService` / `SearchSession` and the source picker:

| Lane | Returns | Contract | Address |
|---|---|---|---|
| Android extension | pages, links | JSON-RPC to the sidecar (`cs3/sidecarSupervisor.ts`) | `cs3ext://` |
| Native provider | pages, links, catalogue rows | `NativeProvider` (`cs3/nativeProviders/types.ts`) | `cs3native://` |
| Torrent indexer | torrents for a title | `TorrentIndexer` → `RawTorrent` (`torrent/indexers/base.ts`) | infohash |
| Torznab / Stremio addon | torrents or streams | `torznab.ts`, `nativeProviders/stremioAddon.ts` | infohash or `cs3native://` |

- **Where a new site goes:** it returns torrents for a known title → `TorrentIndexer`. It returns pages or streams, or has a catalogue worth browsing → `NativeProvider`. Neither lane needs to know the other exists.

| Shared by both layers | Desktop only |
|---|---|
| Search, source picker, ranking, provider analytics, library, history, downloads, player, metadata, backup | Native providers, built-in indexers, Torznab, clearance service, mpv engine, ffmpeg conversion, aria2, sparse torrent cache, `.torrent` export |

## 2. What already exists

Built and in use (file named so a reader can check):

| Area | Built | Gap worth closing |
|---|---|---|
| Android compatibility | Sidecar, DEX→JVM translation, shim, two RPC lanes (`RpcLanes.java`) | OS-level sandbox: raw network egress and process creation are **not enforced** (`extensions.md` §5, `status.sandboxGaps`) |
| Native providers | Internet Archive, PeerTube, iptv-org, Stremio addons, Jellyfin/Emby (`cs3/nativeProviders/*`) | Nothing structural |
| Torrent indexers | 19 built-in adapters (4 Stremio, 12 JSON/RSS, 3 HTML: 1337x, BitSearch, TheRARBG) + Torznab (`indexerRegistry.ts`) | No HTML adapter for EXT.to |
| Bot walls | `botChallenge.ts` tells challenge / block / rate limit apart; `cs3/clearance.ts` keeps one clearance per host in the browser partition's jar, single-flight, 10 min cooldown; `http.ts` replays it with the UA that earned it | **The solver is a hidden window** (`webViewHost.ts`, `show: false`, 45 s). It passes automatic checks only. A checkbox check (Turnstile) fails. Measured 2026-11-02 on ext2.to: a person ticking it in a plain Electron window also failed, while the same person passes in Edge |
| DNS | `networkSettings.ts`: `automatic` DoH by default | None found. Measured 2026-11-02 on this machine: the ISP resolver answers `ext.to` with a block address (49.44.79.236); DoH answers 104.21.82.15 / 172.67.193.81 |
| Torrent streaming | Player-driven pieces (`piecePlan.ts`), sparse store (`sparseStore.ts`), `.torrent` export (`torrent:exportFile`), warm DHT (2753aa6: 210 MB → 11.7 MB on disk at playable) | Read-ahead cap; share sheet; packaged-build check |
| Source selection | Ranking (`providerRanking.ts`), ranked discovery walk (`discoveryWalk.ts`), hit verification (`providerHitMatch.ts`), per-card attempts | Labelled set drawn from real answers |
| Player | Element / hls.js / Shaka / ffmpeg conversion / mpv; speed; Up Next (`UpNextCard.tsx`); shortcuts panel; PiP and window pin; subtitles search, sync, styling; audio switching; telemetry (`playbackTelemetry.ts`) | No on-screen playback info panel; no frame step; no A-B loop |
| Downloads | aria2 + HTTP + yt-dlp; variant identity; resume proof (`resumeWindow.ts`); season batches (`batchDownloader.ts`); attempt tokens | No bandwidth limit, no schedule, no "keep next N episodes" |
| Extensions | Job queue, daily auto-update, new-extension install, rollback, regions, bulk selection, issue ledger | Sandbox (above) |
| Search | Push-shaped fan-out, saved searches, people and category chips | — |

## 3. Corrections to the external research

| It said | The code says |
|---|---|
| Build a unified scraper framework first (P0) | The shared parts exist: `fetchDocument`, `tryMirrors`, `loadCheerio`, `detectChallenge`, `finaliseResult`. EXT.to is the fourth HTML adapter. Extract more only when a second site needs the same new piece |
| Implement `.torrent` export and playhead-driven pieces | Built (2753aa6) |
| Add browser-assisted scraping | A browser host exists for challenges and link interception. Missing: a **visible** window for checks that need a person (§5.1). A "render, then read the DOM" mode is not needed by any known site yet |
| "Do not automate challenge solving" | Kept, with the existing behaviour stated: a hidden Chromium window loads the page, and Cloudflare's own script decides (as Android's `CloudflareKiller` does). Nothing clicks, solves a CAPTCHA, or forges a cookie, and nothing new will |
| Separate provider, indexer, file host, resolved source | Already separate: `providerAnalytics` (provider), `indexerBudget` (indexer), extractor name in the row, `SourceLease` (resolved link) |
| EXT.to returned 403 to automated access | `ext.to`: the ISP resolver blocks the name here. Mirror `ext2.to`: a Cloudflare Turnstile checkbox that Electron cannot pass even with a person ticking it (EXT PRD §14.0). A built-in scraper is not feasible today |
| A user-assisted verification flow makes protected sites usable | Only where Electron passes the check. Turnstile on ext2.to does not let it pass, and making Electron imitate Chrome to get through would be evading detection, which is out of scope |

## 4. Opportunities

Size: S ≤ 2 days · M ≤ 1 week · L > 1 week. "Compat" = effect on Android-compatible workflows.

### 4.1 Scraping and sources

| Feature | User problem | Approach | Compat | Cost / risk | Size | Phase |
|---|---|---|---|---|---|---|
| **Open magnets from the browser** | A site the app cannot reach is still usable in the viewer's browser | Already shipped in packaged builds: `electron-builder.yml` registers `magnet:`; `openableFromArgv` → `app:openLocalFile` → `handleOpenMagnet`. Add "Search on <site> ↗" (`shell:openExternal`) where the site is known. Check in a packaged install that a click in Edge opens the source flow | None | Nothing scraped; the site sees the viewer's own browser | S | idea |
| Person-in-the-loop verification (**spike first**) | A site behind a checkbox fails forever; the user sees "indexer failed" and cannot act | Failed its first test (ext2.to, 2026-11-02). Build only after one real site passes in a plain Electron window. When the hidden solve fails on `cloudflare-challenge`, the outcome says `needs-verification`; a press opens a visible window in the **same partition** as `webViewHost`; it closes when `cf_clearance` lands and the page is no longer a challenge; that source re-runs. Serves indexers and the JVM's `clearance.get` alike | Extensions gain it for free through `clearance.ts` | One window per press, never opened by a background search. Cookie stays in the partition (no new store) | M | 1 |
| EXT.to indexer (**blocked**) | One more large index, with IMDb-id search (advertised) | `torrent/indexers/extTo.ts` + pure `extToParser.ts`; EXT PRD §14.3 | None | Blocked by Turnstile (EXT PRD §14.0). Retest if the site drops the checkbox or publishes an API | M | — |
| **"Site changed" verdict** | A redesigned site reads as "nothing found" | A parser returns `{rows, markers}`; markers present and zero rows → `site-changed`, shown and counted apart from empty | None | Pure; per adapter | S | 2 |
| **Fixture tests for HTML adapters** | Breakage is found by viewers | Saved pages under `torrent/indexers/fixtures/<site>/`; parser tests read them; `tools/e2e` re-fetches live to refresh | None | Fixtures hold release names only | S | 2 |
| **EXT.to catalogue** | Browse latest / TV library | `NativeProvider` with `sections()`/`catalog()`, reusing the parser | None | Only if the user wants browsing; search does not need it | M | 4 |
| Rendered-page scraping | A site that builds results in script | `webViewHost` mode returning `document.documentElement.outerHTML` after a selector appears | None | Heavy (a window per call). Build only for a named site | M | later |

### 4.2 Torrents

| Feature | User problem | Approach | Compat | Cost / risk | Size | Phase |
|---|---|---|---|---|---|---|
| Read-ahead cap | A fast swarm can still fill disk far ahead of the playhead | Cap the forward window in `piecePlan.ts` by bytes and seconds of media | None | Pure, tested beside the plan | S | 1 |
| Swarm diagnostics in the player | "Buffering" with no reason | Show peers, download rate, next missing piece distance from `swarmHealth.ts` in the playback info panel (4.3) | None | Read-only | S | 1 |
| Season-pack episode pick | Pack streams the wrong file | `torrentContents.ts` already classifies; offer its episode list when `isSeasonPack` | None | — | S | 3 |
| Debrid (optional) | Slow swarms | A `NativeProvider` that turns a cached infohash into HTTPS with the viewer's key (key in main, as Jellyfin's) | None | Third-party service and account; legal exposure is the viewer's | M | 4 |

### 4.3 Player

| Feature | User problem | Approach | Compat | Cost / risk | Size | Phase |
|---|---|---|---|---|---|---|
| **Playback info panel** | "Why is it stuttering / which engine?" | Overlay (`i` key) from data already measured: engine and route (`capability`), codecs and resolution (inspection), buffer (`bufferedRanges.ts`), dropped frames (`getVideoPlaybackQuality`), mpv `estimated-vf-fps`, `demuxer-cache-duration`, `hwdec-current` | None | Read-only; mpv properties observed only while open | S | 1 |
| Frame step | Screenshots, subtitle timing | `.` / `,` when paused: mpv `frame-step` / `frame-back-step`; element `currentTime ± 1/fps` | None | Element step is approximate (no frame index) | S | 3 |
| A-B loop | Re-watching a scene, language practice | mpv `ab-loop-a/b`; element: `timeupdate` guard | None | — | S | 3 |
| Playback info in a report | Bug reports lack the route | "Copy playback info" from the panel, through `redact.ts` | None | — | S | 1 |

### 4.4 Downloads and episodes

| Feature | User problem | Approach | Compat | Cost / risk | Size | Phase |
|---|---|---|---|---|---|---|
| **Bandwidth limit** | Downloads starve playback and the household | Settings → Downloads → Limit (off / KB/s). aria2 `changeGlobalOption max-overall-download-limit`; HTTP downloader token bucket; WebTorrent client download limit (check the option against the version in `bun.lock`) | None | Playback streams exempt (they are not downloads) | S | 1 |
| Schedule | Download overnight only | "Only between HH:MM–HH:MM": queue pauses outside (`attemptTokens.ts` already makes pause safe) | None | Timer in main; wakes the queue | S | 3 |
| Keep next N episodes | Watching a series offline | Per library series: after an episode is watched, queue the next N through `batchDownloader.ts` with the played source's provider first (`pickSibling`) | None | Disk; off by default | M | 3 |
| Completed downloads view by series | Finding files | Group finished tasks by `canonicalKey` + season | None | — | S | 3 |

### 4.5 Extensions and repositories

| Feature | User problem | Approach | Compat | Cost / risk | Size | Phase |
|---|---|---|---|---|---|---|
| Lane badge in Installed and Built-in | "Is this an extension or built in?" when diagnosing | Badge from the address scheme; already split in `BuiltInSources.tsx` vs the tree | None | — | S | 4 |
| OS sandbox for the sidecar | A malicious extension can reach the network and spawn processes | Windows job object + restricted token around the JVM; network through a loopback proxy the app controls | **Risk**: extensions that spawn or connect directly break; measure on the corpus with `audit:providers` first | L | 4 |

### 4.6 Desktop integration and automation

| Feature | User problem | Approach | Cost / risk | Size | Phase |
|---|---|---|---|---|---|
| Notifications | A download finishes or fails unseen | Electron `Notification` on download complete / failed, setting-gated | — | S | 3 |
| Tray and background downloads | Closing the window kills downloads | Tray icon; close hides to tray while a download runs; `before-quit` stays the only teardown | Lifecycle change; test quit paths | M | 4 |
| New-episode watch | Missing a new episode | TVmaze airdates for library series; a "New" mark and an optional notification | Keyless; per profile | M | 4 |
| Command palette | Keyboard users | Ctrl+Shift+P over navigation and settings search (`settingsSearch.ts` already matches) | — | M | 4 |
| Local API / remote | Phone as remote | Loopback HTTP with a token, read-mostly | Attack surface; opt-in | L | 4 |

## 5. Phases

| Phase | Contents | Exit check |
|---|---|---|
| **1 — inside the current architecture** | Bandwidth limit · playback info panel (+ copy) · torrent read-ahead cap · swarm numbers in the panel | Each with tests |
| **2 — first native integration** | `site-changed` verdict and fixture tests for the existing HTML adapters (1337x, BitSearch, TheRARBG); verification spike on a second protected site; a built-in EXT.to indexer only if its check changes | Fixtures in CI; spike result written down |
| **3 — torrents, downloads, playback** | Schedule · keep next N · season-pack pick · frame step · A-B loop · notifications · downloads by series | Checked in the app |
| **4 — ecosystem** | Sidecar sandbox · tray · new-episode watch · command palette · EXT.to catalogue · debrid · local API | Each decided on its own |

### 5.1 Person-in-the-loop verification (spike before building)

- **Measured 2026-11-02:** on ext2.to (Turnstile checkbox), a person failed it in the agent's browser pane, which is automation-driven so the result is inconclusive. They failed again in a plain Electron 43 window (Chromium 150) with the app's reshaped UA (`browserUserAgent`) and no automation attached. They pass it in Edge. Spike script: one window and a cookie poll, about 80 lines.
- **Decision:** do not build this until a real protected site passes in a plain Electron window. Do not add browser-imitation tricks to make one pass.
- **When:** only after the hidden solve failed and `detectChallenge` says `cloudflare-challenge` (solvable). Never for `cloudflare-block`, `ddos-guard` or `rate-limited`.
- **Trigger:** a press only (source picker warning, Settings → Places searched row, or an extension issue row). A background search never opens a window.
- **Window:** `BrowserWindow` on `webViewHost`'s partition, `show: true`, the site's URL, the app's title bar text "Verify <host> — complete the check, this window closes by itself". Closes when `cf_clearance` is in the jar and the page is not a challenge; times out at 3 min with "Not verified".
- **After:** `ClearanceService` clears its failure cooldown for that host (a person just passed it), the waiting source re-runs once.
- **Never:** clicks, scripted input, cookie export, or reuse across a different UA.
- **Expiry:** unchanged: `ClearanceService` treats a near-expiry cookie as gone and `http.ts` drops a refused one (`stale`). A new challenge shows the same Verify action again.
- **IPC:** one channel `network:verifyHost(url)` → `{ok, error?}` (four places, §4.1 of AGENTS).

## 6. Security, legal, maintenance

- Respect `Retry-After`; never retry a `cloudflare-block`; one listing plus a bounded number of detail pages per search.
- Scraped HTML is data: parsed with cheerio in main, never rendered; URLs validated (`http(s)` and `magnet:` only); no redirect to loopback or private ranges.
- A `.torrent` is checked against the infohash before use (`torrentMetadata.ts`); file paths from metainfo are never trusted for disk layout.
- Indexes list content whose rights the app cannot judge. The app shows what a site lists and plays what the viewer picks; it makes no claim about rights.
- Each HTML adapter carries fixtures and a live e2e refresh; a `site-changed` verdict is the alarm.

## 7. What not to do

- Replace or route around the extension runtime; make native sites pretend to be extensions.
- A second torrent engine, playback engine, downloader or cookie store.
- Automatic clicks, CAPTCHA solving, cookie forging, or continuing after a block.
- A universal scraper abstraction before a second site needs the same new piece.
- Auto-disable a provider for a low score (`providerRecommendations.ts` never does).
- Download whole torrents to stream them.

## 8. UI changes, low fidelity

Only what changes. EXT.to's own screens are in the EXT PRD §14.6.

### 8.1 Source picker warning (Phase 1)

Current:

```
┌ Select a source ────────────────────────────────────────── × ┐
│ ⚠ 2 indexers failed — results may be incomplete.  details    │
│ ▸ 1080p  WEB   Dune.2021.1080p.WEB…        👥 812  💾 2.1 GB │
```

Idea, not scheduled: a quiet link at the end of the list, beside the existing "Find more sources":

```
│ ▸ 1080p  WEB   Dune.2021.1080p.WEB…        👥 812  💾 2.1 GB │
│ ─────────────────────────────────────────────────────────── │
│ Not here?  Search on EXT Torrents ↗                          │
│            ⓘ Opens in your browser. A magnet you click there │
│              opens in CloudStream.                            │
```

### 8.2 Verification window (only if the spike passes)

```
┌ Verify <host> ───────────────────────────────────────── _ □ × ┐
│ Complete the check below. This window closes by itself.       │
│ ┌───────────────────────────────────────────────────────────┐ │
│ │            (the site's own page and check)                │ │
│ └───────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────┘
```

### 8.3 Settings → Downloads (Phase 1)

Current: download folder, confirmation preference. Added:

```
Download speed limit     ( Off ▾ )   → Off · 1 MB/s · 5 MB/s · 10 MB/s · Custom…
                         ⓘ Playback is never limited.
```

### 8.4 Playback info panel (Phase 1)

New, toggled with `i`, top-left over the video:

```
┌ Playback info ─────────────────── Copy ┐
│ Engine     mpv (d3d11va)               │
│ Route      DIRECT · HLS                │
│ Video      HEVC 1920×1080 · 23.976 fps │
│ Audio      E-AC-3 5.1 · hin            │
│ Buffer     38 s ahead · 2 ranges       │
│ Dropped    0 / 14,220 frames           │
│ Torrent    41 peers · 6.2 MB/s         │
└────────────────────────────────────────┘
```
