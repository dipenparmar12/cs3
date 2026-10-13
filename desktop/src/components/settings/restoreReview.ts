import type {
  BackupAnalysis,
  BackupGroup,
  BackupSectionAnalysis,
  ChangeCounts,
  ConflictResolution,
  RestoreMode,
  RestorePlan,
  SectionResolution,
} from '../../types/backup';

/**
 * The restore screen's arithmetic, kept out of the component so it can be
 * tested: which categories start ticked, what a mode plus a set of conflict
 * choices will do to each one, and the plan sent to the main process.
 *
 * The main process decides every row again when the restore runs, against
 * the live data, so these counts are a forecast. They are the same forecast
 * because they start from the main process's own per-mode projection; only
 * the conflicts, whose outcome is the reader's choice, are folded in here.
 */

export const GROUP_LABELS: Record<BackupGroup, string> = {
  content: 'Your content',
  sources: 'Sources and extensions',
  settings: 'Settings',
};

export const GROUP_ORDER: BackupGroup[] = ['content', 'sources', 'settings'];

export function isRestorable(section: BackupSectionAnalysis): boolean {
  return section.status === 'ok';
}

/** Restorable categories with something in them start ticked; the rest do not. */
export function defaultSelection(analysis: BackupAnalysis): Set<string> {
  return new Set(
    analysis.sections.filter((section) => isRestorable(section) && section.backupCount > 0).map((s) => s.id)
  );
}

/** What a mode will do, with smart-mode conflicts resolved as chosen. */
export function reviewCounts(
  section: BackupSectionAnalysis,
  mode: RestoreMode,
  resolution?: SectionResolution
): ChangeCounts & { conflicts: number } {
  const base = { ...section.projection[mode], conflicts: 0 };
  if (mode !== 'smart' || section.conflictTotal === 0) return base;
  const fallback = resolution?.default ?? 'local';
  const overrides = resolution?.items ?? {};
  const listed = new Set(section.conflicts.map((item) => item.key));
  let overridden = 0;
  const apply = (choice: ConflictResolution) => {
    if (choice === 'backup') base.update++;
    else if (choice === 'both' && section.canKeepBoth) base.add++;
    else base.keep++;
  };
  for (const [key, choice] of Object.entries(overrides)) {
    if (!listed.has(key)) continue;
    overridden++;
    apply(choice);
  }
  for (let i = 0; i < section.conflictTotal - overridden; i++) apply(fallback);
  base.conflicts = section.conflictTotal;
  return base;
}

/** One line in plain words. Zeroes are left out; an all-zero line says so. */
export function describeCounts(counts: ChangeCounts): string {
  const parts: string[] = [];
  if (counts.add) parts.push(`${counts.add} added`);
  if (counts.update) parts.push(`${counts.update} updated`);
  if (counts.remove) parts.push(`${counts.remove} removed`);
  if (counts.keep) parts.push(`${counts.keep} kept as they are here`);
  if (counts.same) parts.push(`${counts.same} already the same`);
  if (counts.invalid) parts.push(`${counts.invalid} unreadable`);
  return parts.length ? parts.join(' · ') : 'Nothing to change';
}

/** How the backup compares with this computer, before any mode is applied. */
export function describeComparison(section: BackupSectionAnalysis): string {
  const { counts } = section;
  const parts: string[] = [];
  if (counts.new) parts.push(`${counts.new} new`);
  const here = counts.same + counts.backupNewer + counts.localNewer + counts.conflict;
  if (here) parts.push(`${here} already here`);
  if (counts.backupNewer) parts.push(`${counts.backupNewer} newer in the backup`);
  if (counts.conflict) parts.push(`${counts.conflict} to decide`);
  if (counts.invalid) parts.push(`${counts.invalid} unreadable`);
  return parts.length ? parts.join(' · ') : 'Empty';
}

export function changesSomething(counts: ChangeCounts): boolean {
  return counts.add + counts.update + counts.remove > 0;
}

export function buildPlan(
  mode: RestoreMode,
  selected: Iterable<string>,
  resolutions: Record<string, SectionResolution>
): RestorePlan {
  const sections = [...selected];
  if (mode !== 'smart') return { mode, sections };
  const chosen: Record<string, SectionResolution> = {};
  for (const id of sections) if (resolutions[id]) chosen[id] = resolutions[id];
  return { mode, sections, resolutions: chosen };
}

export function itemNoun(count: number): string {
  return count === 1 ? 'item' : 'items';
}
