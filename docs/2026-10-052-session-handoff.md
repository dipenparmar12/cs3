# Session handoff — 2026-10-06

Scope:
- `docs/2026-10-050-errors_need_to_resolve.md` (Errors audit, cross-sourcing root causes & fixes, A/V sync analysis)
- `docs/2026-10-051-App-updates-prd-info.md` (Media sources, discovery, navigation, search UX, provider verification)
- `docs/2026-10-052-subtitle-prd-requirement-tobe-implemeted.md` (A/V sync verification, subtitle validation, companion downloads, online search)
- `docs/2026-10-052-Fast Application Startup and Persistent Extension Data Cache.md` (Local-first startup, persistent extension/repository data cache, stale-while-revalidate)

## Done

| Item | Commit | Verified |
|---|---|---|
| Global scroll-to-top (051 §18–22) — `src/components/ScrollToTop.tsx`, mounted once on `<main className="view-viewport">` in `App.tsx`, styles at end of `index.css` | `b97283a` | `tsc -b` clean, oxlint clean, `test reachability` passes. **Not run in the app** — z-index 40 against modals unchecked |

Behaviour: appears after 0.75 × viewport height of scroll (`SCROLL_TO_TOP_THRESHOLD`),
smooth scroll unless reduced motion, hidden whenever the player is open (full or mini —
the mini window parks in the same corner).

## Not started — suggested order

1. **History stores page addresses, not ephemeral stream URLs** (050 Part 2 §5 / Part 3 §1).
   Highest value, contained to `App.tsx`/`VideoPlayer.tsx` history writes. Check against
   `cs3/extensionAddress.ts` (`looksLikeLinksHandle`) — same root cause as the 2026-08-27
   "saved title opens blank" fix.
2. **Detail page background search substitution** (050 Part 2 §1 / Part 3 §3) in `DetailView.tsx`.
3. **Subtitle styling customization fix** (050 Part 4 §3):
   - Chromium shadow DOM variable isolation: inject `subtitleCssVariables` onto `:root` (`document.documentElement.style`) so `video::cue` resolves `--cue-*` variables.
   - mpv startup race condition: invoke `mpvSetSubtitleStyle` in `NativeEngineStage` after `openInNativeEngine` resolves and on preference change.
4. **Subtitle duration cross-check validation & companion downloader** (050 Part 4 §2):
   - Implement `validateSubtitleDuration(vttOrSrt, mediaDurationSeconds)` comparing max cue end time against content duration. Invalidate when discrepancy > 20% or > 15m.
   - When download completes in `downloadService.ts`, fetch validated subtitle files and save alongside media (`.srt` / `.vtt`).
   - Suppress/invalidate mismatched subtitles in player and downloads.
5. **Android-parity online subtitle search** (050 Part 4 §4):
   - Add "Search Subtitles Online..." entry in player's Subtitles `HoverMenu`.
   - Provide online search modal with editable Title, Year, Season, Episode, and multi-language dropdown selector.
6. **Persistent source cache shown immediately + background refresh** (051 §2–12). Large;
   builds on existing `sourceCache.ts` + `sourcePrefetcher.ts` + `LibraryStore.mergeDiscoveredSources`
   rather than a new store. Non-destructive refresh rule (§10) matches the existing
   never-blank rule (`util/prune.ts`).
7. **More Like This: Show all + infinite scroll** (051 §13–17). Reuse `CategoryGrid.tsx`.
8. **Shareable link detection in search** (051 §23+). `searchSession` already turns pasted
   magnets/page URLs into rows — extend that, do not add a second router.
9. **Sidecar error classification** (050 Part 1): `Sequence is empty`, empty date parse,
   Gofile token, PKIX SSL — map into `failureTaxonomy.ts`; count first.
10. **Fast application startup & persistent extension data cache** (`052-Fast Application Startup...`):
    - Separate cold startup from network/remote repository sync: load persisted local extension/repository state immediately into UI.
    - Run background stale-while-revalidate synchronization so remote delays never block initial app usability.
11. **Media player buffer ahead & cache duration indicator** (051 §31):
    - Display adaptive buffer ahead readout (`+2m 30s buffered`, `+45s`, `+1h 15m`) on control bar and seekbar hover.
    - Synchronized across mpv (`demuxer-cache-time`) and HTML5 `<video>` (`buffered` ranges).
12. **Timeline time display toggle: elapsed vs. remaining time** (051 §32):
    - VLC/mpv-style click interaction on `.player__time` and `.player-mini__time` to toggle between Elapsed/Total (`12:45 / 1:45:00`) and Elapsed/Remaining (`12:45 / -1:32:15`).
    - Persist user preference across sessions and synchronize across player sizes.
13. **Chronological movie series, franchises, and cinematic universes** (051 §34–37):
    - Sourced keylessly via Wikidata SPARQL (`wdt:P179`, `pq:P1545`, `wdt:P155`, `wdt:P156`, `wdt:P577`) and Cinemeta without API keys.
    - Render dedicated chronological franchise rail in `DetailView.tsx` with prequel/current/sequel badging and one-click navigation.

## Media Playback & Audio/Video Sync Verification (050 Part 4 §1)

- **A/V Sync Status:** Verified intact across mpv (`--video-sync=audio`), Chromium `<video>` (hardware PTS sync), and FFmpeg (`-avoid_negative_ts make_zero -fflags +genpts+discardcorrupt` with matched dual-input `-ss` seek). No code modifications required.

## Decision needed before touching

- **`autoWiden` / scope escalation** (050 Part 3 §2) contradicts AGENTS.md §7–8
  ("…and widens itself when that provider has nothing", 137 sources found for HDO's
  empty answer). Decide: keep auto-widen but never auto-play an escalated candidate
  (050 Part 2 §4), or make widening explicit. The first is the smaller, safer change.

## Uncommitted

- User's SSL log snippet in `docs/2026-10-050-errors_need_to_resolve.md` (Chromium
  `net_error -101` handshake lines under §7).

