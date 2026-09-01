import fs from 'fs';
import path from 'path';

/**
 * One file that is this installation, and can become it again somewhere else.
 *
 * There were already two export paths and neither answered this question.
 * `datastore:exportBackup` writes the **Android** wire format so a backup can
 * move between the phone app and this one — that is interoperability, and it
 * carries only the key/value store. `library:export` and `history:exportAll`
 * each carry one store. So a user moving to a new machine, or reinstalling
 * after a problem, had to find and move several files and would still lose
 * their repositories, which extensions they had switched off, their saved
 * pages, their download queue and their indexer configuration.
 *
 * ## What is in it, and what deliberately is not
 *
 * **In:** settings, library and watch progress, watch history, saved pages,
 * search history, per-title outcomes, provider measurements, the download
 * queue, the installed repositories and extensions, which of them are switched
 * off, and indexer configuration.
 *
 * **Not in — and each for its own reason:**
 *
 * | Left out | Why |
 * |---|---|
 * | The `.cs3` archives themselves | Hundreds of MB of third-party binaries that re-download from their repositories. The backup records *which* ones, which is the part that cannot be recovered. |
 * | Downloaded media files | The same argument, several orders of magnitude worse. |
 * | Tokens, session and device ids | `DatastoreManager.snapshot` filters them on the way *out*, so they are never written to a file in someone's Downloads folder. |
 * | Diagnostics, the issue ledger, logs | Debugging exhaust. It describes the machine it was captured on and says nothing about the machine it would be restored to. |
 * | Caches — sources, details, discovery | Everything in them expires. Restoring a stale cache is strictly worse than an empty one. |
 *
 * ## Merge or replace, and the user picks
 *
 * **Merge** is the default and the safe one. A restore onto a running
 * installation must not delete what the backup predates: a preference added
 * since it was taken would otherwise silently revert to its default, which
 * reads as the restore having broken something rather than as it not having
 * covered it.
 *
 * **Replace** is the one people actually mean by "restore my machine". Merging
 * a library cannot remove a title watched since the backup, so a merge-only
 * restore can never reproduce the state in the file — it can only ever be a
 * superset of it. Someone reinstalling after a problem wants the file, not the
 * union.
 *
 * Two rules keep replace from being the destructive option it sounds like:
 *
 *  - **A section opts in** (`replaceable`). One that cannot meaningfully clear
 *    itself merges and *says so* in its report row, rather than silently
 *    ignoring the mode the user chose. A restore that quietly did something
 *    other than what was asked is worse than one that refused.
 *  - **Replace never deletes what the backup does not describe.** The
 *    extensions section rewrites the enable/disable lists to match exactly and
 *    leaves every `.cs3` archive on disk. Those are hundreds of megabytes of
 *    re-download, the existing undo snapshots the datastore and could not put
 *    them back, and an unrecoverable delete reached through a radio button is
 *    the wrong default at any level of confirmation.
 *
 * Every section reports how many rows it took and which mode it took them in,
 * so "restored" is a number and a claim about what happened rather than either
 * alone.
 */

/** Bumped when a section's shape changes in a way a reader must know about. */
export const BACKUP_FORMAT_VERSION = 1;

export interface BackupEnvelope {
  format: 'cloudstream-desktop-backup';
  formatVersion: number;
  createdAt: number;
  app: { version: string; platform: string };
  /** Row counts, so a file can be described without being fully parsed. */
  summary: Record<string, number>;
  contents: Record<string, unknown>;
}

/**
 * How a section puts the backup's rows back.
 *
 * `merge` adds to what is here; `replace` makes what is here match the file.
 * The distinction is per section rather than per file only because a section
 * may not be able to honour `replace` — see `BackupSection.replaceable`.
 */
export type RestoreMode = 'merge' | 'replace';

export interface RestoreReport {
  ok: boolean;
  /** What each section restored, how, or why it did not. */
  sections: Array<{ name: string; restored: number; note?: string; mode?: RestoreMode }>;
  error?: string;
}

/**
 * One backup section: how to read it and how to put it back.
 *
 * A table rather than two long switch statements, so a new store is one entry
 * and cannot be added to the export while being forgotten in the restore —
 * which is the failure that turns a backup into a file that looks complete and
 * silently is not.
 */
export interface BackupSection {
  name: string;
  /** Reads the current state. Throwing is caught and reported per section. */
  collect: () => unknown;
  /**
   * Puts it back, returning how many rows were taken.
   *
   * `mode` is passed to every section, including ones that did not opt in to
   * `replace` — they receive `'merge'`, because the service downgrades the mode
   * before calling rather than leaving each section to remember to. A section
   * that forgot would replace when the report said it merged.
   */
  restore?: (value: unknown, mode: RestoreMode) => number;
  /**
   * Whether this section can make the installation match the file.
   *
   * Opt-in, and absent means no. A section defaulting to replaceable would
   * make every store added later silently destructive the moment someone
   * chooses Replace, which is exactly the wrong direction for a default to
   * fail in.
   */
  replaceable?: boolean;
  /** Human label for the report. */
  label: string;
}

/** What a restore was asked to do. */
export interface RestoreOptions {
  /** Section names to restore. Empty or absent means all of them. */
  only?: string[];
  /** Defaults to `merge`, which is the mode that cannot lose data. */
  mode?: RestoreMode;
}

export class BackupService {
  /*
   * Fields written longhand rather than as constructor parameter properties.
   * `erasableSyntaxOnly` is set across this project so Node can strip types and
   * run the suites directly, and that syntax is not erasable — the same reason
   * `util/disabledSet.ts` spells its fields out.
   */
  private readonly sections: BackupSection[];
  private readonly appVersion: string;
  private readonly platform: string;

  constructor(sections: BackupSection[], appVersion: string, platform: string) {
    this.sections = sections;
    this.appVersion = appVersion;
    this.platform = platform;
  }

  /**
   * Builds the envelope.
   *
   * A section that throws is recorded as absent rather than failing the whole
   * export: a backup missing one store is far more useful than no backup, and
   * the summary says which one is missing.
   */
  public collect(only?: string[]): BackupEnvelope {
    const contents: Record<string, unknown> = {};
    const summary: Record<string, number> = {};
    // An empty selection means "everything", not "nothing". A caller that
    // passed a filtered list and filtered it down to zero meant to take a
    // backup; writing an empty file and calling it one is the worse answer.
    const wanted = only && only.length > 0 ? new Set(only) : null;

    for (const section of this.sections) {
      if (wanted && !wanted.has(section.name)) continue;
      try {
        const value = section.collect();
        contents[section.name] = value;
        summary[section.name] = Array.isArray(value)
          ? value.length
          : value && typeof value === 'object'
            ? Object.keys(value as object).length
            : value === undefined
              ? 0
              : 1;
      } catch (error) {
        contents[section.name] = null;
        summary[section.name] = -1;
        console.warn(`[backup] section "${section.name}" could not be read:`, error);
      }
    }

    return {
      format: 'cloudstream-desktop-backup',
      formatVersion: BACKUP_FORMAT_VERSION,
      createdAt: Date.now(),
      app: { version: this.appVersion, platform: this.platform },
      summary,
      contents,
    };
  }

  public write(
    filePath: string,
    only?: string[]
  ): { ok: boolean; path?: string; bytes?: number; error?: string } {
    try {
      const envelope = this.collect(only);
      const json = JSON.stringify(envelope, null, 2);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      // Written to a temp file and renamed, so an interrupted write cannot
      // leave a half-file that looks like a backup.
      const temp = `${filePath}.part`;
      fs.writeFileSync(temp, json, 'utf-8');
      fs.renameSync(temp, filePath);
      return { ok: true, path: filePath, bytes: Buffer.byteLength(json) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /** Reads a file and describes it, without restoring anything. */
  public inspect(filePath: string): { ok: boolean; envelope?: Omit<BackupEnvelope, 'contents'>; error?: string } {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as BackupEnvelope;
      const problem = this.validate(parsed);
      if (problem) return { ok: false, error: problem };
      const { contents: _contents, ...rest } = parsed;
      return { ok: true, envelope: rest };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Refuses anything that is not one of ours.
   *
   * Checked by the `format` marker rather than by shape: a JSON file that
   * happens to have a `contents` key would otherwise be fed to every section's
   * restore, and "restored 0 rows from 9 sections" is a much worse answer than
   * "that is not a CloudStream backup".
   */
  private validate(parsed: unknown): string | null {
    if (!parsed || typeof parsed !== 'object') return 'That file is not readable as a backup.';
    const envelope = parsed as Partial<BackupEnvelope>;
    if (envelope.format !== 'cloudstream-desktop-backup') {
      return 'That is not a CloudStream Desktop backup file.';
    }
    if (typeof envelope.formatVersion !== 'number') return 'That backup has no format version.';
    if (envelope.formatVersion > BACKUP_FORMAT_VERSION) {
      return `That backup was written by a newer version of the app (format ${envelope.formatVersion}). Update and try again.`;
    }
    if (!envelope.contents || typeof envelope.contents !== 'object') {
      return 'That backup has no contents.';
    }
    return null;
  }

  public restore(filePath: string, options?: RestoreOptions): RestoreReport {
    let parsed: BackupEnvelope;
    try {
      parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as BackupEnvelope;
    } catch (error) {
      return {
        ok: false,
        sections: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }

    const problem = this.validate(parsed);
    if (problem) return { ok: false, sections: [], error: problem };

    const only = options?.only;
    const requested: RestoreMode = options?.mode === 'replace' ? 'replace' : 'merge';
    const wanted = only && only.length > 0 ? new Set(only) : null;
    const report: RestoreReport['sections'] = [];

    for (const section of this.sections) {
      if (wanted && !wanted.has(section.name)) continue;
      const value = parsed.contents[section.name];
      if (value === undefined || value === null) {
        report.push({ name: section.name, restored: 0, note: 'not in this backup' });
        continue;
      }
      if (!section.restore) {
        report.push({ name: section.name, restored: 0, note: 'export only' });
        continue;
      }
      /*
       * The downgrade happens here, once, rather than inside each section.
       * A section that has not opted in to replace is handed `'merge'` and
       * cannot act on a mode it does not implement — which is the failure
       * that would make the report's own mode column a lie.
       */
      const mode: RestoreMode =
        requested === 'replace' && section.replaceable ? 'replace' : 'merge';
      const downgraded = requested === 'replace' && mode === 'merge';
      try {
        report.push({
          name: section.name,
          restored: section.restore(value, mode),
          mode,
          note: downgraded ? 'merged — this section cannot be replaced' : undefined,
        });
      } catch (error) {
        // One bad section must not abandon the rest — a restore that stops
        // halfway leaves an installation in a state neither backup describes.
        report.push({
          name: section.name,
          restored: 0,
          note: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { ok: true, sections: report };
  }

  /** A filename that sorts by date and says what it is. */
  public static suggestedFilename(now = new Date()): string {
    const stamp = now.toISOString().slice(0, 19).replace(/[:T]/g, '-');
    return `cloudstream-backup-${stamp}.json`;
  }
}
