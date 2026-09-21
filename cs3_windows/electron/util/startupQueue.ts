/**
 * The work that happens after the window, in an order somebody chose.
 *
 * Every expensive thing the app does at launch used to be scheduled with its
 * own `setTimeout`, each with its own delay picked in isolation — 4s for the
 * provider warm-up, 16s for the torrent client, a settle for the prefetcher.
 * That works right up until two of them land together, and then the machine is
 * doing a JVM class-load pass, a DHT bootstrap and a catalogue fetch at once
 * while the viewer is trying to scroll the home screen. The delays were the
 * only thing keeping them apart, and a delay is a guess about how long the task
 * before it takes.
 *
 * A queue replaces the guessing. Tasks declare a priority and run in that
 * order, one at a time, with the loop given a turn between each — so the cost
 * is spread rather than stacked, and adding a task cannot silently collide with
 * an existing one.
 *
 * **Serial is the default, and it is not conservatism.** Provider loading in
 * this repository genuinely cannot be parallelised: providers self-register
 * into a global and overlapping loads steal each other's registrations, which
 * was measured at 176 providers attributed to the wrong extension. A queue that
 * ran everything concurrently would reintroduce that by default. Tasks that are
 * safe together say so with {@link StartupTask.lane}, and a lane runs its own
 * tasks concurrently while the default lane stays one-at-a-time.
 *
 * **Nothing here blocks anything.** A task that throws is retried on a backoff
 * and then recorded as failed; the queue moves on either way. A service that
 * cannot start must leave the app running with that one feature unavailable,
 * never a launch that stops at the first thing that did not work.
 */

import { describeError } from '../../src/utils/errors.ts';

export type StartupTaskState = 'pending' | 'running' | 'done' | 'failed';

export interface StartupTask {
  /** Stable id, used in the diagnostic report and to dedupe a re-add. */
  readonly id: string;
  /** Shown in Developer mode. A sentence, not a symbol name. */
  readonly label: string;
  /** Higher runs first. Ties keep insertion order. */
  readonly priority: number;
  /**
   * Tasks sharing a lane may run concurrently with each other. The default
   * lane is serial — see the note above about provider registration.
   */
  readonly lane?: string;
  /** Wall-clock delay from `start()` before this task is eligible. */
  readonly delayMs?: number;
  /** How many times to retry before giving up. Default 0. */
  readonly retries?: number;
  readonly run: () => Promise<void> | void;
}

export interface StartupTaskReport {
  readonly id: string;
  readonly label: string;
  readonly state: StartupTaskState;
  readonly priority: number;
  readonly lane: string;
  readonly attempts: number;
  /** Milliseconds from `start()` to the task beginning. */
  readonly startedAt: number | null;
  readonly durationMs: number | null;
  readonly error?: string;
}

/** How long to wait after a failure, doubling per attempt, capped. */
const RETRY_BASE_MS = 2_000;
const RETRY_CAP_MS = 60_000;

/** The default lane's name. Serial. */
const SERIAL_LANE = 'serial';

interface Entry {
  task: StartupTask;
  state: StartupTaskState;
  attempts: number;
  startedAt: number | null;
  durationMs: number | null;
  error?: string;
  /** Earliest time this entry may run, as ms from `start()`. */
  notBefore: number;
}

export class StartupQueue {
  private readonly entries = new Map<string, Entry>();
  private readonly busy = new Set<string>();
  private started = false;
  private origin = 0;
  private pump: ReturnType<typeof setTimeout> | null = null;
  private readonly onSettled: (entry: StartupTaskReport) => void;

  /**
   * @param onSettled Called once per task reaching `done` or `failed`. The
   *                  queue itself never logs: it has no opinion about which
   *                  logger, and a module that imports one is a module the
   *                  tests have to stand up.
   */
  constructor(onSettled: (entry: StartupTaskReport) => void = () => {}) {
    this.onSettled = onSettled;
  }

  /**
   * Adds a task. An id already present is ignored rather than replaced.
   *
   * Ignoring is deliberate: the caller that would re-add is a retry path, and
   * replacing a *running* entry would run the work twice while reporting one.
   */
  public add(task: StartupTask): void {
    if (this.entries.has(task.id)) return;
    this.entries.set(task.id, {
      task,
      state: 'pending',
      attempts: 0,
      startedAt: null,
      durationMs: null,
      notBefore: task.delayMs ?? 0,
    });
    if (this.started) this.schedule(0);
  }

  /** Begins running. Idempotent. */
  public start(): void {
    if (this.started) return;
    this.started = true;
    this.origin = Date.now();
    this.schedule(0);
  }

  /**
   * Runs one task now, out of order, and waits for it.
   *
   * The lazy-service path: something the user just asked for is queued behind
   * work nobody is waiting on. Already-running returns the same settle, and an
   * already-done task is a no-op — so a feature can call this on every use
   * without checking whether startup got there first.
   */
  public async demand(id: string): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry || entry.state === 'done') return;
    if (entry.state === 'running') {
      // Poll rather than hold a promise per waiter: this is reached on a button
      // press, not in a loop, and a shared promise would have to be cleaned up
      // on every settle path including the throwing one.
      while (this.entries.get(id)?.state === 'running') {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      return;
    }
    entry.notBefore = 0;
    await this.execute(entry);
  }

  public report(): StartupTaskReport[] {
    return [...this.entries.values()]
      .map((entry) => ({
        id: entry.task.id,
        label: entry.task.label,
        state: entry.state,
        priority: entry.task.priority,
        lane: entry.task.lane ?? SERIAL_LANE,
        attempts: entry.attempts,
        startedAt: entry.startedAt,
        durationMs: entry.durationMs,
        ...(entry.error === undefined ? {} : { error: entry.error }),
      }))
      .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  }

  /** Stops scheduling. Work already in flight finishes on its own. */
  public stop(): void {
    this.started = false;
    if (this.pump) {
      clearTimeout(this.pump);
      this.pump = null;
    }
  }

  private elapsed(): number {
    return Date.now() - this.origin;
  }

  /**
   * Wakes the pump.
   *
   * Always through a timer, never a direct call, so a task that completes
   * synchronously cannot recurse into the next one on the same tick — which is
   * how a queue built to keep the loop turning comes to block it.
   */
  private schedule(delayMs: number): void {
    if (!this.started || this.pump) return;
    this.pump = setTimeout(() => {
      this.pump = null;
      this.drain();
    }, Math.max(0, delayMs));
    this.pump.unref?.();
  }

  private drain(): void {
    if (!this.started) return;
    const now = this.elapsed();
    const ready = [...this.entries.values()]
      .filter((entry) => entry.state === 'pending' && entry.notBefore <= now)
      .sort((a, b) => b.task.priority - a.task.priority);

    let launched = false;
    for (const entry of ready) {
      /**
       * One task at a time *per lane*, which is not the same as one task at a
       * time. The first version of this asked whether anything at all was busy
       * before starting a serial task, and broke out of the loop after starting
       * one — so a named lane was held behind the serial lane in both
       * directions and the whole point of having lanes was lost. Every lane,
       * including the default one, is simply asked whether it is free.
       *
       * `execute` marks the task busy synchronously, before its first `await`,
       * so a second task in the same lane is correctly skipped on the very next
       * turn of this loop.
       */
      if (this.laneBusy(entry.task.lane ?? SERIAL_LANE)) continue;
      void this.execute(entry);
      launched = true;
    }

    const waiting = [...this.entries.values()].filter((e) => e.state === 'pending');
    if (!waiting.length) return;
    if (launched || this.busy.size > 0) {
      // Re-check when whatever is running settles; `execute` schedules then.
      return;
    }
    // Nothing runnable yet — wake at the soonest `notBefore`.
    const next = Math.min(...waiting.map((e) => e.notBefore));
    this.schedule(Math.max(25, next - now));
  }

  private laneBusy(lane: string): boolean {
    for (const id of this.busy) {
      const entry = this.entries.get(id);
      if (entry && (entry.task.lane ?? SERIAL_LANE) === lane) return true;
    }
    return false;
  }

  private async execute(entry: Entry): Promise<void> {
    if (entry.state === 'running' || entry.state === 'done') return;
    entry.state = 'running';
    entry.attempts++;
    entry.startedAt = this.elapsed();
    this.busy.add(entry.task.id);
    const began = Date.now();
    try {
      await entry.task.run();
      entry.state = 'done';
      entry.durationMs = Date.now() - began;
      delete entry.error;
    } catch (error) {
      entry.durationMs = Date.now() - began;
      entry.error = describeError(error);
      const budget = entry.task.retries ?? 0;
      if (entry.attempts <= budget) {
        // Back to pending on a backoff. A service that is slow to come up must
        // not take a retry slot from the ones behind it in the meantime.
        entry.state = 'pending';
        entry.notBefore =
          this.elapsed() +
          Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** (entry.attempts - 1));
      } else {
        entry.state = 'failed';
      }
    } finally {
      this.busy.delete(entry.task.id);
    }

    if (entry.state === 'done' || entry.state === 'failed') {
      this.onSettled(this.reportFor(entry));
    }
    this.schedule(0);
  }

  private reportFor(entry: Entry): StartupTaskReport {
    return {
      id: entry.task.id,
      label: entry.task.label,
      state: entry.state,
      priority: entry.task.priority,
      lane: entry.task.lane ?? SERIAL_LANE,
      attempts: entry.attempts,
      startedAt: entry.startedAt,
      durationMs: entry.durationMs,
      ...(entry.error === undefined ? {} : { error: entry.error }),
    };
  }
}
