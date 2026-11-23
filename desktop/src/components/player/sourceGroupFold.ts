/**
 * Which source groups start folded, without undoing the viewer's own choices.
 *
 * Sources stream in, so the group list changes many times while the panel is
 * open. Re-deriving the whole fold state on each change reopened groups the
 * viewer had collapsed (and folded ones they had opened, Expand all included).
 * Only a group seen for the first time gets a default: open for a short list
 * (≤ 30 rows), else open only for the best group and the one playing.
 */
export function foldNewGroups(
  collapsed: ReadonlySet<string>,
  seen: ReadonlySet<string>,
  origins: readonly string[],
  totalRows: number,
  playingOrigin: string | undefined,
): Set<string> {
  const next = new Set(collapsed);
  origins.forEach((origin, index) => {
    if (seen.has(origin)) return;
    if (totalRows > 30 && index > 0 && origin !== playingOrigin) next.add(origin);
  });
  return next;
}
