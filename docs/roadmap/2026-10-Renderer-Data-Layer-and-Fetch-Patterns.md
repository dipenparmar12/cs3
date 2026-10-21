> **Status 2026-10-21: Proposed, for review.** Nothing here is built. Code was read on 2026-10-21; counts are `rg` counts on the same date. Register entry: [`ROADMAP.md`](./ROADMAP.md).

# Renderer Data Layer and Fetch Patterns: Analysis, Review and Migration Plan

## 1. Summary

The renderer has no data-fetching library. It makes 567 `window.cloudstream` calls across 82 files, with about 284 `useEffect` calls across 95 files. Each screen hand-rolls loading, error and stale-response handling, and nothing cancels a request when the viewer leaves the screen.

The roadmap goal is that the screen the viewer is on is served first, and work for a screen they have left is deprioritised. That goal has two separate parts:

- **Renderer server state.** Caching, de-duplication, cancelling superseded reads, invalidation and loading and error state. TanStack Query v5 fits this well, through an adapter.
- **Main-process request priority.** Ordering provider, JVM, network and indexer work that is already in flight. TanStack Query cannot do this. It needs the `RequestScheduler` in Part A of the canonical [playback source resolution PRD](./2026-10-Playback-Source-Resolution-Priority-Match-Verification-and-Viewer-Feedback-2.md).

**Recommendation:** adopt TanStack Query selectively, in phases. Do not count on it for priority. Cancelling a renderer promise does not stop the work behind it in main, so request identity and cancellation across IPC come first, or alongside the scheduler.

Four decisions should not be conflated: renderer server state, HTTP transport, response validation and provider SDKs. §10 covers the last three.

## 2. Decisions needed

1. **Adopt TanStack Query v5** for renderer server state, or stay hand-rolled for now?
2. **Cancellation across IPC** (`requestId` plus `request:cancel`): before the scheduler, or with it?
3. **Scheduler order.** This document assumes the scheduler (playback PRD Part A) comes after the pilot and before the broad migration, because the priority metadata is only meaningful with it.
4. **Server state versus UI state.** Is the line in §5 (patterns F and G) drawn correctly? Should the extension job snapshot (pattern F) be a query, written by its push?
5. **Cache ownership.** The app has main-process caches and renderer caches holding the same facts. Which layer owns each once TanStack is added?
6. **Merge semantics** for batched reads (pattern J): per-item keys, or `setQueryData` merging?
7. **Adapter seam.** Should screens call the adapter (§7), or TanStack directly?

## 3. Current state

### 3.1 Evidence

| Measure | Finding | Where |
|---|---|---|
| Data-fetching library | None. Runtime dependencies are React, react-dom and media and torrent modules | `desktop/package.json` |
| Renderer IPC calls | 567 across 82 files. Includes actions, settings and reads | `desktop/src/**` |
| Effects | About 284 `useEffect` calls across 95 files | `desktop/src/**` |
| Manual stale-response guards | 86 across 36 files (`cancelled`, `mounted`, `active`, `live`) | `desktop/src/**` |
| Push subscriptions | About 90 `on*` call sites across 33 files | `desktop/src/**` |
| Errors turned into defaults | 26 `.catch(() => null/undefined/false/[]/{})` in 12 files | `desktop/src/**` |
| Empty `catch` with a reason | 5 in 4 files (deliberate) | `desktop/src/**` |
| Renderer `AbortController` | 1 file | `ReviewsAndExplanations.tsx` |
| Cancel on navigation | None. IPC `invoke` cannot carry an `AbortSignal` | `desktop/electron/preload.ts`; AGENTS §4.2 |
| Main-process scheduling | None. `StartupQueue` is serial; `ExtensionJobQueue` runs three at once; search caps eight in flight per fan-out, not globally | `util/startupQueue.ts:86`; `cs3/extensionJobs.ts:165`; playback PRD F8 |
| JVM queue | First-come-first-served, no priority on a call | playback PRD F7 |
| Network queue | `ResilientFetch` has no concurrency, per-host limit or priority | `electron/networkResilience.ts:253`; `main.ts:921` |
| Profile switch | `App` is keyed on the active profile and remounts whole | AGENTS §4.4; `ProfileRoot.tsx` |

Counts are rough. A grep does not tell a read from an action. Phase 0 counts that properly.

### 3.2 Three layers

**Main process** (`desktop/electron/main.ts`). Two response contracts coexist.

- **Envelope.** Fallible handlers return `{ ok, error?, ...payload }` and never reject, through `fail()` (`:2276`). Examples: `interactions:summarise` (`:2287`), `search:start` (`:2341`), `search:cancel` (`:2368`), `api:loadMedia` (`:3520`), `metadata:getExtended` (`:3557`).
- **Raw value.** Some handlers return the value itself. `library:getContinueWatching` returns an array with **no try/catch** (`:6385`). `userProfiles:get` returns the state object (`:6145`). A throw in either rejects the `invoke`.

Push events go out through `webContents.send`: `search:update`, `playback:update`, `detail:update`, `metadata:extendedUpdate`, `discover:invalidated`, `adult:changed`, `userProfiles:changed`, and others.

**Preload** (`desktop/electron/preload.ts`). Requests are `ipcRenderer.invoke`, one line per method, typed by `CloudStreamElectronAPI`. Subscriptions go through one helper, `subscribe(channel, callback)` (`:2116`), which returns a teardown. Its comment records the bug that the teardown fixed: listeners accumulated on every React remount.

**Renderer.** Five mechanisms hold data, and none is shared:

| Mechanism | Where | Holds |
|---|---|---|
| Component `useState` and an effect | Most views | Server data for one screen |
| Module `Map` keyed by input | `useTitleEnrichment.ts:38`, `useCatalogListings.ts:15` | Enriched titles, repository listings |
| Module `Map` plus in-flight `Map` | `useCatalogListings.ts:15–16, 48–51` | Same, with shared pending reads |
| Module store plus `useSyncExternalStore` | `useAdultMode.ts:38`, `usePrivacy.ts:9`, `useUserProfiles.ts:33`, `useExtensionJobs.ts:24`, `useWindowFullScreen.ts:13` | App state mirrored from main |
| Session memory (survives unmount, not restart) | `useSessionState.ts:17`, `screenSearch.ts:94`, `DetailSection.tsx:33–34` | How the viewer is looking |

Main-process caches sit behind these: `catalogueCache`, `sourceCache`, `pageSnapshot`, `providerAnalytics`, the metadata enrichment cache and `titleInteractions`. A renderer copy and a main copy of one fact can disagree. The push events narrow that gap.

### 3.3 Error handling variants

| Variant | Example | Note |
|---|---|---|
| Check `response.ok`, set an error string | `HomeView.tsx:162–167` | Most common in views |
| `try`/`catch` with `describeError(err)` | `HomeView.tsx:168–169` | Used with `ok` checks |
| Fire-and-forget `.then`, no `.catch` | `HomeView.tsx:204–206` | Unhandled if main throws; main has no try here |
| `.catch(() => null)` | `DetailView.tsx:542–544` | 26 occurrences |
| Empty `catch` with a reason | `useTitleEnrichment.ts:87–88` | Deliberate: "an improvement, never a requirement" |
| Missing bridge treated as an error | `DetailView.tsx:526–529` | Where `window.cloudstream` is absent |

The first column matters most: the same reply can be read three ways, and only the envelope variant forces a check.

## 4. Options considered

| Option | For | Against |
|---|---|---|
| **TanStack Query v5** | Keyed cache; de-duplication of identical in-flight calls; stale-while-revalidate; `enabled` to run only the foreground screen's reads; `cancelQueries` by key or predicate; `invalidateQueries` for push events; devtools | Adds a dependency and a concept to 95 files. Does not schedule main-process work |
| SWR | Smaller; de-duplication and revalidation | Weaker cancellation and invalidation |
| RTK Query | Mature cache and invalidation | Needs Redux, which the app does not use |
| Apollo or urql | Strong caching | Built around GraphQL; our surface is IPC |
| Stay hand-rolled | No dependency | 95 files keep reinventing cache, de-duplication and cancellation. The bug class is already on record: a push listener that nothing wired up left stale rows on screen |

Context7 documentation for `/tanstack/query` confirms:
- `queryFn` receives an `AbortSignal` that aborts when the query is cancelled.
- `cancelQueries` reverts query state; if the signal was consumed, the promise is cancelled too.
- By default, unmounting does not cancel a query.
- The documented API has no request priority and no concurrency limit.

Pin an exact v5 version at adoption, and check its age against the two-week rule.

## 5. Patterns, with examples and verdicts

Verdicts: **Replace** (becomes `useQuery` or `useQueries`), **Adapt** (the behaviour stays, its location changes), **Keep** (not server data, or push-shaped), **Remove** (after its replacement lands).

**A. Load on mount, guard with a flag: Replace.** `HomeView.tsx:155–177`: `loadSections` is a `useCallback` over `[includeAnime, hidden]`, called from an effect. It has no stale-response guard, so a slow reply from an earlier `hidden` set can overwrite a newer one. `DetailView.tsx:503`: the same shape at 500+ lines. It clears about a dozen states, reads a stored snapshot, tries routes in order and retries. The guard is `cancelled`, checked after each `await`, and main keeps running after it fires. Migration: `HomeView` is a clean `useQuery`. `DetailView` should split into queries: snapshot, detail routes, extended metadata (already separate), sources.

**B. Fire-and-forget read: Replace.** `HomeView.tsx:202–210`: continue-watching is read with `.then` and no `.catch`. It is deliberately not behind the discovery await, so the row appears at once. Migration: `useQuery` with `enabled` and an explicit error state, still independent of discovery.

**C. Stored copy first, then live: Adapt.** `DetailView.tsx:564–585`: `getPageSnapshot` draws the stored page and clears `isLoading`; the live fetch refines it. `withEarlyExtended` (`:542–552`) draws cached metadata in the same render to avoid a second layout shift. Migration: `initialData` or `placeholderData` from the snapshot query. The "never blank" rule (AGENTS §9) is why this exists, and it must survive the move.

**D. Ordered route fallback: Adapt.** `DetailView.tsx:601–625`: alternates are tried in merge order, `loadMedia` in a `for` loop, `if (cancelled) return` after each await. The loop is business logic, not fetching. Migration: it moves into `queryFn` unchanged. Each `loadMedia` carries the query's `requestId`, so cancelling the screen stops the current route.

**E. Module cache with in-flight de-duplication: Replace.** `useCatalogListings.ts:15–16, 41–64`: `listings` and `inFlight` are module maps, keyed by repository, remembered for the session. `useTitleEnrichment.ts:38, 47–97`: a session cache keyed by release name, with a `pending` ref and a `null` entry for titles nobody could place. Its comment records why: each provider's answer replaces the whole list, and unmatched rows were re-sent every time. Migration: the cache and de-duplication are what TanStack provides. The `null` entry becomes a stored value with a long `staleTime`. The display transform (`results.map`) stays a pure function.

**F. Module store with `useSyncExternalStore`: Keep.** `useAdultMode.ts:38–51, 105, 145–148`: the renderer's single copy of adult state, mirrored from main through `adult:changed`, with a capture-phase key listener. `usePrivacy.ts`, `useWindowFullScreen.ts` and `useSessionState.ts` follow the same shape. These are UI decisions or main settings mirrored for synchronous reads: the adult gate must answer before anything paints (`useAdultMode.ts:35–36`). A query would make them asynchronous. Open question: `useExtensionJobs.ts:24–38` uses the same mechanism for a snapshot main pushes. Is it better as a query whose cache is written by the push (`setQueryData`), so the job queue and the rest of the app share one cache?

**G. Profile store with a shared loading promise: Keep, plus one addition.** `useUserProfiles.ts:33–35, 66–75`: a module store, one `loading` promise, and `adopt()`, which on a profile change calls `clearSessionState()` and `forgetScreenQueries()` (`:47–49`). Add `queryClient.clear()`, or per-profile scoping, to the same reset point. AGENTS §12 is the reason: a cache that outlives a switch shows the previous viewer's data.

**H. Push subscription filtered by an id: Keep.** `App.tsx:653` (playback), `:662` (search), `:1815` (playback); `DetailView.tsx:862` (detail), `:1035` (extended metadata), `:1365` (playback). Each keeps the snapshot matching its screen and drops the rest. `App.tsx:659–661` explains why: a cancelled provider can still answer after the viewer has moved on. These are streams, not requests. They may write into the cache with `setQueryData`, but never into both the cache and local state.

**I. Imperative start and cancel with an id: Keep.** `App.tsx:1090` `startSearch` returns a snapshot; `:1110–1115` `cancelSearch(search.id)`. Playback (`:1374–1394`) stops the previous session, then starts the next, in one function. These are action sequences, not reads. `useMutation` would fit the start-and-stop sequence, but gains nothing for streams.

**J. Batched summary with string key and coalesced re-ask: Adapt.** `useTitleInteractions.ts:52–67`: rows become a sorted, joined string key, so a reorder of the same set is not a new question. `:74–96` asks `summariseInteractions` for the whole set, and merges the reply (`:91`) rather than replacing it. `:99–112` re-asks after each `download:progress`, coalesced to 700 ms. The comments explain the infinite-loop risk the string key avoids. Migration: a `useQuery` keyed on the whole list would replace the result when the list changes, dropping states already resolved for other rows. Keep the merge by giving each row its own key (`['interaction', url]`) with a batched `queryFn`, or by merging with `setQueryData`. This is the one pattern where a naive migration changes behaviour. The 700 ms coalescing becomes a debounced `invalidateQueries`.

**K. `AbortController` with a ref guard: Replace.** `ReviewsAndExplanations.tsx:73–116`: a ref holds the current controller, a new request aborts the previous one, and results are ignored when `signal.aborted`. It is the only renderer `AbortController`, so the rest of the app has no abort story. Migration: TanStack's `signal` replaces the ref, but it only reaches main once the `requestId` channel exists (§6.3).

**L. Deferred enrichment behind the list: Adapt.** `useTitleEnrichment.ts` (see E) runs after the list renders and rewrites rows as answers land, capped at `ENRICH_LIMIT = 100` (`:41`). Metadata for the open page (`DetailView.tsx:933–1002`) is deliberately off the playback path. Migration: `useQueries` for visible rows, or keep the transform and move only the cache. Keep the cap; it is a product decision.

**M. Invalidation event triggers a reload: Replace.** `HomeView.tsx:189–193`: `discover:invalidated` calls `loadSections()`. The comment records that the event existed and was not listened to for some time. Migration: the subscription calls `invalidateQueries({ queryKey: ['discover'] })`. The subscription stays; the reload logic moves.

**N. Command with a refresh afterwards: Keep as a mutation.** `HomeView.tsx:212–214`: `refresh` calls `refreshDiscovery()`, then reloads. Settings writes, extension installs and library edits follow the same shape. Migration: `useMutation` with `onSuccess` invalidating keys, once the query layer exists. Not needed in the first phase.

### 5.1 Inventory

| Pattern | Verdict | Lands in |
|---|---|---|
| A. Load on mount, flag guard | Replace | `useQuery` per view |
| B. Fire-and-forget read | Replace | `useQuery` with error state |
| C. Stored copy first | Adapt | `initialData` or `placeholderData` |
| D. Ordered route fallback | Adapt | Inside `queryFn`, with `requestId` |
| E. Module cache and de-duplication | Replace | QueryClient cache |
| F. Module store | Keep | UI and mirrored settings |
| G. Profile store | Keep, plus reset | `clear()` at the switch point |
| H. Push subscription | Keep | Optionally `setQueryData` |
| I. Imperative start and cancel | Keep | Or `useMutation` |
| J. Batched summary with merge | Adapt | Per-row keys, or `setQueryData` merge |
| K. `AbortController` with ref | Replace | `signal` plus `requestId` |
| L. Deferred enrichment | Adapt | `useQueries`, same cap |
| M. Invalidation reload | Replace | `invalidateQueries` |
| N. Command with refresh | Keep | `useMutation` later |

About half the patterns are replaced or adapted, and half are kept. The split follows whether the data is server state (replace), or a stream, a UI decision or a mirrored setting (keep).

## 6. Design

### 6.1 Query client and profiles

- One `QueryClient`, created at the profile boundary (`ProfileRoot`), or cleared on every switch. One viewer's cache must never serve another.
- Keys carry every input that changes the answer: profile, adult mode, region set, source scope. A change to any of them fetches rather than serves stale data.

### 6.2 Query function

- A wrapper turns `{ ok: false, error }` into a thrown error. Without it, a failed call reports success, which AGENTS §4.1 forbids.
- `retry: 0` for search and playback. A retry repeats a scrape that can take 20 seconds and multiplies load on the provider. Keep the default for cheap reads.
- `refetchOnWindowFocus: false`. A window focus event is not a change on the network.

### 6.3 Cancellation across IPC

A `signal` passed to a query aborts the renderer promise. It does not reach main, and `ipcRenderer.invoke` does not transfer an `AbortSignal`. The scrape or JVM call behind it keeps running.

Making "leaving a screen drops its requests" true needs three parts:

1. Each read carries a `requestId`, generated in the renderer.
2. A `request:cancel(requestId)` channel, which main maps to an `AbortController` held by the service doing the work. It follows the four-place rule in AGENTS §4.1 and must be added to the `ipcSurface` allow-list.
3. Cancellation wired through the existing fan-outs: search, source prefetch, playback widening and catalogue rows.

Without part 2, cancellation changes what the renderer waits for and nothing else. The UI would look responsive while the same work competes for the JVM and the network.

### 6.4 Priority and navigation

- Each query carries `meta.priority` (`P0` playback, `P1` navigation, `P2` speculative, `P3` maintenance, from canonical PRD §5.2) and `meta.screen`. The priority is sent to main as an argument.
- On every screen change, the previous screen's queries are cancelled with `cancelQueries({ predicate })`, and their `requestId`s are sent to `request:cancel`. The signal comes from the tab and screen stack.
- Revisits use `placeholderData`, so a cancelled or refetching query never blanks content. This respects the "never blank" rule and `useSessionState`.

### 6.5 Push events and ownership

- Existing push events map to `invalidateQueries` (for example `discover:invalidated` → `['discover']`), replacing hand-written reload logic.
- Push streams stay as subscriptions. A stream may write into the cache with `setQueryData`, but no value is held by both the cache and local state.
- `savedPage` snapshots remain the store across restarts. TanStack holds only the in-session cache.

### 6.6 Main-process scheduler

Specified in the canonical playback PRD Part A, not here. In short: a `RequestScheduler` with per-class queues, reserved P0 capacity, no preemption of running work, aging for P3, a global concurrency ceiling in place of the per-fan-out cap, and cancellation by context. The JVM frame gains a `priority` field, which bumps `RUNTIME_GENERATION` (AGENTS §3.5).

## 7. Adapter and key convention

Two rules make the migration a drop-in replacement rather than a rewrite.

**Rule 1: one adapter at the seam.** Screens call a thin wrapper that keeps today's return shape, so a view changes by about one line and its JSX does not change. The sketch below is proposed, not compiled.

```ts
// Proposed, not compiled: desktop/src/utils/ipcQuery.ts
function unwrap<T>(reply: T | { ok: false; error?: string }): T {
  // Accepts both contracts (§3.2) while screens migrate.
  if (reply && typeof reply === 'object' && 'ok' in reply && reply.ok === false) {
    throw new Error((reply as { error?: string }).error ?? 'Request failed');
  }
  return reply as T;
}

export function useIpcQuery<T>(key: QueryKey, call: () => Promise<unknown>, options?: Partial<UseQueryOptions<T>>) {
  const query = useQuery<T>({
    queryKey: key,
    queryFn: async () => unwrap<T>(await call()),
    ...options,
  });
  return { data: query.data, loading: query.isPending, error: query.error ? describeError(query.error) : null, reload: query.refetch };
}
```

**Rule 2: keys carry scope**, written down once:

```ts
['discover', { includeAnime, hidden }]
['detail', url]
['interaction', url]
```

## 8. Migration plan

Each phase has a stop condition. A phase that misses its measurement is reviewed before the next begins.

**Phase 0: measure (no behaviour change).**
- In-flight IPC calls per screen transition, on Home, Search and Detail.
- Time to content on those screens.
- Playback first-source time under background load: PRD check A2 (p95 no worse than 1.25× idle).
- Read calls against action calls across the 567 sites.
- Stop: baseline recorded in the audit, with its date.

**Phase 1: infrastructure.**
- Add the dependency, the provider, `useIpcQuery`, the envelope unwrap and profile clearing. Devtools in developer mode only.
- Pure `*.test.mts` for the key builder and the unwrap. Verify it fails with the bug restored (AGENTS §3.2).
- Stop: tests pass; no screen changed.

**Phase 2: pilot on `HomeView`, read-only.** Patterns A, B and M: rails, continue-watching, hidden-row handling, discovery invalidation.
- Stop: no regression in content on screen, and the Phase 0 counts improve or the team decides to continue.

**Phase 3: request identity, and the first cancel.** Add `requestId` and `request:cancel`, changing all four sides and the `ipcSurface` allow-list. Migrate `ReviewsAndExplanations` (pattern K) as the first screen that cancels end to end. Wire cancellation into search, prefetch and widening.
- Stop: a cancelled screen transition leaves no provider call running. Verify with a counter in main, not by reading code.

**Phase 4: main scheduler.** Implement PRD Part A: the scheduler, reserved P0 capacity, JVM priority and a `ResilientFetch` queue. Bump `RUNTIME_GENERATION`.
- Stop: PRD checks A1–A6 measured.

**Phase 5: remaining screens, in order.**
1. `DetailView` split: patterns A, C, D. The largest and most valuable, done after the adapter has proved itself.
2. Library, History and OTT: patterns A and E.
3. Search suggestions and results metadata: patterns E and J, after the per-row key design is agreed.
4. Remaining views.

Never changed: push subscriptions (H), store modules (F, G), and imperative search and playback calls (I).

**Phase 6: cleanup.** Delete replaced effects, and the `.catch(() => null)` calls that only existed to hide a missing cache. Record the new `useEffect` and `window.cloudstream` counts.

## 9. Risks and checks

| Risk | Check |
|---|---|
| Merge semantics lost (J) | A reply for twelve rows does not clear states already resolved for others |
| Two caches disagree after migration | Each fact has one owner, written in the key convention |
| Cancellation looks done but main keeps working (D, K) | A counter in main, not a UI check |
| "Never blank" regresses (C) | Revisit a saved title with the network blocked; the page still draws |
| Error text changes (§3.3) | Same user-visible message for the same failure, before and after |
| Profile data leaks across a switch (G) | Switch profiles with a query cached; the second profile must not see it |
| Retry storms against scrapers | `retry: 0` on search and playback; default only for cheap reads |
| Memory growth from large cached rows | Garbage collection tuned per key; measured in Phase 0 |
| Most of the 567 calls are actions | Phase 0 count settles the size of the migration |

## 10. External view: selective adoption of public packages

The review distinguishes renderer server state, HTTP transport, failure handling, response validation and provider integrations. They solve different problems and are evaluated separately.

| Area | Recommendation | Rationale |
|---|---|---|
| Renderer server state | **Adopt TanStack Query selectively**, through the adapter (§7) | Reduces duplicated fetching, manual stale-response guards and renderer cache management, without replacing IPC or application services |
| HTTP transport | **Add no new HTTP client** | Preserve the injected-fetch boundary (`setHttpFetch`, `electron/torrent/http.ts:133`) and Electron networking. Node's own `fetch` ignores DNS-over-HTTPS and the system proxy (AGENTS §12). The JVM side already uses OkHttp in the bridge (`CloudflareKiller.kt`, `WebViewResolver.kt`), so any shared policy must cover both runtimes |
| Failure handling | **Standardise classification, not retry behaviour** | Consistent timeout, cancellation and failure semantics across both runtimes, keeping provider deadlines, cooldowns and retry decisions. The bugs that cost us were semantic: a timeout confused with cancellation, GraphQL 200 with errors, a CDN 403 that is not definitive. No client fixes those |
| Response validation | **Pilot a schema validator on one JSON indexer adapter** | No validator dependency exists today. Validate untrusted responses at the boundary and reject, without guessing missing or unrecognised fields. Extension responses are parsed in Kotlin and are out of scope |
| Provider SDKs | **Evaluate individually** | Prefer keyless integrations: the metadata layer uses Wikidata, TVmaze, AniList and Cinemeta with no key. Do not add an API-key requirement or a large dependency for a small integration |

**Constraints for any candidate package.** It must preserve injected transport, cancellation semantics, error classification, cache ownership and provider policies. It must not add generic retries to search or playback, conceal malformed responses, or treat an HTTP status alone as proof that a source is playable or permanently unavailable. It must also pass checks for cold-start cost and lazy loading (webtorrent costs about 2.7 s cold), Electron packaging and externalisation, native-addon rebuilds, and GPL-3.0 compatibility.

**Verdict:** adopt TanStack Query for renderer server state, keep the transport and provider architecture, improve cross-runtime failure semantics, and pilot validation at an untrusted-data boundary. Measure each step before broad adoption.

## 11. Not verified

- Nothing was run. Counts are grep counts; the read-versus-action split needs Phase 0.
- Behaviour under load, memory growth and the cost of the extra renderer cache were not measured.
- Whether Electron's `net.fetch` honours a priority hint is unverified (canonical playback PRD §5.6). The design does not depend on it.
- The `useIpcQuery` adapter is proposed, not compiled. Cancellation does not reach main until §6.3 is implemented and tested. Nothing here implies that migration is complete.
- The `unverified/` roadmap notes were not checked against this document.
