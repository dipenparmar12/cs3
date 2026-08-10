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

## 6. Strategy options

### Strategy A — JVM sidecar
Bundle a JRE; convert `.cs3` DEX to JVM bytecode (`dex2jar` or equivalent); run providers in a Java process communicating with Electron over IPC.

| | |
|---|---|
| **Ecosystem** | Highest — many existing providers could work with modest changes |
| **Effort** | High — conversion pipeline, JVM host, IPC bridge, shims for Android APIs |
| **Bundle** | +60–100 MB (JRE), reducible with `jlink` |
| **Risks** | DEX→JVM conversion is imperfect; any Android API usage fails; each provider needs individual verification; sandboxing a JVM is harder than sandboxing QuickJS |
| **Verdict** | Best ecosystem continuity; highest technical risk. **Spike it in Phase 1** — the answer to "what fraction of real providers survive conversion?" is worth knowing regardless of the chosen path. |

### Strategy B — Zipline / QuickJS
Adopt upstream's own direction: providers compiled to Kotlin/JS, executed in QuickJS via Zipline.

| | |
|---|---|
| **Ecosystem** | Shares upstream's *future*, not its present. Zero benefit until upstream ships Kotlin/JS providers |
| **Effort** | High — a Zipline-compatible host, and a dependency on upstream's timeline |
| **Bundle** | Small (QuickJS is compact) |
| **Risks** | Upstream may not ship; the API may change; **betting on someone else's roadmap** |
| **Verdict** | Strategically correct **if** upstream ships. Premature today. Revisit quarterly. |

### Strategy C — Native JS/TS plugin API ★ recommended for v1
Define a clean-room TypeScript provider API mirroring `MainAPI`'s behavior. Providers are JS/TS modules run in an isolated context.

| | |
|---|---|
| **Ecosystem** | **None initially — full fork.** Every provider must be written or ported |
| **Effort** | Medium — the runtime is the easy part; the ecosystem is the cost |
| **Bundle** | Zero additional |
| **Risks** | Ecosystem fragmentation; the desktop app may launch with very few providers; provider developers may not follow |
| **Verdict** | The only option that reliably produces a working product on a predictable schedule, with the best security story. **Adopt for v1, behind an adapter boundary.** |

### Strategy D — Headless-browser provider host
Run provider logic inside a locked-down, offscreen renderer.

| | |
|---|---|
| **Ecosystem** | Medium — suits providers that already need a browser (`usesWebView`) |
| **Effort** | Medium-High |
| **Bundle** | Zero additional |
| **Risks** | Heavy per-provider memory; weak for CPU-bound extraction; sandboxing a full renderer is subtler than sandboxing an isolate |
| **Verdict** | Not a primary strategy. **Adopt as a component** — the `WebViewResolver` replacement (FEAT-NET-3) is exactly this. |

### Recommendation

> **Strategy C as the v1 runtime, with D as its browser-context component, behind an adapter boundary that permits A or B to be added later.**

Rationale: C is the only path with a predictable schedule and a defensible security model. The adapter boundary preserves the option value of A and B at low cost. Spike A in Phase 1 anyway — knowing the conversion success rate informs whether to fund it later.

**The ecosystem fork is the single largest strategic cost of this project and must be acknowledged explicitly to the sponsor.** Do not promise `.cs3` compatibility in any public communication until a strategy is proven against real providers.

---

## 7. Sandbox model

Applies to whichever runtime is chosen.

```
┌─ MAIN PROCESS ────────────────────────────────────────────┐
│  PluginManager     install, verify, update, enable/disable │
│  NetworkBroker     policy, attribution, rate limiting      │
│  StorageBroker     per-plugin scoped key/value store       │
│  Supervisor        spawn, timeout, kill, restart, quarantine│
└───────────────┬───────────────────────────────────────────┘
                │ typed IPC, schema-validated both directions
┌───────────────▼───────────────────────────────────────────┐
│  PLUGIN HOST (isolated)                                    │
│    ✗ require / import of host modules   ✗ process          │
│    ✗ filesystem                         ✗ child_process    │
│    ✗ raw sockets                        ✗ Electron APIs    │
│    ✗ native modules                     ✗ environment vars │
│    ✓ brokered HTTP        ✓ scoped storage                 │
│    ✓ HTML/JSON parsing    ✓ crypto primitives              │
│    ✓ sandboxed JS eval    ✓ attributed logging             │
│    ✓ brokered browser context (Strategy D component)        │
└───────────────────────────────────────────────────────────┘
```

| ID | Control | Priority |
|---|---|---|
| PLG-S-1 | No host module access of any kind. | P0 |
| PLG-S-2 | All network via the broker; policy-checked, attributed, rate-limited (SEC-16). | P0 |
| PLG-S-3 | `file://`, loopback, link-local, and RFC1918 denied without explicit user consent (SEC-17). | P0 |
| PLG-S-4 | Storage is scoped per plugin; no cross-plugin reads. | P0 |
| PLG-S-5 | No access to credentials or tracker tokens (SEC-25). | P0 |
| PLG-S-6 | Hard per-call timeouts; hung hosts are killed. | P0 |
| PLG-S-7 | Memory and CPU caps; breach terminates the host only. | P1 |
| PLG-S-8 | Returned values are schema-validated and sanitized before reaching the UI (SEC-23). | P0 |
| PLG-S-9 | Repeated crashes quarantine the plugin and surface safe mode. | P1 |
| PLG-S-10 | Declared capabilities shown at install; anything beyond default requires consent. | P2 |

---

## 8. Migration path for the ecosystem

| Step | Action |
|---|---|
| 1 | Publish the plugin API specification and SDK early, in Phase 9 at the latest. |
| 2 | Provide a reference provider implementation. |
| 3 | Provide a porting guide mapping `MainAPI` concepts to the desktop API one-to-one. |
| 4 | Port 5–10 popular providers in-house to prove the API and seed the ecosystem. |
| 5 | Provide the in-app provider tester (FEAT-DIAG-3) and a request inspector (DSK-74). |
| 6 | Preserve `PLUGINS_KEY`-shaped records and repository URLs so migration recovers repositories. |
| 7 | Engage upstream about a shared format — a common plugin format would benefit both projects. |

**User migration.** Android backups carry `REPOSITORIES_KEY` but not plugin binaries. On import, repositories are restored and the user is shown which providers were installed on Android and which desktop equivalents exist. That is the best achievable outcome and should be presented honestly rather than hidden.

---

## 9. Plugin API versioning

| ID | Requirement |
|---|---|
| PLG-V-1 | Semantic versioning, independent of the app version. |
| PLG-V-2 | Plugins declare a minimum API version; incompatible plugins are refused with a clear message. |
| PLG-V-3 | Breaking changes bump major and are announced at least one release ahead. |
| PLG-V-4 | ABI/shape validation in CI, mirroring upstream's `abiValidation` on `:library`. |
| PLG-V-5 | Deprecations follow a documented policy — upstream's `DeprecationLevel.ERROR` churn shows what happens without one. |

---

## 10. Open questions

Tracked in [21](21-open-issues-and-assumptions.md): OQ-2 (strategy funding), OQ-21 (developer adoption), OQ-22 (upstream engagement), OQ-27 (DEX→JVM viability), OQ-30 (IPC overhead).

---

## Next steps

1. **Resolve OQ-2 before Phase 6.** Everything about the product's content depends on it.
2. Spike Strategy A in Phase 1 to quantify conversion success against 10 real providers.
3. Draft the plugin API specification in Phase 3, alongside the data model.
4. Contact upstream maintainers about a shared plugin format — the cost of asking is a message.
5. Build the hostile plugin suite while building the sandbox, not after.
