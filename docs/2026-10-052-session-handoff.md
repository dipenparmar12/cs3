# Session handoff — 2026-10-06

Scope:
- `docs/2026-10-050-errors_need_to_resolve.md` (Errors audit, cross-sourcing root causes & fixes, A/V sync analysis)
- `docs/2026-10-051-App-updates-prd-info.md` (Media sources, discovery, navigation, search UX, provider verification)
- `docs/2026-10-052-subtitle-prd-requirement-tobe-implemeted.md` (Subtitle duration validation, companion downloads, customization styling fix, Android-parity search with country flags)
- `docs/2026-10-052-Fast Application Startup and Persistent Extension Data Cache.md` (Local-first startup, persistent extension/repository data cache, stale-while-revalidate)
- `docs/2026-10-052-hide only the NSFW-adult related extensions.md` (NSFW-adult repository & extension filtering rules)
- `docs/2026-10-052-Franchise and Chronological Movie Navigation.md` (Movie franchise collections, keyless Wikidata SPARQL/Cinemeta sourcing, chronological rail UX)
- `docs/2026-10-052-Player Buffer Ahead Indicator and VLC Time Toggle.md` (Real-time banked cache readout + VLC-style elapsed/remaining click toggle)


## Done (2026-10-06)

All typecheck with `tsc -b`; `bun run test --fast` 99/99 suites; oxlint 0 errors.
**None has been run in the Electron app** — every UI item below is `needs-app-run`.

| Item | Commit | Notes |
|---|---|---|
| Scroll-to-top (051 §18–22) | `b97283a` | `ScrollToTop.tsx` on `<main>`; hidden while the player is open |
| Elapsed/remaining toggle + buffer-ahead readout (051 §31–32) | `f3d5d27` | `player/timeDisplay.ts`; click the clock (full + mini); persisted in localStorage |
| Subtitle style reaches `::cue`; mpv style survives `loadfile` (050 P4 §3) | `512308c` | `--cue-*` mirrored on `:root`; re-applied when mpv leaves `loading` |
| Hide adult-only providers/extensions/repos when 18+ off (NSFW PRD) | `3a38cc2` | `getProviderTree`; mixed extensions stay; unloaded extensions kept |
| Subtitle duration validation (sub PRD §13–16) | `cea9602` | `utils/subtitleDuration.ts` (+test); auto-loader tries 3 candidates, skips mismatches |
| `net::ERR_*` classified (050 Cat.2 #1) | `9b1e983` | `failureTaxonomy.ts` (+test) |
| History never stores loopback URLs; replay sets `titleOverride` (050 P2 §5) | `77d2b0d` | `utils/durableAddress.ts` (+test) |
| Pasted `cloudstream://media/…` opens the page (051 §23–27) | `4a4f27a` | routed in `handleSearch` through `handleShareLink` |
| More like this: count, Show all grid, dedupe (051 §13–14) | `bae4da4` | provider list is unpaged — no infinite scroll is possible from that API |
| Franchise rail (Wikidata P179) | `0e5f317`, `79606aa` | **Live-verified**: Dune 3 films, Avengers 5 (Endgame present). `FranchiseRail.tsx`; parser test |
| Online subtitle language filter (sub PRD §30) | `b3ef94c` | `SubtitlePanel.tsx`; title/S/E editing already existed |
| Provider subtitles saved beside downloads as `Name.<lang>.srt` (sub PRD §17–19) | `7015e07` | `subtitles/companion.ts` (+test); provider-attached subs only |
| Self-widened search never auto-starts (050 P2 §4) | `f4f05b1` | overlay offers Play now / Choose source; AGENTS.md §7–8 rule added |
| Source picker keeps found sources across reopen; non-destructive refresh (051 §2–10) | `d961b54` | per-target retention in `DetailView` |
| Invert selection in search-sources dialog (051 §31–34) | `06fcf55` | disabled when it would empty the selection (empty = search everything) |

Already present, verified by reading, no change: `sameWork.ts` exact-title+year match (050 P2 §1);
repository listings persisted with stale-while-revalidate (`repositoryListings`, `extension:peekRepository`)
and provider hydration without the JVM (startup PRD core); search-history remove button (`16b0308`).

## Remaining

1. **Run the app** over every row above. Highest risk: picker retention merge, widened hold
   (does the overlay always show when `searchDone && widened`?), NSFW tree hiding.
2. **Companion subtitles from online search** — needs the file's duration (ffprobe on the
   finished file) so `subtitleFitsMedia` can gate it; then search by title+year in the
   viewer's languages.
3. **Subtitle confidence score** (sub PRD §15) — duration is one signal; title/year/S/E/filename not combined yet.
4. **Trailer player** (051 §35–42): seeking through the live fMP4 mux, mini-player.
5. **Provider verification** (051 §43–58): `webViewHost` solves challenges per resolve; no
   visible verification window, per-provider session state or resume-after-verify yet.
6. **Startup PRD** gap audit: which remaining paths still await the network before first paint.
7. **Buffer-ahead on seek-bar hover** (051 §31) — readout is beside the clock only.
8. Errors audit Cat.1 #4–6 (`Sequence is empty`, empty date, Gofile token) are extension-side;
   PKIX/SSL is JVM truststore (bundled `cacerts`) — count before acting.

## Media Playback & Audio/Video Sync Verification (050 Part 4 §1)

- Verified intact across mpv (`--video-sync=audio`), Chromium `<video>`, and FFmpeg
  (`-avoid_negative_ts make_zero -fflags +genpts+discardcorrupt`). No change required.
