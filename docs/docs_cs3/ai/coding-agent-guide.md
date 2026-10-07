# Coding-Agent Guide

For an AI (or human) about to modify CS3 Desktop. Root context also lives in `CLAUDE.md`/`AGENTS.md` (same file);
**if it contradicts the code, the code wins — fix the doc in the same commit.** Domain depth: `docs/agents/*.md`.

## 1. Orientation
```
cs3/
├── cs3_windows/        THE APP (Electron main in electron/, React in src/, scripts/, electron-builder.yml)
├── sidecar/            JVM runtime for .cs3 (Maven) + bridge/ (Kotlin)
├── tools/              package/ (build), e2e/ (live harnesses), research/, dex-spike/, toolchain/
├── docs/               PRD/ (intent), agents/ (domain notes), docs_cs3/ (this set; android/ = upstream reference)
└── repositories/       26 submodules, EMPTY unless initialised — never claim to have verified against them
```
`cs3_windows/electron/`: `main.ts` (wiring + IPC), `preload.ts`, `cs3/` (domain), `media/`, `torrent/`, `metadata/`, `download/`, `logging/`, `util/`.
`cs3_windows/src/`: `App.tsx`, `views/`, `components/`, `utils/` (pure rules), `types/` (shared with main).

## 2. Trace any feature, UI → backend
1. Find the component (`src/components` or `src/views`) and the call `window.cloudstream.<ns>.<method>`.
2. `electron/preload.ts` → the channel string. 3. `main.ts` → `ipcMain.handle('<ns>:<method>')`.
4. The service it calls ([api-services.md](../architecture/api-services.md)). 5. Its store/cache ([persistence.md](../architecture/persistence.md), [caching.md](../architecture/caching.md)).
6. Push results come back on `<ns>:update`-style channels subscribed in `preload.ts`.

## 3. Where new work goes
| Adding… | Put it in | Also touch |
|---|---|---|
| An IPC method | service → `main.ts` handler → `preload.ts` type+method → caller | `bun run test ipc` |
| A native provider | `electron/cs3/nativeProviders/<id>.ts` implementing `NativeProvider`, register in `nativeProviderRegistry.ts` | enable cascade, `cs3native://`, `bun run test native-providers` |
| An indexer | `torrent/indexers/*`, entry in `indexerRegistry.ts` | budget/cooldown applies automatically |
| A playback strategy / decision rule | `media/decisionEngine.ts` (pure) + test; execution in `playbackEngine.ts` | `shouldRouteToNativeEngine` if mpv-related |
| Persistent data | a store behind `DatastoreManager` or `util/jsonFileStore.ts`; add a `backupSections` row | `isPrivateSession()` check if automatic; Incognito behaviour |
| A setting | `SettingRow` with `level`; `settingsSearch` keywords | `datastoreCategories.ts` for backup labels |
| A screen | `src/views/*` lazy route + `ErrorBoundary` in `App.tsx`; Sidebar entry | `componentReachability` test |
| Shim/bridge change | `sidecar/` and/or `sidecar/bridge/` | **bump `RUNTIME_GENERATION`** (16 now) |

## 4. Rules that must not be broken casually
Playback: `media:prepare` is the only source of a playable URL; nothing decided from a URL string; renderer capabilities are registered before playback and override static tables; a track switch re-derives the plan; never `-c:v copy` on unverified codec info; HDR re-encode gets the full zscale chain or none; mpv gets the **proxied** URL; nothing per-frame/per-chunk reaches the main thread; probes cached by origin, verdicts recomputed.
Providers: call `ensureProviderActive` first; provider loading is serial; the gate is `enabledProviderNames`; never reintroduce a synthetic source; a scope selection is a strict filter; `empty` ≠ `failure`; nothing auto-disabled; `cs3native://` for built-ins; a links handle is not a page address.
Persistence: whole-state returns (no deltas); a later load may add/correct but never blank; recordProgress keys on `canonicalKey`, never URL; automatic stores check `isPrivateSession()` at write time; datastore is debounced — flush at durability points; hydrate large stores lazily with every entry point calling the hydrator.
Process: sidecar stdout carries RPC frames only; all teardown on `before-quit`; nothing heavy at module scope; any third-party host goes through `electron/torrent/http.ts`; use `describeError`; stores' exceptions-not-members model for enable sets.
UI: never remount the `<video>`; Esc consumed only when it closed something; never name a `.ts` and `.tsx` alike but for case; key effects on serialised keys, not object identity; keep state in `App` where return-navigation must restore it.

## 5. Verification (what "done" means here)
| Check | Command (in `cs3_windows/`) | Note |
|---|---|---|
| Typecheck | `bun run typecheck` (`tsc -b`) | `bun run build`'s `tsc` is a no-op on the solution root |
| Unit tests | `bun run test --fast` (skips real ffmpeg/mpv); `bun run test <alias>`; `bun run test --list` | suites auto-discovered (`*.test.mts`) |
| Lint | `bunx oxlint` | no `lint` script on purpose |
| Sidecar | `mvn test` in `sidecar/` | |
| Live providers/links/metadata | `tools/e2e/*` | needs network; cloud containers usually block hosts |
| UI | `bun run dev` and use it | Electron cannot launch headless — say so if you could not |
Report honestly: "typechecks with `tsc -b`" is not "tested". Never state an Android-source claim unless the submodule is initialised.

## 6. Debugging workflow
Read [../debugging/overview.md](../debugging/overview.md) then the matching entry of [troubleshooting.md](../debugging/troubleshooting.md). Count the log before fixing; check the provisioned runtime before editing a shim.

## 7. Read before you change
| Area | Files |
|---|---|
| Streaming | `contentService.ts` (`discover`, `getSources`, `startStream`), `playbackSession.ts`, `media/playbackEngine.ts`, `media/decisionEngine.ts`, `mediaProxy.ts`, `components/VideoPlayer.tsx` |
| Providers | `pluginManager.ts` (`enabledProviderNames`, `ensureProviderActive`), `cs3/providerRegistry.ts`, `cs3/sidecarSupervisor.ts`, `docs/agents/extensions.md` |
| Search | `searchSession.ts`, `searchScope.ts`, `searchMerge.ts`, `cs3/sourceScope.ts` |
| Downloads | `downloadService.ts`, `download/resumePlan.ts`, `src/utils/downloadIdentity.ts` |
| Data | `datastore.ts`, `cs3/libraryStore.ts`, `cs3/backupSections.ts`, `cs3/privacyMode.ts` |
| Startup | `main.ts` (background tasks), `startupProfile.ts`, `util/startupQueue.ts` |

## 8. Known stale or unfinished areas (do not trust)
* `docs/PRD/33` (partially stale), PRD-39 (superseded), PRD-41 (proposed; not built), PRD-40.1 (`sourceLease`/`playbackTelemetry` not wired — verified: `wrapLease` has no callers).
* `docs/docs_cs3/android/*` describes the *Android* app, not this code.
* No CI exists; nothing runs tests but you. No code-signing certificate.
