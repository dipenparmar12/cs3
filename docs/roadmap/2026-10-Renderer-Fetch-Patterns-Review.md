> **Status 2026-10-21: Proposed. For review.** Nothing here is built. Every reference was read in the code on 2026-10-21; counts are `rg` counts on the same date. Companion to [2026-10-Renderer-Data-Layer-and-Request-Priority.md](./2026-10-Renderer-Data-Layer-and-Request-Priority.md), which holds the design and phases. Register entry: [`ROADMAP.md`](./ROADMAP.md).

# Renderer Fetch Patterns: Current State, Variations and Migration to TanStack Query

## 1. Purpose and review questions

This is the reference a reviewer needs before we decide how the renderer should fetch data. It records what we do today, every variation of it, and which parts a query library replaces, adapts or leaves alone.

Questions for the reviewers:

1. **Server state versus UI state.** Is the line in §6 drawn in the right place? Adult mode, privacy and profiles are main-process state mirrored in the renderer. Should any of them be queries?
2. **Cache ownership.** The app already has main-process caches and renderer module caches (§3.3). Which layer should own each one once TanStack is added?
3. **Cancellation across IPC.** `invoke` cannot carry an `AbortSignal`. Is a `requestId` plus a `request:cancel` channel the right shape, or is there a better one?
4. **Merge semantics.** Several screens merge results rather than replace them (§5, pattern J). Is per-item keying the right way to keep that under a library?
5. **Migration shape.** Is the adapter in §7 the right seam, or should screens call TanStack directly?

## 2. The numbers

| Measure | Count | Note |
|---|---|---|
| `window.cloudstream` calls in `desktop/src` | 567 in 82 files | Includes actions, settings writes and reads |
| `useEffect(` calls | 284 in 95 files | Not all fetch |
| Manual cancellation checks (`let cancelled`, `mounted`, `active`, `live`, etc.) | 86 in 36 files | The hand-rolled stale-response guard |
| `on*` subscription call sites | about 90 in 33 files | Push listeners |
| `.catch(() => null / undefined / false / [] / {})` | 26 in 12 files | Errors turned into a default value |
| Empty `catch` with a comment saying why | 5 in 4 files | Deliberate; see §4 |
| `AbortController` in renderer | 1 file | `ReviewsAndExplanations.tsx` |
| Module-level stores or caches (`new Map`, `new Set`, `let state`) | about 12 files | §3.3 |

Counts are rough by design: a grep does not tell a read from an action. Phase 0 of the design doc counts that properly.

## 3. The three layers today

### 3.1 Main process (`desktop/electron/main.ts`)

Two response contracts coexist.

- **Envelope.** Fallible handlers return `{ ok, error?, ...payload }` and never reject, through the `fail()` helper (`main.ts:2276`). Examples: `search:start` (`:2341`), `search:cancel` (`:2368`), `api:loadMedia` (`:3520`), `metadata:getExtended` (`:3557`), `interactions:summarise` (`:2287`).
- **Raw value.** Some handlers return the value itself. `library:getContinueWatching` returns an array with **no try/catch** (`:6385`). `userProfiles:get` returns the state object. A throw in either rejects the `invoke`.

Push events go out through `webContents.send`. Each one is named like a channel (`search:update`, `playback:update`, `detail:update`, `metadata:extendedUpdate`, `discover:invalidated`, `adult:changed`, `userProfiles:changed`).

### 3.2 Preload bridge (`desktop/electron/preload.ts`)

- Requests are `ipcRenderer.invoke(channel, ...args)`, one line per method, typed by `CloudStreamElectronAPI`.
- Subscriptions go through one helper, `subscribe(channel, callback)` (`:2116`). It returns a teardown that calls `removeListener`. The comment there records the bug this fixed: listeners piled up on every React remount.
- The renderer reaches the API as `window.cloudstream`, which is optional-chained at most call sites (`window.cloudstream?.x?.()`).

### 3.3 Renderer caches and stores

Five different mechanisms hold data in the renderer. None is shared.

| Mechanism | Where | Holds |
|---|---|---|
| Component `useState` plus effect | Most views | Server data for one screen |
| Module `Map` cache, keyed by the input | `useTitleEnrichment.ts:38`, `useCatalogListings.ts:15` | Enriched titles, repository listings |
| Module `Map` plus in-flight `Map` (de-duplication) | `useCatalogListings.ts:15–16`, `:48–51` | Same, plus shared pending reads |
| Module store plus `useSyncExternalStore` | `useAdultMode.ts:38`, `usePrivacy.ts:9`, `useUserProfiles.ts:33`, `useExtensionJobs.ts:24`, `useWindowFullScreen.ts:13` | App state mirrored from main |
| Session memory (survives unmount, not restart) | `useSessionState.ts:17`, `screenSearch.ts:94`, `DetailSection.tsx:33–34` | How the viewer is looking, not data |

Main-process caches sit behind all of these: `catalogueCache`, `sourceCache`, `pageSnapshot`, `providerAnalytics`, the metadata enrichment cache, and `titleInteractions`. A renderer copy and a main copy of the same fact can disagree. The push events exist to reduce that gap.

## 4. Error handling variants

| Variant | Example | Count or note |
|---|---|---|
| Check `response.ok`, set an error string | `HomeView.tsx:162–167` | Most common in views |
| `try`/`catch` with `describeError(err)` | `HomeView.tsx:168–169` | Used with `ok` checks |
| Fire-and-forget `.then` with no `.catch` | `HomeView.tsx:204–206` | Unhandled if main throws. Main has no try here (`main.ts:6385`) |
| `.catch(() => null)` | `DetailView.tsx:542–544` (the early metadata peek) | 26 occurrences |
| Empty `catch` with a reason | `useTitleEnrichment.ts:87–88` ("Enrichment is an improvement, never a requirement.") | 5 occurrences; deliberate |
| Treat a missing bridge as an error | `DetailView.tsx:526–529` | Used where `window.cloudstream` is absent |

The variation that matters most is the first column of this table: the same reply can be read three ways, and only the envelope variant forces a check.

## 5. Patterns, with examples and the migration verdict

Verdicts: **Replace** (becomes `useQuery` or `useQueries`), **Adapt** (the behaviour stays, its location changes), **Keep** (not server data, or push-shaped, so it is not a query), **Remove** (after its replacement lands).

### A. Load on mount, guard with a flag — Replace

`HomeView.tsx:155–177`: `loadSections` is a `useCallback` over `[includeAnime, hidden]`, called from an effect, with `setLoading` in `finally`. The stale-response guard is absent here, so a slow reply from an earlier `hidden` set can overwrite a newer one.

`DetailView.tsx:503`: the same shape at 500+ lines of effect body. It clears about a dozen states, reads a stored snapshot, tries routes in order, then retries. The guard is `cancelled`, checked after each `await`. The main process keeps running after the guard fires.

- Migration: `HomeView` is a clean `useQuery`. `DetailView` should be split into queries: snapshot, detail routes, extended metadata (already separate), sources.

### B. Fire-and-forget read — Replace

`HomeView.tsx:202–210`: continue-watching is read with `.then` and no `.catch`. It is deliberately not behind the discovery await, so the row appears at once. A rejection here is silent or an unhandled rejection.

- Migration: `useQuery` with `enabled` and an explicit error state. The row stays independent of discovery, because they are separate queries.

### C. Stored copy first, then live — Adapt

`DetailView.tsx:564–585`: `getPageSnapshot` draws the stored page and clears `isLoading`; the live route fetch then refines it. `withEarlyExtended` (`:542–552`) draws cached metadata in the same render, to avoid a second layout shift.

- Migration: `initialData` or `placeholderData` from the snapshot query. The "never blank" rule (AGENTS §9) is the reason this exists; it must survive the move.

### D. Ordered route fallback — Adapt

`DetailView.tsx:620–625`: `for` over the routes, `await loadMedia(route)`, `if (cancelled) return`. Alternates are tried in merge order (`:601–613`). The loop is business logic, not fetching.

- Migration: it moves into the `queryFn` unchanged. Each `loadMedia` should carry the query's `requestId` so cancelling the screen stops the current route.

### E. Module cache with in-flight de-duplication — Replace

`useCatalogListings.ts:15–16, 41–64`: `listings` and `inFlight` are module maps; a read is shared by key, and the key is remembered for the session. `useTitleEnrichment.ts:38, 47–97`: a session cache keyed by release name, with a `pending` ref and a `null` entry for titles nobody could place. Its comment records why: each provider's answer replaces the whole list, and unmatched rows were re-sent every time.

- Migration: the cache and the de-duplication are exactly what TanStack provides. The `null`-means-unplaceable entry becomes a stored value with a long `staleTime`. The display transform (`results.map`) stays as a pure function.

### F. Module store with `useSyncExternalStore` — Keep (UI and mirrored state)

`useAdultMode.ts:38–51, 105, 145–148`: the renderer's single copy of adult state, mirrored from main through `adult:changed`, with a capture-phase key listener. `usePrivacy.ts`, `useWindowFullScreen.ts`, `useSessionState.ts` follow the same shape.

- Verdict: keep. These are UI and session decisions, or main-process settings mirrored for synchronous reads (the adult gate must answer before paint, per `useAdultMode.ts:35`). A query would make them asynchronous.
- Open question for reviewers: `useExtensionJobs.ts:24–38` is the same mechanism for a snapshot that main pushes. Is that better as a query whose cache is written by the push (`setQueryData`), so the job queue and the rest of the app share one cache?

### G. Profile store with a shared loading promise — Keep, with one addition

`useUserProfiles.ts:33–35, 66–75`: a module store, one `loading` promise, and `adopt()` which on a profile change calls `clearSessionState()` and `forgetScreenQueries()` (`:47–49`).

- Verdict: keep the store. Add `queryClient.clear()` (or per-profile scoping) to the same reset point. The profile-isolation rule (AGENTS §12) is the reason; a cache that outlives a switch would show the previous viewer's data.

### H. Push subscription filtered by an id — Keep

`App.tsx:653` (playback), `:662` (search), `:1815`; `DetailView.tsx:862` (detail), `:1365` (playback), `:1035` (extended metadata). Each keeps the snapshot whose `id` or `url` matches the screen, and drops the rest. `App.tsx:659–661` says why: a cancelled provider can still answer after the viewer has moved on.

- Verdict: keep. These are streams, not requests. They may write into the cache with `setQueryData`, but never into both the cache and local state.

### I. Imperative start and cancel with an id — Keep, or wrap as a mutation

`App.tsx:1090` `startSearch` returns a snapshot; `:1110–1115` `cancelSearch(search.id)`. Playback at `:1374–1394` stops the previous session, then starts the next, in one function. Both are sequences of actions, not reads.

- Verdict: keep as imperative calls. If the team wants them in TanStack, `useMutation` fits the start-and-stop sequence, but nothing is gained for search or playback, which stream.

### J. Batched summary, string key, re-ask on a coalesced push — Adapt

`useTitleInteractions.ts:52–96`: rows become a sorted, joined string key (`:67`). An effect calls `summariseInteractions` for the whole set. The reply is merged into the map, not replaced (`:91`). `:99–112` re-asks after each `download:progress`, coalesced to 700 ms. The comments explain the infinite-loop risk the string key avoids.

- Migration: a `useQuery` keyed on the sorted URL list would replace the whole result when the list changes, which drops states for rows already resolved. Keep the merge by giving each row its own key (`['interaction', url]`) with a batched `queryFn`, or by using `setQueryData` to merge. This is the one pattern where a naive migration changes behaviour; treat it as a deliberate decision.
- The 700 ms coalescing becomes a debounced `invalidateQueries`.

### K. `AbortController` with a ref guard — Replace

`ReviewsAndExplanations.tsx:73–116`: a ref holds the current controller, a new request aborts the previous one, and results are ignored when `controller.signal.aborted`. It is the only use of `AbortController` in the renderer, so the rest of the app has no abort story.

- Migration: TanStack's `signal` replaces the ref. It only reaches main if the `requestId` channel exists (design doc §4).

### L. Deferred enrichment behind the list — Adapt

`useTitleEnrichment.ts` (see E) runs after the list renders and rewrites rows as answers land, capped at `ENRICH_LIMIT = 100` (`:41`). Metadata for the open page (`DetailView.tsx:933–1002`) is deliberately not on the playback path, with a comment saying why.

- Migration: `useQueries` for visible rows, or keep the transform and move only the cache. Keep the cap; it is a product decision, not a cache detail.

### M. Invalidation event triggers a reload — Replace

`HomeView.tsx:189–193`: `discover:invalidated` calls `loadSections()`. The comment records that the event existed and was not listened to for some time.

- Migration: a subscription that calls `queryClient.invalidateQueries({ queryKey: ['discover'] })`. The subscription stays; the reload logic moves.

### N. Command with a refresh afterwards — Keep as a mutation

`HomeView.tsx:212–214`: `refresh` calls `refreshDiscovery()`, then reloads. Actions (settings writes, extension installs, library edits) follow this shape across the app.

- Migration: `useMutation` with `onSuccess` invalidating the relevant keys, once the query layer exists. Not needed for the first phase.

## 6. Pattern inventory: what changes

| Pattern | Verdict | Where it lands |
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

Rough split: about half the patterns are replaced or adapted, and about half are kept. The split follows whether the data is server state (replace) or a stream, a UI decision or a mirrored setting (keep).

## 7. Transition: how it drops in

Two rules make this a drop-in replacement rather than a rewrite.

**Rule 1: one adapter at the seam.** Screens do not call TanStack directly during migration. They call a thin wrapper that keeps today's return shape, so a view changes by one line and its JSX does not change.

```ts
// Proposed, not compiled: desktop/src/utils/ipcQuery.ts
function unwrap<T>(reply: T | { ok: false; error?: string }): T {
  // Accepts both contracts (§3.1) while screens migrate.
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

**Rule 2: keys carry scope.** The key includes everything that changes the answer: profile, adult mode, region set, source scope. A convention, written down once:

```ts
['discover', { includeAnime, hidden }]
['detail', url]
['interaction', url]
```

**Migration order.** One screen at a time, in this order, each as its own change:

1. `HomeView` discovery and continue-watching (patterns A, B, M). Smallest, read-only.
2. `ReviewsAndExplanations` (K). Shows the cancellation story on a real screen.
3. `DetailView` split (A, C, D). The largest and most valuable; after the adapter has proved itself.
4. Library, History and OTT (A, E).
5. Search suggestions and results metadata (E, J), after the per-row key design is agreed.
6. Remaining views. Remove the replaced effects and the `.catch(() => null)` calls that only existed to hide a missing cache.

What never changes: push subscriptions (H), the store modules (F, G), and the imperative search and playback calls (I).

## 8. Risks and what a reviewer should check

| Risk | Check |
|---|---|
| Merge semantics lost (J) | Test that a reply for twelve rows does not clear states already resolved for others |
| Two caches disagree after migration | Each fact has one owner, written in the key convention |
| Cancellation looks done but main keeps working (D, K) | A counter in main, not a UI check |
| The "never blank" rule regresses (C) | Revisit a saved title with the network blocked; the page must still draw |
| Error text changes (§4) | Same user-visible message for the same failure, before and after |
| Profile data leaks across a switch (G) | Switch profiles with a query cached; the second profile must not see it |
| Retry storms against scrapers | `retry: 0` on search and playback; default only for cheap reads |

## 9. Not verified

- Nothing was run. Counts are grep counts; a read-versus-action split needs Phase 0 of the design doc.
- Behaviour under load, memory growth and the cost of the extra renderer cache were not measured.
- The `unverified/` roadmap notes were not checked against this review.
- Whether Electron's `net.fetch` honours a priority hint is unverified (canonical playback PRD §5.6).
