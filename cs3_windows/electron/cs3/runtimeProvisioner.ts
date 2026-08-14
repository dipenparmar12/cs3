import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { spawnSync } from 'child_process';

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
 * Fallback openJDK 21 binary download metadata for auto-provisioning
 * on machines that lack Java 21 and prebuilt resources.
 */
const PORTABLE_JAVA_URLS: Record<string, { url: string; sha256?: string }> = {
  win32_x64: {
    url: 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.2%2B13/OpenJDK21U-jre_x64_windows_hotspot_21.0.2_13.zip',
  },
};

export class RuntimeProvisioner {
  private baseDir: string;
  private onProgressCb: ((progress: RuntimeProgress) => void) | null = null;

  constructor(customBaseDir?: string) {
    this.baseDir =
      customBaseDir ??
      (app ? path.join(app.getPath('userData'), 'cs3-runtime') : path.join(process.cwd(), 'cs3-runtime'));
    fs.mkdirSync(this.baseDir, { recursive: true });
  }

  public setProgressCallback(cb: (progress: RuntimeProgress) => void): void {
    this.onProgressCb = cb;
  }

  private notifyProgress(p: RuntimeProgress): void {
    if (this.onProgressCb) this.onProgressCb(p);
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
      reason = `Required components missing: ${missing.join(', ')}. Click "Install / Repair Components" in Settings to set up automatically.`;
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
      // 1. App-managed runtime directory (%APPDATA%\CloudStream\cs3-runtime\java\bin\java.exe)
      path.join(this.baseDir, 'java', 'bin', exe),
      path.join(this.baseDir, 'jre', 'bin', exe),
      // 2. Bundled production resources (resources/sidecar/jre/bin/java.exe)
      ...(app?.isPackaged
        ? [path.join(process.resourcesPath, 'sidecar', 'jre', 'bin', exe)]
        : []),
      // 3. Prebuilt dist runtime in repo
      path.join(process.cwd(), '..', 'sidecar', 'dist', 'jre', 'bin', exe),
      path.join(process.cwd(), 'sidecar', 'dist', 'jre', 'bin', exe),
    ];

    // 4. Developer toolchain JDKs
    const toolchainRoot = path.join(process.cwd(), '..', 'tools', 'toolchain');
    try {
      if (fs.existsSync(toolchainRoot)) {
        for (const entry of fs.readdirSync(toolchainRoot)) {
          if (entry.toLowerCase().startsWith('jdk')) {
            candidates.push(path.join(toolchainRoot, entry, 'bin', exe));
          }
        }
      }
    } catch {
      // Ignore directory read errors
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
      // 1. App-managed directory (%APPDATA%\CloudStream\cs3-runtime\sidecar\cs3-sidecar.jar)
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
      // 1. App-managed directory (%APPDATA%\CloudStream\cs3-runtime\runtime)
      path.join(this.baseDir, 'runtime'),
      // 2. Bundled electron resources
      ...(app?.isPackaged
        ? [path.join(process.resourcesPath, 'sidecar', 'runtime')]
        : []),
      // 3. Prebuilt dist runtime
      path.join(process.cwd(), '..', 'sidecar', 'dist', 'runtime'),
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
   */
  public async provisionRuntime(): Promise<boolean> {
    this.notifyProgress({
      step: 'checking',
      progress: 5,
      message: 'Checking CloudStream runtime components...',
    });

    try {
      // 1. Copy available bundled or dev sidecar files into app-managed user directory if needed
      const sidecarInfo = this.findSidecarJar();
      const targetSidecarDir = path.join(this.baseDir, 'sidecar');
      fs.mkdirSync(targetSidecarDir, { recursive: true });

      if (sidecarInfo && !sidecarInfo.jarPath.startsWith(this.baseDir)) {
        this.notifyProgress({
          step: 'extracting',
          progress: 25,
          message: 'Configuring extension sidecar runtime...',
        });
        this.copyRecursiveSync(path.dirname(sidecarInfo.jarPath), targetSidecarDir);
      }

      const runtimeInfo = this.findRuntimeDir();
      const targetRuntimeDir = path.join(this.baseDir, 'runtime');
      fs.mkdirSync(targetRuntimeDir, { recursive: true });

      if (runtimeInfo && !runtimeInfo.dir.startsWith(this.baseDir)) {
        this.notifyProgress({
          step: 'extracting',
          progress: 55,
          message: 'Deploying CloudStream provider dependencies...',
        });
        this.copyRecursiveSync(runtimeInfo.dir, targetRuntimeDir);
      }

      // 2. Check Java status; if missing, auto-provision
      const javaInfo = this.findJavaBinary();
      if (!javaInfo || javaInfo.version < REQUIRED_JAVA_VERSION) {
        this.notifyProgress({
          step: 'downloading',
          progress: 60,
          message: 'Downloading Java 21 runtime for extensions...',
        });
        await this.downloadPortableJava();
      }

      // 3. Verify final setup
      this.notifyProgress({
        step: 'verifying',
        progress: 95,
        message: 'Verifying runtime integrity...',
      });

      const finalStatus = this.getStatus();
      if (finalStatus.ready) {
        this.notifyProgress({
          step: 'completed',
          progress: 100,
          message: 'CloudStream runtime ready.',
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
    }
  }

  /**
   * Completely clears and repairs the app-managed runtime directory.
   */
  public async repairRuntime(): Promise<boolean> {
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
    }
  }

  private async downloadPortableJava(): Promise<void> {
    const key = `${process.platform}_${process.arch}`;
    const meta = PORTABLE_JAVA_URLS[key] || PORTABLE_JAVA_URLS['win32_x64'];
    if (!meta) {
      throw new Error(`No portable Java download configured for platform ${key}`);
    }

    const zipPath = path.join(this.baseDir, 'java_temp.zip');
    const javaTargetDir = path.join(this.baseDir, 'java');

    await this.downloadFile(meta.url, zipPath, (downloaded, total) => {
      const pct = total > 0 ? Math.floor((downloaded / total) * 30) + 65 : 75;
      this.notifyProgress({
        step: 'downloading',
        progress: Math.min(90, pct),
        message: `Downloading Java 21 (${(downloaded / (1024 * 1024)).toFixed(1)} MB)...`,
      });
    });

    this.notifyProgress({
      step: 'extracting',
      progress: 92,
      message: 'Extracting Java 21 runtime...',
    });

    // Unzip portable Java into target directory
    if (process.platform === 'win32') {
      const powershellCmd = `Expand-Archive -Path "${zipPath}" -DestinationPath "${javaTargetDir}" -Force`;
      spawnSync('powershell', ['-NoProfile', '-Command', powershellCmd], { windowsHide: true });
    } else {
      spawnSync('unzip', ['-o', zipPath, '-d', javaTargetDir]);
    }

    // If zip extracted into a subfolder (e.g., jdk-21.0.2+13-jre), elevate contents
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

    // Clean up temporary zip
    try {
      if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
    } catch {
      // Ignore cleanup error
    }
  }

  private downloadFile(
    url: string,
    destPath: string,
    onProgress: (downloaded: number, total: number) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(destPath);
      const getter = url.startsWith('https') ? https : http;

      const request = getter.get(url, { headers: { 'User-Agent': 'CloudStream-Desktop/1.0' } }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
          fs.unlinkSync(destPath);
          return this.downloadFile(res.headers.location, destPath, onProgress).then(resolve).catch(reject);
        }

        if (res.statusCode !== 200) {
          file.close();
          fs.unlinkSync(destPath);
          return reject(new Error(`Server returned HTTP ${res.statusCode}`));
        }

        const total = parseInt(res.headers['content-length'] ?? '0', 10);
        let downloaded = 0;

        res.on('data', (chunk: Buffer) => {
          downloaded += chunk.length;
          file.write(chunk);
          onProgress(downloaded, total);
        });

        res.on('end', () => {
          file.end();
          resolve();
        });
      });

      request.on('error', (err) => {
        file.close();
        if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
        reject(err);
      });
    });
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
