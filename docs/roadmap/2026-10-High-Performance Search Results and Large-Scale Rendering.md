> **Status 2026-10-20: Partial / pending.** Nothing in §5 is built. §3 findings come from reading the code, not from profiling the running app. This is the single merged record of two PRDs that described the same work: **A** = this file's original (High-Performance Search Results and Large-Scale Rendering) and **B** = `2026-10-optimiseation-large-saerch-results.md` (Scalable Search Results Rendering and Performance Optimization), removed after merging. Every requirement, bullet, number and scenario from A and B is kept below; wording is compacted. Register: [`ROADMAP.md`](./ROADMAP.md).

---

## 0. Source map

| Section here | From A | From B |
|---|---|---|
| 1 Objective | §1 | §1 |
| 2 Non-negotiable requirements | §2 | §1 core principle, §2.5, §2.7, §2.8, §2.10 |
| 3 Architecture to audit | §3 | §3 (layers 1–7), §2.3, §2.4, §2.10 |
| 4 Required architecture | §4.1–4.8 | §2.1–2.10 |
| 5 Research (2026-10-20) | new | new |
| 6 Bottlenecks | new | new |
| 7 Recommendations | new | new |
| 8 User experience and states | §5 | §2.9, §2.2, §2.6 |
| 9 Measurement and acceptance | §6, §7 | §4 |
| 10 Plan | §8 | §5, §6 |
| 11 Definition of Done | §9 | §6 |

---

## 1. Objective

- Make CS3 Desktop responsive and reliable when searching across 500+ providers and displaying thousands or tens of thousands of results. (A)
- The current search can freeze or lag on a generic query with a large result set. Eliminate these bottlenecks without sacrificing coverage, results, provider functionality, filtering, sorting or navigation. (A)
- Support 500+ individual providers (B: roughly 500). Each provider can return one or more results per query. Generic searches produce 1,000–2,000 or more results, arriving at different times as providers finish. (B)
- Make search performance independent of total result count as far as practical: collecting, processing, sorting, deduplicating and displaying must keep the UI responsive. (B)
- **Core requirement: every valid result must remain accessible, but only results needed for the viewport are rendered in the DOM.** (A)
- **Core principle: do not sacrifice search coverage to solve a rendering problem.** Optimise how results are processed and presented, not what is returned. (B)
- This is an optimisation project, not a request to reduce the results returned or displayed. (A)

## 2. Scope and non-negotiable requirements

- Preserve all valid results returned by enabled providers. (A)
- Never silently truncate results to improve rendering. (A)
- Preserve source attribution, deduplication, grouping, filtering, sorting and existing card interactions. (A)
- Keep search progress, provider failure counts, cancellation, saved searches and source-scope behaviour working. (A)
- Allow scrolling through the complete result set, including the final item. (A)
- Keep the UI responsive while providers are still returning results. (A)
- Support incremental delivery without rebuilding the whole list after every update. (A)
- Preserve keyboard navigation, accessibility and the user's scroll position where appropriate. (A)
- Performance work must not introduce missing, duplicated or incorrectly grouped results. (A)
- **Do not discard valid results because a rendering batch reached its target size.** Any retention limit must be explicit, configurable where appropriate, and designed apart from rendering. (B)
- **Alternate sources are not lost.** Deduplication must not silently remove useful source choices (B §2.5). Preserve alternate providers and playable sources in grouping (B §2.5).
- **No stale results.** Results from an older search cannot overwrite or contaminate a newer one (B §2.4, §2.8, acceptance 6).
- **Every valid result from every successfully completed provider in the active scope is accounted for**, including duplicates handled by the established policy (A §6, §6 note).

## 3. Architecture to audit

### 3.1 Components named in the project documentation (A §3)

| Component | Optimisation focus |
|---|---|
| `src/views/SearchView.tsx` | Result rendering and page-level state updates |
| `src/utils/resultGroups.ts` | Grouping and result transformations |
| `PosterCard` | Per-result rendering and image loading |
| `SearchSessionManager` | Provider fan-out, incremental updates, session state |
| `search:*` IPC channels | Main-to-renderer updates and cancellation |
| `ContentService` | Search orchestration, source normalisation, caching |
| `SourceCache` and existing metadata caches | Reuse of existing cache mechanisms |

- Before changing the architecture, profile the running application and inspect the current implementations. (A)
- Determine which costs come from provider execution, data processing, IPC serialisation, React rendering, image loading or browser layout. (A)
- Do not assume virtualization alone solves every freeze. (A)

### 3.2 Layers to evaluate independently (B §3)

1. **Provider execution:** concurrent searches, cancellation, timeouts, error isolation.
2. **Result ingestion:** efficient acceptance and batching of incoming provider responses.
3. **Normalisation:** minimal, predictable transformations of provider data.
4. **Identity and deduplication:** efficient matching without losing alternate sources.
5. **State management:** stable references, incremental updates, limited rerender propagation.
6. **Presentation:** virtualised rendering and efficient card components.
7. **Lifecycle management:** cancellation, cleanup, stale-result rejection, memory release.

- Prefer incremental changes that reuse the existing architecture. (B)
- Do not replace the whole search system or add a state-management framework without evidence that the current design is the bottleneck. (B)
- Inspect search orchestration, the provider response pipeline, result stores, search screens and result-card components before choosing an implementation. (B)

## 4. Required architecture

### 4.1 Virtualised result list (A §4.1)

- Implement or improve a virtualised list or grid. Mount only: items in the viewport; a small overscan buffer above and below; any explicitly required accessible or focused item.
- The full result dataset stays available to the search model and to operations.
- Requirements:
  - Stable result keys and identities.
  - Variable-height content, or a measured predictable card layout.
  - Correct scroll offsets as results are added or updated.
  - No thousands of poster cards mounted at once.
  - Scrolling to the bottom never skips items.
  - Handle window resizing, zoom, responsive grid columns and display scaling.
  - Preserve focus and keyboard navigation when virtualised items mount and unmount.
  - Screen readers can navigate the result collection meaningfully.
  - Keep existing interactions: opening details, source attribution, menus, card actions.
- **Virtualisation limits DOM work. It must not limit the number of searchable or accessible results.** (A)
- Reuse existing virtualisation libraries or components where appropriate; keep scrolling smooth when results are continuously appended; preserve stable item identity and React component state during updates; keep the current layout and visual design unless performance requires a change. (B §2.1)
- Avoid rendering hidden or off-screen result content unnecessarily; keep selection interactions working. (B §2.1)
- Virtualisation is the primary defence against excessive DOM size. (B §2.1)

### 4.2 Incremental result ingestion (A §4.2, B §2.2)

- Render initial usable results as soon as possible.
- Accept additional results in bounded batches.
- Avoid a full React render for every individual result.
- Coalesce high-frequency updates into controlled batches. Use controlled intervals or frame-aligned batching. (B)
- Keep progress indicators accurate while results arrive.
- Prevent stale search sessions from updating the current screen.
- Support immediate cancellation without losing control of the UI.
- Retain all valid results from the active session.
- Batching must not add unbounded delay. The user sees new results promptly while the application stays responsive.
- Avoid repeatedly sorting or rebuilding the complete list after every provider response. (B)
- A slow provider must not stop faster providers' results from appearing. (B §2.2)
- Keep a clear indication of ongoing search activity. (B §2.2)
- Keep the interface responsive while hundreds of providers are still processing. (B §2.2)

### 4.3 Separate data processing from rendering (A §4.3, B §2.3)

- Audit deduplication, normalisation, sorting, grouping, filtering and result counts.
- Avoid repeating full-array transformations after every provider update. Recalculate only affected groups or derived data where possible.
- Use incremental indexes or maps where appropriate.
- Memoise expensive computations using stable inputs.
- Avoid creating new object references for unchanged results.
- Do not sort the whole collection repeatedly when the ordering does not require it.
- Keep UI state separate from large, frequently changing provider payloads.
- Use stable result IDs or deterministic identity keys wherever possible. (B)
- Use a single authoritative result identity and deduplication strategy. (A)
- Avoid unnecessary object creation, repeated transformations and full-array copying. (B)
- Cache derived data only where it provides measurable benefit and has a clear invalidation strategy. (B)
- Avoid expensive computation inside individual card render functions. (B)
- Move demonstrably expensive CPU-bound work to a Web Worker or the main process when that improves responsiveness. Measure first: serialisation and IPC cost can exceed the benefit. (A)
- Candidate operations for isolation (B §2.4): large-scale deduplication and grouping; complex sorting and ranking; heavy normalisation or metadata transformation; fuzzy matching and relevance calculation; large filter operations.
- Isolation requirements (B §2.4): keep DOM updates and interactions on the renderer thread; use incremental processing for work that need not finish in one step; avoid excessive serialisation and copying between threads; support cancellation or stale-task invalidation on a new search; do not move everything to a worker by default. Measure and choose the simplest effective architecture. (B)
- Separate search orchestration, result storage, filtering, sorting and presentation into distinct responsibilities. (B §2.3)
- Avoid unnecessary object creation; prevent unrelated components re-rendering when results arrive. (B §2.3)

### 4.4 Poster cards and images (A §4.4)

- Lazy-load images close to the viewport.
- Cancel or deprioritise image work for items far outside the viewport.
- Reserve poster dimensions to prevent layout shifts.
- Use thumbnail sizes, not full-resolution artwork, on every card.
- Do not decode or retain unnecessary image variants.
- Reuse existing image and metadata caches where appropriate.
- Missing images and failed requests must not trigger expensive retries repeatedly.
- Avoid hover effects or observers that add work to every result.
- Artwork privacy and NSFW visibility rules remain enforced.

### 4.5 Stable state and efficient React rendering (A §4.5)

- Keep the search header, progress indicator, filters and result grid from re-rendering unnecessarily.
- Memoise result cards where inputs are stable and profiling shows a benefit.
- Do not pass freshly created callbacks, arrays and objects to every card on each update.
- Keep scroll events lightweight.
- Avoid synchronous layout reads and writes inside repeated loops.
- Avoid large DOM mutations within a single frame.
- Profile with the React Profiler before adding memoisation everywhere.
- Avoid unnecessary remounting when filters and sorting change. (B §2.6)

### 4.6 Provider fan-out and backpressure (A §4.6, B §2.7)

- Keep the ability to search every enabled provider in the active scope.
- Bounded concurrency where provider execution could overload shared resources (CPU, memory, extension runtime, IPC bridge, renderer).
- Stream results from completed providers without waiting for the slowest.
- A slow provider must not block delivery from fast ones.
- Coalesce update notifications without dropping underlying results.
- Do not serialise the whole accumulated collection for every incremental update.
- Apply backpressure where result production could overwhelm state processing or rendering.
- Keep cancellation responsive across the provider, session and renderer layers.
- Keep reporting provider failures and partial results accurately.
- Concurrency limits must not silently exclude providers or stop the search completing.
- Introduce a controlled ingestion and batching mechanism. Prevent unbounded queues of pending renderer updates.
- Keep ingestion separate from rendering, so rendering delay does not block provider orchestration.
- Monitor memory and prevent duplicate copies of large collections from accumulating.
- Handle malformed, duplicate or unusually large provider responses safely.
- One provider returning an excessive number of results must not starve the others.

### 4.7 Filtering, sorting and grouping (A §4.7, B §2.6)

- All existing result operations remain available.
- Filtering operates over the complete result dataset, not only mounted nodes. Sorting applies to the full applicable collection. Counts reflect the full relevant dataset.
- Grouping preserves all valid results. New results enter the correct groups and positions. Stable ordering as additional providers finish.
- Source filters, content-type filters, dead-result visibility and saved-search behaviour remain correct.
- Changing filters must not discard results from the active session.
- Virtualisation is independent of the underlying data model.
- Apply filters efficiently. Avoid recomputing every derived set on each keystroke where an incremental or debounced approach suffices. Debounce must not delay cancellation or explicit user actions.
- Keep sorting predictable. Avoid repeated full-list sorting as results arrive.
- Filters and sorts must not cause unnecessary remounting of cards.

### 4.8 Deduplication and grouping rules (B §2.5)

- Multiple providers may return the same title, season, episode or other media item.
- Use efficient identity lookups (`Map`, `Set`) where appropriate.
- Define explicit matching rules for deciding that two results are the same media item.
- Do not merge distinct releases or provider-specific entries solely because displayed titles match.
- Preserve alternate providers and playable sources when grouping.
- Let users inspect or select alternate sources where the product already supports it.
- Keep grouping incremental where practical.
- Deduplication must improve usability without silently removing useful source choices.

### 4.9 Lifecycle and memory (A §4.8, B §2.8, §2.10)

- Avoid retaining unnecessary copies of large result arrays and provider payloads.
- Release stale session data when it is no longer needed and not required by saved searches or other features.
- Clean up subscriptions, observers, timers, image requests and event listeners.
- Repeated search-to-details navigation must not accumulate hidden components or listeners.
- Measure heap growth during long searches and repeated sessions.
- Cancellation and error paths clean up reliably.
- Do not remove results merely to reduce memory. If a future storage strategy is needed, it must keep the complete result set reachable.
- Cancellation stops unnecessary work throughout the pipeline: cancel provider operations where supported, stop queued processing, prevent cancelled results from updating the interface, release timers, subscriptions, worker tasks and temporary data.
- Use a search-session identifier (or equivalent) to isolate concurrent and successive lifecycles.
- Repeated searches must not accumulate stale state or memory. The user can start another search immediately after cancelling.
- Measure the memory of stored results, provider metadata, derived collections and rendered components.
- Avoid retaining intermediate arrays and duplicated metadata.
- Preserve current results only as long as navigation and search history require. If users must revisit earlier searches, use an explicit retention strategy.
- Repeated generic searches must not cause progressive memory growth.
- Do not add arbitrary result-count limits before measuring memory cost and deciding whether retention is needed.

## 5. Research: what the code does today (2026-10-20)

Read-only. No source was changed. File references are to the current tree.

### 5.1 Main process

| # | Finding | Where | Why it matters |
|---|---|---|---|
| R-M1 | Every provider completion calls `emit()`, which rebuilds the whole snapshot. Calls at lines 168, 244, 263 and 485 | `electron/searchSession.ts:526–530` | No coalescing. 500 providers can emit 500 full snapshots |
| R-M2 | Each emit re-merges **all** collected rows (`mergeSearchResults(this.collected)`), then sends the whole array | `searchSession.ts:496–516`, `electron/searchMerge.ts:145` | Work per emit grows with the result count, so total work is roughly quadratic in providers × rows. The merge is order-sensitive ("first writer wins"), which is why it is re-run rather than appended. Keep that reason (R5) |
| R-M3 | Each emit also calls `onResults` → `contentService.rememberRoutes` on the full array | `searchSession.ts:527–528`, `electron/contentService.ts:437` | A second full-array pass per arrival on the main thread |
| R-M4 | The full snapshot is pushed over IPC on every emit (`notify`) | `searchSession.ts:529` | Payload is the whole accumulated set each time; bytes sent grow roughly quadratically |
| R-M5 | Fan-out is capped at 8 in flight (`searchEach`); one `AbortController` per session | `AGENTS.md` §4; `searchSession.ts:128` | Already bounded: cancellation and concurrency are controlled |

**Scratch benchmark** (`mergebench.mts` in the session scratch folder, outside the repo; run under Bun, not Electron). 200 provider arrivals, 25 rows each, 5,000 rows at the end. Synthetic data; the merged count matched the row count, so it does not exercise deduplication.

| Arrivals | Rows | Merge of this arrival | Cumulative merge time |
|---|---|---|---|
| 10 | 250 | 5.1 ms | 34 ms |
| 50 | 1,250 | 4.7 ms | 286 ms |
| 100 | 2,500 | 13.0 ms | 617 ms |
| 200 | 5,000 | 18.0 ms | 3,023 ms |

The per-arrival merge is small. The cumulative cost, about 3 s of main-thread work over one search, is the figure to watch. The Electron measurement, including IPC serialisation, is still needed.

### 5.2 Renderer

| # | Finding | Where | Why it matters |
|---|---|---|---|
| R-R1 | **No virtualisation.** Every visible result is mapped to a `PosterCard`; nothing slices the list | `src/views/SearchView.tsx:787` | DOM and component count grow with results. The PRD target is under 100 mounted cards. Main cost to confirm |
| R-R2 | Card key is `` `${item.url}-${index}` `` | `SearchView.tsx:~790` | An index key makes React reuse or remount the wrong card on insertion or re-sort, and blocks memoisation |
| R-R3 | `PosterCard` is not memoised; `interactionFor(item)` builds new props on every render | `src/components/PosterCard.tsx` (no `React.memo`) | Every snapshot (each provider arrival) re-renders every card |
| R-R4 | Filter, group and tabs recompute on each snapshot: `results` (364), `filtered` (397), `groups` (412) | `SearchView.tsx:364–412` | Memoised, but their inputs change on every arrival, so all three run over the full list each time |
| R-R5 | Each arrival is a full state replace in two subscribers | `src/App.tsx:662–664` (`setSearch`); `src/components/Navbar.tsx:297` | Two components re-render from the full snapshot. Check whether Navbar needs results, or only progress numbers |
| R-R6 | Images lazy by default (`loading = 'lazy'`), with `onError` per card | `src/components/Poster.tsx:47, 143` | Good. But with every card mounted, far-off cards still start requests once they enter layout, and failed images re-render their card |

### 5.3 Already right

- Cancellation: one `AbortController` per session (`searchSession.ts:128`). Stale results are rejected by id (`App.tsx:663`, `current.id === snapshot.id`).
- Concurrency bounded at 8, so one slow provider does not block the rest.
- Dead-row partition is a single pass (`partitionDeadRows`, `SearchView.tsx:775`).
- Images are lazy by default.

## 6. Bottlenecks and leaks, ranked

1. **Unvirtualised grid (R-R1).** Mounted cards grow with results. Highest expected cost; confirm in the Electron profile first.
2. **Un-coalesced full snapshots (R-M1, R-M4).** One full array per arrival, sent to the renderer and re-merged in main. Total work and IPC bytes grow quadratically with providers.
3. **Index-based keys (R-R2).** Correctness and churn risk: reordering after a late arrival remounts cards and resets their state and focus.
4. **Cards not memoised (R-R3).** Every arrival re-renders every card because props are new each time.
5. **Two full-snapshot subscribers (R-R5) and a second full-array pass in main (R-M3).** Multiplies per-arrival cost without adding anything the user sees.
6. **Possible memory retention.** `collected`, the merged array and the IPC copy all hold every row. Release after `done` or `cancelled` was not verified.

Not a bottleneck today: the merge (18 ms at 5,000 rows, scratch benchmark) and image loading (already lazy). Do not move the merge to a worker until the Electron profile shows it matters.

## 7. Recommendations

Ordered by expected gain per change. Measure each before the next.

- **R1. Profile in the running app first.** Reproduce with a generic query over the full scope. Record the Performance trace, React Profiler commit times, IPC payload size per `search:update`, and mounted card count. Confirm which of §6 dominates. No worker yet.
- **R2. Virtualise the result grid.** Window by row, not item: compute column count from container width (ResizeObserver); render rows in view plus overscan; keep group headers as rows. Fixed card height is simplest (poster aspect ratio is already fixed in CSS), so variable-height support is not needed unless R1 says otherwise. Keep the full array in memory; window only the mounted DOM. Keyboard focus that scrolls out of view stays mounted.
- **R3. Stable card identity.** Key by the work and provider (e.g. `apiName` + `url`), never the index. Verify that reordering keeps each card's state.
- **R4. Coalesce `emit()`.** One trailing-edge publish per frame or per 150–250 ms, flushed at completion and cancellation so the final state is never delayed. Provider work is unchanged; only the publish rate changes. Measure that the UI stays responsive at the chosen interval.
- **R5. Incremental merge, only after R4 is measured.** The merge is order-sensitive, so an incremental version must give the same result. Keep a map from work key to group; a new arrival joins its group or opens one; recompute the best-ranked member for that group only. Regression-test against the full re-merge: identical output for the same input order.
- **R6. Memoise cards with stable props.** After R3: pass ids and a shared handler table instead of per-card closures; wrap `PosterCard` in `React.memo`; make `interactionFor` a lookup keyed by card id.
- **R7. Progress-only navbar subscription.** Navbar reads counts and state, not the full array. First confirm what `Navbar.tsx:297` reads.
- **R8. Deltas only if needed.** A delta protocol (new and changed rows since last push) cuts IPC bytes but adds sync state that can drift. Add only if the Electron measurement shows the payload is the bottleneck.
- **R9. Verify memory release.** Confirm `collected` and snapshot copies are released when a session finishes or is cancelled and replaced. Measure heap growth over repeated searches (§9 scenario 10).

## 8. User experience and states

### 8.1 During search (A §5)
- Show the first results as soon as they are usable.
- Keep progress, result counts and provider failure information responsive.
- Allow scrolling while more providers return results.
- Keep the Stop Searching action responsive.
- Avoid flicker, sudden scroll jumps and repeated grid reflow.

### 8.2 After completion (A §5)
- Make the entire result collection navigable.
- Allow smooth movement to the bottom of large collections.
- Preserve filtering, sorting, grouping, source inspection and details navigation.
- Do not show a completion state while providers are still active.

### 8.3 Empty and partial results (A §5, B §2.9)
- Distinguish no results from still-running, provider failure, and cancellation.
- Preserve existing explanations and recovery actions.
- Partial results stay usable when some providers fail.
- Show loading feedback without blocking the interface.
- Show partial results while the search runs; say whether providers are still being queried or the search has completed.
- Handle individual provider failures without interrupting the whole search.
- A completed search with no results shows a useful empty state.
- Keep cancellation accessible throughout an active search.
- Avoid layout shifts from repeatedly replacing the whole results area.

### 8.4 Active-search feedback (B §2.6)
- Provide a clear way to tell completed searches from searches still receiving results.

## 9. Measurement and acceptance

### 9.1 Environment
- Test on a documented mid-range Windows laptop with a defined CPU, memory, display resolution, Electron version and application build. Record it so results can be reproduced.
- Use synthetic result sets and real provider responses where possible (B §4).

### 9.2 Initial targets (A §6; "initial targets, not claims about current performance")

| Metric | Acceptance target |
|---|---|
| Initial rendering | First usable result page renders in under 500 ms after the first batch is available to the renderer |
| Initial result availability | Time from search submission to first usable results, measured separately from rendering time |
| DOM result count | Fewer than 100 mounted result-card roots at any time, for the large-result test profile |
| Scrolling | Smooth scrolling top to bottom of 3,000+ results, with no skipped or duplicated items |
| Main-thread long tasks | No task over 100 ms attributable to search-result processing or rendering during the scrolling benchmark |
| Metadata API latency | Page 1 response under 1 s at p95, under a defined network and server test environment |
| Search completion | Every valid result from every successfully completed provider in scope is accounted for |
| Cancellation | UI responds promptly; stale updates cannot modify a newer search |
| Memory | No unbounded heap growth across repeated large searches; baseline and regression threshold set from measurement |
| Functional parity | Filters, sorting, grouping, source attribution, navigation and saved-search behaviour pass regression tests |

- Time to first visible result and time until the first provider result is displayed are both measured (B §4).
- Ingestion throughput, renderer main-thread blocking, scroll frame performance, mounted components and DOM nodes, peak and retained memory, CPU during ingestion and scrolling, cancellation latency and filter/sort time (B §4).

### 9.3 Acceptance criteria (B §4)
1. Thousands of results can be ingested without mounting every card.
2. Mounted result components stay bounded by viewport, overscan and necessary auxiliary UI, not growing with the total.
3. Results display progressively while providers continue.
4. Scrolling and ordinary interactions stay responsive during ingestion.
5. Filtering, sorting and deduplication do not trigger unnecessary full-pipeline recomputation.
6. Cancelled and superseded searches cannot modify the active results.
7. Alternate provider sources are not lost through incorrect deduplication.
8. Repeated searches do not accumulate listeners, pending tasks or retained state.
9. Individual provider failures do not stop other providers returning results.
10. Targets are documented from measured baselines and verified on the supported Windows environment.

- Set numeric latency and memory targets only after measuring the current application on representative hardware (B).
- Do not claim performance is independent of result count in every respect. Storing, processing and retaining more data still costs something. The aim is that this cost does not become unbounded rendering work or a frozen interface (B).

### 9.4 Measurement definitions (A)
- **First usable result page:** the first batch has arrived, required processing is complete, and the initial visible cards are rendered and interactive.
- **DOM result count:** count mounted result-card roots, not every DOM node inside each card. Record total DOM node count separately.
- **Long tasks:** measure on the renderer main thread and identify the origin: application JavaScript, layout, paint, image decoding or unrelated browser work.
- **API p95:** measure a defined metadata API or backend page request. Provider fan-out is a separate metric and must not be presented as a single external API response.
- **Complete results:** every valid result accounted for after provider completion, including duplicates handled by the established deduplication policy.

### 9.5 Scenarios (A and B)
1. 100 results.
2. 500 results (B).
3. 1,000 results.
4. 2,000 results (B).
5. 3,000 results.
6. 5,000 results (B).
7. 10,000 results, where feasible.
8. A generic query across 500+ enabled providers.
9. Providers returning at different speeds.
10. A sustained stream of results from multiple providers (B).
11. Large result sets with images enabled.
12. Filtering and sorting while results still arrive.
13. Cancellation followed immediately by a new search.
14. Repeated searches and cancellation while results still arrive (B).
15. A provider returning a disproportionately large response (B).
16. Scrolling, filtering, sorting, and switching between results and details (B).
17. Repeated searches and navigation to measure memory retention.

Record median and p95 where applicable. Use Chromium/Electron Performance and Memory panels, the React Profiler and application timing instrumentation.

## 10. Instrumentation and diagnostics (A §7, B §4)

Lightweight instrumentation at each stage of the search pipeline. Record:
- Search submission time.
- Time to first provider result; time to first renderer batch; time to first visible, interactive result.
- Providers started, completed, failed and cancelled.
- Raw, normalised, deduplicated and displayed result counts.
- Time in normalisation, grouping, sorting and filtering.
- IPC payload size and update frequency.
- Mounted result-card count and total DOM node count.
- Long-task duration and source.
- Heap usage at defined points in the lifecycle.

- Diagnostics must not record unnecessary search terms, titles or viewing history.
- Keep overhead low. Provide a way to compare benchmark runs.

## 11. Implementation plan (in order)

- **Phase 1 — Profile before changing architecture (A §8, B priority 1).** Reproduce the freeze with a generic query and large result set. Capture a Performance recording and a React Profiler trace. Identify whether the dominant cost is provider execution, IPC, transformation, React rendering, images, layout or memory. Establish baselines and a reproducible dataset.
- **Phase 2 — Virtualise (A §8, B priority 2).** Implement or improve the virtualised grid. Keep complete data independent of mounted cards. Verify keyboard navigation, focus, accessibility, scroll restoration and details navigation. Test scrolling from first to last item. Fix or correct list virtualisation if it exists but is faulty (B).
- **Phase 3 — Ingestion and derived data (A §8, B priority 3).** Batch and coalesce updates. Batch progressive updates and remove avoidable re-renders (B). Eliminate whole-array transformations. Use incremental indexes and stable identities where appropriate. Keep counts and grouping correct as results arrive.
- **Phase 4 — Provider and IPC work (A §8).** Measure payload sizes and update frequency. Add bounded concurrency or backpressure only where profiling justifies it. Stop resending the complete accumulated collection. Keep provider coverage, error reporting, cancellation and progressive delivery.
- **Phase 4b — Deduplication and derived state (B priority 4).** Optimise deduplication, normalisation and derived-state calculation.
- **Phase 4c — Cancellation and stale protection across the pipeline (B priority 5).**
- **Phase 5 — Images, memory and components (A §8, B priority 7).** Lazy-load and size images. Fix expensive card rendering and layout. Clean up lifecycle resources. Re-run large-search and repeated-search memory tests. Add backpressure and memory-retention safeguards (B).
- **Phase 4d — Move expensive CPU work off the renderer where it helps (B priority 6).** Only for measured cases; not by default.
- **Phase 6 — Validate and prevent regressions (A §8, B priority 8).** Automated functional tests. Benchmarks for all dataset sizes. Compare with the baseline. Add regression checks for DOM count, long tasks, result completeness and memory. Document any target that cannot be met and the measured reason before changing the criteria. Validate with large synthetic datasets and real provider workloads (B).

**Recommended step order from §7 (R1–R9):** R1 → R2 and R3 → R4 → R6 and R7 → R5 (only if merge time is still visible) → R8 (only if payload still dominates) → R9 with the memory checks → validate at every size.

## 12. Definition of Done

- CS3 can search across its full enabled provider scope and keep every valid result without freezing the renderer (A).
- Large result collections are virtualised. Incremental updates do not trigger unnecessary full-list work. Users scroll smoothly from first result to last (A).
- Existing search functionality is intact. Performance improvements are backed by reproducible measurements (A).
- Automated tests show no missing results, incorrect counts, broken filtering, or navigation regressions (A).
- Expected outcome (B): the app stays responsive when generic searches return thousands of results from hundreds of providers. Users keep receiving comprehensive results while rendering cost is controlled, unnecessary computation is limited, cancellation is correct and memory is managed responsibly. Improvements are measured, source completeness is preserved, and arbitrary truncation is not used in place of a scalable architecture (B §6).
