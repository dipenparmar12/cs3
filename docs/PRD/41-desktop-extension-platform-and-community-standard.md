# 41 — The Desktop Extension Platform, and a community standard of our own

**Status:** proposed. Nothing in §6–§23 is built unless a line says `[measured]`.
**Expands:** doc 39 (which sketched four lanes; this specifies five and the metadata model it lacked).
**Supersedes:** doc 27 §6–§9.
**Depends on:** doc 31 (drop-in commitment), doc 36 (provider execution), docs 37/40 (playback engine).
**Date:** 2026-08-27. Every `[measured]` figure was taken on or before this date.

---

## Evidence markers

This document mixes three kinds of claim, and conflating them is how a specification becomes
a wish list. Every non-obvious assertion carries one of:

| Marker | Means |
|---|---|
| `[measured]` | Observed by running something — a build, a test, a real provider, a real file. Reproducible by the command named beside it. |
| `[researched]` | Read from a primary source — upstream Kotlin, a published spec, an API response. Cited in §24. |
| `[proposed]` | A design decision made in this document. Not built. Arguable. |

If you are reading this to decide what to build, read the `[proposed]` sections and treat §2
and §4 as the constraint set. If you are reading it to decide whether the plan is grounded,
read §2 and §4 — those are the parts that are checkable.

---

## Table of contents

| § | Section |
|---|---|
| 1 | Executive summary |
| 2 | Research: the Android ecosystem exactly as it is |
| 3 | Where we are today: the desktop as-built |
| 4 | Gap analysis: 21 named defects, with evidence |
| 5 | Vision, principles and non-goals |
| 6 | Platform architecture: five lanes, one contract |
| 7 | CSX-REPO: the repository specification |
| 8 | Trust: signing, pinning, revocation |
| 9 | CSX-EXT: the extension specification |
| 10 | CSX-SDK: the provider contract |
| 11 | The unified metadata model |
| 12 | The media source model |
| 13 | The extension runtime and host API |
| 14 | Security model and threat analysis |
| 15 | Search aggregation and scope |
| 16 | Library, indexing and caching |
| 17 | External metadata and multi-source ratings |
| 18 | Artwork pipeline |
| 19 | Networking and performance |
| 20 | Developer experience and tooling |
| 21 | Publishing, CI and community governance |
| 22 | Desktop UX for extension management |
| 23 | IPC surface, migration and sequencing |
| 24 | Acceptance criteria, risks, open decisions, sources |

---

## 1. Executive summary

### 1.1 What we are being asked for

CloudStream on Android has something rarer than good code: **a working extension economy.**
Roughly 400 community-maintained scrapers `[measured]` (392 archives surveyed in doc 35), 26
vendored repositories, and a publishing loop where a maintainer can fix a broken site on a
Tuesday afternoon and every user has the fix before the app ships another release. No central
review, no store, no gatekeeper. The app is a runtime; the ecosystem is the product.

We want that for desktop — not by borrowing theirs, but by **having our own**: our own
repositories, our own extension developers, our own publishing conventions, and our own
standard that other people write against.

### 1.2 What this document decides

**Five lanes, one contract.** A provider is a provider regardless of what it was written in
or where it runs. The host sees one `Provider` interface producing one `Source` object and
one metadata model; the lane is provenance and trust metadata, nothing more.

```
                    ProviderRegistry  —  one interface, one Source, one metadata model
                                  │
   ┌───────────────┬──────────────┼──────────────┬────────────────┐
   │               │              │              │                │
 L0  .cs3        L1  .csj       L2  .csx       L3  addon URL    L4  yt-dlp rule
 Android DEX     upstream JVM   OUR STANDARD   remote HTTP      subprocess
 → dex2jar       jar, no DEX    TypeScript in  (Stremio-        (~1,800 sites,
 → JVM sidecar   → JVM sidecar  QuickJS         compatible)      declarative)
 EXISTS          NEARLY FREE    BUILD THIS     CHEAP WIN        NEARLY FREE
 [measured]      [researched]   [proposed]     [proposed]       [proposed]

   └────── L5 reserved: .wasm component. Same manifest, different binary. Not now. ──────┘
```

L1 is new to this document and is the single highest-value finding of the research (§2.9):
**upstream's Gradle plugin gained an `isCrossPlatform` mode that emits a plain JVM `.jar`
beside the `.cs3`, verified at build time by `jdeps` to contain no `android.` imports, and
the repository index already carries `jarUrl` / `jarHash` / `jarFileSize` for it**
`[researched]`. A maintainer who sets one boolean produces an artifact our sidecar can load
**with no DEX translation, no dex2jar, no `KotlinNameRepair`, and no `RUNTIME_GENERATION`
churn** — retiring, per archive, an entire class of defects this repository has already had.

There is currently no host that consumes that artifact. We should be it, and we should be the
reason maintainers set the flag. That is a community relationship, not a code change.

### 1.3 The three standards this defines

| Standard | Owns | Audience |
|---|---|---|
| **CSX-REPO** | The repository: index schema, signing, trust pinning, channels, discovery | Repository operators |
| **CSX-EXT** | The extension bundle: manifest, layout, versioning, permissions, lifecycle | Extension authors |
| **CSX-SDK** | The provider contract: interfaces, metadata model, source model, host API | Both, plus us |

They version independently. An extension declares an SDK **range**; a repository declares an
index schema version; the app declares which of each it supports. All three are semver, and
§9.4 explains why an integer — which is what Android uses `[researched]` — cannot express the
thing that actually matters.

### 1.4 The four claims that make this "superior" rather than merely "different"

Each is measured or read from source, not asserted:

1. **Trust survives a repository takeover.** Android verifies `fileHash`, and the hash is
   published in the same document as the download URL `[researched]` — so whoever can rewrite
   the index rewrites both. We pin an ed25519 public key on first install and refuse a
   differently-signed artifact *by name* (§8).
2. **A scraper cannot exfiltrate.** An Android `.cs3` is arbitrary DEX holding the host app's
   full privileges `[researched]`. Our L2 lane declares its hosts and the allow-list is
   **enforced by the broker**, not advisory (§13.3, §14).
3. **The metadata model carries what a media application actually displays.** Upstream's
   `Score` is a single scalar `[researched]` — one rating, no source attribution, so "IMDb 7.8
   / RT 91% / Metacritic 74" is inexpressible. It has no crew, no original title, no chapters,
   no collections, no typed artwork, and — the one that reaches playback — `AudioFile` carries
   `url` and `headers` and **no language** `[researched]`, so a separate Hindi dub arrives
   unlabelled. §11 and §12 fix all of it, additively.
4. **A source declares what the host would otherwise guess.** We already spend 1.6–1.7 s per
   source probing for codecs `[measured]`, and we already dig link expiry out of
   `Expires`/`exp`/JWT claims because nobody declares it `[measured]`. §12 makes both
   declarable — never *trusted* over a probe, but enough to skip one.

### 1.5 What this costs, honestly

L1 is days. L3 and L4 are about a week each. L2 — the sandbox, the SDK, the CLI, the signing
chain, the metadata model — is the real project, sequenced across four milestones in §23.5.

Nothing in L2 is on the critical path for the app working: **L0 streams the corpus today**
`[measured]`, and every lane after it is additive. That is deliberate. A rewrite that has to
land before anything works is a rewrite that never lands.

**The thing that cannot be bought with engineering is the community.** §21 is about that, and
it is the section most likely to decide whether this succeeds or becomes doc 39 again.

---

## 2. Research: the Android ecosystem exactly as it is

Everything here was read from upstream source at `recloudstream/cloudstream` `master` and
`recloudstream/gradle` `master` on 2026-08-27, or measured against the local corpus. Where the
code contradicts the published documentation, the code is what is recorded.

### 2.1 Release cadence, and what "the beta" actually is

`[researched]` — GitHub releases API:

| Tag | Name | Prerelease | Date | Assets |
|---|---|---|---|---|
| `pre-release` | Pre-release Build | **yes** | 2026-08-26 | `app-prerelease-release.apk`, `app-sources.jar`, **`classes.jar`** |
| `v4.8.0` | July Update | no | 2026-07-10 | `4.8.0.apk` |
| `v4.7.0` | March Update | no | 2026-03-29 | `4.7.0.apk` |
| `v4.6.0` | October Update | no | 2025-10-15 | `4.6.0.apk` |

Two things commonly got wrong:

- **There is no separate "CloudStream 3 Beta" application.** The beta is a *rolling tag*
  (`pre-release`) rebuilt from `master`, and it is where the ecosystem's forward motion lives.
  Stable ships roughly three times a year; the pre-release ships continuously. Any statement
  of the form "CloudStream does X" should be checked against `master`, not against 4.8.0.
- **The pre-release publishes `classes.jar` as a first-class release asset**, beside the APK
  and the sources jar. That artifact is the plugin-facing library — the same thing our
  `sidecar/runtime-deps/pom.xml` resolves from JitPack as `library-jvm` `[measured]`. Its
  promotion to a release asset is the visible surface of §2.9.

### 2.2 The source layout, and the migration underneath it

`[researched]` — `MainAPI.kt` now lives at
`library/src/commonMain/kotlin/com/lagradost/cloudstream3/MainAPI.kt`. `commonMain` is the
Kotlin Multiplatform source-set convention. **The provider-facing API has been lifted out of
the Android application into a platform-neutral library**, and the app module retains only
what genuinely needs Android.

That migration is neither cosmetic nor finished, and it explains our entire shim history:

- `BasePlugin`, `APIHolder`, `ExtractorApi` and `CloudstreamPlugin` are all inside
  `library-jvm` 4.8.0 `[measured]` — contradicting doc 36 §3, which budgeted a week to shim
  them;
- while `Plugin`, `DataStore`, `CloudflareKiller`, `PluginManager`, `RepositoryManager` and the
  whole `syncproviders` cluster are **not**, and had to be supplied from `sidecar/bridge/`
  across four rounds `[measured]` (AGENTS.md §5);
- and `WebViewResolver` **is** published but is `TODO("Not yet implemented")` on the JVM
  target `[measured]` — a class that links perfectly and does nothing, which is exactly why
  four rounds of counting `NoClassDefFoundError` never surfaced it.

**The boundary between "library" and "app" is where our compatibility work lives, and it is
moving in our favour.** Every release that pushes another type into `commonMain` is one fewer
shim we maintain. That is strategy, not trivia: the cheapest way to shrink our shim surface is
to *participate upstream* in moving types into the library, rather than to reimplement them in
the bridge forever.

### 2.3 Repository format — `repo.json`

`[researched]` — `RepositoryManager.kt`:

```kotlin
data class Repository(
    val iconUrl: String?,
    val name: String,
    val description: String?,
    val manifestVersion: Int,
    val pluginLists: List<String>,   // URLs of plugins.json documents
)
```

That is the entire repository specification. Five fields. Note what is absent: no publisher
identity, no public key, no categories, no channels, no schema URL, no update policy, no
contact, no licence, no minimum app version.

`manifestVersion` exists and **is never read** — `parseRepository` carries the comment
`// Take manifestVersion and such into account later` `[researched]`. There is a version field
and there is no version negotiation.

`parseRepository` fetches through `convertRawGitUrl(url)` with a 5-minute cache. Repository
URLs are frequently project pages (`https://github.com/owner/repo`) rather than raw documents,
so the conversion is a pile of heuristics. Our `pluginManager` has to do the same and cannot
use a convention, because there isn't one: `master/repo.json`, `builds/repo.json` and
`builds/plugins.json` are all in live use across the bundled list `[measured]`.

### 2.4 Extension index — `plugins.json`

`[researched]` — the consumer schema is `SitePlugin`; the producer is `PluginEntry` in the
Gradle plugin. The document is a **bare JSON array**, with no envelope:

```kotlin
data class PluginEntry(
    val url: String,             // the .cs3
    val status: Int,             // 0 down, 1 ok, 2 slow, 3 beta
    val version: Int,            // integer; any increase triggers auto-update
    val name: String,
    val internalName: String,
    val authors: List<String>,
    val description: String?,
    val fileSize: Long?,
    val repositoryUrl: String?,
    val language: String?,       // BCP-47-ish: "en", "zh-TW"
    val tvTypes: List<String>?,
    val iconUrl: String?,
    val apiVersion: Int,
    val fileHash: String?,       // "sha256-<hex>"
    // cross-platform — see §2.9
    val jarFileSize: Long?,
    val jarUrl: String?,
    val jarHash: String?,
)
```

Source comments worth quoting, because they are the standard admitting its own state
`[researched]`:

- on `apiVersion`: *"Unused currently, used to make the api backwards compatible? Set to 1"*
- on `tvTypes`: *"These types are yet to be mapped and used, ignore for now"*
- on `version`: *"Integer over 0, any change of this will trigger an auto update"*

And in `CloudstreamExtension`: `val apiVersion = 1` — **a constant, not a setting**
`[researched]`. Every extension in the corpus declares `apiVersion: 1` and always will until
someone edits the build plugin. **There is no version negotiation in this ecosystem at all.**
There is a field named as though there were, which is worse than not having one, because it
reads to an implementer as a mechanism.

`fileHash` is published as `sha256-<hex>`; the prefix must be stripped before comparing. The
app does this in `installPlugin`; the first version of our own harness did not, and reported
every download in the corpus as a hash mismatch `[measured]`.

### 2.5 The archive — `.cs3`

`[researched]` — the `make` task is a `Zip` with `archiveExtension = "cs3"` and
`isPreserveFileTimestamps = false`:

```
MyProvider.cs3           (ZIP)
├── manifest.json        ← GenerateManifestTask
├── classes.dex          ← CompileDexTask (d8, against the android bootclasspath)
└── res/…, resources.arsc  ← only when requiresResources; res.apk unzipped, AndroidManifest.xml excluded
```

**`manifest.json` has four fields** `[researched]`:

```kotlin
data class PluginManifest(
    val pluginClassName: String,   // found by scanning for the @CloudstreamPlugin annotation
    val name: String,              // = the gradle project name
    val version: Int,              // = project.version parsed as an integer, or -1
    val requiresResources: Boolean
)
```

This is the most consequential structural weakness in the standard, and §4.2 develops it:
**the archive knows almost nothing about itself.** Authors, description, language, tvTypes,
icon, apiVersion, originating repository — all of it lives in the *index*, a separate document
from a separate URL, with nothing binding the two. Rename a file, publish it under a different
entry, and the archive cannot contradict you.

`project.version.toString().toIntOrNull(10)` falls back to `-1` with a warning `[researched]`.
An author who writes `version = "1.4.2"` ships `-1` and a log line.

### 2.6 The provider contract — `MainAPI`

`[researched]`. The full member list, from the class:

```kotlin
abstract class MainAPI {
  open var name; open var mainUrl; open var lang                    // identity
  open var storedCredentials: String?; open var canBeOverridden     // "clone site" support
  open var sequentialMainPage; open var sequentialMainPageDelay; open var sequentialMainPageScrollDelay
  open val instantLinkLoading; open val hasChromecastSupport; open val hasDownloadSupport
  open val usesWebView; open val hasMainPage; open val hasQuickSearch
  open val loadLinksTimeoutMs / getMainPageTimeoutMs / searchTimeoutMs / quickSearchTimeoutMs / loadTimeoutMs
  open val supportedSyncNames; open val supportedTypes; open val vpnStatus; open val providerType
  open val mainPage: List<MainPageData>

  open suspend fun getMainPage(page: Int, request: MainPageRequest): HomePageResponse?
  open suspend fun search(query: String, page: Int): SearchResponseList?   // primary in 4.8.0
  open suspend fun search(query: String): List<SearchResponse>?            // legacy
  open suspend fun quickSearch(query: String): List<SearchResponse>?
  open suspend fun load(url: String): LoadResponse?
  open suspend fun loadLinks(data, isCasting, subtitleCallback, callback): Boolean
  open suspend fun extractorVerifierJob(extractorData: String?)
  open fun getVideoInterceptor(extractorLink: ExtractorLink): Interceptor?
  open suspend fun getLoadUrl(name: SyncIdName, id: String): String?
}
```

Five properties are worth carrying forward verbatim, and §10 does:

1. **Everything is `open`; nothing is abstract.** A provider implements what it can and the
   base class answers "unsupported" for the rest. That is why a review catalogue like
   `BingedReview` can exist with no `loadLinks` and not be *broken* `[measured]`.
2. **`loadLinks` is push-shaped**, delivering through `callback`/`subtitleCallback` rather than
   returning a list. Twenty mirrors resolving at wildly different speeds arrive as they
   resolve. Our `search:*` and `playback:*` channels are push-shaped for exactly this reason
   `[measured]`, so the shape is already proven in our IPC.
3. **Timeouts are per-operation, declared by the provider as hints.** The scraper knows its own
   site is slow; the host decides whether to honour it.
4. **`sequentialMainPage` + delays are a politeness contract with the scraped site**, expressed
   by the scraper. A host that ignores it gets that provider's users rate-limited.
5. **`providerType: MetaProvider | DirectProvider`** distinguishes a catalogue from a scraper.
   We rediscovered the need for this independently — it is the entire subject of
   `sourceScope.ts` and the "ask the originating provider first" work `[measured]`.

`search(query, page)` is the primary overload in 4.8.0 and `search(query)` is the fallback —
the reverse of what doc 36 §4 claims. Calling only the single-argument form returns
"unsupported" from the base class for a modern provider `[measured]`.

Two smaller members are easy to miss and both matter to us. `instantLinkLoading` says the
playable link is already inside the `data` string, so `loadLinks` need not hit the network —
a free latency win we do not currently read. And `getVideoInterceptor` lets a provider attach
an OkHttp interceptor to *playback* requests, which is a capability our proxy architecture
expresses differently (§12.6) and must not silently drop.

### 2.7 The extractor registry, and the hack in the middle of it

`[researched]` — `ExtractorApi.kt`. An `ExtractorApi` declares `name`, `mainUrl`,
`requiresReferer` and implements `getUrl(url, referer, subtitleCallback, callback)`. Instances
register into a **single process-global `extractorApis` list**, and `loadExtractor(url, …)`
resolves an embed URL to whichever registered extractor claims it.

This is the ecosystem's best structural idea and its most fragile implementation at once.

*The idea:* **one extension's Voe extractor serves twenty other providers.** File-host support
is written once and shared. That is genuine cross-extension code reuse in a system with no
dependency mechanism at all — and it is why the corpus can keep up with file hosts.

*The implementation:* matching walks `extractorApis` **backwards**, then falls back to

```kotlin
if (Levenshtein.partialRatio(extractor.mainUrl, currentUrl) > 80) { … }
```

— a fuzzy string distance against the host, to catch mirror domains (`example.com` /
`example.net`). Three consequences, all real:

- **Which extractor wins depends on load order**, because the list is walked from the end.
  Load order depends on install order, which depends on the user. Two users with the same
  extensions installed in a different order can get different results for one URL.
- **A similarly-named unrelated host gets claimed by the wrong extractor**, and the failure is
  attributed to the provider that emitted the URL, not to the extractor that stole it.
- **It is unfixable inside this design**, because there is no declaration to consult. An
  extractor never states which hosts it handles; the host is inferred from a `mainUrl` chosen
  for other reasons.

§10.5 is our answer: extractors are **declared** in the manifest, resolved by an explicit
host-pattern registry with deterministic precedence and an explicit tie-break. This is one of
the few places where we should not copy the shape at all — only the idea.

### 2.8 Plugin lifecycle

`[researched]` — `PluginManager.kt`, corroborated by our own reimplementation `[measured]`:

1. Read the repository list — user-added `RepositoryData` **plus `PREBUILT_REPOSITORIES`**, a
   compiled-in constant. Bundled repositories are not removable through data.
2. `parseRepository` → `repo.json` → `pluginLists[]` → `parsePlugins` each → `SitePlugin[]`.
   `pluginLists` is fetched with `amap` (parallel).
3. Download the `.cs3`, verify `fileHash`, write to the Android-style plugin directory.
4. Open the archive with a class loader whose classpath includes the archive itself; read
   `manifest.json` **through the class loader**, not from the filesystem.
5. `loadClass(pluginClassName)`, construct reflectively, call `load(context)`.
6. **Observe self-registration.** The plugin calls `registerMainAPI` / `registerExtractorAPI`,
   which append to the global `APIHolder.allProviders`. Providers do not return themselves;
   registration is a side effect, observed by remembering the list's *length* before the call.
7. Persist `PluginData { internalName, url, isOnline, filePath, version }`.
8. On update, compare index `version` against stored `version`; any increase auto-updates.

**Step 6 has cost us more than any other single design decision in this ecosystem.** Because
registration is observed by a length mark on a global list, two loads that overlap both read
from the same mark and each claims the other's providers. Measured: eight concurrent load RPCs
produced **176 providers attributed to the wrong extension** `[measured]`. Nothing upstream
prevents this — serial loading merely makes it latent rather than absent. Our fix is
`PluginHost.registrationLock` plus an in-flight dedupe map in `ensureProviderActive`
`[measured]`.

Also note step 1's entry point: `___DO_NOT_CALL_FROM_A_PLUGIN_loadAllOnlinePlugins`, guarded by
`assertNonRecursiveCallstack()`, with a comment warning of *"an infinite recursive loop lagging
or crashing everyone's devices"* `[researched]`. **That is what a capability model looks like
when it is implemented as a naming convention.**

### 2.9 The cross-platform lane — the finding that changes the plan

`[researched]` — `CloudstreamExtension.kt`:

```kotlin
/**
 * Enable this if your plugin does not use any android imports or app refrences.
 * This will generate jar files using :make and these files can be checked with :ensureJarCompatibility
 **/
var isCrossPlatform = false
```

When set, three things happen in the build `[researched]`:

- `compilePluginJar` copies the module's full JAR (`createFullJarDebug`) to `build/<name>.jar`,
  beside the `.cs3`;
- `ensureJarCompatibility` runs **`jdeps --print-module-deps`** over it and **fails the build**
  if the output contains `android.`:

  > *"The cross-platform JAR file contains Android imports! This will cause compatibility
  > issues. Remove 'isCrossPlatform = true' or remove the Android imports."*

- `writeCacheEntry` emits `jarUrl`, `jarHash` and `jarFileSize` into the plugin entry, so
  **the published index already carries the cross-platform artifact**.

Read as a whole, that is an invitation. Upstream has built and shipped a mechanism for
publishing scrapers **guaranteed by a build-time verifier** to be free of Android API surface,
and there is currently no host consuming it.

What an opted-in archive retires for us `[measured]`, from AGENTS.md §5:

| Retired | Why it existed |
|---|---|
| dex2jar translation | DEX is not JVM bytecode |
| `KotlinNameRepair` | dex2jar rewrites `Result.constructor-impl` → `constructor_impl`, which resolves against nothing |
| the hash-keyed translation cache | translation is expensive and must be memoised |
| dropping translations on a `RUNTIME_GENERATION` bump | cached output outlives a translator fix |
| the concurrent-translation nonce | two passes collided on one temp file name |
| ~11 ms mean translate + analyse per archive | measured across 124 archives |

Every one of those is a defect this repository has already had, at least once, in production.
A `.csj` extension has none of them, because there is nothing to translate.

**It does not retire the shim**, and claiming otherwise would be exactly the kind of
overclaiming §4 exists to prevent. A cross-platform jar still links against `library-jvm` and
may still reach `Plugin`, `DataStore`, `CloudflareKiller` or `syncproviders` — the `:app` types
`jdeps` does not flag, because they are not `android.*`. `LinkageAnalyzer` still runs and still
assigns a tier. What goes away is the **bytecode** problem, not the **classpath** one.

### 2.10 Trust, permissions and sandboxing on Android

`[researched]`. This subsection is short because the answer is short.

| Control | State |
|---|---|
| Transport | HTTPS in practice; not enforced by the format |
| Integrity | `fileHash`, `sha256-<hex>`, and **optional** (`String?`) |
| Authenticity | **none** — there are no signatures anywhere in the format |
| Publisher identity | **none** — `authors` is a display string |
| Permissions | **none** — DEX runs with the host app's full privileges |
| Isolation | **none** — same process, same VM, shared static state |
| Review | **none**, by design |
| Revocation | `status: 0` in the index — which a compromised index also controls |

The integrity story needs stating precisely, because "it verifies a hash" sounds like more than
it is: **the hash and the URL are published in the same document.** An attacker who can modify
`plugins.json` modifies both. `fileHash` defends against a corrupted download and a compromised
CDN; it does not defend against a compromised *repository*, which is the threat that actually
matters for a system whose premise is installing code from strangers.

This is not a criticism of a project that made a deliberate trade — no gatekeeper *is* the
feature, and it is the right feature. It is the largest single opportunity in this document,
because **signing costs nothing at runtime and the trade does not have to be made** (§8).

### 2.11 The metadata model

`[researched]` — `MainAPI.kt`. This is what a provider can say about a title.

```kotlin
interface LoadResponse {
    var name: String; var url: String; var apiName: String; var type: TvType
    var posterUrl: String?; var year: Int?; var plot: String?
    var score: Score?                       // ONE scalar, no source attribution
    var tags: List<String>?
    var duration: Int?                      // minutes
    var trailers: MutableList<TrailerData>
    var recommendations: List<SearchResponse>?
    var actors: List<ActorData>?            // cast only — no crew
    var comingSoon: Boolean
    var syncData: MutableMap<String, String>   // external ids, stringly typed
    var posterHeaders: Map<String, String>?
    var backgroundPosterUrl: String?
    var logoUrl: String?
    var contentRating: String?
    var uniqueUrl: String
}
```

Plus, by subtype:

| Type | Adds |
|---|---|
| `EpisodeResponse` (TV/anime) | `showStatus`, `nextAiring: NextAiring{episode, unixTime, season}`, `seasonNames: List<SeasonData{season, name, displaySeason}>` |
| `AnimeLoadResponse` | `engName`, `japName`, `synonyms`, `episodes: Map<DubStatus, List<Episode>>` |
| `TorrentLoadResponse` | `magnet`, `torrent` |
| `LiveStreamLoadResponse` | `dataUrl` |

And the leaf types:

```kotlin
data class Episode(data, name?, season?, episode?, posterUrl?, score?, date?, runTime?)  // runTime in seconds
data class Actor(name, image?)
data class ActorData(actor, role?, roleString?, voiceActor?)
data class TrailerData(extractorUrl, referer?, raw, headers)
data class SeasonData(season, name?, displaySeason?)
data class NextAiring(episode, unixTime, season?)
enum class ShowStatus { Completed, Ongoing }
enum class DubStatus(id) { None(-1), Dubbed(1), Subbed(0) }
enum class ProviderType { MetaProvider, DirectProvider }
enum class VPNStatus { None, MightBeNeeded, Torrent }
enum class TvType(v) { Movie(1) AnimeMovie(2) TvSeries(3) Cartoon(4) Anime(5) OVA(6) Torrent(7)
                       Documentary(8) AsianDrama(9) Live(10) NSFW(11) Others(12) Music(13) AudioBook(14) … }
enum class SearchQuality(v) { Cam CamRip HdCam Telesync WorkPrint Telecine HQ HD HDR BlueRay DVD SD FourK }
```

`Score` deserves its own note, because its design is careful and its *shape* is the problem
`[researched]`. It stores a fixed-point integer in `[0, 10^9]` and converts to any scale on
read (`toInt(maxScore)`, `toFloat(10)`, `toStringNull(minScore, maxScore, decimals)`), and it
deliberately returns `null` below a minimum so a default `0` never renders as `0.0/10.0`. That
is thoughtful work on **precision**. It is single-valued, so it cannot express **provenance** —
and provenance is the thing a viewer needs, because "7.8" means different things from IMDb, TMDB
and MyAnimeList, and a critic score and an audience score disagreeing is *information*.

The media-facing leaf types are thinner still:

```kotlin
data class AudioFile(url, headers?)          // NO language field
data class SubtitleFile(lang, url, headers?)
open class ExtractorLink(source, name, url, referer, quality, type, headers, extractorData, audioTracks, …)
class DrmExtractorLink : ExtractorLink(… kid, key, kty, uuid, licenseUrl, keyRequestParameters)
class ExtractorLinkPlayList : ExtractorLink(… playlist: List<PlayListItem>)
enum class ExtractorLinkType { VIDEO, M3U8, DASH, TORRENT, MAGNET }
```

`AudioFile` having **no language** is not a nitpick. A provider that hands back three separate
audio tracks — the exact Movies4u shape measured in doc 38 `[measured]` — hands back three
indistinguishable URLs. The host can offer "Audio 1 / Audio 2 / Audio 3" and nothing better.

### 2.12 The developer workflow

`[researched]`, from `recloudstream/gradle` and the docs site:

1. Fork `recloudstream/plugin-template`.
2. One Gradle module per extension. `apply plugin: com.lagradost.cloudstream3.gradle`.
3. Configure the `cloudstream { }` block:
   `description`, `authors`, `status`, `language`, `tvTypes`, `iconUrl`, `requiresResources`,
   `isCrossPlatform`, `setRepo(...)`, `buildBranch` (default `"builds"`).
   `setRepo` understands **github, gitlab, codeberg, `gitlab-<domain>`, `gitea-<domain>`**, or
   a raw-link format string — so the standard is *not* GitHub-only, which matters for §7.7.
4. Write a `Plugin` subclass annotated `@CloudstreamPlugin`, whose `load()` calls
   `registerMainAPI(…)` / `registerExtractorAPI(…)`.
5. `./gradlew make` → `.cs3`. `./gradlew makePluginsJson` → the index.
6. `./gradlew deployWithAdb` pushes to a connected device — the only debugging affordance in
   the toolchain.
7. CI (a GitHub Action in the template) builds every module on push and force-pushes the
   artifacts plus `plugins.json` to the `builds` branch.

The attribution in the Gradle plugin's README is worth knowing: *"This gradle plugin and the
whole plugin system is heavily based on [Aliucord]"* `[researched]` — a Discord client mod. The
lineage explains several choices, including integer versions and DEX-in-a-zip.

**What the toolchain does not have**, and §20 supplies: no test harness, no fixture recording,
no mock runtime, no linter, no manifest validator, no local run without a device or emulator,
no hot reload, no docs generator, no semantic versioning, no dependency resolution.

Debugging a scraper today means: build, `adb push`, open the app, search, read logcat. Our
harnesses (`provider-e2e.mjs`, `native-engine-matrix.mjs`) already do more than that
`[measured]` — for *our* corpus runs, not for an author's inner loop. Turning them outward is
most of §20.

---

## 3. Where we are today: the desktop as-built

This section is inventory, not aspiration. Everything in it is `[measured]` — it runs.

### 3.1 The execution chain

```
repo.json  →  plugins.json  →  .cs3 download + SHA-256  →  DexTranslator (dex2jar 2.4.38)
    →  KotlinNameRepair  →  LinkageAnalyzer (T1…T4_BLOCKED)  →  PluginClassLoader
    →  manifest.json read through the loader  →  loadClass  →  construct  →  load(context)
    →  self-registration observed  →  ProviderRegistry row persisted
```

Then, per call: `PluginManager` → `SidecarSupervisor` (line-delimited JSON-RPC over stdio) →
JVM sidecar → `ProviderBridge` (Kotlin, loaded by the shared loader that owns `library-jvm`) →
the provider. Answers come back as JSON strings, read by `cs3/providerLinks.ts` without
guessing.

The reverse direction exists too: the sidecar can call **back** into Electron
(`{"hostCall":"webview.resolve","hostId":…}` → `{"hostReply":…}`), which is what makes
`WebViewResolver` and `CloudflareKiller` real rather than `TODO` `[measured]`.

### 3.2 What is proven

| Claim | Evidence |
|---|---|
| Translation is not the risk | 392/392 archives translated, 18,217 classes, 0 verification failures, 6,617 coroutine state machines `[measured]`, doc 35 |
| Providers load, scrape, resolve and stream | `provider-e2e.mjs --plugins 30`: 66 loaded, 24 answering, 18 links, 16 streams with bytes `[measured]` |
| The class problem is closed | 3 `NoClassDefFoundError` in that whole run, all one class (`CloudStreamApp`, i.e. Ultima) `[measured]` |
| The browser gap is closed | WebView bridge, `webViewMatch.ts` (21 cases), `javap`-verified shadow of the library stub `[measured]` |
| Hydration replaced a cold load | 6.6 s → 8 ms for 117 archives, 132 providers preserved, sidecar not started `[measured]` |
| CSX repository drives end-to-end | `--repo CSX --plugins 10`: 11 loaded, 9 answering, 8 links, 7 streams `[measured]` |

### 3.3 The host services an extension already sits inside

Roughly 70 IPC channels and ~40 main-process modules. The ones an extension platform must
plug into rather than replace:

| Concern | Module | Why it constrains the design |
|---|---|---|
| Enable cascade | `pluginManager.enabledProviderNames` | The **single** enforcement point for provider / extension / repository / adult gating. Every consumer funnels through it. A new lane must too. |
| Scope | `searchScope.ts`, `sourceScope.ts` | A selection is a strict filter; `origin` scope binds a title to the providers that produced it. |
| Identity | `cs3ext://<provider>/<handle>` | The address space. A provider name is globally unique by construction. |
| Ranking | `providerAnalytics` / `providerRanking` / `providerRecommendations` | Counts, weights, advice. `empty ≠ failure`; nothing is auto-disabled. |
| Failure vocabulary | `failureTaxonomy.ts` | One closed `FailureKind` set shared by ranking, diagnostics and the issue ledger. |
| Durable tally | `cs3/extensionIssues.ts` | 5,407 stderr records → ~200 distinct problems `[measured]`. |
| Registry | `cs3/providerRegistry.ts` | What each archive registered, keyed `size:mtime:generation`. |
| Provisioning | `cs3/runtimeProvisioner.ts` | The stamped `%APPDATA%` copy, `RUNTIME_GENERATION` = 8. |
| Playback contract | `media:prepare` | The **only** way to obtain a playable URL. INV-RACE-1. |
| Header injection | `mediaProxy.ts` | Loopback + `Referer`/`User-Agent`, HLS/DASH rewriting, random 16-byte tokens. |
| Link reading | `cs3/providerLinks.ts` | Type, DRM, playlist parts, audio headers — read, never re-derived. |

### 3.4 What we have that Android does not

Worth listing, because these are the parts of *our* platform an extension author would be
writing against, and several have no Android analogue at all:

- **A decision engine that is pure and tested** — `(metadata, transport, caps, encoder) →
  TransformationPlan`, 35 cases `[measured]`. Android hands the bitstream to ExoPlayer and is
  done; we have to decide, so the decision is a testable artifact.
- **mpv as a routed engine**, with a policy (`off` / `auto` / `aggressive`) and a pixels-per-
  second software guard `[measured]`.
- **A source-expiry model.** `sourceCache` reads deadlines out of `Expires`/`exp`/JWT claims,
  counts non-definitive failures three strikes, drops 404/410 on sight `[measured]`.
- **Provenance to the repository.** `repository ▸ extension ▸ provider` on every row, plus
  `cs3_provider_origins` persisted so a disabled extension can still explain a dead bookmark.
- **`explainMissingProvider`** — six causes, six different user actions `[measured]`.
- **Diagnostics that group by cause.** Grouping is what turned 113 load failures into six
  missing classes `[measured]`.
- **Two real end-to-end harnesses** driving the corpus against live hosts.

That list is the foundation of the pitch in §21.2. A desktop extension author gets telemetry,
provenance, a compatibility matrix and a playback engine that an Android author does not have.

### 3.5 What we do not have

- **No lane but L0.** Every provider must be Kotlin compiled for Android.
- **No sandbox.** `sandboxGaps` reports raw network egress and process creation as unenforced,
  and reports it in the UI on purpose `[measured]`.
- **No signing, no publisher identity, no channels.**
- **No SDK, CLI, template, validator, test harness or docs for an author.**
- **No metadata beyond what `LoadResponse` carries**, which §4.5 shows is thin.
- **No repository of our own.** We consume five bundled community repositories; we publish none.

---

## 4. Gap analysis: 21 named defects, with evidence

These are the specific, checkable reasons the Android standard should be *inherited from*
rather than *adopted*. Each names its evidence and the section that answers it. Several are
defects we have already been bitten by, which is the strongest form of evidence available.

### 4.1 Trust and integrity

| # | Defect | Evidence | Answered by |
|---|---|---|---|
| **D1** | **No authenticity.** No signatures in the format. `fileHash` is published in the same document as the URL, so a repo takeover defeats it. | `[researched]` §2.10 | §8.2–§8.5 |
| **D2** | **`fileHash` is optional** (`String?`) and an entry without one installs silently. | `[researched]` `SitePlugin` | §7.3 `required` |
| **D3** | **No publisher identity.** `authors` is a display string; nothing binds an artifact to a person or key. | `[researched]` | §8.6 |
| **D4** | **Revocation is controlled by the thing being revoked.** `status: 0` lives in the index an attacker already owns. | `[researched]` §2.10 | §8.7 |

### 4.2 The archive/index split

| # | Defect | Evidence | Answered by |
|---|---|---|---|
| **D5** | **The archive does not describe itself.** `manifest.json` has 4 fields; everything else lives in the index. Nothing binds them, so the index can misdescribe the artifact and the artifact cannot object. | `[researched]` §2.5 | §9.2 — the manifest is authoritative; the index is a *cache* of it, and disagreement is a named refusal |
| **D6** | **No `id`.** `internalName` is the identity and it is a display-adjacent string, unnamespaced. Two authors can collide. | `[researched]` | §9.2 reverse-DNS `id` |
| **D7** | **Provider-name collisions are a genuine ecosystem hazard.** Provider identity is a bare name; two extensions claiming one name means the first wins and the second silently offers nothing. | `[measured]` — `providerNameClashes` exists in our code because it happened | §10.2 namespaced provider ids |

### 4.3 Versioning and compatibility

| # | Defect | Evidence | Answered by |
|---|---|---|---|
| **D8** | **`version` is an integer.** No semver, no prerelease, no ordering beyond ">". An author who writes `"1.4.2"` ships `-1`. | `[researched]` §2.5 | §9.4 semver + monotonic `versionCode` |
| **D9** | **`apiVersion` is a hardcoded constant.** `val apiVersion = 1` in the build plugin; *"unused currently"* in the consumer. There is no version negotiation. | `[researched]` §2.4 | §9.5 `sdk` semver **range** |
| **D10** | **A range is needed, not a floor.** A floor cannot deprecate. Doc 27 PLG-V-2 asked for a minimum; a minimum cannot express "this stopped working at 3.0". | `[researched]` + doc 27 | §9.5 |
| **D11** | **No dependency mechanism.** The shared-extractor pattern (§2.7) is real cross-extension reuse implemented as a global list and load-order luck. | `[researched]` §2.7 | §9.6 + §10.5 |
| **D12** | **No update channels.** `status` conflates health (down/ok/slow) with maturity (beta) in one integer. | `[researched]` | §7.4 channels ⟂ health |

### 4.4 Safety and isolation

| # | Defect | Evidence | Answered by |
|---|---|---|---|
| **D13** | **No permission model.** DEX runs with the host's full privileges. A scraper for one site can reach any host, any file, any other plugin's data. | `[researched]` §2.10 | §9.7 + §13.3 + §14 |
| **D14** | **Isolation is a naming convention.** `___DO_NOT_CALL_FROM_A_PLUGIN_loadAllOnlinePlugins`. | `[researched]` §2.8 | §13, §14.4 |
| **D15** | **Load-order-dependent extractor dispatch**, with a Levenshtein tie-break. Nondeterministic per user. | `[researched]` §2.7 | §10.5 declared patterns, deterministic precedence |
| **D16** | **Registration is observed by a length mark on a global list**, so concurrent loads cross-attribute. Measured at **176 misattributed providers** under 8 concurrent RPCs. | `[measured]` §2.8 | §10.2 — providers are *returned*, not registered by side effect |

### 4.5 The metadata model

The user-visible half. Every row is something a media application displays and this model
cannot carry.

| # | Missing | Consequence | Answered by |
|---|---|---|---|
| **D17** | **Multiple ratings.** `Score` is one scalar with no source. | "IMDb 7.8 / RT 91% / Metacritic 74" is inexpressible. Two providers disagreeing is indistinguishable from one being wrong. | §11.5 `ratings[]` |
| **D18** | **Crew.** `ActorData` is cast-only. | No director, writer, composer, studio, production company, network. | §11.6 `people[]` with `department`/`job` |
| **D19** | **Titles.** No original title, no alternates, no transliterations (except anime's `engName`/`japName`/`synonyms`). | Non-English catalogues render one arbitrary title. Deduplication across providers is worse than it needs to be. | §11.3 `titles` |
| **D20** | **Typed artwork.** One `posterUrl`, one `backgroundPosterUrl`, one `logoUrl`. No fanart set, no season posters, no episode stills beyond `Episode.posterUrl`, no clearart/banner, no language or dimensions. | No gallery; no way to pick a 4K backdrop over a 300 px one; no way to prefer a textless backdrop. | §18 |
| **D21** | **Chapters, collections, countries, keywords-vs-tags, per-source audio languages, structured external ids.** `syncData` is `Map<String,String>`; `AudioFile` has **no language**. | Skip-intro impossible; "part of a collection" impossible; a Hindi dub arrives as "Audio 2". | §11.4, §11.7, §11.9, §12.4 |

**Two of these have already cost us.** `AudioFile` having no language is why an audio-track
picker cannot label its own entries. And the absence of declared codec/HDR/expiry on
`ExtractorLink` is why we spend 1.6–1.7 s per source on ffprobe `[measured]` and why
`sourceCache` reverse-engineers deadlines out of URL query strings `[measured]`.

### 4.6 What Android gets *right*, and we must not lose

A gap analysis that only lists faults produces a redesign that breaks what worked. These are
load-bearing and are preserved verbatim in §10:

1. **Everything optional.** No abstract members. A catalogue with no `loadLinks` is not broken.
2. **Push-shaped link resolution.** Results arrive as they resolve.
3. **Provider-declared timeouts and politeness delays.** The scraper knows its own site.
4. **`MetaProvider` vs `DirectProvider`.** Catalogue and scraper are different things.
5. **Shared extractors.** One Voe implementation serving twenty providers is the reason the
   corpus keeps up with file hosts. Keep the idea; fix the dispatch (D15).
6. **A trivially small manifest.** Four fields is too few, but forty would be worse. §9.2 lands
   at eleven required.
7. **No gatekeeper.** Anyone can publish. Signing must not become review.
8. **`Score`'s precision design.** Fixed-point, scale-on-read, `null` below a floor so a
   default never renders as `0.0/10.0`. §11.5 keeps that and adds provenance around it.

---

## 5. Vision, principles and non-goals

### 5.1 Vision

> A desktop application that is a **runtime for community-authored media providers**, where
> writing a provider takes an afternoon, publishing it takes a `git push`, installing it takes
> one click, and the user can see exactly whose code is running, what it is allowed to touch,
> and whether it is working.

### 5.2 Principles

**P1 — One contract, many lanes.** The host knows `Provider` and `Source`. It does not care
whether the implementation is Kotlin, TypeScript, a remote HTTP service or a yt-dlp rule.
Anything that leaks a lane into the rest of the app is a design failure.

**P2 — The archive is authoritative about itself.** An index is a cache. Where they disagree,
the artifact wins and the disagreement is *reported*, not resolved silently (D5).

**P3 — Declarations are hints; measurements are facts.** A provider may declare codec,
container, HDR, expiry. The host may skip work because of a declaration. The host never
*contradicts a measurement* with one. This is INV-RACE-3 generalised: `-c:v copy` never runs on
unverified codec info, and a manifest saying "H.264" is not verification.

**P4 — A failure is a diagnosis, never an empty array.** Already in force `[measured]`:
`loadLinksDetailed` carries a `SourceDiagnosis` beside the empty list, because one sentence was
covering a timeout, a thrown extractor, a blocked host, and a title that genuinely has nothing.
The SDK makes this the *only* way to fail.

**P5 — Capability is declared, never assumed.** From `externalPlayerControl` `[measured]`: a
seek bar that silently does nothing is worse than one the viewer was told about. Extensions
declare capabilities; the host declares its own back (§12.7).

**P6 — Nothing is silently punitive.** From `providerRanking` `[measured]`: `empty ≠ failure`;
rates smooth toward a neutral prior; a criterion with no data is excluded from the denominator,
never scored zero; nothing is ever auto-*disabled*. A new extension starts mid-table and cannot
be buried by one unlucky first call.

**P7 — The enforcement point is singular.** The adult gate, the enable cascade and (now) the
permission check each have exactly one implementation that every consumer funnels through.
Filtering at each call site is five places to forget.

**P8 — Backwards compatibility is not negotiable.** Doc 31's drop-in commitment stands: the
existing `.cs3` corpus keeps working, and no extension maintainer is asked to do anything. Every
lane after L0 is opt-in for the author and invisible to the user.

**P9 — Measure before building.** This repository's own history: counting the log turned 113
load failures into six missing classes; counting again said the class problem was closed, which
is why effort went to the WebView instead of a seventh round of shims. §23.5 gates each
milestone on a measurement, not on a date.

### 5.3 Non-goals

- **Not a store.** No review queue, no curation gate, no revenue. Signing proves *who*, never
  *good*.
- **Not a security boundary against a determined author for L0/L1.** JVM lanes get process
  isolation and a classloader boundary — real, and not a sandbox. Only L2 gets a capability
  sandbox, and the UI must say which is which (§14.6).
- **Not a hosting service.** Repositories live on the operator's infrastructure. We publish a
  spec, a CLI and a validator.
- **Not a fork of the Android standard.** We *read* it (L0/L1) and we never diverge those two
  lanes. CSX-EXT is a new, parallel thing.
- **Not a content index.** The platform finds nothing. Providers do.

---

## 6. Platform architecture: five lanes, one contract

### 6.1 The shape

```
┌──────────────────────────── RENDERER ────────────────────────────────────────┐
│  Extensions screen · Repository manager · Scope picker · Health · Provenance  │
└───────────────────────────────────┬──────────────────────────────────────────┘
                        preload.ts — allow-listed, typed
┌───────────────────────────────────┴──────────────────────────────────────────┐
│                            MAIN PROCESS                                       │
│  ┌──────────────────────────────────────────────────────────────────────┐    │
│  │ ExtensionPlatform                                                     │    │
│  │  RepositoryService · TrustStore · InstallService · UpdateService      │    │
│  │  ProviderRegistry  · ExtractorRegistry · CapabilityBroker · Telemetry │    │
│  └───┬─────────────┬─────────────┬──────────────┬────────────┬──────────┘    │
│      │             │             │              │            │                │
│   ┌──┴───┐     ┌───┴────┐    ┌───┴─────┐   ┌────┴─────┐  ┌───┴──────┐        │
│   │  L0  │     │   L1   │    │   L2    │   │    L3    │  │    L4    │        │
│   │ .cs3 │     │  .csj  │    │  .csx   │   │  addon   │  │  yt-dlp  │        │
│   └──┬───┘     └───┬────┘    └───┬─────┘   └────┬─────┘  └───┬──────┘        │
│      └──── JVM sidecar ────┘     │              │            │                │
│         (one process)     utility process   net.fetch    subprocess           │
│                           QuickJS-on-WASM                                     │
└───────────────────────────────────────────────────────────────────────────────┘
              every lane returns the same Provider / Source / MediaDetail
```

### 6.2 Lane comparison

| | L0 `.cs3` | L1 `.csj` | L2 `.csx` | L3 addon | L4 yt-dlp |
|---|---|---|---|---|---|
| Author writes | Kotlin (Android) | Kotlin/Java (JVM) | TypeScript | anything, hosted | a JSON rule |
| Artifact | ZIP + DEX | plain JAR | ZIP + JS bundle | a URL | a JSON fragment |
| Translation | dex2jar + repair | **none** | none | none | none |
| Runs in | JVM sidecar | JVM sidecar | QuickJS in a utility process | the author's server | `yt-dlp` process |
| Isolation | process + classloader | process + classloader | **capability sandbox** | total (not our code) | process |
| Cold start | ~11 ms translate + JVM class loading | JVM class loading only | ~5 ms `[researched]` | one HTTP round trip | process spawn |
| Hot reload | no | no | **yes** | n/a | yes |
| Trust model | signature + tier | signature + tier | signature + capabilities | URL + TLS | rule review |
| Status | **works** `[measured]` | **days** | the project | ~1 week | ~1 week |
| Best for | the 400-archive corpus | upstream authors who opt in | new providers, ports | aggregators, debrid, catalogues, IPTV | ~1,800 sites we would otherwise hand-write |

### 6.3 Why L1 exists, and why it is first

Because it is nearly free and it retires real defects (§2.9). Concretely:

1. `plugins.json` **already carries** `jarUrl`/`jarHash`/`jarFileSize` `[researched]`. Reading
   three fields we currently ignore is the whole discovery story.
2. Install becomes: download, verify hash, **stop**. No `DexTranslator`, no `KotlinNameRepair`,
   no translation cache, no nonce, no generation-keyed invalidation.
3. `PluginClassLoader`, `LinkageAnalyzer`, `PluginHost` and the whole bridge are unchanged —
   a jar is what the translator was *producing*. We are skipping a step, not adding a path.
4. `jdeps`-verified absence of `android.*` means the android shim is not needed for this
   archive, so `T4_BLOCKED` for a missing `android.` class becomes structurally impossible.

**And it is a lever on the community.** Today `isCrossPlatform` has no consumer, so setting it
buys an author nothing. If the desktop app loads `.csj` faster, more reliably and with a green
badge saying so, setting it buys them desktop users. That is the cheapest possible way to make
the upstream ecosystem *more* portable, and it costs us a feature flag rather than a fork.

**The honest caveat, repeated because it will otherwise be overclaimed:** `jdeps` flags
`android.*` only. A cross-platform jar can still reach `:app` types (`Plugin`, `DataStore`,
`CloudflareKiller`, `syncproviders`) that our bridge supplies. `LinkageAnalyzer` still runs;
tiers still apply. L1 removes the *bytecode* problem, not the *classpath* problem.

### 6.4 Why L2 is the standard rather than L1

L1 is a lane, not a standard — it is upstream's standard with the DEX step removed, and its
ceiling is upstream's design (integer versions, no permissions, no signing, cast-only metadata,
D1–D21). Our own standard needs to be authored *by us*, and TypeScript is the correct language
for it for four reasons:

1. **The host is TypeScript.** One type definition file is shared by the SDK, the main process
   and the renderer — exactly as `src/types/` is imported by both sides today `[measured]`.
2. **No toolchain.** No Android SDK, no JDK, no Gradle, no `aapt2`, no emulator. `npm create`
   and an editor.
3. **A capability sandbox is achievable.** QuickJS-on-WASM gives a hard timeout, a memory cap
   and an interrupt handler as primitives `[researched]`, and the host brokers all I/O. That is
   what makes a permission manifest *enforceable* rather than advisory.
4. **Hot reload is possible.** A file watcher swaps a bundle in ~5 ms. An author edits a
   selector and re-runs a search without restarting anything.

**Why QuickJS and not a V8 isolate or a `utilityProcess` with `vm`:** `vm` is not a security
boundary and never has been; V8 isolates in Electron are not separately resource-limited and a
runaway loop takes the process with it. QuickJS-on-WASM is slower per operation and the workload
is I/O-bound scraping, so the difference does not reach the user. Scrapers wait on sockets.

### 6.5 Why L3 (Stremio-compatible addon URLs) is worth a week

Because it is the one lane where **we write no code that can break**. An addon is a remote HTTP
service with a manifest; we call it and map the answer. It is the right lane for anything with
a backend — debrid services, aggregators, IPTV playlist managers, private catalogues — and for
authors who already ship a Stremio addon and would otherwise have to port it.

It also carries a capability-negotiation idea worth stealing outright: Stremio streams declare
`notWebReady`, meaning "this needs a real player". Generalised, that is exactly our
`media:prepare` decision input (§12.7).

### 6.6 Why L4 (yt-dlp rules) is worth a week

`yt-dlp` already handles roughly 1,800 sites. We **already ship it** for downloads `[measured]`,
and it is already the one binary whose *downloaded* copy is preferred over the bundled one,
because its extractors break weekly and a newer copy is better `[measured]`.

An L4 extension is a JSON rule — host patterns, search URL template, a metadata mapping — with
no code. That makes it reviewable by reading, and it makes "add support for site X" a
pull request a non-programmer can write.

### 6.7 The one contract

Every lane produces these, and nothing downstream can tell which lane produced them:

```ts
interface Provider { /* §10 */ }
interface Source { /* §12 */ }
interface MediaDetail { /* §11 */ }
interface SearchResult { /* §11.2 */ }
```

The registry stores, per provider: `id`, `lane`, `extensionId`, `repositoryId`, `trust`,
`capabilities`, `health`. `lane` and `trust` reach the UI (a user is entitled to know that a
provider is a remote service, or unsandboxed). Nothing else in the app branches on lane.

---

## 7. CSX-REPO: the repository specification

`[proposed]` throughout. Design rule: **a valid Android `repo.json` + `plugins.json` pair is a
valid CSX repository at schema 0.** Every field we add is additive, and a CSX-aware client
reading an Android repository degrades to exactly today's behaviour with `trust: "unverified"`.

### 7.1 Two documents, one relationship

```
repository.json          the operator's identity, keys, policy, and the list of indexes
   └── index.json …      one or more extension indexes (may be split by channel/category)
```

Split for the same reason upstream splits `repo.json` from `pluginLists`: the repository
document is small, changes rarely and is what a client pins trust against; indexes are large,
change on every publish, and are what CI regenerates.

### 7.2 `repository.json`

```jsonc
{
  "$schema": "https://cs3desktop.org/schema/repository-1.json",
  "schemaVersion": 1,

  "id": "org.example.movies",         // reverse-DNS, immutable, the trust anchor's name
  "name": "Example Movies",
  "description": "Community scrapers for European streaming sites.",
  "homepage": "https://github.com/example/movies",
  "iconUrl": "https://…/icon.png",
  "contact": { "issues": "https://github.com/example/movies/issues", "matrix": "#example:matrix.org" },
  "license": "GPL-3.0-or-later",

  // ── trust ───────────────────────────────────────────────────────────────────
  "publicKeys": [
    { "id": "primary-2026", "algorithm": "ed25519",
      "key": "RWQf6LRCGA9i53…", "createdAt": "2026-01-04T00:00:00Z" }
  ],
  "signature": {                       // detached, over the canonical form of this document
    "keyId": "primary-2026",
    "algorithm": "ed25519",
    "value": "…"
  },
  "revoked": [                         // §8.7
    { "extensionId": "com.example.dead", "versionCode": 41,
      "reason": "credential exfiltration", "at": "2026-07-02T09:00:00Z" }
  ],

  // ── policy ──────────────────────────────────────────────────────────────────
  "minAppVersion": "1.2.0",
  "channels": ["stable", "beta", "nightly"],
  "defaultChannel": "stable",
  "categories": ["movies", "tv", "europe"],
  "languages": ["en", "de", "fr"],
  "nsfw": false,                       // repository-level declaration; §14.5

  // ── indexes ─────────────────────────────────────────────────────────────────
  "indexes": [
    { "url": "index.json",        "channel": "stable"  },
    { "url": "index-beta.json",   "channel": "beta"    },
    { "url": "index-nightly.json","channel": "nightly" }
  ],

  // ── back-compat: an Android client reads these and ignores everything above ──
  "manifestVersion": 1,
  "pluginLists": ["plugins.json"]
}
```

Notes on the parts that are not obvious:

- **`id` is the trust anchor's name, and it is immutable.** Trust is pinned to
  `(id, publicKey)`. Renaming the display `name` is free; changing `id` is a new repository, by
  definition, and the user is told so.
- **Index URLs may be relative**, resolved against the repository document's *final* URL after
  redirects. Same rule as HLS playlist rewriting in `mediaProxy` `[measured]`, and for the same
  reason — a repository reached via a redirect must still resolve its own children.
- **`channels` is a declared enum, not free text**, so the picker can offer it and a typo in CI
  fails validation instead of silently creating a fourth channel nobody can select.
- **`pluginLists` and `manifestVersion` are kept**, so one document serves both ecosystems. An
  operator publishing for Android and desktop maintains one file.

### 7.3 `index.json`

Where Android publishes a bare array, we publish an envelope. The envelope is what carries the
signature, the generation time and the schema — a bare array has nowhere to put them.

```jsonc
{
  "$schema": "https://cs3desktop.org/schema/index-1.json",
  "schemaVersion": 1,
  "repositoryId": "org.example.movies",   // must match repository.json; a mismatch is refused
  "channel": "stable",
  "generatedAt": "2026-08-27T11:02:00Z",
  "signature": { "keyId": "primary-2026", "algorithm": "ed25519", "value": "…" },

  "extensions": [
    {
      "id": "com.example.kinox",           // reverse-DNS, immutable, globally unique
      "internalName": "Kinox",             // legacy alias; Android reads this
      "name": "Kinox",
      "description": "German movie and series scraper.",
      "authors": [{ "name": "someone", "url": "https://github.com/someone" }],
      "iconUrl": "https://…/kinox.png",
      "homepage": "https://github.com/example/movies/tree/main/Kinox",
      "changelogUrl": "https://…/Kinox/CHANGELOG.md",
      "license": "GPL-3.0-or-later",

      "version": "1.4.2",                  // semver, display + range matching
      "versionCode": 10402,                // monotonic integer; the update trigger
      "sdk": ">=1.2 <2.0",                 // semver RANGE against CSX-SDK — §9.5
      "minAppVersion": "1.2.0",
      "channel": "stable",

      "artifacts": [                       // ordered by host preference; first supported wins
        { "kind": "csx",  "url": "Kinox-1.4.2.csx", "size": 48213,
          "hash": "sha256-9f2c…", "signature": "…" },
        { "kind": "csj",  "url": "Kinox-1.4.2.jar", "size": 194003,
          "hash": "sha256-11ab…", "signature": "…" },
        { "kind": "cs3",  "url": "Kinox.cs3",       "size": 210447,
          "hash": "sha256-77de…" }
      ],

      "capabilities": {                    // MUST equal the bundle manifest — §9.7, D5
        "network": { "hosts": ["kinox.to", "*.kinox.to", "*.voe.sx"] },
        "webview": false, "storage": true, "settings": true, "ytdlp": false
      },

      "providers": [
        { "id": "com.example.kinox/Kinox", "name": "Kinox",
          "types": ["Movie", "TvSeries"], "languages": ["de"],
          "kind": "direct", "nsfw": false, "mainUrl": "https://kinox.to" }
      ],
      "extractors": [
        { "name": "Voe", "hosts": ["voe.sx", "*.voe.sx"], "priority": 50 }
      ],

      "requires": [                        // §9.6
        { "id": "com.example.commonextractors", "range": ">=2.1 <3.0", "optional": true }
      ],

      "health": { "status": "ok", "checkedAt": "2026-08-27T06:00:00Z" },
      "tvTypes": ["Movie", "TvSeries"],    // legacy alias for Android
      "language": "de",                    // legacy alias
      "status": 1                          // legacy alias
    }
  ]
}
```

The four decisions that carry this schema:

- **`artifacts[]` replaces `url` + `jarUrl`.** Upstream needed a second pair of fields to add a
  second artifact kind (`jarUrl`/`jarHash`/`jarFileSize`), and would need a third pair for a
  fourth. A list with a `kind` is open-ended, and the host picks the **first entry whose kind it
  supports** — so an operator expresses preference by ordering, and an old client that only
  knows `cs3` still finds one.
- **`hash` is required on every artifact** (D2). No hash, no install, and the reason names the
  entry.
- **`capabilities` is duplicated here and in the bundle manifest, deliberately.** The index copy
  exists so the *install prompt* can show what a plugin wants **before it is downloaded**. The
  bundle copy is authoritative (P2). A disagreement is a hard refusal naming both values —
  because a mismatch is either a broken pipeline or an attempt to under-declare at the prompt
  and over-reach at runtime, and both should stop.
- **Legacy aliases are emitted, not translated.** `internalName`, `tvTypes`, `language`,
  `status`. One document, two ecosystems, no adapter.

### 7.4 Channels and health are orthogonal

Android's `status` integer conflates them: `0 down, 1 ok, 2 slow, 3 beta` `[researched]`. But
"beta" and "down" are answers to different questions, and a beta extension that works fine
cannot say so.

| Axis | Values | Who sets it | Changes |
|---|---|---|---|
| `channel` | `stable` / `beta` / `nightly` | the **author**, at publish | at release |
| `health.status` | `ok` / `slow` / `degraded` / `down` | the **operator**, or CI | continuously |

A user subscribes to a repository *at a channel*. `stable` is the default and never shows a
nightly build. Health is advisory and never hides an extension — the user's own
`providerAnalytics` numbers outrank a repository's opinion, because they were measured on this
machine `[measured]`.

### 7.5 Repository kinds

All five resolve to the same two documents. Only *acquisition* differs.

| Kind | Example | Notes |
|---|---|---|
| **Remote HTTPS** | `https://example.org/repository.json` | The canonical form. |
| **Git forge shorthand** | `github:example/movies`, `codeberg:x/y`, `gitlab:x/y` | Resolved to raw URLs. Upstream's `setRepo` already supports **github, gitlab, codeberg, `gitlab-<domain>`, `gitea-<domain>`** `[researched]`; we match that list exactly so an author's existing `setRepo` line is enough. |
| **Local directory** | `file:///D:/dev/my-repo` | The development loop. Watched; a change re-reads the index. |
| **Bundled archive** | a `.csrepo` ZIP | Air-gapped and enterprise installs. Same documents, one file, signed as a whole. |
| **Private / authenticated** | any of the above + credentials | §7.6 |

**Project-page probing is retained but demoted.** Our `pluginManager` probes branch/filename
combinations because there is no convention `[measured]`. That heuristic stays for Android
repositories and is **not** part of CSX: a CSX repository URL points at `repository.json` or at
a directory containing it. Probing is a compatibility behaviour, not a specification.

### 7.6 Private, enterprise and local repositories

Three distinct needs, one mechanism:

```jsonc
{ "url": "https://internal.corp/cs3/repository.json",
  "auth": { "kind": "bearer", "credentialRef": "corp-token" } }
```

- `auth.kind`: `none` | `bearer` | `basic` | `header`.
- **Credentials never enter the repository record.** `credentialRef` names an entry in the OS
  credential store; the record holds the *name*. This is the same rule
  `DatastoreManager.snapshot` already enforces on the way out — tokens and device ids are
  filtered so they are never written into a backup file in someone's Downloads folder
  `[measured]`. A repository list is exactly that kind of exportable document.
- **Authenticated requests are made only to the repository's own origin.** A redirect
  cross-origin drops the header. Otherwise a compromised index redirects the artifact fetch and
  harvests the bearer token.
- **Enterprise pinning.** A managed install may ship a policy file that pins
  `(repositoryId, publicKey)` and forbids adding others. That is the whole enterprise story:
  same format, key pinned by policy instead of by first use.

### 7.7 Discovery, categories and "featured"

A curated list ships with the app (`officialRepositories.ts` already exists `[measured]`) and is
**data, not code** — a signed JSON document fetched on a schedule with the bundled copy as
fallback, so a newly-published repository does not wait for an app release.

Rules that keep this from becoming a store:

- **`featured` is editorial and is labelled as editorial.** It means "we ran
  `provider-e2e.mjs` against this and it worked" — the same claim `bundled: true` makes today
  `[measured]` — and the UI says so in those words.
- **Nothing is hidden for being unlisted.** Adding a URL by hand is a first-class path and is
  never harder than picking from the list.
- **Categories and languages are declared by the operator and counted by the client.** Same rule
  as the extensions screen: OR within a facet, AND across facets; a facet with nothing behind it
  is not offered `[measured]`.

### 7.8 Client behaviour

| Step | Rule |
|---|---|
| Fetch | ETag / `If-Modified-Since`. Index documents change on every publish; the repository document rarely does. |
| Verify | Signature over the canonical form (§8.3), then `repositoryId` match, then `schemaVersion` support. |
| Refresh | Repository doc daily; indexes on the update schedule; both on user request. |
| Failure | Serve the last good copy **and say it is stale, with its age**. A repository that 404s must not empty the user's extension list. |
| Unknown fields | Preserved on round-trip, ignored on read. Forward compatibility is free if nothing strips. |
| Unknown `schemaVersion` | Refuse the document with a message naming which side is old (§9.5's rule, applied to repositories). |

---

## 8. Trust: signing, pinning, revocation

`[proposed]`. This section answers D1–D4 and is the largest single improvement over the Android
standard.

### 8.1 The threat this closes

Android's chain is: *the index says the artifact at URL U has hash H; download U; check H.*
Both facts come from one document, so **whoever controls the index controls both**. A GitHub
account compromise, an expired domain re-registered, a malicious maintainer added to an org —
each rewrites URL and hash together, and every client installs the replacement silently, because
the check passes.

The signature chain is: *the artifact is signed by key K; this repository was pinned to K on
first install; a different key is refused by name.* An index rewrite no longer suffices; the
attacker needs K, and K is not in the repository.

### 8.2 Primitives

| | Choice | Why |
|---|---|---|
| Algorithm | **ed25519** | Small keys (32 B) and signatures (64 B), no parameter choices to get wrong, no curve negotiation. |
| Format | **minisign-compatible** detached signatures | An existing, audited CLI already in package managers, so an author is not required to trust *our* signing tool with their key. `[researched]` |
| Hash | SHA-256, published `sha256-<hex>` | Matches upstream, so one document serves both. Strip the prefix before comparing `[measured]`. |
| Key storage (client) | the datastore, under a non-transferable key prefix | Pinned keys are machine trust decisions and must not travel in a backup — same filter that drops tokens `[measured]`. |
| Key storage (author) | never ours | We publish a public key; the private key stays with the author or in a CI secret. |

### 8.3 What is signed

Three levels. Each is independently verifiable, and a client may enforce any prefix of them.

1. **The artifact.** Detached signature over the file's bytes, in `artifacts[].signature`.
   This is the one that matters — it binds *code* to *key*.
2. **The index.** Detached signature over the canonical form of `index.json` minus its own
   `signature` field. Prevents entry removal, downgrade and revocation-stripping.
3. **The repository document.** Same, and it is the root: it carries `publicKeys` and `revoked`.

**Canonical form** is JCS (RFC 8785) — sorted keys, no insignificant whitespace, fixed number
formatting. Signing pretty-printed JSON means a reformat breaks the signature, and CI reformats.

### 8.4 Trust states

Presented to the user, and each is a different sentence:

| State | Meaning | UI |
|---|---|---|
| `pinned` | Signed by the key recorded at first install. | ✓ verified, key fingerprint on the provenance panel |
| `unsigned` | No signature. An Android repository, or a CSX one that has not opted in. | ⚠ "not signed — integrity checked by hash only" |
| `unpinned` | Signed, but this is first contact. | Prompt showing the fingerprint; accepting pins it |
| `mismatch` | Signed by a key that is **not** the pinned one. | **Refuse.** Name both fingerprints. Never auto-accept. |
| `revoked` | Listed in `revoked[]`, or the key is. | **Refuse**, disable the installed copy, say why |

`unsigned` is not a failure. Refusing unsigned repositories would break the entire existing
corpus and violate P8. It is a *label*, and the label is the pressure that makes signing spread.

### 8.5 Key rotation

The hard part, and the reason `publicKeys` is an array.

- A repository may list several keys. Any listed key may sign an artifact.
- A **new** key is accepted only if the repository document introducing it is signed by an
  **already-pinned** key. That is the whole rotation protocol: an operator adds the new key,
  signs with the old, publishes; clients pin the new one; the old is dropped later.
- If every key is lost, rotation is impossible by design, and the operator must publish a new
  repository `id`. The client shows this as **a new repository, not an update** — because that
  is what it is, and pretending otherwise is the exact hole signing exists to close.
- Losing your keys is therefore expensive. §20.6's CLI generates a **revocation certificate at
  key-creation time** and tells the author to store it separately, which is the only affordance
  that helps after the fact.

### 8.6 Publisher identity

`authors[]` becomes structured (`{name, url}`) but is still **display metadata and is labelled
as such**. Identity is the *key*, not the string. The provenance panel shows the fingerprint and
its first-seen date; "this is the same publisher as last time" is a statement about the key.

We deliberately do **not** build a web of trust, a keyserver or a verified-author badge. Every
one of those is a curation gate wearing a cryptography costume, and §5.3 says no.

### 8.7 Revocation

Three mechanisms, because each covers a different failure:

1. **`revoked[]` in the repository document** — the operator withdrawing their own artifact.
   Bounded by the operator still controlling their keys.
2. **A signed app-level denylist**, shipped like the curated repository list: `(extensionId,
   versionCode range, reason)`. This is the only mechanism that survives *repository* compromise.
   Deliberately narrow — it names specific malicious versions, never "extensions we dislike" —
   and every entry is visible in Settings with its reason. A silent kill switch would be a
   worse property than the problem it solves.
3. **Local refusal.** The user can permanently refuse an extension or a key. It is theirs.

A revoked extension is **disabled, not deleted**. The archive stays with a banner naming the
reason, because a user who has been running something malicious is entitled to see what it was,
and silent disappearance is indistinguishable from a bug.

---

## 9. CSX-EXT: the extension specification

`[proposed]`. This is the `.csx` bundle — lane L2, our own standard. L0/L1 artifacts are
described by the same *index* entry (§7.3) but keep their own internal formats unchanged (P8).

### 9.1 The bundle

A ZIP with a fixed layout. `.csx` so it is recognisable, and because associating an extension
format with `.zip` invites double-click accidents.

```
MyProvider-1.4.2.csx
├── manifest.json          required — the authority on this extension (§9.2)
├── main.js                required — one ESM bundle, no imports the host does not provide
├── main.js.map            optional — enables real stack traces in diagnostics
├── settings.json          optional — typed user-facing settings schema (§9.8)
├── icon.png               optional — 128×128
├── CHANGELOG.md           optional — rendered in the update dialog
├── LICENSE                optional
└── fixtures/              optional — recorded HTTP for offline tests (§20.4)
    └── search-dune.har
```

Rules:

- **One bundle, no module resolution.** The author's bundler flattens dependencies. The runtime
  has no `require`, no `import`, no `node_modules`, no network module loading. A plugin that
  fetches code at runtime defeats every signature in §8.
- **Deterministic ZIP.** Fixed timestamps, sorted entries, no extra attributes — so the same
  source produces the same hash on any machine and a signature is reproducible. Upstream already
  does the timestamp half (`isPreserveFileTimestamps = false`) `[researched]`.
- **Size ceiling: 8 MB**, refused above. A scraper is text. A large bundle is either vendored
  binary data or a mistake, and both deserve a question.

### 9.2 `manifest.json` — the authoritative record

Eleven required fields (Android has four; §4.6 point 6 argues against forty).

```jsonc
{
  "schemaVersion": 1,                       // R
  "id": "com.example.kinox",                // R  reverse-DNS, immutable, globally unique
  "name": "Kinox",                          // R  display
  "version": "1.4.2",                       // R  semver
  "versionCode": 10402,                     // R  monotonic integer
  "sdk": ">=1.2 <2.0",                      // R  semver range against CSX-SDK
  "entry": "main.js",                       // R
  "license": "GPL-3.0-or-later",            // R  SPDX
  "authors": [{ "name": "someone", "url": "https://github.com/someone" }],   // R
  "capabilities": { … },                    // R  may be {} — but must be present (§9.7)
  "providers": [ … ],                       // R  may be [] for an extractor-only bundle

  // optional
  "description": "German movie and series scraper.",
  "languages": ["de"],                      // BCP-47, or ["multi"]
  "types": ["Movie", "TvSeries"],           // MediaType[]; drives the facet filters we have
  "nsfw": false,
  "minAppVersion": "1.2.0",
  "platforms": ["win32", "darwin", "linux"],// default: all
  "extractors": [ … ],                      // §10.5
  "requires": [ … ],                        // §9.6
  "settings": "settings.json",
  "icon": "icon.png",
  "homepage": "…", "changelog": "CHANGELOG.md"
}
```

Two things this fixes that are worth naming:

- **D5.** The manifest is authoritative. The index entry is a *cache* of it so the install
  prompt can be drawn before download. On mismatch: refuse, name the field, name both values.
- **`capabilities` is required even when empty.** An absent block would be indistinguishable
  between "declares nothing" and "written before capabilities existed", and the second must not
  silently mean "allow everything". `{}` means *no capabilities*, and a provider that declares
  `{}` and then calls `ctx.http` fails with a message naming the missing declaration.

**`providers: []` is legal and is not an error.** Extractor-only bundles are a real and common
shape, and our `providerRegistry` already records the empty case specifically so those archives
do not pay a full JVM load every launch forever `[measured]`.

### 9.3 An `id` is not a `name`

| Field | Scope | Mutable | Used for |
|---|---|---|---|
| `id` | global | **never** | install identity, updates, dependencies, trust pinning, storage namespace |
| `name` | display | freely | UI |
| `providers[].id` | global | never | `csx://<providerId>/…` addressing, scope selection, analytics, memory |
| `providers[].name` | display | freely | UI |

This answers D6 and D7. Today a provider name is globally unique *by construction* — it is a
`Map` key — so two extensions claiming one name is a real collision that our code already
handles by letting the first win and reporting the loser via `unavailableReason` `[measured]`.
With namespaced ids that collision stops existing: both providers load, both are addressable,
and the UI disambiguates by extension. **A display-name clash becomes a labelling problem
rather than a data-loss one.**

Migration is mechanical: `cs3ext://<name>/<handle>` remains valid and resolves through the
existing name→provider map; `csx://<providerId>/<handle>` is the new form. `extensionAddress.ts`
already owns address parsing and already distinguishes a page address from a links blob
`[measured]`, so this is one more discrimination in a module built for it.

### 9.4 Versioning

Both, and they do different jobs:

| Field | Type | Job |
|---|---|---|
| `version` | semver `1.4.2` | Display, changelogs, range matching, human meaning |
| `versionCode` | monotonic int `10402` | The **update trigger**, and the ordering |

Why both, when semver can be ordered? Because prerelease ordering is where semver comparators
disagree in practice, and an update decision must be **unambiguous** and **cheap** — an integer
comparison, which is what upstream chose and got right `[researched]`. `versionCode` is also
what the legacy `version` alias in the index carries, so an Android client sees a plain integer
and behaves exactly as it does today.

Convention (enforced by the CLI, not by the format): `major*10000 + minor*100 + patch`.

Prerelease versions use semver's own syntax — `1.5.0-beta.2` — and are offered only on a channel
that permits them (§7.4).

### 9.5 SDK compatibility is a range (D9, D10)

```jsonc
"sdk": ">=1.2 <2.0"
```

The host declares an SDK version (`1.4.0`); the extension declares the range it works against.
Three outcomes, and **the message is different in each direction**, because the user action is
different:

| Result | Message |
|---|---|
| in range | install |
| host **below** range | *"Kinox needs CloudStream Desktop 1.5 or newer. Update the app."* |
| host **above** range | *"Kinox was built for an older version and has not been updated. Ask the author, or install 1.3.x."* |

This is the whole reason a range beats a floor (D10). A floor can only ever produce the first
message, so an extension that broke at SDK 2.0 must either lie or be withdrawn.

**Deprecation policy** (inherits doc 27 PLG-V-3): breaking changes bump the SDK major and are
announced **one minor release ahead**, with the deprecated surface still working and emitting a
diagnostic naming the replacement. A major is cut no more than once a year. The SDK ships a
`csx-sdk` type package versioned in lockstep, so an author's editor tells them before their
users do.

### 9.6 Dependencies (D11)

Android has none, and the shared-extractor pattern (§2.7) is dependency management implemented
as a global list plus load-order luck. We declare it:

```jsonc
"requires": [
  { "id": "com.example.commonextractors", "range": ">=2.1 <3.0", "optional": true }
]
```

Deliberately weak, because a full solver is the wrong tool here:

- **Resolution is same-repository first, then any installed repository.** No transitive fetch
  from arbitrary URLs — that would let a dependency edge pull code from a repository the user
  never trusted, which is a supply-chain hole dressed as a convenience.
- **No version unification.** Two extensions needing different majors of one dependency get
  their own copies. Disk is cheap; a solver's failure modes are not, and "could not satisfy
  constraints" is a terrible thing to show someone installing a movie scraper.
- **`optional: true` is the common case** and is what the shared-extractor pattern actually
  wants: *"if CommonExtractors is present, its Voe handler will serve me; if not, I have my
  own."* An unmet optional dependency is a note on the row, never a refusal.
- **Missing required dependency** → install offers to add it, naming its repository and trust
  state. Declining leaves the extension installed and disabled with the reason on the row —
  never half-installed.
- **Cycles are refused at validation time**, by the CLI and again by the host.

### 9.7 The permission model (D13)

```jsonc
"capabilities": {
  "network": {
    "hosts": ["kinox.to", "*.kinox.to", "*.voe.sx"],
    "methods": ["GET", "POST"],
    "maxConcurrent": 6,
    "maxRequestsPerMinute": 120
  },
  "webview": { "hosts": ["kinox.to"], "reason": "Cloudflare challenge" },
  "storage": { "quotaBytes": 262144 },
  "settings": true,
  "ytdlp": false,
  "impersonate": "chrome",
  "subprocess": false          // reserved; always refused in v1
}
```

Rules that make this mean something rather than decorate the manifest:

1. **Enforced in the broker, not the sandbox.** The sandbox has no socket. Every request crosses
   into the host, and the host matches the host-name against the allow-list before a connection
   is opened. A plugin cannot reach a host it did not declare, whatever its code says.
2. **Wildcards are one label deep.** `*.example.com` matches `cdn.example.com`, not
   `a.b.example.com`, and never bare `example.com` — declare both if both are used. `*` alone is
   **refused at validation**: an allow-list that allows everything is not one.
3. **Redirects are re-checked.** A 302 to an undeclared host fails the request with a named
   reason. Otherwise the allow-list is one redirect deep.
4. **`webview` is user-visible and is the highest-privilege capability**, because it runs real
   page JavaScript with a real cookie jar. It is gated, rate-limited, and shown in the install
   prompt in its own sentence (§14.3).
5. **Violations are recorded, not just refused.** An undeclared host reaches
   `extensionIssues.ts` as its own `FailureKind` (`capability-violation`) with the host named.
   Three properties follow: a *broken* extension is diagnosable, a *hostile* one is visible, and
   an author gets a precise message instead of a mystery empty result.
6. **Widening capabilities requires consent on update** (§9.9).
7. **Not scored.** `capability-violation` does not feed `providerRanking`, for the same reason
   `provider-missing` and `cancelled` do not `[measured]`: it is a fault of the manifest, not
   evidence about the site's quality.

### 9.8 Extension settings

`settings.json` is a typed schema; the host renders the form. The extension never draws UI —
which is what the entire androidx UI shim exists to survive on Android, where a settings screen
and a scraper ship in one archive and the UI half drags in `AppCompatActivity`, `DialogFragment`
and `FragmentManager` `[measured]`.

```jsonc
{
  "schemaVersion": 1,
  "groups": [{
    "title": "Account",
    "fields": [
      { "key": "domain", "type": "string", "label": "Mirror domain",
        "default": "kinox.to", "pattern": "^[a-z0-9.-]+$" },
      { "key": "quality", "type": "enum", "label": "Preferred quality",
        "options": [{"value":"2160","label":"4K"},{"value":"1080","label":"1080p"}],
        "default": "1080" },
      { "key": "token", "type": "secret", "label": "API token" },
      { "key": "dub", "type": "boolean", "label": "Prefer dubbed", "default": false }
    ]
  }]
}
```

Types: `string`, `secret`, `number`, `boolean`, `enum`, `multiselect`, `url`. Read through
`ctx.settings.get(key)`, typed.

**`secret` is stored in the OS credential store and is never returned to the sandbox as a
string.** The plugin gets a *handle* it can attach to a request; the broker substitutes the
value when the request leaves. This is the difference between "the extension can use your token"
and "the extension can read your token", and only the first is necessary. It also means a
`secret` never lands in a settings backup, a diagnostic report or a log line — three places our
own redaction already has to defend `[measured]`.

`domain` above is deliberately the example: overriding a mirror domain is upstream's
`canBeOverridden` / "clone site" feature `[researched]`, which is one of the most-used
affordances in the corpus and deserves to be a first-class typed setting rather than a
convention.

### 9.9 Lifecycle

```
discover → resolve artifact → verify hash → verify signature → pin/compare key
   → read manifest → validate → check sdk range → check dependencies
   → prompt (capabilities, trust, size) → install → activate → register
```

| Event | Behaviour |
|---|---|
| **Install** | Atomic. Staged in a temp directory, moved into place after every check passes. A failed install leaves nothing. |
| **Activate** | Lazily, on first use, deduped by an in-flight map — the fix for eight concurrent loads of one archive `[measured]`. Warm the rest in the background 4 s after the window opens `[measured]`. |
| **Enable / disable** | Disable stops execution and keeps the bundle; the disabled list stores **exceptions**, so a newly installed extension works without opting in `[measured]`. |
| **Update** | `versionCode` increase. Copy aside, install, **load**, restore the old bundle if it will not initialise. `T4_BLOCKED` is failure; `T3_DEGRADED` is not; a null report (sidecar unreachable) is not `[measured]`. |
| **Capability widening** | An update that adds a capability **requires consent**, showing exactly the delta. Narrowing is silent. This is where a hijacked extension would ask for the world, and it is the moment to make that visible. |
| **Rollback** | One generation kept; `extension:rollback` exposes it manually for the case a load check cannot see — links fine, scrapes nothing `[measured]`. |
| **Uninstall** | Removes bundle, storage and settings. Analytics and issue rows are **kept** and marked orphaned: "this provider used to work and is gone" is a useful thing to be able to say. |
| **Hot reload** | L2 only, dev mode only. Watch the bundle, tear down, re-instantiate, keep storage. ~5 ms `[researched]`. |

---

## 10. CSX-SDK: the provider contract

`[proposed]`. Shipped as `@cs3desktop/sdk` — types plus a thin runtime. Lives in
`cs3_windows/src/types/csx/` and is imported by `electron/` **and** `src/`, exactly as
`src/types/` is today `[measured]`.

### 10.1 The interface

Every method optional (§4.6 point 1). A provider implements what its site supports; the host
asks `capabilities` first and never calls what was not declared.

```ts
export interface Provider {
  // ── identity ─────────────────────────────────────────────────────────────
  readonly id: string;              // "com.example.kinox/Kinox" — namespaced, immutable
  readonly name: string;            // display
  readonly mainUrl?: string;
  readonly languages: string[];     // BCP-47 of the CONTENT, or ["multi"]
  readonly types: MediaType[];
  readonly kind: 'direct' | 'meta'; // upstream's DirectProvider / MetaProvider [researched]
  readonly nsfw?: boolean;

  // ── declared behaviour ───────────────────────────────────────────────────
  readonly capabilities: ProviderCapabilities;
  readonly policy?: ProviderPolicy;

  // ── lifecycle ────────────────────────────────────────────────────────────
  init?(ctx: HostContext): Promise<void> | void;
  dispose?(): Promise<void> | void;

  // ── content ──────────────────────────────────────────────────────────────
  catalog?(req: CatalogRequest, ctx: HostContext): Promise<CatalogPage>;
  search?(req: SearchRequest, ctx: HostContext): Promise<SearchPage>;
  quickSearch?(req: SearchRequest, ctx: HostContext): Promise<SearchResult[]>;
  load?(ref: MediaRef, ctx: HostContext): Promise<MediaDetail>;
  loadSources?(req: SourceRequest, emit: SourceEmitter, ctx: HostContext): Promise<SourceOutcome>;
  loadSubtitles?(req: SubtitleRequest, ctx: HostContext): Promise<SubtitleTrack[]>;
  loadChapters?(req: ChapterRequest, ctx: HostContext): Promise<Chapter[]>;
  resolveExternal?(id: ExternalId, ctx: HostContext): Promise<MediaRef | null>;
}

export interface ProviderCapabilities {
  catalog: boolean; search: boolean; quickSearch: boolean;
  pagination: boolean; sources: boolean; subtitles: boolean; chapters: boolean;
  externalIds: ExternalIdKind[];        // which ids it can resolve FROM — upstream's supportedSyncNames
  filters: FilterKind[];                // which SearchRequest filters it honours
  sourceKinds: SourceKind[];            // 'progressive' | 'hls' | 'dash' | 'torrent' | 'magnet' | 'live'
  instantSources?: boolean;             // upstream's instantLinkLoading — the link is in the ref [researched]
  downloadable?: boolean;               // upstream's hasDownloadSupport
}

export interface ProviderPolicy {
  timeouts?: { search?: number; quickSearch?: number; load?: number;
               sources?: number; catalog?: number };   // ms — hints, per upstream [researched]
  sequential?: boolean;                 // upstream's sequentialMainPage
  minRequestIntervalMs?: number;        // upstream's sequentialMainPageDelay
  maxConcurrent?: number;
  vpnHint?: 'none' | 'maybe' | 'torrent';   // upstream's VPNStatus
}
```

`ProviderPolicy` is a straight adoption of upstream's per-operation timeouts and politeness
delays (§2.6 points 3–4). They are the scraper telling the host how to be a good citizen on
someone else's site, and dropping them gets that provider's users rate-limited. `timeouts` are
hints — the host may shorten them, and says so in diagnostics when it does.

`capabilities.filters` is what makes §15's facet UI honest: a filter no provider honours is not
offered, and a filter *sent* to a provider that did not declare it is a bug in the host.

### 10.2 Providers are returned, not registered (D16)

```ts
export default function activate(ctx: ActivationContext): Provider[] { … }
```

One function, returning an array. That is the entire entry point, and it is deliberately
**not** upstream's `load()`-plus-`registerMainAPI()` side-effect shape.

The reason is D16 and it is `[measured]`: because registration mutates a process-global list
observed by a length mark, two concurrent loads cross-attribute — **176 providers assigned to
the wrong extension under 8 concurrent RPCs**. A return value cannot do that. There is no shared
list, no mark, no lock, and concurrency becomes free rather than dangerous.

L0 and L1 keep the registration shape, because they are upstream's contract and P8 forbids
changing it. `PluginHost.registrationLock` plus the in-flight dedupe map remain their fix
`[measured]`. The adapter turns observed registrations into a returned array at the sidecar
boundary, so **the host above that boundary only ever sees the safe shape.**

### 10.3 Search, and why it is a page

```ts
export interface SearchRequest {
  query: string;
  page?: number;                  // 1-based
  filters?: SearchFilters;
  signal: AbortSignal;
}

export interface SearchFilters {
  types?: MediaType[]; year?: { from?: number; to?: number };
  genres?: string[]; languages?: string[]; countries?: string[];
  minRating?: number; sort?: 'relevance' | 'popularity' | 'newest' | 'rating';
  quality?: QualityTier[];
}

export interface SearchPage {
  results: SearchResult[];
  hasMore: boolean;
  nextPage?: number;
  total?: number;
  diagnostic?: Diagnostic;        // present even on success — a partial answer says so
}
```

`hasMore` is separate from `results.length` because a provider that returns 20 of 400 and a
provider that returns 20 of 20 look identical otherwise, and infinite scroll needs to tell them
apart. Upstream added `SearchResponseList { items, hasNext }` for exactly this and made
`search(query, page)` the primary overload `[researched]`.

**`signal` is on every request.** Cancellation is not optional: fifteen scrapes are in flight
when the viewer types a new query, and the scope closing throws in every one. That produced
**79 cancellations counted as provider failures** before `cancelled` became its own
non-scored `FailureKind` `[measured]`. An SDK that makes the signal ambient makes the correct
behaviour the default one.

### 10.4 Sources are pushed (§4.6 point 2)

```ts
export type SourceEmitter = {
  source(s: Source): void;
  subtitle(s: SubtitleTrack): void;
  progress(p: { stage: string; done?: number; total?: number }): void;
};

export interface SourceRequest {
  ref: MediaRef;
  season?: number; episode?: number;
  preferred?: { quality?: number; languages?: string[] };
  signal: AbortSignal;
}

export type SourceOutcome =
  | { ok: true; complete: boolean }
  | { ok: false; diagnosis: Diagnosis };
```

Twenty mirrors resolve at wildly different speeds; the first playable one should reach the
player immediately. Our `playback:*` and `search:*` channels are already push-shaped for this
reason `[measured]`, so the SDK shape and the IPC shape agree end to end.

`complete: false` means "these are real, and there may be more" — the honest answer when a
provider hits its own timeout with results already in hand.

### 10.5 The extractor registry, done properly (D15)

Keep upstream's *idea* — one Voe implementation serving twenty providers — and replace the
dispatch, which is load-order-dependent with a Levenshtein tie-break (§2.7).

```ts
export interface Extractor {
  readonly id: string;                    // "com.example.commonextractors/Voe"
  readonly name: string;                  // "Voe"
  readonly hosts: HostPattern[];          // DECLARED. "voe.sx", "*.voe.sx"
  readonly priority: number;              // 0–100, default 50
  readonly requiresReferer?: boolean;
  extract(url: string, hint: ExtractHint, emit: SourceEmitter, ctx: HostContext):
    Promise<SourceOutcome>;
}
```

Resolution is deterministic and stated in full, because "which extractor handles this URL" is a
question that must have one answer:

1. Collect every **enabled** extractor whose declared `hosts` match the URL's host. Matching is
   exact label comparison — never fuzzy, never Levenshtein.
2. Sort by `priority` descending; break ties by `id` **lexicographically**. Not by load order,
   not by install order, not by list position.
3. Try in order until one emits a source or all fail.
4. Record which extractor answered, on the `Source` (`extractor` field, §12.1), so a failing
   file host is attributable. Today `indexerName` on an extension link *is* the extractor and is
   routinely mistaken for the provider `[measured]` — two of four task-building call sites
   stored it as `providerName`, which is also why download recovery's tier-1 match kept missing.

Mirror domains are handled by **declaring them** (`"voe.sx", "voe.mx", "*.voe.sx"`). An
extractor that meets an undeclared mirror returns "not mine" and the next one is tried — a
recoverable miss rather than a silent misattribution.

**Cross-extension use is explicit.** An extractor is usable by any provider unless the manifest
marks it `"private": true`. That is the declared form of what upstream achieves by accident of a
shared global, and it makes the dependency in §9.6 real rather than implied.

### 10.6 Meta providers and the origin binding

`kind: 'meta'` marks a catalogue — it answers `catalog`/`search`/`load` and has no `loadSources`.
This is upstream's `ProviderType` `[researched]` and it is load-bearing for us specifically,
because of a bug we already fixed:

merged search rows are addressed by the *catalogue* row (`searchMerge.primacy()`), and
`runDiscovery` read that as licence to ask **every** enabled provider and indexer — so a title
carried by two providers drew answers from two hundred sources, most with nothing, some slow,
some dead, all of them appearing to the user as sources that did not work `[measured]`.

The SDK therefore requires that **a search result carries its origin** (`SearchResult.providerId`,
§11.2, non-optional) and that merging preserves origins as `alternates`. `sourceScope.ts`'s
`origin` scope is then a property of the data rather than a repair applied on top of it.

### 10.7 Failure is a diagnosis (P4)

```ts
export interface Diagnosis {
  kind: FailureKind;              // the closed set in failureTaxonomy.ts, extended
  summary: string;                // one sentence, shown to the user
  hint?: string;                  // what the user could do
  detail?: string;                // for the clipboard, not the screen
  httpStatus?: number;
  host?: string;
  retryable: boolean;
  retryAfterMs?: number;
}
```

Throwing is allowed and is mapped to `kind: 'provider-error'` with the stack in `detail`.
Returning an empty array with `ok: true` is **legal and means "this title genuinely has
nothing"** — which is `empty`, not `failure`, and the distinction is the whole reason a
specialist anime provider does not rank below a broad one (`providerAnalytics`, `[measured]`).

`FailureKind` extends the existing closed set with `capability-violation`, `sdk-incompatible`
and `signature-invalid`. The extension keeps the two properties that make the set useful:
**one closed vocabulary shared by ranking, diagnostics and the issue ledger**, and **not
everything is scored** — `cancelled`, `provider-missing`, `resource-leak` and now
`capability-violation` are counted and never held against a provider `[measured]`.

---

## 11. The unified metadata model

`[proposed]`. This answers D17–D21 and is the section the user's brief is longest about. Design
rule: **a superset of upstream's `LoadResponse`, losslessly.** Every Android field maps in; the
additions are optional, so a provider that fills in nothing new still works.

### 11.1 Identity and external ids (D21)

Upstream's `syncData: MutableMap<String, String>` is stringly typed, and IMDb/TMDB ids are
additionally packed into a JSON string via `addIdToString` `[researched]`. Structure it:

```ts
export interface ExternalIds {
  imdb?: string;        // "tt1160419"
  tmdb?: number; tvdb?: number; trakt?: number;
  anilist?: number; mal?: number; kitsu?: number; anidb?: number; simkl?: number;
  letterboxd?: string; tvmaze?: number; wikidata?: string;
  musicbrainz?: string; isbn?: string;
  [custom: string]: string | number | undefined;   // namespaced: "x-mysite"
}

export interface MediaRef {
  providerId: string;         // who can act on `handle`
  handle: string;             // opaque to the host — a page address OR a links blob
  handleKind: 'page' | 'links' | 'both';   // ← see below
  ids?: ExternalIds;
  type: MediaType;
  title?: string;             // for the "find it again" fallback
}
```

**`handleKind` is not decoration; it is the fix for the single most frequent failure in a
captured user session** `[measured]`. Upstream has two kinds of handle and nothing separates
them: `load(url)` takes a page address, `loadSources(data)` takes an opaque blob the provider
built for itself — and a large part of the corpus puts JSON in it (VegaMovies an array of
objects, HDHub4U an array of strings). Both are `String`. Handing a links blob to `load()`
reaches OkHttp's `HttpUrl.get` and produces

```
VegaMovies: IllegalArgumentException: Expected URL scheme 'http' or 'https' … for [{"sou…
```

recorded at stage `detail`, **scored against the provider by the ranking**, and shown to the
viewer as the reason their title would not play. The provider was fine and the call should never
have been made. We currently defend with a shared predicate (`looksLikeLinksHandle`) that guesses
by testing for JSON `[measured]`. **Declaring it removes the guess.** `looksLikeLinksHandle`
stays for L0/L1, where nothing declares.

The same bug persisted into the library: `DetailView` recorded `episode?.url` — the *playback*
handle — as `progress.mediaUrl`, so a saved row opened blank later `[measured]`. With
`handleKind`, storing a `links` handle where a `page` handle belongs is a type error at the call
site rather than data rot discovered weeks later.

`ExternalIds` matters beyond bookkeeping: it is what makes §17's rating aggregation possible at
all, and IMDb ids are what indexers match on far better than free text `[measured]`.

### 11.2 Search results

```ts
export interface SearchResult {
  ref: MediaRef;
  providerId: string;           // REQUIRED — §10.6, the origin binding
  title: string;
  originalTitle?: string;
  year?: number; endYear?: number;
  type: MediaType;
  poster?: Image;
  ids?: ExternalIds;
  quality?: QualityTier;
  languages?: string[];
  dub?: DubStatus;              // 'sub' | 'dub' | 'both' | 'unknown'
  score?: number;               // 0–10, display only; §11.5 is the real model
  overview?: string;
  meta?: { seasons?: number; episodes?: number; runtimeMinutes?: number };
  nsfw?: boolean;
  alternates?: { providerId: string; ref: MediaRef }[];  // filled by the MERGE, not the provider
}
```

`alternates` is written by the host when rows merge and read by `sourceScope` to bind discovery
to the providers that actually produced the row. It is in the type because the merge is a
first-class operation with a documented output, not an implementation detail of one module.

### 11.3 Titles (D19)

```ts
export interface Titles {
  primary: string;                     // display, in the user's locale where known
  original?: string;                   // in the original language
  originalLanguage?: string;           // BCP-47
  english?: string; romanized?: string; native?: string;
  alternates?: { title: string; language?: string; kind?: TitleKind }[];
  sortTitle?: string;                  // "Matrix, The"
}
export type TitleKind = 'aka' | 'working' | 'translation' | 'abbreviation' | 'synonym';
```

Upstream has this **only for anime** (`engName`, `japName`, `synonyms`) `[researched]`, which is
a tell: the need is general and was solved in the one place it could not be avoided. It matters
in two places we already feel:

- **Deduplication.** `searchMerge` and `canonicalKey(title, year)` do the work; alternates make
  them better at it, and better dedupe means fewer duplicate rows for one film.
- **`titleEnricher`**, which resolves `Avengers End Game 720p Hindi Dubbed` to the film it is
  about and is deliberately conservative — a disagreeing year is disqualifying, and the
  similarity bar is high enough that `Avengers` does not match `Avengers: Endgame` `[measured]`.
  Alternates raise the recall without lowering that bar.

### 11.4 The core record

```ts
export interface MediaDetail {
  ref: MediaRef;
  providerId: string;
  type: MediaType;
  titles: Titles;
  ids?: ExternalIds;

  // ── description ────────────────────────────────────────────────────────
  overview?: string;               // one paragraph
  plot?: string;                   // long form
  tagline?: string;
  trivia?: string[];               // ← asked for; free-form notes a provider offers
  contentWarnings?: string[];

  // ── classification ─────────────────────────────────────────────────────
  genres?: string[];               // normalised (§11.10)
  tags?: string[];                 // provider vocabulary, verbatim
  keywords?: string[];             // ← distinct from tags; TMDB-style
  themes?: string[];               // AniList-style

  // ── release ────────────────────────────────────────────────────────────
  year?: number;
  releaseDate?: string;            // ISO 8601 date
  endDate?: string;
  status?: ReleaseStatus;          // 'announced'|'in_production'|'released'|'ongoing'|'ended'|'cancelled'
  comingSoon?: boolean;

  // ── production ─────────────────────────────────────────────────────────
  runtimeMinutes?: number;
  countries?: string[];            // ISO 3166-1 alpha-2
  spokenLanguages?: string[];      // BCP-47
  studios?: Organisation[];
  networks?: Organisation[];
  productionCompanies?: Organisation[];
  budget?: number; revenue?: number; currency?: string;

  // ── ratings & certification ────────────────────────────────────────────
  ratings?: Rating[];              // §11.5 — MANY, with provenance
  certifications?: Certification[];// per-country age rating
  popularity?: number;

  // ── people ─────────────────────────────────────────────────────────────
  people?: Person[];               // §11.6 — cast AND crew

  // ── artwork ────────────────────────────────────────────────────────────
  images?: ImageSet;               // §18
  trailers?: Trailer[];

  // ── structure ──────────────────────────────────────────────────────────
  seasons?: Season[];              // §11.7
  episodes?: Episode[];            // flat list; a movie has none
  anime?: AnimeMeta;               // §11.8
  music?: MusicMeta;               // §11.9
  chapters?: Chapter[];            // §11.11
  collection?: Collection;         // §11.12
  related?: RelatedRef[];          // ← "related items"; typed, unlike upstream's recommendations
  recommendations?: SearchResult[];// upstream's field, kept

  // ── playback hints ─────────────────────────────────────────────────────
  availableLanguages?: string[];   // audio the provider claims to have
  availableSubtitles?: string[];
  defaultSourceRequest?: SourceRequest;

  // ── provenance ─────────────────────────────────────────────────────────
  sourceUrl?: string;
  fetchedAt: number;
  expiresAt?: number;
  partial?: boolean;               // some fields deliberately unfetched
}
```

`partial` earns its place: a provider that can fill a detail page in 200 ms without cast and
crew, or in 3 s with them, should be allowed to return the fast answer and say so — the UI can
render and enrich. Upstream cannot express this, so every provider chooses once for everyone.

`trivia` is included because the brief asked for it, with a caveat worth stating: almost no
scraper has it, and the field exists so an enrichment provider (§17) or a rich meta provider can
supply it without a schema change. An empty optional array costs nothing; a missing field costs
a migration.

### 11.5 Ratings — many, with provenance (D17)

The single most-requested thing upstream cannot express.

```ts
export interface Rating {
  source: RatingSource;         // 'imdb'|'tmdb'|'tvdb'|'trakt'|'anilist'|'mal'|'rottenTomatoes'
                                // |'metacritic'|'letterboxd'|'simkl'|'provider'|string
  kind?: RatingKind;            // 'user' | 'critic' | 'audience' | 'editorial'
  value: number;                // as given
  scaleMin: number;             // usually 0
  scaleMax: number;             // 10 | 100 | 5
  votes?: number;
  url?: string;                 // where it came from — clickable
  fetchedAt?: number;
}
```

Four rules make this behave:

1. **Never normalise on the way in.** Store `(value, scaleMin, scaleMax)` as published.
   Rotten Tomatoes is 0–100 and a percentage; IMDb is 0–10 with one decimal; MyAnimeList is
   0–10 with two. Collapsing them all to 0–10 at ingest loses the shape of the source and makes
   "91%" render as "9.1", which is wrong in the way that erodes trust in every other number on
   the page.
2. **`kind` is why one source appears twice.** Rotten Tomatoes' Tomatometer (`critic`) and
   Popcornmeter (`audience`) routinely disagree by forty points, and that disagreement is
   information a viewer uses.
3. **Sorting and filtering use a normalised view computed at read time**, keeping upstream's
   `Score` design: fixed-point, scale-on-read, and **null below a floor so a default `0` never
   renders as `0.0/10.0`** `[researched]`. That last property is a genuinely good idea and is
   preserved exactly.
4. **`votes` decides display precedence.** IMDb with 900,000 votes and a provider's own rating
   with 12 are not comparable, and showing them the same size is a lie of layout.

### 11.6 People — cast *and* crew (D18)

```ts
export interface Person {
  name: string;
  id?: ExternalIds;
  role: 'cast' | 'crew' | 'guest' | 'voice';
  character?: string;                    // cast
  department?: Department;               // crew
  job?: string;                          // "Director", "Screenplay", "Original Music Composer"
  order?: number;                        // billing order
  image?: Image;
  voiceOf?: string;                      // anime: the character this actor voices
  episodeCount?: number;                 // series regulars vs one-episode guests
}
export type Department =
  | 'directing' | 'writing' | 'production' | 'camera' | 'editing'
  | 'sound' | 'art' | 'costume' | 'visual_effects' | 'crew';
```

Upstream's `ActorData { actor, role, roleString, voiceActor }` is cast-only `[researched]`, so
**director and writer — the two crew credits every media application shows — are inexpressible.**
`voiceActor` maps to a `Person` with `role: 'voice'` and `voiceOf` set, so nothing is lost.

Convenience accessors (`detail.directors`, `detail.writers`) are computed, never stored: a
second representation of one fact is a second thing to keep in sync.

### 11.7 Seasons and episodes

```ts
export interface Season {
  season: number;                 // 0 = specials, by convention
  name?: string;                  // upstream's SeasonData.name
  displaySeason?: number;         // upstream's SeasonData.displaySeason [researched]
  overview?: string;
  episodeCount?: number;
  airDate?: string;
  poster?: Image;                 // ← D20: upstream has no season poster
  ids?: ExternalIds;
}

export interface Episode {
  ref: MediaRef;                  // carries handleKind — §11.1
  season?: number;
  episode?: number;
  absoluteNumber?: number;        // ← anime; upstream computes this and cannot carry it
  name?: string;
  overview?: string;
  airDate?: string;
  runtimeMinutes?: number;        // upstream: seconds, on Episode.runTime
  still?: Image;                  // upstream: a bare posterUrl string
  ratings?: Rating[];             // upstream: a single Score
  ids?: ExternalIds;
  kind?: EpisodeKind;             // 'standard'|'special'|'ova'|'ona'|'movie'|'recap'|'filler'|'bonus'
  filler?: boolean;               // ← anime
  dub?: DubStatus;
  chapters?: Chapter[];
  nsfw?: boolean;
}
```

`SeasonData.displaySeason` is upstream's solution to a real and awkward problem — a site that
numbers its seasons differently from the canonical numbering — and it is kept verbatim
`[researched]`, including the rendering rule ("Season $displaySeason $name", or just "$name"
when `displaySeason` is null).

`absoluteNumber` and `kind` are additions the anime corpus needs and upstream computes rather
than carries: `getTotalEpisodeIndex` reconstructs an absolute index from season/episode at read
time `[researched]`, which works until a provider numbers absolutely and the host does not know.

`EpisodeKind` covers the brief's "OVA/Bonus/special episodes" and the recap/filler distinction
in one enum rather than three booleans, because the values are mutually exclusive.

### 11.8 Anime

```ts
export interface AnimeMeta {
  dubStatus?: DubStatus[];                       // which of sub/dub exist
  episodesByDub?: Partial<Record<DubStatus, Episode[]>>;   // upstream's Map<DubStatus, List<Episode>>
  synonyms?: string[];
  season?: 'winter'|'spring'|'summer'|'fall'; seasonYear?: number;
  source?: 'manga'|'light_novel'|'original'|'game'|'visual_novel'|'web_novel'|'other';
  studios?: Organisation[];
  arcs?: Arc[];                                  // ← "arc grouping", asked for
  fillerEpisodes?: number[];
  nextAiring?: { episode: number; at: number; season?: number };  // upstream's NextAiring
  relations?: { relation: AnimeRelation; ref: MediaRef; title: string }[];
}
export interface Arc { name: string; from: number; to: number;
                       kind?: 'canon'|'filler'|'mixed'; description?: string }
export type AnimeRelation = 'sequel'|'prequel'|'side_story'|'parent'|'spin_off'
                          | 'alternative'|'summary'|'movie'|'special'|'character'|'other';
```

`arcs` and `relations` are the two things a serious anime application needs that upstream has no
room for: an 1,100-episode series is unnavigable without arcs, and `relations` is how "related
anime" becomes a typed graph rather than a flat recommendation list. Both are read straight from
AniList's public GraphQL, which we already call `[measured]`.

### 11.9 Music and audio

Upstream has `TvType.Music` and `TvType.AudioBook` and no model behind either `[researched]`.
Forward-looking and small:

```ts
export interface MusicMeta {
  artists?: Person[]; albumArtist?: string; album?: string;
  trackNumber?: number; discNumber?: number; totalTracks?: number;
  label?: string; isrc?: string;
  durationSeconds?: number;
  tracks?: { title: string; ref: MediaRef; durationSeconds?: number; trackNumber?: number }[];
  narrator?: string;                                  // audiobook
  chaptersAvailable?: boolean;
}
```

### 11.10 Genres: normalised value, verbatim original

Every provider has its own vocabulary — "Sci-Fi", "Science Fiction", "SF", "SciFi". Normalise to
a closed set for **filtering**, keep the original for **display**:

```ts
export interface Genre { id: GenreId; label: string; original?: string }
```

The mapping lives in the host and is data, not code, so a new synonym is a table edit. The rule
that keeps it honest: **an unmapped genre is preserved and shown, never dropped.** A provider's
"Tokusatsu" surviving as a display label with no `GenreId` is right; discarding it because our
table is incomplete is the kind of quiet loss that makes a catalogue feel wrong without anyone
being able to say why. Same failure mode as the extensions screen's old three-option `<select>`,
which silently omitted every `TvType` beyond Movies/TV/Anime `[measured]`.

### 11.11 Chapters (D21)

```ts
export interface Chapter {
  index: number;
  title?: string;
  startMs: number;
  endMs?: number;
  kind?: ChapterKind;      // 'intro'|'recap'|'content'|'credits'|'preview'|'advert'|'other'
  thumbnail?: Image;
}
```

`kind` is what turns metadata into a feature. `intro` is skip-intro; `credits` is
next-episode-early; `recap` is a skip most viewers want on a rewatch; `advert` is a segment
marker on a recorded stream. A chapter list without kinds is a table of contents; with them it is
behaviour.

Three sources, in precedence order, and the host merges them:

1. **Container chapters**, read by ffprobe. Already available — we run ffprobe on every source
   `[measured]` and currently ignore the chapter atoms in the output.
2. **Provider-declared**, via `loadChapters`.
3. **Community skip data** (AniSkip-shaped), as an optional enrichment provider (§17).

Container chapters win where they exist, because they are a property of the exact file being
played and the others are a property of the *title* — and a differently-cut release makes a
title-level timestamp wrong in the most annoying possible way.

### 11.12 Collections and related items

```ts
export interface Collection { id?: string; name: string; overview?: string;
                              poster?: Image; backdrop?: Image;
                              parts?: SearchResult[]; partNumber?: number }
export interface RelatedRef { relation: RelationKind; ref: MediaRef;
                              title: string; poster?: Image; year?: number }
export type RelationKind = 'sequel'|'prequel'|'remake'|'spin_off'|'collection'
                         | 'same_universe'|'adaptation'|'similar'|'recommended';
```

Upstream's `recommendations: List<SearchResponse>` is kept and is untyped by design — it means
"the site suggested these". `related` is the typed graph, and the two are different claims: a
sequel is a fact, a recommendation is an opinion, and merging them makes both less useful.

### 11.13 Compatibility with upstream, field by field

The mapping is total in both directions for the fields that exist. This table is the contract
the L0/L1 adapter is written against.

| Upstream `LoadResponse` | CSX `MediaDetail` | Lossless? |
|---|---|---|
| `name` | `titles.primary` | ✔ |
| `url` | `ref.handle` (`handleKind: 'page'`) | ✔ |
| `apiName` | `providerId` | ✔ (name → id via the registry) |
| `type` | `type` | ✔ |
| `posterUrl` / `posterHeaders` | `images.posters[0]` (+ `headers`) | ✔ |
| `backgroundPosterUrl` | `images.backdrops[0]` | ✔ |
| `logoUrl` | `images.logos[0]` | ✔ |
| `year` | `year` | ✔ |
| `plot` | `plot` | ✔ |
| `score` | `ratings[] {source:'provider', kind:'user'}` | ✔ |
| `tags` | `tags` (+ normalised into `genres`) | ✔ |
| `duration` (min) | `runtimeMinutes` | ✔ |
| `trailers[]` | `trailers[]` | ✔ |
| `recommendations` | `recommendations` | ✔ |
| `actors[]` | `people[] {role:'cast'\|'voice'}` | ✔ |
| `comingSoon` | `comingSoon` | ✔ |
| `syncData` | `ids` | ✔ |
| `contentRating` | `certifications[0].rating` | ✔ |
| `uniqueUrl` | `ref.handle` | ✔ |
| `showStatus` | `status` (`ongoing`/`ended`) | ✔ |
| `nextAiring` | `anime.nextAiring` | ✔ |
| `seasonNames[]` | `seasons[]` (`name`, `displaySeason`) | ✔ |
| `engName`/`japName`/`synonyms` | `titles.english`/`.native`/`anime.synonyms` | ✔ |
| `episodes: Map<DubStatus,…>` | `anime.episodesByDub` + flat `episodes` | ✔ |
| `Episode.runTime` (s) | `runtimeMinutes` | ✔ (converted) |
| `magnet`/`torrent` | a `Source` of kind `magnet`/`torrent` | ✔ |
| `dataUrl` (live) | `defaultSourceRequest` | ✔ |
| — | `ratings[]` (multi), `people[] {role:'crew'}`, `titles.*`, `images.*`, `chapters`, `collection`, `keywords`, `countries`, `certifications`, `anime.arcs`, `Episode.absoluteNumber`, `Season.poster` | **additions** |

---

## 12. The media source model

`[proposed]`. One `Source` object, produced by every lane. This is the union of what upstream's
`ExtractorLink` carries, what Stremio's `Stream` carries, and what this codebase has learned it
needs — and we already parse most of it in `cs3/providerLinks.ts` `[measured]`, so L0/L1 land in
this shape with no adapter in between.

### 12.1 `Source`

```ts
export interface Source {
  // ── identity ─────────────────────────────────────────────────────────────
  id: string;                       // stable within one resolve
  providerId: string;               // WHO produced it
  extractor?: string;               // the FILE HOST (Voe, Gdshine) — NOT the provider
  name: string;                     // display label
  variantKey?: string;              // §12.5 — the durable identity

  // ── address: exactly one ─────────────────────────────────────────────────
  url?: string;
  magnet?: string;
  torrentUrl?: string;
  infoHash?: string;

  // ── transport, DECLARED (never re-derived from the URL) ──────────────────
  kind: SourceKind;                 // 'progressive'|'hls'|'dash'|'torrent'|'magnet'|'live'
  mimeType?: string;
  headers?: Record<string, string>; // Referer / User-Agent — applied by mediaProxy
  drm?: DrmDeclaration;

  // ── quality ──────────────────────────────────────────────────────────────
  quality?: number;                 // 2160 | 1080 | 720 …
  qualityTier?: QualityTier;        // 'cam'|'ts'|'tc'|'dvd'|'sd'|'hd'|'webrip'|'webdl'|'bluray'|'remux'
  sizeBytes?: number;
  bitrateBps?: number;
  filename?: string;
  releaseName?: string;
  releaseGroup?: string;

  // ── declarations that let the host skip a probe (§12.7) ──────────────────
  container?: string;
  videoCodec?: string;              // 'h264'|'hevc'|'av1'|'vp9'|'mpeg2'|'vc1'…
  audioCodec?: string;              // 'aac'|'ac3'|'eac3'|'dts'|'truehd'|'opus'|'flac'…
  channels?: number;
  bitDepth?: number;
  hdr?: HdrFormat;                  // 'none'|'hdr10'|'hdr10plus'|'dolbyvision'|'hlg'
  frameRate?: number;
  width?: number; height?: number;

  // ── tracks ───────────────────────────────────────────────────────────────
  audioTracks?: AudioTrack[];       // ← WITH LANGUAGE (D21)
  subtitles?: SubtitleTrack[];
  playlist?: PlaylistPart[];        // multi-part titles

  // ── lifetime ─────────────────────────────────────────────────────────────
  expiresAt?: number;               // epoch ms — DECLARED, not reverse-engineered
  refreshable?: boolean;

  // ── torrent (§12.3) ──────────────────────────────────────────────────────
  torrent?: TorrentMeta;

  // ── advisory ─────────────────────────────────────────────────────────────
  priority?: number;                // provider's own preference, 0–100
  languages?: string[];             // audio languages present
  requiresProxy?: boolean;
  notWebReady?: boolean;            // Stremio's flag [researched] — needs a real player
}

export interface AudioTrack {
  id?: string;
  language: string;                 // BCP-47 — REQUIRED. Upstream's AudioFile has no language.
  label?: string;                   // "Hindi 5.1 (Original)"
  url?: string;                     // separate-track case
  headers?: Record<string, string>; // ← measured: bare URLs get 403'd
  codec?: string; channels?: number; bitrateBps?: number;
  default?: boolean; forced?: boolean;
  kind?: 'main' | 'commentary' | 'descriptive' | 'dub';
}
```

### 12.2 Six fields that exist because we got burned without them

None is in the Android model, and each cites the incident.

- **`expiresAt`.** Provider links are signed CDN addresses good for minutes. `sourceCache`
  already digs the deadline out of `Expires` / `exp` / a JWT claim, case-insensitively, because
  nobody declares it `[measured]`. The asymmetry decides the default: a direct link with **no
  recorded deadline is treated as expired**, because guessing "still good" costs the ffmpeg
  startup plus the player's timeout before failing over, while guessing "expired" costs one
  provider call and produces a stream that works `[measured]`.
- **`playlist`.** A multi-part title has **no top-level URL** — only the parts have one — so an
  `ExtractorLinkPlayList` was being filtered out as malformed `[measured]`. Android concatenates
  into one timeline; we render numbered rows (`part 2 of 3`), because a film that ends after
  forty minutes with no explanation reads as a broken source. Visibly partial beats silently
  truncated.
- **`audioTracks[].headers`.** Separate audio tracks crossed as bare URLs and were 403'd by the
  hosts that use them `[measured]`.
- **`audioTracks[].language`.** D21. Upstream's `AudioFile` is `{url, headers}` `[researched]`,
  so a viewer picking between three dubs is choosing between "Audio 1/2/3".
- **`container`/`videoCodec`/`channels`/`hdr`/`bitDepth`.** Optional and **never trusted over a
  probe** (P3), but they let a provider that already knows save 1.6–1.7 s per source `[measured]`.
  Also: a declared `channels > 2` is exactly the mpv routing trigger, so the decision can be made
  before any process starts `[measured]`.
- **`kind`, declared.** The old mapper matched `.m3u8`, `/hls/` and `?format=m3u8` against the
  address, which is wrong in both directions — providers serve playlists from `.php` URLs with
  no extension, and a progressive MP4 behind a path containing `dash` is not a manifest
  `[measured]`. On Android this field picks the `MediaSource` factory, and where a provider leaves
  it unset upstream's `INFER_TYPE` fills it in *before the link is emitted*, so by the time it
  reaches us it is the best classification that exists. **The heuristics stay as a fallback** for
  archives built against a library predating the field; what changed is that the provider is asked
  first.

### 12.3 Torrents

```ts
export interface TorrentMeta {
  infoHash?: string;                // the DEDUPE IDENTITY
  seeders?: number; leechers?: number; completed?: number;
  trackers?: string[];
  sizeBytes?: number;
  files?: { path: string; sizeBytes: number; index: number }[];
  fileIndex?: number;               // ← leave UNSET unless you mean a specific file
  category?: string;
  uploader?: string; trustedUploader?: boolean;
  publishedAt?: number;
  imdbId?: string;
}
```

Three rules `[measured]`, each from a real defect:

1. **`infoHash` is the dedupe identity.** A provider and an indexer offering the same release
   must collapse to one row. Everything else about a torrent varies between sources; the
   infohash does not.
2. **`fileIndex` must be left unset** unless the provider genuinely means one file. It means
   "which file inside the archive" to the torrent engine, and the list position it used to carry
   would select an arbitrary episode of a season pack.
3. **Torrent links from providers are ordinary results.** `TORRENT` and `MAGNET` are link types
   upstream hands to its torrent player exactly as it hands an M3U8 to ExoPlayer. Here every one
   of them was written into `directUrl` and passed to `MediaProxy`, which speaks HTTP: a
   `magnet:` URI went in and nothing came out `[measured]`. The swarm, sequential piece ordering
   and loopback server had been in place the whole time and were simply never reached from that
   direction.

`seeders`/`leechers`/`sizeBytes`/`trustedUploader`/`releaseGroup` are what `torrent/ranker.ts`
already ranks on `[measured]`. Upstream's `TorrentLoadResponse` carries `magnet` and `torrent`
and nothing else `[researched]`, so a provider that knows its own seed count cannot say so.

### 12.4 Subtitles

```ts
export interface SubtitleTrack {
  language: string;                 // BCP-47
  label?: string;
  url?: string;
  embedded?: boolean; streamIndex?: number;
  format?: 'srt'|'vtt'|'ass'|'ssa'|'sub'|'pgs'|'dvbsub'|'vobsub'|'ttml';
  encoding?: string;                // declared charset, if known
  kind?: 'full'|'forced'|'sdh'|'cc'|'signs'|'commentary';
  headers?: Record<string, string>;
  default?: boolean;
  source?: 'provider'|'embedded'|'opensubtitles'|'user';
  rating?: number; downloads?: number;
}
```

Notes that are not cosmetic:

- **`format` is declared and matters.** `<track>` rejects SubRip **and** ASS silently
  `[measured]`. ASS through the SubRip converter emits `[Script Info]` and `Dialogue:` lines as
  if they were cues — which is most of anime and of fansubbed releases.
- **`encoding`.** `Response.text()` decodes as UTF-8 unconditionally, so a Windows-1252 or GBK
  subtitle loads with correct timings and a black diamond per accent, which reads as a bad upload
  `[measured]`. A declared charset skips the detector; the detector remains, because most
  providers will not declare.
- **`kind: 'forced'`** is why a release carrying its own forced-narrative track had none in the
  app — it could not be distinguished from a full track and so could not be auto-selected.
- **Bitmap formats are listed and never offered.** PGS/DVBSUB/VOBSUB cannot become WebVTT, and an
  empty WebVTT named "English" reads as broken subtitles rather than absent ones `[measured]`.
  mpv renders them; the element cannot.

### 12.5 `variantKey` — the durable identity

```ts
variantKey?: string;   // torrents: the real infoHash
                       // everything else: media + season + episode + provider
                       //                + releaseName + resolution + quality + language + audio
```

This is `src/utils/downloadIdentity.ts` promoted into the wire format `[measured]`. The problem
it solves: **a provider source has no durable id.** Its `infoHash` is *synthesised* as the SHA-1
of its URL, purely so the ranker and the dedupe key have something to work with — so re-resolve
that release an hour later, get a freshly signed URL, and the id is different for a byte-identical
file.

Both failure directions are silent and they are opposite:

| Too coarse | Too fine |
|---|---|
| The 1080p release is refused as a duplicate of the 2160p one | Every recovery starts a second download of bytes already on disk |
| Visible, and reads as a broken button | Invisible, and reads as working |

Declaring `variantKey` lets the provider — which knows whether two links are the same release —
answer directly, instead of the host reconstructing it from a description.

### 12.6 Headers, and why the URL handed onward is always ours

Extension links routinely only answer with the `Referer` the provider supplied, and **no
renderer-side fix is possible**: `Referer` is a forbidden header for `fetch`/XHR precisely so
pages cannot forge it. One cause, two unrecognisable symptoms `[measured]`: HLS fails with
`manifestLoadError` (the host 403'd the playlist), progressive fails with "could not decode this
file" (ffprobe could not read it either, so there was no codec to name).

`mediaProxy` serves from loopback with headers applied, and that fixes the media element, hls.js,
Shaka, ffprobe/ffmpeg, mpv and an external VLC at once, because they are all handed the same
loopback URL `[measured]`. The rules that must survive any change here:

- A **loopback URL is returned from `wrap` untouched**, or the engine wraps a torrent stream in a
  second proxy hop that copies every byte for nothing, and re-wrapping our own output builds a
  chain that grows by one hop per call.
- **HLS playlists and DASH manifests are rewritten, not forwarded**, or segment requests go
  straight to the host without headers — succeeding on the manifest and failing on every
  segment, which is worse than failing outright.
- **Tokens are 16 random bytes.** Every response carries `Access-Control-Allow-Origin: *` so five
  different engines can read from one door; with sequential tokens that meant any page in the
  user's browser could fetch `/stream/1` and walk the integers `[measured]`.

Upstream's `getVideoInterceptor` `[researched]` — a provider attaching an OkHttp interceptor to
playback requests — has no equivalent here and should not get one: an interceptor is arbitrary
code in the playback path, which is the one path that must stay predictable. Its legitimate uses
(a rotating token, a signed query parameter) are covered by `refreshable` plus a re-resolve, and
that is the conversion the L0 adapter performs.

### 12.7 Capability negotiation

The host publishes what it can play; the provider may use it to choose what to return. This is
Stremio's `notWebReady` `[researched]` generalised, and it is read-only to the extension.

```ts
export interface HostPlaybackCapabilities {
  videoCodecs: string[];            // MEASURED by canPlayType at startup [measured]
  audioCodecs: string[];
  containers: string[];
  maxResolution?: { width: number; height: number };
  hdr: HdrFormat[];
  drm: ('clearkey'|'widevine'|'playready')[];   // clearkey only, today [measured]
  engines: ('element'|'hls'|'shaka'|'ffmpeg'|'mpv'|'external')[];
  hardwareDecode: boolean;
  hardwareEncode: boolean;
  torrent: boolean;
}
```

Two properties keep this from becoming a lie:

- **It is measured, not tabled.** Chromium's HEVC support varies by build and platform, so
  `App.tsx` runs `canPlayType` over `VIDEO_CODEC_PROBES` at startup and overrides the static
  table **in both directions** — a build that *can* decode HEVC is not made to re-encode for
  nothing `[measured]`. Similarly, the hardware encoder is chosen by **test-encoding one frame
  with the exact arguments it would be used with**, never by `ffmpeg -encoders`, which reports
  what the binary was built with rather than what the machine can run `[measured]`.
- **A provider may not use it to hide sources.** It is advisory ordering, not filtering. If the
  host cannot play the only thing a provider has, the correct outcome is the source *plus* an
  honest explanation and a download offer — decoding and fetching are different capabilities, and
  a 10-bit HEVC file with Dolby audio can be undecodable here and completely ordinary to download
  `[measured]`.

### 12.8 DRM

```ts
export interface DrmDeclaration {
  scheme: 'clearkey' | 'widevine' | 'playready' | 'unknown';
  uuid?: string;
  kid?: string; key?: string;       // ClearKey — base64url as EME wants it
  keyType?: string;
  licenseUrl?: string;
  keyRequestParameters?: Record<string, string>;
}
```

**A provider's declaration short-circuits inspection entirely**, and that ordering is the whole
point `[measured]`: ffprobe reads a CENC file and reports **correct codec names**, then decoding
produces pages of `non-existing PPS` / `no frame!`. The probe does not fail — it succeeds with a
lie, and every decision made from it is wrong, which is why encrypted provider streams reached
users as "this file is corrupt" rather than "this is encrypted".

Three outcomes that used to read identically `[measured]`:

1. ClearKey + key + browser-decodable payload → EME, and it **plays**.
2. ClearKey + key + payload the browser cannot decode → the ordinary ladder with
   `-decryption_keys`. **Progressive only** — the DASH demuxer answers `Option decryption_key not
   found`, which is fatal to the whole command line.
3. Widevine / PlayReady / ClearKey without a key / unrecognised → reported **by name**. We ship no
   CDM; saying so is better than failing as a corrupt file.

`scheme: 'unknown'` is deliberate: an unrecognised system is exactly as unreadable to FFmpeg as a
recognised one, and folding it into "none" sends it back to the probe to be misdiagnosed.

HLS AES-128 and SAMPLE-AES are **not DRM** for this purpose — hls.js fetches the key over HTTP
and decrypts in JavaScript, and routing those to an EME path they do not need would break streams
that work today.

---

## 13. The extension runtime and host API

`[proposed]` for L2. §13.5 states what L0/L1 get instead.

### 13.1 Where an L2 extension runs

An Electron **`utilityProcess`**, one per extension or one shared with per-extension QuickJS
realms (decided by measurement in M2, §23.5 — the trade is memory against blast radius). Inside
it, a **QuickJS-on-WASM** realm per extension.

| Boundary | Gives |
|---|---|
| `utilityProcess` | OS process isolation. A crash or a memory blow-up cannot take the app down. |
| QuickJS realm | No ambient globals. No `fetch`, no `process`, no `require`, no `Function` over host code. |
| Capability broker (in main) | Every I/O crosses a typed channel and is checked against the manifest. |

Limits are `quickjs-emscripten` primitives — a hard per-call timeout, a memory limit, and an
interrupt handler that kills a runaway loop `[researched]` — so this is configuration rather than
construction.

### 13.2 `ctx` — and nothing else

```ts
export interface HostContext {
  http: HttpApi; html: HtmlApi; json: JsonApi; url: UrlApi; form: FormApi;
  crypto: CryptoApi; js: JsApi; storage: StorageApi; settings: SettingsApi;
  log: LogApi; webview: WebViewApi; player: HostPlaybackCapabilities;
  cache: CacheApi; ytdlp?: YtdlpApi;
  abort: AbortSignal;
  locale: string; appVersion: string; sdkVersion: string; platform: NodeJS.Platform;
}
```

| Module | Surface | Enforced by |
|---|---|---|
| `ctx.http` | `get/post/head/request`, per-call headers, cookie jar, timeout, redirect policy, `impersonate` | host broker; manifest allow-list; per-host rate limit |
| `ctx.html` | `parse(html)` → CSS `select/attr/text`, plus `xpath` | host-side (linkedom/cheerio); returns **handles**, not a live DOM |
| `ctx.json` / `ctx.form` / `ctx.url` | parse/serialise helpers | in-sandbox |
| `ctx.crypto` | md5/sha1/sha256/hmac, AES-CBC/GCM, base64/hex, RSA verify, **`unpack`** | host-side (`node:crypto`) |
| `ctx.js.eval(src)` | run untrusted page JS in a **nested realm with no `ctx`** | the nested realm |
| `ctx.storage` | scoped KV, quota'd | per-extension namespace |
| `ctx.settings` | typed reads; `secret` returns a handle, never a value (§9.8) | host |
| `ctx.log` | attributed logging into `cs3/diagnostics.ts` | host |
| `ctx.webview` | `solve(url)` → cookies + final HTML; `evalOnPage(url, js)` | **capability-gated**, user-visible, rate-limited |
| `ctx.player` | the capability descriptor (§12.7) | read-only |
| `ctx.cache` | request-scoped and persistent memo, TTL'd | host |
| `ctx.ytdlp` | hand a URL to the L4 lane | capability-gated |

Two details worth stating:

- **`ctx.html` returns handles, not a DOM.** Marshalling a live DOM across the WASM boundary is
  where a naive implementation spends all its time; handles keep the tree host-side and cross only
  the strings the scraper asked for.
- **`ctx.crypto.unpack`** is P.A.C.K.E.R. de-obfuscation. Upstream ships `JsUnpacker` in the
  library `[researched]` because a large fraction of file hosts serve packed JavaScript, and every
  scraper would otherwise reimplement it. Putting it in the host is the difference between "the
  SDK is usable for real sites" and "the SDK is a nice idea".

**Everything above is available to L0/L1 too** — the android shim already provides the equivalents
(`Log`, `SharedPreferences`, `Uri`, `Handler`) `[measured]`. What changes is that L2's version
becomes the *specification* and the shim becomes an adapter to it, rather than the reverse.

### 13.3 `ctx.http` is a broker, not a client

```ts
const res = await ctx.http.get('https://kinox.to/search', {
  query: { q: 'dune' },
  headers: { Referer: 'https://kinox.to/' },
  timeout: 15_000,
  redirect: 'follow',        // each hop re-checked against the allow-list
  impersonate: 'chrome',     // §19.3 — may be refused
  cache: 'default',
  retry: { attempts: 2, backoff: 'exponential', on: [429, 502, 503, 504] },
});
```

The check order, in the main process, before a socket exists:

1. Scheme ∈ `{https, http}`. `file:`, `data:` and everything else refused.
2. **Host matches `capabilities.network.hosts`.** One-label wildcards; bare `*` refused at
   validation (§9.7).
3. Method ∈ declared methods.
4. Per-extension concurrency and rate limits (§19.2).
5. Global budget: an extension exceeding a share of app-wide network gets throttled, then
   suspended with a named reason.

Every redirect hop repeats 1–3. A violation is refused, recorded as `capability-violation` with
the host named, and surfaced on the extension's row.

**Loopback is refused outright** — `127.0.0.1`, `::1`, `localhost`, link-local and RFC 1918 ranges
— unless a `localNetwork` capability is declared and granted. Without that, a scraper can port-scan
the user's LAN and reach their router's admin page. That is not hypothetical; it is the standard
attack on any component that fetches attacker-influenced URLs.

### 13.4 The WebView capability

The highest-privilege capability, because it runs real page JavaScript with a real cookie jar.
The design is already built for L0 `[measured]` and generalises unchanged:

- **`backgroundThrottling: false` is mandatory.** A hidden window has its timers throttled and a
  challenge page is mostly timers; left on, it takes minutes or never finishes — and that reads as
  the site being slow rather than as our own setting.
- **Cookies come from the session, never `document.cookie`.** `cf_clearance` is `HttpOnly`.
- **The bypass ends on the cookie arriving**, not on a URL match — upstream passes the
  deliberately unmatchable `.^`, so without `awaitCookie` every bypass runs its full 60 s timeout.
- **Certificate errors are ignored for this partition only.** Android's resolver does
  `handler.proceed()` on every SSL error and a real share of scraper hosts have bad certs. What
  bounds it: the session solves challenges and watches URLs, never carries credentials, and the
  stream it finds is fetched afterwards through the ordinary path with ordinary verification.
- **`webRequest` handlers are per session and there is exactly one of each.** Registering per
  resolve means the second concurrent resolve silently unhooks the first — which reads as a
  provider that intermittently finds nothing, but only when another provider happens to be
  scraping at the same time. Installed once, dispatching on `webContentsId`.
- **A browser opens only when something needs one.** `CloudflareKiller` opens one only if the reply
  is a genuine challenge — `Server: cloudflare` **and** 403/503, both, never one. A bare 403 is far
  more often hotlink protection or an expired signed URL, and the corpus attaches this interceptor
  defensively, so opening a page per request would put a Chromium instance behind every scrape.
- **Java regexes are translated escape-aware, and refused when they cannot be.** JavaScript accepts
  `\A` and `\p{Alpha}` as *identity escapes* — no error, and a pattern that matches nothing a
  browser will ever request. A pattern silently treated as "never matches" spends the full timeout
  on every link and looks exactly like a host that is down, attributed to the provider rather than
  to us.
- **The blacklist reads the path, never the whole URL.** `?poster=…jpg` and `?v=….ts` cache busters
  are routine, and cancelling the script they decorate breaks the page that was about to solve the
  challenge. `/cdn-cgi/` and `recaptcha` are never blocked — that is the challenge machinery.

**CAPTCHA is a hook, not a solver.** `ctx.webview.solve` may return
`{ needsUser: true, url }`, and the host shows the page to the user in a real window. We do not
ship a solver, do not integrate a paid service, and do not pretend to. A visible "this site is
asking you to prove you are human" is a truthful outcome; an invisible five-minute hang is not.

### 13.5 What L0/L1 get instead

| | L0/L1 | L2 |
|---|---|---|
| Isolation | OS process (the sidecar) + `PluginClassLoader` | OS process + QuickJS realm |
| Network | **unrestricted** — OkHttp inside the JVM | brokered, allow-listed |
| Filesystem | JVM defaults, scoped storage by convention | none but `ctx.storage` |
| `System.exit` | cannot kill the app (process boundary) | n/a |
| `System.loadLibrary` | blocked (empty `java.library.path`) | n/a |
| Enforced today | classloader isolation, process boundary, no native loads `[measured]` | all of the above plus network |
| **Not enforced** | **raw egress, process creation** `[measured]` | — |

This asymmetry is real and **must be visible in the UI** (§14.6). The current `sandboxGaps`
reporting already does this on purpose `[measured]`: a named gap can be closed; an
implied-covered gap never gets fixed.

Closing L0/L1's egress gap needs an OS-level sandbox — a Windows job object with a restricted
token, seatbelt on macOS, seccomp/namespaces on Linux — which is doc 36 step 6 and is not in this
document's scope. Java's `SecurityManager` is not an option (JEP 411/486 removal).

---

## 14. Security model and threat analysis

### 14.1 Threat model

| # | Threat | Lane | Control | State |
|---|---|---|---|---|
| T1 | Malicious repository serves a hostile artifact | all | signature + pinned key (§8) | `[proposed]` |
| T2 | Repository takeover rewrites URL **and** hash | all | pinned key — the hash cannot help | `[proposed]` |
| T3 | MITM on download | all | HTTPS + hash + signature | partly built |
| T4 | Extension exfiltrates viewing history | L2 | host allow-list, brokered egress | `[proposed]` |
| T4′ | same | L0/L1 | **not enforced** — reported as a gap | `[measured]` |
| T5 | Extension reads user files | L2 | no filesystem in `ctx` | `[proposed]` |
| T5′ | same | L0/L1 | JVM defaults; scoped storage is convention | gap |
| T6 | Extension steals another extension's settings | all | per-extension storage namespace, keyed by `id` | partly built |
| T7 | Extension exhausts CPU/memory | L2 | interrupt handler, memory cap, per-call timeout | `[proposed]` |
| T7′ | same | L0/L1 | process boundary; a hung plugin degrades to "provider unavailable" | `[measured]` |
| T8 | Extension scans the LAN | L2 | loopback and RFC 1918 refused (§13.3) | `[proposed]` |
| T9 | Malicious update to a trusted extension | all | signature + **capability-widening consent** (§9.9) | `[proposed]` |
| T10 | Supply chain via a dependency | all | same-repo-first resolution, no transitive fetch (§9.6) | `[proposed]` |
| T11 | Data URL / local file exfiltration via the proxy | all | scheme allow-list; `resolvePrefixed` refuses leaving the base origin | `[measured]` |
| T12 | Cross-origin read of the media proxy | — | random 16-byte tokens; `Host` must name loopback | `[measured]` |
| T13 | Plugin desynchronises the RPC channel with a stray `println` | L0/L1 | stdout carries frames only; plugin output forced to stderr | `[measured]` |

### 14.2 Defence in depth, honestly labelled

```
signature + pinned key   ← who wrote this          (T1, T2, T9)
      ↓
capability manifest      ← what it says it needs   (T4, T5, T8)
      ↓
broker enforcement       ← what it can actually do (L2 only)
      ↓
process isolation        ← blast radius            (T7)
      ↓
telemetry + issue ledger ← what it actually did    (all)
```

The last layer is the one most systems omit and it is the one already built `[measured]`. An
extension that behaves badly is *visible*: `capability-violation` rows, per-provider failure
counts, the durable tally that turned 5,407 stderr records into ~200 distinct problems. Detection
after the fact is not prevention, and it is far better than nothing — and unlike the other four, it
works on L0 today.

### 14.3 The install prompt

Shown once, at install, and only when there is something to say:

```
Install “Kinox” 1.4.2
Publisher   ✓ signed — key 9f2c…a41b, pinned since 2026-03-04 (org.example.movies)
Runs in     sandboxed process, brokered network        ← or, for L0/L1:
                                                          separate process, UNRESTRICTED network
This extension will:
  • connect to kinox.to, *.kinox.to, *.voe.sx
  • open a browser window to solve Cloudflare challenges on kinox.to
  • store up to 256 KB of its own data
It cannot: read your files · reach other hosts · see your library or history

                                        [ Cancel ]  [ Install ]
```

Three rules, because permission prompts fail in well-understood ways:

- **"It cannot" is as important as "it will".** A prompt that only escalates trains people to
  click through. The negative list is what makes the positive one informative.
- **No prompt when there is nothing to say.** An extension declaring `{}` installs with a one-line
  confirmation. Prompt fatigue is the mechanism by which permission systems stop working.
- **The L0/L1 line is honest.** `UNRESTRICTED network` in the same visual slot where L2 says
  `brokered`. It is the truth, and it is the incentive: an author who wants the reassuring line
  writes L2.

### 14.4 Static analysis at install

Cheap checks, run on the bundle before the prompt. Every one produces a **warning that is shown**,
not a silent refusal — a heuristic that blocks installs will be wrong and will be worked around.

| Check | Signal |
|---|---|
| `eval` / `Function` outside `ctx.js` | attempting to escape the realm |
| Base64/hex blobs over a size threshold | packed payload |
| Hosts referenced in code but not declared | under-declaration, or a bug |
| Declared hosts never referenced | over-declaration |
| Bundle size vs. provider count | vendored binary |
| Minified with no source map | not disqualifying, but worth showing |

`LinkageAnalyzer` is the L0/L1 equivalent and already assigns a tier `[measured]`. The tier is
compatibility, not safety, and the UI must not conflate them.

### 14.5 The adult gate

Unchanged and central `[measured]`. Off by default; the enforcement point is
`PluginManager.enabledProviderNames`, because search, the scope picker, source discovery, playback
and downloads all funnel through it — filtering at each call site is five places to forget (P7).

CSX adds `nsfw` at the **extension** and **repository** level, so a mixed repository is handled
correctly. That is the real case: four repositories publish NSFW-tagged plugins and none is a
wholly-adult repository `[measured]`. `BootstrapService` additionally declines to *download* them
while the setting is off, which is politeness rather than protection; the gate above is the
protection.

### 14.6 What we will not claim

Stated plainly, because overclaiming here is worse than the gap:

- **L0 and L1 are not sandboxed.** Process isolation and a classloader boundary are real and are
  not a sandbox. Raw egress and process creation are unenforced `[measured]`.
- **A signature proves authorship, not safety.** A signed extension can be malicious. The
  signature makes it *attributable and revocable*, which is the property that matters at ecosystem
  scale.
- **We do not review extensions.** `featured` means "the harness ran it", nothing more, and the UI
  says so in those words.
- **The WebView capability is powerful and its risk is user-visible**, because it is the one
  capability that cannot be meaningfully constrained while still being useful.

---

## 15. Search aggregation and scope

Mostly built `[measured]`. This section states what the extension platform must preserve, and the
three things it adds.

### 15.1 The shape

`search:start` returns an opening snapshot naming the sources it is about to ask; results,
per-source outcomes and progress arrive as `search:update`; `search:cancel` abandons the rest. A
search across fifteen extension providers is fifteen independent scrapes of third-party sites and
the slowest routinely takes 20–40 s — measured, Cinevood times out at 20 s while ARD answers in
350 ms `[measured]` — so a request/response search spent that entire time showing a spinner over
results it already had.

Making that work required breaking up `searchAll`: it issued **one** batched RPC for every
provider and the sidecar collected the futures in order, so the reply landed at the speed of the
slowest provider no matter how fast the others were. It is one RPC per provider now, capped at 8
in flight `[measured]`.

**Constraint on the platform:** any lane must be able to answer independently and be cancelled
independently. That is why `SearchRequest.signal` is non-optional (§10.3).

### 15.2 Scope is a strict filter, not a preference

The rules, all enforced in `SearchSession.plan()` `[measured]`:

- **Nothing selected** → every enabled provider, plus the metadata catalogues.
- **Providers selected** → exactly those, and **no catalogues**. Catalogue rows in a scoped search
  would reintroduce the sources the user just excluded under a different name.
- **Indexers selected** → those indexers are title-searched. They normally answer at
  source-discovery time, so before this a scope of "just this torrent site" had nothing to ask and
  returned a blank page.

`searchScope.ts` used to widen back to *every* source when the stored selection matched nothing
installed (`kept.length > 0 ? kept : candidates`). Combined with a picker that could offer a name
no provider actually had, that produced the worst possible failure: the user picks one site, the
button reads "1 source", and the app queries all two hundred `[measured]`. Resolution is strict
now and an unresolvable selection is **reported** (`missingProviders` / `missingIndexers`) rather
than quietly ignored.

**Namespaced provider ids (§9.3) make this materially better.** Today the scope identity is the
provider *name*, which is unique only by construction; an id is unique by definition, so a stored
scope survives a display-name change and cannot be silently captured by a different extension.

### 15.3 Origin scope, and why merging needed a binding

Android returns **one search row per provider**, and opening a row binds you to the provider that
produced it. There is no fan-out and no torrent-indexer step at all `[researched]`.

We merge rows, and that merge is right — four providers and three catalogues returning one film
should be one row, not seven. What it lost was the binding, and the loss was expensive (§10.6).
`sourceScope.ts` restores it:

| Scope | Who is asked |
|---|---|
| `origin` (default) | Only the providers whose search results produced this row. No indexers. |
| `all` (explicit) | Every enabled provider and every enabled indexer. |

Four things worth keeping straight `[measured]`:

- A `cs3ext://` row was always right — it is a provider's own result. The divergence only ever
  existed on the merged catalogue row.
- `origin` **widens on its own when there is nothing to scope to**, and reports `scopeUsed: 'all'`
  — which is what stops the UI offering to widen a search that already did. A title opened from
  the home screen was never searched for, so no provider claimed it.
- Widening asks every provider **even when routes are known**; already-known providers are skipped
  per result and the merged list is deduped on `infoHash`.
- The scope is part of the cache key **and** the in-flight key, or a widened run is answered by
  the scoped result that just landed.

### 15.4 What the platform adds

1. **Declared filters (§10.1).** `capabilities.filters` says which filters a provider honours, so
   the facet UI offers only what someone can answer and the host never sends a filter that will be
   ignored. Today a genre filter is applied post-hoc to whatever came back, which quietly turns
   "Horror, 2020s, German" into "whatever the first page happened to contain".
2. **Provider-declared politeness (§10.1).** `sequential` and `minRequestIntervalMs` are honoured
   by the scheduler rather than being the scraper's own `Thread.sleep`. A host that schedules can
   interleave; a plugin that sleeps holds a worker.
3. **Cross-lane fan-out.** L3 addons answer in one HTTP round trip and belong at the front of the
   queue; L0 archives may need a JVM class-loading pass first. The scheduler orders by *expected*
   latency, and expected latency is a measured per-provider number we already keep in
   `providerAnalytics` `[measured]`.

---

## 16. Library, indexing and caching

### 16.1 The caches, and what each is allowed to hold

| Cache | Keyed on | Expiry | Rule |
|---|---|---|---|
| Repository index | URL | ETag + 24 h | Serve stale **and say so, with its age**. A 404 must not empty the extension list. |
| Provider registry | `size:mtime:generation` | until any changes | What each archive registered. Hydrates at launch **without starting the JVM** — 6.6 s → 8 ms `[measured]`. |
| Detail cache | `providerId + handle` | TTL, dropped on load | Metadata. |
| Source cache | `title + season + episode + scope` | **per source** | Magnets never expire; provider links carry a deadline read from the URL or a short TTL `[measured]`. |
| Inspection store | **origin** URL + headers | indefinite | The **measurement** only, never the verdict (§16.3). |
| Image cache | URL + requested size | LRU on disk | §18.4 |
| Search history | — | user-controlled | *Queries*, never results — a cached result set goes stale silently `[measured]`. |

### 16.2 The registry is the reason the app starts

`cs3/providerRegistry.ts` records what each archive registered, keyed on
`size:mtime:generation`. Almost everything the app does with providers needs only their
*descriptions* — the scope picker, the extensions tree, the enable cascade, `cs3ext://`
addressing, provenance, the adult gate — and none of that needs a live JVM object.

The measurements that produced this design, in the order that kills each obvious alternative
`[measured]`:

| Experiment | Result |
|---|---|
| Load all 124 archives (serial `load` RPC) | **66.8 s**, plus a 2.7 s handshake |
| `inspect` all 124 — DEX translate **+** `LinkageAnalyzer` | **1.4 s** (mean 11 ms) |
| Load all, unload all, load all again **in the same JVM** | 57.1 s, then **2.4 s** |
| Load all with 8 concurrent RPCs | 43.5 s — and **176 providers misattributed** |

1. Translation is not the cost. Caching `LinkageAnalyzer` output — the first thing that suggests
   itself — would buy about a second of sixty.
2. Neither is plugin logic or the network. The 57 s is demand-driven **JVM class loading of the
   56-jar runtime classpath**, paid once per process, and mostly disk: a run with the page cache
   hot measured 6.5 s for the same work.
3. And it cannot safely be parallelised, for the reason in D16.

So the fix is not a faster load — it is **not loading before anyone has asked for anything.**

Four properties are load-bearing and generalise to every lane:

- **The runtime generation is part of the key.** The shim and the bridge decide what a plugin *can*
  register, so a row recorded under generation 7 is not an answer about generation 8, even though
  the archive's bytes never moved. For L2 the equivalent is the SDK version.
- **An archive that registers nothing is recorded too.** Extractor-only bundles register no
  provider and there are plenty; treating `[]` as "no record" makes every one pay a full load on
  every launch forever.
- **A failed activation withdraws the row**, or a permanently broken extension is re-advertised,
  fails and is rediscovered once per launch with nothing recording that it is permanent.
- **`loadProviders(force)` clears the cache**, because hydration answers from disk and merely
  clearing the in-memory flag would re-read the same descriptions.

**Rule for any new lane:** if you add a code path that calls a provider, call
`ensureProviderActive` first. A hydrated provider is addressable and has no code running behind
it.

### 16.3 Probes are remembered; verdicts are not

`media/inspectionStore.ts` persists what ffprobe found, keyed on the **origin** URL — never the
proxied one, whose port and token are minted per session and would miss on every restart while
looking like they should hit `[measured]`.

The split is the point. A **measurement** (container, codecs, bit depth, track list) is a fact
about the file and never changes. A **verdict** is a function of that measurement *and this
machine*: the renderer's decoders, whether a GPU encoder exists, whether mpv is installed, which
routing policy is set. Caching the verdict would be the stale-cache bug in its most expensive
form — install mpv, and every previously-played title keeps re-encoding because a record from last
week says so.

Query strings are deliberately **not** stripped to normalise signed URLs: two films behind one
path template would then be served each other's codec lists. A signed URL simply misses and is
re-probed.

This is P3 in storage form, and §12.2's declared codec fields fit the same rule: a declaration may
let us *skip* a probe; it never overwrites one.

### 16.4 The library

`cs3/libraryStore.ts` holds watch state, resume progress, buckets, remembered source choices;
`bookmarkStore.ts` holds saved *detail pages*, deliberately not the same thing — the library keys
on a normalised title so one film from five providers is one entry, which is right for watch
tracking and useless for "reopen the page I was on" `[measured]`.

Two rules the extension platform must not break:

- **Progress records the *page* address, never the playback handle.** `DetailView` recorded
  `episode?.url` — the playback handle — as `progress.mediaUrl`, so a saved row opened blank later
  and read as data rot `[measured]`. `handleKind` (§11.1) makes this a type error.
- **The played source is recorded on playback, not on selection**, after **10 seconds** of real
  playback — which is past every failure that presents as "it started and then stopped". A release
  chosen and then abandoned because it would not start is not one that works `[measured]`.

`PlayedSource` matching is why §12.5's `variantKey` is in the wire format: torrents match on
infohash; everything else matches on the durable triple (provider, normalised release name,
resolution), strictly, because returning the *wrong* release is worse than returning nothing
`[measured]`.

### 16.5 Prefetch

Pressing Play used to begin a fifteen-provider scrape from cold, while the viewer had been reading
the plot for several seconds — the exact window the work could have run in.
`cs3/sourcePrefetcher.ts` uses it `[measured]`.

**The in-flight sharing is what makes this safe rather than harmful**, and it is why
`sharedDiscovery.ts` exists as its own module: warming the cache only helps if pressing Play a
second later *joins* the running discovery. Without that it starts a second identical scrape beside
the first, doubling the load on every community site involved and arriving no sooner. Two rules:

- **Cancellation is by consensus.** Each caller brings its own signal; work stops only when every
  caller has withdrawn. Otherwise closing the detail page — which happens immediately after Play —
  cancels the discovery the player just joined.
- **An aborted run is never joined.** It stays in the map until its promise settles.

The prefetch is deliberately restrained, because opening a detail page is not a commitment to watch
and speculative traffic is the fastest way to get an IP blocked by a scraper target: ~1.2 s settle
delay, nothing when the cache can already answer (a `peek`, so the check neither writes nor
promotes), one at a time, superseding rather than stacking, and switchable off with the cost stated
for metered connections.

---

## 17. External metadata and multi-source ratings

### 17.1 The constraint that shapes this

**The user must not have to obtain an API key.** That eliminates TMDB, Trakt, OMDb, Fanart.tv and
TheTVDB from the *default* configuration outright — a key embedded in a distributed client is both
a licence violation and a key that gets revoked `[measured]`.

What survives keyless `[measured]`:

| Service | Gives | Notes |
|---|---|---|
| **Cinemeta** (`cinemeta-catalogs.strem.io`) | catalogues (`top`/`year`/`imdbRating`), IMDb-keyed, 19 genres, pageable | Popularity from Trakt and TMDB, so the ordering reflects the same signal the keyed services sell |
| **AniList** GraphQL | anime metadata, seasonal, relations, staff | Kept separate from the Animation genre on purpose — "Animation" on IMDb is mostly Western film, and an anime row built from it returns Pixar |
| **TVmaze** | series, episodes, air dates | |
| **OpenSubtitles v3 Stremio addon** | subtitles by IMDb id | keyless |
| **Jikan** (MAL) | anime, ratings | keyless mirror of MyAnimeList |

### 17.2 Metadata providers are extensions

The important structural decision: **an enrichment provider is an extension, not a hardcoded
service.** `homeProviders.ts` / `homeProviderRegistry.ts` already made the home catalogue pluggable
and health-checked `[measured]`; this generalises it.

```ts
export interface MetadataProvider {
  readonly id: string;
  readonly sources: RatingSource[];
  readonly provides: MetadataField[];   // 'ratings'|'people'|'images'|'chapters'|'titles'|'trivia'…
  readonly requiresKey: boolean;
  enrich(detail: MediaDetail, ctx: HostContext): Promise<Partial<MediaDetail>>;
}
```

Three consequences, all good:

- **A user with a TMDB key can install a TMDB extension** and enter the key through the normal
  typed `secret` setting (§9.8). We ship no key and violate no terms; the capability exists for
  whoever wants it.
- **Rotten Tomatoes, Metacritic and Letterboxd become community extensions** rather than things we
  either scrape ourselves or do without. Their terms are their author's problem and their breakage
  is their author's to fix, on the community's release cadence rather than ours.
- **Fanart.tv, MusicBrainz and AniSkip** slot in the same way (§18, §11.11).

### 17.3 The merge

Enrichment runs **after** the provider's own `load` and never overwrites a non-null provider field
without recording that it did. Precedence, per field:

1. The originating provider — it is looking at the page the user is on.
2. An `ExternalIds`-matched enrichment provider, by configured order.
3. Cached prior values.

Rules:

- **Ratings never merge — they accumulate.** Every `Rating` keeps its `source` and `kind` (§11.5).
  Two sources disagreeing is displayed, not resolved.
- **A provider disagreeing about the year is a matching failure, not a data conflict.** This is
  `titleEnricher`'s rule and it is deliberately conservative: a disagreeing year is disqualifying,
  and the similarity bar is high enough that `Avengers` does not match `Avengers: Endgame`
  `[measured]`. An unenriched row is a small loss; a mislabelled one reads as data corruption.
- **Enrichment is asynchronous and the page renders without it** (`partial`, §11.4). It never
  blocks a detail page and never blocks playback.
- **Every enriched field carries its source** in a debug view, because "where did this wrong number
  come from" is otherwise unanswerable across six providers.

### 17.4 Privacy

Nothing about the user leaves the machine for enrichment. A genre picks which public catalogue URL
to fetch and the catalogue is not told who asked `[measured]`. Personalised rows are computed from
genres counted out of the **local** library.

The same rule constrains what the platform stores about extensions: `providerAnalytics` holds
**aggregates only** — no queries, no titles, no viewing history — because provider quality does not
depend on any of them and that file is meant to be shareable `[measured]`. `extensionIssues` holds
no URLs, queries or titles either, because a long-lived file accumulating what someone searched for
is a viewing history under another name `[measured]`.

---

## 18. Artwork pipeline

`[proposed]`. Answers D20.

### 18.1 The model

```ts
export interface Image {
  url: string;
  kind: ImageKind;
  width?: number; height?: number;
  language?: string;         // for text-bearing art; null/"" = textless
  aspectRatio?: number;
  primary?: boolean;
  blurhash?: string;         // a placeholder that is not a grey box
  headers?: Record<string, string>;   // hotlink-protected art needs a Referer, like any other URL
  source?: string;           // which provider supplied it
  vote?: number;
}

export type ImageKind =
  | 'poster' | 'backdrop' | 'fanart' | 'banner' | 'logo' | 'clearart' | 'clearlogo'
  | 'thumb' | 'still' | 'season_poster' | 'season_banner' | 'character' | 'actor'
  | 'disc' | 'gallery';

export interface ImageSet {
  posters?: Image[]; backdrops?: Image[]; logos?: Image[]; banners?: Image[];
  thumbs?: Image[]; stills?: Image[]; gallery?: Image[];
  seasonPosters?: Record<number, Image[]>;
}
```

Upstream has one `posterUrl`, one `backgroundPosterUrl`, one `logoUrl` and `posterHeaders`
`[researched]`. Everything above — sets rather than singles, dimensions, language, textless
variants, season posters, blurhash — is an addition, and each earns its place:

- **Sets, not singles**, so a gallery is possible and so a 300 px poster from a scraper can be
  superseded by a 2000 px one from an enrichment provider without either being deleted.
- **`width`/`height`** so selection can be by size rather than by hope. A 4K backdrop and a
  thumbnail are both "the backdrop" today.
- **`language`** so a textless backdrop can be preferred, which is what a logo overlay needs.
- **`headers`** because artwork is hotlink-protected exactly as often as video is, and this is the
  one place a missing `Referer` produces a broken-image icon rather than an error anyone traces.
- **`blurhash`** because scraped poster URLs expire and 403, and the alternative currently in the
  product is Chromium's broken-image icon in the most-repeated component in the app, or
  `display: none`, which is an empty bordered box `[measured]`.

### 18.2 Selection

Deterministic, so two renders of one title do not disagree:

1. `primary: true` if exactly one is marked.
2. Language: user's locale → textless → English → any.
3. Closest to the requested display size **without going under**.
4. Highest `vote`.
5. Lowest `source` id lexicographically. (A tie-break that is arbitrary but *stable* beats one that
   is arbitrary and varies.)

### 18.3 Fetching

All artwork goes through the same proxy as media, for the same reason (§12.6): `headers` need
applying, and a renderer cannot set `Referer`. Additionally:

- Requests carry a size hint; the proxy may downscale server-side and cache the downscaled copy.
  A 4 MB poster rendered into a 180 px card is 4 MB of bandwidth and decode per card.
- A failed image is **negatively cached** with a short TTL, so a dead CDN does not produce one
  request per scroll.
- `Poster.tsx` owns the fallback; each call site keeps its own, because flattening them to one
  glyph is a worse screen rather than a tidier one `[measured]`.

### 18.4 Cache

Disk LRU under `userData`, keyed `url + requested size`, with a user-visible size cap and a clear
button in Settings. Artwork is the largest cache in a media application and the only one a user
will ever want to reclaim space from.

---

## 19. Networking and performance

### 19.1 One HTTP stack

Every lane's requests go through one main-process client, and that is what makes global policy
possible at all:

```
extension → ctx.http (L2) │ OkHttp-in-sidecar (L0/L1) │ net.fetch (L3)
                          ↓
              CapabilityBroker  → allow-list, method, rate
                          ↓
              SharedHttpClient  → cookie jar, cache, retry, throttle, proxy, TLS profile
                          ↓
              Electron net / undici
```

L0/L1 are the honest exception: OkHttp lives inside the JVM and the broker cannot intercept it
without an OS sandbox (§13.5). Their requests are *observed* (stderr attribution, per-provider
timing) but not *gated*. That asymmetry is stated in the UI (§14.3, §14.6) rather than papered over.

### 19.2 Rate limiting and politeness

Per-host token buckets, shared across extensions, because **the site does not care which extension
is asking**. Three extensions scraping one popular host at their individual limits is one host
being hit at three times the limit.

- Defaults: 4 concurrent per host, 60 requests/minute per host, 8 concurrent per extension.
- `ProviderPolicy.minRequestIntervalMs` and `sequential` tighten but never loosen.
- `429` and `Retry-After` are honoured globally: one extension being told to slow down slows
  everyone on that host, because the next one is about to be told the same thing.
- Backoff is exponential with jitter. Without jitter, twelve providers that all failed at once all
  retry at once.

### 19.3 TLS, and the one measured Android/desktop divergence

`SSLHandshakeException: Received fatal alert: unrecognized_name` appears in sidecar stderr against
some provider hosts `[measured]`. This is a **real Android/JVM difference and not a provider bug**:
a server that does not recognise the SNI name sends a *warning*-level `unrecognized_name` alert,
Android's Conscrypt ignores it, and the stock JVM treats it as fatal.

The documented workaround, `-Djsse.enableSNIExtension=false`, is **not applied and should not be
applied casually** — it disables SNI for every connection, and virtually every CDN in the corpus
needs SNI to serve the right certificate. Trading a handful of hosts for most of them is the wrong
direction. A correct fix is per-connection and belongs in the bridge's HTTP client.

**And the frequency is still unmeasured.** The harness prints only the last 15 lines of sidecar
stderr, so the occurrences seen are a signal, not a rate. `extensionIssues.ts` can now count it
properly `[measured]`; **count it before spending anything on it.**

Separately, `impersonate` (§13.3) requests a TLS/JA3 fingerprint profile. Some hosts fingerprint
the handshake, and a default Node or JVM fingerprint is refused where a browser's is not. Treated
as a **request the host may refuse**, because it needs a curl-impersonate-class stack we do not
ship today.

### 19.4 Cold start

The measured path `[measured]`:

| Stage | Before | After |
|---|---|---|
| Hydrate 117 archives from the registry | 6.6 s | **8 ms** |
| Sidecar started at launch | yes | **no** |
| First search | 57–67 s | provider-lazy |
| Warm the rest | — | background, 4 s after the window opens, serial |

For L2 the equivalent budget is: manifest parse and registry hydration at launch (no JS executed),
realm instantiation on first use (~5 ms `[researched]`), bundle evaluation once per realm.

### 19.5 Budgets

| Operation | Target | Hard cap |
|---|---|---|
| Repository index fetch | < 500 ms | 15 s |
| Extension install (L2) | < 2 s | 60 s |
| Extension activate (L2) | < 50 ms | 5 s |
| `quickSearch` | < 800 ms | 3 s |
| `search` per provider | < 5 s | provider policy, else 30 s |
| `load` | < 3 s | 20 s |
| `loadSources` first source | < 4 s | provider policy, else 60 s |
| Probe per source | 1.6–1.7 s `[measured]` | 20 s |

A provider exceeding its cap is **cancelled, not failed** — `cancelled` is its own non-scored
`FailureKind`, because counting it would rank the *slowest* providers down hardest, since those
are the ones still running when the cancel lands `[measured]`.

### 19.6 Abandoned requests must actually stop

The trap, and it is subtle enough to be worth the space `[measured]`. `pump`'s cleanup called
`reader.releaseLock()`, which detaches the reader and **leaves the body open**. Under Node's fetch
the transfer stops anyway; the main process runs on Electron's `net.fetch`, where the request lives
in Chromium's network service and a detached body does not reliably stop it.

On an origin that ignores `Range` and answers everything with the whole file, each abandoned probe
is therefore a **3.24 GB download still running** — three attempts across three sources is nine of
them, against a link the viewer was already downloading at 4.2 MB/s. That is how a two-second probe
becomes a twenty-second timeout.

The rule for every lane: **cancel the reader, and carry an `AbortSignal` on every upstream fetch,
tied to the client socket.** The signal is what reaches a request still blocked in DNS or TLS,
before there is a body to cancel at all.

A related one: `FastChunkDownloader.probeUrl` called `res.resume()` after reading headers.
`resume()` *discards* data; it does not stop the transfer. Against a Range-ignoring host that meant
5.6 MB pulled in the five seconds after the probe had already returned its answer, competing with
the real download for the same throttled signed URL `[measured]`. Destroy the response and the
request.

---

## 20. Developer experience and tooling

`[proposed]`. This section is the one most likely to decide adoption, because §2.12 established
that the Android toolchain has **no test harness, no mock runtime, no linter, no validator, no
local run, no hot reload and no docs generator** — the inner loop is build, `adb push`, open the
app, search, read logcat.

The goal, stated as a target rather than a hope: **a working provider for a simple site, from
nothing, in under thirty minutes, with no Android SDK, no JDK and no device.**

### 20.1 The inner loop

```bash
npm create cs3-extension@latest my-provider
cd my-provider
npm run dev            # watch + hot reload into a running desktop app
npm test               # fixture-backed, offline, deterministic
npm run lint           # manifest + code + capability coherence
npm run build          # → my-provider-1.0.0.csx, deterministic ZIP
npm run sign           # detached ed25519 signature
npm run publish        # regenerate + sign the index, commit to the builds branch
```

`npm run dev` connects to the desktop app over a local dev channel, installs the bundle as a
**development extension** (unsigned, marked as such, capabilities still enforced), and reloads on
every save. Editing a CSS selector and re-running a search takes about a second, against minutes
today.

### 20.2 The template

```
my-provider/
├── manifest.json
├── src/index.ts          # export default function activate(): Provider[]
├── src/kinox.ts
├── test/search.test.ts
├── fixtures/             # recorded HTTP — see §20.4
├── settings.json
└── package.json          # devDeps: @cs3desktop/sdk, @cs3desktop/cli
```

```ts
import { defineProvider, MediaType } from '@cs3desktop/sdk';

export default defineProvider({
  id: 'com.example.kinox/Kinox',
  name: 'Kinox',
  mainUrl: 'https://kinox.to',
  languages: ['de'],
  types: [MediaType.Movie, MediaType.TvSeries],
  kind: 'direct',

  async search({ query, page = 1, signal }, ctx) {
    const res = await ctx.http.get(`${this.mainUrl}/search`, { query: { q: query, page }, signal });
    const doc = ctx.html.parse(res.body);
    return {
      results: doc.select('.result').map((el) => ({
        providerId: this.id,
        ref: { providerId: this.id, handle: el.attr('href'), handleKind: 'page', type: MediaType.Movie },
        title: el.select('.title').text(),
        year: Number(el.select('.year').text()) || undefined,
        poster: { url: el.select('img').attr('data-src'), kind: 'poster' },
        type: MediaType.Movie,
      })),
      hasMore: doc.select('.pagination .next').length > 0,
    };
  },
});
```

`defineProvider` exists for the type inference — `this.id` and `this.mainUrl` are typed inside the
methods — and for nothing else. It is not a framework.

### 20.3 The CLI

| Command | Does |
|---|---|
| `cs3x new` | scaffold from a template (`provider`, `extractor`, `meta`, `addon`, `ytdlp`) |
| `cs3x dev` | watch, bundle, hot-reload into the app |
| `cs3x test` | run fixture-backed tests |
| `cs3x record <url>` | **hit the real site and save a fixture** (§20.4) |
| `cs3x lint` | manifest schema, capability coherence, SDK misuse, common scraper mistakes |
| `cs3x validate <file>` | full pre-publish check on a built bundle |
| `cs3x build` | deterministic `.csx` |
| `cs3x keygen` | ed25519 keypair **+ a revocation certificate** (§8.5) |
| `cs3x sign` | detached signature |
| `cs3x index` | regenerate + sign `index.json` and `repository.json` |
| `cs3x doctor` | diagnose a broken extension against a running app |
| `cs3x docs` | generate reference docs from the manifest and types |
| `cs3x migrate <plugin.cs3>` | scaffold a `.csx` from an existing archive (§20.7) |

### 20.4 Fixtures matter more than tests

The single most important tooling decision in this document, and it is the one Android's toolchain
has no answer to.

A scraper test that hits the live site is not a test — it fails when the site is down, when the
site changes, when the CI runner's IP is blocked, and when the release the fixture searched for
scrolls off the front page. It fails for reasons unrelated to the code and it therefore gets
ignored, and a test everyone ignores is worse than no test.

`cs3x record` performs the real requests **once** and saves request/response pairs (HAR-shaped)
into `fixtures/`. `cs3x test` replays them, so tests are **offline, deterministic and fast**, and
a failure means the parsing changed.

Three properties make it usable rather than merely correct:

- **Recording is one command and produces a committable artifact.** If recording is hard, nobody
  records, and the fixtures rot.
- **Fixtures ship in the bundle** (optional, §9.1), so *we* can run an author's own tests during
  index validation (§21.3) — CI that proves the extension works with **no live network at all**.
- **`cs3x record --refresh` re-records and shows a diff.** A site redesign becomes a reviewable
  change with the failing selector named, rather than a bug report from a user.

This is the same argument our own media suites make: the inputs were expensive to reproduce and
cheap to encode, every row of the compatibility matrix was measured against a real 25 GB file
behind a provider link that has since expired, and a regression there is silent in the worst way
`[measured]`.

### 20.5 The mock runtime

`cs3x test` runs the provider under the **real** `HostContext`, with `ctx.http` backed by fixtures
and `ctx.storage`/`ctx.settings` in memory. Not a mock of the SDK — the SDK, with I/O swapped. A
mock of the SDK only ever asserts what the author assumed the SDK does.

Assertions the harness makes for free, so an author does not have to write them:

| Check | Catches |
|---|---|
| Every `SearchResult.providerId` is set | the origin-binding bug (§10.6) |
| Every `MediaRef.handleKind` is correct for its handle | the `IllegalArgumentException` class (§11.1) |
| Every `Source` has exactly one address | malformed links |
| Every `Source.kind` matches its declared transport | the URL-sniffing class |
| Every `AudioTrack` has a language | D21 |
| No request to an undeclared host | capability drift |
| No unhandled rejection; the signal is honoured | hangs and leaks |

### 20.6 Debugging

- **`ctx.log`** is attributed and lands in `cs3/diagnostics.ts` with the extension named.
- **Source maps** in the bundle give real stack traces. Bundled scraper stacks are otherwise
  `main.js:1:48211`.
- **`cs3x doctor`** asks the running app what it thinks of an installed extension: tier, registered
  providers, last N failures grouped **by cause**, capability violations, health.
- **The provider inspector** (`F12` in the app, already built `[measured]`) shows live calls,
  timings and raw replies per provider.
- **Grouping by cause is the tool, not a nicety.** Counting free text produces a tally with one
  entry per failure; grouping by cause is what turned 113 load failures into six missing classes
  `[measured]`. `cs3x doctor` groups the same way, using the same taxonomy.

### 20.7 Migration from `.cs3`

`cs3x migrate` does not translate Kotlin to TypeScript — that is not a solved problem and pretending
otherwise wastes an author's afternoon. It extracts what *is* mechanical:

- `manifest.json` (name, version, class name) + the index entry (authors, description, language,
  tvTypes, icon) → a CSX `manifest.json`;
- registered provider and extractor names → `providers[]` / `extractors[]` stubs;
- **hosts observed by running the archive under the sidecar with request logging** →
  `capabilities.network.hosts`, which is the field most tedious to derive by hand and the easiest to
  get wrong;
- a `TODO`-marked skeleton per provider method.

For most authors the right answer is **not to migrate at all**: keep the Kotlin, set
`isCrossPlatform = true`, and ship L1 (§6.3). `cs3x migrate --check` reports whether an archive is
already L1-eligible — i.e. whether `jdeps` would pass — which is a one-command answer to "is this
worth doing".

### 20.8 Documentation

Four documents, and the order is deliberate:

1. **Quickstart** — a working provider in thirty minutes, no theory.
2. **Provider cookbook** — the twenty patterns that cover most sites: pagination, POST search,
   JSON APIs, packed JS, base64 payloads, iframe chains, Cloudflare, signed URLs, `.m3u8` behind a
   redirect, multi-audio releases.
3. **Reference** — generated from the SDK types, so it cannot drift.
4. **Publishing** — repository setup, signing, CI, channels.

Plus a **compatibility page** stating exactly what §2 states: which Android concepts map to which
CSX concepts, and which do not.

---

## 21. Publishing, CI and community governance

### 21.1 The publishing loop

```
author writes  →  cs3x build  →  cs3x sign  →  git push
                                                   ↓
                                    CI: lint · validate · replay fixtures · build
                                                   ↓
                                    cs3x index (regenerate + sign)
                                                   ↓
                                    force-push to the `builds` branch
                                                   ↓
                                    users see the update within the poll interval
```

This is upstream's loop `[researched]` — one Gradle module per extension, CI force-pushing
artifacts plus `plugins.json` to a `builds` branch — with validation, signing and fixture replay
added. **Keeping the loop shape identical is deliberate:** an author who already publishes for
Android recognises every step, and their existing `setRepo`/`buildBranch` configuration carries
over unchanged (§7.5).

A reference GitHub Action ships with the template. Signing uses a repository secret; the private key
never leaves CI. Codeberg, GitLab and Gitea equivalents ship too, because §2.12 established that
upstream's own `setRepo` supports all of them `[researched]` and a "community standard" that only
works on GitHub is a GitHub standard.

### 21.2 The pitch to extension authors

Adoption is the whole risk (§24.2). The honest pitch, all of it checkable:

| What an author gets | Not available on Android |
|---|---|
| No Android SDK, no JDK, no Gradle, no emulator | ✔ |
| Hot reload in about a second | ✔ |
| Offline, deterministic, fixture-backed tests | ✔ |
| A linter and a manifest validator | ✔ |
| Real stack traces via source maps | ✔ |
| `cs3x doctor` against a running app | ✔ |
| Per-provider telemetry: success rate, latency, failure causes | ✔ |
| Signed publishing, so users know it is theirs | ✔ |
| Semver with ranges, so a break can be expressed | ✔ |
| A metadata model that carries crew, multi-ratings, chapters, typed art | ✔ |
| mpv, so 10-bit HEVC and TrueHD just play | ✔ (Android has ExoPlayer; the desktop hole was ours) |

And the L1 pitch, which costs an existing author one line: **set `isCrossPlatform = true`, get
faster and more reliable desktop loading and a badge saying so.**

### 21.3 What CI validates

Run by the author's CI, and again by us before a repository is listed as `featured`:

| Check | Fails the build? |
|---|---|
| Manifest schema | yes |
| `capabilities` in bundle == index | yes |
| `id` well-formed, immutable vs. the previous release | yes |
| `versionCode` strictly increased | yes |
| SDK range satisfiable by at least one released app version | yes |
| Signature verifies against a repository key | yes |
| Deterministic build reproduces the hash | yes |
| Fixture tests pass | yes |
| No undeclared host reached during fixture replay | yes |
| Bundle < 8 MB | yes |
| Capabilities widened vs. previous release | **warn, and label the release** |
| Declared hosts unreachable from CI | warn |
| No changelog for a minor/major bump | warn |

The widening warning is deliberately not a failure — a legitimate feature may need a new host — but
it is *labelled on the release*, so a reviewer or a user sees that this update asks for more than
the last one.

### 21.4 Governance

Deliberately thin, and each rule exists to prevent a specific failure mode:

- **Anyone may publish.** No application, no review, no queue (§5.3).
- **We operate one reference repository** (`cs3desktop/extensions`) with a small number of
  well-tested providers, maintained to demonstrate the standard. It is not privileged in the client
  beyond appearing in the curated list, and that list is data (§7.7).
- **`featured` means the harness ran it.** Same claim `bundled: true` makes today `[measured]`, and
  the UI says so in those words.
- **The denylist is narrow and public.** Named malicious versions, with reasons, visible in
  Settings (§8.7). Never "extensions we dislike".
- **The spec is versioned in public** with an RFC process for breaking changes: proposal, one minor
  release of notice, then the major.
- **Legal posture is unchanged and stated up front.** GPL-3.0. We ship no content, index no
  content, and host no extensions. Repository operators are responsible for what they publish. This
  is the same posture upstream takes and it is the only defensible one for a runtime.

### 21.5 Seeding the ecosystem

An extension platform with no extensions is a spec. Sequenced:

1. **Ship L1 first.** Day one, the entire existing corpus benefits from faster loading and every
   `isCrossPlatform` archive gets the good path. Nobody has to write anything.
2. **Port ten providers ourselves**, chosen for variety rather than popularity — one JSON API, one
   HTML scraper, one Cloudflare-protected, one anime with dub tracks, one IPTV, one torrent
   indexer, one debrid-style addon. These are the cookbook (§20.8).
3. **Publish the reference repository** with those ten, signed, with fixtures.
4. **Approach the five bundled repositories' maintainers** with the L1 flag and the L2 pitch. They
   already ship to our users; they have the strongest reason to care.
5. **Make `cs3x migrate --check` a one-command answer** to "is my archive L1-eligible", so the
   cheapest step is also the most discoverable.

---

## 22. Desktop UX for extension management

The screen already exists and was rebuilt once `[measured]`. This section states what changes.

### 22.1 Two tabs, and a panel that opens where you asked

**Installed** and **Browse**. The third tab is gone: "what does this repository offer?" was a tab,
and reaching it threw away the list the question was asked from — the scroll position, the filter
chips, the neighbouring repositories being compared against. Comparing two catalogues cost three
tab switches. It is a full-width panel under the repository's own card now
(`grid-column: 1 / -1`, so a twenty-extension list does not render inside one 290 px column and
read as belonging to the card's neighbours) `[measured]`.

Search reaches **through** a repository: the query matches the repository's name, description,
language and shortcode **and** the installed extensions and providers underneath it, and the card
says *why* it matched — a result with no visible reason reads as a broken filter `[measured]`.

### 22.2 What each row must say

The hierarchy is **exactly three levels: repository → extension → provider**, and the provider is
the selectable leaf. There is no fourth entity in the model `[measured]`.

| Level | New in CSX |
|---|---|
| Repository | trust state + key fingerprint, channel selector, categories, last-checked, **stale badge with age** |
| Extension | lane badge (`.cs3`/`.csj`/`.csx`/addon/yt-dlp), semver + channel, capability summary, SDK range vs. app, changelog link, health, dependency state |
| Provider | id (not just name), content types, languages, measured success rate and latency, adult flag, enable state **and the responsible ancestor** |

Two existing rules that must survive:

- **`enabled` and `effectivelyEnabled` are separate on every node.** Collapsing them loses what the
  user needs: a provider greyed out because its *repository* is off must not look like one they
  turned off themselves, or clicking its toggle appears to do nothing `[measured]`.
- **`getProviderTree` recomputes the same predicate as `enabledProviderNames`.** If those two ever
  disagree the screen is lying about what a search will ask `[measured]`.

### 22.3 Trust, capability and health, on the row

- **Trust** — ✓ verified (fingerprint on hover) · ⚠ unsigned · ⛔ key mismatch · ⛔ revoked.
- **Capability summary** — one line: *"kinox.to +2 hosts · browser · storage"*. Expandable to the
  full list. The install prompt (§14.3) is the long form; the row is the reminder.
- **Health** — the repository's declared status **and** the user's own measured numbers, side by
  side and labelled as different claims. The local number wins any disagreement, because it was
  measured on this machine.

### 22.4 Updates

- **Extension updates are independent of app updates.** That is the point of the whole platform.
- **Auto-update is on by default within a channel**, off across channels.
- **An update that widens capabilities never auto-applies.** It queues with a badge and shows the
  delta (§9.9). This is the moment a hijacked extension asks for the world.
- **Rollback is one click** on the row, using the retained generation `[measured]`.
- **The changelog is shown** when one exists. Silent version churn is how users learn to ignore
  update notifications.

### 22.5 Failure surfaces

Three surfaces already exist and none can answer the others' question `[measured]`:

| | Shape | Answers |
|---|---|---|
| `Logger` | NDJSON, one file per launch, rotated | what happened, in what order |
| `DiagnosticsLog` | one failure's tuple, capped and windowed | enough to hand to a maintainer |
| `ExtensionIssueLog` | one row per `(cause, source, groupingForm(message))`, durable | **how many distinct things are wrong** |

CSX adds `capability-violation` rows and per-extension attribution for L2 (which is exact, since
every request crosses the broker). The **copy-a-report** button keeps its two sizes, and the small
one stays the default: copying a whole session is wrong in both directions — the recipient has to
find the failure inside it, and the sender has pasted an evening's viewing history into a chat
window without meaning to `[measured]`.

### 22.6 Developer mode

Off by default; a switch in Settings → Advanced.

- Install from a local directory or a `.csx` on disk, unsigned, **badged as a development
  extension** everywhere it appears.
- Hot reload on file change.
- The provider inspector, with raw request/response bodies.
- `cs3x dev`'s local channel is accepted only while this is on.

**A development extension is never silently treated as trusted**, and installing one is a distinct,
explicit action — otherwise "sideload this to fix your problem" becomes the social-engineering path
that walks around §8 entirely.

---

## 23. IPC surface, migration and sequencing

### 23.1 New channels

Per the repo rule, all four change together: the service in `electron/`, `ipcMain.handle` in
`main.ts`, the typed method in `preload.ts`, and the caller in `src/`.

| Namespace | Channels |
|---|---|
| `repo:*` | `list`, `add`, `remove`, `refresh`, `setChannel`, `setEnabled`, `getTrust`, `pinKey`, `getIndex`, `search` |
| `ext:*` | `list`, `install`, `uninstall`, `update`, `rollback`, `setEnabled`, `getManifest`, `getCapabilities`, `grantCapability`, `getSettingsSchema`, `getSettings`, `setSettings`, `getHealth`, `getChangelog` |
| `ext:dev:*` | `installLocal`, `reload`, `watch`, `unwatch` |
| `provider:*` | `list`, `describe`, `getProvenance`, `getAnalytics`, `setEnabled` |
| `sdk:*` | `getVersion`, `getCapabilities` (the host descriptor, §12.7) |
| `trust:*` | `listKeys`, `getDenylist`, `refuseExtension`, `refuseKey` |

Push channels: `repo:update`, `ext:installProgress`, `ext:updateAvailable`, `ext:violation`.

**`ipcSurface.test.mts` must be extended in the same commit.** It pins the channel literals in
`main.ts` against those in `preload.ts` lexically, and it exists because seven channels had silently
stopped matching — `tsc` cannot see them, the two files never refer to each other, and the
user-visible form is always a dead button or a silent no-op `[measured]`. Notably
`binary:setupBinaries` was invoked and never registered, so the first-run component installer
**always failed** — and `ipcRenderer.invoke` on an unregistered channel *rejects*, which
`BinarySetupModal` caught and rendered as a friendly-sounding notice. **A catch that reassures is
worse than no catch.**

### 23.2 Types

`cs3_windows/src/types/csx/` — `provider.ts`, `metadata.ts`, `source.ts`, `manifest.ts`,
`repository.ts`, `host.ts` — imported by `electron/` **and** `src/`, and published as
`@cs3desktop/sdk`. That dual import is intentional and already the pattern `[measured]`.

### 23.3 Coexistence with the current model

| Today | After | Note |
|---|---|---|
| `SitePlugin` | `IndexEntry` | Adapter reads Android indexes into the new shape |
| `PluginData` | `InstalledExtension` | Migrated in place on first run |
| `cs3ext://<name>/<handle>` | `csx://<providerId>/<handle>` | **Both resolve, indefinitely.** Stored bookmarks, library rows and cached sources carry the old form. |
| `LoadResponse` (ours) | `MediaDetail` | Adapter at the sidecar boundary; §11.13 is the mapping |
| `ExtractorLink` (ours) | `Source` | `providerLinks.ts` already reads most of it `[measured]` |
| `providerRegistry` rows | unchanged shape, `lane` added | Generation key covers the migration |

**No user action, no re-download, no re-translation.** `RUNTIME_GENERATION` bumps once for the
adapter, which drops stale translations exactly as designed `[measured]`.

### 23.4 Legacy support horizon

L0 is supported **indefinitely**. Doc 31's drop-in commitment is not time-boxed and this document
does not box it. The corpus is the asset; a deprecation notice against it would be a decision to
throw the asset away.

### 23.5 Sequencing

Each milestone is gated on a **measurement**, not a date (P9).

| M | Scope | Gate |
|---|---|---|
| **M0** | **L1.** Read `artifacts[]` + `jarUrl`/`jarHash`. Load a jar without translating. Badge it. | An `isCrossPlatform` archive loads, registers and scrapes with **zero** `DexTranslator` invocations, and `provider-e2e.mjs` shows no regression on L0 |
| **M1** | **CSX-REPO + trust.** `repository.json`, `index.json`, ed25519 signing, key pinning, channels, `cs3x keygen/sign/index`. Applied to L0/L1 artifacts. | A signed repository installs as `pinned`; a re-signed-with-a-different-key artifact is **refused by name**; an unsigned Android repository still installs as `unsigned` |
| **M2** | **CSX-SDK + L2 runtime.** Types, `HostContext`, QuickJS in a `utilityProcess`, broker, permission enforcement, `settings.json`. Three reference providers. | A `.csx` provider searches, loads and streams end to end; a request to an undeclared host is refused and recorded; a runaway loop is killed without touching the app |
| **M3** | **Tooling.** `create-cs3-extension`, the CLI, fixtures, mock runtime, hot reload, linter, docs. | A developer with no prior context ships a working provider for a chosen site in **under 30 minutes**, measured on a real person |
| **M4** | **Metadata + artwork.** `MediaDetail`, `Rating[]`, `Person[]`, `ImageSet`, chapters, collections. Adapters for L0/L1. Enrichment providers. | A title shows ≥3 attributed ratings, a director, a season poster and skip-intro chapters, with the L0 corpus unchanged |
| **M5** | **L3 + L4.** Stremio addon lane; yt-dlp rule lane. | An existing Stremio addon URL installs and plays; a yt-dlp rule resolves a site nobody wrote a scraper for |
| **M6** | **Ecosystem.** Reference repository, ten ported providers, CI actions, docs site, migration guide. | Three community repositories publish signed CSX extensions |

M0 is worth doing on its own even if nothing after it ever ships. That is the test of a good first
milestone.

---

## 24. Acceptance criteria, risks, open decisions, sources

### 24.1 Acceptance criteria

**Compatibility**

- AC-1 Every currently-installed `.cs3` continues to load, scrape and stream after every milestone.
  Verified by `provider-e2e.mjs` across all bundled repositories, with **no regression** against the
  baseline: 66 providers loaded, 24 answering, 18 links, 16 streams with bytes `[measured]`.
- AC-2 An unsigned Android repository installs and works, labelled `unsigned`.
- AC-3 `cs3ext://` addresses resolve after migration. No bookmark, library row or cached source is
  orphaned.

**Trust**

- AC-4 A signed extension whose signature does not verify is **refused**, naming the key.
- AC-5 An artifact signed by a key other than the pinned one is refused, naming **both**
  fingerprints, with no auto-accept path.
- AC-6 A revoked extension is disabled with its reason shown, and the archive is retained.
- AC-7 Rotation via an old-key-signed repository document succeeds; rotation without it does not.

**Sandbox (L2)**

- AC-8 A request to an undeclared host is refused, recorded as `capability-violation` with the host
  named, and shown on the extension's row.
- AC-9 A redirect to an undeclared host is refused.
- AC-10 An infinite loop is terminated by the interrupt handler; the app is unaffected.
- AC-11 An extension exceeding its memory cap is terminated; other extensions keep running.
- AC-12 An extension cannot read another extension's storage or settings, or any `secret` value.
- AC-13 Loopback and RFC 1918 destinations are refused without `localNetwork`.

**SDK and metadata**

- AC-14 A provider implementing only `search` installs and works; unimplemented methods are never
  called.
- AC-15 `MediaDetail` round-trips every upstream `LoadResponse` field losslessly (§11.13).
- AC-16 A title displays ratings from ≥3 sources, each with its own scale and attribution.
- AC-17 A multi-audio source labels every track with a language.
- AC-18 Chapters drive skip-intro when a source provides them.
- AC-19 A source declaring `container`/`videoCodec`/`channels` skips the probe; a *contradicting*
  probe result **wins** (P3).

**Performance**

- AC-20 Launch does not execute extension code. Registry hydration ≤ 50 ms for 120 extensions.
- AC-21 L2 activation ≤ 50 ms warm.
- AC-22 First search after launch does not regress against the current lazy path.
- AC-23 No abandoned probe leaves an upstream transfer running (§19.6), verified by breaking the fix.

**Developer experience**

- AC-24 A developer with no prior context ships a working provider in **under 30 minutes**.
- AC-25 `cs3x test` runs fully offline and is deterministic across machines.
- AC-26 `cs3x build` is reproducible: same source, same hash, any machine.
- AC-27 `cs3x lint` catches every mistake in §20.5's table.

### 24.2 Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | **Nobody writes CSX extensions.** The Android corpus works; the incentive is weak. | **highest** | L1 first (zero author effort). §21.2's checkable pitch. Port ten ourselves. Approach the five bundled maintainers directly. |
| R2 | The sandbox is too restrictive and real sites cannot be scraped in it. | high | Build three *hard* reference providers (Cloudflare, packed JS, iframe chain) **during** M2, not after. If they cannot be written, the design is wrong and M2 is where we find out. |
| R3 | QuickJS is too slow for heavy parsing. | medium | Parsing is host-side (`ctx.html`, `ctx.crypto.unpack`). The workload is I/O-bound. Measure in M2 against a real scrape. |
| R4 | Two standards fragment the community. | medium | One index publishes both. One repository serves both. `kind`/`artifacts[]` make it one ecosystem, not two. |
| R5 | Signing burdens hobbyist authors. | medium | `cs3x keygen` + a CI secret + a template action. Unsigned stays permitted forever. |
| R6 | Upstream changes `MainAPI` and breaks L0/L1. | medium | Already handled: pinned `library-jvm` 4.8.0, `RUNTIME_GENERATION`, rollback on `T4_BLOCKED`. Track the `pre-release` tag. |
| R7 | Capability prompts train click-through. | medium | Prompt only when there is something to say; the "cannot" list; no prompt for `{}`. |
| R8 | Metadata model grows unbounded. | low | Everything optional; `[custom]` namespaced escape hatch; additions need a named consumer in the UI. |
| R9 | We become a de facto gatekeeper via `featured`. | low | `featured` = "the harness ran it", said in those words; adding a URL by hand is never harder than picking from the list. |
| R10 | The denylist is used for non-security purposes. | low | Narrow by policy, public with reasons, visible in Settings, disable-never-delete. |

### 24.3 Open decisions

Named because they are genuinely open, not because they are hard.

| # | Decision | Recommendation |
|---|---|---|
| O1 | One `utilityProcess` per extension, or one shared with per-extension realms? | **Shared, with realms**, until memory is measured in M2. Per-extension is the safer default and 120 processes is not viable. |
| O2 | Is `.csx` signing **required** for non-development installs? | **No.** Requiring it would make us a gatekeeper (§5.3). Label instead. |
| O3 | Ship `curl-impersonate`-class TLS? | **Not in v1.** Measure `impersonate` refusals first (§19.3), then decide. |
| O4 | Do we host a public extension index? | **No.** We publish a curated *list of repositories* (data, signed). Hosting extensions makes us the arbiter. |
| O5 | Should L3 addons be installable by bare URL, or must they be in a repository? | **Bare URL**, with a clear trust label. That is what a Stremio user expects, and forcing a repository kills the lane's whole advantage. |
| O6 | Do we adopt upstream's integer `status`, or only channels + health? | **Both**, emitted as aliases (§7.3). One document, two ecosystems. |
| O7 | Where does the genre normalisation table live? | **Host data file**, editable without a release, with unmapped genres preserved (§11.10). |
| O8 | Does `Rating` normalisation belong in the SDK or the UI? | **UI**, computed at read time. Storage keeps the published scale (§11.5). |

### 24.4 Sources

**Primary source, read 2026-08-27** — `github.com/recloudstream/cloudstream`, branch `master`:

- `library/src/commonMain/kotlin/com/lagradost/cloudstream3/MainAPI.kt` — `MainAPI`, `LoadResponse`
  and subtypes, `Episode`, `Score`, `ActorData`, `TrailerData`, `SeasonData`, `NextAiring`,
  `TvType`, `SearchQuality`, `DubStatus`, `ShowStatus`, `ProviderType`, `VPNStatus`, `AudioFile`,
  `SubtitleFile`, `MainPageData`.
- `library/src/commonMain/kotlin/com/lagradost/cloudstream3/utils/ExtractorApi.kt` — `ExtractorApi`,
  `ExtractorLink`, `DrmExtractorLink`, `ExtractorLinkPlayList`, `ExtractorLinkType`,
  `loadExtractor`, the `extractorApis` registry and the Levenshtein mirror match.
- `library/src/commonMain/kotlin/com/lagradost/cloudstream3/utils/JsUnpacker.kt` — P.A.C.K.E.R.
  de-obfuscation in the library (§13.2).
- `app/src/main/java/com/lagradost/cloudstream3/plugins/PluginManager.kt` — lifecycle,
  `PREBUILT_REPOSITORIES`, `___DO_NOT_CALL_FROM_A_PLUGIN_loadAllOnlinePlugins`.
- `app/src/main/java/com/lagradost/cloudstream3/plugins/RepositoryManager.kt` — `Repository`,
  `SitePlugin`, `parseRepository`, `parsePlugins`, `convertRawGitUrl`.
- GitHub Releases API — the `pre-release` rolling tag and its `classes.jar` asset (§2.1).

**Primary source** — `github.com/recloudstream/gradle`, branch `master`:

- `CloudstreamExtension.kt` — the `cloudstream { }` DSL, `apiVersion = 1`, `isCrossPlatform`,
  `setRepo` forge support.
- `entities/PluginManifest.kt`, `entities/PluginEntry.kt` — the two schemas.
- `tasks/Tasks.kt` — the `make` Zip, task graph, `writeCacheEntry`.
- `tasks/GenerateManifestTask.kt`, `tasks/MakePluginsJsonTask.kt`,
  `tasks/CompilePluginJarTask.kt`, `tasks/EnsureJarCompatibilityTask.kt` — the `jdeps` gate.
- `README.md` — the Aliucord lineage.

**Documentation** — `recloudstream.github.io/csdocs/` (dev guide; several deep links 404 as of this
date, so the Gradle source is authoritative where they disagree).

**This repository** — `AGENTS.md` (all `[measured]` figures), docs 27, 31, 33–40, 40.1,
`docs/roadmap/android-parity.md`, `docs/roadmap/product-hardening-backlog.md`, and the harnesses
`tools/e2e/provider-e2e.mjs` and `tools/e2e/native-engine-matrix.mjs`.

**External standards referenced** — RFC 8785 (JCS), minisign / ed25519, BCP 47, ISO 3166-1,
SPDX, semver 2.0.0, HAR 1.2, Stremio addon protocol, `quickjs-emscripten`.

---

*End of document. §§7–23 are `[proposed]`. Nothing here is built. §2 and §4 are checkable against
the cited sources; §3 and every `[measured]` figure are checkable against this repository.*






