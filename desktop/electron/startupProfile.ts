/**
 * What the app spent before it was usable, and what blocked the main thread.
 *
 * Startup was reported as slow and occasionally as Windows' "Not Responding",
 * and neither complaint could be answered because nothing was counted. The two
 * are the same fact seen from different sides: Windows marks a process
 * unresponsive when it stops pumping messages, and the main process pumps
 * nothing while it is evaluating modules or parsing a file synchronously.
 *
 * So this records two things and keeps them apart, because they need different
 * fixes:
 *
 * **Stages** — named spans of startup work, nested, with the wall clock each
 * took. This answers "why is the window late".
 *
 * **Stalls** — intervals where the event loop did not turn for longer than
 * {@link STALL_THRESHOLD_MS}, attributed to whatever stage was open at the
 * time. This answers "why did it go grey", which is a different question: an
 * eight-second startup made of forty responsive stages is slow and never
 * freezes, and a two-second one made of a single synchronous block does.
 *
 * Measured on the development install (2026-09-21) before this pass landed,
 * which is what the numbers below are for:
 *
 * | Before the first frame                   | warm    | cold    |
 * |------------------------------------------|---------|---------|
 * | `webtorrent` module evaluation           |  604ms  | 2762ms  |
 * | `cheerio` module evaluation              |  242ms  | 1740ms  |
 * | `fast-xml-parser` module evaluation      |   43ms  |  710ms  |
 * | 17.4MB of synchronous JSON read + parse  |   87ms  |       - |
 *
 * All of it ran before `app.whenReady()` resolved, so none of it could be
 * interrupted by anything and none of it was visible.
 *
 * **This module imports nothing.** It is the first import in `main.ts` and its
 * own evaluation is part of what it measures, so a dependency here would be a
 * dependency it cannot see. It also has to stay loadable under Node's type
 * stripping, where its test runs — hence no `electron` import.
 */

/**
 * How long the loop may stop turning before it counts as a stall.
 *
 * Not a round number and not tuning: 120ms is roughly the point at which a
 * click stops feeling like it registered. Below it the app is janky, above it
 * the app is frozen, and only the second one is what this exists to find.
 */
export const STALL_THRESHOLD_MS = 120;

/** How often the monitor checks. Short enough to bracket a stall closely. */
const MONITOR_INTERVAL_MS = 20;

export interface StartupStage {
  /** Dotted path, so a nested stage says what it was nested in. */
  readonly name: string;
  /** Milliseconds since the recorder started. */
  readonly startedAt: number;
  readonly durationMs: number;
  readonly depth: number;
  /** Set when the stage threw; the stage is still recorded. */
  readonly error?: string;
}

export interface StartupStall {
  readonly startedAt: number;
  readonly durationMs: number;
  /**
   * The innermost stage that was open at any point during the blocked interval.
   *
   * "At any point" rather than "when the monitor noticed": a synchronous stage
   * opens, blocks and closes inside one turn of the loop, so by the time a
   * timer can run there is nothing open to name. `null` means the block
   * happened outside every stage — which is itself the answer worth having,
   * since it points at work nobody instrumented.
   */
  readonly during: string | null;
}

export interface StartupProfile {
  /** Wall clock at process creation, where the platform reports one. */
  readonly processStartedAt: number | null;
  /** Milliseconds from process creation to this module being evaluated. */
  readonly beforeMainMs: number | null;
  readonly stages: readonly StartupStage[];
  readonly stalls: readonly StartupStall[];
  readonly marks: Readonly<Record<string, number>>;
  /** Total time the loop was blocked past the threshold. */
  readonly stalledMs: number;
  /** True until {@link StartupProfiler.finish} is called. */
  readonly running: boolean;
  readonly elapsedMs: number;
}

/**
 * The recorder.
 *
 * One instance, exported as {@link startup}. A class rather than free functions
 * so a test can drive an isolated one — a module-global recorder measured by a
 * test that shares it is a test that cannot assert anything about totals.
 */
export class StartupProfiler {
  private readonly origin = Date.now();
  private readonly originHr = process.hrtime.bigint();
  private readonly stages: StartupStage[] = [];
  private readonly stalls: StartupStall[] = [];
  private readonly marks: Record<string, number> = {};
  private readonly open: string[] = [];
  private monitor: ReturnType<typeof setInterval> | null = null;
  private lastTick = 0;
  private live = true;
  /**
   * The innermost stage entered since the monitor last ticked.
   *
   * Without this, attribution is always `null` for the case that matters most.
   * A synchronous stage opens, blocks, and closes inside one turn of the loop —
   * so by the time the monitor's timer can run, `open` is empty again and the
   * stall it just detected has nobody to blame. Reading what was entered during
   * the blocked interval is the only way to name it, and naming it is the whole
   * point: a list of freezes with no owner is what the app already had.
   */
  private enteredSinceTick: string | null = null;

  /**
   * Milliseconds since this recorder was constructed.
   *
   * `hrtime` rather than `Date.now`, because a stall long enough to matter is
   * also long enough for the system clock to be adjusted under it — and an NTP
   * step during startup would otherwise be recorded as a negative stage.
   */
  public now(): number {
    return Number(process.hrtime.bigint() - this.originHr) / 1e6;
  }

  /** Records an instant. A later mark with the same name overwrites. */
  public mark(name: string): void {
    this.marks[name] = this.now();
  }

  /**
   * Times a synchronous span.
   *
   * The stage is recorded even when the body throws, and the error travels with
   * it — a stage that is slow *because* it failed is the one worth seeing, and
   * a profiler that drops those is reporting a startup that did not happen.
   */
  public stage<T>(name: string, body: () => T): T {
    const path = this.enter(name);
    const startedAt = this.now();
    try {
      const value = body();
      this.exit(path, startedAt);
      return value;
    } catch (error) {
      this.exit(path, startedAt, error);
      throw error;
    }
  }

  /**
   * Opens a stage that is closed by the returned function.
   *
   * For work that has no callback to wrap: the service graph in `main.ts` is
   * four hundred lines of module-scope `const`s, and nothing can be put around
   * it. Bracketing it with a mark either side gives the duration and loses the
   * attribution — a stall inside it reports `uninstrumented`, which is the
   * least useful thing this module can say and was exactly what the first
   * measured launch produced.
   *
   * {@link stage} is the better tool wherever a callback exists, because it
   * cannot be left open by an early return or a throw.
   */
  public span(name: string): () => void {
    const path = this.enter(name);
    const startedAt = this.now();
    let closed = false;
    return () => {
      if (closed) return;
      closed = true;
      this.exit(path, startedAt);
    };
  }

  /** As {@link stage}, for work that is awaited. */
  public async stageAsync<T>(name: string, body: () => Promise<T>): Promise<T> {
    const path = this.enter(name);
    const startedAt = this.now();
    try {
      const value = await body();
      this.exit(path, startedAt);
      return value;
    } catch (error) {
      this.exit(path, startedAt, error);
      throw error;
    }
  }

  private enter(name: string): string {
    const parent = this.open.length ? this.open[this.open.length - 1] : null;
    const path = parent ? `${parent}.${name}` : name;
    this.open.push(path);
    this.enteredSinceTick = path;
    return path;
  }

  private exit(path: string, startedAt: number, error?: unknown): void {
    const depth = this.open.length - 1;
    // Popped by identity rather than by length: an async stage may settle out
    // of order, and truncating the list would close stages still running.
    const at = this.open.lastIndexOf(path);
    if (at >= 0) this.open.splice(at, 1);
    this.stages.push({
      name: path,
      startedAt,
      durationMs: this.now() - startedAt,
      depth: Math.max(0, depth),
      ...(error === undefined ? {} : { error: describe(error) }),
    });
  }

  /**
   * Starts watching for intervals where the loop stops turning.
   *
   * Drift, not duration: the timer asks how late it is rather than how long
   * anything took, so it catches a block wherever it happens — inside a stage,
   * between two of them, or in code that never told this module it existed.
   * That last case is the important one, because the blocking work nobody
   * instrumented is exactly the work nobody knew about.
   *
   * Unref'd, or a profiler left running would hold the process open through
   * quit and the app would never exit.
   */
  public watch(): void {
    if (this.monitor) return;
    this.lastTick = this.now();
    this.monitor = setInterval(() => {
      const at = this.now();
      const late = at - this.lastTick - MONITOR_INTERVAL_MS;
      if (late >= STALL_THRESHOLD_MS) {
        this.stalls.push({
          startedAt: this.lastTick,
          durationMs: late,
          // Still open wins over merely entered: on a nested block the
          // innermost stage still running is the more specific answer. A stage
          // that opened and closed inside the block is the fallback, and it is
          // the common case — that is what a synchronous stall looks like.
          during:
            (this.open.length ? this.open[this.open.length - 1] : null) ??
            this.enteredSinceTick,
        });
      }
      this.enteredSinceTick = null;
      this.lastTick = at;
    }, MONITOR_INTERVAL_MS);
    this.monitor.unref?.();
  }

  /**
   * Stops the monitor and freezes the profile.
   *
   * Called when the app is interactive, not when it has finished loading — the
   * background queue keeps working long after, and folding that in would make
   * the headline number grow every time work moved *off* the critical path,
   * which is backwards.
   */
  public finish(): void {
    this.live = false;
    if (this.monitor) {
      clearInterval(this.monitor);
      this.monitor = null;
    }
  }

  public snapshot(): StartupProfile {
    const created = processCreationTime();
    return {
      processStartedAt: created,
      beforeMainMs: created === null ? null : this.origin - created,
      // Sorted by when they started rather than when they finished, so a nested
      // stage reads under its parent instead of before it.
      stages: [...this.stages].sort((a, b) => a.startedAt - b.startedAt),
      stalls: [...this.stalls],
      marks: { ...this.marks },
      stalledMs: this.stalls.reduce((total, stall) => total + stall.durationMs, 0),
      running: this.live,
      elapsedMs: this.now(),
    };
  }
}

/**
 * When the OS says this process was created.
 *
 * The only way to see the cost *before* our first line runs — Electron's own
 * bootstrap, the V8 snapshot, the module loader. Reached off `process` rather
 * than through an `electron` import so this module stays loadable under type
 * stripping, and it answers null where the platform reports nothing, which is a
 * real answer rather than a zero.
 */
function processCreationTime(): number | null {
  const fn = (process as { getCreationTime?: () => number | null }).getCreationTime;
  if (typeof fn !== 'function') return null;
  try {
    const value = fn.call(process);
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

/** Local, because importing `describeError` would be a dependency this cannot see. */
function describe(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return String(error);
}

/** The one the app uses. */
export const startup = new StartupProfiler();
