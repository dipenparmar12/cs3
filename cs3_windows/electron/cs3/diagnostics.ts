import { app } from 'electron';
import fs from 'fs';
import path from 'path';

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

  public clear(): void {
    this.records = [];
    this.scheduleWrite();
  }

  public get filePath(): string {
    return this.file;
  }

  /**
   * A plain-text report, for pasting into an issue.
   *
   * Deliberately text rather than JSON: it is going into a chat message or a
   * bug tracker, and it has to stay readable by the maintainer of a scraper who
   * does not have this codebase open. The environment header goes first because
   * "which Java" and "which app version" are the first two questions anyone
   * asks and the two the reporter is least likely to know.
   */
  public report(records: DiagnosticRecord[], environment: Record<string, string>): string {
    const lines: string[] = [
      'CloudStream Desktop — diagnostics report',
      `Generated: ${new Date().toISOString()}`,
      '',
    ];

    for (const [key, value] of Object.entries(environment)) {
      lines.push(`${key}: ${value}`);
    }
    lines.push('', `${records.length} record(s)`, '');

    for (const record of records) {
      lines.push(
        `[${new Date(record.at).toISOString()}] ${record.level.toUpperCase()} ${record.stage}` +
          (record.source ? ` · ${record.source}` : '')
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

    return lines.join('\n');
  }
}
