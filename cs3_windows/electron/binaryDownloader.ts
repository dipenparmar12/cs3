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

  public checkBinaries(): { aria2: boolean; ytdlp: boolean } {
    const aria2Path = path.join(this.binDir, process.platform === 'win32' ? 'aria2c.exe' : 'aria2c');
    const ytdlpPath = path.join(this.binDir, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');

    const cwdAria2 = path.join(process.cwd(), 'bin', process.platform === 'win32' ? 'aria2c.exe' : 'aria2c');
    const cwdYtdlp = path.join(process.cwd(), 'bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');

    return {
      aria2: fs.existsSync(aria2Path) || fs.existsSync(cwdAria2),
      ytdlp: fs.existsSync(ytdlpPath) || fs.existsSync(cwdYtdlp)
    };
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
          fileStream.end();
          resolve(true);
        });
      });

      req.on('error', (err) => {
        console.error('Binary download error:', err);
        fileStream.close();
        if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
        resolve(false);
      });
    });
  }

  public async setupAria2(onStatus?: (status: string, percent: number) => void): Promise<boolean> {
    const binaryName = process.platform === 'win32' ? 'aria2c.exe' : 'aria2c';
    const targetBinaryPath = path.join(this.binDir, binaryName);

    if (fs.existsSync(targetBinaryPath)) return true;

    if (onStatus) onStatus('Downloading portable aria2c binary...', 20);

    // Direct github raw mirror for portable aria2c executable
    const aria2Url = 'https://github.com/aria2/aria2/releases/download/release-1.37.0/aria2-1.37.0-win-64bit-build1.zip';
    const zipPath = path.join(this.binDir, 'aria2.zip');

    const downloadSuccess = await this.downloadFile(aria2Url, zipPath, (p) => {
      if (onStatus) onStatus(`Downloading aria2c engine... ${p}%`, Math.floor(20 + p * 0.5));
    });

    if (!downloadSuccess || !fs.existsSync(zipPath)) {
      // Fallback direct executable mirror
      const directExecutableUrl = 'https://raw.githubusercontent.com/dipenparmar12/cs3/main/bin/aria2c.exe';
      if (onStatus) onStatus('Downloading via mirror engine...', 50);
      await this.downloadFile(directExecutableUrl, targetBinaryPath, (p) => {
        if (onStatus) onStatus(`Configuring aria2c... ${p}%`, p);
      });
      return fs.existsSync(targetBinaryPath);
    }

    if (onStatus) onStatus('Extracting aria2c binary...', 80);

    // Extract zip via powershell on Windows
    try {
      child_process.execSync(`powershell -command "Expand-Archive -Path '${zipPath}' -DestinationPath '${this.binDir}' -Force"`);
      
      // Search for aria2c.exe in extracted subfolder and move to binDir
      const files = fs.readdirSync(this.binDir, { recursive: true });
      for (const f of files) {
        const fullPath = path.join(this.binDir, String(f));
        if (path.basename(fullPath).toLowerCase() === 'aria2c.exe') {
          fs.copyFileSync(fullPath, targetBinaryPath);
          break;
        }
      }
      if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
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
