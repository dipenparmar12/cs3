import crypto from 'crypto';

import { JsonFileStore } from '../util/jsonFileStore.ts';
import { classifyFailure, groupingForm, FAILURE_KIND_LABELS } from './failureTaxonomy.ts';
import type { SidecarRecord } from './sidecarStderr.ts';
import type { FailureKind } from '../../src/types/analytics.ts';
import type { LogLevel } from '../logging/logger.ts';

/**
 * What the extension runtime keeps getting wrong, counted and kept.
 *
 * This repository's one reliable workflow for extension problems is **count the
 * log before fixing anything** — it is what turned 113 load failures into six
 * missing classes, and what showed that five of eight "broken" extensions were
 * one stale-runtime bug. That workflow was, until this module, impossible to
 * run from inside the app. The pieces around it were all in place and none of
 * them added up to a tally:
 *
 *  - `Logger` writes NDJSON, **one file per session**, and rotates old sessions
 *    away. A count across sessions meant a bespoke script over 21 files.
 *  - `DiagnosticsLog` is shaped to be *pasted to a maintainer* — it holds the
 *    tuple for one failure, capped and time-windowed, deliberately not a
 *    history.
 *  - `providerAnalytics` counts per provider for the *ranking*, so it holds
 *    outcomes rather than causes and cannot answer "what is actually broken".
 *
 * So this is the third thing: a **durable ledger of distinct problems**, keyed
 * by what makes two occurrences the same problem, surviving restarts and log
 * rotation. It is the artifact you read when you sit down to fix extensions.
 *
 * ## What one row is
 *
 * A row is `(cause, source, groupingForm(message))`. All three are needed and
 * the measurement says why:
 *
 *  - **cause** alone is eight rows for six thousand records — the right shape
 *    for "where is the effort", useless for "what do I change".
 *  - **message** alone is thousands of rows, because a message carries a host,
 *    a title and a duration. `groupingForm` removes exactly the parts that
 *    differ per occurrence and — deliberately — leaves bare integers, because
 *    `HTTP 403` and `HTTP 404` differ by one digit and mean opposite things.
 *  - **source** is what makes a row *assignable*. 92.5% of a real log's stderr
 *    carries one. Without it, "Read timed out" is one row covering nine
 *    extensions and nobody can act on it.
 *
 * ## What it deliberately does not do
 *
 * **It does not rank or punish.** `providerAnalytics` owns that, and its rules
 * about not being silently punitive stand. A row here is a note for whoever is
 * debugging, not evidence against a provider.
 *
 * **It does not store URLs, queries or titles.** Those are in `DiagnosticsLog`
 * for the one failure being reported, with a retention window and a user-facing
 * erase. This file is long-lived by design, and a long-lived file that
 * accumulated what someone searched for is a viewing history under another
 * name. A row holds the *shape* of a failure and nothing about who hit it.
 *
 * Free of `electron` for the reason `logger.ts` and `sidecarStderr.ts` are: the
 * import makes a module unloadable under Node's type stripping, which is where
 * the tests run. The directory is passed in.
 */

/** One distinct problem, however many times it has happened. */
export interface ExtensionIssue {
  /** Stable across sessions: the hash of the fingerprint, not a counter. */
  id: string;
  cause: FailureKind;
  /** Who printed it — a plugin tag, an extractor, or a library. */
  source?: string;
  /** The worst level this has ever been seen at. */
  level: LogLevel;
  /** A representative message, kept verbatim. */
  message: string;
  /** A representative stack, when one was attached. */
  detail?: string;
  /** Set when the failure named a class that could not be resolved. */
  missingClass?: string;
  /** Extensions this has been attributed to, when the host knew. */
  plugins: string[];
  occurrences: number;
  /** Distinct app launches this has appeared in — a better signal than raw count. */
  sessions: number;
  firstSeen: number;
  lastSeen: number;
  /**
   * App versions at first and last sighting.
   *
   * The cheapest possible answer to "did my fix work?": an issue whose
   * `lastSeenVersion` is two releases behind is one that stopped happening, and
   * without this the only way to tell is to remember when you changed it.
   */
  firstSeenVersion?: string;
  lastSeenVersion?: string;
  /**
   * Set by the reader when a problem has been dealt with.
   *
   * Kept rather than deleted: a muted row that starts happening again is the
   * regression signal, and deleting it means the next occurrence looks new.
   */
  muted?: boolean;
  /** Free text from whoever triaged it. */
  note?: string;
  /**
   * The launch this was last seen in, which is what makes `sessions` durable.
   *
   * Counting sessions from an in-memory "seen this run" set alone works until
   * the ledger is reconstructed, and it is reconstructed on every launch — so
   * the count has to be decided against something written down. Comparing the
   * stored session id to the current one gives the right answer whether the row
   * came from disk or from this run.
   */
  lastSession?: string;
}

export interface IssueSummary {
  cause: FailureKind;
  label: string;
  hint: string;
  issues: number;
  occurrences: number;
}

export interface IssueQuery {
  /** Default 200. */
  limit?: number;
  cause?: FailureKind;
  source?: string;
  /** Default false — a muted row is triaged, not interesting. */
  includeMuted?: boolean;
  /** Only rows seen in the current session. */
  thisSessionOnly?: boolean;
}

/**
 * Rows kept.
 *
 * Generous, because a row is small and the point is a history. What bounds the
 * file in practice is that rows are *distinct problems*: the 6,069-record log
 * this was built from collapses to well under a hundred.
 */
const MAX_ISSUES = 1_500;

/** A sample stack is evidence, not a log. */
const MAX_DETAIL_CHARS = 4_000;
const MAX_MESSAGE_CHARS = 1_000;
/** One row cannot be allowed to accumulate every plugin in the corpus. */
const MAX_PLUGINS_PER_ISSUE = 12;

const WRITE_DEBOUNCE_MS = 2_000;

const LEVEL_ORDER: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

interface Persisted {
  version: 1;
  issues: ExtensionIssue[];
}

export interface ExtensionIssueLogOptions {
  /** Absolute path to the file. Its directory is created on write. */
  file: string;
  /** This launch. Rows count distinct sessions, not just occurrences. */
  sessionId: string;
  /** Stamped onto rows so a fix can be dated. */
  appVersion?: string;
  /** Off for tests that only want the in-memory tally. */
  persist?: boolean;
}

export class ExtensionIssueLog {
  private readonly issues = new Map<string, ExtensionIssue>();
  /** Which rows this session has already touched, so `sessions` counts launches. */
  private readonly seenThisSession = new Set<string>();
  private readonly sessionId: string;
  private readonly appVersion?: string;
  private readonly store: JsonFileStore<Persisted> | null;

  constructor(options: ExtensionIssueLogOptions) {
    this.sessionId = options.sessionId;
    this.appVersion = options.appVersion;
    this.store =
      options.persist === false
        ? null
        : new JsonFileStore<Persisted>(options.file, WRITE_DEBOUNCE_MS, () => ({
            version: 1,
            issues: [...this.issues.values()],
          }));

    const loaded = this.store?.load();
    for (const issue of loaded?.issues ?? []) {
      if (issue && typeof issue.id === 'string') {
        this.issues.set(issue.id, { ...issue, plugins: issue.plugins ?? [] });
      }
    }
  }

  /**
   * Folds one sidecar stderr record in.
   *
   * Returns the row it landed on, or `null` when the record is not a problem.
   * Informational lines are the overwhelming majority — 3,832 of 5,407 in the
   * sampled logs — and a ledger that held them would be the session log again,
   * with the failures diluted back out of sight.
   */
  public recordSidecar(record: SidecarRecord, plugin?: string): ExtensionIssue | null {
    if (LEVEL_ORDER[record.level] < LEVEL_ORDER.warn) return null;
    const cause = record.cause ?? classifyFailure(record.message);
    /**
     * A cancelled call is not a problem, and 79 of them in a real log were
     * being listed as extensions throwing.
     *
     * The viewer typing a new query while fifteen scrapes are in flight
     * cancels all fifteen, and every one throws. Listing those puts the app's
     * own decision to stop waiting at the top of a page headed "what is
     * broken" — and puts the *slowest* providers there, because those are the
     * ones still running when the cancel lands.
     */
    if (cause === 'cancelled') return null;
    return this.record({
      cause,
      source: record.source,
      level: record.level,
      message: record.message,
      detail: record.detail,
      missingClass: record.missingClass,
      plugin,
    });
  }

  /**
   * Folds in a failure the host classified rather than the sidecar printing it.
   *
   * A plugin that will not load never reaches stderr as a tagged line — the
   * host learns it from a failed `load` reply — and that is the single most
   * actionable category there is. Leaving it out would mean the ledger held
   * every way an extension misbehaves except the one that stops it working.
   */
  public recordPluginFailure(input: {
    plugin: string;
    reason: string;
    kind?: string;
    tier?: string;
  }): ExtensionIssue | null {
    if (!input.reason) return null;
    return this.record({
      cause: classifyFailure(`${input.kind ?? ''} ${input.reason}`),
      source: input.plugin,
      level: 'error',
      message: input.tier ? `${input.tier}: ${input.reason}` : input.reason,
      plugin: input.plugin,
    });
  }

  private record(input: {
    cause: FailureKind;
    source?: string;
    level: LogLevel;
    message: string;
    detail?: string;
    missingClass?: string;
    plugin?: string;
  }): ExtensionIssue {
    const message = input.message.slice(0, MAX_MESSAGE_CHARS);
    const id = fingerprint(input.cause, input.source, message);
    const now = Date.now();

    let issue = this.issues.get(id);
    if (!issue) {
      issue = {
        id,
        cause: input.cause,
        ...(input.source ? { source: input.source } : {}),
        level: input.level,
        message,
        ...(input.detail ? { detail: input.detail.slice(0, MAX_DETAIL_CHARS) } : {}),
        ...(input.missingClass ? { missingClass: input.missingClass } : {}),
        plugins: [],
        occurrences: 0,
        sessions: 0,
        firstSeen: now,
        lastSeen: now,
        ...(this.appVersion ? { firstSeenVersion: this.appVersion } : {}),
      };
      this.issues.set(id, issue);
    }

    issue.occurrences += 1;
    issue.lastSeen = now;
    if (this.appVersion) issue.lastSeenVersion = this.appVersion;
    // The worst it has ever been. A condition that is usually a warning and
    // occasionally throws is the second thing, and recording the last level
    // seen would let a quiet occurrence hide that.
    if (LEVEL_ORDER[input.level] > LEVEL_ORDER[issue.level]) issue.level = input.level;
    // A later occurrence may carry the stack the first one lacked.
    if (!issue.detail && input.detail) issue.detail = input.detail.slice(0, MAX_DETAIL_CHARS);
    if (!issue.missingClass && input.missingClass) issue.missingClass = input.missingClass;

    if (input.plugin && !issue.plugins.includes(input.plugin)) {
      if (issue.plugins.length < MAX_PLUGINS_PER_ISSUE) issue.plugins.push(input.plugin);
    }

    // Counted against the stored session id rather than the in-memory set, so
    // a row read back from disk is not credited with a second session merely
    // for being seen again in the launch that loaded it.
    if (issue.lastSession !== this.sessionId) {
      issue.lastSession = this.sessionId;
      issue.sessions += 1;
    }
    this.seenThisSession.add(id);

    this.evictIfNeeded();
    this.store?.schedule();
    return issue;
  }

  /**
   * Drops the least recently seen rows, never the least frequent.
   *
   * A row with two occurrences from this morning is what someone is debugging;
   * one with four hundred from three weeks ago is already known and is in the
   * report they pasted at the time. Evicting by count would delete exactly the
   * rows the ledger is being opened for.
   */
  private evictIfNeeded(): void {
    if (this.issues.size <= MAX_ISSUES) return;
    const ordered = [...this.issues.values()].sort((a, b) => a.lastSeen - b.lastSeen);
    for (const issue of ordered.slice(0, this.issues.size - MAX_ISSUES)) {
      this.issues.delete(issue.id);
    }
  }

  public list(query: IssueQuery = {}): ExtensionIssue[] {
    const limit = query.limit ?? 200;
    return [...this.issues.values()]
      .filter((issue) => {
        if (!query.includeMuted && issue.muted) return false;
        if (query.cause && issue.cause !== query.cause) return false;
        if (query.source && issue.source !== query.source) return false;
        if (query.thisSessionOnly && !this.seenThisSession.has(issue.id)) return false;
        return true;
      })
      .sort((a, b) => b.occurrences - a.occurrences || b.lastSeen - a.lastSeen)
      .slice(0, limit);
  }

  /**
   * The tally, by cause. This is the "count before fixing" view.
   *
   * Both numbers, because they answer different questions. `occurrences` says
   * where the noise is; `issues` says how many distinct things you would have
   * to fix to remove it. Six hundred occurrences across three rows is an
   * afternoon; across two hundred rows it is a different project.
   */
  public summary(): IssueSummary[] {
    const byCause = new Map<FailureKind, IssueSummary>();
    for (const issue of this.issues.values()) {
      if (issue.muted) continue;
      const entry = byCause.get(issue.cause) ?? {
        cause: issue.cause,
        label: FAILURE_KIND_LABELS[issue.cause]?.label ?? issue.cause,
        hint: FAILURE_KIND_LABELS[issue.cause]?.hint ?? '',
        issues: 0,
        occurrences: 0,
      };
      entry.issues += 1;
      entry.occurrences += issue.occurrences;
      byCause.set(issue.cause, entry);
    }
    return [...byCause.values()].sort((a, b) => b.occurrences - a.occurrences);
  }

  /** Which extensions generate the most, which is where effort pays. */
  public bySource(limit = 25): Array<{ source: string; issues: number; occurrences: number }> {
    const map = new Map<string, { source: string; issues: number; occurrences: number }>();
    for (const issue of this.issues.values()) {
      if (issue.muted || !issue.source) continue;
      const entry = map.get(issue.source) ?? { source: issue.source, issues: 0, occurrences: 0 };
      entry.issues += 1;
      entry.occurrences += issue.occurrences;
      map.set(issue.source, entry);
    }
    return [...map.values()].sort((a, b) => b.occurrences - a.occurrences).slice(0, limit);
  }

  /** Triage. `muted` hides a row from the default view without forgetting it. */
  public annotate(id: string, changes: { muted?: boolean; note?: string }): boolean {
    const issue = this.issues.get(id);
    if (!issue) return false;
    if (changes.muted !== undefined) issue.muted = changes.muted;
    if (changes.note !== undefined) issue.note = changes.note.slice(0, 500) || undefined;
    this.store?.schedule();
    return true;
  }

  public clear(): number {
    const n = this.issues.size;
    this.issues.clear();
    this.seenThisSession.clear();
    this.store?.schedule();
    return n;
  }

  /**
   * A plain-text report, ordered the way it should be read.
   *
   * The tally goes first and the rows follow. That order is the whole lesson of
   * the six-missing-classes finding: a list of 113 failures sends you fixing
   * symptoms one at a time, and the same list with a count on top shows six
   * causes covering all of it.
   */
  public report(environment: Record<string, string> = {}): string {
    const lines: string[] = [
      'CloudStream Desktop — Extension issue ledger',
      `Generated: ${new Date().toISOString()}`,
    ];

    if (Object.keys(environment).length > 0) {
      lines.push('', 'Environment');
      for (const [key, value] of Object.entries(environment)) lines.push(`  ${key}: ${value}`);
    }

    const summary = this.summary();
    const totalOccurrences = summary.reduce((n, s) => n + s.occurrences, 0);
    lines.push(
      '',
      `Failures by cause — ${this.issues.size} distinct, ${totalOccurrences} occurrences`
    );
    for (const entry of summary) {
      lines.push(
        `  ${String(entry.occurrences).padStart(6)}  ${entry.label} (${entry.issues} distinct)`
      );
    }

    const sources = this.bySource(10);
    if (sources.length > 0) {
      lines.push('', 'By source');
      for (const s of sources) {
        lines.push(`  ${String(s.occurrences).padStart(6)}  ${s.source} (${s.issues} distinct)`);
      }
    }

    lines.push('', 'Issues');
    for (const issue of this.list({ limit: 60 })) {
      lines.push(
        '',
        `  [${issue.cause}] ${issue.source ?? 'unattributed'} — ${issue.occurrences}x over ${issue.sessions} session(s)`,
        `    first: ${new Date(issue.firstSeen).toISOString()}${issue.firstSeenVersion ? ` (v${issue.firstSeenVersion})` : ''}`,
        `    last:  ${new Date(issue.lastSeen).toISOString()}${issue.lastSeenVersion ? ` (v${issue.lastSeenVersion})` : ''}`,
        `    ${issue.message}`
      );
      if (issue.missingClass) lines.push(`    missing class: ${issue.missingClass}`);
      if (issue.plugins.length > 0) lines.push(`    extensions: ${issue.plugins.join(', ')}`);
      if (issue.note) lines.push(`    note: ${issue.note}`);
      if (issue.detail) {
        for (const line of issue.detail.split('\n').slice(0, 12)) lines.push(`      ${line}`);
      }
    }

    return lines.join('\n');
  }

  /** Called on quit; the last few seconds are the ones worth having. */
  public flush(): void {
    this.store?.flush();
  }
}

/**
 * What makes two occurrences the same problem.
 *
 * Hashed rather than stored whole so the id is short enough to be a React key,
 * an IPC argument and a stable handle for a note across restarts — a counter
 * would renumber on every load and re-point every note at a different row.
 */
function fingerprint(cause: FailureKind, source: string | undefined, message: string): string {
  return crypto
    .createHash('sha1')
    .update(`${cause} ${source ?? ''} ${groupingForm(message)}`)
    .digest('hex')
    .slice(0, 16);
}

/**
 * The process-wide ledger.
 *
 * A singleton for the reason `getLogger` is one: the two places that produce
 * issues are `SidecarSupervisor`, which owns a pipe and is constructed several
 * layers below anything that could inject a ledger, and `PluginManager`, which
 * learns about load failures. Threading it through both would mean changing
 * every constructor between them and `main.ts` to carry a debugging aid.
 *
 * Absent until `setIssueLog` runs, and the accessor answers `null` rather than
 * building one: unlike a logger, a ledger with no file is not a useful default
 * — it would collect a session's problems and then drop them, which is worse
 * than not collecting them, because it looks like it worked.
 */
let ledger: ExtensionIssueLog | null = null;

export function getIssueLog(): ExtensionIssueLog | null {
  return ledger;
}

export function setIssueLog(log: ExtensionIssueLog | null): void {
  ledger = log;
}
