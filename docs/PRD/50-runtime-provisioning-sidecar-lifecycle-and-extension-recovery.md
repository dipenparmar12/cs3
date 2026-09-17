# PRD-50 — Runtime Provisioning, Sidecar Lifecycle & Extension Recovery Engine

> **Document ID**: `PRD-50-RUNTIME-PROVISIONING-RECOVERY`  
> **Status**: Active / Implemented  
> **Scope**: CloudStream 3 Desktop Application (`cs3_windows`)  
> **Source Files**: `electron/cs3/runtimeProvisioner.ts`, `sidecarSupervisor.ts`, `extensionUpdater.ts`, `extensionIssues.ts`, `failureTaxonomy.ts`, `sidecarStderr.ts`  
> **Test Suites**: `electron/cs3/extensionUpdater.test.mts` (12 cases), `electron/cs3/extensionIssues.test.mts` (21 cases), `electron/cs3/failureTaxonomy.test.mts`, `electron/cs3/sidecarStderr.test.mts` (20 cases), `sidecar/` JUnit suite (47 tests)  
> **Date**: 2026-09-17  

---

## 1. Executive Summary

Running Android `.cs3` plugins on Windows requires an isolated Java 21 runtime, an Android API shim layer, a Kotlin provider bridge, and a DEX-to-JVM bytecode translator. In early desktop versions, the app suffered from a critical trap: installed applications ran stale shims cached in user data, causing `NoClassDefFoundError` even after updates were installed.

The **Runtime Provisioning & Extension Recovery Subsystem** guarantees that the sidecar environment remains 100% synchronized with the packaged application through **Generation-Stamped Provisioning** (`runtimeProvisioner.ts`, Generation 14). Furthermore, it provides **fail-safe extension updates with automated rollback** (`extensionUpdater.ts`) and systematic error diagnosis through an **8-shape failure taxonomy** (`failureTaxonomy.ts`).

```text
                               Application Startup
                                        │
                                        ▼
                  +───────────────────────────────────────────+
                  |    RuntimeProvisioner (electron/cs3/)     |
                  |  Reads runtime-stamp.json (Generation 14) |
                  +───────────────────────────────────────────+
                                        │
                         Is stamp stale or jars changed?
                                        │
                      ┌─────────────────┴─────────────────┐
                      ▼ YES                               ▼ NO
+───────────────────────────────────────────+ +───────────────────────────────────+
| Purge stale %APPDATA%/<app>/cs3-runtime/  | | Ready: Use verified local runtime |
| Copy newest jars from build/package       | +─────────────────┬─────────────────+
| Write fresh runtime-stamp.json            |                   │
+─────────────────────┬─────────────────────+                   │
                      └─────────────────┬───────────────────────┘
                                        │
                                        ▼
                  +───────────────────────────────────────────+
                  |   SidecarSupervisor (electron/cs3/)       |
                  |   Spawns Java 21 Process (cs3-sidecar)    |
                  |   Wires JSON-lines RPC over stdio pipes   |
                  +───────────────────────────────────────────+
                                        │
                ┌───────────────────────┴───────────────────────┐
                ▼                                               ▼
+───────────────────────────────────+ +───────────────────────────────────────────+
| ExtensionUpdater (electron/cs3/)  | |   ExtensionIssues (electron/cs3/)         |
| Checks repo updates, archives old | |   Classifies scraper/sidecar errors via   |
| versions, rolls back on failure   | |   8-shape failure taxonomy                |
+───────────────────────────────────+ +───────────────────────────────────────────+
```

---

## 2. Generation-Stamped Runtime Provisioning (`runtimeProvisioner.ts`)

### 2.1 The Stale Provisioning Trap
In desktop environments, copying runtime jars to `%APPDATA%` without continuous validation resulted in applications running outdated copies of the Android shim or provider bridge. Shipped bug fixes were ignored because the app resolved the cached copy first.

### 2.2 The Stamp Specification (`runtime-stamp.json`)
The provisioner enforces an atomic stamp carrying:
* **`generation`**: An integer constant bumped whenever the shim, bridge, or translator changes (currently **14**).
* **`fingerprint`**: A deterministic hash of every jar's filename, byte size, and last modified timestamp (`mtime`).
* **Evaluation Algorithm**:
  1. On boot, `RuntimeProvisioner.getStatus()` compares the app's packaged assets against the provisioned directory.
  2. If the stamp is missing, the generation is lower, or any jar fingerprint differs, the runtime status transitions to `stale`.
  3. The provisioner performs an atomic sync: wipes stale jars, syncs fresh jars from build/staging resources, drops stale DEX translation caches, and writes the updated stamp.

---

## 3. Sidecar Process Supervision (`sidecarSupervisor.ts`)

* **Java 21 Resolution Priority**:
  1. Bundled jlinked JRE in `resources/sidecar/jre` (packaged app).
  2. Local toolchain JDK in `tools/toolchain/jdk-21*`.
  3. System `JAVA_HOME` / `PATH` (verifying class file version $\ge 65$).
* **RPC Communication**:
  * Employs newline-delimited JSON (`JSON-lines`) over standard I/O pipes (`stdin`/`stdout`).
  * Avoids port collision issues on restricted networks.
* **Resilience & Health Heartbeats**:
  * Sends periodic health ping RPCs to the sidecar.
  * In the event of an unhandled JVM crash or out-of-memory error, automatically restarts the sidecar process and re-registers active plugins.
* **Stderr Stream Inspection (`sidecarStderr.ts`)**:
  * Parses and categorizes JVM stack traces, isolating missing Android classes from network scraper exceptions.

---

## 4. Extension Auto-Update & Safe Rollback Engine (`extensionUpdater.ts`)

Updating community extensions can occasionally introduce broken scrapers or incompatible DEX bytecode.

* **Pre-Update Archival**:
  * Prior to overwriting an installed `.cs3` plugin, the current working archive is moved to a rollback cache (`%APPDATA%/<app>/plugin_rollbacks/<pluginId>.cs3`).
* **Verification Gate**:
  * After download, the updated plugin is loaded into the sidecar and subjected to a structural validation check (manifest verification, class loading).
* **Automated Rollback**:
  * If the updated plugin throws a initialization exception, the updater automatically deletes the failed archive and restores the previous working version from rollback storage, notifying the user.

---

## 5. Extension Issue Ledger & 8-Shape Failure Taxonomy (`failureTaxonomy.ts`, `extensionIssues.ts`)

Scraper failures are classified into 8 standardized error shapes to facilitate instant diagnosis:

| Error Shape | Meaning & Example Trigger | Recommended Remediation |
|---|---|---|
| `NetworkError` | DNS failure, connection timeout, connection reset | Suggests proxy or network settings check |
| `ScrapeFailure` | Target website changed HTML structure / CSS selectors | Flags plugin for upstream maintainer fix |
| `MissingClass` | Plugin referenced unsupported Android API stub | Identifies shim gap for desktop runtime update |
| `TranslationError` | DEX-to-JVM translation failed on bytecode instruction | Logs translator bug to `tools/dex-spike` |
| `MediaPlaybackError` | Link extraction succeeded but video stream is 404/403 | Triggers playback failover to next source |
| `CaptchaChallenge` | Host returned Cloudflare Turnstile or IUAM page | Dispatches `webViewHost` session interception |
| `TimeoutError` | Provider search exceeded host deadline ($>15$s) | Trips circuit breaker to prevent search stall |
| `UnknownError` | Unclassified runtime exception | Records full stack trace in diagnostic ledger |

The ledger is exposed over IPC (`issues:list`, `issues:annotate`, `issues:clear`) and visualized in the Extensions Debugging panel.
