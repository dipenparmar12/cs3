import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { RuntimeProvisioner } from './runtimeProvisioner';
import { scopedLogger } from '../logging/logger';
import { SidecarStderrReader } from './sidecarStderr';
import { getIssueLog } from './extensionIssues';

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

/**
 * Answers a call the *sidecar* made. Registered by `main.ts`.
 *
 * Returns the document the JVM will hand straight to the bridge, so it must be
 * the shape that end binds to — see `WebViewAnswer` in `webViewHost.ts`.
 */
export type HostCallHandler = (
  method: string,
  params: Record<string, unknown>
) => Promise<unknown>;

/** One pending JSON-RPC call. */
interface Pending {
  resolve: (value: RpcResult) => void;
  timer: NodeJS.Timeout;
  method: string;
}

/**
 * The sidecar's stderr, as records rather than console noise.
 *
 * The folding rules live in `sidecarStderr.ts`, which stays free of `electron`
 * so it can be tested; this file owns the pipe and nothing else.
 */
const sidecarLog = scopedLogger('runtime', { component: 'sidecar' });

/**
 * RPC names this build will actually call.
 *
 * Compared against what the sidecar says it answers, so a jar older than the
 * host is named at the handshake rather than surfacing later as one
 * unexplained failure per feature. Add a method here when you add a caller for
 * it — an entry with no caller costs a false alarm, and a caller with no entry
 * costs the bug this exists to end.
 */
const REQUIRED_METHODS = [
  'status',
  'inspect',
  'load',
  'unload',
  'providers',
  'providerSearch',
  'providerLoad',
  'providerLoadLinks',
  'providerMainPageSections',
  'providerMainPage',
] as const;

export class SidecarSupervisor {
  private proc: ChildProcessWithoutNullStreams | null = null;

  /**
   * RPC names this build needs and the running jar does not answer.
   *
   * Empty both when everything matches and when the sidecar is too old to
   * report its methods at all — absence is not evidence, and refusing to start
   * over a field an older jar never sent would break installs that merely lag.
   */
  private missingMethods: string[] = [];

  /**
   * Folds stderr lines into one record per event. Flushed on a short timer as
   * well as on the next line, because the last trace of a session has nothing
   * after it to trigger a flush and is the one worth having.
   */
  private readonly stderr = new SidecarStderrReader((record) => {
    sidecarLog.write(record.level, 'sidecar_stderr', { ...record, level: undefined });
    /**
     * The same record, counted rather than narrated.
     *
     * The log above is a transcript: one file per launch, rotated away, and in
     * a real session 5,407 of its 6,069 lines came from here. Counting across
     * those 21 files by hand is what showed that they are ~200 distinct
     * problems — which is the number worth acting on and the one no transcript
     * can show. The ledger keeps that tally across restarts.
     *
     * Both, not one: the transcript preserves ordering, which is what tells you
     * a failure followed a particular search, and the ledger discards ordering,
     * which is what lets it group.
     */
    getIssueLog()?.recordSidecar(record);
  });
  private stderrTimer: NodeJS.Timeout | null = null;
  private pending = new Map<string, Pending>();
  private nextId = 1;
  private restarts = 0;
  private stdoutBuffer = '';
  private startFailure: string | null = null;
  private lastStatus: { canExecute: boolean; reason?: string; sandboxGaps: string[] } | null = null;
  private starting: Promise<boolean> | null = null;
  private provisioner: RuntimeProvisioner;
  private hostCallHandler: HostCallHandler | null = null;

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

  /**
   * Registers what answers the sidecar's own calls.
   *
   * Must be set before `ensureStarted`, because the capability handshake that
   * tells the JVM a browser exists is sent as part of starting. Registered
   * after, the first session's providers would each spend a full browser
   * timeout discovering that nothing was listening.
   */
  public setHostCallHandler(handler: HostCallHandler | null): void {
    this.hostCallHandler = handler;
  }

  // --- lifecycle -----------------------------------------------------------

  public async ensureStarted(): Promise<boolean> {
    if (this.proc && !this.proc.killed) return true;
    if (this.restarts > MAX_RESTARTS) return false;
    if (this.starting) return this.starting;

    // Provision when components are missing, and re-provision when the
    // app-managed copy has fallen behind the build it came from. The second
    // case is not cosmetic: the copy under %APPDATA% is resolved ahead of every
    // build location, so without this check an app keeps running the shim and
    // bridge it was first installed with and reports NoClassDefFoundError for
    // classes that shipped long ago.
    const status = this.provisioner.getStatus();
    if (!status.ready || status.stale) {
      if (status.stale) {
        console.warn(`[cs3-sidecar] refreshing the extension runtime: ${status.staleReason}`);
      }
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
          /*
           * 512m was not enough, and the failure named the wrong thing.
           * Reported as `TRANSLATION_FAILED: OutOfMemoryError: Java heap
           * space` against MovieBoxProviderIN — a 79 KB archive, which reads
           * as absurd until you look at what translation does: dex2jar holds
           * the whole DEX graph plus every emitted class in memory at once,
           * and a small archive can carry a very large one. The extension was
           * reported as incompatible when nothing was wrong with it.
           *
           * The ceiling is what the JVM is *allowed* to reach, not what it
           * reserves, so raising it costs an idle sidecar nothing. It is still
           * bounded rather than left to the default — this process runs
           * third-party code, and an unbounded heap turns one runaway plugin
           * into the machine swapping.
           */
          '-Xmx1536m',
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
        if (!line.trim()) continue;
        // Kept: a terminal is still the fastest way to watch a plugin load.
        console.warn(`[cs3-sidecar] ${line}`);
        this.absorbStderr(line);
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
    // Tell the JVM whether a browser is on offer. Until this lands every reverse
    // call there fails at once with a reason, which is the honest answer for a
    // host that is not listening — and much better than each provider spending a
    // 60-second browser timeout to find out.
    await this.call('hostCapabilities', { webview: this.hostCallHandler !== null }, 10_000);

    /*
     * Is the jar as new as the build that shipped it?
     *
     * `RUNTIME_GENERATION` cannot answer this. It is a number the *host*
     * writes into its own stamp, so it detects a provisioned copy going stale
     * and is blind to the case where the TypeScript was rebuilt and
     * `mvn package` was not — the jar then predates the code calling it.
     *
     * That happened, and every symptom named the wrong party: three OTT
     * platforms each reported `UnsupportedOperationException: Unknown method:
     * providerMainPageSections`, which points at the RPC layer and gives the
     * reader nothing to act on. Checked once here, it is one sentence naming
     * the actual fix.
     *
     * Missing `methods` is not a failure. A sidecar older than this check does
     * not report the field, and refusing to start over its absence would break
     * every install that is merely behind rather than incompatible.
     */
    const methods = Array.isArray(status.result?.methods)
      ? (status.result.methods as string[])
      : null;
    this.missingMethods = methods
      ? REQUIRED_METHODS.filter((method) => !methods.includes(method))
      : [];

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

  private absorbStderr(line: string): void {
    this.stderr.push(line);
    if (this.stderrTimer) clearTimeout(this.stderrTimer);
    this.stderrTimer = setTimeout(() => this.stderr.flush(), 250);
    this.stderrTimer.unref?.();
  }

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
    let frame: {
      id?: string;
      ok?: boolean;
      result?: Record<string, unknown>;
      error?: string;
      errorKind?: string;
      hostCall?: string;
      hostId?: string;
      params?: Record<string, unknown>;
    };
    try {
      frame = JSON.parse(line);
    } catch {
      console.warn(`[cs3-sidecar] unparsable frame: ${line.slice(0, 200)}`);
      return;
    }

    // The pipe run backwards: the sidecar asking us for something. Told apart by
    // a key rather than a version field, so a runtime provisioned before this
    // existed still speaks the frames it always did.
    if (typeof frame.hostCall === 'string') {
      void this.onHostCall(frame.hostCall, String(frame.hostId ?? ''), frame.params ?? {});
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
      error: this.explainUnknownMethod(pending.method, frame.error),
      errorKind: frame.errorKind,
    });
  }

  /**
   * Serves one call from the sidecar and answers it.
   *
   * Every failure is answered, never dropped. The JVM side has its own deadline,
   * so a dropped frame is not a hang — but it is a provider waiting the full
   * browser timeout to be told something we already knew, on every link it
   * tries.
   */
  private async onHostCall(
    method: string,
    hostId: string,
    params: Record<string, unknown>
  ): Promise<void> {
    const reply = (payload: Record<string, unknown>) => {
      if (!this.proc || this.proc.killed) return;
      try {
        // The answer travels as a JSON *string* under `json`, matching the way
        // `providerLoad` carries the bridge's document in the other direction:
        // it is already shaped for its reader, and re-parsing it through the
        // sidecar's minimal writer would only add a place to lose fields.
        this.proc.stdin.write(
          `${JSON.stringify({ hostReply: hostId, ok: true, json: JSON.stringify(payload) })}\n`
        );
      } catch (error) {
        sidecarLog.warn('host_call_reply_failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    };

    const handler = this.hostCallHandler;
    if (!handler) {
      reply({ ok: false, error: `The desktop app cannot serve ${method}.` });
      return;
    }

    try {
      const result = await handler(method, params);
      reply((result ?? { ok: false, error: `${method} produced no answer.` }) as Record<string, unknown>);
    } catch (error) {
      reply({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  /**
   * Issues one RPC call. Never rejects: a dead sidecar, a timeout and a plugin
   * error are all outcomes the caller has to render, not exceptions.
   */
  /**
   * Turns the runtime's own "Unknown method" into something actionable.
   *
   * The dispatch throws `UnsupportedOperationException: Unknown method: X`,
   * which names the RPC layer and nothing a reader can act on — it reached
   * users as "Netflix has no catalogue to browse" beside a Java exception.
   * The handshake check above catches this for every method known when it
   * shipped; this catches one added later, where the list has not been updated.
   */
  private explainUnknownMethod(method: string, error: string | undefined): string | undefined {
    if (!error || !/Unknown method/i.test(error)) return error;
    return (
      `The extension runtime does not support "${method}". It is older than this build of ` +
      'the app — rebuild it with `mvn -f sidecar/pom.xml package`, or reinstall the app.'
    );
  }

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
    /*
     * A jar behind its host is reported here rather than only in a log,
     * because it is a working runtime that will fail one feature at a time.
     * `canExecute` stays true — extensions load and scrape perfectly; what is
     * missing is whatever the newer host learned to ask for.
     */
    const stale =
      this.missingMethods.length > 0
        ? `The extension runtime is older than this build of the app and cannot answer ${this.missingMethods.join(', ')}. ` +
          'Rebuild it with `mvn -f sidecar/pom.xml package`, or reinstall the app.'
        : undefined;

    return {
      running: probe.ok,
      canExecute: Boolean(this.lastStatus?.canExecute),
      reason: stale ?? this.lastStatus?.reason,
      javaVersion: probe.result?.javaVersion ? String(probe.result.javaVersion) : undefined,
      pid: typeof probe.result?.pid === 'number' ? probe.result.pid : undefined,
      sandboxGaps: this.lastStatus?.sandboxGaps ?? [],
      restarts: this.restarts,
    };
  }
}
