# AGENTS.md — CloudStream 3 Desktop

Context for AI coding agents. `CLAUDE.md` symlinks here.

**Read this before searching the codebase. If it contradicts the code, the code wins — fix this file in the same commit.**

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

### Renderer modules worth knowing

| File | Responsibility |
|---|---|
| `src/utils/savedPage.ts` | Draws a page from its snapshot and folds a live answer over it **without blanking**. |
| `src/utils/errors.ts` | `describeError` — never returns empty; unwraps `error.cause`. |
| `src/utils/format.ts` | The byte formatters, kept as parameters (see §12). |
| `src/utils/sourceIdentity.ts` | `normaliseReleaseName` / `hasRealInfoHash`. |
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

## 5. The `.cs3` extension story

`.cs3` = ZIP of Android DEX bytecode compiled against upstream's Kotlin provider API. Unrunnable by Node/V8 in any configuration — a barrier to JS runtimes, not to desktop:

1. `sidecar/` is a **separate JVM OS process** (not a thread/worker) — a hanging or crashing plugin degrades to "unavailable", never takes the app down.
2. `DexTranslator`: DEX→JVM via **dex2jar 2.4.38**, once at install, cached by SHA-256. The original `.cs3` is never modified.
3. `LinkageAnalyzer` resolves every referenced type, assigns tier `T1_DROPIN`…`T4_BLOCKED`.
4. `PluginHost` reproduces Android's load sequence: `manifest.json` through the class loader → `loadClass` → construct reflectively → `load(context)` → observe self-registration.
5. `sidecar/src/main/java/android/**` — hand-written stubs. 67.6% of providers import no `android.*`; the shim covers ~93% of the 32.4% that do.

**Never reintroduce a synthetic or placeholder source.** Empty result + a reason, always.

### 5.1 Provider execution

- `sidecar/runtime-deps/pom.xml` resolves `library-jvm` (pinned **4.8.0**) + transitive runtime → `sidecar/runtime/`, 56 jars. Don't restate versions by hand; transitive resolution reproduces what providers compiled against. Needs Google's Maven repo.
- `sidecar/bridge/` (Kotlin) → `cs3-provider-bridge.jar`, **must live in `sidecar/runtime/`** — same loader as `library-jvm.jar`, or `BasePlugin` resolves as two different `Class` objects. Reached reflectively; primitives in, JSON strings out.
- RPC: `providerSearch`, `providerLoad`, `providerLoadLinks`, `providers`, `providerMainPageSections`, `providerMainPage`. Results re-addressed `cs3ext://<provider>/<handle>`.
- Contradicts PRD-36: `BasePlugin`/`CloudstreamPlugin`/`APIHolder`/`ExtractorApi` ship **inside** `library-jvm` 4.8.0 (no `cs3-app-shim.jar` needed); `search(query, page)` is primary, not `search(query)` — bridge tries paginated first.
- `PluginClassLoader` needs the **original `.cs3`** as a second classpath entry (dex2jar converts only `classes.dex`; `manifest.json` must resolve through the loader).
- `getMainPage`: `mainPageSections` needs the plugin loaded; `mainPage` fetches one page of one row. Request travels as **separate primitives** (row handles are opaque strings with delimiters). Only the row asked for is used. `page` is **1-based** (0 = "no such page" upstream).
- Outstanding from PRD-36: step 6 (OS sandbox).

### 5.2 The android/`:app` shim — six rounds

Pattern throughout: **count failures before fixing.**

| Round | Trigger | Fixed |
|---|---|---|
| 1 | `Bnyro/GermanProviders` | `Plugin` is `:app` not `library-jvm`; dex2jar mangled-name corruption; shim never delivered to `runtime/`; dev classpath pointed at a non-existent dir; `resolveJava` accepted Java 17 |
| 2 | `Kraptor123/cs-kraptor`, 65/65 failing | **`SharedPreferences` was a class; Android's is an interface** (112/392 plugins — highest-impact single fix); `PluginData`/`PluginManager`/`RepositoryManager`/`RepositoryData`; `PackageManager`; `android.os.Process` |
| 3 | 113 user failures → 6 classes = 100% | `DataStore` (48), `AppCompatActivity` (23), `CloudflareKiller` (16), `android.net.Uri` (16), `DialogFragment`/`FragmentManager` (10) |
| 4 | 8 extensions "No providers" — **5 of 8 were the stale-runtime trap**, not bugs | `Context.getSystemService`; `android.os.Handler`; the `syncproviders` cluster |
| 5 | `NivinCNC/CNCVerse`, 18 failures | `CheckBox` (7), `Intent` (6), `AlertDialog` (3), `Globals` (9), `Drawable` (8) |
| 6 | 11 × `NoClassDefFoundError: android/widget/Toast` | `Toast` — first widget shim that **does not throw on use** |

Rules those rounds established:

- **`Class.getMethod` resolves every public method's parameter and return types.** A provider merely *declaring* `val x = CloudflareKiller()` throws `NoClassDefFoundError` naming its own class **after registering successfully**, blaming the wrong class and aborting the load. `PluginHost.call` must catch **`LinkageError`**, not just `ReflectiveOperationException`; `diffProviders` isolates per-provider describe failures. This is why one missing widget class costs an entire extension.
- **dex2jar corrupts Kotlin mangled names**: `kotlin.Result.constructor-impl` (hyphen→underscore) resolves against nothing. `Result` is `runCatching`'s compiled form, so search/metadata work and **link resolution fails** — **if a provider works until you press Play, check `KotlinNameRepair` first.** The repair itself was once broken: changed-ness tracked by a *global* counter while decisions were memoised per class, so the second class hitting a cached decision had correct bytes discarded ("works with 3 plugins, fails with 8"). Now tracked per class by the visitor.
- **Never forge `com.lagradost.cloudstream3`** as package name; lying about the platform makes downstream bugs undiagnosable.
- **Never fake platform numbers** (DROP-9). `getSystemService("activity")` returns a real `ActivityManager` with this JVM's real `MemoryInfo`.
- **Concede the type, refuse the operation.** androidx UI (`View`/`ViewGroup`/`Dialog`/`Fragment`/`FragmentManager`/`Activity`…), `PackageManager`, `AssetManager`, `ContentResolver` exist so *scraping* logic bundled with settings UI can link; they throw `UnsupportedAndroidApiException` on use, demoting the tier rather than crashing. `Intent`/`AlertDialog.Builder` don't throw on construction (inert on Android too) — refusal sits on `startActivity`/`show`.
- **The plugin's context is an `AppCompatActivity`** (`android/content/PluginHostContext.java`) — the corpus's dominant shape is `activity = context as AppCompatActivity` as `load()`'s first statement (25 files). Turns total loss into scrapes-fine/no-settings-screen.
- **`android.net.Uri` is implemented, not delegated to `java.net.URI`** — Android's parser never validates and scraped URLs carry spaces, `|`, stray `%`. RFC 3986 Appendix B splitting, total (cannot fail). Asymmetry preserved: `getQueryParameter` decodes `+` as space, `Uri.decode` doesn't.
- **`androidx/**` must be excluded from `cs3-sidecar.jar`** alongside `android/**` — parent-first delegation means a stray copy wins and fails to link.
- **Data classes faithful, behaviour refused.** Jackson binds by constructor parameter name, so a rename silently binds null. `syncproviders` answers `null` / "not logged in".
- **Host-state inventories return empty, mutations are no-ops** — that state belongs to the main process.
- **`Toast` does not throw.** A dialog is load-bearing (the flow waits for an answer), but `Toast.show()` returns immediately, tells its caller nothing and cannot fail — refusing would convert a consequence-free call into an aborted scrape. Text goes to stderr in the `Log` shim's shape, where `sidecarStderr` classifies it. Not displayed, not discarded.
- **Deliberately unshimmed: Ultima** — needs `CloudStreamApp`→`MainActivity`/`CommonActivity`/`HomeViewModel`, a host-UI replacement, not a scraper.

### 5.3 The `Object`-widening family — 12 occurrences, closed

**A parameter or return type widened to `Object` is not a type-safety loss, it renames the method.** An extension calling `getResources()Landroid/content/res/Resources;` against a shim declaring `()Ljava/lang/Object;` gets `NoSuchMethodError` at the call site and the shim's careful refusal is never reached. A getter returning a **supertype** is the same bug.

Occurrences: `Context.getPackageManager` / `.getResources` / `.startActivity` / `.getAssets` / `.getContentResolver`; `AccountManager.aniListApi` / `.simklApi` (typed as wrapper `SyncRepo`); `Application.ActivityLifecycleCallbacks`; `CloudStreamApp$Companion.setKey` (erased generic); `Window.setBackgroundDrawable`; `Fragment.getResources` (same method fixed once, missed on a second class).

**`ShimSignatureTest` enumerates the rule**: no shim method may mention bare `Object` unless Android's own signature does; the allow-list carries upstream's real signature per entry, and **a stale allow-list entry fails too**. Mutation-verified — closed, not merely reduced. The last four were found by **enumerating instead of waiting for the next report**.

Related: `errorKind` classifies the **whole** `LinkageError` family (`NoSuchMethodError`, `IncompatibleClassChangeError`, `AbstractMethodError`, `VerifyError`) as "our shim is wrong", not `PLUGIN_ERROR`. `ExceptionInInitializerError` excluded (a plugin's own static init).

### 5.4 The upstream jar lane (built; the corpus then left it)

Upstream's `isCrossPlatform` flag emits a plain JVM `.jar` beside the `.cs3`; `plugins.json` carries `jarUrl`/`jarHash`/`jarFileSize`. Needs no translation.

- `chooseArtifact` prefers the jar, verified against **`jarHash`** — never `fileHash` (the `.cs3`'s digest, always mismatching; a mismatch must never be read as permission to skip verification).
- **Archive keeps its `.cs3` name.** `PluginArchive.detect` classifies by **contents** (`.dex` vs `.class` members), never filename.
- **No `manifest.json` on this lane.** Entry class recovered by scanning for the `@CloudstreamPlugin` **ASM annotation** — stronger than a `*Plugin.class` convention. Two annotated classes are **reported, never arbitrated** (picking first makes provider choice depend on zip ordering); an unparseable class is **skipped, not fatal**.
- `PluginHost.prepare` is the **only** branch point for jar-vs-dex; a second copy of the load sequence would drift.
- **Does not retire `LinkageAnalyzer`/tiers** — `jdeps` flags `android.*` only, and a cross-platform jar still links `library-jvm` and can reach `:app` types. Removes the *bytecode* problem, not the *classpath* one.
- **The lane collapsed 4 days after shipping.** Across 36 catalogued repos: 958 extensions, **18 publishing `jarUrl` (1.9%)**, down from 12.0%; `phisher` 47→**0/81**. **Do not plan work assuming the corpus moves here.** The uncatalogued tail (122 repos, 1,158 extensions) is worse: 1.6%, and 3 of the 4 largest are majority-NSFW.
- Trap: a declared `tvType` is a manifest default, not coverage (`Wiojelt/TurkSinema` declares every type on every extension).

Translation risk **measured** against all 392 plugins: 392 translated, 18,217 classes, 0 verification failures, 6,617 Kotlin coroutine state machines, 0 failures (`docs/PRD/35`, `tools/dex-spike/`).

### 5.5 Diagnosis: three surfaces, one taxonomy

| Surface | Answers |
|---|---|
| `Logger` (NDJSON per launch) | "what happened" |
| `DiagnosticsLog` | "enough to paste" — one failure's **tuple** (provider, query, item, address); a bare message like `Expected URL scheme 'http'` names nothing actionable |
| `ExtensionIssueLog` | "what keeps happening" — durable across restarts and rotation |

Counting the log from inside the app (21 sessions, 6,069 records): **5,407 (89%) sidecar stderr**, `missingClass` matched **none** (class problem confirmed closed). Three defects: level was wrong *in the hiding direction* (unprefixed → `info`, so `Read timed out` sat beside registration chatter); nothing carried who printed it though the tag was right there; JUL records are two lines read as two events. `sidecarStderr.ts` emits `source` (92.5% coverage) and, at warn+, `cause`. Ledger reduced 5,407 → ~200 distinct problems.

Issue row key = `(cause, source, groupingForm(message))` — needs all three, stores **no URLs/queries/titles** (that would be a viewing history).

Classification bugs worth not repeating:
- **Stack-frame line numbers read as HTTP statuses** (`RealCall.java:519` matched a 3-digit test, 23 miscounts). `classifyFailure` strips source locations first; `groupingForm` keeps bare integers so `HTTP 403` ≠ `HTTP 404`.
- **The taxonomy only spoke Node's dialect** — tested `ECONNRESET`, missed JVM's `SocketException: Connection reset` (108 miscounts).
- **Cancellations counted as failures** (79×) — scope-closing throws on every in-flight scrape when a new query starts.
- **Stacks read as messages, twice**: a `PluginHost` frame made every plugin crash look like a sidecar fault (`describe` classifies from head + `Caused by:` only, never `at` frames); `InvocationTargetException` was the attributed source (now reads the plugin's own loader frame).
- `resource-leak` (OkHttp's warning) was **every unclassified record**, 159× — scrape succeeded, socket leaked.

**`UNSCORED_FAILURE_KINDS` lives in the taxonomy; `ProviderAnalytics.observe` consults it.** An unscored failure is **not recorded at all**, not recorded-and-discounted — counting it in `attempts` alone still moves the success rate. Members: `cancelled`, `provider-missing`, `resource-leak`, `unsupported-operation`.

**Grep for `\x08` after any bulk edit.** `playbackSession.ts` once had `/\b(\d{3})\b/` with `\b` replaced by literal backspace characters and the backslash eaten off `\d` — it could never match, and it is invisible in a diff.

### 5.6 A provider that is gone must say which extension owned it

`requireProvider` throws `ProviderNotLoadedException` (one line; loaded set to stderr only). `PluginManager.explainMissingProvider` answers *why* via `errorKind: 'PROVIDER_NOT_LOADED'`: which switch and where / the adult gate / a name clash and which extension lost (`providerNameClashes`) / uninstalled / blocked at load (verbatim `runtimeReports` reason) / not loaded yet — which is **not** a failure.

Supporting: **provider origins persisted** (`cs3_provider_origins`) because a bookmark addresses `cs3ext://X/…` long after X is gone; a missing archive on disk **gets a runtime report** (was silently filtered from `pending`); `provider-missing` is its own unscored kind.

**A sidecar that cannot start must say so.** `ensureProvidersLoaded` used to silently `return` on a failed `ensureStarted()` → infinite "initializing providers…" spinner. It writes a `T4_BLOCKED` runtime report naming the cause to every plugin. **Never add another silent early return here.**

### 5.7 Loading is lazy, and cannot be parallelised

Measured on 124 archives / 132 providers: all serially **66.8s**; `inspect` (translate+analyse) all **1.4s**; second load same JVM **2.4s**; **8 concurrent RPCs → 43.5s and 176 providers mis-attributed**.

So translation is not the cost — it is **demand-driven JVM class loading of the 56-jar classpath**, paid once per process. It **cannot be parallelised**: providers self-register into global `APIHolder.allProviders` and `diffProviders` reads its length before/after `load()`, so overlapping loads read the same mark and steal each other's providers.

`cs3/providerRegistry.ts` records what each archive registered, keyed `size:mtime:generation`, hydrating the provider list from disk without starting the JVM (**6.6s → 8ms**, 132 providers preserved, zero misses).

- **The generation is part of the key** — the shim/bridge changes what a plugin *can* register.
- An archive registering nothing is still recorded (`[]` ≠ no record, else extractor-only bundles reload every launch forever). A failed activation withdraws the row.
- **Loading is lazy and per-archive**: `ensureProviderActive(name)`, deduped by an in-flight map — a search fanning to 8 providers from one archive would otherwise load it 8× concurrently, the mis-attribution bug through the front door.
- `warmProviders()` runs 4s after window-open, serially, **waiting between archives while any search runs** (never mid-archive — that leaves a half-registered provider), bounded at 120s.
- **If you add a code path that calls a provider, call `ensureProviderActive` first.**

### 5.8 Updating an extension

`installPlugin` tells the sidecar to `unload` before replacing an archive, and used to tell nothing on this side: `liveInJvm` still held the name so the next `activate` returned `true` without loading, and the registry described bytes no longer on disk — every layer reported success and the extension answered nothing. **`forgetLoadedExtension` drops all four claims** (live set, registry row, provider entries, runtime report), **paired with the `unload`** rather than placed after the rename, so a failed rename cannot leave a live claim either.

- Only the replaced archive is reactivated. Every install used to run `providersLoaded = false; loadProviders()` — "update all" across twenty extensions was twenty whole-catalogue re-reads.
- **"Up to date" was wrong for exactly the extensions that had stopped working.** Maintainers fix a scraper and republish without touching `version`. Same version + different published hash **is** an update, labelled `reason: 'republished'` ("v7 rebuilt", not "v7 ➔ v7"). Compared **only when both sides carry a hash for the same lane**, else it re-downloads the catalogue forever.
- `resolveUpdate` asks the extension's own repository first; `updateAll` runs a check rather than iterating an empty list. Pressing Update with a cold cache used to answer "check for updates first" — a dead end made of our own bookkeeping.
- **The maintainer's own `status: 0` produces an `ExtensionNotice`** — deliberately information, not an action. Switching off a source someone chose, on the strength of a number in a JSON file, is the silently-punitive behaviour the ranking exists to avoid.
- **An update that breaks itself is put back**: copy the working archive aside, install, **load the new one**, restore on link failure. Only `T4_BLOCKED` counts as failure — `T3_DEGRADED` is normal for much of the corpus, and a `null` report means the sidecar is unreachable, explicitly not a failure (DROP-34). One generation kept; `extension:rollback` exposes it.

### 5.9 The WebView bridge

**The class that resolves perfectly and does nothing**: `WebViewResolver` *is* published in `library-jvm` 4.8.0, but its JVM variant's `resolveUsingWebView` is `TODO("Not yet implemented")`. A class-resolution audit sees nothing wrong — which is why four shim rounds never surfaced it, and the standing argument against reading "zero `NoClassDefFoundError`" as "zero compatibility gaps".

| Piece | File |
|---|---|
| stdio protocol, run backwards | `sidecar/.../HostChannel.java` + `Main.handle` |
| sidecar-installed handler | `bridge/.../HostBridge.kt` |
| `WebViewResolver`, shadowing the stub | `bridge/.../network/WebViewResolver.kt` |
| the browser | `electron/cs3/webViewHost.ts` |
| subrequest meaning (pure, tested) | `electron/cs3/webViewMatch.ts` |

- Frames told apart by key (`hostCall`/`hostReply`), never a version — old sidecars still speak them. Payload travels as a JSON string under `json`, avoiding a lossy re-parse.
- **Host replies complete on the stdin reader thread, not the bounded plugin-call pool** — else concurrent resolves deadlock the pool waiting on replies no thread can deliver.
- **Classpath order in `PluginHost.shared()` is load-bearing.** `WebViewResolver` is the first class the bridge *overrides* rather than supplies fresh, and `Files.newDirectoryStream` order is filesystem-dependent (correct on the build machine, broken on a user's). Bridge sorted to the front; `WebViewBridgeTest` asserts both directions; the shadow is verified a strict superset of the stub **via `javap`**.
- A browser opens only on a genuine challenge (`Server: cloudflare` **and** 403/503 — a bare 403 is usually hotlink protection a browser can't fix).
- `backgroundThrottling: false` mandatory (a challenge page is mostly timers); `cf_clearance` is `HttpOnly`, so read from the session not `document.cookie`; the bypass ends on **cookie arrival** (`awaitCookie`), not a URL match (upstream's is a deliberately unmatchable `.^`).
- Certificate errors ignored **for this partition only**, never the default session — this partition never carries credentials and the stream it finds is re-fetched normally.
- `webRequest` handlers installed **once**, dispatched by `webContentsId` — per-resolve registration silently unhooks concurrent resolves.
- Java→JS regex translation must be **escape-aware**: `\A`, `\p{Alpha}` are silent no-ops in JS, and a naive global replace corrupts escaped-backslash sequences — producing a pattern that never matches, which reads as a dead host.
- Blacklist matches the **path only** (query-string cache-busters are routine); `/cdn-cgi/` and `recaptcha` never blocked — that's the challenge machinery.
- **Honest gap vs Android**: Android streams intercepted requests to the callback live (`true` mid-load destroys the view); here the batch arrives after the fact and `true` truncates the reconstructed list. Every corpus use (collect/filter) survives; only the early-stop saving is absent.

**The deadline rule.** The reverse channel carries one deadline and both ends were spending it: the JVM waits `timeoutMs` in `HostChannel.call`, and `WebViewHost.resolve` took the same number as its *work budget*. Counted over three sessions: **214 resolves, 49 matched — every one inside 6.5s — while 165 ran the full 15s budget, answered at 15021–15273 ms against a 15000 ms wait, and 0 were kept.** **This is most of what "it just sits there and then says no sources" means on a provider that needs a browser** — and the browser works (`hgcloud.to` matched 49 of 49).

`cs3/hostDeadline.ts` (pure, 10 tests): **the side doing the work finishes first, so the side waiting is still listening.** The repo already said this forward — `Main.timeoutFor` gives a plugin call ten seconds less than the RPC carrying it. Reserve is flat (1.5s: serialise, one pipe write, one parse), sized far above the measured overshoot because that overshoot is our own timer firing late while three Chromium pages and a transcode compete. Capped at ¼ of the deadline so a small ask still gets most of it. `webview_resolve` logs `budgetMs` and `deadlineMs` beside the duration — without them a late answer and a slow site are the same line.

### 5.10 What Android does about a page that needs a click

`loadExtractor` in `library-jvm` 4.8.0 tries three things, all in `commonMain` so the JVM build has them (verified in the shipped jar): `unshortenLinkSafe`; prefix match with the scheme stripped; and **`Levenshtein.partialRatio(mainUrl, url) > 80`**, a deliberate fuzzy pass commented upstream as "to match mirror domains". That is what lets an extractor registered for `hblinks.dad` claim `hblinks.co`, and what makes the wildcard `mainUrl`s the corpus is full of work at all.

So `M3u8Helper: … is not a "Master Playlist"` on `hblinks.co`/`gdflix` is **the extension's own behaviour and appears identically on Android** — that provider hands those URLs to `M3u8Helper` directly rather than through `loadExtractor`. **Not a desktop gap, not ours to fix by porting.** What *was* ours is §5.9: those hosts are exactly the ones a browser has to finish.

### 5.11 Native providers (`cs3native://`)

Compiled into the app, reviewed normally — deliberately **not** PRD-41's sandboxed `.csx`.

Rules: addressed `cs3native://<id>/<handle>`, **never** `cs3ext://` (wrong-attribution failures); funnels through the same `enabledProviderNames` / adult gate / `DisabledSet` cascade; shares the `providers` scope dimension (no third axis); `loadLinks` returns an ordinary `ExtractorLink`; failures use the shared taxonomy; **does not auto-escalate scope on empty** (the address already names an item in that provider's own catalogue, so empty means genuinely unplayable); the detail route is checked **before** `plugins.loadMedia`, else `null` misreports as "nothing knows this address".

| Provider | Notes |
|---|---|
| Internet Archive | ~52,000 public-domain films/TV. Search **must** be `title:("<query>")` — bare terms OR across all fields and return wildly wrong top hits. A `sort` key is **mandatory** (empty → empty result set, indistinguishable from "no such film"); `format:(MPEG4)` is a needed quality gate. |
| PeerTube | Federated via SepiaSearch; files live on their own instance. |
| iptv-org | 17,230 free-to-air streams; ~70% answer. |
| Stremio addon | **Any** addon by manifest URL, so new ones need no adapter (95 measured: 19 carry streams). `idPrefixes` is a **hard constraint** (an addon can 500 on a foreign id scheme). A declared `extra` list **under-reports** — attempt, don't trust the manifest. Two deployments of one addon are **two providers**. `externalUrl`/`ytId` streams dropped (they open a webpage). |
| Jellyfin/Emby | Can't exist as `.cs3` (no LAN route) and can't rot. Key travels as `X-Emby-Token` **header, never in the URL** (URLs get written to disk everywhere); exception: a poster `src` can't carry a header, so the key is omitted there. Key never crosses the context bridge (`listServers()` strips it, tested). `static=true` — the original file, not a server transcode. A key valid but attached to no account returns empty `/Users`, not 401. |

`DiscoveryService` shares `ContentService`'s registry instance, so a disabled provider vanishes from both at once.

### 5.12 The end-to-end harness — `tools/e2e/provider-e2e.mjs`

```
node tools/e2e/provider-e2e.mjs [--repo X] [--plugins N] [--queries "a,b"]
                                [--only A,B] [--json report.json] [--list]
                                [--lane cs3]   # force DEX artifact, skip jar lane
```

Drives repo JSON → `.cs3` download + SHA-256 → DEX→JVM → `load()` → `search()` → `load()` → `loadLinks()` → a 2MB range-GET off the real host. **Talks stdio JSON-RPC directly to the sidecar, no Electron** — harness passes + app fails ⇒ bug in `cs3_windows/`; harness fails ⇒ bug in runtime/extension. Exit 0 requires **bytes**, not just search results; `PARTIAL` = scraped but nothing played.

- `fileHash` is `sha256-<hex>` — strip the prefix before comparing.
- Repository URLs are project pages resolved to raw documents by probing branch/filename combos (`master/repo.json`, `builds/repo.json`, `builds/plugins.json` all in use).
- **Where it stops**: real extractors fail on *hosts* (Voe "encoded string not found", Vidsonic gets HTML expecting hex) — bot protection, WebView territory. **Don't weaken the extractor path to "fix" this.**
- **Not yet measured: whether the WebView bridge rescues affected providers.** The harnesses run with no Electron, so `hostCapabilities` reports none and every resolve declines. Only the seams are verified (31 sidecar tests, 21 matcher tests, `javap`). Closing this needs a headless Electron main answering `webview.resolve`.

### 5.13 Android vs Windows divergence, measured

`--plugins 30`, all 5 repos: 66 loaded, 24 answering, 18 links, 16 streams — PASS. **`NoClassDefFoundError` count: 3, all one class** (`CloudStreamApp` = Ultima, the deliberate exclusion). **For the visible corpus the translation/class problem is closed** — a provider failing here that works on Android is failing for a non-class reason.

1. **TLS strictness** — `SSLHandshakeException: unrecognized_name` from servers sending a *warning*-level SNI alert; Android's Conscrypt ignores it, the stock JVM treats it as fatal. **Do not apply `-Djsse.enableSNIExtension=false`** globally — that disables SNI for every connection, breaking most CDNs to fix a few hosts. The correct fix is per-connection in the bridge's HTTP client; not built. **Frequency unmeasured — count before spending effort.**
2. Host-side reality (expired links, 403s, dead swarms) is not a divergence: of 72 non-playing streams in the vendor matrix, every one was host-side.

### 5.14 Sandbox, bootstrap, adult gate

**Enforced**: plugins can't reach sidecar internals (`PluginClassLoader`, tested); `System.exit` can't kill the app (process boundary); `System.loadLibrary` blocked (empty `java.library.path`); per-plugin scoped storage using the real `pluginId` — `newShimContext` once hard-coded the literal `"plugin"` and **every extension shared one preferences file**.

**Not enforced**: raw network egress, process creation — both need an OS-level sandbox (Windows job object + restricted token). Reported via `status.sandboxGaps` and surfaced in the UI deliberately: a named gap gets fixed, an implied-covered one doesn't. `SecurityManager` is unavailable (JEP 411/486).

**First launch bootstraps repositories** (`cs3/bootstrap.ts`, background, progress shown, once per `BOOTSTRAP_VERSION`, capped at `PLUGINS_PER_REPOSITORY`, never blocks catalogues/indexers). `bundled: true` means `provider-e2e.mjs` has driven that repo end-to-end.

**Adult content off by default.** The gate is `PluginManager.enabledProviderNames` — the single funnel search, scope, discovery, playback and downloads all pass through. A provider is adult if `supportedTypes` includes upstream's `NSFW` `TvType`, which catches an adult provider bundled inside an otherwise-ordinary repo. `BootstrapService` also declines to *download* them while off (politeness, not the protection). Three states (`off`/`ask`/`on`) because two couldn't express "installed and working and not on screen by default"; the old boolean is migrated from and kept in step on every write, since it is a datastore key and travels in Android-format backups.

---

## 6. Playback and the media engine

### 6.1 Chromium cannot decode much of what people actually stream

Measured with `canPlayType`. Audio: AAC/MP3/FLAC/Opus fine; **AC-3, E-AC-3, DTS return `""`** in both MP4 and MKV. Worst failure mode: bare `video/x-matroska` reports `"maybe"` — container opens, video decodes, **audio silently dropped** (measured: 65,397 bytes video / 0 bytes audio, correct duration, no `error` event). Hits **series** hardest (HDTV/WEB-DL carries broadcast AC-3/E-AC-3 where film web-rips carry AAC) — the provider was never the variable. Video: H.264/VP8/VP9/AV1 only; no HEVC without platform decoders, no MPEG-2, VC-1, MPEG-4 Part 2, WMV. Android has none of this (ExoPlayer → hardware decoders).

### 6.2 Inspect, decide, execute — in that order

| File | Role |
|---|---|
| `media/mediaInspector.ts` | ffprobe → `MediaMetadata`; transport from the manifest **body**; reads DRM |
| `media/decisionEngine.ts` | Pure `(metadata, transport, rendererCaps, hostEncoder) → TransformationPlan`. No I/O |
| `mediaTranscoder.ts` | Executes a plan as live fragmented-MP4 on loopback |
| `media/playbackEngine.ts` | Assembles them, caches capability records per URL, owns telemetry |

Types in `src/types/media.ts`. The decision is pure so it can be tested against an expensive-to-reproduce matrix (a real 25GB file behind a now-expired link): `decisionEngine.test.mts` (35 cases), `pipeline.test.mts` (13 cases, real ffmpeg, skips itself without it).

**Ordering is the bug fix.** Playback used to attach on mount while a probe ran beside it; Chromium's parser failed within ~150ms, `error` fired with the probe still in flight, and the fallback ran `-c:v copy` on unknown video — re-wrapping undecodable HEVC and failing identically. **`media:prepare` is the only source of a URL; assigning `video.src` from anything else reintroduces this.**

| ID | Rule | Enforced in |
|---|---|---|
| INV-RACE-1 | Nothing attached before inspection completes | `VideoPlayer` — no `?? streamUrl` fallback |
| INV-RACE-2 | The gate is visible ("Inspecting media…") | `VideoPlayer`, `isInspecting` |
| INV-RACE-3 | `-c:v copy` never on unverified codec info | `blindFallbackPlan` re-encodes |
| INV-RACE-4 | Renderer capabilities registered before playback | `App.tsx` mount → `media:setCapabilities` |

**Nothing is decided from the URL.** The old implementation searched filenames for `hevc`/`x265`/`10bit` — wrong in both directions. Transport is classified from the first 64KB of body (`#EXTM3U`/`<MPD`), not the URL or content-type.

### 6.3 Plan details that are load-bearing

- **The software 4K guard is arithmetic, not heuristic.** Measured: 3840×2160 10-bit HEVC, libx264 `veryfast` native res = 11–13 FPS (0.47× realtime — Chromium drains the buffer in ~3s then stalls forever); `scale=-2:1080` = 26–28 FPS. Software-only hosts downscale above 1080p; GPU-encoder or 16-thread hosts keep full res. Threshold is **pixels per second**, not height (8K is 4× 4K's pixels and a height-only guard waved it through), `Math.max(1,…)`-clamped so every ≤4K verdict is unchanged.
- **A track switch re-derives the plan, never re-indexes it.** Pointing a copy-audio plan at a 6-channel AC-3 track makes ffmpeg fail outright (`Cannot write moov atom before AC3 packets`). `planForAudioTrack` is the only correct way.
- **Unplayable default audio is swapped only for a track in the same language** (Movies4u ships 3× E-AC-3 5.1 beside AAC stereo of the same film — never swap languages for cost).
- **The hardware encoder is chosen by test-encoding**, never `ffmpeg -encoders` (that lists what the binary was built with; the bundled build advertises nvenc/qsv/amf everywhere and only QSV opens without an NVIDIA GPU). Each candidate encodes one real frame with the exact args it will be used with, which also catches AMF's missing `-preset`.
- **Decodability is measured in the renderer** (`App.tsx` runs `canPlayType` over `VIDEO_CODEC_PROBES`), overriding the static `UNSUPPORTED_VIDEO` table **in both directions**. Chromium is launched with `PlatformHEVCDecoderSupport`.
- **HDR re-encode needs tone-mapping.** `-pix_fmt yuv420p` converts storage format, not transfer function, so PQ/HLG re-encoded to 8-bit keeps HDR-referred values displayed as SDR — washed out, no error. Measured first-frame SATAVG: SDR reference 112.6 · no tone-map 22.8 · zscale chain **63.0** · `tonemap` without `zscale` **6.3**. **That last number is why there is no degraded fallback** — `tonemap` alone on PQ is measurably worse than nothing. `toneMapFilters()` returns the chain only when `zscale` (zimg) is detected at startup. Trap: ffmpeg takes **one** `-vf`, so tone-map and downscale must share a chain.
- Stereo downmix is deliberate (5.1→5.1 AAC decodes but routes to the wrong outputs on most desktop setups).
- `-user_agent` is HTTP-demuxer-only — fatal on local paths, so applied only to http(s) inputs.
- Seeking restarts ffmpeg at the target time (fragmented MP4 has no index; accuracy bounded by keyframe interval).
- Embedded text subtitles extracted on demand, bounded 3 min, cached (reads the whole file — packets are interleaved). Bitmap tracks (PGS/DVB/VOBSUB) listed but never offered. No ffprobe means the app cannot even *list* a Japanese AC-3 dub.
- **FFmpeg 7.1 silently broke the image-segment fix.** `-allowed_extensions ALL` (for Hdmovie2 serving MPEG-TS from `.png` URLs) stopped working when 7.1 added `-extension_picky`, evaluated **before** the allow-list — with no repo-side change on the day it broke. Only `-extension_picky 0` fixes it, and adding it unconditionally is fatal on 7.0. `detectExtensionPicky` probes `-h demuxer=hls` at startup and after any ffmpeg install; `hlsDemuxerOptions()` includes it only if present.

### 6.4 DRM

HLS AES-128 and SAMPLE-AES are **not** DRM here (hls.js handles them in JS). ClearKey/Widevine/PlayReady/unrecognised set `requiresEmeDecryption` and **bypass FFmpeg entirely** — measured: ffprobe reads a synthesised CENC file and reports **correct codec names**, then decode produces `non-existing PPS`. The probe succeeds with a lie, so encrypted streams were reported as "file is corrupt".

1. **ClearKey + browser-decodable payload** → `EME_NATIVE` via `src/utils/clearKeySession.ts`.
2. **ClearKey + browser-undecodable payload** → the ordinary ladder plus `-decryption_keys`. **Progressive only** — the DASH demuxer's `Option decryption_key not found` is fatal to the whole command line.
3. **Widevine/PlayReady/keyless ClearKey/unrecognised** → named as unplayable (no CDM shipped).

Hazards in `src/utils/clearKey.ts`: hex vs base64url told apart **by length only** (16 bytes = 32 hex or 22 base64url, unambiguous); EME wants base64url and FFmpeg wants hex, so both conversions live in one file and are tested against each other. `DrmType.unknown` is kept distinct from `none` — folding them sends it back to be misdiagnosed.

**Not built: DASH under any DRM** (Chromium can't demux `.mpd` without MSE+JS; FFmpeg refuses the keys). Reported by name, not as corrupt.

### 6.5 DASH is played, not remuxed

Shaka Player (Apache-2.0) takes any DASH manifest the browser can decode (`DASH_NATIVE`); remux is the fallback. Buys the full adaptive ladder (remux flattens it to one rendition) and is the only strategy that can play encrypted DASH.

**The proxy had to learn DASH first, which fixed an existing bug**: manifests name segments relative to their own address, so serving one unmodified from loopback breaks resolution for **both** Shaka and ffmpeg's DASH demuxer — the remux path was already broken for any manifest not spelling segments out in full. `MediaProxy` rewrites MPDs with **directory routes** (`/base/<token>/<rest>`, because `SegmentTemplate` uses player-expanded `$Number$` placeholders, unlike HLS which lists every segment); `<BaseURL>` inserted/replaced; absolute `media`/`initialization`/`sourceURL` rewritten; suffix origin-checked (`resolvePrefixed` refuses cross-origin, else a directory route becomes an arbitrary-URL fetcher); manifest sniffing bounded to 4MB declared length.

### 6.6 The media proxy

A browser cannot send the provider's `Referer` (a forbidden fetch/XHR header), which broke `<video>`, hls.js and ffprobe with two different symptoms (HLS `manifestLoadError`; progressive "could not decode"). `mediaProxy.ts` serves from loopback with headers applied, fixing all three at once.

- **HLS playlists are rewritten, not forwarded** — segments, keys and variant playlists would otherwise hit the host with no headers. Covers bare URI lines and quoted `EXT-X-KEY`/`EXT-X-MAP`/`EXT-X-MEDIA` attributes; relative URIs resolve against the **final** (post-redirect) upstream URL.
- **A loopback URL returned from `wrap` is untouched**, else torrent/transcoder output gets double-wrapped, growing a hop per call.
- **A 4xx source fails over immediately** rather than being handed to ffmpeg, saving a wasted startup and timeout per expired URL.
- **Tokens are 16 random bytes**, not sequential integers. With `Access-Control-Allow-Origin: *` (needed for ffprobe/hls.js/Shaka/mpv/VLC), integer tokens let any page in the user's browser enumerate the session's viewing by walking them. A `Host` header not naming loopback is refused — binding to 127.0.0.1 doesn't prevent DNS rebinding.
- **`Accept-Ranges` is stated, not forwarded**; byte-zero data is never served as a mid-file range.
- **Any un-Ranged body under 4MB was once corrupted** — the manifest-sniffing branch did `.text()` then `res.end(body)`, UTF-8-mangling binary bytes (704KB segment → 1.27MB garbage). It survived because media requests almost always carry Range. Read as bytes; decode only to sniff.
- **Abandoned probe requests kept downloading the whole file.** `reader.releaseLock()` detaches but does not stop — under Electron's `net.fetch` the request lives in Chromium's network service. On Range-ignoring hosts, 3 aborted probes × 3 sources = 9 concurrent full-file downloads competing with the real one. The reader is cancelled and every upstream fetch carries an `AbortSignal` tied to the client socket (guarded on `writableEnded`, since close fires on normal finish too).
- **Segments disguised as images**: HDHub4U's playlists point at TikTok's image CDN — each segment is a real 70-byte PNG header with MPEG-TS glued behind it. No demuxer option helps; detection is PNG magic + a sync-byte run at 188-byte stride, only on routes minted by a playlist rewrite.
- **Route eviction is scheduled, not per-mint** (§6.10).

Test traps: **`MediaProxy.wrap` returns loopback URLs untouched**, so a 127.0.0.1 test origin is never proxied and tests nothing real. Regression tests must be verified to FAIL with the bug restored — a stub that ends its own body passes trivially.

### 6.7 The native engine: mpv

4K HEVC 10-bit has exactly one browser path (re-encode to 8-bit H.264 — a whole CPU core, discards HDR, flattens 5.1, downscales under 16 threads). mpv carries its own FFmpeg and hands bitstreams to D3D11VA/NVDEC/Vulkan/VideoToolbox: the same file plays untouched, full resolution, a couple of percent of one core.

**Routing is a decision, not a mode** — `shouldRouteToNativeEngine` runs *after* the browser-side decision, so removing mpv reverts every verdict exactly. Policy (`native_engine_policy`): `off`; `auto` (default — anything the browser path would re-encode or downmix: above-stereo, or lossless/object-based audio at any channel count); `aggressive`. **The channel rule replaced a codec rule** after a lossless-only rule pushed nearly all TV (modal E-AC-3 5.1 WEB-DL) to software re-encode when the GPU decodes it free.

**A stream never reaches mpv without inspection** — no raw-URL entry point, and `VideoPlayer` refuses to assign a `NATIVE_MPV` URL to the element.

- The URL handed over is the **proxied** one; headers go per-file via `loadfile`'s option map (one process serves a whole series and headers differ per episode).
- `--no-config` (a user's own config would silently change behaviour); `--ytdl=no` (wastes ~8s on failures already diagnosed).
- `video-params/pixelformat` reports the **GPU surface type** once hardware decoding runs — read `hw-pixelformat` for the real format.
- **`mpv.com`, not `.exe`** — the GUI-subsystem binary has no stdout. 7z extraction needs bsdtar (Windows' own `tar`, not `Expand-Archive`). mpv is wired into `before-quit`, else it outlives the app.
- **mpv draws its own window**, so `--osc=yes`/`--osd-level=1`/`--input-vo-keyboard=yes`. But **`--input-default-bindings` stays `no`**: defaults quit on `q`/`Q`/`Ctrl+q`, and mpv exiting while playing reports `ended` → advances to the next episode. Bindings enumerated manually (`NATIVE_KEY_BINDINGS`) to match `VideoPlayer`'s (`SKIP_SECONDS` = 10 in both). `end-file` reason `quit` reports `idle`, not `ended`.
- **`--force-seekable=yes` is removed.** Three host shapes: (a) 206 + `Content-Range` + `Accept-Ranges`; (b) 206 + `Content-Range`, no `Accept-Ranges` (honest but silent); (c) `video-downloads.googleusercontent.com` — **200 and the whole file from byte 0 regardless of the Range asked**. On (c) mpv accepted the seek and satisfied it by reading-and-discarding from 0, so the timeline never moved — and **every Continue-Watching resume hit this, since resume is a seek before the first frame**. Measured: the flag never helps and actively hangs.
- **`--volume-max=100`.** mpv's default is 130 and VLC's scale goes to 512; a >100 value divided by 100 and assigned to `HTMLMediaElement.volume` throws `IndexSizeError` **inside a `useEffect`, unmounting the player**. `clampVolume` is a second line of defence in both `VideoPlayer` and `mpvEngine`.
- Echo suppression needs **two** rules: a 700ms window (`AUDIO_ECHO_MS`) ignoring incoming values while a local change settles, **and** a value record (`engineAudio`) so an engine-originated value is never pushed back to that engine. Cleared on engine change, else the first push to a fresh player is suppressed.
- **Not built: embedding.** mpv is a separate OS window driven over IPC (roadmap Option A); true embedding needs libmpv's render API via a native addon. `MpvOpenRequest.windowHandle` exists, unused.

`mpvEngine.test.mts` (19 cases, real mpv against a synthesised HEVC10/AC-3-5.1 MKV) is deliberately impure — the failures live in the inter-process seam.

### 6.8 The failure ladder

element `error` → re-decide with `force` → route to mpv → skip the source.

- **The forced pass must still ask mpv.** `PlaybackEngine.prepare` once hard-set `FULL_TRANSCODE` on the forced pass, bypassing `shouldRouteToNativeEngine` — so exactly when the native engine was most needed it was guaranteed to re-encode. Traced: `hev1` 1080p probed `dash`/`hevc`, remuxed, failed in the element, re-encoded frame by frame; the same URL to mpv opens `d3d11va` in ~1s. Exclusions: `EME_NATIVE`/`requiresEmeDecryption` (mpv has no CDM). **The returned capability is rewritten** — `VideoPlayer` reads `capability.requiredStrategy`, and handing back the pre-force model loops the element on a source mpv could already play.
- **The ladder was wired to `<video>` only.** hls.js's fatal handler was one `setError()` line and Shaka's `.catch` the same shape, so `Playback error: fragParsingError` was the whole of what a viewer got from an HLS stream whose segments had downloaded intact — mpv idle, ffmpeg untried, next candidate never reached. **This is the reported "it downloads but it will not stream".** `player/playbackRecovery.ts` (pure, 16 tests) decides by *what would change the outcome*: nothing arrived → fetch again within a budget; bytes arrived and could not be read → hand to another engine (re-fetching identical bytes produces an identical refusal); budget spent → genuinely unplayable. `fragParsingError` escalates on sight; `bufferStalledError` gets one `recoverMediaError()` first. 403 retried, 404 not — same rule as `SourceCache`.
- **Three "the error outlived the failure" bugs**, all producing "it says it cannot stream while mpv is playing": `setError(null)` sat *below* the `NATIVE_MPV` early return in the attach effect (clear before the branch); `NativeEngineStage` renders `null` while holding an error and had no way to clear one — it now clears on `state === 'playing'` **for its own `url`**, since a late snapshot describing the previous source must not retire this one's failure; and the `[streamUrl]` reset effect reset every ref except the error. A `playing` listener on the element clears the error — `play` fires when `play()` is *called*, only `playing` means frames are presented.

`SourceCache.recordFailure`: **definitive** (404/410/"file is gone") drops immediately; **counted** (timeout/reset/5xx/403) needs 3 strikes, cleared by `recordSuccess`. **403 is specifically not definitive** — expired signed URLs and hotlink protection both answer 403 and both recover by re-resolving.

Genuinely dead hosts (recognise, don't re-debug): `workers.dev` 500/403, `r2.cloudflarestorage` 403 NotEntitled, pixeldrain 404, `hcdn3.hakunaymatata.com` DNS failure. Measurement trap: probing a manifest with `Range: bytes=1000000-` returns 416 (the file is a few KB) — ask for a satisfiable range or none.

### 6.9 The vendor coverage matrix — `tools/e2e/native-engine-matrix.mjs`

```
node --experimental-strip-types tools/e2e/native-engine-matrix.mjs
  [--plugins 12] [--links 2] [--only Cinefreak,HDhub4u] [--titles hindi-movie,english-series]
```

Answers "given what extensions hand back, can this app put it on screen?" Imports the shipping `MediaInspector`/`decideStrategy` (not a reimplementation), then **actually plays** each candidate via headless mpv (`--vo=null --ao=null`, full demux/decode) for a few seconds, recording playhead progress and dropped frames. **`--untimed` deliberately not passed** — it would hide sustained-realtime failures. Records **both** verdicts (with and without the native engine); a differing row is a stream that used to be re-encoded and now isn't. Hindi-title coverage is deliberate (dual-audio MKV, per-language 5.1 AC-3/E-AC-3, 10-bit HEVC cluster there).

### 6.10 The window stopped answering while a film played

Windows marks a window whose message loop has stalled 5s as "not responding"; in Electron that loop is the **main process's**. Two independent costs were paid there, both only reachable while playing + searching + mpv open.

**1. The proxy swept its whole route table on every mint.** Rewriting one HLS media playlist mints a route **per segment** (~1300 in one synchronous burst), and each mint re-swept everything; past `MAX_ROUTES` each also took the `O(n log n)` sort path. One playlist rewrite:

| routes held | before | after |
|---|---|---|
| 1,000 | 306 ms | 8 ms |
| 5,000 | 800 ms | 2 ms |
| 15,000 | 1,202 ms | 2 ms |
| **20,000 (cap)** | **6,654 ms** | **9 ms** |

The table only grows within a session (every source probed adds to it) while `ROUTE_TTL_MS` is an hour — so once a session crossed the cap it **stayed** broken, which is why it reads as "searching causes it". Fixed by changing *when*, never *which*: the expiry sweep runs at most every `SWEEP_INTERVAL_MS` (30s, against a 1h TTL), and a trim goes down to `ROUTE_LOW_WATER` (90% of cap) — trimming *to* the cap leaves the table one mint over it, so the next mint sorts again.

**2. mpv pushed a snapshot per presented frame.** Observing `time-pos` delivers a `property-change` **per frame**, not once a second. Measured (1080p25, 15s, real mpv): 451 property changes — 375 `time-pos` (25/s), 56 `demuxer-cache-time` — so 30 `emit()`/s and **60 `webContents.send`/s** (main sends `mpv:update` and `external:update` for each); 60fps doubles it. Each push re-rendered a 4,020-line `VideoPlayer` plus `NativeEngineStage`, whose snapshot effect depends on five callbacks that are fresh closures every render.

`media/mpvEmitPolicy.ts` (pure, 14 tests): state change, error, pause, track selection, volume or a different file go **immediately**; only playhead, buffer, frame rate, dropped frames and startup latency may wait `COALESCE_MS` (200ms ≈ `<video>`'s own `timeupdate` rate). Measured after: **60/s → 10/s**.

Two rules: **`COALESCEABLE` is an opt-out, not an opt-in** — a new `MpvSnapshot` field defaults to being delivered, and a test enumerates every field of the type and fails if one is neither named coalesceable nor able to make a change significant. And **the timer re-reads `snapshot()` when it fires** rather than closing over the one that started it. `teardown` clears the timer and drops `lastDelivered`, so a new session's first snapshot is always significant.

Known, not changed: `WebViewHost`'s `MAX_CONCURRENT` of 3 — three hidden Chromium windows running ad-heavy resolve pages with `backgroundThrottling: false` are a real CPU cost during playback, but they are separate processes and were not the stall.

### 6.11 Probes remembered, verdicts recomputed

`media/inspectionStore.ts` is keyed on the **origin** URL, never the proxied one (a per-session token would always miss on restart). The **measurement** (codecs, bit depth, tracks) is a fact about the file and is cached; the **verdict** depends on this machine's decoders/GPU/mpv/policy and is always recomputed — caching it would be the stale-cache bug's most expensive form (install mpv, everything keeps re-encoding per a week-old record). Query strings are **not** stripped, which would merge distinct signed-URL films' codec lists.

The cache was once keyed on the loopback address (`/stream/1`, a token minted per process), so **the second film was decided from the first film's codecs**. `MediaProxy.getTargetRoute` unwraps to the upstream URL; the store refuses and prunes loopback keys.

### 6.12 Player behaviour

- **The mini player never remounts `<video>`.** Minimising is a CSS geometry change (unmounting stops the stream, loses position, renegotiates the swarm). Chrome hidden with CSS, not conditional rendering. Shortcuts disarmed in mini mode. Drag/resize is owned, not `resize:both` (can't hold aspect ratio); the handle is **top-left**, since a corner-parked window's bottom-right handle would be off-screen.
- **Floating playback is four mechanisms, not a scale**: in-app mini (CSS, always works), native PiP (moves the `<video>` surface; **unavailable for exactly what this app most often plays**, since mpv/VLC render in their own windows), app-window always-on-top, and mpv `ontop`. `isPipSupported` checks readiness *and* that the native engine isn't holding the stream. Audio-only hides the picture via `visibility`, not `display` — layout removal can stop decoding on some builds; it genuinely stops decoding on mpv (`vid=no`) but is a no-op on the element, and says so in its own help text. PiP rejection reasons are surfaced as sentences — a silent no-op button is the worst outcome.
- **Volume/mute/speed/track languages persist by language, never index** — track 2 is a different thing on every release.
- **Controls hide from one place** — a state machine polled on a timer, not `setTimeout` chains. A zero-`movementX/Y` `mousemove` is never activity: Chromium synthesises exactly that when hiding controls changes what's under the cursor, which caused a flashing feedback loop.
- **One failure surface**: `player/PlaybackErrorPanel.tsx` (`.player__overlay` z-index 4, above `.native-stage` 3, below `.player__top` 5 and `.player-panel` 7); two stacking overlays used to render through each other. **The first action offered is Download** — decoding and fetching are different capabilities, and a 10-bit HEVC file can be undecodable here and download fine. Suppressed only when the source is dead (`describeUnreadableSource`).
- Messages flow in two columns (`.player__messages--top`/`--bottom`) with `pointer-events:none` on the stack and `auto` per child.
- `NativeEngineStage` keeps only mpv track selection and fullscreen. It once drew a duplicate transport row under `z-index:3`, beneath `.player__controls` — unclickable, and its flex overflow caused a scrollbar with nothing to scroll to (**a flex item never shrinks below its content unless told to**). `onPausedChange` reports the engine's own `paused` upward, because the element's events never fire for mpv. Buffering is deliberately **not** forwarded — that overlay's copy is torrent-specific and would lie about an HTTP stream.
- **The preparation effect keys on a serialised `activeSourceKey`, not object identity.** `activeSource?.directHeaders`/`.drm` are new objects on every `playback:update`, causing stall→teardown→re-prepare→stall loops. **Add new source fields to the key, not the dependency array.**
- **`MpvEngine.serialize` queues `open`/`stop`/`shutdown`.** `mpv:stop` (cleanup) and `mpv:open` (new mount) once fired in the same tick unordered, so the old kill landed on the newly-started process. `shutdownNow` awaits the child's actual `exit`. **`playback:stop` no longer stops mpv at all** — not every session owns a stream, and the detail page's picker starting a scrape used to kill the mini-player's film. Closing the player closes mpv. Idle mpv (`--idle=yes`) left a blank window after `stop()`; it now quits.

### 6.13 Subtitles

Android always had SubRip + WebVTT + SubStation Alpha through `juniversalchardet`; desktop had neither. `.ass`/`.ssa` went through the SubRip converter (emitting `[Script Info]`/`Dialogue:` as cues), and every download decoded as UTF-8 unconditionally, so Windows-1252/GBK subtitles got correct timing and black-diamond garbage per accent.

`electron/subtitles/convert.ts`: **UTF-8 is checked (fatal-mode `TextDecoder`), not detected** — the statistical detector only sees provably-non-UTF-8 files. **A UTF-8 detection is rejected if the decode produces U+FFFD**: `chardet` false-positives on 4-byte Windows-1252 strings, and non-fatal `TextDecoder` substitutes rather than throwing, so the substitution char *is* the error signal. ASS conversion reads the `Format:` line (order is per-file), bounds the `Dialogue:` split (commas in text), drops `\p1` drawing commands.

**Provider subtitles are a real source** — `loadLinks` returns them and `subtitles:search` merges them **ahead of** OpenSubtitles, critical for extension-sourced content with no IMDb id. Appearance is one record, two renderers (`src/utils/subtitleStyle.ts` → `::cue` vars and mpv properties; `sub-pos` counts down from 100 where the CSS lift counts up).

### 6.14 External players

| Player | Channel | Capability |
|---|---|---|
| mpv | JSON IPC via `MpvEngine` | `full` |
| VLC | built-in HTTP interface | `full` |
| MPC-HC/BE | web UI, off unless user-enabled | `none` |
| PotPlayer, IINA, Celluloid, SMPlayer | none | `none` |

VLC is launched `--extraintf http` on an OS-assigned loopback port behind a per-session password (unauthenticated by default otherwise). **Capability can downgrade at runtime** — a VLC build without its HTTP module plays fine and answers nothing, so it reports `none` after a grace period rather than offering dead controls. `transport` in `VideoPlayer` is the single "who holds this stream" answer (element/native/external); volume/mute/speed apply to all engines so a handoff-and-back doesn't reset.

The URL handed over is **proxied** (headers pre-applied — each player has an incompatible or absent way to set `Referer`). Nothing is downloaded on the user's behalf; if no player is found, official download pages open. Suppressed when the source is dead — a 404 plays no better in VLC.

---

## 7. Torrents and indexers

### 7.1 Startup: the client was cold, it was never the swarm

Compared against a hosted service (~1s vs tens of seconds) with identical peers. The gap is one-time costs a service pays once and a desktop app paid every launch: socket binds, DHT bootstrap (DNS + round trip to `k-rpc`'s 3 hardcoded hosts), converging on an infohash from 3 contacts, reachability from an ephemeral node id/port, and the info dictionary (BEP-9, 5–30s).

1. **`TorrentEngine.warmUp()` 8s after the window opens** (`TORRENT_WARMUP_DELAY_MS`). Never awaited, never fatal.
2. **DHT routing table / node id / port persist** (`dhtNodeCache.ts`, `userData/torrent-state/`). Contacts expire weekly; the node id doesn't. `dhtPort` is pinned to **6882** — WebTorrent's default of 0 quietly cancelled the persisted id.
   **Saved contacts go through `DHT.addNode()`, never `bootstrap`.** `k-rpc` compares the candidate-set length against `bootstrap.length` every lookup round, so 200 saved contacts in `bootstrap` makes that test permanently true: the per-lookup table (the convergence mechanism) is discarded every round and `bootstrap()` fires the whole list in one burst, bypassing the concurrency gate. A test pins `DHT_BOOTSTRAP_NODES.length < 20`.
3. **`.torrent` metadata cached on disk by infohash**, self-verifying (info dict sliced and SHA-1'd; a mismatch is deleted). The bencode reader is hand-written because the hash must cover the **exact original byte range** — a parse/re-encode round trip normalises key order and loses it.
4. **Magnet `xs` mirror links** — WebTorrent already races them against the swarm and discards mismatched infohashes; this module just builds the URLs. Setting `torrent_http_metadata_cache` is a **getter**, consulted per magnet, not read once.
5. **`ut_pex` stated explicitly** (helps when the tracker is slow or dead).
6. **Magnet `tr=` trackers merged into `announce`** — a cached `.torrent` buffer used to discard the magnet's trackers entirely.

Timing: `METADATA_TIMEOUT_MS` 45s→25s plus a 12s dead-swarm bail (measures **known** peers `_peers`, not connected — reachability is `swarmHealth.ts`'s job). `PLAYABLE_THRESHOLD_BYTES` 8MB→4MB (lower and the demuxer runs out, which reads as a stall). The tail window is **container-aware** (`tailPriorityBytes`): MP4/MOV/AVI need a trailing `moov`/`idx1`, Matroska doesn't, MPEG-TS has no trailing index at all (MKV is the modal container here).

**Does not fix**: CGNAT reachability, genuinely dead swarms, host-side 403s.

Two more load-bearing torrent behaviours: **file selection inside season packs** (deselect all, select one, or bandwidth splits across episodes and nothing plays) and **leading-bytes readiness** measured as contiguous leading pieces, not overall percent.

### 7.2 A search costs what its worst indexer costs

Every indexer used to get a flat 20s and they all ran at once; the circuit breaker needed three consecutive failures, so a permanently blocked scraper cost three full timeouts, then three more five minutes later.

`torrent/indexerBudget.ts` (pure, 22 tests) decides from measurement:
- **Deadline = p90 of that indexer's own recent successes × 2.5, clamped [4s, 20s].** No history → the full budget; judging a source before it has answered is how a slow-but-working one gets called dead. p90 not mean, so an occasional 3s tail sits inside the budget. **Only successes shape it** — otherwise timing out buys a longer deadline.
- **A timeout weighs 1.5× an error** toward tripping: a 404 costs one round trip, a timeout costs the whole search.
- **Cooldown escalates** 5m → 15m → 45m → 2h, and **any success resets the ladder**.
- Fastest-first ordering, with **unproven ahead of recovering** — putting the unproven last is how a new indexer never accumulates history.

The aggregate stops waiting for stragglers (`STRAGGLER_GRACE_MS`, floored by `MIN_SEARCH_MS`). **Nothing is cancelled and no result is lost** — every indexer runs to its own deadline and still reports through `onProgress`. This bounds the *wait*, not the work.

### 7.3 A Cloudflare challenge is not a ban

`requestOnce` threw `HTTP 403` for a challenge, a country block and a hotlink refusal alike, and `withRetry` doesn't retry a 4xx. Worse: **Cloudflare's managed challenge is routinely served as HTTP 200** with an interstitial body, so cheerio parsed zero rows and the adapter reported "no results" — a search that silently got smaller.

`torrent/botChallenge.ts` (pure, 17 tests) separates challenge / block / rate-limit, and `WebViewHost` — which has solved these for `.cs3` extensions since 2026-08-24 and which the torrent lane could not reach — now solves the solvable ones once per host via `setChallengeSolver` in `main.ts`.

- **A block or a rate limit never opens a window.** A browser passes neither, and at a rate limit it makes things worse (a dozen subrequests where the scrape made one). `503` + `Retry-After` is checked **before** the challenge markers.
- A 403 behind Cloudflare with **no body to read** gets the benefit of the doubt — guessing "block" costs a working indexer; guessing "challenge" costs one browser window that finds out.
- Challenge markers are narrow: a listing page whose footer says "secured by Cloudflare" is a working page.
- **The clearance is sent with the User-Agent that earned it** (they are bound) and is **held in memory only** — restoring one from disk onto a new IP produces a failure indistinguishable from a fresh challenge.
- **`fetchDocument` is separate from `fetchText`.** HTML scrapes send what Chrome actually sends (`Sec-Fetch-*`, `Upgrade-Insecure-Requests`, a real `Accept`); RSS/JSON endpoints must **not** be asked for a document. The UA had always claimed to be Chrome while the request beside it asked for a wildcard `Accept` with no fetch metadata — a combination no Chrome produces, and exactly what bot detection scores.

TokyoTosho and AniDex were added **off by default**: the anime lane had one broad source (Nyaa) plus a spare that aggregates it, so one outage took both, and Nyaa's `c=1_2` filter removes raws and non-English releases before a query is typed. **Neither has been driven against a live host.**

### 7.4 Indexer adapter rules

`torrent/indexers/base.ts` holds `withEpisodeTerms`/`tryMirrors` (7+6 copies merged) plus `buildMagnet`/`trackersFromMagnet`/`mergeTrackers`. **Zero-padding `S01E02` matters** — drop it and `S1E2` matches nothing, which reads as "the indexer has nothing". Two anime indexers keep their own rule (absolute episode numbering).

**A direct HTTP link is not an indexer result** (PRD-43 §6) — debrid/live/yt-dlp/Jellyfin are *provider* sources regardless of what found them. `StremioAddonIndexer.search` once filtered to `infoHash`-carrying replies only, silently dropping every debrid/HTTP-only addon reply; `RawTorrent` gained a **direct URL half**, finished before magnet derivation. Identity is shared with `ContentService.extensionSources`'s `directSourceIdentity` (`ext-` prefix), else two lanes finding the same host show as two sources. `seeders: 1` is set because swarm health is meaningless for HTTP and `minSeeders` default 1 would hard-reject. `fileIdx` is dropped on `url` streams — it indexes a file *inside* a torrent.

**yt-dlp**: `extractLinks`/`searchAndExtract` existed with no caller. Transport detection was `url.includes('.m3u8')` with `fmt.protocol` sitting unread (nothing is decided from URLs); **both** video and audio streams are now required (a video-only DASH format plays silently — the same shape as the AC-3 bug). The `ytsearch1:… trailer OR full feature` fallback was removed — a trailer standing in for a film is a synthetic source. `YtDlpEngine.resolve` answers with a **reason** from stderr (Unsupported URL / Video unavailable / geo-block are three different actionable outcomes). `--no-playlist` is passed, else a series page resolves every entry. Two entry points: a pasted page URL is its own search row, and `ContentService.discover` resolves `http(s)` bases through yt-dlp. **Not** resolved from the search box — typing is not consent to spawn a process per keystroke.

---

## 8. Search, scope and ranking

### 8.1 Scope: a selection is a strict filter, not a preference

An unresolvable stored selection used to silently widen back to *everything* (`kept.length > 0 ? kept : candidates`), and the picker could offer fake provider names for extensions registering none — the user picks 1 source and the app queries 200. It is strict now, and unresolvable selections are **reported** (`missingProviders`/`missingIndexers`).

`SearchSession.plan()`: nothing selected → global (every provider + metadata catalogues); providers selected → **exactly those, no catalogues** (catalogues would reintroduce excluded sources under another name); indexers selected → title-searched directly.

The hierarchy is exactly **repository → extension → provider**. The provider is the selectable leaf: its globally-unique name is the scope identity, the `cs3ext://` address and the enable/disable key. A name collision is real — first wins, and the loser is reported via `unavailableReason`.

**`SearchScopePicker` filters on `effectivelyEnabled`, not `enabled`** — a repo-disabled provider offered by name would search nothing.

### 8.2 Discovery scope: ask the originating provider first

Android returns one search row per provider, binding Play to that provider alone. This app merges rows across providers (correct — one film shouldn't be seven rows), but `runDiscovery` used the merge as licence to fan out to **every** enabled provider and indexer, drawing 200 sources for a title 2 providers actually carried.

`cs3/sourceScope.ts`: default scope **`origin`** = only the providers whose results produced this row, no indexers; explicit **`all`** = everything. `origin` widens to `all` automatically when nothing claimed the title (home-screen items).

**Auto-widen when origin finds nothing** (`shouldEscalateScope`): a reported case found 137 sources (81/98 live) behind a dead-end "Find more sources" button the app could have pressed itself. It goes through `getSources` so it joins the shared in-flight map (a manual press during auto-widen doesn't double the fan-out); two independent recursion guards; **a failed escalation leaves the narrow answer standing**, never surfacing a worse error; the fan-out's `load(base)` may fail when the title is already known (escalation is enrichment, not discovery, once titled); the prefetcher passes `autoWiden:false` (opening a detail page isn't a play commitment) and it is part of `sourceKey`, else Play would join a settled-for-narrow prefetch. `SearchProgress.widened` explains the up-to-3× longer wait live.

### 8.3 The fan-out order is measured

The order was the provider registry's, i.e. install order — and that order decides how long the screen stays empty, since a lane timing out on a dead provider is a lane not spent on one answering in 350ms. `ProviderAnalytics` had been measuring success rate and latency all along and `ProviderRanking.rank` turning them into an order that **only a settings panel read**. `searchEach` reads it now.

`cs3/searchOrder.ts` is a module rather than one line because of its guard: **an ordering that is not the same set** — one dropped, added, duplicated behind a plausible length, or a throw — falls back to the original. A ranking is scored from noisy scrapes through stored weights and a smoothing prior; that is more machinery than a search should trust with "which providers am I searching". **Silently searching fewer sources and reporting it as "no results" is the worst failure this app has**, and reaching it through an optimisation is worse.

### 8.4 Ranking rules

1. **`empty` ≠ `failure`.** An anime provider with nothing for *Dune* is correct; merging the two buries specialists.
2. **Smoothed toward a neutral prior**, else it is self-fulfilling — one lucky 100% beats 95%-over-400-calls and gets asked first forever.
3. **No-data criteria are excluded from the denominator**, never scored zero.
4. **Nothing is ever auto-disabled.** Auto-*enable* is opt-in and score+sample-gated. A week-long outage is not consent to remove a user's chosen source.
5. The maintainer's declared `status` (0 down / 1 ok / 2 slow / 3 beta) is weighted **0.4** with `minSamples` **0** — a declaration isn't a sample, but requiring samples would exclude it forever; it loses to real counters the moment those exist. `ProviderRanking.setContext` supplies it post-construction, avoiding a construction-order cycle with `PluginManager`.

The settings panel shows every number and sample count plus an erase button — opaque reordering breeds distrust.

**Providers must not be scored for things that are not their fault.** The guards used to live in the *callers*: `loadLinksDetailed` wrote `if (kind !== 'provider-missing')` by hand and `searchEach` had none, so whether the ranking followed its own rules depended on which call site produced the failure. `UNSCORED_FAILURE_KINDS` now lives in the taxonomy (§5.5). Measured on one real search: Disney, Marvel, Pixar and Star Wars are catalogue-only providers that each answered "does not implement that operation" and were each recorded as a **failed search** — four permanent penalties per query against providers working exactly as designed. They have their own `SearchSourceOutcome` state (`unsupported`), read "Browse only — this source has no search", and `explainEmpty` excludes them when deciding whether *all* sources failed.

Two related traps:
- **A cancellation with no message was filed as an extension crash.** `kotlinx.coroutines.JobCancellationException` — the bare class name, which is what `describe()` produces when the exception carries none, and a cancelled coroutine carries none. The word-boundary regex needed a non-word character after "Cancellation" and found `E`. **Found by writing the test, not by reading the regex.**
- **A guess we made was blamed on the provider.** `extensionSources` calls `loadLinks` before `load` — correctly, since plenty of providers' link handle is a page address. For those whose handle is their own JSON, that first call throws inside the provider (`JsonParseException: Unrecognized token 'https'`). The retry works and the viewer gets their film, while the doomed first call was logged at error level as "the site has probably changed" and counted against the provider. `looksLikePageAddress` marks that call **speculative**: still made, still diagnosed (when the retry also fails it is the only account of what the viewer asked for), logged as a guess at `warn`, never scored. A test pins that the two predicates can never both be true.

### 8.5 Provider health, shown where it is chosen

`src/components/search/providerHealth.ts` (pure, 12 tests) puts Excellent / Good / Average / Poor on the provider rows in the scope picker. It reads `score.band` rather than re-deriving one — **two places computing "is this any good" is how the settings panel and the source list come to disagree in front of one user.** `unproven` keeps its own answer and is never folded into the middle of the scale: on a fresh install that is every provider, and a label reading as mediocre is the silently-punitive behaviour the ranking exists to avoid. Unmeasured rows draw **no badge at all**. A pinned or blocked provider is described as a choice, not measured as a quality.

### 8.6 Source profiles — All sources is a mode, not an erasure

The All-sources button was `persist(new Set(), new Set())` — an *erasure*, so eleven providers picked out of two hundred vanished on one press with no undo.

`cs3/sourceProfiles.ts` (pure, 30 tests) holds three things that can drive the scope: All sources, a saved profile, or the unnamed draft — and **the draft survives every switch**.
- Editing while a profile is active edits **that profile**; editing under All sources writes to the **draft**, never into whichever profile was last used.
- Deleting the active profile falls back to **All sources**, never to the next in the list — silently searching a different user-defined set is worse than searching everything, because only one of those is obvious from the button.
- **A facet filter alone is not a narrowed scope.** Facets decide which rows the picker shows; a button reading "1 source" over a search of two hundred is the lie `SearchScopeStore` was fixed to stop telling.
- A profile may narrow the adult gate and can **never** widen it.
- A corrupt stored record degrades to empty rather than throwing.
- An upgrading user's existing selection is adopted as the draft on first use (`adoptExistingScope`), deliberately **not** at construction — doing it at startup would silently widen the next search.

### 8.7 The scope picker

`search/SourceScopeDialog.tsx` (presentation) + `search/sourceScopeModel.ts` (pure, tested); `SearchScopePicker.tsx` keeps all data and state and is the trigger. Two distinctions were invisible in the old 330×300px dialog:

1. **A filter is not a selection.** Chips narrow what the list *shows*; a ticked box narrows what the search *asks*. As adjacent rows of similar pills they read as one mechanism — someone who filtered to "Hindi" believed they had scoped their search to Hindi providers. Separate panes, separate headings, one line in the rail saying which is which.
2. **Which facet a chip belongs to.** Twelve language chips beside six type chips separated by a hairline does not express **OR within a facet, AND across facets**. Each facet is a labelled group.

Plus: the current scope is a strip of chips that each remove their own source — a count answers "how many", never "which".

Real `tree`/`treeitem` with roving focus via `aria-activedescendant`, arrows stepping over label rows, Left/Right collapse/expand, Space to tick, focus trap, focus restored on close. **Escape is handled in capture phase.** Viewport height is **measured** (`ResizeObserver`), not a constant — the dialog is sized in `vh` and a constant mounts invisible rows on a laptop or leaves a blank band on a large display.

**`stateOf`'s vacuous case is the tested one**: a row with **no members** must read `off`, never `on` — an extension that registered nothing would otherwise draw as ticked, advertising a scope that queries nothing.

The picker's menu-open fetch used to load **every installed extension into the sidecar first** (minutes of DEX translation, no progress shown); searching "fixed" it only because search awaited the same load. Now `getSearchScopeOptions(false)` on mount (instant, from what's already registered) vs `(true)` on open (pays the cost with visible progress via `extension:providerLoadProgress`).

### 8.8 Prefetch, and sharing in-flight work

Play used to start a 15-provider scrape from cold; the detail-page reading window is free time to do it in. `cs3/sourcePrefetcher.ts` is safe **only because of in-flight sharing** (`sharedDiscovery.ts`) — else Play would double every scrape. Cancellation is by **consensus** (every caller's `AbortSignal` must withdraw); an aborted run is never joined (it stays in the map until settled). Restrained: waits ~1.2s to settle, skips on `hasFreshSources` (a `peek`, which doesn't promote), one at a time (supersedes), togglable for metered connections. The detail page shows state; `waiting`/`idle` render nothing — no badge for a mere glance. `SourcePrefetcher.schedule` is safe to call from anywhere (it declines/dedupes/supersedes internally; the player calls it at 70% of an episode).

### 8.9 Results, catalogues, OTT

- **The home screen is discovered, not hardcoded.** It used to be 3 fixed searches ("Spider-Man"/"One Piece"/"Stranger Things") against every provider, called "Trending" — a category error (scrapers have no popularity opinion) plus the slowest scraper's timeout on every launch. Now keyless Cinemeta (`cinemeta-catalogs.strem.io/{top,year,imdbRating}`, IMDb-keyed, 19 genres, pageable via `skip`) + AniList seasonal anime, kept separate from the Animation genre (IMDb's "Animation" is mostly Western film). **No API key ever** (TMDB/Trakt/OMDb/Fanart/TheTVDB all eliminated — an embedded key is a licence violation and gets revoked). Stale-while-revalidate. **Finds nothing playable** — sources resolve only when a title opens. Personalised rows come from local-library genre counts; nothing about the user leaves the machine.
- **Results that resolve to nothing are held back** (`src/utils/deadRows.ts`). **`app-error` is never hidden** — our own failures must stay visible, or a translation bug looks like a hundred broken providers. The whole page is never hidden, and the count is stated with the hidden rows one click away.
- **OTT platforms** (`cs3/ottPlatforms.ts`) map provider names → Netflix/Prime/Hotstar/Disney+/Sony LIV/ZEE5/JioCinema by **name matching only** (no other identity exists). Too-loose is far worse than too-tight (silent wrong-content fill vs. a renamed provider merely disappearing): exact names win first, patterns are anchored against known false positives (`PrimeWire`, `Ahashare`, `Netfilm`). Four availability states (`ready`/`disabled`/`aggregate`/`missing`) — collapsing to "no content" would tell a user who disabled a provider that the platform doesn't exist. A platform is a **set** of providers. Search from a platform page uses `SearchOptions.providers` override, **never written back to the stored scope**. Browse asks **one** provider (editorial "Trending" rows from two providers would interleave into neither's meaning); paging is a button, since each page is a live scrape. Sony LIV/ZEE5/JioCinema have no dedicated provider and fall back to aggregate scrapers — **fallback never merges**.

### 8.10 The extensions screen (`src/components/extensions/`)

- **Disable ≠ uninstall, and both work.** `removeRepository` used to delete only the URL, leaving installed extensions running. Removing now cascades to uninstall; `setRepositoryEnabled`/`setExtensionEnabled` are the reversible alternative.
- **The enable cascade lives in `enabledProviderNames` only.** `getProviderTree` recomputes the identical predicate as `effectivelyEnabled` — **if they disagree, the screen lies about what a search will ask.**
- `enabled` vs `effectivelyEnabled` are deliberately separate: a provider off because its repo is off must show the responsible ancestor, not look self-disabled.
- Tag filters are multi-select and derived from installed data — the old hardcoded 3-option `<select>` silently omitted NSFW/Live/Documentary. **OR within a facet, AND across facets.**
- Install progress is real (`onExtensionInstallProgress`); the old code faked a scripted 250ms `setTimeout` sequence plus 500ms of invented delay per action.
- Provenance (`repository ▸ extension ▸ provider`, maintainers, version, types, hash) on every row.
- Browse is a full-width panel under the repo's own card, not a third tab that discarded scroll and filter state. Two tabs: **Installed** / **Browse**.
- The Providers tab was removed — it was a second, desyncing copy of the tree's leaves.

---

## 9. Library, pages, downloads

### 9.1 A links handle is not a page address

Upstream's `MainAPI` has two incompatible handle kinds under one `String` type: `load(url)` (a page address, fetched) and `loadLinks(data)` (an opaque provider-built blob, often JSON). Handing a links blob to `load()` reached OkHttp's `HttpUrl.get`, threw, **was scored against the provider** and shown as the reason playback failed — while the provider was fine. Reached from 3 directions, unified into `cs3/extensionAddress.ts`'s `looksLikeLinksHandle`. The test is narrow: JSON is definitely not a page; anything else might be (Internet Archive's `load()` takes a URL while `loadLinks` takes a bare id).

**The persisted form of the same bug**: `DetailView` recorded the playback handle as `progress.mediaUrl`, breaking library and Continue-Watching rows on the *second* visit. `libraryStore.recordProgress` keys on `canonicalKey(title, year)` + season + episode, **never `mediaUrl`**, so nothing is orphaned. Pre-fix rows are unrecoverable (a page address isn't derivable from a links blob); the failure screen offers "Find `<title>` again".

Two Play buttons wrote the same bug: `App.handleQuickPlay` and `DetailView.handlePlaySource` wrote `episode.url` into `progress.mediaUrl`, so series played that way always wrote a dead address and disabled next-episode prefetch. Fixed centrally — **`LibraryStore` refuses a links handle on the way in.**

**Play must not restart a series at episode one.** `src/utils/resumePoint.ts` (pure): **a null episode means "Play"**, not "play the series URL"; the rule is **furthest episode with history wins**, never most-recently-updated — otherwise re-watching an early episode of a finished show sends every later Play backwards.

### 9.2 A saved page had nothing behind it

A library row carries a title, poster and year copied when it was added, so the **list** always looked right. The **page** behind it was drawn entirely from what the provider answered at that moment — and when the provider was switched off, uninstalled, throttled or had changed shape, that was nothing. Reported as "the app lost my saved content". It was never lost; it was never written down.

`cs3/pageSnapshot.ts` writes it down, captured in **`ContentService.load`** — the one funnel catalogue, native-provider and extension pages all pass through, and the only side that knows a provider's ancestry (`provenanceOf`). A page is kept by being *looked at*; saving or adding to the library only **pins** it against eviction (`MAX_SNAPSHOTS` 600, unpinned LRU).

Stored: the display copy, the repository ▸ extension ▸ provider chain, the search query, and **every address known to reach the work**. Those addresses are half the fix — a merged row's `alternates` live only as long as the row is on screen, so a page saved in March had one address in June and it was the one that had stopped working. `DetailView` tries the row's alternates *and* the snapshot's routes. **No playable link is stored** (that is `SourceCache`/`PlayedSource`, which have deadlines; a page that opens and cannot play is worse than one that re-resolves).

**The one rule: a later load may add and may correct, but may never blank.** A provider answering with a title and no poster has said nothing about the poster; reading that silence as "there is no poster" is what made a complete page degrade every time it was opened. Implemented twice on purpose — `mergeSnapshot` (main) and `savedPage.ts`'s `mergeDetail` (display). **Episode listings are all-or-nothing, never field-merged** — splicing two partial scrapes invents a season no provider offers.

The page draws from the copy **before** the provider is asked, so a revisit is instant; the live answer folds over it. When every route fails the copy **stands**, with a banner naming the reason and the copy's **age** — "saved today" beside a failing provider and "saved 8 months ago" call for different responses.

Its own file, not the datastore (episode lists run to hundreds of rows, and the datastore round-trips through Android backups) — but **a backup section of its own**, since restoring a library without the pages behind it reproduces the whole bug on a new machine. Only pinned rows are exported; the rest is cache.

### 9.3 The library remembers which source actually played

`PlayedSource` (per title + season + episode — episode-level, else ep6 overwrites ep5) holds the full `StoredSource` plus an `origin` query. **The link is stored but never the identity** — `origin` re-resolves a fresh link for the same release. Recorded on playback (10s of real play, past every "started then stopped" failure), not on selection. `library:resolvePlayedSource` returns `reused`/`refreshed`/`unavailable` — marked, not deleted, and alternatives offered.

`cs3/playedSource.ts`: torrents match a real infohash; everything else matches the **durable triple** (provider, normalised release name, resolution) — never the synthetic per-URL `infoHash`. Strict, with containment allowed either direction for decoration drift like `[Dual Audio]`; **a wrong-release match is worse than no match**. **No recorded deadline is treated as expired** — guessing "expired" costs one provider call, guessing "still good" costs a full ffmpeg startup and player timeout before failing over anyway.

### 9.4 Downloads

- **A download is addressed by its source variant, not its title.** Duplicate detection once matched by title prefix, so one film at any resolution collapsed into one slot — and the target path was title-derived, so allowing two would corrupt one file via interleaved writes. `src/utils/downloadIdentity.ts`: torrents key on a real infohash; everything else on the durable description (media + season + episode + provider + release name + resolution + quality + language + audio), **never** on `infoHash` (synthesised per-URL, changes on re-resolve). The provider is stored, not the extractor host (`indexerName` changes between resolves). Recovery matches the variant key first, resolution-bound after — the old unconditional `directSources[0]` could silently rebind 2160p→480p and report success. The target path carries the variant, de-duped with a numbered suffix at enqueue. **The batch downloader must not stamp a run-specific batch id into the identity field** (it broke recovery and caused duplicate re-queues).
- **aria2 says `complete`, not `completed`.** A literal string-comparison typo meant `pollAria2Tasks` never matched, so finished transfers sat at 100% "Downloading" forever and the gid was never released. `removed`/`paused` were unhandled too.
- **Completion is verified, not reported.** `finalizeCompletion` on all 3 engines checks the file exists, no `.part` remains, and the size is within 1% (many sources send no `Content-Length`) — else `Failed` with a retryable reason.
- **Delete is two actions** (`remove(id, deleteFile)`); "remember my choice" defaults off — a preference learned from one click nobody consciously set.
- **A partial download must be *proved* to match before resuming.** The old check compared provider-declared size and restarted if >20% different — both wrong (the declared size is often absent, so the check never ran; and 20% is huge, so wrong-encode tail-appends silently corrupted files that "finished"). **One ranged 64KB request at the resume point** answers Range support (206), real length (`Content-Range`) and byte-identity in one shot. `download/resumePlan.ts` (pure) checks cheapest-first: identity → exact size → Range support → byte comparison. `no-range` is its own cause (the server always sends the whole file — nothing is wrong with either file). An unreadable comparison window **restarts**, never "assume match".
- **`res.resume()` discards data but does not stop the transfer** — this trap has appeared **three times**. `FastChunkDownloader.probeUrl`'s `bytes=0-0` request used it, harmless against Range-honouring hosts and catastrophic against one that ignores Range and returns the whole 6GB (measured: 5.6MB pulled in the 5s after "resolving", competing with the real download for the same throttled URL). Destroy both response **and** request once headers are read. Also: a chunk worker accepting `200` mid-transfer now **fails that chunk with a reason** instead of writing whole-file bytes at a chunk offset.
- **Pressing Download is a request, not a command** (`download:request`). Old behaviour: any existing entry → "Already downloading" regardless of state. Now: `Downloading/Retrying/RefreshingSource` → no-op and says so; `Queued` → says when; `Paused` → resumes; `Failed` → recovers (clears the retry budget, re-resolves, retries); `Completed` → checked against the filesystem and re-downloaded if gone; nothing → starts.
- The confirm gate lives in `App.handleEnqueueDownload`, the one funnel all four press sites reach, and works by resolving a promise the callers already awaited. Default `immediate` — the delete prompt asks because deletion is unrecoverable; a download is a cancellable transfer.

### 9.5 Backup

`electron/cs3/backupService.ts`. **Sections are a table**, not switch statements — a store added to export-but-not-restore silently drops rows. Deliberately excluded: `.cs3` archives and media (large, re-fetchable — the backup records *which*), tokens and device ids (filtered on export by `DatastoreManager.snapshot`), diagnostics and logs (they describe the wrong machine), caches (stale is worse than empty). **Restore merges, never replaces** (snapshots first, undoable); a throwing section is recorded while the rest still restore. Unrelated JSON is refused **by format marker**, else you get "restored 0 of 9 sections" instead of "not a CloudStream backup".

### 9.6 Source list provenance and export

`indexerName` on an extension link is the file **host** ("Voe"), not the provider — both lists also carry `repository ▸ extension ▸ provider`, batched via `api:getProviderProvenanceMap`. `src/utils/sourceExport.ts` defaults to CSV (sortable/filterable). **The exported address is always the provider's, never loopback** (`sourceAddress` — loopback dies when the app closes). RFC 4180 quoting matters: `Dune, Part Two` unquoted silently shifts every later column, attributing links to the wrong provider.

---

## 10. UI conventions

- **Settings is a level, not an Advanced tab.** Advanced-vs-simple isn't a *category* — it cuts across every subject, so an Advanced tab splits one topic across two places. Grouping stays by subject; a **level** filters within it (`SettingRow`/`SettingGroup` take `level`; an all-hidden group hides itself). **`advanced` means one specific thing: understanding the label requires knowing how the app is built** — not "rare", not "dangerous". `settingsLevel.test.mts` enforces it (refuses >50% advanced; catches redundant per-row+per-group marking; caught rows hidden for jargon labels **when renaming the label was the actual fix** — 6 renamed, e.g. "Detected native players" → "Players found on this computer"). **Simple is the default**, and **an unclassified row is basic** — backwards would silently lose every future setting from Simple mode. Stored in `localStorage`, not the datastore (a per-viewer UI preference, not app behaviour). `shouldShow` lives in a plain `.ts` because JSX can't load under Node's type-stripping.
- **Never name a `.tsx` and `.ts` alike but for casing.** `SettingsLevel.tsx` beside `settingsLevel.ts` are **one name on Windows' case-insensitive filesystem**, and module resolution tries `.ts` first — so the import silently resolved to the pure module. A missing named export is an ESM **link** error, not catchable by `ErrorBoundary`: it failed the whole `App.tsx` import graph and **blanked the entire window**. `tsc -b` and `vite build` both refuse it; the gap was shipping without running either. `componentReachability.test.mts` folds every module path to lowercase and checks uniqueness.
- **A component built and never mounted** is a third failure direction (after invoked-never-registered and registered-never-invoked), invisible to `tsc` and every test. `src/componentReachability.test.mts` closes it lexically. Orphans are allow-listed **with their superseding component** — an allow-list entry without a reason becomes precedent, and a second test fails on stale entries.
- **Escape is consumed in capture phase, only when it actually closed something.** `VideoPlayer` binds `keydown` on `window` as "leave playback"; 5 of 8 hand-rolled dismiss effects listened on `document` in **bubble** phase without stopping the event, so a menu's Escape also reached the player and called `onBack()` — closing a menu ended playback. `useDismissable` uses `pointerdown`, not `click` (click fires after release, so outside-click-close plus the trigger's own toggle would reopen it).
- **The app is dark-only and must say so.** `.btn-ghost` had no colour and nothing set `color-scheme`, so twenty ghost buttons fell through to Chromium's `buttontext` — near-black on `--bg-card` — along with every native `<select>` popup. `.btn` also had no `:disabled` rule while a dozen bespoke buttons each grew their own.
- Global `:focus-visible` floor (8 `outline:none` sites had no replacement); `prefers-reduced-motion` honoured everywhere; poster cards keyboard-reachable; window bounds persist and clamp to an existing display; one offline banner beats 30 separate provider errors.
- `src/components/Poster.tsx` has an `onError` for the actually-common case (expired/hotlink-blocked scraped posters) — otherwise Chromium's broken-image icon everywhere. Per-call-site `fallback` kept, not one glyph.
- `src/components/EmptyState.tsx` gives every empty route an *action* (search-empty offers "Search all sources", clearing the stored scope).
- `useFlash` replaced 20+ hand-rolled toast timers that **crossed** (a second flash's timer cleared by the first) and leaked past unmount. Durations stay per-call-site (1500–5000ms, deliberate).

---

## 11. Lifecycle, navigation, shipping behaviour

- **Closing a window is not quitting.** `window-all-closed` used to tear down every service unconditionally (macOS: a dock icon holding a dead sidecar; `activate` reopened onto the wreckage). All teardown lives in `before-quit`, which calls `preventDefault()` and races a 5s deadline — else the window closes but the process survives, locking the cache dir for next launch. The pending service is logged as `shutdown_timeout`.
- **Shutdown is explicit**: `downloadService.stop()`, `extensionUpdater.stop()`, `pluginManager.shutdown()` (kills the JVM), `torrentEngine.destroy()`, mpv. **Any new service owning a socket, handle, timer or child process must wire in here.**
- **A dropped file used to replace the whole app.** `setWindowOpenHandler` doesn't cover top-level navigation (Electron's default for a dropped file), and `setApplicationMenu(null)` meant no View→Reload existed to recover. `will-navigate`/`will-frame-navigate` refuse it; the renderer's `drop` handler routes the file through `media:prepare` instead — this was always possible via `/local/<token>`, the capability existed with no entry point.
- **F12 was bound twice** — `before-input-event`'s `preventDefault()` suppressed the page's own F12 handler, making `ProviderInspector` unreachable. DevTools is `Ctrl+Shift+I` only. Reload is gated on `app.isPackaged` (`Ctrl+R` in a packaged build destroys the renderer mid-playback).
- **A real menu is back** (it was `null`, which broke `Cmd+C` in the search box on macOS since Cut/Copy/Paste are menu *roles* there, and removed Quit/About/zoom-reset). Hidden behind Alt via `autoHideMenuBar`.
- **aria2 probes upward from 6800 by test-binding**, captures stderr, and confirms via a `getVersion` RPC before reporting success. It was pinned to 6800 (which collides most with aria2's own users), used `stdio:'ignore'` so the reason was discarded, and returned `true` from `spawn` returning — but a port conflict is not a spawn error, aria2 dies milliseconds later and `isRunning()` lied. `getLastError()` carries the reason.
- **External links open in the system browser**, never in-app (`setWindowOpenHandler`).
- **The font is vendored.** `@import url('https://fonts.googleapis.com/…')` in `src/index.css` meant a packaged desktop app phoned a third party on every start, invisibly, plus a hang or silent failure offline. Inter is in `src/assets/fonts/` (7 variable-font subsets, 213KB — non-latin subsets kept because provider titles aren't English).

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
| `docs/PRD/41` | **Proposed, nothing built** — read instead of 39. §2 is a measured Android-ecosystem account worth reading standalone |
| `docs/PRD/43` | Research 2026-09-03; items 1–4 built. §6's rule: a direct HTTP link is not an indexer result |
| `docs/PRD/44` | Research + proposal, §6–§8 not built. §5 is an 8-shape failure taxonomy from a 6,180-record log; read §6.1 before any failure-UI design |
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
- **Keep this file current.** Changing the IPC surface, adding a service, moving the sidecar contract, or finding a stale section — update it in the same commit. **Keep it dense**: facts, rules and measurements, not narrative.
- **Do not vendor or commit**: `.cs3` archives, `library-jvm.jar`, `node_modules/`, `target/`, `dist/`, `dist-electron/`, downloaded `aria2c`/`yt-dlp` binaries. A `jar xf`'d sidecar jar is build output too — one branch merge carried 28 stray `.class` files beside their `.java` sources, and a stale compiled copy in the tree reads as a second, authoritative build.
- **Anchor every ignore rule naming a runtime directory.** A bare `extensions/` in `cs3_windows/.gitignore` matched **any depth**, silently swallowing `src/components/extensions/` — the whole extensions screen vanished from every fresh clone and broke `tsc -b` unconditionally. Rules are anchored now (`/extensions/`, `/data/`, `/bin/`).

### Merging from `claude/refine` / `claude/android-media-desktop-dybtml`

`refine` forked at `881456a`, **before this branch's streaming stack existed** — it has no `providerLinks.ts`, `subtitles/convert.ts`, `clearKey`/`shakaSession`, `build-media-runtime.mjs`, or (due to the unanchored ignore rule) extensions screen at all.

**Cherry-pick additively; never take a whole-file rewrite from it.** That is why the 25-commit IPC refactor (`main.ts` → 24 `ipc/*` modules, `60da305`) was **not** merged — its `main.ts` predates this branch's 222-channel surface (written against 188) and would delete modules it never knew existed. It can be re-derived as a template later, not cherry-picked.

Rule: take features and refinements; leave anything touching playback behaviour, request headers or the native engine — this branch's proven streaming stack is the asset being protected. Not merged, each a behaviour change to a working path: `ext.to` gateway; mpv embedding/`mpvSurface.ts`; concurrent-open/end-of-playback `MpvEngine` changes; HEVC `hvc1` tagging; `unreadableSource`'s loopback-failure split; media-module logging-init changes.

**Never take a prebuilt jar from a branch whose sources you haven't compared** — `refine`'s `cs3-provider-bridge.jar` predates this branch's `:app` activity shims, and taking it for an unrelated fix would have silently regressed all of them: no compile error, no failing test, just extensions losing providers again.

### A gap a missing-class count cannot see is not a gap that doesn't exist

The `WebViewResolver` stub (§5.9) resolved perfectly and did nothing, and four rounds of shim work never surfaced it. When auditing compatibility, "zero `NoClassDefFoundError`" is not "zero gaps" — compare against the Android source's *behaviour*, not just its type graph (`docs/roadmap/android-parity.md`).
