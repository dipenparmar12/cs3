/**
 * The order of the search box's dropdown: recent searches, people and
 * companies, and titles. One function, read by the navbar's keyboard handling
 * and by the dropdown that draws the rows, so an arrow key always lands on
 * the row it highlights. Pure.
 */
export type SuggestionRowKind = 'history' | 'entity' | 'suggestion';

export interface SuggestionRow {
  kind: SuggestionRowKind;
  /** Index within its own list. */
  index: number;
}

/** Case, accents and punctuation folded: how a typed name is compared with a catalogue's. */
export function foldName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    // "Surf’s Up" is "Surfs Up", not "Surf s Up".
    .replace(/['’]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * The order of the three blocks. History leads only while the box is empty.
 *
 * While typing, people and studios always sit above titles, at most three
 * rows. They used to go first only when the query was exactly a name, but
 * that was decided again on every answer, so a person landing a moment after
 * the titles moved the list under the pointer (measured 2026-10-30: "Tom
 * Hanks" settled through four layouts). A fixed slot moves things at most
 * once.
 */
export function blockOrder(historyFirst: boolean): SuggestionRowKind[] {
  return historyFirst ? ['history', 'entity', 'suggestion'] : ['entity', 'suggestion', 'history'];
}

export function suggestionRows(
  order: readonly SuggestionRowKind[],
  counts: Record<SuggestionRowKind, number>
): SuggestionRow[] {
  return order.flatMap((kind) => Array.from({ length: counts[kind] }, (_, index) => ({ kind, index })));
}

/** Where a row of `kind` number `index` sits in the whole list; -1 when that kind is not shown. */
export function rowPosition(rows: readonly SuggestionRow[], kind: SuggestionRowKind, index: number): number {
  const start = rows.findIndex((row) => row.kind === kind);
  return start < 0 ? -1 : start + index;
}
