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
  let on = 0;
  for (const member of members) if (selected.has(member)) on += 1;
  if (on === 0) return 'off';
  return on === members.length ? 'on' : 'mixed';
}

/** Upstream's `TvType` names are PascalCase; the menu is not. */
export function prettyType(value: string): string {
  return value.replace(/([a-z])([A-Z])/g, '$1 $2');
}

