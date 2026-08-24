import { app } from 'electron';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

import { FastChunkDownloader, type DownloadProgress as FastProgress } from '../fastDownloader';

export interface SystemRuntimeStatus {
  ready: boolean;
  javaReady: boolean;
  sidecarReady: boolean;
  bridgeReady: boolean;
  javaPath?: string;
  javaVersion?: string;
  sidecarPath?: string;
  runtimeDir?: string;
  isAppManaged: boolean;
  reason?: string;
  /**
   * The app-managed copy no longer matches the build it was copied from.
   *
   * Reported separately from `ready` on purpose: a stale runtime is complete
   * and starts fine, it just runs last month's shim. Folding it into `ready`
   * would make a working install look broken; leaving it out entirely is what
   * produced the bug this field exists to catch.
   */
  stale: boolean;
  staleReason?: string;
  generation?: number;
}

/**
 * Bumped whenever the shim, the bridge or the translator changes in a way that
 * an already-provisioned copy would get wrong.
 *
 * Generation 2 covers the androidx UI closure, `android.net.Uri`, the `DataStore`
 * and `CloudflareKiller` bridge types, and the per-class fix to
 * `KotlinNameRepair` — every one of which shipped into `sidecar/runtime` while
 * installed apps kept serving the generation-1 copy out of `%APPDATA%`.
 *
 * Generation 3 is the provider bridge learning to report what it had been
 * discarding: DRM parameters, playlist parts, audio-track headers, the link's
 * own type, and live streams' `dataUrl`. An old copy of the bridge still loads
 * and still scrapes, so nothing looks broken — it simply never emits any of
 * those fields, and the desktop half added for them sits inert. That is exactly
 * the failure this counter exists to prevent: a working install quietly missing
 * a capability the build believes it shipped.
 *
 * Generation 4 adds the `:app` lifecycle and activity shims (`CommonActivity`,
 * `MainActivity`, `CloudStreamApp`, `AcraApplication`) so plugins that read
 * preferences through `CommonActivity.activity` (e.g. `StreamingCommunity`) load
 * without NoClassDefFoundError.
 *
 * Generation 5 adds `NewPipeBootstrap` to the bridge. NewPipeExtractor holds one
 * global `Downloader` that must be installed before anything touches it, nothing
 * was installing one, and every YouTube link a provider returned therefore died
 * with `NullPointerException: downloader is null`. The bump is what carries the
 * fix into an installed app: the copy under `%APPDATA%` is resolved ahead of
 * every build location, so without it the old bridge keeps being served and the
 * fix reaches nobody who already has the app.
 *
 * Generation 6 is the WebView bridge (PRD-36 step 7). Both halves change: the
 * sidecar gains a reverse-call frame, and the bridge gains a `WebViewResolver`
 * that shadows `library-jvm`'s `TODO("Not yet implemented")` stub. This one has
 * a failure mode the earlier bumps did not — the two halves must agree, and a
 * provisioned copy that pairs a new sidecar with an old bridge has a channel
 * with nothing on the far end of it. There is a handshake for exactly that
 * (`hostCapabilities`, and the sidecar says so once on stderr), but the bump is
 * what makes it not happen.
 */
const RUNTIME_GENERATION = 6;

/** Records which build the app-managed copy was taken from. */
interface RuntimeStamp {
  generation: number;
  runtimeFingerprint: string;
  sidecarFingerprint: string;
  installedAt: string;
  sourceRuntimeDir?: string;
  sourceSidecarDir?: string;
}

const STAMP_FILE = 'runtime-stamp.json';

export interface RuntimeProgress {
  step: 'idle' | 'checking' | 'downloading' | 'extracting' | 'verifying' | 'completed' | 'error';
  progress: number; // 0 to 100
  message: string;
  error?: string;
}

const REQUIRED_JAVA_VERSION = 21;

/**
 * Fallback openJDK 21 binary mirrors for auto-provisioning
 * on machines that lack Java 21 and prebuilt resources.
 * Prioritizes high-speed CDNs (AWS CloudFront Amazon Corretto & Adoptium Mirrors).
 */
const PORTABLE_JAVA_MIRRORS: Record<string, string[]> = {
  win32_x64: [
    // 1. Amazon Corretto 21 JRE via AWS CloudFront CDN (High throughput, compact ~40MB)
    'https://corretto.aws/downloads/latest/amazon-corretto-21-x64-windows-jre.zip',
    // 2. Adoptium Temurin 21 HotSpot
    'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.2%2B13/OpenJDK21U-jre_x64_windows_hotspot_21.0.2_13.zip',
    // 3. Global CDN Proxy
    'https://ghproxy.net/https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.2%2B13/OpenJDK21U-jre_x64_windows_hotspot_21.0.2_13.zip',
  ],
  darwin_x64: [
    'https://corretto.aws/downloads/latest/amazon-corretto-21-x64-macos-jre.tar.gz',
    'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.2%2B13/OpenJDK21U-jre_x64_mac_hotspot_21.0.2_13.tar.gz',
  ],
  darwin_arm64: [
    'https://corretto.aws/downloads/latest/amazon-corretto-21-aarch64-macos-jre.tar.gz',
    'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.2%2B13/OpenJDK21U-jre_aarch64_mac_hotspot_21.0.2_13.tar.gz',
  ],
  linux_x64: [
    'https://corretto.aws/downloads/latest/amazon-corretto-21-x64-linux-jre.tar.gz',
    'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.2%2B13/OpenJDK21U-jre_x64_linux_hotspot_21.0.2_13.tar.gz',
  ],
};

export class RuntimeProvisioner {
  private baseDir: string;
  private listeners: Set<(progress: RuntimeProgress) => void> = new Set();
  private inFlightProvision: Promise<boolean> | null = null;
  private inFlightRepair: Promise<boolean> | null = null;
  private lastProgress: RuntimeProgress = {
    step: 'idle',
    progress: 0,
    message: 'Runtime is idle',
  };

  constructor(customBaseDir?: string) {
    this.baseDir =
      customBaseDir ??
      (app ? path.join(app.getPath('userData'), 'cs3-runtime') : path.join(process.cwd(), 'cs3-runtime'));
    fs.mkdirSync(this.baseDir, { recursive: true });
  }

  public setProgressCallback(cb: (progress: RuntimeProgress) => void): void {
    this.listeners.clear();
    this.listeners.add(cb);
  }

  public addProgressListener(cb: (progress: RuntimeProgress) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  public notifyProgress(p: RuntimeProgress): void {
    this.lastProgress = p;
    for (const listener of this.listeners) {
      try {
        listener(p);
      } catch (err) {
        console.warn('[RuntimeProvisioner] Error notifying progress listener:', err);
      }
    }
  }

  public getLastProgress(): RuntimeProgress {
    return this.lastProgress;
  }

  public get appDataRuntimeDir(): string {
    return this.baseDir;
  }

  /**
   * Evaluates whether all required runtime components exist and are ready for execution.
   */
  public getStatus(): SystemRuntimeStatus {
    const javaInfo = this.findJavaBinary();
    const sidecarInfo = this.findSidecarJar();
    const bridgeInfo = this.findRuntimeDir();

    const javaReady = Boolean(javaInfo && javaInfo.version >= REQUIRED_JAVA_VERSION);
    const sidecarReady = Boolean(sidecarInfo && fs.existsSync(sidecarInfo.jarPath));
    const bridgeReady = Boolean(bridgeInfo && bridgeInfo.hasBridge);

    const ready = javaReady && sidecarReady && bridgeReady;

    let reason: string | undefined;
    if (!ready) {
      const missing: string[] = [];
      if (!javaReady) missing.push(`Java ${REQUIRED_JAVA_VERSION}+ runtime`);
      if (!sidecarReady) missing.push('Extension sidecar (cs3-sidecar.jar)');
      if (!bridgeReady) missing.push('Provider bridge (library-jvm.jar)');
      reason = `Required components missing: ${missing.join(', ')}. Click "Install Required Components" in Settings to set up automatically.`;
    }

    const stamp = this.readStamp();
    const staleReason = this.describeStaleness(stamp);

    return {
      ready,
      javaReady,
      sidecarReady,
      bridgeReady,
      javaPath: javaInfo?.exePath,
      javaVersion: javaInfo ? `Java ${javaInfo.version}` : undefined,
      sidecarPath: sidecarInfo?.jarPath,
      runtimeDir: bridgeInfo?.dir,
      isAppManaged: Boolean(
        sidecarInfo?.jarPath.startsWith(this.baseDir) ||
          javaInfo?.exePath.startsWith(this.baseDir)
      ),
      reason,
      stale: staleReason !== undefined,
      staleReason,
      generation: stamp?.generation,
    };
  }

  // --- staleness -----------------------------------------------------------

  /**
   * Why the app-managed copy should be replaced, or `undefined` when it is current.
   *
   * The app-managed copy under `%APPDATA%` is resolved *before* every build
   * location, which is what makes the packaged app self-contained. The cost is
   * that once it exists it shadows the build forever unless something notices
   * it has drifted — and nothing did. Installed apps kept serving a shim with
   * no `androidx/**` and a bridge with no `DataStore` long after both were
   * fixed, and every extension that touched one reported `NoClassDefFoundError`
   * naming a class that had been shipped weeks earlier. Comparing a recorded
   * fingerprint against the source build is the whole fix.
   */
  private describeStaleness(stamp: RuntimeStamp | null): string | undefined {
    const managedRuntime = path.join(this.baseDir, 'runtime');
    const managedSidecar = path.join(this.baseDir, 'sidecar');
    // Nothing has been copied yet, so there is nothing to be stale.
    if (!fs.existsSync(managedRuntime) && !fs.existsSync(managedSidecar)) return undefined;

    if (!stamp) {
      return 'The extension runtime was installed by an older build that did not record its version.';
    }
    if (stamp.generation !== RUNTIME_GENERATION) {
      return `The extension runtime is generation ${stamp.generation}; this build ships generation ${RUNTIME_GENERATION}.`;
    }

    const source = this.findSourceComponents();
    if (source.runtimeDir) {
      const current = this.fingerprintDir(source.runtimeDir);
      if (current && current !== stamp.runtimeFingerprint) {
        return 'A newer provider runtime (library-jvm, bridge and android shim) is available in this build.';
      }
    }
    if (source.sidecarDir) {
      const current = this.fingerprintDir(source.sidecarDir);
      if (current && current !== stamp.sidecarFingerprint) {
        return 'A newer extension sidecar is available in this build.';
      }
    }
    return undefined;
  }

  /**
   * Content identity of a jar directory: name, size and mtime of every jar.
   *
   * Hashing the bytes would be more exact and costs seconds over ~60 jars on
   * every startup, which is not a trade worth making for a check that runs
   * before the window opens. Size plus mtime catches a rebuild, which is the
   * only way these directories ever change.
   */
  private fingerprintDir(dir: string): string | null {
    try {
      const parts: string[] = [];
      const walk = (d: string, prefix: string): void => {
        for (const entry of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) =>
          a.name.localeCompare(b.name)
        )) {
          const full = path.join(d, entry.name);
          const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
            walk(full, rel);
          } else if (entry.name.endsWith('.jar')) {
            const st = fs.statSync(full);
            parts.push(`${rel}:${st.size}:${Math.floor(st.mtimeMs)}`);
          }
        }
      };
      walk(dir, '');
      if (parts.length === 0) return null;
      return crypto.createHash('sha256').update(parts.join('\n')).digest('hex').slice(0, 32);
    } catch {
      return null;
    }
  }

  private get stampPath(): string {
    return path.join(this.baseDir, STAMP_FILE);
  }

  private readStamp(): RuntimeStamp | null {
    try {
      const raw = fs.readFileSync(this.stampPath, 'utf8');
      const parsed = JSON.parse(raw) as RuntimeStamp;
      return typeof parsed?.generation === 'number' ? parsed : null;
    } catch {
      return null;
    }
  }

  private writeStamp(stamp: RuntimeStamp): void {
    try {
      fs.writeFileSync(this.stampPath, JSON.stringify(stamp, null, 2), 'utf8');
    } catch (err) {
      console.warn('[RuntimeProvisioner] Could not record the runtime stamp:', err);
    }
  }

  /**
   * Resolves the Java binary location across all managed & fallback paths.
   */
  public findJavaBinary(): { exePath: string; version: number } | null {
    const exe = process.platform === 'win32' ? 'java.exe' : 'java';
    const candidates: string[] = [
      // 1. App-managed runtime directory (%APPDATA%\CloudStream 3 Desktop\cs3-runtime\java\bin\java.exe)
      path.join(this.baseDir, 'java', 'bin', exe),
      path.join(this.baseDir, 'jre', 'bin', exe),
      // 2. Bundled production resources (resources/sidecar/jre/bin/java.exe)
      ...(app?.isPackaged
        ? [path.join(process.resourcesPath, 'sidecar', 'jre', 'bin', exe)]
        : []),
      // 3. Prebuilt dist runtime in repo
      path.join(process.cwd(), '..', 'sidecar', 'dist', 'jre', 'bin', exe),
      path.join(process.cwd(), 'sidecar', 'dist', 'jre', 'bin', exe),
      path.join(process.cwd(), 'dist', 'jre', 'bin', exe),
    ];

    // 4. Developer toolchain JDKs
    const toolchainRoots = [
      path.join(process.cwd(), '..', 'tools', 'toolchain'),
      path.join(process.cwd(), 'tools', 'toolchain'),
    ];
    for (const toolchainRoot of toolchainRoots) {
      try {
        if (fs.existsSync(toolchainRoot)) {
          for (const entry of fs.readdirSync(toolchainRoot)) {
            if (entry.toLowerCase().startsWith('jdk')) {
              candidates.push(path.join(toolchainRoot, entry, 'bin', exe));
              candidates.push(path.join(toolchainRoot, entry, 'jre', 'bin', exe));
            }
          }
        }
      } catch {
        // Ignore directory read errors
      }
    }

    // 5. JAVA_HOME environment variable
    if (process.env.JAVA_HOME) {
      candidates.push(path.join(process.env.JAVA_HOME, 'bin', exe));
    }

    // 6. System PATH fallback
    candidates.push(exe);

    for (const candidate of candidates) {
      const isPath = candidate === exe;
      if (!isPath && !fs.existsSync(candidate)) continue;

      const version = this.probeJavaVersion(candidate);
      if (version && version >= REQUIRED_JAVA_VERSION) {
        return { exePath: candidate, version };
      }
    }

    return null;
  }

  /**
   * Build locations the app-managed copy is populated *from*, best first.
   *
   * Deliberately excludes `this.baseDir`. Provisioning used to call
   * `findSidecarJar()`/`findRuntimeDir()` — which answer with the app-managed
   * copy first — and then skip the copy when the answer already lived under
   * `baseDir`. That made the very first provision the last one: every later
   * build was resolved to the copy it was supposed to replace.
   */
  private sourceSidecarCandidates(): Array<{ jar: string; lib: string }> {
    return [
      ...(app?.isPackaged
        ? [
            {
              jar: path.join(process.resourcesPath, 'sidecar', 'cs3-sidecar.jar'),
              lib: path.join(process.resourcesPath, 'sidecar', 'lib'),
            },
          ]
        : []),
      {
        jar: path.join(process.cwd(), '..', 'sidecar', 'dist', 'cs3-sidecar.jar'),
        lib: path.join(process.cwd(), '..', 'sidecar', 'dist', 'lib'),
      },
      {
        jar: path.join(process.cwd(), 'sidecar', 'dist', 'cs3-sidecar.jar'),
        lib: path.join(process.cwd(), 'sidecar', 'dist', 'lib'),
      },
      {
        jar: path.join(process.cwd(), '..', 'sidecar', 'target', 'cs3-sidecar.jar'),
        lib: path.join(process.cwd(), '..', 'sidecar', 'target', 'lib'),
      },
      {
        jar: path.join(process.cwd(), 'sidecar', 'target', 'cs3-sidecar.jar'),
        lib: path.join(process.cwd(), 'sidecar', 'target', 'lib'),
      },
    ];
  }

  private sourceRuntimeCandidates(): string[] {
    return [
      ...(app?.isPackaged ? [path.join(process.resourcesPath, 'sidecar', 'runtime')] : []),
      path.join(process.cwd(), '..', 'sidecar', 'dist', 'runtime'),
      path.join(process.cwd(), 'sidecar', 'dist', 'runtime'),
      path.join(process.cwd(), '..', 'sidecar', 'runtime'),
      path.join(process.cwd(), 'sidecar', 'runtime'),
    ];
  }

  /**
   * A runtime directory is usable only if it has the provider API *and* the
   * bridge. A directory holding `library-jvm` alone is a half-built dev tree,
   * and copying it over a complete app-managed runtime would remove the bridge
   * the app was working with.
   */
  private describeRuntimeDir(dir: string): { dir: string; hasBridge: boolean } | null {
    try {
      if (!fs.existsSync(dir)) return null;
      const files = fs.readdirSync(dir);
      const hasLibraryJvm = files.some((f) => f.startsWith('library-jvm') && f.endsWith('.jar'));
      if (!hasLibraryJvm) return null;
      const hasBridge = files.some(
        (f) => f.startsWith('cs3-provider-bridge') && f.endsWith('.jar')
      );
      return { dir, hasBridge };
    } catch {
      return null;
    }
  }

  /** Newest mtime among the jars under a directory, or 0 if there are none. */
  private newestJarMtime(dir: string): number {
    let newest = 0;
    const walk = (d: string): void => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(d, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = path.join(d, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.name.endsWith('.jar')) {
          try {
            newest = Math.max(newest, fs.statSync(full).mtimeMs);
          } catch {
            // Unreadable jar; it cannot be the newest for our purposes.
          }
        }
      }
    };
    walk(dir);
    return newest;
  }

  /**
   * The best build-side runtime and sidecar, ignoring the app-managed copy.
   *
   * Chosen by build time, not by list order. `sidecar/dist/` is generated
   * *from* `sidecar/runtime/` by `tools/package/build-runtime.mjs`, so in a dev
   * checkout it is a snapshot that goes stale the moment Maven runs again —
   * and it sits earlier in the candidate list. Preferring whichever directory
   * was built most recently means a fresh `mvn package` takes effect without
   * anyone having to remember to re-run the packaging script first.
   *
   * A directory that carries the bridge always beats one that does not,
   * however new: a runtime without it can be started but cannot call a
   * provider.
   */
  private findSourceComponents(): {
    runtimeDir?: string;
    sidecarDir?: string;
    sidecarLib?: string;
  } {
    let runtime: { dir: string; hasBridge: boolean; mtime: number } | undefined;
    for (const candidate of this.sourceRuntimeCandidates()) {
      const described = this.describeRuntimeDir(candidate);
      if (!described) continue;
      const mtime = this.newestJarMtime(described.dir);
      if (
        !runtime ||
        (described.hasBridge && !runtime.hasBridge) ||
        (described.hasBridge === runtime.hasBridge && mtime > runtime.mtime)
      ) {
        runtime = { ...described, mtime };
      }
    }

    let sidecar: { dir: string; lib: string; mtime: number } | undefined;
    for (const candidate of this.sourceSidecarCandidates()) {
      if (!fs.existsSync(candidate.jar)) continue;
      let mtime = 0;
      try {
        mtime = fs.statSync(candidate.jar).mtimeMs;
      } catch {
        continue;
      }
      if (!sidecar || mtime > sidecar.mtime) {
        sidecar = { dir: path.dirname(candidate.jar), lib: candidate.lib, mtime };
      }
    }

    return { runtimeDir: runtime?.dir, sidecarDir: sidecar?.dir, sidecarLib: sidecar?.lib };
  }

  /**
   * Resolves the sidecar JAR across all managed & fallback paths.
   */
  public findSidecarJar(): { jarPath: string; libDir: string } | null {
    // The app-managed copy wins when it exists — that is what makes an
    // installed app independent of where it was built — and provisioning keeps
    // it current. Anything else falls back to the newest build on disk.
    const managed = {
      jar: path.join(this.baseDir, 'sidecar', 'cs3-sidecar.jar'),
      lib: path.join(this.baseDir, 'sidecar', 'lib'),
    };
    if (fs.existsSync(managed.jar)) return { jarPath: managed.jar, libDir: managed.lib };

    const source = this.findSourceComponents();
    if (source.sidecarDir) {
      return {
        jarPath: path.join(source.sidecarDir, 'cs3-sidecar.jar'),
        libDir: source.sidecarLib ?? path.join(source.sidecarDir, 'lib'),
      };
    }
    return null;
  }

  /**
   * Resolves the provider runtime directory (containing library-jvm-4.8.0.jar & bridge).
   */
  public findRuntimeDir(): { dir: string; hasBridge: boolean } | null {
    const managed = this.describeRuntimeDir(path.join(this.baseDir, 'runtime'));
    if (managed) return managed;

    const source = this.findSourceComponents();
    return source.runtimeDir ? this.describeRuntimeDir(source.runtimeDir) : null;
  }

  private probeJavaVersion(exePath: string): number | null {
    try {
      const probe = spawnSync(exePath, ['-version'], {
        encoding: 'utf8',
        timeout: 6000,
        windowsHide: true,
      });
      const output = `${probe.stderr ?? ''}${probe.stdout ?? ''}`;
      const match = output.match(/version "(\d+)(?:\.(\d+))?/);
      if (!match) return null;
      const major = parseInt(match[1], 10);
      return major === 1 ? parseInt(match[2] ?? '0', 10) : major;
    } catch {
      return null;
    }
  }

  /**
   * One-click Plug-and-Play Provisioner:
   * Copies bundled components or downloads missing runtimes automatically.
   * Uses singleton promise mutex to eliminate race conditions and UI flickering.
   */
  public async provisionRuntime(): Promise<boolean> {
    if (this.inFlightProvision) {
      return this.inFlightProvision;
    }

    this.inFlightProvision = (async () => {
      this.notifyProgress({
        step: 'checking',
        progress: 5,
        message: 'Checking CloudStream runtime components...',
      });

      try {
        const source = this.findSourceComponents();
        const stamp = this.readStamp();
        const targetRuntimeDir = path.join(this.baseDir, 'runtime');
        const targetSidecarDir = path.join(this.baseDir, 'sidecar');
        fs.mkdirSync(targetRuntimeDir, { recursive: true });
        fs.mkdirSync(targetSidecarDir, { recursive: true });

        // 1. Provider dependencies (library-jvm, the bridge, the android shim).
        //
        // Mirrored rather than merged: a jar the build dropped — a superseded
        // library-jvm, a renamed bridge — has to disappear from the copy too,
        // or it stays on the plugin classpath and the loader can resolve the
        // old class in preference to the new one.
        let runtimeFingerprint = stamp?.runtimeFingerprint ?? '';
        if (source.runtimeDir) {
          this.notifyProgress({
            step: 'extracting',
            progress: 25,
            message: 'Deploying CloudStream provider dependencies (library-jvm)...',
          });
          this.mirrorDirSync(source.runtimeDir, targetRuntimeDir);
          runtimeFingerprint = this.fingerprintDir(source.runtimeDir) ?? '';
        }

        // 2. The sidecar itself and its own dependencies.
        let sidecarFingerprint = stamp?.sidecarFingerprint ?? '';
        if (source.sidecarDir) {
          this.notifyProgress({
            step: 'extracting',
            progress: 50,
            message: 'Configuring extension compatibility sidecar (cs3-sidecar.jar)...',
          });
          this.mirrorDirSync(source.sidecarDir, targetSidecarDir);
          // `lib/` is a sibling of the jar in a dev checkout and a child of it
          // in `dist/`, so it is only copied separately when it is not already
          // underneath what was just mirrored.
          if (source.sidecarLib && !source.sidecarLib.startsWith(source.sidecarDir)) {
            this.mirrorDirSync(source.sidecarLib, path.join(targetSidecarDir, 'lib'));
          }
          sidecarFingerprint = this.fingerprintDir(source.sidecarDir) ?? '';
        }

        // 3. A new sidecar means a new translator, and translations are cached
        //    by archive hash alone. Serving generation-1 output to a
        //    generation-2 runtime is exactly how the KotlinNameRepair fix
        //    stayed invisible after it shipped.
        //
        //    An absent stamp counts as changed. That is the upgrade case — a
        //    copy installed before stamping existed — and it is the one run
        //    where the cache is most likely to hold output from the broken
        //    translator. On a genuinely fresh install the cache is empty, so
        //    clearing it costs nothing.
        const translatorChanged =
          stamp === null ||
          stamp.generation !== RUNTIME_GENERATION ||
          stamp.sidecarFingerprint !== sidecarFingerprint;
        if (translatorChanged) {
          this.clearTranslationCache();
        }

        // 4. Check Java status; if missing, auto-provision portable Java 21
        const javaInfo = this.findJavaBinary();
        if (!javaInfo || javaInfo.version < REQUIRED_JAVA_VERSION) {
          this.notifyProgress({
            step: 'downloading',
            progress: 60,
            message: 'Downloading Java 21 execution engine for extensions...',
          });
          await this.downloadPortableJava();
        }

        // 5. Verify final setup
        this.notifyProgress({
          step: 'verifying',
          progress: 95,
          message: 'Verifying runtime integrity and provider support...',
        });

        const finalStatus = this.getStatus();
        if (finalStatus.ready) {
          this.writeStamp({
            generation: RUNTIME_GENERATION,
            runtimeFingerprint,
            sidecarFingerprint,
            installedAt: new Date().toISOString(),
            sourceRuntimeDir: source.runtimeDir,
            sourceSidecarDir: source.sidecarDir,
          });
          this.notifyProgress({
            step: 'completed',
            progress: 100,
            message: 'CloudStream extension runtime ready.',
          });
          return true;
        } else {
          throw new Error(finalStatus.reason ?? 'Runtime verification failed.');
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        this.notifyProgress({
          step: 'error',
          progress: 0,
          message: 'Failed to prepare extension runtime.',
          error: errorMsg,
        });
        return false;
      } finally {
        this.inFlightProvision = null;
      }
    })();

    return this.inFlightProvision;
  }

  /**
   * Completely clears and repairs the app-managed runtime directory.
   */
  public async repairRuntime(): Promise<boolean> {
    if (this.inFlightRepair) {
      return this.inFlightRepair;
    }

    this.inFlightRepair = (async () => {
      try {
        if (fs.existsSync(this.baseDir)) {
          fs.rmSync(this.baseDir, { recursive: true, force: true });
          fs.mkdirSync(this.baseDir, { recursive: true });
        }
        return await this.provisionRuntime();
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        this.notifyProgress({
          step: 'error',
          progress: 0,
          message: 'Failed to repair runtime.',
          error: errorMsg,
        });
        return false;
      } finally {
        this.inFlightRepair = null;
      }
    })();

    return this.inFlightRepair;
  }

  private async downloadPortableJava(): Promise<void> {
    const key = `${process.platform}_${process.arch}`;
    const mirrors = PORTABLE_JAVA_MIRRORS[key] || PORTABLE_JAVA_MIRRORS['win32_x64'];
    if (!mirrors || mirrors.length === 0) {
      throw new Error(`No portable Java download configured for platform ${key}`);
    }

    const zipPath = path.join(this.baseDir, `java_temp_${Date.now()}.zip`);
    const javaTargetDir = path.join(this.baseDir, 'java');
    fs.mkdirSync(javaTargetDir, { recursive: true });

    try {
      await FastChunkDownloader.download({
        mirrors,
        targetPath: zipPath,
        maxConnections: 8,
        onProgress: (_p: FastProgress, statusText: string) => {
          const mappedPct = Math.min(88, Math.floor(60 + _p.percent * 0.28));
          this.notifyProgress({
            step: 'downloading',
            progress: mappedPct,
            message: statusText.replace(/^Downloading/, 'Downloading Java 21 engine'),
          });
        },
      });

      this.notifyProgress({
        step: 'extracting',
        progress: 90,
        message: 'Extracting Java 21 execution engine...',
      });

      // Extract portable Java archive into target directory
      this.extractArchive(zipPath, javaTargetDir);

      // If zip extracted into a subfolder (e.g., amazon-corretto-21... or jdk-21...), elevate contents
      try {
        const subdirs = fs.readdirSync(javaTargetDir);
        if (subdirs.length === 1) {
          const subPath = path.join(javaTargetDir, subdirs[0]);
          if (fs.statSync(subPath).isDirectory() && fs.existsSync(path.join(subPath, 'bin'))) {
            this.copyRecursiveSync(subPath, javaTargetDir);
            fs.rmSync(subPath, { recursive: true, force: true });
          }
        }
      } catch {
        // Ignore subfolder restructuring errors
      }
    } finally {
      // Clean up temporary zip
      try {
        if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
      } catch {
        // Ignore cleanup error
      }
    }
  }

  private extractArchive(archivePath: string, targetDir: string): void {
    if (process.platform === 'win32') {
      // Windows 10/11 native tar command is 50x faster and safer than PowerShell Expand-Archive
      const tarResult = spawnSync('tar.exe', ['-xf', archivePath, '-C', targetDir], {
        windowsHide: true,
        timeout: 60_000,
      });

      if (tarResult.status !== 0) {
        // Fallback to PowerShell Expand-Archive if tar fails
        const powershellCmd = `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${targetDir.replace(/'/g, "''")}' -Force`;
        const psResult = spawnSync('powershell', ['-NoProfile', '-Command', powershellCmd], {
          windowsHide: true,
          timeout: 120_000,
        });
        if (psResult.status !== 0) {
          throw new Error(
            `Failed to extract Java archive: ${psResult.stderr?.toString() || 'unknown extraction error'}`
          );
        }
      }
    } else {
      if (archivePath.endsWith('.tar.gz')) {
        spawnSync('tar', ['-xzf', archivePath, '-C', targetDir], { timeout: 60_000 });
      } else {
        spawnSync('unzip', ['-o', archivePath, '-d', targetDir], { timeout: 60_000 });
      }
    }
  }

  /**
   * Tests existing runtime components without downloading or extracting.
   */
  public async testRuntime(): Promise<{
    ok: boolean;
    version?: string;
    javaPath?: string;
    sidecarPath?: string;
    runtimeDir?: string;
    error?: string;
  }> {
    const javaInfo = this.findJavaBinary();
    if (!javaInfo) {
      return { ok: false, error: 'Java 21+ execution engine is not found or not provisioned.' };
    }

    const sidecarInfo = this.findSidecarJar();
    if (!sidecarInfo) {
      return { ok: false, error: 'Extension sidecar (cs3-sidecar.jar) is missing.' };
    }

    const runtimeInfo = this.findRuntimeDir();
    if (!runtimeInfo) {
      return { ok: false, error: 'Provider bridge dependencies (library-jvm) are missing.' };
    }

    return {
      ok: true,
      version: `Java ${javaInfo.version}`,
      javaPath: javaInfo.exePath,
      sidecarPath: sidecarInfo.jarPath,
      runtimeDir: runtimeInfo.dir,
    };
  }

  /**
   * Cleans / removes provisioned runtime components for a fresh re-installation.
   */
  public async cleanRuntime(): Promise<{ ok: boolean; message: string }> {
    try {
      if (fs.existsSync(this.baseDir)) {
        fs.rmSync(this.baseDir, { recursive: true, force: true });
      }
      return { ok: true, message: 'Runtime components removed successfully.' };
    } catch (e: any) {
      return { ok: false, message: e?.message || 'Failed to remove runtime directory.' };
    }
  }

  /**
   * Copies `src` over `dest` and removes anything in `dest` that `src` no
   * longer has. Only files whose size or mtime differ are rewritten, so a
   * no-op refresh over ~60 jars costs a stat each rather than 90 MB of I/O.
   */
  private mirrorDirSync(src: string, dest: string): void {
    if (!fs.existsSync(src)) return;
    fs.mkdirSync(dest, { recursive: true });

    const wanted = new Set<string>();
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      wanted.add(entry.name);
      const from = path.join(src, entry.name);
      const to = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        this.mirrorDirSync(from, to);
        continue;
      }
      try {
        const a = fs.statSync(from);
        const b = fs.existsSync(to) ? fs.statSync(to) : null;
        if (b && b.size === a.size && Math.floor(b.mtimeMs) === Math.floor(a.mtimeMs)) continue;
        fs.copyFileSync(from, to);
        // Carrying the mtime across is what makes the comparison above and the
        // fingerprint stable; without it every run looks like a change.
        fs.utimesSync(to, a.atime, a.mtime);
      } catch (err) {
        console.warn(`[RuntimeProvisioner] Could not copy ${from}:`, err);
      }
    }

    for (const existing of fs.readdirSync(dest)) {
      if (wanted.has(existing)) continue;
      try {
        fs.rmSync(path.join(dest, existing), { recursive: true, force: true });
      } catch {
        // A locked jar is left behind; the fingerprint will retry next launch.
      }
    }
  }

  /**
   * Drops cached DEX→JVM output.
   *
   * Translations are keyed by archive hash and nothing else, so they survive a
   * translator upgrade and keep serving bytecode produced by the version that
   * had the bug. Clearing costs one re-translation per installed extension.
   */
  public clearTranslationCache(): number {
    const dir = path.join(this.baseDir, 'translated');
    let removed = 0;
    try {
      if (!fs.existsSync(dir)) return 0;
      for (const entry of fs.readdirSync(dir)) {
        try {
          fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
          removed++;
        } catch {
          // In use by the running sidecar; it will be replaced in place.
        }
      }
    } catch (err) {
      console.warn('[RuntimeProvisioner] Could not clear the translation cache:', err);
    }
    return removed;
  }

  private copyRecursiveSync(src: string, dest: string): void {
    if (!fs.existsSync(src)) return;
    const stats = fs.statSync(src);

    if (stats.isDirectory()) {
      fs.mkdirSync(dest, { recursive: true });
      for (const child of fs.readdirSync(src)) {
        this.copyRecursiveSync(path.join(src, child), path.join(dest, child));
      }
    } else {
      fs.copyFileSync(src, dest);
    }
  }
}
