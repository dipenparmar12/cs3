import type { ProviderCatalog, ProviderCatalogPage, SearchResponse } from '../types/api';

/**
 * The rows of a streaming-service page, and what each provider answer does to
 * them. Pure, so the cases that are easy to get silently wrong — a row that
 * expands into eighteen, a background refresh that fails, a page appended
 * twice — are tested without a renderer.
 *
 * The case this exists for, measured on NetMirror, CNC Verse and OttSource: a
 * provider declares **one unnamed row** (upstream's default `mainPage`) and
 * answers it with its **whole home page** — 18 named lists, 340 titles. Android
 * draws each list as its own row. Flattening them under one heading with no
 * name is what made those pages look empty.
 */

export interface CatalogueRow {
  /** Stable across refreshes: `provider::section` plus `>>list` for a split row. */
  key: string;
  provider: string;
  /** Heading shown on the page. */
  name: string;
  /** What to ask the provider for. Shared by every row split out of one answer. */
  request: { name: string; data: string; horizontalImages?: boolean };
  /** For a row split out of a multi-list answer: which list it is. */
  list?: string;
  /** For a split row: the key of the row it came from, so siblings refresh together. */
  parent?: string;
  fetched: boolean;
  loading: boolean;
  items: SearchResponse[];
  page: number;
  hasNext: boolean;
  error?: string;
  /** When the items on screen were fetched; drives the background refresh. */
  fetchedAt?: number;
}

/** A section heading for a row whose provider gave it no name. */
const UNNAMED = 'Featured';

export function rowsFromCatalog(catalog: ProviderCatalog): CatalogueRow[] {
  return catalog.sections.map((section) => ({
    key: `${catalog.provider}::${section.name}::${section.data}`,
    provider: catalog.provider,
    name: section.name || UNNAMED,
    request: { name: section.name, data: section.data, horizontalImages: section.horizontalImages },
    fetched: false,
    loading: false,
    items: [],
    page: 1,
    hasNext: false,
  }));
}

/** Appends without repeating a title already in the row (pages overlap on some sites). */
function appendUnique(existing: SearchResponse[], incoming: SearchResponse[]): SearchResponse[] {
  const seen = new Set(existing.map((item) => item.url));
  return [...existing, ...incoming.filter((item) => !seen.has(item.url))];
}

/** Gives repeated list names distinct keys without changing what is shown. */
function uniqueListKeys(names: string[]): string[] {
  const counts = new Map<string, number>();
  return names.map((name) => {
    const n = (counts.get(name) ?? 0) + 1;
    counts.set(name, n);
    return n === 1 ? name : `${name}#${n}`;
  });
}

export interface ApplyOptions {
  /**
   * A background refresh: a failure keeps what is on screen silently, and an
   * empty answer never replaces items that were there.
   */
  quiet?: boolean;
}

/**
 * Folds one provider answer for row `key` (page `page`) into the rows.
 * `answer` is the page, or an error string when the request itself failed.
 */
export function applyPage(
  rows: CatalogueRow[],
  key: string,
  page: number,
  answer: ProviderCatalogPage | { error: string },
  options: ApplyOptions = {}
): CatalogueRow[] {
  const row = rows.find((candidate) => candidate.key === key);
  if (!row) return rows;

  const failure = answer.error;
  if (failure || !('items' in answer)) {
    return rows.map((candidate) =>
      sameRequest(candidate, row)
        ? {
            ...candidate,
            loading: false,
            // A refresh that fails, or a row that already shows something,
            // keeps what it has; only an empty row says it failed.
            error: options.quiet || candidate.items.length > 0 ? candidate.error : failure ?? 'Failed',
          }
        : candidate
    );
  }

  const fetchedAt = answer.fetchedAt ?? Date.now();
  const lists = answer.lists ?? [{ name: row.request.name, horizontalImages: false, items: answer.items }];

  // A split row, or the row being split for the first time.
  const isSplit = row.list !== undefined;
  const shouldSplit = !isSplit && page === 1 && (lists.length > 1 || (lists.length === 1 && !row.request.name));

  if (isSplit || shouldSplit) {
    const parentKey = row.parent ?? row.key;
    const keys = uniqueListKeys(lists.map((list) => list.name));
    const byKey = new Map(lists.map((list, index) => [keys[index], list]));

    if (shouldSplit) {
      const children: CatalogueRow[] = lists
        .map((list, index) => ({ list, listKey: keys[index] }))
        .filter(({ list }) => list.items.length > 0)
        .map(({ list, listKey }) => ({
          key: `${parentKey}>>${listKey}`,
          provider: row.provider,
          name: list.name || row.name || UNNAMED,
          request: row.request,
          list: listKey,
          parent: parentKey,
          fetched: true,
          loading: false,
          items: list.items,
          page: 1,
          hasNext: answer.hasNext,
          fetchedAt,
        }));
      // Nothing in any list: the row stays, honestly empty.
      if (children.length === 0) {
        return rows.map((candidate) =>
          candidate.key === key
            ? options.quiet && candidate.items.length > 0
              ? { ...candidate, loading: false }
              : { ...candidate, loading: false, fetched: true, items: [], hasNext: false, fetchedAt }
            : candidate
        );
      }
      return rows.flatMap((candidate) => (candidate.key === key ? children : [candidate]));
    }

    // Page 1 refreshes every sibling from the one answer; page > 1 extends this row.
    return rows.map((candidate) => {
      if (candidate.parent !== parentKey || candidate.list === undefined) return candidate;
      if (page > 1 && candidate.key !== key) return candidate;
      const list = byKey.get(candidate.list);
      if (!list) return candidate.key === key ? { ...candidate, loading: false, hasNext: false } : candidate;
      if (page === 1 && options.quiet && list.items.length === 0) return { ...candidate, loading: false };
      return {
        ...candidate,
        loading: false,
        error: undefined,
        page,
        hasNext: answer.hasNext,
        items: page > 1 ? appendUnique(candidate.items, list.items) : list.items,
        fetchedAt,
      };
    });
  }

  return rows.map((candidate) => {
    if (candidate.key !== key) return candidate;
    if (options.quiet && answer.items.length === 0 && candidate.items.length > 0) {
      return { ...candidate, loading: false };
    }
    return {
      ...candidate,
      name: !candidate.request.name && lists[0]?.name ? lists[0].name : candidate.name,
      loading: false,
      fetched: true,
      error: undefined,
      page,
      hasNext: answer.hasNext,
      items: page > 1 ? appendUnique(candidate.items, answer.items) : answer.items,
      fetchedAt,
    };
  });
}

function sameRequest(a: CatalogueRow, b: CatalogueRow): boolean {
  if (a.key === b.key) return true;
  return Boolean(b.parent) && a.parent === b.parent;
}

/** The items of one list in a page answer — for paging a split row in a grid. */
export function itemsForRow(row: Pick<CatalogueRow, 'list'>, answer: ProviderCatalogPage): SearchResponse[] {
  if (row.list === undefined) return answer.items;
  const keys = uniqueListKeys((answer.lists ?? []).map((list) => list.name));
  const index = keys.indexOf(row.list);
  return index >= 0 ? answer.lists[index].items : [];
}
