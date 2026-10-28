/**
 * The runner's side of `net-worker.cjs`: spawns the headless Electron worker,
 * reads its ready line, and sends it requests over its loopback control port.
 * Also adapts it to the `fetch` shape `MediaProxy` takes, so the shipping
 * proxy runs over Chromium's network with every byte counted against the
 * source's budget.
 *
 * Node's own `fetch` here talks only to the worker on 127.0.0.1; it never
 * carries a source byte.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');

export function electronBinary() {
  const dist = path.join(REPO_ROOT, 'desktop', 'node_modules', 'electron', 'dist');
  const name =
    process.platform === 'win32'
      ? 'electron.exe'
      : process.platform === 'darwin'
        ? 'Electron.app/Contents/MacOS/Electron'
        : 'electron';
  const file = path.join(dist, name);
  if (!fs.existsSync(file)) throw new Error(`Electron is not installed at ${file}. Run bun install in desktop/.`);
  return file;
}

export class NetWorker {
  constructor(userDataDir) {
    this.userDataDir = userDataDir;
    this.stderr = [];
  }

  async start() {
    fs.mkdirSync(this.userDataDir, { recursive: true });
    // Present at all, even empty, this makes Electron start as plain Node, with no `net`.
    const env = { ...process.env, CS3_AUDIT_PARENT_PID: String(process.pid) };
    delete env.ELECTRON_RUN_AS_NODE;
    this.proc = spawn(electronBinary(), [path.join(HERE, 'net-worker.cjs'), this.userDataDir], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env,
    });
    this.proc.stderr.setEncoding('utf8');
    this.proc.stderr.on('data', (chunk) => {
      this.stderr.push(chunk);
      if (this.stderr.length > 200) this.stderr.splice(0, 100);
    });
    this.proc.stdout.setEncoding('utf8');
    const frame = await new Promise((resolve, reject) => {
      let buffer = '';
      const timer = setTimeout(() => reject(new Error('The network worker did not start in 30 s.')), 30_000);
      this.proc.once('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`The network worker exited with code ${code} before it was ready.`));
      });
      this.proc.stdout.on('data', (chunk) => {
        buffer += chunk;
        for (const line of buffer.split('\n')) {
          if (!line.startsWith('{')) continue;
          try {
            const parsed = JSON.parse(line);
            if (parsed.id === 'ready') {
              clearTimeout(timer);
              resolve(parsed);
            }
          } catch {
            // A partial line; the rest is still arriving.
          }
        }
      });
    });
    this.electron = frame.electron;
    this.control = `http://127.0.0.1:${frame.port}/`;
    this.token = frame.token;
  }

  async post(body, timeoutMs) {
    try {
      const response = await fetch(this.control, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-audit-token': this.token },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      return await response.json();
    } catch (error) {
      return { ok: false, error: this.proc.exitCode !== null ? 'the network worker has exited' : String(error?.message ?? error) };
    }
  }

  /** One request; resolves with the worker's answer, `body` decoded to bytes. */
  async fetch(request) {
    const timeoutMs = request.timeoutMs ?? 20_000;
    const frame = await this.post({ ...request, op: 'fetch', timeoutMs }, timeoutMs + 5000);
    return { redirects: [], ...frame, body: frame.body ? Buffer.from(frame.body, 'base64') : Buffer.alloc(0) };
  }

  async stop() {
    if (!this.proc || this.proc.exitCode !== null) return;
    const exited = new Promise((resolve) => this.proc.once('exit', resolve));
    await this.post({ op: 'quit' }, 3000);
    const killer = setTimeout(() => this.proc.kill(), 5000);
    await exited;
    clearTimeout(killer);
  }
}

const NO_BODY = new Set([101, 204, 205, 304]);
/**
 * One request's slice when the proxy asks for an open range: enough for a
 * probe, never a film. At 4 MB an MP4 probe cost 8.8 MB (head, then the
 * tail); at 1 MB ffprobe asks again where it needs more, and stops sooner.
 */
const SLICE = 1024 * 1024;

/**
 * A `fetch` for `MediaProxy`, over the worker, drawing on `meter`. Once the
 * meter is spent every further request fails, which the inspector reports as
 * an incomplete probe: the source is `inconclusive: budget-exhausted`, never
 * read further.
 */
export function meteredFetch(worker, meter) {
  return async (input, init = {}) => {
    if (meter.exhausted) throw new Error('The audit byte budget for this source is spent.');
    const headers = {};
    new Headers(init.headers ?? {}).forEach((value, key) => {
      headers[key] = value;
    });
    const result = await worker.fetch({
      url: String(input),
      method: init.method ?? 'GET',
      headers,
      cap: Math.min(SLICE, meter.remaining),
      timeoutMs: 20_000,
    });
    if (!result.ok) throw new Error(result.error ?? 'network worker failed');
    meter.add(result.bytes);
    const responseHeaders = new Headers(result.headers ?? {});
    // The body may be cut short; a length the proxy would trust must not survive that.
    if (result.truncated) responseHeaders.delete('content-length');
    return new Response(NO_BODY.has(result.status) ? null : result.body, {
      status: result.status,
      headers: responseHeaders,
    });
  };
}
