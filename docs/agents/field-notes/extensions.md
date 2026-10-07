# Extensions, the sidecar and the android shim — field notes

Dated post-mortems and measurements moved verbatim out of `AGENTS.md` (nothing rewritten). The distilled rules are in `AGENTS.md` §5 and `docs/agents/extensions.md`; read this file when you need the *why* — the measurement behind a number or the failure a rule prevents. Section numbers and cross-references (§5.1, §6.9 …) are unchanged.

## Contents

- (jar-lane preamble — read from the gradle source)
- …and now it does: the cross-platform jar lane (2026-08-28)
- Provider execution: working as of 2026-08-13
- Community extensions: five defects found by running them (2026-08-13)
- Community extensions: the second round (2026-08-13)
- Community extensions: the third round (2026-08-14)
- Community extensions: the fourth round (2026-08-15)
- The bridge was discarding half of what Android hands back (2026-08-21)
- Android vs Windows: where the two actually diverge now (2026-08-19)
- A provider that is gone has to say which extension owned it (2026-08-24)
- The first search cost a minute, and it was never the plugins (2026-08-26)
- Counting the log, from inside the app (2026-08-26)
- Community extensions: the fifth round, and the OTT lane (2026-08-31)
- Provider catalogues: `getMainPage`, finally (2026-08-31)
- The OTT platform destinations (2026-08-31)
- Extension updates: three reasons "Update all" did nothing (2026-09-17)
- A timeout is not a verdict (2026-09-17)
- A mirror cannot make a claim about somebody else's extension (2026-09-19)
- 5.1 The end-to-end harness — `tools/e2e/provider-e2e.mjs`
- The extensions screen: `src/components/extensions/`
- The native provider lane, and why the jar lane stopped being the answer (2026-09-07)
- An extension update that breaks itself is put back
- Diagnosability: a message is not a report
- Adult content is opt-in, and the gate is central
- Sandbox: enforced vs. not
- CloudStream X (CSX), and two shim gaps it found (2026-08-27)
- `InvalidHeader` was every unclassified record (2026-08-27)
- Extensions: browse opens where you asked (2026-08-27)

---

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

**Updates install automatically, on every launch, by default (2026-09-24).** This
section used to say `autoInstall` defaulted to false, on the argument that
swapping trusted code is the user's decision. Android made the other decision,
verified in the upstream source: `settings_updates.xml` declares
`auto_update_plugins` with `defaultValue="true"`, and `MainActivity` runs
`updateAllOnlinePluginsAndLoadThem` on every start. Defaults are now
`policy: 'startup'` (every launch, then daily while open) and `autoInstall:
true`; every install is still loaded before it is accepted and rolled back if it
will not load. `UpdateSettings.chosen` records which values a person actually
set — `saveSettings` had persisted the defaults as a side effect, so a stored
`false` was not evidence of a choice. The control is in `ExtensionUpdates`;
`saveUpdateSettings` had been exposed and called by nothing.

**Bookkeeping never re-arms the timer.** `doCheck` recorded `lastCheckedAt`
through `saveSettings`, which re-armed the schedule — under `startup` that was a
30-second timer, so every repository was re-fetched every 30s. `record()` writes
without scheduling; only a change made in Settings re-arms.

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

### Extensions: browse opens where you asked (2026-08-27)

"What does this repository offer?" was a third tab, and reaching it threw away the list the
question was asked from — the scroll position, the filter chips, and the neighbouring
repositories being compared against. Comparing two catalogues cost three tab switches. It is
now a full-width panel under the repository's own card (`grid-column: 1 / -1`, so a
twenty-extension list does not render inside one 290px column and read as belonging to the
card's neighbours), and the tab is gone. Four tabs remain (`ExtensionsScreen.tsx` `TABS`, verified 2026-10-07): **Installed**, **Browse**, **Built-in Sources**, **Updates**.

**Search reaches through a repository.** The query matched a repository's own name,
description, language and shortcode and nothing else — so looking for a provider you know you
have found nothing, even with the repository carrying it on screen. It now also matches the
installed extensions and providers underneath, and the card says *why* it matched: a result
with no visible reason reads as a broken filter.

