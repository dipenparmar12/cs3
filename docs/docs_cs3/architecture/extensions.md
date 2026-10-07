# Extensions and the Sidecar Runtime

An Android `.cs3` is a ZIP of DEX bytecode (`manifest.json` + `classes.dex`) built against upstream's Kotlin
provider API. Desktop keeps that ecosystem working with **no maintainer action** by running them in a JVM child
process. (Android's own loading is described in [../android/03_extension_and_plugin_system.md](../android/03_extension_and_plugin_system.md).)

## 1. Components
| Piece | Where | Role |
|---|---|---|
| Sidecar | `sidecar/` (Java 21, Maven; `Main`, `PluginHost`, `DexTranslator`, `KotlinNameRepair`, `LinkageAnalyzer`, `PluginArchive`) | Separate OS process; a hung plugin degrades to "unavailable" instead of taking the app down |
| Android shim | `sidecar/src` `android/**`, `androidx/**` | Hand-written platform classes: *concede the type, refuse the operation* |
| Bridge | `sidecar/bridge/` (Kotlin) → `cs3-provider-bridge.jar` | Supplies `:app` types (`Plugin`, `DataStore`, `CloudflareKiller`, `syncproviders`, `Globals`…), `WebViewResolver`, and the primitives-in/JSON-out `ProviderBridge` |
| Runtime classpath | `sidecar/runtime-deps` → `sidecar/runtime/` (library-jvm 4.8.0 + transitive jars) | Same loader owns `library-jvm` and the bridge |
| Supervisor | `electron/cs3/sidecarSupervisor.ts` | Spawn, JSON-RPC over stdio, never throws on a broken sidecar |
| Manager | `electron/pluginManager.ts` | Repos, download + SHA-256, install paths, enable cascade, calls into the sidecar |
| Provisioner | `electron/cs3/runtimeProvisioner.ts` | Copies the runtime into `userData/cs3-runtime/` and stamps it |

RPC methods in `sidecar/.../Main.java`: `ping`, `status`, `inspect`, `load`, `unload`, `hostCapabilities`,
`providerSearch`, `providerLoad`, `providerLoadLinks`, `providerMainPageSections`, `providerMainPage`, `providers`,
`clearTranslationCache`. Reverse (JVM → host): WebView resolve and `clearance.get/invalidate/fetch`.

## 2. Install and load lifecycle
1. **Download** the artifact; verify. `chooseArtifact` prefers the published **jar** when `jarUrl` exists (verified
   against `jarHash`, not `fileHash`), else the `.cs3` (`fileHash` is published as `sha256-<hex>`).
2. **Place** with `cs3/archivePlacement.ts` (retry rename ~1.5 s, else place beside as `Name.hash.<sha12>.cs3`; held copy swept later). Read archives from `record.filePath`.
3. **Inspect** (`inspect` RPC): `PluginArchive.detect` classifies by *contents* (`.dex` ⇒ DEX lane, `.class` ⇒ jar lane); DEX is translated once by dex2jar (cached by SHA-256), `KotlinNameRepair` fixes mangled names; `LinkageAnalyzer` assigns tier `T1_DROPIN`…`T4_BLOCKED`. Jar lane finds the entry class by scanning for `@CloudstreamPlugin` (two annotated classes are reported, not arbitrated).
4. **Load** (`PluginHost`): Android's sequence reproduced; a failed `load()` closes its class loader and `unload` withdraws registrations (otherwise Windows keeps a handle and later updates fail with `EPERM`). `PluginHost.call` catches `LinkageError`.
5. **Register**: providers recorded into `ProviderRegistry`, keyed `size:mtime:generation`.
Everything after the verified download runs through `PluginManager.oneAtATime` — **provider loading cannot be parallelised** (providers self-register in a global; overlapping loads steal each other's).

## 3. Lazy loading
Hydrate descriptions from `cs3-provider-registry.json` at launch (the sidecar is not started: 6.6 s → 8 ms measured
on 117 archives). `ensureProviderActive(name)` loads one archive on demand; `warmProviders()` does the rest in the
background queue. A failed activation withdraws its registry row. `loadProviders(force)` clears the cache.

## 4. The stale-runtime trap
The app runs the copy in `%APPDATA%/<app>/cs3-runtime/`, not what you just built. `runtime-stamp.json` records a
generation + fingerprint; `getStatus()` reports `stale`. Provisioning reads from build locations only and picks the
**newest**. **Bump `RUNTIME_GENERATION`** (`runtimeProvisioner.ts`, currently **16**, one paragraph per generation) whenever
shim/bridge/translator behaviour changes; translations drop when the sidecar changes.

## 5. Updates and rollback
`extensionUpdater.ts`: updates install automatically on every launch by default (Android parity), then daily while
open; every install is loaded before it is accepted and **rolled back** if it will not link (`T4_BLOCKED` is the only
failure; `T3_DEGRADED` is normal; a *transport* failure — `rpcResult.isTransportFailure` — is never a verdict).
"Update all" re-checks live rather than reading the persisted snapshot; an update installs into the directory the
*record* names and downloads from the repository the *update* names. A same-version "republish" counts only from the
extension's own repository. `extension:rollback` restores one kept generation.

## 6. Jobs
`cs3/extensionJobs.ts`: install/update/add-repository/install-repository as background jobs (3 at once, one per
target, retry with reason, whole-state snapshots pushed ≤ every 120 ms). Downloads overlap; load stays serialised.

## 7. Sandbox
Enforced: class-loader isolation, process boundary (`System.exit` can't kill the app), `System.loadLibrary` blocked,
per-plugin scoped storage. **Not enforced** (reported as `sandboxGaps`): raw network egress, process creation.

## 8. WebView and clearances
`webViewHost.ts` opens an offscreen `BrowserWindow` per resolve; `webViewMatch.ts` interprets subrequests;
`clearance.ts` owns Cloudflare-style clearances (webview cookie jar is the store, one solve per host,
Chrome-shaped UA); `hostDeadline.ts` makes the host finish before the sidecar stops waiting.

## 9. Known unsupported
Ultima (host-UI replacement needing `CloudStreamApp`/`MainActivity`) is deliberately excluded. Only a small share of
the live corpus publishes a jar (measured 1.9% on 2026-09-07) — do not plan on the jar lane.

Further detail and measurements: `docs/agents/extensions.md`.
