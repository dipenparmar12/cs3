# PRD: High-Performance Search Results and Large-Scale Rendering

## 1. Objective

Make CS3 Desktop responsive and reliable when searching across 500+ providers and displaying thousands or tens of thousands of results.

The current search experience can freeze or lag when a generic query produces a large result set. The goal is to eliminate these performance bottlenecks without sacrificing search coverage, results, provider functionality, filtering, sorting, or navigation.

**Core requirement: Every valid result must remain accessible, but only the results needed for the current viewport should be rendered in the DOM.**

This is an optimization project, not a request to reduce the number of results returned or displayed.

## 2. Scope and Non-Negotiable Requirements

- Preserve all valid results returned by enabled providers.
- Never silently truncate results to improve rendering performance.
- Preserve source attribution, deduplication, grouping, filtering, sorting, and existing card interactions.
- Keep search progress, provider failure counts, cancellation, saved searches, and source-scope behavior working.
- Allow users to scroll through the complete result set, including the final item.
- Keep the UI responsive while providers are still returning results.
- Support incremental result delivery without rebuilding the entire result list after every update.
- Preserve keyboard navigation, accessibility, and the user's scroll position when appropriate.
- Ensure performance optimizations do not introduce missing, duplicated, or incorrectly grouped results.

## 3. Existing Architecture to Audit

The project documentation identifies the following relevant components:

| Component | Optimization focus |
|---|---|
| `src/views/SearchView.tsx` | Search result rendering and page-level state updates |
| `src/utils/resultGroups.ts` | Grouping and result transformations |
| `PosterCard` | Per-result component rendering and image loading |
| `SearchSessionManager` | Provider fan-out, incremental updates, and session state |
| `search:*` IPC channels | Main-to-renderer search updates and cancellation |
| `ContentService` | Search orchestration, source normalization, and caching |
| `SourceCache` and existing metadata caches | Reuse of existing cache mechanisms |

These locations are identified in the current screen and service documentation. <FileCite ref_id="turn5file7" />

Before changing the architecture, profile the running application and inspect the current implementations. Determine which costs come from provider execution, data processing, IPC serialization, React rendering, image loading, or browser layout. Do not assume virtualization alone will solve every freeze.

## 4. Required Performance Architecture

### 4.1 Virtualized Result List

Implement or improve a virtualized list or grid for search results.

Instead of mounting every result card, render only:
- Items currently visible in the viewport.
- A small overscan buffer immediately above and below the viewport.
- Any explicitly required accessible or focused item that must remain mounted.

The full result dataset remains available to the search model and relevant operations.

Requirements:
- Maintain stable result keys and identities.
- Support variable-height content or use a measured, predictable card layout.
- Preserve correct scroll offsets as results are added or updated.
- Avoid mounting thousands of poster cards simultaneously.
- Support scrolling to the bottom without skipping items.
- Handle window resizing, zoom, responsive grid columns, and display scaling.
- Preserve focus and keyboard navigation when virtualized items mount and unmount.
- Ensure screen readers can navigate the result collection meaningfully.
- Keep existing interactions, including opening details, source attribution, menus, and card actions.

**Important:** Virtualization limits DOM work. It must not limit the number of searchable or accessible results.

### 4.2 Incremental Result Ingestion

Provider results should be processed and delivered incrementally rather than waiting for all providers to finish.

Requirements:
- Render initial usable results as soon as possible.
- Accept additional provider results in bounded batches.
- Avoid forcing a complete React render for every individual result.
- Coalesce high-frequency updates into controlled batches.
- Keep progress indicators accurate while results continue arriving.
- Prevent stale search sessions from updating the current screen.
- Support immediate cancellation without losing control of the UI.
- Retain all valid results from the active session.

Batching must not introduce unbounded delays. The user should see new results promptly while the application remains responsive.

### 4.3 Separate Data Processing from Rendering

Audit expensive operations such as deduplication, normalization, sorting, grouping, filtering, and result counts.

Requirements:
- Avoid repeating full-array transformations after every provider update.
- Use incremental indexes or maps where appropriate.
- Recalculate only affected groups or derived data when possible.
- Memoize expensive computations using stable inputs.
- Avoid creating new object references for unchanged results.
- Avoid sorting the entire collection repeatedly when the selected ordering does not require it.
- Keep UI state separate from large, frequently changing provider payloads.
- Move demonstrably expensive CPU-bound work to a Web Worker or the main process when that improves responsiveness.
- Use a single authoritative result identity and deduplication strategy.

Do not move work across process boundaries without measuring the cost of serialization and IPC. A worker is useful only when its benefits exceed communication and copying overhead.

### 4.4 Optimize Poster Cards and Images

Thousands of image requests can create network, memory, decoding, and layout pressure even when the list is virtualized.

Requirements:
- Lazy-load images close to the viewport.
- Cancel or deprioritize image work for items far outside the viewport.
- Reserve poster dimensions to prevent layout shifts.
- Use appropriate thumbnail sizes rather than downloading full-resolution artwork for every card.
- Avoid decoding and retaining unnecessary image variants.
- Reuse existing image and metadata caches where appropriate.
- Ensure missing images and failed requests do not repeatedly trigger expensive retries.
- Avoid hover effects or observers that create unnecessary work for every result.
- Ensure artwork privacy and NSFW visibility rules remain enforced.

### 4.5 Stable State and Efficient React Rendering

Audit component state boundaries and update frequency.

Requirements:
- Keep the search header, progress indicator, filters, and result grid from rerendering unnecessarily.
- Memoize result cards where inputs are stable and profiling demonstrates a benefit.
- Avoid passing freshly created callbacks, arrays, and objects to every card on each update.
- Keep scroll events lightweight.
- Avoid synchronous layout reads and writes in repeated loops.
- Avoid large DOM mutations during a single frame.
- Use React profiling to identify actual component costs before adding memoization indiscriminately.

### 4.6 Provider Fan-Out and Backpressure

With 500+ providers, simultaneous work may overload CPU, memory, the extension runtime, the IPC bridge, or the renderer.

Requirements:
- Preserve the ability to search every enabled provider in the active scope.
- Use bounded concurrency where provider execution can overload shared resources.
- Stream results from completed providers without waiting for the slowest provider.
- Prevent slow providers from blocking the delivery of results from fast providers.
- Coalesce update notifications without dropping underlying results.
- Avoid serializing the entire accumulated result collection for every incremental update.
- Apply backpressure where necessary so that result production cannot overwhelm rendering and state processing.
- Keep cancellation responsive across the provider, session, and renderer layers.
- Continue reporting provider failures and partial results accurately.

Concurrency limits must improve responsiveness without silently excluding providers or preventing the search from completing.

### 4.7 Filtering, Sorting, and Grouping

All existing result operations must remain available.

Requirements:
- Filtering must operate over the complete result dataset, not only currently mounted DOM nodes.
- Sorting must apply to the full applicable result collection.
- Grouping must preserve all valid results.
- Source filters, content-type filters, dead-result visibility, and saved-search behavior must remain correct.
- Result counts must reflect the full relevant dataset.
- New results must enter the correct groups and positions.
- Changing filters must not discard results from the active search session.
- Virtualization must be independent of the underlying data model.

### 4.8 Memory and Lifecycle Management

Requirements:
- Avoid retaining unnecessary copies of large result arrays and provider payloads.
- Release stale search-session data when it is no longer needed and is not required by saved searches or other features.
- Clean up subscriptions, observers, timers, image requests, and event listeners when appropriate.
- Prevent repeated navigation between search and details from accumulating hidden components or listeners.
- Measure heap growth during long searches and repeated search sessions.
- Ensure cancellation and error paths clean up resources reliably.

Do not remove results merely to reduce memory consumption. If a future result-storage strategy is needed, it must preserve the ability to access the complete result set.

## 5. User Experience Requirements

### During Search
- Show the first results as soon as they are usable.
- Keep progress, result counts, and provider failure information responsive.
- Allow users to scroll while additional providers are returning results.
- Keep the Stop Searching action responsive.
- Avoid flicker, sudden scroll jumps, and repeated grid reflow.

### After Search Completion
- Make the entire result collection navigable.
- Allow smooth movement to the bottom of large collections.
- Preserve filtering, sorting, grouping, source inspection, and details navigation.
- Do not present a misleading completion state while providers remain active.

### Empty and Partial Results
- Distinguish no results from a still-running search, provider failure, or cancellation.
- Preserve existing explanations and recovery actions.
- Ensure partial results remain usable when some providers fail.

## 6. Performance Acceptance Criteria

Test on a documented mid-range Windows laptop with a defined CPU, memory, display resolution, Electron version, and application build. Record the test environment so results can be reproduced.

The following are initial targets, not claims about current performance.

| Metric | Acceptance target |
|---|---|
| Initial rendering | First usable result page renders in under 500 ms after the first batch is available to the renderer |
| Initial result availability | Measure time from search submission to first usable results separately from rendering time |
| DOM result count | Fewer than 100 mounted result-card roots at any time for the large-result test profile |
| Scrolling | Smooth scrolling from the top to the bottom of 3,000 or more results, without skipped or duplicated items |
| Main-thread long tasks | No tasks longer than 100 ms attributable to search-result processing or rendering during the scrolling benchmark |
| Metadata API latency | Page 1 response under 1 second at p95 under a defined network and server test environment |
| Search completion | Every valid result from every successfully completed provider in the active scope is accounted for |
| Cancellation | The UI responds promptly to cancellation and stale updates cannot modify a newer search |
| Memory | No unbounded heap growth across repeated large searches; establish a baseline and regression threshold from measurement |
| Functional parity | Existing filters, sorting, grouping, source attribution, navigation, and saved-search behavior pass regression tests |

### Measurement definitions

- **First usable result page:** The first batch has arrived, required data processing has completed, and the initial visible result cards are rendered and interactive.
- **DOM result count:** Count mounted result-card roots, not every DOM node inside each card. Also record total DOM node count separately.
- **Long tasks:** Measure on the renderer main thread and identify whether the work originates from application JavaScript, layout, paint, image decoding, or unrelated browser work.
- **API p95:** Measure a defined metadata API or backend page request. Provider fan-out search is a separate metric and must not be represented as a single external API response.
- **Complete results:** Every valid result is accounted for after provider completion, including duplicates handled by the established deduplication policy.

### Performance scenarios

Run benchmarks for:
1. 100 results.
2. 1,000 results.
3. 3,000 results.
4. 10,000 results, where feasible.
5. A generic query across 500+ enabled providers.
6. Providers returning results at different speeds.
7. Large result sets with images enabled.
8. Filtering and sorting while results continue arriving.
9. Cancellation followed immediately by a new search.
10. Repeated searches and navigation to measure memory retention.

Record median and p95 timings where applicable. Use Chrome/Electron Performance and Memory panels, React Profiler, and application-level timing instrumentation.

## 7. Instrumentation and Diagnostics

Introduce lightweight instrumentation to measure each stage of the search pipeline.

Record:
- Search submission time.
- Time to first provider result.
- Time to first renderer batch.
- Time to first visible and interactive result.
- Number of providers started, completed, failed, or cancelled.
- Number of raw, normalized, deduplicated, and displayed results.
- Time spent in normalization, grouping, sorting, and filtering.
- IPC payload size and update frequency.
- Mounted result-card count and total DOM node count.
- Long-task duration and source.
- Heap usage at defined points during the search lifecycle.

Diagnostics must not record unnecessary search terms, titles, or viewing history. Keep instrumentation overhead low and provide a way to compare benchmark runs.

## 8. Implementation Plan

### Phase 1: Profile Before Changing Architecture
- Reproduce the freeze with a generic query and a large result set.
- Capture a Performance recording and React Profiler trace.
- Identify whether the dominant cost is provider execution, IPC, transformations, React rendering, images, layout, or memory.
- Establish baseline measurements and a reproducible test dataset.

### Phase 2: Virtualize Search Results
- Implement or improve the virtualized grid.
- Preserve complete result data independently of mounted cards.
- Verify keyboard navigation, focus, accessibility, scroll restoration, and navigation to details.
- Test scrolling from the first item to the last item.

### Phase 3: Optimize Result Ingestion and Derived Data
- Batch and coalesce incremental updates.
- Eliminate unnecessary whole-array transformations.
- Use incremental indexes and stable result identities where appropriate.
- Ensure result counts and grouping remain correct as new results arrive.

### Phase 4: Optimize Provider and IPC Work
- Measure payload sizes and update frequency.
- Add bounded concurrency or backpressure where the profiling data justifies it.
- Avoid repeatedly sending complete accumulated result collections.
- Preserve provider coverage, error reporting, cancellation, and progressive delivery.

### Phase 5: Optimize Images, Memory, and Components
- Lazy-load and size images appropriately.
- Fix expensive card rendering and layout patterns.
- Clean up lifecycle resources.
- Re-run large-search and repeated-search memory tests.

### Phase 6: Validate and Prevent Regressions
- Run automated functional tests.
- Run performance benchmarks for all defined dataset sizes.
- Compare results with the original baseline.
- Add regression checks for DOM count, long tasks, result completeness, and memory.
- Document any target that cannot be met and the measured reason before changing the acceptance criteria.

## 9. Definition of Done

CS3 can search across its full enabled provider scope and retain every valid result without freezing the renderer. Large result collections are virtualized, incremental updates do not trigger unnecessary full-list work, and users can scroll smoothly from the first result to the last.

All existing search functionality remains intact. Performance improvements are supported by reproducible measurements, and automated tests prove that optimization has not introduced missing results, incorrect counts, broken filtering, or navigation regressions.