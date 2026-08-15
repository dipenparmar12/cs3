import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { app } from 'electron';
import child_process from 'child_process';

export class BinaryDownloader {
  private binDir: string;

  constructor() {
    this.binDir = app ? path.join(app.getPath('userData'), 'bin') : path.join(process.cwd(), 'bin');
    if (!fs.existsSync(this.binDir)) {
      fs.mkdirSync(this.binDir, { recursive: true });
    }
  }

  public getBinDir(): string {
    return this.binDir;
  }

  /** Resolves a tool by name in the app's bin dir, then the dev-checkout one. */
  public resolveBinary(name: string): string | null {
    const exe = process.platform === 'win32' ? `${name}.exe` : name;
    for (const dir of [this.binDir, path.join(process.cwd(), 'bin')]) {
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
   * Installs FFmpeg and FFprobe with no user configuration.
   *
   * BtbN's build is chosen for two reasons: it is **GPL**, which matches this
   * project's licence, and it ships `ffprobe` alongside `ffmpeg`. The probe is
   * not optional here — it is what identifies the audio codec in a stream, and
   * therefore what makes it possible to tell "this file has no audio" apart
   * from "Chromium cannot decode this file's audio", which are the same silence
   * to a user.
   *
   * Nothing about PATH, codecs or environment variables is exposed. The user
   * presses one button.
   */
  public async setupFfmpeg(onStatus?: (status: string, percent: number) => void): Promise<boolean> {
    if (this.resolveBinary('ffmpeg') && this.resolveBinary('ffprobe')) return true;
    if (process.platform !== 'win32') {
      // Other platforms ship ffmpeg through a package manager; downloading a
      // Windows build there would be worse than saying so.
      if (onStatus) onStatus('Install ffmpeg with your system package manager.', 100);
      return false;
    }

    const url =
      'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip';
    const zipPath = path.join(this.binDir, 'ffmpeg.zip');

    if (onStatus) onStatus('Downloading media components…', 5);
    const ok = await this.downloadFile(url, zipPath, (p) => {
      if (onStatus) onStatus(`Downloading media components… ${p}%`, Math.floor(5 + p * 0.75));
    });

    if (!ok || !fs.existsSync(zipPath)) {
      if (onStatus) onStatus('Download failed. Check your connection and try again.', 0);
      return false;
    }

    if (onStatus) onStatus('Extracting…', 85);
    const extractDir = path.join(this.binDir, 'ffmpeg-tmp');
    try {
      child_process.execSync(
        `powershell -NoProfile -Command "Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${extractDir}' -Force"`,
        { windowsHide: true }
      );

      // The archive nests everything under a versioned directory, so the two
      // executables are located by search rather than by an assumed path.
      for (const tool of ['ffmpeg.exe', 'ffprobe.exe']) {
        const found = this.findFile(extractDir, tool);
        if (found) fs.copyFileSync(found, path.join(this.binDir, tool));
      }
    } catch (error) {
      console.warn('ffmpeg extraction failed:', error);
      if (onStatus) onStatus('Could not extract the media components.', 0);
      return false;
    } finally {
      try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch { /* best effort */ }
      try { fs.unlinkSync(zipPath); } catch { /* best effort */ }
    }

    const installed = Boolean(this.resolveBinary('ffmpeg') && this.resolveBinary('ffprobe'));
    if (onStatus) {
      onStatus(installed ? 'Media components installed.' : 'Installation incomplete.', 100);
    }
    return installed;
  }

  /** Depth-first search for a file name, for archives with nested layouts. */
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

  public async downloadFile(url: string, targetPath: string, onProgress?: (percent: number) => void): Promise<boolean> {
    return new Promise((resolve) => {
      const fileStream = fs.createWriteStream(targetPath);
      const requestClient = url.startsWith('https') ? https : http;

      const req = requestClient.get(url, { headers: { 'User-Agent': 'CloudStreamDesktop/1.0' } }, (res) => {
        // Handle HTTP redirects (301, 302)
        if (res.statusCode === 301 || res.statusCode === 302) {
          if (res.headers.location) {
            fileStream.close();
            return this.downloadFile(res.headers.location, targetPath, onProgress).then(resolve);
          }
        }

        const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
        let downloadedBytes = 0;

        res.on('data', (chunk) => {
          downloadedBytes += chunk.length;
          fileStream.write(chunk);
          if (totalBytes > 0 && onProgress) {
            onProgress(Math.floor((downloadedBytes / totalBytes) * 100));
          }
        });

        res.on('end', () => {
          fileStream.on('finish', () => {
            resolve(true);
          });
          fileStream.end();
        });
      });

      req.on('error', (err) => {
        console.error('Binary download error:', err);
        fileStream.close();
        if (fs.existsSync(targetPath)) {
          try { fs.unlinkSync(targetPath); } catch {}
        }
        resolve(false);
      });
    });
  }

  public async setupAria2(onStatus?: (status: string, percent: number) => void): Promise<boolean> {
    const binaryName = process.platform === 'win32' ? 'aria2c.exe' : 'aria2c';
    const targetBinaryPath = path.join(this.binDir, binaryName);

    if (fs.existsSync(targetBinaryPath)) return true;

    if (onStatus) onStatus('Downloading portable aria2c binary...', 20);

    const aria2Url = 'https://github.com/aria2/aria2/releases/download/release-1.37.0/aria2-1.37.0-win-64bit-build1.zip';
    const zipPath = path.join(this.binDir, 'aria2.zip');

    const downloadSuccess = await this.downloadFile(aria2Url, zipPath, (p) => {
      if (onStatus) onStatus(`Downloading aria2c engine... ${p}%`, Math.floor(20 + p * 0.5));
    });

    if (!downloadSuccess || !fs.existsSync(zipPath)) {
      const directExecutableUrl = 'https://raw.githubusercontent.com/dipenparmar12/cs3/main/bin/aria2c.exe';
      if (onStatus) onStatus('Downloading via mirror engine...', 50);
      await this.downloadFile(directExecutableUrl, targetBinaryPath, (p) => {
        if (onStatus) onStatus(`Configuring aria2c... ${p}%`, p);
      });
      return fs.existsSync(targetBinaryPath);
    }

    if (onStatus) onStatus('Extracting aria2c binary...', 80);

    // Extract zip via powershell safely
    try {
      child_process.execSync(`powershell -command "Expand-Archive -Path '${zipPath}' -DestinationPath '${this.binDir}' -Force"`);

      const files = fs.readdirSync(this.binDir, { recursive: true });
      for (const f of files) {
        const fullPath = path.join(this.binDir, String(f));
        if (path.basename(fullPath).toLowerCase() === 'aria2c.exe') {
          fs.copyFileSync(fullPath, targetBinaryPath);
          break;
        }
      }
      if (fs.existsSync(zipPath)) {
        try { fs.unlinkSync(zipPath); } catch {}
      }
    } catch (e) {
      console.warn('Extraction fallback:', e);
    }

    if (onStatus) onStatus('aria2c engine configured successfully!', 100);
    return fs.existsSync(targetBinaryPath);
  }

  public async setupYtDlp(onStatus?: (status: string, percent: number) => void): Promise<boolean> {
    const binaryName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
    const targetBinaryPath = path.join(this.binDir, binaryName);

    if (fs.existsSync(targetBinaryPath)) return true;

    if (onStatus) onStatus('Downloading portable yt-dlp fallback engine...', 30);

    const ytdlpUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';
    await this.downloadFile(ytdlpUrl, targetBinaryPath, (p) => {
      if (onStatus) onStatus(`Configuring yt-dlp... ${p}%`, Math.floor(30 + p * 0.7));
    });

    if (onStatus) onStatus('yt-dlp configured successfully!', 100);
    return fs.existsSync(targetBinaryPath);
  }
}
