import { spawn, ChildProcess } from 'child_process';
import crypto from 'crypto';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';

export interface Aria2Progress {
  gid: string;
  status: 'active' | 'waiting' | 'paused' | 'completed' | 'error' | 'removed';
  totalLength: number;
  completedLength: number;
  downloadSpeed: number;
  errorCode?: string;
  errorMessage?: string;
}

export class Aria2Engine {
  private aria2Process: ChildProcess | null = null;
  private rpcSecret: string;
  private port: number = 6800;


  constructor() {
    this.rpcSecret = crypto.randomUUID();
  }

  public getBinaryPath(): string | null {
    const binaryName = process.platform === 'win32' ? 'aria2c.exe' : 'aria2c';
    const userBin = app ? path.join(app.getPath('userData'), 'bin', binaryName) : '';
    const cwdBin = path.join(process.cwd(), 'bin', binaryName);

    if (userBin && fs.existsSync(userBin)) return userBin;
    if (fs.existsSync(cwdBin)) return cwdBin;
    return null;
  }

  public async start(): Promise<boolean> {
    try {
      const binaryPath = this.getBinaryPath();

      if (!binaryPath) {
        console.warn(`aria2c binary not found. Downloads will use HTTP stream fallback.`);
        return false;
      }

      const args = [
        '--enable-rpc',
        '--rpc-listen-all=false', // Loopback 127.0.0.1 only
        `--rpc-listen-port=${this.port}`,
        `--rpc-secret=${this.rpcSecret}`,
        '--max-connection-per-server=16',
        '--split=16',
        '--min-split-size=1M',
        '--file-allocation=none',
        '--quiet=true'
      ];

      this.aria2Process = spawn(binaryPath, args, { stdio: 'ignore' });

      this.aria2Process.on('error', (err) => {
        console.warn('aria2c spawn process warning:', err.message);
        this.aria2Process = null;
      });


      return true;
    } catch (e) {
      console.warn('Failed to start aria2 engine:', e);
      return false;
    }
  }

  public isRunning(): boolean {
    return this.aria2Process !== null;
  }

  public async sendRpc<T>(method: string, params: any[] = []): Promise<T> {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify({
        jsonrpc: '2.0',
        id: crypto.randomUUID(),
        method: `aria2.${method}`,
        params: [`token:${this.rpcSecret}`, ...params]
      });

      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: this.port,
          path: '/jsonrpc',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
          }
        },
        (res) => {
          let body = '';
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => {
            try {
              const json = JSON.parse(body);
              if (json.error) {
                reject(new Error(json.error.message));
              } else {
                resolve(json.result as T);
              }
            } catch (err) {
              reject(err);
            }
          });
        }
      );

      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  }

  public async addUri(
    url: string,
    outputDir: string,
    filename: string,
    headers: Record<string, string> = {}
  ): Promise<string> {
    if (!this.aria2Process) {
      throw new Error('aria2c engine binary not running');
    }

    const headerOption: string[] = [];
    for (const [key, val] of Object.entries(headers)) {
      headerOption.push(`${key}: ${val}`);
    }

    const options: any = {
      dir: outputDir,
      out: filename,
      header: headerOption,
      'max-connection-per-server': '16',
      split: '16'
    };

    return await this.sendRpc<string>('addUri', [[url], options]);
  }

  public async getStatus(gid: string): Promise<Aria2Progress> {
    if (!this.aria2Process) {
      return { gid, status: 'error', totalLength: 0, completedLength: 0, downloadSpeed: 0, errorMessage: 'Engine not running' };
    }

    const raw = await this.sendRpc<any>('tellStatus', [
      gid,
      ['gid', 'status', 'totalLength', 'completedLength', 'downloadSpeed', 'errorCode', 'errorMessage']
    ]);

    return {
      gid: raw.gid,
      status: raw.status,
      totalLength: parseInt(raw.totalLength || '0', 10),
      completedLength: parseInt(raw.completedLength || '0', 10),
      downloadSpeed: parseInt(raw.downloadSpeed || '0', 10),
      errorCode: raw.errorCode,
      errorMessage: raw.errorMessage
    };
  }

  public async pause(gid: string): Promise<string> {
    if (!this.aria2Process) return gid;
    return await this.sendRpc<string>('pause', [gid]);
  }

  public async unpause(gid: string): Promise<string> {
    if (!this.aria2Process) return gid;
    return await this.sendRpc<string>('unpause', [gid]);
  }

  public async remove(gid: string): Promise<string> {
    if (!this.aria2Process) return gid;
    return await this.sendRpc<string>('remove', [gid]);
  }

  public stop(): void {
    if (this.aria2Process) {
      this.aria2Process.kill();
      this.aria2Process = null;
    }
  }
}
