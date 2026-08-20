import fs from 'fs';
import path from 'path';

import { redact, redactUrl } from './redact.ts';

/**
 * The application's structured log.
 *
 * `DiagnosticsLog` already answers "what went wrong, and with what context" —
 * it exists to be pasted to a provider maintainer and is shaped for that. This
 * is the layer underneath: **every meaningful thing the app does**, as data
 * rather than prose, so a failure can be reconstructed from what led up to it
 * rather than from the one sentence that was on screen when it broke.
 *
 * Three decisions carry the design:
 *
 * **Structured, not formatted.** `logger.info('source_resolution_failed', {
 * provider, sourceId, httpStatus: 403, attempt: 2 })` rather than a sentence
 * containing those values. A sentence has to be parsed back out by whoever
 * reads it, and the parse is guesswork the moment anyone rewords the string.
 * Grouping 113 load failures into six missing classes — the thing that actually
 * solved that problem — is a `GROUP BY` over a field, and impossible over prose.
 *
 * **NDJSON, appended.** One JSON object per line, opened `a`, flushed on a
 * short timer and synchronously on exit. A crash therefore truncates at most
 * the last few hundred milliseconds and never corrupts what came before, which
 * a rewritten JSON array cannot promise — and a crash is precisely when the log
 * matters. It also means the file can be read with `grep` while the app runs.
 *
 * **One file per session.** A session is one app launch. Sessions are the unit
 * a user reports in ("it broke, I restarted, now it works"), and separating
 * them means the previous run's log is intact and complete rather than
 * interleaved with the current one's.
 *
 * Writes are single-writer by construction: the main process owns this file and
 * nothing else opens it. The sidecar logs to stderr, which the supervisor
 * captures and re-emits through here, so its lines are ordered against
 * everything else rather than racing with them.
 */

export const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const LEVEL_ORDER: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

/**
 * Where an event came from. A closed set, because the value of a scope is that
 * it can be filtered on, and a free-text scope is one nobody can enumerate.
 */
export const LOG_SCOPES = [
  'app',
  'search',
  'repository',
  'extension',
  'provider',
  'sources',
  'resolve',
  'metadata',
  'playback',
  'mpv',
  'player',
  'external',
  'proxy',
  'ffmpeg',
  'ffprobe',
  'download',
  'subtitle',
  'audio',
  'network',
  'runtime',
  'library',
  'discovery',
  'ipc',
] as const;
export type LogScope = (typeof LOG_SCOPES)[number];

/**
 * The context a record may carry.
 *
 * Every field is optional and none is invented — an event records what its call
 * site actually knows. The named fields are the ones worth querying across
 * scopes: "every event for this media", "every 403 from this provider",
 * "everything in this session between these timestamps". Anything else goes in
 * the index signature and still round-trips.
 */
export interface LogContext {
  mediaId?: string;
  mediaTitle?: string;
  repository?: string;
  extension?: string;
  provider?: string;
  sourceId?: string;
  operation?: string;
  action?: string;
  status?: string;
  url?: string;
  httpStatus?: number;
  engine?: string;
  playbackState?: string;
  error?: string;
  attempt?: number;
  durationMs?: number;
  [key: string]: unknown;
}

export interface LogRecord extends LogContext {
  /** Epoch milliseconds. */
  t: number;
  /** Monotonic within a session, so records that share a millisecond still order. */
  seq: number;
  level: LogLevel;
  scope: LogScope;
  /** `snake_case` verb phrase — the thing that happened. */
  event: string;
  session: string;
}

/** Rotate a session file at this size; a session that reaches it keeps going in `.1`, `.2`… */
const MAX_FILE_BYTES = 8 * 1024 * 1024;

/** Session files kept, newest first. Roughly a fortnight of ordinary use. */
const MAX_SESSION_FILES = 20;

/** Nothing older than this survives, however few files there are. */
const RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

/** Buffered writes are flushed at least this often. */
const FLUSH_INTERVAL_MS = 500;

/** A single record cannot be allowed to fill the file by itself. */
const MAX_RECORD_CHARS = 8_000;

const FILE_PREFIX = 'cs3-log-';

export interface LoggerOptions {
  directory?: string;
  /** Records below this are dropped at the call site and cost almost nothing. */
  level?: LogLevel;
  /** Off for tests that only want the in-memory ring. */
  persist?: boolean;
}

export class Logger {
  private readonly dir: string;
  private readonly persist: boolean;
  private minLevel: LogLevel;
  private readonly sessionId: string;
  private file: string;
  private rotation = 0;
  private bytesWritten = 0;
  private seq = 0;

  private pending: string[] = [];
  private flushTimer: NodeJS.Timeout | null = null;

  /**
   * The last N records, in memory.
   *
   * The file is the durable record; this is what answers a UI or an IPC query
   * without reading and parsing megabytes back off disk. Small on purpose — a
   * bug report wants the recent past, and the file has the rest.
   */
  private readonly ring: LogRecord[] = [];
  private static readonly RING_SIZE = 2_000;

  private listeners = new Set<(record: LogRecord) => void>();

  constructor(options: LoggerOptions = {}) {
    /**
     * The directory is the caller's to choose, and `electron` is deliberately
     * not imported here. Importing it would make this module unloadable outside
     * Electron — which is exactly where its tests run, under Node's type
     * stripping — and the one thing it wanted from `app` was a path that
     * `main.ts` already has.
     */
    this.dir = options.directory ?? path.join(process.cwd(), 'logs');
    this.persist = options.persist ?? true;
    this.minLevel = options.level ?? 'debug';
    this.sessionId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`;
    this.file = path.join(this.dir, `${FILE_PREFIX}${this.sessionId}.ndjson`);

    if (this.persist) {
      try {
        fs.mkdirSync(this.dir, { recursive: true });
        this.prune();
      } catch {
        // A log directory that cannot be created is not worth failing over.
        // Everything still works in memory, which is what most callers use.
        this.persist = false;
      }
    }
  }

  public get session(): string {
    return this.sessionId;
  }

  public get logFile(): string {
    return this.file;
  }

  public setLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  public get level(): LogLevel {
    return this.minLevel;
  }

  /**
   * A logger bound to a scope and some standing context.
   *
   * The point is that a service should not have to repeat which provider or
   * which media every call is about. `sources.child({ provider })` and every
   * event from it carries the provider without the call site restating it —
   * which is what makes the context reliably present rather than present
   * wherever someone remembered.
   */
  public child(scope: LogScope, base: LogContext = {}): ScopedLogger {
    return new ScopedLogger(this, scope, base);
  }

  public write(level: LogLevel, scope: LogScope, event: string, context: LogContext = {}): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) return;

    const record: LogRecord = {
      ...redactContext(context),
      t: Date.now(),
      seq: ++this.seq,
      level,
      scope,
      event,
      session: this.sessionId,
    };

    this.ring.push(record);
    if (this.ring.length > Logger.RING_SIZE) this.ring.shift();

    for (const listener of this.listeners) {
      try {
        listener(record);
      } catch {
        // A listener that throws must not take down the thing recording why.
      }
    }

    if (!this.persist) return;
    let line: string;
    try {
      line = JSON.stringify(record);
    } catch {
      // Circular or otherwise unserialisable context. Losing the fields is
      // better than losing the event.
      line = JSON.stringify({ t: record.t, seq: record.seq, level, scope, event, session: this.sessionId, error: 'context was not serialisable' });
    }
    if (line.length > MAX_RECORD_CHARS) line = `${line.slice(0, MAX_RECORD_CHARS)}"}`;

    this.pending.push(line);
    this.scheduleFlush();
  }

  public trace(scope: LogScope, event: string, context?: LogContext): void {
    this.write('trace', scope, event, context);
  }
  public debug(scope: LogScope, event: string, context?: LogContext): void {
    this.write('debug', scope, event, context);
  }
  public info(scope: LogScope, event: string, context?: LogContext): void {
    this.write('info', scope, event, context);
  }
  public warn(scope: LogScope, event: string, context?: LogContext): void {
    this.write('warn', scope, event, context);
  }
  public error(scope: LogScope, event: string, context?: LogContext): void {
    this.write('error', scope, event, context);
  }
  public fatal(scope: LogScope, event: string, context?: LogContext): void {
    this.write('fatal', scope, event, context);
    // A fatal is by definition the last thing that will be recorded, so it is
    // not left sitting in a buffer waiting for a timer that will not fire.
    this.flush();
  }

  /** Recent records, newest last, optionally filtered. */
  public query(filter: {
    level?: LogLevel;
    scopes?: LogScope[];
    event?: string;
    /** Matched against `mediaId`, `mediaTitle`, `provider`, `url` and `error`. */
    search?: string;
    since?: number;
    limit?: number;
  } = {}): LogRecord[] {
    const minimum = filter.level ? LEVEL_ORDER[filter.level] : 0;
    const scopes = filter.scopes ? new Set(filter.scopes) : null;
    const needle = filter.search?.toLowerCase();

    const matched = this.ring.filter((record) => {
      if (LEVEL_ORDER[record.level] < minimum) return false;
      if (scopes && !scopes.has(record.scope)) return false;
      if (filter.event && record.event !== filter.event) return false;
      if (filter.since && record.t < filter.since) return false;
      if (needle) {
        const haystack = [
          record.mediaId,
          record.mediaTitle,
          record.provider,
          record.url,
          record.error,
          record.event,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });

    const limit = filter.limit ?? 500;
    return matched.slice(-limit);
  }

  /** Every log file on disk, newest first, with its size. */
  public sessions(): Array<{ file: string; bytes: number; modified: number; current: boolean }> {
    if (!this.persist) return [];
    try {
      return fs
        .readdirSync(this.dir)
        .filter((name) => name.startsWith(FILE_PREFIX))
        .map((name) => {
          const full = path.join(this.dir, name);
          const stat = fs.statSync(full);
          return {
            file: full,
            bytes: stat.size,
            modified: stat.mtimeMs,
            current: full === this.file,
          };
        })
        .sort((a, b) => b.modified - a.modified);
    } catch {
      return [];
    }
  }

  public subscribe(listener: (record: LogRecord) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, FLUSH_INTERVAL_MS);
    this.flushTimer.unref?.();
  }

  /**
   * Synchronous, and deliberately.
   *
   * This runs on `before-quit` and on `process.on('exit')`, where an async
   * write simply never completes — the very moments whose records are most
   * worth having. Between those it runs on a 500 ms timer with at most a few
   * kilobytes buffered, which is not a cost worth optimising away.
   */
  public flush(): void {
    if (!this.persist || this.pending.length === 0) return;
    const payload = `${this.pending.join('\n')}\n`;
    this.pending = [];
    try {
      fs.appendFileSync(this.file, payload, 'utf8');
      this.bytesWritten += Buffer.byteLength(payload);
      if (this.bytesWritten >= MAX_FILE_BYTES) this.rotate();
    } catch {
      // Disk full, permissions, an antivirus holding the handle. Dropping the
      // lines is correct: the alternative is an unbounded buffer in a process
      // that is already having a bad time.
    }
  }

  /**
   * A session that outgrows one file continues in a numbered sibling.
   *
   * Rotating rather than truncating because a long session is exactly the one
   * whose beginning matters — an extension installed at launch is what explains
   * a provider failing an hour later.
   */
  private rotate(): void {
    this.rotation += 1;
    this.bytesWritten = 0;
    this.file = path.join(this.dir, `${FILE_PREFIX}${this.sessionId}.${this.rotation}.ndjson`);
    this.prune();
  }

  /** Retention: by age first, then by count. Neither alone is enough. */
  private prune(): void {
    try {
      const entries = fs
        .readdirSync(this.dir)
        .filter((name) => name.startsWith(FILE_PREFIX))
        .map((name) => {
          const full = path.join(this.dir, name);
          return { full, modified: fs.statSync(full).mtimeMs };
        })
        .sort((a, b) => b.modified - a.modified);

      const cutoff = Date.now() - RETENTION_MS;
      entries.forEach((entry, index) => {
        if (entry.full === this.file) return;
        if (entry.modified < cutoff || index >= MAX_SESSION_FILES) {
          try {
            fs.unlinkSync(entry.full);
          } catch {
            // Held open by something else; it will be caught next launch.
          }
        }
      });
    } catch {
      // Nothing to prune, or an unreadable directory.
    }
  }

  public shutdown(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.flush();
  }
}

/**
 * A logger with a scope and standing context already applied.
 *
 * Exists so the context is structurally guaranteed rather than remembered. A
 * `provider` field that is present on four call sites out of five produces a
 * log that cannot be grouped, which is the same as no log at all for the one
 * question worth asking of it.
 */
export class ScopedLogger {
  private readonly root: Logger;
  private readonly scope: LogScope;
  private readonly base: LogContext;

  // Explicit fields rather than parameter properties: `erasableSyntaxOnly` is
  // set, and the `.mts` tests are run by Node's type stripping, which cannot
  // erase a parameter property because it emits code.
  constructor(root: Logger, scope: LogScope, base: LogContext) {
    this.root = root;
    this.scope = scope;
    this.base = base;
  }

  public child(context: LogContext): ScopedLogger {
    return new ScopedLogger(this.root, this.scope, { ...this.base, ...context });
  }

  public trace(event: string, context?: LogContext): void {
    this.root.write('trace', this.scope, event, { ...this.base, ...context });
  }
  public debug(event: string, context?: LogContext): void {
    this.root.write('debug', this.scope, event, { ...this.base, ...context });
  }
  public info(event: string, context?: LogContext): void {
    this.root.write('info', this.scope, event, { ...this.base, ...context });
  }
  public warn(event: string, context?: LogContext): void {
    this.root.write('warn', this.scope, event, { ...this.base, ...context });
  }
  public error(event: string, context?: LogContext): void {
    this.root.write('error', this.scope, event, { ...this.base, ...context });
  }

  /**
   * Times an operation and logs its outcome once, with the duration.
   *
   * A start record and an end record is two lines to correlate; one line
   * carrying `durationMs` and `status` is one row to sort. The start is still
   * emitted at `trace`, where it costs nothing and is off by default, because
   * an operation that never finishes leaves no end record at all — and knowing
   * it began is the only evidence that it hung.
   */
  public begin(event: string, context?: LogContext): (outcome?: LogContext) => void {
    const startedAt = Date.now();
    this.root.write('trace', this.scope, `${event}_started`, { ...this.base, ...context });
    let settled = false;
    return (outcome: LogContext = {}) => {
      if (settled) return;
      settled = true;
      const durationMs = Date.now() - startedAt;
      const level: LogLevel = outcome.error ? 'warn' : 'info';
      this.root.write(level, this.scope, event, {
        ...this.base,
        ...context,
        ...outcome,
        durationMs,
      });
    };
  }
}

/** Applied to every record, so a call site cannot forget it. See `redact`. */
function redactContext(context: LogContext): LogContext {
  const out: LogContext = {};
  for (const [key, value] of Object.entries(context)) {
    if (value === undefined) continue;
    if (typeof value === 'string') {
      out[key] = /url|href|address|link|magnet/i.test(key) ? redactUrl(value) : redact(value);
    } else if (value instanceof Error) {
      out[key] = redact(value.message);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * The process-wide instance.
 *
 * A singleton rather than an injected dependency because the alternative is
 * threading a logger through every constructor in `electron/`, and the services
 * that most need to log — a proxy, an ffmpeg wrapper — are the ones furthest
 * from where one would be constructed. The constructor is exported so tests can
 * make their own against a temp directory.
 */
let instance: Logger | null = null;

export function getLogger(): Logger {
  if (!instance) instance = new Logger();
  return instance;
}

export function setLogger(logger: Logger): void {
  instance = logger;
}
