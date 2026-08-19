import { app } from 'electron';
import fs from 'fs';
import path from 'path';

import type { FailureKind } from '../../src/types/analytics';
import { classifyFailure, FAILURE_KIND_LABELS } from './failureTaxonomy';

/**
 * A record of what went wrong, with enough context to reproduce it.
 *
 * Community extensions fail constantly and for reasons that are not our fault —
 * a site changes its page shape, a host starts returning 403, a mirror dies.
 * The app already reported those failures, but only as a sentence on screen at
 * the moment they happened, attached to nothing. By the time anyone wanted to
 * investigate, the query was gone, the provider was one of thirty, and the item
 * that failed was one row of a grid that had since been replaced.
 *
 * What makes a report actionable is the tuple, not the message: **which
 * provider, on which query, for which item, at what address**. That is what is
 * stored here, so a failure can be handed to a maintainer — or replayed with
 * `tools/e2e/provider-e2e.mjs` — rather than described from memory.
 *
 * Written to its own file rather than the datastore: this is debugging exhaust
 * that can run to hundreds of entries, and it has no business travelling inside
 * a user's backup alongside their watch history.
 */

/** What the user was looking at when they asked for a report. */
export interface ReportContext {
  query?: string;
  title?: string;
  url?: string;
  source?: string;
  message?: string;
}

/**
 * The form of a message used for grouping, not for display.
 *
 * Durations, byte counts and timestamps differ on every occurrence and are
 * never what distinguishes one failure from another, so thirty identical
 * timeouts arrived as thirty unique entries. They are flattened here.
 *
 * Bare integers are deliberately **not** touched: `HTTP 403` and `HTTP 404`
 * differ by one digit and mean opposite things, and merging them would produce
 * a shorter report that says something false.
 */
function groupingForm(message: string): string {
  return message
    .replace(/\b\d+(\.\d+)?\s?ms\b/gi, '<ms>')
    .replace(/\b\d+(\.\d+)?\s?s\b/gi, '<s>')
    .replace(/\b\d+(\.\d+)?\s?(B|KB|MB|GB|KiB|MiB|GiB)\b/g, '<size>')
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z?/g, '<time>')
    .replace(/0x[0-9a-f]{6,}/gi, '<addr>');
}

export type DiagnosticStage =
  | 'search'
  | 'detail'
  | 'links'
  | 'sources'
  | 'playback'
  | 'runtime'
  | 'install';

export interface DiagnosticRecord {
  id: string;
  at: number;
  /** `info` records things that worked, which is what makes replay possible. */
  level: 'error' | 'warn' | 'info';
  stage: DiagnosticStage;
  /** Provider, extension or indexer the failure belongs to. */
  source?: string;
  /** What the user had typed, when there was a query. */
  query?: string;
  /** The item being acted on, by name. */
  title?: string;
  /** The address involved — a `cs3ext://` URL or a provider's own handle. */
  url?: string;
  message: string;
  /** Stack, raw reply, or whatever else helps; trimmed before storing. */
  detail?: string;
}

/**
 * Enough to reconstruct months of use, not just the last thing that broke.
 *
 * The log started as a failure list. That answers "what went wrong just now"
 * and not "what was I doing when it worked", and the second question is the one
 * that lets a problem be reproduced: the source that played on Tuesday is the
 * control for the one that will not play today.
 *
 * So successes are recorded too, at `info`, and retention is measured in months
 * rather than entries. The cap remains as a floor under pathological cases — a
 * provider failing on a loop should not be able to push out a week of history.
 */
const MAX_RECORDS = 20_000;

/** How long a record is kept. Six months of ordinary use fits comfortably. */
const RETENTION_MS = 180 * 24 * 60 * 60 * 1000;

/** A raw provider reply can be a whole HTML page; the first part is the useful part. */
const MAX_DETAIL_CHARS = 2_000;

const FILE_NAME = 'cs3-diagnostics.json';

export class DiagnosticsLog {
  private records: DiagnosticRecord[] = [];
  private file: string;
  private writeTimer: NodeJS.Timeout | null = null;
  private nextId = 1;

  constructor(directory?: string) {
    const base = directory ?? (app ? app.getPath('userData') : process.cwd());
    this.file = path.join(base, FILE_NAME);
    this.restore();
  }

  private restore(): void {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const cutoff = Date.now() - RETENTION_MS;
        this.records = parsed
          .filter((record) => typeof record?.at === 'number' && record.at >= cutoff)
          .slice(0, MAX_RECORDS);
      }
    } catch {
      // No log yet, or an unreadable one. Neither is worth reporting: this is
      // the thing that reports problems, and it failing loudly would be absurd.
    }
  }

  /**
   * Persisted on a short delay.
   *
   * A search across thirty providers can produce thirty records in a second,
   * and writing the file thirty times would make the diagnostics the slowest
   * part of the failure they are describing.
   */
  private scheduleWrite(): void {
    if (this.writeTimer) return;
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      try {
        fs.writeFileSync(this.file, JSON.stringify(this.records), 'utf8');
      } catch {
        // Losing the log is not worth surfacing an error over.
      }
    }, 1_000);
    this.writeTimer.unref?.();
  }

  public record(entry: Omit<DiagnosticRecord, 'id' | 'at'> & { at?: number }): void {
    if (!entry.message) return;

    const record: DiagnosticRecord = {
      id: `d${this.nextId++}`,
      at: entry.at ?? Date.now(),
      level: entry.level,
      stage: entry.stage,
      source: entry.source,
      query: entry.query,
      title: entry.title,
      url: entry.url,
      message: entry.message.slice(0, 500),
      detail: entry.detail?.slice(0, MAX_DETAIL_CHARS),
    };

    this.records.unshift(record);

    // Age first, then the cap. Trimming by count alone would discard six-month
    // history the moment a provider started failing in a loop.
    const cutoff = Date.now() - RETENTION_MS;
    while (this.records.length > 0 && this.records[this.records.length - 1].at < cutoff) {
      this.records.pop();
    }
    if (this.records.length > MAX_RECORDS) this.records.length = MAX_RECORDS;
    this.scheduleWrite();
  }

  /**
   * Recent records, newest first.
   *
   * `levels` narrows to what the caller is asking about — the diagnostics panel
   * shows problems by default, because a list where every successful playback
   * scrolls past the one failure is not a debugging tool.
   */
  public list(limit = 200, levels?: Array<DiagnosticRecord['level']>): DiagnosticRecord[] {
    const wanted = levels?.length ? new Set(levels) : null;
    const rows = wanted ? this.records.filter((record) => wanted.has(record.level)) : this.records;
    return rows.slice(0, limit);
  }

  /** Everything retained, for export. */
  public all(): DiagnosticRecord[] {
    return [...this.records];
  }

  /**
   * Writes immediately, for shutdown.
   *
   * `scheduleWrite` debounces by a second and the timer is `unref`ed, so a quit
   * inside that window drops everything since the last flush — which is exactly
   * the window a crash-adjacent session ends in, and would explain a report
   * arriving with no records in it.
   */
  public flush(): void {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    try {
      fs.writeFileSync(this.file, JSON.stringify(this.records), 'utf8');
    } catch {
      // Shutdown is not the place to start reporting problems.
    }
  }

  public clear(): void {
    this.records = [];
    this.scheduleWrite();
  }

  public get filePath(): string {
    return this.file;
  }

  /**
   * The records that belong to what the user is currently looking at.
   *
   * This is what makes a "copy this error" button possible. Without it every
   * report is the whole log — three hundred entries covering everything that
   * happened all session — which is a real cost: the person receiving it has to
   * find the one failure being described, and the person sending it cannot tell
   * whether they have just pasted their entire viewing history into a chat.
   *
   * Matched on any of source, url, title or query rather than all of them,
   * because a failure is rarely tagged with everything: a search failure has a
   * query and no url, a link failure has a url and no query, and the record
   * that explains both is usually one of each.
   */
  public selectForContext(
    context: ReportContext,
    windowMs = 15 * 60 * 1000,
    limit = 60
  ): { records: DiagnosticRecord[]; matched: boolean } {
    const since = Date.now() - windowMs;
    const wanted = {
      source: context.source?.toLowerCase(),
      url: context.url,
      title: context.title?.toLowerCase(),
      query: context.query?.toLowerCase(),
    };
    const hasCriteria = Object.values(wanted).some(Boolean);

    if (hasCriteria) {
      const matches = this.records.filter((record) => {
        if (record.at < since) return false;
        if (wanted.source && record.source?.toLowerCase() === wanted.source) return true;
        if (wanted.url && record.url === wanted.url) return true;
        if (wanted.title && record.title?.toLowerCase() === wanted.title) return true;
        if (wanted.query && record.query?.toLowerCase() === wanted.query) return true;
        return false;
      });
      if (matches.length > 0) return { records: matches.slice(0, limit), matched: true };
    }

    // Nothing matched. Recent history is still far more useful than an empty
    // report, and the caller is told it is a fallback so the report can say so
    // rather than implying these entries are about the failure on screen.
    return { records: this.records.slice(0, 20), matched: false };
  }

  /**
   * A plain-text report, for pasting into an issue.
   *
   * Deliberately text rather than JSON: it is going into a chat message or a
   * bug tracker, and it has to stay readable by the maintainer of a scraper who
   * does not have this codebase open. The environment header goes first because
   * "which Java" and "which app version" are the first two questions anyone
   * asks and the two the reporter is least likely to know.
   *
   * `options.context` is folded in here rather than prepended by the caller.
   * The button used to paste its on-screen context above this text, which
   * restated the same provider, url and message that the log had already
   * recorded — deduplicating the body and then duplicating its most important
   * line above it.
   */
  public report(
    records: DiagnosticRecord[],
    environment: Record<string, string>,
    options: { context?: ReportContext; mode?: 'current' | 'full'; contextMatched?: boolean } = {}
  ): string {
    const mode = options.mode ?? 'full';
    const lines: string[] = [
      mode === 'current'
        ? 'CloudStream Desktop — Diagnostics (this failure)'
        : 'CloudStream Desktop — Diagnostics (full session)',
      `Generated: ${new Date().toISOString()}`,
      '',
      'Environment',
    ];

    for (const [key, value] of Object.entries(environment)) {
      lines.push(`  ${key}: ${value}`);
    }

    const context = options.context;
    if (context && Object.values(context).some(Boolean)) {
      lines.push('', 'What was on screen');
      if (context.query) lines.push(`  query:    ${context.query}`);
      if (context.title) lines.push(`  title:    ${context.title}`);
      if (context.source) lines.push(`  source:   ${context.source}`);
      if (context.url) lines.push(`  url:      ${context.url}`);
      if (context.message) lines.push(`  message:  ${context.message}`);
      if (options.contextMatched === false) {
        lines.push(
          '  note:     no log entries matched this exactly, so recent history follows instead.'
        );
      }
    }

    // Deduplicate records sharing identical level, stage, source, url, message, and detail
    interface GroupedRecord {
      record: DiagnosticRecord;
      count: number;
      firstAt: number;
      lastAt: number;
    }

    const groups: GroupedRecord[] = [];
    const groupMap = new Map<string, GroupedRecord>();
    const uniqueUrls = new Set<string>();
    const uniqueProviders = new Set<string>();
    const uniqueMessages = new Set<string>();

    for (const rec of records) {
      if (rec.url) uniqueUrls.add(rec.url);
      if (rec.source) uniqueProviders.add(rec.source);
      if (rec.message) uniqueMessages.add(rec.message);

      const key =
        `${rec.level}|${rec.stage}|${rec.source ?? ''}|${rec.url ?? ''}` +
        `|${groupingForm(rec.message)}|${groupingForm(rec.detail ?? '')}`;
      const existing = groupMap.get(key);
      if (existing) {
        existing.count++;
        if (rec.at < existing.firstAt) existing.firstAt = rec.at;
        if (rec.at > existing.lastAt) existing.lastAt = rec.at;
      } else {
        const group: GroupedRecord = {
          record: rec,
          count: 1,
          firstAt: rec.at,
          lastAt: rec.at,
        };
        groupMap.set(key, group);
        groups.push(group);
      }
    }

    const totalCount = records.length;
    const uniqueCount = groups.length;

    /**
     * What kind of failure this session actually had.
     *
     * Counted, and put before the events rather than after. Grouping a hundred
     * and thirteen load failures by class is what showed they came from six
     * missing types and not from a long tail — the same discipline is what a
     * maintainer needs from a pasted report, and it belongs at the top where it
     * will be read.
     */
    const kinds = new Map<FailureKind, number>();
    for (const rec of records) {
      if (rec.level !== 'error') continue;
      const kind = classifyFailure(rec.message);
      kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
    }
    if (kinds.size > 0) {
      lines.push('', 'Failures by cause');
      for (const [kind, count] of [...kinds.entries()].sort((a, b) => b[1] - a[1])) {
        lines.push(`  ${String(count).padStart(4)} × ${FAILURE_KIND_LABELS[kind].label}`);
      }
    }

    lines.push('', 'Diagnostic Events (Deduplicated)', '');

    for (const { record, count, firstAt, lastAt } of groups) {
      let timeHeader: string;
      if (count > 1 && firstAt !== lastAt) {
        const t1 = new Date(firstAt).toISOString();
        const t2 = new Date(lastAt).toISOString();
        timeHeader = `[${t1} ... ${t2}]`;
      } else {
        timeHeader = `[${new Date(record.at).toISOString()}]`;
      }

      const repeatSuffix = count > 1 ? ` (Occurrences: ${count})` : '';
      lines.push(
        `${timeHeader} ${record.level.toUpperCase()} ${record.stage}` +
          (record.source ? ` · ${record.source}` : '') +
          repeatSuffix
      );
      if (record.query) lines.push(`  query: ${record.query}`);
      if (record.title) lines.push(`  title: ${record.title}`);
      if (record.url) lines.push(`  url:   ${record.url}`);
      lines.push(`  error: ${record.message}`);
      if (record.detail) {
        lines.push('  detail:');
        for (const line of record.detail.split('\n')) lines.push(`    ${line}`);
      }
      lines.push('');
    }

    lines.push(
      'Summary',
      `  Unique Errors:       ${uniqueMessages.size}`,
      `  Unique Diagnostic:   ${uniqueCount}`,
      `  Unique Sources/URLs: ${uniqueUrls.size}`,
      `  Unique Providers:    ${uniqueProviders.size}`,
      `  Total Logged Events: ${totalCount} (Compressed to ${uniqueCount})`
    );

    return lines.join('\n');
  }
}
