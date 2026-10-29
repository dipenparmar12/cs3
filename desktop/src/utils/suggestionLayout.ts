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
 * People go above titles only when the query *is* a person's or company's
 * name and no title is called exactly that. "John Cena" leads with John Cena;
 * "Inception" keeps the film on top; and an ambiguous query keeps titles
 * first, since a title search is what the box was for.
 */
export function entitiesFirst(
  query: string,
  titles: ReadonlyArray<{ title: string; originalTitle?: string }>,
  entities: ReadonlyArray<{ name: string }>
): boolean {
  const wanted = foldName(query);
  if (!wanted || !entities.some((entity) => foldName(entity.name) === wanted)) return false;
  return !titles.some((title) => foldName(title.title) === wanted || (title.originalTitle && foldName(title.originalTitle) === wanted));
}

/** The order of the three blocks. History leads only while the box is empty. */
export function blockOrder(historyFirst: boolean, peopleFirst: boolean): SuggestionRowKind[] {
  if (historyFirst) return ['history', 'entity', 'suggestion'];
  return peopleFirst ? ['entity', 'suggestion', 'history'] : ['suggestion', 'entity', 'history'];
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
