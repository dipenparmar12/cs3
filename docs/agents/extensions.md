# Extensions, the sidecar and the android shim

Domain notes for CloudStream 3 Desktop, covering §5 — the `.cs3` extension story.

**Read `AGENTS.md` first.** It carries the repository map, the build and test commands, the
IPC contract, the service table and the rules that cut across every area. This file assumes it.

Section numbers here match `AGENTS.md`'s, so a cross-reference like `§6.10` resolves whichever
file you are in. **If this contradicts the code, the code wins — fix this file in the same commit.**

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
