import { app } from 'electron';
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
}

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
    };
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
   * Resolves the sidecar JAR across all managed & fallback paths.
   */
  public findSidecarJar(): { jarPath: string; libDir: string } | null {
    const candidates = [
      // 1. App-managed directory (%APPDATA%\CloudStream 3 Desktop\cs3-runtime\sidecar\cs3-sidecar.jar)
      {
        jar: path.join(this.baseDir, 'sidecar', 'cs3-sidecar.jar'),
        lib: path.join(this.baseDir, 'sidecar', 'lib'),
      },
      // 2. Bundled electron resources
      ...(app?.isPackaged
        ? [
            {
              jar: path.join(process.resourcesPath, 'sidecar', 'cs3-sidecar.jar'),
              lib: path.join(process.resourcesPath, 'sidecar', 'lib'),
            },
          ]
        : []),
      // 3. Prebuilt sidecar dist
      {
        jar: path.join(process.cwd(), '..', 'sidecar', 'dist', 'cs3-sidecar.jar'),
        lib: path.join(process.cwd(), '..', 'sidecar', 'dist', 'lib'),
      },
      {
        jar: path.join(process.cwd(), 'sidecar', 'dist', 'cs3-sidecar.jar'),
        lib: path.join(process.cwd(), 'sidecar', 'dist', 'lib'),
      },
      // 4. Maven target directory (dev environment)
      {
        jar: path.join(process.cwd(), '..', 'sidecar', 'target', 'cs3-sidecar.jar'),
        lib: path.join(process.cwd(), '..', 'sidecar', 'target', 'lib'),
      },
      {
        jar: path.join(process.cwd(), 'sidecar', 'target', 'cs3-sidecar.jar'),
        lib: path.join(process.cwd(), 'sidecar', 'target', 'lib'),
      },
    ];

    for (const item of candidates) {
      if (fs.existsSync(item.jar)) {
        return { jarPath: item.jar, libDir: item.lib };
      }
    }

    return null;
  }

  /**
   * Resolves the provider runtime directory (containing library-jvm-4.8.0.jar & bridge).
   */
  public findRuntimeDir(): { dir: string; hasBridge: boolean } | null {
    const candidates = [
      // 1. App-managed directory (%APPDATA%\CloudStream 3 Desktop\cs3-runtime\runtime)
      path.join(this.baseDir, 'runtime'),
      // 2. Bundled electron resources
      ...(app?.isPackaged
        ? [path.join(process.resourcesPath, 'sidecar', 'runtime')]
        : []),
      // 3. Prebuilt dist runtime
      path.join(process.cwd(), '..', 'sidecar', 'dist', 'runtime'),
      path.join(process.cwd(), 'sidecar', 'dist', 'runtime'),
      // 4. Dev runtime
      path.join(process.cwd(), '..', 'sidecar', 'runtime'),
      path.join(process.cwd(), 'sidecar', 'runtime'),
    ];

    for (const candidate of candidates) {
      try {
        if (!fs.existsSync(candidate)) continue;
        const files = fs.readdirSync(candidate);
        const hasLibraryJvm = files.some(
          (f) => f.startsWith('library-jvm') && f.endsWith('.jar')
        );
        const hasBridge = files.some(
          (f) => f.startsWith('cs3-provider-bridge') && f.endsWith('.jar')
        );

        if (hasLibraryJvm) {
          return { dir: candidate, hasBridge };
        }
      } catch {
        // Ignore read errors
      }
    }

    return null;
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
        // 1. Copy available bundled or dev runtime dependencies into app-managed directory
        const runtimeInfo = this.findRuntimeDir();
        const targetRuntimeDir = path.join(this.baseDir, 'runtime');
        fs.mkdirSync(targetRuntimeDir, { recursive: true });

        if (runtimeInfo && !runtimeInfo.dir.startsWith(this.baseDir)) {
          this.notifyProgress({
            step: 'extracting',
            progress: 25,
            message: 'Deploying CloudStream provider dependencies (library-jvm)...',
          });
          this.copyRecursiveSync(runtimeInfo.dir, targetRuntimeDir);
        }

        // 2. Copy available sidecar files into app-managed directory
        const sidecarInfo = this.findSidecarJar();
        const targetSidecarDir = path.join(this.baseDir, 'sidecar');
        fs.mkdirSync(targetSidecarDir, { recursive: true });

        if (sidecarInfo && !sidecarInfo.jarPath.startsWith(this.baseDir)) {
          this.notifyProgress({
            step: 'extracting',
            progress: 50,
            message: 'Configuring extension compatibility sidecar (cs3-sidecar.jar)...',
          });
          this.copyRecursiveSync(path.dirname(sidecarInfo.jarPath), targetSidecarDir);
        }

        // 3. Check Java status; if missing, auto-provision portable Java 21
        const javaInfo = this.findJavaBinary();
        if (!javaInfo || javaInfo.version < REQUIRED_JAVA_VERSION) {
          this.notifyProgress({
            step: 'downloading',
            progress: 60,
            message: 'Downloading Java 21 execution engine for extensions...',
          });
          await this.downloadPortableJava();
        }

        // 4. Verify final setup
        this.notifyProgress({
          step: 'verifying',
          progress: 95,
          message: 'Verifying runtime integrity and provider support...',
        });

        const finalStatus = this.getStatus();
        if (finalStatus.ready) {
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
