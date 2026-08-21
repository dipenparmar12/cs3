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

  /**
   * Where the bundled media runtime lives.
   *
   * `tools/package/build-media-runtime.mjs` stages ffmpeg, ffprobe and mpv into
   * `cs3_windows/media-runtime/`, and `extraResources` copies that to
   * `resources/media/`. Both are listed so a dev checkout resolves the same
   * binaries the packaged app will.
   */
  private bundledDirs(): string[] {
    return [
      ...(app?.isPackaged ? [path.join(process.resourcesPath, 'media')] : []),
      path.join(process.cwd(), 'media-runtime'),
    ];
  }

  /**
   * Resolves a tool, preferring the copy that shipped with the app.
   *
   * The order is the point. It used to start at `userData/bin` — the directory
   * the on-demand downloader writes to — which is the same shape as the
   * stale-runtime trap documented in `AGENTS.md`: a copy fetched by an older
   * version of the app silently shadows the one this version was built and
   * tested against, and nothing reports it. The bundled copy is versioned with
   * the app, so it wins.
   *
   * **`yt-dlp` is the deliberate exception.** Extractors break when a site
   * changes, which happens weekly, so a downloaded copy there is *newer* rather
   * than staler and pinning it to the release cadence would break downloads
   * between releases. It keeps the old order.
   */
  public resolveBinary(name: string): string | null {
    const exe = process.platform === 'win32' ? `${name}.exe` : name;
    const selfUpdating = name === 'yt-dlp';

    const dirs = selfUpdating
      ? [this.binDir, ...this.bundledDirs(), path.join(process.cwd(), 'bin')]
      : [...this.bundledDirs(), this.binDir, path.join(process.cwd(), 'bin')];

    for (const dir of dirs) {
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

  /** True when this tool came out of the box rather than from a download. */
  public isBundled(name: string): boolean {
    const resolved = this.resolveBinary(name);
    if (!resolved) return false;
    return this.bundledDirs().some((dir) => resolved.startsWith(dir + path.sep));
  }

  public checkBinaries(): {
    aria2: boolean;
    ytdlp: boolean;
    ffmpeg: boolean;
    ffprobe: boolean;
    mpv: boolean;
    /**
     * Which of these came out of the box.
     *
     * Carried separately so the UI can say "included" rather than "installed".
     * The difference is not cosmetic: a card reporting "Installed" for something
     * the user never installed teaches them that the status is decorative, and
     * the same card is what they will look at when something really is missing.
     */
    bundled: { ffmpeg: boolean; ffprobe: boolean; mpv: boolean };
  } {
    return {
      aria2: this.resolveBinary('aria2c') !== null,
      ytdlp: this.resolveBinary('yt-dlp') !== null,
      ffmpeg: this.resolveBinary('ffmpeg') !== null,
      ffprobe: this.resolveBinary('ffprobe') !== null,
      mpv: this.resolveBinary('mpv') !== null,
      bundled: {
        ffmpeg: this.isBundled('ffmpeg'),
        ffprobe: this.isBundled('ffprobe'),
        mpv: this.isBundled('mpv'),
      },
    };
  }

  /**
   * Tests an existing binary by executing it with a version flag.
   */
  public async testBinary(
    name: 'aria2c' | 'yt-dlp' | 'ffmpeg' | 'ffprobe' | 'mpv'
  ): Promise<BinaryTestResult> {
    const binPath = this.resolveBinary(name);
    if (!binPath) {
      return { ok: false, error: `${name} is not installed` };
    }

    const flag =
      name === 'yt-dlp' || name === 'mpv' ? '--version' : name === 'aria2c' ? '-v' : '-version';

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
  public removeBinary(
    name: 'aria2c' | 'yt-dlp' | 'ffmpeg' | 'ffprobe' | 'mpv' | 'media' | 'downloads' | 'all'
  ): boolean {
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
    /**
     * `media` deliberately does not include mpv. Removing the ffmpeg pair is how
     * a user repairs a broken probe; taking the native engine with it would
     * silently undo a 32 MB download they made on purpose.
     */
    if (name === 'mpv' || name === 'all') {
      targets.push('mpv.exe', 'mpv.com', 'mpv');
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
  /**
   * Where to get mpv, and why this list is resolved rather than hardcoded.
   *
   * mpv publishes no "latest" URL for Windows. Every official-adjacent build is
   * tagged by date and commit — `mpv-x86_64-20260818-git-e7191f2a65.7z` — so a
   * constant would rot into a 404 on a schedule nobody is watching. The release
   * API is asked for the current asset first, and these remain as the answer for
   * a machine that cannot reach api.github.com but can reach the CDN.
   */
  private static readonly MPV_RELEASE_API =
    'https://api.github.com/repos/zhongfly/mpv-winbuild/releases/latest';
  private static readonly MIRRORS_MPV_FALLBACK = [
    'https://github.com/zhongfly/mpv-winbuild/releases/download/2026-08-18-e7191f2a65/mpv-x86_64-20260818-git-e7191f2a65.7z',
    'https://ghproxy.net/https://github.com/zhongfly/mpv-winbuild/releases/download/2026-08-18-e7191f2a65/mpv-x86_64-20260818-git-e7191f2a65.7z',
  ];

  private inFlightMpv: Promise<boolean> | null = null;

  /**
   * Asks the release feed which archive is current.
   *
   * `x86_64` rather than `x86_64-v3`: the v3 build requires AVX2 and simply
   * crashes on anything older, which is a failure mode with no diagnostic — the
   * process dies before it can say why. A few percent of decode throughput is
   * not worth an app that will not start on a 2013 laptop.
   */
  private async resolveMpvMirrors(): Promise<string[]> {
    try {
      const response = await fetch(BinaryDownloader.MPV_RELEASE_API, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'cloudstream-desktop' },
        signal: AbortSignal.timeout(10_000),
      });
      if (response.ok) {
        const release = (await response.json()) as {
          assets?: Array<{ name?: string; browser_download_url?: string }>;
        };
        const asset = (release.assets ?? []).find(
          (candidate) => /^mpv-x86_64-\d/.test(candidate.name ?? '') && !/debug|dev/.test(candidate.name ?? '')
        );
        if (asset?.browser_download_url) {
          return [asset.browser_download_url, `https://ghproxy.net/${asset.browser_download_url}`];
        }
      }
    } catch {
      /* the fallbacks below are exactly for this */
    }
    return BinaryDownloader.MIRRORS_MPV_FALLBACK;
  }

  /**
   * Installs the native playback engine.
   *
   * One 119 MB statically-linked executable, and no DLLs beside it — which is
   * why this can be a single file copy where ffmpeg needed a directory. It is
   * the largest thing the app fetches, so it is deliberately **not** part of
   * `setupAll`: someone who only ever watches H.264 web releases never needs it,
   * and spending 32 MB of their bandwidth to prove that would be rude.
   *
   * The archive is 7-Zip, which is not a passing detail. Windows' own `tar.exe`
   * is bsdtar/libarchive and reads 7z fine; PowerShell's `Expand-Archive` does
   * not, so the fallback path in {@link extractZip} cannot rescue this one. On a
   * system where bsdtar is missing the honest outcome is a named failure rather
   * than a half-extracted directory.
   */
  public async setupMpv(onStatus?: (status: string, percent: number) => void): Promise<boolean> {
    if (this.inFlightMpv) return this.inFlightMpv;

    this.inFlightMpv = (async () => {
      const existing = await this.testBinary('mpv');
      if (existing.ok) {
        if (onStatus) onStatus(`Native engine ready (${existing.version || 'mpv'}).`, 100);
        return true;
      }

      /**
       * mpv is packaged everywhere but Windows, and the packaged build is the
       * one with the platform's own hardware decoding wired up. Downloading a
       * binary over the distribution's is how you end up with a player that
       * cannot open VA-API.
       */
      if (process.platform !== 'win32') {
        if (onStatus) {
          onStatus(
            process.platform === 'darwin'
              ? 'Install mpv with `brew install mpv`, then reopen this panel.'
              : 'Install mpv with your package manager (e.g. `apt install mpv`), then reopen this panel.',
            100
          );
        }
        return false;
      }

      if (onStatus) onStatus('Locating the current native engine build...', 4);
      const mirrors = await this.resolveMpvMirrors();

      const archivePath = path.join(this.binDir, 'mpv.7z');
      if (onStatus) onStatus('Downloading the native playback engine (~32 MB)...', 8);

      try {
        await FastChunkDownloader.download({
          mirrors,
          targetPath: archivePath,
          maxConnections: 8,
          onProgress: (progress: DownloadProgress, statusText: string) => {
            if (onStatus) onStatus(statusText, Math.min(85, Math.floor(8 + progress.percent * 0.77)));
          },
        });
      } catch (error: any) {
        console.error('[BinaryDownloader] mpv download failed:', error);
        if (onStatus) onStatus(`Download failed: ${error?.message || 'Network error'}`, 0);
        return false;
      }

      if (!fs.existsSync(archivePath)) {
        if (onStatus) onStatus('Download failed. Please check your internet connection.', 0);
        return false;
      }

      if (onStatus) onStatus('Extracting the native playback engine...', 88);
      const extractDir = path.join(this.binDir, 'mpv-tmp');
      try {
        if (!this.extractZip(archivePath, extractDir)) {
          if (onStatus) {
            onStatus('Could not extract the engine: this system has no 7-Zip-capable tar.', 0);
          }
          return false;
        }
        /**
         * `mpv.com` is copied alongside `mpv.exe` deliberately. It is the
         * console front-end, and it is what makes `--version` and `--hwdec=help`
         * answer on stdout at all — `mpv.exe` is a GUI subsystem binary whose
         * output goes nowhere. Without it the engine works and every diagnostic
         * about it comes back empty.
         */
        for (const tool of ['mpv.exe', 'mpv.com']) {
          const found = this.findFile(extractDir, tool);
          if (!found) continue;
          const destination = path.join(this.binDir, tool);
          try {
            if (fs.existsSync(destination)) fs.unlinkSync(destination);
          } catch {
            /* replaced below regardless */
          }
          fs.copyFileSync(found, destination);
        }
      } catch (error) {
        console.warn('[BinaryDownloader] mpv extraction failed:', error);
        if (onStatus) onStatus('Could not extract the native playback engine.', 0);
        return false;
      } finally {
        try {
          fs.rmSync(extractDir, { recursive: true, force: true });
        } catch {
          /* best effort */
        }
        try {
          fs.unlinkSync(archivePath);
        } catch {
          /* best effort */
        }
      }

      const verified = await this.testBinary('mpv');
      if (onStatus) {
        onStatus(
          verified.ok
            ? `Native engine ready (${verified.version || 'mpv'}).`
            : 'Installation incomplete.',
          verified.ok ? 100 : 0
        );
      }
      return verified.ok;
    })().finally(() => {
      this.inFlightMpv = null;
    });

    return this.inFlightMpv;
  }

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
