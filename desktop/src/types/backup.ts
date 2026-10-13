/**
 * The backup and restore contract, shared by the main process and the
 * renderer. See `electron/cs3/backupService.ts` for the design.
 */

/**
 * How a restore treats what is already here.
 *
 * - `smart` decides each row from what both sides know: new rows are added,
 *   the newer of two copies wins, identical rows are left alone, and only rows
 *   that differ with nothing to say which is newer are asked about.
 * - `merge` adds and updates from the backup and never removes anything.
 * - `replace` makes each chosen category match the backup exactly.
 */
export type RestoreMode = 'smart' | 'merge' | 'replace';

/** What to do with one row that differs and cannot be decided automatically. */
export type ConflictResolution = 'backup' | 'local' | 'both' | 'skip';

/** Where a row stands when the backup is compared with this installation. */
export type RowStatus =
  /** Present in both and the same. */
  | 'same'
  /** Only in the backup. */
  | 'new'
  /** Only here. */
  | 'localOnly'
  /** In both, different, and the backup's copy changed later. */
  | 'backupNewer'
  /** In both, different, and this installation's copy changed later. */
  | 'localNewer'
  /** In both, different, and nothing says which is newer. */
  | 'conflict'
  /** In the backup but unreadable by this version of the app. */
  | 'invalid';

export type BackupGroup = 'content' | 'sources' | 'settings';

/** What a restore would do to one category, before it is run. */
export interface ChangeCounts {
  add: number;
  update: number;
  remove: number;
  /** Differs, and this installation's copy is kept. */
  keep: number;
  /** Already identical. */
  same: number;
  /** Rows the restore could not read. */
  invalid: number;
}

export interface ConflictItem {
  /** `<part>:<row identity>`, stable across analyse and restore. */
  key: string;
  label: string;
  /** Short descriptions of each side, for a reader choosing between them. */
  backup: string;
  current: string;
}

export interface BackupPartAnalysis {
  id: string;
  label: string;
  backupCount: number;
  localCount: number;
  counts: Record<RowStatus, number>;
  /** A few names of rows the backup would add, for the expanded view. */
  newSamples: string[];
}

export interface BackupSectionAnalysis {
  id: string;
  label: string;
  description: string;
  group: BackupGroup;
  /**
   * `ok` can be restored. `unsupported` was written by a different version
   * of the app and is skipped. `invalid` could not be read. `exportOnly` is
   * carried for reading, never written back.
   */
  status: 'ok' | 'unsupported' | 'invalid' | 'exportOnly';
  reason?: string;
  backupCount: number;
  localCount: number;
  counts: Record<RowStatus, number>;
  /**
   * What each mode would do. For `smart`, conflicts are counted separately
   * because their outcome is the reader's choice.
   */
  projection: Record<RestoreMode, ChangeCounts>;
  conflicts: ConflictItem[];
  /** All conflicts, of which `conflicts` may be a prefix. */
  conflictTotal: number;
  /** Whether "Keep both" means anything for this category. */
  canKeepBoth: boolean;
  /** Whether Replace can remove rows here, or only add and update. */
  canRemove: boolean;
  parts: BackupPartAnalysis[];
  /** Settings read at startup; the change completes after a restart. */
  restartAfterRestore: boolean;
  /** Set when the section was upgraded from an older shape on read. */
  migratedFrom?: number;
}

export interface BackupAnalysis {
  path: string;
  createdAt: number;
  appVersion: string;
  platform: string;
  formatVersion: number;
  /** Set when the file was written by a newer app; parts of it may be skipped. */
  newerFormat: boolean;
  sections: BackupSectionAnalysis[];
}

export interface SectionResolution {
  /** Applied to every conflict in the category without an override. */
  default: ConflictResolution;
  /** Per-row choices, keyed by `ConflictItem.key`. */
  items?: Record<string, ConflictResolution>;
}

export interface RestorePlan {
  mode: RestoreMode;
  /** Section ids to restore. Every other category is left untouched. */
  sections: string[];
  /** Conflict choices, used by `smart` only. */
  resolutions?: Record<string, SectionResolution>;
}

export interface RestoreFailure {
  label: string;
  reason: string;
}

export interface RestoreSectionResult {
  id: string;
  label: string;
  /** Whether the category was restored at all. */
  status: 'restored' | 'skipped' | 'failed';
  reason?: string;
  added: number;
  updated: number;
  removed: number;
  unchanged: number;
  /** Differing rows where this installation's copy was kept. */
  kept: number;
  /** Conflicts the reader chose to skip. */
  skipped: number;
  /** Rows that could not be restored, each with why. */
  failed: RestoreFailure[];
  notes: string[];
}

export interface RestoreSummary {
  ok: boolean;
  error?: string;
  mode?: RestoreMode;
  sections: RestoreSectionResult[];
  /** Some restored settings complete only after a restart. */
  restartRecommended: boolean;
  /** A copy of what was here before is available to put back. */
  undoAvailable: boolean;
}
