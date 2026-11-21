import fs from 'fs';
import os from 'node:os';
import { aria2Mirrors, extraSearchDirs, installHint, windowsTar, ytDlpMirrors } from './platform/binarySources.ts';
import {
  getSharedProbeCache,
  isPreferBundled,
  orderBinaryCandidates,
  probeManagedBinaryAsync,
  probeManagedBinarySync,
  resolveBinaryCandidate,
  systemSearchDirs,
  type ManagedToolName,
  type ToolResolution,
} from './platform/toolResolver.ts';
import path from 'path';
import { app } from 'electron';
import child_process from 'child_process';
import { FastChunkDownloader, type DownloadMirror, type DownloadProgress } from './fastDownloader';
import { fetchJson } from './torrent/http';
import { formatSetupSize } from '../src/utils/format.ts';

export interface BinaryTestResult {
  ok: boolean;
  version?: string;
  path?: string;
  error?: string;
}

const MANAGED_TOOLS = new Set<string>(['aria2c', 'yt-dlp', 'ffmpeg', 'ffprobe', 'mpv']);

const MIRRORS_FFMPEG = [
  // 1. Gyan Essentials: Highly optimized package (~38MB vs ~130MB), fast CDN, contains both ffmpeg & ffprobe
  'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip',
  // 2. Official GitHub Release upstream
  'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip',
  // (No ghproxy.net copy: "latest" has no digest to verify a mirror against — SEC-03.)
  // 4. Gyan Codex GitHub mirror
  'https://github.com/GyanD/codexffmpeg/releases/download/7.1/ffmpeg-7.1-essentials_build.zip',
];

/** Per-platform sources live in `platform/binarySources.ts`; these are this machine's. */
const MIRRORS_ARIA2 = aria2Mirrors(process.platform);
const MIRRORS_YTDLP = ytDlpMirrors(process.platform, process.arch);

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
   * `desktop/media-runtime/`, and `extraResources` copies that to
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
   * Resolves a managed helper tool with System-First, App-Fallback precedence
   * (PRD-57), gated by cached compatibility criteria.
   *
   * When a compatible system-wide tool exists (`PATH` or `extraSearchDirs`),
   * it is used directly without duplicating or shadowing it. Otherwise the
   * bundled (`resources/media` / `desktop/media-runtime`) and app-managed
   * (`userData/bin`) copies serve as fallback.
   *
   * Set `CS3_PREFER_BUNDLED=1` or enable "Prefer bundled runtimes" in Settings
   * to invert back to bundled-first (also used by release smoke tests).
   */
  public resolveBinaryWithOrigin(name: ManagedToolName): ToolResolution {
    const preferBundled = isPreferBundled();
    // Pair `ffprobe` with the directory of a verified system `ffmpeg` so both
    // tools come from the same FFmpeg build whenever possible.
    let pairedSystemDir: string | null = null;
    if (name === 'ffprobe' && !preferBundled) {
      const ffmpegRes = this.resolveBinaryWithOrigin('ffmpeg');
      if (ffmpegRes.origin === 'system' && ffmpegRes.path) {
        pairedSystemDir = path.dirname(ffmpegRes.path);
      }
    }

    const candidates = orderBinaryCandidates({
      name,
      preferBundled,
      bundledDirs: this.bundledDirs(),
      binDir: this.binDir,
      cwdBinDir: path.join(process.cwd(), 'bin'),
      systemDirs: systemSearchDirs(),
      pairedSystemDir,
    });

    return resolveBinaryCandidate(
      candidates,
      (file) => fs.existsSync(file),
      (candidate) => probeManagedBinarySync(name, candidate.exePath, getSharedProbeCache())
    );
  }

  public resolveBinary(name: string): string | null {
    if (MANAGED_TOOLS.has(name)) {
      return this.resolveBinaryWithOrigin(name as ManagedToolName).path;
    }

    const exe = process.platform === 'win32' ? `${name}.exe` : name;
    const systemDirs = [
      ...(process.env.PATH || '').split(path.delimiter),
      ...extraSearchDirs(process.platform, os.homedir()),
    ];
    const fallbackDirs = [...this.bundledDirs(), this.binDir, path.join(process.cwd(), 'bin')];
    const orderedDirs = isPreferBundled() ? [...fallbackDirs, ...systemDirs] : [...systemDirs, ...fallbackDirs];

    for (const dir of orderedDirs) {
      if (!dir) continue;
      const candidate = path.join(dir, exe);
      if (fs.existsSync(candidate)) return candidate;
    }
    return null;
  }

  /**
   * Pre-warms fingerprinted system binary probes off the main thread during
   * background startup so cold launches do not block Electron's event loop.
   */
  public async warmSystemProbes(): Promise<void> {
    if (isPreferBundled()) return;
    const tools: ManagedToolName[] = ['ffmpeg', 'ffprobe', 'mpv', 'yt-dlp', 'aria2c'];
    const sysDirs = systemSearchDirs();
    await Promise.all(
      tools.map(async (name) => {
        const exe = process.platform === 'win32' ? `${name}.exe` : name;
        for (const dir of sysDirs) {
          if (!dir) continue;
          const candidate = path.join(dir, exe);
          if (!fs.existsSync(candidate)) continue;
          const outcome = await probeManagedBinaryAsync(name, candidate, getSharedProbeCache());
          if (outcome.ok) break;
        }
      })
    );
  }

  /** True when this tool came out of the box rather than from the system or a download. */
  public isBundled(name: string): boolean {
    if (MANAGED_TOOLS.has(name)) {
      return this.resolveBinaryWithOrigin(name as ManagedToolName).origin === 'bundled';
    }
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
     */
    bundled: { ffmpeg: boolean; ffprobe: boolean; mpv: boolean };
    /** Per-tool origin, resolved path, version, and skipped-system diagnostics (PRD-57). */
    origins: Record<ManagedToolName, ToolResolution>;
  } {
    const aria2Res = this.resolveBinaryWithOrigin('aria2c');
    const ytdlpRes = this.resolveBinaryWithOrigin('yt-dlp');
    const ffmpegRes = this.resolveBinaryWithOrigin('ffmpeg');
    const ffprobeRes = this.resolveBinaryWithOrigin('ffprobe');
    const mpvRes = this.resolveBinaryWithOrigin('mpv');

    return {
      aria2: aria2Res.path !== null,
      ytdlp: ytdlpRes.path !== null,
      ffmpeg: ffmpegRes.path !== null,
      ffprobe: ffprobeRes.path !== null,
      mpv: mpvRes.path !== null,
      bundled: {
        ffmpeg: ffmpegRes.origin === 'bundled',
        ffprobe: ffprobeRes.origin === 'bundled',
        mpv: mpvRes.origin === 'bundled',
      },
      origins: {
        aria2c: aria2Res,
        'yt-dlp': ytdlpRes,
        ffmpeg: ffmpegRes,
        ffprobe: ffprobeRes,
        mpv: mpvRes,
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

    // Refresh the cached probe verdict on explicit test.
    getSharedProbeCache().delete(`bin:${name}:${binPath}`);

    const flag =
      name === 'yt-dlp' || name === 'mpv' ? '--version' : name === 'aria2c' ? '-v' : '-version';
    // On Windows, `mpv.com` beside `mpv.exe` prints stdout where `mpv.exe` does not.
    let probePath = binPath;
    if (process.platform === 'win32' && name === 'mpv' && binPath.toLowerCase().endsWith('.exe')) {
      const comPath = binPath.slice(0, -4) + '.com';
      if (fs.existsSync(comPath)) probePath = comPath;
    }

    return new Promise((resolve) => {
      child_process.execFile(probePath, [flag], { timeout: 8000, windowsHide: true }, (err, stdout, stderr) => {
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

    /*
     * Arguments, never a command string (audit SEC-04, CWE-78): the paths come
     * from the user profile, and on macOS/Linux `unzip "…"` ran through
     * /bin/sh, where a `$(…)` or backtick in the path is executed. PowerShell
     * reads the paths from its environment, so they are never parsed as script.
     */
    if (process.platform === 'win32') {
      try {
        // System32's libarchive tar by path: a GNU tar earlier on PATH reads
        // neither zip nor mpv's 7z, and Expand-Archive below cannot read 7z.
        child_process.execFileSync(windowsTar() ?? 'tar.exe', ['-xf', zipPath, '-C', destinationDir], {
          windowsHide: true,
          timeout: 45000,
          stdio: 'pipe',
        });
        return true;
      } catch {
        // Fall back to PowerShell Expand-Archive
        try {
          child_process.execFileSync(
            'powershell',
            [
              '-NoProfile',
              '-NonInteractive',
              '-Command',
              'Expand-Archive -LiteralPath $env:CS3_ARCHIVE -DestinationPath $env:CS3_DESTINATION -Force',
            ],
            {
              windowsHide: true,
              timeout: 60000,
              stdio: 'pipe',
              env: { ...process.env, CS3_ARCHIVE: zipPath, CS3_DESTINATION: destinationDir },
            }
          );
          return true;
        } catch (psErr) {
          console.warn('[BinaryDownloader] PowerShell unzip error:', psErr);
        }
      }
    } else {
      try {
        child_process.execFileSync('unzip', ['-o', zipPath, '-d', destinationDir], {
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
      // Test before downloading if binaries already exist (system-native or bundled/managed)
      const ffmpegOrigin = this.resolveBinaryWithOrigin('ffmpeg').origin;
      const ffprobeOrigin = this.resolveBinaryWithOrigin('ffprobe').origin;
      const test = await this.testBinary('ffmpeg');
      const testProbe = await this.testBinary('ffprobe');
      if (test.ok && testProbe.ok) {
        const msg =
          ffmpegOrigin === 'system' && ffprobeOrigin === 'system'
            ? `Using system-installed FFmpeg & FFprobe (${test.version || 'verified'}).`
            : 'Media components verified and ready.';
        if (onStatus) onStatus(msg, 100);
        return true;
      }

      if (process.platform !== 'win32') {
        if (onStatus) onStatus(installHint('ffmpeg', process.platform), 100);
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
      const origin = this.resolveBinaryWithOrigin('aria2c').origin;
      const test = await this.testBinary('aria2c');
      if (test.ok) {
        if (onStatus) {
          onStatus(
            origin === 'system'
              ? `Using system-installed aria2c (${test.version || 'verified'}).`
              : 'aria2c verified and ready.',
            100
          );
        }
        return true;
      }

      // aria2 publishes Windows builds only; elsewhere it is a system package,
      // and downloads still work without it through the built-in downloader.
      if (MIRRORS_ARIA2.length === 0) {
        if (onStatus) onStatus(installHint('aria2c', process.platform), 100);
        return false;
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
            mirrors: ['https://raw.githubusercontent.com/dipenparmar12/cs3/main/bin/aria2c.exe'],
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
      const origin = this.resolveBinaryWithOrigin('yt-dlp').origin;
      const test = await this.testBinary('yt-dlp');
      if (test.ok) {
        if (onStatus) {
          onStatus(
            origin === 'system'
              ? `Using system-installed yt-dlp (${test.version || 'verified'}).`
              : 'yt-dlp verified and ready.',
            100
          );
        }
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

      // A downloaded file is not executable on macOS or Linux until it is made so.
      if (process.platform !== 'win32' && fs.existsSync(targetBinaryPath)) {
        try {
          fs.chmodSync(targetBinaryPath, 0o755);
        } catch {
          /* reported by the test below */
        }
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
  private static readonly MIRRORS_MPV_FALLBACK: DownloadMirror[] = [
    'https://github.com/zhongfly/mpv-winbuild/releases/download/2026-08-18-e7191f2a65/mpv-x86_64-20260818-git-e7191f2a65.7z',
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
  private async resolveMpvMirrors(): Promise<DownloadMirror[]> {
    try {
      // Through the shared client so this honours the DNS-over-HTTPS setting
      // and the system proxy; a release feed the network cannot reach is
      // exactly the case the fallback mirrors below exist for.
      const release = await fetchJson<{
        assets?: Array<{ name?: string; browser_download_url?: string; digest?: string | null }>;
      }>(BinaryDownloader.MPV_RELEASE_API, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'cloudstream-desktop' },
        timeoutMs: 10_000,
      });
      const asset = (release.assets ?? []).find(
        (candidate) =>
          /^mpv-x86_64-\d/.test(candidate.name ?? '') && !/debug|dev/.test(candidate.name ?? '')
      );
      if (asset?.browser_download_url) {
        /*
         * GitHub states each new asset's SHA-256 in the release feed. With it,
         * the download is verified whichever mirror serves it, and the
         * ghproxy.net copy becomes usable; without it, GitHub only (SEC-03).
         */
        const sha256 = /^sha256:([0-9a-f]{64})$/i.exec(asset.digest ?? '')?.[1];
        const url = asset.browser_download_url;
        return sha256 ? [{ url, sha256 }, { url: `https://ghproxy.net/${url}`, sha256 }] : [url];
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
      const origin = this.resolveBinaryWithOrigin('mpv').origin;
      const existing = await this.testBinary('mpv');
      if (existing.ok) {
        if (onStatus) {
          onStatus(
            origin === 'system'
              ? `Using system-installed mpv (${existing.version || 'mpv'}).`
              : `Native engine ready (${existing.version || 'mpv'}).`,
            100
          );
        }
        return true;
      }

      /**
       * mpv is packaged everywhere but Windows, and the packaged build is the
       * one with the platform's own hardware decoding wired up. Downloading a
       * binary over the distribution's is how you end up with a player that
       * cannot open VA-API.
       */
      if (process.platform !== 'win32') {
        if (onStatus) onStatus(installHint('mpv', process.platform), 100);
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
    return formatSetupSize(bytes);
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
