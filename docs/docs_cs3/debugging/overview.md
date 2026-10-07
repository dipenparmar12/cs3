# Debugging Overview

## 1. Where evidence lives

| Evidence | Where | How to get it |
|---|---|---|
| Per-launch structured log | `<userData>/logs/` (NDJSON, one file per launch, rotated by size `.1`, `.2`…) | Help → **Open Log Folder**; `log:sessions/query/exportSession`; Settings → diagnostics |
| Failure tuples (provider, query, item, address) | `cs3-diagnostics.json` (`DiagnosticsLog`) | `CopyErrorButton` ("current" report vs full), `diagnostics:report` |
| Durable tally of distinct extension problems | `cs3-extension-issues.json` (`ExtensionIssueLog`) | Settings → Extension issues (`issues:list/annotate/report/clear`) |
| Sidecar stderr (plugin logs, JVM) | folded into the log with level/tag/cause (`sidecarStderr.ts`) | log query by `source` |
| Startup stages and main-thread stalls | `startupProfile.ts` | `app:getStartupProfile` → Settings → Advanced → Startup profile (Developer mode) |
| Per-attempt playback telemetry | `PlaybackEngine` records | `media:getPlaybackDiagnostics(sessionId?)`; Developer-mode overlays |
| Provider health / scores | `cs3-provider-analytics.json` | Settings → Provider ranking (`analytics:getLeaderboard`) |
| Provider internals (live) | `ProviderInspector` | **F12** (Developer mode) |
| Runtime state | `runtime:getStatus` | Settings → Setup & repair (reports `stale`) |
| Network reachability | `network:test` | Settings → Connection |

Turn on **Developer mode** (Settings → Advanced; a deliberately *basic* row) before debugging: it reveals the transformation
plan, swarm stats, ranking criteria, codecs, the full `repository ▸ extension ▸ provider` chain and original error text.
Developer mode is a renderer reveal; the data channels themselves are unconditional.

## 2. Method
1. **Classify the failure** with the shared taxonomy (`failureTaxonomy.classifyFailure`) — one closed cause set. Count the
   log first (grouping by cause turned 113 load failures into 6 missing classes).
2. **Decide which side owns it:** if the harness (`tools/e2e/provider-e2e.mjs`, no Electron) passes and the app doesn't, the bug is in
   `cs3_windows/`; if the harness fails, it is in the runtime or the extension.
3. **Trace the layer** with the table in [troubleshooting.md](troubleshooting.md).
4. **Check the runtime copy** before assuming a shim/bridge bug: compare `%APPDATA%/<app>/cs3-runtime/runtime/` against
   `sidecar/runtime/` and `runtime:getStatus` (`stale`).
5. Host-side reality is not a bug: expired signed URLs, hotlink 403s, dead swarms, DNS blocks and slow sites fail identically on Android.

## 3. Harnesses (live network; run deliberately)
| Command (repo root) | Answers |
|---|---|
| `node tools/e2e/provider-e2e.mjs [--repo X] [--only A,B] [--lane cs3]` | repository → download+SHA → translate → load → search → loadLinks → 2 MB range GET |
| `node tools/e2e/catalogue-e2e.mjs --installed netflix,prime` | provider `getMainPage` rows classified OK/MULTI/EMPTY/DROPPED/ERROR |
| `node --experimental-strip-types tools/e2e/native-engine-matrix.mjs` | can the engine put provider output on screen (real mpv, headless) |
| `node --experimental-strip-types tools/e2e/metadata-e2e.mjs` | do the keyless catalogues answer with the expected shape |
| `node tools/e2e/links-e2e.mjs --case "Provider=Title" --out l.json` then `electron … links-play.cjs l.json` | re-resolve a reported title and fetch each link via `net.fetch` (links expire in hours — re-resolve before judging) |
| `node tools/research/survey-repositories.mjs` | live repository/corpus counts |

Under a blocking proxy these report `FAIL` with the real reason, by design.

## 4. Traps worth knowing before you start
* `tsc` in `bun run build` typechecks nothing (solution-style root); use `bun run typecheck` (`tsc -b`).
* Electron cannot launch in a headless container; do not claim you ran the app unless you did.
* The renderer is a *copy* of nothing — but the **sidecar runtime is a provisioned copy** (see [../architecture/extensions.md](../architecture/extensions.md#4-the-stale-runtime-trap)).
* An unregistered IPC channel rejects (no `{ok:false}`) — check `ipcSurface` first for "button does nothing".
* A links handle is not a page address; a failing `load()` with a JSON-ish URL is our bug, not the provider's.
