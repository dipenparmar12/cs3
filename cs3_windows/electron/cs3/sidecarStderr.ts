import type { LogLevel } from '../logging/logger.ts';

/**
 * Turns the sidecar's stderr into records that can be counted.
 *
 * `logger.ts` states that "the sidecar logs to stderr, which the supervisor
 * captures and re-emits through here". It did not: stderr went to
 * `console.warn` and nowhere else, so every extension failure was visible only
 * to whoever had a terminal open — and the one workflow this codebase relies on
 * for extension problems, *count the log before fixing anything*, could not be
 * run on them at all. Both of the traces that prompted this module had to be
 * pasted from a console by hand, and so did the six-missing-classes finding
 * before them.
 *
 * Its own module, and free of `electron`, for the reason `logger.ts` is: that
 * import makes a module unloadable under Node's type stripping, which is where
 * the tests run. `SidecarSupervisor` owns the pipe; this owns what the lines
 * mean.
 *
 * **The shape is the point, not the volume.** A Java stack trace is thirty
 * lines describing one event: logged individually they are thirty records that
 * cannot be grouped and that push the cause out of the ring buffer. Folded into
 * one record with the failing class promoted to its own field, they are a
 * `GROUP BY` — which is exactly what turned 113 load failures into six missing
 * types.
 */

/** `INFO PluginInstance: Adding X` — the JVM's own level, where it prints one. */
const LEVEL_PREFIX = /^(TRACE|DEBUG|INFO|WARN|WARNING|ERROR|SEVERE|FATAL)\b[: ]?\s*/;

/** A line that continues the record above rather than starting a new one. */
const STACK_LINE = /^(\s+at\s|\s*Caused by:|\s*\.\.\.\s+\d+\s+more|\s*Suppressed:)/;

/** The class behind a linkage failure, which is the field worth counting. */
const MISSING_CLASS = /(?:NoClassDefFoundError|ClassNotFoundException):\s*([\w/$.]+)/;

/** A single stack cannot be allowed to become the log file. */
const MAX_STACK_LINES = 80;

export interface SidecarRecord {
  level: LogLevel;
  message: string;
  /** The stack, when the message had one under it. */
  detail?: string;
  /** Set when the failure names a class that could not be resolved. */
  missingClass?: string;
}

export class SidecarStderrReader {
  private readonly emit: (record: SidecarRecord) => void;
  private head: string | null = null;
  private stack: string[] = [];

  constructor(emit: (record: SidecarRecord) => void) {
    this.emit = emit;
  }

  /**
   * Folds one line in.
   *
   * A stack line attaches to the message above it; anything else flushes the
   * record in progress and becomes the new head.
   */
  public push(line: string): void {
    if (!line.trim()) return;
    if (STACK_LINE.test(line) && this.head !== null) {
      if (this.stack.length < MAX_STACK_LINES) this.stack.push(line.trim());
      return;
    }
    this.flush();
    this.head = line.trim();
  }

  /**
   * Emits the record in progress.
   *
   * The supervisor calls this on a short timer as well as on the next line: the
   * last trace of a session has nothing after it to trigger a flush, and that
   * is precisely the trace worth having.
   */
  public flush(): void {
    const head = this.head;
    if (!head) return;
    const stack = this.stack;
    this.head = null;
    this.stack = [];

    const match = LEVEL_PREFIX.exec(head);
    const missing = MISSING_CLASS.exec([head, ...stack].join('\n'))?.[1];

    this.emit({
      level: levelFor(match?.[1], stack.length > 0),
      message: match ? head.slice(match[0].length) : head,
      ...(missing ? { missingClass: missing.replace(/\//g, '.') } : {}),
      ...(stack.length > 0 ? { detail: stack.join('\n') } : {}),
    });
  }
}

/**
 * The JVM's own word for it, or a judgement when it printed none.
 *
 * A stack trace with no level prefix is an uncaught throwable the JVM printed
 * itself — an error however quiet the first line looks. Recording those at
 * `info` would hide every plugin crash from a problems-only view, which is the
 * view anyone debugging actually opens.
 */
function levelFor(prefix: string | undefined, hasStack: boolean): LogLevel {
  switch ((prefix ?? '').toUpperCase()) {
    case 'ERROR':
    case 'SEVERE':
    case 'FATAL':
      return 'error';
    case 'WARN':
    case 'WARNING':
      return 'warn';
    case 'DEBUG':
      return 'debug';
    case 'TRACE':
      return 'trace';
    case 'INFO':
      return 'info';
    default:
      return hasStack ? 'error' : 'info';
  }
}
