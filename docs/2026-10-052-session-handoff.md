# Session handoff — 2026-10-06

Scope: `docs/2026-10-050-errors_need_to_resolve.md` (errors audit) and
`docs/2026-10-051-App-updates-prd-info.md` (app-updates PRD).

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
3. **Persistent source cache shown immediately + background refresh** (051 §2–12). Large;
   builds on existing `sourceCache.ts` + `sourcePrefetcher.ts` + `LibraryStore.mergeDiscoveredSources`
   rather than a new store. Non-destructive refresh rule (§10) matches the existing
   never-blank rule (`util/prune.ts`).
4. **More Like This: Show all + infinite scroll** (051 §13–17). Reuse `CategoryGrid.tsx`.
5. **Shareable link detection in search** (051 §23+). `searchSession` already turns pasted
   magnets/page URLs into rows — extend that, do not add a second router.
6. **Sidecar error classification** (050 Part 1): `Sequence is empty`, empty date parse,
   Gofile token, PKIX SSL — map into `failureTaxonomy.ts`; count first.

## Decision needed before touching

- **`autoWiden` / scope escalation** (050 Part 3 §2) contradicts AGENTS.md §7–8
  ("…and widens itself when that provider has nothing", 137 sources found for HDO's
  empty answer). Decide: keep auto-widen but never auto-play an escalated candidate
  (050 Part 2 §4), or make widening explicit. The first is the smaller, safer change.

## Uncommitted

- User's SSL log snippet in `docs/2026-10-050-errors_need_to_resolve.md` (Chromium
  `net_error -101` handshake lines under §7).
