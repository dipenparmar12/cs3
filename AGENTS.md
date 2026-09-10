# AGENTS.md — CloudStream 3 Desktop

Context file for AI coding agents working in this repository. `CLAUDE.md` is a symlink to
this file; both names load the same content.

**Read this before searching the codebase.** If something here contradicts the code, **the
code wins** — fix this file in the same commit.

---

## 1. What this repository is

A **reverse-engineering and platform-migration project**: port the Android app
[CloudStream 3](https://github.com/recloudstream/cloudstream) (Kotlin, 4.8.0) to a
**Windows-first Electron desktop app**, keeping the existing community `.cs3` extension
ecosystem working **without asking any extension maintainer to do anything**. This is the
single most important constraint in the repo — it is why a JVM sidecar exists, why there is
a DEX→JVM translation layer, and why several apparently over-engineered designs exist.

Governing principle (`docs/PRD/00-index.md`):
> The Android implementation defines the expected product behavior. The Electron
> implementation defines how that behavior is delivered on desktop.

Licensing: upstream CloudStream is **GPL-3.0**. Behave accordingly with derived code.

---

## 2. Repository map

```
cs3/
├── cs3_windows/      ← THE APP. Electron + React 19 + TypeScript + Vite 8. Most work here.
├── sidecar/          ← JVM (Java 21 / Maven) process that runs Android .cs3 extensions.
├── tools/dex-spike/  ← Maven harness that measured DEX→JVM translation across 392 real plugins.
├── docs/PRD/         ← 37+ numbered spec documents — the reasoning behind everything.
├── docs/docs_cs3/    ← 9 documents on the *Android* app's architecture (source of truth).
└── repositories/     ← 26 git submodules: vendored community extension corpus.
    └── _cloudstream_ref_android/  ← submodule: upstream Android source (a72f9e6c…, v4.8.0).
```

### Submodules are NOT checked out by default
`git submodule status` shows every entry prefixed `-`. `_cloudstream_ref_android/` and
`repositories/*` are **empty** in a fresh clone (incl. cloud/CI).
- Do not claim you verified something against Android source unless you initialised the submodule.
- Do not run `git submodule update --init --recursive` casually — clones 27 repos over SSH, usually fails without a key, eats disk.
- For Android-side questions read `docs/docs_cs3/` and file:line citations in `docs/PRD/` first.

---

## 3. Build, run, test

| What | Where | Command |
|---|---|---|
| Install deps | `cs3_windows/` | `bun install` (lockfile `bun.lock`; npm works but churns it) |
| Dev app | `cs3_windows/` | `bun run dev` — Vite :5173, `vite-plugin-electron` launches Electron, rebuilds main/preload |
| Typecheck + build | `cs3_windows/` | `bun run build` (`tsc && vite build`) |
| Bundle the JVM | repo root | `node tools/package/build-runtime.mjs --verify` → `sidecar/dist/` |
| Bundle ffmpeg + mpv | repo root | `node tools/package/build-media-runtime.mjs --verify` → `cs3_windows/media-runtime/` |
| **Ship it (Windows)** | `cs3_windows/` | **`bun run dist:win`** → `release/`; `dist:win:fast` reuses existing jars |
| Package, lower level | `cs3_windows/` | `bun run electron:build` → `release/` (assumes Maven already run) |
| Lint | `cs3_windows/` | `bunx oxlint` (devDependency; deliberately no `lint` script) |
| Typecheck only | `cs3_windows/` | `bun run typecheck` (`tsc -b` — see warning below) |
| Sidecar build | `sidecar/` | `mvn package` → `target/cs3-sidecar.jar` + `target/lib/*` + android shim into `runtime/` |
| Sidecar tests | `sidecar/` | `mvn test` (47 tests) |
| Main-process tests (all) | `cs3_windows/` | `bun run test` (57 suites; the runner reports suites, not a case total) or `bun run test:electron` |
| Fast unit tests | `cs3_windows/` | `bun run test --fast` (55 suites, ~13s) |
| Named suites | `cs3_windows/` | `bun run test <name>`: `errors`(8) `resume-point`(10) `libraryStore`(7) `issues`(21) `registry`(9) `recovery`(12) `torrent-contents`(24) `sidecar-log`(20) `cache`(10) `links`(15) `webview`(21) `torrent-metadata`(28) `source-scope`(17) `ott`(19) `native-providers`(50) `resume`(17) `resume-window`(10) `reachability`(2) `settings-level`(6) `dead-rows`(8) `proxy`(11) `subtitles`(16) `media`(71) `pipeline`(17, real ffmpeg) `export`(13) `direct-sources`(13) `ytdlp`(16) `repositories`(9) `download-identity`(18) `native`(12, real mpv) `ipc` `pageSnapshot`(12) `savedPage`(8) `sourceScopeModel`(5) `searchOrder`(5) `extensionUpdater`(8) `playback-recovery`(16) `indexer-budget`(22) `bot-challenge`(17) `source-profiles`(30) `failure-taxonomy`(12) `provider-health`(12) `host-deadline`(10) |
| Repository/corpus liveness | repo root | `node tools/research/survey-repositories.mjs` (PRD-43) |
| Provider end-to-end | repo root | `node tools/e2e/provider-e2e.mjs` — §5.1 |
| Vendor stream matrix | repo root | `node --experimental-strip-types tools/e2e/native-engine-matrix.mjs` — §5.2 |
| Plugin runtime classpath | repo root | `mvn -f sidecar/runtime-deps/pom.xml package` → `sidecar/runtime/` (56 jars incl. `library-jvm-4.8.0.jar`) |
| Provider bridge (Kotlin) | repo root | `mvn -f sidecar/bridge/pom.xml package` → `sidecar/runtime/cs3-provider-bridge.jar` |
| Provider bridge, no JitPack | repo root | `node tools/package/build-bridge.mjs` — same jar, built against `sidecar/runtime/` |

### The one command that produces a distributable
`tools/package/build-installer.mjs` = `bun run dist:win`. Order matters and skipping a step
fails silently: `build-runtime.mjs` verifies what Maven produced rather than running Maven,
so a package built without the sidecar step installs fine with **zero extension capability**
and nothing says so.

```
bun run dist:win           # everything, Maven to two .exe files
bun run dist:win:fast      # reuse jars/staging that exist
bun run dist:installer     # NSIS setup only
bun run dist:portable      # portable exe only
```
Order: preflight (Node 20+, Java 21+ preferring `tools/toolchain/jdk-*` over `JAVA_HOME`,
`node_modules`) → `sidecar/pom.xml` → `runtime-deps` → bridge → `build-runtime.mjs --verify`
→ `build-media-runtime.mjs --verify` → `tsc -b` → `vite build` → `electron-builder --win nsis portable`.

Non-obvious details:
- **Bridge falls back to `build-bridge.mjs`** when Maven fails — `library-jvm` is jitpack-only and blocked egress 403s the POM before compiling any Kotlin. Fallback is for the network, not the build.
- **`shell: true` only where a `.cmd` shim needs it.** cmd.exe splits unquoted paths on spaces (`C:\Program Files\nodejs\node.exe` → `C:\Program`). Local dev executables are probed across spellings (`tsc.exe` vs `tsc.cmd`, bun vs npm).
- **Built CSS is grepped for `https://fonts.`** before packaging (Inter is vendored; a re-added `@import` would silently undo that).

Four packaging bugs found the hard way:
- **electron-builder 26 rejects unknown config keys** (`"//comment"` in `package.json`'s `build`). Config now lives in **`cs3_windows/electron-builder.yml`** (comments allowed); no `build` field in `package.json`.
- **`npmRebuild: false`.** `@electron/rebuild` failed node-gyp on `bufferutil` (no VS) rebuilding a module that already ships `prebuilds/win32-x64`. All native deps here are N-API (`node-datachannel` `napi_versions [8]`; `utp-native`, `bufferutil`, `utf-8-validate` ship win32-x64 prebuilds) and N-API is ABI-stable across Node/Electron. **If a non-N-API native dep is ever added, set this back to `true`** and the build machine needs a C++ toolchain.
- **A running `bun run dev` fails the package** with `EPERM … rename win-unpacked.tmp -> win-unpacked` — Vite watches `cs3_windows` recursively and holds a directory handle electron-builder needs to rename. `vite.config.ts` ignores `release/`, `media-runtime/`, `dist-electron/`; the installer script clears stale `*.tmp` first.
- **`tar` on PATH ≠ the `tar` that reads 7z.** mpv ships as `.7z`; GNU tar (from Git) can't open it. Windows' own `System32\tar.exe` (libarchive) can, and is now named explicitly.

**Measured 2026-08-29**, `bun run dist:win:fast`, 158s: `CloudStream-Desktop-1.0.0-x64-setup.exe` 271.9 MB, `…-portable.exe` 271.7 MB. Verify `release/win-unpacked/resources/`: `media/` has ffmpeg/ffprobe/mpv; `sidecar/` has `cs3-sidecar.jar` + jlinked JRE + 58 runtime jars — a package missing either installs/launches fine and runs no extension.

`--skip-jvm` / `--skip-media` exist for fast UI iteration; both warn in the final report.

**NSIS**: `oneClick: false`, `perMachine: false` (per-user install, no admin/UAC). Portable target writes userData beside the exe (USB-portable). Both x64-only (ia32 can't load webtorrent's native `.node` binaries). **No code-signing cert** — SmartScreen will warn; this is a purchase, not a build flag. No `.ico` in repo — default Electron icon.

On a fresh clone run sidecar build → runtime-deps → bridge, **in that order** (sidecar produces the android shim the bridge compiles against; runtime-deps puts `library-jvm` in place).

**Bridge needs jitpack.io** (blocked in some cloud sessions — 403 on a POM before any Kotlin compiles). Jars are vendored in `sidecar/runtime/`; `tools/package/build-bridge.mjs` compiles the bridge against that directory with `kotlin-compiler-embeddable` (resolves from Central) + `jar`. Two non-obvious costs: the Kotlin compiler is itself compiled Kotlin needing `kotlin-stdlib`, `kotlin-reflect`, `kotlin-script-runtime`, `kotlin-daemon-embeddable`, `trove4j`, coroutines, **and `annotations-13.0`** on its own classpath (codegen resolves `@Nullable` from there); and the **previous** `cs3-provider-bridge.jar` must be excluded from the compile classpath or sources compile against last build's copy of themselves.

**Sidecar needs Java 21+** (class file 65). `SidecarSupervisor.resolveJava` looks in `tools/toolchain/jdk-*` before PATH (fixed 2026-08-13 — previously any JAVA_HOME on Java 17 silently broke everything). Maven for sidecar builds lives in `tools/toolchain/apache-maven-3.9.16`, also not on PATH.

**A sidecar that cannot start must say so.** `ensureProvidersLoaded` used to silently `return` on a failed `ensureStarted()`, producing an infinite "initializing providers…" spinner. It now writes a `T4_BLOCKED` runtime report naming the cause to every plugin. Never add another silent early return on this path.

Cloud environment toolchain: Java 21, Maven, Bun, Node 22.

**Almost no automated tests for Electron/React**, no CI (`.github/` absent). Exceptions:
`electron/sharedDiscovery.test.mts` and the two media suites under `electron/media/`, run by
`bun run test:electron` — Node strips types itself (`erasableSyntaxOnly`), no framework/transform.
`.mts` is in `tsconfig.node.json`'s `include` so tests are typechecked too. These earn tests
because `sharedDiscovery` failures are invisible (doubled scrape ≈ slow provider) and the media
suites' inputs are expensive to reproduce (25GB file behind an expired link) while a regression
is silent (`-c:v copy` on 10-bit HEVC → MP4 that downloads fine, plays nothing).

Note `.ts` extensions on imports inside `electron/media/` — load-bearing: Node's type-stripping
ESM loader won't resolve extensionless specifiers (`allowImportingTsExtensions` set in both tsconfigs).

**`tsc` in `bun run build` typechecks nothing** — root `tsconfig.json` is solution-style
(`"files": []` + two `references`), and plain `tsc` on that is a no-op. Use **`tsc -b`** (or
`-p tsconfig.app.json` / `-p tsconfig.node.json`). Say "typechecks with `tsc -b`", not "tested".

**Electron cannot be launched in a headless cloud container.** Verify by typechecking/reading; don't claim "I ran the app" unless you did.

### The runtime the app runs is not the one you just built
`RuntimeProvisioner` copies sidecar + provider runtime into `%APPDATA%/<app>/cs3-runtime/` and
resolves that copy **before** every build location — this decouples an installed app from its
build location, and is the single most expensive trap in the repo:
- `provisionRuntime()` used to ask `findRuntimeDir()` where to copy *from*, which answers with the app-managed copy first, then skipped the copy as "already there". First provision was the last.
- Result: installed apps kept serving the shim/bridge they were first installed with. One report: `NoClassDefFoundError` for `DataStore`, `android/net/Uri`, `AppCompatActivity`, `DialogFragment`, `FragmentManager` — all classes shipped weeks earlier. 5 of 8 failing extensions were this bug alone.

Three fixes, all matter:
1. **The copy carries a stamp** (`runtime-stamp.json`: generation + fingerprint of every jar's name/size/mtime). `getStatus()` reports `stale` separately from `ready`.
2. **Provisioning reads from build locations only** (`findSourceComponents`), picks **newest** not first — `sidecar/dist/` is generated *from* `sidecar/runtime/` and goes stale the moment Maven runs again.
3. **Translations drop when the sidecar changes.** DEX→JVM output is cached by archive hash alone; an absent stamp counts as changed.

**Bump `RUNTIME_GENERATION`** whenever shim/bridge/translator changes in a way an already-provisioned copy would get wrong. Debugging "class that should exist doesn't"? Check `%APPDATA%/<app>/cs3-runtime/runtime/` against `sidecar/runtime/` first.

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
`electron/preload.ts` is the **only** bridge. `contextIsolation: true`, `nodeIntegration: false`.
Namespaces: `api:*`, `torrent:*`, `playback:*`, `indexer:*`, `sources:*`, `download:*`,
`extension:*`, `library:*`, `datastore:*`, `binary:*`, `dialog:*`, `pages:*`.

- **`playback:*`** push-shaped: `playback:start` returns a session id immediately; updates arrive as `playback:update` snapshots. Player renders from snapshots before a stream exists.
- **`search:*`** push-shaped for the same reason: `search:start` returns an opening snapshot; results/progress arrive as `search:update`; `search:cancel` abandons the rest. A search across 15 providers is 15 independent scrapes (measured: Cinevood 20s timeout, ARD 350ms) — request/response would spend the whole time on a spinner. `api:searchAll` remains for callers needing a full answer. Required breaking up `PluginManager.searchAll`'s single batched RPC (reply landed at slowest-provider speed) into one RPC per provider (`searchEach`), capped at 8 in flight (sidecar dispatches onto a core-sized bounded pool).
- **`natives:*`** built-in provider roster — `natives:list/setEnabled/addAddon/removeAddon` (Stremio addons by manifest URL), `natives:addServer/removeServer` (Jellyfin/Emby; `addServer` takes a key, never returns one). Separate from `extension:*` (which is an inventory of *downloaded* things — repos/archives/hashes/tiers) because a compiled-in provider has no repository. See "native provider lane" below.
- **`ott:*`** — `ott:listPlatforms/getCatalog/getCatalogPage/getSearchScope/getSuggestions/installSuggestion`. Answers "can I watch Netflix?" keyed by platform, always listing every platform with reachability. **`ott:installSuggestion` takes a repository id, never a URL** — accepting a URL from the renderer would let "set up Netflix" install arbitrary code.
- `window:setAlwaysOnTop/getAlwaysOnTop` pins the app window; `mpv:setOnTop`/`mpv:setVideoEnabled` do the same for mpv's own window (see "Floating playback").
- Also: `analytics:*`, `bookmarks:*`, `discover:*`, `subtitles:*`, `sources:getCacheStats/clearCache`.
- **`issues:*`** — `issues:list/annotate/report/clear`: the extension issue ledger, deliberately a third surface beside `log:*`/`diagnostics:*` (see §5, "Counting the log").
- **`profiles:*`** — `profiles:list/activate/create/rename/duplicate/delete`: named search configurations. Every one answers with the **whole** state (list + active id + unnamed draft), like `disabledSet.ts` returns the whole list — those three have to agree and rebuilding them from a delta is how they stop agreeing. **Profiles sit above `SearchScopeStore`, not beside it**: each change resolves to the same `SearchScope` the five scope-reading paths already use and writes it through, so nothing downstream learns profiles exist. `search:setScope` routes through the profile layer for the same reason.
- **`download:preview`** answers where a download would land and what the press would do, read-only — the renderer cannot compute the path (folder layout, variant segment and collision suffix are decided from the whole queue). `download:get/setConfirmPreference` (`ask`|`immediate`, default **`immediate`**) gates the confirmation dialog.
- **`extension:getAdultMode/setAdultMode/unlockAdultForSession/lockAdultForSession`** — the three-state gate. `mode` is the setting, `allowed` is whether adult providers are offered *right now*; under `ask` those differ. **The unlock is in-memory only and never persisted** — one that survived a restart would make `ask` into `on` with extra steps — and `unlockAdultForSession` refuses unless the mode is already `ask`, so a renderer cannot use it to change the setting.
- **`pages:*`** — `pages:getSnapshot/remember/setPinned`: the stored copy of a detail page. Deliberately read-shaped, unlike `search:*`/`playback:*` — the answer is already on disk and the caller wants it in the tick it decides to render. **Capture is not exposed**; it happens in `ContentService.load`, the one funnel every detail load passes through and the only side that knows a provider's ancestry.
- **`extension:addRepository`** and **`installRepository`** are deliberately two actions (fetch+persist vs. tens of downloads/translations).
- **`media:*`** — `media:inspect` classifies without starting; `media:prepare` inspects-decides-opens, the only source of a playable URL; `media:switchAudio/closeStream` drive a live session; `media:setCapabilities/getCodecProbes` carry renderer-measured decoder support; `media:getPlaybackDiagnostics` returns per-attempt telemetry. **No channel hands back an unclassified URL.** `media:prepare` also takes provider-declared `isDash`/`drm`, which outrank the probe — DRM in particular skips the probe entirely (ffprobe succeeds with correct codec names over undecodable encrypted payload).
- `external:*` drives a handed-off player, pushes `external:update` with a `capability` flag. `player:getPreferences/setPreferences` hold volume/mute/speed/track languages. `download:getDeletePreference/setDeletePreference`. `extension:rollback` restores a replaced archive.
- **`download:request`** (button press — reads task state, resumes/recovers/refuses, reports which) vs **`download:enqueue`** (explicit "create this task").
- **`mpv:*`** — `mpv:open` (prepared URL only), transport/track controls, `mpv:update` snapshots, `mpv:getPolicy/setPolicy`. No raw-link channel, same reasoning as `media:*`.
- Fallible handlers return an **envelope** `{ ok, error?, …payload }` (never reject) via `main.ts`'s `fail()` helper.

**When crossing the IPC boundary, four things change together:** 1) service in `electron/`, 2) `ipcMain.handle('ns:name', …)` in `main.ts`, 3) method+type in `CloudStreamElectronAPI` in `preload.ts`, 4) caller in `src/`. Shared types: `cs3_windows/src/types/{api,plugin,torrent,download,player}.ts`, imported by both sides (intentional, not a layering mistake).

### Services (`cs3_windows/electron/`)

| File | Responsibility |
|---|---|
| `main.ts` | Window, lifecycle, service wiring, every IPC handler. |
| `preload.ts` | The typed API surface. |
| `datastore.ts` | Reimplements Android's 6-bucket key grammar (`_Bool/_Int/_String/_Float/_Long/_StringSet`) for lossless Android backup import. Non-transferable keys filtered on import by regex. |
| `contentService.ts` | `search → MetadataProvider → getSources → IndexerRegistry → startStream → TorrentEngine`. Extension providers first, torrents fallback. `cs3ext://` bypasses indexers. |
| `playbackSession.ts` | One "Play" interaction; opens the player before a stream exists, streams discovery into it; owns in-player switching/refresh via retained `SourceQuery`. |
| `searchScope.ts` | Which sources a search may ask — a selection is a strict filter, not a preference. |
| `searchSession.ts` | One "Search" interaction; push-shaped, fans out per source, cancellable. |
| `searchSuggestions.ts` | Autocomplete merged Cinemeta + TVmaze + AniList, deduped, misspelling-tolerant. |
| `searchHistory.ts` | Past search *queries* only (not results — stale silently). |
| `sourceCache.ts` | Per-source expiry: magnets never expire; provider links carry a deadline from the URL (`Expires`/`exp`/JWT) or a short TTL. |
| `subtitleService.ts` | Keyless OpenSubtitles v3 Stremio addon by IMDb id; SubRip→WebVTT is mandatory (`<track>` rejects `.srt` silently). |
| `media/mediaInspector.ts` | ffprobe → `MediaMetadata`; transport/DRM from manifest body, never URL. |
| `media/decisionEngine.ts` | Pure: metadata+capability+DRM → `TransformationPlan`. |
| `media/playbackEngine.ts` | Inspect→decide→open; the only source of a URL; owns telemetry. |
| `media/mpvEngine.ts` | Native engine: spawns mpv, JSON-RPC, snapshots. |
| `mediaTranscoder.ts` | Executes a plan as live fragmented-MP4 on loopback; embedded-subtitle extraction. |
| `metadataProvider.ts` | TVmaze + AniList — catalogue metadata only, never streams. Key output: IMDb id. |
| `cinemeta.ts` | Stremio Cinemeta metadata provider, prioritised in search. |
| `pluginManager.ts` | `.cs3` repo discovery, plugin-list parsing, download+SHA-256, install paths, hands archives to sidecar; owns the enable/disable cascade. |
| `cs3/providerLinks.ts` | Reads a provider's reply without guessing: link type, DRM, playlist parts, audio headers. |
| `pluginAnalyzer.ts` | Static compatibility tiering before trust. |
| `cs3/sidecarSupervisor.ts` | Spawns/supervises the JVM process; line-delimited JSON-RPC over stdio; never throws on a broken sidecar; routes reverse frames (see `webViewHost.ts`). |
| `cs3/webViewHost.ts` | Offscreen `BrowserWindow` per resolve; `webRequest` watching; cookies harvested for `CloudflareKiller`. |
| `cs3/webViewMatch.ts` | What a page's subrequests mean. Pure, tested. |
| `cs3/hostDeadline.ts` | How long the host may work on a call the sidecar is waiting on. Pure, tested; **the worker stops before the waiter does**. |
| `cs3/extensionUpdater.ts` | Scheduled OTA extension updates. |
| `cs3/bootstrap.ts` | First-run bundled-repo install + adult-content opt-in. |
| `cs3/diagnostics.ts` | Provider failures with reproducible context. |
| `cs3/extensionIssues.ts` | Durable tally of distinct extension problems across restarts/rotation. |
| `cs3/providerRegistry.ts` | What each archive registered, keyed by size+mtime+generation; hydrates provider list without starting the JVM (57–67s→8ms fix). |
| `cs3/providerRecovery.ts` | `planRecovery` (pure) — ordered steps to make a saved page's provider answer again; never adds an unknown repository. |
| `cs3/titleOutcomes.ts` | Last-behaviour-per-title so dead rows aren't reclicked. |
| `cs3/ottPlatforms.ts` | OTT platform table + name-matching rule. Pure, tested. |
| `cs3/nativeProviderRegistry.ts` | Compiled-in provider roster; mirrors `enabledProviderNames` (adult gate + disable cascade). |
| `cs3/nativeProviders/types.ts` | `NativeProvider` interface, `cs3native://` addressing. |
| `cs3/nativeProviders/internetArchive.ts` | ~52,000 public-domain films/TV. |
| `cs3/nativeProviders/peerTube.ts` | Federated video via SepiaSearch; files live on their own instance. |
| `cs3/nativeProviders/iptvOrg.ts` | 17,230 free-to-air streams; ~70% answer. |
| `cs3/nativeProviders/stremioAddon.ts` | Any Stremio addon by manifest URL; `idPrefixes` is a hard constraint. |
| `cs3/nativeProviders/jellyfin.ts` | User's own Jellyfin/Emby; key travels as a header, never reaches renderer. |
| `cs3/ottService.ts` | Platform table × what's installed: availability, search scope, install offers. |
| `download/resumePlan.ts` | Pure decision: does a partial survive a link swap. |
| `download/resumeWindow.ts` | 64KB boundary probe: range support + real length + byte compare, one request. |
| `cs3/batchDownloader.ts` | Season/series batch orchestration. |
| `cs3/libraryStore.ts` | Watch state, resume progress, library buckets, remembered source choices. |
| `cs3/bookmarkStore.ts` | Saved detail pages (provider/extension/repo/query) — not the library (that keys on normalised title). |
| `cs3/pageSnapshot.ts` | Last-known-good copy of every detail page opened, plus its routes and origin — so a saved page never opens blank. |
| `cs3/searchOrder.ts` | Which provider the fan-out asks first; refuses any ordering that is not the same set. |
| `cs3/sourceProfiles.ts` | Named search configurations — the state machine. Pure, tested. **All sources is a mode, not an erasure.** |
| `cs3/sourceProfileStore.ts` | Persists profiles and writes the effective scope through to `SearchScopeStore`. Profiles sit *above* scope; nothing downstream knows they exist. |
| `cs3/providerAnalytics.ts` | Behaviour counts, aggregates only (no queries/titles/history). `empty` tracked separately from `failure`. |
| `cs3/providerRanking.ts` | Weighted scoring, criteria as table rows; `null` excluded from denominator, not scored zero; rates smoothed toward neutral prior. |
| `cs3/providerRecommendations.ts` | Scores → advice/action (`autoEnableProven`). Never auto-disables. |
| `cs3/failureTaxonomy.ts` | `classifyFailure` — one closed cause set shared by ranking/diagnostics/ledger; also `groupingForm` and **`UNSCORED_FAILURE_KINDS`**. |
| `cs3/sidecarStderr.ts` | JVM stderr line → level/tag/cause. |
| `cs3/discovery.ts` | Home catalogues: stale-while-revalidate Cinemeta (`top/year/imdbRating`, 19 genres) + AniList. Finds nothing playable. |
| `cs3/titleEnricher.ts` | Resolves messy release titles to canonical works; conservative (disagreeing year disqualifies). |
| `torrent/torrentEngine.ts` | WebTorrent + loopback HTTP with range support; sequential pieces; warmed at launch. |
| `torrent/torrentMetadata.ts` | `.torrent` cached by infohash, self-verifying; builds `xs` mirror URLs. |
| `torrent/torrentContents.ts` | Seasons/episodes/samples/extras from a torrent; sample recognised by size ratio too. |
| `torrent/dhtNodeCache.ts` | Persisted DHT routing table/node id/port. |
| `torrent/indexerRegistry.ts`, `indexers/*` | 19 built-in adapters (4 Stremio, 12 JSON/RSS, 3 HTML) + Torznab. |
| `torrent/indexerBudget.ts` | Per-indexer deadline from measured latency, escalating cooldown, fastest-first order. Pure, tested. |
| `torrent/botChallenge.ts` | Challenge vs block vs rate limit. Pure, tested; decides whether opening a browser is worth it. |
| `torrent/ranker.ts`, `releaseParser.ts` | Release parsing + result ranking. |
| `externalPlayerControl.ts` | Two-way VLC control over HTTP; capability declared per player. |
| `media/inspectionStore.ts` | Persists probe findings keyed on origin URL; verdict recomputed. |
| `downloadService.ts`, `aria2Engine.ts`, `ytdlpEngine.ts`, `binaryDownloader.ts` | aria2c RPC + HTTP fallback; portable binaries fetched on first use. |
| `src/utils/savedPage.ts` | Draws a page from its snapshot, and folds a live answer over it without blanking. |
| `src/components/search/sourceScopeModel.ts` | The scope dialog's row/facet vocabulary and tri-state rule. Pure, tested. |
| `src/components/search/providerHealth.ts` | The ranking's band as a word a chooser can act on. Pure, tested; **unmeasured is never "average"**. |
| `src/components/player/playbackRecovery.ts` | What a transport failure costs next: reload, rebuild the buffer, or hand the source to another engine. Pure, tested. |
| `src/utils/deadRows.ts` | Which search results to hide (`no-sources`) vs never hide (`app-error`). |
| `src/components/player/useFloatingPlayer.ts` | PiP, window pin, background policy, Media Session record. |
| `src/components/settings/settingsLevel.ts` | Simple vs Everything semantics. |

### Shared primitives that replaced duplication

- **`src/utils/format.ts`** — 8 byte formatters disagreed on zero-text, base (1000 vs 1024), decimals: `DownloadCenter`("Unknown",1024,0), `PlayerDownloadPanel`("0 MB",1024,0), `SourcePanel`("—",**1000**,0), `HistoryView`("Unknown size",1024,1), `SourcePicker`("—",1024,adaptive), `ProvenancePanel`("0 B",1024,2), `DownloadService`("0 MB",**1000**,0), `FastChunkDownloader`("0 MB",1024,1+KB rung). Last two live in `electron/` — one download reported SI size on the companion file and binary on the progress line above it. Preserved as **parameters**, not unified; `format.test.mts` derives expectations from the old implementations. **Deliberate and must survive tidy-ups**: release sizes use base 1000 (match provider/tracker SI quotes); download progress uses base 1024 (match the OS file manager). Zero-placeholder differences are *not* deliberate (flagged, unresolved).
- **`electron/util/jsonFileStore.ts`** — 5 debounced-persistence impls unified: coalescing, unref'd timer, shutdown flush, "losing a cache never throws". Does NOT own data shape (`detailCache` TTL-drops, `diagnostics` retention-filters — real per-store policy).
- **`electron/util/disabledSet.ts`** — 3 copies of the enable-cascade toggle. Stores *exceptions* (new extensions work by default); every mutation returns the whole list; bulk is the primitive.
- **`preload.ts`'s `subscribe()`** — 14 listener/teardown pairs; teardown prevents accumulation across React remounts. `onExtensionUpdateEvent` keeps its own listener (carries a discriminator).
- **`src/utils/errors.ts`** — 82 copies of `x instanceof Error ? x.message : String(x)` across 37 files. Node's `fetch` throws `TypeError: fetch failed` with the real reason in `error.cause`; the naive idiom collapsed every DNS/refused/TLS/unreachable failure into 2 words, and `groupingForm` then merged the entire network family into **one row** in `ExtensionIssueLog`, defeating its whole purpose. `describeError` fixes this (promoted from `indexerRegistry`'s local fix). Also: **timeout ≠ cancellation** — `AbortSignal.timeout()`→`TimeoutError`, caller's own controller→`AbortError`; conflating them scores a provider for the app's own decision to stop waiting. Never returns empty.
- **`src/utils/useDismissable.ts`** — 8 copies of dismiss-on-outside-click had drifted: `VideoPlayer` binds `keydown` on `window`, Escape closes the open panel or leaves the player; 5 of 8 listened on `document` in **bubble** phase without stopping the event, so a menu's Escape also reached the player and called `onBack()` — closing a menu ended playback. Fix: **whoever consumes Escape stops it, in capture phase, only when it actually closed something.** Uses `pointerdown` not `click` (click fires after release, so outside-click-close + trigger's own toggle would reopen it).
- **`torrent/indexers/base.ts`** — `withEpisodeTerms`/`tryMirrors`, 7+6 copies. Zero-padding `S01E02` matters (drop it → `S1E2` matches nothing, reads as "indexer has nothing"). Two anime indexers keep their own rule (absolute episode numbering).
- **`src/utils/sourceIdentity.ts`** — `normaliseReleaseName`/`hasRealInfoHash`, byte-identical duplicates in `downloadIdentity.ts` and `cs3/playedSource.ts`. Drift risk: downloads dedupe on one rule, resume matches another, silently and oppositely wrong.
- **`electron/anilist.ts`** — 3 hand-rolled GraphQL POSTs, drifted timeouts/messages, all used **global `fetch`** (see injected-fetch rule below). Also read `data` without checking `errors` — GraphQL returns bad-query/rate-limit/server-fault as **HTTP 200** with `errors` + null `data`, so `response.ok` was true and every caller rendered "no results". AniList rate-limits per minute; app can query per keystroke.
- Note: `util/disabledSet.ts` writes fields longhand (no constructor parameter properties) — `erasableSyntaxOnly` requires it (that syntax isn't erasable).

### Codecs: Chromium cannot decode a lot of what people actually stream

Measured with `canPlayType`. AAC/MP3/FLAC/Opus fine; **AC-3, E-AC-3, DTS return `""`** in
both MP4/MKV. Worst failure mode: bare `video/x-matroska` reports `"maybe"` — container opens,
video decodes, audio silently dropped (measured: 65,397 bytes video / 0 bytes audio, correct
duration, no `error` event). Hits **series** hardest (HDTV/WEB-DL carries broadcast AC-3/E-AC-3
vs film web-rips' AAC) — the provider was never the variable. Video is worse: Chromium decodes
H.264/VP8/VP9/AV1 only; no HEVC (without platform decoders), MPEG-2, VC-1, MPEG-4 Part 2, WMV.
Android has none of this (ExoPlayer → hardware decoders).

#### The engine: inspect, decide, execute — in that order (rebuilt 2026-08-16, PRD-37/38)

One file that decided-and-executed from whatever was known when `<video>` failed → now four:

| File | Role |
|---|---|
| `media/mediaInspector.ts` | ffprobe → `MediaMetadata`; classifies transport (progressive/HLS/DASH) from manifest **body**; reads DRM. |
| `media/decisionEngine.ts` | Pure `(metadata, transport, rendererCaps, hostEncoder) → TransformationPlan`. No I/O. |
| `mediaTranscoder.ts` | Executes a plan as live fragmented-MP4 on loopback. |
| `media/playbackEngine.ts` | Assembles them, caches capability records per URL, owns telemetry. |

Shared types: `src/types/media.ts` (`MediaMetadata`, `SourceCapabilityModel`, `TransformationPlan`, `PlaybackStrategyType`, `DrmConfiguration`). Decision is pure so it's testable against the expensive-to-reproduce matrix (real 25GB file, now-expired link): `media/decisionEngine.test.mts` (35 cases), `media/pipeline.test.mts` (13 cases, real ffmpeg, skips itself without it) — both under `bun run test:electron`.

**Ordering is the bug fix.** Playback used to attach on mount while a probe ran beside it; Chromium's parser failed within ~150ms, `error` fired with the probe in flight, fallback ran `-c:v copy` on unknown video — re-wrapping undecodable HEVC and failing identically again. `media:prepare` is now the only source of a URL. **Assigning `video.src` from anything but a prepared response reintroduces this.**

Four invariants (PRD-37 §4.2):

| ID | Rule | Enforced in |
|---|---|---|
| INV-RACE-1 | Nothing attached before inspection completes | `VideoPlayer` — no `?? streamUrl` fallback |
| INV-RACE-2 | Gate is visible ("Inspecting media…") | `VideoPlayer`, `isInspecting` |
| INV-RACE-3 | `-c:v copy` never on unverified codec info | `blindFallbackPlan` re-encodes |
| INV-RACE-4 | Renderer capabilities registered before playback | `App.tsx` mount → `media:setCapabilities` |

**Nothing is decided from the URL.** (Old impl searched filenames for `hevc`/`x265`/`10bit` — wrong both ways.) Transport likewise classified from first 64KB of body (`#EXTM3U`/`<MPD`), not URL/content-type.

Load-bearing plan details:
- **Software 4K guard is arithmetic, not heuristic.** Measured: 3840x2160 10-bit HEVC, libx264 `veryfast` native res = 11–13 FPS (0.47x realtime, Chromium drains buffer in ~3s then stalls forever); same encode at `scale=-2:1080` = 26–28 FPS (plays). So software-only hosts downscale >1080p; GPU-encoder or 16-thread hosts keep full res.
- **A track switch re-derives the plan, never re-indexes it.** Pointing a copy-audio plan at a 6-channel AC-3 track → ffmpeg fails outright (`Cannot write moov atom before AC3 packets` — fragmented output writes header before first packet exists). `planForAudioTrack` is the only correct way to change tracks.
- **Unplayable default audio is swapped only for one in the same language** (Movies4u ships 3× E-AC-3 5.1 beside AAC stereo of the same film — swap the AAC, never swap languages for cost).
- `-allowed_extensions ALL` for HLS/DASH (Hdmovie2 serves MPEG-TS from `.png` URLs).
- DASH remuxed by ffmpeg (Chromium chokes on raw `.mpd` XML), collapsing the adaptive ladder to one rendition; Widevine/ClearKey DASH is detected/reported, not played.
- **Decodability is measured in the renderer** (`App.tsx` runs `canPlayType` over `VIDEO_CODEC_PROBES`), overriding the static `UNSUPPORTED_VIDEO` table **in both directions**.
- **The hardware encoder is chosen by test-encoding**, never `ffmpeg -encoders` (that lists what the binary was built with, not what runs — measured: bundled build advertises nvenc/qsv/amf everywhere, only QSV opens without an NVIDIA GPU). Each candidate encodes one real frame with the exact args it'll be used with (also catches AMF's missing `-preset`).

Bite-prone rules: stereo downmix is deliberate (5.1→5.1 AAC decodes but routes to wrong outputs on most desktop setups); `-user_agent` is HTTP-demuxer-only (fatal on local paths, applied only to http(s) inputs); seeking restarts ffmpeg at target time (fragmented MP4 has no index, accuracy bounded by keyframe interval); probe enables multi-audio selection (no ffprobe = app can't even list a Japanese AC-3 dub); embedded text subtitles extracted on demand, bounded 3 min, cached (reads whole file — packets interleaved); bitmap subtitle tracks (PGS/DVB/VOBSUB) listed but never offered.

**DRM classified and (2026-08-21) acted on.** HLS AES-128/SAMPLE-AES are NOT DRM here (hls.js handles them in JS). ClearKey/Widevine/PlayReady/unrecognised → `requiresEmeDecryption`, FFmpeg bypassed entirely (probing encrypted content succeeds with correct codec names over garbage — see next section). ClearKey now decrypted (`src/utils/clearKeySession.ts` EME, or FFmpeg `-decryption_keys`). Widevine/PlayReady/DASH-under-DRM: named, not built.

Torrent load-bearing behaviours: **file selection inside season packs** (deselect all, select one, or bandwidth splits across episodes and nothing plays) and **leading-bytes readiness** (measured as contiguous leading pieces, not overall %).

### Torrent startup: the client was cold, and it was never the swarm (2026-08-28)

Comparison to a hosted service (seedr, ~1s vs tens of seconds here) with identical peers.
Gap = one-time costs a service pays once and a desktop app paid every launch:

| Cost | Cold client | Warm service |
|---|---|---|
| TCP/uTP/DHT/loopback binds | on first Play | done weeks ago |
| DHT bootstrap (DNS + round trip to `k-rpc`'s 3 hardcoded hosts) | every launch | never |
| Converging on an infohash from 3 contacts | several `find_node` rounds | ~1, dense table |
| Reachability (ephemeral node id/port) | nobody can route to us | stable |
| Info dictionary (BEP-9, 16KB chunks) | 5–30s | already held |

Fixes:
1. **`TorrentEngine.warmUp()`, 8s after window opens** (`TORRENT_WARMUP_DELAY_MS`), like `warmProviders()`. Never awaited/fatal.
2. **DHT routing table/node id/port persist** (`dhtNodeCache.ts`, `userData/torrent-state/`). Contacts expire weekly; node id doesn't. `dhtPort` pinned to **6882** (WebTorrent's default 0 quietly cancelled the persisted id).
   - **Saved contacts go through `DHT.addNode()`, never `bootstrap`.** `k-rpc` compares candidate-set length against `bootstrap.length` on every lookup round:
     ```js
     var closest = table.closest(target, self.k)
     if (!closest.length || closest.length < self.bootstrap.length) {
       closest = self.nodes.closest(target, self.k)
       if (!closest.length || closest.length < self.bootstrap.length) bootstrap()
     }
     ```
     200 saved contacts in `bootstrap` makes that permanently true — the per-lookup `table` (the convergence mechanism) is discarded every round, and `bootstrap()` fires the whole list in one burst bypassing the concurrency gate. `addNode` with no id pings through the queued path instead. Test pins `DHT_BOOTSTRAP_NODES.length < 20`.
3. **`.torrent` metadata cached on disk by infohash** (`torrentMetadata.ts`), self-verifying (info dict sliced + SHA-1'd; mismatch deleted).
4. **Magnet `xs` mirror links** — WebTorrent already races them against the swarm and discards mismatched infohashes; this module just builds the URLs. Setting: `torrent_http_metadata_cache`, a **getter** (not read-once), consulted per magnet.
5. **`ut_pex` stated explicitly** — helps when the tracker is slow/dead.
6. **Magnet `tr=` trackers merged into `announce`** (`trackersFromMagnet`/`mergeTrackers` in `indexers/base.ts`, beside `buildMagnet`) — a cached `.torrent` buffer used to discard the magnet's trackers entirely.

Timing trade-offs: `METADATA_TIMEOUT_MS` 45s→25s + 12s dead-swarm bail (measures **known** peers `_peers`, not connected — reachability is `swarmHealth.ts`'s job); `PLAYABLE_THRESHOLD_BYTES` 8MB→4MB (can't go much lower — demuxer runs out, reads as a stall); tail window is **container-aware** (`tailPriorityBytes`) — MP4/MOV/AVI need trailing `moov`/`idx1`, Matroska doesn't (header at front), MPEG-TS has no trailing index at all (MKV is the modal container in this corpus).

`torrentMetadata.test.mts` (28 cases) — bencode reader is hand-written because the hash must cover the **exact original byte range** (a parse-re-encode round trip normalises key order and loses it).

**Does not fix:** CGNAT reachability, genuinely dead swarms, host-side 403/expired links (still `swarmHealth.ts`'s job).

---

## 5. The `.cs3` extension story

`.cs3` = ZIP of Android DEX bytecode compiled against upstream's Kotlin provider API. Not runnable by Node/V8 at any configuration, but not a barrier to desktop (only to JS runtimes):
1. `sidecar/` is a **separate JVM OS process** (not thread/worker) — a hanging/crashing plugin degrades to "unavailable", never takes the app down.
2. `DexTranslator`: DEX→JVM via **dex2jar 2.4.38**, once at install, cached by SHA-256. Original `.cs3` never modified.
3. `LinkageAnalyzer` resolves every referenced type, assigns tier `T1`…`T4_BLOCKED`.
4. `PluginHost` reproduces Android's load sequence: read `manifest.json` through the class loader, `loadClass`, construct reflectively, `load(context)`, observe self-registration.
5. `sidecar/src/main/java/android/**` hand-written stubs of the 5 classes (`Log`, `Base64`, `Context`, `SharedPreferences`, +1) covering ~93% of the 32.4% of providers that import `android.*` at all (67.6% import none).

### Upstream now publishes a jar, largely unread (2026-08-27 → wired 2026-08-28)

Upstream's Gradle plugin's `isCrossPlatform` flag emits a plain JVM `.jar` beside the `.cs3`;
`ensureJarCompatibility` runs `jdeps --print-module-deps` and fails the build on any `android.`
reference; `plugins.json` carries `jarUrl`/`jarHash`/`jarFileSize`. This artifact needs no
translation — `DexTranslator`, `KotlinNameRepair`, the translation cache and its concurrency
fixes all become dead code on this path. **Does NOT retire**: `jdeps` flags `android.*` only —
a cross-platform jar still links `library-jvm` and can reach `:app` types the bridge supplies;
`LinkageAnalyzer`/tiers still apply. Removes the *bytecode* problem, not the *classpath* one.

**M0 (PRD-41), built 2026-08-28.** Live-index count (larger than PRD assumed): official `recloudstream/extensions` 5/5 jars; `phisher98` 79 ext/**47** jars; `Kraptor123/cs-kraptor` 67/0. All jars matched declared `jarHash`/`jarFileSize`.

`PluginManager.chooseArtifact` prefers the jar, verified against **`jarHash`** (never `fileHash` — that's the `.cs3`'s digest and would always mismatch; a mismatch there must never be taken as permission to skip verification). `extensionUpdater` copies the three fields through on re-resolve. **Archive keeps its `.cs3` name** — `PluginArchive.detect` classifies by **contents** (`.dex` member vs `.class` members), never filename (filenames drift/get renamed).

**No `manifest.json` on the jar lane.** Entry class recovered by scanning for the `@CloudstreamPlugin` **ASM annotation** (verified on `recloudstream/DailymotionPlugin.class`: `Lcom/lagradost/cloudstream3/plugins/CloudstreamPlugin;`, extends `BasePlugin`) — stronger than a `*Plugin.class` naming convention. Rules: two annotated classes are both **reported, never arbitrated** (picking-first would make provider choice depend on archive zip ordering); an unparseable class file is **skipped, not fatal**. `PluginHost.prepare` is the only branch point for jar-vs-dex — a second copy of the load sequence would drift.

`PluginCompatibilityAnalyzer` had a real defect here: a jar reached the "no `classes.dex`" branch → `Unsupported`, score **0**, exact opposite of truth. Now reports `format: 'CSJ'`, 95%, `TierA_SourceJVM`.

Jar lane = **generation 9** (current value **14**, see `runtimeProvisioner.ts` — one paragraph per generation).

`tools/e2e/provider-e2e.mjs --lane cs3` forces the DEX artifact for A/B comparison — M0's no-regression gate. **Measured** (`--repo phisher --plugins 6 --queries "dune,one piece"`): 3 archives loaded jar-lane with **zero `DexTranslator` invocations**, same tier/results as DEX lane; 6 loaded, 6 answering, 5 links resolved, 3 streams with bytes — PASS identically both ways. **Translation risk measured** (not assumed) against all 392 real plugins: 392 translated, 18,217 classes emitted, 0 verification failures, 6,617 Kotlin coroutine state machines, 0 failures (`docs/PRD/35`, `tools/dex-spike/`).

**The jar lane collapsed four days later (2026-09-07).** Re-measured across all 36 catalogued repos: 958 extensions, **18 publishing jarUrl (1.9%)**, down from 12.0% on 2026-09-03. `phisher` 47→**0/81**; `xr3ed` 46→1/191 (verified: `plugins.json` entries no longer carry the fields at all). **Do not plan work assuming the corpus moves onto this lane.** Uncatalogued `.cs3` tail (122 repos not in the official list, 21/32 probed live, 1,158 extensions) is also **not worth taking**: only 19 publish a jar (1.6%), 3 of 4 largest are majority-NSFW. Trap: a declared `tvType` is a manifest default, not coverage (`Wiojelt/TurkSinema` declares every type on every extension).

### Provider execution: working as of 2026-08-13

PRD-36 steps 1–4 done. Verified E2E against real `InternetArchiveProvider`: tier `T1_DROPIN`, 26 results, detail load, 4 live HTTP video URLs (200, `video/mp4`, `Accept-Ranges: bytes`).

- `sidecar/runtime-deps/pom.xml` resolves `com.github.recloudstream.cloudstream:library-jvm` (pinned **4.8.0**) + full transitive runtime → `sidecar/runtime/`, 56 jars. Don't restate versions by hand — transitive resolution reproduces exactly what providers compiled against. Needs Google's Maven repo (`androidx.annotation:annotation-jvm`).
- `sidecar/bridge/` (Kotlin) → `cs3-provider-bridge.jar`, must live in `sidecar/runtime/` (loaded by the same loader that owns `library-jvm.jar`, or `BasePlugin` resolves as two different Class objects). Reached reflectively; primitives in, JSON strings out.
- RPC methods: `providerSearch`, `providerLoad`, `providerLoadLinks`, `providers`. Results re-addressed `cs3ext://<provider>/<handle>`.

Two doc-36-contradicting findings: (1) `BasePlugin`, `CloudstreamPlugin`, `APIHolder`, `ExtractorApi` all ship inside `library-jvm` 4.8.0 — the hand-built `cs3-app-shim.jar` doc 36 budgeted a week for wasn't needed. (2) `search(query, page)` is primary in 4.8.0, not `search(query)` (doc 36 says reverse) — bridge tries paginated first, falls back.

Also fixed: `DexTranslator`'s temp filename (SHA alone) collided on concurrent translation of the same archive (nonce added, atomic move kept); `PluginClassLoader` needed the **original `.cs3`** as a second classpath entry too (dex2jar only converts `classes.dex`, but `manifest.json` must resolve through the loader).

**Never reintroduce a synthetic/placeholder source.** Empty result + a reason, always.

Outstanding from doc 36: step 5 (jlink JRE), step 6 (OS sandbox). Step 7 (WebView) landed 2026-08-24 (§"The browser, finally").

### Community extensions: shim rounds (chronological; count-before-fixing pattern throughout)

**Round 1 (2026-08-13), five defects found running `Bnyro/GermanProviders`:**
1. `com.lagradost.cloudstream3.plugins.Plugin` is `:app`, not in `library-jvm` — every community `.cs3` (all extend `Plugin`, not `BasePlugin`) failed with `NoClassDefFoundError` before running. Supplied from `sidecar/bridge/` (must be loaded by the `library-jvm`-owning loader).
2. **dex2jar corrupts Kotlin mangled names**: `kotlin.Result.constructor-impl` (hyphen) → rewritten to underscore, resolves against nothing (`Result` = `runCatching`'s compiled form — search/metadata worked, link resolution failed with Kotlin-internal errors). `KotlinNameRepair` fixes it. **If a provider works until you press play, check this first.** The repair was itself broken until 2026-08-13: `rewriteClass` tracked change via a *global* counter while `repairedName` memoised decisions per-class — the second class hitting a cached decision bumped no counter and had its correctly-rewritten bytes discarded. Failure depended on install count (shared repair instance across plugins in a session) — "works in a 3-plugin test, fails with 8 installed." Fixed: changed-ness tracked per class by the visitor, never re-derived from a skippable-cache counter.
3. android.* shim built into `sidecar/target/`, never delivered to `sidecar/runtime/` (the plugin classpath).
4. Dev classpath pointed at a directory that never existed (`sidecar/pom.xml`→`target/`, `runtime-deps`→`runtime/`, siblings) — every plugin `T4_BLOCKED`.
5. `resolveJava` accepted any JVM — Java 17 → `UnsupportedClassVersionError` reported as "runtime crashed".

**Round 2 (2026-08-13),** `Kraptor123/cs-kraptor` 65/65 failing at `load` with `InvocationTargetException: null`:
1. Reflection wrappers carry no message — `Main.describe` now walks to the first cause that says something; `errorKind` classification was already correct.
2. **`SharedPreferences` was a class; Android's is an interface** — **112/392 plugins** reference it (highest-impact single fix). `invokeinterface` against a class → `IncompatibleClassChangeError` at first *use* (settings read), not load. Fixed: interface + `Editor`/listener nested interfaces, impl `JsonSharedPreferences`.
3. `PluginData`, `PluginManager`, `RepositoryManager`, `RepositoryData` are `:app` types (same category as `Plugin`), supplied from `sidecar/bridge/`. Used by extensions to enumerate/delete host plugins/repos — **inventories return empty, mutations are no-ops, deliberately** (that state belongs to main process).
4. `android.content.pm.PackageManager` missing; `Context.getPackageManager` returned `Object` (wrong descriptor — link failure, not just type-loss). Returns a manager, every op throws; `getPackagesForUid` returns `null` (Android's own answer). **Never forge `com.lagradost.cloudstream3`** — lying about the platform makes downstream bugs undiagnosable.
5. `android.os.Process` missing — identity reads honest, `killProcess` refused (would kill the sidecar + every co-loaded extension).

After all 5: AnimeciX loads at `T3_DEGRADED`; Filmpalast/EinschaltenIn/Serienstream load, register 3 `MainAPI` + 10 `ExtractorApi`, answer searches (8/33/21 results).

**Round 3 (2026-08-14),** counted a user's 113 load failures → 6 classes covered 100%:

| Missing type | Failures | Category |
|---|---|---|
| `com.lagradost.cloudstream3.utils.DataStore` | 48 | `:app` |
| `androidx.appcompat.app.AppCompatActivity` | 23 | androidx UI |
| `com.lagradost.cloudstream3.network.CloudflareKiller` | 16 | `:app` |
| `android.net.Uri` | 16 | shim gap |
| `androidx.fragment.app.DialogFragment`/`FragmentManager` | 10 | androidx UI |

1. **`PluginHost.call` caught `ReflectiveOperationException` but not `LinkageError`.** `Class.getMethod` resolves *every* public method's param/return types, so a provider merely declaring `val interceptor = CloudflareKiller()` threw `NoClassDefFoundError` asking for its own **name**, after successfully registering — blamed the wrong class, aborted the whole load. `diffProviders` now isolates per-provider describe failures.
2. `DataStore`/`CloudflareKiller` are `:app`, from `sidecar/bridge/`. `DataStore` needed a faithful reimplementation (most API is `inline fun … reified`; shipped `.cs3` carries a copy of the body calling `getSharedPrefs(context)`/`AppUtils.parseJson` directly). `CloudflareKiller` forwards (challenge needs WebView, doc 36 step 7). Both need `-opt-in=com.lagradost.cloudstream3.InternalAPI`.
3. `android.net.Uri` implemented (not `java.net.URI` delegation — Android's parser never validates; scraped URLs routinely carry spaces/`|`/stray `%`). RFC 3986 Appendix B splitting, total (cannot fail). Asymmetry preserved: `getQueryParameter` decodes `+` as space, `Uri.decode` doesn't.
4. androidx UI closure (`View`, `ViewGroup`, `LayoutInflater`, `Bundle`, `Dialog`, `DialogInterface`, `Window`, `Activity`, `Fragment`, `DialogFragment`, `FragmentManager`, `FragmentActivity`) exists so *scraping* logic (bundled with settings UI in one archive) can link — throws `UnsupportedAndroidApiException` on use (demotes tier, doesn't crash).
5. Context handed to a plugin is now **`AppCompatActivity`** (`android/content/PluginHostContext.java`) — corpus's dominant shape is `activity = context as AppCompatActivity` as `load()`'s first statement (25 files). Converts total loss → scrapes-fine/no-settings-screen. Every inherited method still throws; only type identity conceded.
6. `Context.getResources` returned `Object` (same descriptor bug as `getPackageManager` — different method to the JVM, `NoSuchMethodError`).

Also: **`androidx/**` must be excluded from `cs3-sidecar.jar`** alongside `android/**` — parent-first delegation means a stray copy there wins and fails to link against the excluded `android.content.Context`.

Measured after all six (`--repo phisher --plugins 25`): 28 providers loaded (was 26), 12 answering, 7 links, 5 streams, zero of the six classes. All 5 repos (`--plugins 4`): 12 loaded, 7 answering, 3 streams, zero of the six, **no T4_BLOCKED at all** (10 T1_DROPIN, 3 T3_DEGRADED).

**Round 4 (2026-08-15),** user reported 8 Phisher extensions "No providers" — **5 of 8 were the stale-runtime trap** (§3), not real bugs (classes had shipped weeks earlier but the install still served old copies). The 3 real ones:
1. `Context.getSystemService` threw for every name (Android returns `null`) — aborted `load()`'s first statement (memory-sizing check), lost StreamPlay's whole provider set. `"activity"` answers a real `ActivityManager` with this JVM's real `MemoryInfo` (DROP-9: never fake platform numbers).
2. `android.os.Handler` absent — shim **works** (single-threaded daemon executor per handler, Android's per-Handler ordering guarantee preserved); `Looper.getMainLooper()` must return non-null.
3. Whole `syncproviders` cluster is `:app` (`library-jvm` ships only `SyncIdName`). Supplied: `AuthAPI`, `AuthRepo`, `SyncAPI`(+nested), `SyncRepo`, `AccountManager`, `AniListApi`(+10 nested data classes), `UiText`, `ListSorting`, `SyncWatchType`. **Data classes faithful (Jackson binds by constructor param name — a rename silently binds null); behaviour refused (`null`, "not logged in").** Descriptor trap caught: `AccountManager.aniListApi` declared as `SyncRepo` (wrapper) compiled but failed at call sites with `NoSuchMethodError` — **a getter returning a supertype is a different method to the JVM.**

Measured (`--only <the eight>`): 7/8 load. Repo-wide (`--plugins 40`): 45 loaded, 20 answering, 12 links, 8 streams, zero `NoClassDefFoundError`. **Outstanding: Ultima** — needs `CloudStreamApp`→`MainActivity`/`CommonActivity`/`HomeViewModel`/etc. — a host-UI replacement, not a scraper; left unshimmed deliberately.

### The bridge was discarding half of what Android hands back (2026-08-21)

Found by reading `ProviderBridge.encodeLink` against `library-jvm` 4.8.0 (produces no errors):

| Discarded | Consequence |
|---|---|
| `DrmExtractorLink` (`kid`,`key`,`kty`,`uuid`,`licenseUrl`,`keyRequestParameters`) | Encrypted stream looked ordinary |
| `ExtractorLinkPlayList.playlist` | Multi-part title has no top-level URL — filtered as malformed |
| `LiveStreamLoadResponse` | Every `TvType.Live` provider offered nothing to play |
| `AudioFile.headers` | Separate audio tracks 403'd as bare URLs |
| `ExtractorLinkType`/`isDash` | Ignored; transport re-guessed from URL string |

Transport now read from the provider's own declaration first (upstream's `INFER_TYPE` already fills it before emission), URL heuristics kept only as fallback for pre-field archives. `electron/cs3/providerLinks.ts` owns this, tested separately.

**Torrent/magnet links from providers never reached the torrent engine** — `TORRENT`/`MAGNET` types were written into `directUrl` and handed to `MediaProxy` (HTTP-only); the swarm/piece-order/loopback machinery existed but was unreachable from this direction. Fixed: real infohash is the dedupe identity; `fileIndex` left **unset** (torrent-engine-meaningful — a stale list-position would pick a wrong episode).

**Multi-part titles are numbered rows** (`part 2 of 3`), not a silently-truncated single row — visibly partial beats silently truncated.

### DRM: classified before, decrypted now (2026-08-21)

Nothing filled `EME_NATIVE`/`DrmConfiguration` from a provider — DRM was detected only from
manifest bodies, **after** the probe. Measured: ffprobe reads a synthesised CENC file and
reports **correct codec names**, then decode produces `non-existing PPS`/`no frame!` — the
probe succeeds with a lie, so encrypted streams reported as "file is corrupt".

Provider declaration now short-circuits inspection (`PlaybackStreamRequest.drm`). Three cases:
1. **ClearKey + browser-decodable payload** → `EME_NATIVE`, plays via `src/utils/clearKeySession.ts` (attaches `org.w3.clearkey` MediaKeys, answers licence locally from the key that came with the link).
2. **ClearKey + browser-undecodable payload** → ordinary ladder + `-decryption_keys` on the plan. **Progressive only** (DASH demuxer: `Option decryption_key not found` is fatal to the whole command line).
3. **Widevine/PlayReady/keyless ClearKey/unrecognised** → `EME_NATIVE`, named as unplayable (no CDM shipped).

Two silent-failure hazards in `src/utils/clearKey.ts`: hex vs base64url told apart **by length only** (a 32-char string is ambiguous both ways at 24 vs 16 bytes — 16 bytes = 32 hex or 22 base64url, unambiguous); EME wants base64url, FFmpeg wants hex (both conversions in one file, tested against each other). `DrmType.unknown` kept distinct from `none` (folding in sends it back to be misdiagnosed).

**Not built: DASH under any DRM** (Chromium can't demux `.mpd` without MSE+JS, FFmpeg refuses the keys) — reported by name now, not as corrupt.

### 4K, 8K and HDR (2026-08-21)

**Software-encode guard was height-only, wrong above 4K.** 16-core threshold was measured *at 4K* (3840×2160); 8K is 4× the pixels, so the same machine holds ~0.25x at 7680×4320 and the height-only guard waved it through at full res. Fixed: threshold is now **pixels-per-second**, `Math.max(1,…)`-clamped so every ≤4K verdict is unchanged (only tightens); width used where reported (5120×2160 ≠ 3840×2160). Above 4K, container remux also routes to mpv under `auto`.

**HDR re-encode needs tone-mapping; didn't have it.** `-pix_fmt yuv420p` only converts storage format, not transfer function — PQ/HLG re-encoded to 8-bit keeps HDR-referred values displayed as SDR (washed out, no error). Measured (synthesised PQ fixture, first-frame stats):

| | SATAVG | YAVG |
|---|---|---|
| SDR reference | 112.6 | 124.7 |
| Re-encoded, no tone-map (shipped) | 22.8 | 97.4 |
| Re-encoded, zscale chain | **63.0** | 84.3 |
| `tonemap` without `zscale` ("fallback") | 6.3 | 37.7 |

**That last row is why there's no degraded fallback** — `tonemap` alone on PQ values is measurably *worse* than nothing. `toneMapFilters()` returns the chain only when `zscale` (zimg) is detected at startup, else nothing at all. Only re-encodes are tone-mapped (`-c:v copy` can't tone-map anyway). Trap: ffmpeg takes **one** `-vf` — tone-map and downscale must share a chain, not each push their own.

### The box now contains the player (2026-08-21)

`extraResources` had only the sidecar — fresh installs had **no ffprobe/ffmpeg/mpv**, fetched
on first use, and `setupMpv` didn't even try outside Windows. Consequence: `MpvEngine.isAvailable()`
false → `shouldRouteToNativeEngine` false for **every** stream → every 4K HEVC file hit the
0.47x-realtime software stall the native engine exists to avoid. **Default install was the
worst configuration possible.**

`tools/package/build-media-runtime.mjs` stages binaries into `cs3_windows/media-runtime/` → `extraResources` → `resources/media/`. **Fails the build** if a required component is missing (`--allow-missing` overrides deliberately). Bundled copy now wins over `userData/bin` (was reversed — same stale-shadow shape as §3's trap). **`yt-dlp` is the exception** — a downloaded copy is *newer* (extractors break weekly), kept resolving from `userData` first. mpv is `required: false` on Linux/macOS (distro packages wire VA-API/VideoToolbox correctly; a generic binary can't).

Chromium now gets `PlatformHEVCDecoderSupport` (Chrome 104+, previously never requested) — `App.tsx`'s `canPlayType` measurement overrides it in both directions, so this can't make a decision worse.

### DASH is played, not remuxed (2026-08-21)

Shaka Player (Apache-2.0) takes any DASH manifest the browser can decode (`DASH_NATIVE`); remux stays as fallback. Buys: full adaptive ladder (remux flattens to one rendition) + the only strategy that can play encrypted DASH (FFmpeg's demuxer rejects `-decryption_key` outright).

**The proxy had to learn DASH first — fixed an existing bug too**: manifests name segments relative to their own address; serving unmodified from loopback breaks resolution for both Shaka *and* ffmpeg's DASH demuxer (same relative-resolution rule) — the remux path was already broken for any manifest not spelling segments out in full. `MediaProxy` now rewrites MPDs: **directory routes** (`/base/<token>/<rest>`, since `SegmentTemplate` uses player-expanded `$Number$` placeholders — unlike HLS which lists every segment); `<BaseURL>` inserted/replaced; absolute `media`/`initialization`/`sourceURL` rewritten; suffix origin-checked (`resolvePrefixed` refuses cross-origin — else a directory route becomes an arbitrary-URL fetcher); manifest sniffing bounded to 4MB declared length. `mediaProxy.test.mts` (11 cases) — note: `wrap` returns loopback URLs untouched, so a 127.0.0.1 test origin is never proxied and tests nothing real.

### Subtitles: ASS and the charset (2026-08-21)

Android always had SubRip + WebVTT + SubStation Alpha, all through `juniversalchardet` first; desktop had neither. `.ass`/`.ssa` went through the SubRip converter (emitted `[Script Info]`/`Dialogue:` as cues — breaks most anime/fansubs). Every download decoded as UTF-8 unconditionally (`Response.text()`) — Windows-1252/GBK subtitles got correct timing + black-diamond garbage per accent.

`electron/subtitles/convert.ts` owns both. **UTF-8 is checked (fatal-mode `TextDecoder`), not detected** — statistical detector only sees provably-non-UTF-8 files. **A UTF-8 detection is then rejected if the decode produces U+FFFD** (`chardet` false-positives on 4-byte Windows-1252 strings; non-fatal `TextDecoder` substitutes rather than throwing, so the substitution char IS the error signal). ASS conversion reads the `Format:` line (order is per-file), bounds the `Dialogue:` split (commas in text), drops `\p1` drawing commands (vector coordinate dumps).

### Android vs Windows divergence, measured (2026-08-19)

`provider-e2e.mjs --plugins 30`, all 5 repos: 66 loaded, 24 answering, 18 links, 16 streams — PASS. **`NoClassDefFoundError` count: 3, all one class** (`CloudStreamApp` = Ultima, the deliberate exclusion). **Conclusion: for the visible corpus, the translation/class problem is closed** — a provider failing here that works on Android is failing for a non-class reason. Real remaining divergences:
1. **TLS strictness** — `SSLHandshakeException: unrecognized_name` — servers sending a *warning*-level SNI alert; Android's Conscrypt ignores it, stock JVM treats it fatal. **Do not apply `-Djsse.enableSNIExtension=false`** globally — disables SNI for every connection, breaking most CDNs to fix a few hosts. Correct fix is per-connection in the bridge's HTTP client; not built. **Frequency unmeasured** (harness only prints last 15 lines of stderr) — count before spending effort.
2. **No WebView — closed 2026-08-24** (see "The browser, finally").
3. Host-side reality (expired links, 403s, dead swarms) is not a divergence at all — of 72 non-playing streams in the vendor matrix, every one was host-side.

### A provider that is gone has to say which extension owned it (2026-08-24)

Old: `IllegalArgumentException: No loaded provider is named "X". Loaded: [...100 more]` shown
raw to the viewer. Fixed: `requireProvider` throws `PluginHost.ProviderNotLoadedException`
(one line; loaded set to stderr only). `PluginManager.explainMissingProvider` answers *why*,
reached via `errorKind: 'PROVIDER_NOT_LOADED'`:

| Cause | Told to viewer |
|---|---|
| Provider/extension/repo switched off | which switch, where |
| Adult provider, gate off | that + where |
| Two extensions claiming one name | which lost (`providerNameClashes`) |
| Extension uninstalled | which one, search again |
| Extension installed but blocked at load | verbatim `runtimeReports` reason |
| Providers not loaded yet | that, not a failure |

Supporting pieces: **provider origins persisted** (`cs3_provider_origins` — a bookmark/library entry addresses `cs3ext://X/…` long after X is gone); **a missing archive on disk gets a runtime report** (was silently filtered from `pending`); **`provider-missing` is its own unscored `FailureKind`** (scoring it would rank a switched-off extension down). `RUNTIME_GENERATION` → **7**.

### The forced retry never asked the engine that could have played it (2026-08-26)

Measured against 54 real sources (`.temp/RRR_sources.md`): most healthy, 5/7 representative
ones play via `MediaProxy`→mpv in ~1s. Bug: `PlaybackEngine.prepare` hard-set `FULL_TRANSCODE`
on the forced (post-element-failure) pass, bypassing `shouldRouteToNativeEngine` entirely —
exactly when the native engine is most needed, it was guaranteed to re-encode instead. Traced:
`hev1` 1080p probes `dash`/`hevc`, remuxed, fails in element, re-encoded frame-by-frame; same
URL to mpv opens `d3d11va` in ~1s. Fixed: forced pass now routes to `NATIVE_MPV` when available
and policy≠`off` (exclusions: `EME_NATIVE`/`requiresEmeDecryption` — mpv has no CDM). **The
returned capability is rewritten** — `VideoPlayer` reads `capability.requiredStrategy`; handing
back the pre-force model would loop the element on a source mpv could already play.

Genuinely dead (recognise, don't re-debug): `workers.dev` 500/403, `r2.cloudflarestorage` 403 NotEntitled, pixeldrain 404, `hcdn3.hakunaymatata.com` DNS failure. Measurement trap: probing a manifest with `Range: bytes=1000000-` returns 416 (file is a few KB) — ask for a satisfiable range or none.

### The timeline drew and never moved (2026-08-26) — four separate defects

1. **`--force-seekable=yes` on Range-ignoring origins.** Host shapes: (a) 206+Content-Range+Accept-Ranges (honest); (b) 206+Content-Range, no Accept-Ranges (honest but silent); (c) `video-downloads.googleusercontent.com` — **200 + whole file from byte 0 regardless of Range asked** (not seekable, doesn't say so). On (c), mpv accepted the seek and satisfied it by reading-and-discarding from 0 — timeline never moves (**every Continue-Watching resume hit this, since resume = seek-before-first-frame**). Measured: the flag never helps (Range-honouring works either way) and actively hangs on Range-ignoring origins. Removed. `MediaProxy` now **states `Accept-Ranges` rather than forwarding it** (fixes case b), and refuses to serve byte-zero data as a mid-file range.
2. **`MAX_ROUTES`(1000) below one film's cost** (~1200 routes/film for HLS) and **LRU evicted the wrong end** — oldest routes (master + variant playlists, just handed to the player) evicted first. Fixed: routes carry `createdAt` separate from `lastAccess`; never-served routes evicted only after all served ones, and among never-served, **newest first** (age = position in the document, not staleness — oldest are variants/opening segments, newest is film's end, dropping the tail is free/re-minted on demand).
3. **Any un-Ranged body under 4MB was corrupted** — manifest-sniffing branch did `.text()` then `res.end(body)`, UTF-8-mangling binary bytes (704KB segment → 1.27MB garbage). Survived because media requests almost always carry Range. Fixed: read as bytes, decode only to sniff.
4. **Abandoned probe requests kept downloading the whole file.** `pump`'s cleanup called `reader.releaseLock()` (detaches but doesn't stop — under Electron's `net.fetch`, the request lives in Chromium's network service and keeps running). On Range-ignoring hosts, 3 aborted probes × 3 sources = 9 concurrent full-file downloads competing with the real one. Fixed: reader cancelled + every upstream fetch carries an `AbortSignal` tied to the client socket. Guarded on `writableEnded` (close fires on normal finish too).

Test traps: `MediaProxy.wrap` returns loopback URLs untouched (127.0.0.1 test origins are never proxied — test nothing); regression tests must be verified to FAIL with the bug restored (a stub that ends its own body passes trivially).

**Segments disguised as images**: HDHub4U's playlists point at TikTok's image CDN — each segment is a real 70-byte PNG header + MPEG-TS glued behind it (`Content-Type: image/png`, valid PNG signature). No demuxer option helps; detection = PNG magic + sync-byte run at 188-byte stride on routes minted by a playlist rewrite only.

### The first search cost a minute, never the plugins (2026-08-26)

Measured on 124 archives/132 providers:

| Experiment | Result |
|---|---|
| Load all 124 serially | 66.8s + 2.7s handshake |
| `inspect` all 124 (translate+analyse) | 1.4s |
| Load, unload, load again same JVM | 57.1s, then 2.4s |
| Load all, 8 concurrent RPCs | 43.5s, **176 providers mis-attributed** |

Conclusions: translation isn't the cost (cached, 1.4s total); it's **demand-driven JVM class loading of the 56-jar classpath**, paid once per process (mostly disk — hot page cache measured 6.5s); **cannot be parallelised** — providers self-register into global `APIHolder.allProviders`, `diffProviders` reads its length before/after `load()`, so overlapping loads both read the same mark and steal each other's providers.

Fix: **stop loading before anyone asks.** `cs3/providerRegistry.ts` records what each archive registered, keyed `size:mtime:generation` — hydrates the provider list from disk without starting the JVM (6.6s→8ms, 132 providers preserved, zero misses). **The generation is part of the key** (shim/bridge changes what a plugin *can* register). An archive registering nothing is still recorded (`[]` ≠ no record — else extractor-only bundles reload every launch forever). A failed activation withdraws the row. `loadProviders(force)` clears the cache. **Loading is lazy and per-archive** — `ensureProviderActive(name)`, deduped by an in-flight map (a search fanning to 8 providers from one archive would otherwise load it 8× concurrently — the mis-attribution bug through the front door). `warmProviders()` runs 4s after window-open, loads the rest serially in the background. **If you add a code path calling a provider, call `ensureProviderActive` first.**

### Counting the log, from inside the app (2026-08-26)

21 session files, 6,069 records, **5,407 (89%) sidecar stderr**, `missingClass` matched **none** (class problem confirmed closed). Log noise breakdown: `ApiError: ---` ×290 (pure punctuation), `PluginInstance: Adding … ExtractorApi` ×~200 (INFO chatter), JUL header lines ×151 (message is the *next* line), `[plugin D/tag]` Log-shim lines ×~150, real failures at `info` level ×74. Three defects: **level was wrong in the hiding direction** (unprefixed → `info`, so `Read timed out`/`Connection reset` sat beside registration chatter); **nothing carried who printed it** (tag was right there, unused); **JUL records are two lines read as two events**.

`sidecarStderr.ts` now emits `source` (92.5% coverage) and (warn+ only) `cause` from the shared taxonomy. `cs3/extensionIssues.ts`: 5,407→~200 distinct problems, durable, third surface beside `Logger` (NDJSON per-launch transcript, answers "what happened") and `DiagnosticsLog` (one failure's tuple, answers "enough to paste"). Row key = `(cause, source, groupingForm(message))` — needs all three, stores **no URLs/queries/titles** (would be a viewing history).

Classification bugs found building it: **stack-frame line numbers read as HTTP statuses** (`RealCall.java:519` matched `server-error`'s 3-digit test, 23 miscounts — `classifyFailure` now strips source locations first, `groupingForm` keeps bare integers so `HTTP 403`≠`HTTP 404`); **taxonomy only spoke Node's dialect** (tested `ECONNRESET`, missed JVM's `SocketException: Connection reset`, 108 miscounts); **cancellations counted as failures** (79× — scope-closing throws on every in-flight scrape when a new query starts; `cancelled` is now its own unscored kind). Plus two "stack read as message" bugs: a `PluginHost` stack frame made every plugin crash blamed on the sidecar (`describe` now classifies from head + `Caused by:` only, never `at` frames); `InvocationTargetException` was the attributed source (now reads the plugin's own loader frame). **Rest of the linkage family was unclassified** — `NoSuchMethodError`/`IncompatibleClassChangeError`/`AbstractMethodError`/`VerifyError` landed in `provider-error` (blames the scraper for a method *we* failed to provide) despite this repo having 3 worked examples of exactly that shape. Two new unscored `FailureKind`s: `cancelled`, `resource-leak` (OkHttp leak warning — was **every unclassified record**, 159×; scrape succeeded, socket leaked).

**One regex bug found in the same pass**: `playbackSession.ts` had `/\b(\d{3})\b/` with `\b` literally replaced by backspace chars and the backslash eaten off `\d` — could never match, so `SourceCache.recordFailure`'s definitive-vs-counted HTTP-status parsing always saw "ambiguous." **Grep for `\x08` after any bulk edit — invisible in a diff.**

### Community extensions: round 5 + OTT lane (2026-08-31)

`Sushan64/NetMirror-Extension` (Netflix/Prime/Hotstar/Disney+ catalogues) verified: 2 members (`manifest.json`,`classes.dex`), 4 `MainAPI` subclasses registering **Netflix, Prime Video, Hotstar, Disney Plus**, all with `getMainPage`, loads `T1_DROPIN`. **Not `bundled`** — streaming half unverifiable from a cloud container (egress proxy 403s `CONNECT` to provider hosts); settle with `node tools/e2e/provider-e2e.mjs --repo NetMirror` on an ordinary network.

`NivinCNC/CNCVerse-Cloud-Stream-Extension` gave **round 5**: 18 load failures/5 classes → 16 in top 3:

| Missing type | Failures |
|---|---|
| `android.widget.CheckBox` | 7 |
| `android.content.Intent` | 6 |
| `android.app.AlertDialog` | 3 |
| `com.lagradost.cloudstream3.ui.settings.Globals` (`:app`) | 1 |
| Material `BottomSheetDialogFragment` (still outstanding) | 1 |

Underneath: `Drawable`(8), `Globals`(9). After all five: 18→1 failures, 29 providers registered. Rules: `Intent`/`AlertDialog.Builder` don't throw on construction (inert on Android too) — refusal sits on `startActivity`/`show`. **`Context.startActivity` stopped taking `Object`** (5th occurrence of the widened-supertype near-miss — see below). `CheckBox` needed 3 ancestors (`TextView`,`Button`,`CompoundButton` — ancestry resolved before defining). `Globals` is Kotlin in the bridge (Kotlin `object` + member extension function `fun Context.updateTv()` — a Java static-method class links against nothing), answers `PHONE` (desktop = pointer-driven windowed app). `Drawable` deliberately not abstract, no `draw(Canvas)` — every corpus use is as a type, never a base class.

### The `Object`-widening near-miss family — **8 occurrences on record**

**Rule: a parameter or return type widened to `Object` is not a type-safety loss, it renames the method** — an extension calling `getResources()Landroid/content/res/Resources;` against a shim declaring `()Ljava/lang/Object;` gets `NoSuchMethodError` at the call site; the shim's own careful refusal is never reached.

Occurrences: `Context.getPackageManager`, `Context.getResources`, `AccountManager.aniListApi` (typed as wrapper `SyncRepo` not `AniListApi`), `Context.startActivity`, `Application.ActivityLifecycleCallbacks`, `CloudStreamApp$Companion.setKey` (erased-generic `Object`), `AccountManager.simklApi` (typed `SyncRepo`/`SyncAPI` not concrete `SimklApi`), plus (2026-09-09, found by **enumerating instead of waiting for #8**) `Context.getAssets`, `Context.getContentResolver`, `Window.setBackgroundDrawable`, `Fragment.getResources` (last one = the *same* method fixed once already, missed on a second class). New shims: `AssetManager`, `ContentResolver` (concede the type, refuse every op, like `PackageManager`).

`RUNTIME_GENERATION` **12**. **`ShimSignatureTest` enumerates the rule**: no shim method may mention bare `Object` unless Android's own signature does, allow-list carries upstream's real signature per entry, **a stale allow-list entry fails too**. Verified by mutation; found nothing else (family is closed, not merely reduced).

Also: `UnsupportedAndroidApiException` now separates its `Class.method` aggregation key from its explanation (was folding prose into the key, defeating grouping). `errorKind` now classifies the **whole** `LinkageError` family (`NoSuchMethodError`, `IncompatibleClassChangeError`, `AbstractMethodError`, `VerifyError`, not just `NoClassDefFoundError`) — was `PLUGIN_ERROR` ("extension threw"), should be "our shim is wrong." `ExceptionInInitializerError` excluded (a plugin's own static-init throwing, despite being a `LinkageError` by inheritance).

### A saved page had nothing behind it (2026-09-09)

A library row carries a title, a poster and a year, copied when it was added, so the **list**
always looked right. The **page** behind it carried nothing — drawn entirely from what the
provider answered at that moment, and when the provider was switched off, uninstalled,
throttled or had changed its page shape since, that was nothing. Reported as "the app lost my
saved content". It was never lost; it was never written down.

`cs3/pageSnapshot.ts` writes it down. Captured in **`ContentService.load`** — the one funnel
catalogue, native-provider and extension pages all pass through, and the only side that knows a
provider's ancestry (`provenanceOf`). A page is kept by being *looked at*; saving or adding to
the library only **pins** it against eviction (`MAX_SNAPSHOTS` 600, unpinned LRU).

Stored: the display copy, the repository ▸ extension ▸ provider chain, the search query, and
**every address known to reach the work**. Those addresses are half the fix — a merged row's
`alternates` live only as long as the row is on screen, so a page saved in March had one
address in June and it was the one that had stopped working. `DetailView` now tries the row's
alternates *and* the snapshot's routes. **No playable link is stored** (that is `SourceCache` /
`PlayedSource`, which have deadlines; a page that opens and cannot play is worse than one that
re-resolves).

**The one rule: a later load may add and may correct, but may never blank.** A provider
answering with a title and no poster has said nothing about the poster; reading that silence as
"there is no poster" is what made a complete page degrade every time it was opened. Implemented
twice on purpose — `mergeSnapshot` (main) and `utils/savedPage.ts` `mergeDetail` (display) —
and both say so. Episode listings are all-or-nothing, never field-merged: splicing two partial
scrapes invents a season no provider offers.

The page draws from the copy **before** the provider is asked, so a revisit is instant; the live
answer folds over it. When every route fails the copy **stands**, with a banner naming the
reason and the copy's age, instead of the blank error screen offering to search for a title it
is already displaying. "Saved today" beside a failing provider and "saved 8 months ago" call for
different responses, which is why the age is stated and not just "saved copy".

Its own file, not the datastore (episode lists run to hundreds of rows; the datastore
round-trips through Android backups) — but **a backup section of its own**, since restoring a
library without the pages behind it reproduces the whole bug on a new machine. Only pinned rows
are exported; the rest is cache.

### The scope picker was a letterbox (2026-09-09)

330px wide, 300px tall, holding a search field, a reset row, three unlabelled rows of chips
meaning three different things, a progress line, a windowed three-level tree of several hundred
28px rows, two buttons and a sentence. Two distinctions were invisible in it:

1. **A filter is not a selection.** Chips narrow what the list *shows*; a ticked box narrows
   what the search *asks*. As adjacent rows of similar pills they read as one mechanism —
   someone who filtered to "Hindi" believed they had scoped their search to Hindi providers.
   Now: separate panes, separate headings, and one line in the rail saying which is which.
2. **Which facet a chip belongs to.** Twelve language chips beside six type chips separated by
   a hairline does not express "OR within a facet, AND across facets". Each facet is a labelled
   group.

Plus **which sources are actually scoped**: a count answers "how many", never "which", and the
current scope is now a strip of chips that each remove their own source.

`search/SourceScopeDialog.tsx` (presentation) + `search/sourceScopeModel.ts` (pure, tested);
`SearchScopePicker.tsx` keeps all data/state and is the trigger. Real `tree`/`treeitem` with
roving focus via `aria-activedescendant`, arrows stepping over label rows, Left/Right
collapse/expand, Space to tick, focus trap, focus restored on close. **Escape is handled in
capture phase** — `VideoPlayer` binds Escape on `window` as "leave playback", and a dialog that
lets it through closes a film along with itself (§"Escape closed the film"). Viewport height is
**measured** (`ResizeObserver`), not a constant: the dialog is sized in `vh` and a constant
mounts invisible rows on a laptop or leaves a blank band on a large display.

`stateOf`'s vacuous case is the tested one: a row with **no members** must read `off`, never
`on` — an extension that registered nothing would otherwise draw as ticked, advertising a scope
that queries nothing.

### Updating an extension left its providers dead until restart (2026-09-09)

`installPlugin` tells the sidecar to `unload` before replacing an archive, and told **nothing on
this side**: `liveInJvm` still held the name, so the next `activate` returned `true` without
loading, and `registry` still described bytes no longer on disk. Every layer reported success
and the extension answered nothing. `forgetLoadedExtension` drops all four claims — live set,
registry row, provider entries, runtime report — **paired with the `unload`**, not placed after
the rename, so a rename that fails cannot leave a live claim either.

Same pass: every install ran `providersLoaded = false; loadProviders()`, a whole-catalogue
re-read, so "update all" across twenty extensions was twenty passes of work unrelated to what
changed. Only the replaced archive is reactivated now — which is also the only correct thing
once its registry row is gone.

**"Up to date" was wrong for exactly the extensions that had stopped working.** Maintainers here
fix a scraper and republish without touching `version`. A same version with a different
published hash is now an update, labelled `reason: 'republished'` so the UI says "v7 rebuilt"
rather than "v7 ➔ v7". Compared **only when both sides carry a hash for the same lane** — no
hashes anywhere would otherwise re-download the catalogue on every check, forever.

Also: pressing Update with a cold cache answered "check for updates first", a dead end made
entirely of our own bookkeeping — `resolveUpdate` asks the extension's own repository first, and
`updateAll` runs a check rather than iterating an empty list and reporting a successful update
of nothing.

**The maintainer's own status is the ecosystem's health mechanism**, and the check re-fetched it
every run and discarded it. An installed extension its author marks `status: 0` now produces an
`ExtensionNotice`. Deliberately **information, not an action**: switching off a source someone
chose, on the strength of a number in a JSON file, is the silently-punitive behaviour the
ranking exists to avoid.

### The fan-out asked whoever was installed first (2026-09-09)

A search runs 8 providers at a time and works through the rest as lanes free; the order was the
provider registry's, i.e. install order. That order decides how long the screen stays empty — a
lane timing out on a dead provider is a lane not spent on one answering in 350ms. `ProviderAnalytics`
has been measuring success rate and latency all along and `ProviderRanking.rank` turning them
into an order that **only a settings panel read**. `searchEach` reads it now.

`cs3/searchOrder.ts` is a module rather than one line because of its guard: an ordering that is
not the **same set** — one dropped, added, duplicated behind a plausible length, or a throw —
falls back to the original. A ranking is scored from noisy scrapes through stored weights and a
smoothing prior; that is more machinery than a search should trust with "which providers am I
searching". Silently searching fewer sources and reporting it as "no results" is the worst
failure this app has, and reaching it through an optimisation is worse.

**The warm-up competed with the searches it exists to speed up.** Serial is not the same as out
of the way: it keeps the sidecar's bounded pool busy with a 56-jar classpath while eight scrapes
queue behind it. It now waits **between archives** (never mid-archive — a half-registered
provider) while any search runs, bounded at 120s so a continuously-searching session still warms
up, falling back past that to exactly the prior behaviour.

### The browser's answer was always a moment too late (2026-09-10)

The reverse channel carries one deadline and both ends spent it. The JVM waits
`timeoutMs` in `HostChannel.call`; `WebViewHost.resolve` took the same number as
its *work budget* and drove Chromium for all of it. So an answer produced at the
end of the budget arrived after the only thread that wanted it had stopped
waiting, and `HostChannel.complete` dropped it — "a reply with nobody waiting"
is its own documented normal case.

Counted over three sessions of ordinary use, from the app's own log:

| | |
|---|---|
| resolves | 214 |
| matched | 49 — **every one inside 6.5s** |
| ran to the full 15s budget | 165 |
| of those, answered at | 15021–15273 ms, against a 15000 ms wait |
| of those, kept | **0** |

Forty-one minutes of browser work in three sessions, thrown away tens of
milliseconds past the line, having already cost the viewer the entire wait. With
`MAX_CONCURRENT` at 3 those waits queue, so a season pack's worth of links spends
minutes discovering nothing on purpose. **This is most of what "it just sits
there and then says no sources" means on a provider that needs a browser** — and
it is not a browser that does not work: `hgcloud.to` matched 49 times out of 49.

`cs3/hostDeadline.ts` (pure, 10 tests) states the rule the channel was missing:
**the side doing the work finishes first, so the side waiting for it is still
listening.** The repository already says this in the forward direction —
`Main.timeoutFor` gives a plugin call ten seconds less than the RPC carrying it
so that "the inner one wins" and the message can name the provider that hung.
The reverse channel was built four months later and never got it.

The reserve is flat (1.5s) because what it pays for is flat — serialise, one
pipe write, one parse on the stdin reader — and it is sized far above the
measured overshoot because that overshoot is not the round trip. It is our own
timer firing late while three Chromium pages and a transcode compete for the
machine, and a margin that only just covers an idle host is not a margin. It is
capped at a quarter of the deadline so a caller asking for little still gets
most of it to work in.

`webview_resolve` now logs `budgetMs` and `deadlineMs` beside the duration.
Without them a late answer and a slow site are the same line, which is why this
survived from 2026-08-24 to now.

### A page that needs a click, and what Android actually does about it (2026-09-10)

Reported as: `hblinks.co`, `new4.filepress.baby`, `new3.gdflix.io` all open fine
in a browser and lead to a real file after a step or two, and the log throws them
away —

```
INFO M3u8Helper: M3u8 Playlist is not a "Master Playlist" nor a "Media Playlist".
Removing this link as it is invalid: https://hblinks.co/archives/105234
```

**We already have what Android has, and it is worth writing down so nobody ports
it twice.** `loadExtractor` in `library-jvm` 4.8.0 tries three things in order,
and all three are in `commonMain`, so the JVM build has them and our shipped
`library-jvm-4.8.0.jar` contains the classes (`ShortLink`, `Levenshtein`,
`ExtractorApiKt$loadExtractor$*` — checked in the jar, not assumed):

1. `unshortenLinkSafe` — walks known shorteners before matching.
2. Prefix match with the scheme stripped.
3. **`Levenshtein.partialRatio(mainUrl, url) > 80`** — a deliberate fuzzy pass,
   commented upstream as "to match mirror domains - like example.com,
   example.net". This is what lets an extractor registered for `hblinks.dad`
   claim `hblinks.co`, and what makes the wildcard `mainUrl`s the corpus is full
   of (`https://*.gdflix.*/`, `https://new15.gdflix.*/`) work at all.

The only jvm-side `TODO("Not yet implemented")` in that library is
`WebViewResolver.jvm.kt`, which the bridge already shadows. So the M3u8Helper
lines above are the extension's own behaviour and appear identically on Android:
that provider hands those URLs to `M3u8Helper` directly rather than through
`loadExtractor`, and an `Hblinks` extractor is registered and never invoked.
**Not a desktop gap, and not ours to fix by porting.** What *was* ours is the
previous section: those hosts are exactly the ones a browser has to finish, and
the browser's answers were being discarded.

### The 18+ filter had no chip, and one of its repositories had no plugins (2026-09-10)

Two unrelated halves of the same complaint.

**The chip.** `TYPE_TABS` left `NSFW` out, reasoning that a tab for it would
appear for people who never asked. But `tabsFor` right underneath builds tabs
from the results in hand and drops any that would be empty, and adult providers
are withdrawn before results are ever built. With the gate off there are no such
rows and the tab cannot exist; with it on the rows arrive and could only be
reached through "All", mixed into everything else. The stated reason was already
handled by the mechanism below it. The scope picker never had this problem — it
derives its facets from `supportedTypes` on whatever providers are visible, so
its chip has always appeared and disappeared with the gate.

**The repository.** Of four adult repositories in the catalogue, three answer
(`cxxx` 69 extensions, `gizlikeyif` 111, `codegeasse` 34 — probed live). The
fourth, `cloudstream_18plus`, was marked `verified: false` on 2026-09-07 because
its plugin list 404s. It still does: its `repo.json` wrapper points at a *third
party's* list (`Rowdy-Avocado/18plus-Extensions`) that has gone. The repository's
own `builds/plugins.json` is alive and carries **49 extensions**, so the entry
now addresses that directly as a `pluginList` — which is what `documentKind`
exists to express. Turning the gate on reaches 263 extensions rather than 214.

### Round 6, one class: `android.widget.Toast` (2026-09-10)

Eleven `NoClassDefFoundError: android/widget/Toast` in one user's sessions. The
cost is out of all proportion to what the class does, for round 3's reason:
`Class.getMethod` resolves every public method's parameter and return types, so
an extension that merely *declares* a method mentioning `Toast` fails while
being described — after it has already registered — and the whole load is
abandoned naming a class nobody called.

**It is the first widget shim here that does not throw on use.** A dialog is
load-bearing: the flow stops and waits for an answer, so pretending it appeared
would let a provider act on a choice nobody made. Android's `Toast.show()`
returns immediately, tells its caller nothing and cannot fail, so a provider that
posts one has no branch depending on it — refusing would convert a call with no
consequences into an aborted scrape, in the one case the extension author could
not have written differently. The text goes to stderr in the `Log` shim's shape
instead, where `sidecarStderr` classifies it and the issue ledger counts it. Not
displayed, but not discarded. `RUNTIME_GENERATION` **14**.

### Two of three transports could not fail their way back (2026-09-10)

The failover ladder — element `error` → re-decide with `force` → route to mpv →
skip the source — was wired to the `<video>` element only. hls.js's fatal error
handler read, in full:

```ts
hls.on(Hls.Events.ERROR, (_evt, data) => {
  if (data.fatal) setError(`Playback error: ${data.details}`);
});
```

A dead end, and Shaka's `.catch` was the same shape. So `Playback error:
fragParsingError` was the whole of what a viewer got from an HLS stream whose
segments had downloaded intact — with mpv idle, the ffmpeg path untried and the
next candidate never reached. **This is the reported "it downloads but it will
not stream"**: the transport that fails most often was the one with no way back.
Measured case: Castle TV's MPEG-TS ladder, which mpv opens without comment.

`src/components/player/playbackRecovery.ts` (pure, 16 tests) decides by *what
would change the outcome*: nothing arrived → fetch again within a budget; bytes
arrived and could not be read → hand to another engine (re-fetching identical
bytes produces an identical refusal); budget spent → the source is genuinely
unplayable. `fragParsingError` escalates on sight; `bufferStalledError` gets one
`recoverMediaError()` first. 403 is still retried, 404 is not — same rule as
`SourceCache`.

**Three separate "the error outlived the failure" bugs** in the same pass, all
producing the reported "it says it cannot stream while mpv is playing":

1. `setError(null)` sat **below** the `NATIVE_MPV` early return in the attach
   effect. The session gives up on source A, advances to B, B comes back
   `NATIVE_MPV`, the effect returns one line later — and A's message is still on
   screen over B playing perfectly. Clear before the branch, not after it.
2. `NativeEngineStage` renders `null` for as long as it holds an error and had
   no way to clear one, so a failure on the way to playback left a blank stage
   under an error panel. It now clears on `state === 'playing'` **for its own
   `url`** — a late snapshot describing the previous source must not retire this
   one's failure.
3. The `[streamUrl]` reset effect reset every ref except the error.

Also: a `playing` listener on the element clears the error, because `play` fires
when `play()` is *called* and only `playing` means frames are being presented.

### A search cost what its worst indexer cost (2026-09-10)

Every indexer got a flat 20s and they all ran at once. The circuit breaker made
that cheaper, not cheap: three consecutive failures to open, so a permanently
blocked scraper cost three full timeouts before being skipped, then five minutes
later cost three more.

`torrent/indexerBudget.ts` (pure, 22 tests) decides from measurement:
- **Deadline = p90 of that indexer's own recent successes × 2.5, clamped
  [4s, 20s].** No history → the full budget; judging a source before it has
  answered is how a slow-but-working one gets designated dead. p90 not mean, so
  an occasional 3s tail is inside the budget rather than becoming a timeout that
  counts against it. **Only successes shape it** — else timing out buys a longer
  deadline.
- **A timeout weighs 1.5× an error** toward tripping. A 404 costs one round trip;
  a timeout costs the whole search.
- **Cooldown escalates** 5m → 15m → 45m → 2h, and **any success resets the
  ladder** — an indexer that recovered is not on probation months later.
- Fastest-first ordering, with **unproven ahead of recovering** (putting the
  unproven last is how a new indexer never accumulates history).

The aggregate also stops waiting for stragglers (`STRAGGLER_GRACE_MS`, floored
by `MIN_SEARCH_MS`). Nothing is cancelled and no result is lost — every indexer
runs to its own deadline and still reports through `onProgress`. This bounds the
*wait*, not the work.

### A Cloudflare challenge looked exactly like a ban (2026-09-10)

`requestOnce` threw `HTTP 403 Forbidden` for a challenge, a country block and a
hotlink refusal alike; `withRetry` does not retry a 4xx; three of those skipped
the indexer. **Worse: Cloudflare's managed challenge is routinely served as HTTP
200** with an interstitial body — cheerio parsed zero rows and the adapter
reported "no results", a search that silently got smaller.

`torrent/botChallenge.ts` (pure, 17 tests) separates challenge / block /
rate-limit, and `WebViewHost` — which has solved these for `.cs3` extensions
since 2026-08-24 and which the torrent lane could not reach — now solves the
solvable ones once per host via `setChallengeSolver` in `main.ts`. Rules:
- **A block or a rate limit never opens a window.** A browser passes neither, and
  at a rate limit it makes things worse (a dozen subrequests where the scrape
  made one). `503` + `Retry-After` is checked *before* the challenge markers.
- A 403 behind Cloudflare with **no body to read** is given the benefit of the
  doubt — guessing "block" costs a working indexer, guessing "challenge" costs
  one browser window that finds out.
- Challenge markers are narrow: a listing page whose footer says "secured by
  Cloudflare" is a working page.
- **The clearance is sent with the User-Agent that earned it** (they are bound)
  and is **held in memory only** — restoring one from disk onto a new IP
  produces a failure indistinguishable from a fresh challenge.
- `fetchDocument` is separate from `fetchText`: HTML scrapes send what Chrome
  actually sends (`Sec-Fetch-*`, `Upgrade-Insecure-Requests`, a real `Accept`),
  and RSS/JSON endpoints must **not** be asked for a document. The UA has always
  claimed to be Chrome while the request beside it asked for a wildcard `Accept`
  with no fetch metadata — a combination no Chrome produces, and exactly what
  bot detection scores.

Added TokyoTosho and AniDex, both **off by default**: the anime lane had one
broad source (Nyaa) and a spare that aggregates it (AnimeTosho), so one outage
took both — and Nyaa's `c=1_2` filter removes raws and non-English releases
before a query is typed. **Neither has been driven against a live host.**

### "All sources" was a way to lose your selection (2026-09-10)

The scope picker's All-sources button was `persist(new Set(), new Set())` — an
*erasure*. Eleven providers picked out of two hundred, gone on one press, with
no undo and no record of what was lost.

**All sources is a mode now, not an erasure.** `cs3/sourceProfiles.ts` (pure, 30
tests) holds three things that can drive the scope: All sources, a saved profile,
or the unnamed draft — and the draft survives every switch. Rules worth knowing:
- Editing while a profile is active edits **that profile**; editing while All
  sources is active writes to the **draft**, never into whichever profile was
  last used.
- Deleting the active profile falls back to **All sources**, never to the next in
  the list — silently searching a different user-defined set is worse than
  searching everything, because only one of those is obvious from the button.
- **A facet filter alone is not a narrowed scope.** Facets decide which rows the
  picker shows; a button reading "1 source" over a search of two hundred is the
  lie `SearchScopeStore` was fixed to stop telling.
- A profile may narrow the adult gate and can **never** widen it.
- A corrupt stored record degrades to empty rather than throwing.

An upgrading user's existing `SearchScopeStore` selection is adopted as the draft
on first use (`adoptExistingScope`), deliberately not at construction — doing it
at startup would silently widen the next search.

### Providers were being scored for things that were not their fault (2026-09-10)

The ranking's guards lived in the **callers**: `loadLinksDetailed` wrote
`if (kind !== 'provider-missing')` out by hand and `searchEach` had none at all,
so whether the ranking followed its own two stated rules depended on which call
site produced the failure — and `searchEach`, the busiest, followed neither.

**`UNSCORED_FAILURE_KINDS` is now in the taxonomy and `ProviderAnalytics.observe`
consults it.** A failure of an unscored kind is **not recorded at all**, not
recorded-and-discounted: counting it in `attempts` alone still moves the success
rate, which is the number the ranking is built on. Members: `cancelled`,
`provider-missing`, `resource-leak`, and now **`unsupported-operation`**.

Measured on one real search: Disney, Marvel, Pixar and Star Wars are
catalogue-only providers, each answered "does not implement that operation", and
each was recorded as a failed search — four permanent penalties per query against
providers working exactly as designed, plus four sentences in the message the
viewer reads. They have their own `SearchSourceOutcome` state now
(`unsupported`), read "Browse only — this source has no search" in grey, and
`explainEmpty` excludes them when deciding whether *all* sources failed.

**A cancellation with no message was filed as an extension crash.**
`kotlinx.coroutines.JobCancellationException` — the bare class name, which is
what `describe()` produces when the exception carries none, and a cancelled
coroutine carries none — classified as `provider-error`. The word-boundary form
needed a non-word character after "Cancellation" and found `E`, and one before
it and found the `b` of "Job". The one shape this actually takes fell through
both. **Found by writing the test, not by reading the regex.**

**A guess we made was blamed on the provider.** `extensionSources` calls
`loadLinks` before `load` — correctly, since plenty of providers' link handle is
a page address. For the ones whose handle is their own JSON, that first call
throws inside the provider (`JsonParseException: Unrecognized token 'https'` —
BollyFlix, HDO, CineSimkl, three sessions, one shape). The retry works and the
viewer gets their film, while the doomed first call was logged at error level as
"the site has probably changed" and counted against the provider.
`looksLikePageAddress` is the mirror of `looksLikeLinksHandle` and marks that
call **speculative**: still made, still diagnosed (when the retry also fails it
is the only account of what the viewer asked for), logged as a guess at `warn`,
never scored. A test pins that the two predicates can never both be true.

### The ranking was measured for a screen nobody opens (2026-09-10)

Success rate, latency, whether links resolve, whether anything played — measured
since `providerRanking` was written, read by exactly one settings panel with
eight weighted criteria and a re-weighting slider. That panel is right for tuning
the ranking and wrong for the person looking at two hundred providers wondering
which to switch on.

`src/components/search/providerHealth.ts` (pure, 12 tests) puts Excellent / Good
/ Average / Poor on the provider rows in the scope picker. It reads
`score.band` rather than re-deriving one — **two places computing "is this any
good" is how the settings panel and the source list come to disagree in front of
one user**. `unproven` keeps its own answer and is never folded into the middle
of the scale: on a fresh install that is every provider, and a label reading as
mediocre is the silently-punitive behaviour the ranking exists to avoid.
Unmeasured rows draw **no badge at all**. A pinned or blocked provider is
described as a choice, not measured as a quality.

### The adult gate needed a middle (2026-09-10)

Two states could not express what someone on a shared machine wants: these
providers installed and working and *not on screen by default*. `off` throws away
the configuration; `on` leaves it in front of whoever opens the app next. `ask`
keeps the setup and starts every launch hidden.

**The unlock is a field, never a datastore key** — one that survived a restart
would make `ask` into `on` with extra steps, which is the opposite of what it is
chosen for. `unlockAdultForSession` refuses unless the mode is already `ask`:
the channel is reachable from the renderer and revealing must never become a way
to change the setting, which is where the consent step lives. The old boolean is
migrated from and kept in step on every write, because it is a datastore key and
therefore travels in Android-format backups — leaving it stale would restore an
install whose two records of one decision disagree. `isAdultAllowed()` keeps its
signature, so the single funnel through `enabledProviderNames` is untouched.

### Two other things, same pass (2026-09-10)

**`.btn-ghost` had no colour and nothing set `color-scheme`.** `.btn` declares
none either, so twenty ghost buttons fell through to Chromium's `buttontext` —
near-black on `--bg-card` — along with every native `<select>` popup. Reported as
the Reset button's contrast; it was every one of them. `.btn` also had no
`:disabled` rule while a dozen bespoke buttons in `sources.css` each grew their
own, so Reset looked pressable in the state where it is disabled. **The app is
dark-only and had never told the browser so.**

**Pressing Download can ask first** (`ask` | `immediate`, default `immediate` —
the delete prompt asks because deletion is unrecoverable; a download is a
cancellable transfer). The gate is in `App.handleEnqueueDownload`, the one funnel
all four press sites reach, and it works by resolving a promise the callers
already awaited — so nothing on their side changed. `download:preview` supplies
the real destination; a path composed in the renderer would be wrong exactly when
it matters, on the second release of a film already downloading.

**The always-on-top pin left the player's transport row.** It changes nothing
about playback, applies only while minimised, and `PlayerSettings` has had the
same toggle all along.

### Two Play buttons that could not remember (2026-09-09)

1. **A links handle stored as a reopenable page address.** `App.handleQuickPlay` and `DetailView.handlePlaySource` (2 of 3 renderer call sites) wrote `episode.url` (opaque `loadLinks` blob, often JSON) instead of a page address into `progress.mediaUrl` — series played this way always wrote a dead address, and disabled next-episode prefetch. Fixed centrally: `LibraryStore` refuses a links-handle on the way in (progress keys on `canonicalKey(title,year)`+season+episode, never the URL — nothing lost).
2. **Play always restarted a series at episode one.** `src/utils/resumePoint.ts` (pure): **null episode means "Play"** (not "play series URL"); the rule is **furthest episode with history wins**, never most-recently-updated (else re-watching an early episode of a finished show sends every later Play backwards).

### Escape closed the film (2026-09-09)

8 components each had their own dismiss-on-outside-click effect; `VideoPlayer` binds `keydown` on `window`, Escape = "close open panel, or leave player." 5/8 listened on `document` in bubble phase without stopping the event — menu handled Escape, then the player (last stop in bubble path) handled the same Escape with no panel open → `onBack()`. `useDismissable`: capture phase, `stopPropagation` **only when it actually closed something**; `pointerdown` not `click` (click fires after release — outside-click-close + trigger's own toggle would reopen it).

### The injected fetch is not optional (2026-09-09)

`torrent/http.ts` swaps in Electron's `net.fetch` (honours `app.configureHostResolver` + system proxy) — **Node's `fetch` honours neither.** 5 call sites used global `fetch` (both AniList queries in `metadataProvider`, seasonal-anime in `homeProviders`, OTT catalogue, mpv release feed) — DNS-over-HTTPS setting silently did nothing for them. **`externalPlayerControl` keeps global `fetch` deliberately** (loopback VLC control, no DNS/proxy involved). Rule: **anything reaching a third-party host goes through `torrent/http.ts`.** Also fixed: `OttCatalogService`'s films/series catalogues fetched under `Promise.all` — one 404 rejected both.

### Provider catalogues: `getMainPage` (2026-08-31)

No bridge path existed for `MainAPI.getMainPage` — apps could search/open but not browse. `ProviderBridge.mainPageSections` (needs the plugin loaded) + `mainPage` (fetches one page of one row), via `providerMainPageSections`/`providerMainPage` → `PluginManager.loadCatalog`/`loadCatalogPage`. Request travels as separate primitives (row handles are opaque strings with delimiters — packing would need escaping). A provider answering with several rows: only the row asked for is used (others would put unpageable rows on screen). `page` is **1-based** (0 = "no such page" upstream).

### The OTT platform destinations (2026-08-31)

`cs3/ottPlatforms.ts` maps provider names → Netflix/Prime Video/Disney+ Hotstar/Disney+/Sony LIV/ZEE5/JioCinema by **name matching only** (no other identity exists). Too-loose is far worse than too-tight (silent wrong-content fill vs. a renamed provider merely disappearing) — exact names win first, patterns anchored against known false positives (`PrimeWire`, `Ahashare`, `Netfilm`). Pinned overlaps: `Disney+ Hotstar`→Hotstar, `JioHotstar`→Hotstar; Disney pattern has trailing `m?` (CNC Verse suffixes every provider with `M`). **Sony LIV/ZEE5/JioCinema have no dedicated provider** — fall back to aggregate scrapers (MovieBox, CNC Verse) that advertise coverage, **fallback never merge**. Four availability states (`ready`/`disabled`/`aggregate`/`missing`) — collapsing to "no content" would tell a user who disabled a provider that the platform doesn't exist. A platform is a **set** of providers (name collisions resolved first-wins via `unavailableReason`). Search from a platform page uses `SearchOptions.providers` override, **never written back to the stored scope**. Browse asks **one** provider (editorial "Trending" rows from two providers would interleave into neither's meaning); first publisher wins browse, rest still searched; paging is a button (each page = a live scrape).

### A component built and never mounted (2026-08-31)

`ExtensionUpdates` was fully wired IPC-wise and imported by nothing — third direction of this failure (channel invoked-never-registered; registered-never-invoked; now component-built-never-mounted), invisible to `tsc`/every test. `src/componentReachability.test.mts` closes it lexically (mutation-verified). Orphans allow-listed **with their superseding component** (`MediaComponentsCard`/`RuntimeProvisionerCard`→`UnifiedComponentManager`, `ProviderSelector`→`SearchScopePicker`) — an allow-list entry without a reason becomes precedent; a second test fails on stale entries.

### Ranking on the maintainer's own status (2026-08-31)

Fresh installs had every criterion `null`, neutral-midpoint scores, arbitrary order. Repository indexes carry a per-plugin `status` (0 down/1 ok/2 slow/3 beta) already parsed into `SitePlugin.status` and unread. Weighted **0.4**, `minSamples` **0** (a declaration isn't a sample; requiring samples would exclude it forever), loses to real counters the moment those exist. `ProviderRanking.setContext` supplies it post-construction (avoids a construction-order cycle with `PluginManager`).

### Results that resolve to nothing are held back (2026-08-31)

`src/utils/deadRows.ts`. **`app-error` is never hidden** (our own failures must stay visible or a translation bug looks like a hundred broken providers). Whole page never hidden. Count is stated with the hidden rows one click away.

### 5.1 The end-to-end harness — `tools/e2e/provider-e2e.mjs`

```
node tools/e2e/provider-e2e.mjs                       # all repositories
node tools/e2e/provider-e2e.mjs --repo MegaRepo       # one
node tools/e2e/provider-e2e.mjs --plugins 3 --queries "one piece,dune" --json report.json
node tools/e2e/provider-e2e.mjs --list
node tools/e2e/provider-e2e.mjs --repo phisher --only TorraStream,Ultima
node tools/e2e/provider-e2e.mjs --lane cs3            # force DEX artifact, skip jar lane
```
Drives the full chain: repo JSON → `.cs3` download+SHA-256 → DEX→JVM → `load()`→`search()`→`load()`→`loadLinks()`→ a 2MB range-GET off the real host, against Kraptor123/cs-kraptor, Bnyro/GermanProviders, Sushan64/NetMirror-Extension, NivinCNC/CNCVerse-Cloud-Stream-Extension, phisher98, rockhero1234/cinephile, self-similarity/MegaRepo. Exit 0 requires bytes, not just search results; `PARTIAL` = scraped but no link played. Talks stdio JSON-RPC directly to the sidecar, **no Electron** — pass+app-fails = bug in `cs3_windows/`; harness fails = bug in runtime/extension.

`fileHash` is `sha256-<hex>` — strip the prefix before comparing (app does via `installPlugin`).

**Where it still stops**: real extractors fail on *hosts* (Voe "encoded string not found", Vidsonic gets HTML expecting hex) — bot-protected, WebView territory, not translation. Don't weaken the extractor path to "fix" this.

Repository URLs are project pages resolved to raw documents by probing branch/filename combos (`master/repo.json`, `builds/repo.json`, `builds/plugins.json` all in use).

**Never reintroduce a synthetic/placeholder source.** Empty list + a reason, always.

### Source discovery asks the originating provider first (2026-08-22, widened 2026-09-02)

Android returns one search row per provider, binding Play to that provider alone. This app merges rows across providers/catalogues (correct — one film shouldn't be seven rows) but `runDiscovery` used the merge as licence to fan out to **every** enabled provider+indexer, drawing 200 sources for a title 2 providers actually carried. `cs3/sourceScope.ts` restores the binding: default scope **`origin`** = only the providers whose results produced this row, no indexers; explicit **`all`** = everything. `cs3ext://` rows were always scoped correctly (the divergence only existed on merged catalogue rows). `origin` widens to `all` automatically when nothing claimed the title (home-screen items). Scope is part of the cache/in-flight key.

**Auto-widen when origin finds nothing** (`shouldEscalateScope`/`ContentService.escalateToAllSources`, 2026-09-02): reported case found 137 sources (81/98 live links) behind a dead-end "Find more sources" button the app could have pressed itself. Goes through `getSources` (joins the shared in-flight map — a manual press during auto-widen doesn't double the fan-out); two independent recursion guards (`canWiden` already false at `all`, nested call passes `autoWiden:false`); **a failed escalation leaves the narrow (already-computed) answer standing**, never surfaces a worse error; fan-out's `load(base)` allowed to fail when the title is already known (escalation is enrichment, not discovery, once titled); prefetcher passes `autoWiden:false` (opening a detail page isn't a play commitment) and it's part of `sourceKey` (else Play would join a settled-for-narrow prefetch). `SearchProgress.widened`/`PlaybackSnapshot.widened` explain the (up to 3x) longer wait live. `explainEmptyResult` takes `escalated` to avoid re-suggesting an already-taken step.

### Search scope: selection is a strict filter, not a preference

Old: an unresolvable stored selection silently widened back to *everything* (`kept.length > 0 ? kept : candidates`), and the picker could offer fake provider names for extensions registering none — user picks 1 source, app queries 200. Now strict; unresolvable selections **reported** (`missingProviders`/`missingIndexers`). Rules in `SearchSession.plan()`: nothing selected → global (every provider + metadata catalogues); providers selected → exactly those, **no catalogues** (would reintroduce excluded sources under another name); indexers selected → title-searched directly. Hierarchy is exactly **repository → extension → provider** (provider = selectable leaf, globally-unique name = scope identity = `cs3ext://` address = enable/disable key; a name collision is real, first wins, loser reported via `unavailableReason`).

### The extensions screen: `src/components/extensions/`

Reconstructed 2026-08-21 (originally rebuilt 2026-08-14 as one 2,689-line component, 25 `useState` hooks, lost to an ignore-rule bug, six files restored from the author's machine 2026-08-22: `primitives`, `FilterBar`, `BulkActionBar`, `ProvenancePanel`, `CompatibilityReport`, `useExtensionFilters`; container/views/`useExtensionCatalog` reconstructed fresh — originals won where overlapping). Key fixes vs. the pre-2026-08-14 state:
- **Disable ≠ uninstall, both now work** — `removeRepository` used to delete only the URL, leaving installed extensions running. Removing now cascades to uninstall; `setRepositoryEnabled`/`setExtensionEnabled` are the reversible alternative (keeps archives, no re-download).
- **Enable cascade lives in `enabledProviderNames` only** — every consumer funnels through it once. `getProviderTree` recomputes the identical predicate as `effectivelyEnabled`; **if they disagree, the screen lies about what a search will ask.**
- `enabled` vs `effectivelyEnabled` deliberately separate (a provider off because its repo is off must show the responsible ancestor, not look self-disabled).
- Tag filters multi-select, derived/counted from installed data (old: hardcoded 3-option `<select>`, silently omitted NSFW/Live/Documentary/etc). **OR within a facet, AND across facets.**
- Providers tab removed (was a second, desyncing copy of the tree's leaves).
- Install progress is real (`onExtensionInstallProgress`; old code faked a scripted 250ms `setTimeout` sequence, +500ms invented delay per action).
- Provenance (`repository ▸ extension ▸ provider` chain, maintainers, version, types, hash) on every row.

**`SearchScopePicker` filters on `effectivelyEnabled`, not `enabled`** — must keep doing so (a repo-disabled provider offered by name would search nothing and self-report via `missingProviders`).

### Sources found while the page is being read (`cs3/sourcePrefetcher.ts`)

Play used to start a 15-provider scrape from cold; the detail-page reading window is free time to do it in. Safe only because of **in-flight sharing** (`sharedDiscovery.ts` — else Play would double every scrape): cancellation is by **consensus** (every caller's `AbortSignal` must withdraw); an aborted run is never joined (stays in the map until settled). Restrained: waits ~1.2s settle, skips on `hasFreshSources` (a `peek`, doesn't promote), one at a time (supersedes), togglable for metered connections. Detail page shows state ("3 sources ready"/"Finding sources…"); `waiting`/`idle` render nothing (no badge for a mere glance).

### The mini player: `<video>` is never remounted

Minimising is a **CSS geometry change to an element that stays mounted** (unmounting stops the stream, loses position, renegotiates the swarm). Chrome hidden with CSS, not conditional rendering (would lose open-panel/scroll state). Keyboard shortcuts disarmed in mini (space in a search box elsewhere mustn't pause). Drag/resize is owned, not `resize:both` (can't hold aspect ratio; handle is **top-left** since a corner-parked window's bottom-right handle would be off-screen). `useMiniFrame` clamps on window resize.

### The home screen is discovered, not hardcoded (`cs3/discovery.ts`)

Old: 3 fixed searches ("Spider-Man"/"One Piece"/"Stranger Things") against every provider, called "Trending" — a category error (scrapers have no popularity opinion) plus the slowest scraper's timeout on every launch. Now: keyless Cinemeta (`cinemeta-catalogs.strem.io/{top,year,imdbRating}`, IMDb-keyed, 19 genres, pageable via `skip`) + AniList seasonal anime (kept separate from the Animation genre — IMDb's "Animation" is mostly Western film). No API key ever (TMDB/Trakt/OMDb/Fanart/TheTVDB all eliminated — embedded key = licence violation + gets revoked). **Stale-while-revalidate** (cached sections render instantly, replaced a second later). **Finds nothing playable** — sources resolve only when a title opens. Personalised rows come from local-library genre counts (nothing about the user leaves the machine — only the catalogue URL choice is affected).

### Search scope: why it looked empty until you searched

Picker's menu-open fetch loaded **every installed extension into the sidecar first** (minutes of DEX translation, no progress shown) — searching "fixed" it only because search awaited the same load. Fixed: `getSearchScopeOptions(false)` on mount (instant, from what's already registered) vs `(true)` on open (pays the cost with visible progress via `extension:providerLoadProgress` per archive). Facets added (content type/language/extensions-vs-torrents), same OR/AND rule as extensions screen.

### Provider ranking rules (`providerAnalytics`/`providerRanking`/`providerRecommendations`)

1. `empty` ≠ `failure` (an anime provider with nothing for *Dune* is correct; merging would bury specialists).
2. Smoothed toward a neutral prior (else self-fulfilling: one lucky 100% beats 95%-over-400-calls and gets asked first forever).
3. No-data criteria excluded from denominator, never scored zero.
4. **Nothing is ever auto-disabled** (auto-*enable* is opt-in, score+sample-gated). A week-long outage isn't consent to remove a user's chosen source.

Settings panel shows every number/sample-count + an erase button (opaque reordering breeds distrust).

### Floating playback: three mechanisms, not one setting (2026-08-31)

Four modes (`mini`/`floating`/`pip`/`background`) as a **choice**, not a scale — different mechanisms, different reach:

| Mechanism | Moves | Works when |
|---|---|---|
| In-app mini window | nothing (CSS) | always, this app frontmost |
| Native PiP | `<video>`'s surface, to an OS window | only while the element is what's playing |
| App window always-on-top | window level | always |
| mpv `ontop` | window level | only while mpv holds the stream |

PiP is unavailable for exactly what this app most often plays (mpv/VLC handoffs render in their own windows, no element to detach) — `isPipSupported` checks readiness AND that the native engine isn't holding the stream; the window pin exists for that case. Element never remounted in any mode (audio-only hides picture via `visibility` not `display` — layout removal can stop decoding on some builds). Pin unapplies itself on unmount. `audio-only` genuinely stops decoding on mpv (`vid=no`) but is a no-op saving on the element (states this in its own help text). PiP rejection reasons surfaced as sentences (silent no-op buttons are the worst UX).

### Downloads: state machine

**aria2 says `complete`, not `completed`** — a literal string-comparison typo meant `pollAria2Tasks` never matched; finished transfers sat at 100% "Downloading" forever, gid never released. `removed`/`paused` also unhandled. **Completion is now verified, not reported** — `finalizeCompletion` on all 3 engines checks file exists, no `.part` remains, size within 1% (many sources send no `Content-Length`) — else `Failed` with a retryable reason. **Delete is two actions** (`remove(id, deleteFile)`); "remember my choice" defaults off (a preference learned from one click nobody consciously set).

### A download is addressed by its source variant, not its title

Bug: duplicate detection matched by **title prefix** (`norm(t.title).startsWith(norm(title))`) — one film, any resolution, collapsed into one download slot; target path was also title-derived, so allowing two would corrupt one file via interleaved writes. `src/utils/downloadIdentity.ts`: torrents key on real infohash; everything else keys on the durable description (media+season+episode+provider+release name+resolution+quality+language+audio) — **never** on `infoHash` (synthesised per-URL, changes on re-resolve). Rules: provider stored, not the extractor host (`indexerName` changes between resolves); recovery matches variant key first, resolution-bound after (old: unconditional `directSources[0]` could silently rebind 2160p→480p and report success); target path carries the variant, de-duped with a numbered suffix at enqueue; batch downloader must not stamp a run-specific batch id into the identity field (broke recovery + caused duplicate re-queues).

### A partial download must be *proved* to match before resuming (2026-08-31)

Old: compared provider-declared size, restarted if >20% different — both wrong (declared size often absent = check never ran; 20% is huge = wrong-encode tail-appends silently corrupted files that "finished"). Fixed: **one ranged 64KB request at the resume point** answers Range support (206) + real length (`Content-Range`) + byte-identity (tail comparison) in one shot. `download/resumePlan.ts` (pure), cheapest-first: identity → exact size → Range support → byte comparison. `no-range` is its own cause (server always sends the whole file — nothing wrong with either file). An unreadable comparison window **restarts** (not "assume match"). `download/resumeWindow.ts` tested against real servers — **the `res.resume()` trap appears a third time** (discards data, leaves transfer running) — both response and request destroyed now; regression test verified to FAIL with the bug restored.

### Pressing Download is a request, not a command (`download:request`)

Old: any existing entry → "Already downloading" regardless of actual state (paused/failed/deleted). New: `Downloading/Retrying/RefreshingSource`→no-op+says so; `Queued`→no-op+says when; `Paused`→resumes; `Failed`→recovers (clears retry budget, re-resolves, retries); `Completed`→checked against filesystem, re-downloads if gone; nothing→starts.

### The player: three "nothing happened" bugs

`onRefresh` was a no-op on 2 of 3 player mount points (dead "Search again" button). `isActive` compared synthetic per-URL `infoHash` — two extensions scraping the same host both showed "Playing" (fixed: first match only, disambiguated React key). Volume/mute/speed/track-language persist by **language, never index** (track 2 is a different thing on every release) — load applied through the same ref the attach effect reads.

### Volume had two writers and no rule (2026-08-29)

Player holds volume as a [0,1] fraction (`HTMLMediaElement.volume` contract); mpv (`volume-max` 130 default, OSC/keybindings can exceed 100) and VLC (0–256 scale, up to 512) can both report over-100 values from their own UI — divided by 100 and assigned, throwing `IndexSizeError` **inside a `useEffect`, unmounting the player**. Fixed at source: mpv launched `--volume-max=100`, VLC's reported level capped; `clampVolume` kept as a second line of defense in both `VideoPlayer` and `mpvEngine`. Echo suppression needs **two rules**: a 700ms window (`AUDIO_ECHO_MS`) ignoring incoming values while a local change settles, AND a value record (`engineAudio`) so an engine-originated value is never pushed back to that engine (else immediately re-derives a stale push that drags the UI backwards). Cleared on engine change (else the very first push to a fresh player is suppressed).

### External players: capability declared, never assumed

| Player | Channel | Capability |
|---|---|---|
| mpv | JSON IPC via `MpvEngine` | `full` |
| VLC | built-in HTTP interface | `full` |
| MPC-HC/BE | web UI, off unless user-enabled | `none` |
| PotPlayer, IINA, Celluloid, SMPlayer | none | `none` |

VLC launched `--extraintf http` on an OS-assigned loopback port behind a per-session password (unauthenticated by default otherwise). **Capability can downgrade at runtime** (a no-HTTP-module VLC build plays fine, answers nothing — reports `none` after a grace period rather than offering dead controls). `transport` in `VideoPlayer` is the single "who holds this stream" answer (element/native/external); volume/mute/speed apply to all engines so a handoff-and-back doesn't reset to 100%.

### Probes remembered, verdicts recomputed (`media/inspectionStore.ts`)

Keyed on **origin** URL, never proxied (per-session token would always miss on restart). Measurement (codecs/bit depth/tracks) is a fact about the file, cached; verdict (depends on this machine's decoders/GPU/mpv/policy) always recomputed — caching it would be the stale-cache bug's most expensive form (install mpv, everything keeps re-encoding per a week-old record). Query strings NOT stripped (would merge distinct signed-URL films' codec lists).

### The library remembers which source actually played

`PlayedSource` (per title+season+episode — episode-level, else ep6 overwrites ep5) holds the full `StoredSource` + an `origin` query. **The link is stored but never the identity** — `origin` re-resolves a fresh link for the same release. Recorded on playback (10s of real play, past every "started then stopped" failure), not selection. `library:resolvePlayedSource` returns `reused`/`refreshed`/`unavailable` (marked, not deleted — offers alternatives).

`cs3/playedSource.ts`: torrents match real infohash; everything else matches the **durable triple** (provider, normalised release name, resolution) — never the synthetic per-URL `infoHash`. Strict (containment allowed either direction for decoration drift like `[Dual Audio]`) — a wrong-release match is worse than no match. **No recorded deadline = treated as expired** (guessing "expired" costs one provider call; guessing "still good" costs a full ffmpeg-startup + player-timeout before failing over anyway).

### Source list provenance + export

`indexerName` on an extension link is the file **host** ("Voe"), not the provider — both lists now also carry `repository ▸ extension ▸ provider`, batched via `api:getProviderProvenanceMap`. `src/utils/sourceExport.ts`: CSV default (sortable/filterable), text/links-only alternatives. **Exported address is always the provider's, never loopback** (`sourceAddress` — loopback dies when the app closes). RFC 4180 quoting matters (`Dune, Part Two` unquoted silently shifts every later column, attributing links to the wrong provider).

### Playback failure: one surface, offers a download

Old: two stacking overlays (`NativeEngineStage`'s own + `VideoPlayer`'s, both z-index-less under `.native-stage`, unreadable together). `player/PlaybackErrorPanel.tsx` is the single owner now (`.player__overlay` z-index 4 — above `.native-stage`(3), below `.player__top`(5) and `.player-panel`(7)). **First action is Download** — decoding and fetching are different capabilities (a 10-bit HEVC file can be undecodable here and download fine) — suppressed only when the source is actually dead (`describeUnreadableSource` reports `dead`).

### Messages that overlapped: two flow columns

4 absolutely-positioned, non-opaque message boxes could render through each other (they can co-occur genuinely). Now `.player__messages--top`/`--bottom` flow columns with `pointer-events:none` on the stack, `auto` per child.

### The native stage's control bar was unreachable

`NativeEngineStage` drew a full duplicate transport row under `z-index:3`, beneath `.player__controls`(5) — unclickable, and its flex overflow (`min-height:auto`/`min-width:auto` not overridden — **a flex item never shrinks below its content unless told to**) caused a scrollbar with nothing to scroll to. Only mpv-track-selection and mpv-fullscreen remain in the stage. `onPausedChange` now reports the engine's own `paused` up (the `<video>` element's events never fire for mpv playback). Buffering is deliberately NOT forwarded (that overlay's copy is torrent-specific and would lie about an HTTP stream).

### The native provider lane (2026-09-07)

Re-counting found (a) the jar lane had collapsed (see above) and (b) a real gap: **no native searchable provider lane existed** — `HomeProvider` had catalogue rows only, no `search`/`load`/`loadLinks`; Internet Archive/iptv-org/PeerTube/Jellyfin were all unreachable. `cs3/nativeProviderRegistry.ts` + `cs3/nativeProviders/` closes it — deliberately **not** PRD-41's `.csx` (sandboxed third-party format, large separate effort); this is code shipped inside the app, reviewed normally, no sandbox/signing needed.

Rules: addressed `cs3native://<id>/<handle>`, **never** `cs3ext://` (else wrong-attribution failures); funnels through the same `enabledProviderNames`/adult-gate/`DisabledSet` cascade; shares the `providers` scope dimension (no third axis); `loadLinks` returns ordinary `ExtractorLink` (all downstream consumers already read it); failures classified through the shared taxonomy; **does not auto-escalate scope on empty** (the address already names an item in that provider's own catalogue — empty means genuinely unplayable, and 200 other sites can't fix it); detail route checked before `plugins.loadMedia` (else `null` misreports as "nothing knows this address"). `bun run test:native-providers` (50 cases, mutation-verified — bypassing the enable cascade fails 3).

Internet Archive gotchas: search **must** be `title:("<query>")` (bare terms OR across all fields + `sort=downloads desc` returns wildly wrong top hits — verified on 3/5 test titles); a `sort` key is **mandatory** (empty → empty result set, indistinguishable from "no such film") and `format:(MPEG4)` is a needed quality gate (ungated top "documentary" was a 3MB test clip with 1.25M downloads).

**Any Stremio addon is a provider** — supports the protocol, so new addons need no adapter. Measured `api.strem.io/addonscollection.json` (95 addons): subtitles 42, catalog 40, meta 23, **stream 19** (previously consumed from exactly one hardcoded place). Rules: `idPrefixes` is a **hard constraint** (an addon can 500 on a foreign id scheme — Anime Kitsu on `tt…`); a declared `extra` list **under-reports** (TMDB declares no `search` extra but answers correctly anyway — attempt, don't trust the manifest); two deployments of one addon (public vs self-hosted debrid) are **two providers** (host is part of the local id). `externalUrl`/`ytId` streams dropped (open a webpage, not a stream — worse than no row).

Verified live: Internet Archive (HTTP 206, `video/mp4`, `ftypmp42`), PeerTube (4 links@1080p from origin instance), iptv-org, Cinemeta.

**Jellyfin/Emby is a provider** — can't exist as `.cs3` (no LAN route, no credential storage reason in an Android extension), and can't rot (a NAS doesn't 403/expire). Rules: API key travels as `X-Emby-Token` header **never in the URL** (URLs get written to disk everywhere — `MediaProxy`, `SourceCache`, diagnostics, export; exception: poster `src` can't carry a header, key omitted there); key never crosses the context bridge (`listServers()` strips it, tested); `static=true` (original file, not a server transcode — this app's own compatibility engine is better). A key valid but attached to no account returns empty `/Users`, not 401 — message names this honestly.

Native catalogues reach the home screen after metadata rows (`DiscoveryService` shares `ContentService`'s registry instance so a disabled provider vanishes from both simultaneously). Verified live counts: Documentaries 28, Public-domain features 30, PeerTube documentaries 30, Movie channels 40. **4 rotted catalogue rows marked `verified:false`**: `pitipitii` (GitHub 451), `fstream` (Anubis bot wall), `cloudstream_18plus` (404 plugin list).

### Two lanes that were already paid for (2026-09-03)

**Non-torrent Stremio streams were discarded** — `StremioAddonIndexer.search` filtered to `infoHash`-carrying replies only, dropping every debrid/HTTP-only addon reply silently. `RawTorrent` gained a **direct URL half**, finished before magnet derivation (no swarm/piece-order/infohash needed). Identity shared with `ContentService.extensionSources`'s `directSourceIdentity` (`ext-` prefix, else two lanes finding the same host show as two sources). `seeders:1` fixed (swarm health meaningless for HTTP; `minSeeders` default 1 would hard-reject otherwise). `fileIdx` dropped on `url` streams (indexes a file *inside* a torrent; a direct link is already the file).

**yt-dlp had no caller** — `extractLinks`/`searchAndExtract` existed, referenced by nothing. Fixed transport detection (was `url.includes('.m3u8')` string-sniffing with `fmt.protocol` sitting unread — nothing decided from URLs, per repo-wide rule) and required **both** video+audio streams (a video-only DASH format plays silently — same AC-3-style bug shape). `ytsearch1:… trailer OR full feature` fallback removed (a trailer standing in for a film is a synthetic source). `YtDlpEngine.resolve` answers with a **reason** from yt-dlp's stderr (Unsupported URL / Video unavailable / geo-block are 3 different actionable outcomes). `--no-playlist` passed (else a series page resolves every entry). Two entry points, no IPC change: a pasted page URL is its own search row; `ContentService.discover` resolves `http(s)` bases through yt-dlp. **Not** resolved from the search box (typing ≠ consent to spawn a process per keystroke).

Repositories added: `xr3ed` (190 ext, 47 jar-lane), `hexated`, `arabic_extensions`, `indochannel`, `codegeasse` (adult-gated). None `bundled` (unproven by the harness).

### The source cache learns from playback

`recordFailure`: **definitive** (404/410/"file is gone") drops immediately; **counted** (timeout/reset/5xx/403) needs 3 strikes (`recordSuccess` clears the count). **403 is specifically not definitive** — expired signed URLs and hotlink protection both answer 403 and both recover by re-resolving.

### An extension update that breaks itself is put back

`updatePlugin` copies the working archive aside, installs, **loads the new one**, restores the old on link failure. Only `T4_BLOCKED` counts as failure (`T3_DEGRADED` is normal for much of the corpus; a `null` report = sidecar unreachable, explicitly not a failure — DROP-34). One generation kept; `extension:rollback` exposes it manually (for scrapes-nothing-but-links-fine cases the load check can't see).

### The native engine: mpv (added 2026-08-19, `docs/roadmap/support_libmpv.md`)

4K HEVC 10-bit has exactly one browser path (re-encode to 8-bit H.264 — a whole CPU core, discards HDR, flattens 5.1, downscales under 16 threads). mpv carries its own FFmpeg + hands bitstreams to D3D11VA/NVDEC/Vulkan/VideoToolbox (measured: `d3d11va`, full resolution, nothing re-encoded).

| File | Role |
|---|---|
| `media/mpvEngine.ts` | Spawns/supervises mpv; line-delimited JSON-RPC over named pipe (Windows)/unix socket. |
| `src/types/mpv.ts` | Contract; `MpvSnapshot` is what the player renders from. |
| `src/components/player/NativeEngineStage.tsx` | Player surface for a routed stream. |
| `binaryDownloader.setupMpv` | Fetches a portable build on demand. |

**Routing is a decision, not a mode** — `shouldRouteToNativeEngine` runs *after* the browser-side decision (removing mpv reverts every verdict exactly). Policy (`native_engine_policy` in datastore): `off`; `auto` (default — anything the browser path would re-encode/downmix: above-stereo, or lossless/object-based audio at any channel count); `aggressive` (everything not already native). **The channel rule replaced a codec rule** after user reports showed the original lossless-only rule pushed nearly all TV (modal E-AC-3 5.1 WEB-DL) to software re-encode when the GPU decodes it free — the line is now channel count, not codec.

**A stream never reaches mpv without inspection** — no raw-URL entry point (`media:prepare` only, same INV-RACE-1 rule); `VideoPlayer` refuses to assign a `NATIVE_MPV` URL to the element.

Bite-prone: URL handed over is the proxied one, headers per-file via `loadfile`'s option map (one mpv process serves a whole series, headers differ per episode); `--no-config` (a user's own mpv config would silently change behaviour); `--ytdl=no` (yt-dlp fallback wastes ~8s on failures already diagnosed); `video-params/pixelformat` reports the **GPU surface type** once hardware decoding runs — read `hw-pixelformat` for the real format; `mpv.com` (not `.exe`) needed for stdout (GUI-subsystem binary has none); 7z extraction needs bsdtar (Windows' own tar, not PowerShell's `Expand-Archive`); mpv wired into `before-quit` (else outlives the app).

**mpv's window draws its own controls (2026-08-24)** — it renders a **separate OS window**, so `--osc=no`/`--osd-level=0` left that window with zero controls while the app's own bar sat behind it. Now `--osc=yes`/`--osd-level=1`/`--input-vo-keyboard=yes`. **`--input-default-bindings` stays `no`** (defaults quit on `q`/`Q`/`Ctrl+q`, and mpv exiting-while-playing reports `ended`→advances to next episode) — bindings enumerated manually (`NATIVE_KEY_BINDINGS`) to match `VideoPlayer`'s own (`SKIP_SECONDS`=10 both). `end-file` reason `quit` now reports `idle`, not `ended`.

**What is not built: embedding.** mpv is a separate OS window driven over IPC (roadmap's recommended first step / Option A). True embedding needs libmpv's render API via a native addon (Option B). `MpvOpenRequest.windowHandle` exists, unused today.

### The second film would not play (2026-08-24) — four causes

1. **Persistent probe cache keyed on the loopback address** (`/stream/1`, token minted per-process — second film decided from first film's codecs). Fixed: `MediaProxy.getTargetRoute` unwraps to the upstream URL; store refuses/prunes loopback keys.
2. Idle mpv (`--idle=yes`) left a blank window on screen after `stop()`. Now quits.
3. **Race**: `mpv:stop` (cleanup) and `mpv:open` (new mount) fired in the same tick, unordered — the old kill landed on the newly-started process. `MpvEngine.serialize` queues `open`/`stop`/`shutdown`; `shutdownNow` awaits the child's actual `exit` instead of a detached timer. `playback:stop` no longer stops mpv at all (not every session owns a stream — the detail page's picker starting a scrape used to kill the mini-player's film); closing the player is what closes mpv now.
4. **Preparation effect keyed on object identity** — `activeSource?.directHeaders`/`.drm` are new objects on every `playback:update` (including buffer-stall pushes), causing stall→teardown→re-prepare→stall loops. Fixed: `activeSourceKey` (serialised) drives a `sourceConfig` memo. **Add new source fields to the key, not the dependency array.**

`electron/media/mpvEngine.test.mts` (17 cases, real mpv against a synthesised HEVC10/AC-3-5.1 MKV fixture) — deliberately impure (the failures live in the inter-process seam).

### FFmpeg 7.1 silently broke the image-segment fix

`-allowed_extensions ALL` (fix for `.png`-served MPEG-TS) stopped working when FFmpeg 7.1 added `-extension_picky` (default true, evaluated **before** the allow-list) — with no repo-side change on the day it broke. Measured: only `-extension_picky 0` fixes it; the old flag alone still fails. Can't just add it (unknown option is fatal to the whole command line on FFmpeg 7.0, still in mirrors) — `detectExtensionPicky` probes `-h demuxer=hls` at startup and after any ffmpeg install; `hlsDemuxerOptions()` includes it only if present. Found by `tools/e2e/native-engine-matrix.mjs` on its first run.

### 5.2 The vendor coverage matrix — `tools/e2e/native-engine-matrix.mjs`

```
node --experimental-strip-types tools/e2e/native-engine-matrix.mjs
node --experimental-strip-types tools/e2e/native-engine-matrix.mjs --plugins 12 --links 2
node --experimental-strip-types tools/e2e/native-engine-matrix.mjs --only Cinefreak,HDhub4u
node --experimental-strip-types tools/e2e/native-engine-matrix.mjs --titles hindi-movie,english-series
```
Answers "given what extensions hand back, can this app put it on screen?" — imports the shipping `MediaInspector`/`decideStrategy` (not a reimplementation), then **actually plays** each candidate via headless mpv (`--vo=null --ao=null`, full demux/decode) for a few seconds, recording playhead progress + dropped frames. `--untimed` deliberately NOT passed (would hide sustained-realtime failures). Records **both** verdicts (with/without the native engine) — a differing row is a stream that used to be re-encoded and now isn't. Hindi-title coverage deliberate (dual-audio MKV, per-language 5.1 AC-3/E-AC-3, 10-bit HEVC cluster there).

### When we cannot play it: `externalPlayer.ts`

Detects VLC/mpv/MPC-HC/BE/PotPlayer, offers handoff. URL handed over is proxied (headers pre-applied — each player has an incompatible/absent way to set `Referer` itself). Nothing downloaded on the user's behalf (detected only; opens official download pages if none found). Suppressed when the source is dead (`describeUnreadableSource` — a 404 plays no better in VLC).

### Provider headers: a browser cannot send them

Extension links often need the provider's `Referer`, which `<video>`/hls.js/ffprobe cannot send (`Referer` is a forbidden fetch/XHR header). Same root cause, two symptoms (HLS: `manifestLoadError`; progressive: "could not decode" since ffprobe also failed). `mediaProxy.ts` serves from loopback with headers applied — fixes all three consumers at once. **HLS playlists are rewritten, not forwarded** (segments/keys/variant playlists would otherwise hit the host directly with no headers) — covers bare URI lines and quoted `EXT-X-KEY`/`EXT-X-MAP`/`EXT-X-MEDIA` attributes; relative URIs resolve against the *final* (post-redirect) upstream URL. **A loopback URL returned from `wrap` untouched** (else torrent/transcoder output gets double-wrapped, growing by one hop per call — nothing gained, header injection is for third-party CDN hotlink checks only). **A 4xx source fails over immediately** rather than being handed to ffmpeg (saves a wasted startup+timeout per expired/signed URL).

### Diagnosability: a message is not a report

`cs3/diagnostics.ts` records the **tuple** (provider, query, item, address) — a bare message like `Expected URL scheme 'http' or 'https'` names nothing actionable. Persisted to its own file, not the datastore (debugging exhaust, not backup-worthy, no viewing-history overlap). `CopyErrorButton`'s report leads with app/Electron/platform/runtime versions + a `Failures by cause` tally. Two sizes; **`mode:'current'` (context-scoped) is the default** (was: whole session, up to 300 entries — over-inclusive and under-targeted at once). Grouping normalises durations/byte-counts/timestamps out of the key but **keeps bare integers** (`HTTP 403` vs `404` must stay distinct). `loadLinksDetailed`/`SourceDiagnosis` replaced bare `[]` returns (which collapsed timeout/thrown-extractor/nothing-found/empty-links-in-reply into one sentence) with summary+hint+facts.

### The range probe was downloading the whole file

`FastChunkDownloader.probeUrl`'s `bytes=0-0` request called `res.resume()` (discards data, **does not stop the transfer**) before resolving — harmless against Range-honouring hosts, catastrophic against `video-downloads.googleusercontent.com` (ignores Range, returns 200+whole-6GB-file) — measured 5.6MB pulled in the 5s after "resolving," competing with the real download for the same throttled signed URL. Fixed: response+request destroyed once headers are read (verified: 0 bytes pulled after). Also: a chunk worker accepting `200` mid-transfer (host changed its mind under load) now **fails that chunk with a reason** instead of writing whole-file bytes at a chunk offset (silent corruption).

### Shipping: the box has to contain everything

**The JVM ships inside the app** — old `electron-builder` packaged only `dist/`+`dist-electron/`+`node_modules/`, zero extension capability regardless of runtime code correctness. `tools/package/build-runtime.mjs` assembles `sidecar/dist/` (sidecar+`lib/`+`runtime/`+jlinked JRE, ~90MB) → `extraResources` → `resources/sidecar/` (where `SidecarSupervisor` looks when `app.isPackaged`).

jlink module list is curated, not `ALL-MODULE-PATH` — non-obvious-but-critical entries: `jdk.crypto.ec` (ECDHE, else TLS fails site-by-site), `jdk.unsupported` (`sun.misc.Unsafe`, reached by coroutines/OkHttp/Jackson), `jdk.localedata` (C-locale date parsing silently returns nothing for multilingual corpus), `java.sql` (Jackson reflects `java.sql.Date`). Verify by running the corpus, not just building:
```
node tools/package/build-runtime.mjs --verify
node tools/e2e/provider-e2e.mjs --java sidecar/dist/jre/bin/java.exe
```

**First launch bootstraps repositories itself** (`cs3/bootstrap.ts`, background, progress shown, once per `BOOTSTRAP_VERSION`, capped at `PLUGINS_PER_REPOSITORY`, never blocks catalogues/indexers). `bundled:true` = a claim `provider-e2e.mjs` has driven that repo end-to-end.

**Adult content**: off by default, gate is `PluginManager.enabledProviderNames` (single funnel point — search/scope/discovery/playback/downloads all pass through it). A provider is adult if `supportedTypes` includes upstream's `NSFW` `TvType` (catches an adult provider bundled inside an otherwise-ordinary repo — measured: `indostream`, `cinephile`, `redowan`, `uk_extensions`, none wholly-adult, `cinephile` is bundled). `BootstrapService` also declines to *download* them while off (politeness, not the actual protection).

**Sandbox**: enforced — plugin can't reach sidecar internals (`PluginClassLoader`, tested); `System.exit` can't kill the app (process boundary); `System.loadLibrary` blocked (empty `java.library.path`); per-plugin scoped storage. **Not enforced** — raw network egress, process creation (need an OS-level sandbox: Windows job object + restricted token). Reported via `status.sandboxGaps`, surfaced in UI deliberately (a named gap gets fixed; an implied-covered one doesn't). `SecurityManager` unavailable (JEP 411/486 removal).

### A links handle is not a page address (2026-08-27)

Upstream's `MainAPI` has two incompatible handle kinds under one `String` type: `load(url)` (page address, fetched) vs `loadLinks(data)` (opaque provider-built blob, often JSON — VegaMovies array-of-objects, HDHub4U array-of-strings). Handing a links blob to `load()` reached OkHttp's `HttpUrl.get`, threw, was **scored against the provider by the ranking** and shown as the reason playback failed — provider was fine. Reached `load()` from 3 directions, unified into one predicate: `cs3/extensionAddress.ts`'s `looksLikeLinksHandle`. Test is narrow (JSON is definitely not a page; anything else might be — Internet Archive's `load()` takes a URL while `loadLinks` takes a bare id).

**"A title I saved now opens blank" — the persisted form of the same bug.** `DetailView` recorded `episode?.url ?? detail.url` (the playback handle) as `progress.mediaUrl`, breaking library/Continue-Watching/saved-page rows on the *second* visit. Fixed: `libraryStore.recordProgress` keys on `canonicalKey(title,year)`+season+episode (never `mediaUrl` — nothing orphaned). Pre-fix rows are unrecoverable (page address isn't derivable from a links blob); failure screen offers "Find `<title>` again" instead.

### CloudStream X (CSX) (2026-08-27) — two more shim gaps, both `Object`-widening variants

1. `CloudStreamApp$Companion.setKey(String, Object)` — upstream's generic `fun <T> setKey` erases to `Object`; bridge had `setKey(String, String?)` (a different, uncallable method). **A Kotlin companion is not inherited** (`CloudStreamApp.Companion` gets nothing from `AcraApplication.Companion`).
2. `AccountManager.simklApi` typed as the wrapper `SyncRepo`/`SyncAPI` instead of concrete `SimklApi` — 4th occurrence of the getter-returns-supertype near-miss.

Also: **nothing was setting the application context** on either companion — `PluginHost.invokeLoad` now points both at the plugin's context before `load()`. And `newShimContext` hard-coded the literal `"plugin"` as scoped-storage id — **every extension shared one preferences file** (uses real `pluginId` now). `RUNTIME_GENERATION` **8**, `BOOTSTRAP_VERSION` **2** (delivers CSX to already-bootstrapped installs — `run()` filters on `!already.has(rawRepoUrl)`). Measured (`--repo CSX --plugins 10`, 5 queries): 11 loaded, 9 answering, 8 links, 7 streams — PASS; CineStream resolved 57/66 links for two Dune titles.

**`build-bridge.mjs` couldn't find Maven on Windows** — `spawnSync('mvn')` without `shell:true` doesn't resolve `mvn.cmd`. `findMaven()` now tries platform spellings, prefers `tools/toolchain/apache-maven-*`.

**`InvalidHeader` (non-EXTM3U response) was falling into `unknown`** — now `unreadable-reply` (extension's parser is right to refuse; the fix is checking the source, not the scraper).

### Backing up an installation (2026-08-27, `electron/cs3/backupService.ts`)

Old exports (Android-format datastore export; separate library/history exports) missed repositories, disabled-state, saved pages, indexer config. **Sections are a table**, not switch statements (a store added to export-but-not-restore silently drops rows). Deliberately excluded: `.cs3` archives/media (large, re-fetchable — backup records *which*), tokens/device ids (filtered on export by `DatastoreManager.snapshot`), diagnostics/logs (describe the wrong machine), caches (stale is worse than empty). **Restore merges, never replaces** (snapshots first, undoable); a throwing section is recorded while the rest still restore. Unrelated JSON refused **by format marker** (else "restored 0 of 9 sections" instead of "not a CloudStream backup"). 12 cases in `backupService.test.mts`.

### Extensions: browse opens where you asked (2026-08-27)

"What does this repo offer" used to be a third tab that discarded scroll/filter state. Now a full-width panel (`grid-column: 1 / -1`) under the repo's own card; two tabs remain (**Installed**/**Browse**). Search now reaches through a repo into its installed extensions/providers too, with a stated match reason.

### Settings: a level, not an Advanced tab (2026-08-31)

Moving technical rows to an "Advanced" tab fails because advanced-vs-simple isn't a *category* — it cuts across every subject (search settings, playback settings, etc.), splitting one topic across two places. Fixed: grouping stays by subject, a **level** filters within it (`SettingRow`/`SettingGroup` take `level`; an all-hidden group hides itself). **`advanced` means one specific thing: understanding the label requires knowing how the app is built** — not "rare," not "dangerous." `settingsLevel.test.mts` enforces this (refuses >50% advanced; catches redundant per-row+per-group marking; caught rows hidden for jargon labels **when renaming the label was the actual fix** — 6 renamed, e.g. "Detected native players"→"Players found on this computer"). Test-scanner traps: brace-depth tracking needed (not "nearest `<`" — breaks on `<SettingGroup icon={<RefreshCw />}…>`); rows and groups counted separately (else a marked group double-counts). **Simple is the default.** Stored in `localStorage`, not the datastore (per-viewer UI preference, not app behaviour/backup-worthy). `shouldShow` in a plain `.ts` (JSX can't load under Node's type-stripping); default is **an unclassified row is basic** (backwards would silently lose every future setting from Simple mode).

**Splitting it that way blanked the whole app (2026-09-01).** `SettingsLevel.tsx` (React) beside `settingsLevel.ts` (pure) — **on Windows' case-insensitive filesystem these are one name**, and module resolution tries `.ts` before `.tsx`, so the import silently resolved to the pure module (no hook/provider exports). A missing named export is an ESM **link** error — not catchable by `ErrorBoundary`, fails the whole `App.tsx` import graph, **blanks the entire window**. `tsc -b`/`vite build` both refuse it — the gap was shipping without running either. Fixed file: `SettingsLevelContext.tsx`; `componentReachability.test.mts` gained a case folding every module path to lowercase, checking uniqueness (mutation-verified). **Never name a `.tsx` and `.ts` alike but for casing.**

Tab bar wraps + is sticky now (was `overflow-x:auto` over 8 fixed tabs). "All settings" is a view rendering the same groups in tab order (no duplication, can't disagree).

### Seven IPC channels were strings that had stopped matching (2026-08-27)

Found by diffing channel literals in `main.ts` vs `preload.ts` (invisible to `tsc` — plain strings on both sides):

| Channel | Was | Consequence |
|---|---|---|
| `binary:setupBinaries` | invoked, never registered | first-run installer **always failed** |
| `runtime:repair` | invoked, never registered | recovery path latent/unreachable |
| `discover:invalidated` | pushed, no listener | stale home catalogue up to 6h |
| `binary:check`/`binary:setup` | registered, unreachable | duplicate spellings |
| `extension:getRuntimeReport` | registered, unreachable | no way to explain zero providers |
| `media:get/setProbeConfig` | registered, unreachable | probe budget unreachable |

**`ipcRenderer.invoke` on an unregistered channel rejects — no `{ok:false}` envelope.** `BinarySetupModal` caught the rejection and rendered a *reassuring* fallback notice — masking a totally broken button. **A catch that reassures is worse than no catch.** `electron/ipcSurface.test.mts` (`bun run test:ipc`, runs first in `test:electron`) pins all diffs lexically, mutation-verified in all 3 directions. Exceptions go in commented allow-lists — "I'll wire it later" is not a valid entry.

### Lifecycle: closing a window is not quitting (2026-08-27)

`window-all-closed` used to tear down every service unconditionally (macOS: dock icon holding a dead sidecar; `activate` reopened onto the wreckage). All teardown moved to `before-quit`. **Shutdown raced against a 5s deadline** (WebTorrent's `destroy()`/an unresponsive mpv can hang; `before-quit` calls `preventDefault()`, else the window closes but the process survives, locking the cache dir for next launch). The pending service is logged as `shutdown_timeout`.

### Navigation, shortcuts, menu (2026-08-27)

**A dropped file used to replace the whole app** — `setWindowOpenHandler` doesn't cover top-level navigation (Electron's default for a dropped file), and `setApplicationMenu(null)` meant no View→Reload existed to recover. `will-navigate`/`will-frame-navigate` now refuse it; the renderer's `drop` handler routes the file through `media:prepare` instead (this was always possible via `/local/<token>` — the capability existed with no entry point). **F12 was bound twice** — `before-input-event`'s `preventDefault()` suppressed the page's own F12 handler, making `ProviderInspector` (F12-only) unreachable; DevTools is `Ctrl+Shift+I` only now. **Reload gated on `app.isPackaged`** (`Ctrl+R` in a packaged build destroys the renderer mid-playback). **A real menu is back** (was `null` — broke `Cmd+C` in the search box on macOS since Cut/Copy/Paste are menu *roles* there, and removed Quit/About/zoom-reset); hidden behind Alt via `autoHideMenuBar`.

### aria2 pinned to port 6800, silent on failure (2026-08-27)

6800 collides most with aria2's own technical-audience users. `stdio:'ignore'` discarded the reason; `start()` returned `true` on `spawn` returning (a port conflict is not a spawn error — aria2 dies milliseconds later, `isRunning()` lies). Fixed: probes upward from 6800 by test-binding, captures stderr, confirms via `getVersion` RPC before reporting success; `getLastError()` carries the reason.

### Media proxy tokens were `1`, `2`, `3` (2026-08-27)

`Access-Control-Allow-Origin: *` (correct, needed for ffprobe/hls.js/Shaka/mpv/external VLC) + sequential integer tokens meant **any page in the user's browser could cross-origin-fetch and enumerate the whole session's viewing** by walking integers. Tokens are now 16 random bytes (`[0-9a-f]{32}`), `tokensByKey` keeps them stable; a `Host` header not naming loopback is refused (binding to 127.0.0.1 alone doesn't prevent DNS rebinding).

### The font was fetched from Google on every launch (2026-08-27)

`@import url('https://fonts.googleapis.com/…')` in `src/index.css` — a packaged desktop app phoning a third party on every start, invisibly, plus a hang/silent-fail offline or on blocked hosts. Inter now vendored (`src/assets/fonts/`, 7 variable-font subsets, 213KB — non-latin subsets kept because provider titles aren't English). **Verify with `grep -oE 'https://fonts[^)"]*' dist/assets/*.css` after any build — must find nothing.**

### Licensing (2026-08-27)

No `LICENSE` file despite porting GPL-3.0 code + vendoring 26 extension repos + bundling FFmpeg/mpv/aria2/yt-dlp/JRE. `LICENSE` (GPL-3.0, from gnu.org) + `THIRD-PARTY-NOTICES.md` now at root, reachable from a packaged build via `settings/AboutPanel.tsx` (GPL-3.0 §6). **Bundled FFmpeg builds are GPL, not LGPL** — notice says so explicitly.

### Shared renderer primitives (same pass)

- `src/utils/useFlash.ts` — 20+ call sites' hand-rolled toast timers **crossed** (a second flash's timer got cleared early by the first) and leaked past unmount. Durations stay per-call-site (1500–5000ms, deliberate).
- `src/components/Poster.tsx` — `PosterCard` had no `onError` for the actually-common case (expired/hotlink-blocked scraped poster URLs) — Chromium's broken-image icon everywhere. Per-call-site `fallback` kept (not one glyph).
- `src/components/EmptyState.tsx` — every empty list route was identical one-sentence text; now has an *action* (search-empty offers "Search all sources", clearing the stored scope).
- Also: global `:focus-visible` floor (8 `outline:none` sites had no replacement); `prefers-reduced-motion` honoured in the one stylesheet that wasn't; poster cards keyboard-reachable; window bounds persist+clamp to an existing display; offline banner (30 separate provider errors < one true sentence).

**Backlog**: `docs/roadmap/product-hardening-backlog.md`. Items marked `needs-app-run` are unverified in a running Electron app — don't report as done.

---

## 6. Documentation: what to trust

- `docs/PRD/00-index.md` — start here (F-1…F-5 findings, scope/cost baseline).
- `docs/PRD/31` — drop-in compatibility commitment, ADR-10.
- `docs/PRD/33` — desktop as-built, **partially stale**: references `electron/cs3ArchiveLoader.ts`/`jvmProviderBridge.ts` (don't exist — that role is `cs3/sidecarSupervisor.ts` + sidecar); has stale absolute Windows paths.
- `docs/PRD/34` torrent architecture · `35` translation spike results · `36` provider execution roadmap.
- `docs/PRD/39` — **proposed, nothing built**: 4-lane extension standard (`.cs3`, QuickJS `.csx`, Stremio addon URL, yt-dlp), wire formats, signing, engine ladder, TLS/challenge layer. Superseded by 41 (missed the upstream jar lane).
- `docs/PRD/41` — **proposed, nothing built**, read instead of 39: 5 lanes, repo/extension/SDK schemas, ed25519 signing, capability sandbox, unified metadata model, author CLI. §2 is a measured Android-ecosystem account worth reading standalone.
- `docs/PRD/43` — **research 2026-09-03; items 1–4 built** (§0). §4 named 4 already-paid-for unreached sources: 2 now wired ("Two lanes that were already paid for"), `megarepo` contributes nothing (only mechanism is a bridge no-op), subtitle service still single-hosted. §6's rule: **a direct HTTP link is not an indexer result** — debrid/live/yt-dlp/Jellyfin are all *provider* sources regardless of what found them.
- `docs/PRD/44` — **research+proposal, §6–§8 not built**. §5: an 8-shape failure taxonomy from a 6,180-record log. Read §6.1 before any failure-UI design (every message names the action that resolves it). §4: none of the 5 specified extension lanes can be authored without the Android toolchain.
- `docs/docs_cs3/` — Android app architecture, 9 documents, written from source.

Requirement ids in code comments (`ARCH-2`, `SEC-7`, `DROP-12`, `DSK-57`, `AC-D4`, `RISK-D1`, …) resolve inside `docs/PRD/` — grep the id.

**Rule of thumb: PRD documents describe intent and reasoning; the code describes reality. Where they disagree, trust the code and fix the doc.**

---

## 7. Conventions

- **Commits**: Conventional Commits, scope from the area (`feat(library):`, `feat(cs3):`, `feat(torrent):`, `feat(player):`, `docs:`, `chore(cs3_windows):`).
- **Comments explain *why*, not *what*.** Match the dense-rationale register already present. No narration of the obvious.
- **TypeScript `strict`.** Avoid `any` (existing ones are IPC plumbing, not precedent).
- **Never bundle main-process runtime deps.** `vite.config.ts` externalises `dependencies` + node builtins (bare and `node:` spellings). `webtorrent`'s native `.node` binaries (`node-datachannel`, `utp-native`) must also be `asarUnpack`-ed.
- **External links open in the system browser**, never in-app (`setWindowOpenHandler`).
- **Player controls hide from one place** — a state machine polled on a timer (`VideoPlayer`), not `setTimeout` chains. A zero-`movementX/Y` `mousemove` is never activity (Chromium synthesises exactly that when hiding controls changes what's under the cursor — treating it as activity caused a flashing feedback loop).
- **Provider subtitles are a real source** — `loadLinks` returns them; `subtitles:search` merges them ahead of OpenSubtitles (critical for extension-sourced content with no IMDb id).
- **Shutdown is explicit**: `downloadService.stop()`, `extensionUpdater.stop()`, `pluginManager.shutdown()` (kills the JVM), `torrentEngine.destroy()`, all on `before-quit`. Any new service owning a socket/handle/timer/child process must wire into this.
- **stdout of the sidecar carries RPC frames and nothing else.** A stray `println` desyncs the channel — plugin logs/JVM warnings/stack traces are forced to stderr. Keep it that way.

### What was merged from `claude/refine` / `claude/android-media-desktop-dybtml`, and what wasn't (2026-08-23)

Rule: take features/refinements, leave anything touching playback behaviour/request headers/the native engine (this branch's proven streaming stack is the asset being protected).

**`refine` forked at `881456a`, before this branch's streaming stack existed** — no `providerLinks.ts`, `subtitles/convert.ts`, `clearKey`/`shakaSession`, `build-media-runtime.mjs`, or (due to the unanchored `extensions/` ignore rule) extensions screen at all. **Cherry-pick additively; never take a whole-file rewrite from it.** This is why the 25-commit IPC refactor (`main.ts`→24 `ipc/*` modules, `60da305`) was **not merged** — its `main.ts` predates this branch's 222-channel surface (was written against 188) and would delete modules it never knew existed. It can be re-derived as a template later, not cherry-picked.

Merged: `sourceScope.ts`, `swarmHealth.ts`, rebuilt extensions screen, `utils/format.ts`, `util/jsonFileStore.ts`/`disabledSet.ts`, `homeProviders.ts`/`homeProviderRegistry.ts`, source provenance/export, NewPipe downloader fix.

Not merged (deliberately, each a behaviour change to a working path): `ext.to` gateway; mpv embedding/`mpvSurface.ts`; concurrent-open/end-of-playback `MpvEngine` changes; HEVC `hvc1` tagging/remux-container changes; `unreadableSource`'s loopback-failure split; media-module logging-init changes.

**Never take a prebuilt jar from a branch whose sources you haven't compared** — `refine`'s prebuilt `cs3-provider-bridge.jar` predates this branch's `:app` activity shims (`CommonActivity`, `MainActivity`, `CloudStreamApp`, `AcraApplication`); taking it for an unrelated fix would have silently regressed all of them (no compile error, no failing test — just extensions losing providers again). Bridge rebuilt from the union of both sources; `RUNTIME_GENERATION` bumped.

### The browser, finally: the WebView bridge (2026-08-24)

**The class that resolves perfectly and does nothing**: `com.lagradost.cloudstream3.network.WebViewResolver` IS published in `library-jvm` 4.8.0 — but its JVM variant's `resolveUsingWebView` is `TODO("Not yet implemented")`. A class-resolution audit (counting `NoClassDefFoundError`) sees nothing wrong with it — this is why 4 rounds of shim work never surfaced the gap, and the standing argument against treating "zero NoClassDefFoundError" as "zero compatibility gaps."

| Piece | File |
|---|---|
| stdio protocol, run backwards | `sidecar/.../HostChannel.java` + `Main.handle` |
| sidecar-installed handler | `bridge/.../HostBridge.kt` |
| `WebViewResolver`, shadowing the stub | `bridge/.../network/WebViewResolver.kt` |
| the browser | `cs3_windows/electron/cs3/webViewHost.ts` |
| subrequest meaning (pure, tested) | `cs3_windows/electron/cs3/webViewMatch.ts` |

Frames told apart by key (`hostCall`/`hostReply`), never a version — old sidecars still speak the same frames. Payload travels as a JSON string under `json` (same choice as `providerLoad`, avoids a lossy re-parse). **Host replies complete on the stdin reader thread, not the bounded plugin-call pool** — else concurrent resolves under load deadlock the pool waiting on replies no thread can deliver.

**Classpath order in `PluginHost.shared()` is load-bearing** — `WebViewResolver` is the first class the bridge *overrides* rather than supplies fresh, and `URLClassLoader`/`Files.newDirectoryStream` order is otherwise filesystem-dependent (correct on the build machine, broken on a user's). Bridge sorted to the front; `WebViewBridgeTest` asserts both directions. **The shadow is verified a strict superset of the stub via `javap`** (adds Android-only members like `getWebViewUserAgent1` the JVM stub lacks — archives compiled against Android would otherwise `NoSuchMethodError` post-link).

A browser opens only on a genuine challenge (`Server: cloudflare` **and** 403/503, both — a bare 403 is usually hotlink protection a browser can't fix). Bite-prone: `backgroundThrottling:false` mandatory (hidden-window timers throttled → challenge pages hang); `cf_clearance` is `HttpOnly` (read from the session, not `document.cookie`); bypass ends on **cookie arrival** (`awaitCookie`), not a URL match (upstream's deliberately-unmatchable `.^`); certificate errors ignored **for this partition only** (never for the app's default session — this one never carries credentials, the found stream is re-fetched normally afterward); `webRequest` handlers installed **once**, dispatched by `webContentsId` (per-resolve registration would silently unhook concurrent resolves); Java regex→JS translation must be escape-aware (`\A`, `\p{Alpha}` are silent no-ops in JS — a naive global replace also corrupts escaped-backslash sequences, producing a "pattern that never matches" that reads as a dead host); blacklist matches the **path only** (query-string cache-busters routine; `/cdn-cgi/`/`recaptcha` never blocked — that's the challenge machinery itself). `RUNTIME_GENERATION` **6**.

**Honest gap vs Android**: Android streams intercepted requests to the callback live (a `true` mid-load destroys the view); here the whole batch arrives after the fact and a `true` truncates the reconstructed list at that point — every corpus use (collect/filter) survives this; only the early-stop-load-sooner behaviour is absent (a saving, not a semantic difference).

**Not yet measured: whether this actually rescues affected providers** — the harnesses (`provider-e2e.mjs`, `native-engine-matrix.mjs`) run with **no Electron**, so `hostCapabilities` reports none and every resolve declines. Only the seams are verified (31 sidecar tests, 21 matcher tests, `javap`). Closing this needs a headless Electron main process answering `webview.resolve`.

### Android parity audit (2026-08-23, `docs/roadmap/android-parity.md`)

Source-level comparison against checked-out Android at `a72f9e6c`. The `WebViewResolver` gap above was its most important finding (closed 2026-08-24) — invisible to a class-resolution audit precisely because the class resolves. **Lesson: a gap that a missing-class count can't see is not a gap that doesn't exist.** Two smaller rules: `SourcePrefetcher.schedule` is safe to call from anywhere (declines/dedupes/supersedes internally — player calls it at 70% of an episode); subtitle appearance is one record, two renderers (`src/utils/subtitleStyle.ts` maps to both `::cue` vars and mpv properties — `sub-pos` counts down from 100 where the CSS lift counts up).

---

## 8. Working agreements for agents

- **Branching**: cloud/agent sessions develop on their assigned `claude/*` branch, push there. Never push to `master` directly. No PR unless asked.
- **Scope**: don't start on a PRD step because you read about it here — implement what was asked.
- **Do not vendor/commit**: `.cs3` archives, `library-jvm.jar`, `node_modules/`, `target/`, `dist/`, `dist-electron/`, downloaded `aria2c`/`yt-dlp` binaries. (Root `.gitignore` covers `target/`; `cs3_windows/.gitignore` covers `dist-electron/`, `dist/`.)
- **A `jar xf`'d sidecar jar is build output too, and nothing ignored it** — one branch merge carried 28 stray `.class` files beside their `.java` sources. Now ignored (`/META-INF/`, `/com/`, anchored). This matters because a stale compiled sidecar copy in the tree reads as a second, authoritative build.
- **Anchor every ignore rule naming a runtime directory.** A bare `extensions/` in `cs3_windows/.gitignore` (meant for the runtime archive dir) matched **any depth**, silently swallowing `src/components/extensions/` — the whole extensions screen vanished from every fresh clone, breaking `tsc -b`/`vite build` unconditionally. Rules are anchored now (`/extensions/`, `/data/`, `/bin/`). The screen was rebuilt fresh on 2026-08-21, not recovered — if the original turns up, compare rather than assume.
- **Report honestly.** "Typechecks with `bun run build`" is true; "tested" is not unless you ran `mvn test` or actually exercised the path. GPL-3.0/third-party-indexer/community-plugin context makes overclaiming expensive.
- **Keep this file current.** Changing the IPC surface, adding a service, moving the sidecar contract, or finding a stale section — update it in the same commit.
