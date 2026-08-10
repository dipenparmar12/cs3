# 12 — Performance and Limits

**Generated:** 2026-08-10
**Baseline:** commit `a72f9e6c`

Sizing is derived from the Android data model, not guessed. Android stores every user record as a separate `SharedPreferences` entry, which is loaded **entirely into memory** at process start — that is the real-world upper bound the desktop app must beat, not merely match.

---

## 1. Dataset sizing

Per profile, per record type. `context.getSharedPrefs().all` returns the whole map, so Android's practical ceiling is "what fits in the app's heap".

| Collection | Key form | Typical | Heavy (P6) | Notes |
|---|---|---|---|---|
| Watch progress | `<p>/video_pos_dur/<id>` | 500–3,000 | 50,000+ | One per watched episode, forever; **never pruned upstream** |
| Video watch state | `<p>/video_watch_state/<id>` | 300–2,000 | 30,000 | Only non-`None` values are stored |
| Bookmarks | `<p>/result_watch_state_data/<id>` | 50–500 | 5,000 | Full metadata per record |
| Favourites | `<p>/result_favorites_state_data/<id>` | 20–200 | 2,000 | Full metadata |
| Subscriptions | `<p>/result_subscribed_state_data/<id>` | 10–100 | 1,000 | Polled every 6 h — **cost scales with count** |
| Resume watching | `<p>/result_resume_watching_2/<pid>` | 20–200 | 2,000 | |
| Search history | `<p>/search_history/<key>` | 50–500 | 5,000 | |
| Sync mappings | `<prefix>_sync/<id>` | 100–1,000 | 10,000 | × 4 tracker prefixes |
| Download headers | `download_header_cache` | 10–200 | 2,000 | Transferable |
| Settings | flat | ~100 | ~100 | Bounded |
| Repositories | `REPOSITORIES_KEY` | 1–10 | 50 | |
| Installed plugins | `PLUGINS_KEY` | 5–30 | 200 | |
| Profiles | `data_store_helper/account` | 1–3 | 10 | Multiplies everything above |

**Worst credible case.** 10 profiles × 50,000 progress records ≈ **500,000 rows**, plus ~50,000 metadata-bearing library records. A backup at that size is roughly **150–400 MB of JSON**.

**Confidence: Medium.** The key shapes are High confidence; the volumes are extrapolation and should be validated against the real backup corpus ([30](30-migration-test-cases.md) §2).

---

## 2. Performance targets

| ID | Operation | Target | Hard limit |
|---|---|---|---|
| PERF-1 | Cold start to interactive | < 2 s | 4 s |
| PERF-2 | Warm start | < 1 s | 2 s |
| PERF-3 | Profile switch | < 300 ms | 1 s |
| PERF-4 | Library open, 10,000 items | < 500 ms to first paint | 2 s |
| PERF-5 | Library scroll | 60 fps sustained | no frame > 32 ms |
| PERF-6 | Search first result rendered | provider latency + < 100 ms | +500 ms |
| PERF-7 | Detail page render after `load` | < 200 ms | 500 ms |
| PERF-8 | Time to first frame after source selection | ≤ Android on the same source | +1 s |
| PERF-9 | Seek response | < 200 ms | 1 s |
| PERF-10 | Import, 10,000 records | < 10 s | 60 s |
| PERF-11 | Import, 500,000 records | < 3 min | 10 min |
| PERF-12 | Export, full dataset | < 30 s | 2 min |
| PERF-13 | Idle memory | < 300 MB | 500 MB |
| PERF-14 | Memory during playback | < 700 MB | 1.2 GB |
| PERF-15 | Memory during a 400 MB import | < 1 GB | 1.5 GB |
| PERF-16 | Idle CPU | < 1% | 3% |
| PERF-17 | Download throughput | ≥ 90% of raw HTTP for the same source | 75% |
| PERF-18 | Settings write→persist | < 50 ms | 200 ms |

---

## 3. Large-operation handling

### 3.1 Import and export

| ID | Requirement | Priority |
|---|---|---|
| PERF-19 | Import parses by **streaming**, never `JSON.parse` on the whole file. A 400 MB backup must not require 400 MB+ of string plus a full object graph. | P0 |
| PERF-20 | Records are written in transactional batches (1,000–5,000 rows), not one transaction per record and not one for the entire import. | P0 |
| PERF-21 | Progress reports at least every 500 ms, with category-level counts. | P0 |
| PERF-22 | Cancellation takes effect within 1 s and rolls back cleanly. | P0 |
| PERF-23 | Import runs off the UI thread — a worker or the main process — and the window stays fully responsive. | P0 |
| PERF-24 | Export streams to disk incrementally rather than building the document in memory. | P0 |
| PERF-25 | Peak import memory is bounded and independent of file size beyond a fixed working set. | P1 |

**Note on Android's format.** The backup is a single JSON object whose six type buckets are large maps. Streaming it requires an incremental parser that can emit key/value pairs from within `datastore._String` without materializing the whole map. This is the single most important performance decision in the migration subsystem — a naive implementation will exhaust memory on a large backup and be blamed on "the file being corrupt".

### 3.2 Lists

| ID | Requirement | Priority |
|---|---|---|
| PERF-26 | All content lists are virtualized. No list may render every item. | P0 |
| PERF-27 | Images load lazily with a bounded concurrent-decode budget. | P0 |
| PERF-28 | Bounded LRU disk cache for images, size configurable, default ~500 MB. | P1 |
| PERF-29 | Library sorting and filtering happen in the data layer (indexed SQL), not by loading everything into the renderer. | P0 |
| PERF-30 | Pagination or windowed queries between main and renderer; never ship 50,000 rows across IPC. | P0 |

### 3.3 Providers and network

| ID | Requirement | Priority |
|---|---|---|
| PERF-31 | Concurrent provider calls are capped (default 8, configurable). Android's unbounded `amap` is a rate-limit hazard. | P0 |
| PERF-32 | Per-host connection limits and backoff. | P1 |
| PERF-33 | `sequentialMainPage` providers are strictly serialized with their declared delays. | P0 |
| PERF-34 | Provider results are cached in-session so revisiting a page does not re-fetch. | P1 |
| PERF-35 | Subscription polling batches requests and spreads them over the interval rather than firing 1,000 at once. | P1 |

### 3.4 Downloads

| ID | Requirement | Priority |
|---|---|---|
| PERF-36 | Concurrency honors `download_parallel_key` and `download_concurrent_key`. | P0 |
| PERF-37 | Downloads stream to disk; a file is never buffered whole in memory. | P0 |
| PERF-38 | Segmented download with per-segment resume for files over the 50 MiB threshold Android uses. | P1 |
| PERF-39 | Download progress events are throttled to ≤ 4 Hz per item and coalesced across items. | P1 |
| PERF-40 | Queues of 1,000+ items remain responsive and are themselves virtualized. | P1 |

### 3.5 Playback

| ID | Requirement | Priority |
|---|---|---|
| PERF-41 | Hardware decoding by default; software fallback only on failure or explicit setting. | P0 |
| PERF-42 | Buffer sizing honors the four `video_buffer_*` keys. | P1 |
| PERF-43 | Thumbnail preview generation is off the render path and cancellable. | P2 |
| PERF-44 | Subtitle rendering does not drop video frames; ASS rendering in particular must be offloaded. | P1 |

---

## 4. Resource limits

| Resource | Limit | Behavior on breach |
|---|---|---|
| Import file size | 1 GB | Refuse with a clear message and the actual size |
| Import JSON depth | 64 | Refuse — malformed or hostile |
| Import key count | 2,000,000 | Refuse |
| Single value length | 10 MB | Skip, report in the migration summary |
| Plugin archive size | 100 MB | Refuse |
| Plugin extracted size | 500 MB | Refuse (decompression bomb) |
| Plugin call timeout | 30 s default, honoring per-operation `MainAPI` timeouts | Kill and attribute the failure |
| Plugin host memory | 512 MB | Terminate host, keep the app alive |
| Concurrent plugin hosts | 4 | Queue |
| Image cache | 500 MB default | LRU eviction |
| HTTP cache | 200 MB default | LRU eviction |
| Log files | 50 MB total, rotated | Delete oldest |
| Pre-import snapshots | 5 retained | Delete oldest |

---

## 5. Platform performance notes

| Platform | Consideration |
|---|---|
| Windows | Defender real-time scanning slows many-small-file writes — batch, and prefer fewer larger files. `MAX_PATH` affects deep download trees. |
| macOS | App Nap can throttle background downloads; request the appropriate activity assertion. Apple Silicon vs Intel need separate performance validation. |
| Linux | Wayland vs X11 differ materially for video and fullscreen. Bundled versus system codec availability varies by distribution. |
| All | Low-end HTPC hardware (P3) is a real target; do not tune only on developer machines. |

---

## 6. Measurement

| ID | Requirement | Priority |
|---|---|---|
| PERF-45 | Startup, import, and library-render timings are instrumented and locally visible. | P1 |
| PERF-46 | CI runs performance regression tests against fixed synthetic datasets (small / typical / heavy). | P1 |
| PERF-47 | Memory profiles are captured for the heavy dataset each release. | P2 |
| PERF-48 | A synthetic dataset generator produces reproducible fixtures at each size tier. | P1 |

---

## Next steps

1. Build the synthetic dataset generator (PERF-48) in Phase 3 — it is a prerequisite for meaningful targets.
2. Validate §1 volumes against real backups; adjust targets once, then freeze them.
3. Prototype the streaming import parser (PERF-19) early — it constrains the migration architecture.
4. Add PERF-1, PERF-5, PERF-10, PERF-26 to CI as gates from Phase 5 onward.
