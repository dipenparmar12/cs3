# 31 — `.cs3` Drop-In Compatibility (JVM Sidecar)

**Generated:** 2026-08-12
**Baseline:** CloudStream Android commit `a72f9e6c` (4.8.0) · community repositories as vendored in `repositories/` on 2026-08-12
**Status:** Ratified architecture. Supersedes the "providers must be rewritten" premise in earlier revisions of [27](27-plugin-and-extension-architecture.md).
**Decision:** ADR-12 — Electron host + bundled JVM sidecar. Recorded 2026-08-12.

---

## 1. The requirement

> Existing `.cs3` extensions, built by existing maintainers with existing Gradle tooling, install and run on CloudStream Desktop for Windows **without source changes, without a rebuild, and without maintainer action**.

This document specifies how that is achieved, what fraction of the ecosystem it actually covers, and what it explicitly does not cover.

It exists because "drop-in" is a product commitment with a hard technical precondition: **`.cs3` plugins are JVM-shaped code, so the desktop app must contain a JVM.** Everything below follows from that.

---

## 2. Why this is feasible — the evidence

Earlier revisions of this PRD asserted that `.cs3` files could never run on desktop (finding F-1). That assertion was **correct about Node.js and V8, and wrong as a statement about desktop**. The distinction matters, and the evidence now available makes the feasible path concrete.

### 2.1 The provider API already has a JVM build

`:library` is a Kotlin Multiplatform module that **declares a `jvm()` target today** and ships JVM actuals for every platform-specific declaration:

| JVM actual | File |
|---|---|
| `Log` | `library/src/jvmMain/kotlin/com/lagradost/api/Log.kt` |
| `getContext`/`setContext` | `library/src/jvmMain/kotlin/com/lagradost/api/ContextHelper.jvm.kt` |
| `WebViewResolver` | `library/src/jvmMain/kotlin/com/lagradost/cloudstream3/network/WebViewResolver.jvm.kt` |
| `Coroutines` | `library/src/jvmMain/kotlin/com/lagradost/cloudstream3/utils/Coroutines.jvm.kt` |
| `SubtitleHelperPlatform` | `library/src/jvmMain/kotlin/com/lagradost/cloudstream3/utils/SubtitleHelperPlatform.jvm.kt` |

**Evidence.** `library/build.gradle.kts:23-42` (`android { }` and `jvm()` targets declared); `library/src/jvmMain/` (5 files). **Confidence: High.**

**Consequence.** `MainAPI`, `ExtractorApi`, `M3u8Helper`, `SubtitleHelper`, the extractor catalogue, `newMovieSearchResponse` and the rest of the provider-facing surface are **not reimplemented** by the desktop app. The sidecar links the real `library-jvm.jar`. Provider behavior is upstream's behavior, by construction.

### 2.2 Providers already compile against a partly-JVM classpath

Upstream's `makeJar` task — the task that produces the `classes.jar` every provider compiles against — merges the Android `:app` classes with **`library-jvm.jar`**, not with an Android library artifact.

**Evidence.** `app/build.gradle.kts:305-317` (`copyJar` depends on `:library:jvmJar`, includes `library-jvm*.jar`), `:319-325` (`makeJar` zips `classes.jar` + `library-jvm.jar`). **Confidence: High.**

The provider ecosystem is therefore already, today, written against a classpath whose provider-API half is a JVM artifact.

### 2.3 The Android surface providers actually touch is small and stubbable

An automated survey of all 26 vendored community repositories (1,009 Kotlin files, 325 Gradle modules, 303 `@CloudstreamPlugin` entry classes, 299 `MainAPI` subclasses, 110 `ExtractorApi` subclasses):

**`MainAPI` provider classes — Android dependency profile**

| Category | Files | Share |
|---|---|---|
| Zero `android.*` imports | 202 | **67.6%** |
| Any `android.*` import | 97 | 32.4% |
| …of which touch the Android **UI toolkit** (`view`/`widget`/`graphics`/`app`/`text`) | 8 | **2.7%** |
| …of which touch `android.webkit` | 7 | **2.3%** |

**`ExtractorApi` classes:** 82 of 110 (**74.5%**) have zero `android.*` imports.

**The complete `android.*` import histogram across all 299 provider classes** is dominated by five trivially stubbable entries:

| Import | Occurrences | Stub difficulty |
|---|---|---|
| `android.util.Log` | 77 | Trivial — delegate to the attributed logger |
| `android.util.Base64` | 16 | Trivial — `java.util.Base64` + Android flag semantics (`NO_WRAP`, `URL_SAFE`, `NO_PADDING`) |
| `android.content.SharedPreferences` | 8 | Small — map to the per-plugin `StorageBroker` |
| `android.webkit.CookieManager` | 6 | Small — map to the `NetworkBroker` cookie jar |
| `android.content.Context` | 4 | Small — an inert token object; see §5.3 |

Everything below `android.content.Context` in the histogram occurs in **3 files or fewer**.

**Reading.** Stubbing `Log`, `Base64`, `Context`, `SharedPreferences` and `CookieManager` alone brings the covered share of `MainAPI` providers to **≈93%** before any WebView or UI work is done at all.

**Evidence.** Survey over `repositories/**/*.kt`, 2026-08-12. Reproduce with `npx @cloudstream/cli analyze --all` ([27](27-plugin-and-extension-architecture.md) §8.5, DX-4). **Confidence: High** for the counts; **Medium** for the inference that import presence predicts runtime success — a file can import `Context` and never dereference it, and can avoid the import while depending on Android behavior transitively. §7 exists because of that gap.

### 2.4 The `:app` surface providers touch is a bounded, enumerable list

283 distinct `com.lagradost.*` imports appear across the 26 repositories. Resolved against the upstream source tree by declaration site:

| Resolves to | Count |
|---|---|
| `:library` (already has a JVM build — §2.1) | 122 |
| `:app` (**must be provided by the sidecar**) | 22 |
| Member/extension imports resolving into the library root | 139 |

The 22 `:app` symbols are the entire application-side compatibility surface:

| Symbol | Sidecar treatment |
|---|---|
| `AcraApplication` | Stub; `getKey`/`setKey` route to `StorageBroker` |
| `CloudStreamApp` | Stub |
| `CommonActivity` | Stub; `showToast` routes to a host notification IPC |
| `MainActivity` | Stub |
| `network.CloudflareKiller` | **Reimplement** — depends on `WebViewResolver` (§5.4) |
| `plugins.Plugin` | Reimplement — the sidecar's own loader base type |
| `plugins.PluginManager` | Reimplement — registration entry points only |
| `plugins.RepositoryManager` | Reimplement |
| `syncproviders.AccountManager` · `AuthData` · `SyncAPI` · `SyncRepo` | Bridge to the host's sync services over IPC |
| `utils.DataStoreHelper` | Bridge to `StorageBroker` |
| `utils.ImageLoader` | Stub — returns descriptors; the renderer loads images |
| `utils.txt` | Stub — string/`UiText` shim |
| `ui.player.*` (4) · `ui.settings.*` (2) · `ui.*` (1) | §5.5 — `openSettings` / `registerVideoClickAction` |

**Evidence.** Import extraction over `repositories/**/*.kt` resolved against `cloudstream_ref_android/{app,library}/src`, 2026-08-12. **Confidence: High.**

**This is the single most important number in this document.** The compatibility shim is not "reimplement Android" — it is **22 named types plus 5 `android.*` stubs**, against a provider API that already builds for the JVM.

---

## 3. Architecture

```
┌─ ELECTRON MAIN (Node.js, full privilege) ─────────────────────────┐
│  ExtensionManager · NetworkBroker · StorageBroker · Supervisor     │
└──────┬─────────────────────────┬──────────────────────┬───────────┘
       │ contextBridge IPC       │ child_process        │ child_process
       │                         │ + typed JSON-RPC     │ + typed JSON-RPC
┌──────▼──────────┐   ┌──────────▼──────────┐   ┌───────▼───────────┐
│ RENDERER (UI)   │   │ V8 PLUGIN HOST      │   │ JVM SIDECAR       │
│ contextIsolation│   │ TS SDK + KMP/JS     │   │ Runtime 3         │
│ sandbox: true   │   │ (Runtimes 1 & 2)    │   │ .cs3 DROP-IN      │
│ no provider code│   │                     │   │                   │
└─────────────────┘   └─────────────────────┘   └───────────────────┘
                                                          │
                                    ┌─────────────────────┴────────┐
                                    │ jlink'd JRE 17 (bundled)     │
                                    │ library-jvm.jar (upstream)   │
                                    │ cs3-app-shim.jar (22 types)  │
                                    │ cs3-android-shim.jar         │
                                    │ dex→class translator         │
                                    │ SecurityManager-free sandbox │
                                    └──────────────────────────────┘
                                                          │ IPC
                                    ┌─────────────────────▼────────┐
                                    │ OFFSCREEN BrowserWindow      │
                                    │ WebViewResolver / Cloudflare │
                                    └──────────────────────────────┘
```

### 3.1 Load sequence — Android parity, step by step

| # | Android (`PluginManager.kt`) | JVM sidecar |
|---|---|---|
| 1 | Download to cache, verify `sha256-<hex>` from `fileHash` | **Identical** — same repository JSON, same hash check |
| 2 | Atomic move to `<filesDir>/Extensions/<sanitize(repo)>.<hash>/<sanitize(name)>.<hash>.cs3` | **Identical path grammar**, rooted at `%APPDATA%\<App>\extensions` ([29](29-platform-compatibility.md) §2) |
| 3 | Set file read-only | Identical |
| 4 | `PathClassLoader(filePath, appClassLoader)` | `URLClassLoader` over the **translated** archive (§4), parented to the shim classpath |
| 5 | Read `manifest.json` *through the class loader* | Identical — same ordering, so a plugin shipping its own `manifest.json` resource behaves the same |
| 6 | `loadClass(manifest.pluginClassName)` | Identical |
| 7 | Reflective no-arg construction | Identical |
| 8 | `AssetManager` via reflection when `requiresResources` | §5.6 — resource table shim |
| 9 | `load(context)` | `load(shimContext)` (§5.3) |
| 10 | Self-registration via `registerMainAPI` / `registerExtractorAPI` / `registerVideoClickAction` | Identical; registrations are marshalled to the host over IPC |

**Requirement DROP-1 (P0).** The install path grammar, the SHA-256 verification, the read-only step, and the manifest-through-classloader read order are reproduced exactly. Deviating from step 5 in particular changes which `manifest.json` wins for plugins that ship one as a resource.

### 3.2 Why a sidecar and not in-process

| Reason | Detail |
|---|---|
| Language | The JVM cannot be hosted inside Node.js without a native bridge that would itself become the largest source of crashes. |
| Isolation | [02](02-system-architecture.md) ARCH-3 requires that a plugin-host crash degrade to "provider unavailable". A separate OS process is the only mechanism that delivers this unconditionally. |
| Kill semantics | PLG-S-5 requires hard per-call timeouts. Killing a process is reliable; interrupting a JVM thread is not. |
| Startup cost | The sidecar is spawned lazily on first provider use, so it does not enter the PERF-1 cold-start budget (DSK-57). |

---

## 4. Bytecode translation

`.cs3` archives contain DEX. The JVM executes `.class`. One translation step bridges them.

| ID | Requirement | Priority |
|---|---|---|
| DROP-2 | DEX→`.class` translation happens **once at install time**, not per load. The translated artifact is cached beside the `.cs3` and invalidated on version or hash change. | P0 |
| DROP-3 | The original `.cs3` is retained byte-for-byte. Uninstall/reinstall and export must reproduce the exact file the user installed. | P0 |
| DROP-4 | Translation failure is a **first-class, reportable outcome**, not a crash: the plugin is marked `TRANSLATION_FAILED` with the offending class named, and the app continues. | P0 |
| DROP-5 | Translation runs in the sidecar, never in the main process, and is subject to the same resource caps as execution. A malicious archive must not be able to exhaust host memory. | P0 |
| DROP-6 | Multi-DEX archives (`classes.dex`, `classes2.dex`, …) are handled. | P1 |

**Implementation note.** Candidate translators are `dex-translator` (Kotlin, in-process, no shell-out) and `dex2jar`. The Phase 1 spike (OQ-27) selects one by running it against a corpus of real `.cs3` files drawn from the 26 vendored repositories. Selection criteria: correctness on Kotlin-generated DEX (default arguments, `suspend` state machines, inline classes), absence of a native dependency, and license compatibility with GPL-3.0.

**Known risk.** Kotlin `suspend` functions compile to state machines whose DEX form is well-trodden, but coroutine-heavy providers are the population most likely to expose translator bugs. Every provider in the ecosystem is coroutine-heavy. **This is the highest-severity unknown in the drop-in plan** — see RISK-D1 in §8.

---

## 5. The compatibility shims

### 5.1 `cs3-android-shim.jar`

Implements the `android.*` surface from §2.3. Not an Android emulator — a targeted stub set.

| Package | Behavior |
|---|---|
| `android.util.Log` | Delegates to the attributed logger; plugin ID is attached automatically. Visible in the Inspector Panel (DX-8). |
| `android.util.Base64` | `java.util.Base64` with Android flag semantics reproduced exactly, including `NO_WRAP`, `URL_SAFE`, `NO_PADDING`, and Android's lenient decoding of unpadded input. |
| `android.content.Context` | §5.3. |
| `android.content.SharedPreferences` | Backed by the per-plugin `StorageBroker` namespace. `Editor.apply()` and `.commit()` both write; `apply()` returns without waiting. |
| `android.webkit.CookieManager` | Reads and writes the `NetworkBroker` cookie jar for the calling plugin. |
| `android.net.Uri` | Parsing/building over `java.net.URI`, preserving Android's tolerance of malformed input. |
| `android.os.Build` | Constant values reported as a **desktop identity**, not a spoofed device — see DROP-9. |
| `android.os.Handler` / `Looper` | Backed by a single-threaded executor per plugin. `Looper.getMainLooper()` returns that executor's looper analogue. |
| `android.widget.Toast` | Routes to a host notification (DX-9). |

| ID | Requirement | Priority |
|---|---|---|
| DROP-7 | Any `android.*` class reached by a plugin but **not** implemented by the shim throws a typed `UnsupportedAndroidApiException` naming the class and method, which the Supervisor reports as a compatibility finding rather than a crash. | P0 |
| DROP-8 | Every such throw is recorded and aggregated. The aggregate is the empirical input that decides which stubs get built next — the shim surface grows from telemetry, not from guesswork. | P1 |
| DROP-9 | `android.os.Build` must not impersonate a real Android device. Providers that gate behavior on API level receive a coherent, stable, honest identity. | P1 |

### 5.2 `cs3-app-shim.jar`

The 22 `:app` symbols from §2.4. Types that bridge to host services (`DataStoreHelper`, `SyncAPI`, `AccountManager`, `CommonActivity.showToast`) marshal over the sidecar's JSON-RPC channel; types that exist only to satisfy the linker (`MainActivity`, `CloudStreamApp`) are inert.

| ID | Requirement | Priority |
|---|---|---|
| DROP-10 | The shim's public signatures are **binary-compatible** with the upstream `:app` classes at the analyzed baseline. A signature drift breaks translated bytecode at link time, not at build time, so this is verified by an automated ABI diff in CI (PLG-V-4). | P0 |
| DROP-11 | The ABI diff runs against upstream `master` on a schedule and opens an issue on drift, so the shim tracks upstream instead of silently rotting. | P1 |

### 5.3 The `Context` object

`load(context: Context)` is the plugin entry point, so a `Context` must exist. The shim provides an **inert capability token**: it carries the plugin's identity, its storage namespace and its broker handles, and it implements the `Context` methods providers actually call (`getSharedPreferences`, `getString`, `getFilesDir`, `getPackageName`). Every other method throws per DROP-7.

| ID | Requirement | Priority |
|---|---|---|
| DROP-12 | The `Context` grants **no ambient authority**. `getFilesDir()` returns a per-plugin scoped directory; there is no path from a `Context` to the user's filesystem, to another plugin's data, or to the host process. | P0 |

Note that `getContext()` in `library/src/jvmMain/.../ContextHelper.jvm.kt` returns `null` upstream. The sidecar overrides this to return the shim token, because ~4 providers dereference it.

### 5.4 WebView — the real gap

`WebViewResolver.jvm.kt`'s `resolveUsingWebView(request, callback)` is `TODO("Not yet implemented")` upstream. Its `intercept` is a pass-through. **The JVM actual is a stub, so this must be built, not inherited.**

20 files across the ecosystem use `WebViewResolver`, and `CloudflareKiller` depends on it.

| ID | Requirement | Priority |
|---|---|---|
| DROP-13 | The sidecar's `WebViewResolver` marshals to an **offscreen Electron `BrowserWindow`** in the host, which performs the navigation, applies `interceptUrl`/`additionalUrls` regex matching, runs any custom `script`, and returns the matched request plus additional requests. | P0 |
| DROP-14 | The offscreen window is destroyed on timeout (`DEFAULT_TIMEOUT` = 60,000 ms, matching upstream) and on plugin unload. A leaked window is a memory leak and a fingerprinting surface. | P0 |
| DROP-15 | The offscreen window runs with `contextIsolation` on, no Node integration, a separate session partition per plugin, and no access to the app's cookies or storage. | P0 |
| DROP-16 | `WebViewResolver.webViewUserAgent` reports the offscreen window's real user agent, so provider logic that echoes it stays consistent. | P1 |
| DROP-17 | `CloudflareKiller` is reimplemented on top of DROP-13 with behavior equivalent to the Android version. | P1 |

**This is the largest single piece of net-new work in the drop-in plan.** It is also the piece with no upstream reference implementation to copy on the JVM side.

### 5.5 Plugin settings and video click actions

30 files call `openSettings`, and `registerVideoClickAction` is part of the `BasePlugin` contract. Both are Android-View-shaped APIs: a plugin inflates a `View` or builds a `Dialog`.

**The Android UI toolkit is not stubbed.** Instead:

| ID | Requirement | Priority |
|---|---|---|
| DROP-18 | A plugin calling `openSettings` with an Android View hierarchy is detected at analysis time (§7) and its settings entry is **disabled with an explanatory message**, rather than crashing when the user taps it. | P0 |
| DROP-19 | A declarative settings schema is offered as the desktop-native alternative: plugins describe settings as typed key/label/kind records, and the renderer draws native controls. Providers that adopt it get working settings on both platforms. | P1 |
| DROP-20 | `registerVideoClickAction` is supported, since the action contract is data (label, icon hint, callback) even though the Android implementation is View-adjacent. | P1 |

**Honest limitation.** A provider whose settings UI is hand-built Android Views cannot render on desktop. Per §2.3 this affects **8 of 299 provider classes (2.7%)**, and it degrades that provider's *settings screen*, not its content. This is the documented cost of the drop-in approach, and it is small.

### 5.6 Resourced plugins

48 references to `requiresResources` appear across the vendored repositories' Gradle files. Android builds these with an `AssetManager` constructed by reflection on `addAssetPath`.

| ID | Requirement | Priority |
|---|---|---|
| DROP-21 | The sidecar reads the plugin's compiled resource table (`resources.arsc`) and serves string, drawable-reference and layout-reference lookups through an `AssetManager`-shaped shim. String and drawable resources resolve; layout inflation does not (§5.5). | P1 |
| DROP-22 | A plugin whose resource use is limited to strings and drawables is classified **fully compatible**, not degraded. | P1 |

---

## 6. Sandbox — the JVM does not get an exemption

The sidecar is a second untrusted-code host. [27](27-plugin-and-extension-architecture.md) §7 applies to it in full, by different mechanisms.

| Control | V8 host mechanism | JVM sidecar mechanism |
|---|---|---|
| No filesystem | No `fs` binding | OS-level process sandbox (Windows AppContainer / job object with a restricted token); the shim exposes only the scoped plugin directory |
| No process spawn | No `child_process` | Job object with `JOB_OBJECT_LIMIT_ACTIVE_PROCESS = 1`; process-creation denied at the OS |
| No raw sockets | Brokered HTTP only | Outbound network denied to the process; **all** HTTP is marshalled to `NetworkBroker` over IPC |
| Memory cap | Isolate heap limit | `-Xmx` plus a job-object commit cap |
| CPU/hang | Isolate termination | Job-object CPU cap + Supervisor kill |
| No native code | No native modules | `-Djava.library.path=` empty; `System.loadLibrary` denied by the shim class loader |

| ID | Requirement | Priority |
|---|---|---|
| DROP-23 | The JVM sidecar has **no direct network egress**. This is enforced by the OS sandbox, not by convention, and is verified by a test that attempts a raw socket connection from inside a plugin and asserts failure. | P0 |
| DROP-24 | `System.exit`, `Runtime.exec`, `ProcessBuilder`, `System.loadLibrary`, and reflection into shim internals are denied by the sidecar's class loader and verified by test. | P0 |
| DROP-25 | Java deprecated and disabled `SecurityManager` (JEP 411/486). The sandbox is therefore **OS-level and class-loader-level**. Any design that assumes `SecurityManager` is invalid. | P0 |
| DROP-26 | One plugin's failure, hang, or OOM does not affect another. The Supervisor may run separate sidecar processes per plugin when a plugin is quarantined or under test. | P0 |
| DROP-27 | Safe mode (`27` §1.5) disables the sidecar entirely, matching Android's behavior. | P0 |

**DROP-25 deserves emphasis.** Android's plugin model relies on the app process boundary for safety and grants plugins app-level privilege — including `MANAGE_EXTERNAL_STORAGE`, annotated "Plugin API" in the manifest. **Drop-in compatibility of the plugin's *code* does not extend to drop-in compatibility of its *privileges*.** A provider that reads arbitrary files on Android fails on desktop, by design. That is a deliberate, non-negotiable divergence.

---

## 7. Compatibility tiers

The analyzer ([27](27-plugin-and-extension-architecture.md) §6.1) classifies every plugin before it runs. Tiers are stated in terms of what the user sees.

| Tier | Definition | Ecosystem share (est.) | User-visible behavior |
|---|---|---|---|
| **T1 — Drop-in** | Translates cleanly; touches only shimmed `android.*` and `:app` symbols; no WebView | ~68% of providers | Works. No indication anything was translated. |
| **T2 — Drop-in with brokered WebView** | T1 plus `WebViewResolver`/`CloudflareKiller` (DROP-13) | ~7% | Works; slower first call while the offscreen window loads. |
| **T3 — Degraded** | Content works; settings UI or a resource-dependent affordance does not (§5.5) | ~3% | Works, with a disabled settings entry and an explanation. |
| **T4 — Blocked** | Reaches an unimplemented `android.*` API (DROP-7), fails translation (DROP-4), or requires native libraries | Unknown until Phase 1 | Not enabled; the specific blocking API is named to the user and reported upstream to the maintainer. |

| ID | Requirement | Priority |
|---|---|---|
| DROP-28 | Tier is computed at install time and **re-verified on first successful call**. Static analysis predicts; execution decides. A plugin that analyzes as T1 and throws `UnsupportedAndroidApiException` is reclassified T4 automatically. | P0 |
| DROP-29 | The tier and its reasoning are shown in the Extension Manager (DX-11). A user must never be left guessing why a provider is missing. | P1 |
| DROP-30 | Aggregate tier statistics across the vendored corpus are published each release as the project's honest compatibility number. **The estimates in the table above are static-analysis projections and must be replaced with measured values after the Phase 1 corpus run.** | P1 |

---

## 8. Risks specific to drop-in

| ID | Risk | Severity | Mitigation |
|---|---|---|---|
| **RISK-D1** | DEX→JVM translation mishandles Kotlin coroutine state machines. Every provider is coroutine-heavy, so this is not a long-tail failure — it would be systemic. | **Critical** | Phase 1 spike (OQ-27) runs the translator against the full vendored corpus and asserts on `suspend` call paths specifically, before any other drop-in work is funded. |
| **RISK-D2** | `library-jvm.jar`'s JVM actuals diverge behaviorally from the Android actuals in ways that change provider results. `WebViewResolver` already does (§5.4). | High | Differential testing (§9, TC-D3): identical provider, identical input, Android vs sidecar, compared output. |
| **RISK-D3** | Upstream changes an `:app` signature and every translated plugin fails to link. | High | DROP-10/DROP-11 automated ABI diff against upstream `master`. |
| **RISK-D4** | Bundling a JRE inflates the installer and triggers Windows SmartScreen heuristics on an unsigned build. | Medium | `jlink` a minimal runtime (§10); EV-sign per XP-29. |
| **RISK-D5** | Drop-in success reduces the incentive to adopt the TypeScript SDK, leaving the app permanently dependent on translated Android bytecode. | Medium | Accepted deliberately. Runtime 3 is the compatibility bridge and the ecosystem's on-ramp; Runtimes 1 and 2 are the destination. `cli migrate` (DX-6) exists to move providers across. |
| **RISK-D6** | A provider works on desktop but returns different links than on Android, and no one notices. | Medium | TC-D3 differential corpus, run in CI against recorded fixtures. |

---

## 9. Acceptance criteria

| ID | Criterion | Priority |
|---|---|---|
| **AC-D1** | A `.cs3` file downloaded from any of the 26 vendored repositories installs and runs on Windows with **no rebuild and no source change**. | P0 |
| **AC-D2** | ≥60% of the 299 surveyed `MainAPI` providers reach tier T1 or T2 and return correct search results against live or recorded fixtures. | P0 |
| **AC-D3** | No plugin, at any tier, can read a file outside its scoped directory, open a socket, spawn a process, or load a native library. Each is a separate passing test (DROP-23/24). | P0 |
| **AC-D4** | A plugin that hangs, OOMs, or crashes the sidecar leaves the app running and the other providers usable. | P0 |
| **AC-D5** | An unsupported `android.*` API produces a named, actionable message — never a stack trace and never a silent empty result. | P0 |
| **AC-D6** | A T4 plugin is never silently enabled. | P0 |
| **AC-D7** | Differential test: for a fixed corpus of provider+query pairs, sidecar output matches Android output structurally (same result count, same URLs, same quality labels). | P1 |
| **AC-D8** | The Windows installer with the bundled JRE stays under 250 MB. | P1 |
| **AC-D9** | Sidecar cold start to first provider response is under 3 s; it does not delay app cold start (DSK-57). | P1 |

**Test cases** are specified as TC-D1..TC-D12 in [30](30-migration-test-cases.md).

---

## 10. Packaging impact (Windows)

| ID | Requirement | Priority |
|---|---|---|
| DROP-31 | The JRE is `jlink`-minimized to the modules the sidecar actually uses and bundled with the app. The user is **never** asked to install Java. | P0 |
| DROP-32 | The bundled runtime is a GPL-3.0-compatible build (Eclipse Temurin or equivalent); the licensing outcome is recorded alongside OQ-23. | P0 |
| DROP-33 | The sidecar executable and JAR are covered by the same Authenticode signature as the app (XP-29). | P0 |
| DROP-34 | The app runs, and clearly reports reduced capability, if the sidecar fails to start — for example when endpoint security blocks it. It must not fail to launch. | P0 |
| DROP-35 | Windows Defender and common endpoint-protection products are validated against the sidecar before release; a bundled JVM spawning a sandboxed child is a shape that triggers heuristics. | P1 |

---

## 11. What drop-in does **not** cover

Stated plainly, so the commitment is not oversold.

| Not covered | Why |
|---|---|
| Plugins that hand-build Android View settings UI | §5.5; ~2.7% of providers, and it degrades settings only |
| Plugins requiring native `.so` libraries | DROP-24; no JNI is permitted into the sandbox |
| Plugins depending on ambient app privileges (arbitrary filesystem access via `MANAGE_EXTERNAL_STORAGE`) | DROP-25; a deliberate security divergence |
| Plugins depending on Android system services (telephony, sensors, package manager, real device identity) | Not present on desktop; DROP-9 refuses to fake it |
| Plugins depending on Android-specific TLS or crypto provider behavior (Conscrypt) | Behavior differs; expected to be rare, unmeasured |
| **Byte-identical output guarantees** | Only structural equivalence is claimed (AC-D7) |

---

## 12. Relationship to the other runtimes

Drop-in is **the on-ramp, not the destination**.

| Runtime | Role | Trajectory |
|---|---|---|
| **Runtime 3 — CS3 JVM (this document)** | Day-one ecosystem availability; zero maintainer action | Supported indefinitely; expected to shrink as providers migrate |
| **Runtime 2 — KMP/JS** | Kotlin maintainers who want one source for Android and desktop | Grows as upstream's KMP work lands (F-2) |
| **Runtime 1 — TypeScript SDK** | New authors; fastest iteration | Grows as new providers are written |

The Gradle bridge (DX-1..3) means a Kotlin maintainer's existing project hot-reloads into the desktop app *through Runtime 3* on day one, then targets Runtime 2 when they choose — without a flag day.

---

## Next steps

1. **Fund and run the Phase 1 translation spike (OQ-27) before anything else in this document.** RISK-D1 can invalidate the whole approach, and it is cheap to test. Run it against the full vendored corpus, not a sample.
2. Build the analyzer (§7) and publish measured tier statistics, replacing the §7 estimates (DROP-30).
3. Build `cs3-android-shim` and `cs3-app-shim` from the §2.3/§2.4 inventories — a bounded, enumerable amount of work.
4. Build the offscreen WebView bridge (DROP-13..17) — the largest net-new component, with no upstream reference to copy.
5. Stand up the differential test harness (AC-D7) early; it is what keeps drop-in honest as both sides move.
