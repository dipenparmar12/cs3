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

Variants: `dist:win:fast` (reuse jars/staging), `dist:installer`, `dist:portable`. `--skip-jvm`/`--skip-media` for UI iteration; both warn in the report.

**Skipping a step fails silently** — `build-runtime.mjs` verifies what Maven produced rather than running Maven, so a package built without the sidecar step installs fine with **zero extension capability** and nothing says so. Verify `release/win-unpacked/resources/`: `media/` has ffmpeg/ffprobe/mpv, `sidecar/` has `cs3-sidecar.jar` + jlinked JRE + 58 runtime jars.

Measured 2026-08-29, `dist:win:fast`, 158s: setup 271.9 MB, portable 271.7 MB.

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
| `search:*` | **Push**, same reason. `search:start` → opening snapshot; `search:update` carries results/progress; `search:cancel` abandons the rest. 15 providers = 15 independent scrapes (Cinevood 20s vs ARD 350ms) — request/response would spend the whole time on a spinner. `api:searchAll` remains for callers needing a full answer. Required splitting `searchAll`'s single batched RPC into one RPC per provider (`searchEach`), capped at 8 in flight. |
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
| `external:*` | Drives a handed-off player, pushes `external:update` with a `capability` flag. |
| window pins | `window:set/getAlwaysOnTop` for the app window; `mpv:setOnTop`/`setVideoEnabled` for mpv's own. |

**`ipcRenderer.invoke` on an unregistered channel rejects — there is no `{ok:false}` envelope.** Seven channels were once strings that had stopped matching (invisible to `tsc`): `binary:setupBinaries` invoked-never-registered made the first-run installer *always* fail, and `BinarySetupModal` caught the rejection and rendered a *reassuring* notice. **A catch that reassures is worse than no catch.** `electron/ipcSurface.test.mts` (`bun run test ipc`, runs first) pins every diff lexically, mutation-verified in all three directions. Exceptions go in commented allow-lists — "I'll wire it later" is not a valid entry.

### Services (`cs3_windows/electron/`)

| File | Responsibility |
|---|---|
| `main.ts` | Window, lifecycle, service wiring, every IPC handler. |
| `preload.ts` | The typed API surface. `subscribe()` unified 14 listener/teardown pairs (teardown prevents accumulation across React remounts). |
| `datastore.ts` | Android's 6-bucket key grammar (`_Bool/_Int/_String/_Float/_Long/_StringSet`) for lossless Android backup import. Non-transferable keys filtered on import by regex. |
| `contentService.ts` | `search → MetadataProvider → getSources → IndexerRegistry → startStream → TorrentEngine`. Extension providers first, torrents fallback. `cs3ext://` bypasses indexers. Also the one funnel that captures page snapshots. |
| `playbackSession.ts` | One "Play" interaction; opens the player before a stream exists and streams discovery into it; owns in-player switching/refresh via a retained `SourceQuery`. |
| `searchScope.ts` | Which sources a search may ask — a selection is a strict filter, not a preference. |
| `searchSession.ts` | One "Search" interaction; push-shaped, fans out per source, cancellable. |
| `searchSuggestions.ts` | Autocomplete: Cinemeta + TVmaze + AniList merged, deduped, misspelling-tolerant. |
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
| `cs3/extensionUpdater.ts` | Scheduled OTA extension updates. |
| `cs3/bootstrap.ts` | First-run bundled-repo install + adult opt-in. |
| `cs3/diagnostics.ts` | Provider failures with reproducible context (the tuple, not a message). |
| `cs3/extensionIssues.ts` | Durable tally of distinct extension problems across restarts/rotation. |
| `cs3/failureTaxonomy.ts` | `classifyFailure` — one closed cause set shared by ranking/diagnostics/ledger; also `groupingForm` and `UNSCORED_FAILURE_KINDS`. |
| `cs3/sidecarStderr.ts` | JVM stderr line → level/tag/cause. |
| `cs3/titleOutcomes.ts` | Last behaviour per title, so dead rows aren't reclicked. |
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
