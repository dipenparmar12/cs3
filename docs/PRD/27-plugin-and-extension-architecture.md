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

## 2. Why this cannot be reused

| Barrier | Detail |
|---|---|
| **Bytecode** | DEX is Dalvik/ART bytecode. Node and Chromium execute JavaScript/WASM. There is no runtime overlap. |
| **Class loading** | `PathClassLoader` is an Android runtime API with no equivalent outside ART. |
| **Android APIs** | Providers may use `Context`, `WebView`, Android crypto providers, resources, and Android-specific I/O. |
| **The library dependency** | Providers compile against `MainAPI`, `ExtractorApi`, jsoup, nicehttp, gson, fuzzywuzzy — a JVM-shaped surface. |
| **Reflection** | Loading depends on reflective construction and, for resourced plugins, reflection on `AssetManager` internals. |

There is no configuration of Electron, Node, or Chromium that runs a `.cs3` file. **This is a hard constraint, not an engineering difficulty.**

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
| PLG-12 | Offer hot reload for development. | P2 |
| PLG-13 | Preserve safe mode. | P0 |
| PLG-14 | Preserve the recursion guard. | P1 |

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
     TypeScript               KMP/JS                 Legacy JVM
      Runtime                 Runtime                 Runtime
  (@cloudstream/sdk)   (Kotlin Multiplatform)   (CS3 Compatibility)
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
2. **Compatibility Report**: Generates a structured `PluginCompatibilityReport`:
   * **TypeScript/KMP Native**: 100% compatibility (Sandboxed JS Runtime).
   * **Legacy JVM Compatible**: ~80–95% confidence (Runs via Legacy JVM Compatibility Adapter with Android stubs).
   * **Android-Only / Unsupported**: Low confidence due to hard Android OS hardware/native dependencies.
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

#### Runtime 3: Legacy CloudStream CS3 Compatibility Adapter (JVM)
* **Target Audience**: Existing `.cs3` Android plugins from community repositories.
* **Mechanism**: In-memory `classes.dex` $\rightarrow$ Java `.class` bytecode translation via `dex-translator`, coupled with Android framework stubs (`Context`, `Log`, `NiceHttp`).
* **Positioning**: **Compatibility-only fallback layer**, subject to automated Plugin Compatibility Analyzer checks.

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

## 9. Plugin API Versioning

| ID | Requirement |
|---|---|
| PLG-V-1 | Semantic versioning, independent of the app version. |
| PLG-V-2 | Plugins declare minimum API version; incompatible versions yield an explicit warning. |
| PLG-V-3 | Breaking changes bump major version and are announced at least one release ahead. |
| PLG-V-4 | CI automated ABI compatibility validation against the community repository index. |

---

## 10. Next Steps

1. **Run Automated Compatibility Analyzer across all 26 Community Repositories** (`repositories/`) in Phase 1 to generate an empirical plugin compatibility matrix.
2. Build the V8 Sandboxed Plugin Host (`PLG-S-1..6`) in Phase 2.
3. Release the `@cloudstream/sdk` (TypeScript) and KMP plugin templates alongside the Provider Inspector UI (`F12`).
