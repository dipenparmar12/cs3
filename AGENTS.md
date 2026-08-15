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
| Bundle the JVM | repo root | `node tools/package/build-runtime.mjs --verify` → `sidecar/dist/` |
| Package (Windows) | `cs3_windows/` | `bun run electron:build` → `release/` (runs the above first) |
| Lint | `cs3_windows/` | `bunx oxlint` (oxlint is a devDependency; there is deliberately **no** `lint` script yet) |
| Typecheck only | `cs3_windows/` | `bun run typecheck` (`tsc -b` — see the warning below) |
| Sidecar build | `sidecar/` | `mvn package` → `target/cs3-sidecar.jar` + `target/lib/*` + the android shim into `runtime/` |
| Sidecar tests | `sidecar/` | `mvn test` (20 tests) |
| Main-process tests | `cs3_windows/` | `bun run test:electron` (10 tests, Node type-stripping — no framework) |
| Provider end-to-end | repo root | `node tools/e2e/provider-e2e.mjs` — see §5.1 |
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
(`.github/` does not exist). The exception is `electron/sharedDiscovery.test.mts`, run by
`bun run test:electron`: Node strips the types itself — possible only because
`erasableSyntaxOnly` is set — so there is no framework, no transform and no config to keep
working. That module earns tests where the rest of `electron/` has none because its failure
modes are invisible: a doubled scrape reads as a slow provider and a wrongly-cancelled run
reads as a flaky site, and neither would ever be traced back to it from a bug report. `.mts`
is in `tsconfig.node.json`'s `include`, so the tests are typechecked too.

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
catalogues and title enrichment), `subtitles:*` (online search, SubRip→WebVTT), `audio:*` (ffprobe
inspection and remux sessions), `sources:getCacheStats` / `sources:clearCache`.

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
| `mediaTranscoder.ts` | ffprobe/ffmpeg audio *and* video compatibility. See the codec section below — the fix for both the "no sound" bug and undecodable HEVC. |
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
| `cs3/libraryStore.ts` | Watch state, resume progress, library buckets, and remembered source choices. |
| `cs3/bookmarkStore.ts` | Saved *detail pages*, with the provider, extension, repository and query that produced them. Deliberately **not** the library: that keys on a normalised title so one film from five providers is one entry, which is right for watch tracking and useless for "reopen the page I was on". Identity and origin are stored; resolved links are not, because they expire. |
| `cs3/providerAnalytics.ts` | How every provider has actually behaved, counted. Aggregates only — no queries, no titles, no viewing history — because provider quality does not depend on any of them and this file is meant to be shareable. `empty` is tracked separately from `failure`: a provider with nothing for this title is working, and folding the two together would rank providers by catalogue breadth. |
| `cs3/providerRanking.ts` | Weighted scoring over those counts. Criteria are **rows in a table**, not a formula: an id, a weight, a sample floor and a function to `0..1` or `null`. A `null` is excluded from the denominator rather than scored zero — a provider nobody has downloaded from must not rank below one whose downloads always fail. Rates are smoothed toward a neutral prior so a new extension starts mid-table and can never be permanently buried by one unlucky first call. |
| `cs3/providerRecommendations.ts` | Turns scores into advice, and (only with `autoEnableProven`) into action. Nothing is ever auto-**disabled**: a site being down for a week is not consent to remove a source the user chose. |
| `cs3/failureTaxonomy.ts` | `classifyFailure` — one closed set of causes, shared by the ranking and the diagnostics. Counting free text produces a tally with one entry per failure; grouping by cause is what showed 113 load failures came from six missing classes. |
| `cs3/discovery.ts` | The home screen's catalogues. Stale-while-revalidate over Stremio's keyless Cinemeta catalogs (`top`/`year`/`imdbRating`, filterable by 19 genres, pageable) plus AniList for anime. Finds **nothing playable** — sources are resolved by providers when an item is opened. |
| `cs3/titleEnricher.ts` | Resolves `Avengers End Game 720p Hindi Dubbed` to the film it is about. Conservative on purpose: a disagreeing year is disqualifying and the similarity bar is high enough that `Avengers` does not match `Avengers: Endgame`. An unenriched row is a small loss; a mislabelled one reads as data corruption. |
| `torrent/torrentEngine.ts` | WebTorrent + loopback HTTP server with range support. Sequential pieces; the player only ever sees `http://127.0.0.1:PORT/…`. |
| `torrent/indexerRegistry.ts`, `indexers/*` | 7 built-in public indexers, Torznab (Jackett/Prowlarr), and aggregators (Torrentio, apibay). |
| `torrent/ranker.ts`, `releaseParser.ts` | Release-name parsing (quality/codec/group/season/episode) and result ranking. |
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

`mediaTranscoder.ts` (was `audioTranscoder.ts`) probes with ffprobe and remuxes
through ffmpeg to a loopback URL. Audio goes to AAC downmixed to stereo; video is
**copied unless it genuinely cannot be decoded**, because copying is free and
re-encoding is not. Verified end to end: an HEVC + AC-3 file comes back as H.264
High/yuv420p + AAC stereo.

Two things about that path are load-bearing:

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
