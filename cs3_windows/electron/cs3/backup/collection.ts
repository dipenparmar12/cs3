import type {
  ChangeCounts,
  ConflictResolution,
  RestoreFailure,
  RestoreMode,
  RowStatus,
} from '../../../src/types/backup.ts';

/**
 * One keyed collection inside a backup section, and everything a restore needs
 * to know about it.
 *
 * Every store in the app is, for backup purposes, the same shape: rows with an
 * identity. So the comparison, the three restore modes, conflict detection and
 * "keep both" are written once here, and a store joins the backup by
 * describing its rows rather than by writing its own merge — which is how
 * eleven hand-written restores came to disagree about what "merge" meant.
 *
 * Pure apart from what the adapter does in `local` and `commit`.
 */
export interface BackupPart<T = any> {
  id: string;
  /** Plural noun for what the rows are: "titles", "settings". */
  label: string;
  /** This installation's rows. Also what an export writes. */
  local(): T[];
  /** Stable identity, or null for a row that cannot be addressed. */
  identify(row: T): string | null;
  /** A name a person would recognise, for conflict lists. */
  describe(row: T): string;
  /** When the row last changed; lets "newer wins" decide without asking. */
  updatedAt?(row: T): number | undefined;
  /** Whether two copies are the same. Defaults to a key-order-blind comparison. */
  same?(backup: T, local: T): boolean;
  /** A few words describing one side of a conflict. */
  preview?(row: T): string;
  /** Shape check for a row read from a file. Defaults to "has an identity". */
  valid?(row: unknown): boolean;
  /**
   * Whether Replace may remove rows the backup lacks.
   *
   * Absent means yes. A part where removal costs something a restore cannot
   * give back — an uninstalled repository, a download record pointing at a
   * file — says no, and Replace keeps those rows and reports them as kept.
   */
  removable?: boolean;
  /** Merge's answer to a differing row with no timestamps. Defaults to the backup. */
  mergePrefers?: 'backup' | 'local';
  /**
   * Folds the local copy into the backup's when the backup wins, so fields
   * only this installation knows survive (a library entry's extra addresses).
   */
  combine?(backup: T, local: T): T;
  /** A copy of the row under a fresh identity, for "keep both". */
  duplicate?(row: T, taken: Set<string>): T | null;
  /**
   * Bookkeeping a person would not recognise as an item (which extension
   * registered a provider name). Restored like any other part, but left out
   * of every count shown, so "Extensions: 24" does not read as 154.
   */
  quiet?: boolean;
  /**
   * Persists the change. `next` is the whole intended collection; `put` and
   * `remove` are the delta, for stores where writing everything is not how a
   * change is made (a repository is added, not overwritten).
   */
  commit(change: PartChange<T>): void | CommitResult | Promise<void | CommitResult>;
}

export interface PartChange<T> {
  next: T[];
  put: T[];
  remove: string[];
}

export interface CommitResult {
  /** Rows the store refused, each with why. They are not counted as restored. */
  failed?: RestoreFailure[];
  notes?: string[];
  /** Planned updates the store found it did not need to make. */
  unchanged?: number;
}

export interface DiffRow<T> {
  key: string;
  status: RowStatus;
  backup?: T;
  local?: T;
}

export interface PartDiff<T> {
  rows: DiffRow<T>[];
  invalid: number;
  backupCount: number;
  localCount: number;
}

export type RowAction = 'add' | 'update' | 'remove' | 'keep' | 'same' | 'skip' | 'duplicate' | 'untouched';

export function emptyStatusCounts(): Record<RowStatus, number> {
  return { same: 0, new: 0, localOnly: 0, backupNewer: 0, localNewer: 0, conflict: 0, invalid: 0 };
}

export function emptyChangeCounts(): ChangeCounts {
  return { add: 0, update: 0, remove: 0, keep: 0, same: 0, invalid: 0 };
}

/** JSON with sorted keys, so two copies of one object compare equal. */
export function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return v;
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) sorted[k] = (v as Record<string, unknown>)[k];
    return sorted;
  });
}

function stamp<T>(part: BackupPart<T>, row: T): number | undefined {
  const value = part.updatedAt?.(row);
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Compares the backup's rows with this installation's, row by row. */
export function diffPart<T>(part: BackupPart<T>, backupRows: unknown[]): PartDiff<T> {
  const local = part.local();
  const localByKey = new Map<string, T>();
  for (const row of local) {
    const key = part.identify(row);
    if (key !== null && !localByKey.has(key)) localByKey.set(key, row);
  }

  const rows: DiffRow<T>[] = [];
  const seen = new Set<string>();
  let invalid = 0;
  for (const raw of backupRows) {
    const valid = part.valid ? part.valid(raw) : raw !== null && raw !== undefined;
    const key = valid ? part.identify(raw as T) : null;
    if (key === null) {
      invalid++;
      continue;
    }
    // A file holding one identity twice is read as holding it once; the first
    // copy is the one its writer listed first, which is the newest for every
    // store that orders by recency.
    if (seen.has(key)) continue;
    seen.add(key);
    const backup = raw as T;
    const current = localByKey.get(key);
    if (current === undefined) {
      rows.push({ key, status: 'new', backup });
      continue;
    }
    const same = part.same ? part.same(backup, current) : canonical(backup) === canonical(current);
    if (same) {
      rows.push({ key, status: 'same', backup, local: current });
      continue;
    }
    const tb = stamp(part, backup);
    const tl = stamp(part, current);
    const status: RowStatus =
      tb !== undefined && tl !== undefined && tb !== tl
        ? tb > tl
          ? 'backupNewer'
          : 'localNewer'
        : 'conflict';
    rows.push({ key, status, backup, local: current });
  }
  for (const [key, row] of localByKey) {
    if (!seen.has(key)) rows.push({ key, status: 'localOnly', local: row });
  }
  return { rows, invalid, backupCount: backupRows.length, localCount: localByKey.size };
}

/**
 * What one row's comparison means under one mode.
 *
 * The three modes differ in exactly two places, and keeping them in one
 * function is what stops them drifting:
 *
 * - **Smart** and **Merge** only differ on a genuine conflict — Smart asks,
 *   Merge takes the backup (or keeps the local row, where the part says the
 *   local copy is the one that matters, such as credentials).
 * - **Replace** additionally removes what the backup does not have.
 *
 * A newer local row is kept by Smart and Merge alike: overwriting it with an
 * older copy is the "unnecessary" loss Merge promises not to cause.
 */
export function decideRow(
  status: RowStatus,
  mode: RestoreMode,
  part: Pick<BackupPart, 'removable' | 'mergePrefers' | 'duplicate'>,
  resolution?: ConflictResolution
): RowAction {
  switch (status) {
    case 'new':
      return 'add';
    case 'same':
      return 'same';
    case 'invalid':
      return 'skip';
    case 'localOnly':
      return mode === 'replace' && part.removable !== false ? 'remove' : 'untouched';
    case 'backupNewer':
      return 'update';
    case 'localNewer':
      return mode === 'replace' ? 'update' : 'keep';
    case 'conflict':
      if (mode === 'replace') return 'update';
      if (mode === 'merge') return part.mergePrefers === 'local' ? 'keep' : 'update';
      switch (resolution ?? 'local') {
        case 'backup':
          return 'update';
        case 'skip':
          return 'skip';
        case 'both':
          return part.duplicate ? 'duplicate' : 'keep';
        default:
          return 'keep';
      }
  }
}

/**
 * Counts what a mode would do, for the review screen. In smart mode
 * conflicts are left out, because their outcome is still the reader's to pick.
 */
export function projectPart<T>(
  part: BackupPart<T>,
  diff: PartDiff<T>,
  mode: RestoreMode
): ChangeCounts {
  const counts = emptyChangeCounts();
  counts.invalid = diff.invalid;
  for (const row of diff.rows) {
    if (mode === 'smart' && row.status === 'conflict') continue;
    const action = decideRow(row.status, mode, part);
    if (action === 'add' || action === 'duplicate') counts.add++;
    else if (action === 'update') counts.update++;
    else if (action === 'remove') counts.remove++;
    else if (action === 'keep' || action === 'skip') counts.keep++;
    else if (action === 'same') counts.same++;
    // `untouched` is a local row nothing asked about and stays out of every
    // count — the "nothing else was changed" in the summary. Under Replace it
    // can only mean a row the part refuses to remove, which *is* worth saying.
    else if (action === 'untouched' && mode === 'replace') counts.keep++;
  }
  return counts;
}

export interface PartPlan<T> {
  change: PartChange<T>;
  added: number;
  updated: number;
  removed: number;
  unchanged: number;
  kept: number;
  skipped: number;
  /** Local rows Replace wanted to remove and the part does not allow. */
  retained: number;
}

/** Turns a comparison into the collection the store should end up holding. */
export function planPart<T>(
  part: BackupPart<T>,
  diff: PartDiff<T>,
  mode: RestoreMode,
  resolutionFor: (key: string) => ConflictResolution | undefined
): PartPlan<T> {
  const plan: PartPlan<T> = {
    change: { next: [], put: [], remove: [] },
    added: 0,
    updated: 0,
    removed: 0,
    unchanged: 0,
    kept: 0,
    skipped: 0,
    retained: 0,
  };

  // The local order is kept and new rows follow it, so a store that does not
  // sort for itself does not see its list shuffled by a restore.
  const next = new Map<string, T>();
  const taken = new Set<string>();
  for (const row of part.local()) {
    const key = part.identify(row);
    if (key === null || next.has(key)) continue;
    next.set(key, row);
    taken.add(key);
  }
  for (const row of diff.rows) if (row.backup !== undefined) taken.add(row.key);

  const appended: Array<[string, T]> = [];
  for (const row of diff.rows) {
    const action = decideRow(row.status, mode, part, resolutionFor(row.key));
    switch (action) {
      case 'add':
        appended.push([row.key, row.backup as T]);
        plan.change.put.push(row.backup as T);
        plan.added++;
        break;
      case 'update': {
        const merged =
          part.combine && row.local !== undefined
            ? part.combine(row.backup as T, row.local)
            : (row.backup as T);
        next.set(row.key, merged);
        plan.change.put.push(merged);
        plan.updated++;
        break;
      }
      case 'duplicate': {
        const copy = part.duplicate?.(row.backup as T, taken) ?? null;
        const key = copy === null ? null : part.identify(copy);
        if (copy === null || key === null || taken.has(key)) {
          plan.kept++;
          break;
        }
        taken.add(key);
        appended.push([key, copy]);
        plan.change.put.push(copy);
        plan.added++;
        break;
      }
      case 'remove':
        next.delete(row.key);
        plan.change.remove.push(row.key);
        plan.removed++;
        break;
      case 'keep':
        plan.kept++;
        break;
      case 'skip':
        plan.skipped++;
        break;
      case 'same':
        plan.unchanged++;
        break;
      case 'untouched':
        if (mode === 'replace' && part.removable === false) plan.retained++;
        break;
    }
  }
  for (const [key, row] of appended) next.set(key, row);
  plan.change.next = [...next.values()];
  return plan;
}
