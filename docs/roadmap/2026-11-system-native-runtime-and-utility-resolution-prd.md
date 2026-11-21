# PRD-57: System-Native Runtime & Utility Resolution (System-First, App-Fallback)

**Project:** CS3 Desktop  
**Feature:** Prefer Verified System-Wide Java & Utility Tools Over App-Level Wrapping / Duplication (Dev & Production)  
**Document Status:** Implemented (2026-11-21; unit-tested & verified via `tsc -b` and `doctor.mjs`)  
**Document ID:** PRD-57  
**Creation Date:** 2026-11-21  
**Priority:** High  
**Platform:** Windows-first desktop (`desktop`), with full cross-platform parity (macOS / Linux)  
**Compatibility:** Additive resolution policy. Zero regression for clean end-user machines that have no system tools installed (app-level / bundled fallback remains intact).

---

## 1. Executive Summary & Core Principle

CS3 Desktop currently has a strong auto-setup and runtime-provisioning system (`tools/package/doctor.mjs`, `RuntimeProvisioner`, `BinaryDownloader`, `build-runtime.mjs`, `build-media-runtime.mjs`) that guarantees plug-and-play operation on clean machines.

However, **when a machine already has Java (`JAVA_HOME` / system `java`) and the required utility tools (`mvn`, `ffmpeg`, `ffprobe`, `mpv`, `yt-dlp`, `aria2c`) installed system-wide and meeting all compatibility criteria, CS3 should use those system-native installations directly — without wrapping, duplicating, shadowing, or downloading a second copy.**

### The Core Rule: System-First, App-Fallback

1. **System-Native First:** In both **developer** and **production** environments, CS3 resolves and validates system-wide installations (`JAVA_HOME`, `MAVEN_HOME`/`M2_HOME`, `PATH`, and OS-standard package directories such as Homebrew/Linux system bins) **before** looking at app-managed, local toolchain, or bundled copies.
2. **Criteria-Gated Acceptance:** A system-native tool is accepted **only** if it passes CS3's version, architecture, and capability checks (e.g., Java 21+ with required JPMS modules, functional `ffmpeg`/`ffprobe`, IPC-capable `mpv`). A system tool that fails criteria (for example, `JAVA_HOME` pointing to Java 17) is cleanly rejected with a diagnostic reason, and resolution falls through to the next candidate.
3. **App-Level Fallback Only When Needed:** Downloading into `tools/toolchain/`, `%APPDATA%/.../cs3-runtime/java`, or `%APPDATA%/.../bin`, or falling back to bundled `resources/sidecar/jre` and `resources/media`, happens **only** when no system-native installation meets the criteria.
4. **Scope Boundary (App Artifacts vs. System Utilities):** CS3's own compiled artifacts (`cs3-sidecar.jar`, `cs3-provider-bridge.jar`, `library-jvm-4.8.0.jar`, and `cs3-sidecar-android-shim.jar`) are application code, not system utilities. They remain managed and version-stamped by CS3. This PRD governs **external runtimes and CLI utilities**: Java (JDK/JRE), Maven, FFmpeg, FFprobe, mpv, yt-dlp, and aria2c.

---

## 2. Current State Analysis (Codebase Audit)

An audit of the current codebase (2026-11-21) reveals that **every runtime and utility resolver currently puts local/bundled/app-managed copies ahead of system-native installations**, and several resolvers check file existence without validating compatibility criteria.

### 2.1 Current Resolution & Duplication Matrix

| Tool | Environment | Current Resolution Order | Current Criteria Check | Duplication / Shadowing Problem |
|---|---|---|---|---|
| **Java (Runtime)** | Prod & Dev (`desktop/electron/cs3/runtimeProvisioner.ts:443-501`) | 1. `userData/cs3-runtime/{java,jre}`<br>2. `resources/sidecar/jre` (packaged)<br>3. `tools/toolchain/jdk-*`<br>4. `sidecar/dist/jre`<br>5. `JAVA_HOME`<br>6. `PATH` | `java -version` major ≥ 21 only. No JPMS module check. | System `JAVA_HOME` and `PATH` are **dead last (#5, #6)**. Any bundled, toolchain, or previously downloaded copy permanently shadows a valid system Java 21+. |
| **Java (Build JDK)** | Dev (`tools/package/doctor.mjs:134-160`, `build-runtime.mjs:89-114`, `build-installer.mjs:155-160`) | 1. `tools/toolchain/jdk-*`<br>2. `JAVA_HOME`<br>3. `PATH` (`doctor.mjs` only; `build-runtime.mjs` & `build-installer.mjs` skip `PATH`) | `doctor.mjs`: major ≥ 21 + `javac`.<br>`build-runtime.mjs`: major ≥ 21 + `jlink`.<br>`build-installer.mjs`: none (relies on `doctor.mjs`). | If `tools/toolchain/jdk-*` exists, it overrides a valid system `JAVA_HOME`. `build-runtime.mjs` fails if JDK 21 is on `PATH` without `JAVA_HOME`. |
| **Maven** | Dev (`tools/package/doctor.mjs:163-178`, `build-bridge.mjs:63-80`, `build-installer.mjs:140-154`) | 1. `tools/toolchain/apache-maven-*`<br>2. `PATH` (`mvn.cmd`/`mvn`) | Existence only (`mvn -v` in `build-bridge.mjs`). Does not check `MAVEN_HOME`/`M2_HOME` or minimum version. | If `tools/toolchain/apache-maven-*` exists, it shadows system Maven. System `MAVEN_HOME` is ignored if not on `PATH`. |
| **FFmpeg & FFprobe** | Prod & Dev (`desktop/electron/binaryDownloader.ts:84-110`) | 1. `resources/media` (packaged)<br>2. `desktop/media-runtime`<br>3. `userData/bin`<br>4. `cwd/bin`<br>5. `PATH` + `extraSearchDirs` | `resolveBinary()` checks `fs.existsSync()` only. Capability probes (`-extension_picky`, `zscale`) run *after* selection (`toolCapabilities.ts`). | System `ffmpeg`/`ffprobe` are **dead last**. Packaged apps and dev checkouts that ran `build:media` always shadow system installs. `doctor.mjs` does not check media tools. |
| **mpv** | Prod & Dev (`desktop/electron/binaryDownloader.ts:84-110`) | Same as FFmpeg (bundled → `userData/bin` → `cwd/bin` → `PATH` + `extraSearchDirs`) | `fs.existsSync()` only during resolution; `--version` only during `testBinary()`. | On Windows, bundled/downloaded `mpv.exe` shadows a system-installed `mpv`. On macOS/Linux, system `mpv` is already used because it is not bundled. |
| **yt-dlp** | Prod & Dev (`desktop/electron/binaryDownloader.ts:84-110`) | 1. `userData/bin`<br>2. `resources/media` / `desktop/media-runtime`<br>3. `cwd/bin`<br>4. `PATH` + `extraSearchDirs` | `fs.existsSync()` only; `--version` only during `testBinary()`. | Any copy in `userData/bin` shadows a system-installed `yt-dlp` (e.g., `winget`/`brew`/`pipx`). |
| **aria2c** | Prod & Dev (`desktop/electron/binaryDownloader.ts:84-110`) | Same as FFmpeg (bundled → `userData/bin` → `cwd/bin` → `PATH` + `extraSearchDirs`) | `fs.existsSync()` only; `-v` only during `testBinary()`. | Any copy in `userData/bin` shadows a system-installed `aria2c`. |
| **tar (Windows)** | Dev & Prod (`platform/binarySources.ts:120-128`, `doctor.mjs:232-234`) | Explicit `System32\tar.exe` | Existence check. | Already system-native and never duplicated. Keep as-is. |

### 2.2 Concrete Gaps Identified

1. **Inverted Resolution Precedence:** Both `RuntimeProvisioner.findJavaBinary()` and `BinaryDownloader.resolveBinary()` put system-native paths last. Even when the OS has valid, up-to-date tools configured globally, the app runs its bundled/local copy.
2. **Missing Pre-Selection Criteria Gates:** `BinaryDownloader.resolveBinary()` returns the first matching filename on disk without verifying that the binary runs, matches the host architecture, or meets minimum capability requirements. `RuntimeProvisioner.findJavaBinary()` checks Java major version ≥ 21, but does not verify required JPMS modules (which a stripped custom system JRE could lack).
3. **Unnecessary Dev-Time Duplication:**
   - `tools/package/build-media-runtime.mjs` always downloads ~140 MB into `.cache/media-runtime/` and stages into `desktop/media-runtime/`. Once staged for a test build, `desktop/media-runtime/` permanently shadows the developer's system `ffmpeg`/`ffprobe`/`mpv` during `bun run dev`.
   - `tools/package/doctor.mjs` does not inspect or report system media/download utilities (`ffmpeg`, `ffprobe`, `mpv`, `yt-dlp`, `aria2c`), so developers cannot see whether their machine already satisfies playback/download requirements natively.
   - `tools/package/build-runtime.mjs` ignores `PATH` when locating a JDK (only checks `tools/toolchain/` and `JAVA_HOME`).
4. **Opaque Origin Reporting in Settings UI:**
   - `SystemRuntimeStatus` (`runtimeProvisioner.ts:13-35`) only exposes `isAppManaged: boolean` — it cannot distinguish `system` (`JAVA_HOME`/`PATH`) from `bundled` (`resources/sidecar/jre`) or `toolchain` (`tools/toolchain/`).
   - `BinaryDownloader.checkBinaries()` (`binaryDownloader.ts:119-147`) only exposes `bundled: { ffmpeg, ffprobe, mpv }` — it cannot distinguish `system` from `app-managed` (`userData/bin`).
   - Consequently, `RuntimeProvisionerCard.tsx`, `MediaComponentsCard.tsx`, and `UnifiedComponentManager.tsx` cannot tell the user "Using system-native Java 21 / FFmpeg" and still surface "Install / Reinstall" actions that invite redundant downloads.
5. **No Slim / System-Native Packaging Target:** `electron-builder.yml` unconditionally bundles `sidecar/dist` (including the ~90 MB jlinked JRE) and `desktop/media-runtime` (~140 MB). There is no opt-in slim build mode for environments where system packages manage Java, FFmpeg, and mpv (e.g., Linux distros, Homebrew, or power-user/enterprise installs).

### 2.3 Historical Traps That Must Not Regress

The current bundled-first order was originally adopted to prevent three real bugs documented in `AGENTS.md` and source comments. **System-First MUST preserve protection against all three:**

1. **Java 17 on `JAVA_HOME`:** Many developer machines have `JAVA_HOME` set to JDK 17, which silently fails on class file 65 (`sidecar` requires Java 21+). **Mitigation:** The system Java candidate is rejected unless `major >= 21` and required modules are present; resolution then checks `PATH` and falls back to local/bundled Java 21.
2. **Stale `userData/bin` Shadowing:** An old app-downloaded copy in `userData/bin` once shadowed a newer bundled binary. **Mitigation:** App-managed (`userData/bin` and `userData/cs3-runtime/java`) always sits **below** verified system-native and bundled copies (except `yt-dlp`, where an app-managed update may be newer than a stale distro package if the system copy fails the recency/health check).
3. **Cold-Spawn Startup Freeze (~590 ms/binary on Windows):** `toolCapabilities.ts` measured that synchronous `spawnSync` of cold binaries blocks the Electron main thread for 1.1–1.8 s on startup. **Mitigation:** All system-binary verification probes must be fingerprinted by `{ path, size, mtimeMs }`, cached on disk, and executed off the main thread (`runToolOffThread` / async `execFile`).

---

## 3. Target Architecture: System-First Resolution

### 3.1 Unified Resolution Precedence

Every external runtime and utility uses the same four-tier precedence model:

```text
Tier 0: Explicit Override (opt-in only)
        └─ Env var (CS3_PREFER_BUNDLED=1, CS3_JAVA_HOME, etc.) or user-configured
           custom path in Settings. Allows forcing bundled mode for debugging.

Tier 1: System-Native (DEFAULT PREFERRED)
        └─ JAVA_HOME / MAVEN_HOME / PATH / OS-standard package dirs (extraSearchDirs)
        └─ MUST pass the tool's Criteria Gate (version + arch + capability check).
        └─ If present but fails criteria → record `skippedSystemReason`, fall through.

Tier 2: Bundled / Local Checkout Fallback (no network download)
        └─ Production: resources/sidecar/jre, resources/media
        └─ Developer:  tools/toolchain/*, sidecar/dist/jre, desktop/media-runtime

Tier 3: App-Managed On-Demand Fallback
        └─ Production: userData/cs3-runtime/java, userData/bin
        └─ Developer:  prompted download into tools/toolchain/ (only via `bun run setup`)
        └─ Downloaded ONLY when Tiers 1 and 2 have no passing candidate.
```

### 3.2 Per-Tool Compatibility Criteria Gate

A Tier 1 (system-native) candidate is accepted **only** when it passes every required check in this table. All probe results are cached per `{ path, size, mtimeMs }` so repeated launches cost a single `fs.statSync` (~0.1 ms).

| Tool | System Search Locations (in order) | Required Criteria (Must Pass to Accept) | Advisory / Recorded Capabilities |
|---|---|---|---|
| **Java (Runtime)** | 1. `JAVA_HOME/bin/java`<br>2. `PATH` (`java`)<br>3. OS standard JVM dirs (e.g., `/usr/libexec/java_home` on macOS, `/usr/lib/jvm/*` on Linux) | - Executable runs `-version` cleanly<br>- Major version `>= 21`<br>- Required JPMS modules present (`--list-modules` contains `java.base`, `java.desktop`, `java.net.http`, `java.sql`, `java.scripting`, `java.naming`, `jdk.crypto.ec`, `jdk.localedata`, `jdk.unsupported`, `jdk.zipfs`) | Full version string, vendor, architecture (`x64`/`arm64`) |
| **Java (Dev JDK)** | Same as Java Runtime | - All Java Runtime criteria<br>- `javac` exists beside `java` (must be a JDK, not JRE)<br>- `jlink` exists beside `java` (required in `dist` mode only) | Same as Runtime |
| **Maven (Dev)** | 1. `MAVEN_HOME/bin/mvn` or `M2_HOME/bin/mvn`<br>2. `PATH` (`mvn.cmd`/`mvn.bat` on Win, `mvn` on Unix) | - Executable runs `-v` cleanly<br>- Version `>= 3.8.0` (3.9.x recommended) | Maven version, active Java version |
| **FFmpeg** | 1. `PATH` (`ffmpeg`)<br>2. `extraSearchDirs` (Homebrew, `/usr/local/bin`, `/usr/bin`, etc.) | - Executable runs `-version` cleanly (exit 0)<br>- Major version `>= 5` (or >= 4.4 with H.264/AAC/HLS demuxer support)<br>- Companion `ffprobe` also available | `zscale` / tone-map filter support (`toolCapabilities.ts`), hardware encoders |
| **FFprobe** | 1. Same directory as resolved system `ffmpeg`<br>2. `PATH` + `extraSearchDirs` | - Executable runs `-version` cleanly (exit 0)<br>- Supports `-of json` | `-extension_picky` flag support (`toolCapabilities.ts`) |
| **mpv** | 1. `PATH` (`mpv`)<br>2. `extraSearchDirs` (incl. `/Applications/mpv.app/Contents/MacOS` on macOS) | - Executable runs `--version` cleanly (on Windows, probe via `mpv.com` if present beside `mpv.exe`, else accept `mpv.exe` with IPC test)<br>- Version `>= 0.35` (supports JSON IPC `--input-ipc-server`) | `--hwdec=help` available backends |
| **yt-dlp** | 1. `PATH` (`yt-dlp`)<br>2. `extraSearchDirs` | - Executable runs `--version` cleanly (exit 0)<br>- Outputs a valid version string (e.g., `YYYY.MM.DD`)<br>- Note: if system `yt-dlp` is older than a newer app-managed copy in `userData/bin` (from an in-app update), allow user/policy to prefer the newer one without re-downloading | Release date |
| **aria2c** | 1. `PATH` (`aria2c`)<br>2. `extraSearchDirs` | - Executable runs `-v` cleanly (exit 0)<br>- Version `>= 1.35` (supports JSON-RPC `--enable-rpc`) | Supported features (SSL/TLS) |

> [!NOTE]
> **Windows `JAVA_HOME` & `PATH` Nuance:** On Windows, `where java` can return `C:\Program Files\Common Files\Oracle\Java\javapath\java.exe` or a shim. Resolving the real home via `java -XshowSettings:properties -version` (already implemented in `doctor.mjs:121-125` as `javaHomeOf`) ensures `javac` and `jlink` are reliably located beside the real JDK.

---

## 4. Detailed Requirements by Environment

### 4.1 Developer Environment (`tools/package/*`)

1. **`tools/package/doctor.mjs` (`bun run doctor`, `bun run setup`, `predev`, `prebuild`, `dist`):**
   - **Flip `findJdk()` and `findMaven()` to System-First:**
     - `findJdk()`: Check `JAVA_HOME` → `PATH` (resolving real `javaHomeOf`) → `tools/toolchain/jdk-*`.
     - `findMaven()`: Check `MAVEN_HOME` / `M2_HOME` → `PATH` → `tools/toolchain/apache-maven-*`.
   - **Never download duplicates:** When a system JDK 21+ or Maven 3.8+ passes inspection, `doctor.mjs --fix` (`bun run setup`) marks it `✓ (system: JAVA_HOME)` or `✓ (system: PATH)` and **never prompts for or downloads** a second copy into `tools/toolchain/`.
   - **Explain rejected system tools:** If `JAVA_HOME` exists but is Java 17 (or a JRE without `javac`), report explicitly: `JAVA_HOME has Java 17 (need 21+); checking PATH / tools/toolchain`.
   - **Report media & download utilities (advisory in `check` / `setup`):** Add non-blocking inspection rows for `ffmpeg`, `ffprobe`, `mpv`, `yt-dlp`, and `aria2c` showing whether each is resolved from `system`, `local (desktop/media-runtime)`, or `missing`. Never auto-download media tools during `bun run setup` if system-native copies pass criteria.
   - **Duplicate detection & optional cleanup:** If both a valid system-native tool AND a redundant local copy in `tools/toolchain/` exist, `doctor.mjs` prints a one-line notice (e.g., `note: tools/toolchain/jdk-21-corretto is unused because system JAVA_HOME meets requirements`) and supports `--prune-duplicates` to remove unused local toolchain copies safely.

2. **`tools/package/build-runtime.mjs`, `build-bridge.mjs`, `build-installer.mjs`:**
   - Unify JDK and Maven discovery by importing `findJdk()` and `findMaven()` from `doctor.mjs` instead of maintaining three divergent copies (`build-runtime.mjs:89`, `build-bridge.mjs:63`, `build-installer.mjs:140`).
   - Ensure `build-runtime.mjs` can use a system JDK 21+ found via `JAVA_HOME` **or** `PATH` (as long as `jlink` is present).
   - Ensure `desktop/media-runtime/` (staged only for packaging) does **not** shadow a developer's valid system `ffmpeg`/`ffprobe`/`mpv` when running `bun run dev` (handled automatically once `BinaryDownloader.resolveBinary()` becomes System-First).

3. **Dev App Startup (`RuntimeProvisioner` when `!app.isPackaged`):**
   - When running via `bun run dev`, if system Java 21+ is valid, `RuntimeProvisioner` must **never** download portable Java into `%APPDATA%/.../cs3-runtime/java`, and must use the system `java` binary directly.
   - Sidecar JARs (`cs3-sidecar.jar`, `sidecar/runtime/`) continue to resolve from the checkout / synced runtime stamp as today so local Maven rebuilds are picked up immediately.

### 4.2 Production / Packaged Application (`desktop/electron/*`)

1. **`RuntimeProvisioner` (`desktop/electron/cs3/runtimeProvisioner.ts`):**
   - **System-First `findJavaBinary()`:**
     1. Explicit override (`CS3_JAVA_HOME` / user setting, if set)
     2. System `JAVA_HOME` (validated: major ≥ 21 + required JPMS modules)
     3. System `PATH` (`java`, validated: major ≥ 21 + required JPMS modules)
     4. Bundled `resources/sidecar/jre` (when `app.isPackaged`)
     5. Dev toolchain `tools/toolchain/jdk-*` and `sidecar/dist/jre` (when `!app.isPackaged`)
     6. App-managed `userData/cs3-runtime/{java,jre}`
   - **Zero unnecessary downloads or copies:**
     - `provisionRuntime()` only calls `downloadPortableJava()` if **no** valid Java 21+ exists across System, Bundled, or App-managed tiers.
     - `repairRuntime()` clears stale `userData/cs3-runtime` files (sidecar/bridge copies and any redundant app-managed `java/`), and if system Java 21+ passes criteria, does **not** re-download Java.
   - **Origin & diagnostics on `SystemRuntimeStatus`:**
     - Add `javaOrigin: 'system' | 'bundled' | 'toolchain' | 'app-managed' | 'missing'`
     - Add `skippedSystemJavaReason?: string` (e.g., `"System JAVA_HOME is Java 17 (requires 21+)"`)
     - Keep `isAppManaged` for backward compatibility, derived accurately from origin.

2. **`BinaryDownloader` (`desktop/electron/binaryDownloader.ts`):**
   - **System-First `resolveBinary(name)`:**
     1. Explicit override (user setting or `CS3_PREFER_BUNDLED=1` flips bundled ahead of system)
     2. System `PATH` + `extraSearchDirs` (validated against the Criteria Gate, fingerprinted & cached)
     3. Bundled (`resources/media`, `desktop/media-runtime`)
     4. App-managed (`userData/bin`, `cwd/bin`)
   - **Paired FFmpeg/FFprobe preference:** When system `ffmpeg` passes criteria, prefer the `ffprobe` in the same directory so both tools share the same libav/FFmpeg version.
   - **Zero redundant downloads:** `setupFfmpeg()`, `setupAria2()`, `setupYtDlp()`, `setupMpv()`, and `setupAll()` check resolved status first; if a system-native binary already passes criteria, they return `true` immediately with status `"Using system-installed <tool> (<version>)"` and write nothing to `userData/bin`.
   - **Origin & diagnostics on `checkBinaries()`:**
     - Extend return payload with per-tool origin metadata:
       ```ts
       origins: Record<'aria2c' | 'yt-dlp' | 'ffmpeg' | 'ffprobe' | 'mpv', {
         origin: 'system' | 'bundled' | 'app-managed' | 'missing';
         path?: string;
         version?: string;
         skippedSystemReason?: string;
       }>
       ```
     - Keep existing boolean flags (`aria2`, `ytdlp`, `ffmpeg`, `ffprobe`, `mpv`, `bundled`) for backward compatibility.

3. **Settings UI (`RuntimeProvisionerCard.tsx`, `MediaComponentsCard.tsx`, `UnifiedComponentManager.tsx`):**
   - Display the real origin badge for each component:
     - **System Native** (green badge) — shows resolved version and path in disclosure; hides or demotes "Install" button (nothing to install).
     - **Included** (bundled with app) — shown when system copy is absent or failed criteria; if a system copy was skipped, show a quiet one-line explanation in Technical Details (e.g., *"System Java 17 skipped — Java 21+ required; using bundled Java 21"*).
     - **App Managed** (downloaded into app data) — offers Remove / Repair.
     - **Missing** — offers one-click Install (Windows) or package manager hint (macOS/Linux).
   - Add an Advanced / Troubleshooting toggle in Settings: **"Prefer bundled runtimes over system tools"** (default: `false`), persisted in app settings, for users who want to isolate a misbehaving system installation without uninstalling it from their OS.

4. **Packaging & Distribution (`tools/package/build-installer.mjs`, `electron-builder.yml`):**
   - **Default releases remain self-contained:** Standard `bun run dist:*` builds continue to bundle fallback JRE and media runtimes so a user on a fresh machine still gets zero-setup playback and extensions. At runtime on a machine that *already* has system Java/FFmpeg/mpv, the app simply uses the system copies and never unpacks/duplicates anything into `%APPDATA%`.
   - **Opt-in Slim / System-Native Package (`--slim`):** Add a `--slim` flag to `build-installer.mjs` (and optional Linux `.deb`/tarball variant) that omits the bundled JRE (`sidecar/dist/jre`) and bundled media binaries (`desktop/media-runtime`) while still shipping `cs3-sidecar.jar` and `sidecar/runtime/`, dramatically reducing installer size (~240 MB → ~70–85 MB) for system-managed environments (e.g., Linux packages declaring `openjdk-21-jre-headless`, `ffmpeg`, `mpv`, `aria2` as package dependencies, or developers building a local portable copy).

---

## 5. Performance & Caching Design

Running `-version` / `--list-modules` on 6 system binaries synchronously at launch would regress startup time (cold Windows spawns take ~590 ms each). To guarantee **zero main-thread stall**:

1. **Pure Resolver + Fingerprinted Cache:** Introduce a shared pure module `desktop/electron/platform/toolResolver.ts` (no Electron imports, testable with plain `node --experimental-strip-types`) that caches probe verdicts in `userData/tool-probes.json` keyed by `{ path, size, mtimeMs }`.
2. **Warm Launch Cost:** On subsequent launches, if the system binary's path, size, and mtime match the cached fingerprint, verification is a single `fs.statSync` (< 1 ms total across all tools) — zero child processes spawned.
3. **Cold Launch / Binary Changed:** Probes run asynchronously off the main thread using `runToolOffThread` (reusing `desktop/electron/media/toolCapabilities.ts`) during background startup, never blocking window paint.
4. **Cache Invalidation:** Automatically invalidated whenever `PATH` / `JAVA_HOME` changes, a binary's `size`/`mtimeMs` changes, or the user clicks "Test" / "Repair" in Settings.

---

## 6. Phased Implementation Plan

| Phase | Scope | Files Touched | Deliverable |
|---|---|---|---|
| **Phase 1: Core Resolution & Criteria Gate** | Shared system-first resolver, JPMS module + version + capability criteria gates, fingerprinted probe cache | New `desktop/electron/platform/toolResolver.ts` + `toolResolver.test.mts`; update `runtimeProvisioner.ts`, `binaryDownloader.ts` | System-native Java 21+ and media/download tools win over bundled/app-managed copies whenever they pass criteria; fallback works seamlessly when system tools are absent or too old. |
| **Phase 2: Developer Toolchain Alignment** | Unify `doctor.mjs`, `build-runtime.mjs`, `build-bridge.mjs`, `build-installer.mjs` on System-First; add advisory media tool checks & `--prune-duplicates` | `tools/package/doctor.mjs`, `build-runtime.mjs`, `build-bridge.mjs`, `build-installer.mjs` | `bun run doctor` / `bun run setup` use system JDK 21+ and Maven without downloading duplicates; media tools reported cleanly. |
| **Phase 3: IPC & Settings UI Origin Visibility** | Expose `origin` (`system`/`bundled`/`app-managed`/`toolchain`/`missing`) and `skippedSystemReason`; add "Prefer bundled" troubleshooting toggle | `desktop/electron/main.ts`, `preload.ts`, `src/types/electron.d.ts`, `RuntimeProvisionerCard.tsx`, `MediaComponentsCard.tsx`, `UnifiedComponentManager.tsx` | Users see "System Native" clearly with path/version; no redundant install prompts when system tools are ready. |
| **Phase 4: Slim / System-Managed Packaging (Optional)** | `--slim` flag in `build-installer.mjs`, `verify-package.mjs` slim mode, Linux `.deb` recommends/depends for `openjdk-21-jre` + `ffmpeg` + `mpv` | `tools/package/build-installer.mjs`, `verify-package.mjs`, `electron-builder.yml` | Lightweight ~80 MB build for system-managed environments. |

---

## 7. Verification & Acceptance Criteria

1. **Unit Tests (`toolResolver.test.mts`, `runtimeProvisioner` / `binaryDownloader` pure tests):**
   - System Java 21+ with required modules beats bundled JRE and `userData/cs3-runtime/java`.
   - System `JAVA_HOME` = Java 17 is rejected with an explicit `skippedSystemReason`, falling through to `PATH` (if Java 21+) or bundled JRE.
   - System Java 21 stripped of `jdk.crypto.ec` is rejected and falls back cleanly.
   - System `ffmpeg` + `ffprobe` + `mpv` + `yt-dlp` + `aria2c` beat `resources/media` and `userData/bin` when passing criteria, and fall back when broken/missing.
   - `CS3_PREFER_BUNDLED=1` (and Settings toggle) cleanly restores bundled-first order.
   - Fingerprint cache hits without spawning a child process; cache misses when `size` or `mtimeMs` changes.
   - Regression tests verified to **fail** against the old bundled-first resolution order.
2. **Developer Environment Verification:**
   - On a machine with system JDK 21+ (`JAVA_HOME`) and system Maven (`PATH`): `bun run setup` downloads **0 bytes** into `tools/toolchain/`, builds the sidecar using system tools, and `bun run dev` runs the sidecar on system Java with `javaOrigin: 'system'`.
   - On a machine with system `JAVA_HOME` = Java 17: `bun run doctor` explains why `JAVA_HOME` was skipped and offers/uses `tools/toolchain/jdk-21-*`.
3. **Production Verification:**
   - **Pre-configured machine** (system Java 21, FFmpeg, mpv, yt-dlp, aria2c): Packaged app uses all system binaries (`origin: 'system'`), creates no `userData/cs3-runtime/java` and no `userData/bin/*` duplicates, and Settings shows "System Native".
   - **Clean machine** (no system Java, FFmpeg, or mpv): Packaged app seamlessly falls back to bundled `resources/sidecar/jre` and `resources/media` (`origin: 'bundled'`) with zero user intervention.
4. **Startup Performance:** Warm startup adds < 5 ms main-thread time; cold system probe runs off-thread with zero UI freeze.
