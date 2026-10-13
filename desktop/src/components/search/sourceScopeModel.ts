/**
 * The vocabulary the source-scope dialog renders, kept out of the component.
 *
 * Two reasons, and the second is the one that matters. Exporting a function
 * beside a component breaks fast refresh for the whole file; and a `.tsx`
 * cannot be loaded by the test runner at all, which for `stateOf` — the
 * function that decides whether a repository row reads as ticked, part-ticked
 * or clear, across every level of the tree — is the difference between a rule
 * that is pinned down and one that is merely believed.
 */

export type CheckState = 'on' | 'off' | 'mixed';

/**
 * One rendered line.
 *
 * The tree is flattened to a uniform row list so the menu can render a window
 * of it. Check state is derived at paint time from `members` rather than stored
 * here, which keeps ticking a box from rebuilding the list.
 */
export interface Row {
  key: string;
  kind: 'repo' | 'ext' | 'leaf' | 'note';
  depth: 0 | 1 | 2;
  label: string;
  /** Provider names or indexer ids this row toggles; a leaf toggles one. */
  members: string[];
  expanded?: boolean;
  lang?: string;
  title?: string;
  isIndexer: boolean;
  icon?: 'package' | 'radio';
}

/** The facet values that exist, counted from what is installed. */
export interface Facets {
  types: string[];
  languages: string[];
}

export interface FacetSelection {
  types: Set<string>;
  languages: Set<string>;
  /** Hide extensions, or hide torrent indexers. Never both. */
  kinds: Set<'extension' | 'indexer'>;
}

/** One thing the user has actually scoped to, for the chip strip. */
export interface ChosenSource {
  id: string;
  label: string;
  isIndexer: boolean;
}

export function stateOf(members: string[], selected: Set<string>): CheckState {
  if (members.length === 0) return 'off';
  const unique = new Set(members);
  let on = 0;
  for (const member of unique) {
    if (selected.has(member)) on += 1;
  }
  if (on === 0) return 'off';
  return on === unique.size ? 'on' : 'mixed';
}

/** Upstream's `TvType` names are PascalCase; the menu is not. */
export function prettyType(value: string): string {
  return value.replace(/([a-z])([A-Z])/g, '$1 $2');
}

export interface FilteredMembers {
  providers: string[];
  indexers: string[];
}

/**
 * Collects distinct selectable provider names and indexer ids from the active rows.
 *
 * Scans leaf rows so bulk actions (select/deselect all filtered) strictly target
 * what matches active search queries, language filters, and content types.
 */
export function getFilteredMembers(rows: Row[]): FilteredMembers {
  const providers = new Set<string>();
  const indexers = new Set<string>();
  for (const row of rows) {
    if (row.kind === 'leaf') {
      for (const member of row.members) {
        if (row.isIndexer) indexers.add(member);
        else providers.add(member);
      }
    }
  }
  return {
    providers: [...providers],
    indexers: [...indexers],
  };
}

/**
 * Checks whether all currently filtered members are in the selection.
 */
export function areAllFilteredSelected(
  filtered: FilteredMembers,
  providers: Set<string>,
  indexers: Set<string>
): boolean {
  if (filtered.providers.length === 0 && filtered.indexers.length === 0) return false;
  for (const p of filtered.providers) {
    if (!providers.has(p)) return false;
  }
  for (const i of filtered.indexers) {
    if (!indexers.has(i)) return false;
  }
  return true;
}

/**
 * Bulk includes all members of a section row into the respective selection set.
 */
export function includeSection(
  row: Row,
  currentProviders: Set<string>,
  currentIndexers: Set<string>
): { providers: Set<string>; indexers: Set<string> } {
  const nextProviders = new Set(currentProviders);
  const nextIndexers = new Set(currentIndexers);
  for (const member of row.members) {
    if (row.isIndexer) nextIndexers.add(member);
    else nextProviders.add(member);
  }
  return { providers: nextProviders, indexers: nextIndexers };
}

/**
 * Bulk excludes all members of a section row from the respective selection set.
 */
export function excludeSection(
  row: Row,
  currentProviders: Set<string>,
  currentIndexers: Set<string>
): { providers: Set<string>; indexers: Set<string> } {
  const nextProviders = new Set(currentProviders);
  const nextIndexers = new Set(currentIndexers);
  for (const member of row.members) {
    if (row.isIndexer) nextIndexers.delete(member);
    else nextProviders.delete(member);
  }
  return { providers: nextProviders, indexers: nextIndexers };
}

