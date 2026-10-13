import type { LogLevel } from '../logging/logger.ts';
import type { FailureKind } from '../../src/types/analytics.ts';
import { classifyFailure } from './failureTaxonomy.ts';

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
 *
 * ## What counting 21 real session logs changed here (2026-08-26)
 *
 * The capture worked. What it produced was not usable, and the numbers say why:
 * **5,407 of 6,069 records in a real user's log were `sidecar_stderr`** — 89% of
 * everything the app recorded — and `missingClass` matched **none** of them. The
 * class problem really is closed; what fills the log now is a different thing
 * entirely, and the reader could not tell the parts apart:
 *
 * | Shape, by frequency | What it is |
 * |---|---|
 * | `ApiError: ------------------` ×290 | upstream's `logError` divider. Pure punctuation. |
 * | `PluginInstance: Adding Voe (…) ExtractorApi` ×~200 | registration chatter, logged at `info` |
 * | `Aug 25, 2026 1:23:45 PM okhttp3…Platform log` ×151 | a JUL *header*, whose message is on the next line |
 * | `[plugin D/Ayzen] audinifer.com` ×~150 | the `android.util.Log` shim, carrying its own level letter |
 * | `Exception in NiceHttp: java.net.SocketException Connection reset` ×74 | a real failure, recorded at `info` |
 *
 * Three consequences, and each is a defect rather than untidiness:
 *
 * **The level was wrong in the direction that hides things.** `levelFor` fell
 * back to `info` for anything without a prefix and without a stack, so
 * `Read timed out`, `Connection reset` and `UnknownHostException` — 240
 * occurrences between them — were `info`, while `PluginInstance: Adding …` was
 * also `info`. A problems-only view, which is the only view anyone debugging
 * opens, therefore showed neither.
 *
 * **Nothing carried who printed it.** The tag is right there at the front of the
 * line — `GDFlix:`, `VidzeeApi:`, `[plugin D/Ayzen]` — and it was folded into
 * the message, so "which extension is generating these 700 lines" could not be
 * asked. That is the single most useful question about this log.
 *
 * **A JUL record is two lines and was read as two events.** `SimpleFormatter`
 * prints `<date> <class> <method>` and then the message underneath, so 151
 * headers were logged with no message and 151 messages with no origin.
 *
 * So a record now carries {@link SidecarRecord.source} and, for anything at
 * `warn` or above, {@link SidecarRecord.cause} from the same closed taxonomy the
 * ranking and the diagnostics screen use. Those two fields are what make
 * `extensionIssues.ts` a `GROUP BY` rather than a transcript.
 */

/** `INFO PluginInstance: Adding X` — the JVM's own level, where it prints one. */
const LEVEL_PREFIX = /^(TRACE|DEBUG|INFO|WARN|WARNING|ERROR|SEVERE|FATAL)\b[: ]?\s*/;

/** A line that continues the record above rather than starting a new one. */
const STACK_LINE = /^(\s+at\s|\s*Caused by:|\s*\.\.\.\s+\d+\s+more|\s*Suppressed:)/;

/** The class behind a linkage failure, which is the field worth counting. */
const MISSING_CLASS = /(?:NoClassDefFoundError|ClassNotFoundException):\s*([\w/$.]+)/;

/**
 * `android.util.Log` as the shim prints it: `[plugin D/Ayzen] message`.
 *
 * The letter is the level the *extension author* chose, which is better
 * information than anything inferable from the text, and the tag is the closest
 * thing to an attribution the corpus offers.
 */
const ANDROID_LOG = /^\[plugin ([VDIWEA])\/([^\]]{1,64})\]\s*(.*)$/;

/**
 * `java.util.logging`'s `SimpleFormatter` header — `<date> <class> <method>`.
 *
 * Its message is on the *next* line, which is why this is matched rather than
 * ignored: read as a standalone event it is 151 records saying nothing, and the
 * 151 lines under it become 151 records with no origin.
 */
const JUL_HEADER =
  /^[A-Z][a-z]{2} \d{1,2}, \d{4}[, ]+\d{1,2}:\d{2}:\d{2}(?:\s?[AP]M)?\s+([\w.$]+)\s+([\w$<>]+)$/;

/**
 * `Tag: message`, the shape almost every extension and extractor prints.
 *
 * Bounded and identifier-shaped on purpose. Without the bound, a sentence
 * containing a colon — `Removing this link as it is invalid: https://…` —
 * donates its first clause as a tag, and the tally grows one row per URL.
 */
const TAGGED = /^([A-Za-z][\w.$ -]{0,31}):\s+(?=\S)(.*)$/s;

/** A throwable printed on its own: `java.io.IOException: Canceled`. */
const THROWABLE = /^((?:[a-z]\w*\.)+[A-Z]\w*(?:Exception|Error|Throwable))\b/;

/**
 * The plugin loader's own name, as it appears in a stack frame.
 *
 * `PluginClassLoader` names itself `cs3-plugin-<pluginId>`, and the JVM prints
 * the defining loader before the class in every frame it owns — so a trace
 * through plugin code carries its attribution in plain sight:
 *
 *     at cs3-plugin-Ultima.-1758189056//com.phisher98.UltimaPlugin.load(...)
 *
 * Worth reading, because the alternative is what this did first: attribute the
 * record to `java.lang.reflect.InvocationTargetException`, which names the
 * reflection layer and says nothing. That is the same mistake `Main.describe`
 * was fixed for on the JVM side — see the second round of community-extension
 * findings — arriving here from the other end.
 */
const PLUGIN_FRAME = /\bat\s+cs3-plugin-([\w.$-]+)\/\//;

/**
 * The part of a stack that describes the failure, as opposed to the route to it.
 *
 * Only `Caused by:` and `Suppressed:` lines say what went wrong; `at` frames are
 * an itinerary. Classifying from the whole trace reads that itinerary as
 * evidence, and it produced exactly the confident wrong answer this taxonomy
 * exists to avoid: every plugin failure passes through
 * `com.cloudstream.desktop.sidecar.PluginHost`, the `runtime-unavailable` rule
 * matches the word `sidecar`, and so *every* trace was reported as the extension
 * runtime being broken — sending the reader to a runtime status page that is
 * working and has nothing to tell them.
 */
const EXPLANATORY = /^(Caused by:|Suppressed:)/;

/**
 * Registration announcements. High volume, zero diagnostic value, and they
 * arrive at `INFO` so they cannot be dropped by level alone.
 *
 * Demoted rather than discarded: "which providers did this archive register"
 * is a real question, just not one worth 200 records at the level a problems
 * view reads.
 */
const REGISTRATION = /^PluginInstance:\s*Adding\b/;

/**
 * A line that is only punctuation — upstream's `logError` prints a row of
 * dashes above and below every block, 290 times in one real log. It marks an
 * error rather than describing one, and the block's actual content follows it
 * as its own lines.
 */
const DIVIDER = /^[-=_*#~\s]{8,}$/;

/**
 * Failures the JVM prints with no level prefix and no stack.
 *
 * These were the ones recorded at `info`, which is where they became invisible.
 * `NiceHttp` and `ApiError` are upstream's own wrappers; the rest is the
 * vocabulary a thrown exception uses when a scraper catches and prints it, plus
 * the plain words a scraper uses when it reports a failure in its own prose.
 *
 * **Deliberately vocabulary, not sentiment.** `failed`, `refused`, `could not`
 * and `does not implement` mean one thing wherever they appear. What is *not*
 * here is extension-specific prose: `GDFlix: No server matched` is a real
 * failure 66 times over in the sampled logs and no general rule can know that,
 * so it stays informational. Guessing at prose would promote arbitrary plugin
 * chatter and refill the problems view with the noise this pass emptied out of
 * it. The certain signal about a failed call comes from the host, which watched
 * the call fail — see `ExtensionIssueLog.recordPluginFailure`.
 */
const UNPREFIXED_PROBLEM =
  /^(?:Exception in |ApiError\b|Error::?|Fatal\b)|(?:Exception|Error):\s|\bwas leaked\b|\b(?:timed out|Connection reset|UnknownHostException|SocketException|SocketTimeoutException)\b|\bfail(?:ed|ure|s)\b|\bdoes not implement\b|\b(?:could not|unable to|gave up)\b|\brefused\b/i;

/** A single stack cannot be allowed to become the log file. */
const MAX_STACK_LINES = 80;

export interface SidecarRecord {
  level: LogLevel;
  message: string;
  /** The stack, when the message had one under it. */
  detail?: string;
  /** Set when the failure names a class that could not be resolved. */
  missingClass?: string;
  /**
   * Who printed it — a plugin tag, an extractor, or a library.
   *
   * The one field that makes "which extension is producing these 700 lines"
   * answerable. Absent when the line carried no recognisable tag, which is
   * honest: inventing one would attribute a library's output to whichever
   * plugin happened to be running.
   */
  source?: string;
  /**
   * The failure category, for records at `warn` and above only.
   *
   * Deliberately not set for informational lines. `classifyFailure` ends in a
   * catch-all that matches any line containing "Error" or "failed", so applying
   * it to `PluginInstance: Adding …` would file registration chatter under a
   * failure kind and put it in the tally the ledger exists to keep clean.
   */
  cause?: FailureKind;
}

export class SidecarStderrReader {
  private readonly emit: (record: SidecarRecord) => void;
  private head: string | null = null;
  private stack: string[] = [];
  /** Set by a JUL header, consumed by the line under it. */
  private julSource: string | null = null;

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

    const trimmed = line.trim();

    // A divider marks the error block that follows; the block's own lines say
    // what happened. Recording the marker adds a row to every tally with
    // nothing in it.
    //
    // Tested past the tag as well as against the whole line: upstream prints
    // its dashes *through* `Log.d("ApiError", …)`, so every one of the 290
    // occurrences in the sampled logs arrives as `ApiError: ------`.
    if (DIVIDER.test(trimmed) || DIVIDER.test(trimmed.replace(TAGGED, '$2'))) return;

    const jul = JUL_HEADER.exec(trimmed);
    if (jul) {
      // The message is on the next line. Flush what is in progress so the
      // header does not attach to it, and hold the origin for that line.
      this.flush();
      this.julSource = jul[1];
      return;
    }

    this.flush();
    this.head = trimmed;
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
    // Nothing pending. A JUL origin waiting for its message stays held — this
    // path runs on every line, and clearing it here unbound every JUL header
    // from the line it belongs to. If the stream ends here instead, the origin
    // is simply dropped, which is right: a header with no message is not an
    // event.
    if (!head) return;
    const stack = this.stack;
    const julSource = this.julSource;
    this.head = null;
    this.stack = [];
    this.julSource = null;

    const record = describe(head, stack, julSource);
    this.emit(record);
  }
}

/**
 * One stderr line, plus whatever attached to it, as a record.
 *
 * Exported for the ledger, which replays historical log files through the same
 * reading rather than re-deriving it — two implementations of "what does this
 * line mean" would drift, and the tally would then disagree with the log it
 * was built from.
 */
export function describe(head: string, stack: string[] = [], julSource?: string | null): SidecarRecord {
  const joined = [head, ...stack].join('\n');
  const missing = MISSING_CLASS.exec(joined)?.[1];
  /**
   * What the failure *is*, without the route it took to get here.
   *
   * `at` frames are dropped — see EXPLANATORY. Source locations are stripped
   * inside `classifyFailure` itself, which is the same problem from the other
   * direction: a line number is a three-digit integer and `server-error` tests
   * for one.
   */
  const subject = [head, ...stack.filter((line) => EXPLANATORY.test(line))].join('\n');

  let level: LogLevel | null = null;
  let source: string | undefined = julSource ?? undefined;
  let message = head;

  const android = ANDROID_LOG.exec(message);
  if (android) {
    // The extension author's own level and tag. Both are better than anything
    // that could be inferred from the text underneath them.
    level = ANDROID_LEVELS[android[1]] ?? 'info';
    source = android[2].trim();
    message = android[3].trim();
  }

  if (level === null) {
    const prefixed = LEVEL_PREFIX.exec(message);
    if (prefixed) {
      level = levelForPrefix(prefixed[1]);
      message = message.slice(prefixed[0].length);
    }
  }

  if (source === undefined) {
    const tagged = TAGGED.exec(message);
    if (tagged && !THROWABLE.test(message)) {
      source = tagged[1].trim();
      // The tag stays in the message as well. It is what a maintainer greps
      // for, and stripping it makes two different extractors' "No server
      // matched" indistinguishable in any view that does not show the column.
    } else {
      /**
       * A plugin's own loader outranks the exception class.
       *
       * `InvocationTargetException` is the reflection layer, not the culprit —
       * and for a plugin failure the culprit's id is right there in the frames.
       */
      const owner = PLUGIN_FRAME.exec(joined)?.[1];
      if (owner) {
        source = owner;
      } else {
        const throwable = THROWABLE.exec(message)?.[1];
        if (throwable) source = throwable;
      }
    }
  }

  if (level === null) level = inferLevel(message, stack.length > 0);

  /**
   * Registration is demoted even when the JVM called it `INFO`, because that
   * is exactly what it calls it.
   *
   * The plugin loader announces every provider through `Log.i`, so the prefix
   * is `INFO` on all ~200 of them and honouring it leaves the chatter at the
   * same level as the failures. A `WARN` or `ERROR` on one of these lines is
   * something else and is left alone.
   */
  if (level === 'info' && REGISTRATION.test(message)) level = 'debug';

  const record: SidecarRecord = { level, message };
  if (source) record.source = source;
  if (missing) record.missingClass = missing.replace(/\//g, '.');
  if (stack.length > 0) record.detail = stack.join('\n');
  // Only a problem gets a cause. See the field's own note: the taxonomy's last
  // rule matches anything containing "Error", so classifying an informational
  // line files chatter as a failure.
  if (level === 'warn' || level === 'error' || level === 'fatal') {
    record.cause = classifyFailure(subject);
  }
  return record;
}

/** `android.util.Log`'s level letters, as the shim prints them. */
const ANDROID_LEVELS: Record<string, LogLevel> = {
  V: 'trace',
  D: 'debug',
  I: 'info',
  W: 'warn',
  E: 'error',
  A: 'fatal',
};

function levelForPrefix(prefix: string): LogLevel {
  switch (prefix.toUpperCase()) {
    case 'ERROR':
    case 'SEVERE':
      return 'error';
    case 'FATAL':
      return 'fatal';
    case 'WARN':
    case 'WARNING':
      return 'warn';
    case 'DEBUG':
      return 'debug';
    case 'TRACE':
      return 'trace';
    default:
      return 'info';
  }
}

/**
 * A level for a line the JVM printed without one.
 *
 * A stack trace with no prefix is an uncaught throwable the JVM printed itself
 * — an error however quiet the first line looks.
 *
 * Everything else is judged from the text, and the judgement is what the
 * measurement above forced. Falling back to `info` for an unprefixed line put
 * `Connection reset`, `Read timed out` and `UnknownHostException` — the three
 * most common real failures in the corpus — below the threshold of the only
 * view anyone debugging opens, while leaving 200 lines of `Adding … ExtractorApi`
 * at the same level. Both halves of that are now stated explicitly.
 */
function inferLevel(message: string, hasStack: boolean): LogLevel {
  if (hasStack) return 'error';
  if (REGISTRATION.test(message)) return 'debug';
  if (UNPREFIXED_PROBLEM.test(message)) return 'warn';
  return 'info';
}
