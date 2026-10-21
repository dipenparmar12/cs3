> **Status 2026-10-21: Proposed. Nothing in this document is built.** Code references were read on 2026-10-21 and are the evidence for the statements in §2. Register entry: [`ROADMAP.md`](./ROADMAP.md).

# Analysis: Renderer Data Layer and Request Priority

## 1. Summary

The renderer has no data-fetching library. Every screen loads its own data with hand-written effects, and nothing cancels a request when the viewer leaves the screen. The roadmap decision is that the screen the viewer is on is served first and that work for a screen they have left is deprioritised.

This analysis separates two problems that look like one:

- **Renderer data layer.** Caching, de-duplication, cancelling superseded reads, and loading and error state. TanStack Query (v5) fits this well.
- **Main-process request priority.** Ordering the provider, JVM, network and indexer work that is already in flight. TanStack Query cannot do this. It needs the `RequestScheduler` already specified in Part A of [the canonical Playback Source Resolution PRD](./2026-10-Playback-Source-Resolution-Priority-Match-Verification-and-Viewer-Feedback-2.md).

Recommendation: adopt TanStack Query for the renderer, phased as in §6. Do not treat it as the fix for priority. Cancelling a renderer promise does not stop the work behind it in the main process, so request identity and cancellation across IPC must be built first.

## 2. What the code does today

| # | Finding | Where |
|---|---|---|
| D1 | No data-fetching library. Runtime dependencies are React, react-dom, and media and torrent modules only | `desktop/package.json` |
| D2 | 567 `window.cloudstream` calls across 82 renderer files | `desktop/src/**` |
| D3 | About 284 `useEffect` calls across 95 files. Each screen keeps its own loading, error and `mounted` flags | e.g. `desktop/src/views/HomeView.tsx:175–205` |
| D4 | IPC `invoke` cannot carry an `AbortSignal`. The only cancellations are per channel (`search:cancel`, one `AbortController` for `api:suggest`) | `desktop/electron/preload.ts`; AGENTS §4.2 |
| D5 | No request scheduler in main. `StartupQueue` is serial; `ExtensionJobQueue` runs three at once; search caps eight in flight per fan-out, not globally | `desktop/electron/util/startupQueue.ts:86`; `desktop/electron/cs3/extensionJobs.ts:165`; roadmap F8 |
| D6 | The JVM worker pool is first-come-first-served, with no priority on a call | roadmap F7 (`sidecar/.../Main.java:33`) |
| D7 | `ResilientFetch` has no concurrency limit, per-host limit or priority | roadmap F9 (`electron/main.ts:921`) |
| D8 | Fallible IPC handlers return `{ ok, error? }` and never reject. A channel that is not registered does reject | AGENTS §4.1 |
| D9 | `App` is mounted keyed on the active viewer profile. A switch remounts the whole app | AGENTS §4.4 (`ProfileRoot.tsx`) |
| D10 | Push-shaped channels (`search:update`, `playback:update`, `discover:invalidated`, `adult:changed`, `userProfiles:changed`) are subscriptions, not requests | AGENTS §4.2 |

Consequence: when the viewer moves from one screen to another, the previous screen's calls keep running in main and keep occupying the same queues the new screen needs.

## 3. Options considered

| Option | For | Against |
|---|---|---|
| **TanStack Query v5** | Keyed cache; de-duplication of identical in-flight calls; stale-while-revalidate; `enabled` to run only the foreground screen's reads; `cancelQueries` by key or predicate; `invalidateQueries` for existing push events; devtools | Adds a dependency and a concept to 95 files. Does not schedule main-process work |
| SWR | Smaller; de-duplication and revalidation | Weaker cancellation and invalidation API |
| RTK Query | Mature cache and invalidation | Needs Redux, which the app does not use |
| Apollo or urql | Strong caching | Built around GraphQL; the app's surface is IPC |
| Stay hand-rolled | No dependency | The 95 files keep reinventing cache, de-duplication and cancellation. The same bug class is already on record: a push listener that nothing wired up left stale rows on screen |

TanStack Query is the best fit. The Context7 documentation for `/tanstack/query` confirms:
- `queryFn` receives an `AbortSignal` that aborts when the query is cancelled.
- `cancelQueries` reverts the query state; if the signal was consumed, the promise is cancelled too.
- By default, unmounting does not cancel a query.
- The documented API describes no request priority and no concurrency limit.

Pin an exact v5 version at adoption, and check its age against the two-week rule.

## 4. The cancellation gap

A `signal` passed to a TanStack query aborts the renderer-side promise. It does not reach the main process. `ipcRenderer.invoke` does not transfer an `AbortSignal`, so the scrape or JVM call behind it keeps running.

Making "leaving a screen drops its requests" true needs all three:

1. Each read carries a `requestId` generated in the renderer.
2. A `request:cancel(requestId)` channel, which main maps to an `AbortController` held by the service doing the work. It follows the four-place rule in AGENTS §4.1 and must be added to the `ipcSurface` allow-list.
3. Cancellation wired through the existing fan-outs: search, source prefetch, playback widening, and catalogue rows.

Without step 2, cancellation changes what the renderer waits for and nothing else. The UI would look responsive while the same work competes for the JVM and the network.

## 5. Design

### 5.1 Query client and profiles

- One `QueryClient`, created at the profile boundary (`ProfileRoot`), or cleared on every profile switch. One viewer's cache must never serve another.
- Keys carry every input that changes the answer: the adult mode, the region set, the source scope and the viewer profile. A change to any of them fetches rather than serves stale data.

### 5.2 Query function

- A wrapper turns `{ ok: false, error }` into a thrown error carrying `describeError` output. Without it the query reports success on a failed call, which AGENTS §4.1 forbids.
- `retry: 0` for search and playback. A retry repeats a scrape that can take 20 seconds and multiplies load on the provider. Keep the default for cheap metadata reads.
- `refetchOnWindowFocus: false`. A window focus event is not a change on the network.

### 5.3 Priority and navigation

- Each query carries `meta.priority` (`P0` playback, `P1` navigation, `P2` speculative, `P3` maintenance; the classes are defined in the canonical PRD §5.2) and `meta.screen`. The priority is passed to main as an argument.
- On every screen change, the previous screen's queries are cancelled with `cancelQueries({ predicate })` and their `requestId`s are sent to `request:cancel`.
- Revisits use `placeholderData` so a cancelled or refetching query never blanks content. This respects the "never blank" rule and the existing `useSessionState` and `savedPage` behaviour.

### 5.4 Push events and ownership

- Existing push events map to `invalidateQueries` (for example `discover:invalidated` → `['discover']`), which replaces the hand-written listeners.
- Push streams (`search:update`, `playback:update`) stay as subscriptions. A stream may write into the cache with `setQueryData`, but no value is held by both the cache and local state.
- `savedPage` snapshots remain the store across restarts. TanStack holds only the in-session cache.

### 5.5 Main-process scheduler

Built to the canonical PRD Part A, not here: `RequestScheduler` with per-class queues, reserved P0 capacity, no preemption, aging for P3, a global concurrency ceiling in place of the per-fan-out cap, and a `priority` field on the JVM frame (bumping `RUNTIME_GENERATION`, AGENTS §3.5).

## 6. Migration plan

Each phase has a stop condition. A phase that misses its measurement is reviewed before the next begins.

**Phase 0 — Measure (no behaviour change).**
- Count in-flight IPC calls per screen transition, on Home, Search and Detail.
- Time to content on those screens.
- Playback first-source time under background load: PRD check A2 (p95 no worse than 1.25× idle).
- Count read calls against action calls across the 567 call sites, to size the migration.
- Stop condition: baseline numbers recorded in the audit with their date.

**Phase 1 — Infrastructure.**
- Add the dependency, the provider, an `ipcQuery` helper, the envelope adapter and profile clearing. Devtools in developer mode only.
- Pure `*.test.mts` for the key builder and the envelope unwrap. Verify it fails with the bug restored, per AGENTS §3.2.
- Stop condition: tests pass; no screen changed yet.

**Phase 2 — Pilot one screen, read-only.**
- Migrate `HomeView`: the rails, continue-watching, and the hidden-row handling.
- Compare against the Phase 0 numbers.
- Stop condition: no regression in content on screen, and an improvement in the measured counts or an explicit decision to continue.

**Phase 3 — Request identity in main.**
- Add `requestId` and `request:cancel`, changing all four sides (service, `ipcMain.handle`, preload type, caller) and the `ipcSurface` allow-list.
- Wire cancellation into search, source prefetch and playback widening.
- Stop condition: a cancelled screen transition leaves no provider call running. Verify with a counter, not by reading code.

**Phase 4 — Main scheduler.**
- Implement roadmap PRD Part A: the scheduler, reserved P0 capacity, JVM priority, `ResilientFetch` queue. Bump `RUNTIME_GENERATION`.
- Stop condition: PRD checks A1–A6 measured.

**Phase 5 — Migrate the remaining reads, screen by screen.**
- Search suggestions and results metadata, Detail, Library, History, OTT, Settings reads.
- Mutations stay as actions that invalidate keys.
- Playback and search streams stay as push subscriptions.

**Phase 6 — Clean up.**
- Delete the replaced effects. Confirm the `useEffect` and `window.cloudstream` counts fall, and record the numbers.

## 7. Risks

| Risk | Mitigation |
|---|---|
| Two sources of truth: push and query both write one value | Rule in §5.4; one owner per value, checked in review |
| Retry storms against scrapers | `retry: 0` on search and playback (§5.2) |
| Memory growth from large cached rows | Tune garbage collection per key; measure in Phase 0 |
| Reverted cancellations blank the screen | `placeholderData` on revisits (§5.3) |
| Most of the 567 calls are actions, not reads, so the migration is smaller than it looks | Phase 0 count settles it |
| Cancellation looks finished in the UI while main keeps working | Phase 3 counter check, not a UI check |

## 8. Decisions needed

1. Adopt TanStack Query v5, or stay hand-rolled for now?
2. Is cross-IPC cancellation (Phase 3) in scope before the scheduler, or only with it?
3. Does the scheduler (canonical PRD Part A) come before or after the renderer migration? This analysis assumes after Phase 2 and before Phase 5, because Phase 5 needs the priority metadata to be meaningful.

## 9. Verification when this is closed

- [ ] Each phase's stop condition met, with its measurement recorded in the audit
- [ ] Any new IPC channel changes all four sides and the `ipcSurface` allow-list (AGENTS §4)
- [ ] A pure test for each new helper fails with its bug restored
- [ ] `docs/agents/*.md` and `AGENTS.md` updated in the same change
- [ ] This document moved to `docs/done/` and its line removed from `ROADMAP.md`

## 10. Not verified

- Nothing here was run or measured in Electron. Every figure is a count from reading the code.
- Whether Electron's `net.fetch` honours a `priority` hint is unverified (canonical PRD §5.6). The design does not depend on it.
- The `unverified/` notes were not checked against this analysis.
