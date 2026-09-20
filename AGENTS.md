# AGENTS.md — CloudStream 3 Desktop

Context for AI coding agents. `CLAUDE.md` symlinks here.

**Read this before searching the codebase. If it contradicts the code, the code wins — fix this file in the same commit.**

This is the core. Per-area detail lives in `docs/agents/` — see **Domain notes** below and
read the file for the area you are about to change.

Facts here are measured, not assumed. Numbers in parentheses are real measurements; keep them when editing.

---

## 1. What this is

Port of Android **CloudStream 3** (Kotlin, 4.8.0) to a **Windows-first Electron desktop app**, keeping the community `.cs3` extension ecosystem working **without asking any maintainer to do anything**. That constraint is why a JVM sidecar, a DEX→JVM translator and the android shim exist.

> Android defines expected behaviour. Electron defines how it's delivered on desktop. (`docs/PRD/00-index.md`)

Upstream is **GPL-3.0**; `LICENSE` + `THIRD-PARTY-NOTICES.md` at root, reachable from the packaged app via `settings/AboutPanel.tsx` (GPL §6). Bundled FFmpeg builds are GPL, not LGPL.

---

## 2. Repository map

```
cs3/
├── cs3_windows/      ← THE APP. Electron + React 19 + TypeScript + Vite 8. Most work here.
├── sidecar/          ← JVM (Java 21 / Maven) process that runs Android .cs3 extensions.
├── tools/dex-spike/  ← Maven harness; measured DEX→JVM translation across 392 real plugins.
├── docs/PRD/         ← 37+ numbered specs — the reasoning behind everything.
├── docs/docs_cs3/    ← 9 documents on the *Android* app (source of truth for behaviour).
└── repositories/     ← 26 git submodules: vendored community extension corpus.
    └── _cloudstream_ref_android/  ← upstream Android source (a72f9e6c…, v4.8.0).
```

**Submodules are not checked out by default** — `repositories/*` and `_cloudstream_ref_android/` are empty in a fresh clone (incl. cloud/CI).
- Never claim you verified something against Android source unless you initialised the submodule.
- Don't run `git submodule update --init --recursive` casually: 27 repos over SSH, usually fails without a key, eats disk.
- For Android questions read `docs/docs_cs3/` and the file:line citations in `docs/PRD/` first.

---

## 3. Build, run, test

| What | Where | Command |
|---|---|---|
| Install deps | `cs3_windows/` | `bun install` (lockfile is `bun.lock`; npm works but will churn it) |
| Dev app | `cs3_windows/` | `bun run dev` — Vite on :5173, `vite-plugin-electron` launches Electron and rebuilds main/preload on change |
| Typecheck + build | `cs3_windows/` | `bun run build` (`tsc && vite build`) |
| Bundle the JVM | repo root | `node tools/package/build-runtime.mjs --verify` → `sidecar/dist/` |
| Bundle ffmpeg + mpv | repo root | `node tools/package/build-media-runtime.mjs --verify` → `cs3_windows/media-runtime/` |
| **Ship it (Windows)** | `cs3_windows/` | **`bun run dist:win`** → `release/` — the whole chain, Maven included; `dist:win:fast` reuses existing jars |
| Package (Windows), lower level | `cs3_windows/` | `bun run electron:build` → `release/` (assumes the Maven builds have already been run by hand) |
| Lint | `cs3_windows/` | `bunx oxlint` (oxlint is a devDependency; there is deliberately **no** `lint` script yet) |
| Typecheck only | `cs3_windows/` | `bun run typecheck` (`tsc -b` — see the warning below) |
| Sidecar build | `sidecar/` | `mvn package` → `target/cs3-sidecar.jar` + `target/lib/*` + the android shim into `runtime/` |
| Sidecar tests | `sidecar/` | `mvn test` (42 tests) |
| Main-process tests (all) | `cs3_windows/` | `bun run test` (~580 cases across 42 suites, Node type-stripping; or `bun run test:electron`) |
| Fast unit tests (skips slow) | `cs3_windows/` | `bun run test --fast` (40 unit suites in ~5s) |
| Extension issues only | `cs3_windows/` | `bun run test issues` (21 cases, pure) |
| Provider registry only | `cs3_windows/` | `bun run test registry` (9 cases, temp dirs) |
| Provider recovery only | `cs3_windows/` | `bun run test recovery` (12 cases, pure) |
| Torrent contents only | `cs3_windows/` | `bun run test torrent-contents` (24 cases, pure) |
| Sidecar log only | `cs3_windows/` | `bun run test sidecar-log` (20 cases, pure) |
| Source cache only | `cs3_windows/` | `bun run test cache` (10 cases, no ffmpeg needed) |
| Provider links only | `cs3_windows/` | `bun run test links` (15 cases, no ffmpeg needed) |
| WebView matching only | `cs3_windows/` | `bun run test webview` (21 cases, pure) |
| Torrent metadata + DHT cache only | `cs3_windows/` | `bun run test torrent-metadata` (28 cases, temp dirs) |
| Source scope only | `cs3_windows/` | `bun run test source-scope` (17 cases) |
| OTT platform matching only | `cs3_windows/` | `bun run test ott` (19 cases, pure) |
| Built-in provider lane only | `cs3_windows/` | `bun run test native-providers` (50 cases, pure — stubs `setHttpFetch`) |
| Download resume decision only | `cs3_windows/` | `bun run test resume` (17 cases, pure) |
| Download resume probe only | `cs3_windows/` | `bun run test resume-window` (10 cases, real sockets) |
| Component reachability only | `cs3_windows/` | `bun run test reachability` (2 cases, lexical) |
| Settings level only | `cs3_windows/` | `bun run test settings-level` (6 cases, pure + lexical) |
| Dead result rows only | `cs3_windows/` | `bun run test dead-rows` (8 cases, pure) |
| Media proxy only | `cs3_windows/` | `bun run test proxy` (11 cases, stubbed origin) |
| Subtitles only | `cs3_windows/` | `bun run test subtitles` (16 cases) |
| Media decisions only | `cs3_windows/` | `bun run test media` (71 cases, no ffmpeg needed) |
| Media pipeline only | `cs3_windows/` | `bun run test pipeline` (17 cases, real ffmpeg; skips itself without it) |
| Source export only | `cs3_windows/` | `bun run test export` (13 cases, pure) |
| Direct (non-torrent) indexer sources only | `cs3_windows/` | `bun run test direct-sources` (13 cases, pure) |
| yt-dlp source mapping only | `cs3_windows/` | `bun run test ytdlp` (16 cases, pure) |
| Repository catalogue only | `cs3_windows/` | `bun run test repositories` (9 cases, pure — fetches nothing) |
| Extended metadata (all) | `cs3_windows/` | `bun run test metadata` (92 cases, pure — fetches nothing) |
| Metadata merge only | `cs3_windows/` | `bun run test metadata-merge` (34 cases, pure) |
| Metadata sources only | `cs3_windows/` | `bun run test metadata-sources` (39 cases, stubbed transport) |
| Metadata display only | `cs3_windows/` | `bun run test metadata-display` (19 cases, pure) |
| Repository/corpus liveness | repo root | `node tools/research/survey-repositories.mjs` — counts the live indexes; see PRD-43 |
| Download identity only | `cs3_windows/` | `bun run test download-identity` (18 cases, pure) |
| Native engine only | `cs3_windows/` | `bun run test native` (12 cases, spawns a real mpv; skips itself without it) |
| Provider end-to-end | repo root | `node tools/e2e/provider-e2e.mjs` — see §5.1 |
| Vendor stream matrix | repo root | `node --experimental-strip-types tools/e2e/native-engine-matrix.mjs` — see §5.2 |
| **Metadata coverage** | repo root | `node --experimental-strip-types tools/e2e/metadata-e2e.mjs` — see §5.3. **Nothing in `electron/metadata/` has been run against a live host; this is what settles it.** |
| Plugin runtime classpath | repo root | `mvn -f sidecar/runtime-deps/pom.xml package` → `sidecar/runtime/` (56 jars, incl. `library-jvm-4.8.0.jar`) |
| Provider bridge (Kotlin) | repo root | `mvn -f sidecar/bridge/pom.xml package` → `sidecar/runtime/cs3-provider-bridge.jar` |
| Provider bridge, no JitPack | repo root | `node tools/package/build-bridge.mjs` — same jar, compiled against `sidecar/runtime/` |
| Install deps | `cs3_windows/` | `bun install` (lockfile `bun.lock`; npm works but churns it) |
| Dev app | `cs3_windows/` | `bun run dev` — Vite :5173, `vite-plugin-electron` launches Electron |
| Build | `cs3_windows/` | `bun run build` (`tsc && vite build`) |
| Typecheck | `cs3_windows/` | `bun run typecheck` — **`tsc -b`**, see trap below |
| Lint | `cs3_windows/` | `bunx oxlint` (devDependency; deliberately no `lint` script) |
| All main-process tests | `cs3_windows/` | `bun run test` / `test:electron` (57 suites) |
| Fast tests | `cs3_windows/` | `bun run test --fast` (56 suites, ~10s; skips real ffmpeg/mpv) |
| One suite | `cs3_windows/` | `bun run test <name>` — see alias list in `scripts/test-runner.mjs` |
| Sidecar build | `sidecar/` | `mvn package` → `target/cs3-sidecar.jar` + `lib/` + android shim → `runtime/` |
| Sidecar tests | `sidecar/` | `mvn test` (47 tests) |
| Plugin runtime classpath | root | `mvn -f sidecar/runtime-deps/pom.xml package` → `sidecar/runtime/` (56 jars incl. `library-jvm-4.8.0.jar`) |
| Provider bridge (Kotlin) | root | `mvn -f sidecar/bridge/pom.xml package` → `sidecar/runtime/cs3-provider-bridge.jar` |
| Bridge without JitPack | root | `node tools/package/build-bridge.mjs` |
| Bundle the JVM | root | `node tools/package/build-runtime.mjs --verify` → `sidecar/dist/` |
| Bundle ffmpeg + mpv | root | `node tools/package/build-media-runtime.mjs --verify` → `cs3_windows/media-runtime/` |
| **Ship it (Windows)** | `cs3_windows/` | **`bun run dist:win`** → `release/` |
| Provider end-to-end | root | `node tools/e2e/provider-e2e.mjs` — §5.6 |
| Vendor stream matrix | root | `node --experimental-strip-types tools/e2e/native-engine-matrix.mjs` — §6.9 |
| Corpus liveness | root | `node tools/research/survey-repositories.mjs` (PRD-43) |

Test suites are **auto-discovered** (`*.test.mts`); `PRESET_ALIASES` in `scripts/test-runner.mjs` are just shortcuts. Run `bun run test --list` for the current set rather than trusting a count written here.

### Build traps

- **`tsc` in `bun run build` typechecks nothing.** Root `tsconfig.json` is solution-style (`"files": []` + references); plain `tsc` on it is a no-op. Use **`tsc -b`**. Say "typechecks with `tsc -b`", never "tested".
- **Electron cannot launch in a headless cloud container.** Don't claim "I ran the app" unless you did.
- **`.ts` extensions on imports inside `electron/media/` are load-bearing** — Node's type-stripping ESM loader won't resolve extensionless specifiers (`allowImportingTsExtensions` in both tsconfigs).
- **Sidecar needs Java 21+** (class file 65). `SidecarSupervisor.resolveJava` checks `tools/toolchain/jdk-*` before PATH — any JAVA_HOME on 17 used to break everything silently. Maven lives in `tools/toolchain/apache-maven-3.9.16`, also not on PATH.
- **Fresh clone order: sidecar → runtime-deps → bridge.** Sidecar produces the android shim the bridge compiles against; runtime-deps puts `library-jvm` in place.
- **Bridge needs jitpack.io** (403s in some cloud sessions). Jars are vendored in `sidecar/runtime/`; `build-bridge.mjs` compiles against that directory with `kotlin-compiler-embeddable` from Central. Two costs: the Kotlin compiler needs `kotlin-stdlib/reflect/script-runtime/daemon-embeddable`, `trove4j`, coroutines **and `annotations-13.0`** on its own classpath (codegen resolves `@Nullable` there); and the **previous** `cs3-provider-bridge.jar` must be excluded from the compile classpath or sources compile against last build's copy of themselves.
- **`build-bridge.mjs` and Maven on Windows**: `spawnSync('mvn')` without `shell:true` won't resolve `mvn.cmd`. `findMaven()` tries platform spellings, prefers `tools/toolchain/apache-maven-*`.
- Cloud toolchain: Java 21, Maven, Bun, Node 22. **No CI** — `.github/` holds only `hooks/context-mode.json`, no workflows. Nothing runs tests but you.

### Packaging — `bun run dist:win`

`tools/package/build-installer.mjs`. Order: preflight (Node 20+, Java 21+) → `sidecar/pom.xml` → `runtime-deps` → bridge → `build-runtime.mjs --verify` → `build-media-runtime.mjs --verify` → `tsc -b` → `vite build` → `electron-builder --win nsis portable`.

Variants: `dist:installer`, `dist:portable`, `dist:win:fast`. `--skip-jvm`/`--skip-media` for UI iteration; both warn in the report.

**Every stage is incremental by default, decided from the files rather than a flag (2026-09-19).** Reuse used to be `--fast` and nothing else, so an ordinary `dist:portable` rebuilt the sidecar, re-resolved the 56-jar classpath from jitpack, recompiled the bridge, relinked a JRE and **re-downloaded ~140 MB of ffmpeg and mpv**, however little had changed. `upToDate(label, outputs, inputs)` skips a stage when every output exists and is newer than every input; `--clean` forces the work, `--fast` skips the comparison and trusts what is on disk (right for a fresh clone, whose checkout timestamps are all "now"). The end of the run prints where the time went, per stage.

- **Downloaded archives are cached in `/.cache/media-runtime/`, keyed by URL** and gitignored (anchored). `--refresh` re-fetches — needed for gyan.dev's `ffmpeg-release-essentials.zip`, whose URL is stable while its contents are not. Downloads report progress every 2s and carry a 10-minute deadline, because `await response.arrayBuffer()` printed one line and then nothing for minutes, which is indistinguishable from a hang; a body shorter than its `Content-Length` is rejected rather than cached, or one failed download would poison every later build.
- **`build-runtime.mjs` mirrors by difference and never wipes.** Deleting first is what made a *running app* fail the build: `EBUSY … unlink sidecar/dist/lib/antlr-runtime-3.5.3.jar`, for a jar whose bytes were already correct, with 58 identical jars about to be deleted and copied back. A file is written only when size or mtime differ, so building no longer requires closing the app; a file that genuinely must be replaced while held reports which file and says to close CloudStream.
- **A stalled mirror costs 20s, not 10 minutes.** The cache is checked across *every* mirror before any of them is fetched — measured, gyan.dev accepted the connection and sent nothing while the GitHub mirror behind it was already cached, and asking them in order turned that stage into **608 seconds**. Then two deadlines rather than one: 20s to start answering, and a watchdog that fires only after 45s with no bytes, so a slow-but-live download is never cut off.
- **`--quick` stores the payload instead of compressing it.** Packaging is 336s of a 367s steady-state build — `compression: maximum` squeezing a payload dominated by a JRE, ffmpeg and mpv. `--quick` takes that to 51s at 898 MB instead of 240 MB: right for a build you are about to run once, never for a release, and the report says which one you made.
- **The jlinked JRE carries `cs3-link-stamp.json`** (JDK home, major, module list) and is relinked only when that changes, or on `--relink`. The module list is part of the stamp deliberately: silently reusing a JRE linked without `jdk.crypto.ec` ships TLS that fails site by site.

**Skipping a step fails silently** — `build-runtime.mjs` verifies what Maven produced rather than running Maven, so a package built without the sidecar step installs fine with **zero extension capability** and nothing says so. Verify `release/win-unpacked/resources/`: `media/` has ffmpeg/ffprobe/mpv, `sidecar/` has `cs3-sidecar.jar` + jlinked JRE + 58 runtime jars.

Measured 2026-08-29, `dist:win:fast`, 158s: setup 271.9 MB, portable 271.7 MB.

Measured 2026-09-19, `dist:portable`, **steady state 367s** — Maven ~0s ×3 (reused), sidecar/dist 2s, media runtime 8s (from the archive cache), `tsc -b` 19s, vite 3s, **electron-builder 336s**, portable 239.9 MB. The same run before this pass rebuilt everything and re-downloaded 119 MB. Packaging is now the whole build; `--quick` is the lever on it.

| Trap | Rule |
|---|---|
| electron-builder 26 rejects unknown config keys | Config lives in **`electron-builder.yml`**; no `build` field in `package.json` |
| `npmRebuild: false` | All native deps are N-API (ABI-stable). **Set back to `true` if a non-N-API native dep is added** — build machine then needs a C++ toolchain |
| A running `bun run dev` fails the package | `EPERM … rename win-unpacked.tmp` — Vite holds a dir handle. `vite.config.ts` ignores `release/`, `media-runtime/`, `dist-electron/` |
| `tar` on PATH ≠ the `tar` that reads 7z | mpv ships `.7z`; GNU tar can't. Windows' `System32\tar.exe` (libarchive) named explicitly |
| Fonts | Built CSS is grepped for `https://fonts.` before packaging. Verify: `grep -oE 'https://fonts[^)"]*' dist/assets/*.css` must find nothing |
| `shell: true` | Only where a `.cmd` shim needs it — cmd.exe splits unquoted paths on spaces |

**jlink module list is curated, not `ALL-MODULE-PATH`.** Critical entries: `jdk.crypto.ec` (ECDHE, else TLS fails site-by-site), `jdk.unsupported` (`sun.misc.Unsafe`, reached by coroutines/OkHttp/Jackson), `jdk.localedata` (C-locale date parsing silently returns nothing for a multilingual corpus), `java.sql` (Jackson reflects `java.sql.Date`). Verify by running the corpus, not just building.

**NSIS**: `oneClick: false`, `perMachine: false` (per-user, no UAC). Portable writes userData beside the exe. x64-only (ia32 can't load webtorrent's native `.node`). **No code-signing cert** — SmartScreen warns; that's a purchase, not a build flag. No `.ico` in repo.

### The runtime the app runs is not the one you just built

`RuntimeProvisioner` copies sidecar + provider runtime into `%APPDATA%/<app>/cs3-runtime/` and resolves that copy **before** every build location. **The single most expensive trap in the repo.**

It once asked `findRuntimeDir()` where to copy *from* — which answers with the app-managed copy first — then skipped the copy as "already there". First provision was the last, so installed apps kept serving the shim/bridge they were installed with. One report: `NoClassDefFoundError` for classes shipped weeks earlier; **5 of 8 failing extensions were this bug alone**.

1. The copy carries a stamp (`runtime-stamp.json`: generation + fingerprint of every jar's name/size/mtime). `getStatus()` reports `stale` separately from `ready`.
2. Provisioning reads from **build locations only** (`findSourceComponents`) and picks **newest, not first** — `sidecar/dist/` is generated *from* `sidecar/runtime/` and goes stale the moment Maven runs again.
3. Translations drop when the sidecar changes; an absent stamp counts as changed.

**Bump `RUNTIME_GENERATION`** whenever the shim/bridge/translator changes in a way an already-provisioned copy would get wrong (currently **14**; one paragraph per generation in `runtimeProvisioner.ts`). Debugging "a class that should exist doesn't"? Compare `%APPDATA%/<app>/cs3-runtime/runtime/` against `sidecar/runtime/` first.

---

## 4. Architecture of `cs3_windows`

```
┌──────────────── RENDERER (React 19, src/) ────────────────┐
│ App.tsx · views/{Home,Search,Detail,Library,Settings}     │
│ components/VideoPlayer …                                  │
└───────────────────────────┬───────────────────────────────┘
          contextBridge, allow-listed, typed (electron/preload.ts)
┌───────────────────────────┴───────────────────────────────┐
│                MAIN PROCESS (electron/main.ts)            │
│  wires every service as a singleton, ~70 ipcMain.handle   │
└─┬────────┬──────────┬───────────┬──────────┬──────────────┘
Datastore Content   Plugin     Torrent   Download   Library
          Service   Manager    Engine    Service    Store
             │         │          │         │
      Metadata/    Sidecar   WebTorrent  aria2c / yt-dlp
      Cinemeta     Supervisor + loopback  (portable bins)
      + Indexer    ──► JVM     HTTP server
        Registry      process
  └── cs3_datastore.json in app.getPath('userData')
```

### The IPC contract

`electron/preload.ts` is the **only** bridge. `contextIsolation: true`, `nodeIntegration: false`. Namespaces: `api: torrent: playback: search: indexer: sources: download: extension: library: datastore: binary: dialog: pages: natives: ott: issues: profiles: media: mpv: external: player: analytics: bookmarks: discover: subtitles: log: runtime:`.

**Four things change together when crossing the boundary:** 1) service in `electron/`, 2) `ipcMain.handle('ns:name', …)` in `main.ts`, 3) method + type in `CloudStreamElectronAPI` in `preload.ts`, 4) caller in `src/`. Shared types live in `src/types/{api,plugin,torrent,download,player,media,mpv}.ts` and are imported by both sides — intentional, not a layering mistake.

Fallible handlers return an **envelope** `{ ok, error?, …payload }` and never reject, via `main.ts`'s `fail()`.

| Channel group | Shape & rules |
|---|---|
| `playback:*` | **Push.** `playback:start` returns a session id immediately; `playback:update` snapshots follow. Player renders from snapshots before a stream exists. |
| `search:*` | **Push**, same reason. `search:start` → opening snapshot; `search:update` carries results/progress; `search:cancel` abandons the rest. `api:suggest` is push-shaped too: it answers instantly from cache with a `done` flag and `search:suggestUpdate` carries each catalogue as it lands — measured, the three answer 170–935ms apart, so one reply would spend the fastest two on the slowest. Main keeps **one** `AbortController` for it; a new keystroke aborts the previous fan-out. 15 providers = 15 independent scrapes (Cinevood 20s vs ARD 350ms) — request/response would spend the whole time on a spinner. `api:searchAll` remains for callers needing a full answer. Required splitting `searchAll`'s single batched RPC into one RPC per provider (`searchEach`), capped at 8 in flight. |
| `pages:*` | **Read-shaped**, deliberately unlike the two above — the answer is already on disk. `getSnapshot/remember/setPinned`. **Capture is not exposed**; it happens in `ContentService.load`. |
| `media:*` | `inspect` classifies without starting; **`prepare` is the only source of a playable URL**; `switchAudio/closeStream` drive a live session; `setCapabilities/getCodecProbes` carry renderer-measured decoder support; `getPlaybackDiagnostics` returns per-attempt telemetry. **No channel hands back an unclassified URL.** Provider-declared `isDash`/`drm` outrank the probe; DRM skips the probe entirely. |
| `mpv:*` | `open` (prepared URL only), transport/track controls, `mpv:update` snapshots, `get/setPolicy`. No raw-link channel, same reason as `media:*`. |
| `natives:*` | Built-in provider roster: `list/setEnabled/addAddon/removeAddon` (Stremio addons by manifest URL), `addServer/removeServer` (Jellyfin/Emby — `addServer` takes a key, never returns one). Separate from `extension:*` (an inventory of *downloaded* things) because a compiled-in provider has no repository. |
| `ott:*` | `listPlatforms/getCatalog/getCatalogPage/getSearchScope/getSuggestions/installSuggestion`. **`installSuggestion` takes a repository id, never a URL** — a URL would let "set up Netflix" install arbitrary code. |
| `profiles:*` | `list/activate/create/rename/duplicate/delete`. Every one answers with the **whole** state (list + active id + unnamed draft) — those three must agree and rebuilding from a delta is how they stop agreeing. Profiles sit **above** `SearchScopeStore`; each change resolves to a `SearchScope` and writes it through, so nothing downstream learns profiles exist. `search:setScope` routes through the same layer. |
| `extension:*` | `addRepository` and `installRepository` are deliberately two actions (fetch+persist vs. tens of downloads/translations). `rollback` restores a replaced archive. |
| adult gate | `get/setAdultMode`, `unlock/lockAdultForSession`. `mode` is the setting; `allowed` is whether adult providers are offered *now* (they differ under `ask`). **The unlock is in-memory only and never persisted**; `unlockAdultForSession` refuses unless mode is already `ask`, so a renderer cannot use it to change the setting. |
| `download:*` | **`request`** = a button press (reads task state, resumes/recovers/refuses, reports which) vs **`enqueue`** = "create this task". `preview` answers where a file would land, read-only — the renderer cannot compute the path (folder layout, variant segment and collision suffix come from the whole queue). `get/setConfirmPreference` (`ask`\|`immediate`, default `immediate`). |
| `issues:*` | `list/annotate/report/clear` — the extension issue ledger; a third surface beside `log:*` and `diagnostics:*` (§5.5). |
| `interactions:*` | **Batched read.** `summarise(queries)` answers one screen's worth of card states in a single call — a join over the library, the outcome ledger, the download queue and the source cache, not a sixth store. `visit(title, year)` records that a details page opened; `clearVisits` is the only control over that ledger. Keyed on the *title* for everything about the work and on the *address* for everything about one source of it — see `cs3/titleInteractions.ts`. |
| `videos:*` | `resolve(pageUrl)` turns a trailer's page into a stream. Returns a **provider-level, proxied** address, never a playable one: the renderer hands it to `media:prepare` like any other source, so that channel stays the only source of a playable URL. Separate from `metadata:*` because it spawns a process on a button press, where a metadata record is something nothing waits for. |
| `external:*` | Drives a handed-off player, pushes `external:update` with a `capability` flag. |
| window pins | `window:set/getAlwaysOnTop` for the app window; `mpv:setOnTop`/`setVideoEnabled` for mpv's own. |

**`ipcRenderer.invoke` on an unregistered channel rejects — there is no `{ok:false}` envelope.** Seven channels were once strings that had stopped matching (invisible to `tsc`): `binary:setupBinaries` invoked-never-registered made the first-run installer *always* fail, and `BinarySetupModal` caught the rejection and rendered a *reassuring* notice. **A catch that reassures is worse than no catch.** `electron/ipcSurface.test.mts` (`bun run test ipc`, runs first) pins every diff lexically, mutation-verified in all three directions. Exceptions go in commented allow-lists — "I'll wire it later" is not a valid entry.

`metadata:*` is extended title metadata — `metadata:getExtended`,
`metadata:peekExtended`, `metadata:clearCache`, and the push channel
`metadata:extendedUpdate`. Separate from `api:loadMedia` because it answers a
different question at a different cost: `api:loadMedia` is what the app can
**play** and a Play press waits for it; this is what the title **is**, from four
third-party catalogues, and nothing waits for it. Push-shaped for the same
reason `search:*` is — the record is emitted partial and refilled as each source
lands. See "The cast list was a row of names" below.

`ott:*` is the streaming-service surface — `ott:listPlatforms`, `ott:getCatalog`,
`ott:getCatalogPage`, `ott:getSearchScope`, `ott:getSuggestions`,
`ott:installSuggestion`. Separate from `extension:*` because it answers a different
question: `extension:*` is an inventory keyed on repositories and archives, this is
"can I watch Netflix?" keyed on the platform — and it has to answer even when the
answer is no, so the list always contains every platform with how it is reachable
rather than omitting the ones nothing serves.
### Services (`cs3_windows/electron/`)

| File | Responsibility |
|---|---|
| `main.ts` | Window, lifecycle, service wiring, every IPC handler. |
| `preload.ts` | The typed API surface. |
| `datastore.ts` | Persistence. Reimplements **Android's 6-bucket key grammar** (`_Bool`/`_Int`/`_String`/`_Float`/`_Long`/`_StringSet`) so Android backups import losslessly. Non-transferable keys (tokens, device ids, cache paths) are filtered on import by regex. |
| `contentService.ts` | The content pipeline orchestrator: `search → MetadataProvider → getSources → IndexerRegistry → startStream → TorrentEngine`. Extension providers are consulted first; torrents are the fallback. A `cs3ext://` media URL bypasses indexers entirely — the provider already knows its links. |
| `playbackSession.ts` | Owns one "user pressed play" interaction. Opens the player *before* a stream exists and streams discovery progress into it, so the viewer can start the best source found so far instead of waiting for the slowest indexer. Also owns in-player source switching and refresh. Retains the `SourceQuery`, which is what makes refresh possible without navigating back. |
| `searchScope.ts` | Which sources a search may ask. **A selection is a strict filter, not a preference** — see below. |
| `searchSession.ts` | One "the user pressed search" interaction. Push-shaped like `playback:*`: fans out per source, emits a snapshot as each answers, and can be cancelled. |
| `searchSuggestions.ts` | Title autocomplete merged across Cinemeta + TVmaze + AniList, deduped on normalised title+year, misspelling-tolerant. Their blind spots do not overlap — see the file header for what was measured about each. `instant()` is synchronous and answers from an exact or longest-prefix cache hit with no I/O; `suggest()` publishes per source and runs the genre lookup *behind* the answer. |
| `searchHistory.ts` | Past search *queries* (not results — a cached result set goes stale silently), stored via the datastore so backups carry it. |
| `sourceCache.ts` | Resolved sources, with expiry tracked **per source**: magnets never expire, provider links carry a deadline read from the URL (`Expires`/`exp`/JWT claim, case-insensitively) or a short TTL. A cache hit can be partially stale — good magnets beside dead links — and `read()` reports that split. |
| `subtitleService.ts` | Online subtitle search via the keyless OpenSubtitles v3 Stremio addon, keyed by IMDb id. Converts SubRip to WebVTT, which is **not optional**: `<track>` rejects `.srt` silently. |
| `media/mediaInspector.ts` | ffprobe → `MediaMetadata`; transport and DRM classified from the manifest body, never the URL. |
| `media/decisionEngine.ts` | Pure decision: metadata + host capability + DRM → `TransformationPlan`. Tested exhaustively; see the codec section. |
| `media/playbackEngine.ts` | Inspect → decide → open, and the only way to obtain a URL to attach. Owns playback telemetry. |
| `media/mpvEngine.ts` | The native engine. Spawns mpv, drives it over JSON-RPC, and reports snapshots. For the streams Chromium will never decode — see below. |
| `mediaTranscoder.ts` | Executes a plan as a live fragmented-MP4 stream on loopback, plus embedded-subtitle extraction. |
| `metadataProvider.ts` | TVmaze + AniList. **Catalogue metadata only, never streams.** Its key output is the IMDb id, which indexers match on far better than free text. |
| `cinemeta.ts` | Stremio Cinemeta metadata provider, prioritised in search. |
| `metadata/enrichmentService.ts` | Cast, crew, ratings, debut date and production notes, merged from four keyless catalogues. Push-shaped and cached; never on the playback path. See below. |
| `metadata/merge.ts` | Merging what several catalogues say about one title. Pure and tested — every wrong answer here is silent and plausible. |
| `metadata/wikidata.ts` | Cast **with characters** for film, plus crew, release date and box office. The keyless answer to the one thing TMDB is usually reached for. |
| `metadata/tvmaze.ts` | Cast and crew with real photographs, for television. Two endpoints on a host the app already talks to and had never asked. |
| `metadata/anilist.ts` | Characters, their voice actors in every language, and staff, for anime. Both name pairs in both scripts. |
| `metadata/wikipedia.ts` | "Behind the scenes" prose. The article is a Wikidata sitelink, **never a search** — see below. |
| `metadata/cinemetaExtras.ts` | The half of Cinemeta's reply the app already pays for and drops: director, writer, `released`, country, awards, trailers. |
| `src/utils/metadataDisplay.ts` | Rendering rules for the above. Pure; owns the partial-date trap. |
| `pluginManager.ts` | `.cs3` repository discovery, plugin-list parsing (mirrors upstream `RepositoryManager.kt`), download + SHA-256 verification, Android-style install paths, then hands archives to the sidecar. Also owns the enable/disable cascade — see the extensions-screen section. |
| `cs3/providerLinks.ts` | Reads a provider's reply without guessing: link type, DRM, playlist parts, audio-track headers. Pure and tested — every wrong answer here looks like a bad provider rather than a bad routing decision. |
| `pluginAnalyzer.ts` | Static compatibility classification of a plugin before it is trusted. |
| `cs3/sidecarSupervisor.ts` | Spawns and supervises the JVM child process; line-delimited JSON-RPC over stdio; never throws on a missing/broken sidecar. Also routes the *reverse* frames — see `webViewHost.ts`. |
| `cs3/webViewHost.ts` | The browser the JVM cannot open for itself. Offscreen `BrowserWindow` per resolve, `webRequest` watching for the provider's intercept pattern, cookies harvested for `CloudflareKiller`. |
| `cs3/webViewMatch.ts` | What a page's subrequests mean. Pure and tested, because every wrong answer here is attributed to the provider instead. |
| `cs3/extensionUpdater.ts` | Over-the-air extension updates on a schedule, so a provider fix does not wait for an app release. |
| `cs3/bootstrap.ts` | First-run install of the bundled repositories, and the adult-content opt-in. |
| `cs3/diagnostics.ts` | Provider failures with the context that makes them reproducible. See below. |
| `cs3/extensionIssues.ts` | The **durable tally** of distinct extension problems, across restarts and log rotation. `diagnostics` is one failure shaped to be pasted; the logger is a per-session transcript; this is the "count before fixing" list. See below. |
| `cs3/providerRegistry.ts` | What each archive registered, keyed by size+mtime+runtime generation. Hydrates the provider list at launch **without starting the JVM** — the fix for a 57–67s first search. See below. |
| `cs3/providerRecovery.ts` | Making a provider a saved page names answer again. `planRecovery` is pure and returns the ordered steps, because the button has to say what it will do — a repository fetch and a DEX translation — *before* it starts. It fixes the whole enable cascade, not just the provider switch: the old handler called `setProviderEnabled` alone, which on the common post-restore state (repository off, or extension not installed at all) completed successfully and changed nothing observable. It never adds a repository the app was not already told about — a `cs3ext://` address travels in library rows, and accepting a URL out of one would make "reopen my saved page" a way to install code from anywhere. |
| `cs3/titleOutcomes.ts` | How each title last behaved, so a dead row is not clicked twice. |
| `cs3/ottPlatforms.ts` | The OTT platform table and the rule for deciding which provider is one. Pure and tested — a matcher one character too loose fills the Prime Video page with a torrent aggregator called PrimeWire and nothing says so. |
| `cs3/nativeProviderRegistry.ts` | The roster of providers compiled into the app, and the native mirror of `enabledProviderNames` — the adult gate and the disable cascade, in one place. |
| `cs3/nativeProviders/types.ts` | The `NativeProvider` interface and `cs3native://` addressing. Pure. |
| `cs3/nativeProviders/internetArchive.ts` | ~52,000 public-domain films, documentaries and classic TV. The query form is measured, not designed — see below. |
| `cs3/nativeProviders/peerTube.ts` | Federated video via SepiaSearch. A video's files live on its **own** instance, not the search host. |
| `cs3/nativeProviders/iptvOrg.ts` | 17,230 free-to-air live streams from the open iptv-org dataset; ~70% answer. |
| `cs3/nativeProviders/stremioAddon.ts` | Any Stremio addon, by manifest URL. `idPrefixes` is a hard constraint — an addon 500s on an id it does not speak. |
| `cs3/nativeProviders/jellyfin.ts` | The user's own Jellyfin/Emby server. The key travels as a header, never in a URL, and never reaches the renderer. |
| `cs3/ottService.ts` | The same table against what is installed: availability, the search scope for a platform page, and the repositories to offer when nothing serves it. |
| `download/resumePlan.ts` | Whether a partial download survives its link being replaced. Pure; both failure modes are silent and opposite. |
| `download/resumeWindow.ts` | The 64 KB boundary probe that proves it — range support, real file length and a byte comparison in one request. |
| `cs3/batchDownloader.ts` | Season/series batch download orchestration. |
| `cs3/libraryStore.ts` | Watch state, resume progress, library buckets, and remembered source choices. |
| `cs3/bookmarkStore.ts` | Saved *detail pages*, with the provider, extension, repository and query that produced them. Deliberately **not** the library: that keys on a normalised title so one film from five providers is one entry, which is right for watch tracking and useless for "reopen the page I was on". Identity and origin are stored; resolved links are not, because they expire. |
| `cs3/providerAnalytics.ts` | How every provider has actually behaved, counted. Aggregates only — no queries, no titles, no viewing history — because provider quality does not depend on any of them and this file is meant to be shareable. `empty` is tracked separately from `failure`: a provider with nothing for this title is working, and folding the two together would rank providers by catalogue breadth. |
| `cs3/providerRanking.ts` | Weighted scoring over those counts. Criteria are **rows in a table**, not a formula: an id, a weight, a sample floor and a function to `0..1` or `null`. A `null` is excluded from the denominator rather than scored zero — a provider nobody has downloaded from must not rank below one whose downloads always fail. Rates are smoothed toward a neutral prior so a new extension starts mid-table and can never be permanently buried by one unlucky first call. |
| `cs3/providerRecommendations.ts` | Turns scores into advice, and (only with `autoEnableProven`) into action. Nothing is ever auto-**disabled**: a site being down for a week is not consent to remove a source the user chose. |
| `cs3/failureTaxonomy.ts` | `classifyFailure` — one closed set of causes, shared by the ranking, the diagnostics and the issue ledger. Counting free text produces a tally with one entry per failure; grouping by cause is what showed 113 load failures came from six missing classes. Also owns `groupingForm`, moved here from `diagnostics.ts` because that module imports `electron` and cannot be loaded under Node's type stripping. |
| `cs3/sidecarStderr.ts` | What a line of JVM stderr *means*: level, the tag that printed it, and a cause. Pure and tested — it is the only attribution the corpus offers. |
| `cs3/discovery.ts` | The home screen's catalogues. Stale-while-revalidate over Stremio's keyless Cinemeta catalogs (`top`/`year`/`imdbRating`, filterable by 19 genres, pageable) plus AniList for anime. Finds **nothing playable** — sources are resolved by providers when an item is opened. |
| `cs3/titleEnricher.ts` | Resolves `Avengers End Game 720p Hindi Dubbed` to the film it is about. Conservative on purpose: a disagreeing year is disqualifying and the similarity bar is high enough that `Avengers` does not match `Avengers: Endgame`. An unenriched row is a small loss; a mislabelled one reads as data corruption. |
| `torrent/torrentEngine.ts` | WebTorrent + loopback HTTP server with range support. Sequential pieces; the player only ever sees `http://127.0.0.1:PORT/…`. Warmed at launch — see below. |
| `torrent/torrentMetadata.ts` | `.torrent` bytes cached by infohash, verified against it. A cache hit means `add()` has the piece hashes synchronously and the swarm is needed only for bytes. Also builds the `xs` mirror URLs. |
| `torrent/torrentContents.ts` | What is actually *in* a torrent, as something a person can browse: seasons, episodes, samples, extras. Pure and tested for the reason `ottPlatforms.ts` is — every wrong answer is silent and plausible, and the viewer attributes it to the torrent. Extension decides the kind, never the folder; a sample is recognised by size ratio as well as by name. |
| `torrent/dhtNodeCache.ts` | The DHT routing table, node id and port, persisted. Turns a cold bootstrap into a warm one. |
| `torrent/indexerRegistry.ts`, `indexers/*` | 17 built-in adapters — 4 Stremio stream addons, 10 JSON APIs, 3 HTML scrapers — plus Torznab (Jackett/Prowlarr). Counted from the registry switch on 2026-09-03; this line said 7 for a long time after it stopped being true. |
| `torrent/ranker.ts`, `releaseParser.ts` | Release-name parsing (quality/codec/group/season/episode) and result ranking. |
| `externalPlayerControl.ts` | Two-way control of VLC over its HTTP interface. Capability is declared per player, never assumed — see below. |
| `media/inspectionStore.ts` | Persists what a probe found, keyed on the origin URL. The measurement only; the verdict is recomputed. |
| `downloadService.ts`, `aria2Engine.ts`, `ytdlpEngine.ts`, `binaryDownloader.ts` | Downloads via aria2c RPC with an HTTP fallback; portable `aria2c`/`yt-dlp` binaries are fetched on first use. |
| `src/utils/deadRows.ts` | Which search results are worth showing. `no-sources` hides; `app-error` never does — see below. |
| `src/components/player/useFloatingPlayer.ts` | Picture-in-Picture, the window pin, the background policy and the Media Session record. |
| `src/components/settings/settingsLevel.ts` | Simple versus Everything, and what `advanced` means. |
| `preload.ts` | The typed API surface. `subscribe()` unified 14 listener/teardown pairs (teardown prevents accumulation across React remounts). |
| `datastore.ts` | Android's 6-bucket key grammar (`_Bool/_Int/_String/_Float/_Long/_StringSet`) for lossless Android backup import. Non-transferable keys filtered on import by regex. |
| `contentService.ts` | `search → MetadataProvider → getSources → IndexerRegistry → startStream → TorrentEngine`. Extension providers first, torrents fallback. `cs3ext://` bypasses indexers. Also the one funnel that captures page snapshots. |
| `playbackSession.ts` | One "Play" interaction; opens the player before a stream exists and streams discovery into it; owns in-player switching/refresh via a retained `SourceQuery`. |
| `searchScope.ts` | Which sources a search may ask — a selection is a strict filter, not a preference. |
| `searchSession.ts` | One "Search" interaction; push-shaped, fans out per source, cancellable. |
| `searchSuggestions.ts` | Autocomplete: Cinemeta + TVmaze + AniList merged, deduped, misspelling-tolerant. Instant from cache, progressive from the network, superseded runs aborted. |
| `searchHistory.ts` | Past *queries* only — results go stale silently. |
| `sourceCache.ts` | Per-source expiry: magnets never expire; provider links take a deadline from the URL (`Expires`/`exp`/JWT) or a short TTL. |
| `subtitleService.ts` | Keyless OpenSubtitles v3 Stremio addon by IMDb id. SubRip→WebVTT is mandatory (`<track>` rejects `.srt` silently). |
| `subtitles/convert.ts` | SubRip/ASS/SSA → WebVTT + charset detection. |
| `mediaProxy.ts` | Loopback HTTP with provider headers applied; HLS/DASH manifest rewriting; range handling. |
| `mediaTranscoder.ts` | Executes a `TransformationPlan` as live fragmented-MP4 on loopback; embedded-subtitle extraction. |
| `media/mediaInspector.ts` | ffprobe → `MediaMetadata`; transport and DRM from the manifest **body**, never the URL. |
| `media/decisionEngine.ts` | Pure `(metadata, transport, rendererCaps, hostEncoder) → TransformationPlan`. No I/O. |
| `media/playbackEngine.ts` | Inspect→decide→open; the only source of a playable URL; owns telemetry. |
| `media/mpvEngine.ts` | Native engine: spawns mpv, JSON-RPC over pipe/socket, snapshots. |
| `media/mpvEmitPolicy.ts` | Which mpv snapshots go now and which may wait a tick. Pure, tested. |
| `media/inspectionStore.ts` | Persists probe findings keyed on **origin** URL; verdict always recomputed. |
| `metadataProvider.ts` | TVmaze + AniList — catalogue metadata only, never streams. Key output: IMDb id. |
| `cinemeta.ts` | Stremio Cinemeta metadata, prioritised in search. |
| `anilist.ts` | The one AniList GraphQL client (3 hand-rolled POSTs were merged). |
| `pluginManager.ts` | `.cs3` repo discovery, plugin-list parsing, download + SHA-256, install paths, hands archives to the sidecar; owns the enable/disable cascade. |
| `pluginAnalyzer.ts` | Static compatibility tiering before trust. |
| `cs3/sidecarSupervisor.ts` | Spawns/supervises the JVM; line-delimited JSON-RPC over stdio; never throws on a broken sidecar; routes reverse frames. |
| `cs3/providerLinks.ts` | Reads a provider's reply without guessing: link type, DRM, playlist parts, audio headers. |
| `cs3/extensionAddress.ts` | `looksLikeLinksHandle` / `looksLikePageAddress` — a links handle is not a page address. |
| `cs3/webViewHost.ts` | Hidden `BrowserWindow` per resolve; `webRequest` watching; cookies harvested for `CloudflareKiller`. |
| `cs3/webViewMatch.ts` | What a page's subrequests mean. Pure, tested. |
| `cs3/hostDeadline.ts` | How long the host may work on a call the sidecar is waiting on. Pure, tested; **the worker stops before the waiter does**. |
| `cs3/providerRegistry.ts` | What each archive registered, keyed `size:mtime:generation`; hydrates the provider list without starting the JVM (67s → 8ms). |
| `cs3/providerRecovery.ts` | `planRecovery` (pure) — ordered steps to make a saved page's provider answer again; never adds an unknown repository. |
| `cs3/extensionUpdater.ts` | Scheduled OTA extension updates. "Update all" re-checks rather than reading the persisted snapshot; an update installs into the directory the *record* names and downloads from the repository the *update* names. |
| `cs3/rpcResult.ts` | `RpcResult` + `isTransportFailure` — "the runtime never answered" vs "the answer was no". Pure, tested. |
| `cs3/bootstrap.ts` | First-run bundled-repo install + adult opt-in. |
| `cs3/diagnostics.ts` | Provider failures with reproducible context (the tuple, not a message). |
| `cs3/extensionIssues.ts` | Durable tally of distinct extension problems across restarts/rotation. |
| `cs3/failureTaxonomy.ts` | `classifyFailure` — one closed cause set shared by ranking/diagnostics/ledger; also `groupingForm` and `UNSCORED_FAILURE_KINDS`. |
| `cs3/sidecarStderr.ts` | JVM stderr line → level/tag/cause. |
| `cs3/titleOutcomes.ts` | Last behaviour per title, so dead rows aren't reclicked. |
| `cs3/titleInteractions.ts` | Every card's state, assembled. Owns **one** fact (a details page was opened) and joins the rest live. Batched, because a catalogue page is forty posters. |
| `metadata/videoTitles.ts` | What a promotional video *is*, read out of its own title — kind, label, season, ordinal, official. Pure, tested against real oEmbed titles. |
| `metadata/youtube.ts` | Keyless oEmbed: a video id → its real title, channel and thumbnail. 12 ids in **201 ms**, measured. A 401/404 means the video is gone and its card is dropped. |
| `cs3/titleEnricher.ts` | Messy release titles → canonical works; conservative (a disagreeing year disqualifies). |
| `cs3/discovery.ts` | Home catalogues: stale-while-revalidate Cinemeta (`top/year/imdbRating`, 19 genres) + AniList. Finds nothing playable. |
| `cs3/ottPlatforms.ts` | OTT platform table + name-matching rule. Pure, tested. |
| `cs3/ottService.ts` | Platform table × what's installed: availability, search scope, install offers. |
| `cs3/nativeProviderRegistry.ts` | Compiled-in provider roster; mirrors `enabledProviderNames` (adult gate + disable cascade). |
| `cs3/nativeProviders/*` | `types.ts` (`NativeProvider`, `cs3native://`), `internetArchive.ts`, `peerTube.ts`, `iptvOrg.ts`, `stremioAddon.ts`, `jellyfin.ts`. |
| `cs3/libraryStore.ts` | Watch state, resume progress, library buckets, remembered source choices. |
| `cs3/bookmarkStore.ts` | Saved detail pages (provider/extension/repo/query) — not the library (that keys on normalised title). |
| `cs3/pageSnapshot.ts` | Last-known-good copy of every detail page opened, plus its routes and origin. |
| `cs3/playedSource.ts` | Which source actually played, per title+season+episode. |
| `cs3/searchOrder.ts` | Which provider the fan-out asks first; refuses any ordering that is not the same set. |
| `cs3/sourceScope.ts` | `origin` vs `all` discovery scope, and when to widen. |
| `cs3/sourceProfiles.ts` | Named search configurations — the state machine. Pure, tested. **All sources is a mode, not an erasure.** |
| `cs3/sourceProfileStore.ts` | Persists profiles, writes the effective scope through to `SearchScopeStore`. |
| `cs3/sourcePrefetcher.ts` | Finds sources while the detail page is being read. |
| `cs3/providerAnalytics.ts` | Behaviour counts, aggregates only (no queries/titles/history). `empty` tracked separately from `failure`. |
| `cs3/providerRanking.ts` | Weighted scoring, criteria as table rows; `null` excluded from the denominator, not scored zero; rates smoothed toward a neutral prior. |
| `cs3/providerRecommendations.ts` | Scores → advice/action (`autoEnableProven`). Never auto-disables. |
| `cs3/backupService.ts` | Backup/restore as a **table of sections**, not switch statements. |
| `cs3/batchDownloader.ts` | Season/series batch orchestration. |
| `download/resumePlan.ts` | Pure decision: does a partial download survive a link swap. |
| `download/resumeWindow.ts` | 64KB boundary probe: range support + real length + byte compare, in one request. |
| `downloadService.ts`, `aria2Engine.ts`, `ytdlpEngine.ts`, `httpDownloader.ts`, `fastDownloader.ts`, `binaryDownloader.ts` | aria2c RPC + HTTP fallback; portable binaries fetched on first use. |
| `torrent/torrentEngine.ts` | WebTorrent + loopback HTTP with range support; sequential pieces; warmed at launch. |
| `torrent/torrentMetadata.ts` | `.torrent` cached by infohash, self-verifying; builds `xs` mirror URLs. |
| `torrent/torrentContents.ts` | Seasons/episodes/samples/extras from a torrent; sample recognised by size ratio too. |
| `torrent/dhtNodeCache.ts` | Persisted DHT routing table / node id / port. |
| `torrent/indexerRegistry.ts`, `indexers/*` | 19 built-in adapters (4 Stremio, 12 JSON/RSS, 3 HTML) + Torznab. |
| `torrent/indexerBudget.ts` | Per-indexer deadline from measured latency, escalating cooldown, fastest-first order. Pure, tested. |
| `torrent/botChallenge.ts` | Challenge vs block vs rate limit. Pure, tested. |
| `torrent/swarmHealth.ts` | Reachability, as distinct from known peers. |
| `torrent/ranker.ts`, `releaseParser.ts` | Release parsing + result ranking. |
| `torrent/http.ts` | **The injected fetch** — Electron's `net.fetch`. See §12. |
| `externalPlayer.ts`, `externalPlayerControl.ts` | Detection + two-way VLC control over HTTP; capability declared per player. |
| `logging/logger.ts`, `redact.ts` | NDJSON per-launch transcript, buffered, flushed on a timer. |
| `util/jsonFileStore.ts` | Debounced persistence (5 copies unified). |
| `util/disabledSet.ts` | The enable-cascade toggle (3 copies unified). |
| `util/prune.ts` | Drops empty keys so a merge cannot blank a known value — the mechanical half of the never-blank rule (§9.2). Was byte-identical in `bookmarkStore` and `pageSnapshot`. |

### Renderer modules worth knowing

| File | Responsibility |
|---|---|
| `src/utils/savedPage.ts` | Draws a page from its snapshot and folds a live answer over it **without blanking**. |
| `src/utils/errors.ts` | `describeError` — never returns empty; unwraps `error.cause`. |
| `src/utils/format.ts` | The byte formatters, kept as parameters (see §12). |
| `src/utils/sourceIdentity.ts` | `normaliseReleaseName` / `hasRealInfoHash`. |
| `src/utils/historyEvent.ts` | `historyEventForTask` — the one download-task→history-record mapping. Was spelled out field-by-field in `downloadService`, `App.tsx` and `VideoPlayer`; three copies of a fallback chain drift rather than break. |
| `src/utils/downloadIdentity.ts` | A download is addressed by its source variant, not its title. |
| `src/utils/deadRows.ts` | Which results to hide (`no-sources`) vs never hide (`app-error`). |
| `src/utils/cardState.ts` | What a poster says about a title already met. Pure, tested, mutation-verified. **Failure is always marked, success almost never is**; a failure the viewer has since disproved is retired. |
| `src/utils/videoGallery.ts` | Trailers vs related videos, grouped by season. Pure, tested. |
| `src/utils/trailerQueue.ts` | What autoplays after a trailer: same rail, no wrap. Pure, tested. |
| `src/utils/experienceMode.ts` | Standard vs developer, `shouldReveal`, and `plainMessage` — one internal message to one sentence a viewer can act on, with the original kept. |
| `src/components/useTitleInteractions.ts` | The batched card-state hook; re-asks on `download:progress`, coalesced. |
| `src/utils/resumePoint.ts` | **Null episode means "Play"**; furthest episode with history wins. |
| `src/utils/useDismissable.ts` | Dismiss-on-outside-click, capture phase (8 copies unified). |
| `src/utils/useFlash.ts` | Toast timers (20+ hand-rolled copies unified). |
| `src/utils/clearKey.ts`, `clearKeySession.ts` | ClearKey hex/base64url conversion + EME session. |
| `src/utils/subtitleStyle.ts` | One appearance record, two renderers (`::cue` vars and mpv properties). |
| `src/utils/sourceExport.ts` | CSV/text export; RFC 4180 quoting. |
| `src/components/search/sourceScopeModel.ts` | The scope dialog's row/facet vocabulary and tri-state rule. Pure, tested. |
| `src/components/search/providerHealth.ts` | The ranking's band as a word a chooser can act on. Pure, tested; **unmeasured is never "average"**. |
| `src/components/player/playbackRecovery.ts` | What a transport failure costs next. Pure, tested. |
| `src/components/player/useFloatingPlayer.ts` | PiP, window pin, background policy, Media Session record. |
| `src/components/settings/settingsLevel.ts` | Simple vs Everything semantics. |
| `src/components/Poster.tsx`, `EmptyState.tsx` | Shared primitives with per-call-site fallbacks. |

---

## Domain notes

Four areas carry more hard-won detail than one file should load every session, so their depth
lives in `docs/agents/`. **Each capsule below is self-contained**: the mechanism, the modules
that implement it, and the rules that must not be broken. You can work from a capsule alone.
Open the domain file when you need the *why* — the measurement behind a number, the failure a
rule prevents, or the history of a design you are about to change.

**Section numbers are continuous across the set**, so a cross-reference like `§6.10` resolves
whichever file you are in. The domain files carry the same authority as this one.

---

### §5 — Extensions, the sidecar and the android shim → `docs/agents/extensions.md`

**Mechanism.** A `.cs3` is a ZIP of Android DEX bytecode compiled against upstream's Kotlin
provider API. `sidecar/` is a **separate JVM OS process** (not a thread), so a hanging plugin
degrades to "unavailable" instead of taking the app down. `DexTranslator` converts DEX→JVM via
dex2jar once at install, cached by SHA-256; `LinkageAnalyzer` assigns a tier `T1_DROPIN`…
`T4_BLOCKED`; `PluginHost` reproduces Android's load sequence; hand-written `android/**` stubs
cover the platform classes providers reach for. Providers are addressed `cs3ext://<provider>/<handle>`.

**Modules.** `sidecar/` (Java) · `sidecar/bridge/` (Kotlin, supplies `:app` types) ·
`electron/pluginManager.ts` (repos, download, SHA-256, enable cascade) ·
`cs3/sidecarSupervisor.ts` (JSON-RPC over stdio) · `cs3/providerRegistry.ts` (what each archive
registered) · `cs3/webViewHost.ts` (Cloudflare challenges) · `cs3/extensionIssues.ts` +
`failureTaxonomy.ts` (diagnosis) · `cs3/nativeProviders/*` (compiled-in providers).

**Rules:**
- **Call `ensureProviderActive(name)` before using a provider.** Loading is lazy and per-archive, deduped by an in-flight map.
- **Provider loading cannot be parallelised** — providers self-register into a global, and overlapping loads steal each other's providers (measured: 176 mis-attributed).
- **Bump `RUNTIME_GENERATION`** whenever the shim, bridge or translator changes (currently **14**). The app runs a *copy* in `%APPDATA%`, not what you just built.
- **`cs3-provider-bridge.jar` must live in `sidecar/runtime/`** — same loader as `library-jvm.jar`, or `BasePlugin` resolves as two different classes.
- **The sidecar's stdout carries RPC frames and nothing else.** A stray `println` desyncs the channel; logs go to stderr.
- **Shim rule: concede the type, refuse the operation.** Never widen a parameter or return type to `Object` (it renames the method — `ShimSignatureTest` enforces this); never forge the package name; never fake a platform number.
- **`PluginHost.call` must catch `LinkageError`, not just `ReflectiveOperationException`** — `Class.getMethod` resolves every public method's types, so one missing class kills a whole extension after it registered.
- **A provider that works until you press Play** → check `KotlinNameRepair` first (dex2jar corrupts Kotlin mangled names).
- **Never reintroduce a synthetic or placeholder source.** Empty result plus a reason, always.
- **The adult gate is `PluginManager.enabledProviderNames`** — the single funnel search, scope, discovery, playback and downloads all pass through.
- **Built-in providers use `cs3native://`, never `cs3ext://`** (wrong-attribution failures).
- **The WebView host must finish before the sidecar stops waiting** (`cs3/hostDeadline.ts`) — the reverse channel carries one deadline and both ends used to spend it.
- The upstream jar lane exists but only **1.9%** of the corpus publishes one — don't plan work assuming it.

---

### §6 — Playback and the media engine → `docs/agents/media.md`

**Mechanism.** Chromium cannot decode much of what people stream — **AC-3, E-AC-3 and DTS return `""`**, and bare `video/x-matroska` reports `"maybe"` then drops audio silently; no HEVC without platform decoders. So playback is **inspect → decide → execute**: ffprobe produces `MediaMetadata`, a *pure* decision function turns metadata + renderer capabilities + host encoder into a `TransformationPlan`, and the plan is executed as live fragmented-MP4 on loopback, played natively, or handed to **mpv** (its own window, driven over JSON IPC, hardware decode). `MediaProxy` serves everything from loopback because a browser cannot send the provider's `Referer`.

**Modules.** `media/mediaInspector.ts` · `media/decisionEngine.ts` (pure, tested) ·
`media/playbackEngine.ts` (the only source of a playable URL) · `media/mpvEngine.ts` +
`mpvEmitPolicy.ts` · `mediaTranscoder.ts` · `mediaProxy.ts` · `media/inspectionStore.ts` ·
`subtitles/convert.ts` · `src/components/VideoPlayer.tsx` + `player/playbackRecovery.ts`.

**Rules:**
- **`media:prepare` is the only source of a playable URL.** Assigning `video.src` — or handing mpv a link — from anything else reintroduces a fixed race. No channel returns an unclassified URL.
- **Nothing is decided from a URL string.** Transport comes from the first 64KB of body (`#EXTM3U`/`<MPD`); codecs from the probe; DRM from the provider's declaration or the manifest.
- **`-c:v copy` never runs on unverified codec info** — re-wrapping undecodable HEVC fails identically and looks like a different bug.
- **Renderer capabilities are registered before playback** (`App.tsx` → `media:setCapabilities`) and override the static table **in both directions**.
- **A track switch re-derives the plan** (`planForAudioTrack`) — never re-index an existing one, or ffmpeg fails outright.
- **The software 4K guard is arithmetic, not a heuristic** — pixels per second, not height.
- **HDR re-encodes get the full `zscale` tone-map chain or none at all** — `tonemap` alone is measurably worse than nothing.
- **mpv:** hand it the **proxied** URL; `--no-config`; `--volume-max=100`; `--input-default-bindings=no` (defaults quit on `q`, which reads as "film ended"); use `mpv.com`, not `.exe`; wire it into `before-quit`.
- **Nothing reaches the main thread per frame or per chunk.** mpv snapshots are coalesced (`mpvEmitPolicy.ts`, 200ms) and proxy route eviction is scheduled, not per-mint — both were "not responding" freezes.
- **Probes are cached by *origin* URL; verdicts are always recomputed** — a verdict depends on this machine's decoders.
- **A loopback URL returned from `wrap` is untouched**, or output gets double-wrapped one hop per call.
- **PRD-40.1's `sourceLease.ts` and `playbackTelemetry.ts` are built, tested and never wired** — green suites over unreachable code. See §6.11 before touching either.

---

### §7–8 — Torrents, indexers, search and ranking → `docs/agents/torrents-and-search.md`

**Mechanism.** Torrents run on WebTorrent with a loopback HTTP server doing range requests and
sequential pieces, warmed at launch because the costs are cold-client costs (DHT bootstrap,
info dictionary), never the swarm. Search fans out **8 providers at a time**, push-shaped via
`search:update`, ordered by measured provider health. 19 built-in indexers each get a deadline
derived from their own measured latency. Scope decides which sources a search may ask.

**Modules.** `torrent/torrentEngine.ts` · `torrentMetadata.ts` · `dhtNodeCache.ts` ·
`indexerRegistry.ts` + `indexers/*` · `indexerBudget.ts` · `botChallenge.ts` · `swarmHealth.ts` ·
`searchSession.ts` · `searchScope.ts` · `cs3/sourceScope.ts` · `cs3/searchOrder.ts` ·
`providerAnalytics.ts` + `providerRanking.ts` · `cs3/sourceProfiles.ts`.

**Rules:**
- **A scope selection is a strict filter, not a preference.** An unresolvable selection is *reported*, never silently widened back to everything. Providers selected ⇒ exactly those, no catalogues.
- **Discovery defaults to `origin` scope** (only the providers that produced the row), widening to `all` automatically when nothing is found. A failed escalation leaves the narrow answer standing.
- **`searchOrder` falls back to the original order** if the ranking returns anything that is not the same set. Silently searching fewer sources and calling it "no results" is the worst failure this app has.
- **`empty` ≠ `failure`.** An anime provider with nothing for *Dune* is correct.
- **An unscored failure is not recorded at all** (`UNSCORED_FAILURE_KINDS`) — recording it in `attempts` alone still moves the success rate.
- **Nothing is ever auto-disabled.** Auto-*enable* is opt-in and gated.
- **Indexer deadline = p90 of that indexer's own successes × 2.5, clamped [4s, 20s]**; only successes shape it, or timing out buys a longer deadline. Cooldown escalates; any success resets it.
- **A block or a rate limit never opens a browser** — only a genuine challenge does. A Cloudflare challenge is routinely served as **HTTP 200**.
- **DHT: saved contacts go through `addNode()`, never `bootstrap`**; `dhtPort` is pinned to 6882.
- **All sources is a mode, not an erasure** — it must never throw away a saved selection.
- **Zero-pad episode terms** (`S01E02`); `S1E2` matches nothing and reads as "the indexer has nothing".

Found by reading `recloudstream/gradle` `master` rather than by chasing a symptom. The Gradle
plugin gained `isCrossPlatform`: set it, and `make` emits a plain JVM **`.jar`** beside the
`.cs3`, `ensureJarCompatibility` runs **`jdeps --print-module-deps`** over it and *fails the
build* if the output contains `android.`, and `writeCacheEntry` puts `jarUrl`, `jarHash` and
`jarFileSize` into the plugin entry. **The published `plugins.json` already carries those three
fields and `pluginManager` ignores all of them.**

That artifact needs no translation. For an archive that opts in, `DexTranslator`,
`KotlinNameRepair`, the hash-keyed translation cache, the concurrent-translation nonce and the
generation-keyed cache drop all become dead code on the load path — every one of which has been
a real defect in this repository at least once. Note the corpus survey above: **67.6% of
providers import no `android.*` at all**, so most of the corpus is already eligible and simply
has not been asked.

What it does **not** retire, and claiming otherwise would be overclaiming: `jdeps` flags
`android.*` only. A cross-platform jar still links against `library-jvm` and can still reach the
`:app` types the bridge supplies (`Plugin`, `DataStore`, `CloudflareKiller`, `syncproviders`).
`LinkageAnalyzer` still runs and tiers still apply. This removes the *bytecode* problem, not the
*classpath* one.

There is currently no host anywhere that consumes that jar, which makes setting the flag worth
nothing to an author today. Doc 41 §6.3 argues we should be that host and that this is the
cheapest lever we have on the upstream ecosystem's portability.

### …and now it does: the cross-platform jar lane (2026-08-28)

PRD-41 **M0**, built. The section above was written from upstream's Gradle source; the first
thing this pass did was count what the *live* indexes actually publish, and the answer is
larger than the PRD assumed:

| Repository | Extensions | Publishing `jarUrl` |
|---|---|---|
| `recloudstream/extensions` (official) | 5 | **5** |
| `phisher98/cloudstream-extensions-phisher` | 79 | **47** |
| `Kraptor123/cs-kraptor` | 67 | 0 |

Every jar checked matched its declared `jarHash` and `jarFileSize` exactly. So this is not a
lane anyone is being asked to adopt — **it is one a large part of the corpus already publishes
into, with nothing reading it.**

`PluginManager.chooseArtifact` now prefers the jar wherever one exists, verifying it against
`jarHash` (**not** `fileHash` — that is the `.cs3`'s digest and would fail every
cross-platform install; taking the mismatch as permission to skip verification would be worse
than not checking at all). `extensionUpdater` copies the three fields through when it
re-resolves against the live repository, or an update would quietly move a translation-free
extension back onto the DEX lane with nothing saying so.

**The archive keeps its `.cs3` path and file name, and that is deliberate.**
`PluginArchive.detect` classifies by **contents**, never by extension: a `.dex` member means
the DEX lane, `.class` members mean the jar lane. The file name is chosen by whoever
downloaded it and is exactly the sort of thing that drifts — a repository renaming artifacts,
a path written by an older build. Keying on it would also have meant touching
`installPathFor`, `backupPathFor`, `archivePathFor`, the updater's existence checks and the
missing-archive report, each a place to forget.

**The one real difference at load time is that a published jar has no `manifest.json`.**
Measured: a `.cs3` contains exactly two members, `manifest.json` and `classes.dex`; the jar
beside it contains the module's compiled output and nothing else. Android's load sequence
reads that file *through the class loader* to learn `pluginClassName` (step 5), and on this
lane there is no file to read. The entry class is recovered the way upstream's own build finds
it in the first place — by scanning for the **`@CloudstreamPlugin` annotation** with ASM.
Verified on `recloudstream/DailymotionPlugin.class`, which carries
`Lcom/lagradost/cloudstream3/plugins/CloudstreamPlugin;` and extends `BasePlugin`. That is a
stronger signal than `*Plugin.class`, which is a convention authors are free to ignore.

Two rules in `PluginArchive` are load-bearing:

- **Two annotated classes are reported, never arbitrated.** Picking whichever the zip listed
  first would make which provider loads a property of archive ordering — reproducible on the
  machine it was built on and nowhere else.
- **A class file ASM cannot parse is skipped, not fatal.** It is one member of an archive that
  may hold fifty, and losing the extension over a class the plugin never touches is the wrong
  trade.

`PluginHost.prepare` is where the branch lives, and it is the *only* place it lives: `install`
and `load` both need a jar of bytecode, an entry class, somewhere to read resources from, and a
failure to report, and a second copy of the load sequence for the jar lane is how the two would
silently drift apart. On the DEX lane the classpath is still two entries (translated jar +
original archive, so `manifest.json` resolves as it does on Android); on the jar lane it is one,
because there is nothing else in it to resolve.

**`PluginCompatibilityAnalyzer` had to learn the lane too, and this was a real defect.** A jar
reached the existing "no `classes.dex`" branch, which reports `Unsupported` with a score of
**0** — the exact opposite of the truth for the one lane that skips translation entirely, shown
on the install screen. It now reports `format: 'CSJ'`, 95%, `TierA_SourceJVM`, and says why:
upstream's build ran `jdeps` over this jar and refused to publish it if a single `android.` type
appeared.

The jar lane is what **generation 9** was for (the current value is **11** — see
`runtimeProvisioner.ts`, which carries one paragraph per generation). An already-provisioned
sidecar has none of this: handed a jar it
would call dex2jar, be told there is no `classes.dex`, and report a translation failure for an
archive that never needed translating — while the upgraded host had already started preferring
jars.

`tools/e2e/provider-e2e.mjs` makes the same choice the app makes, and **`--lane cs3` forces the
DEX artifact** so the same corpus can be run both ways and compared — which is the
no-regression half of M0's gate. `PluginArchiveTest` (10 cases) pins detection and the
annotation scan; the sidecar suite is 42.

**Measured, `--repo phisher --plugins 6 --queries "dune,one piece"`, both lanes:**

```
                       auto (jar preferred)        --lane cs3
AllMovieLandProvider   jar  T1_DROPIN              cs3  T1_DROPIN
AllWish                jar  T1_DROPIN              cs3  T1_DROPIN
Anikage                jar  T1_DROPIN              cs3  T1_DROPIN
Anichi                 cs3  T3_DEGRADED            cs3  T3_DEGRADED   (publishes no jar)
AniDb                  cs3  T3_DEGRADED            cs3  T3_DEGRADED   (publishes no jar)
AniKoto                cs3  T1_DROPIN              cs3  T1_DROPIN     (publishes no jar)

providers loaded 6 · answering 6 · links resolved 5 · streams with bytes 3 — PASS, identically
```

Three archives loaded through the jar lane with **zero `DexTranslator` invocations**, every
one at `T1_DROPIN`, registering the same providers and answering the same queries as the DEX
artifact beside it. That is M0's gate in both directions.

**What this does not retire, repeated because it is the easy thing to overclaim:** `jdeps`
flags `android.*` and nothing else. A cross-platform jar still links `library-jvm` and can still
reach the `:app` types the bridge supplies. `LinkageAnalyzer` still runs, tiers still apply, and
a jar can still be `T3_DEGRADED`. This removes the **bytecode** problem, not the **classpath**
one.

**Translation risk was measured, not assumed.** Against all 392 real community plugins:
392 translated, 18,217 classes emitted, 0 verification failures, 6,617 Kotlin coroutine
state machines, 0 failures — see `docs/PRD/35`, reproducible via `tools/dex-spike/`.

### Provider execution: working as of 2026-08-13

PRD-36 steps 1–4 are **done**, and this section previously said they were not. Providers
now search, load and resolve playable links. Verified end-to-end against the real
`InternetArchiveProvider` from `recloudstream/extensions`: tier `T1_DROPIN`, 26 search
results, detail load, and 4 live HTTP video URLs (confirmed `HTTP 200`, `video/mp4`,
`Accept-Ranges: bytes`).

How the pieces fit:

- `sidecar/runtime-deps/pom.xml` resolves `com.github.recloudstream.cloudstream:library-jvm`
  (pinned **4.8.0**) plus its whole transitive runtime into `sidecar/runtime/` — 56 jars.
  Upstream's POM declares every third-party version (jsoup, NiceHttp, jackson, ksoup, ktor,
  rhino, fuzzywuzzy, coroutines…), so **do not restate them by hand**; transitive resolution
  reproduces exactly what providers were compiled against. Needs Google's Maven repo too:
  `androidx.annotation:annotation-jvm` is published only there.
- `sidecar/bridge/` is a **Kotlin** module producing `cs3-provider-bridge.jar`, which is
  copied into `sidecar/runtime/`. It must live there, not on the sidecar's own classpath:
  provider instances are created by the plugin loader whose ancestry runs through the shared
  loader that owns `library-jvm.jar`, and only code loaded by that same loader resolves the
  identical `MainAPI` class. The sidecar reaches it reflectively across a deliberately
  trivial surface — primitives in, JSON strings out.
- RPC methods added: `providerSearch`, `providerLoad`, `providerLoadLinks`, `providers`.
- `PluginManager.searchAll/loadMedia/loadLinks` are real now. Provider results are
  re-addressed as `cs3ext://<provider>/<handle>` because a provider's own URLs carry nothing
  identifying which provider produced them.

Two findings that contradict PRD-36 and cost real debugging time:

1. **`BasePlugin`, `CloudstreamPlugin`, `APIHolder`, `ExtractorApi` all ship inside
   `library-jvm` 4.8.0.** Doc 36 §3 treats them as `:app` types needing a hand-built
   `cs3-app-shim.jar` (~1 week budgeted). Upstream moved them; that shim was not needed.
2. **`search(query, page)` is the primary overload in 4.8.0, not `search(query)`.** Doc 36
   §4 says the reverse. Calling only the single-argument form returns "unsupported" from the
   base class for a modern provider. The bridge tries paginated first and falls back.

Also fixed while getting there, both real bugs on the load path:

- `DexTranslator` derived its temp file name from the archive SHA alone, so two concurrent
  translations of the *same* archive collided (`inspect` on install races `load`). The temp
  name now carries a nonce; the final move stays atomic.
- `PluginClassLoader` was given only the translated jar. dex2jar converts `classes.dex` and
  nothing else, so `manifest.json` — which step 5 must read *through the loader* — was not
  visible. The original `.cs3` is now a second classpath entry, which is what Android does.

**Never reintroduce a synthetic/placeholder source.** That rule is unchanged and still
load-bearing. When nothing real is found, return an empty list *and a reason*.

Still outstanding from doc 36: step 5 (jlink a JRE) and step 6 (OS-level sandbox). Step 7,
the WebView bridge, landed 2026-08-24 — see "The browser, finally" below.

### Community extensions: five defects found by running them (2026-08-13)

`InternetArchiveProvider` worked because it is one of the few extensions that extends
`BasePlugin`. Every *community* extension extends `Plugin`, and none of them ran. Found by
installing `Bnyro/GermanProviders` and driving the whole pipeline; each of these blocked
everything downstream of it, so they only surface one at a time.

1. **`com.lagradost.cloudstream3.plugins.Plugin` is not published anywhere.** It lives in
   the Android `:app` module; `library-jvm` has only `BasePlugin`. Every community `.cs3`
   failed with `NoClassDefFoundError` before running a line. Now supplied by
   `sidecar/bridge/` — it has to be that module, because the jar must be loaded by the
   loader that owns `library-jvm.jar` or the `BasePlugin` it extends is a different Class
   object than the plugin's own superclass resolves to. Note this is the *opposite* of
   finding 1 above: some `:app` types did move into `library-jvm`, and `Plugin` did not.
2. **dex2jar corrupts Kotlin's mangled method names.** Kotlin names inline-value-class
   members with a hyphen (`kotlin.Result.constructor-impl`); dex2jar rewrites it to an
   underscore, which resolves against nothing. `Result` is what `runCatching` compiles to,
   so search and metadata worked and *link resolution* failed with a Kotlin-internal error.
   `KotlinNameRepair` rewrites a reference only when the underscore form is absent from the
   owner and the hyphen form exists with an identical descriptor. If a future symptom looks
   like "provider works until you press play", check this first.

   **The repair was itself broken until 2026-08-13, and it failed in a way designed to
   fool you.** `rewriteClass` decided whether a class had changed by comparing a *global*
   rewrite counter before and after, while `repairedName` memoises its decisions — so the
   second class to reference `kotlin.Result.constructor_impl` took the cache path, bumped
   no counter, and had its correctly-rewritten bytes discarded. Exactly one class per
   distinct broken reference was ever repaired.

   The reason this hid so well: the repair instance is shared across every plugin in a
   session, so **the failure depends on how many extensions are installed**. A minimal
   test with three plugins passed and streamed video; the same provider in an eight-plugin
   run failed with `NoSuchMethodError`, because an earlier plugin had already claimed the
   decision. "Works in a small test, fails in the real app" was the whole signature.
   Changed-ness is now tracked per class by the visitor. Never re-derive it from a counter
   that a cache can skip.
3. **The android.* shim was built and never delivered.** It sat in `sidecar/target/`; the
   plugin classpath is `sidecar/runtime/`. `android.content.Context` was unresolvable.
4. **The dev runtime classpath pointed at a directory that has never existed.**
   `sidecar/pom.xml` builds into `target/`, `runtime-deps` into `runtime/` — siblings. Every
   plugin reported `T4_BLOCKED: library-jvm.jar is not present` regardless of the build.
5. **`resolveJava` accepted any JVM that existed.** A `JAVA_HOME` on Java 17 produced
   `UnsupportedClassVersionError`, reported only as "the extension runtime crashed".

### Community extensions: the second round (2026-08-13)

Found by pointing `tools/e2e/provider-e2e.mjs` at `Kraptor123/cs-kraptor`, whose **65
plugins all failed at `load`** with `InvocationTargetException: null`. Each fix revealed the
next, so they only surface one at a time — and the first one is why nobody could see any of
them.

1. **`InvocationTargetException` was reported verbatim, and its message is always null.**
   Reflection wrappers carry no message of their own, so every plugin failure that came
   through `Method.invoke` rendered as `InvocationTargetException: null` — naming the
   reflection layer and saying nothing. `Main.describe` now walks to the first cause that
   actually says something, and failures print their stack to stderr. `errorKind` had been
   walking the chain correctly the whole time, so the *classification* was right while the
   message was useless.
2. **`SharedPreferences` was a class; Android's is an interface.** The single highest-impact
   fix here: **112 of 392** surveyed plugins reference it. Extensions emit `invokeinterface`,
   which against a class throws `IncompatibleClassChangeError: Found class …, but interface
   was expected` — at first *use*, not at load, so a provider would register, answer a
   search, and die on its first settings read. Now an interface (with `Editor` and the
   listener nested as interfaces), implemented by `JsonSharedPreferences`.
3. **`PluginData`, `PluginManager`, `RepositoryManager`, `RepositoryData` are `:app` types.**
   Same category as `Plugin` (finding 1 above) and supplied the same way, from
   `sidecar/bridge/`. Extensions use them to enumerate and *delete* the host's installed
   plugins and repositories. **Every inventory returns empty and every mutation is a no-op,
   deliberately** — that state belongs to the main process, which owns install paths, the
   hash-keyed translation cache and the datastore records. Empty inventories mean the
   cleanup loops iterate nothing and the destructive calls are never reached.
4. **`android.content.pm.PackageManager` did not exist, and `Context.getPackageManager`
   returned `Object`.** Both fatal, in that order: verification resolves every type a method
   body names, so merely mentioning the type killed the load; and once it existed, an
   `Object` return is a different descriptor from Android's
   `()Landroid/content/pm/PackageManager;` and would have failed at the call site instead.
   The manager is returned and every operation on it throws, which preserves DROP-12 while
   letting the class link. `getPackagesForUid` returns `null` — Android's own answer for an
   unknown uid, and truthful. Do **not** forge `com.lagradost.cloudstream3` here; lying to
   plugin code about its platform makes every downstream bug undiagnosable.
5. **`android.os.Process` did not exist.** Identity reads answer honestly; `killProcess` is
   refused, because a plugin calling it would take down the sidecar and every other
   extension sharing it.

After these, AnimeciX loads and registers its provider plus a dozen `ExtractorApi`s at
`T3_DEGRADED` (it still touches `android.content.pm.Signature`/`SigningInfo` on non-critical
paths, which is exactly what that tier is for).

After all five: Filmpalast, EinschaltenIn and Serienstream load, register 3 `MainAPI`
providers and 10 `ExtractorApi`s, and answer searches — 8 results for "Matrix", 33 for
"Breaking Bad", 21 for "Dune", with posters, plot and year on detail load.

### Community extensions: the third round (2026-08-14)

Found by counting, not guessing. A user's captured sidecar log held **113 load failures**
across a full session, and grouping them by class showed the entire tail came from **six**
missing types — no long tail at all:

| Missing type | Failures | Category |
|---|---|---|
| `com.lagradost.cloudstream3.utils.DataStore` | 48 | `:app` type |
| `androidx.appcompat.app.AppCompatActivity` | 23 | androidx UI |
| `com.lagradost.cloudstream3.network.CloudflareKiller` | 16 | `:app` type |
| `android.net.Uri` | 16 | shim gap |
| `androidx.fragment.app.DialogFragment` / `FragmentManager` | 10 | androidx UI |

**Count the log before fixing anything.** Six classes covered 100% of it; a
plugin-by-plugin approach would have chased dozens of symptoms with one cause each.

1. **`PluginHost.call` caught `ReflectiveOperationException` but not `LinkageError`.** This
   is the one to remember, because the class it named was never the class at fault.
   `Class.getMethod` resolves the parameter and return types of *every* public method on the
   class, so a provider that merely declares `override val interceptor = CloudflareKiller()`
   threw `NoClassDefFoundError` when asked for its own **name**. It had already registered
   successfully. `describeProvider` let the error escape and the whole plugin load aborted,
   blaming a class the provider never called. `diffProviders` now also isolates per-provider
   describe failures — one unlistable provider must not discard the dozen `ExtractorApi`s
   registered beside it.
2. **`DataStore` and `CloudflareKiller` are `:app` types**, supplied from `sidecar/bridge/`
   like `Plugin` before them. `DataStore` had to be a faithful `object`-with-`Context`-
   extensions reimplementation: most of its API is `inline fun … reified`, so a shipped
   `.cs3` carries a *copy of the body* and calls `getSharedPrefs(context)` and
   `AppUtils.parseJson` directly — a top-level function or a differently-shaped class would
   compile here and link against nothing there. `CloudflareKiller` forwards rather than
   bypasses; the challenge needs a WebView (doc 36 step 7) and cannot be solved by an HTTP
   client. Both need `-opt-in=com.lagradost.cloudstream3.InternalAPI` on the Kotlin compiler.
3. **`android.net.Uri` is implemented, not stubbed**, and does **not** delegate to
   `java.net.URI`. Android's parser never validates; `java.net.URI` throws on spaces, `|`
   and stray percent signs, all of which scraped URLs carry routinely. Component splitting
   uses the RFC 3986 Appendix B expression, which is total, so parsing cannot fail. Note the
   asymmetry Android has and this reproduces: `getQueryParameter` decodes `+` as a space and
   `Uri.decode` does not.
4. **The androidx UI closure exists so *providers* can link.** An extension's settings
   screen and its scraper ship in one archive, so `View`, `ViewGroup`, `LayoutInflater`,
   `Bundle`, `Dialog`, `DialogInterface`, `Window`, `Activity`, `Fragment`, `DialogFragment`,
   `FragmentManager` and `FragmentActivity` all have to resolve or the scraping half is lost
   too. They throw `UnsupportedAndroidApiException` on use, which demotes the tier rather
   than reporting a crash.
5. **The Context handed to a plugin is now an `AppCompatActivity`** — see
   `android/content/PluginHostContext.java`. Supplying the *type* fixed the
   `NoClassDefFoundError` and immediately exposed what was underneath: the dominant corpus
   shape is not a lambda but the first statement of `load()`,
   `activity = context as AppCompatActivity`, followed by `registerMainAPI(…)`. 25 files do
   exactly that, and every one still lost all its providers — to `ClassCastException`
   instead. Measured on Aniworld, which now loads and searches. The reference is almost
   always just stored, so satisfying the cast converts a total loss into an extension that
   scrapes and has no settings screen. Every inherited Activity method still throws; only
   the type identity is conceded. One file in the corpus tests `is AppCompatActivity` and
   will now take the UI branch — 25 against 1, and the failure it hits is the one that
   branch was avoiding.
6. **`Context.getResources` returned `Object`.** The same descriptor bug already fixed for
   `getPackageManager`, still present and unreached until extensions got far enough into
   `load()` to ask. `()Ljava/lang/Object;` is a different method from
   `()Landroid/content/res/Resources;`, so the call site failed with `NoSuchMethodError`
   before the `Resources` stub's own message could ever be seen.

Also worth knowing: **`androidx/**` must be excluded from `cs3-sidecar.jar`** alongside
`android/**`. The shared runtime loader's parent is the sidecar's own loader, so delegation
is parent-first into it — a stray `AppCompatActivity` there wins over the copy in `runtime/`
and then fails to link, because its supertype chain ends at the `android.content.Context`
that *is* excluded.

Measured after all six, `--repo phisher --plugins 25`: **28 providers loaded** (was 26; both
`ShowBox` and `Jellyfin` previously died at load), 12 answering, 7 links resolved, 5 streams
delivering bytes, and **zero** occurrences of any of the six classes in the report.

Across all five repositories (`--plugins 4 --queries "matrix,one piece"`): PASS, 12 providers
loaded, 7 answering, 3 streams with bytes, **zero** of the six classes, and **no `T4_BLOCKED`
at all** — 10 `T1_DROPIN`, 3 `T3_DEGRADED`. `Aniworld`, `AniDB` and `MegaProvider` now load
and search where they previously died at load; their remaining failures are the honest
per-host kind (`Aniworld` gets a Google 403, `AniDB` times out).

Still outstanding and now visible underneath: `com.lagradost.cloudstream3.syncproviders.
providers.AniListApi$CoverImage` and `com.google.android.material.bottomsheet.
BottomSheetDialogFragment`, both reached by Anichi during `loadLinks`. Same category as the
above — an `:app` type and a Material Components type — and the same fix shape if they turn
out to matter to more than one archive. **Count first.**

### Community extensions: the fourth round (2026-08-15)

A user reported eight Phisher extensions with "No providers", each naming a class.
**Five of the eight were not extension bugs at all** — they were the stale-runtime trap in
§3: `DataStore`, `android/net/Uri`, `AppCompatActivity`, `DialogFragment` and
`FragmentManager` had all shipped weeks earlier and the installed app was still serving the
copy it was first provisioned with. Check that directory before writing a shim.

The remaining three were real, and each revealed the next exactly as before:

1. **`Context.getSystemService` threw for every name; Android returns `null`.** The corpus
   call site is the *first statement* of a provider's `load()`, unguarded, asking how much
   memory the device has to size a buffer. Throwing there aborted the load and cost the
   extension every provider it was about to register — StreamPlay lost all of them, and the
   reported cause named `getSystemService` rather than anything actionable. `null` is both
   the documented contract and the safer failure: a caller that checks gets Android's
   behaviour, one that does not fails on the line that *uses* the service. `"activity"`
   answers with a real `ActivityManager` whose `MemoryInfo` reports this JVM's actual
   figures — DROP-9 forbids lying about the platform, and a fabricated memory number would
   make the extension size its buffer wrongly.
2. **`android.os.Handler` was absent, and the shim for it *works* rather than throwing.**
   Almost every use in the corpus is a retry backoff, a debounce or a timeout guard — plain
   scheduling the JVM does fine. Refusing would break working scraper code to make a point
   about a platform difference that does not exist here. One single-threaded daemon executor
   per handler, because Android guarantees ordering on one Handler and code written against
   a Looper is entitled to assume it. `Looper.getMainLooper()` must return non-null:
   `Handler(Looper.getMainLooper())` is how essentially everything that defers work is built.
3. **The whole `syncproviders` cluster is `:app`.** `library-jvm` 4.8.0 ships only
   `SyncIdName` out of that package. TorraStream died at `load` on `SyncRepo`; StreamPlay and
   Anichi reach the same cluster. Supplied from `sidecar/bridge/`: `AuthAPI`, `AuthRepo`,
   `SyncAPI` (+ its nested `SyncResult`, `LibraryList`, `LibraryMetadata`, `SyncStatus`),
   `SyncRepo`, `AccountManager`, `AniListApi` with its ten nested data classes, plus
   `UiText`, `ListSorting` and `SyncWatchType`.

   **Data classes are faithful; behaviour is refused.** The data classes are Jackson binding
   targets reached through `parseJson`, and `jackson-module-kotlin` binds by constructor
   parameter *name* — a renamed property does not fail, it binds to null, and the resulting
   "AniList returned no artwork" is close to untraceable. The operations answer null, because
   there is no signed-in account here and a caller's "not logged in" branch is the right one.

   One descriptor mistake was caught in the act and is worth remembering: declaring
   `AccountManager.aniListApi` as `SyncRepo` (the wrapper) compiled fine and failed at
   TorraStream's call site with
   `NoSuchMethodError: AniListApi AccountManager$Companion.getAniListApi()`. **A getter
   returning a supertype is a different method to the JVM.** The evidence said `AniListApi`;
   the evidence won.

Measured after all three, `--repo phisher --only <the eight>`: **seven of eight now load**
(StreamPlay 2 providers, TorraStream 2, ShowBox 15 search results, StremioX 20 results and
55 links, plus DoraBash, MovieBoxProvider and XDMovies). Across the repository at large,
`--plugins 40`: **45 providers loaded, 20 answering, 12 links resolved, 8 streams delivering
bytes, and zero `NoClassDefFoundError` of any kind.**

**Still outstanding: Ultima.** It needs `com.lagradost.cloudstream3.CloudStreamApp`, behind
which sit `MainActivity`, `CommonActivity`, `HomeViewModel`, `PluginWrapper`,
`AppContextUtils` and `DataStoreHelper$ResumeWatchingResult`. That is a different category
from everything above — Ultima is a host-UI replacement rather than a scraper, and shimming
it means shimming the Android app itself. Left alone deliberately; one extension is not worth
a fake `MainActivity`.

### The bridge was discarding half of what Android hands back (2026-08-21)

The four rounds of shim work above closed the *class* problem: providers load, scrape and
resolve. What was still open is narrower and was invisible for exactly that reason — the
providers were working and the bridge was throwing away part of their answer. Everything
below was found by reading `ProviderBridge.encodeLink` against `library-jvm` 4.8.0 rather
than by chasing a symptom, because none of it produces an error.

| Discarded | Consequence |
|---|---|
| `DrmExtractorLink` — `kid`, `key`, `kty`, `uuid`, `licenseUrl`, `keyRequestParameters` | An encrypted stream arrived indistinguishable from an ordinary one |
| `ExtractorLinkPlayList.playlist` | A multi-part title has **no top-level URL**; only the parts have one, so it was filtered out as malformed |
| `LiveStreamLoadResponse` | Fell into the `else` branch. Every `TvType.Live` provider searched, opened a detail page and offered nothing to play |
| `AudioFile.headers` | Separate audio tracks crossed as a bare URL, which most hosts that use them 403 |
| `ExtractorLinkType` / `isDash` | Both present on the link and both ignored; the host re-derived the transport from the URL string |

**The transport was being guessed while the answer sat unread.** The old mapper matched
`.m3u8`, `/hls/` and `?format=m3u8` against the address, which is wrong in both directions:
providers serve playlists from `.php` URLs with no extension, and a progressive MP4 behind a
path containing `dash` is not a manifest. On Android that field picks the `MediaSource`
factory, and where a provider leaves it unset upstream's `INFER_TYPE` fills it in *before the
link is emitted* — so by the time it reaches here it is the best classification that exists.
The heuristics are kept as a fallback for archives built against a library that predates the
field; what changed is that the provider is asked first.

`electron/cs3/providerLinks.ts` owns the reading, and it is separate and tested because every
wrong answer here looks like a bad provider rather than a bad decision.

**Torrent links from providers never reached the torrent engine.** `ExtractorLinkType.TORRENT`
and `MAGNET` are ordinary results upstream — Android hands them to its torrent player the way
it hands an M3U8 to ExoPlayer. Here every one of them was written into `directUrl` and passed
to `MediaProxy`, which speaks HTTP: a `magnet:` URI went in and nothing came out. The swarm,
the sequential piece ordering and the loopback server had been in place the whole time and
were simply never reached from this direction. Two things to keep straight now that they are:
a magnet's **real infohash** is the dedupe identity (a provider and an indexer offering the
same release must collapse to one row), and `fileIndex` must be left **unset** — it means
"which file inside the archive" to the torrent engine, and the list position it used to carry
would select an arbitrary episode of a season pack.

**Multi-part titles are numbered rows, not one truncated row.** Android concatenates an
`ExtractorLinkPlayList` into a single timeline and nothing here does yet. One row that plays
part 1 and stops is the worse failure — a film that ends after forty minutes with no
explanation reads as a broken source — so each part is its own row, labelled `part 2 of 3`.
Visibly partial beats silently truncated. The whole part list still travels on every source,
so a concatenating player would not have to re-resolve the link.

### DRM: classified before, decrypted now (2026-08-21)

`EME_NATIVE` and `DrmConfiguration` have existed since PRD-37 and **nothing ever filled them
in from a provider**. DRM was detected only by reading a manifest body, which happens after
the probe — so an encrypted stream was handed to ffprobe first, and that is where the real
damage was:

> Measured on a synthesised CENC file: ffprobe reads it and reports **correct codec names**,
> then decoding produces pages of `non-existing PPS`, `no frame!`, `reference count
> overflow`. The probe does not fail. It succeeds with a lie, and every decision made from
> it is wrong — which is why encrypted provider streams reached users as "this file is
> corrupt" rather than "this is encrypted".

So a provider's declaration now short-circuits inspection entirely (`PlaybackStreamRequest.drm`),
and the verdict distinguishes three cases that used to read identically:

1. **ClearKey with a key, browser-decodable payload** → `EME_NATIVE`, and it now *plays*.
   `src/utils/clearKeySession.ts` attaches `org.w3.clearkey` MediaKeys and answers the licence
   request locally — a ClearKey licence is a JWK Set, and the key already came with the link,
   so there is no server in the loop. Covers progressive CENC and, through hls.js, fMP4 CENC
   in HLS.
2. **ClearKey with a key, payload the browser cannot decode** → the ordinary ladder, with
   `-decryption_keys` on the plan. Decrypting is not enough when the bitstream still has no
   decoder; FFmpeg does both in one pass. **Progressive only** — measured, the DASH demuxer
   answers `Option decryption_key not found`, which is *fatal to the whole command line*
   rather than ignored. Same trap `-extension_picky` set, from the other direction.
3. **Widevine, PlayReady, ClearKey without a key, or an unrecognised system** → `EME_NATIVE`
   and named as such. Widevine needs a CDM this build does not ship (Android gets one from
   the device); the message now says so rather than implying a broken source.

Two encoding hazards live in `src/utils/clearKey.ts`, both of which fail *silently* into a
stream that decrypts to noise:

- **Hex and base64url are told apart by length, never by alphabet.**
  `0123456789abcdef0123456789abcdef` is valid base64url *and* valid hex; read as base64 it
  yields 24 bytes of the wrong key. 16 bytes is 32 hex characters or 22 base64url ones, and
  that is unambiguous.
- **EME wants base64url and FFmpeg wants hex.** Both conversions live in one file so they can
  be tested against each other.

`DrmType` gained `unknown` deliberately: an unrecognised system is exactly as unreadable to
FFmpeg as a recognised one, and folding it into `none` sends it back to the probe to be
misdiagnosed.

**Still not built: DASH under any DRM.** Chromium cannot demux an `.mpd` without a JavaScript
player driving MSE, FFmpeg refuses the keys, and this build ships no dash.js. That is the
remaining gap and it is now *reported by name* instead of failing as a corrupt file.

### 4K, 8K and HDR (2026-08-21)

**The software-encode guard was height-only and stopped being right above 4K.** It asked "is
this taller than 1080?" and "are there fewer than 16 cores?", and 16 cores was measured at
*3840x2160*. 8K is four times those pixels, so the machine that holds 1.0x at 4K holds about
0.25x at 7680x4320 — and the guard waved it through at full resolution, producing exactly the
stall it exists to prevent on the most expensive files in the corpus. The threshold is now
pixels per second rather than a height, with `Math.max(1, …)` clamping it so **every verdict
measured at or below 4K is unchanged**; it only ever tightens. Width is used where reported,
because a 5120x2160 frame is not a 3840x2160 one.

Above 4K, a container remux also routes to mpv under `auto`. The remux stays cheap and leaves
Chromium decoding an 8K frame in software with four times a 4K surface behind it — this is
the tier where "the browser can demux it" and "the machine can play it" come apart.

**HDR that is re-encoded has to be tone-mapped, and was not.** `-pix_fmt yuv420p` converts the
storage format and says nothing about the transfer function, so a PQ or HLG source re-encoded
to 8-bit keeps HDR-referred values and is displayed as if they were SDR: washed out, flat,
desaturated. Nothing errors. The file plays perfectly and looks wrong, which is why it
survived. Measured on a synthesised PQ fixture, average saturation of the first frame:

| | SATAVG | YAVG |
|---|---|---|
| SDR source (reference) | 112.6 | 124.7 |
| Re-encoded, no tone-map (what shipped) | 22.8 | 97.4 |
| Re-encoded with the zscale chain | **63.0** | 84.3 |
| `tonemap` without `zscale` — the "graceful fallback" | 6.3 | 37.7 |

**That last row is why there is no degraded fallback.** Fed non-linear PQ code values, the
`tonemap` filter alone is not a worse tone-map, it is a wrong one — measurably worse than
doing nothing. `toneMapFilters()` returns the chain when `zscale` is present and **nothing at
all** when it is not. `zscale` comes from zimg, an optional dependency, so it is detected at
startup exactly like `-extension_picky`; a filter the binary lacks fails the whole command
line.

Only a re-encode is tone-mapped. A copied stream carries its own metadata and is displayed
correctly by whatever decodes it, and `-c:v copy` could not tone-map anyway.

One trap while you are in `buildArgs`: ffmpeg takes **one** `-vf`. A second silently replaces
the first, so the tone-map and the downscale share a chain rather than each pushing their own.

### The box now contains the player (2026-08-21)

`extraResources` carried exactly one entry — the sidecar — so a freshly
installed app had **no ffprobe, no ffmpeg and no mpv**. All three were fetched on
first use, and `setupMpv` did not even try outside Windows: it printed
`brew install mpv` and returned false.

The consequence was not a missing convenience. `MpvEngine.isAvailable()` was
false, so `shouldRouteToNativeEngine` returned false for **every** stream and the
native engine was never used at all — every 4K HEVC file took the software
transcode path, which is the 0.47x-realtime stall the engine exists to avoid.
**The default install was the worst configuration this codebase can be in, and
the good one was opt-in behind a download the user had to discover.**

`tools/package/build-media-runtime.mjs` stages the binaries per platform into
`cs3_windows/media-runtime/`, `extraResources` copies that to `resources/media/`,
and `electron:build` runs it. It **fails the build** when a required component is
missing rather than producing a package quietly without its player;
`--allow-missing` is the deliberate override.

Two things about resolution order:

- **The bundled copy wins**, where it used to lose. `resolveBinary` started at
  `userData/bin`, which is the same shape as the stale-runtime trap in §3: a copy
  fetched by an older version silently shadows the one this version was built
  and tested against.
- **`yt-dlp` is the exception**, and deliberately so. Its extractors break when a
  site changes, which happens weekly, so a downloaded copy there is *newer*
  rather than staler. It keeps the old order.

On Linux and macOS mpv is `required: false` on purpose rather than by omission —
the distribution's own package is the one wired to that platform's VA-API or
VideoToolbox, and shipping a generic binary over it produces a player that
cannot open the GPU. A distribution package should depend on `mpv`.

**Chromium is now asked for the decoders the platform has.** `main.ts` set
exactly one switch (`autoplay-policy`) and had never asked for
`PlatformHEVCDecoderSupport`, available since Chrome 104 — so HEVC was
re-encoded even on machines whose GPU decodes it for free. Enabling it cannot
make a decision worse: `App.tsx` measures `canPlayType` at startup and overrides
the static table **in both directions**, so a machine without the decoder still
answers `""` and still gets the transcode.

### DASH is played, not remuxed (2026-08-21)

Shaka Player (`shaka-player`, Apache-2.0, an ordinary bundled dependency) now
takes any DASH manifest whose payload the browser can decode — strategy
`DASH_NATIVE`. The remux stays as the fallback for a payload Chromium cannot
decode, because Shaka appends to the same MSE and cannot invent decoders either.

What this buys, beyond not spending an ffmpeg process: the remux **flattens the
adaptive ladder to one fixed rendition**, which is the thing DASH exists for.
And it closes the gap the ClearKey work left open — `DASH_NATIVE` is the only
strategy that can play encrypted DASH, because FFmpeg's DASH demuxer rejects
`-decryption_key` outright.

**The proxy had to learn DASH first, and that fixed an existing bug.** A manifest
names its segments relative to its own address, so serving one unmodified from
loopback makes the player resolve them against `…/stream/<token>` and ask for
paths the proxy has no route for. This was never only a Shaka problem: **ffmpeg's
DASH demuxer resolves relative segments exactly the same way**, so the remux path
was already broken for every manifest that did not spell its segments out in
full. `MediaProxy` now rewrites MPDs, and needed a shape it did not have:

- **Directory routes** (`/base/<token>/<rest>`), because `SegmentTemplate` names
  segments with `$Number$` placeholders the *player* expands. HLS never needed
  this — a playlist lists every segment, so each got an exact route. A DASH
  manifest has no list to rewrite, only a base to redirect.
- A `<BaseURL>` is **inserted** when the manifest has none, replaced when it has
  one, and absolute `media`/`initialization`/`sourceURL` attributes are rewritten
  by directory so their placeholders survive.
- The suffix arrives from the renderer, so `resolvePrefixed` refuses anything
  that leaves the base's origin. Without that check a directory route becomes the
  arbitrary-URL fetcher `wrap` deliberately is.
- Manifest sniffing is **bounded by declared length** (4 MB). Reading a body to
  identify it means buffering it, and a provider serving a 5 GB MKV as
  `application/octet-stream` is routine.

Pinned by `mediaProxy.test.mts` (11 cases). Note the origin there is a *stub*
rather than a real server: `wrap` returns loopback URLs untouched by design, so a
socket-backed origin on 127.0.0.1 tests nothing.

### Subtitles: ASS and the charset, which Android has always had (2026-08-21)

`docs/docs_cs3/05` records what the Android app does — SubRip, WebVTT **and**
SubStation Alpha, every file through `juniversalchardet` first. Desktop did
neither, and both failures are silent:

- **`.ass` / `.ssa` went through the SubRip converter**, which emits
  `[Script Info]` and `Dialogue:` lines as if they were cues. That is most of
  anime and of fansubbed releases.
- **Every download was decoded as UTF-8**, because `Response.text()` does that
  unconditionally. A Windows-1252 or GBK subtitle then loads with correct timings
  and a black diamond where each accent was — which reads as a bad upload.

`electron/subtitles/convert.ts` owns both. Two rules in it are worth keeping:

- **UTF-8 is checked, not detected.** `TextDecoder` in fatal mode either accepts
  the bytes or throws, so the common case is answered exactly and the statistical
  detector only sees files that are provably not UTF-8.
- **A detection of UTF-8 is then rejected, and a decode producing U+FFFD is
  treated as a failed decode.** `chardet` answers "UTF-8" for a four-byte
  Windows-1252 string, and `TextDecoder` outside fatal mode substitutes rather
  than throwing — so the substitution character *is* the error and is checked
  for.

ASS conversion reads the `Format:` line rather than assuming field positions
(ASS declares its order per file), bounds the `Dialogue:` split so text
containing a comma is not truncated, and drops `\p1` drawing commands — those are
vector shapes, and printing their coordinate lists puts a wall of numbers over
the picture.

### Android vs Windows: where the two actually diverge now (2026-08-19)

The recurring report is "this provider works in the Android app and fails here". Measured
rather than assumed, with `provider-e2e.mjs --plugins 30` across all five bundled
repositories:

```
providers loaded    66
providers answering 24
links resolved      18
streams with bytes  16
PASS — extensions load, scrape and stream
```

**`NoClassDefFoundError` occurrences across the whole run: 3, all of one class —
`com.lagradost.cloudstream3.CloudStreamApp`.** That is Ultima, and it is the one deliberate
exclusion on record: a host-UI replacement rather than a scraper, whose dependency chain runs
through `MainActivity`, `CommonActivity` and `HomeViewModel`. Shimming it means shimming the
Android app itself.

So the answer to "what is the translation layer still missing?" is: for the corpus we can
see, **nothing**. The four rounds of shim work documented above closed it. A provider that
works on Android and fails here is now failing for a reason that is *not* a missing class,
and looking for one is looking in the wrong place.

The divergences that remain are runtime and platform, not translation:

1. **TLS strictness.** `SSLHandshakeException: Received fatal alert: unrecognized_name`
   appears in sidecar stderr against some provider hosts. This is a real Android/JVM
   difference and not a provider bug: a server that does not recognise the SNI name sends a
   *warning*-level `unrecognized_name` alert, Android's Conscrypt ignores it, and the stock
   JVM treats it as fatal. The documented JVM workaround, `-Djsse.enableSNIExtension=false`,
   is **not** applied here and should not be applied casually — it disables SNI for every
   connection, and virtually every CDN in the corpus needs SNI to serve the right
   certificate. Trading a handful of hosts for most of them is the wrong direction. A
   correct fix is per-connection and belongs in the bridge's HTTP client; it is not built.
   **The frequency is not yet measured** — the harness prints only the last 15 lines of
   sidecar stderr, so the occurrences seen are a signal, not a rate. Count it properly before
   spending effort on it.

2. **No WebView — closed 2026-08-24.** This was the dominant gap and the recommended next
   unit of work in three separate documents. Providers now get a real browser: the sidecar
   can call back into the main process, the bridge supplies a `WebViewResolver` that
   *shadows* `library-jvm`'s `TODO("Not yet implemented")` stub, and `CloudflareKiller`
   solves challenges rather than forwarding them. See "The browser, finally" below for the
   design and for what still differs from Android.

3. **Host-side reality, which is not a divergence at all.** Expired signed URLs, hotlink
   403s, dead swarms and slow sites fail identically on both platforms. The vendor matrix
   (§5.2) counted these: of 72 non-playing streams, every one was a host refusing or
   expiring a link, or a provider with nothing for that title. Attributing those to the
   compatibility layer is the mistake that sends people looking for translation bugs that
   are not there.

**Count before fixing.** That rule produced the six-classes finding in the third round and it
applies here in the other direction: the counting says the class problem is solved, which is
why the next unit of effort went into the WebView bridge rather than into more shims. With
that closed, the remaining named divergence is TLS strictness (1 above) — **and its frequency
is still unmeasured**. Count it before spending anything on it.

### A provider that is gone has to say which extension owned it (2026-08-24)

Reported as a raw runtime exception on screen:

```
IllegalArgumentException: No loaded provider is named "EinschaltenIn".
Loaded: [Aniworld, Serienstream, Cinevood, … 100 more]
```

Two separate faults, and the visible one is the smaller.

**The runtime appended its whole loaded set to the message**, and the host passed it
through to the viewer. On a bootstrapped install that is a hundred provider names offered
as the explanation for the one that did not work — a list of everything that *did* work,
which is diagnostics and not an answer. `requireProvider` now throws
`PluginHost.ProviderNotLoadedException` with a one-line message and prints the loaded set
to stderr, where a diagnosis can find it.

**And the host was not answering the question it is uniquely able to answer.** The runtime
knows only that a name is absent. The host knows *why*, and each reason is a different
action for the reader:

| Cause | What the viewer is told |
|---|---|
| Provider, extension or repository switched off | which switch, and that Extensions is where it is |
| Adult provider with the gate off | that, and where the gate is |
| Two extensions claiming one name | which one lost it (`providerNameClashes`) |
| Extension uninstalled | which extension it was, and to search again |
| Extension installed but blocked at load | the `runtimeReports` reason verbatim |
| Providers not loaded yet | that, rather than a failure |

`PluginManager.explainMissingProvider` is that table, reached from `loadMedia` and
`loadLinksDetailed` when the reply carries `errorKind: 'PROVIDER_NOT_LOADED'` — recognised
by kind rather than by matching the sentence, which is why the sidecar has a named
exception at all.

Three supporting pieces, each of which was a gap on its own:

- **Provider origins are persisted** (`cs3_provider_origins`), because this is read exactly
  when the live tables cannot answer. A bookmark, a library entry, a cached source or an
  open detail page addresses `cs3ext://EinschaltenIn/…` long after the extension behind it
  was disabled or removed, and without a stored `provider name → extension` map the app can
  only say the name is unknown.
- **An installed archive that is missing from disk now gets a runtime report.**
  `ensureProvidersLoaded` filtered those out of `pending` and said nothing, so the extension
  ceased to exist with no report anywhere and every saved reference to its providers failed
  by naming a *provider* rather than the missing file that caused it.
- **`provider-missing` is its own `FailureKind`, and it is not scored.** Folding it into
  `runtime-unavailable` would send the reader to the runtime status in Settings, which is
  working and has nothing to tell them. And recording it as a provider failure would rank an
  extension down for having been switched off — the silently-punitive behaviour the ranking
  exists to avoid.

`RUNTIME_GENERATION` is bumped to 7: an already-provisioned sidecar never sends the new
error kind, so without it the host's branch is unreachable and the viewer keeps seeing the
hundred-name exception.

### The forced retry never asked the engine that could have played it (2026-08-26)

Reported as: none of a title's sources play or download, while the Android app plays the
same list. Measured against the captured source list (`.temp/RRR_sources.md`, 54 sources):
most of them are **healthy** — 206 with `Content-Range` and `video/x-matroska`, or a valid
`.mpd`/`.m3u8` with no DRM — and five of a representative seven play through this app's own
`MediaProxy` into mpv in about a second, including the CloudFront-signed DASH that needs a
`Cookie` and the googleusercontent link that ignores `Range`. So the sources were not the
variable, and neither was the proxy.

**`PlaybackEngine.prepare` hard-set `FULL_TRANSCODE` on the forced pass and never consulted
`shouldRouteToNativeEngine`.** `decideStrategy` routes to mpv properly; this path bypasses
the decision entirely. The consequence is precise and backwards: the forced pass runs
*exactly* when the element has already failed on a source — which is the definition of what
the native engine exists for — and it was the one path guaranteed to answer with a software
re-encode instead.

Traced through a session log on MovieBox's DASH:

```
ffprobe  /stream/17  container=dash videoCodec=hevc audioCodec=aac   1736ms   ok
prepare  /stream/17  engine=ffmpeg  strategy=REMUX_CONTAINER
prepare  /stream/17  engine=ffmpeg  strategy=FULL_TRANSCODE  probeLatencyMs=0
```

An `hev1` 1080p stream probes as `dash`/`hevc`, is remuxed, fails in the element, and comes
back here to be re-encoded frame by frame. The same URL handed to mpv opens with `d3d11va`
in about a second — mpv carries its own FFmpeg and the platform's hardware decoders, so a
bitstream that defeated Chromium is usually ordinary to it.

The forced pass now routes to `NATIVE_MPV` when the engine is available and the policy is
not `off`, and falls back to the re-encode when it is not. Two exclusions: `EME_NATIVE` and
anything `requiresEmeDecryption`, because mpv holds no CDM and routing an encrypted stream
to it converts a playable source into an unplayable one.

**The returned capability is rewritten with it, and that half is load-bearing.**
`VideoPlayer` reads `capability.requiredStrategy` to choose between the `<video>` element
and `mpv:open`. Returning the pre-force model would hand the URL back to the element that
had just failed on it — which fails, forces again, and spins the retry ladder on a source
the native engine was ready to play.

**What is genuinely dead in that list, and worth recognising rather than re-debugging:**
`workers.dev` mirrors answering `500` or `403 Quota exceeded`, `r2.cloudflarestorage`
answering `403 NotEntitled`, pixeldrain `404`, and `hcdn3.hakunaymatata.com` failing to
resolve at all (`ENOTFOUND`/`EAI_AGAIN`) — a DNS answer, not an app failure, and one the
DNS-over-HTTPS setting can change.

**One measurement trap.** Probing a manifest with `Range: bytes=1000000-` returns `416`,
because an `.mpd` is a few kilobytes. Nine sources looked dead that way and every one was
fine; a liveness scan has to ask for a range the file can actually satisfy, or none at all.

### The timeline drew and never moved (2026-08-26)

Reported as: the film downloads perfectly, and streaming the same link shows a timeline
that is frozen — in the in-app player and in mpv as an external player alike. Three
separate defects, found by measuring the sources rather than reading the player, and none
of them is the one the symptom points at.

The sources were captured from the app for two titles (`.temp/hulk_sources.csv`,
`.temp/supergirl-…md`) and every one was characterised against the real host. That is what
made the causes separable — they present identically.

**1. `--force-seekable=yes` on an origin that ignores `Range`.** The flag had been in
`mpvEngine` since the engine's first commit, as a blanket default. Measured across the
corpus, hosts fall into three shapes and only one describes itself correctly:

| Shape | Reply to a `Range` | Seekable |
|---|---|---|
| `sssrr.org`, r2.cloudflarestorage | 206 + `Content-Range` + `Accept-Ranges: bytes` | yes, and says so |
| gdflix `workers.dev` mirrors | 206 + `Content-Range`, **no** `Accept-Ranges` | yes, and does not say so |
| `video-downloads.googleusercontent.com` (GDFlix "Instant Download") | **200 + the whole file from byte zero**, whatever was asked | **no**, and does not say so |

On the third, mpv accepted the seek, could not ask for the offset, and satisfied it by
reading and discarding from byte zero. On a 3.24 GB link that never arrives: the tracks
parse, the window opens with a timeline on it, and the position never moves. **Every resume
from Continue Watching hit it, because a resume is a seek before the first frame** — which
is why it looked like the app could not play that source at all while the downloader,
which only ever reads forward, was fine.

Measured on a synthesised fixture behind a Range-ignoring origin, seeking to 60s:

| Origin | `--force-seekable` | Result |
|---|---|---|
| honours Range | yes | seeks to 60s |
| honours Range | **no** | seeks to 60s — the flag buys nothing |
| ignores Range | **yes** | grinds the whole file, no first frame |
| ignores Range | no | starts at 0 immediately and plays |

So the flag only ever converts a correct "cannot seek" into a hang, and it is gone.
`MediaProxy` now **states `Accept-Ranges` rather than forwarding it**, in both directions,
which is what restores seeking on the middle row without anything having to be forced. It
also **refuses to serve byte-zero data as a mid-file range**: a `200` answering a
`bytes=N-` used to be passed straight through, handing the player the opening of the film
labelled as its middle.

**2. `MAX_ROUTES` was below the cost of one film, and LRU evicted the wrong end.**
Rewriting one HLS media playlist mints a route per segment — ~1200 for a two-hour film, in
a single burst, against a cap of 1000. The routes evicted to make room were the *oldest*:
the master playlist and the video variant playlists it had just handed the player.
Measured on HDHub4U's `hdstream4u.com` master, tokens 4 and 5 — the two video variants —
were gone before the first request for either, and the table held segments 306–1305. mpv
read the master, asked for the variant it named, and got `404 Unknown stream` **from us**.

Two changes, and the second matters more than the cap: routes now carry `createdAt`
separately from `lastAccess`, a route that has never served a request is evicted only after
every route that has, and **among never-served routes the newest go first**. For an
unfetched route, age is not staleness — it is position in the document that minted it, so
the oldest are the variants and the opening segments and the newest are the end of the
film. Dropping the tail is free; the playlist re-mints it if playback ever gets there.

**3. Any body under 4 MB with no `Range` was corrupted.** Pre-existing, and independent of
the above. The manifest-sniffing branch did `await upstream.text()` and then `res.end(body)`
— so a binary body small enough to reach it was decoded as UTF-8 and re-encoded, turning
every byte that is not valid UTF-8 into three. A 704 KB HLS segment left the proxy 1.27 MB
long and no longer a media file. It survived because media requests almost always carry a
`Range`, which skips the branch entirely; only the occasional un-ranged first fetch of a
small segment was hit, and it read as a bad source. The body is read as bytes now and
decoded only to look at.


**4. An abandoned request left the whole file downloading.** Found from a later session
log, after the three above were fixed: `ffprobe timed out after 20000ms` three times on
each googleusercontent source, then `The source could not be reached: The operation was
aborted due to timeout` — while the same file probed in 2.4 s standalone. `pump`'s cleanup
called `reader.releaseLock()`, which detaches the reader and **leaves the body open**.
Under Node's fetch the transfer stops anyway; the main process runs on Electron's
`net.fetch`, where the request lives in Chromium's network service and a detached body does
not reliably stop it. On an origin that ignores `Range` and answers everything with the
whole file, each abandoned probe is therefore a 3.24 GB download still running — three
attempts across three sources is nine of them, against a link the viewer was already
downloading at 4.2 MB/s. That is how a two-second probe becomes a twenty-second timeout,
and why playback that had started buffered until the engine exited. The reader is cancelled
now, and every upstream fetch carries an `AbortSignal` tied to the client socket — the
signal is what reaches a request still blocked in DNS or TLS, before there is a body to
cancel at all. Guarded on `writableEnded`, because `close` also fires on a normal finish.

**Two traps worth not repeating.** `MediaProxy.wrap` returns loopback URLs *untouched* by
design, so a test origin listening on 127.0.0.1 is never proxied and measures nothing —
the test file's header says so, and it is still easy to do. And a regression test for this
class of bug has to be checked by breaking the fix again: the assertions pass trivially
against a stub that ends its own body, so the upstream in `mediaProxy.test.mts` is endless
and the test is verified to FAIL with `releaseLock()` restored.

**Segments disguised as images are unwrapped.** HDHub4U's playlists point at TikTok's image
CDN, which serves only images, so each segment is a **real 70-byte PNG header with the
MPEG-TS glued on behind it** — `Content-Type: image/png` and a valid PNG signature. This is
a step beyond the `.png`-*named* segments `-extension_picky` was added for: there the bytes
were already TS and only the name lied, so opening the extension allow-list was enough.
Here the bytes lie too and no demuxer option helps — FFmpeg reads a PNG, finds no
elementary stream, and stops with nothing in the log naming the cause. Measured on a real
segment: 704,318 bytes in, a 70-byte prefix, then 3,745 consecutive sync bytes at the exact
188-byte stride and a clean `h264 + aac` after the strip. Only routes minted by a playlist
rewrite are examined, and only that signature — PNG magic followed by a sync run at the
packet stride — counts, so a mis-detection would need a file that is simultaneously a valid
PNG and a valid transport stream.

**What is still not ours.** Of the 16 Supergirl sources, after these fixes the four
r2.cloudflarestorage links, HUBCDN and all three HLS variants play. The rest fail at the
host and are worth recognising rather than re-debugging: pixeldrain 404s, the Vidstack IP
404s, and the googleusercontent links expire (they are signed with an 8-hour window, and
answer `HTTP 400` after it). A `RefreshingSource` retry on those is correct behaviour.

### The first search cost a minute, and it was never the plugins (2026-08-26)

Reported as: the app is slow to start, and slow again the first time you search. Measured on
the development machine's real install — **124 archives, 132 providers** — rather than
reasoned about, and every obvious explanation turned out to be wrong.

`PluginManager.ensureProvidersLoaded` loaded every installed archive into the JVM, in series,
on the first search of **every launch**:

| Experiment | Result |
|---|---|
| Load all 124 archives (`load` RPC, serial) | **66.8s**, plus a 2.7s sidecar handshake |
| `inspect` all 124 — DEX translate **+** `LinkageAnalyzer` | **1.4s** (mean 11ms) |
| Load all, unload all, load all again **in the same JVM** | 57.1s, then **2.4s** |
| Load all with 8 concurrent RPCs | 43.5s — and **176 providers attributed to the wrong extension** |

Read those in order, because each one kills a fix that looks obvious before it:

1. **Translation is not the cost.** It is already cached by archive hash, and the whole
   translate-plus-analyse pass over the corpus is 1.4 seconds. Caching `LinkageAnalyzer`
   output — the first thing that suggests itself — would buy about a second of sixty.
2. **Neither is plugin logic, or the network.** Reloading all 124 *in the same process*
   costs 2.4s. The 57s is demand-driven **JVM class loading of the 56-jar runtime
   classpath** — jsoup, ktor, jackson, coroutines — spread across whichever plugin first
   touches each part. It is paid once per JVM process and it is mostly disk: a run
   immediately after another, with the OS page cache hot, measured 6.5s for the same work.
3. **And it cannot safely be parallelised.** Providers do not return themselves; they
   self-register into the single global `APIHolder.allProviders`, and `diffProviders`
   observes registration by remembering that list's *length* before `load()`. Two loads
   overlapping both read from the same mark and each claims the other's providers. Nothing
   prevented this — the host merely happened to issue loads in series, which made it latent
   rather than absent.

So the fix is not to make the load faster. It is to **stop doing it before anyone has asked
for anything.**

**`cs3/providerRegistry.ts` records what each archive registered**, keyed on
`size:mtime:generation`. Almost everything the app does with providers needs only their
descriptions — the scope picker, the extensions tree, the enable cascade, `cs3ext://`
addressing, provenance, the adult gate — and none of that needs a live JVM object.

**Measured end to end against the same 117 distinct archives: 6.6s → 8ms, 132 providers
preserved identically, zero cache misses, and the sidecar is not started at all.**

Four things about it are load-bearing:

- **The runtime generation is part of the key.** The shim and the bridge decide what a
  plugin *can* register — four rounds of shim work in this repo each changed exactly that —
  so a row recorded under generation 7 is not an answer about generation 8, even though the
  archive's bytes never moved. Same argument `RuntimeProvisioner` makes for dropping
  translations, and the same failure if skipped.
- **An archive that registers nothing is recorded too.** Extractor-only bundles register no
  `MainAPI`, and there are plenty; treating `[]` as "no record" would make every one of them
  pay the full JVM load on every launch forever.
- **A failed activation withdraws the row.** Otherwise a permanently broken extension is
  re-advertised every launch, fails, and is rediscovered — once per launch, with nothing
  recording that it is permanent.
- **`loadProviders(force)` now clears the cache.** Hydration answers from disk, so merely
  clearing `providersLoaded` would re-read the same descriptions and change nothing — the
  opposite of what a caller asking to reload wants.

**Loading is now lazy and per-archive.** `ensureProviderActive(name)` loads the plugin behind
one provider, deduped by an in-flight map — a search fans out to eight providers at once and
several routinely come from one archive, so without it that archive is loaded eight times
concurrently, which is the mis-attribution case arriving through the front door.
`PluginHost.registrationLock` is the backstop; the in-flight map is the fix.

**And the unavoidable cold cost moved off the path where someone is waiting.**
`warmProviders()` runs 4s after the window opens and loads the rest in the background,
serially. Same work, done while the viewer reads the home screen.

If you add a code path that calls a provider, call `ensureProviderActive` first. A hydrated
provider is addressable and has no code running behind it; the RPC will answer
`PROVIDER_NOT_LOADED`, which `explainMissingProvider` will then explain as though the
extension were disabled.

### Counting the log, from inside the app (2026-08-26)

The capture worked. What it produced was not usable, and the numbers say why. A real user's
21 session files held **6,069 records, 5,407 of them sidecar stderr — 89% of everything the
app recorded** — and `missingClass` matched **none** of them. The class problem really is
closed (§5 says so and the count agrees); what fills the log now is something else, and the
reader could not tell its parts apart:

| Shape, by frequency | What it is |
|---|---|
| `ApiError: ------------------` ×290 | upstream's `logError` divider — pure punctuation |
| `PluginInstance: Adding Voe (…) ExtractorApi` ×~200 | registration chatter, at `INFO` |
| `Aug 25, 2026 1:23:45 PM okhttp3…Platform log` ×151 | a JUL *header*, whose message is the next line |
| `[plugin D/Ayzen] audinifer.com` ×~150 | the `android.util.Log` shim, carrying its own level |
| `Exception in NiceHttp: … Connection reset` ×74 | a real failure, recorded at `info` |

Three defects, and the first is the one that mattered. **The level was wrong in the
direction that hides things**: unprefixed lines fell back to `info`, so `Read timed out`,
`Connection reset` and `UnknownHostException` — 240 occurrences — sat at the same level as
200 lines of `Adding … ExtractorApi`, and a problems-only view showed neither. **Nothing
carried who printed it**, though the tag is right there at the front of the line. **And a JUL
record is two lines**, read as two events: 151 headers with no message, 151 messages with no
origin.

`sidecarStderr.ts` now emits `source` (92.5% coverage on that corpus) and, for `warn` and
above only, `cause` from the shared taxonomy. Only problems get a cause — the taxonomy ends
in a catch-all matching anything containing "Error", so classifying an informational line
files registration chatter as a failure.

**`cs3/extensionIssues.ts` is the tally those fields make possible: 5,407 records → ~200
distinct problems**, persisted across restarts and log rotation. It is a third surface beside
the other two on purpose, because none of them can answer the others' question:

| | Shape | Answers |
|---|---|---|
| `Logger` | NDJSON, **one file per launch**, rotated away | what happened, and in what order |
| `DiagnosticsLog` | one failure's tuple, capped and time-windowed | enough to hand to a maintainer |
| `ExtensionIssueLog` | one row per `(cause, source, groupingForm(message))`, durable | **how many distinct things are wrong** |

A row needs all three key parts: `cause` alone is eight rows for six thousand records;
`message` alone is thousands, because a message carries a host and a duration; `source` is
what makes a row *assignable*. It stores **no URLs, queries or titles** — this file is
long-lived, and a long-lived file accumulating what someone searched for is a viewing history
under another name.

Building it found three real classification bugs, each invisible and each in the same
direction — a plausible category on a real failure:

- **Stack-frame line numbers were read as HTTP statuses.** `RealCall.java:519` contains a
  three-digit integer and `server-error` tests for one, so `IOException: Canceled` under an
  OkHttp stack was classified as the *host* returning a 5xx, 23 times. `classifyFailure` now
  strips source locations first — and only there, because `groupingForm` must keep bare
  integers so `HTTP 403` and `HTTP 404` stay apart.
- **The taxonomy only spoke Node's dialect.** It tests `ECONNRESET`; the JVM says
  `SocketException: Connection reset`. 108 network failures were filed as the extension
  throwing.
- **Cancellations were counted as failures.** 79 of them. Fifteen scrapes are in flight when
  the viewer types a new query, and the scope closing throws in every one. `cancelled` is now
  its own kind and the ledger drops it — counting it would rank the *slowest* providers down
  hardest, since those are the ones still running when the cancel lands.

Two more came from running the finished path over the whole corpus, and both are the same
shape — a stack read as though it were a message:

- **A frame naming the sidecar made every plugin crash the sidecar's fault.** Every plugin
  failure passes through `com.cloudstream.desktop.sidecar.PluginHost`, and the
  `runtime-unavailable` rule matches the word `sidecar`. `describe` now classifies from the
  head plus `Caused by:` lines only — `at` frames are the route, not the reason.
- **`InvocationTargetException` was the attributed source.** It names the reflection layer
  and says nothing, which is the same mistake `Main.describe` was fixed for on the JVM side.
  The plugin's own loader is right there in the frames — `at cs3-plugin-Ultima…//` — so that
  is read instead.

And one real taxonomy gap the finished ledger surfaced on its first run over the corpus:
**the rest of the linkage family is ours too.** `NoClassDefFoundError` was classified as the
runtime's problem; `NoSuchMethodError`, `IncompatibleClassChangeError`, `AbstractMethodError`
and `VerifyError` were not — yet those are precisely what a *shim* produces, and this repo's
own history is three worked examples: `SharedPreferences` as a class where Android's is an
interface (`IncompatibleClassChangeError`, 112 plugins), `getResources` returning `Object`
(`NoSuchMethodError`), and `AccountManager.aniListApi` declared as the wrapper type
(`NoSuchMethodError` — a getter returning a supertype is a different method to the JVM). All
of them were landing in `provider-error`, whose hint tells the reader to report it to the
scraper's maintainer — for a method we failed to provide.

Two new `FailureKind`s came out of it and **neither is scored**, for the reason
`provider-missing` is not: `cancelled`, above, and `resource-leak` — OkHttp's "was leaked.
Did you forget to close a response body?", which was **every unclassified problem record in
the corpus** (159). The scrape succeeded; a socket leaked. Filing it as `provider-error`
reports providers as having failed 159 times that did not fail at all.

**One pre-existing bug fell out of the same pass.** `playbackSession.ts` carried
`/\b(\d{3})\b/` with both `\b` escapes replaced by literal backspace characters and the
backslash eaten off `\d` — a pattern requiring control characters and the letter "d", which
can never match. It parses the HTTP status that `SourceCache.recordFailure` uses to decide
whether a dead link is **dropped on sight** or needs three strikes, so *every* failure was
reaching it as ambiguous: a definitive 404 was never dropped, and the dead link was served
first again in between. Worth grepping for `\x08` after any bulk edit; it is invisible in a
diff.

### Community extensions: the fifth round, and the OTT lane (2026-08-31)

Found by pointing the harness at two repositories nobody here had run before —
`Sushan64/NetMirror-Extension` and `NivinCNC/CNCVerse-Cloud-Stream-Extension`,
the two that carry the Netflix/Prime Video/Hotstar/Disney+ catalogues the
Android community actually uses.

**NetMirror is the whole reason the OTT feature can exist**, and what it
registers was read out of the published archive rather than assumed. The
downloaded `.cs3` hashes to its declared `fileHash`; inside are two members
(`manifest.json`, `classes.dex`) and four `MainAPI` subclasses —
`NetflixMirrorProvider`, `PrimeVideoMirrorProvider`, `HotStarMirrorProvider`,
`DisneyPlusProvider` — registering the display names **Netflix**, **Prime
Video**, **Hotstar** and **Disney Plus**, all four with a `getMainPage`. It
loads at `T1_DROPIN`.

**It is not `bundled`, and that is deliberate.** `bundled: true` is a claim the
harness has driven the repository end to end. The load half passes; the
streaming half cannot be verified from a cloud container, because the egress
proxy answers `CONNECT` for the providers' own hosts (`net52.cc` and the rest)
with 403. Anyone running this on an ordinary network can settle it with
`node tools/e2e/provider-e2e.mjs --repo NetMirror` and flip the flag.

**CNC Verse gave the fifth round of shim work.** Counted first, as the third
round taught: `--plugins 20` produced **18 load failures across 5 classes**, and
16 of them were in three.

| Missing type | Failures | Category |
|---|---|---|
| `android.widget.CheckBox` | 7 | shim gap (settings dialogs) |
| `android.content.Intent` | 6 | shim gap |
| `android.app.AlertDialog` | 3 | shim gap |
| `com.lagradost.cloudstream3.ui.settings.Globals` | 1 | `:app` type |
| `com.google.android.material.…BottomSheetDialogFragment` | 1 | Material, still outstanding |

Adding the top three surfaced two more underneath — `android.graphics.drawable.Drawable`
(8) and `Globals` (9) — which is the same one-at-a-time pattern as every previous
round. **After all five: 18 load failures to 1, and 0 to 29 providers registered.**
Every plugin in that repository now loads.

Four things about the new shims are load-bearing:

- **`Intent` and `AlertDialog.Builder` do not throw on construction or
  configuration.** Neither touches the platform on Android either — an `Intent`
  is an inert value object and a builder describes a dialog — so refusing there
  would break an expression whose only job is to build one. The refusal sits on
  `startActivity` and `show`, which is where a platform is genuinely needed.
- **`Context.startActivity` stopped taking `Object`.** It could not name `Intent`
  before one existed, which made it a *different method* to the JVM: present,
  and impossible for any extension to call. **That is the fifth time this
  repository has made that exact near-miss** (`getResources` returning `Object`,
  `aniListApi` typed as the wrapper, `setKey`, `simklApi`). The rule it keeps
  breaking: a parameter or return type widened to a supertype does not merely
  lose type safety, it renames the method. `Application.ActivityLifecycleCallbacks`
  was fixed in the same pass for the same reason.
- **`CheckBox` needed three ancestors** (`TextView`, `Button`, `CompoundButton`).
  Verification resolves a class's whole ancestry before it can be defined, so a
  shimmed `CheckBox` with missing parents fails exactly as loudly as no
  `CheckBox` — while naming the wrong class.
- **`Globals` is Kotlin, in the bridge, not a Java stub.** Upstream declares it
  as an `object` with a *member extension function* (`fun Context.updateTv()`),
  and both are Kotlin encodings — an `INSTANCE` field and a receiver-as-first-
  parameter method. A Java class with static methods of the same names compiles
  here and links against nothing there. It answers `PHONE`: desktop is a windowed
  app driven by a pointer, which is the phone layout's assumptions and
  emphatically not the 10-foot one.

`Drawable` is deliberately **not** abstract and has no `draw(Canvas)`. Every
counted occurrence uses it as a *type* — an icon field, a return — never as a
base class, and declaring the abstract members would drag `Canvas`,
`ColorFilter` and `PixelFormat` in to satisfy signatures nothing calls. If an
extension ever subclasses it, its own override will fail to resolve `Canvas` and
show up in the next count, which is the right way to learn that.

### Provider catalogues: `getMainPage`, finally (2026-08-31)

`MainAPI.getMainPage` had no path through the bridge at all, so "show me this
provider's catalogue" was unanswerable — the app could search a provider and
open a title from it, and could not browse it. That is the Android home screen's
entire content model, and it is what makes an OTT platform page more than a
search box.

`ProviderBridge.mainPageSections` reads the declared rows (a plain property; no
network, but it does need the plugin *loaded*, because the property lives on the
instance) and `ProviderBridge.mainPage` fetches one page of one row. Reached
through `providerMainPageSections` / `providerMainPage` and
`PluginManager.loadCatalog` / `loadCatalogPage`.

Two things worth knowing:

- **The request travels as separate primitives, not as a document.** The bridge
  has a JSON *writer* and no parser, and a provider's row handle is an opaque
  string that routinely contains delimiters — packing three fields into one
  argument would need an escaping scheme to get wrong.
- **A provider may answer one request with several rows.** Upstream's
  `HomePageResponse` carries a list, and those are flattened onto the row that
  was asked for. Rendering a provider's sub-rows as though the app had requested
  them would put rows on screen the user cannot page.

`page` is 1-based, matching upstream: providers written against the Android home
screen treat 0 as "no such page".

### The OTT platform destinations (2026-08-31)

`cs3/ottPlatforms.ts` maps provider display names onto Netflix, Prime Video,
Disney+ Hotstar, Disney+, Sony LIV, ZEE5 and JioCinema. The desktop app has no
privileged knowledge of what an extension registers — a `.cs3` is somebody
else's Kotlin and the only identity it exposes is its `MainAPI.name` — so this
can only ever be name matching, and the question is how to match without being
wrong in either direction.

| Too loose | Too tight |
|---|---|
| `PrimeWire` files under Prime Video. Someone opens Prime Video and browses a torrent aggregator. | A provider that renames itself disappears from its page and looks uninstalled. |

Loose is far worse because it is *silent* — the page fills with plausible
content from the wrong place. So exact names win first, and the patterns are
anchored tightly enough that the false positives which exist in this corpus
(`PrimeWire`, `Ahashare`, `Netfilm`) cannot reach them. Two overlaps are pinned
by name because they would otherwise depend on declaration order: `Disney+
Hotstar` normalises to `disneyhotstar` and must land on Hotstar, and `JioHotstar`
likewise. The Disney pattern carries a trailing `m?` for a measured reason — CNC
Verse ships a second extension suffixing every provider with `M`, so `DisneyM`
sits beside `Disney`.

**Sony LIV, ZEE5 and JioCinema have no provider named after them anywhere in the
reachable ecosystem.** The community reaches them through aggregate scrapers —
MovieBox and CNC Verse both advertise it. Dropping them from the catalogue would
be tidier and would answer the wrong question: the user knows the platform, not
the scraper. They are listed, and `providersFor` falls back to the providers
those extensions registered, so the search box on that page asks something real.
It is a fallback and never a merge: a platform with a provider of its own should
not have a general scraper's results filed under its name.

Four availability states — `ready`, `disabled`, `aggregate`, `missing` — because
they need different things from the user: nothing, a switch, an explanation, or
an install. **Collapsing them into "no content" is the failure this exists to
avoid**: a user who turned a provider off last week being told the platform does
not exist.

**A platform is a set of providers, not one.** NetMirror registers `Netflix` and
CNC Verse registers a `Netflix` of its own; `PluginManager.providers` is keyed on
the name, so the first keeps it and the second is reported through
`unavailableReason` — existing behaviour, and correct. The consequence is that
installing a second OTT repository does not double the Netflix page; it adds
whichever providers did not collide.

**Search from a platform page is scoped by `SearchOptions.providers`**, an
override honoured by `SearchScopeStore.override` with the same strictness as the
stored scope and deliberately *never written to it*. A scope that outlives the
page it came from is indistinguishable from a stuck filter, which is the failure
the strict resolution rules already exist to prevent. An empty override searches
nothing rather than everything.

Browse asks **one** provider, not a merge. Catalogue rows are the provider's own
editorial — "Trending Now" — and two providers' notions of trending are
different lists that would interleave into something neither meant. The first
provider publishing a catalogue wins the browse view; the rest are still
searched. Paging is a button rather than an infinite scroll, because each page is
a live scrape of someone else's server.

### A component built and never mounted (2026-08-31)

`ExtensionUpdates` — check, update one, update all, the auto-update policy, live
progress from the `extension:update*` events — was imported by nothing. Every
channel it needs was registered in `main.ts` and exposed in `preload.ts`, so
`ipcSurface.test.mts` was perfectly satisfied: **the IPC surface agreed with
itself and simply had no caller.**

That is the third direction this same failure has arrived from — a channel
invoked and never registered, a channel registered and never invoked, and now a
component built and never mounted. All three are invisible to `tsc` and to every
other test, and all three look identical to a user: a feature that exists and
cannot be reached.

`src/componentReachability.test.mts` closes it lexically, and is verified by
mutation. Three further orphans are allow-listed **with the component that
superseded each** (`MediaComponentsCard` and `RuntimeProvisionerCard` by
`UnifiedComponentManager`, `ProviderSelector` by `SearchScopePicker`), because an
allow-list without reasons becomes precedent for the next one. A second case
fails on a stale entry, so an entry that gets wired up has to be removed.

### Ranking on the maintainer's own status (2026-08-31)

On a fresh install every ranking criterion returns `null`, every provider scores
the neutral midpoint, and the order is whatever the map iterated — which is
exactly when a new user forms their opinion of the app.

There is evidence available; it is just not ours. Every CloudStream repository
index carries a per-plugin `status` — 0 down, 1 ok, 2 slow, 3 beta — set by
whoever maintains the scraper. It has been parsed into `SitePlugin.status` all
along and read by nothing.

Quoting it is defensible in a way a hand-written table of "good providers" would
not be: it is the author's own claim about their own extension, it updates when
they update it, and it needs no judgement from us about third-party code. It is
weighted **0.4** and `minSamples` **0** — a declaration is not a sample, and
requiring three would exclude the criterion from every provider forever — and it
loses to the counters the moment those have anything to say. A provider the
maintainer calls healthy that has failed nine of ten searches here must rank
below one marked beta that works.

`ProviderRanking.setContext` supplies it after construction, because
`PluginManager` and the ranking are both built in `main.ts` and each would
otherwise need the other first. A ranking with no context is still correct: the
criterion returns `null` and is excluded from the denominator, exactly as it is
for a repository that publishes no status.

### Results that resolve to nothing are held back (2026-08-31)

`TitleOutcomeStore` already recorded what happened last time a title was opened,
and `PosterCard` already badged it — which stops someone clicking the *same*
dead row twice and does nothing about a page full of them. `src/utils/deadRows.ts`
holds those rows back, and the interesting part is the exclusion:

**`app-error` is never hidden.** It means *our* runtime or transport failed, and
filtering on it would turn one bug of ours into a catalogue that silently
shrinks — reported as "the providers stopped working", by someone with no way to
see that a hundred titles were removed on our own account. This repository has
already had one translation bug come to look like a hundred broken providers.

Two more rules keep the cure from being worse. **The whole page is never
hidden**: a query where everything has failed before is exactly when the list is
needed, to try one anyway or to recognise the title is the problem. And **the
count is stated with the rows one click away**, because a results page quietly
shorter than the search found is indistinguishable from a search that found
less — the same complaint, from the other direction.

### Trailers: the catalogues publish an id and nothing else (2026-09-18)

PRD-45. `ExtendedMetadata.videos` had been assembled by `enrichmentService`,
carried across the IPC boundary and cached **since extended metadata was built,
and rendered by nothing**. That is the fourth direction this repository's
recurring failure has arrived from: a channel invoked and never registered, a
channel registered and never invoked, a component built and never mounted, and
now a *field* populated and never read. No test catches the fourth, because the
data flowed correctly the whole way and simply stopped.

**What the keyless sources actually publish, measured against the live hosts:**

| Source | Videos per title | Type published |
|---|---|---|
| Cinemeta `trailers[]` | 2-5 (Spider-Verse 5, Dune: Part Two 3, Breaking Bad 2) | the literal string `"Trailer"`, on **every** entry including the teasers |
| Cinemeta `trailerStreams[]` | the same ids again | a `title` that is the *film's* name repeated |
| AniList `trailer` | 1 | the site, not the type |

So the type, the ordinal and the season are not fields anybody gives us.
**YouTube's keyless oEmbed endpoint closes that**: 12 ids issued in parallel
answered in **201 ms total**, carrying the real title and channel --
`"Dune: Part Two | Official Trailer 3"`, `"Stranger Things Season 1 Trailer 1 |
Rotten Tomatoes TV"`. `metadata/videoTitles.ts` reads them.

Rules:

- **The describing segment decides the kind, not the whole title.** Measured on
  `Spider-Man: Across the Spider-Verse - Trailer #3 - Only In Cinemas June 2`:
  testing the whole string classified a numbered trailer as a promo, because
  "In Cinemas" matches a rule listed above `trailer`.
- **An unrecognised video is a trailer, never `other`.** These arrive from a
  *trailer* field; filing one under Related Videos hides the thing the viewer
  asked for.
- **Wikidata's `P1651` is not a trailer -- do not use it.** Measured: it resolves
  to the **YouTube Movies rental listing** (`Dune` by *YouTube Movies*). A
  paywalled full film labelled "Trailer" is the wrong-answer-that-looks-plausible
  failure, caught only because it was checked.
- **Duration and publish date are not fetched.** They sit at roughly byte
  **748,000 of a 1.28 MB** watch page -- a megabyte per card to print "2:31". The
  fields exist and are filled opportunistically from yt-dlp's reply when a video
  is played, because that call happens anyway.
- **Nothing settled renders empty.** PRD-45 section 10 asks for both "hide the
  section" and "show a no-trailers state"; those cannot both be right, and
  `metadataSection.ts` settled it already.
- **A trailer plays in its own popup, never in the player** (`TrailerPopup`,
  2026-09-19). It used to go through `onPlay` as a `PlaybackRequest` with no
  `progress`, no `series` and no `sources` and `promo: true` withholding the
  download button -- correct, and still wrong: a two-minute teaser took over the
  app exactly as the film does, and leaving it meant leaving the page being read.
  The popup is a dialog over the detail page with the browser's own controls, so
  it sets none of the player's expectations (pick a source, download, resume,
  next episode). `promo` is gone from `PlaybackRequest`; nothing set it.
- **The popup still calls `media:prepare`, and still refuses `NATIVE_MPV`.**
  INV-RACE-1 is not waived for a short video: `videos:resolve` answers with a
  proxied provider address and the classification decides the transport, never
  the URL string. A prepared session is closed on every step, or six trailers
  hold six ffmpeg processes.
- **Autoplay is an offer with a five-second countdown, and it never leaves the
  rail.** `src/utils/trailerQueue.ts` (pure, tested): a trailer follows a
  trailer and a related video follows a related video -- rolling on from the last
  trailer into an eleven-minute cast interview is the exact failure `groupVideos`
  splits the two rails to prevent. Nothing wraps, so autoplay ends by itself.

**And a trailer is never a source.** `resolvePromoVideo` goes nowhere near
`getSources`, the cache, the ranker or the download identity. The standing rule
that a trailer standing in for a feature is a synthetic source is about a trailer
offered when somebody asked for the *film*; here they pressed it, in a section
labelled Trailers.

### YouTube serves only bounded byte ranges, and that broke everything (2026-09-18)

The measurement that shaped the playback half. None of it was guessable.

**YouTube publishes exactly one muxed format -- id 18, 360p -- and it is mostly
refused.** Across eight trailer ids from Cinemeta, format 18 answered `HTTP 403`
on **five of eight**, and `yt-dlp` itself gets the same 403 when asked to
download them, so it is the URL being rejected rather than how we fetch it. No
extraction client changes it: `tv`, `ios`, `android_vr`, `web_safari`, `mweb` and
`tv_simply` were each measured at **0 of 5**.

**The DASH rungs are fine** -- video 137 (1080p avc1) and audio 140 (m4a)
answered `HTTP 206` on every one. So the stream is a *pair*, and something has to
mux it.

**But a DASH URL refuses anything that is not a bounded window:**

| Request | Reply |
|---|---|
| no `Range` header | **403** |
| `Range: bytes=0-` | **403** |
| `Range: bytes=0-4095` | 206, `Content-Range: bytes 0-4095/61710344` |

That defeats every ordinary consumer here: ffmpeg opens an input with no `Range`
at all, and a media element streaming from a position sends the open-ended form.
Both get a 403 and report the source as forbidden, which reads as a dead link.

`MediaProxy.wrap(url, headers, { boundedRanges: true })` is the answer:
`serveWindowed` asks upstream in windows and stitches them into the single
continuous response the client expects. Four things about it are load-bearing:

- **The first window is 64 KB, and that is not a warm-up.** A window's end has to
  be a byte that exists, and the total is unknown until the first reply.
  Measured: `bytes=0-4194303` of a 2,742,140-byte audio rung answers **403**, not
  a clamped 206 -- so a full-size opening window fails on every file smaller than
  the window, while the 61 MB video rung beside it succeeds. That difference
  looks exactly like "audio is broken".
- **The total comes from the first window's `Content-Range`.** It is the only
  place the full size appears, and without it a media element cannot draw a seek
  bar.
- **The status mirrors what was asked**, not what upstream said: upstream answers
  206 to every window, and echoing that to a client which asked for the whole
  file would leave it waiting for a remainder that never comes.
- **A refused window is halved and retried** down to 64 KB, covering both a
  window too long for the file and a momentary refusal.

**Verified end to end** with the real `MediaProxy` and the real ffmpeg: plain GET
-> `200`, `Content-Length: 48696621`; mid-file range -> `206 bytes
1000000-1004095/48696621`; and the two-input copy produced a fragmented MP4 that
ffprobe reads as `h264 1920x1080` + `aac 2ch`. Both decode natively in Chromium,
so the element plays it with no further work.

**One trap when measuring this yourself:** sustained re-reads of one googlevideo
URL start answering 403 after about a megabyte. Two 512 KB windows succeeded and
every window after them failed, on a URL six hours from expiry that a dozen
earlier probes had hammered. Fresh URLs served 16 MB windows without complaint.
Budget fresh ids per experiment, or the rate limit will read as a design fault.

`MediaTranscoder`'s `Session` gained an optional `audioUrl`, unset by every other
caller: with it absent the argument list is byte-for-byte what it was.

### Cards remember what already happened to them (2026-09-18)

PRD-46. Every surface draws the same `PosterCard`, and each one used to decide
for itself what to put on it -- search passed an outcome, Continue Watching
passed a percentage, everything else passed nothing. The same film was a
different card depending on which screen you found it on, and a viewer cannot
learn a language that changes between rooms.

`cs3/titleInteractions.ts` is **a join, not a sixth store**. Watch progress is in
`libraryStore`, what happened last time is in `titleOutcomes`, transfers are in
`downloadService`, resolvable links are in `sourceCache`. It owns exactly one
fact nobody else has -- that a details page was opened -- and reads the rest live.

- **Visits could not be derived from `PageSnapshotStore`.** That keeps a *copy of
  the page*, so it is capped; a title would stop being marked visited because a
  few hundred others were opened after it, in an order nobody could explain.
- **Two keys, and both are needed.** `canonicalKey(title, year)` for everything
  about the work -- watched, downloaded, how far through. The *address* for
  everything about one source of it. Folding the second onto the first would mark
  every copy of a film failed because one scraper's page was dead.
- **Failure is always marked, success almost never is.** A tick on everything
  that ever worked is decoration on every card in the library.
- **A failure the viewer has disproved is retired** (`cardState.ts`): watch
  progress newer than the failure, or a completed download, clears the badge.
  PRD-46 section 9 -- the indicator is the latest state, not a permanent verdict.
- **`visited` is a dimming, never a badge**, so it can be true at the same time
  as any other state without competing for the one corner. The poster and the
  title fade; the badge does not, because the reason to notice a visited card is
  usually the badge on it.

### Standard mode, and where the app was narrating itself (2026-09-18)

PRD-47. `src/utils/experienceMode.ts` and its context already existed; what was
missing was the sweep. Now behind developer mode: the transformation plan drawn
over a playing film (`capability.explanation`), the swarm and peer readouts, the
failover attempt list, source ranking scores with their reasons, the codec
columns in a source row and in the library's stored sources, the full
`repository > extension > provider` chain (standard mode shows the provider
alone, via `providerLabel`), and the provider inspector including its F12
shortcut.

Rules:

- **Loading stages are reworded, not removed.** "Connecting to the swarm" becomes
  "Starting playback"; "Searched 7 of 19 indexers" becomes "Checked 7 of 19
  places". The climbing count stays in both, because it is what says the app is
  working rather than stuck.
- **Errors keep their original text**, demoted rather than discarded:
  `plainMessage` gives a viewer a sentence, and developer mode shows the original.
- **The Developer mode row in Settings is deliberately `basic` level.** Every
  other row on that tab is held back in standard mode; if this one were too, the
  only way to turn it on would be a two-word toolbar toggle with no statement of
  what it does.
- **The F12 shortcut is gated with the button it duplicates**, and reads the mode
  through a ref -- the listener is installed once, so closing over the mount-time
  value would leave the shortcut dead until the next reload.

### The second pass: the screens PRD-47 did not reach (2026-09-19)

The sweep above covered the player, the source lists and the library and stopped
at the two screens with the densest jargon in the product. The extensions screen
was **entirely unswept** -- it is the app's own build vocabulary rendered as a
UI, and it is also the screen a new user is sent to first.

Now behind the same one switch, with nothing removed:

| Surface | Standard mode | Developer mode |
|---|---|---|
| `CompatibilityReport` | one verdict -- "Should work", and why | the score, confidence, tier, format, Android API references, network stack, HTML parser, native libs, analyser details |
| `ProvenancePanel` | maintainers, content, version, size, project page | those plus internal id, SHA-256 and the raw catalogue URL |
| `ExtensionCatalog` | "Will it work?" | "Check compatibility" |
| `SearchView` progress | the bar, the count, "N failed" | plus which source answered last and each failure's exception text |
| `SearchView` failure | `plainMessage`, original one click away | the original, already open |
| `ProviderRankingPanel` | score, band, sample count, pin/never-use, **every privacy control** | plus the weighted criteria, their sliders, the per-criterion breakdown and the source's repository |
| `SourceSettings` | "the places searched when an add-on has nothing" | the indexer paragraph, the named sites, Jackett/Prowlarr |

Rules, beyond the four above:

- **`compatibilityVerdict.ts` reads the score; it never re-derives one.** Pure and
  tested, for `providerHealth.ts`'s reason -- a second opinion computed at the UI
  is how a panel and its own summary come to disagree in front of one person. The
  80/50 boundaries are `CompatibilityReport`'s existing badge thresholds, kept
  rather than re-chosen for the same reason.
- **`Unsupported` is an absence of evidence, not the bottom of the scale.** Its
  score is 0 by default rather than by measurement, and the cross-platform jar
  lane spent a release being reported as exactly that -- `Unsupported`, 0% --
  for the one lane that needs no translation at all. It answers `unknown`.
- **Nothing tells a viewer an extension *will* work.** The analyser reads the
  archive and never runs it, so a perfect score and a dead site are identical
  from where it stands. Every band hedges; a test enforces it.
- **A privacy control is never held back.** `ProviderRankingPanel` carries what is
  collected and the button that erases it, and those stay in both modes. Gating
  the whole panel was the obvious move and it would have put a data control
  behind a jargon filter, which is the one thing this level must not do. The
  same argument keeps pin/never-use visible: they are choices, not workings.
- **Jargon with no technical counterpart is reworded once, not branched.** "Delete
  its archive", "No providers registered", "declares upstream's NSFW content
  type" have no audience that needs the original, so they are simply fixed. A
  mode branch is for content a developer genuinely wants back.

### The cast list was a row of names, and that was as far as it could go (2026-09-14)

The detail page showed `detail.actors` as grey chips. That is upstream's shape —
`LoadResponse.actors: string[]` — and it is not a UI shortcoming: **a `.cs3`
provider is a site scraper**, so it knows the page it parsed and nothing else. It
has no opinion about who directed the film, what an actor looks like, which
character they played, or what IMDb's 900,000 voters thought. Widening
`LoadResponse` would have added a dozen fields every provider in the corpus
leaves undefined, and the page would look exactly as it does now.

So extended metadata is a **second record on a second schedule**: the provider
answers "what can I play", the catalogues answer "what is this", both keyed on
the same title, merged at the edge. `electron/metadata/` owns the second half and
`src/components/detail/TitleMetadata.tsx` draws it.

**The key constraint eliminates most of the obvious answers.** The user must not
have to obtain an API key — `cs3/discovery.ts` settled this for the home screen
and it binds harder here, because a key embedded in a distributed GPL client is
both a licence violation and a key that gets revoked, taking the feature from
every user at once. That rules out TMDB, Trakt, OMDb, Fanart and TheTVDB as
direct sources, which is most of what a search for "movie metadata API" returns.

Four keyless sources survive, and each answers a different part:

| Source | Answers | Covers |
|---|---|---|
| **Wikidata** (SPARQL, CC0) | cast **with characters**, crew, release date, box office, budget, awards, and the Wikipedia sitelink | film and TV |
| **TVmaze** | cast and crew with real photographs, and the character's own artwork | television only |
| **AniList** (GraphQL) | characters, their voice actors in every language, staff, studios — both name pairs in both scripts | anime |
| **Cinemeta** | director, writer, `released`, country, awards, trailers, IMDb rating | film and TV |
| **Wikipedia** (REST) | "behind the scenes" prose — production, filming, casting, legacy | anything with a sitelink |

Wikidata is the one that made this worth building. Cinemeta's `cast` is
`string[]` — names and nothing else — so before this the app could say Timothée
Chalamet is in Dune and could not say he plays Paul Atreides. Wikidata models
`P161` (cast member) as a *statement* carrying `P453` (character role) as a
qualifier, so the performer and the part are one fact rather than two lists to be
zipped together and got wrong. **Cinemeta is also the cheapest of the five**: the
app already fetches that exact URL on every catalogue detail page and reads nine
of its fields, so `cinemetaExtras.ts` is a new parse of a reply already paid for.

#### Things that are load-bearing

- **Nothing waits for this.** `metadata:getExtended` answers from cache at once
  and `metadata:extendedUpdate` pushes a fuller record as each source lands —
  push-shaped like `search:*` and `playback:*`, for the identical reason. Four
  third-party hosts, the slowest measured in seconds; a blocking version would
  make every detail page as slow as Wikidata's worst day.
- **The enrichment is never on the playback path.** `metadataEnrichment` is
  constructed beside `contentService` in `main.ts`, not inside it. Folding it
  into `ContentService.load` would put four third-party APIs in front of a Play
  press.
- **The provider's own `actors` stays as the floor.** `TitleMetadata` takes
  `fallbackActors` and renders the old chip list when nothing richer arrived.
  Without that, enrichment would *replace* the names on every title the
  catalogues do not cover rather than adding to them — a large part of this
  corpus, since providers scrape sites rather than databases.
- **Nothing *settled* renders empty, but a lookup in progress says so.** The
  rule was once "nothing renders until there is something to render", and the
  half of it about the settled case still holds: a "Cast" heading over a blank
  space reads as a lookup that failed, and for a title nothing has an entry for
  that impression would be permanent and wrong. The half about the *wait* was
  wrong. Five hosts are asked and Wikidata alone measured 11.3s, and for all of
  it the page said nothing — so a slow fetch and a title no catalogue carries
  produced the same screen, collapsing the exact distinction `empty` vs `failed`
  exists to keep. `metadataSection.ts` owns the four-way decision (`looking` /
  `fallback` / `content` / `nothing`); it is a plain `.ts` beside the component
  because Node's type stripping cannot load JSX, same as `settingsLevel.ts`.
- **`pending` is the caller's flag and `partial` is the record's, and both are
  needed.** `partial` only exists once a record does, and for a page whose
  provider published no IMDb id the lookup *begins* by resolving one from the
  title — so the longest part of the wait happens while there is nothing to read
  a flag off. `DetailView` clears `pending` on every exit from that effect,
  including the no-URL path: a spinner that outlives its request is worse than
  no spinner.
- **There is no "show all" on the cast or the notes.** Everything found is
  drawn. A collapsed list hides what the viewer came to read behind a button
  they have to find; the rail already scrolls and `Poster` lazy-loads, so a
  250-strong anime cast costs its images only as they are scrolled to. The
  heading states the count, because a scroll bar cannot say whether it is
  showing twelve of twelve or twelve of two hundred.
- **Ratings are never normalised on ingest** (PRD-41 §11.5). Value plus
  `scaleMin`/`scaleMax`, as published; `normalisedRating` scales at read time for
  sorting only. Rotten Tomatoes' 91% rendered as "9.1/10" is a misquote, not a
  unit conversion — and a zero answers `null`, because AniList sends
  `averageScore: 0` for an unrated title and scaling it renders a real and
  terrible score.
- **The Wikipedia article is a sitelink, never a search.** A search for "Dune
  production" finds an article, and whether it is about the 2021 film, the 1984
  one, the novel or the desert is a guess — one that attaches the wrong film's
  history to a page in well-written, entirely plausible prose. Wikidata's
  `schema:about` asserts the identity. No sitelink, no prose; that costs coverage
  on obscure titles and is the right trade. Same argument `cs3/titleEnricher.ts`
  makes, one step further.
- **Wikipedia attribution is a required field.** `ProductionNote.attribution`
  carries the source, the deep link and the licence name, so nothing can
  construct a note without one. The text is CC BY-SA; an attribution the UI can
  forget to render is one it will eventually forget to render.
- **Commons images are requested at a width.** `P18` resolves to
  `Special:FilePath/<file>`, which serves the *original upload* — 3–8 MB for a
  professional headshot, up to sixty of them, drawn at 96 pixels. `?width=` is
  always appended and the raw URL never reaches the renderer. TVmaze's `medium`
  is taken over `original` for the same reason.
- **The native name is `P1559`, not a non-English `rdfs:label`.** Selecting a
  label in another language returns one row *per language Wikidata holds*,
  multiplying a 40-person cast by 90 and timing the query out.
- **Spoiler tags never reach the page.** AniList marks them
  (`isGeneralSpoiler`/`isMediaSpoiler`) and they are the one piece of metadata
  that can actively ruin the thing the viewer came to watch.

#### The merge, and why it is its own tested module

`metadata/merge.ts` is pure and pinned by 34 cases, for the reason
`ottPlatforms.ts` and `playedSource.ts` are: every wrong answer is silent and
plausible. The two failure directions are not symmetric —

| Too coarse | Too fine |
|---|---|
| The composer John Williams folds into the bit-part actor John Williams | One person from two sources becomes two rows |
| Rare, wrong, and invisible | Common, harmless, and looks broken |

— so the key is **name plus role class**, and two cast credits that *both* state
a character and state different ones are treated as different people. Where only
one source states a character there is no disagreement, and merging is right:
that case is the whole point, since Wikidata has the character and TVmaze has the
photograph. Characters compare by containment in either direction, because
"Tony Stark" and "Tony Stark / Iron Man" are one role.

**Source order in `assemble` is precedence order and is not arbitrary.** The
sources carrying characters and photographs go first so their rows shape the
list; the name-only sources fold onto them. Put Cinemeta first and the merged
cast is ordered by the one source with no images.

**A credit with no billing order is never given one.** Wikidata answers a SPARQL
*set*, in planner order; treating a missing `order` as `0` scatters unbilled
extras through the top of a list TVmaze had ordered correctly. `orderCredits`
puts the unordered ones behind, stably.

#### `empty` is not `failed`, and two bugs of mine proved why it matters

Same distinction `providerAnalytics` draws. Wikidata genuinely has no entry for
many 2024 streaming releases; reporting that as an error puts a red state on a
page that is simply about an obscure title. So `MetadataSourceOutcome` carries
`ok` / `empty` / `failed` / `skipped`, with the reason kept even though the page
shows only one muted line.

**That distinction is worthless if a source swallows its errors, and two of them
did.** `lookupByImdb` caught everything and answered `null`; `fetchWikidata`
settled both queries and returned an empty result whatever happened. The e2e
harness caught both on its first run — reporting *Breaking Bad*, one of the
best-covered series TVmaze holds, as "not a TVmaze title" while the host was
answering 403, and every Wikidata row as `OK — 0 credits` against the same 403.
An unreachable host would have reached the viewer as "this title has no cast
recorded", with the real cause invisible in every diagnostic the app collects.
Only a 404 is a null now, and a total Wikidata failure is raised. Pinned by
`metadata-sources`, verified by mutation.

**This is the same defect this repository keeps undoing** — `probeUrl`'s
`res.resume()`, `BinarySetupModal` rendering a rejection as a friendly notice,
`ensureProvidersLoaded` returning silently. A catch that reassures is worse than
no catch.

#### Verified against live hosts, 2026-09-17

The section that stood here said no part of `electron/metadata/` had ever been
run against a live host, because it was written in a cloud container whose
egress proxy denied every third-party host. That is no longer true and the
claim was the stale half of this file.

`node --experimental-strip-types tools/e2e/metadata-e2e.mjs` — **PASS, 3/3
titles resolved a cast list with characters.** Per-source, measured:

| Title | cinemeta | wikidata | tvmaze | anilist | wikipedia | merged |
|---|---|---|---|---|---|---|
| Dune (2021) | 606ms, 7 | 1553ms, 29 (14 characters, 22 photos) | n/a (a film) | — | 997ms, 5 sections | 33 credits |
| Breaking Bad | 68ms, 4 | 11280ms, 60 | 1240ms, 56 | — | 898ms, 3 sections | 106 credits |
| One Piece | — | — | — | 1038ms, 253 | — | 252 credits |

Note Wikidata's **11.3 s** on Breaking Bad. That is the number the whole
push-shaped design exists for, and it is why nothing on the detail page waits
for this record.

What is still *not* claimed: `tagline` is carried on `ExtendedMetadata` and
**nothing keyless fills it**. It is absent from Cinemeta, TVmaze and AniList,
and Wikidata's `P6338` came back unset on every film checked. It is filled from
the provider or not at all, and the row is simply omitted.

#### Every page gets the same metadata, because the id is resolved

The complaint this answers is "some titles show everything and some show a row
of names", and the cause was not the catalogues. **Four of the five sources are
reached through an IMDb id**, and a `cs3ext://` page from a scraper routinely
has none — the provider parsed a streaming site and the site never printed one.
Those pages recorded four `skipped` outcomes and rendered nothing at all.

`MetadataEnrichmentService` takes `TitleEnricher` and resolves the id from the
title before asking anything. Measured live, from the raw release name
`Dune Part Two 2024 2160p WEB-DL` with **no ids of any kind**: resolved to
`tt15239678` and assembled genres, runtime 167, `US: PG-13`, Legendary Pictures,
three countries, poster, backdrop, `2024-03-01`, an IMDb rating, 6 trailers and
31 credits. Before, that page drew nothing.

Four rules:

- **Awaited, not raced.** Every source below it is addressed *by* the id, so the
  fan-out cannot start first. `TitleEnricher` caches for a week.
- **The resolver's conservatism is the safety.** A disagreeing year disqualifies
  and the similarity bar is high; a wrong match does not degrade a page, it
  replaces it with a different film's cast and nothing marks it as a guess.
- **Anime resolves an AniList id the same way** (`searchAniListId`). An IMDb id
  reaches Cinemeta and Wikidata and neither has characters, voice actors or
  native names, which is the entire reason AniList is in the set.
- **The provider's own answer always wins; enrichment is the floor.** Poster,
  plot, runtime and original title fill gaps and never overwrite — a scraper
  that returned artwork returned it for the *release* being watched, and a
  canonical catalogue value would quietly change what the page is about for
  dubbed cuts and re-edits.

New fields on the record, with where each is measured from: `genres` (Cinemeta,
TVmaze, AniList — **never Wikidata's `P136`**, which answers "action film" and
"drama television series" and would put the word "film" on every chip),
`status`, `seasonCount`/`episodeCount`, `runtimeMinutes`, `posterUrl`,
`certifications` (`P1657`), `networks` (`P449` + TVmaze). `backdropUrl` had been
fetched, cached and sent across the IPC boundary since this module was written
and was **drawn by nothing** — `DetailHero` is the entry point it never had.

**Organisations merge on the name.** Measured, TVmaze and Wikidata both answer
`AMC` for Breaking Bad, and the first version of this rendered "AMC, AMC" under
Network. `mergeOrganisations` is the `mergeStrings` rule for `Organisation[]`;
`studios` had the same latent duplication and goes through it too.

### The search box answers before the network does (2026-09-17)

Reported as: autocomplete is too slow. Measured against the live endpoints
rather than reasoned about, in milliseconds:

| query | fan-out | the awaited enrich after it |
|---|---|---|
| `sp` | 935 | 388 |
| `spi` | 437 | 187 |
| `spider` | 290 | 52 |
| `spidrman` | 696 | 315 |

Plus a 250 ms renderer debounce, so the first row appeared **0.6–1.6 s** after
the viewer stopped typing. Three faults, and the fan-out was the smallest:

1. **The enrich was awaited.** Genre and plot on rows that were already correct,
   already ordered and already carried a poster — holding back the whole list.
2. **The fastest two sources waited for the slowest.** TVmaze answers in ~170 ms
   and Cinemeta's movie catalogue in up to 935; `Promise.allSettled` paid the
   935 every time.
3. **Nothing was reused between keystrokes.** `spider` and `spiderm` share every
   answer worth showing, and the second started from nothing.

Measured after, typing `spider man` one character at a time: from the fourth
character on, **every keystroke has rows in 0 ms** (`instant()`, synchronous, no
I/O), and the network's first rows land at 36–430 ms. Debounce is 110 ms.

Rules:

- **`instant()` is synchronous and must stay so.** An `async` signature invites
  a caller to await it beside the network call, which is how the latency it
  removes got there. Exact cache hit, else longest cached *prefix* re-filtered,
  else nothing — and a prefix answer is **never** `done`.
- **One `AbortController` in `main.ts`.** A search box has one current query; a
  new keystroke aborts the previous fan-out. Nine live scrapes against three
  third-party hosts is what a typed title costs without it.
- **A single character asks Cinemeta only.** It identifies nothing, so three
  fan-outs per keystroke buy an unrankable list at triple the cost.
- **`SOURCE_PRECEDENCE` is identity, not decoration.** Sources now publish as
  they land, so `found` accumulates in *arrival* order; the merge keeps the
  first candidate's title and URL, and that URL travels as `ExactMedia.url`.
  Without a fixed order the same query names the same work differently between
  runs — measured on *One Piece*, which Cinemeta spells `One Piece` and TVmaze
  spells `One Piece!`.
- **A prefix match is not charged for the untyped remainder.** Bigram overlap
  scores `dune` against `Dune: Part Two` at 0.50 and against `Dune Drifter` at
  0.67 — purely a length difference — and with the word-count penalty on top,
  an obscure 2020 film outranked the film the query obviously meant while
  Cinemeta had ranked the franchise 0, 1, 2 in the reply. Prefix matches floor
  the similarity and skip the penalty, and `rankBonus` (the row's position in
  its own catalogue) breaks the tie. Verified: `dune` now surfaces Part Two,
  Part One and Part Three in that order, and `dune part two`, `breaking bad`,
  `the office`, `inception`, `naruto` and `avatar` are unchanged.
- **Matching is against every name a row answers to** — title, native title and
  synonyms — and against the *collapsed* spelling, so `spiderman` matches
  `Spider-Man`. Verified live: `spiderman`, `spidrman`, `Spider Man`,
  `shingeki` (→ Attack on Titan), `brakin bad` and `atack on titn` all resolve.

`electron/searchSuggestions.test.mts` (18 cases) pins it, mutation-verified:
restoring the awaited enrich, the batched publish, the full single-character
fan-out, the prefix cache, the source precedence and the prefix scoring each
fail a test. The two ordering tests use a **gated** stub rather than a timer —
a timing test for a latency fix passes on the machine that wrote it.

### Extension updates: three reasons "Update all" did nothing (2026-09-17)

Reported as: updating every extension always fails, and many are visibly out of
date. Diagnosed against a real install — 219 installed extensions, 31
repositories — and **not from the logs, because the entire update path logged
nothing**: 22,841 records held not one line from `extensionUpdater.ts`. That is
the first defect, and it is why the other two survived.

Measured on that install by driving the shipped `ExtensionUpdater` with the
network live and the install step stubbed:

| pressing "Update all" | before | after |
|---|---|---|
| extensions acted on | **3** | **94** |
| installed over the existing archive | 1 | 94 |
| would create a duplicate beside it | **2** | **0** |
| backups actually taken | 1/3 | 94/94 |

1. **`updateAll()` with no targets preferred a persisted snapshot.** It fell
   back to a live check only when the cache was *empty*. The cache is written by
   the last check and survives restarts, so it can be arbitrarily old: 3 entries
   stored against 94 available. The button updated three extensions, reported
   "Updated all 3 extension(s)", and left 91 — indistinguishable from the
   feature not working. **"Update everything" means everything out of date now.**

2. **An update installed into the wrong directory.** `installPathFor` keys the
   on-disk directory on the *repository URL string*, and one repository is
   routinely known by two — the curated list stores a project page
   (`https://github.com/owner/repo`) and `fetchRepository` resolves it to a raw
   document. An extension stamped with the first and updated under the second
   got **no backup** (`preserveInstalledVersion` looked at a path that does not
   exist and returned false, so a bad update could not be rolled back at all)
   and was **installed beside itself** rather than replaced. Physical evidence
   on that install: 311 archives on disk for 219 records, with duplicate
   filenames in two repository directories holding different bytes.
   **Where the archive lives and where the new bytes come from are two
   questions**: download from the update's repository, install into the
   record's. `resolveUpdate` had always preferred the extension's own
   repository; `doCheck` did not, so which repository supplied an update
   depended on the order the catalogue fetches settled in.

3. **A transport failure was reported as a broken extension.** See below.

`autoInstall` still defaults to **false** — notify only. That is deliberate and
unchanged: installed extensions execute code the user chose to trust at a
version, and silently swapping it is their decision. "The app should update
itself" is one toggle, not a default.

### A timeout is not a verdict (2026-09-17)

`PluginManager.inspect` turned **every** failed RPC into a `T4_BLOCKED` tier,
which means "this archive cannot be loaded". Two things act on that, and both
are wrong when the runtime simply never answered:

- `ExtensionUpdater` reads it through `verifyInstalledPlugin` and **rolls the
  update back** — undoing an archive that had already downloaded, verified its
  publisher's SHA-256 and been written atomically, then reporting the extension
  as broken.
- The tier is cached, so the extensions screen shows a working extension as
  blocked until something re-inspects it.

Not hypothetical: a bulk update unloads, translates and reloads each archive in
turn against a JVM holding 219 plugins, and the call deadline is 60s.

`cs3/rpcResult.ts` owns the distinction — `TRANSPORT_ERROR_KINDS` is the closed
set the *host* sets when no verdict was produced (`SIDECAR_UNAVAILABLE`,
`SIDECAR_STOPPED`, `SIDECAR_CRASHED`, `TIMEOUT`), and `inspect` answers `null`
for those, exactly as it already did for a sidecar that had not started. It is
its own module for `groupingForm`'s reason: `sidecarSupervisor.ts` imports
`electron` and cannot be loaded under Node's type stripping.

**DROP-34 already said this.** It was being honoured only for
`ensureStarted()` returning false, and not for a call that failed afterwards.

`bun run test updater` (13 cases) pins all of it, mutation-verified: restoring
the cache-first behaviour, the update-repository install target, the missing
own-repository preference, or the flattened transport kinds each fails a test.

### A mirror cannot make a claim about somebody else's extension (2026-09-19)

Reported as: every update fails, 60 of them, with `SHA-256 mismatch`. The
verification was right and the update should never have been offered.

Measured from the session log: **61 of 61 failures were same-version
`republished` candidates, all supplied by one repository (`xr3ed/xr3ed-Repo`),
and none of the 125 installed extensions came from it.** That index mirrors 195
entries by pointing `url` straight at **phisher98's** artifacts while publishing
its own `fileHash` and `fileSize` — measured, its declared sizes run ~2,700
bytes under the files those URLs serve, so its hash describes a build that is
not at the address beside it. Checked directly: phisher98's own index matches
its artifacts byte for byte on every sample.

So `artifactChanged`, read across repositories, cannot tell **"your copy is out
of date"** from **"two publishers built this differently"** — and it answered
the first every time. The result was a permanent failure list that no amount of
retrying could clear, because the hash is wrong at the publisher.

- **A republish is a claim only its own publisher can make.** Same version plus
  different bytes counts only from `local.meta.repositoryUrl`. A record with no
  repository stamp takes version bumps only.
- **A version *bump* stays cross-repository.** That is a claim about the
  artifact itself, tested by the number rather than against our own bytes; the
  installed-from repository remains the tie-break, not a veto.
- **`status: 0` is a quotation, so only the maintainer may be quoted.** Same
  bug, same screen: `IdlixProvider is marked as not working by its maintainer`
  was on display while its own publisher had it at `status: 1` and a third
  repository carried a stale copy. An unreachable own-repository now produces no
  notice, which is the honest answer.
- **A hash mismatch names the index that published the hash**, plus declared
  size against arrived size. Sixty identical rows blaming "the download" is the
  one explanation that was never true, and the size gap identifies a
  mirror-metadata mismatch in a line. The declared size is *reported, never
  checked* — rejecting on it would be a second way to refuse what the hash
  already covers.

### 5.1 The end-to-end harness — `tools/e2e/provider-e2e.mjs`

Run it before believing anything about extension health:

```
node tools/e2e/provider-e2e.mjs                       # all five repositories
node tools/e2e/provider-e2e.mjs --repo MegaRepo       # one
node tools/e2e/provider-e2e.mjs --plugins 3 --queries "one piece,dune" --json report.json
node tools/e2e/provider-e2e.mjs --list                # what it knows about
node tools/e2e/provider-e2e.mjs --repo phisher --only TorraStream,Ultima   # named extensions
```

It drives the whole chain — repository JSON → `.cs3` download + SHA-256 → DEX→JVM →
`load()` → `search()` → `load()` → `loadLinks()` → **a 2 MB range-GET off the real host** —
against Kraptor123/cs-kraptor, Bnyro/GermanProviders, Sushan64/NetMirror-Extension,
NivinCNC/CNCVerse-Cloud-Stream-Extension, phisher98, rockhero1234/cinephile and
self-similarity/MegaRepo. Exit 0 requires bytes, not just search results; `PARTIAL` means
providers scraped but no link played.

It talks to the sidecar over the same stdio JSON-RPC the main process uses, with **no
Electron in the way**. That split is most of its value: if the harness passes and the app
does not, the bug is in `cs3_windows/`; if the harness fails, it is in the runtime or the
extension.

Measured 2026-08-13, all five repositories, 2 plugins each: 6 providers loaded, 4 answering
(ARD 30/31 results, AllMovieLand 4/6, AllWish 2/1, Binged 18/18), and ARD resolved 5 links
and delivered **2.00 MB of `video/mp4`, HTTP 206, `Accept-Ranges: bytes`**. The rest are
honest per-source failures worth recognising rather than re-debugging:

| Symptom | Cause |
|---|---|
| Aniworld — HTML `403` where JSON was expected | Google bot protection on the host, not translation |
| Cinevood — `SocketTimeoutException` | the site is slow/unreachable from here |
| Binged — "does not implement that operation" | `BingedReview` is a review catalogue; it has no `loadLinks`. Correct. |
| Anichi — `NoClassDefFoundError: AniListApi$CoverImage` | an `:app` type absent from `library-jvm`; flagged `T3_DEGRADED` at load |
| cs-kraptor — `InvocationTargetException: null` at load | not yet diagnosed |

`fileHash` is published as `sha256-<hex>`. Strip the prefix before comparing — the app does
(`installPlugin`), and the first version of the harness did not, which reported every
download in the corpus as a hash mismatch.

**Where it still stops.** `loadLinks` runs the real extractors and they fail on the *hosts*:
Voe returns "encoded string not found", Vidsonic gets HTML where it expects hex. Those are
bot-protected file hosts, which is doc 36 step 7 (WebView) territory, not a translation
problem. Do not "fix" this by weakening the extractor path — the correct next step is the
WebView bridge.

Repository URLs: the curated list stores project pages (`https://github.com/owner/repo`),
which return HTML. `pluginManager` resolves those to raw documents by probing branch and
filename combinations, because there is no convention — `master/repo.json`,
`builds/repo.json` and `builds/plugins.json` are all in use across the bundled list.

An earlier revision of this app registered installed plugins as fake providers backed by a
metadata API and a **hardcoded demo video**. That was removed deliberately, and the
codebase now carries comments saying so. **Never reintroduce a synthetic/placeholder
source.** When nothing real is found, return an empty list *and a reason*. A system that
cannot run must say so, not return empty results dressed up as "no matches found".

### Source discovery asks the originating provider first (2026-08-22)

The recurring report is "some of the sources didn't work". The cause was not the
sources; it was how many were being asked.

**Android returns one search row per provider.** Opening a row binds you to the
provider that produced it, and pressing play calls `loadLinks` on that provider
alone. There is no fan-out and no torrent-indexer step at all.

This app merges search rows, and that merge is right — four providers and three
catalogues returning one film should be one row, not seven. What it lost was the
binding. `searchMerge.primacy()` makes the *catalogue* row win, so the merged row
is addressed by its `cs3meta://` URL, and `runDiscovery` took that as licence to
ask **every enabled provider and every enabled indexer**. A title carried by two
providers drew answers from two hundred sources: most had nothing, some were
slow, some were dead, and all of them appeared in the list as sources that did
not work.

`cs3/sourceScope.ts` restores the binding without undoing the merge. The
providers whose rows were merged are already recorded as `alternates`, and
`ContentService.alternateRoutes` already remembered them — they were simply being
used as *one more* input to a full fan-out rather than as the scope.

| Scope | Who is asked |
|---|---|
| `origin` (default) | Only the providers whose search results produced this row. No indexers. |
| `all` (explicit) | Every enabled provider and every enabled indexer. |

Four things are worth keeping straight:

- **A `cs3ext://` row was always right.** It is a provider's own result and has
  always resolved from that provider alone. The divergence only ever existed on
  the merged catalogue row.
- **`origin` widens on its own when there is nothing to scope to.** A title
  opened from the home screen was never searched for, so no provider claimed it.
  Narrowing to an empty set there would return zero sources for every catalogue
  item in the app, so it widens and reports `scopeUsed: 'all'` — which is what
  stops the UI offering to widen a search that already did.
- **Widening asks every provider even when routes are known.** The old condition
  skipped the provider search whenever routes existed, which was correct while
  routes were the only way to reach a provider. Under widening it makes "search
  all sources" re-ask the same two providers and appear to do nothing. Already-
  known providers are skipped per result instead, and the merged list is deduped
  on `infoHash`.
- **The scope is part of the cache key and the in-flight key.** Without that a
  widened run is answered by the scoped result that just landed.

The offer appears in two places and only when `canWiden` is true: the source
panel, and the failure overlay — which is where it matters, because the sentence
above it has just said the providers this title came from had nothing.

### …and widens itself when that provider has nothing (2026-09-02)

The section above got the scope right and left one case reading as a dead end.
Reported verbatim from a user's screen:

```
No playable sources found
HDO has no sources for this item.
Try "Find more sources" to ask the other enabled providers.
provider  HDO
address   cs3ext://HDO/{"imdbID":"tt1754656",…,"movieName":"The Little Prince"}
took      1398 ms
```

**Pressing that button found 137 sources** — five extensions (CineStream,
Moviesmod, MovieBoxProviderIN, MovieLinkBDProvider) plus The Pirate Bay and
Torrents-CSV — of which **81 of the 98 distinct HTTP links were still live when
probed** (206 or 200, mostly `video/x-matroska`). So the screen was a dead end
whose only useful action was a step the app was perfectly able to take itself.

`shouldEscalateScope` in `cs3/sourceScope.ts` is that step, and the argument for
it is narrow: `origin` scope is right *while it is paying for itself*. Its whole
value — fewer third-party sites contacted, a faster answer, no dead links from
providers that never carried the title — is a **saving on an answer nobody can
play** the moment it returns zero. So it stays narrow when it finds something and
widens when it does not.

`ContentService.escalateToAllSources` runs it, and five things about it are
load-bearing:

- **It goes through `getSources`, not `discover`.** The widened run then lands in
  the shared in-flight map under its own key, so a viewer pressing "Find more
  sources" while it runs *joins* it rather than starting a second fan-out across
  two hundred sites, and its answer lands in the `#all` cache entry so reopening
  the title is instant.
- **Two guards against recursion**, not one: `canWiden` is already false at `all`
  scope, and the nested call passes `autoWiden: false` anyway. A missing guard
  here does not produce one extra request, it produces unbounded fan-out across
  the whole provider corpus. `sourceScope.test.mts` pins each guard *in
  isolation* — the first draft asserted the scope guard only alongside
  `canWiden: false`, so removing it failed nothing.
- **A failed escalation leaves the narrow answer standing.** `fallback` is a
  thunk producing exactly what the scoped pass would have returned. Letting the
  widened run throw would replace "HDO has no sources for this item" with
  whatever the fan-out hit — and for a **links-handle** address that is
  `loadMedia`'s refusal, a sentence about a call the viewer never made. Same
  rule as the `dataUrl` retry in `extensionSources`: a rescue that makes the
  original failure worse is not one worth having.
- **The fan-out's `load(base)` is now allowed to fail when a title is already
  known.** Escalation is addressed by whatever the viewer was on, which is
  routinely a provider's links blob, and `loadMedia` refuses those by design.
  The detail is enrichment at that point; only the title is required. It still
  throws when there is no `titleOverride`, because then it is not enrichment.
  The `cs3ext://` path also refuses to escalate a links handle with no title —
  the fan-out would have nothing to search for.
- **The prefetcher passes `autoWiden: false`, and it is the only caller that
  does.** Opening a detail page is not a commitment to watch — the same reason
  that module waits `SETTLE_MS`, declines on a cache hit and runs one at a time.
  The flag defaults **on** rather than off so the six real call sites do not each
  have to opt in; the one that got forgotten would be a dead end nobody could
  see. It is part of `sourceKey`, or a prefetch that settled for the narrow empty
  answer would be joined by the play that wanted the wide one.

**The wait is explained while it happens.** `SearchProgress.widened` is stamped
on *every* event the widened run emits, not just the handover — the fan-out
builds its own progress objects, so a one-shot flag appears for a frame and is
overwritten by the next indexer answering. `PlaybackSnapshot.widened` latches it,
and the overlay, the player's source panel and the detail picker each say "no
sources where this title was found — asking every provider and indexer". Without
it the wait silently triples, which is the shape of a hang.

Afterwards `canWiden` is false, so nothing offers a button that would do nothing,
and `explainEmptyResult` takes an `escalated` flag whose only effect is to stop
the generic tail advising a step that has already been taken.

### Search scope: selecting a source is a filter, not a preference

`searchScope.ts` used to widen back to *every* source whenever the stored selection matched
nothing currently installed (`kept.length > 0 ? kept : candidates`). Combined with a picker
that could offer a name no provider actually had — it synthesised a fake provider named
after the extension whenever an extension registered none — the result was the worst
possible failure: the user picks one site, the button reads "1 source", and the app queries
all two hundred. Resolution is strict now, and an unresolvable selection is *reported*
(`missingProviders` / `missingIndexers`) rather than quietly ignored.

The rules, all enforced in `SearchSession.plan()`:

- **Nothing selected** → global: every enabled provider, plus the metadata catalogues.
- **Providers selected** → exactly those, and **no catalogues**. Catalogue rows in a scoped
  search would reintroduce the sources the user just excluded under a different name.
- **Indexers selected** → those indexers are title-searched. They normally answer at
  source-discovery time, so before this a scope of "just this torrent site" had nothing to
  ask and returned a blank page.

The hierarchy is **exactly three levels: repository → extension → provider**, and the
provider is the selectable leaf. There is no fourth entity in the CloudStream model. What
looked like duplication in the picker — `Fivemovierulz > Fivemovierulz` — was the ordinary
case of an archive registering one provider named after itself, rendered at two levels;
`SearchScopePicker` collapses that pair into one row. A provider name is globally unique by
construction (`PluginManager.providers` is a `Map` keyed by name), which is why the name is
also the scope identity, the `cs3ext://` address and the enable/disable key. Two extensions
claiming one name is a genuine collision: the first keeps it and the loser is reported via
`unavailableReason` instead of silently showing zero providers.

### The extensions screen: `src/components/extensions/`

**Reconstructed 2026-08-21**, after the ignore-rule bug below meant the 2026-08-14 rebuild
was never committed. Six of the originals — `primitives`, `FilterBar`, `BulkActionBar`,
`ProvenancePanel`, `CompatibilityReport` and `useExtensionFilters` — were restored from the
author's machine on 2026-08-22 and are now what the screen is built from; the container
(`ExtensionsScreen`), the three views and `useExtensionCatalog` are the reconstruction.
Where the two overlapped **the originals won**: `Toggle` carrying a `suppressedReason` says
something the reconstruction's plain switch could not, and `TriStateCheckbox` has an
`indeterminate` state a boolean cannot express. What follows describes the current files.

Originally rebuilt 2026-08-14. It was one 2,689-line component — 25 `useState` hooks, four tabs and
~2,000 lines of inline-styled JSX in a single function body — replaced by a container plus
focused children (`useExtensionCatalog`, `useExtensionFilters`, `FilterBar`, `SourceTree`,
`RepositoryCatalog`, `ExtensionCatalog`, `ProvenancePanel`, `BulkActionBar`,
`CompatibilityReport`, `primitives`, `extensions.css`). Every feature was kept. What changed
and why it matters:

- **Disable is not uninstall, and both now work.** `removeRepository` used to delete the URL
  and stop — the extensions it installed stayed on disk, loaded, and answering searches, so
  "remove" changed nothing observable. That was the real shape of "I can't turn off the
  default repositories". Removing now cascades to uninstall them and reports how many;
  `setRepositoryEnabled` / `setExtensionEnabled` are the reversible alternative, keeping the
  archives so re-enabling costs no downloads.
- **The enable cascade lives in `enabledProviderNames` and nowhere else.** A provider answers
  only when it, its extension, its repository and the adult gate all allow it. Every consumer
  — search, scope picker, source discovery, playback, downloads — already funnels through
  that one method, so the cascade is enforced once. `getProviderTree` recomputes the same
  predicate as `effectivelyEnabled`; **if those two ever disagree the screen is lying about
  what a search will ask.**
- **`enabled` and `effectivelyEnabled` are deliberately separate** on every tree node.
  Collapsing them loses the information the user needs: a provider greyed out because its
  repository is off must not look like one they turned off themselves, or clicking its toggle
  appears to do nothing. The UI shows the responsible ancestor instead.
- **Tag filters are multi-select and derived from the data.** The old filter was a single
  `<select>` with three hardcoded options (Movies/TV/Anime), which could not express "anime
  or series" and silently omitted every other `TvType` — `NSFW`, `Live`, `Documentary`,
  `AsianDrama`, `Cartoon` and the rest. Facets are now counted from what is installed, so a
  tag with nothing behind it cannot be offered and a tag that exists cannot be hidden.
  Semantics: **OR within a facet, AND across facets** — anything else feels broken.
- **The Providers tab is gone.** It was a flattened re-listing of the tree's leaves with its
  own filter and selection state, so toggling a provider in one view did not update the
  other. Three tabs now split by *question*: what do I have (Sources), what could I add
  (Repositories), what do the repositories offer (Extensions).
- **Progress is real.** `onExtensionInstallProgress` existed and was ignored in favour of a
  scripted `setTimeout` sequence — "Translating DEX bytecode to JVM…" for 250 ms whether or
  not that was happening — which added ~500 ms of invented delay to every action.
- **Provenance is on the row, not buried.** Every repository, extension and provider can show
  its `repository ▸ extension ▸ provider` chain, maintainers, version, declared content
  types, origin URL and hash. A provider row previously showed a name and a toggle, so a
  provider that returned nothing could not be traced to whose code or whose repository.

**`SearchScopePicker` filters on `effectivelyEnabled`, not `enabled`**, and must keep doing
so. It was the one consumer outside the extensions screen that read the provider's own switch
directly; once repository-level disabling existed, that would have offered a provider the
main process is going to drop — selecting it searches nothing and reports itself through
`missingProviders`. Same class of failure as the widen-back bug above, from the other
direction. Anything new that reads the tree to decide what may be searched has the same
obligation.

### Sources are found while the page is being read

Pressing Play used to begin a fifteen-provider scrape from cold. Meanwhile the viewer had
been on the detail page for several seconds reading the plot — the exact window the work
could have run in. `cs3/sourcePrefetcher.ts` uses it: a moment after a detail page settles,
it runs the same discovery Play would, and the results land in `SourceCache` where Play
finds them.

**The in-flight sharing is what makes this safe rather than harmful**, and it is the reason
`sharedDiscovery.ts` exists as its own module. Warming the cache only helps if pressing Play
a second later *joins* the running discovery; without that it would start a second identical
scrape beside the first, doubling the load on every community site involved and arriving no
sooner. Two rules in there are load-bearing:

- **Cancellation is by consensus.** Each caller brings its own `AbortSignal` and the work
  stops only when *every* caller has withdrawn. Otherwise closing the detail page — which
  happens immediately after Play — would cancel the discovery the player just joined.
- **An aborted run is never joined.** It stays in the map until its promise settles, and
  handing it to a new caller would return a cancelled result.

Both are covered by `sharedDiscovery.test.mts`, along with late-joiner progress replay and
the refresh rule (a cache-bypassing caller may not be served by a run that might have
answered from cache; the reverse is fine).

The prefetch itself is deliberately restrained, because opening a detail page is not a
commitment to watch and speculative traffic is the fastest way to get an IP blocked by a
scraper target:

- nothing runs until the page has been open ~1.2s, so paging through six titles fires zero
  scrapes rather than six;
- nothing runs when `hasFreshSources` says the cache can already answer — a `peek`, so the
  check neither writes nor promotes the entry;
- one at a time, a new target superseding the old;
- and it can be switched off, with the cost stated, for metered connections.

The detail page shows the state on the artwork ("3 sources ready", "Finding sources…"),
because invisible work is indistinguishable from no work — nobody expects Play to be instant
unless something says so. `waiting` and `idle` deliberately render nothing: announcing the
settle delay would put a badge on every title someone merely glanced at.

Reuse and expiry are `SourceCache`'s existing behaviour, not a second policy: magnets never
expire, provider links carry the deadline in their URL or a short TTL, and a partially stale
entry serves its good half.

### The mini player: the `<video>` element is never remounted

Minimising is a **geometry change to an element that stays mounted** — the same node, in the
same place in the tree, with `player--mini` and an inline position. That is not an
implementation detail. The `<video>` *is* the playback: unmount it and the stream stops, the
position is lost and the swarm is renegotiated. Anything that recreates the element to change
its size has broken the feature it was trying to add.

What that buys, and what it costs:

- **Full chrome is hidden with CSS, not conditionally rendered.** Unmounting the controls
  would unmount their state — open panels, scroll positions, the source list — and restoring
  the player would drop all of it. The mini window gets its own much smaller control set,
  because at 420px the real seek bar and eleven buttons are unusable.
- **Keyboard shortcuts are disarmed in mini exactly as in hidden**, and it matters *more*
  here: the window is visible, so it looks focused, while the whole point is that the viewer
  is typing somewhere else. A space bar in the search box must not pause the film.
- **The drag/resize gesture is owned rather than delegated to `resize: both`**, which cannot
  hold an aspect ratio and puts its handle in the bottom-right corner — precisely where a
  window parked in the corner of the screen is against the edge. The resize handle is
  top-left for that reason. See `useMiniFrame`, which also clamps on window resize: a player
  parked at the right edge of a maximised window is unreachable once it is restored, because
  the part that has gone off screen is the drag handle.

`MiniPlayerBar` remains for the `hidden` state, but every path in the app now minimises
instead. Stepping out to Downloads used to blank the video and leave a bar saying it was
still playing, which is a strange thing to tell someone about a film they were watching a
second ago.

### The home screen is discovered, not hardcoded

It ran three fixed searches — `Spider-Man`, `One Piece`, `Stranger Things` — against every
installed provider and called the result "Trending". The obvious problem is that the front
page never changed. The real one is that **a site scraper has no opinion about what is
popular**, so the label was a category error, and it cost the slowest scraper's timeout on
every launch.

`cs3/discovery.ts` answers from catalogue services instead. The binding constraint was that
**the user must not have to obtain an API key**, which eliminated TMDB, Trakt, OMDb, Fanart
and TheTVDB outright — a key embedded in a distributed client is both a licence violation and
a key that gets revoked. What survives:

- `cinemeta-catalogs.strem.io/{top,year,imdbRating}/catalog/{movie,series}/…` — keyless,
  IMDb-keyed, filterable by 19 genres, pageable with `skip`. Its popularity numbers come from
  Trakt and TMDB, so the ordering reflects the same signal the keyed services sell.
- AniList's public GraphQL for seasonal anime. Kept separate from the Animation genre on
  purpose: "Animation" on IMDb is mostly Western film, and an anime row built from it returns
  Pixar.

Two behaviours are load-bearing. **Stale-while-revalidate, with the "while" doing the work**:
cached sections render instantly and are replaced a second later, so the page never shows a
spinner after the first launch and still works offline. And **discovery finds nothing
playable** — items are addressed by IMDb id and sources are resolved by the providers when
one is opened. Keeping that boundary is what lets the page be fast and current at once.

Personalised rows come from genres counted out of the local library. Nothing about the user
leaves the machine: the genre picks which public catalogue URL to fetch, and the catalogue is
not told who asked.

### Search scope: why it looked empty until you searched

The picker only fetched when the menu opened, and that fetch loaded **every installed
extension into the sidecar first** — minutes of DEX translation on a bootstrapped install,
with nothing on screen saying so. Users opened it, saw nothing, closed it, ran a search, and
found it populated afterwards. Searching appeared to be the fix because it awaited the very
same load.

Two calls now, and the split is the fix: `getSearchScopeOptions(false)` on mount answers
instantly from whatever is already registered, and `getSearchScopeOptions(true)` on open pays
the cost with a menu on screen to show progress in. `PluginManager` emits
`extension:providerLoadProgress` per archive, so the tree fills in as the pass runs instead of
appearing all at once at the end.

The picker also gained facets — content type, language, and extensions-vs-torrents — derived
from what is installed, counted rather than listed, with **OR within a facet and AND across
facets**. Same rule as the extensions screen; anything else reads as broken.

### Provider ranking: measured, arguable, and never silently punitive

`providerAnalytics` counts, `providerRanking` scores, `providerRecommendations` advises. Four
rules keep it honest:

1. **`empty` is not `failure`.** An anime provider with nothing for *Dune* is behaving
   correctly. Merging them would rank by catalogue breadth and bury every specialist.
2. **Smoothing toward a neutral prior**, or the ranking is self-fulfilling: a provider that
   answered its single search scores 100%, sorts above one with 95% over four hundred calls,
   gets asked first, and stays there.
3. **A criterion with no data is excluded from the denominator**, never scored zero.
4. **Nothing is ever auto-disabled.** Auto-*enable* is opt-in and gated on score *and* sample
   count; a site being down for a week is not consent to remove a source the user picked.

The settings panel shows every number, every criterion's sample count, and the erase button,
because a system that reorders results on evidence nobody can see is one users learn to
distrust the first time it is wrong — and with hundreds of third-party scrapers it will
sometimes be wrong.

### Floating playback: three mechanisms, not one setting (2026-08-31)

Minimising meant one thing — a small window inside the app — which stops being
useful the moment CloudStream is not the front window, which is exactly when
someone minimises a film. There are four modes now (`mini`, `floating`, `pip`,
`background`) and they are a **choice rather than a scale**, because they use
different mechanisms with different reach:

| Mechanism | Moves | Works when |
|---|---|---|
| In-app mini window | nothing — a CSS geometry change | always, while this app is the front window |
| Native Picture-in-Picture | the `<video>` element's rendering surface, to an OS window | only while the element is what is playing |
| App window always-on-top | a window level | always, whatever is inside the window |
| mpv `ontop` | a window level | only while the native engine holds the stream |

**The middle row is why this is not simply "pin the window".** PiP is what people
mean by "like Chrome" — a real OS window with the system's own controls,
resizable, above full-screen applications. It is also unavailable for exactly
the content this app most often plays: a stream routed to mpv renders in mpv's
window and a handoff to VLC renders in VLC's, and neither has an element to
detach. So PiP is offered where it can work (`isPipSupported` checks the
document, the element's `readyState` **and** that the native engine is not
holding the stream) and the window pin is what makes the feature exist for a
torrent stream or a 4K HEVC file.

Things that will bite:

- **The element is never remounted, in any mode.** Same rule as the in-app mini
  player and the same reason: recreating it ends the stream, loses the position
  and renegotiates the swarm. Audio-only hides the picture with `visibility`
  rather than `display`, because an element removed from layout loses its
  surface and some builds treat that as a reason to stop decoding — which would
  silence the audio the mode exists to keep.
- **The pin unapplies itself on unmount.** Leaving the app above every other
  window after the player closed is invisible, survives navigation, and is
  undone only by a control inside a player that no longer exists.
- **`audio-only` is asymmetric and says so.** On the native engine it sets
  `vid=no` and genuinely stops decoding — real work saved on a 4K file. On the
  element there is nothing equivalent: an offscreen element keeps decoding what
  it was given, and re-negotiating the source to a track-less stream would be a
  far larger change than the setting is worth. The setting's own help text
  states this rather than implying a saving that is not there.
- **The Media Session record is set, or a PiP window's own buttons are dead
  chrome.** A native PiP window draws play/pause and next/previous and wires
  them to `navigator.mediaSession` action handlers; the OS uses the same record
  for the keyboard's media keys. They are wired to the same `togglePlay` /
  `seekTo` the on-screen controls use, so two sets of controls cannot disagree
  about whether the film is paused.
- **PiP is asked for, never assumed.** `requestPictureInPicture` rejects for
  several ordinary reasons — no metadata yet, no gesture, a platform without it
  — and every one of them looks identical from outside: a button that does
  nothing. The rejection is reported as a sentence.

The mini player also gained a real scrubber on its own row, a volume slider and
the provider name. A mini window is where a source is most likely to fail
unattended, and "it stopped" is only actionable if the row says whose it was.

### Downloads: the state machine, and why 100% was not "done"

**aria2 says `complete`, not `completed`.** `Aria2Progress.status` declared the latter and
`getStatus` passes `raw.status` straight through, so the comparison in `pollAria2Tasks`
could never be true. Every finished aria2 transfer sat at 100% in `Downloading` for the life
of the session, and its gid was never released, so the poller kept asking about it forever.
Verified against a live aria2 daemon: `tellStatus` answers `"active"`, then `"complete"`.
`removed` and `paused` were unhandled too — each a second way for a task to stick with no
poll left that could change it.

**Completion is now verified rather than reported.** All three engines route through
`finalizeCompletion`, because "the engine finished" and "there is a playable file" are
different claims and a download list that reports the second knowing only the first is
worthless. It requires: the target exists, no unfinalised `.part` remains beside it, and the
size agrees with expectations where any exist — 1% tolerance, since plenty of sources send
no `Content-Length` and a strict test would fail every one of them. Anything else is
`Failed` **with the reason**, which is retryable.

**Delete is two actions.** `remove(id, deleteFile)` — removing a finished film from the list
and erasing it from disk are unrecoverably different, so the caller decides and
`DeleteDownloadDialog` asks. The "remember my choice" box is off by default (a preference
learned from one click is one nobody knows they set) and Settings → Downloads can put the
prompt back, because a preference settable only inside a dialog you opted out of seeing
cannot otherwise be undone.

### A download is addressed by its source variant, not by its title

Reported as: downloading *The Incredible Hulk* in 2160p and then asking for the 1080p
release answered `Already downloading` and did nothing. Two independent mistakes about
identity sat underneath it, and each would have been enough on its own.

**Duplicate detection matched on the title, by prefix.** `VideoPlayer`'s `currentDownload`
did `norm(t.title).startsWith(norm(title))`, plus a shared `mediaUrl` and a substring test
on the task id. Every release of one film satisfies all three, so a viewer could hold
exactly one copy of a title no matter which source produced it — and the progress badge in
the player showed whichever transfer happened to be first in the queue.

**And the target path was derived from the title too**, so allowing two to start would
merely have moved the collision onto the disk: `Movies/The Incredible Hulk/The Incredible
Hulk.mp4` for both, two engines interleaving bytes into one file, and both reporting
success. A corrupt file that finishes is worse than a refusal.

`src/utils/downloadIdentity.ts` owns the rule, and it is pure and tested because both
halves fail *silently* and in opposite directions:

| Too coarse | Too fine |
|---|---|
| The 1080p release is refused as a duplicate of the 2160p one | Every recovery starts a second download of bytes already on disk |
| Visible, and reads as a broken button | Invisible, and reads as working |

**The key has to be durable, not merely unique** — which is the same problem
`cs3/playedSource.ts` solves for resuming, and it is solved the same way. A provider
stream's `infoHash` is *synthesised* by `ContentService` from its URL, so a re-resolved link
is a different id for a byte-identical file; keying on it produces the right-hand column
above. So torrents key on their real infohash and everything else keys on the durable
description: media + season + episode + provider + release name + resolution + quality +
language + audio.

Four things follow, and each is load-bearing:

- **The provider is stored, not the extractor.** `indexerName` on an extension link is the
  file host the provider picked ("Voe", "Server 3") and it changes between resolves of one
  release. Two of the four call sites that built tasks stored it as `providerName` and two
  stored the provider — which is also why `findMatchingSource`'s tier-1 match so often
  missed.
- **Recovery matches the variant key first, and is resolution-bound after that.** Its last
  tier used to `return directSources[0]` unconditionally, so a failed 2160p download could
  be silently rebound to an unrelated 480p rip, written into the folder labelled 2160p and
  reported as complete. A task that finds nothing of its own resolution is now left
  `Failed` with its reason.
- **The target path carries the variant** (`Movies/<Title>/2160p · WEB-DL · Gdshine/…`).
  `variantPathSegment` keeps it readable — this is a folder a person opens — so it can
  collide between two releases from one provider at one resolution; `DownloadService`
  resolves that at enqueue time with a numbered suffix, because only it can see the rest of
  the queue.
- **The batch downloader stamped its batch id into `providerName`** (`Gdshine
  (batch-1755…)`). Nothing read it, and two things that do read that field broke: recovery
  never matched a provider, and the identity changed on every run — so re-running a season
  queued a second copy of every episode already in it.

### A partial download has to be *proved* to match before it resumes (2026-08-31)

Provider links are signed and short-lived, so a 4 GB film routinely outlives the
URL serving it. `DownloadService` re-resolves the release and gets a different
address for what is usually the same content — and then has to decide whether
the partial file beside it is still the beginning of what that address will
send.

The old answer compared the provider's *declared* size against the task's and
restarted when they differed by more than 20%. Both halves are wrong and they
compound:

- Declared sizes are frequently absent, and with none **the check did not run at
  all** — the partial was appended to unconditionally.
- **20% is enormous.** Two encodes of one film at one resolution differ by far
  less, so appending the tail of encode B to the head of encode A produced a
  file that finalised, reported success, and did not play. A corrupt download
  that completes is worse than one that restarts, because nothing says it
  happened; the viewer finds out when they sit down to watch.

It is proved now. **One ranged request for the 64 KB window ending at the resume
point answers all three questions at once**: `206` proves the server honours
Range, `Content-Range: …/total` gives the real file length, and the body
compares byte for byte against the tail of the `.part`. That is 64 KB against a
multi-gigabyte transfer, and it turns "these look similar" into "these are the
same file up to this offset".

`download/resumePlan.ts` is the decision and is pure. Ordered cheapest-first:
identity (provider, resolution, container) before anything that costs a request,
then exact size equality, then Range support, then the byte comparison. Notes:

- **`sameResolution` reads `parsed.resolution`**, matching `findMatchingSource`.
  A resolution the release name did not state is "no opinion" — most direct
  provider links carry no release name, and treating that as a difference would
  refuse every resume.
- **`containersAgree` only ever rejects on positive disagreement.** Most provider
  links are `?id=…` with no extension, and a container check that refused those
  would refuse nearly every resume — which is how a safety check comes to be
  switched off wholesale.
- **`no-range` is its own cause.** It is the one restart where nothing is wrong
  with either file, and the honest thing to say is that this server sends the
  whole file every time. Checked *after* the size arithmetic, so a real mismatch
  gets the message it deserves.
- **An unreadable window restarts.** A failed comparison is not evidence of a
  match; defaulting it to `true` would put the corruption back with a safety
  check standing in front of it.

`download/resumeWindow.ts` is the socket half, tested against real servers
because everything worth catching lives in the seam. **The `res.resume()` trap
appears here for the third time in this repository** — it discards data and
leaves the transfer running — so both the response and the request are
destroyed. That regression test is verified by mutation, and its first draft was
worthless: it asserted the probe *resolved* quickly, which is true with the bug
present. It asserts the connection tears down now.

Only `restart` is acted on in `markFailed`. `resume` is the default (every engine
continues from a `.part`) and `complete` is carried by machinery that already
exists — the transfer asks for `bytes=N-`, the server answers `416`, and
`httpDownloader` finalises rather than erroring; aria2 routes its own range
errors to that same downloader. Adding a rename there would bypass
`finalizeCompletion`, which is the only thing that checks the file is present and
the right size before claiming success.

### Pressing Download is a request, not a command

The other half of the same report. Every press on a title with any entry in the list
answered `Already downloading`, including when that entry was paused (left paused), had
failed (told to go and find the download panel), or had had its file deleted.

`download:request` → `DownloadService.request` answers from the task's actual state and
returns which of six things it did, so the renderer no longer phrases the outcome from a
list it matched itself:

| State | What a press does |
|---|---|
| `Downloading` / `Retrying` / `RefreshingSource` | nothing, and says so |
| `Queued` | nothing; says it starts when a slot frees |
| `Paused` — including every task after a restart, which `loadQueueFromStorage` parks there | resumes |
| `Failed` | recovers: clears the retry budget, re-resolves the source, retries |
| `Completed` | reports it — **after checking the file is still there**, and re-downloading if it is not |
| nothing yet | starts one |

`Completed` is checked against the filesystem rather than trusted because it is a claim
about a file: a download whose file the viewer has since deleted or moved must be startable
again, and reporting it as finished leaves the only useful action unavailable with the
reason invisible.

### The player: three bugs that all looked like "nothing happened"

**`onRefresh` was `() => {}` on two of three player mount points.** Only the live
`PlaybackSession` path had a working "Search again"; the path taken after picking a source
from the detail page rendered the button and wired it to nothing — which reads as "the
search found nothing new" rather than as a dead control. It now runs a real cache-bypassing
discovery whose results stream into the open list, and reports when one cannot start.

**Two sources could both show "Playing".** `isActive` compared `infoHash`, which for a
provider stream is *synthetic* — the SHA-1 of its URL. Two extensions scraping the same file
host produce the same id, so every copy lit up. Only the first match is marked now, and the
React key is disambiguated so duplicates do not collapse into one row either.

**Volume, mute, speed and track languages persist**, across media and restarts. Languages,
never indices: audio track 2 is the Hindi dub on one release and the director's commentary
on the next, so restoring an index would confidently select the wrong thing. The load is
applied through the same ref the attach effect reads, or a source that attaches before the
preference arrives spends its first seconds at full volume.

### Volume had two writers and no rule (2026-08-29)

Reported as: the volume slider is flaky, and past a certain point in mpv the player
crashes. Two distinct defects with one shared cause — volume is the only control in this
app that is written from **both** ends, and nothing said which end wins.

**The crash is a range contract nobody was enforcing.** The player holds volume as a
fraction of unity because that is what `HTMLMediaElement.volume` takes. Both other engines
speak percentages and both can exceed unity from their *own* UI: mpv defaults
`volume-max` to 130, and its OSC slider and the `add volume 5` bindings we install both
walk past 100; VLC reports up to **512** on its 0–256 scale. That level arrived on a
snapshot, was divided by 100 into something greater than 1, and was assigned to
`video.volume` — whose setter throws `IndexSizeError` outside [0,1]. Thrown from inside a
`useEffect`, that unmounts the player. "Turn it up past a point and it crashes."

Fixed at the source in both engines rather than only at the element: mpv is launched with
`--volume-max=100` and VLC's reported level is capped, so the two windows agree on what
100% means — an OSC showing 120% beside a bar showing 100% is the next bug. `clampVolume`
in `VideoPlayer` and in `mpvEngine` is the second line, kept because the element's
contract is not something to be defensive about only where we remembered.

**The flakiness is the echo, and it needs two rules, not one.** Every push to an engine
comes back as an observed property change. Neither rule alone is enough:

- **A time window** (`AUDIO_ECHO_MS`, 700 ms): while a locally-made change is settling,
  incoming audio values are ignored. Without it, snapshots describing the volume from
  *before* the drag still in progress arrive and yank the slider backwards under the
  cursor.
- **A value record** (`engineAudio`): a level that came *from* an engine is never sent
  back *to* it. Without it, adopting mpv's level immediately re-derives a push of that
  same level — by then several steps behind where the viewer has dragged mpv's own knob,
  so our echo drags it backwards.

`engineAudio` is cleared whenever the engine changes, or the suppression would skip the
one push that matters — the first to a player that has never been told anything.

### External players are driven, where driving them is possible

The requirement is that transport controls keep working after a handoff. What is actually
possible is not uniform, and `externalPlayerControl.ts` declares it per player rather than
pretending:

| Player | Channel | Capability |
|---|---|---|
| mpv | JSON IPC — routed through `MpvEngine` | `full` |
| VLC | its built-in HTTP interface | `full` |
| MPC-HC/BE | web UI, **off unless the user enabled it**, no launch switch | `none` |
| PotPlayer, IINA, Celluloid, SMPlayer | none | `none` |

VLC is launched with `--extraintf http` on an OS-assigned loopback port behind a
per-session password — that interface is unauthenticated by default, and binding it without
one would hand playback control to anything else on the machine.

**Capability can downgrade at runtime.** A VLC built without its HTTP module launches, plays
perfectly, and answers no request; after a grace period the snapshot reports `none` and the
UI stops offering controls that cannot work. A seek bar that silently does nothing is worse
than one the viewer was told about — that is the whole reason this is declared rather than
assumed.

`transport` in `VideoPlayer` is the single derived answer to "who is holding this stream?" —
element, native engine, or external — and every control reads it. Volume/mute/speed are
applied to *all* engines rather than only the active one, so a handoff to VLC and back does
not restore the volume to 100%.

### Probes are remembered; verdicts are not

`media/inspectionStore.ts` persists what ffprobe found, keyed on the **origin** URL — never
the proxied one, whose port and token are minted per session and would miss on every restart
while looking like they should hit.

The split is the point. A **measurement** (container, codecs, bit depth, track list) is a
fact about the file and never changes. A **verdict** is a function of that measurement *and*
this machine: the renderer's decoders, whether a GPU encoder exists, whether mpv is
installed, which routing policy is set. So only the measurement is stored and
`decideStrategy` runs again every time. Caching the verdict would be the stale-cache bug in
its most expensive form — install mpv, and every previously-played title keeps re-encoding
because a record from last week says so.

Query strings are deliberately **not** stripped to normalise signed URLs: two films behind
one path template would then be served each other's codec lists. A signed URL simply misses
and is re-probed.

Measured: 97 ms saved on a local multi-track MKV, and the probe was 1.6–1.7 s per source
against real provider streams in the vendor matrix — which is where it actually pays.

### The library remembers which source actually played

The library remembered *what* was watched and `bookmarkStore` remembered *which page* it
came from. Neither remembered **which of thirty sources delivered it**, so returning to a
title meant picking from the list again with nothing recording that the fourth row down is
the only one that ever produced a frame.

`PlayedSource` (in `src/types/library.ts`, stored by `libraryStore`) is one slot per
(title, season, episode) — per episode, because keying on the title alone would have episode
6 overwrite what played episode 5. It holds the full `StoredSource` (provider, repository,
extension, quality, capabilities, the link and its deadline) plus an `origin` query.

**The link is stored but is never the identity.** A provider URL is a signed address on
someone else's CDN, good for minutes; the durable half is `origin`, which is replayed to get
a fresh link for the same release. That is why both are there.

**It is recorded on playback, not on selection.** `SourceMemory` already covers "what the
viewer picked", and the two are different claims — a release chosen and then abandoned
because it would not start is not one that works. `VideoPlayer` records after **10 seconds**
of real playback, which is past every failure that presents as "it started and then stopped".

`library:resolvePlayedSource` returns one of three outcomes, and the caller is told which
because they mean different things:

- `reused` — the stored link still holds; no provider contacted.
- `refreshed` — it had expired, so the same release was re-resolved and the record updated
  in place. Surfaced in the UI, because it explains the pause the viewer just sat through.
- `unavailable` — the provider no longer offers it. The record is **marked, not deleted**
  ("the one that used to work is gone" beats an entry that silently vanishes) and the
  alternatives come back so it is a choice rather than a dead end.

#### Matching a saved source after its link dies

`cs3/playedSource.ts`, and the reason it is its own tested module: **a provider source has
no durable id.** Torrents do — an infohash addresses content. A provider stream's
`infoHash` is *synthesised* by `ContentService` as the SHA-1 of its URL, purely so the
ranker and the dedupe key have something to work with. Re-resolve that release an hour later,
get a freshly signed URL, and the id is different for the identical file. **Matching on it
alone can never re-find a provider source, which is the case this feature exists for.**

So: torrents match on infohash; everything else matches on the durable triple — provider,
normalised release name, resolution. Strict on purpose, because returning the wrong release
is worse than returning nothing: the viewer asked to resume *this* stream, and quietly
starting a different cut, dub or a 480p rip is a failure they will attribute to the app
losing their place. The one concession is containment in either direction, since providers
append and drop decorations (a size, a mirror name, `[Dual Audio]`) between refreshes.

A direct link with **no recorded deadline is treated as expired**, deliberately. The costs
are asymmetric: guessing "still good" spends the ffmpeg startup and the player's timeout
before failing over, while guessing "expired" costs one provider call and produces a stream
that works.

Pinned by `cs3/playedSource.test.mts` (12 cases), including that a provider source is
re-found despite its synthetic id changing, and that nothing matching returns null rather
than a nearby release.

### A source list has to say where it came from, and hand over its link

The in-player list and the detail page both showed a release name, a size, a
seeder count and `indexerName`. For an extension link **`indexerName` is the
extractor** — "Gdshine", "Voe", "Server 3" — a file host the provider picked. It
is not the provider, so a source that started failing could not be traced to
whose code or whose repository to turn off, which is the only action a user can
actually take. Both lists now carry the `repository ▸ extension ▸ provider`
chain beside the host, resolved through `api:getProviderProvenanceMap` — batched
because a thirty-row list asking one at a time is thirty IPC round trips to read
one in-memory Map.

`src/utils/sourceExport.ts` is the shared format, used by the in-player panel,
the detail page and the player's copy menu. **CSV is the default**: the useful
operation on thirty sources is sorting and filtering them, and every machine
already has something that does that. Text and links-only are the other two
destinations — a chat window, and a downloader that wants one URL per line.

**The exported address is always the provider's, never the loopback one.** By
the time a stream is playing its URL is `http://127.0.0.1:<ephemeral>/…`, which
names our own proxy and is dead when the app closes — a link that *looks* like
it should work in a downloader and cannot. `sourceAddress` is the only way to
get it, and `sourceExport.test.mts` (13 cases) pins that along with RFC 4180
quoting, which matters more than it looks: a release called `Dune, Part Two`
does not break an unquoted CSV, it silently shifts every later column by one and
produces a spreadsheet of plausible rows with every link attributed to the wrong
provider.

### Playback failure is one surface, and it offers a download

There were two overlays, and they stacked. `NativeEngineStage` rendered its own
full-bleed `.player__overlay` on an mpv failure **and** reported the same failure
through `onError`, so `VideoPlayer` rendered its error overlay as well — two
translucent black panels, each dimming the other, with two different sentences
about one failure legible through each other. Both also sat under `.native-stage`
(`z-index: 3`) while carrying no `z-index` of their own, so on the engine that
fails most interestingly neither could be read at all.

`player/PlaybackErrorPanel.tsx` is the single owner now; the engine reports and
the player renders. `.player__overlay` is `z-index: 4` — chosen against its
neighbours, not for headroom: above `.native-stage` (3), below `.player__top` (5)
so Back stays reachable, and below `.player-panel` (7) so "Choose another source"
opens the list *over* the error that offered it.

**The first action is Download, deliberately.** Decoding and fetching are
different capabilities: a 10-bit HEVC file with Dolby audio can be undecodable
here and completely ordinary to download, and every report of "it will not play"
from a source that would have downloaded fine was a dead end the app put there
itself. Offered only when the source is alive — `describeUnreadableSource`
reporting `dead` suppresses the download, the external players and everything
else that cannot help a 404.

### Four messages that positioned themselves independently

`.player__external-banner` at `top: 4.5rem`, `.player__audio-notice` at
`top: 4.2rem`, `.player__strategy-note` at `bottom: 5.5rem`, `.player__toasts` at
`bottom: 6.5rem` — four absolutely positioned boxes, none of them opaque. Any two
that were true at once overlapped and rendered *through each other*. They can
genuinely co-occur (a stream being converted, on a machine missing the components
that would convert it, while a download finishes), so suppressing one was never
the answer. They are two flow columns now — `.player__messages--top` and
`--bottom` — and the stack carries the blur. `pointer-events: none` on the stack
with `auto` on each child keeps the gaps click-through; the stack spans the width
of the player and would otherwise swallow clicks on the picture.

### The native stage drew a control bar nobody could click

`NativeEngineStage` had a full transport row along its bottom edge: play, seek,
volume, mute, track menus, fullscreen. Every one of those except the track menus
was a duplicate — `VideoPlayer`'s own bar already routes `togglePlay`, `seekTo`
and volume to mpv. And the duplicate was **unreachable**: `.player__controls` is
`z-index: 5` and pinned to the bottom, the stage is `z-index: 3`, so the row sat
underneath it receiving no clicks at all. Its overflow is also what produced the
reported horizontal scrollbar with nothing to scroll to.

Two flexbox faults were behind that overflow, and both are the same trap:
`.native-stage__surface` had `flex: 1` with the default `min-height: auto`, so it
refused to shrink below its own text and pushed the control row off the bottom of
the player; `.native-stage__seek` had `flex: 1` with `min-width: auto`, so the
range input's intrinsic width forced the row wider than the player. **A flex item
does not shrink below its content unless you say so.**

What is left in the stage is what the player's bar genuinely cannot do — mpv
track selection and fullscreening mpv's own window — sitting in the surface where
nothing covers it. Transport state now flows the other way: `onPausedChange`
reports the engine's own `paused` up, because the play button reads the
`<video>` element's events and those never fire here. It showed "Play" over a
film that was playing, and the first press paused it. Buffering is deliberately
*not* forwarded into `isBuffering` — that flag drives an overlay reading
"Buffering from peers…", which is a torrent's story and a lie about an HTTP
stream.

### The native provider lane, and why the jar lane stopped being the answer (2026-09-07)

Two findings from re-counting the ecosystem, and the second is the one that changes strategy.

**The cross-platform jar lane collapsed.** PRD-43 measured 110 of 918 extensions publishing
`jarUrl` on 2026-09-03 — 12.0%. Four days later, re-measured across all 36 catalogued
repositories following every `pluginLists` entry:

```
958 extensions · 18 publishing jarUrl (1.9%)
still on the lane: saimuelrepo 10/10 · recloudstream/extensions 5/5
                   reflex_repo 1/2 · xr3ed 1/191 · gizlikeyif 1/111
```

`phisher` went from 47 jars to **0 of 81** and `xr3ed` from 46 to 1 of 191 — verified by
reading the published `plugins.json` directly: the entries no longer carry `jarUrl`,
`jarHash` or `jarFileSize` at all. The lane still works and `chooseArtifact` still prefers a
jar where one exists; what changed is that almost nothing publishes one. **Do not plan work
on the assumption that the corpus is moving onto it.**

**And the uncatalogued `.cs3` tail is not worth taking.** 122 CloudStream repositories on
GitHub are not in `official_repositories.json`; 21 of 32 probed have live indexes carrying
1,158 extensions, of which **19 publish a jar (1.6%)** and three of the four largest are
majority-NSFW (`7Escanor/BlackHole` 182/182, `vigarepo2` 190/437, `gameras1010-afk` 116/291).
One trap worth naming: `Wiojelt/TurkSinema` reports `Documentary:56` across 56 extensions —
every extension declaring every type. **A declared `tvType` is a manifest default, not
coverage**, and any count taken from that field will be inflated by exactly this pattern.

So the effort went where the sources actually are, and that turned out to be one gap:

> **There was no native searchable provider lane.** `HomeProvider` supplies catalogue rows
> and has no `search`, `load` or `loadLinks`; everything playable is a `.cs3` addressed
> `cs3ext://` and run in the JVM. Every source that is not an Android archive — Internet
> Archive, iptv-org, PeerTube, a Jellyfin server — was unreachable, and all for the same
> reason.

`cs3/nativeProviderRegistry.ts` plus `cs3/nativeProviders/` closes it. **This is deliberately
not PRD-41's L2**: `.csx` is a user-installable, sandboxed, signed bundle format for
third-party code, and that is a large piece of work. This is the other half — code that ships
inside the app and is reviewed like any other module, so it needs no sandbox, no signing and
no capability model. When `.csx` lands it produces the same values this does.

Seven rules, each answering a failure already on record:

- **Addressed `cs3native://<id>/<handle>`, never `cs3ext://`.**
  `explainMissingProvider` resolves an unknown `cs3ext://` name against the extension tables
  and reports which extension owned it — for a module compiled into the binary that is the
  wrong-attribution failure that method exists to prevent. `NativeProviderRegistry.explain`
  is the native counterpart.
- **They funnel through the enable cascade.** `enabledProviderNames()` on the registry
  mirrors `PluginManager`'s, reads the same `cs3_adult_content_enabled` key, and stores its
  exceptions through the same `DisabledSet`. A lane registering providers anywhere else
  re-opens the adult gate *and* the disable switch at once.
- **They share the `providers` scope dimension rather than getting a third axis.** A native
  and an extension provider are the same thing to everything downstream — a named source,
  scoped by name, enabled by name. What differs is only who to ask, which is one partition in
  `SearchSession.runProviders`.
- **`loadLinks` returns `ExtractorLink`.** Not a new shape; `providerLinks.ts`, the
  compatibility engine, `MediaProxy`, mpv routing and the download identity all already read
  it.
- **Failure is a reason, never a bare empty list**, classified through the shared
  `classifyFailure` taxonomy so these group with everything else in the issue ledger.
- **`nativeSources` does not escalate to a full fan-out when empty.** `shouldEscalateScope`
  is right for an extension that has never heard of a title; here the address *names* an item
  in that provider's own catalogue, so empty means that item is unplayable — which two
  hundred third-party sites cannot fix and would misreport as the title being unavailable.
- **The detail route is checked before `plugins.loadMedia`**, which answers `null` for an
  address it does not know — and that null becomes "nothing knows how to open this address"
  for every native row.

Two things measured while building Internet Archive that would each have shipped as a bug:

- **Search must be `title:("<query>")`.** The endpoint ORs bare terms across every field and
  `sort=downloads desc` floats whatever is popular: bare `apollo 11` answers *Experiments in
  the Revival of Organisms*, bare `night of the living dead` answers *Unus Annus*. The phrase
  form is right on all five test titles; the bare form is wrong on three.
- **A sort key is mandatory and `format:(MPEG4)` is a quality gate.** An empty `sort[]`
  returns an *empty result set* rather than an error — indistinguishable from "no such film".
  Ungated, the top documentary by downloads is a 3 MB test clip titled *Sample 1* with 1.25M
  downloads.

`bun run test:native-providers` (50 cases) pins all of it, and is verified by mutation:
bypassing the enable cascade fails three. One of those three was rewritten after the
mutation check — asserting "the result was empty" passed with the cascade removed, because a
*failing* provider also returns empty, so it asserts the socket was never touched instead.

**Any Stremio addon is a provider now**, which is the part of this that keeps paying: what is
supported is the protocol, so an addon published next year needs no adapter. Measured across
`api.strem.io/addonscollection.json` (95 addons) by resource: **subtitles 42 · catalog 40 ·
meta 23 · stream 19**. Read that table against what the app consumed before — `catalog` on the
home screen only, `stream` in the indexer registry, no `meta`, and `subtitles` from one
hardcoded host. The single most-served resource in the ecosystem was the one we took from
exactly one place.

Three rules came out of probing real addons, and two invert what the manifest says:

- **`idPrefixes` is a hard constraint.** Anime Kitsu answers **HTTP 500** for `tt0063350`, not
  an empty list — an addon that speaks only `kitsu:`/`mal:`/`anilist:` treats an IMDb id as
  malformed. Check the prefix before the request; an addon that cannot address an id is
  skipped, not counted as failing.
- **A declared `extra` list under-reports what works.** TMDB's catalogue declares only `genre`
  and `skip`, and `search=dune` returns 23 correct results anyway. Search is *attempted* and a
  refusal is read as "this catalogue does not search" — trusting the manifest would have
  silently disabled search on one of the two best catalogue addons in the ecosystem.
- **Two deployments of one addon are two providers.** Torrentio, Comet and MediaFusion all
  have public and self-hosted instances, and a debrid-configured deployment is the *point* of
  adding one — so the host is part of the local id or the second silently replaces the first.

Also: `externalUrl` and `ytId` streams are dropped rather than offered. An `externalUrl` opens
a web page, and a row that looks playable and is not is worse than no row.

**Verified against live hosts**, driving the shipped classes rather than a harness copy:
Internet Archive search → load → `loadLinks` → **HTTP 206, `video/mp4`, `ftypmp42`**; PeerTube
4 links at 1080p from the origin instance; iptv-org catalogue, search and resolve; Cinemeta
search and meta.

**The user's own Jellyfin or Emby server is a provider**, and it is the clearest
desktop-exclusive case there is. It *cannot* exist as a `.cs3`: an Android extension scrapes
public websites and has no route to a server on your LAN, no way to hold your credentials and
no reason to. It is also the only source in this app that cannot rot — every other one can
403, expire or be taken down; a NAS in the next room does not. And it clears the keyless bar
from the other side: the key is the user's own, for their own server, and there is no
third-party service to revoke it.

Three rules there are load-bearing:

- **The API key travels as `X-Emby-Token`, never in the URL.** Jellyfin accepts `?api_key=`
  and its own docs use it — but a URL is the one part of a request this codebase writes to
  disk: `MediaProxy` mints routes from it, `SourceCache` persists it, `DiagnosticsLog` records
  it and the source export copies it to a clipboard. The one exception is the poster `src`,
  which cannot carry a header, so the key is simply omitted there.
- **The key never crosses the context bridge.** `listServers()` strips it on the way out
  rather than leaving each caller to remember; a test asserts it appears nowhere in
  renderer-bound data.
- **`static=true`.** The original file, not a server-side transcode — this app has its own
  compatibility engine, and a second one running on the user's NAS would produce a worse
  picture than the file it started from.

Worth knowing: an API key that authenticates but is attached to no user account does **not**
401. `/Users` comes back empty, and the honest message names that rather than reporting no
results.

**Their catalogues reach the home screen**, after the metadata rows rather than before.
Cinemeta's "Trending now" is what somebody opening a streaming app expects at the top; a
public-domain shelf and a list of free-to-air channels are worth having and are not that.
These rows are also *playable* rather than metadata — opening one goes straight to that
provider's own `loadLinks` — which is the opposite of `ottCatalog`'s caveat, and why the
subtitle names the source. `DiscoveryService` takes the **same** registry instance
`ContentService` owns, so a provider switched off in the extensions screen leaves the home
screen in the same moment; two rosters would drift. Verified live: Documentaries 28 rows,
Public-domain features 30, PeerTube documentaries 30, Movie channels 40.

**Four catalogue rows had rotted** and are now marked with the measurement:
`pitipitii` is gone permanently (GitHub answers **451, unavailable for legal reasons**),
`fstream`'s host sits behind an Anubis bot wall serving HTML where JSON is expected, and
`cloudstream_18plus` resolves to a plugin list that 404s. All three are `verified: false`.

### Two lanes that were already paid for (2026-09-03)

Found by counting the roster for PRD-43 rather than from a bug report. Neither was a missing
feature; both were built, funded and unreachable.

**Every non-torrent Stremio stream was being discarded.** `StremioAddonIndexer.search` filtered
its replies to the ones carrying an `infoHash`. A Stremio `stream` carries **either** `infoHash`
**or** `url`, and the `url` half is what every debrid-fronted addon answers with — an
already-cached link at line speed, the most reliable source shape in that ecosystem — plus
everything an HTTP-only addon returns. There was no error and no diagnosis: the addon simply
"found nothing".

The wall was the adapter contract, not the idea. `TorrentResult` has carried `directUrl` since
extension providers started returning HTTP links; `RawTorrent` had nowhere to put one, so
`finaliseResult` returned null. It now has a direct half, finished **before** any of the magnet
derivation — there is no swarm, no piece order and no infohash to validate.

Three rules in it are load-bearing:

- **The identity is `directSourceIdentity`, shared with `ContentService.extensionSources`.** Same
  function, same `ext-` prefix, so an addon and an extension that resolve a title to the same
  file host collapse into one row in `dedupeByInfoHash`. Two schemes would show the viewer one
  stream twice and call it two sources.
- **`seeders: 1`, and no attempt to do better.** Swarm health is meaningless for an HTTP stream,
  and `minSeeders` (1 by default) would hard-reject every direct source in `rankResults`. It
  understates a cached debrid link, which is deliberate: the provider path has ranked its links
  this way all along, and a special case here would make two identical sources sort differently
  depending on which lane found them.
- **`fileIdx` is dropped on a `url` stream.** It indexes a file *inside* a torrent, and a direct
  link is already that file.

**yt-dlp had no caller.** `extractLinks`/`searchAndExtract` existed and were referenced by
nothing outside their own definitions — ~1,800 sites, binary already fetched and resolved by
`binaryDownloader`. Same shape as the local-file capability that shipped with no entry point.
Two defects were fixed on the way in, and both are rules this repository had already settled:

- **The transport was read from the URL string** (`url.includes('.m3u8')`) with `fmt.protocol`
  sitting unread in the same object. Nothing is decided from the URL — `cs3/providerLinks.ts`
  exists for exactly this argument.
- **Any format with a video *or* an audio stream was offered.** On every DASH site that means
  the top rows are video-only, and a video-only row plays perfectly, in silence, with no `error`
  event. That is the AC-3 signature, and a viewer diagnoses it as a broken app. `ytdlpSources.ts`
  requires both halves, except on a manifest, which names its own tracks.

The `ytsearch1:<query> official trailer OR full feature` fallback is gone. A trailer standing in
for a film is a synthetic source under another name.

`YtDlpEngine.resolve` answers with a **reason** rather than an empty array, lifted from yt-dlp's
own stderr: "Unsupported URL", "Video unavailable" and a named geo-block are three different
actions a viewer could take, and the old code made them one silent non-answer. It is bounded,
and it passes `--no-playlist` — handed a series page, yt-dlp otherwise resolves every entry,
turning one press into hundreds of extractions against somebody's site.

**Two entry points, and no IPC surface changed**, because both paths already ran end to end: a
pasted page URL becomes its own search row exactly as a pasted magnet does (`searchSession`), and
`ContentService.discover` resolves an `http(s)` base through yt-dlp — where it previously fell
through to a catalogue lookup and ended at "Could not determine a title to search for". The page
is **not** resolved from the search box: typing is not consent to fetch a page, and a search that
spawns a process per keystroke would be its own bug. A page yt-dlp cannot read still falls through
to the ordinary search when a title is already known, so re-opening a history row whose media URL
is an expired CDN address is not answered with a sentence about the dead link.

`bun run test:direct-sources` (13) and `bun run test:ytdlp` (16). The first was verified by
mutation: restoring the `infoHash` filter and removing the direct branch fails 9 of its 13.

**The catalogue grew with them** — `xr3ed` (190 extensions, 47 on the jar lane), `hexated`,
`arabic_extensions`, `indochannel`, and `codegeasse` behind the adult gate. None is `bundled`:
that flag is still a claim `provider-e2e.mjs` has driven the repository end to end.
`bun run test:repositories` (9) pins what that data file may claim — unique ids and addresses,
https, a raw document rather than a project page, an adult repository never bundled, a bundled
repository never unverified. It fetches nothing; liveness is
`node tools/research/survey-repositories.mjs`, run deliberately, and a test that fails when a
third-party host has a bad afternoon is one people learn to ignore.

### The source cache learns from playback

It was already persistent with per-source expiry. What it lacked was any memory of a source
having *failed*: `unplayable` lived on the session and died with the player, so the same
dead link was served first again next time.

`recordFailure` now decides between two responses, and the distinction is the whole policy.
A **definitive** answer — 404, 410, or the host saying the file is gone — drops the source
immediately, because no amount of retrying changes it. Anything else is **counted**: a
timeout, a reset, a 5xx, or a 403 is the network or the host having a moment, and a cache
that forgets everything on the first bad minute is worse than no cache. Three such failures
drop it. `recordSuccess` clears the count, so a source that failed twice on a bad afternoon
is not dropped by an unrelated blip a week later.

403 is specifically **not** definitive: expired signed URLs and hotlink protection both
answer 403 and both are recovered by re-resolving, which the expiry machinery already does.

Pinned by `sourceCache.test.mts` (10 cases), including that removing the last source removes
the entry rather than leaving an empty shell — `hit: true` with nothing in it makes the
caller skip the discovery it needs.

### An extension update that breaks itself is put back

`updatePlugin` now copies the working archive aside, installs, **loads the new one**, and
restores the old one when it will not link. An update can download cleanly, verify its hash
and write successfully while being built against a provider API this runtime does not have —
and the first anyone knows is that every provider from that extension has silently vanished.

`T4_BLOCKED` is the only verdict that counts as failure. `T3_DEGRADED` is the normal state of
a large part of the corpus and refusing an update over it would block most of the ecosystem.
A **null** report — the sidecar being unreachable — is explicitly not a failure either
(DROP-34): rolling an update back because the JVM had not started yet would be its own bug.

One generation is kept. `extension:rollback` exposes it manually, for the case the load check
cannot see: an extension that links fine and then scrapes nothing.

### The native engine: mpv, for the streams Chromium will never decode

Added 2026-08-19 against `docs/roadmap/support_libmpv.md`. Everything in the codec
section above is still true and still the fallback; what changed is that the transcoding
ladder is no longer the *only* answer, and it stopped being the answer for the case where
it was worst.

The arithmetic that motivates it. A 4K HEVC 10-bit release — routine on GDFlix, Google
Drive links and any decent torrent — has exactly one browser-side path: re-encode to 8-bit
H.264. That costs a whole CPU core, throws away the HDR metadata, flattens 5.1 to stereo,
and on a software-only host under 16 threads it downscales to 1080p because libx264 cannot
hold realtime at 4K. mpv carries its own FFmpeg and hands the bitstream to D3D11VA, NVDEC,
Vulkan or VideoToolbox. **Measured here: `d3d11va`, full resolution, nothing re-encoded.**

| File | Role |
|---|---|
| `media/mpvEngine.ts` | Spawns and supervises mpv; line-delimited JSON-RPC over a named pipe (Windows) or unix socket. Property observation, track lists, seek, tracks, subtitles. |
| `src/types/mpv.ts` | The contract, imported by both sides. `MpvSnapshot` is what the player renders from. |
| `src/components/player/NativeEngineStage.tsx` | The player surface for a routed stream: our controls, mpv's playback. |
| `binaryDownloader.setupMpv` | Fetches a portable build on demand. |

**Routing is a decision, not a mode.** `shouldRouteToNativeEngine` runs *after* the
browser-side decision rather than instead of it, so removing mpv from the machine reverts
every verdict to exactly what it was — there is no second code path to keep correct. Three
policies, stored in the datastore under `native_engine_policy`:

- `off` — the ladder does everything, as before.
- `auto` (default) — mpv takes any stream the browser path would have **re-encoded** or
  **downmixed**: that is anything above stereo, plus lossless and object-based audio
  (TrueHD, DTS-HD MA, DTS:X, FLAC, PCM) at any channel count.
- `aggressive` — mpv takes everything that is not already playing natively, including a
  stereo container remux that loses nothing.

**The channel rule replaced a codec rule, and a user's catalogue is what settled it.** The
first version routed only *lossless* audio, reasoning that AC-3/E-AC-3 5.1 was a recoverable
loss and that routing it would push most television out of the in-app player. The report
back was "this happens on most of the content", with `Audio re-encoded, video copied
untouched: matroska,webm cannot be demuxed by the browser; EAC3 audio has no decoder here`
on title after title. A 1080p WEB-DL carrying E-AC-3 5.1 in Matroska is the **modal**
provider release, so the rule meant to protect the common case was degrading it: nearly
every film and episode played as stereo while the 5.1 sat in a file the GPU decodes for
free. The line is now channels, not codec — genuine stereo still stays in the app, where a
remux costs nothing and loses nothing.

**A stream never reaches mpv without being inspected first.** There is no `mpv:play(url)`
that takes a raw link; `media:prepare` remains the only way to obtain a playable URL, and
it returns `requiredStrategy: 'NATIVE_MPV'` with the proxied loopback address. INV-RACE-1
applies to this engine exactly as it applies to the `<video>` element — a second entry
point that skipped inspection would reintroduce PRD-37's original bug in a new decoder.
`VideoPlayer` also refuses to assign a `NATIVE_MPV` URL to the element: Chromium would take
it, fail, fire `error`, and the failover ladder would skip a source that is playing fine.

Things that will bite:

- **The URL handed over is the proxied one**, same rule as `externalPlayer`. Headers are
  also passed per-file through `loadfile`'s option map rather than as process arguments,
  because one long-lived mpv process serves a whole series and episode 2's `Referer` is not
  episode 1's.
- **`--no-config` is not tidiness.** Someone who uses mpv has configured it for mpv — key
  bindings, an OSC, a profile forcing software decoding, `--save-position-on-quit`. Any of
  those silently changes what this engine does, and the bug is invisible on every machine
  but theirs.
- **`--ytdl=no`.** Link resolution is the extensions' job and it is already done. Left on,
  every failed load spends seconds shelling out to a downloader that cannot help — measured
  at ~8s added to a failure mpv had already diagnosed as HTTP 522.
- **`video-params/pixelformat` lies once hardware decoding is running.** It reports the GPU
  surface type (`d3d11`, `cuda`), and the real format moves to `hw-pixelformat`. Reading
  only the first makes every hardware-decoded file look like it has no bit depth — which is
  the fact that put it on this path.
- **`mpv.com` ships beside `mpv.exe`.** `mpv.exe` is a GUI-subsystem binary whose stdout
  goes nowhere, so without the console front-end `--version` and `--hwdec=help` return
  empty and every diagnostic about the engine is blank.
- **The 7z archive needs bsdtar.** Windows' own `tar.exe` is libarchive and reads 7z;
  PowerShell's `Expand-Archive` does not, so `extractZip`'s fallback cannot rescue this one.
- **mpv is a child process with its own window** and is wired into `before-quit`. Without
  that it outlives the app and keeps playing with nothing left on screen to stop it.

### mpv's window draws its own controls (2026-08-24)

`--osc=no`, `--osd-level=0`, `--input-default-bindings=no` and
`--input-vo-keyboard=no` were all set on the reasoning that our control bar is the
controller and mpv's would be a second one. That reasoning holds for an *embedded*
surface and does not hold for what is actually built: mpv renders into a **separate OS
window**, so the viewer looking at the picture was looking at a window with no controls
in it, while the bar that drives it sat behind in a different window.

So `--osc=yes` and `--osd-level=1` are on — mpv's built-in on-screen controller gives
play/pause, a seek bar, volume and fullscreen — and `--input-vo-keyboard=yes` lets keys
reach the window. Verified that the OSC still loads under `--no-config --load-scripts=no`:
it is an internal script, and `--load-scripts` only governs the user's own script
directory. None of this touches decode or network.

**`--input-default-bindings` stays `no`, and the bindings are enumerated instead**
(`NATIVE_KEY_BINDINGS`, applied with mpv's `keybind` command after the IPC channel is up).
mpv's default set quits on `q`, `Q` and `Ctrl+q` — and an exit while playing is reported
as `ended`, which `NativeEngineStage` turns into `onEnded()`, so a viewer pressing `q` to
stop watching would be handed the next episode. The defaults also bind `s` to a screenshot
written beside the working directory. Every enumerated binding matches what the same key
already does in `VideoPlayer` (`SKIP_SECONDS` is 10 in both), because the two windows are
one player and a key that seeks 10 in one and 60 in the other is worse than a dead key.

Two consequences worth keeping:

- **Nothing new syncs.** `pause`, `volume`, `mute`, `speed` and `fullscreen` are already in
  `OBSERVED`, so whatever the viewer changes in mpv's window arrives back as a
  `property-change` and our own control bar follows it. Adding a control that mpv can
  change without an `OBSERVED` entry behind it would be the first thing here to need a
  second sync path.
- **`end-file` with reason `quit` now reports `idle`.** Closing mpv's window — or any
  binding that quits — used to reach `child.on('exit')` while `state` was still `playing`,
  which is the credits as far as that handler is concerned. The next episode started in a
  new window. Same rule as `shutdownNow`, reached from mpv's side instead of ours.

**What is not built: embedding.** mpv renders in its own window, driven over IPC — the
roadmap's Option A, which it calls the recommended first step. Putting the video surface
inside the Electron window needs libmpv's render API through a native addon (Option B).
`MpvOpenRequest.windowHandle` exists and is passed to `--wid` for when that lands; nothing
sets it today.

### The second film would not play (2026-08-24)

Reported as: the first title plays, and after that nothing does — a different film, a
different source, or the same one again. Four causes, and none of them is the one the
symptom points at.

1. **The persistent probe cache was keyed on the loopback address.** `ContentService` wraps
   a provider link through `MediaProxy` to attach its headers, producing
   `http://127.0.0.1:<port>/stream/1`, and `PlaybackEngine.inspect` handed *that* to
   `InspectionStore` — which persists. The token is minted per process, so `/stream/1` is
   one film this run and a different one the next: the second film was decided from the
   first film's codecs, and an HEVC release was attached as though it were H.264.
   `MediaProxy.getTargetRoute` unwraps a loopback URL back to the upstream one, the
   capability cache and the store are keyed on **that plus the headers**, and the store now
   refuses loopback keys outright and prunes the ones already written.

2. **An idle mpv left its window on screen.** `stop()` sent `['stop']` and left the process
   alive under `--idle=yes`, so a blank standalone window floated over the app for every
   source that was not routed to mpv, and for the player being closed. It quits now.

3. **Which immediately created a race, and it is the ordinary source switch.**
   `NativeEngineStage`'s effect cleanup fires `mpv:stop` and its body fires `mpv:open` in
   the same tick, neither awaiting the other. Interleaved, the quit's `teardown()` — and the
   `kill()` that used to be scheduled on a detached 1.5s timer — landed on the process the
   open had just started. `MpvEngine.serialize` puts `open`, `stop` and `shutdown` on one
   queue, and `shutdownNow` waits for the child's `exit` (~100ms typically) instead of
   arming a timer at a process that may no longer be the one it meant. Pinned by three cases
   in `mpvEngine.test.mts`; the pre-fix engine fails the first of them by timing out waiting
   for the switched-to source to play.

   Two smaller rules fell out of it. An explicit stop clears `state` **before** the quit,
   because `child.on('exit')` reports `ended` when the process dies while playing and
   `NativeEngineStage` turns an `ended` snapshot into `onEnded()` — the next-episode
   advance. And `playback:stop` no longer stops mpv at all: not every session owns a stream,
   and the detail page's source picker starts one through `startSourceDiscovery` purely to
   scrape, so closing the picker killed the film playing in the mini player. Closing the
   player is what must close mpv, and `handleClosePlayer`, `VideoPlayer`'s unmount and
   `NativeEngineStage`'s teardown all do it directly.

4. **The preparation effect depended on object identity, so playback restarted itself.**
   `VideoPlayer`'s `media:prepare` effect listed `activeSource?.directHeaders` and
   `activeSource?.drm` in its dependencies. Those come off a `playback:update` snapshot and
   are therefore **new objects every time one arrives** — and `recordBufferStall` pushes one
   on every buffer underrun. So a stall tore the stream down and re-prepared it, which
   caused the next stall. Identity now comes from a serialised `activeSourceKey`, and the
   effect depends on a `sourceConfig` memo keyed on that. **If you add a source field to
   that effect, add it to the key, not to the dependency array.**

`electron/media/mpvEngine.test.mts` (17 cases, `bun run test:native`) drives a real mpv
process against a synthesised HEVC 10-bit / AC-3 5.1 Matroska fixture. It is not pure and
should not be: every failure worth catching lives in the seam between two processes — the
JSON framing, `request_id` correlation, the property observations that drive the timeline,
`end-file` telling a dead link apart from the credits — and a mock would only ever assert
what we assumed mpv does.

### FFmpeg 7.1 silently broke the image-segment fix

`-allowed_extensions ALL` — the documented answer to `Hdmovie2` serving MPEG-TS from `.png`
URLs — **stopped working, and nothing in this repository changed on the day it did.**
FFmpeg 7.1 added `-extension_picky`, defaulted it to *true*, and evaluates it before the
allow-list. On the bundled build (n8.0) the old flag is inert and every provider serving
extensionless or image-named segments fails with the exact message the fix was written
against.

Measured against a local HLS fixture with `.png` segments served as `image/png`:

| Flags | Result |
|---|---|
| `-allowed_extensions ALL` | refused |
| `-allowed_segment_extensions ALL` | refused |
| `-extension_picky 0` | **probes cleanly** |

The flag cannot simply be added: passing an option a binary does not know is fatal to the
whole command line (`Option extension_picky not found`), and FFmpeg 7.0 is still in the
download mirrors. So `detectExtensionPicky` asks the binary via `-h demuxer=hls` once at
startup and again after any ffmpeg install, and `hlsDemuxerOptions()` includes the flag
only where it exists. Pinned by `pipeline.test.mts`.

Found by `tools/e2e/native-engine-matrix.mjs` on a real provider playlist, on its first
run — which is the argument for that harness existing.

### 5.2 The vendor coverage matrix — `tools/e2e/native-engine-matrix.mjs`

```
node --experimental-strip-types tools/e2e/native-engine-matrix.mjs
node --experimental-strip-types tools/e2e/native-engine-matrix.mjs --plugins 12 --links 2
node --experimental-strip-types tools/e2e/native-engine-matrix.mjs --only Cinefreak,HDhub4u
node --experimental-strip-types tools/e2e/native-engine-matrix.mjs --titles hindi-movie,english-series
```

`provider-e2e.mjs` answers "does the extension corpus still run?". This answers the question
after it: **given what those extensions hand back, can this app put it on screen?** Those are
different failures with different owners — a provider resolving five links to 10-bit HEVC is
working perfectly and is still, without the native engine, five links we could not play.

It imports the shipping `MediaInspector` and `decideStrategy` rather than reimplementing
them, so the strategy in the report is literally the one the app will choose for that URL;
a harness with its own copy of the decision agrees with the product right until it matters.
Every candidate stream is then **played for real by mpv for a few seconds**, headless
(`--vo=null --ao=null`, which still runs the full demux and decode path), and the report
carries how far the playhead got and how many frames dropped. `--untimed` is deliberately
not passed — decoding as fast as the CPU allows would hide the exact failure being looked
for, a stream that cannot sustain realtime.

Each row records **both** verdicts: what the strategy would have been without the engine and
what it is with it. A row where they differ is a stream that used to be re-encoded and now
is not, which is the only honest way to state what the engine bought.

Language coverage is deliberate rather than decorative. Hindi releases are where the hard
cases cluster — dual-audio Matroska with per-language 5.1 AC-3/E-AC-3, 10-bit HEVC encodes,
the multi-track files the audio-selection logic exists for — so a matrix of English titles
alone reports a compatibility story that is true for half the catalogue.

### 5.3 The metadata coverage harness — `tools/e2e/metadata-e2e.mjs`

```
node --experimental-strip-types tools/e2e/metadata-e2e.mjs
node --experimental-strip-types tools/e2e/metadata-e2e.mjs --only wikidata
node --experimental-strip-types tools/e2e/metadata-e2e.mjs --title tt1160419
node --experimental-strip-types tools/e2e/metadata-e2e.mjs --json report.json
```

`provider-e2e.mjs` asks whether the extension corpus still runs and
`native-engine-matrix.mjs` asks whether what it returns can be played. This asks
the third question: **do the keyless catalogues actually answer, and is what
comes back the shape the parsers expect?**

It imports the shipping adapters rather than reimplementing the requests, for
`native-engine-matrix.mjs`'s reason — and here that matters more than usual,
because a wrong SPARQL property fails *silently as an empty result* rather than
as an error. So the gate is that at least one source returned **cast with
characters**, not that a request succeeded: a clean, empty 200 is exactly what a
mistyped property produces, and it is indistinguishable at the transport layer
from a title nobody has an entry for.

Three fixtures, one per routing path — a film (Wikidata + Cinemeta), a series
(TVmaze) and an anime (AniList, two scripts and voice actors) — and it prints,
per source: status, latency, credits, how many carry a character, a photograph
and a native name, then the merged result and five sample rows. The merged line
is the one worth reading: it is the only place several real sources meet, so a
duplicate there is a duplicate on screen.

**It has already paid for itself once.** On its first run it exposed two
swallowed-error bugs in the adapters it drives — see "`empty` is not `failed`"
above. Both were invisible to the unit tests, because both produced a perfectly
well-formed empty result.

Run it before claiming anything about metadata coverage. Under a blocking egress
proxy it correctly reports every source as `FAIL` with the real reason and exits
1, which is the honest answer rather than a pass.

### When we cannot play it, hand it to something that can

`externalPlayer.ts` detects VLC, mpv, MPC-HC/BE and PotPlayer and offers to open
the stream in them. This is not a fallback for our bugs — there is a category of
file Chromium will never decode, and VLC and mpv carry their own ffmpeg and play
essentially anything.

**The URL handed over is the proxied one.** External players each have their own
incompatible way of setting a `Referer` (`--http-referrer`, `--http-header-fields`,
nothing at all), and a provider link without its header is a 403 in any of them.
The loopback URL has the headers applied already, so every player works with no
per-player knowledge.

**Nothing is downloaded on the user's behalf.** Players are detected, never
fetched; when none is found the official download pages open in the browser.
`shell:openExternal` re-checks the scheme because, unlike `setWindowOpenHandler`,
it is reachable from the renderer with an arbitrary string.

The offer is suppressed when the source is dead — a 404 plays no better in VLC,
and sending someone to install a player that cannot help is worse than saying
nothing. That distinction comes from `describeUnreadableSource`: when a probe
returns nothing, the source is asked for its HTTP status with a one-byte range
GET (HEAD is refused by some hosts). A reported failure turned out to be a plain
404 while the message on screen was still guessing at codecs.

### Provider links need the provider's headers, and a browser cannot send them

Extension links routinely only answer when accompanied by the `Referer` the
provider supplied. `ExtractorLink` carries it, and for a long time it reached the
download engine and nothing else: playback handed the raw URL to `<video>`, which
sends neither `Referer` nor a custom `User-Agent`. No renderer-side fix was
possible — `Referer` is a forbidden header for `fetch`/XHR precisely so pages
cannot forge it.

One cause, two unrecognisably different symptoms:

- **HLS** — `manifestLoadError` from hls.js, because the host 403'd the playlist.
- **Progressive** — "could not decode this file", because *ffprobe* could not read
  it either, so the player had no codec to name and fell through to the generic
  message.

`mediaProxy.ts` serves the stream from loopback with the headers applied, and
`ContentService.startStream` wraps every `directUrl` through it. That fixes all
three consumers at once — the media element, hls.js and ffprobe/ffmpeg — because
they are all handed the same loopback URL. A link with no headers is passed
through untouched rather than gaining a pointless hop.

**HLS playlists are rewritten, not forwarded.** A manifest names its segments,
keys and variant playlists by URL, and those requests would otherwise go straight
from the renderer to the host without headers — succeeding on the manifest and
then failing on every segment, which is worse than failing outright. Both forms
are covered: bare URI lines and quoted `URI="…"` attributes (`EXT-X-KEY`,
`EXT-X-MAP`, `EXT-X-MEDIA`). Relative URIs resolve against the *final* upstream
URL so a playlist reached via redirect still resolves correctly.

Bound to loopback only: it forwards arbitrary URLs with caller-supplied headers.

**A loopback URL is returned from `wrap` untouched.** Everything that serves media
locally — the torrent engine, this proxy, the transcoder — hands back
`http://127.0.0.1:…`, which matches the scheme test. Without the guard the
compatibility engine wraps a torrent stream in a second proxy hop that copies every
byte for nothing, and re-wrapping this proxy's own output builds a chain that grows
by one hop per call. There is nothing to gain either way: header injection exists to
satisfy a third-party CDN's hotlink check, and our own servers set what they need.

**A source that answers 4xx is failed over immediately, not converted.** Expired
signed URLs from Cloudflare Workers and Googleusercontent are the routine case, and
opening ffmpeg on one costs its startup plus the wait for the element to give up
before the next mirror gets a turn. `PlaybackEngine.prepare` returns the failure as
soon as `describeUnreadableSource` reports it dead, and the player asks the session
for the next candidate.

### Diagnosability: a message is not a report

A failure message is a fact about a string. `Expected URL scheme 'http' or 'https'`
names no provider, no query and no item, and by the time anyone investigates the
query is gone and the provider was one of thirty. What makes a failure actionable
is the **tuple**: which provider, on which query, for which item, at what address.

`cs3/diagnostics.ts` records exactly that, persisted to its own file — not the
datastore, because this is debugging exhaust that runs to hundreds of entries and
has no business inside a user's backup next to their watch history. Recording
happens in `PluginManager`, the only layer that knows which provider was asked.

`loadLinks` was the worst offender and is the one to imitate: every failure
returned `[]`, so a timeout, a thrown extractor and a provider that genuinely has
nothing all produced one sentence. The empty list still goes back — a failed
resolve is not an exception at that layer — but the reason goes to the log.

`CopyErrorButton` renders a pasteable report, assembled in the main process
because that is the only side holding the environment. It leads with app,
Electron, platform and extension-runtime versions: the two questions every
maintainer asks first are the two a reporter is least able to answer.

**Two sizes, and the small one is the default.** It used to copy the whole
session — up to three hundred entries — which is wrong in both directions:
whoever receives it has to find the failure being described inside it, and
whoever sends it has pasted an evening's viewing history into a chat window
without meaning to. `mode: 'current'` selects by context (provider, url, title
or query, within a recent window) and falls back to recent history *while saying
so*, rather than silently implying unrelated entries describe the failure.

Both modes deduplicate. Grouping normalises durations, byte counts and
timestamps out of the key — those differ on every occurrence and never
distinguish one failure from another — but **bare integers are left alone**,
because `HTTP 403` and `HTTP 404` differ by one digit and mean opposite things.
A shorter report that says something false is not an improvement. The report also
leads with a `Failures by cause` tally: grouping by class is what turned 113 load
failures into six missing types, and that is the shape a maintainer needs.

**`loadLinksDetailed` is why the message can now be specific.** `loadLinks`
returning a bare `[]` is the reason "the extension provider returned no playable
links for this item" was the only thing anyone could ever be told — one sentence
covering a timeout, a thrown extractor, a blocked host, a provider with no
`loadLinks` at all, a title that genuinely has no sources, and a reply full of
links with empty URLs. The empty list still goes back; what changed is that a
`SourceDiagnosis` travels beside it, carrying the summary for the screen, a hint
for the user, and the facts for the clipboard.

### The range probe was downloading the whole file

Reported as a stalled download: `Babe Beach`, 4K HDHUB, **2 MB of 5.75 GB at 0 KB/s**. The
link was alive and the source was fine.

`FastChunkDownloader.probeUrl` asks for `bytes=0-0`, reads the headers, and called
`res.resume()` before resolving. `resume()` discards the data — it does not stop the
transfer. Against a server that honours Range that is harmless, because the body is one
byte. Against a server that **ignores** Range it is not, and
`video-downloads.googleusercontent.com` ignores it: measured on the reported link, it
answers `200` with no `Accept-Ranges` and `Content-Length: 6,175,245,105`, so the probe kept
pulling the file after it had already returned its answer — **5.6 MB in the five seconds
after resolving, and still going.** The real download then ran beside it, competing for the
same throttled signed URL. A few megabytes, then nothing.

The probe now destroys the response and the request once it has the headers. Verified
against the same URL: 0 bytes after resolving, where the old code reached 5.6 MB.

Two things worth keeping straight while you are in there:

- **`supportsRange` was never wrong.** It reads `206` or `Accept-Ranges: bytes`, and this
  host offers neither, so `canParallelize` was already false and the sequential path was
  already chosen. The bug was entirely in the abandoned probe connection — which is why it
  looked like a network problem rather than a downloader one.
- **A chunk worker used to accept `200`.** If a host changes its mind between the probe and
  the transfer — signed-URL CDNs do this under load — a ranged request answered with `200`
  is the whole file from byte zero, and writing it at that chunk's offset corrupts the
  output while every worker downloads the entire file. It now fails the chunk with a reason.
  A corrupt file that finishes is worse than a download that says why it stopped.

Unrelated but reported alongside it: a `RefreshingSource` retry on a
`googleusercontent.com` link is usually **correct behaviour, not a bug**. Those URLs are
signed and short-lived; the second reported link answered `HTTP 400` outright, and
re-resolving it from the provider is the only thing that can help.

### Shipping: the box has to contain everything

The target user has used Netflix and has not used a plugin manager. They install
one thing and they stream. Two consequences, both structural:

**The JVM ships inside the app.** `electron-builder` used to package `dist/`,
`dist-electron/` and `node_modules/` and *nothing else* — no sidecar jar, no
provider classpath, no Java — so a packaged build had no extension capability at
all, and no amount of correct runtime code would have changed that.
`tools/package/build-runtime.mjs` assembles `sidecar/dist/` (sidecar + `lib/` +
`runtime/` + a jlinked JRE, ~90 MB) and `extraResources` copies it to
`resources/sidecar/`, which is exactly where `SidecarSupervisor` looks when
`app.isPackaged`.

The jlink module list is curated rather than `ALL-MODULE-PATH`, and the entries
that look optional are the ones that bite: `jdk.crypto.ec` (ECDHE — without it
TLS fails against most sites, one provider at a time), `jdk.unsupported`
(`sun.misc.Unsafe`, reached by coroutines/OkHttp/Jackson), `jdk.localedata` (a
multilingual corpus parsing dates under a C locale silently returns nothing),
`java.sql` (Jackson resolves `java.sql.Date` reflectively). Verify a change to
that list by running the corpus against the linked runtime, not by checking that
the build succeeded:

```
node tools/package/build-runtime.mjs --verify
node tools/e2e/provider-e2e.mjs --java sidecar/dist/jre/bin/java.exe
```

**First launch installs the verified repositories itself** (`cs3/bootstrap.ts`),
in the background, with progress — an app that opens to an empty home screen
until you find the extensions tab and install plugins one at a time has shipped a
construction kit, not a product. It runs once (`BOOTSTRAP_VERSION`), caps at
`PLUGINS_PER_REPOSITORY` because ~170 archives means ~170 DEX translations before
the first search, and never blocks: the catalogues and indexers answer normally
while providers arrive. Repositories opt in via `bundled: true`, which is a claim
that `tools/e2e/provider-e2e.mjs` has driven them end-to-end.

### Adult content is opt-in, and the gate is central

Off by default. The enforcement point is `PluginManager.enabledProviderNames`,
because search, the scope picker, source discovery, playback and downloads all
funnel through it — filtering at each call site would be five places to forget.
A provider is adult when its `supportedTypes` include upstream's `NSFW` `TvType`,
which catches an adult provider bundled inside an otherwise ordinary repository.
That is the real case: measured against the catalogue, **four** repositories
publish NSFW-tagged plugins (`indostream`, `cinephile`, `redowan`,
`uk_extensions`) and none is a wholly-adult repository — `cinephile` is in the
bundled set. `BootstrapService` additionally declines to *download* them while
the setting is off, which is politeness rather than protection; the gate above is
the protection.

### Sandbox: enforced vs. not

Enforced — plugin cannot reach sidecar internals (`PluginClassLoader`, tested);
`System.exit` cannot kill the app (process boundary); `System.loadLibrary` blocked via
empty `java.library.path`; per-plugin scoped storage.
**Not enforced** — raw network egress, process creation. Both need an OS-level sandbox
(Windows job object + restricted token). They are reported by `status` as `sandboxGaps`
and surfaced in the UI on purpose: a named gap can be closed; an implied-covered gap never
gets fixed. Java's `SecurityManager` is not an option (JEP 411/486 removal).

### A links handle is not a page address (2026-08-27)

The single most frequent failure in a user's captured session, and it named the wrong party
every time:

```
VegaMovies: IllegalArgumentException: Expected URL scheme 'http' or 'https'
            but no scheme was found for [{"sou...
  url: cs3ext://VegaMovies/[{"source":"https://vcloud.fit/ubvtmxgdjbx1xxu"}, …]
```

Upstream's `MainAPI` has **two kinds of handle and they are not interchangeable**. `load(url)`
takes a page address and fetches it. `loadLinks(data)` takes an opaque blob the provider built
for itself — and a large part of the corpus puts JSON in it (VegaMovies an array of objects,
HDHub4U an array of strings). Both are `String`, so nothing in the type system separates them,
and `cs3ext://<provider>/<handle>` does not record which kind it is carrying.

Handing a links blob to `load()` reaches OkHttp's `HttpUrl.get`. The throw was recorded at
stage `detail`, **scored against the provider by the ranking**, and shown to the viewer as the
reason their title would not play. The provider was fine and the call should never have been
made.

It reached `load()` from three directions, which is why the guard is one shared predicate
(`cs3/extensionAddress.ts`, `looksLikeLinksHandle`) rather than three local checks:

1. **`resolveExtensionTarget`** looked up an episode list for any address carrying an episode
   number — including one that already *was* the episode, which is what Continue Watching
   hands over.
2. **`extensionSources`** retried through `dataUrl` whenever the first attempt found no links,
   without asking whether the address it had could be opened — **and did not catch the
   throw**, so OkHttp's message replaced the real diagnosis and rejected the whole discovery.
3. **`DetailView`** was handed a playback handle as an item URL. See below.

The test is deliberately narrow: JSON is definitely not a page, anything else might be.
Internet Archive's `load()` takes `https://archive.org/details/<id>` while its `loadLinks`
takes the bare id, so "must start with http" would refuse pages that work.

### "A title I saved now opens blank" (2026-08-27)

The same root cause, persisted. `DetailView` recorded `progress.mediaUrl` as
`episode?.url ?? detail.url` — and `episode.url` is the **playback handle**. That address went
into the library, Continue Watching and any page saved from one of those rows; clicking the row
later called `load()` on it and the detail page came up empty. It reads as data rot, and it is
not: it is the wrong address having been written, and it only ever manifests on the *second*
route to a title.

**Nothing is lost by storing the page instead.** `libraryStore.recordProgress` keys on
`canonicalKey(title, year)` plus season and episode — not on `mediaUrl` — so no progress record
is orphaned by the change, and the season and episode travel in their own fields. The handle
that actually plays is still `request.mediaUrl`.

Rows written before the fix cannot be repaired: the page address is not recoverable from a
links blob. What *is* stored beside them is the title, so the failure screen now offers
**"Find <title> again"**, which is the only thing that turns a permanently dead row back into a
working page.

### CloudStream X (CSX), and two shim gaps it found (2026-08-27)

CSX is now `bundled: true`. Per §5's rule that the flag is a claim the harness has driven the
repository end to end, `tools/e2e/provider-e2e.mjs` knows about it and was run before the flag
was set. Two extensions stopped at `load()` and both were ours:

1. **`CloudStreamApp$Companion.setKey(String, Object)`** — upstream declares
   `fun <T> setKey(path, value)`, whose erased descriptor takes `Object`. The bridge carried a
   `setKey(String, String?)`, which is a *different method* to the JVM: present, and impossible
   to call. CineStream's `load()` opens with `Settings.initSeenProviders()` and died there.
   **A Kotlin companion is not inherited** — `CloudStreamApp : AcraApplication()` gives
   `CloudStreamApp.Companion` nothing from `AcraApplication.Companion` — so both names carry
   the methods rather than one delegating to the other.
2. **`AccountManager.simklApi`, typed `SimklApi`.** `SyncRepo.kt` said SIMKL was left out
   because nothing had been observed to use it; CineStream's `CineSimklProvider` is that
   observation. Typed as the concrete class, not `SyncAPI` or `SyncRepo` — a getter returning a
   supertype is a different method. **That near-miss has now been made four times** in this
   repo (`getResources` returning `Object`, `aniListApi` as the wrapper, `setKey`, this).

**Nothing was setting the application context**, so even once the descriptors matched every
helper would have been a silent no-op. `PluginHost.invokeLoad` now points both companions at
the plugin's context immediately before `load()`. The same pass found `newShimContext`
hard-coding the literal `"plugin"` as the scoped-storage id — so **every extension in the
process shared one preferences file**, which was invisible while the helpers were stubs and is
a collision the moment they write. It takes the real `pluginId` now.

`RUNTIME_GENERATION` is **8**: both halves changed and a provisioned copy pairing one with the
other is worse than either alone. `BOOTSTRAP_VERSION` is **2**, which is how an install that has
already bootstrapped receives CSX — `run()` filters targets on `!already.has(rawRepoUrl)`, so a
re-run installs only what is new and re-downloads nothing.

**Measured after the fixes**, `--repo CSX --plugins 10` across five queries
(dune, reacher, breaking bad, one piece, inception):

```
providers loaded    11
providers answering  9
links resolved       8
streams with bytes   7
PASS
```

CineStream alone resolved 57 links for *Dune: Part One* and 66 for *Dune: Prophecy*, and
delivered 2.00 MB of `video/x-matroska` at HTTP 206 with ranges honoured. The remaining
failures are host-side and worth recognising rather than re-debugging: BollyFlix times out,
Online Movies Hindi resets the connection, GDIndex trips its own 5 MB `.text` guard.

**`tools/package/build-bridge.mjs` could not find Maven on Windows.** `spawnSync('mvn')`
without a shell does not resolve `mvn.cmd`, and every `dependency:get` failed with `ENOENT` —
reported as *"could not obtain <artifact> from Maven Central. Is mvn on PATH?"*. It was on
PATH. `findMaven()` now tries the platform's spellings and prefers `tools/toolchain/apache-maven-*`,
for the same reason `SidecarSupervisor.resolveJava` prefers the checked-in JDK.

### `InvalidHeader` was every unclassified record (2026-08-27)

`InvalidHeader: Invalid file header. Header doesn't start with #EXTM3U` fell through to
`unknown` — four IPTV providers failing identically on every search, never grouping, so one
dead upstream read as scattered noise. It is `unreadable-reply`, not `provider-error`: the
extension's parser is right to refuse, what changed is on the other end of the connection, and
the reader's action is to check the source rather than to report a bug to the scraper's
maintainer.

### Backing up an installation (2026-08-27)

`electron/cs3/backupService.ts`. There were two exports before it and neither answered the
question: `datastore:exportBackup` writes the **Android** format for moving between the phone
app and this one, and library/history each exported themselves — so moving to a new machine
lost the repositories, the extensions switched off, the saved pages and the indexer
configuration.

**Sections are a table, not two switch statements.** A store added to the export and forgotten
in the restore produces a file that looks complete and silently drops those rows on the way
back; one entry cannot be half-added. An export-only section (the download queue) is reported
as `export only` rather than as a restore of zero, so the two are distinguishable.

Deliberately absent, each for its own reason: the `.cs3` archives and downloaded media (large,
re-fetchable — the backup records *which*, which is the part that cannot be); tokens and device
ids (filtered by `DatastoreManager.snapshot` on the way **out**, so they are never written into
a file in someone's Downloads folder); diagnostics and logs (they describe the machine captured,
not the one restored to); caches (everything in them expires, and a stale cache is worse than
an empty one).

**Restore merges rather than replaces**, so a preference added since the backup was taken does
not silently revert; it snapshots the datastore first so the write can be undone; and a section
that throws is recorded while the rest still restore, because a restore that stops halfway
leaves a state neither the backup nor the previous one describes. 12 cases in
`backupService.test.mts`, including that an unrelated JSON file is refused **by its format
marker** — otherwise it would be fed to every section and answer "restored 0 rows from 9
sections" instead of "that is not a CloudStream backup".

### Extensions: browse opens where you asked (2026-08-27)

"What does this repository offer?" was a third tab, and reaching it threw away the list the
question was asked from — the scroll position, the filter chips, and the neighbouring
repositories being compared against. Comparing two catalogues cost three tab switches. It is
now a full-width panel under the repository's own card (`grid-column: 1 / -1`, so a
twenty-extension list does not render inside one 290px column and read as belonging to the
card's neighbours), and the tab is gone. Two tabs remain: **Installed** and **Browse**.

**Search reaches through a repository.** The query matched a repository's own name,
description, language and shortcode and nothing else — so looking for a provider you know you
have found nothing, even with the repository carrying it on screen. It now also matches the
installed extensions and providers underneath, and the card says *why* it matched: a result
with no visible reason reads as a broken filter.

### Settings: a level, not an Advanced tab (2026-08-31)

The screen accumulated the way settings screens do — every decision worth
exposing became a row — and the result is accurate and unusable. "Providers
searched at once", "Torrent metadata mirrors", "Native engine policy" are all
real controls with real effects and none of them means anything to somebody who
installed this to watch a film.

**The obvious fix does not work, and this screen already tried it.** Moving the
technical rows to an Advanced tab fails because "advanced" is not a category:
the technical controls are *about* the same subjects as the simple ones — how
many providers a search asks is a search setting, the probe budget is a playback
setting. Grouping by audience rather than by subject puts two halves of one topic
in two places, and the reader has to know which half they need before they can
look.

So the grouping stays by subject and a **level** filters within it.
`SettingRow` and `SettingGroup` take `level`, and a group whose rows have all
hidden themselves hides too — otherwise Simple is a page of empty headings that
reads as a failure to load.

**`advanced` means one specific thing: understanding the *label* requires
knowing how this app is built.** Not "rare" and not "dangerous". A control whose
effect a viewer can describe without that — where downloads go, subtitle size,
keep playing when I minimise — is basic however obscure it is.

Applying that test changed the answer twice, both times because
`settingsLevel.test.mts` said so. It refuses a file where over half the rows are
advanced, and it caught rows marked individually inside groups that were already
marked, and a batch of rows hidden for having jargon labels **when the labels
were the problem**. Six are renamed instead — "Detected native players" is now
"Players found on this computer" — and the toolbar-visibility rows came back,
because "show the subtitles button" needs no knowledge of anything.

Two traps in that test are worth keeping:

- Its first tag scanner used "the nearest `<` before the match", which is wrong
  the moment an attribute follows a JSX expression: in
  `<SettingGroup icon={<RefreshCw />} level="advanced">` the nearest `<` is the
  icon. It tracks brace depth now.
- The ratio has to count rows and groups separately, or a marked *group* is
  counted as a marked row and the file looks twice as filtered as it is.

**Simple is the default**, and that is the part that matters: someone opening
this screen is being asked, implicitly, which rows they should have an opinion
about, and the honest answer for most people is about eight. The switch says
what it is holding back, because a filtered list that does not admit it is
filtered is the same failure as a scoped search that does not.

Stored in `localStorage`, not the datastore: it describes how one person reads a
screen, not how the app behaves, and has no business travelling in a backup to a
machine somebody else uses. `shouldShow` lives in a plain `.ts` beside the
provider because Node's type stripping cannot load JSX and the rule is the half
worth testing — its default (**an unclassified row is basic**) is load-bearing,
since backwards it would make Simple mode silently lose every setting added from
then on.

**And splitting it that way is what blanked the whole app (2026-09-01).** The
React half was `SettingsLevel.tsx`, beside the pure `settingsLevel.ts`. On
Windows' case-insensitive filesystem those are **one name**, and module
resolution tries `.ts` before `.tsx` — so `import { useSettingsLevel } from
'./SettingsLevel'` resolved to the pure rule, which exports `shouldShow` and
neither the hook nor the provider.

The consequence is out of all proportion to the cause, and that is the part
worth remembering. A missing named export is an ESM **link** error, not a
runtime one: it does not throw inside a component where `ErrorBoundary` could
catch it and it names nothing on screen. It fails the entire `App.tsx` import
graph, so **the window comes up blank** — every view, not just Settings. The
last successful `dist/` predated the commit by three days and nothing said so,
because `vite-plugin-electron` builds main and preload as separate environments
and those two kept succeeding.

`tsc -b` and `vite build` both refuse it outright, so the tooling was never the
gap — the gap was shipping without running either. The file is
`SettingsLevelContext.tsx` now, and `componentReachability.test.mts` grew a
third case that folds every module path under `src/` and `electron/` to lower
case and requires it to stay unique. It runs inside `test:electron`, which is
what people actually run, and it is verified by mutation. **Never name a `.tsx`
and a `.ts` alike but for their casing** — on the machine it is written on, it
resolves.

### Settings (2026-08-27)

The tab bar was `overflow-x: auto` over a fixed set of eight tabs, so on an ordinary window
reaching "Advanced" meant finding and dragging a horizontal scrollbar. It wraps now, and is
sticky — because the new **All settings** view is one long page, and navigation that scrolls
away is navigation you have to scroll back up to reach.

`all` is a view, not a category: it renders exactly the same groups the tabs do, in tab order,
with a heading before each. No control is duplicated, so the two views cannot disagree.

### Seven IPC channels were strings that had stopped matching (2026-08-27)

Found by diffing the channel literals in `main.ts` against those in `preload.ts` — not by
chasing a symptom, because none of these produces an error anyone would report as an error.
`tsc` cannot see them: the channel is a string on both sides and the two files never refer to
each other. The user-visible form is always a dead button or a silent no-op.

| Channel | Was | Consequence |
|---|---|---|
| `binary:setupBinaries` | invoked, never registered | the first-run component installer **always failed** |
| `runtime:repair` | invoked, never registered | the recovery path for a broken runtime, latent |
| `discover:invalidated` | pushed, no listener | switching home catalogue left the old rows up for 6h |
| `binary:check`, `binary:setup` | registered, unreachable | duplicate spellings of live handlers |
| `extension:getRuntimeReport` | registered, unreachable | no way to say *why* an extension registered nothing |
| `media:get/setProbeConfig` | registered, unreachable | the probe budget, unreachable by the users it affects |

**`ipcRenderer.invoke` on an unregistered channel rejects — it does not return an
`{ ok: false }` envelope.** That is what made the first one invisible: `BinarySetupModal`
caught the rejection and rendered `No handler registered for 'binary:setupBinaries'` as a
friendly-sounding notice with "(HTTP fallback stream active)" after it. The user was told a
fallback was active and had no way to know the button had done nothing. **A catch that
reassures is worse than no catch.** Both halves were needed to hide it.

**`electron/ipcSurface.test.mts` now pins all four diffs** (`bun run test:ipc`, and it runs
first in `test:electron`). It is lexical rather than runtime — loading `main.ts` would boot
the whole service graph, and the strings are what matter. Verified to fail in all three
directions by mutation, because a parity test that passes trivially is worthless. Exceptions
go in the commented allow-lists at the top, and "I will wire it later" is not a reason: an
entry there is indistinguishable from a working feature to everyone who reads the code.

### Lifecycle: closing a window is not quitting (2026-08-27)

`window-all-closed` ran `downloadService.stop()`, `extensionUpdater.stop()` and
`pluginManager.shutdown()` **unconditionally**, with only `app.quit()` guarded by platform.
On macOS the app then stayed in the dock holding a dead sidecar and a stopped queue, and
`activate` opened a fresh window onto all of it — zero providers, every search empty, and
nothing on screen explaining any of it. Every teardown moved into `before-quit`, which is the
event that actually means "we are going away"; `window-all-closed` now only quits.

**Shutdown is raced against a 5s deadline.** WebTorrent's `destroy()` and an unresponsive mpv
both hang in the wild, and `before-quit` calls `preventDefault()` — so when one hung the
window was gone, the process was not, and the only recourse was Task Manager, after which the
next launch hit the locked cache directory this handler exists to prevent. Which service was
still pending is logged as `shutdown_timeout`; that is the fact that makes the next fix
possible and it costs one line. The old `if (!torrentEngine) return;` guard was dead (it is
constructed eagerly) and would have skipped mpv, external players, the WebView host and
`logger.shutdown()` if it had ever fired.

### Navigation, shortcuts and the menu (2026-08-27)

**A dropped file used to replace the app.** `setWindowOpenHandler` covers `window.open`; it
does not cover a top-level navigation, and Electron's default is to perform one. Dragging a
video onto a media player's window is the most natural gesture a user has — and with
`setApplicationMenu(null)` there was no View → Reload to get back, so the app was bricked
until relaunch. `will-navigate` and `will-frame-navigate` refuse it now, and the gesture does
the useful thing instead: the renderer's `drop` handler routes the file through
`media:prepare` like any other source. **`MediaProxy` could always serve local files
(`/local/<token>`) and the engine is source-agnostic — the capability was built and had no
entry point,** so the app could finish a download and then not play it from disk. File → Open
and drag-and-drop are both that entry point.

**F12 was bound twice and the app's own binding could never fire.** `before-input-event`
toggled DevTools *and* called `preventDefault()`, which suppresses the page keyboard event —
so `App.tsx`'s F12 handler never ran and `ProviderInspector`, which has no other entry point,
was unreachable. DevTools is `Ctrl+Shift+I` only now. **Reload is gated on `app.isPackaged`**:
`Ctrl+R` is browser muscle memory and in a packaged build it destroys the renderer — playback
stops, the open page is lost, an in-flight search is abandoned.

**`Menu.setApplicationMenu(null)` cost more than chrome.** On macOS, Cut/Copy/Paste/Select-All
are menu *roles*, not native text-field behaviour, so `Cmd+C` did nothing in the search box —
and there was no Quit, no About and no zoom reset anywhere. A real menu is back, hidden behind
Alt on Windows and Linux via `autoHideMenuBar`. It is also what makes any shortcut
discoverable at all.

### `aria2` was pinned to port 6800 and told nobody when it failed (2026-08-27)

6800 is aria2's documented default, so the people most likely to collide with it are the ones
already running aria2 — which is this app's technical audience. `stdio: 'ignore'` discarded
the reason, and `start()` returned `true` the moment `spawn` returned: **a port conflict is
not a spawn error.** aria2 starts, fails to bind and exits a few milliseconds later, so
`isRunning()` answered true for a dead process and every `addUri` after it failed with a
message about the *download*. It now probes upward from 6800 by test-binding, captures stderr,
and reports success only once the RPC actually answers (`getVersion`). `getLastError()` carries
the reason. A silent downgrade to the slow HTTP path is the failure mode this repo keeps
having to fix.

### The media proxy's tokens were `1`, `2`, `3` (2026-08-27)

Every response carries `Access-Control-Allow-Origin: *` so that ffprobe, hls.js, Shaka, mpv and
an external VLC can all read from one door — which is correct and load-bearing. Combined with
sequential tokens it meant **any page open in the user's browser could fetch
`http://127.0.0.1:<port>/stream/1` cross-origin, read the body, and walk the integers to
enumerate the session's viewing.** The ephemeral port is a speed bump, not a control. Tokens
are 16 random bytes now (`[0-9a-f]{32}` in all five route regexes), `tokensByKey` keeps them
stable so nothing downstream changed, and a `Host` header that does not name loopback is
refused — binding to 127.0.0.1 says nothing about DNS rebinding. Pinned by two new cases in
`mediaProxy.test.mts`; `fetch` refuses to set `Host`, so that one uses a raw `http.request`.

### The font was fetched from Google on every launch (2026-08-27)

`src/index.css` opened with `@import url('https://fonts.googleapis.com/…Inter…')`, so a
*packaged desktop app* sent the user's IP and User-Agent to a third party on every start —
invisibly, in an app whose users frequently run a VPN precisely to avoid that. It also failed
silently offline and hung before falling back where the host is blocked. Inter is vendored
into `src/assets/fonts/` (seven variable-font subsets, 213 KB; the non-latin ones stay because
provider titles are not English even though the interface is) and `src/assets/inter.css` is
generated from the Google CSS with the URLs rewritten. **Verify with
`grep -oE 'https://fonts[^)"]*' dist/assets/*.css` after a build — it must find nothing.** This
also unblocks a CSP, which would otherwise have to allow a third-party style and font origin.

### Licensing (2026-08-27)

The repository had **no `LICENSE` file** while being a port of a GPL-3.0 Android application,
vendoring 26 community extension repositories and bundling FFmpeg, mpv, aria2, yt-dlp and a
JRE. `LICENSE` (GPL-3.0, fetched from gnu.org rather than reproduced from memory) and
`THIRD-PARTY-NOTICES.md` now exist at the root, and `settings/AboutPanel.tsx` makes them
reachable from a *packaged* build where the repository is not — GPL-3.0 §6 asks that whoever
holds the binary can find the source. **The bundled FFmpeg builds are the GPL variants, not
LGPL**, and the notice says so; "FFmpeg" unqualified would be the kind of accurate-sounding
omission that file exists to avoid.

### Shared renderer primitives added in the same pass

- **`src/utils/useFlash.ts`** — twenty-odd call sites wrote `setToast(m); setTimeout(() => setToast(null), N)`
  with no cleanup. Two bugs: the timers **cross**, so flashing a second message two seconds
  later has the *first* timer clear it early (which reads as the app dropping a confirmation,
  exactly when someone is doing several things quickly); and every one set state after unmount,
  which these views do constantly. Durations stay per call site — they range 1500–5000 ms and
  unifying them would change what several screens do, the same argument `utils/format.ts` won.
  Note `flash` is stable but the linter cannot know that the way it knows a `useState` setter
  is, so it goes in dependency arrays.
- **`src/components/Poster.tsx`** — `PosterCard` handled a *missing* `posterUrl` and had no
  `onError`, so it handled the case that never happens and not the one that happens constantly:
  scraped poster URLs expire and 403 on hotlink checks, and the result was Chromium's broken
  image icon in the most-repeated component in the product. `HistoryView` had answered it with
  `display: none`, which is an empty bordered box instead. Each call site keeps its own
  `fallback`; flattening them to one glyph would be a worse screen, not a tidier one.
- **`src/components/EmptyState.tsx`** — every list route was one sentence of body text, so an
  empty library, an empty history and a search that found nothing were the same blank page. For
  a new user **every screen except Home is empty**, which makes this the cheapest onboarding in
  the app. The *action* is why it is a component: the search empty state now offers "Search all
  sources", which clears the stored scope and re-runs — previously reachable only by finding
  the scope picker and clearing it by hand.

Also: a global `:focus-visible` floor in `index.css` (eight `outline: none` sites, only some
with replacements — in a full-screen dark app a missed one means the keyboard user simply
loses the cursor); `prefers-reduced-motion` in `index.css`, which owns the `.spin` keyframe
every loading indicator uses and was the one stylesheet of four not honouring it; the poster
card is keyboard-reachable (`.poster-card:focus-visible` had been styled all along, which says
someone meant it to be); window bounds persist and are clamped to a display that still exists;
and an offline banner, because offline every provider fails separately and thirty honest
errors are less useful than one true sentence.

**Backlog:** `docs/roadmap/product-hardening-backlog.md` carries the remaining items with
evidence, fixes and acceptance checks. Items marked `needs-app-run` there have not been
verified in a running Electron app and should not be reported as done.

---

### §9–11 — Library, downloads, UI and lifecycle → `docs/agents/library-and-ui.md`

**Mechanism.** The library keys on `canonicalKey(title, year)` plus season and episode — never
on a URL, so nothing is orphaned when an address dies. Every detail page opened is written down
as a snapshot (display copy, provenance chain, every address known to reach the work) so a saved
page never opens blank. Downloads are addressed by **source variant**, not title. The settings
screen groups by subject and filters by *level*. All teardown happens on `before-quit`.

**Modules.** `cs3/libraryStore.ts` · `cs3/pageSnapshot.ts` + `src/utils/savedPage.ts` ·
`cs3/playedSource.ts` · `cs3/bookmarkStore.ts` · `downloadService.ts` + `aria2Engine.ts` ·
`download/resumePlan.ts` + `resumeWindow.ts` · `src/utils/downloadIdentity.ts` ·
`src/utils/resumePoint.ts` · `settings/settingsLevel.ts` · `cs3/backupService.ts`.

**Rules:**
- **A links handle is not a page address** (`cs3/extensionAddress.ts`). `loadLinks` takes an opaque provider blob, often JSON; `load` takes a fetchable URL. Storing one as the other is how saved rows opened blank.
- **`recordProgress` keys on `canonicalKey` + season + episode, never `mediaUrl`.**
- **A null episode means "Play"**, and the resume rule is *furthest episode with history wins* — never most-recently-updated.
- **A later load may add and may correct, but may never blank.** Episode listings are all-or-nothing, never field-merged.
- **A download is identified by its variant** (media + season + episode + provider + release name + resolution + quality + language + audio), never by title and never by a synthesised per-URL `infoHash`.
- **A partial download must be *proved* to match before resuming** — one ranged 64KB request answers range support, real length and byte identity together.
- **Completion is verified, not reported** — file exists, no `.part`, size within 1%.
- **`res.resume()` discards data but does not stop the transfer** (this has bitten three times) — destroy both request and response.
- **All teardown is on `before-quit`**, never `window-all-closed`. Any new service owning a socket, handle, timer or child process wires in there.
- **Escape is consumed in capture phase, only when it actually closed something** — otherwise closing a menu ends playback.
- **Never name a `.tsx` and `.ts` alike but for casing** — one name on Windows; the wrong resolution blanked the whole window.
- **Four reachability guards exist** (channel invoked/registered, component mounted, module constructed) — see §10.

---

## 12. Rules that cut across everything

- **Nothing is decided from a URL string.** Transport, codec, DRM and container all come from the body or the provider's own declaration. (Violated historically in `mediaInspector`, `ytdlpSources`, `providerLinks` — all fixed.)
- **A capability check ends in an allowlist, not a denylist.** `!UNSUPPORTED.has(x)` answers *yes* for everything it has never heard of, which is how an unknown codec was reported directly playable and failed in the element (§6.16). Absent information is not the same as unrecognised information: no codec means "do not block", a named unknown means "assume not". Same rule as `canPlayContainer`, which got it right first.
- **Anything reaching a third-party host goes through `electron/torrent/http.ts`**, which swaps in Electron's `net.fetch` (honouring `app.configureHostResolver` and the system proxy). **Node's `fetch` honours neither** — 5 call sites used global `fetch` and the DNS-over-HTTPS setting silently did nothing for them. `externalPlayerControl` keeps global `fetch` deliberately (loopback VLC control, no DNS or proxy involved).
- **Timeout ≠ cancellation.** `AbortSignal.timeout()` → `TimeoutError`; the caller's own controller → `AbortError`. Conflating them scores a provider for the app's own decision to stop waiting.
- **`describeError` always** (`src/utils/errors.ts`), never `x instanceof Error ? x.message : String(x)` — that idiom (82 copies across 37 files) collapsed every DNS/refused/TLS failure into `fetch failed`, and `groupingForm` then merged the whole network family into **one row** in the issue ledger, defeating its purpose. The real reason is in `error.cause`.
- **A GraphQL 200 can be a failure.** AniList returns bad-query/rate-limit/server-fault as **HTTP 200** with `errors` and null `data`, so `response.ok` was true and every caller rendered "no results". Check `errors`.
- **Byte formatters are parameters, not one function.** Release sizes use base **1000** (matching provider/tracker SI quotes); download progress uses base **1024** (matching the OS file manager). Deliberate, and must survive tidy-ups — `format.test.mts` derives expectations from the 8 original implementations. (Zero-placeholder differences are *not* deliberate; flagged, unresolved.)
- **Stores return whole state, never deltas.** `disabledSet.ts` (which stores *exceptions*, so new extensions work by default), `profiles:*`, and the scope trio must all agree, and rebuilding them from a delta is how they stop agreeing. **Bulk is the primitive.**
- **`util/disabledSet.ts` writes fields longhand** — `erasableSyntaxOnly` forbids constructor parameter properties.
- **The sidecar's stdout carries RPC frames and nothing else.** A stray `println` desyncs the channel; plugin logs, JVM warnings and stack traces are forced to stderr. Keep it that way.
- **Never bundle main-process runtime deps.** `vite.config.ts` externalises `dependencies` + node builtins (bare and `node:` spellings). WebTorrent's native `.node` binaries (`node-datachannel`, `utp-native`) must also be `asarUnpack`-ed.
- **A catch that reassures is worse than no catch.**
- **Prefer an honest empty answer with a reason over a synthesised one.**

---

## 13. Documentation: what to trust

**PRDs describe intent; the code describes reality. Where they disagree, trust the code and fix the doc.**

| Doc | Status |
|---|---|
| `docs/PRD/00-index.md` | Start here — F-1…F-5 findings, scope/cost baseline |
| `docs/PRD/31` | Drop-in compatibility commitment, ADR-10 |
| `docs/PRD/33` | Desktop as-built — **partially stale**: references `electron/cs3ArchiveLoader.ts`/`jvmProviderBridge.ts`, which don't exist (that role is `cs3/sidecarSupervisor.ts` + the sidecar); stale absolute Windows paths |
| `docs/PRD/34` · `35` · `36` | Torrent architecture · translation spike results · provider execution roadmap |
| `docs/PRD/39` | **Proposed, nothing built.** Superseded by 41 |
| `docs/PRD/40` · `40.1` | Playback engine PRD; **40.1 is approved and frozen, Tier 1 half-built** — see §6.11 before touching leases or telemetry |
| `docs/PRD/41` | **Proposed, nothing built** — read instead of 39. §2 is a measured Android-ecosystem account worth reading standalone |
| `docs/PRD/43` | Research 2026-09-03; items 1–4 built. §6's rule: a direct HTTP link is not an indexer result |
| `docs/PRD/44` | Research + proposal, §6–§8 not built. §5 is an 8-shape failure taxonomy from a 6,180-record log; read §6.1 before any failure-UI design |
| `docs/agents/*.md` | **The other half of this document.** `extensions.md` (§5) · `media.md` (§6) · `torrents-and-search.md` (§7–8) · `library-and-ui.md` (§9–11). Same authority as this file |
| `docs/docs_cs3/` | Android app architecture, 9 documents, written from source |
| `docs/roadmap/product-hardening-backlog.md` | Backlog. Items marked `needs-app-run` are **unverified in a running Electron app — don't report as done** |

Requirement ids in code comments (`ARCH-2`, `SEC-7`, `DROP-12`, `DSK-57`, `AC-D4`, `RISK-D1`) resolve inside `docs/PRD/` — grep the id.

---

## 14. Working agreements

- **Branching**: cloud/agent sessions develop on their assigned `claude/*` branch and push there. **Never push to `master`.** No PR unless asked.
- **Scope**: implement what was asked. Don't start on a PRD step because you read about it here.
- **Commits**: Conventional Commits, scope from the area (`feat(library):`, `fix(cs3):`, `feat(torrent):`, `feat(player):`, `docs:`, `chore(cs3_windows):`).
- **Comments explain *why*, not *what*.** Match the surrounding density. No narration of the obvious.
- **TypeScript `strict`.** Avoid `any` — the existing ones are IPC plumbing, not precedent.
- **Report honestly.** "Typechecks with `tsc -b`" is true; "tested" is not unless you ran `mvn test` or actually exercised the path. GPL-3.0 + third-party-indexer + community-plugin context makes overclaiming expensive.
- **Keep these files current.** Changing the IPC surface, adding a service, moving the sidecar
  contract, or finding a stale section — update it in the same commit. **Put it in the right
  file**: `AGENTS.md` for the map, the build, the IPC contract and rules that apply everywhere;
  `docs/agents/<area>.md` for detail only that area needs. Adding domain detail here is how the
  core grows back into something every session pays for. **Keep it dense**: facts, rules and
  measurements, not narrative — a post-mortem is worth one rule plus its number, not its story.
- **Do not vendor or commit**: `.cs3` archives, `library-jvm.jar`, `node_modules/`, `target/`, `dist/`, `dist-electron/`, downloaded `aria2c`/`yt-dlp` binaries. A `jar xf`'d sidecar jar is build output too — one branch merge carried 28 stray `.class` files beside their `.java` sources, and a stale compiled copy in the tree reads as a second, authoritative build.
- **Anchor every ignore rule naming a runtime directory.** A bare `extensions/` in `cs3_windows/.gitignore` matched **any depth**, silently swallowing `src/components/extensions/` — the whole extensions screen vanished from every fresh clone and broke `tsc -b` unconditionally. Rules are anchored now (`/extensions/`, `/data/`, `/bin/`).

### Merging from `claude/refine` / `claude/android-media-desktop-dybtml`

`refine` forked at `881456a`, **before this branch's streaming stack existed** — it has no `providerLinks.ts`, `subtitles/convert.ts`, `clearKey`/`shakaSession`, `build-media-runtime.mjs`, or (due to the unanchored ignore rule) extensions screen at all.

**Cherry-pick additively; never take a whole-file rewrite from it.** That is why the 25-commit IPC refactor (`main.ts` → 24 `ipc/*` modules, `60da305`) was **not** merged — its `main.ts` predates this branch's 222-channel surface (written against 188) and would delete modules it never knew existed. It can be re-derived as a template later, not cherry-picked.

Rule: take features and refinements; leave anything touching playback behaviour, request headers or the native engine — this branch's proven streaming stack is the asset being protected. Not merged, each a behaviour change to a working path: `ext.to` gateway; mpv embedding/`mpvSurface.ts`; concurrent-open/end-of-playback `MpvEngine` changes; HEVC `hvc1` tagging; `unreadableSource`'s loopback-failure split; media-module logging-init changes.

**Never take a prebuilt jar from a branch whose sources you haven't compared** — `refine`'s `cs3-provider-bridge.jar` predates this branch's `:app` activity shims, and taking it for an unrelated fix would have silently regressed all of them: no compile error, no failing test, just extensions losing providers again.

### A gap a missing-class count cannot see is not a gap that doesn't exist

The `WebViewResolver` stub (§5.9) resolved perfectly and did nothing, and four rounds of shim work never surfaced it. When auditing compatibility, "zero `NoClassDefFoundError`" is not "zero gaps" — compare against the Android source's *behaviour*, not just its type graph (`docs/roadmap/android-parity.md`).
