import { spawn, ChildProcess } from 'child_process';
import crypto from 'crypto';
import http from 'http';
import net from 'net';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';

export interface Aria2Progress {
  gid: string;
  /**
   * aria2's own vocabulary, passed through untouched — and `complete` is the
   * word, not `completed`.
   *
   * This union used to say `completed`, which is not a value aria2 ever sends.
   * `getStatus` copies `raw.status` straight through, so the comparison in
   * `DownloadService.pollAria2Tasks` could never be true: a finished download
   * sat at 100% in the `Downloading` state forever, its gid never released, and
   * the poller kept asking about it for the life of the session. Verified
   * against a live aria2 RPC: `tellStatus` answers `"active"` then `"complete"`.
   */
  status: 'active' | 'waiting' | 'paused' | 'complete' | 'error' | 'removed';
  totalLength: number;
  completedLength: number;
  downloadSpeed: number;
  errorCode?: string;
  errorMessage?: string;
}

/**
 * Where to start looking for a port. aria2's own default, so a user watching
 * with a port monitor sees the number they expect — but it is a starting point
 * and not a requirement; see `findFreePort`.
 */
const PREFERRED_PORT = 6800;
/** How many ports above the preferred one to try before giving up. */
const PORT_SCAN_RANGE = 24;
/** How long to wait for the spawned daemon's RPC to answer before failing. */
const RPC_READY_TIMEOUT_MS = 4_000;

export class Aria2Engine {
  private aria2Process: ChildProcess | null = null;
  private rpcSecret: string;
  private port: number = PREFERRED_PORT;
  /**
   * Why the last `start()` failed, in words a person can act on.
   *
   * The daemon used to be spawned with `stdio: 'ignore'`, so when it refused to
   * start the reason was discarded and the app reported only that downloads had
   * fallen back to the HTTP path — at a fraction of the speed, for the life of
   * the install, with nothing anywhere saying why. A silent downgrade is the
   * failure mode this codebase keeps having to fix.
   */
  private lastError: string | null = null;
  private starting: Promise<boolean> | null = null;

  constructor() {
    this.rpcSecret = crypto.randomUUID();
  }

  /** The port the daemon actually bound, once it has started. */
  public getPort(): number {
    return this.port;
  }

  /** Why the engine is unavailable, or null when it is running or untried. */
  public getLastError(): string | null {
    return this.lastError;
  }

  public getBinaryPath(): string | null {
    const binaryName = process.platform === 'win32' ? 'aria2c.exe' : 'aria2c';
    const userBin = app ? path.join(app.getPath('userData'), 'bin', binaryName) : '';
    const cwdBin = path.join(process.cwd(), 'bin', binaryName);

    if (userBin && fs.existsSync(userBin)) return userBin;
    if (fs.existsSync(cwdBin)) return cwdBin;
    return null;
  }

  /**
   * A port nothing else is listening on, starting at aria2's default.
   *
   * 6800 is aria2's *documented* default, which means the people most likely to
   * collide with it are the ones already running aria2 — a seedbox operator, a
   * Deluge user, anyone with an aria2 tray app. That is precisely this app's
   * technical audience, and hard-coding the number handed exactly them the
   * slowest download path available.
   *
   * Binding is the test rather than a connect attempt: a connect that fails
   * tells you nothing about whether *we* will be allowed to listen there.
   */
  private async findFreePort(): Promise<number | null> {
    for (let candidate = PREFERRED_PORT; candidate < PREFERRED_PORT + PORT_SCAN_RANGE; candidate++) {
      const free = await new Promise<boolean>((resolve) => {
        const probe = net.createServer();
        probe.once('error', () => resolve(false));
        probe.once('listening', () => probe.close(() => resolve(true)));
        probe.listen(candidate, '127.0.0.1');
      });
      if (free) return candidate;
    }
    return null;
  }

  /** Polls the RPC until it answers, so "started" means "usable". */
  private async waitForRpc(deadlineMs: number): Promise<boolean> {
    const until = Date.now() + deadlineMs;
    while (Date.now() < until) {
      try {
        await this.sendRpc('getVersion');
        return true;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
    }
    return false;
  }

  /**
   * Start the daemon, and only report success once its RPC actually answers.
   *
   * The old implementation returned `true` the moment `spawn` returned. A port
   * conflict is not a spawn error — aria2 starts, fails to bind, and exits with
   * a non-zero code a few milliseconds later — so `isRunning()` answered true
   * for a dead process and every `addUri` after it failed with a message about
   * the *download* rather than about the engine.
   */
  public async start(): Promise<boolean> {
    if (this.aria2Process) return true;
    if (this.starting) return this.starting;

    this.starting = this.startOnce().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async startOnce(): Promise<boolean> {
    try {
      const binaryPath = this.getBinaryPath();
      if (!binaryPath) {
        this.lastError = 'aria2c is not installed. Downloads use the built-in HTTP transfer.';
        return false;
      }

      const port = await this.findFreePort();
      if (port === null) {
        this.lastError = `No free port between ${PREFERRED_PORT} and ${
          PREFERRED_PORT + PORT_SCAN_RANGE - 1
        } for the aria2 control channel.`;
        return false;
      }
      this.port = port;

      const args = [
        '--enable-rpc',
        '--rpc-listen-all=false', // Loopback 127.0.0.1 only
        `--rpc-listen-port=${this.port}`,
        `--rpc-secret=${this.rpcSecret}`,
        '--max-connection-per-server=16',
        '--split=16',
        '--min-split-size=1M',
        '--file-allocation=none',
      ];

      // stderr is captured rather than ignored: it is the only place the daemon
      // ever says why it would not start.
      const child = spawn(binaryPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
      this.aria2Process = child;

      let stderr = '';
      child.stderr?.on('data', (chunk: Buffer) => {
        // Bounded: a daemon looping on an error must not grow this without limit.
        if (stderr.length < 4_000) stderr += chunk.toString();
      });

      child.on('error', (err) => {
        this.lastError = err.message;
        if (this.aria2Process === child) this.aria2Process = null;
      });

      child.on('exit', (code) => {
        if (this.aria2Process === child) this.aria2Process = null;
        if (code !== 0 && code !== null) {
          const detail = stderr.trim().split('\n').filter(Boolean).pop();
          this.lastError = detail
            ? `aria2c exited (${code}): ${detail}`
            : `aria2c exited with code ${code}.`;
        }
      });

      const ready = await this.waitForRpc(RPC_READY_TIMEOUT_MS);
      if (!ready) {
        if (!this.lastError) {
          const detail = stderr.trim().split('\n').filter(Boolean).pop();
          this.lastError =
            detail ?? `The aria2 control channel on port ${this.port} did not answer.`;
        }
        try {
          child.kill();
        } catch {
          /* already gone */
        }
        this.aria2Process = null;
        return false;
      }

      this.lastError = null;
      return true;
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e);
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

    const mergedHeaders: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
      ...headers,
    };

    const headerOption: string[] = [];
    for (const [key, val] of Object.entries(mergedHeaders)) {
      if (val) headerOption.push(`${key}: ${val}`);
    }

    const options: any = {
      dir: outputDir,
      out: filename,
      header: headerOption,
      'max-connection-per-server': '4',
      split: '4',
      'min-split-size': '1M',
      'allow-overwrite': 'true',
      'auto-file-renaming': 'false',
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
