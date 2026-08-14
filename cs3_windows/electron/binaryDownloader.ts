import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import child_process from 'child_process';
import { FastChunkDownloader, type DownloadProgress } from './fastDownloader';

export interface BinaryTestResult {
  ok: boolean;
  version?: string;
  path?: string;
  error?: string;
}

const MIRRORS_FFMPEG = [
  // 1. Gyan Essentials: Highly optimized package (~38MB vs ~130MB), fast CDN, contains both ffmpeg & ffprobe
  'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip',
  // 2. Official GitHub Release upstream
  'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip',
  // 3. Global CDN proxy fallback
  'https://ghproxy.net/https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip',
  // 4. Gyan Codex GitHub mirror
  'https://github.com/GyanD/codexffmpeg/releases/download/7.1/ffmpeg-7.1-essentials_build.zip',
];

const MIRRORS_ARIA2 = [
  'https://github.com/aria2/aria2/releases/download/release-1.37.0/aria2-1.37.0-win-64bit-build1.zip',
  'https://ghproxy.net/https://github.com/aria2/aria2/releases/download/release-1.37.0/aria2-1.37.0-win-64bit-build1.zip',
  'https://raw.githubusercontent.com/dipenparmar12/cs3/main/bin/aria2c.exe',
];

const MIRRORS_YTDLP = [
  'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe',
  'https://ghproxy.net/https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe',
  'https://github.com/yt-dlp/yt-dlp/releases/download/2025.02.19/yt-dlp.exe',
];

export class BinaryDownloader {
  private binDir: string;
  private inFlightAria2: Promise<boolean> | null = null;
  private inFlightYtDlp: Promise<boolean> | null = null;
  private inFlightFfmpeg: Promise<boolean> | null = null;
  private inFlightAll: Promise<{ ok: boolean; message: string }> | null = null;

  constructor() {
    this.binDir = app ? path.join(app.getPath('userData'), 'bin') : path.join(process.cwd(), 'bin');
    if (!fs.existsSync(this.binDir)) {
      try {
        fs.mkdirSync(this.binDir, { recursive: true });
      } catch {
        /* best effort */
      }
    }
  }

  public getBinDir(): string {
    return this.binDir;
  }

  /** Resolves a tool by name in the app's bin dir, then dev checkout, then PATH. */
  public resolveBinary(name: string): string | null {
    const exe = process.platform === 'win32' ? `${name}.exe` : name;
    for (const dir of [this.binDir, path.join(process.cwd(), 'bin')]) {
      const candidate = path.join(dir, exe);
      if (fs.existsSync(candidate)) return candidate;
    }

    // Check system PATH
    const pathDirs = (process.env.PATH || '').split(path.delimiter);
    for (const dir of pathDirs) {
      if (!dir) continue;
      const candidate = path.join(dir, exe);
      if (fs.existsSync(candidate)) return candidate;
    }

    return null;
  }

  public checkBinaries(): { aria2: boolean; ytdlp: boolean; ffmpeg: boolean; ffprobe: boolean } {
    return {
      aria2: this.resolveBinary('aria2c') !== null,
      ytdlp: this.resolveBinary('yt-dlp') !== null,
      ffmpeg: this.resolveBinary('ffmpeg') !== null,
      ffprobe: this.resolveBinary('ffprobe') !== null,
    };
  }

  /**
   * Tests an existing binary by executing it with a version flag.
   */
  public async testBinary(name: 'aria2c' | 'yt-dlp' | 'ffmpeg' | 'ffprobe'): Promise<BinaryTestResult> {
    const binPath = this.resolveBinary(name);
    if (!binPath) {
      return { ok: false, error: `${name} is not installed` };
    }

    const flag = name === 'yt-dlp' ? '--version' : name === 'aria2c' ? '-v' : '-version';

    return new Promise((resolve) => {
      child_process.execFile(binPath, [flag], { timeout: 8000, windowsHide: true }, (err, stdout, stderr) => {
        if (err && !stdout && !stderr) {
          resolve({ ok: false, path: binPath, error: err.message });
          return;
        }

        const out = (stdout || stderr || '').trim();
        const firstLine = out.split('\n')[0]?.trim() || `${name} executable ready`;
        resolve({ ok: true, version: firstLine, path: binPath });
      });
    });
  }

  /**
   * Tests all 4 tools in parallel.
   */
  public async testAllBinaries(): Promise<{
    aria2: BinaryTestResult;
    ytdlp: BinaryTestResult;
    ffmpeg: BinaryTestResult;
    ffprobe: BinaryTestResult;
  }> {
    const [aria2, ytdlp, ffmpeg, ffprobe] = await Promise.all([
      this.testBinary('aria2c'),
      this.testBinary('yt-dlp'),
      this.testBinary('ffmpeg'),
      this.testBinary('ffprobe'),
    ]);
    return { aria2, ytdlp, ffmpeg, ffprobe };
  }

  /**
   * Removes installed binaries so the user can perform a fresh install.
   */
  public removeBinary(name: 'aria2c' | 'yt-dlp' | 'ffmpeg' | 'ffprobe' | 'media' | 'downloads' | 'all'): boolean {
    const targets: string[] = [];
    if (name === 'aria2c' || name === 'downloads' || name === 'all') {
      targets.push('aria2c.exe', 'aria2c');
    }
    if (name === 'yt-dlp' || name === 'downloads' || name === 'all') {
      targets.push('yt-dlp.exe', 'yt-dlp');
    }
    if (name === 'ffmpeg' || name === 'media' || name === 'all') {
      targets.push('ffmpeg.exe', 'ffmpeg');
    }
    if (name === 'ffprobe' || name === 'media' || name === 'all') {
      targets.push('ffprobe.exe', 'ffprobe');
    }

    let anyRemoved = false;
    for (const exe of targets) {
      const file = path.join(this.binDir, exe);
      if (fs.existsSync(file)) {
        try {
          fs.unlinkSync(file);
          anyRemoved = true;
        } catch (e) {
          console.warn(`Could not remove ${file}:`, e);
        }
      }
    }
    return anyRemoved;
  }

  /**
   * Fast native archive extraction with fallback.
   */
  private extractZip(zipPath: string, destinationDir: string): boolean {
    try {
      fs.mkdirSync(destinationDir, { recursive: true });
    } catch {
      /* ignore */
    }

    // Try Windows native tar.exe first (ultra fast & reliable)
    if (process.platform === 'win32') {
      try {
        child_process.execSync(`tar.exe -xf "${zipPath}" -C "${destinationDir}"`, {
          windowsHide: true,
          timeout: 45000,
          stdio: 'pipe',
        });
        return true;
      } catch {
        // Fall back to PowerShell Expand-Archive
        try {
          const escapedZip = zipPath.replace(/'/g, "''");
          const escapedDest = destinationDir.replace(/'/g, "''");
          child_process.execSync(
            `powershell -NoProfile -Command "Expand-Archive -LiteralPath '${escapedZip}' -DestinationPath '${escapedDest}' -Force"`,
            { windowsHide: true, timeout: 60000, stdio: 'pipe' }
          );
          return true;
        } catch (psErr) {
          console.warn('[BinaryDownloader] PowerShell unzip error:', psErr);
        }
      }
    } else {
      try {
        child_process.execSync(`unzip -o "${zipPath}" -d "${destinationDir}"`, {
          windowsHide: true,
          timeout: 45000,
          stdio: 'pipe',
        });
        return true;
      } catch {}
    }
    return false;
  }

  /**
   * High-speed parallel download & configuration for FFmpeg and FFprobe.
   */
  public async setupFfmpeg(onStatus?: (status: string, percent: number) => void): Promise<boolean> {
    if (this.inFlightFfmpeg) return this.inFlightFfmpeg;

    this.inFlightFfmpeg = (async () => {
      // Test before downloading if binaries already exist
      const test = await this.testBinary('ffmpeg');
      const testProbe = await this.testBinary('ffprobe');
      if (test.ok && testProbe.ok) {
        if (onStatus) onStatus('Media components verified and ready.', 100);
        return true;
      }

      if (process.platform !== 'win32') {
        if (onStatus) onStatus('Please install ffmpeg through your system package manager.', 100);
        return false;
      }

      const zipPath = path.join(this.binDir, 'ffmpeg.zip');
      if (onStatus) onStatus('Connecting to high-speed media mirrors...', 5);

      try {
        await FastChunkDownloader.download({
          mirrors: MIRRORS_FFMPEG,
          targetPath: zipPath,
          maxConnections: 8,
          onProgress: (_p: DownloadProgress, statusText: string) => {
            const mappedPercent = Math.min(85, Math.floor(5 + _p.percent * 0.8));
            if (onStatus) onStatus(statusText, mappedPercent);
          },
        });
      } catch (err: any) {
        console.error('[BinaryDownloader] FFmpeg download failed:', err);
        if (onStatus) onStatus(`Download failed: ${err?.message || 'Network error'}`, 0);
        return false;
      }

      if (!fs.existsSync(zipPath)) {
        if (onStatus) onStatus('Download failed. Please check your internet connection.', 0);
        return false;
      }

      if (onStatus) onStatus('Extracting media components (ffmpeg & ffprobe)...', 88);
      const extractDir = path.join(this.binDir, 'ffmpeg-tmp');
      try {
        const extracted = this.extractZip(zipPath, extractDir);
        if (extracted) {
          for (const tool of ['ffmpeg.exe', 'ffprobe.exe']) {
            const found = this.findFile(extractDir, tool);
            if (found) {
              const dest = path.join(this.binDir, tool);
              try { if (fs.existsSync(dest)) fs.unlinkSync(dest); } catch {}
              fs.copyFileSync(found, dest);
            }
          }
        }
      } catch (error) {
        console.warn('ffmpeg extraction failed:', error);
        if (onStatus) onStatus('Could not extract media components.', 0);
        return false;
      } finally {
        try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch {}
        try { fs.unlinkSync(zipPath); } catch {}
      }

      // Verify installed tools
      const verifyFfmpeg = await this.testBinary('ffmpeg');
      const verifyFfprobe = await this.testBinary('ffprobe');
      const installed = Boolean(verifyFfmpeg.ok && verifyFfprobe.ok);

      if (onStatus) {
        onStatus(
          installed
            ? `Media components ready (${verifyFfmpeg.version || 'FFmpeg Active'})`
            : 'Installation incomplete.',
          installed ? 100 : 0
        );
      }
      return installed;
    })().finally(() => {
      this.inFlightFfmpeg = null;
    });

    return this.inFlightFfmpeg;
  }

  /**
   * High-speed parallel download & configuration for aria2c.
   */
  public async setupAria2(onStatus?: (status: string, percent: number) => void): Promise<boolean> {
    if (this.inFlightAria2) return this.inFlightAria2;

    this.inFlightAria2 = (async () => {
      const test = await this.testBinary('aria2c');
      if (test.ok) {
        if (onStatus) onStatus('aria2c verified and ready.', 100);
        return true;
      }

      const binaryName = process.platform === 'win32' ? 'aria2c.exe' : 'aria2c';
      const targetBinaryPath = path.join(this.binDir, binaryName);
      const zipPath = path.join(this.binDir, 'aria2.zip');

      if (onStatus) onStatus('Connecting to high-speed aria2c mirrors...', 10);

      try {
        await FastChunkDownloader.download({
          mirrors: MIRRORS_ARIA2,
          targetPath: zipPath,
          maxConnections: 4,
          onProgress: (_p: DownloadProgress, statusText: string) => {
            const mappedPercent = Math.min(85, Math.floor(10 + _p.percent * 0.75));
            if (onStatus) onStatus(statusText, mappedPercent);
          },
        });
      } catch (err: any) {
        console.warn('[BinaryDownloader] aria2 zip download error:', err);
      }

      // If downloaded as direct executable or as zip archive:
      if (fs.existsSync(zipPath)) {
        // Check if the zipPath is actually a raw executable or a real zip
        const extractDir = path.join(this.binDir, 'aria2-tmp');
        try {
          if (onStatus) onStatus('Extracting aria2c engine...', 90);
          const extracted = this.extractZip(zipPath, extractDir);
          if (extracted) {
            const found = this.findFile(extractDir, 'aria2c.exe');
            if (found) {
              try { if (fs.existsSync(targetBinaryPath)) fs.unlinkSync(targetBinaryPath); } catch {}
              fs.copyFileSync(found, targetBinaryPath);
            }
          }
        } catch (e) {
          console.warn('aria2c extraction error:', e);
        } finally {
          try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch {}
          try { fs.unlinkSync(zipPath); } catch {}
        }
      }

      // If zip extraction didn't yield executable, try direct download to targetBinaryPath
      if (!fs.existsSync(targetBinaryPath)) {
        try {
          if (onStatus) onStatus('Downloading aria2c direct binary...', 50);
          await FastChunkDownloader.download({
            mirrors: [
              'https://raw.githubusercontent.com/dipenparmar12/cs3/main/bin/aria2c.exe',
              'https://ghproxy.net/https://raw.githubusercontent.com/dipenparmar12/cs3/main/bin/aria2c.exe',
            ],
            targetPath: targetBinaryPath,
            maxConnections: 2,
            onProgress: (_p: DownloadProgress, statusText: string) => {
              if (onStatus) onStatus(statusText, Math.min(90, Math.floor(50 + _p.percent * 0.4)));
            },
          });
        } catch {
          /* best effort */
        }
      }

      const verify = await this.testBinary('aria2c');
      const installed = Boolean(verify.ok && fs.existsSync(targetBinaryPath));
      if (onStatus) {
        onStatus(
          installed
            ? `aria2c engine configured successfully (${verify.version || 'Operational'})`
            : 'aria2c setup failed.',
          installed ? 100 : 0
        );
      }
      return installed;
    })().finally(() => {
      this.inFlightAria2 = null;
    });

    return this.inFlightAria2;
  }

  /**
   * High-speed parallel download & configuration for yt-dlp.
   */
  public async setupYtDlp(onStatus?: (status: string, percent: number) => void): Promise<boolean> {
    if (this.inFlightYtDlp) return this.inFlightYtDlp;

    this.inFlightYtDlp = (async () => {
      const test = await this.testBinary('yt-dlp');
      if (test.ok) {
        if (onStatus) onStatus('yt-dlp verified and ready.', 100);
        return true;
      }

      const binaryName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
      const targetBinaryPath = path.join(this.binDir, binaryName);

      if (onStatus) onStatus('Connecting to high-speed yt-dlp mirrors...', 10);

      try {
        await FastChunkDownloader.download({
          mirrors: MIRRORS_YTDLP,
          targetPath: targetBinaryPath,
          maxConnections: 6,
          onProgress: (_p: DownloadProgress, statusText: string) => {
            const mappedPercent = Math.min(92, Math.floor(10 + _p.percent * 0.82));
            if (onStatus) onStatus(statusText, mappedPercent);
          },
        });
      } catch (err: any) {
        console.error('[BinaryDownloader] yt-dlp download failed:', err);
        if (onStatus) onStatus(`yt-dlp download failed: ${err?.message || 'Network error'}`, 0);
        return false;
      }

      const verify = await this.testBinary('yt-dlp');
      const installed = Boolean(verify.ok && fs.existsSync(targetBinaryPath));
      if (onStatus) {
        onStatus(
          installed
            ? `yt-dlp configured successfully (v${verify.version || 'Active'})`
            : 'yt-dlp setup failed.',
          installed ? 100 : 0
        );
      }
      return installed;
    })().finally(() => {
      this.inFlightYtDlp = null;
    });

    return this.inFlightYtDlp;
  }

  /**
   * Sets up all missing binaries concurrently with status updates.
   */
  public async setupAll(
    onProgress?: (component: string, status: string, percent: number) => void
  ): Promise<{ ok: boolean; message: string }> {
    if (this.inFlightAll) return this.inFlightAll;

    this.inFlightAll = (async () => {
      const results: string[] = [];

      // Run download engines (aria2c + yt-dlp) and media components (ffmpeg)
      onProgress?.('aria2c', 'Configuring aria2c...', 5);
      const aria2Ok = await this.setupAria2((status, p) => onProgress?.('aria2c', status, p));
      results.push(aria2Ok ? 'aria2c ready' : 'aria2c failed');

      onProgress?.('yt-dlp', 'Configuring yt-dlp...', 5);
      const ytdlpOk = await this.setupYtDlp((status, p) => onProgress?.('yt-dlp', status, p));
      results.push(ytdlpOk ? 'yt-dlp ready' : 'yt-dlp failed');

      onProgress?.('ffmpeg', 'Configuring media components...', 5);
      const ffmpegOk = await this.setupFfmpeg((status, p) => onProgress?.('ffmpeg', status, p));
      results.push(ffmpegOk ? 'ffmpeg/ffprobe ready' : 'ffmpeg/ffprobe failed');

      const allOk = aria2Ok && ytdlpOk && ffmpegOk;
      return {
        ok: allOk,
        message: results.join(', '),
      };
    })().finally(() => {
      this.inFlightAll = null;
    });

    return this.inFlightAll;
  }

  private findFile(root: string, fileName: string): string | null {
    if (!fs.existsSync(root)) return null;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      const full = path.join(root, entry.name);
      if (entry.isDirectory()) {
        const nested = this.findFile(full, fileName);
        if (nested) return nested;
      } else if (entry.name.toLowerCase() === fileName.toLowerCase()) {
        return full;
      }
    }
    return null;
  }

  public formatBytes(bytes: number): string {
    return FastChunkDownloader.formatBytes(bytes);
  }

  /**
   * Legacy single-url download method preserved for backward compatibility,
   * powered by FastChunkDownloader.
   */
  public async downloadFile(
    url: string,
    targetPath: string,
    onProgress?: (downloadedBytes: number, totalBytes: number, percent: number) => void
  ): Promise<boolean> {
    try {
      return await FastChunkDownloader.download({
        mirrors: [url],
        targetPath,
        onProgress: (p) => {
          if (onProgress) onProgress(p.downloadedBytes, p.totalBytes, p.percent);
        },
      });
    } catch {
      return false;
    }
  }
}
