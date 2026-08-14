import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { RuntimeProvisioner } from './runtimeProvisioner';

export interface RpcResult {
  ok: boolean;
  result?: Record<string, unknown>;
  error?: string;
  errorKind?: string;
}

export interface SidecarStatus {
  /** The process is up and answering. */
  running: boolean;
  /** The provider API is present, so plugins can actually be executed. */
  canExecute: boolean;
  /** Plain-language explanation when `canExecute` is false. */
  reason?: string;
  javaVersion?: string;
  pid?: number;
  /** Controls from doc 31 §6 that this build does not yet enforce. */
  sandboxGaps: string[];
  restarts: number;
}

const CALL_TIMEOUT_MS = 60_000;
/** Beyond this many restarts in a session the sidecar is treated as unusable. */
const MAX_RESTARTS = 3;

/** One pending JSON-RPC call. */
interface Pending {
  resolve: (value: RpcResult) => void;
  timer: NodeJS.Timeout;
  method: string;
}

export class SidecarSupervisor {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<string, Pending>();
  private nextId = 1;
  private restarts = 0;
  private stdoutBuffer = '';
  private startFailure: string | null = null;
  private lastStatus: { canExecute: boolean; reason?: string; sandboxGaps: string[] } | null = null;
  private starting: Promise<boolean> | null = null;
  private provisioner: RuntimeProvisioner;

  private readonly dataDir: string;

  constructor(dataDir?: string) {
    this.provisioner = new RuntimeProvisioner();
    this.dataDir =
      dataDir ??
      (app ? path.join(app.getPath('userData'), 'cs3-runtime') : path.join(process.cwd(), 'cs3-runtime'));
    fs.mkdirSync(this.dataDir, { recursive: true });
  }

  public getProvisioner(): RuntimeProvisioner {
    return this.provisioner;
  }

  // --- lifecycle -----------------------------------------------------------

  public async ensureStarted(): Promise<boolean> {
    if (this.proc && !this.proc.killed) return true;
    if (this.restarts > MAX_RESTARTS) return false;
    if (this.starting) return this.starting;

    // Try auto-provisioning if components are missing
    const status = this.provisioner.getStatus();
    if (!status.ready) {
      await this.provisioner.provisionRuntime();
    }

    this.starting = this.start().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async start(): Promise<boolean> {
    const sidecarInfo = this.provisioner.findSidecarJar();
    if (!sidecarInfo) {
      this.startFailure =
        'The extension runtime is not provisioned. Click "Install Required Components" in Settings to set up automatically.';
      return false;
    }

    const javaInfo = this.provisioner.findJavaBinary();
    if (!javaInfo) {
      this.startFailure =
        'No compatible Java 21+ runtime was found. Click "Install Required Components" in Settings to set up automatically.';
      return false;
    }

    const java = javaInfo.exePath;
    const jarPath = sidecarInfo.jarPath;
    const libDir = sidecarInfo.libDir;

    const classpath = [jarPath, path.join(libDir, '*')].join(path.delimiter);
    const runtimeClasspath = this.resolveRuntimeDir();

    try {
      this.proc = spawn(
        java,
        [
          '-Xmx512m',
          // DROP-24: an empty library path makes System.loadLibrary fail, so a
          // plugin cannot pull in native code.
          '-Djava.library.path=',
          '-Dfile.encoding=UTF-8',
          '-cp',
          classpath,
          'com.cloudstream.desktop.sidecar.Main',
          `--data-dir=${this.dataDir}`,
          `--runtime-classpath=${runtimeClasspath}`,
        ],
        { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }
      );
    } catch (error) {
      this.startFailure = `The extension runtime failed to start: ${
        error instanceof Error ? error.message : String(error)
      }`;
      return false;
    }

    this.startFailure = null;
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk: string) => this.onStdout(chunk));

    // Plugin logs and JVM diagnostics arrive here. They are surfaced for the
    // Inspector Panel rather than dropped, but must never be parsed as RPC.
    this.proc.stderr.setEncoding('utf8');
    this.proc.stderr.on('data', (chunk: string) => {
      for (const line of chunk.split('\n')) {
        if (line.trim()) console.warn(`[cs3-sidecar] ${line}`);
      }
    });

    this.proc.on('exit', (code, signal) => this.onExit(code, signal));
    this.proc.on('error', (error) => {
      this.startFailure = `The extension runtime could not be launched: ${error.message}`;
      this.failAllPending('SIDECAR_UNAVAILABLE', this.startFailure);
    });

    const status = await this.call('status', {}, 10_000);
    if (!status.ok) {
      this.startFailure = status.error ?? 'The extension runtime did not respond to a status probe.';
      return false;
    }
    this.lastStatus = {
      canExecute: Boolean(status.result?.canExecute),
      reason: status.result?.reason ? String(status.result.reason) : undefined,
      sandboxGaps: Array.isArray(status.result?.sandboxGaps)
        ? (status.result.sandboxGaps as string[])
        : [],
    };
    return true;
  }

  /**
   * Locates the provider API jars every plugin is linked against.
   *
   * A packaged build ships them beside the sidecar jar. A dev checkout does
   * not: `sidecar/pom.xml` builds into `sidecar/target`, while the separate
   * `sidecar/runtime-deps/pom.xml` resolves `library-jvm` and its 55
   * transitives into `sidecar/runtime` — a sibling, not a child. Deriving the
   * path from the jar's own directory therefore pointed at a folder that has
   * never existed, and every plugin in a dev run was reported `T4_BLOCKED` with
   * "library-jvm.jar is not present" no matter how correctly it had been built.
   *
   * Both layouts are checked, and the packaged one first so a shipped build
   * cannot be diverted by a stray directory next to it.
   */
  private resolveRuntimeDir(): string {
    const info = this.provisioner.findRuntimeDir();
    if (info) return info.dir;
    return path.join(this.provisioner.appDataRuntimeDir, 'runtime');
  }

  private onExit(code: number | null, signal: string | null): void {
    this.proc = null;
    const detail = `exit code ${code ?? 'none'}${signal ? `, signal ${signal}` : ''}`;
    this.failAllPending(
      'SIDECAR_CRASHED',
      `The extension runtime stopped (${detail}). ` +
        `A plugin can crash it; the app itself is unaffected.`
    );
    this.restarts++;
    if (this.restarts > MAX_RESTARTS) {
      this.startFailure =
        `The extension runtime has crashed ${this.restarts} times this session and will not be ` +
        `restarted again. Extensions are unavailable until the app is restarted.`;
    }
  }

  private failAllPending(kind: string, message: string): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.resolve({ ok: false, errorKind: kind, error: message });
    }
    this.pending.clear();
  }

  public stop(): void {
    this.failAllPending('SIDECAR_STOPPED', 'The extension runtime was shut down.');
    if (!this.proc) return;
    // Closing stdin lets the sidecar drain in-flight replies and exit cleanly.
    try {
      this.proc.stdin.end();
    } catch {
      // Already gone; the kill below is the backstop.
    }
    const dying = this.proc;
    this.proc = null;
    setTimeout(() => {
      if (!dying.killed) dying.kill();
    }, 2_000).unref();
  }

  // --- protocol ------------------------------------------------------------

  private onStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    // Frames are newline-delimited; a partial trailing frame stays buffered.
    let index = this.stdoutBuffer.indexOf('\n');
    while (index >= 0) {
      const line = this.stdoutBuffer.slice(0, index).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(index + 1);
      if (line) this.onFrame(line);
      index = this.stdoutBuffer.indexOf('\n');
    }
  }

  private onFrame(line: string): void {
    let frame: { id?: string; ok?: boolean; result?: Record<string, unknown>; error?: string; errorKind?: string };
    try {
      frame = JSON.parse(line);
    } catch {
      console.warn(`[cs3-sidecar] unparsable frame: ${line.slice(0, 200)}`);
      return;
    }

    const id = String(frame.id ?? '');
    const pending = this.pending.get(id);
    if (!pending) return;

    this.pending.delete(id);
    clearTimeout(pending.timer);
    pending.resolve({
      ok: Boolean(frame.ok),
      result: frame.result,
      error: frame.error,
      errorKind: frame.errorKind,
    });
  }

  /**
   * Issues one RPC call. Never rejects: a dead sidecar, a timeout and a plugin
   * error are all outcomes the caller has to render, not exceptions.
   */
  public async call(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs = CALL_TIMEOUT_MS
  ): Promise<RpcResult> {
    if (!this.proc || this.proc.killed) {
      return {
        ok: false,
        errorKind: 'SIDECAR_UNAVAILABLE',
        error: this.startFailure ?? 'The extension runtime is not running.',
      };
    }

    const id = String(this.nextId++);
    const payload = `${JSON.stringify({ id, method, params: { ...params, timeoutMs } })}\n`;

    return new Promise<RpcResult>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({
          ok: false,
          errorKind: 'TIMEOUT',
          error: `${method} did not return within ${timeoutMs} ms.`,
        });
      }, timeoutMs + 2_000);
      // The host waits slightly longer than the sidecar's own deadline so a
      // clean in-process timeout, which names the plugin, wins the race.

      this.pending.set(id, { resolve, timer, method });

      try {
        this.proc!.stdin.write(payload);
      } catch (error) {
        this.pending.delete(id);
        clearTimeout(timer);
        resolve({
          ok: false,
          errorKind: 'SIDECAR_UNAVAILABLE',
          error: `Could not reach the extension runtime: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      }
    });
  }

  // --- status --------------------------------------------------------------

  public async status(): Promise<SidecarStatus> {
    const started = await this.ensureStarted();
    if (!started) {
      return {
        running: false,
        canExecute: false,
        reason: this.startFailure ?? 'The extension runtime is unavailable.',
        sandboxGaps: [],
        restarts: this.restarts,
      };
    }

    const probe = await this.call('ping', {}, 10_000);
    return {
      running: probe.ok,
      canExecute: Boolean(this.lastStatus?.canExecute),
      reason: this.lastStatus?.reason,
      javaVersion: probe.result?.javaVersion ? String(probe.result.javaVersion) : undefined,
      pid: typeof probe.result?.pid === 'number' ? probe.result.pid : undefined,
      sandboxGaps: this.lastStatus?.sandboxGaps ?? [],
      restarts: this.restarts,
    };
  }
}
