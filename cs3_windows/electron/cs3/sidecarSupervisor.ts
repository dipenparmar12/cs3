import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';

/**
 * Supervises the JVM sidecar that executes `.cs3` extensions.
 *
 * `.cs3` archives contain Android DEX bytecode built against a Kotlin provider
 * API, so running them needs a JVM. It lives in a separate OS process for the
 * reasons set out in docs/PRD/31 §3.2: a plugin that hangs, exhausts memory or
 * calls `System.exit` must degrade to "provider unavailable" rather than taking
 * the app with it (ARCH-3, DROP-26, AC-D4). Process boundaries deliver that
 * unconditionally; in-process isolation does not.
 *
 * The supervisor never throws on a missing or broken sidecar. DROP-34 requires
 * the app to launch and report reduced capability instead of failing, so every
 * failure mode resolves to a {@link SidecarStatus} the UI can explain.
 */

/** One pending JSON-RPC call. */
interface Pending {
  resolve: (value: RpcResult) => void;
  timer: NodeJS.Timeout;
  method: string;
}

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

export class SidecarSupervisor {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<string, Pending>();
  private nextId = 1;
  private restarts = 0;
  private stdoutBuffer = '';
  private startFailure: string | null = null;
  private lastStatus: { canExecute: boolean; reason?: string; sandboxGaps: string[] } | null = null;
  private starting: Promise<boolean> | null = null;

  private readonly dataDir: string;
  private readonly resourceDir: string;

  constructor(dataDir?: string, resourceDir?: string) {
    this.dataDir =
      dataDir ??
      (app ? path.join(app.getPath('userData'), 'cs3-runtime') : path.join(process.cwd(), 'cs3-runtime'));
    // Packaged builds ship the sidecar beside the app; a dev run picks it up
    // from the Maven output so `mvn package` is all a contributor needs.
    this.resourceDir =
      resourceDir ??
      (app?.isPackaged
        ? path.join(process.resourcesPath, 'sidecar')
        : path.join(process.cwd(), '..', 'sidecar', 'target'));
    fs.mkdirSync(this.dataDir, { recursive: true });
  }

  // --- lifecycle -----------------------------------------------------------

  /**
   * Starts the sidecar if it is not already running.
   *
   * Spawning is lazy — on first extension use, not at app start — so the JVM's
   * startup cost stays out of the cold-start budget (DSK-57, DROP-9).
   */
  public async ensureStarted(): Promise<boolean> {
    if (this.proc && !this.proc.killed) return true;
    if (this.restarts > MAX_RESTARTS) return false;
    // Concurrent callers must not race two JVMs into existence.
    if (this.starting) return this.starting;

    this.starting = this.start().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async start(): Promise<boolean> {
    const jarPath = path.join(this.resourceDir, 'cs3-sidecar.jar');
    const libDir = path.join(this.resourceDir, 'lib');

    if (!fs.existsSync(jarPath)) {
      this.startFailure =
        `The extension runtime is not installed (${jarPath} is missing). ` +
        `Build it with "mvn -f sidecar/pom.xml package", or reinstall the app.`;
      return false;
    }

    const java = this.resolveJava();
    if (!java) {
      this.startFailure =
        'No Java runtime was found. The app ships a bundled JRE; if this build was ' +
        'assembled without it, install a Java 21 runtime or reinstall the app.';
      return false;
    }

    const classpath = [jarPath, path.join(libDir, '*')].join(path.delimiter);
    const runtimeClasspath = path.join(this.resourceDir, 'runtime');

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

  private resolveJava(): string | null {
    const exe = process.platform === 'win32' ? 'java.exe' : 'java';
    const bundled = path.join(this.resourceDir, 'jre', 'bin', exe);
    if (fs.existsSync(bundled)) return bundled;

    const javaHome = process.env.JAVA_HOME;
    if (javaHome) {
      const fromHome = path.join(javaHome, 'bin', exe);
      if (fs.existsSync(fromHome)) return fromHome;
    }
    // Falling back to PATH keeps a dev checkout working without a bundled JRE.
    // DROP-31 requires shipped builds to carry their own, so this is a
    // development convenience, not the supported configuration.
    return app?.isPackaged ? null : exe;
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
