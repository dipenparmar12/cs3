# AGENTS.md — CloudStream 3 Desktop

Context file for AI coding agents (Claude Code, Cursor, Copilot, etc.) working in this
repository. `CLAUDE.md` is a symlink to this file, so both names load the same content.

**Read this before searching the codebase.** It exists so you do not have to re-derive
the architecture, the naming, or the reasons behind the odd-looking decisions on every
session. If something here contradicts the code, **the code wins** — fix this file in the
same commit.

---

## 1. What this repository is

A **reverse-engineering and platform-migration project**: take the Android app
[CloudStream 3](https://github.com/recloudstream/cloudstream) (Kotlin, 4.8.0) and deliver
the same product as a **Windows-first Electron desktop app**, while keeping the existing
community extension ecosystem (`.cs3` plugin archives) working **without asking any
extension maintainer to do anything**.

That last commitment is the single most important constraint in the repo. It is why a JVM
sidecar exists, why there is a DEX→JVM translation spike, and why several designs that
would otherwise look over-engineered are the way they are.

Governing principle, from `docs/PRD/00-index.md`:

> The Android implementation defines the expected product behavior. The Electron
> implementation defines how that behavior is delivered on desktop.

Licensing: upstream CloudStream is **GPL-3.0**. Behave accordingly with derived code.

---

## 2. Repository map

```
cs3/
├── cs3_windows/      ← THE APP. Electron + React 19 + TypeScript + Vite 8. Most work happens here.
├── sidecar/          ← JVM (Java 21 / Maven) process that runs Android .cs3 extensions.
├── tools/dex-spike/  ← Throwaway-ish Maven harness that measured DEX→JVM translation across 392 real plugins.
├── docs/PRD/         ← 37 numbered specification documents. The reasoning behind everything.
├── docs/docs_cs3/    ← 9 documents describing the *Android* app's architecture (the source of truth being ported).
├── cloudstream_ref_android/  ← git submodule: upstream Android source (commit a72f9e6c…, v4.8.0).
└── repositories/     ← 26 git submodules: the vendored community extension corpus.
```

### Submodules are NOT checked out by default

`git submodule status` shows every entry prefixed with `-`. `cloudstream_ref_android/` and
`repositories/*` are **empty directories** in a fresh clone (including cloud/CI sessions).

- Do **not** claim you verified something against Android source unless you actually
  initialised the submodule.
- Do **not** run `git submodule update --init --recursive` casually — it clones 27
  repositories over SSH URLs (`git@github.com:…`), which usually fails without an SSH key
  and always eats a lot of disk in an ephemeral container.
- For Android-side questions, read `docs/docs_cs3/` and the file:line citations in
  `docs/PRD/` first. They were written from the real source and cite exact paths.

---

## 3. Build, run, test

| What | Where | Command |
|---|---|---|
| Install deps | `cs3_windows/` | `bun install` (lockfile is `bun.lock`; npm works but will churn it) |
| Dev app | `cs3_windows/` | `bun run dev` — Vite on :5173, `vite-plugin-electron` launches Electron and rebuilds main/preload on change |
| Typecheck + build | `cs3_windows/` | `bun run build` (`tsc && vite build`) |
| Package (Windows) | `cs3_windows/` | `bun run electron:build` → `release/` |
| Lint | `cs3_windows/` | `bunx oxlint` (oxlint is a devDependency; there is deliberately **no** `lint` script yet) |
| Sidecar build | `sidecar/` | `mvn package` → `target/cs3-sidecar.jar` + `target/lib/*` |
| Sidecar tests | `sidecar/` | `mvn test` (15 tests) |

Toolchain present in the cloud environment: Java 21, Maven, Bun, Node 22.

There is **no automated test suite for the Electron/React side** and no CI workflow
(`.github/` does not exist). `bun run build` — i.e. `tsc` passing — is the strongest
automated signal available. Say so plainly rather than implying tests passed.

**Electron cannot actually be launched in a headless cloud container.** Verify by
typechecking and by reading; do not report "I ran the app" unless you really did.

---

## 4. Architecture of `cs3_windows`

```
┌──────────────────────────── RENDERER (React 19, src/) ────────────────────────────┐
│ App.tsx · views/{Home,Search,Detail,Library,Settings} · components/VideoPlayer …  │
└───────────────────────────────────────┬───────────────────────────────────────────┘
                    contextBridge, allow-listed, typed  (electron/preload.ts)
┌───────────────────────────────────────┴───────────────────────────────────────────┐
│                          MAIN PROCESS (electron/main.ts)                          │
│   wires every service as a singleton and registers ~70 ipcMain.handle channels    │
└─┬──────────┬──────────────┬───────────────┬──────────────┬───────────────┬────────┘
  │          │              │               │              │               │
Datastore  Content       Plugin          Torrent        Download        Library
Manager    Service       Manager         Engine         Service         Store
  │          │              │               │              │
  │      Metadata/      Sidecar        WebTorrent      aria2c / yt-dlp
  │      Cinemeta       Supervisor     + loopback      (portable bins,
  │      + Indexer      ──► JVM         HTTP server     auto-downloaded)
  │        Registry        process
  └── cs3_datastore.json in app.getPath('userData')
```

### The IPC contract

`electron/preload.ts` is the **only** bridge. `contextIsolation: true`, `nodeIntegration:
false`. Channels are namespaced: `api:*`, `torrent:*`, `indexer:*`, `sources:*`,
`download:*`, `extension:*`, `library:*`, `datastore:*`, `binary:*`, `dialog:*`.

Fallible handlers return an **envelope**, `{ ok: boolean; error?: string; …payload }`,
instead of rejecting. `main.ts` has a `fail()` helper for this. A transport failure must
surface as UI text the user can act on, never an unhandled rejection in the renderer.

**When you add a feature that crosses the boundary, all four of these change together:**
1. the service in `electron/`,
2. `ipcMain.handle('ns:name', …)` in `electron/main.ts`,
3. the method + its type in `CloudStreamElectronAPI` in `electron/preload.ts`,
4. the caller in `src/`.

Shared types live in `cs3_windows/src/types/{api,plugin,torrent,download,player}.ts` and
are imported by **both** sides — `electron/` importing from `../src/types/` is intentional,
not a layering mistake.

### Services you will actually touch (`cs3_windows/electron/`)

| File | Responsibility |
|---|---|
| `main.ts` | Window, lifecycle, service wiring, every IPC handler. |
| `preload.ts` | The typed API surface. |
| `datastore.ts` | Persistence. Reimplements **Android's 6-bucket key grammar** (`_Bool`/`_Int`/`_String`/`_Float`/`_Long`/`_StringSet`) so Android backups import losslessly. Non-transferable keys (tokens, device ids, cache paths) are filtered on import by regex. |
| `contentService.ts` | The content pipeline orchestrator: `search → MetadataProvider → getSources → IndexerRegistry → startStream → TorrentEngine`. Extension providers are consulted first when runnable; torrents are today's working fallback. |
| `metadataProvider.ts` | TVmaze + AniList. **Catalogue metadata only, never streams.** Its key output is the IMDb id, which indexers match on far better than free text. |
| `cinemeta.ts` | Stremio Cinemeta metadata provider, prioritised in search. |
| `pluginManager.ts` | `.cs3` repository discovery, plugin-list parsing (mirrors upstream `RepositoryManager.kt`), download + SHA-256 verification, Android-style install paths, then hands archives to the sidecar. |
| `pluginAnalyzer.ts` | Static compatibility classification of a plugin before it is trusted. |
| `cs3/sidecarSupervisor.ts` | Spawns and supervises the JVM child process; line-delimited JSON-RPC over stdio; never throws on a missing/broken sidecar. |
| `cs3/extensionUpdater.ts` | Over-the-air extension updates on a schedule, so a provider fix does not wait for an app release. |
| `cs3/batchDownloader.ts` | Season/series batch download orchestration. |
| `cs3/libraryStore.ts` | Watch state, resume progress, library buckets, and remembered source choices. |
| `torrent/torrentEngine.ts` | WebTorrent + loopback HTTP server with range support. Sequential pieces; the player only ever sees `http://127.0.0.1:PORT/…`. |
| `torrent/indexerRegistry.ts`, `indexers/*` | 7 built-in public indexers, Torznab (Jackett/Prowlarr), and aggregators (Torrentio, apibay). |
| `torrent/ranker.ts`, `releaseParser.ts` | Release-name parsing (quality/codec/group/season/episode) and result ranking. |
| `downloadService.ts`, `aria2Engine.ts`, `ytdlpEngine.ts`, `binaryDownloader.ts` | Downloads via aria2c RPC with an HTTP fallback; portable `aria2c`/`yt-dlp` binaries are fetched on first use. |

Two behaviours in `torrentEngine.ts` are load-bearing and easy to break:
**file selection inside season packs** (deselect all, select one, or swarm bandwidth is
split across ten episodes and nothing becomes playable) and **leading-bytes readiness**
(playability is measured as contiguous leading pieces — the container header lives at the
start of the file — not as overall percent complete).

---

## 5. The `.cs3` extension story (the part that surprises people)

`.cs3` files are ZIP archives of **Android DEX bytecode** compiled against upstream's
Kotlin provider API. Node and V8 cannot run them, at any configuration. That is not a
barrier to *desktop* though, only to *JavaScript runtimes* — so:

1. `sidecar/` is a **separate JVM OS process** (not a thread, not a worker). A plugin that
   hangs, exhausts memory, or calls `System.exit` must degrade to "provider unavailable",
   not take the app down. Process boundaries give that unconditionally.
2. `DexTranslator` converts DEX → JVM bytecode via **dex2jar 2.4.38**, once at install
   time, cached by archive SHA-256. The original `.cs3` is never modified.
3. `LinkageAnalyzer` resolves every referenced type against the runtime classpath and
   assigns a compatibility tier (`T1`…`T4_BLOCKED`).
4. `PluginHost` reproduces Android's load sequence exactly: read `manifest.json` *through
   the class loader*, `loadClass` the entry, construct reflectively, call `load(context)`,
   observe self-registration.
5. `sidecar/src/main/java/android/**` are **hand-written stubs** of the Android APIs
   plugins actually use — `Log`, `Base64`, `Context`, `SharedPreferences`. A survey of the
   corpus found 67.6% of providers import no `android.*` at all, and those five classes
   cover ~93% of the rest.

**Translation risk was measured, not assumed.** Against all 392 real community plugins:
392 translated, 18,217 classes emitted, 0 verification failures, 6,617 Kotlin coroutine
state machines, 0 failures — see `docs/PRD/35`, reproducible via `tools/dex-spike/`.

### The current, honest limitation — do not paper over it

Plugins link against `library-jvm.jar` (upstream's `MainAPI`, `ExtractorApi`, `Plugin`),
published **only via JitPack**, not Maven Central. Until that jar is on the sidecar's
runtime classpath:

- `inspect` works, every plugin classifies as `T4_BLOCKED` naming
  `com.lagradost.cloudstream3.plugins.BasePlugin`, and `status` explains exactly why.
- Even with the jar present, *calling* a provider is unimplemented work: the API is Kotlin
  `suspend` functions with `Function1` callbacks, which plain Java reflection cannot invoke
  usefully. `docs/PRD/36` sequences that work honestly ("step 1 is a day; steps 2–5 are the
  actual work").

An earlier revision of this app registered installed plugins as fake providers backed by a
metadata API and a **hardcoded demo video**. That was removed deliberately, and the
codebase now carries comments saying so. **Never reintroduce a synthetic/placeholder
source.** When nothing real is found, return an empty list *and a reason*. A system that
cannot run must say so, not return empty results dressed up as "no matches found".

### Sandbox: enforced vs. not

Enforced — plugin cannot reach sidecar internals (`PluginClassLoader`, tested);
`System.exit` cannot kill the app (process boundary); `System.loadLibrary` blocked via
empty `java.library.path`; per-plugin scoped storage.
**Not enforced** — raw network egress, process creation. Both need an OS-level sandbox
(Windows job object + restricted token). They are reported by `status` as `sandboxGaps`
and surfaced in the UI on purpose: a named gap can be closed; an implied-covered gap never
gets fixed. Java's `SecurityManager` is not an option (JEP 411/486 removal).

---

## 6. Documentation: what to trust

- `docs/PRD/00-index.md` — start here. Analysis baseline, the five findings (F-1…F-5) that
  shape scope and cost.
- `docs/PRD/31-cs3-dropin-compatibility.md` — the drop-in commitment and ADR-10.
- `docs/PRD/33-cs3-desktop-current-architecture-and-implementation.md` — desktop
  as-built. **Partially stale**: it references `electron/cs3ArchiveLoader.ts` and
  `electron/jvmProviderBridge.ts`, which do not exist; that role is now
  `cs3/sidecarSupervisor.ts` + the sidecar. It also contains absolute `D:\dipen\cs3\…`
  paths from the author's Windows machine.
- `docs/PRD/34` torrent architecture · `35` translation spike results · `36` the remaining
  work to actually execute providers.
- `docs/docs_cs3/` — the Android app's architecture, 9 documents, written from source.

Requirement ids appear throughout code comments — `ARCH-2`, `SEC-7`, `DROP-12`, `DSK-57`,
`AC-D4`, `RISK-D1`. They resolve inside `docs/PRD/`. Grep the id when a comment cites one;
it will explain the constraint rather than the mechanism.

Rule of thumb: **PRD documents describe intent and reasoning; the code describes reality.**
Where they disagree, trust the code and fix the doc.

---

## 7. Conventions

- **Commits**: Conventional Commits with a scope drawn from the area —
  `feat(library): …`, `feat(cs3): …`, `feat(torrent): …`, `feat(player): …`,
  `docs: …`, `chore(cs3_windows): …`.
- **Comments explain *why*, not *what*.** This codebase's comments are unusually dense with
  rationale (why a dep is external, why the sidecar is a process, why file selection
  matters). Match that register. Do not add narration of what the next line obviously does.
- **TypeScript, `strict`.** Avoid `any`; the existing handful of `any`s are in IPC
  plumbing, not a licence to add more.
- **Never bundle main-process runtime deps.** `vite.config.ts` externalises everything in
  `dependencies` plus node builtins in both bare and `node:` spellings. `webtorrent` pulls
  native `.node` binaries (`node-datachannel`, `utp-native`) that cannot exist in a JS
  bundle and must also be `asarUnpack`-ed for packaging.
- **External links open in the system browser**, never in-app (`setWindowOpenHandler`).
- **Shutdown is explicit**: `downloadService.stop()`, `extensionUpdater.stop()`,
  `pluginManager.shutdown()` (kills the JVM — otherwise you orphan a Java process), and
  `torrentEngine.destroy()` on `before-quit` (otherwise: zombie process, locked cache dir).
  If you add a service that owns a socket, file handle, timer, or child process, wire it
  into these paths.
- **stdout of the sidecar carries RPC frames and nothing else.** A stray `println` from
  plugin code desynchronises the channel, so plugin logs, JVM warnings, and stack traces
  are forced to stderr. Keep it that way.

---

## 8. Working agreements for agents

- **Branching**: cloud/agent sessions develop on their assigned `claude/*` branch and push
  there. Never push to `master` directly. Do not open a PR unless asked.
- **Scope**: this repo has a lot of aspirational documentation. Implement what was asked;
  do not start on `docs/PRD/36` step 4 because you read about it here.
- **Do not vendor or commit** `.cs3` archives, `library-jvm.jar`, `node_modules/`,
  `target/`, `dist/`, `dist-electron/`, or downloaded `aria2c`/`yt-dlp` binaries.
  (`.gitignore` at root covers `target/`; `cs3_windows/.gitignore` covers the rest.
  `dist-electron/` is currently tracked — leave that alone unless asked.)
- **Report honestly.** "Typechecks with `bun run build`" is a true claim. "Tested" is not,
  unless you ran `mvn test` or actually exercised the path. Legal/ecosystem context here
  (GPL-3.0, third-party indexers, community plugin code) makes overclaiming expensive.
- **Keep this file current.** If you change the IPC surface, add a service, move the
  sidecar contract, or discover that a section above is wrong — update it in the same
  commit. This file is the reason the next agent does not have to repeat your exploration.
