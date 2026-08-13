import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'child_process';
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

/** The sidecar is compiled to class file 65, which is Java 21. */
const REQUIRED_JAVA_VERSION = 21;

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
      // `resolveJava` sets a specific reason when it found a JVM and rejected
      // it for being too old; that is far more useful than this general one.
      this.startFailure ||=
        `No Java runtime was found. The app ships a bundled JRE; if this build was ` +
        `assembled without it, install a Java ${REQUIRED_JAVA_VERSION} runtime or reinstall the app.`;
      return false;
    }

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
    const candidates = [
      path.join(this.resourceDir, 'runtime'),
      path.join(this.resourceDir, '..', 'runtime'),
    ];
    for (const candidate of candidates) {
      try {
        // Matched by prefix: Maven resolves it under its version
        // (`library-jvm-4.8.0.jar`), and pinning the exact name here would
        // break on the next upgrade.
        const found = fs
          .readdirSync(candidate)
          .some((entry) => entry.startsWith('library-jvm') && entry.endsWith('.jar'));
        if (found) return candidate;
      } catch {
        // Missing directory; try the next candidate.
      }
    }
    // Nothing found: hand back the packaged location so the sidecar's own
    // "library-jvm.jar is not present in X" message names the expected place.
    return candidates[0];
  }

  /**
   * JDKs checked into `tools/toolchain/`, newest-looking first.
   *
   * Matched by prefix rather than pinned: the directory carries its full
   * version (`jdk-21.0.12+8`), and naming it exactly here would break on the
   * next patch bump. Sorted descending so a newer JDK wins if several are
   * unpacked side by side.
   */
  private toolchainJavas(exe: string): string[] {
    // `resourceDir` in a dev run is `<repo>/sidecar/target`, so the toolchain
    // is two levels up. Derived from it rather than from `process.cwd()`, which
    // depends on how the app was launched.
    const root = path.join(this.resourceDir, '..', '..', 'tools', 'toolchain');
    try {
      return fs
        .readdirSync(root)
        .filter((entry) => entry.toLowerCase().startsWith('jdk'))
        .sort()
        .reverse()
        .map((entry) => path.join(root, entry, 'bin', exe))
        .filter((candidate) => fs.existsSync(candidate));
    } catch {
      return [];
    }
  }

  /**
   * Reads a JVM's feature version, or null if it will not answer.
   *
   * `-version` prints to stderr, and has done since Java 1.0 — reading stdout
   * finds nothing. Both are captured for that reason.
   */
  private static probeJavaVersion(exe: string): number | null {
    try {
      const probe = spawnSync(exe, ['-version'], {
        encoding: 'utf8',
        timeout: 8_000,
        windowsHide: true,
      });
      const output = `${probe.stderr ?? ''}${probe.stdout ?? ''}`;
      // `"21.0.12"`, `"17.0.9"`, and the legacy `"1.8.0_402"`.
      const match = output.match(/version "(\d+)(?:\.(\d+))?/);
      if (!match) return null;
      const major = parseInt(match[1], 10);
      return major === 1 ? parseInt(match[2] ?? '0', 10) : major;
    } catch {
      return null;
    }
  }

  /**
   * Finds a JVM new enough to load the sidecar.
   *
   * Version checking is not defensive tidiness — an older JVM starts, gets as
   * far as the main class, and dies with `UnsupportedClassVersionError: class
   * file version 65.0 ... recognizes up to 61.0`, which the supervisor could
   * only report as "the runtime crashed". Java 8, 11 and 17 are all common
   * installs, and `JAVA_HOME` pointing at one of them was enough to make every
   * extension permanently unavailable with no usable explanation. Observed on
   * this machine: `JAVA_HOME` was a JDK 17 while a JDK 21 sat on `PATH`.
   *
   * Candidates are therefore tried in order of preference and the first one
   * that is actually new enough wins, rather than the first one that exists.
   */
  private resolveJava(): string | null {
    const exe = process.platform === 'win32' ? 'java.exe' : 'java';

    const candidates: string[] = [path.join(this.resourceDir, 'jre', 'bin', exe)];
    if (process.env.JAVA_HOME) {
      candidates.push(path.join(process.env.JAVA_HOME, 'bin', exe));
    }
    // The repo carries a portable JDK for exactly this case, and it was never
    // being looked at. A developer machine with `JAVA_HOME` on 17 and a 17 on
    // PATH — a completely ordinary setup, since most tooling still targets it —
    // left the sidecar unable to start with a JDK 21 sitting checked in beside
    // it. Preferred over PATH, because a rejected `JAVA_HOME` is usually a sign
    // the system JVM is the wrong one rather than that a right one is nearby.
    if (!app?.isPackaged) candidates.push(...this.toolchainJavas(exe));
    // Falling back to PATH keeps a dev checkout working without a bundled JRE.
    // DROP-31 requires shipped builds to carry their own, so this is a
    // development convenience, not the supported configuration.
    if (!app?.isPackaged) candidates.push(exe);

    const rejected: string[] = [];
    for (const candidate of candidates) {
      const isPath = candidate === exe;
      if (!isPath && !fs.existsSync(candidate)) continue;

      const version = SidecarSupervisor.probeJavaVersion(candidate);
      if (version === null) continue;
      if (version >= REQUIRED_JAVA_VERSION) return candidate;

      rejected.push(`${isPath ? 'the Java on PATH' : candidate} is Java ${version}`);
    }

    if (rejected.length > 0) {
      this.startFailure =
        `Extensions need Java ${REQUIRED_JAVA_VERSION} or newer, but ${rejected.join(', ')}. ` +
        `Install a Java ${REQUIRED_JAVA_VERSION} runtime, or point JAVA_HOME at one.`;
    }
    return null;
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
