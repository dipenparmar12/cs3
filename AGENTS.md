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
└── repositories/     ← 26 git submodules: the vendored community extension corpus.
    └── _cloudstream_ref_android/  ← git submodule: upstream Android source (commit a72f9e6c…, v4.8.0).
```

### Submodules are NOT checked out by default

`git submodule status` shows every entry prefixed with `-`. `_cloudstream_ref_android/` and
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
| Bundle the JVM | repo root | `node tools/package/build-runtime.mjs --verify` → `sidecar/dist/` |
| Package (Windows) | `cs3_windows/` | `bun run electron:build` → `release/` (runs the above first) |
| Lint | `cs3_windows/` | `bunx oxlint` (oxlint is a devDependency; there is deliberately **no** `lint` script yet) |
| Typecheck only | `cs3_windows/` | `bun run typecheck` (`tsc -b` — see the warning below) |
| Sidecar build | `sidecar/` | `mvn package` → `target/cs3-sidecar.jar` + `target/lib/*` + the android shim into `runtime/` |
| Sidecar tests | `sidecar/` | `mvn test` (20 tests) |
| Main-process tests | `cs3_windows/` | `bun run test:electron` (169 tests, Node type-stripping — no framework) |
| Source cache only | `cs3_windows/` | `bun run test:cache` (10 cases, no ffmpeg needed) |
| Source export only | `cs3_windows/` | `bun run test:export` (13 cases, pure) |
| Logging only | `cs3_windows/` | `bun run test:log` (17 cases, real files in a temp dir) |
| Home providers only | `cs3_windows/` | `bun run test:home` (9 cases, pure) |
| Media decisions only | `cs3_windows/` | `bun run test:media` (53 cases, no ffmpeg needed) |
| Media pipeline only | `cs3_windows/` | `bun run test:pipeline` (14 cases, real ffmpeg; skips itself without it) |
| Native engine only | `cs3_windows/` | `bun run test:native` (12 cases, spawns a real mpv; skips itself without it) |
| Provider end-to-end | repo root | `node tools/e2e/provider-e2e.mjs` — see §5.1 |
| Vendor stream matrix | repo root | `node --experimental-strip-types tools/e2e/native-engine-matrix.mjs` — see §5.2 |
| Plugin runtime classpath | repo root | `mvn -f sidecar/runtime-deps/pom.xml package` → `sidecar/runtime/` (56 jars, incl. `library-jvm-4.8.0.jar`) |
| Provider bridge (Kotlin) | repo root | `mvn -f sidecar/bridge/pom.xml package` → `sidecar/runtime/cs3-provider-bridge.jar` |

On a fresh clone run all three **in that order**: the sidecar build produces the android
shim the bridge compiles against, runtime-deps puts `library-jvm` in place, and the bridge
needs both. Nothing can execute an extension until all three have run.

The sidecar needs **Java 21 or newer** — it is compiled to class file 65. An older
`JAVA_HOME` is detected and named rather than crashing the runtime at startup, and
`SidecarSupervisor.resolveJava` now actually *looks* in `tools/toolchain/jdk-*` before
falling back to PATH. It did not until 2026-08-13, and the consequence was severe: a
machine with `JAVA_HOME` on Java 17 — an entirely ordinary setup — could not start the
sidecar at all while a perfectly good JDK 21 sat checked in beside it. Maven for the
sidecar builds lives in `tools/toolchain/apache-maven-3.9.16` and is likewise not on PATH.

**A sidecar that cannot start must say so.** `ensureProvidersLoaded` used to `return`
silently when `ensureStarted()` failed. Every installed extension then reported zero
providers with no reason, which the extensions screen rendered as a permanent "JVM sidecar
is initializing providers…" spinner — an infinite progress message for something that was
never going to happen. It now writes a `T4_BLOCKED` runtime report naming the real cause to
every installed plugin, and the UI shows it. If you add another early return on that path,
carry a reason with it.

Toolchain present in the cloud environment: Java 21, Maven, Bun, Node 22.

There is **almost no automated test suite for the Electron/React side** and no CI workflow
(`.github/` does not exist). The exceptions are `electron/sharedDiscovery.test.mts` and the two
media suites under `electron/media/`, all run by `bun run test:electron`: Node strips the types
itself — possible only because `erasableSyntaxOnly` is set — so there is no framework, no
transform and no config to keep working. `.mts` is in `tsconfig.node.json`'s `include`, so the
tests are typechecked too.

Those modules earn tests where the rest of `electron/` has none, for two different reasons.
`sharedDiscovery` because its failure modes are invisible: a doubled scrape reads as a slow
provider and a wrongly-cancelled run reads as a flaky site, and neither would ever be traced
back to it from a bug report. The media suites because their inputs are **expensive to
reproduce and cheap to encode** — every row of the compatibility matrix was measured against a
real 25 GB file behind a provider link that has since expired, and a regression there is silent
in the worst way: choosing `-c:v copy` for a 10-bit HEVC file produces an MP4 that downloads
perfectly and plays nothing, which is indistinguishable from a bad provider.

Note the `.ts` extensions on imports inside `electron/media/`. They are load-bearing: Node's
type stripping is an ESM loader and will not resolve an extensionless specifier, so without
them the tests cannot import the modules they test. `allowImportingTsExtensions` is already set
in both tsconfigs and the Rollup build is indifferent.

**The `tsc` in `bun run build` typechecks nothing.** The root `tsconfig.json` is
solution-style (`"files": []` plus two `references`), and plain `tsc` on such a config is a
no-op — it does not build referenced projects. Use **`tsc -b`** (or
`tsc -p tsconfig.app.json` / `-p tsconfig.node.json`) to get a real signal. Running
`tsc -b` for the first time surfaced seven pre-existing errors, since fixed; the tree is
clean now, so a new error is yours. Say "typechecks with `tsc -b`" rather than implying
tests passed.

**Electron cannot actually be launched in a headless cloud container.** Verify by
typechecking and by reading; do not report "I ran the app" unless you really did.

### The runtime the app runs is not the one you just built

`RuntimeProvisioner` copies the sidecar and the provider runtime into
`%APPDATA%/<app>/cs3-runtime/` and resolves that copy **before** every build location. That
is what makes an installed app independent of where it was built, and it is also the single
most expensive trap in this repo, because for a while nothing noticed when the copy drifted:

- `provisionRuntime()` asked `findRuntimeDir()` where to copy *from* — and that answers with
  the app-managed copy first — then skipped the copy because the source "already" lived under
  `baseDir`. The first provision was therefore the last one.
- Installed apps kept serving the shim and bridge they were first installed with. A user
  reported `NoClassDefFoundError` for `DataStore`, `android/net/Uri`, `AppCompatActivity`,
  `DialogFragment` and `FragmentManager` — **every one of them a class that had shipped weeks
  earlier.** Five of eight failing extensions in that report were this bug alone.

Three things now prevent it, and all three matter:

1. **The copy carries a stamp** (`runtime-stamp.json`: generation + a fingerprint of every
   jar's name, size and mtime). `getStatus()` reports `stale` separately from `ready`,
   because a stale runtime is complete and starts fine — folding it into `ready` would make a
   working install look broken, and leaving it out is what produced the bug.
2. **Provisioning reads from build locations only** (`findSourceComponents`), and picks the
   **newest** rather than the first. `sidecar/dist/` is generated *from* `sidecar/runtime/`,
   so in a dev checkout it is a snapshot that goes stale the moment Maven runs again — and it
   sits earlier in the candidate list.
3. **Translations are dropped when the sidecar changes.** DEX→JVM output is cached by archive
   hash alone, so it survives a translator upgrade and keeps serving bytecode from the version
   that had the bug. An absent stamp counts as changed: that is the upgrade case, and it is
   the run most likely to be holding output from the broken `KotlinNameRepair`.

**Bump `RUNTIME_GENERATION` whenever the shim, the bridge or the translator changes in a way
an already-provisioned copy would get wrong.** If you are debugging a "class that should
exist doesn't", check `%APPDATA%/<app>/cs3-runtime/runtime/` before anything else — compare
its jars against `sidecar/runtime/`.

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
false`. Channels are namespaced: `api:*`, `torrent:*`, `playback:*`, `indexer:*`,
`sources:*`, `download:*`, `extension:*`, `library:*`, `datastore:*`, `binary:*`,
`dialog:*`.

`playback:*` is push-shaped, unlike the rest: `playback:start` returns a session id
immediately and everything after arrives as `playback:update` snapshots on a
`webContents.send` channel. That inversion is the point — the player renders from snapshots
from the moment it opens, before any stream exists.

`search:*` is push-shaped for the same reason. `search:start` returns an opening snapshot
naming the sources it is about to ask; results, per-source outcomes and progress arrive as
`search:update`, and `search:cancel` abandons the rest. A search across fifteen extension
providers is fifteen independent scrapes of third-party sites and the slowest routinely
takes 20–40s (measured: Cinevood times out at 20s while ARD answers in 350ms), so a
request/response search spent that entire time showing a spinner over results it already
had. `api:searchAll` still exists for callers that genuinely cannot use a partial answer.

Making that work required breaking up `PluginManager.searchAll`. It issued **one** batched
`providerSearch` RPC for every provider, and the sidecar collected the futures in order —
so the reply landed at the speed of the slowest provider no matter how fast the others
were. It is now one RPC per provider (`searchEach`), capped at 8 in flight because the
sidecar dispatches each onto a bounded pool sized to the core count.

Also namespaced: `analytics:*` (provider measurement, ranking weights, recommendations,
and the erase control), `bookmarks:*` (saved detail pages), `discover:*` (home-screen
catalogues and title enrichment), `home:*` (which catalogue those come from, and its
health), `log:*` (the structured log — query, sessions, level, reveal, export),
`subtitles:*` (online search, SubRip→WebVTT), `sources:getCacheStats` /
`sources:clearCache`.

`media:*` is the compatibility engine's surface: `media:inspect` classifies a source without
starting anything, `media:prepare` inspects-decides-opens and returns the URL to attach,
`media:switchAudio` / `media:closeStream` drive a live session, `media:setCapabilities` /
`media:getCodecProbes` carry what the renderer measured about its own decoders, and
`media:getPlaybackDiagnostics` returns the per-attempt telemetry. There is deliberately **no**
channel that hands back an unclassified playback URL.

`external:*` drives a handed-off player and pushes `external:update` snapshots back, with a
`capability` that says whether those controls reach anything. `player:getPreferences` /
`player:setPreferences` hold volume, mute, speed and track languages.
`download:getDeletePreference` / `download:setDeletePreference` hold the delete behaviour, and
`extension:rollback` puts back the archive an update replaced.

`mpv:*` drives the native engine — `mpv:open` (a *prepared* URL only), transport and track
controls, `mpv:update` snapshots pushed like `playback:*`, and `mpv:getPolicy`/`mpv:setPolicy`
for how eagerly it is used. It has no channel that takes a raw link either, for the same reason.

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
| `contentService.ts` | The content pipeline orchestrator: `search → MetadataProvider → getSources → IndexerRegistry → startStream → TorrentEngine`. Extension providers are consulted first; torrents are the fallback. A `cs3ext://` media URL bypasses indexers entirely — the provider already knows its links. |
| `playbackSession.ts` | Owns one "user pressed play" interaction. Opens the player *before* a stream exists and streams discovery progress into it, so the viewer can start the best source found so far instead of waiting for the slowest indexer. Also owns in-player source switching and refresh. Retains the `SourceQuery`, which is what makes refresh possible without navigating back. |
| `searchScope.ts` | Which sources a search may ask. **A selection is a strict filter, not a preference** — see below. |
| `searchSession.ts` | One "the user pressed search" interaction. Push-shaped like `playback:*`: fans out per source, emits a snapshot as each answers, and can be cancelled. |
| `searchSuggestions.ts` | Title autocomplete merged across Cinemeta + TVmaze + AniList, deduped on normalised title+year, misspelling-tolerant. Their blind spots do not overlap — see the file header for what was measured about each. |
| `searchHistory.ts` | Past search *queries* (not results — a cached result set goes stale silently), stored via the datastore so backups carry it. |
| `sourceCache.ts` | Resolved sources, with expiry tracked **per source**: magnets never expire, provider links carry a deadline read from the URL (`Expires`/`exp`/JWT claim, case-insensitively) or a short TTL. A cache hit can be partially stale — good magnets beside dead links — and `read()` reports that split. |
| `subtitleService.ts` | Online subtitle search via the keyless OpenSubtitles v3 Stremio addon, keyed by IMDb id. Converts SubRip to WebVTT, which is **not optional**: `<track>` rejects `.srt` silently. |
| `media/mediaInspector.ts` | ffprobe → `MediaMetadata`; transport and DRM classified from the manifest body, never the URL. |
| `media/decisionEngine.ts` | Pure decision: metadata + host capability → `TransformationPlan`. Tested exhaustively; see the codec section. |
| `media/playbackEngine.ts` | Inspect → decide → open, and the only way to obtain a URL to attach. Owns playback telemetry. |
| `media/mpvEngine.ts` | The native engine. Spawns mpv, drives it over JSON-RPC, and reports snapshots. For the streams Chromium will never decode — see below. |
| `mediaTranscoder.ts` | Executes a plan as a live fragmented-MP4 stream on loopback, plus embedded-subtitle extraction. |
| `metadataProvider.ts` | TVmaze + AniList. **Catalogue metadata only, never streams.** Its key output is the IMDb id, which indexers match on far better than free text. |
| `cinemeta.ts` | Stremio Cinemeta metadata provider, prioritised in search. |
| `pluginManager.ts` | `.cs3` repository discovery, plugin-list parsing (mirrors upstream `RepositoryManager.kt`), download + SHA-256 verification, Android-style install paths, then hands archives to the sidecar. Also owns the enable/disable cascade — see the extensions-screen section. |
| `pluginAnalyzer.ts` | Static compatibility classification of a plugin before it is trusted. |
| `cs3/sidecarSupervisor.ts` | Spawns and supervises the JVM child process; line-delimited JSON-RPC over stdio; never throws on a missing/broken sidecar. |
| `cs3/extensionUpdater.ts` | Over-the-air extension updates on a schedule, so a provider fix does not wait for an app release. |
| `cs3/bootstrap.ts` | First-run install of the bundled repositories, and the adult-content opt-in. |
| `cs3/diagnostics.ts` | Provider failures with the context that makes them reproducible. See below. |
| `cs3/titleOutcomes.ts` | How each title last behaved, so a dead row is not clicked twice. |
| `cs3/batchDownloader.ts` | Season/series batch download orchestration. |
| `cs3/libraryStore.ts` | Watch state, resume progress, library buckets, remembered source choices, and the source that actually played. |
| `cs3/playedSource.ts` | Re-finding a saved source after its link expires. Pure and tested — a provider source has no durable id. |
| `cs3/bookmarkStore.ts` | Saved *detail pages*, with the provider, extension, repository and query that produced them. Deliberately **not** the library: that keys on a normalised title so one film from five providers is one entry, which is right for watch tracking and useless for "reopen the page I was on". Identity and origin are stored; resolved links are not, because they expire. |
| `cs3/providerAnalytics.ts` | How every provider has actually behaved, counted. Aggregates only — no queries, no titles, no viewing history — because provider quality does not depend on any of them and this file is meant to be shareable. `empty` is tracked separately from `failure`: a provider with nothing for this title is working, and folding the two together would rank providers by catalogue breadth. |
| `cs3/providerRanking.ts` | Weighted scoring over those counts. Criteria are **rows in a table**, not a formula: an id, a weight, a sample floor and a function to `0..1` or `null`. A `null` is excluded from the denominator rather than scored zero — a provider nobody has downloaded from must not rank below one whose downloads always fail. Rates are smoothed toward a neutral prior so a new extension starts mid-table and can never be permanently buried by one unlucky first call. |
| `cs3/providerRecommendations.ts` | Turns scores into advice, and (only with `autoEnableProven`) into action. Nothing is ever auto-**disabled**: a site being down for a week is not consent to remove a source the user chose. |
| `cs3/failureTaxonomy.ts` | `classifyFailure` — one closed set of causes, shared by the ranking and the diagnostics. Counting free text produces a tally with one entry per failure; grouping by cause is what showed 113 load failures came from six missing classes. |
| `logging/logger.ts` | The structured log: NDJSON, one file per session, redacted at the logger rather than the call site. Does **not** import `electron`, so it stays testable. |
| `logging/redact.ts` | Taking credentials out of a log line without taking its shape out. |
| `cs3/homeProviders.ts` | Where the home screen's catalogue comes from, as something replaceable. Stremio catalog protocol, AniList, and TMDB with the user's own key. |
| `cs3/homeProviderRegistry.ts` | Which one is active, whether it is answering, and the fallback when it is not. |
| `media/mpvSurface.ts` | The native child window mpv renders into. Windows only; attaching is an attempt. |
| `cs3/discovery.ts` | The home screen's catalogues. Stale-while-revalidate over Stremio's keyless Cinemeta catalogs (`top`/`year`/`imdbRating`, filterable by 19 genres, pageable) plus AniList for anime. Finds **nothing playable** — sources are resolved by providers when an item is opened. |
| `cs3/titleEnricher.ts` | Resolves `Avengers End Game 720p Hindi Dubbed` to the film it is about. Conservative on purpose: a disagreeing year is disqualifying and the similarity bar is high enough that `Avengers` does not match `Avengers: Endgame`. An unenriched row is a small loss; a mislabelled one reads as data corruption. |
| `torrent/torrentEngine.ts` | WebTorrent + loopback HTTP server with range support. Sequential pieces; the player only ever sees `http://127.0.0.1:PORT/…`. |
| `torrent/indexerRegistry.ts`, `indexers/*` | 7 built-in public indexers, Torznab (Jackett/Prowlarr), and aggregators (Torrentio, apibay). |
| `torrent/ranker.ts`, `releaseParser.ts` | Release-name parsing (quality/codec/group/season/episode) and result ranking. |
| `externalPlayerControl.ts` | Two-way control of VLC over its HTTP interface. Capability is declared per player, never assumed — see below. |
| `media/inspectionStore.ts` | Persists what a probe found, keyed on the origin URL. The measurement only; the verdict is recomputed. |
| `downloadService.ts`, `aria2Engine.ts`, `ytdlpEngine.ts`, `binaryDownloader.ts` | Downloads via aria2c RPC with an HTTP fallback; portable `aria2c`/`yt-dlp` binaries are fetched on first use. |

### Codecs: Chromium cannot decode a lot of what people actually stream

Measured on this Electron build with `canPlayType`, not assumed. AAC, MP3, FLAC
and Opus are fine; **AC-3, E-AC-3 and DTS all return `""`** in both MP4 and MKV.

The failure mode is the nastiest possible one: bare `video/x-matroska` still
reports `"maybe"`, so the container opens, the video decodes normally, and the
audio track is silently dropped. Playing an H.264 + AC-3 file and reading the
decode counters gives **65,397 bytes of video and 0 bytes of audio**, correct
duration, and no `error` event. The volume slider works perfectly on a stream
that has no sound in it.

This is why the bug looked provider-specific and why it hit **series** hardest:
TV releases are overwhelmingly HDTV/WEB-DL carrying broadcast AC-3/E-AC-3, while
film web-rips usually carry AAC. The provider was never the variable.

**Video has the same problem and it is worse.** Chromium decodes H.264, VP8, VP9
and AV1; it does not decode HEVC outside builds with platform decoders, nor any
of MPEG-2, VC-1, MPEG-4 Part 2 or WMV. HEVC is routine in 4K and 10-bit releases,
so "the browser could not decode this file" was a growing dead end. Android does
not have this problem — ExoPlayer hands the stream to the device's hardware
decoders.

#### The engine: inspect, decide, execute — in that order

Rebuilt 2026-08-16 against PRD-37 and PRD-38. It was one file that decided *and*
executed, with the decision made from whatever happened to be known at the moment
the `<video>` element failed. It is now four, and the split is the fix rather than
tidying:

| File | Role |
|---|---|
| `media/mediaInspector.ts` | ffprobe → `MediaMetadata`. Also classifies the transport (progressive / HLS / DASH) from the **manifest body**, and reads DRM out of it. |
| `media/decisionEngine.ts` | Pure. `(metadata, transport, rendererCaps, hostEncoder) → TransformationPlan`. No I/O, no URLs, no clock. |
| `mediaTranscoder.ts` | Executes a plan as a live fragmented-MP4 stream on loopback. Builds ffmpeg arguments and nothing else. |
| `media/playbackEngine.ts` | Assembles them, caches capability records per URL, and owns the telemetry. |

Shared types are in `src/types/media.ts` — `MediaMetadata`, `SourceCapabilityModel`,
`TransformationPlan`, `PlaybackStrategyType`, `DrmConfiguration`.

**The decision is pure so that it can be tested, and it is tested because the
measurements behind it are expensive to reproduce.** Every row of the matrix came
from a real 25 GB file behind a provider link that has since expired.
`media/decisionEngine.test.mts` (35 cases) pins the decisions;
`media/pipeline.test.mts` (13 cases) runs real ffmpeg over synthesised fixtures and
asserts what comes *out* is 8-bit H.264 + stereo AAC. Both run under
`bun run test:electron`, and the pipeline suite skips itself when ffmpeg is absent.

**The ordering is the whole bug fix.** Playback used to be attached on mount while
a probe ran beside it. Chromium's parser failed on an unsupported bitstream within
~150 ms, its `error` handler fired with the probe still in flight, and the fallback
therefore ran `-c:v copy` on video it knew nothing about — re-wrapping an
undecodable HEVC bitstream into MP4 and failing a second time in exactly the same
way, which is why the bug looked like it had no fix. `media:prepare` now returns
the URL to attach and there is no other way to obtain one. **If you add a code path
that assigns `video.src` from anything but a prepared response, you have
reintroduced it.**

Four invariants, from PRD-37 §4.2, and where each lives:

| ID | Rule | Enforced in |
|---|---|---|
| INV-RACE-1 | Nothing is attached before inspection completes | `VideoPlayer` — no `?? streamUrl` fallback exists |
| INV-RACE-2 | The gate is visible ("Inspecting media…") | `VideoPlayer`, `isInspecting` |
| INV-RACE-3 | `-c:v copy` never runs on unverified codec info | `blindFallbackPlan` re-encodes |
| INV-RACE-4 | Renderer capabilities registered before playback | `App.tsx` on mount → `media:setCapabilities` |

**Nothing is decided from the URL.** The implementation this replaced searched the
link for `hevc`, `x265` and `10bit`, which is a guess about a filename some scraper
produced — wrong in both directions: releases mislabelled by whoever named them,
and bare `?id=…` Drive links carrying 10-bit HEVC with nothing to match on. The
same rule covers transports: an `.m3u8` served from a `.php` URL and an `.mpd`
served as `application/octet-stream` are both routine, so the first 64 KB of the
body classifies it (`#EXTM3U` / `<MPD`).

Three things about the plan are load-bearing:

- **The software 4K guard is the fix for the "plays for 3–5 seconds then freezes"
  report, and it is arithmetic rather than a heuristic.** Measured on a 3840x2160
  10-bit HEVC source: libx264 `veryfast` at native resolution encodes 11–13 FPS —
  0.47x realtime — so Chromium drains the buffer it was handed in about three
  seconds and buffers forever. The same encode at `scale=-2:1080` runs 26–28 FPS,
  above realtime, and plays. So a software-only host downscales anything over
  1080p; a host with a working GPU encoder keeps full resolution, and so does a
  16-thread machine, which clears realtime at 4K without help.
- **A track switch re-derives the plan, it does not re-index it.** Caught by
  `pipeline.test.mts` rather than reasoned about: pointing a copy-the-audio plan at
  a 6-channel AC-3 track makes ffmpeg refuse outright with `Cannot write moov atom
  before AC3 packets`, because AC-3 in MP4 takes its extradata from the first
  packet and a fragmented output writes its header before one exists. The
  user-visible form is the worst kind — the viewer picks the Hindi dub and playback
  stops, blamed on the source. `planForAudioTrack` is the only correct way to
  change tracks.
- **An unplayable default audio track is swapped only for one in the same
  language.** PRD-38 measured Movies4u shipping three E-AC-3 5.1 tracks beside an
  AAC stereo of the same film, and copying the AAC is free where transcoding the
  E-AC-3 is not. Silently swapping an English default for a Hindi AAC track because
  it was cheaper would be a far worse bug than a few percent of one CPU core.

Two more, further from the hot path:

- **`-allowed_extensions ALL`** is passed for HLS and DASH. `Hdmovie2` serves its
  MPEG-TS segments from `.png` URLs to get past CDN filters, and ffmpeg's HLS
  demuxer refuses unknown extensions by default. There is no way to enumerate what
  a provider will pick next, so the extension allow-list is opened while the
  protocol whitelist stays closed — that is the boundary that actually matters.
- **DASH is remuxed by ffmpeg rather than played by dash.js.** Handed an `.mpd`
  directly, Chromium reports `Unable to parse XML declaration` — an XML document
  arriving at a binary demuxer. ffmpeg's `dash` demuxer reads it properly and the
  output joins the same fragmented-MP4 path as everything else, which avoids a
  second player library. The cost is honest and worth knowing: it collapses the
  adaptive ladder to one rendition. A Widevine or ClearKey DASH stream is
  *detected* and reported, not played — see below.

Two things about the surrounding path are load-bearing:

- **What is decodable is measured in the renderer, not tabled in main.** Chromium's
  HEVC support varies by build and platform, so `App.tsx` runs `canPlayType` over
  `VIDEO_CODEC_PROBES` at startup and `setCapabilities` overrides the static
  `UNSUPPORTED_VIDEO` set **in both directions** — a build that can decode HEVC is
  not made to re-encode it for nothing.
- **The hardware encoder is chosen by test-encoding, never by `ffmpeg -encoders`.**
  That listing reports what the binary was *built* with, not what the machine can
  run: the bundled build advertises `h264_nvenc`, `h264_qsv` and `h264_amf`
  everywhere, and on the development machine only QSV opens — NVENC fails with
  "Could not open encoder" for want of an NVIDIA GPU. Each candidate now encodes
  one frame to null **with the exact arguments it would be used with**, which also
  catches encoders that reject an option (AMF has no `-preset`). Getting this
  wrong means picking an encoder that dies the moment a viewer presses play.

Things that will bite if you change it:

- **Stereo downmix is deliberate.** 5.1 AC-3 re-encoded as 5.1 AAC decodes but
  routes to the wrong outputs on most desktop setups, which sounds like missing
  dialogue — a different bug that looks like the same one.
- **`-user_agent` is an HTTP demuxer option.** Passing it for a local path makes
  ffmpeg fail outright with "Option user_agent not found". It is applied only to
  `http(s)` inputs; omitting it for network input gets providers 403ing instead.
- **Seeking restarts ffmpeg** at the target time, because a live fragmented MP4
  has no index and `currentTime` does nothing. Accuracy is bounded by the
  source's keyframe interval, since `-c:v copy` can only cut at a keyframe.
- **The probe is also what makes multi-audio selection work.** A `<video>`
  element does not expose tracks it cannot decode, so without ffprobe the app
  cannot even tell the user a Japanese AC-3 dub exists.
- **Embedded text subtitles are extracted on demand, and that is deliberate.**
  `<track>` rejects SubRip and ASS silently, so a release carrying its own
  forced-narrative track had none in the app — and the online search cannot help
  an extension-sourced film with no IMDb id. Extraction reads the *whole* file,
  because subtitle packets are interleaved through it, so a 25 GB remote MKV
  cannot be subtitled quickly. It runs when the viewer picks the track, is bounded
  at three minutes, and is cached. Bitmap tracks (PGS, DVB, VOBSUB) are listed as
  present and never offered: an empty WebVTT named "English" reads as broken
  subtitles rather than absent ones.

**DRM is classified, and the classification is the point.** HLS AES-128 and
SAMPLE-AES are *not* DRM as far as this engine is concerned — hls.js fetches the
key over HTTP and decrypts in JavaScript, and routing those to an EME path they do
not need would break streams that work today. ClearKey, Widevine and PlayReady need
a CDM, so they are marked `requiresEmeDecryption` and FFmpeg is bypassed entirely:
it holds no keys, so probing one spends twenty seconds on encrypted noise and
remuxing one produces an unplayable file with a codec error about content it never
decrypted. **What is not built:** Widevine CDM discovery/loading and dash.js. Such a
stream is detected and reported by name instead of failing as a corrupt file, which
is the honest state, not the finished one.

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

Still outstanding from doc 36: step 5 (jlink a JRE), step 6 (OS-level sandbox), step 7 (the
WebView bridge, needed by ~7% of providers).

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

2. **No WebView.** Still doc 36 step 7, still the largest single gap, and now the dominant
   one. Android providers get a real browser for Cloudflare challenges and for extractors
   that need JavaScript to run; `CloudflareKiller` here forwards rather than bypasses.
   Aniworld's Google 403 and the Voe/Vidsonic extractor failures are all this. This is the
   thing to build next if the goal is parity — not more shims.

3. **Host-side reality, which is not a divergence at all.** Expired signed URLs, hotlink
   403s, dead swarms and slow sites fail identically on both platforms. The vendor matrix
   (§5.2) counted these: of 72 non-playing streams, every one was a host refusing or
   expiring a link, or a provider with nothing for that title. Attributing those to the
   compatibility layer is the mistake that sends people looking for translation bugs that
   are not there.

**Count before fixing.** That rule produced the six-classes finding in the third round and it
applies here in the other direction: the counting now says the class problem is solved, so
the next unit of effort belongs in the WebView bridge.

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
against Kraptor123/cs-kraptor, Bnyro/GermanProviders, phisher98, rockhero1234/cinephile and
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

Rebuilt 2026-08-14. It was one 2,689-line component — 25 `useState` hooks, four tabs and
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

### Containers: "the codecs play" and "the codecs fit in this box" are two questions

`REMUX_CONTAINER` always targeted fragmented MP4 with `-c copy`, on the reasoning
that both streams being decodable was enough. It is two independent claims, and
each fails differently — both measured on the bundled ffmpeg, not looked up:

1. **ffmpeg refuses the mux.** VP8 into MP4 answers `Could not find tag for codec
   vp8 in stream #0, codec not currently supported in container`, then `Could not
   write header`, and the command dies having produced nothing. Every earlier
   step looked right, because both codecs are ones the browser decodes.
2. **ffmpeg writes it and Chromium cannot decode it.** Vorbis into MP4 muxes
   cleanly and plays no audio, because Vorbis is a WebM/Ogg codec there. This is
   the worse one: exit status says success, so nothing downstream can catch it,
   and the viewer gets a silent black player.

`chooseCopyContainer(video, audio)` answers `mp4_fragmented`, `webm`, or `null`.
**`null` is the important answer** — VP8 beside AAC is legal in neither, so a
copy is impossible and one stream has to be re-encoded. Returning a container
anyway is what produced the original bug.

**The mux tables are deliberately broad.** HEVC, AC-3 and DTS are all legal in
MP4; whether a decoder exists is a separate question `canPlayVideo` already
answers, and one of them is measured at runtime. Folding "no decoder here" into
"cannot be muxed" would force a full re-encode on every build that grew a
platform HEVC decoder — the exact case the capability override exists to serve.

`predictOutput` states what a plan will produce (container, codecs, MIME) and
`decideStrategy` escalates to a full transcode rather than shipping a plan whose
output would not play. **A remux is not successful because ffmpeg exited zero.**
`pipeline.test.mts` asserts on the bytes — EBML magic versus `ftyp` — rather than
on an exit status, because the Vorbis case exits zero.

Note the reachability, which is not obvious: a Matroska carrying WebM-legal
codecs *is* a WebM to Chromium and plays directly, so it never reaches a remux.
It takes a container Chromium cannot demux at all (AVI, MPEG-TS) to get WebM-only
codecs onto the copy path. The common shape of the bug is the `null` case.

### The log: structured, redacted, and written a line at a time

`electron/logging/` — `DiagnosticsLog` answers "what went wrong, with what
context" and is shaped to be pasted to a provider maintainer. `Logger` is the
layer underneath: everything the app does, as data.

- **Structured, not formatted.** Grouping 113 load failures into six missing
  classes — the thing that actually solved that problem — is a `GROUP BY` over a
  field and impossible over prose.
- **NDJSON, appended, flushed synchronously on exit.** A crash truncates the last
  few hundred milliseconds and never corrupts what came before, which a rewritten
  JSON array cannot promise — and a crash is when the log matters. One file per
  session, because a session is the unit users report in.
- **Redaction is applied by the logger, not by call sites.** These URLs are
  signed CDN addresses whose query string *is* the credential, and a log is a
  file people paste into issues. A rule enforced at four hundred call sites holds
  at three hundred and ninety. Structure survives, secrets do not:
  `?token=<redacted>` keeps the fact that the link was signed, which is what
  distinguishes an expired link from one that never had credentials. Malformed
  URLs fall back to text rules rather than throwing — a redactor that threw would
  take down the logging of the failure worth recording.

**`Logger` does not import `electron`**, deliberately: that import makes a module
unloadable under Node's type stripping, which is where its tests run. The
directory comes from `main.ts`.

Instrumented at **choke points**, so coverage cannot rot: `PlaybackEngine.record`
(every `prepare` outcome), `MediaInspector.inspect` (wrapped — the body has five
exits), the ffmpeg spawn (the arguments, which is what makes a conversion failure
reproducible), `MpvEngine.emit` (state transitions, deduplicated because
`time-pos` fires once a second for a whole film), `ContentService.runDiscovery`,
download finalisation. Diagnostics are mirrored in.

`log:*` is thin on purpose — the log's job is to be on disk when something goes
wrong, not to be browsed. The level persists, because what it gets turned up for
has not happened yet.

### mpv, embedded: what `--wid` buys and what it costs

True embedding needs libmpv's render API through a native addon, which this
repository does not build. `MpvSurface` does the next thing: a frameless child
`BrowserWindow`, its HWND passed as `--wid`, tracking the player's video rect.

**The constraint that shapes the whole layout: a native child window sits above
Chromium's compositor entirely, so nothing can be drawn over the video.**
Overlaying controls is not an option that was rejected for taste — it is not
available. `NativeEngineStage` reserves bands above and below and reports only
the remaining rect. That letterboxes by roughly 9rem of chrome, and the bands do
not collapse when the chrome auto-hides, because a video that jumped every time
the controls faded reads far worse than a stable frame.

Windows only (`--wid` takes an `NSView*` on macOS, an X11 id on Linux). Attaching
is an *attempt*; `embedded` is reported from the engine, never assumed, because a
player reserving space for a surface that never appeared is worse than one that
never tried. Settable, since a second monitor or an HDR path that only engages
top-level are real reasons to want a separate window — and changing it restarts
the process, because `--wid` is decided once on the command line.

**The dependency is inverted**: `MpvEngine` takes a `createSurface` factory
rather than importing `BrowserWindow`, which is what keeps it loadable under type
stripping so its test can drive a real mpv.

Two control bugs fixed alongside. `seekBy` read `video.currentTime`, which is
permanently `0` for mpv — so every fast-forward and rewind seeked to ±delta from
the *start of the film*. `toggleFullscreen` fullscreened the Electron container,
blowing up a panel of controls over an empty surface. Volume, mute and speed now
sync **both ways**, because mpv is a real window a viewer can touch;
`pushedToEngine` breaks the echo by ignoring a value matching what was last sent.

### The home screen's catalogue is chosen, and checked

`cs3/homeProviders.ts` + `homeProviderRegistry.ts`. The keyless constraint has not
changed, so the useful move was supporting the **Stremio catalog protocol**
rather than a host: one documented GET shape served by Cinemeta and by a whole
ecosystem of community addons, so a user with an addon URL is supported without
anyone writing an adapter — the same bet the indexer layer makes with Torznab.

TMDB is offered honestly: listed, described as needing a key, selectable only
once the *user* supplies one. A key embedded in a distributed client violates
their terms and gets revoked, breaking the home screen for everyone at once with
no way for any individual to fix it.

**Sections come from `capabilities()`**, not a fixed list, so selecting AniList
produces an anime home screen rather than five empty headings. The discovery
cache is keyed by provider — without that, switching would serve one provider's
row out of another's entry, and both answers look like plausible catalogues.

**Health is measured with a real catalogue request.** The failures that actually
happen — a 200 with empty `metas`, a page of items with no artwork or ids — all
come back from a healthy-looking server and render as blank cards that do nothing
when clicked, which reads as *our* bug. An unhealthy provider cannot be selected
and the refusal names the cause; the empty screen it replaces could not. It stays
listed, because "unavailable" and "does not exist" are different facts. The
active provider is *resolved* rather than stored: a host down for an afternoon
falls back without rewriting the user's choice.

### Continue Watching: removal is a dismissal

`dismissedAt`, compared against `updatedAt` rather than being a boolean. "Take
this off my home screen" and "forget where I was" are different intentions, and
the destructive reading of the first is unrecoverable — someone tidying the row
would silently lose the resume point on a film they were halfway through. The
comparison is also what makes "Play again" work with no extra machinery: watching
more moves `updatedAt` past the dismissal and the card returns.

Dismissal is per **title**, not per row: the rail shows the newest episode of a
series as one card, so dismissing only that episode would put the previous one in
its place and read as the button not working.

The visibility toggle is enforced in the main process. Off means the rows are
never assembled, not merely hidden — on a shared machine that is the point.

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

**What is not built: embedding.** mpv renders in its own window, driven over IPC — the
roadmap's Option A, which it calls the recommended first step. Putting the video surface
inside the Electron window needs libmpv's render API through a native addon (Option B).
`MpvOpenRequest.windowHandle` exists and is passed to `--wid` for when that lands; nothing
sets it today.

`electron/media/mpvEngine.test.mts` (12 cases, `bun run test:native`) drives a real mpv
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
- **Player controls hide from one place.** Visibility is a state machine polled on
  a timer (`VideoPlayer`), not a chain of `setTimeout`s. The rule that keeps it
  stable: a `mousemove` with zero `movementX`/`movementY` is never activity.
  Chromium synthesises exactly that event when hiding the controls changes what
  sits under a stationary cursor — and toggling `cursor: none` on idle does it
  too — so treating synthetic events as activity created a genuine reveal/hide
  feedback loop, seen as controls flashing while the mouse was not moving.
- **Provider subtitles are a real source.** `loadLinks` returns subtitles
  alongside links and `PluginManager.loadSubtitles` exposes them; `subtitles:search`
  merges them ahead of OpenSubtitles. This matters most where OpenSubtitles cannot
  help at all — extension-sourced content with no IMDb id — and the method existed
  with no caller for some time, so a film played from an extension had no
  subtitles even when the provider had handed them over with the video.
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
  (`.gitignore` at root covers `target/`; `cs3_windows/.gitignore` covers `dist-electron/`, `dist/`, etc.)
- **Report honestly.** "Typechecks with `bun run build`" is a true claim. "Tested" is not,
  unless you ran `mvn test` or actually exercised the path. Legal/ecosystem context here
  (GPL-3.0, third-party indexers, community plugin code) makes overclaiming expensive.
- **Keep this file current.** If you change the IPC surface, add a service, move the
  sidecar contract, or discover that a section above is wrong — update it in the same
  commit. This file is the reason the next agent does not have to repeat your exploration.
