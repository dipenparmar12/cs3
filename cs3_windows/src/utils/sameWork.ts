/**
 * Which search rows are the same work as a title that would not open.
 *
 * Used to recover a detail page automatically: every row returned here is
 * tried in turn, so a loose rule opens a *different* film under the viewer's
 * click — worse than the failure it replaces. Title must match exactly once
 * punctuation, case and accents are folded away; a year, where both sides know
 * one, may differ by at most one (release vs. premiere dates disagree).
 */
export interface WorkCandidate {
  name: string;
  url: string;
  apiName: string;
  year?: number;
}

export const RECOVERY_SEARCH_MS = 25_000;
const MAX_CANDIDATES = 4;

function fold(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

export function sameWorkMatches<T extends WorkCandidate>(
  results: readonly T[],
  title: string,
  year?: number
): T[] {
  const wanted = fold(title);
  if (!wanted) return [];
  const matches = results.filter((row) => {
    if (!row.url || fold(row.name ?? '') !== wanted) return false;
    if (year && row.year && Math.abs(row.year - year) > 1) return false;
    return true;
  });
  // An exact year beats an unknown one, which beats an off-by-one.
  const rank = (row: T) => (!year || !row.year ? 1 : row.year === year ? 0 : 2);
  return matches
    .map((row, order) => ({ row, order }))
    .sort((a, b) => rank(a.row) - rank(b.row) || a.order - b.order)
    .slice(0, MAX_CANDIDATES)
    .map(({ row }) => row);
}
