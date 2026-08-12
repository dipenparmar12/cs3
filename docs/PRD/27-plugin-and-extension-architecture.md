# 27 — Plugin and Extension Architecture

**Generated:** 2026-08-10
**Baseline:** commit `a72f9e6c`

**The decisive subsystem.** CloudStream without providers is an empty shell. This document specifies what exists on Android, why it cannot be reused, and what the alternatives cost.

---

## 1. The Android plugin system

### 1.1 Format
A `.cs3` file (a `.zip` also works) containing:
- **Android DEX bytecode** — the compiled provider
- **`manifest.json`** — `name`, `pluginClassName`, `requiresResources`, `version`
- optionally, Android resources when `requiresResources` is true

Built with upstream's Gradle plugin (`github.com/recloudstream/gradle`), compiled against a `classes.jar` that merges `:app` and `:library` classes — produced by the `makeJar` Gradle task.

### 1.2 Distribution
```
Repository URL
  → Repository JSON { iconUrl, name, description, manifestVersion, pluginLists[] }
      → each pluginLists entry → SitePlugin[]
          { url, status, version, apiVersion, name, internalName, authors[],
            description, repositoryUrl, tvTypes[], language, iconUrl,
            fileSize, fileHash }
```
`status`: 0 Down · 1 Ok · 2 Slow · 3 Beta-only. `version` is a monotonically increasing integer; `-1` means always update.

### 1.3 Installation
1. Download to a temp file in the cache directory.
2. If `fileHash` is present, verify SHA-256 (`"sha256-<hex>"`); mismatch → delete and throw.
3. Atomic move into the deterministic install path (`ATOMIC_MOVE`, falling back to a plain move).
4. Record `PluginData{internalName, url, isOnline, filePath, version}` under `PLUGINS_KEY`.

Install path — and this path **is** the installed-detection mechanism:
```
<filesDir>/Extensions/<sanitize(repoUrl)>.<hash(repoUrl)>/<sanitize(internalName)>.<hash(internalName)>.cs3
```

### 1.4 Loading
1. Set the file read-only (Android 14+ requirement).
2. `PathClassLoader(filePath, context.classLoader)`.
3. Read `manifest.json` **through the class loader**, not from the archive directly.
4. `loadClass(manifest.pluginClassName)`.
5. Reflective no-arg construction.
6. If `requiresResources`, build an `AssetManager` via reflection on `addAssetPath`.
7. Call `load(context)`.
8. The plugin self-registers via `registerMainAPI`, `registerExtractorAPI`, `registerVideoClickAction`.

### 1.5 Safety mechanisms
- **Safe mode** — a file named `safe` in `<externalStorage>/Cloudstream3/`, or a recorded prior load error, disables all plugin loading.
- **Recursion guard** — `assertNonRecursiveCallstack()` and `___DO_NOT_CALL_FROM_A_PLUGIN_` prefixes exist because plugins caused infinite recursion by calling loader entry points.
- **Failure isolation** — a load failure toasts and continues; other plugins still load.
- **Local plugins** — `<externalStorage>/Cloudstream3/plugins` is scanned; hot reload is available via the bare `cloudstreamapp:` intent, used by the Gradle `deployWithAdb` task.

### 1.6 What plugins can do
Everything the app can. They run in the app process with app privileges, including `MANAGE_EXTERNAL_STORAGE` — whose manifest comment reads "Plugin API".

**Evidence.** `app/.../plugins/PluginManager.kt:79-108, 178-243, 274-352, 463-536, 571-587, 593-686, 737-806`; `app/.../plugins/RepositoryManager.kt:33-95, 107-240`; `library/.../plugins/BasePlugin.kt:14-78`; `app/.../plugins/Plugin.kt:10-39`; `app/src/main/AndroidManifest.xml:9`; `app/build.gradle.kts:305-325`. **Confidence: High.**

---

## 2. Why this cannot run in Node or V8 — and what that does and does not imply

**Revised 2026-08-12 (ADR-10).** An earlier revision of this section concluded that `.cs3` files could never run on desktop. That conclusion was correct about **Node.js and V8** and wrong as a statement about **desktop**. The corrected reading is below; the full analysis is in [31-cs3-dropin-compatibility.md](31-cs3-dropin-compatibility.md).

### 2.1 The barriers to running `.cs3` in a JavaScript runtime — all real

| Barrier | Detail |
|---|---|
| **Bytecode** | DEX is Dalvik/ART bytecode. Node and Chromium execute JavaScript/WASM. There is no runtime overlap. |
| **Class loading** | `PathClassLoader` is an Android runtime API with no equivalent outside ART. |
| **Android APIs** | Providers may use `Context`, `WebView`, Android crypto providers, resources, and Android-specific I/O. |
| **The library dependency** | Providers compile against `MainAPI`, `ExtractorApi`, jsoup, nicehttp, gson, fuzzywuzzy — a JVM-shaped surface. |
| **Reflection** | Loading depends on reflective construction and, for resourced plugins, reflection on `AssetManager` internals. |

There is no configuration of Node or V8 that executes a `.cs3` file. That remains a hard constraint.

### 2.2 Why it nonetheless runs on desktop

Every barrier in 2.1 is a statement about *JavaScript runtimes*, not about *Windows*. Read against a JVM, the same five rows invert:

| Barrier | Against a JVM |
|---|---|
| **Bytecode** | DEX→`.class` is a one-time, well-understood translation ([31](31-cs3-dropin-compatibility.md) §4). |
| **Class loading** | `URLClassLoader` reproduces `PathClassLoader`'s semantics, including the manifest-through-the-loader read order. |
| **Android APIs** | Empirically small: **67.6%** of the 299 surveyed `MainAPI` providers import no `android.*` at all, and five stubbable classes cover ~93% ([31](31-cs3-dropin-compatibility.md) §2.3). |
| **The library dependency** | Decisive — **the JVM-shaped surface is the point.** `:library` already declares a `jvm()` target and ships JVM actuals, and upstream's own `makeJar` already merges `library-jvm.jar` into the classpath providers compile against. |
| **Reflection** | Ordinary JVM reflection. |

**Consequence.** The desktop app bundles a JVM as a sandboxed sidecar process, and `.cs3` plugins from the existing ecosystem run drop-in — no rebuild, no source change, no maintainer action. The application-side compatibility shim is a bounded list of **22 `:app` types plus 5 `android.*` stubs**, enumerated in [31](31-cs3-dropin-compatibility.md) §2.4.

**What is still true:** drop-in compatibility of a plugin's *code* does not extend to its *privileges*. On Android, plugins run with app privilege including `MANAGE_EXTERNAL_STORAGE`. On desktop they run in an OS-level sandbox with no filesystem, no sockets, and no native code ([31](31-cs3-dropin-compatibility.md) §6). This divergence is deliberate.

---

## 3. What upstream is doing about it

Upstream is not standing still, and their direction is legible from the repository:

- `:library` is Kotlin Multiplatform with `commonMain`, `jvmMain`, `androidMain`, and a populated `webMain` (6 actual files, added 2026-07-15).
- **Zipline** (Cash App's Kotlin/JS-over-QuickJS runtime) replaced QuickJS in commit `#2256`, and is a declared app dependency — though not yet referenced from Kotlin source.
- ~25 subsystems migrated from Jackson to kotlinx.serialization in six weeks.
- `COMPOSE.md` mandates KMP-compatible libraries for all new code.

**Reading.** Upstream appears to be heading toward providers compiled to Kotlin/JS and executed in a QuickJS sandbox via Zipline. If that lands, providers become portable to any host that can run QuickJS — including Electron.

**Confidence: Medium.** The evidence is strong but the intent is not stated in so many words, and no timeline exists.

**Strategic consequence.** Strategy B below is a bet on this. It is the highest-value option if upstream ships, and dead weight if they do not.

---

## 4. Requirements the runtime must satisfy

Regardless of strategy:

| ID | Requirement | Priority |
|---|---|---|
| PLG-1 | Execute provider logic implementing the [07](07-apis-and-contracts.md) §3 contract. | P0 |
| PLG-2 | Stream `loadLinks` results incrementally, not batched. | P0 |
| PLG-3 | Enforce per-operation timeouts from `MainAPI`. | P0 |
| PLG-4 | Isolate failures — one provider cannot affect another or the app. | P0 |
| PLG-5 | Run under the sandbox in §7. | P0 |
| PLG-6 | Support the install/verify/update lifecycle from §1.3. | P0 |
| PLG-7 | Support repository discovery with Android's exact URL grammar. | P0 |
| PLG-8 | Provide per-plugin settings (Android's `openSettings`). | P1 |
| PLG-9 | Support action registration (Android's `registerVideoClickAction`). | P1 |
| PLG-10 | Provide HTML parsing, HTTP, JSON, crypto, and string-similarity utilities equivalent to the Android surface. | P0 |
| PLG-11 | Version the plugin API independently of the app. | P0 |
| PLG-12 | Offer hot reload for development. | P0 |
| PLG-13 | Preserve safe mode. | P0 |
| PLG-14 | Preserve the recursion guard. | P1 |
| PLG-15 | **Execute unmodified `.cs3` artifacts from the existing community repositories** — no rebuild, no source change, no maintainer action. Full contract in [31](31-cs3-dropin-compatibility.md). | P0 |

**PLG-12 raised from P2 to P0 (2026-08-12).** All 325 `build.gradle.kts` files across the 26 community repositories audited in `repositories/` are Kotlin/Gradle projects that already rely on Android's `deployWithAdb` hot-reload intent (§1.6). Every existing maintainer's workflow depends on hot reload today; shipping it late would regress DX for 100% of the current ecosystem, not just new TypeScript authors. See §8.4.

---

## 5. What providers actually need from the host

Derived from the Android dependency surface. **A desktop plugin API missing any of these will break ports even if the app itself works.**

| Capability | Android | Desktop equivalent |
|---|---|---|
| HTTP with full header/cookie control | nicehttp/OkHttp | Brokered client with the same shape |
| HTML parsing and CSS selectors | jsoup / ksoup | cheerio or equivalent |
| JSON parsing | Jackson / kotlinx | Native |
| Regex | Kotlin | Native |
| Crypto (AES, MD5, SHA, base64) | cryptography-kotlin | WebCrypto / Node crypto, exposed safely |
| JS evaluation (unpacking obfuscated scripts) | Rhino, `JsUnpacker`, `JsHunter` | Sandboxed JS evaluation |
| M3U8/HLS parsing | `M3u8Helper` | Equivalent |
| String similarity | Levenshtein, fuzzywuzzy | Equivalent |
| Browser context | `WebViewResolver` | Offscreen isolated `BrowserWindow` |
| Persistent per-plugin storage | DataStore | Scoped key/value store |
| Logging | `Log` | Attributed logging |
| Subtitle language mapping | `SubtitleHelper` | Same tag set |

---

## 6. Multi-Runtime Plugin Architecture & Strategy

To balance ecosystem continuity with long-term desktop sustainability, CloudStream Desktop adopts a **Multi-Runtime Plugin Architecture** managed by a central **Extension Compatibility Layer**:

```
                         CloudStream Desktop
                                  |
                           Extension Manager
                                  |
                    Extension Compatibility Layer
                                  |
          +-----------------------+-----------------------+
          |                       |                       |
          v                       v                       v
     TypeScript               KMP/JS                  CS3 Drop-In
      Runtime                 Runtime                   Runtime
  (@cloudstream/sdk)   (Kotlin Multiplatform)   (bundled JVM sidecar)
          |                       |                       |
     [V8 isolate]            [V8 isolate]      [JVM child process, doc 31]
          |                       |                       |
          +-----------------------+-----------------------+
                                  |
                          CloudStream Plugin API
                                  |
          +-----------------------+-----------------------+
          |                       |                       |
        HTTP                    Parser                Extractor
   (Brokered Client)        (Cheerio/Jsoup)        (ExtractorApi)
```

---

### 6.1 Plugin Compatibility Analyzer

Rather than assuming 100% compatibility for arbitrary `.cs3` binaries, CloudStream Desktop incorporates a **Plugin Compatibility Analyzer**. When a user adds a repository URL or installs a plugin:

1. **Inspection**: The analyzer inspects `manifest.json`, `classes.dex`, class method references, Android OS API imports (`Context`, `SharedPreferences`, `Log`, `AssetManager`), reflection usage, and native C/C++ libraries.
2. **Compatibility Report**: Generates a structured `PluginCompatibilityReport` assigning one of the four tiers defined in [31](31-cs3-dropin-compatibility.md) §7:
   * **T1 — Drop-in** (~68% of surveyed providers): translates cleanly, touches only shimmed APIs.
   * **T2 — Drop-in with brokered WebView** (~7%): additionally uses `WebViewResolver`/`CloudflareKiller`.
   * **T3 — Degraded** (~3%): content works; Android-View settings UI does not.
   * **T4 — Blocked**: unimplemented `android.*` API, translation failure, or native library dependency.

   TypeScript and KMP/JS plugins bypass tiering entirely — they are native to Runtimes 1 and 2.

   **These shares are static-analysis projections over the 26 vendored repositories and must be replaced with measured values after the Phase 1 corpus run (DROP-30).**
3. **Automatic Runtime Selection**: The Extension Manager selects the appropriate isolated runtime transparently based on the report.

---

### 6.2 The Three Official Plugin Runtimes

#### Runtime 1: Primary Desktop TypeScript SDK (`@cloudstream/sdk`)
* **Target Audience**: Web developers, community creators, and rapid prototyping.
* **Mechanism**: Runs pure JS/TS modules in a V8 isolated context.
* **API Surface**: Clean-room TypeScript API mirroring `MainAPI` (`search`, `load`, `loadLinks`, `ExtractorApi`).
* **Performance & Security**: Zero JVM overhead, fast boot time, 100% sandboxed.

#### Runtime 2: Official Kotlin Multiplatform (KMP/JS) SDK
* **Target Audience**: Existing CloudStream Kotlin contributors sharing code between Android and Desktop.
* **Mechanism**: Compiles Kotlin source to Kotlin/JS modules targetable to both Android and Desktop.
* **Upstream Alignment**: Matches upstream's cross-platform roadmap (`COMPOSE.md`).

#### Runtime 3: CloudStream CS3 Drop-In Runtime (bundled JVM sidecar)
* **Target Audience**: The **entire existing ecosystem** — all 303 `@CloudstreamPlugin` entry classes across the 26 vendored community repositories, unmodified.
* **Mechanism**: Install-time `classes.dex` → Java `.class` translation, loaded by a `URLClassLoader` in a sandboxed JVM child process, linked against upstream's real `library-jvm.jar` plus `cs3-app-shim.jar` (22 types) and `cs3-android-shim.jar` (5 core stubs).
* **Positioning**: **The day-one path to a populated app, not a fallback.** Runtimes 1 and 2 are where the ecosystem is going; Runtime 3 is how it gets there without a flag day. Supported indefinitely, expected to shrink as providers migrate.
* **Full specification**: [31-cs3-dropin-compatibility.md](31-cs3-dropin-compatibility.md).

**Revised 2026-08-12 (ADR-10).** This runtime was previously described as a "compatibility-only fallback layer". That framing understated it: without Runtime 3 the app ships with no content, because Runtimes 1 and 2 have zero providers on day one. Runtime 3 is P0.

---

## 7. Sandbox & Security Model (P0 Constraint)

Plugins are third-party untrusted code and **MUST NEVER** have unrestricted access to the host operating system.

```
┌─ MAIN PROCESS ────────────────────────────────────────────┐
│  ExtensionManager   install, verify, analyze, enable/disable│
│  NetworkBroker      policy, attribution, rate limiting     │
│  StorageBroker      per-plugin scoped key/value store      │
│  Supervisor         spawn, timeout, kill, quarantine       │
└───────────────┬───────────────────────────────────────────┘
                │ typed IPC (schema-validated both directions)
┌───────────────▼───────────────────────────────────────────┐
│  ISOLATED PLUGIN HOST                                     │
│    ❌ require / import of host Node modules  ❌ process      │
│    ❌ filesystem (fs)                        ❌ child_process│
│    ❌ raw network sockets                    ❌ Electron APIs│
│    ❌ native binary modules                  ❌ env vars    │
│    ✅ brokered HTTP      ✅ scoped storage                 │
│    ✅ HTML/JSON parsing  ✅ crypto primitives              │
│    ✅ attributed logging ✅ sandboxed JS isolate           │
└───────────────────────────────────────────────────────────┘
```

| ID | Security Control | Priority |
|---|---|---|
| PLG-S-1 | No access to Node.js `fs`, `child_process`, `process`, or native binary modules. | P0 |
| PLG-S-2 | All network requests proxied through `NetworkBroker`; rate-limited and attributed (SEC-16). | P0 |
| PLG-S-3 | `file://`, loopback (`127.0.0.1`), and local network IPs denied without user consent (SEC-17). | P0 |
| PLG-S-4 | Storage scoped per plugin ID; cross-plugin data access prohibited. | P0 |
| PLG-S-5 | Hard per-call execution timeouts; hung plugin instances are terminated by the Supervisor. | P0 |
| PLG-S-6 | Extracted links and HTML outputs are schema-validated before passing to renderer/player (SEC-23). | P0 |
| PLG-S-7 | **The JVM sidecar gets no exemption from PLG-S-1..6.** The controls are enforced by different mechanisms (OS-level process sandbox and class-loader denial rather than V8 isolate limits), because Java's `SecurityManager` is deprecated and disabled (JEP 411/486). Mechanism-by-mechanism mapping in [31](31-cs3-dropin-compatibility.md) §6. | P0 |
| PLG-S-8 | Android grants plugins app-level privilege including `MANAGE_EXTERNAL_STORAGE` (§1.6). Desktop does not, at any runtime. A provider relying on ambient filesystem authority fails on desktop **by design**, and this is documented to users rather than worked around. | P0 |

---

## 8. Developer Experience (DX) & Tooling

To ensure rapid extension authoring and debugging, CloudStream Desktop provides three primary developer tools:

### 1. Live Hot-Reloading CLI (`npx @cloudstream/cli dev`)
Developers run `npx @cloudstream/cli dev` in their extension repo. The CLI spins up a local WebSocket dev server; CloudStream Desktop connects to `localhost`, auto-reloading plugin changes in real-time (<200ms) without app restarts.

### 2. In-App Provider Inspector Panel (`F12`)
A dedicated visual inspection tab inside CloudStream Desktop showing:
* Raw HTTP Request / Response logs (Headers, Status, Body).
* Interactive Jsoup DOM selector sandbox.
* Extracted `ExtractorLink` metadata inspector.
* Single-click **Test Extractor** runner for custom media URLs.

### 3. Automated CLI Test Suite (`npx @cloudstream/cli test`)
Allows extension developers to run automated test vectors against their providers in CI/CD:
```bash
npx @cloudstream/cli test --url "https://example.com/movie/123"
# Returns: 9/9 passed (Search ✓ Load ✓ Extractors ✓ Subtitles ✓ Headers ✓)
```

---

### 8.4 Gradle Bridge — day-one parity for existing Kotlin maintainers

**Problem.** §8's tooling is TypeScript-first (`npx @cloudstream/cli`), but the empirical survey of all 26 community repositories (`repositories/`) shows **zero** existing npm/TS tooling — every provider today is authored and hot-reloaded through Gradle + `deployWithAdb`. A TS-only rollout gives the entire current maintainer base nothing to use on day one and creates pressure to hand-rewrite ~325 Gradle modules before they get any desktop support at all.

| ID | Requirement | Priority |
|---|---|---|
| DX-1 | Ship a `cs3-desktop` Gradle plugin that wraps existing `build.gradle.kts` provider projects and emits the same plugin bundle format the desktop app loads from `@cloudstream/cli` — no source rewrite required. | P0 |
| DX-2 | The Gradle plugin drives the same WebSocket hot-reload channel as `@cloudstream/cli dev` (§8.1), so a Kotlin provider hot-reloads into CloudStream Desktop exactly like a TS one. | P0 |
| DX-3 | Existing `deployWithAdb`-style workflows keep working unmodified against desktop builds during the migration window (see §6.2 Runtime 3, Legacy JVM Compatibility Adapter). | P1 |

### 8.5 Compatibility Analyzer as a CLI subcommand

Today §6.1's Plugin Compatibility Analyzer only runs inside the app, after a user has already installed a plugin — maintainers find out it's incompatible from a user bug report, not before shipping.

| ID | Requirement | Priority |
|---|---|---|
| DX-4 | `npx @cloudstream/cli analyze <repo-or-path>` runs the same `PluginCompatibilityReport` inspection as §6.1 locally, so maintainers self-check before publishing. | P0 |
| DX-5 | CI template (GitHub Action) that runs `cli analyze` + `cli test` (§8.3) on every push and fails the build below a configurable confidence threshold. | P1 |

### 8.6 Migration codemod

Manually porting 26 repositories is not a plan; it's a request for volunteer labor that won't materialize. §6.1 already classifies providers as ~85% pure HTTP+Jsoup (mechanically portable) vs. ~15% Android-API-dependent (needs a human).

| ID | Requirement | Priority |
|---|---|---|
| DX-6 | `npx @cloudstream/cli migrate <kotlin-provider-path>` auto-translates the pure-HTTP+Jsoup majority to `@cloudstream/sdk` TypeScript scaffolding (HTTP calls, CSS selectors, `MainAPI` method shapes translated 1:1). | P1 |
| DX-7 | Providers the codemod cannot safely translate (Android `Context`/`SharedPreferences`/native usage, per §6.1's analyzer) are left untouched and flagged with the specific blocking API, not silently skipped. | P1 |

### 8.7 Inspector Panel covers all three runtimes, not just TypeScript

§8.2's Provider Inspector Panel (`F12`) must attach to whichever runtime is actually executing (§6.2) — TypeScript, KMP/JS, or the Legacy JVM Compatibility Adapter — so the majority of maintainers still on Runtime 3 during the migration window get the same HTTP/DOM/extractor debugging UI as TS-native authors, instead of being told to migrate before they can debug at all.

| ID | Requirement | Priority |
|---|---|---|
| DX-8 | Inspector Panel data source is runtime-agnostic: it reads from the `NetworkBroker`/`StorageBroker` attribution layer (§7) common to all three runtimes, not from TS-specific instrumentation. | P0 |

### 8.8 Native Windows desktop UX for plugin management

Beyond the authoring tools above, the *installing/managing* side of DX is a first-class Windows desktop UX surface, not a ported Android settings screen:

| ID | Requirement | Priority |
|---|---|---|
| DX-9 | Native Windows notifications (Action Center) for plugin install/update/quarantine events, replacing Android's in-app toast. | P1 |
| DX-10 | Drag-and-drop `.cs3`/plugin-bundle install onto the app window or its taskbar icon. | P2 |
| DX-11 | Compatibility Analyzer report (§6.1) rendered as a native, filterable table in the Extension Manager UI — sortable by confidence, runtime, and blocking API — not a raw JSON dump. | P1 |
| DX-12 | Inspector Panel (§8.2/§8.7) opens as a real detachable window (multi-monitor friendly), matching Chromium DevTools ergonomics, since Windows desktop users expect a undockable debugger, not a fixed in-app tab. | P2 |

---

## 9. Plugin API Versioning

| ID | Requirement |
|---|---|
| PLG-V-1 | Semantic versioning, independent of the app version. |
| PLG-V-2 | Plugins declare minimum API version; incompatible versions yield an explicit warning. |
| PLG-V-3 | Breaking changes bump major version and are announced at least one release ahead. |
| PLG-V-4 | CI automated ABI compatibility validation against the community repository index. |

---

## 10. Next Steps

0. **Run the DEX→JVM translation spike (OQ-27) against the full vendored corpus first.** RISK-D1 ([31](31-cs3-dropin-compatibility.md) §8) — systemic failure on Kotlin coroutine state machines — can invalidate Runtime 3 entirely, and every provider in the ecosystem is coroutine-heavy. It is cheap to test and gates everything else here.
1. **Run Automated Compatibility Analyzer across all 26 Community Repositories** (`repositories/`) in Phase 1 to generate an empirical plugin compatibility matrix, replacing the §6.1 projections.
2. Build the JVM sidecar and its two shims ([31](31-cs3-dropin-compatibility.md) §5) in Phase 1–2 — this is what makes the app non-empty at launch.
3. Build the offscreen WebView bridge (DROP-13..17) — the largest net-new component, with no upstream JVM reference implementation to copy.
4. Build the V8 Sandboxed Plugin Host (`PLG-S-1..6`) in Phase 2.
5. Release the `@cloudstream/sdk` (TypeScript) and KMP plugin templates alongside the Provider Inspector UI (`F12`).
6. Ship the `cs3-desktop` Gradle bridge (DX-1..3) in Phase 1, in parallel with item 1. Note that its urgency drops once Runtime 3 lands: with drop-in working, existing repositories run on desktop *as already-published `.cs3` artifacts*, so the Gradle bridge becomes a hot-reload **developer** convenience rather than the ecosystem's only on-ramp.
7. Land `cli analyze` and `cli migrate` (DX-4..7) in Phase 2, driven directly off the Phase 1 compatibility matrix.
8. Build the native Windows Extension Manager UI and detachable Inspector window (DX-9..12) in Phase 2, alongside the Sandboxed Plugin Host.
