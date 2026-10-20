# Documentation audit — 2026-10-20

Status of every PRD against the code, and where the docs disagree with it.
This is a **first pass**: the 40+ undeclared PRDs and the `docs_cs3/` Android
set are not yet verified line by line. Each row says what was checked.

Legend: **Done** = built and verified in code · **Partial** = some parts built ·
**Pending** = nothing built · **Unverified** = not checked yet.

## 1. Status by PRD

| PRD | Title (short) | Declared status | Verified status | Evidence |
|---|---|---|---|---|
| 31 | Drop-in compatibility | Ratified | **Done** (architecture) | Sidecar, bridge, `cs3/sidecarSupervisor.ts` |
| 32 | Desktop feature additions | Active / Implemented | Unverified | — |
| 33 | Current architecture | Active / Verified | **Stale in part** — see §3 | `cs3ArchiveLoader.ts`, `jvmProviderBridge.ts` do not exist |
| 34 | Torrent search & streaming | Active / Implemented | **Done** | `torrent/*`, `indexers/*` |
| 35 | Translation spike | Complete | **Done** | `tools/dex-spike/` |
| 36 | Enabling provider execution | Work plan | **Done** (in practice) | Sidecar runs 392-plugin corpus per AGENTS §5 |
| 37 | Adaptive playback engine | Approved spec | Unverified | `media/*` exists |
| 40 | Universal media compatibility | state | Unverified | — |
| 40.1 | Reliability & observability | Approved, fully implemented | **Conflict** — see §3 | `sourceLease.ts`, `playbackTelemetry.ts` exist; AGENTS §6 says never wired |
| 41 | Desktop extension platform standard | Proposed | **Pending** | No `extension-standard` code found |
| 42 | Resume continuity | Partially implemented | **Partial** | `resumePoint.ts`, `playedSource.ts` built; `seriesContext.ts` **does not exist** |
| 43 | Source & provider expansion | Items 1–4 built | **Partial** | `nativeProviders/*` present |
| 44 | UX & DX research | Most §6–8 not built | **Partial** | Dev inspector, startup profile built |
| 45 | New source integration | §6–7 not built | **Partial** | Native providers (IA, PeerTube, IPTV, Stremio) built |
| 46 | Extended metadata | Active / Implemented | **Done** | `metadata/*`, `enrichmentService.ts` |
| 47 | Native providers & OTT catalog | Active / Implemented | **Done** | `ottService.ts`, `ottPlatforms.ts` |
| 48 | Download subsystem | Active / Implemented | **Done** | `downloadService.ts`, `resumePlan.ts` |
| 49 | Anti-bot & session interception | Active / Implemented | **Done** | `webViewHost.ts`, `clearance.ts` |
| 50 | Runtime provisioning | Active / Implemented | **Done** | `runtimeProvisioner.ts` |
| 51 | Push search & scope | Active / Implemented | **Done** | `searchSession.ts`, `searchScope.ts` |
| 52 (custom repositories) | Custom repositories | **Proposed — ready to implement** | **Done** — status is stale | `userAdded`, `installed_repositories_urls` |
| 52 (incognito) | Incognito mode | **Proposed** | **Done** — status is stale | `cs3/privacyMode.ts` |
| 53 | Platform catalogue discovery | Research only | **Partial** — status is stale | `ottService` discovers platforms and pins |
| 54 | Regional onboarding | Built | **Done** | `cs3/regions.ts`, tested |
| 55 | Trailers & provider verification | Proposed | **Partial** — status is stale | `videoTitles.ts`, `youtube.ts`, `TrailerPopup.tsx` |
| 2026-10 Source Profiles | Search source profiles | Proposed specification | **Done** (core) — status is stale | `cs3/sourceProfiles.ts`, `SourceProfileBar.tsx` |
| 2026-10 Viewer profiles | Viewer profiles (`extensions-profile-misc-updates`) | — | **Done** (core) | `electron/profiles/*`, PIN lock with scrypt |
| 2026-10 Subtitles | Subtitle requirements | "to be implemented" | **Partial** | `subtitles/*` (convert, library, match, companion) |
| 2026-10 Franchise navigation | Franchise / chronological | — | Unverified | `FranchiseRail.tsx` exists |
| 2026-10 Player buffer / VLC time | Buffer indicator, time toggle | — | Unverified | `bufferedRanges.ts` exists |
| 2026-10 NSFW privacy | Adult content privacy | — | **Done** (per AGENTS §5, §6) | `adultContent.ts`, `playbackPrivacy.ts` |
| 2026-10 Search priority | Source discovery priority | — | Unverified | — |
| 2026-10 Metadata search for people | Filmography | — | **Done** | `metadata/filmography.ts` |
| 2026-10 Large search results | Result optimisation | — | Unverified | — |
| 2026-10 Search sources panel UI/UX | Scope panel redesign | — | **Partial** | Guided view and profile bar shipped; see the open decisions below |
| 2026-10 providers support testing | Provider test harness | — | Unverified | `tools/e2e/*` exists |
| 2026-10 Errors to resolve | Error backlog | — | Unverified | — |
| 2026-10 App updates | Auto-update | — | **Done** (daily schedule) | `cs3/updateSchedule.ts` |
| 2026-10 PRD-CloudStream, session handoff, init | Meta / process docs | — | Not a feature PRD | — |

**Pending (nothing built):** 39, 41, 45 §6–7.

**Undeclared, reference-only (not feature plans):** 01–30 are the Android-era
specification set. Treat them as reference, not as status.

## 2. Open decisions the audit cannot settle

- **Done PRDs need a home.** Moving them breaks cross-links like the spike results (35, done)
  across the set. Recommend a link-rewrite pass, one folder at a time, before
  any file is moved.
- **Proposed PRDs that are already built** (52 ×2, 53, 55, Source Profiles) need
  their status line changed. That is a judgement on how far "built" goes.

## 3. Where the docs and the code disagree

1. **PRD 33** references `electron/cs3ArchiveLoader.ts` and `jvmProviderBridge.ts`.
   Neither exists; the role is `cs3/sidecarSupervisor.ts` plus the sidecar.
   *Architecture difference — flagged.*
2. **PRD 40.1** says "fully implemented". AGENTS §6 says `sourceLease.ts` and
   `playbackTelemetry.ts` are built, tested and **never wired**. These cannot both
   be right. *Flagged: needs an owner decision.*
3. **PRD 42** names `cs3/seriesContext.ts`, which does not exist. *Small — the
   file was renamed or never written.*
4. **Four PRDs carry stale status lines** (52 ×2, 53, 55). *Small, fix in place.*

## 4. Not done in this pass

- Verify the 40+ undeclared PRDs.
- Verify `docs/agents/*` and `docs/agents/field-notes/*` line by line against
  `AGENTS.md`.
- `docs/docs_cs3/` documents the **Android** app. It is the behaviour source of
  truth, not a description of this codebase, so it should be checked for
  staleness against upstream, not against `desktop/`.
- The `docs/2026-10-052-*` files at the docs root are outside `docs/PRD/` and are
  unclassified.

## 5. What this pass changed

- **Moved:** 19 done PRDs and 3 root notes to `docs/done/`; 10 partial or pending PRDs to `docs/roadmap/`; 14 unverified PRDs to `docs/roadmap/unverified/`. The reference set (00–30, 21, 22, 23, 24, init) stays in `docs/PRD/`.
- **Stamped:** every moved file opens with a status line (Done / Partial / Unverified) that points back here.
- **Links:** cross-references rewritten in `docs/`, `AGENTS.md`, `README.md`, the sidecar and tools READMEs, and the code comments that cited PRD 31 and 35.
- **Changed by hand:** `AGENTS.md` §13 (the doc table now gives the new paths and the 40.1 conflict), the repo map in §2, and short-form `docs/PRD/NN` references in `docs/agents/`.

## 6. Still broken (not fixed here)

- `docs/docs_cs3/android/08_*` and `09_*` link to upstream Android files (gradle, `.github/`, fastlane) that are not in this repo. They were already broken; they need the upstream repo or the links removed.
- Several `docs/roadmap/unverified/` files contain absolute `file:///` and `/cs3/...` links from before the move. They are not checked.
- Status lines on the four "built but marked proposed" PRDs (52 custom repositories, 52 incognito, 53, 55) are now stamped by filing, but their **original** headers still say "Proposed" inside the file body. Read the stamp first.

## 7. Second pass (same day)

- **Unverified → classified.** Done: 32, 36, 37, the NSFW-extensions note. Partial or pending: the Franchise note, the player buffer note, 38, the providers-testing plan (it names files that do not exist, so it is proposed work). The rest stay in `unverified/` because nothing checkable was found.
- **AGENTS.md counts corrected.** IPC: 361 `ipcMain.handle` calls and 361 invoke channels (was 341 and 349). Sidecar: 53 `@Test` methods (was 50).
- **Agent docs checked.** 427 code file names are cited in `AGENTS.md` and `docs/agents/`; 424 exist. The three that do not are intentional: `cs3ArchiveLoader.ts` and `jvmProviderBridge.ts` are named as gone, and `mpvSurface.ts` is named as not merged. A fourth citation, `SettingsLevel.tsx`, was a real error and is now `settingsLevel.ts`.
- **Links.** Broken relative links went from 68 to 12. The 12 are all upstream Android repo files (gradle, `.github/`, fastlane) that this repo does not contain. Absolute `/cs3/...` and `file:///D:/...` links were converted to repo-relative paths.

## 8. Still not verified

- The 40+ numbered PRDs without a declared status (01–30 and the reference set). They describe the Android app and the planned architecture, so they are checked for consistency, not feature by feature.
- `docs/docs_cs3/` against upstream Android. Not in this repo.
- The "Done" PRDs were checked by module presence and the AGENTS summary, not by reading each requirement against the code.
- The 12 Android-repo links above.
