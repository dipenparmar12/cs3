# 36 — Enabling Provider Execution: What Is Left, In Order

**Generated:** 2026-08-12
**Status:** Work plan. Depends on [35](35-phase1-translation-spike-results.md) (translation proven) and [31](31-cs3-dropin-compatibility.md) (architecture).
**Goal:** every `.cs3` extension the Android community publishes runs on Windows with no maintainer action, and updates itself when its author ships a fix.

---

## 0. A correction before the plan

An earlier summary described the remaining work as *"a CI task, not a code task."* That is wrong and worth stating plainly, because it changes how this gets scheduled.

Fetching `library-jvm.jar` **is** a build step. But having the jar on the classpath only lets a plugin *load*. Actually **calling** a provider is real engineering that does not exist yet, because the provider API is Kotlin `suspend` functions with Kotlin function-type callbacks:

```kotlin
open suspend fun search(query: String): List<SearchResponse>?
open suspend fun load(url: String): LoadResponse?
open suspend fun loadLinks(
    data: String,
    isCasting: Boolean,
    subtitleCallback: (SubtitleFile) -> Unit,
    callback: (ExtractorLink) -> Unit
): Boolean
```
*(`library/src/commonMain/kotlin/com/lagradost/cloudstream3/MainAPI.kt:641-697`)*

A `suspend` function compiles to a method taking a hidden `Continuation` parameter and returning `COROUTINE_SUSPENDED` rather than a value. Java reflection cannot call that usefully, and `loadLinks` additionally requires passing objects implementing Kotlin's `Function1`. Section 4 is therefore a real module, not configuration.

**Honest sequencing: step 1 is a day. Steps 2–5 are the actual work.**

---

## 1. Put `library-jvm.jar` on the sidecar classpath

The provider API is published only through JitPack — not Maven Central — as `com.github.recloudstream.cloudstream:library`. Extension projects declare exactly this (`extensions/build.gradle.kts`).

**What to do**

Add a resolver project whose only job is to download the artifact and its transitive dependencies into `sidecar/runtime/`:

```kotlin
// sidecar/runtime-deps/build.gradle.kts
repositories {
    mavenCentral()
    maven("https://jitpack.io")
}
dependencies {
    runtimeOnly("com.github.recloudstream.cloudstream:library-jvm:<pinned-commit>")
}
tasks.register<Copy>("collectRuntime") {
    from(configurations.runtimeClasspath)
    into(layout.projectDirectory.dir("../runtime"))
}
```

| Decision | Choice | Why |
|---|---|---|
| Version | **Pin a commit, not `-SNAPSHOT`** | `-SNAPSHOT` means the ABI the shim is diffed against can change between two builds of the same source. DROP-10 requires binary compatibility; that is unverifiable against a moving target. |
| Where it runs | CI, once per release; cached | JitPack builds from source on first request and can take minutes or fail transiently. It must not be in the developer inner loop. |
| Failure handling | Build fails loudly | A silently missing API jar produces an app where every extension is blocked — which currently *looks* like a working app with no results. |

**Network note.** JitPack must be reachable from wherever this runs. It is blocked in some sandboxed environments; the artifacts should be cached in the project's own package registry so builds do not depend on JitPack being up.

**Done when:** `sidecar/runtime/library-jvm-*.jar` exists and the sidecar's `status` RPC reports `canExecute: true`.

---

## 2. Bundle the third-party runtime

Providers do **not** ship their dependencies inside the `.cs3` — they are `compileOnly` against the host. The host must supply them. This list is measured from the translated bytecode of all 392 plugins ([35](35-phase1-translation-spike-results.md) §5), not guessed:

| Library | Plugins referencing | Source |
|---|---|---|
| `com.lagradost.nicehttp` (Requests/NiceResponse) | 388 | JitPack (`com.github.Blatzar:NiceHttp`) |
| okhttp3 / okio | 388 | Maven Central |
| Jsoup | 315 | Maven Central |
| Jackson databind + module-kotlin | 231 | Maven Central |
| org.json | 118 | Maven Central |
| kotlin-stdlib, kotlinx-coroutines | all | Maven Central |
| xmlpull | 37 | Maven Central |
| fuzzywuzzy | 27 | Maven Central |
| ktor-http | 15 | Maven Central |
| Gson | 13 | Maven Central |
| Ksoup | 7 | Maven Central |
| Rhino (JS engine) | 6 | Maven Central |

**Version pinning matters more than it looks.** Providers were compiled against whatever the Android app shipped. A major-version drift in Jackson or okhttp produces `NoSuchMethodError` at the moment a provider runs, not at build time. Mirror the versions in upstream's `app/build.gradle.kts` and `gradle/libs.versions.toml`.

`com.google.android.material.*` appears in 35 plugins — it is **not** bundled. It only appears in settings dialogs, which are out of scope per DROP-18.

---

## 3. Build `cs3-app-shim.jar`

The 22 `:app` types from [31](31-cs3-dropin-compatibility.md) §2.4. Bytecode measurement confirms the ones that actually matter:

| Symbol | Plugins | Treatment |
|---|---|---|
| `plugins.Plugin` | 324 | The loader's own base type — **the single blocking dependency today** |
| `plugins.BasePlugin` | (via Plugin) | Same |
| `plugins.PluginManager` | 55 | Registration entry points only |
| `plugins.RepositoryManager` | 52 | Reimplement |
| `network.CloudflareKiller` | — | Needs the WebView bridge (§7) |
| `utils.DataStoreHelper`, `AcraApplication.getKey/setKey` | — | Bridge to the sidecar's storage broker |
| `CommonActivity.showToast` | — | Host notification over RPC |
| `MainActivity`, `CloudStreamApp` | — | Inert; exist only to satisfy the linker |

**DROP-10 is not optional.** These signatures must be binary-compatible with upstream's. A drift breaks translated bytecode at *link* time, inside the user's app, not at build time. Add an automated ABI diff (`japicmp` or `revapi`) against the pinned `library-jvm.jar` in CI, and a scheduled job that diffs against upstream `master` and opens an issue on drift (DROP-11).

---

## 4. The Kotlin bridge — the real remaining work

**Write this module in Kotlin, not Java.** Bridging `suspend` functions and `Function1` callbacks from Java means hand-constructing continuations and reimplementing what the Kotlin compiler generates for free. In Kotlin it is ordinary code:

```kotlin
// sidecar-bridge/src/main/kotlin/.../ProviderBridge.kt
class ProviderBridge(private val api: MainAPI) {

    fun search(query: String, timeoutMs: Long): List<SearchResponse> =
        runBlocking { withTimeout(timeoutMs) { api.search(query) } } ?: emptyList()

    fun load(url: String, timeoutMs: Long): LoadResponse? =
        runBlocking { withTimeout(timeoutMs) { api.load(url) } }

    fun loadLinks(data: String, timeoutMs: Long): LinkResult {
        val links = mutableListOf<ExtractorLink>()
        val subs = mutableListOf<SubtitleFile>()
        runBlocking {
            withTimeout(timeoutMs) {
                api.loadLinks(data, false, { subs += it }, { links += it })
            }
        }
        return LinkResult(links, subs)
    }
}
```

Notes that will bite if skipped:

- **`loadLinks` returns results by callback, not by return value.** It is a `Boolean`-returning function that fires `callback(link)` zero or more times. Treating the boolean as "did it work" and ignoring the callbacks yields a provider that always appears to return nothing.
- **`withTimeout` is the right kill mechanism**, not thread interruption. A provider hung on a socket read is the common case and coroutine cancellation handles it cleanly.
- **`search(query)` vs `search(query, page)`.** The paginated overload delegates to the single-argument one by default; call the one the provider overrode, or you get `NotImplementedError` from the base class.
- **`NotImplementedError` is normal.** Base implementations throw it. A provider that does not implement `quickSearch` is not broken — catch it and treat it as "unsupported", not as a failure.

Then extend the RPC surface: `search`, `quickSearch`, `load`, `loadLinks`, `getMainPage`, each keyed by loaded plugin ID, each with the per-call timeout the supervisor already enforces.

Finally, replace `PluginManager.searchAll`/`loadMedia`/`loadLinks` in the Electron main process — they currently return empty, correctly and deliberately — with calls into this surface, and merge provider results alongside the existing torrent pipeline in `ContentService`.

---

## 5. Ship a JRE (DROP-31)

`jlink` a minimal runtime into `sidecar/jre/`. The supervisor already prefers `<resourceDir>/jre/bin/java` and only falls back to `PATH` in a dev checkout, so nothing else changes. Target: installer under 250 MB (AC-D8). Use a GPL-compatible build such as Temurin (DROP-32), and cover the sidecar jars with the same Authenticode signature as the app (DROP-33).

---

## 6. Close the sandbox gaps

The sidecar reports these honestly today rather than implying coverage:

| Gap | Fix |
|---|---|
| DROP-23 — no network egress control | Launch the sidecar inside a Windows job object with a restricted token; route all HTTP through the host's `NetworkBroker` |
| DROP-24 — process creation reachable | Same job object, `JOB_OBJECT_LIMIT_ACTIVE_PROCESS = 1` |

`SecurityManager` is not an option (JEP 411/486, DROP-25). This must be OS-level.

---

## 7. The WebView bridge (DROP-13..17)

`WebViewResolver.jvm.kt` is `TODO("Not yet implemented")` upstream — **the JVM actual is a stub, so this must be built, not inherited.** 25 plugins reference `android.webkit.WebView` and `CloudflareKiller` depends on it.

Marshal to an offscreen Electron `BrowserWindow` per DROP-13: apply `interceptUrl`/`additionalUrls` matching, run any custom script, return the matched request. Destroy on 60s timeout and on unload (DROP-14); isolated session partition per plugin (DROP-15).

This remains the largest piece of net-new work with no upstream reference to copy. It is deliberately **last**: ~93% of providers do not need it, and shipping the other 93% first is worth more than shipping none of them.

---

## 8. Order, and what each step buys

| # | Step | Effort | Unblocks |
|---|---|---|---|
| 1 | Fetch `library-jvm.jar` in CI | ~1 day | Plugins **load**; tier stops being T4 for everything |
| 2 | Bundle third-party runtime | ~1 day | Plugins load without `NoClassDefFoundError` |
| 3 | `cs3-app-shim.jar` + ABI diff | ~1 week | `Plugin`/`BasePlugin` resolve — the current hard blocker |
| 4 | **Kotlin bridge + RPC + ContentService wiring** | **~2 weeks** | **Providers actually return results.** This is the milestone that makes the app work |
| 5 | jlink JRE + signing | ~3 days | Ships to users without asking them to install Java |
| 6 | OS sandbox | ~1 week | The security posture doc 31 §6 promises |
| 7 | WebView bridge | ~2–3 weeks | The last ~7% of providers, incl. Cloudflare-protected |

After step 4, publish measured tier statistics and replace doc 31 §7's projections (DROP-30). **Static analysis predicts; execution decides** (DROP-28) — the sidecar already re-classifies a plugin that analyses as T1 and then throws.

---

## 9. The maintenance story: why the community does nothing

The point of all of the above is that **there is no Windows port for maintainers to maintain.**

| Concern | How it is handled |
|---|---|
| Maintainer publishes a fix | Pushes to their repo's `builds` branch, as today. Nothing else. |
| Windows users get it | The extension updater re-checks repositories, compares versions, downloads the changed `.cs3` into the user's data directory. No app release. |
| Maintainer builds for Windows | **They do not.** The same `.cs3` runs on both platforms; the desktop app translates DEX to JVM bytecode at install time. |
| Maintainer tests on Windows | Not required. The sidecar links upstream's real `library-jvm.jar`, so provider behaviour is upstream's behaviour by construction. |
| A provider breaks on desktop only | The sidecar reports a typed `UnsupportedAndroidApiException` naming the exact API (DROP-7), aggregated across users (DROP-8). That names the gap for *us* to shim — not work for the maintainer. |
| New repository appears | User pastes the URL. Both `repo.json` and bare plugin-list documents are accepted. |

**One-click, from the user's side:** open Extensions → pick a repository → Install. Updates: leave the default daily check on, or press "Update all". Nothing else, ever.

The one thing that *is* on us continuously is **ABI tracking** (DROP-11). Upstream changing an `:app` signature breaks every translated plugin at link time. That is why the scheduled diff against upstream `master` is not optional polish.

---

## 10. Risks that remain open after step 4

| Risk | Mitigation |
|---|---|
| A provider works but returns different links than on Android, unnoticed | Differential corpus test (AC-D7): same provider, same query, Android vs sidecar, compared structurally |
| Third-party version drift causes `NoSuchMethodError` at provider runtime | Pin to upstream's versions; add a smoke test that runs one real provider per major library |
| `library-jvm.jar` pinned commit goes stale vs. what new plugins are built against | The ABI diff job (DROP-11) is the early warning |
| Sidecar cold start delays first search | Spawn lazily but eagerly on app idle, not on first keystroke (AC-D9 targets <3s) |
