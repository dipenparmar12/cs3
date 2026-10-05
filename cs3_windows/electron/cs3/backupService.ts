import fs from 'fs';
import path from 'path';
import { describeError } from '../../src/utils/errors.ts';
import type {
  BackupAnalysis,
  BackupGroup,
  BackupSectionAnalysis,
  ConflictItem,
  ConflictResolution,
  RestoreMode,
  RestorePlan,
  RestoreSectionResult,
  RestoreSummary,
  RowStatus,
} from '../../src/types/backup.ts';
import {
  diffPart,
  emptyChangeCounts,
  emptyStatusCounts,
  planPart,
  projectPart,
  type BackupPart,
  type PartDiff,
  type PartPlan,
} from './backup/collection.ts';
import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  countRows,
  readEnvelope,
  upgradeSection,
  type BackupEnvelope,
  type ReadResult,
  type SectionMigrations,
} from './backup/envelope.ts';

export { BACKUP_FORMAT_VERSION };

/**
 * One file that is this installation, and can become it again somewhere else
 * — restored as much or as little as the reader chooses.
 *
 * ## A framework, not a restore
 *
 * Each store registers a {@link BackupSection}: what it exports, its schema
 * version, how older shapes upgrade, and its rows as one or more keyed
 * {@link BackupPart}s. Comparison, the three modes, conflicts, "keep both",
 * the review counts and the summary are all derived from that description by
 * `backup/collection.ts`. A store added later joins by declaring its rows; it
 * cannot be added to the export and forgotten in the restore, and it cannot
 * invent its own meaning of "merge".
 *
 * ## What is in it, and what deliberately is not
 *
 * **In:** the library, watch progress, history, saved pages and their content,
 * searches, the download list, repositories and extensions and what is
 * switched off, indexer configuration, provider preferences, and every setting
 * — split into categories a person recognises (`backup/datastoreCategories.ts`).
 *
 * **Not in, each for its own reason:** extension archives and downloaded media
 * (large, and re-fetchable — the backup records *which*); tokens and device ids
 * (filtered on the way out by `DatastoreManager.snapshot`); diagnostics and
 * logs (they describe the machine they were captured on); caches (everything
 * in them expires, and a stale cache is worse than an empty one).
 *
 * ## Restoring
 *
 * 1. **Read everything before writing anything.** Every chosen section is
 *    upgraded, validated and compared before the first write. A section that
 *    cannot be read is skipped with its reason; it never stops the others.
 * 2. **Save what is here first.** The chosen sections' current state is
 *    written to a recovery file in this app's own format, and Undo replays it
 *    with Replace. Refusing to restore when that copy cannot be written is the
 *    point — a restore without a way back is the one this exists to prevent.
 * 3. **Write each section once.** A part's whole intended collection is
 *    committed in one store write, so an interrupted restore leaves each store
 *    either as it was or as intended, never half-merged.
 *
 * Running the same restore twice changes nothing the second time: every row
 * the first run wrote now compares as `same`.
 */

export interface BackupSection {
  id: string;
  label: string;
  /** One plain sentence: what restoring this brings back. */
  description: string;
  group: BackupGroup;
  /** Bumped when the shape of this section's rows changes. */
  schemaVersion: number;
  /** `fromVersion → step`, for reading files written before a bump. */
  migrations?: SectionMigrations;
  parts: BackupPart[];
  /** Carried so it can be read, never written back. */
  exportOnly?: boolean;
  /** The store reads it at startup; a restart completes the restore. */
  restartAfterRestore?: boolean;
  /** Runs after every part committed, for side effects a store owes its readers. */
  afterRestore?: (result: RestoreSectionResult) => void | Promise<void>;
}

export interface BackupServiceOptions {
  /** Where the pre-restore recovery copy is kept. */
  recoveryDir: string;
}

/** Conflicts listed per section. The rest are counted and follow the default. */
const CONFLICT_LIST_LIMIT = 200;
const NEW_SAMPLE_LIMIT = 6;
const RECOVERY_FILE = 'before-restore.json';

interface Prepared {
  section: BackupSection;
  plans: Array<{ part: BackupPart; plan: PartPlan<unknown>; invalid: number }>;
  migratedFrom?: number;
}

export class BackupService {
  /*
   * Fields written longhand rather than as constructor parameter properties:
   * `erasableSyntaxOnly` forbids the latter, so Node can strip types and run
   * the suites directly.
   */
  private readonly sections: BackupSection[];
  private readonly appVersion: string;
  private readonly platform: string;
  private readonly recoveryPath: string;
  private running = false;

  constructor(
    sections: BackupSection[],
    appVersion: string,
    platform: string,
    options: BackupServiceOptions
  ) {
    const ids = new Set<string>();
    for (const section of sections) {
      if (ids.has(section.id)) throw new Error(`Two backup sections are named "${section.id}".`);
      ids.add(section.id);
    }
    this.sections = sections;
    this.appVersion = appVersion;
    this.platform = platform;
    this.recoveryPath = path.join(options.recoveryDir, RECOVERY_FILE);
  }

  /** The categories this version can back up, in display order. */
  public describeSections(): Array<Pick<BackupSection, 'id' | 'label' | 'description' | 'group'>> {
    return this.sections.map(({ id, label, description, group }) => ({ id, label, description, group }));
  }

  /**
   * Builds the envelope. A section that throws is left out and logged rather
   * than failing the whole export: a backup missing one store is far more
   * useful than no backup.
   */
  public collect(only?: string[]): BackupEnvelope {
    // An empty selection means everything. A caller that filtered its list
    // down to nothing still meant to take a backup.
    const wanted = only && only.length > 0 ? new Set(only) : null;
    const sections: BackupEnvelope['sections'] = {};
    for (const section of this.sections) {
      if (wanted && !wanted.has(section.id)) continue;
      try {
        const data: Record<string, unknown[]> = {};
        for (const part of section.parts) data[part.id] = part.local();
        sections[section.id] = { schemaVersion: section.schemaVersion, count: countRows(data), data };
      } catch (error) {
        console.warn(`[backup] section "${section.id}" could not be read:`, error);
      }
    }
    return {
      format: BACKUP_FORMAT,
      formatVersion: BACKUP_FORMAT_VERSION,
      createdAt: Date.now(),
      app: { version: this.appVersion, platform: this.platform },
      sections,
    };
  }

  public write(
    filePath: string,
    only?: string[]
  ): { ok: boolean; path?: string; bytes?: number; error?: string } {
    try {
      const json = JSON.stringify(this.collect(only), null, 2);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      // Temp file and rename, so an interrupted write cannot leave a
      // half-file that looks like a backup.
      const temp = `${filePath}.part`;
      fs.writeFileSync(temp, json, 'utf-8');
      fs.renameSync(temp, filePath);
      return { ok: true, path: filePath, bytes: Buffer.byteLength(json) };
    } catch (error) {
      return { ok: false, error: describeError(error) };
    }
  }

  public read(filePath: string): ReadResult {
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch (error) {
      return { ok: false, error: describeError(error) };
    }
    return readEnvelope(parsed);
  }

  /** Describes a file against this installation, without changing anything. */
  public analyze(filePath: string): { ok: true; analysis: BackupAnalysis } | { ok: false; error: string } {
    const read = this.read(filePath);
    if (!read.ok) return read;
    const { envelope } = read;
    const known = new Map(this.sections.map((section) => [section.id, section]));
    const analyses: BackupSectionAnalysis[] = [];

    // Registry order first, so the screen groups the way the app does.
    for (const section of this.sections) {
      const stored = envelope.sections[section.id];
      if (stored) analyses.push(this.analyzeSection(section, stored));
    }
    for (const [id, stored] of Object.entries(envelope.sections)) {
      if (known.has(id)) continue;
      analyses.push({
        ...blankAnalysis(id, humanise(id), '', 'settings'),
        status: 'unsupported',
        reason: 'This version of the app does not know this kind of data, so it is skipped.',
        backupCount: stored.count,
      });
    }

    return {
      ok: true,
      analysis: {
        path: filePath,
        createdAt: envelope.createdAt,
        appVersion: envelope.app.version,
        platform: envelope.app.platform,
        formatVersion: envelope.migratedFrom ?? envelope.formatVersion,
        newerFormat: envelope.formatVersion > BACKUP_FORMAT_VERSION,
        sections: analyses,
      },
    };
  }

  private analyzeSection(
    section: BackupSection,
    stored: BackupEnvelope['sections'][string]
  ): BackupSectionAnalysis {
    const analysis = blankAnalysis(section.id, section.label, section.description, section.group);
    analysis.restartAfterRestore = section.restartAfterRestore === true;
    analysis.backupCount = stored.count;
    const visible = section.parts.filter((part) => !part.quiet);
    analysis.canKeepBoth = visible.some((part) => typeof part.duplicate === 'function');
    analysis.canRemove = visible.some((part) => part.removable !== false);

    if (section.exportOnly) return { ...analysis, status: 'exportOnly', reason: 'Kept for reference only.' };
    const upgraded = upgradeSection(stored, section.schemaVersion, section.migrations);
    if (!upgraded.ok) return { ...analysis, status: 'unsupported', reason: upgraded.reason };
    analysis.migratedFrom = upgraded.migratedFrom;

    try {
      analysis.backupCount = 0;
      for (const part of section.parts) {
        if (part.quiet) continue;
        const diff = diffPart(part, upgraded.data[part.id] ?? []);
        addPartAnalysis(analysis, part, diff);
      }
    } catch (error) {
      return {
        ...analysis,
        status: 'invalid',
        reason: `What is here now could not be read: ${describeError(error)}`,
      };
    }
    return analysis;
  }

  public hasUndo(): boolean {
    return fs.existsSync(this.recoveryPath);
  }

  /**
   * Restores the chosen sections. Never rejects; failures are reported per
   * section, and only a file that cannot be read at all fails the whole call.
   */
  public async restore(filePath: string, plan: RestorePlan): Promise<RestoreSummary> {
    return this.run(filePath, plan, true);
  }

  /**
   * Puts back what was here before the last restore, by replaying the
   * recovery copy with Replace. Repositories and extensions the restore added
   * stay installed: removing them is an uninstall, and the recovery copy does
   * not hold the archives to put back.
   */
  public async undo(): Promise<RestoreSummary> {
    if (!this.hasUndo()) {
      return { ...emptySummary(), ok: false, error: 'There is no restore to undo.' };
    }
    const read = this.read(this.recoveryPath);
    if (!read.ok) return { ...emptySummary(), ok: false, error: read.error };
    const summary = await this.run(
      this.recoveryPath,
      { mode: 'replace', sections: Object.keys(read.envelope.sections) },
      false
    );
    if (summary.ok) {
      // Kept beside rather than deleted, so a mistaken undo is still on disk.
      try {
        fs.renameSync(this.recoveryPath, `${this.recoveryPath}.undone`);
      } catch {
        /* An undo that ran twice changes nothing the second time. */
      }
    }
    return { ...summary, undoAvailable: this.hasUndo() };
  }

  private async run(filePath: string, plan: RestorePlan, keepRecovery: boolean): Promise<RestoreSummary> {
    if (this.running) {
      return { ...emptySummary(), ok: false, error: 'A restore is already running.' };
    }
    this.running = true;
    try {
      return await this.runExclusive(filePath, plan, keepRecovery);
    } finally {
      this.running = false;
    }
  }

  private async runExclusive(
    filePath: string,
    plan: RestorePlan,
    keepRecovery: boolean
  ): Promise<RestoreSummary> {
    const mode: RestoreMode =
      plan.mode === 'merge' || plan.mode === 'replace' ? plan.mode : 'smart';
    const read = this.read(filePath);
    if (!read.ok) return { ...emptySummary(), ok: false, error: read.error, mode };

    const wanted = new Set(Array.isArray(plan.sections) ? plan.sections : []);
    if (wanted.size === 0) {
      return { ...emptySummary(), ok: false, error: 'Nothing was chosen to restore.', mode };
    }

    const results: RestoreSectionResult[] = [];
    const prepared: Prepared[] = [];

    // Phase 1: read, upgrade and compare everything. Nothing is written yet.
    for (const section of this.sections) {
      if (!wanted.has(section.id)) continue;
      const result = blankResult(section);
      results.push(result);
      const stored = read.envelope.sections[section.id];
      if (!stored) {
        Object.assign(result, { status: 'skipped', reason: 'Not in this backup.' });
        continue;
      }
      if (section.exportOnly) {
        Object.assign(result, { status: 'skipped', reason: 'Kept for reference only.' });
        continue;
      }
      const upgraded = upgradeSection(stored, section.schemaVersion, section.migrations);
      if (!upgraded.ok) {
        Object.assign(result, { status: 'skipped', reason: upgraded.reason });
        continue;
      }
      try {
        const resolution = plan.resolutions?.[section.id];
        const resolutionFor = (partId: string) => (rowKey: string): ConflictResolution | undefined =>
          resolution?.items?.[`${partId}:${rowKey}`] ?? resolution?.default;
        prepared.push({
          section,
          migratedFrom: upgraded.migratedFrom,
          plans: section.parts.map((part) => {
            const diff = diffPart(part, upgraded.data[part.id] ?? []);
            return {
              part,
              plan: planPart(part, diff, mode, resolutionFor(part.id)),
              invalid: diff.invalid,
            };
          }),
        });
      } catch (error) {
        Object.assign(result, { status: 'failed', reason: describeError(error) });
      }
    }

    // Phase 2: keep a way back.
    const touches = prepared.filter(({ plans }) =>
      plans.some(({ plan: p }) => p.change.put.length > 0 || p.change.remove.length > 0)
    );
    if (keepRecovery && touches.length > 0) {
      const saved = this.write(
        this.recoveryPath,
        touches.map(({ section }) => section.id)
      );
      if (!saved.ok) {
        return {
          ...emptySummary(),
          ok: false,
          mode,
          error: `Nothing was restored: a copy of your current data could not be saved first (${saved.error}).`,
        };
      }
    }

    // Phase 3: write.
    for (const { section, plans, migratedFrom } of prepared) {
      const result = results.find((row) => row.id === section.id) as RestoreSectionResult;
      result.status = 'restored';
      if (migratedFrom !== undefined) result.notes.push('Converted from an older backup.');
      try {
        for (const { part, plan: partPlan, invalid } of plans) {
          const { change } = partPlan;
          let failedRows = 0;
          let notNeeded = 0;
          if (change.put.length > 0 || change.remove.length > 0) {
            const committed = await part.commit(change);
            if (committed?.failed?.length) {
              result.failed.push(...committed.failed);
              failedRows = committed.failed.length;
            }
            if (committed?.notes?.length) result.notes.push(...committed.notes);
            notNeeded = Math.min(committed?.unchanged ?? 0, partPlan.updated);
          }
          if (part.quiet) continue;
          // Refused rows came out of the puts, adds first: for the parts that
          // can refuse (repositories, extensions) a put is almost always one.
          const failedAdds = Math.min(failedRows, partPlan.added);
          result.added += partPlan.added - failedAdds;
          result.updated += Math.max(0, partPlan.updated - notNeeded - (failedRows - failedAdds));
          result.removed += partPlan.removed;
          result.unchanged += partPlan.unchanged + notNeeded;
          result.kept += partPlan.kept + partPlan.retained;
          result.skipped += partPlan.skipped;
          if (partPlan.retained > 0) {
            result.notes.push(
              `${partPlan.retained} ${part.label} only on this computer were kept — a restore never removes these.`
            );
          }
          if (invalid > 0) {
            result.failed.push({
              label: `${invalid} ${part.label}`,
              reason: 'Could not be read by this version of the app.',
            });
          }
        }
        await section.afterRestore?.(result);
      } catch (error) {
        // One bad section must not abandon the rest.
        result.status = 'failed';
        result.reason = describeError(error);
      }
    }

    const restartRecommended = prepared.some(
      ({ section }) => {
        if (!section.restartAfterRestore) return false;
        const row = results.find((result) => result.id === section.id);
        return !!row && row.status === 'restored' && row.added + row.updated + row.removed > 0;
      }
    );
    return {
      ok: true,
      mode,
      sections: results,
      restartRecommended,
      undoAvailable: this.hasUndo(),
    };
  }

  /** A filename that sorts by date and says what it is. */
  public static suggestedFilename(now = new Date()): string {
    const stamp = now.toISOString().slice(0, 19).replace(/[:T]/g, '-');
    return `cloudstream-backup-${stamp}.json`;
  }
}

function blankAnalysis(
  id: string,
  label: string,
  description: string,
  group: BackupGroup
): BackupSectionAnalysis {
  return {
    id,
    label,
    description,
    group,
    status: 'ok',
    backupCount: 0,
    localCount: 0,
    counts: emptyStatusCounts(),
    projection: { smart: emptyChangeCounts(), merge: emptyChangeCounts(), replace: emptyChangeCounts() },
    conflicts: [],
    conflictTotal: 0,
    canKeepBoth: false,
    canRemove: true,
    parts: [],
    restartAfterRestore: false,
  };
}

function addPartAnalysis(
  analysis: BackupSectionAnalysis,
  part: BackupPart,
  diff: PartDiff<unknown>
): void {
  const counts = emptyStatusCounts();
  counts.invalid = diff.invalid;
  const samples: string[] = [];
  for (const row of diff.rows) {
    counts[row.status]++;
    if (row.status === 'new' && samples.length < NEW_SAMPLE_LIMIT) samples.push(safeDescribe(part, row.backup));
    if (row.status === 'conflict') {
      analysis.conflictTotal++;
      if (analysis.conflicts.length < CONFLICT_LIST_LIMIT) {
        analysis.conflicts.push(conflictItem(part, row.key, row.backup, row.local));
      }
    }
  }
  for (const status of Object.keys(counts) as RowStatus[]) analysis.counts[status] += counts[status];
  analysis.backupCount += diff.backupCount;
  analysis.localCount += diff.localCount;
  for (const mode of ['smart', 'merge', 'replace'] as const) {
    const projected = projectPart(part, diff, mode);
    const total = analysis.projection[mode];
    for (const key of Object.keys(projected) as Array<keyof typeof projected>) total[key] += projected[key];
  }
  analysis.parts.push({
    id: part.id,
    label: part.label,
    backupCount: diff.backupCount,
    localCount: diff.localCount,
    counts,
    newSamples: samples,
  });
}

function conflictItem(part: BackupPart, key: string, backup: unknown, local: unknown): ConflictItem {
  const side = (row: unknown): string => {
    try {
      if (part.preview) return part.preview(row);
      const at = part.updatedAt?.(row);
      return typeof at === 'number' ? `Changed ${new Date(at).toISOString().slice(0, 10)}` : 'Different';
    } catch {
      return 'Different';
    }
  };
  return {
    key: `${part.id}:${key}`,
    label: safeDescribe(part, backup ?? local),
    backup: side(backup),
    current: side(local),
  };
}

function safeDescribe(part: BackupPart, row: unknown): string {
  try {
    return part.describe(row) || 'Untitled';
  } catch {
    return 'Untitled';
  }
}

function blankResult(section: BackupSection): RestoreSectionResult {
  return {
    id: section.id,
    label: section.label,
    status: 'skipped',
    added: 0,
    updated: 0,
    removed: 0,
    unchanged: 0,
    kept: 0,
    skipped: 0,
    failed: [],
    notes: [],
  };
}

function emptySummary(): RestoreSummary {
  return { ok: true, sections: [], restartRecommended: false, undoAvailable: false };
}

function humanise(id: string): string {
  const words = id.replace(/^settings\./, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[._-]+/g, ' ');
  return words ? words[0].toUpperCase() + words.slice(1).toLowerCase() : id;
}
