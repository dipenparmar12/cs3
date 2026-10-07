# AGENTS.md — CloudStream 3 Desktop

Context for AI coding agents. `CLAUDE.md` symlinks here.

**Read this before searching the codebase. If it contradicts the code, the code wins — fix this file in the same commit.**

This is the core. Per-area detail lives in `docs/agents/` — see **Domain notes** below and
read the file for the area you are about to change.

**Doc shorthand** (everything under `docs/agents/`): `extensions.md` §5 · `media.md` §6 · `torrents-and-search.md` §7–8 · `library-and-ui.md` §9–11 are the domain files; **`fn:<area>`** = `field-notes/<area>.md`, area ∈ extensions · media · search · ui · metadata (dated post-mortems, verbatim, each with a contents list).

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
| Sidecar tests | `sidecar/` | `mvn test` (50 tests) |
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
| Startup profiler only | `cs3_windows/` | `bun run test startup-profile` (7 cases, blocks the loop for real) |
| Startup queue only | `cs3_windows/` | `bun run test startup-queue` (9 cases, real timers) |
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
| Extension job queue only | `cs3_windows/` | `bun run test jobs` (13 cases, pure — gated runners, no JVM) |
| Saved searches only | `cs3_windows/` | `bun run test saved-searches` (9 cases, temp dirs) |
| Settings search only | `cs3_windows/` | `bun run test settings-search` (6 cases, pure) |
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
| Provider catalogues (`getMainPage`) | root | `node tools/e2e/catalogue-e2e.mjs --installed netflix,prime` — every row of the installed providers via the sidecar, classified OK/MULTI/EMPTY/DROPPED/ERROR; tells provider-side from app-side |
| Fresh links for a reported title | root | `node tools/e2e/links-e2e.mjs --case "Hindmoviez=Dune Part Two" --out l.json`, then `cs3_windows/node_modules/electron/dist/electron tools/e2e/links-play.cjs l.json` — re-resolves through the installed providers and fetches each link via Electron `net.fetch` (HLS down to a segment), also under the default referrer policy. Issue-file links expire within hours; re-resolve before judging |

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

**Bump `RUNTIME_GENERATION`** whenever the shim/bridge/translator changes in a way an already-provisioned copy would get wrong (currently **16**; one paragraph per generation in `runtimeProvisioner.ts`). Debugging "a class that should exist doesn't"? Compare `%APPDATA%/<app>/cs3-runtime/runtime/` against `sidecar/runtime/` first.

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
│  wires every service as a singleton, 341 ipcMain.handle   │
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

`electron/preload.ts` is the **only** bridge. `contextIsolation: true`, `nodeIntegration: false`. 341 channels in 43 namespaces (counted 2026-10-07; full generated table in `docs/docs_cs3/architecture/api-services.md`): `api: torrent: playback: search: indexer: sources: download: extension: library: datastore: binary: dialog: pages: natives: ott: issues: profiles: media: mpv: external: player: analytics: bookmarks: discover: subtitles: log: runtime: history: home: backup: network: ratings: metadata: regions: privacy: interactions: diagnostics: components: videos: window: app: shell: storage:`.

**Four things change together when crossing the boundary:** 1) service in `electron/`, 2) `ipcMain.handle('ns:name', …)` in `main.ts`, 3) method + type in `CloudStreamElectronAPI` in `preload.ts`, 4) caller in `src/`. Shared types live in `src/types/{api,plugin,torrent,download,player,media,mpv}.ts` and are imported by both sides — intentional, not a layering mistake.

Fallible handlers return an **envelope** `{ ok, error?, …payload }` and never reject, via `main.ts`'s `fail()`.

| Channel group | Shape & rules |
|---|---|
| `playback:*` | **Push.** `playback:start` returns a session id immediately; `playback:update` snapshots follow. Player renders from snapshots before a stream exists. `playback:start`'s `{ persistent }` (standard mode) walks every source and, once they all fail, widens to every provider and indexer **once** by itself — the "Find more sources" press made for the viewer; snapshots carry `retryingElsewhere` and `tried`. A source the viewer picked is still the only one tried. |
| `discover:*` | `sections({ hidden })` fetches only the rows switched on; `rows()` lists every row, shown or not, **without fetching** (for the row picker); `more(section, { skip, page })` pages one row for "Show all" — offset for Stremio/TMDB/AniList, page number for built-in providers; empty means the end. |
| `search:*` | **Push**, same reason. `search:start` → opening snapshot; `search:update` carries results/progress; `search:cancel` abandons the rest. `api:suggest` is push-shaped too: it answers instantly from cache with a `done` flag and `search:suggestUpdate` carries each catalogue as it lands — measured, the three answer 170–935ms apart, so one reply would spend the fastest two on the slowest. Main keeps **one** `AbortController` for it; a new keystroke aborts the previous fan-out. 15 providers = 15 independent scrapes (Cinevood 20s vs ARD 350ms) — request/response would spend the whole time on a spinner. `api:searchAll` remains for callers needing a full answer. Required splitting `searchAll`'s single batched RPC into one RPC per provider (`searchEach`), capped at 8 in flight. |
| `pages:*` | **Read-shaped**, deliberately unlike the two above — the answer is already on disk. `getSnapshot/remember/setPinned`. **Capture is not exposed**; it happens in `ContentService.load`. |
| `media:*` | `inspect` classifies without starting; **`prepare` is the only source of a playable URL**; `switchAudio/closeStream` drive a live session; `setCapabilities/getCodecProbes` carry renderer-measured decoder support; `getPlaybackDiagnostics` returns per-attempt telemetry. **No channel hands back an unclassified URL.** Provider-declared `isDash`/`drm` outrank the probe; DRM skips the probe entirely. |
| `mpv:*` | `open` (prepared URL only), transport/track controls, `mpv:update` snapshots, `get/setPolicy`. No raw-link channel, same reason as `media:*`. |
| `natives:*` | Built-in provider roster: `list/setEnabled/addAddon/removeAddon` (Stremio addons by manifest URL), `addServer/removeServer` (Jellyfin/Emby — `addServer` takes a key, never returns one). Separate from `extension:*` (an inventory of *downloaded* things) because a compiled-in provider has no repository. |
| `ott:*` | `listPlatforms/getCatalog/getCatalogPage/getSearchScope/getSuggestions/installSuggestion`, plus `getProviderCatalog(platformId, provider, {refresh})` (one provider at a time so the page draws progressively), `listAllPlatforms`, `setPlatformEnabled/setPlatformsEnabled`, `setPinnedPlatforms(ids)` (whole ordered list). **Sidebar visibility:** a stored choice wins; with none, the three listed platforms and every discovered non-adult `ready` platform are shown (`OttService.shownPlatformIds`) — adult ones need an explicit pick. Right-click → Remove stores `false` (hides only; provider stays enabled). Enabled/pinned state lives in the datastore, so the `settings` backup section carries it. `getCatalogPage`/`getProviderCatalog` answer from `CatalogueCache` unless `refresh`. **`installSuggestion` takes a repository id, never a URL** — a URL would let "set up Netflix" install arbitrary code. Only Netflix/Prime Video/Disney+ are hand-listed; every other platform is discovered (`provider:<name>`) from enabled providers with `hasMainPage`, flagged `adult` from the provider's `NSFW` type. |
| `profiles:*` | `list/activate/create/rename/duplicate/delete`. Every one answers with the **whole** state (list + active id + unnamed draft) — those three must agree and rebuilding from a delta is how they stop agreeing. Profiles sit **above** `SearchScopeStore`; each change resolves to a `SearchScope` and writes it through, so nothing downstream learns profiles exist. `search:setScope` routes through the same layer. |
| `extension:*` | `addRepository` and `installRepository` are deliberately two actions (fetch+persist vs. tens of downloads/translations). `rollback` restores a replaced archive. **The screen does not call them directly any more**: `enqueueJobs(requests)` queues install/update/add/install-repository and returns the whole queue; `extension:jobsUpdate` pushes it (≤ every 120ms); `cancelJob/cancelQueuedJobs/retryJob/clearFinishedJobs/getJobs`. One job per target — a second press joins it. The direct handlers stay for callers that await one result (OTT setup, bootstrap). |
| saved searches | `search:saveResults({query, results, providers, indexers})` → `{ok, saved}`; `search:listSaved` (summaries, no rows); `search:getSaved(id)` (re-teaches `ContentService` the rows' alternate routes); `search:removeSaved`. The renderer draws a saved search as a finished `SearchSnapshot` with `savedView` set, so the screen always says it is saved and when. |
| `regions:*` | `get` → `{selected, needsSelection, suggested, regions}`; `set(selection, {crossRegion?})` stores and sets up what it newly calls for in the background (`extension:bootstrapProgress`), returning `affected` — repositories a removed region leaves behind, **for review only, never disabled here** (PRD-54). |
| adult gate | `get/setAdultMode`, `unlock/lockAdultForSession`. `mode` is the setting; `allowed` is whether adult providers are offered *now* (they differ under `ask`). **The unlock is in-memory only and never persisted**; `unlockAdultForSession` refuses unless mode is already `ask`, so a renderer cannot use it to change the setting. **One source of truth:** `BootstrapService` owns it and `onAdultChange` fires on every mutation (set, unlock, lock, backup restore) → `adult:changed` push → `src/utils/useAdultMode.ts` is the renderer's only copy. Every surface (Settings, Extensions footer, onboarding) uses that hook or `AdultContentSetting`; never keep a local copy or write a boolean (`setAdultAllowed` flattens `ask`). |
| `download:*` | **`request`** = a button press (reads task state, resumes/recovers/refuses, reports which) vs **`enqueue`** = "create this task". `preview` answers where a file would land, read-only — the renderer cannot compute the path (folder layout, variant segment and collision suffix come from the whole queue). `get/setConfirmPreference` (`ask`\|`immediate`, default `immediate`). |
| `issues:*` | `list/annotate/report/clear` — the extension issue ledger; a third surface beside `log:*` and `diagnostics:*` (§5.5). |
| `interactions:*` | **Batched read.** `summarise(queries)` answers one screen's worth of card states in a single call — a join over the library, the outcome ledger, the download queue and the source cache, not a sixth store. `visit(title, year)` records that a details page opened; `clearVisits` is the only control over that ledger. Keyed on the *title* for everything about the work and on the *address* for everything about one source of it — see `cs3/titleInteractions.ts`. |
| `videos:*` | `resolve(pageUrl)` turns a trailer's page into a stream. Returns a **provider-level, proxied** address, never a playable one: the renderer hands it to `media:prepare` like any other source, so that channel stays the only source of a playable URL. Separate from `metadata:*` because it spawns a process on a button press, where a metadata record is something nothing waits for. |
| `external:*` | Drives a handed-off player, pushes `external:update` with a `capability` flag. |
| window pins | `window:set/getAlwaysOnTop` for the app window; `mpv:setOnTop`/`setVideoEnabled` for mpv's own. |
| `app:getStartupProfile` | **Read-shaped.** Returns this launch's stages, marks, stalls and the background queue's state. Developer mode on the renderer side, but the *channel* is unconditional — a reporter being told to turn developer mode on before they can answer "why is it slow" is the diagnostic being unavailable exactly when it is wanted. |

**`ipcRenderer.invoke` on an unregistered channel rejects — there is no `{ok:false}` envelope.** Seven channels were once strings that had stopped matching (invisible to `tsc`): `binary:setupBinaries` invoked-never-registered made the first-run installer *always* fail, and `BinarySetupModal` caught the rejection and rendered a *reassuring* notice. **A catch that reassures is worse than no catch.** `electron/ipcSurface.test.mts` (`bun run test ipc`, runs first) pins every diff lexically, mutation-verified in all three directions. Exceptions go in commented allow-lists — "I'll wire it later" is not a valid entry.

`metadata:*` is extended title metadata — `metadata:getExtended`,
`metadata:peekExtended`, `metadata:clearCache`, and the push channel
`metadata:extendedUpdate`. Separate from `api:loadMedia` because it answers a
different question at a different cost: `api:loadMedia` is what the app can
**play** and a Play press waits for it; this is what the title **is**, from four
third-party catalogues, and nothing waits for it. Push-shaped for the same
reason `search:*` is — the record is emitted partial and refilled as each source
lands. See "The cast list was a row of names" in `fn:metadata`.

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
| `preload.ts` | The typed API surface. `subscribe()` unified 14 listener/teardown pairs (teardown prevents accumulation across React remounts). |
| `datastore.ts` | Persistence. Reimplements **Android's 6-bucket key grammar** (`_Bool`/`_Int`/`_String`/`_Float`/`_Long`/`_StringSet`) so Android backups import losslessly. Non-transferable keys (tokens, device ids, cache paths) are filtered on import by regex. |
| `contentService.ts` | The content pipeline orchestrator: `search → MetadataProvider → getSources → IndexerRegistry → startStream → TorrentEngine`. Extension providers are consulted first; torrents are the fallback. A `cs3ext://` media URL bypasses indexers entirely — the provider already knows its links. Also the one funnel that captures page snapshots. |
| `playbackSession.ts` | Owns one "user pressed play" interaction. Opens the player *before* a stream exists and streams discovery progress into it, so the viewer can start the best source found so far instead of waiting for the slowest indexer. Also owns in-player source switching and refresh. Retains the `SourceQuery`, which is what makes refresh possible without navigating back. |
| `searchScope.ts` | Which sources a search may ask. **A selection is a strict filter, not a preference** — see `fn:search` ("Search scope: selecting a source is a filter"). |
| `searchSession.ts` | One "the user pressed search" interaction. Push-shaped like `playback:*`: fans out per source, emits a snapshot as each answers, and can be cancelled. |
| `searchSuggestions.ts` | Title autocomplete merged across Cinemeta + TVmaze + AniList, deduped on normalised title+year, misspelling-tolerant. Their blind spots do not overlap — see the file header for what was measured about each. `instant()` is synchronous and answers from an exact or longest-prefix cache hit with no I/O; `suggest()` publishes per source and runs the genre lookup *behind* the answer. |
| `searchHistory.ts` | Past search *queries* (not results — a cached result set goes stale silently), stored via the datastore so backups carry it. |
| `sourceCache.ts` | Resolved sources, with expiry tracked **per source**: magnets never expire, provider links carry a deadline read from the URL (`Expires`/`exp`/JWT claim, case-insensitively) or a short TTL. A cache hit can be partially stale — good magnets beside dead links — and `read()` reports that split. `forget(keys, s, e)` clears one title/episode (both `origin` and `#all` scopes) — Media Details → Sources → *Clear cached* (`sources:clearForMedia`), which also withdraws the prefetcher's answer and the page's retained rows before re-resolving. |
| `subtitleService.ts` | Online subtitle search via the keyless OpenSubtitles v3 Stremio addon, keyed by IMDb id. Converts SubRip to WebVTT, which is **not optional**: `<track>` rejects `.srt` silently. |
| `media/mediaInspector.ts` | ffprobe → `MediaMetadata`; transport and DRM classified from the manifest body, never the URL. |
| `media/decisionEngine.ts` | Pure decision: metadata + host capability + DRM → `TransformationPlan`. Tested exhaustively; see §6.3 in `media.md`. |
| `media/playbackEngine.ts` | Inspect → decide → open, and the only way to obtain a URL to attach. Owns playback telemetry. |
| `media/mpvEngine.ts` | The native engine. Spawns mpv, drives it over JSON-RPC, and reports snapshots. For the streams Chromium will never decode — see `fn:media` ("The native engine: mpv"). |
| `mediaTranscoder.ts` | Executes a `TransformationPlan` as a live fragmented-MP4 stream on loopback, plus embedded-subtitle extraction. |
| `metadataProvider.ts` | TVmaze + AniList. **Catalogue metadata only, never streams.** Its key output is the IMDb id, which indexers match on far better than free text. |
| `cinemeta.ts` | Stremio Cinemeta metadata provider, prioritised in search. |
| `metadata/enrichmentService.ts` | Cast, crew, ratings, debut date and production notes, merged from four keyless catalogues. Push-shaped and cached; never on the playback path. See `fn:metadata`. |
| `metadata/merge.ts` | Merging what several catalogues say about one title. Pure and tested — every wrong answer here is silent and plausible. |
| `metadata/wikidata.ts` | Cast **with characters** for film, plus crew, release date and box office. The keyless answer to the one thing TMDB is usually reached for. |
| `metadata/tvmaze.ts` | Cast and crew with real photographs, for television. Two endpoints on a host the app already talks to and had never asked. |
| `metadata/anilist.ts` | Characters, their voice actors in every language, and staff, for anime. Both name pairs in both scripts. |
| `metadata/wikipedia.ts` | "Behind the scenes" prose. The article is a Wikidata sitelink, **never a search** — see `fn:metadata`. |
| `metadata/cinemetaExtras.ts` | The half of Cinemeta's reply the app already pays for and drops: director, writer, `released`, country, awards, trailers. |
| `src/utils/metadataDisplay.ts` | Rendering rules for the above. Pure; owns the partial-date trap. |
| `pluginManager.ts` | `.cs3` repository discovery, plugin-list parsing (mirrors upstream `RepositoryManager.kt`), download + SHA-256 verification, Android-style install paths, then hands archives to the sidecar. Also owns the enable/disable cascade — see the extensions-screen section. |
| `cs3/providerLinks.ts` | Reads a provider's reply without guessing: link type, DRM, playlist parts, audio-track headers. Pure and tested — every wrong answer here looks like a bad provider rather than a bad routing decision. |
| `pluginAnalyzer.ts` | Static compatibility classification of a plugin before it is trusted. |
| `cs3/sidecarSupervisor.ts` | Spawns and supervises the JVM child process; line-delimited JSON-RPC over stdio; never throws on a missing/broken sidecar. Also routes the *reverse* frames — see `webViewHost.ts`. |
| `cs3/webViewHost.ts` | The browser the JVM cannot open for itself. Offscreen `BrowserWindow` per resolve, `webRequest` watching for the provider's intercept pattern, cookies harvested for `CloudflareKiller`. |
| `cs3/webViewMatch.ts` | What a page's subrequests mean. Pure and tested, because every wrong answer here is attributed to the provider instead. |
| `cs3/extensionUpdater.ts` | Scheduled OTA extension updates. "Update all" re-checks rather than reading the persisted snapshot; an update installs into the directory the *record* names and downloads from the repository the *update* names. Auto-installs on every launch by default (Android parity); only a choice made in Settings overrides that. |
| `cs3/bootstrap.ts` | First-run install of the bundled repositories, and the adult-content opt-in. |
| `cs3/diagnostics.ts` | Provider failures with the context that makes them reproducible. See `fn:extensions` ("Diagnosability"). |
| `cs3/extensionIssues.ts` | The **durable tally** of distinct extension problems, across restarts and log rotation. `diagnostics` is one failure shaped to be pasted; the logger is a per-session transcript; this is the "count before fixing" list. See below. |
| `cs3/providerRegistry.ts` | What each archive registered, keyed by size+mtime+runtime generation. Hydrates the provider list at launch **without starting the JVM** — the fix for a 57–67s first search. See `fn:extensions` ("The first search cost a minute"). |
| `cs3/providerRecovery.ts` | Making a provider a saved page names answer again. `planRecovery` is pure and returns the ordered steps, because the button has to say what it will do — a repository fetch and a DEX translation — *before* it starts. It fixes the whole enable cascade, not just the provider switch: the old handler called `setProviderEnabled` alone, which on the common post-restore state (repository off, or extension not installed at all) completed successfully and changed nothing observable. It never adds a repository the app was not already told about — a `cs3ext://` address travels in library rows, and accepting a URL out of one would make "reopen my saved page" a way to install code from anywhere. |
| `cs3/titleOutcomes.ts` | How each title last behaved, so a dead row is not clicked twice. |
| `cs3/ottPlatforms.ts` | The OTT platform table and the rule for deciding which provider is one. Pure and tested — a matcher one character too loose fills the Prime Video page with a torrent aggregator called PrimeWire and nothing says so. |
| `cs3/nativeProviderRegistry.ts` | The roster of providers compiled into the app, and the native mirror of `enabledProviderNames` — the adult gate and the disable cascade, in one place. |
| `cs3/nativeProviders/types.ts` | The `NativeProvider` interface and `cs3native://` addressing. Pure. |
| `cs3/nativeProviders/internetArchive.ts` | ~52,000 public-domain films, documentaries and classic TV. The query form is measured, not designed — see `fn:extensions` ("The native provider lane"). |
| `cs3/nativeProviders/peerTube.ts` | Federated video via SepiaSearch. A video's files live on its **own** instance, not the search host. |
| `cs3/nativeProviders/iptvOrg.ts` | 17,230 free-to-air live streams from the open iptv-org dataset; ~70% answer. |
| `cs3/nativeProviders/stremioAddon.ts` | Any Stremio addon, by manifest URL. `idPrefixes` is a hard constraint — an addon 500s on an id it does not speak. |
| `cs3/nativeProviders/jellyfin.ts` | The user's own Jellyfin/Emby server. The key travels as a header, never in a URL, and never reaches the renderer. |
| `cs3/ottService.ts` | The same table against what is installed: availability, the search scope for a platform page, and the repositories to offer when nothing serves it. Also owns discovered platforms and pins. |
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
| `torrent/torrentEngine.ts` | WebTorrent + loopback HTTP server with range support. Sequential pieces; the player only ever sees `http://127.0.0.1:PORT/…`. Warmed at launch — see §7.1 in `torrents-and-search.md`. |
| `torrent/torrentMetadata.ts` | `.torrent` bytes cached by infohash, verified against it. A cache hit means `add()` has the piece hashes synchronously and the swarm is needed only for bytes. Also builds the `xs` mirror URLs. |
| `torrent/torrentContents.ts` | What is actually *in* a torrent, as something a person can browse: seasons, episodes, samples, extras. Pure and tested for the reason `ottPlatforms.ts` is — every wrong answer is silent and plausible, and the viewer attributes it to the torrent. Extension decides the kind, never the folder; a sample is recognised by size ratio as well as by name. |
| `torrent/dhtNodeCache.ts` | The DHT routing table, node id and port, persisted. Turns a cold bootstrap into a warm one. |
| `torrent/indexerRegistry.ts`, `indexers/*` | 19 built-in adapters — 4 Stremio stream addons, 12 JSON/RSS APIs, 3 HTML scrapers — plus Torznab (Jackett/Prowlarr). Counted from the registry switch on 2026-10-07 (17 on 2026-09-03; older lines said 7). |
| `torrent/ranker.ts`, `releaseParser.ts` | Release-name parsing (quality/codec/group/season/episode) and result ranking. |
| `externalPlayerControl.ts` | Two-way control of VLC over its HTTP interface. Capability is declared per player, never assumed — see `fn:media` ("External players are driven"). |
| `media/inspectionStore.ts` | Persists what a probe found, keyed on the origin URL. The measurement only; the verdict is recomputed. |
| `downloadService.ts`, `aria2Engine.ts`, `ytdlpEngine.ts`, `binaryDownloader.ts` | Downloads via aria2c RPC with an HTTP fallback; portable `aria2c`/`yt-dlp` binaries are fetched on first use. |
| `src/utils/deadRows.ts` | Which search results are worth showing. `no-sources` hides; `app-error` never does — see `fn:search` ("Results that resolve to nothing are held back"). |
| `src/components/player/useFloatingPlayer.ts` | Picture-in-Picture, the window pin, the background policy and the Media Session record. |
| `src/components/settings/settingsLevel.ts` | Simple versus Everything, and what `advanced` means. |
| `savedSearches.ts` | Result sets the viewer chose to keep (Save results). Own JSON file, hydrated on first use, 50 searches × 200 rows; same query + same scope updates in place. Rows are page addresses, which do not expire. In the backup table as `savedSearches`. |
| `subtitles/convert.ts` | SubRip/ASS/SSA → WebVTT + charset detection. |
| `subtitles/subtitleLibrary.ts` | Subtitles saved for reuse, in `Downloads/CloudStream/Subtitles` as `.vtt`, indexed by work (title+year+season+episode), never by stream URL. Same source twice = reuse unless `refresh`. IPC `subtitles:download/listSaved/readSaved/removeSaved`. The player auto-loads the preferred language (English default; an explicit Off is respected): stream track → saved file → online search, never blocking playback. Timing offset moves cues (element) or sets `sub-delay` (mpv). |
| `cs3/privacyMode.ts` | Incognito (PRD-52). `isPrivateSession()` is checked **at write time** by every automatic-activity store (history, progress, played source, discovered-source merge, search history, title outcomes, visits, provider analytics) — never a renderer copy. `SourceCache.setVolatileMode` keeps private discovery in memory. Active flag persisted only with `rememberPreference`. IPC `privacy:getState/setActive/updateSettings` + push `privacy:changed` (whole state); File menu + Ctrl+Shift+N. Explicit actions (bookmarks, downloads, subtitle Download) are not gated. |
| `mediaProxy.ts` | Loopback HTTP with provider headers applied; HLS/DASH manifest rewriting; range handling. |
| `media/mpvEmitPolicy.ts` | Which mpv snapshots go now and which may wait a tick. Pure, tested. |
| `media/toolCapabilities.ts` | What this ffmpeg build supports, remembered per binary (path/size/mtime) and asked from a worker thread — see §12 on `spawn`. |
| `anilist.ts` | The one AniList GraphQL client (3 hand-rolled POSTs were merged). |
| `cs3/extensionAddress.ts` | `looksLikeLinksHandle` / `looksLikePageAddress` — a links handle is not a page address. |
| `cs3/clearance.ts` + `clearanceRelay.ts` | Bot-wall clearances owned by the app: the webview partition's cookie jar is the store, one solve per host (single-flight), 10-min cooldown after a failed solve, Chrome-shaped UA. Serves the JVM (`clearance.get/invalidate/fetch`) and the indexer client alike. Pure, tested (`bun run test clearance`). See §5.15. |
| `cs3/hostDeadline.ts` | How long the host may work on a call the sidecar is waiting on. Pure, tested; **the worker stops before the waiter does**. |
| `cs3/archivePlacement.ts` | Replacing an archive Windows still holds: retry the rename, then place beside it and sweep the held copy later. Pure, tested with an injected filesystem. |
| `cs3/extensionJobs.ts` | The background queue behind the extensions screen: install, update, **uninstall**, add repository, install repository (expanded into one install job per extension). 3 at once, one job per target, failures kept with a reason and a retry, whole-state snapshots. Install and update join each other; an uninstall against an active install/update (or the reverse) is **refused** with a reason (`enqueue` returns `refused`), never joined. Uninstall runs under `PluginManager.oneAtATime` (`uninstallPluginExclusive`). Pure apart from the injected runner. |
| `src/components/extensions/bulkSelection.ts` | The Installed tree's filter (`filterTree`, the one the tree renders) and bulk selection: keys `ext:`/`prov:`; *Select all matching* takes an extension whole only when all its providers are shown; hidden selections are kept but never acted on; a provider under a selected extension is acted on through it; Enable/Disable count only what would change; extensions held by a job are left out with the reason. `BulkActionBar` + `BulkConfirmDialog` (repository -> extension -> providers, plus search-scope/profile references) read the same `planBulk`. Tested (`bun run test bulkSelection`). |
| `cs3/starterPlugins.ts` | Which extensions a new install starts with: the viewer's languages, working before beta before slow. Pure, tested. |
| `cs3/regions.ts` | PRD-54: region table, catalogue `regions`/`languages` (fallback derived from `language` text), selection → add/install plan, removal review, locale suggestion. Pure, tested (`bun run test regions`). |
| `cs3/rpcResult.ts` | `RpcResult` + `isTransportFailure` — "the runtime never answered" vs "the answer was no". Pure, tested. |
| `cs3/titleInteractions.ts` | Every card's state, assembled. Owns **one** fact (a details page was opened) and joins the rest live. Batched, because a catalogue page is forty posters. |
| `metadata/videoTitles.ts` | What a promotional video *is*, read out of its own title — kind, label, season, ordinal, official. Pure, tested against real oEmbed titles. |
| `metadata/youtube.ts` | Keyless oEmbed: a video id → its real title, channel and thumbnail. 12 ids in **201 ms**, measured. A 401/404 means the video is gone and its card is dropped. |
| `cs3/catalogueCache.ts` | Provider `getMainPage` answers on disk (`cs3-catalogue-cache.json`), stale-while-revalidate: reads answer from cache, `refresh` re-asks; only successes stored, a failed/empty refresh returns the cached copy, identical in-flight requests shared. Flushed on `before-quit`. |
| `cs3/nativeProviders/*` | `types.ts` (`NativeProvider`, `cs3native://`), `internetArchive.ts`, `peerTube.ts`, `iptvOrg.ts`, `stremioAddon.ts`, `jellyfin.ts`. |
| `cs3/pageSnapshot.ts` | Last-known-good copy of every detail page opened, plus its routes and origin. |
| `cs3/playedSource.ts` | Which source actually played, per title+season+episode. |
| `cs3/searchOrder.ts` | Which provider the fan-out asks first; refuses any ordering that is not the same set. |
| `cs3/sourceScope.ts` | `origin` vs `all` discovery scope, and when to widen. |
| `cs3/sourceProfiles.ts` | Named search configurations — the state machine. Pure, tested. **All sources is a mode, not an erasure.** |
| `cs3/sourceProfileStore.ts` | Persists profiles, writes the effective scope through to `SearchScopeStore`. |
| `cs3/sourcePrefetcher.ts` | Finds sources while the detail page is being read. |
| `cs3/backupService.ts` | Backup/restore as a **table of sections**, not switch statements. |
| `downloadService.ts`, `aria2Engine.ts`, `ytdlpEngine.ts`, `httpDownloader.ts`, `fastDownloader.ts`, `binaryDownloader.ts` | aria2c RPC + HTTP fallback; portable binaries fetched on first use. |
| `torrent/indexerBudget.ts` | Per-indexer deadline from measured latency, escalating cooldown, fastest-first order. Pure, tested. |
| `torrent/botChallenge.ts` | Challenge vs block vs rate limit. Pure, tested. |
| `torrent/swarmHealth.ts` | Reachability, as distinct from known peers. |
| `torrent/http.ts` | **The injected fetch** — Electron's `net.fetch`. See §12. |
| `externalPlayer.ts`, `externalPlayerControl.ts` | Detection + two-way VLC control over HTTP; capability declared per player. |
| `logging/logger.ts`, `redact.ts` | NDJSON per-launch transcript, buffered, flushed on a timer. |
| `storage/appStorage.ts` + `storageCleanup.ts` | **Where everything lives on disk.** `<userData>/` is persistent (datastore, library, extensions, runtime copy, logs, backups — unchanged); `cache/` is re-creatable (torrent pieces, torrent-state, yt-dlp, the `cs3-*-cache.json` stores, moved there once from `userData` root on first launch); `temp/session-<t>-<pid>/` is this launch's working files (removed on `before-quit`); `temp/jvm/` is the sidecar's `java.io.tmpdir`. Downloads: the viewer's folder (`download_directory`, Settings → Downloads — previously a placeholder that saved nothing), else an existing `~/Downloads/CloudStream`, else `app.getPath('downloads')/CloudStream`. Cleanup deletes **only inside a directory carrying `.cs3-owned.json`**, a temp session only when its marker's pid is dead, never an `isActive` entry, never a folder the viewer chose. Background sweep 45s after launch; Settings → Advanced → Storage shows sizes, paths (developer mode) and per-area Clear via the owning service. Tested (`bun run test storageCleanup`). |
| `util/jsonFileStore.ts` | Debounced persistence (5 copies unified). |
| `util/disabledSet.ts` | The enable-cascade toggle (3 copies unified). |
| `startupProfile.ts` | What this launch cost, and where the main thread stopped answering. Stages, marks and **stalls** — the last is the only one that tells "busy" from "frozen". Imports nothing, and is the first import in `main.ts`. |
| `util/startupQueue.ts` | The prioritised background queue every post-window service registers with. Serial by default (provider registration), named lanes opt into concurrency, a failed task never blocks the ones behind it. |
| `util/prune.ts` | Drops empty keys so a merge cannot blank a known value — the mechanical half of the never-blank rule (§9.2). Was byte-identical in `bookmarkStore` and `pageSnapshot`. |

### Renderer modules worth knowing

| File | Responsibility |
|---|---|
| `src/utils/savedPage.ts` | Draws a page from its snapshot and folds a live answer over it **without blanking**. |
| `src/components/extensions/useExtensionJobs.ts` + `JobsTray.tsx` | The job queue as the renderer sees it — one module-level subscription shared by the tray, each row's button and the sidebar badge. `useOnJobsSettled` re-reads the tree when jobs finish (coalesced). |
| `src/utils/screenSearch.ts` + `components/ScreenSearch.tsx` | **Find on this screen** (Library, History) — distinct from the navbar's media search: filters what the screen holds, never fetches or asks a provider. Every word anywhere in the row's fields, accent/punctuation-insensitive, episodes by `S01E02`/`s1e2`/`1x02`. Ctrl+F opens it while one is mounted (`screenSearchAvailable`), else the media search; **Ctrl+K is always the media search**. Query survives the details round trip, forgotten on tab change. `historyStore` filters with the same matcher. Pure half tested (`bun run test screenSearch`). |
| `src/components/ui/` | Shared controls: `Button` (variants `default`/`prominent`/`ambient`/`destructive`, `size="compact"`, `loading`, `iconOnly` requires `aria-label`) over the existing `.btn` classes; `Dialog` + `DialogActions` (labelled, Escape consumed in capture, focus moved in and restored, Tab trapped, Cancel before the main action). Styles in `src/styles/ui.css`, loaded last. |
| `src/components/settings/settingsSearch.ts` | "Find a setting": every query word must appear in a row's label, note, ⓘ text or `keywords`. Pure, tested. Rows/groups filter themselves; whole panels are wrapped in `SettingsSection keywords=…`. |
| `src/components/library/SavedSourcesList.tsx`, `SavedSearchesList.tsx` | A library title's saved sources, grouped by episode, playable when the link is usable and "Find again" when it has expired; the Library's Saved searches tab. |
| `src/utils/errors.ts` | `describeError` — never returns empty; unwraps `error.cause`. |
| `src/utils/format.ts` | The byte formatters, kept as parameters (see §12). |
| `src/utils/sourceIdentity.ts` | `normaliseReleaseName` / `hasRealInfoHash`. |
| `src/utils/historyEvent.ts` | `historyEventForTask` — the one download-task→history-record mapping. Was spelled out field-by-field in `downloadService`, `App.tsx` and `VideoPlayer`; three copies of a fallback chain drift rather than break. |
| `src/utils/downloadIdentity.ts` | A download is addressed by its source variant, not its title. |
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
| `src/components/settings/StartupProfilePanel.tsx` | The startup profile, Developer mode. Stalls first, then slowest stages, then the background queue. |
| `src/components/ViewSkeleton.tsx` | What a lazily-loaded route shows while its chunk arrives. Fades in at 150ms, so the common case draws nothing. |
| `src/views/searchUiState.ts` | `SearchUiState` + `EMPTY_SEARCH_UI`. Its own module because `App` holds the value, and a value import of `SearchView` would have pinned that screen into the first paint. |
| `src/views/homeCategoryState.ts` | The row opened with "Show all", held by `App` for `searchUiState`'s reason: a title opened from the grid comes back to the same place. |
| `src/components/home/HomeRow.tsx`, `CategoryGrid.tsx`, `RowPicker.tsx` | A rail capped at `RAIL_LIMIT` (20) that draws only near the viewport; the infinite "Show all" grid; the per-row visibility picker (a hidden row is not fetched). |
| `src/views/ottRows.ts` | A streaming-service page's rows and what each `getMainPage` answer does to them. Pure, tested. **A provider declaring one unnamed row answers it with its whole home page** (NetMirror/CNC Verse/OttSource: 4–18 named lists, up to 340 items) — each list is its own row, as on Android. Catalogue items may have an empty `name` (poster-only); `mapProviderResults(..., { allowUnnamed })` keeps them for catalogues only. |
| `src/utils/homeRows.ts` | Hidden-row persistence (reads the old anime switch once) and page merging. Pure, tested. |
| `src/utils/releaseName.ts` | A file name tidied into a title — strict: cuts only at tokens no real title contains. Shown for rows the catalogues cannot place, and asked of other providers when a search widens. Pure, tested. |
| `src/components/Poster.tsx`, `EmptyState.tsx` | Shared primitives with per-call-site fallbacks. |

---

## Domain notes

Four areas carry more hard-won detail than one file should load every session, so their depth
lives in the domain files. **Each capsule below is self-contained**: the mechanism, the modules
that implement it, and the rules that must not be broken. You can work from a capsule alone.
Open the domain file when you need the *why* — the measurement behind a number, the failure a
rule prevents, or the history of a design you are about to change.

**Section numbers are continuous across the set**, so a cross-reference like `§6.10` resolves
whichever file you are in. The domain files carry the same authority as this one.

---

### §5 — Extensions, the sidecar and the android shim → `extensions.md`

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
- **Bump `RUNTIME_GENERATION`** whenever the shim, bridge or translator changes (currently **16**). The app runs a *copy* in `%APPDATA%`, not what you just built.
- **`cs3-provider-bridge.jar` must live in `sidecar/runtime/`** — same loader as `library-jvm.jar`, or `BasePlugin` resolves as two different classes.
- **The sidecar's stdout carries RPC frames and nothing else.** A stray `println` desyncs the channel; logs go to stderr.
- **Shim rule: concede the type, refuse the operation.** Never widen a parameter or return type to `Object` (it renames the method — `ShimSignatureTest` enforces this); never forge the package name; never fake a platform number.
- **`PluginHost.call` must catch `LinkageError`, not just `ReflectiveOperationException`** — `Class.getMethod` resolves every public method's types, so one missing class kills a whole extension after it registered.
- **A provider that works until you press Play** → check `KotlinNameRepair` first (dex2jar corrupts Kotlin mangled names).
- **Never reintroduce a synthetic or placeholder source.** Empty result plus a reason, always.
- **The adult gate is `PluginManager.enabledProviderNames`** — the single funnel search, scope, discovery, playback and downloads all pass through. It removes only **adult-only** providers (`NSFW` with no general type; `NSFW, Others` counts as adult-only). A **mixed** provider (9kMovies, Mp4Moviez: `Movie, TvSeries, NSFW` — 5 of 22 NSFW providers measured) stays available with adult off; its 18+ rows and explicit titles are screened instead (`src/utils/adultContent.ts`: `screenSections`/`screenLists` in `OttService` *after* the cache, `withoutAdultTitles` on search and recommendations). Upstream publishes no per-row flag — every title in 9kMovies' "18+ Movies" is typed `Movie` — so rows are classified from their own name/handle/titles; patterns are pinned against measured row names. With adult on, such rows are flagged `sensitive` and covered (not fetched) until the once-per-launch confirmation.
- **Built-in providers use `cs3native://`, never `cs3ext://`** (wrong-attribution failures).
- **Clearances are the host's, not the interceptor's** (`cs3/clearance.ts`, §5.15). Never keep `cf_clearance` per caller or re-solve without asking `clearance.get` first; never relay (`clearance.fetch`) for a host the jar holds no clearance for.
- **The WebView host must finish before the sidecar stops waiting** (`cs3/hostDeadline.ts`) — the reverse channel carries one deadline and both ends used to spend it.
- **A failed `load()` closes its class loader, and `unload` withdraws what the plugin registered.** A leaked loader holds a Windows handle on the `.cs3`, and every later update of that extension fails its rename with `EPERM` (measured: Ultima, which fails at `load()` on every launch, could never be updated). `unload` removes the plugin's entries from `APIHolder.apis`/`allProviders` and `extractorApis` by `sourcePlugin`, as upstream's `unloadPlugin` does. `PluginUnloadTest` pins both and fails on the old code.
- **Installs and updates from the screen are background jobs** (`cs3/extensionJobs.ts`). Downloads overlap; everything after the verified download in `installPlugin` — rename, translate, load — runs through `PluginManager.oneAtATime`, because overlapping loads mis-attribute providers. Any new install path must go through `installPlugin` or take that lock.
- **Replacing an archive goes through `cs3/archivePlacement.ts`.** Retry the rename for ~1.5s, then place the update beside the held file (`Name.hash.<sha12>.cs3`) and point the record at it; the held copy goes on `extension_displaced_archives` and is swept once released. Read an extension's archive from `record.filePath` (`archivePathFor`), never from the canonical path.
- **Extension updates install automatically on every launch by default** — Android parity; see `fn:extensions` ("Extension updates: three reasons \"Update all\" did nothing").
- **Nothing installs until the viewer picks regions** (PRD-54, `cs3/regions.ts`; first-run modal pre-ticked from the locale; existing installs asked once). Every matching verified repository is *added*; starter extensions (≤16, working before beta before slow, nothing marked down — `starterPlugins.ts`) are *installed* from repositories matched through a named region (any language) and from **bundled** global ones (filtered to the selection's languages). Unbundled global repos are added only; adult repos added only when allowed, never installed from. **Cross-region** (default on, `cs3_content_regions_cross`): every unmatched non-adult repo is searched for plugins whose `language` is *exactly* a selected one (`strictLanguage`) and removed again if none were found. The region system only adds — an installed repository is skipped, so a manual off is never undone; removal returns a list to review.
- The upstream jar lane exists but only **1.9%** of the corpus publishes one — don't plan work assuming it.
- **Shims, measured:** `android.net.Uri` is implemented (RFC 3986, never validates — `java.net.URI` throws on scraped URLs); `Handler` works (one executor per handler) and `Looper.getMainLooper()` is non-null; `Context.getSystemService` returns `null` (Android's contract); UI types throw `UnsupportedAndroidApiException` (demotes the tier, not a crash); `Intent`/`AlertDialog.Builder` build fine and refuse at `startActivity`/`show`.
- **A Kotlin companion is not inherited:** `CloudStreamApp.Companion` and `AcraApplication.Companion` each carry the methods; `PluginHost.invokeLoad` points both at the plugin's context before `load()`.
- `describeProvider`/`diffProviders` isolate per-provider failures — one unlistable provider must not discard the `ExtractorApi`s registered beside it.
- **Provider links are read, not guessed:** `ExtractorLinkType`/`isDash` come from the provider; torrent/magnet links go to the torrent engine with `fileIndex` unset; a playlist is numbered rows (`part 2 of 3`), never one truncated row.
- **Platform-page search** is scoped by `SearchOptions.providers` through `SearchScopeStore.override` and is never persisted. `Disney+ Hotstar` → Hotstar and `JioHotstar` are pinned by name, not by declaration order.
- **Updates:** a same-version republish counts only from the extension's own repository (a mirror's hash describes a different build); version bumps stay cross-repository; download from the *update's* repository, install into the *record's* directory; "Update all" re-checks live, never the persisted snapshot.
- **A timeout is not a verdict:** `PluginManager.inspect` returns `null` for `TRANSPORT_ERROR_KINDS`, never `T4_BLOCKED` (which triggers an update rollback).
- Provider origins are persisted (`cs3_provider_origins`) so a saved `cs3ext://` address can still say which extension owned it.
- Stremio `externalUrl`/`ytId` streams are dropped, not offered; a Jellyfin key bound to no user gives an empty `/Users`, reported as that, not "no results".
- A cloud container's egress proxy 403s provider hosts (`net52.cc`…): the streaming half of a repository can't be verified there — never set `bundled: true` from a cloud run. `diagnostics` `mode: 'current'` selects by context and says so when it falls back to recent history.
- More: `fn:extensions`.

---

### §6 — Playback and the media engine → `media.md`

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
- **ClearKey:** browser-decodable payload → `EME_NATIVE`; undecodable → ladder with `-decryption_keys`, **progressive only** (FFmpeg's DASH demuxer answers `Option decryption_key not found`, fatal to the whole command line); encrypted DASH plays only through Shaka `DASH_NATIVE`.
- **The forced retry** in `PlaybackEngine.prepare` routes to `NATIVE_MPV` when available and policy ≠ `off` (not for `EME_NATIVE`/DRM) and rewrites the returned capability, or `VideoPlayer` hands the URL back to the element that just failed.
- **`MediaProxy`:** `Accept-Ranges` is stated, never forwarded; a 200 answering a mid-file range is refused; never-served routes are evicted after served ones, newest first (`createdAt` vs `lastAccess`); bodies are read as bytes and decoded only to sniff; the reader is cancelled and upstream fetches carry an `AbortSignal` tied to the client socket; tokens are 16 random bytes and a non-loopback `Host` is refused.
- `wrap(url, headers, { boundedRanges: true })` is for hosts that refuse unbounded Range (YouTube DASH): first window 64 KB, total from `Content-Range`, status mirrors what was asked, a refused window is halved down to 64 KB.
- Never pass `--force-seekable` to mpv (a Range-ignoring origin makes it grind the whole file); never pass `--untimed` in the matrix (hides a stream that can't hold realtime).
- **Volume has two writers:** ignore incoming engine audio for `AUDIO_ECHO_MS` (700 ms) after a local change and never send an engine's own level back (`engineAudio`, cleared when the engine changes); `clampVolume` on element and mpv — `video.volume` throws outside [0,1].
- The native stage reports `onPausedChange` upward (element events never fire there) and does not forward buffering into `isBuffering` (that overlay is a torrent's story).
- `build-media-runtime.mjs` fails the build on a missing required component (`--allow-missing` overrides); mpv is `required: false` off Windows on purpose (the distro package is wired to VA-API/VideoToolbox).
- A test origin on 127.0.0.1 is never proxied (`wrap` leaves loopback alone) and measures nothing; verify a proxy regression test fails with the fix reverted. googleusercontent links expire (8 h signed, then `HTTP 400`) — re-resolving is correct, not a bug.
- More: `fn:media`.

---

### §7–8 — Torrents, indexers, search and ranking → `torrents-and-search.md`

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
- **Discovery defaults to `origin` scope** (only the providers that produced the row), widening to `all` automatically when nothing is found. A failed escalation leaves the narrow answer standing. **A self-widened result is offered, never auto-started** (`playbackSession.discover`): it was found by title, and a title match can be a different work (errors audit 2026-10-050, Part 2 §4).
- **`searchOrder` falls back to the original order** if the ranking returns anything that is not the same set. Silently searching fewer sources and calling it "no results" is the worst failure this app has.
- **`empty` ≠ `failure`.** An anime provider with nothing for *Dune* is correct.
- **An unscored failure is not recorded at all** (`UNSCORED_FAILURE_KINDS`) — recording it in `attempts` alone still moves the success rate.
- **Nothing is ever auto-disabled.** Auto-*enable* is opt-in and gated.
- **Indexer deadline = p90 of that indexer's own successes × 2.5, clamped [4s, 20s]**; only successes shape it, or timing out buys a longer deadline. Cooldown escalates; any success resets it.
- **A block or a rate limit never opens a browser** — only a genuine challenge does. A Cloudflare challenge is routinely served as **HTTP 200**.
- **DHT: saved contacts go through `addNode()`, never `bootstrap`**; `dhtPort` is pinned to 6882.
- **All sources is a mode, not an erasure** — it must never throw away a saved selection.
- **Zero-pad episode terms** (`S01E02`); `S1E2` matches nothing and reads as "the indexer has nothing".
- **Ranking on a maintainer's `status`:** weight **0.4**, `minSamples` **0** (a declaration is not a sample); it loses to the counters as soon as they have anything to say.
- An unresolvable scope selection is reported (`missingProviders`/`missingIndexers`), never ignored.
- `sharedDiscovery.ts`: cancel by consensus (stop only when every caller withdrew); an aborted run is never joined; the prefetcher is the only caller passing `autoWiden: false`. The fan-out's `load(base)` may fail when `titleOverride` is known (enrichment only).
- `SourceCache`: removing the last source removes the entry (`hit: true` with nothing in it skips discovery); a 403 is never definitive (expiry/hotlink), 404/410 drop at once, three other failures drop.
- **Stremio addons:** an addon whose `idPrefixes` can't address an id is skipped (it 500s), not counted failing; search is attempted whatever `extra` declares; two deployments of one addon are two providers (the host is in the local id). A direct `url` stream gets `seeders: 1`, no `fileIdx`, and `directSourceIdentity` (shared with extensions).
- **yt-dlp** rows need audio **and** video (except manifests); `--no-playlist`; `resolve` answers with a reason; a pasted page URL becomes its own search row and is resolved when opened; typing never triggers a page fetch.
- A prefix match is not charged for the untyped remainder; `SOURCE_PRECEDENCE`, not arrival order, decides which candidate names a merged work. `bun run test repositories` pins what the catalogue may claim; liveness is `survey-repositories.mjs`, run deliberately.
- More: `fn:search`.

### Field notes — the dated post-mortems → `fn:<area>`

Moved **verbatim** out of this file (nothing rewritten; each file opens with a contents list). Read the one for the area you are changing when you need the *why*: the measurement behind a number, the failure a rule prevents, how a design came to be. Section numbers (§5.1, §5.2, §5.3 …) are unchanged inside them.

| File | Holds |
|---|---|
| `extensions.md` | Jar lane and `jarUrl`; provider execution; the six shim rounds (5 defects → CSX/CNC Verse), `Object`-widening; bridge discarding link data; Android-vs-Windows divergence; missing-provider explanations; lazy loading (67s → 8ms); the ledger/taxonomy ("Counting the log"); OTT lane, `getMainPage`, OTT platform matching; extension updates (three reasons "Update all" did nothing, a timeout is not a verdict, mirrors); §5.1 e2e harness; the extensions screen; native provider lane (Internet Archive, Stremio, Jellyfin); update rollback; diagnosability; adult gate; sandbox; CSX; `InvalidHeader`; browse panel |
| `media.md` | DRM; 4K/8K/HDR; media runtime bundling; DASH/Shaka; subtitles (ASS, charset); forced retry → mpv; the frozen timeline (Range, MAX_ROUTES, PNG-wrapped TS, abandoned fetch); YouTube bounded ranges; player bugs, volume writers, external players, probes remembered; failure panel, message stacks, native stage; the mpv engine (OSC, second film, FFmpeg 7.1 `extension_picky`); §5.2 vendor matrix; handing off to external players; provider headers/proxy; proxy tokens |
| `search.md` | Provider ranking on maintainer status; dead-row hiding; the search box (instant/progressive); origin scope and self-widening; search scope; prefetch while reading; scope picker; provider ranking; direct (non-torrent) Stremio/yt-dlp lanes; source cache learning |
| `ui.md` | Startup (3s window, lazy chunks, datastore debounce); reachability guards; cards; standard mode sweeps; mini/floating player; home discovery; downloads (state machine, variant identity, resume proof, "Download is a request"); library played source; source list export; range-probe bug; shipping; links handle vs page address; saved-title blank; backup; settings level; IPC string drift; lifecycle; navigation/menu; aria2 port; font; licensing; shared primitives |
| `metadata.md` | Trailers (PRD-45) and the cast list / extended metadata (Wikidata, TVmaze, AniList, Cinemeta, Wikipedia) incl. merge rules and live verification; §5.3 metadata harness |
---

### §9–11 — Library, downloads, UI and lifecycle → `library-and-ui.md`

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
- **A library title keeps what discovery found for it.** `SourceCache.onWrite` → `LibraryStore.mergeDiscoveredSources`, matched on the page address or a linked episode address (`sourceAddresses`, set from the `sourceQuery` the detail page sends — a series is searched by each episode's own handle). Identity is provider + release + resolution (real infohash for torrents), 30 per title, `parsed`/`scoreReasons` dropped; never bumps `updatedAt`. A deliberate add with nothing cached runs one background discovery, under the "Load sources while you read" switch.
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
- **Cards:** `visited` is a dimming, never a badge; failure always marked, success almost never; a failure the viewer disproved is retired. `Unsupported` is absence of evidence → `unknown`; nothing tells a viewer an extension *will* work.
- **A privacy control is never held back** by mode or level (`ProviderRankingPanel`'s data and erase button stay in both). `advanced` means the *label* needs knowledge of how the app is built, not "rare"; an unclassified row is basic.
- **PiP** only where it can work (`isPipSupported`: element is what plays, `readyState`, native engine not holding the stream); the window pin unapplies itself on unmount; the `<video>` is never remounted in any mode.
- **aria2** reports `complete`, not `completed` (handle `removed`/`paused` too); its port probes upward from 6800 and success is claimed only once RPC answers.
- `PlayedSource` is recorded after 10 s of real playback, not on selection; a direct link with no recorded deadline counts as expired.
- Bootstrap runs once (`BOOTSTRAP_VERSION`; a bump installs only what is new), caps at `PLUGINS_PER_REPOSITORY`, never blocks.
- **Lifecycle:** shutdown is raced against 5 s and logs `shutdown_timeout` naming the pending service; a dropped file never navigates the window (`will-navigate`); DevTools is `Ctrl+Shift+I` only (F12 is the app's), Reload is gated on `!app.isPackaged`.
- **Metadata:** Wikidata `P161` + qualifier `P453` is performer and role as one fact; Commons images are always `?width=`, the raw URL never reaches the renderer; `assemble` source order is precedence (characters/photos first); Wikidata `P1651` is **not** a trailer; trailer duration/date aren't fetched; a field populated and never read is a defect (`backdropUrl` was drawn by nothing until `DetailHero`).
- More: `fn:ui`, `fn:metadata`.

---

## 12. Rules that cut across everything

- **Nothing is decided from a URL string.** Transport, codec, DRM and container all come from the body or the provider's own declaration. (Violated historically in `mediaInspector`, `ytdlpSources`, `providerLinks` — all fixed.)
- **A capability check ends in an allowlist, not a denylist.** `!UNSUPPORTED.has(x)` answers *yes* for everything it has never heard of, which is how an unknown codec was reported directly playable and failed in the element (§6.16). Absent information is not the same as unrecognised information: no codec means "do not block", a named unknown means "assume not". Same rule as `canPlayContainer`, which got it right first.
- **Files the app creates go through `storage/appStorage.ts`**: `cacheDir()`/`cacheFile()` for re-creatable data, `tempFile()` for a working file, never `os.tmpdir()` or a path built from `userData` in a feature. The exceptions are deliberate and commented: a Unix socket whose app-data path would exceed `sun_path` (mpv), and the unconfigured test fallback.
- **Anything reaching a third-party host goes through `electron/torrent/http.ts`**, which swaps in Electron's `net.fetch` (honouring `app.configureHostResolver` and the system proxy). **Node's `fetch` honours neither** — 5 call sites used global `fetch` and the DNS-over-HTTPS setting silently did nothing for them. `externalPlayerControl` keeps global `fetch` deliberately (loopback VLC control, no DNS or proxy involved).
- **DNS defaults to `automatic` DoH (Cloudflare, Google) with system fallback** (`networkSettings.ts`); an explicit choice is kept. 2,454 `ERR_NAME_NOT_RESOLVED` for raw.githubusercontent.com in one install's logs — an ISP DNS block that stopped every repository fetch.
- **`net.fetch` runs with `referrerPolicy: 'unsafe-url'`** (`resilientFetch.primary` in `main.ts`). Under Chromium's default policy a full-path `Referer` on a *cross-site* request is refused with `ERR_BLOCKED_BY_CLIENT`, not trimmed — 159 blocked requests in 36 logs (workers.dev/Hindmoviez 117, freecdn34/NetMirror 37). aria2 never goes through Chromium, which is why those sources "downloaded but would not stream".
- **Timeout ≠ cancellation.** `AbortSignal.timeout()` → `TimeoutError`; the caller's own controller → `AbortError`. Conflating them scores a provider for the app's own decision to stop waiting.
- **`describeError` always** (`src/utils/errors.ts`), never `x instanceof Error ? x.message : String(x)` — that idiom (82 copies across 37 files) collapsed every DNS/refused/TLS failure into `fetch failed`, and `groupingForm` then merged the whole network family into **one row** in the issue ledger, defeating its purpose. The real reason is in `error.cause`.
- **A GraphQL 200 can be a failure.** AniList returns bad-query/rate-limit/server-fault as **HTTP 200** with `errors` and null `data`, so `response.ok` was true and every caller rendered "no results". Check `errors`.
- **Byte formatters are parameters, not one function.** Release sizes use base **1000** (matching provider/tracker SI quotes); download progress uses base **1024** (matching the OS file manager). Deliberate, and must survive tidy-ups — `format.test.mts` derives expectations from the 8 original implementations. (Zero-placeholder differences are *not* deliberate; flagged, unresolved.)
- **Stores return whole state, never deltas.** `disabledSet.ts` (which stores *exceptions*, so new extensions work by default), `profiles:*`, and the scope trio must all agree, and rebuilding them from a delta is how they stop agreeing. **Bulk is the primitive.**
- **`util/disabledSet.ts` writes fields longhand** — `erasableSyntaxOnly` forbids constructor parameter properties.
- **The sidecar's stdout carries RPC frames and nothing else.** A stray `println` desyncs the channel; plugin logs, JVM warnings and stack traces are forced to stderr. Keep it that way.
- **Never bundle main-process runtime deps.** `vite.config.ts` externalises `dependencies` + node builtins (bare and `node:` spellings). WebTorrent's native `.node` binaries (`node-datachannel`, `utp-native`) must also be `asarUnpack`-ed.
- **Nothing heavy runs at module scope.** Every `import` in `main.ts` is evaluated before `app.whenReady()` resolves, with no message pump running — which is exactly the interval Windows reports as "Not Responding". Measured before this was fixed: `webtorrent` 604ms warm / **2762ms cold**, `cheerio` 242/1740, `fast-xml-parser` 43/710, plus two `ffmpeg` child processes spawned from a top-level call (**4.65s** on a cold run). A third-party package reached only from a feature is a `await import()` behind that feature; a service is a `background.add(...)` task. `bun run test reachability` does not catch this — check the graph.
- **A store that is read at construction is read before the window exists.** `DiagnosticsLog` (5.53MB), `PageSnapshotStore` (1.10MB) and the datastore (7.10MB) were 17.4MB of synchronous read-and-parse in front of the first frame. Hydrate on first use instead, and have *every* entry point call the hydrator including the write-only ones — hydrating after a record was appended replaces the live state with the file's and loses it.
- **The datastore is debounced, coalesced and written atomically.** `save()` marks dirty; the bytes land 250ms later via temp-file-plus-rename. It used to `writeFileSync(JSON.stringify(everything, null, 2))` on **every setter** — 7.1MB, ~29ms of main thread, for one `setBool`. Durability points call `flush()`/`flushSync()`: backup, import, rollback and `before-quit`.
- **Nothing asked once per card may parse a datastore value.** `datastore.getObject` is a `JSON.parse` every call. Card states (`interactions:summarise`) peeked the source cache twice per poster, re-parsing its 1.94MB each time: measured on a real install, **738 home cards took 14,681ms of main thread** — the "whole window freezes on Home and Search" report. Read-only per-row queries use a parse memoised on the stored string (`SourceCache.snapshot`, `LibraryStore.playedSnapshot`): **9.1ms** for the same screen. Paths that mutate still parse their own copy.
- **`spawn` is synchronous where it counts on Windows.** libuv calls `CreateProcessW` on the calling thread, and a cold 87MB ffmpeg costs **~590ms** there (5ms warm). Never spawn a large binary from the main thread on a path nobody asked for; short queries go through `media/toolCapabilities.ts`'s `runToolOffThread`, and answers that only change with the binary are remembered against its path, size and mtime.
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
| `fn:*` (`docs/agents/field-notes/*.md`) | The dated post-mortems, measurements and "why" behind every rule — moved verbatim from this file; five files by area (see **Field notes** above) |
| domain files (`docs/agents/*.md`) | **The other half of this document.** `extensions.md` (§5) · `media.md` (§6) · `torrents-and-search.md` (§7–8) · `library-and-ui.md` (§9–11). Same authority as this file |
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
  the domain file for detail only that area needs (a new dated post-mortem goes in `fn:<area>`, never here). Adding domain detail here is how the
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
