# Refactoring plan — CloudStream 3 Desktop

Status: **Phases 1 and 2.1–2.2 done; Phase 2.3–2.5 and Phase 3 outstanding.** Written
2026-08-21 from a full read of `cs3_windows/`, `sidecar/` and `tools/`. Every number below was counted, not estimated; the commands that produced
them are in §7 so they can be re-run to measure progress.

The objective is **internal only**: the same features, the same behaviour, the same IPC
surface, the same rendered pixels. Nothing here removes a capability or changes a contract.

---

## 0. Progress

| Counter | Before | Now |
|---|---:|---:|
| `main.ts` lines | 3,150 | **713** |
| Largest IPC module | — | 250 |
| Hand-written envelopes in `main.ts` | 68 | **0** |
| `removeListener` in `preload.ts` | 14 | **2** |
| Local byte/speed formatters in `src/` | 9 | **0** |
| Debounced-persistence implementations | 5 | 3 (2 adopted) |
| `DisabledSet` copies in `PluginManager` | 3 | **1** |
| Tests | 162 | **194** |
| IPC registrations | 486 | **486** (verified identical) |
| Inline `style={{` in `src/` | 572 | 572 *(Phase 3)* |
| `window.cloudstream` reaches | 332 | 335 *(Phase 3)* |

**Done:** Phase 1.1–1.4 (envelope, JSON store, disabled set, formatters), the preload
subscription helper, and Phase 2.1–2.2 (the `main.ts` split into 20 per-domain registrars
plus the `Services` bag).

**Not started:** Phase 1.5 (`src/api/client.ts`), 1.6 (`historyEvents.ts`), Phase 2.3
(`PluginManager` split), 2.4 (`binaryDownloader`), 2.5 (`ContentService.discover`), and all
of Phase 3.

**One verification tool was built and is worth keeping:** `tools/refactor/ipc-surface.mjs`
prints the whole IPC surface as a sorted manifest. A channel name is a string on both sides
of the bridge and the compiler cannot see it, so a rename or a drop typechecks perfectly and
fails at runtime as a feature that silently does nothing. Snapshot before, diff after.

---

## 1. The baseline, and why it is the whole plan

Before anything moved:

```
tsc -b                                       clean
electron/sharedDiscovery.test.mts            10 passed
electron/sourceCache.test.mts                10 passed
electron/cs3/playedSource.test.mts           12 passed
electron/media/decisionEngine.test.mts       63 passed
electron/media/pipeline.test.mts             16 passed   (real ffmpeg)
electron/media/mpvEngine.test.mts            12 passed   (real mpv)
src/utils/sourceExport.test.mts              13 passed
electron/logging/logger.test.mts             17 passed
electron/cs3/homeProviders.test.mts           9 passed
                                            162 passed
```

That is the entire safety net, and it covers perhaps 8% of the code being touched. The app
cannot be launched in a headless container, there is no CI, and the renderer has no tests
at all. So the plan is shaped around that constraint rather than around what would be
ideal:

- **Mechanical before structural.** A change a compiler can verify goes first. A change
  only a human can verify goes last, and goes in the smallest slice that still makes sense.
- **Facades stay.** When a class is split, the original name keeps its exact public
  signature and delegates. Callers do not move in the same commit as the code they call.
- **Extraction, not reinterpretation.** Moving a block of code into a named function is
  safe. Rewriting it to be "cleaner" while moving it is not, and the two must never happen
  in the same step.
- **Tests are added ahead of the risky steps, not after.** The pure modules extracted in
  Phase 1 are directly testable, so each one lands with a suite. That grows the net before
  Phase 3 needs it.

---

## 2. What is actually wrong

Not "it is messy". Three specific, measurable problems, in the order they cost the most.

### 2.1 Files that own too much

| File | Lines | What is in it |
|---|---:|---|
| `src/components/VideoPlayer.tsx` | 3,175 | 24 `useState`, 36 `useEffect`, 19 `useCallback`, one 605-line `return` |
| `electron/main.ts` | 3,150 | 229 IPC handlers across 29 namespaces, plus all service construction |
| `electron/pluginManager.ts` | 2,365 | six unrelated responsibilities in one class |
| `electron/preload.ts` | 1,500 | 228 forwarders, 14 hand-written subscription closures |
| `src/views/HistoryView.tsx` | 1,404 | filters + list + inspector + confirm dialog + selection |
| `electron/contentService.ts` | 1,209 | `discover()` alone is 290 lines |
| `src/App.tsx` | 1,194 | search, playback, downloads, navigation, player chrome, binaries |
| `src/sources.css` | 5,378 | the entire application's styles, 145 KB, one file |

The extensions screen was already rebuilt out of this exact shape (`AGENTS.md` §"The
extensions screen"), and that rebuild is the template: a container, focused children, a
hook per concern, every feature kept. `HistoryView` is the same 2,689-line component the
extensions screen used to be, and `VideoPlayer` is worse.

### 2.2 The same code, written repeatedly

| Duplicated thing | Copies | Where |
|---|---:|---|
| `try/catch` → `{ ok, error, …payload }` | 68 | `main.ts` |
| `ipcRenderer.on` + `removeListener` closure | 14 | `preload.ts` |
| byte-size formatter | 6 | five components + `HistoryView` |
| transfer-speed formatter | 3 | `DownloadCenter`, `PlayerDownloadPanel`, `VideoPlayer` |
| debounced JSON-file persistence | 5 | `diagnostics`, `providerAnalytics`, `detailCache`, `discovery`, `inspectionStore` |
| datastore-backed string-set toggle | 3 | `PluginManager` (providers / extensions / repositories) |
| "check → download → extract → locate → verify" installer | 5 | `binaryDownloader` |
| hand-built `recordHistoryEvent` payload | 8 | `App`, `VideoPlayer` ×3, `DetailView`, `HistoryView`, `LibraryBucketSelector` ×2 |
| datastore array store (read → validate → cap → write) | 4 | `searchHistory`, `titleOutcomes`, `bookmarkStore`, `historyStore` |

**The six byte formatters are the instructive case.** They are not copies — they disagree.
One returns `'Unknown'` for zero, one `'—'`, one `'Unknown size'`; two compute GB as
`1024³` and one as `1e9`; precision runs from 0 to 2 decimal places. Any consolidation
that picks a single behaviour changes what six screens display. The correct move is a
shared formatter *parameterised on the differences*, with each call site keeping its exact
current output — which is why this is Phase 1 work with a test, not a five-minute
find-and-replace.

### 2.3 Boundaries that exist in the docs but not in the code

`AGENTS.md` describes a clean four-layer architecture. The code mostly honours it, with
three leaks:

- **`window.cloudstream` is reached directly 332 times across 40 renderer files**, 195 of
  them optional-chained and 78 not. There is no seam between the renderer and the IPC
  surface, so nothing can be rendered without Electron and no view can be tested.
- **`main.ts` is both the composition root and the controller layer.** ~30 singletons are
  constructed at module scope in an order that matters and is documented only in comments,
  then 229 handlers are registered in the same file.
- **Hooks are not a layer.** `useMiniFrame`, `useExtensionCatalog`, `useTimelinePreview`
  and `useTitleEnrichment` each live beside one component. There is no `src/hooks/`, so a
  hook is only discoverable by already knowing which component it was written for.

---

## 3. What is deliberately not being touched

Stated up front, because each looks like an obvious target and each would be a mistake.

**The `android.*` / `androidx.*` Java shims** (`sidecar/src/main/java/`, ~20 files, 95
identical `throw new UnsupportedAndroidApiException` sites). The repetition is the
specification: these mirror an external API surface method-for-method, and `AGENTS.md`
records two separate outages caused by a return type being *slightly* wrong
(`getPackageManager` and `getResources` both returning `Object`). Consolidating them
behind a helper buys nothing and risks a descriptor.

**Anything `AGENTS.md` marks load-bearing.** The `<video>` element is never remounted;
`-c:v copy` never runs on unverified codec info; the mux tables stay broad; `empty` stays
separate from `failure`; changed-ness in `KotlinNameRepair` is never re-derived from a
counter. Each of those reads as removable complexity and each was written to fix a
specific, documented, expensive bug. **Where the code contradicts an instinct to simplify,
the code wins** — and if the reason is not obvious, it is in `AGENTS.md` or in a `docs/PRD`
requirement id cited in a comment nearby.

**The comment density.** This codebase's comments carry rationale that exists nowhere else.
Refactoring moves them with the code they explain; it does not thin them out.

**New dependencies.** The request asked for ecosystem libraries in place of custom
implementations. Having looked: **this codebase is not reinventing library functionality.**
There is no hand-rolled date library, no deep-clone, no semver parser, no
`JSON.parse(JSON.stringify(…))` anywhere. What it reinvents is *its own* internal
patterns — five copies of its own file-persistence idiom, three of its own toggle idiom.
The fix for that is one internal module each, not a package. Adding runtime dependencies
here also has a real cost that a web app does not pay: main-process deps are externalised
from the bundle and ship to users, native deps need per-ABI rebuilds, and `webtorrent`'s
already do. The recommendation is to add none, and to spend the effort on the internal
duplication instead. (Two hooks — `useDebouncedValue`, `useAsyncData` — are internal
consolidations of a pattern repeated in the renderer, not wrappers around a library.)

---

## 4. The phases

Ordered by verifiability: each phase's changes are checkable by a stricter mechanism than
the next one's.

### Phase 1 — Shared primitives *(compiler-verifiable, independently revertible)*

New modules, each with a test where it is pure. No caller behaviour changes.

| # | Module | Replaces |
|---|---|---|
| 1.1 | `electron/ipc/envelope.ts` | 68 hand-written try/catch envelopes |
| 1.2 | `electron/util/jsonFileStore.ts` | 5 debounced-persistence implementations |
| 1.3 | `electron/util/disabledSet.ts` | 3 toggle implementations in `PluginManager` |
| 1.4 | `src/utils/format.ts` | 6 byte + 3 speed + 2 duration formatters |
| 1.5 | `src/api/client.ts` | 332 direct `window.cloudstream` reaches |
| 1.6 | `src/utils/historyEvents.ts` | 8 hand-built event payloads |

`1.4` and `1.6` land with test suites. `1.5` is introduced but adopted gradually — it is a
re-export seam first, and call sites migrate per-file in later phases so a mistake is
scoped to one screen.

### Phase 2 — Main-process module boundaries *(compiler + existing suites)*

| # | Change | Result |
|---|---|---|
| 2.1 | Split the 229 handlers into `electron/ipc/<domain>.ts` registrars taking a service container | `main.ts` → lifecycle and wiring only |
| 2.2 | Extract `electron/services.ts` — the composition root, with construction order stated as code | ~30 module-scope singletons become one declared graph |
| 2.3 | `PluginManager` → `RepositoryClient`, `PluginInstaller`, `PluginRegistry`, `ProviderGateway`; `PluginManager` becomes a facade delegating to them | no caller changes |
| 2.4 | Table-drive `binaryDownloader`: one `installTool(spec)` plus a spec per tool | 5 near-identical methods → 1 + a table |
| 2.5 | `ContentService.discover` → named private steps | a 290-line method becomes readable |

2.3 is the highest-risk item in this phase and goes last within it. The facade is what
makes it safe: `pluginManager.installPlugin(…)` keeps working identically whether the body
is inline or delegated, so the split can be verified by `tsc -b` plus the provider E2E
harness (`tools/e2e/provider-e2e.mjs`) before any caller is touched.

### Phase 3 — Renderer decomposition *(human-verifiable — smallest slices)*

| # | Change |
|---|---|
| 3.1 | `VideoPlayer` → hooks under `src/components/player/hooks/` (`usePlaybackAttachment`, `useTransport`, `useAudioTracks`, `useSubtitles`, `usePlayerPreferences`, `useControlsVisibility`, `useWatchProgress`, `useExternalPlayback`) + `PlayerControls` / `PlayerMessages` / `PlayerChrome` |
| 3.2 | `HistoryView` → `useHistoryFeed` + `HistoryFilters` / `HistoryList` / `HistoryInspector`, on the extensions-screen template |
| 3.3 | `App.tsx` → `usePlaybackSessionController`, `useSearchController`, `useDownloadQueue` |
| 3.4 | Inline `style={{…}}` → classes; split `sources.css` by feature to match the component tree |

Each hook extraction is one commit, moving state and effects verbatim. **The hard rule for
3.1: the `<video>` element and its containing JSX do not move.** Minimising is a geometry
change to a mounted element, and remounting it stops the stream, loses the position and
renegotiates the swarm. The hooks move around it.

### Phase 4 — Organisation

`src/hooks/` for cross-cutting hooks; `electron/util/` consolidated; the remaining
datastore array stores onto one `DatastoreCollection<T>`; `AGENTS.md` updated in the same
commits, as its own rules require.

---

## 5. Rules for every commit

1. `tsc -b` clean, and all 162 tests pass, before it is written.
2. One concern per commit. A move and a rewrite are two commits.
3. Comments travel with the code they explain.
4. Public signatures do not change in the same commit as the implementation behind them.
5. Conventional Commits, scoped to the area — `refactor(ipc):`, `refactor(player):`.
6. If a behaviour difference is discovered mid-refactor, it is reported, not silently
   fixed — a bugfix disguised as a refactor is impossible to review or revert.

---

## 6. What this does not fix

Honest limits, so nobody expects them later:

- **No new test coverage for the renderer.** Phase 3 makes the views testable by
  extracting logic into pure hooks; it does not add a test runner or a DOM environment.
  That is a separate decision with its own cost.
- **No CI.** `.github/` still has no workflow. Everything here is verified locally.
- **The datastore still writes synchronously on every set.** Coalescing those writes would
  change durability semantics on a crash, which is a behaviour change and therefore out of
  scope for this work.
- **`sources.css` gets split, not rewritten.** 1,300 selectors with no usage analysis is a
  separate project.

---

## 7. Measuring progress

```bash
# the safety net
cd cs3_windows && node node_modules/typescript/bin/tsc -b && bun run test:electron

# file sizes
find cs3_windows/electron cs3_windows/src -name '*.ts*' | xargs wc -l | sort -rn | head -20

# the duplication counters
grep -c 'fail(error)'          cs3_windows/electron/main.ts       # 68 → 0
grep -c 'removeListener'       cs3_windows/electron/preload.ts    # 14 → 1
grep -rc 'formatSize\|formatBytes' cs3_windows/src --include=*.tsx # 6 → 0
grep -ro 'style={{' cs3_windows/src --include=*.tsx | wc -l       # 572 → …
grep -ro 'window.cloudstream' cs3_windows/src | wc -l             # 332 → …
```
