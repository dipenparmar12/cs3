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

import type { ProviderTreeProvider, ProviderTreeRepository } from '../../types/plugin';

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
  /** Selectable providers per value, for the number on each chip. */
  typeCounts?: Record<string, number>;
  languageCounts?: Record<string, number>;
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

export interface SelectionImpact {
  addedProviders: string[];
  removedProviders: string[];
  addedIndexers: string[];
  removedIndexers: string[];
  unchangedProviders: number;
  unchangedIndexers: number;
  totalAdded: number;
  totalRemoved: number;
  totalUnchanged: number;
  newTotal: number;
  isConsequential: boolean;
}

/**
 * Calculates the exact delta between the current selection and a proposed target selection.
 * Categorizes changes between extension providers and torrent indexers.
 */
export function calculateSelectionImpact(
  current: { providers: Set<string>; indexers: Set<string> },
  target: { providers: Set<string>; indexers: Set<string> },
  threshold = { remove: 3, add: 10 }
): SelectionImpact {
  const addedProviders: string[] = [];
  const removedProviders: string[] = [];
  let unchangedProviders = 0;

  for (const p of target.providers) {
    if (!current.providers.has(p)) addedProviders.push(p);
    else unchangedProviders += 1;
  }
  for (const p of current.providers) {
    if (!target.providers.has(p)) removedProviders.push(p);
  }

  const addedIndexers: string[] = [];
  const removedIndexers: string[] = [];
  let unchangedIndexers = 0;

  for (const i of target.indexers) {
    if (!current.indexers.has(i)) addedIndexers.push(i);
    else unchangedIndexers += 1;
  }
  for (const i of current.indexers) {
    if (!target.indexers.has(i)) removedIndexers.push(i);
  }

  const totalAdded = addedProviders.length + addedIndexers.length;
  const totalRemoved = removedProviders.length + removedIndexers.length;
  const totalUnchanged = unchangedProviders + unchangedIndexers;
  const newTotal = target.providers.size + target.indexers.size;
  const isConsequential = totalRemoved >= threshold.remove || totalAdded >= threshold.add;

  return {
    addedProviders,
    removedProviders,
    addedIndexers,
    removedIndexers,
    unchangedProviders,
    unchangedIndexers,
    totalAdded,
    totalRemoved,
    totalUnchanged,
    newTotal,
    isConsequential,
  };
}


// --- quick setup: what the viewer asked for ---------------------------------

/**
 * The chips the viewer ticked in quick setup: "Hindi", "Movies".
 *
 * Stored with the profile or draft (`languages`, `contentTypes`) and read back
 * from there, never worked out from the providers it selected. Worked out, it
 * was wrong every time: a provider that carries Movies carries Series too, and
 * the Movies providers between them speak every language, so ticking Movies
 * lit up Series and every language chip, and the NSFW preset lit up a dozen
 * languages (the 2026-10-21 report).
 */
export interface ScopeIntent {
  languages: Set<string>;
  types: Set<string>;
}

export const EMPTY_INTENT: ScopeIntent = { languages: new Set(), types: new Set() };

export function isIntentEmpty(intent: ScopeIntent): boolean {
  return intent.languages.size === 0 && intent.types.size === 0;
}

export function sameIntent(a: ScopeIntent, b: ScopeIntent): boolean {
  const same = (x: Set<string>, y: Set<string>) =>
    x.size === y.size && [...x].every((value) => y.has(value));
  return same(a.languages, b.languages) && same(a.types, b.types);
}

/** One chip pressed: that value in or out, and nothing else. */
export function toggleIntent(
  intent: ScopeIntent,
  group: 'languages' | 'types',
  value: string
): ScopeIntent {
  const next = new Set(intent[group]);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return { ...intent, [group]: next };
}

/**
 * The providers quick setup searches for these chips.
 *
 * Any ticked language, and any ticked content type: OR inside a section, AND
 * across them, so "Hindi + Tamil" is both and "Hindi + Movies" is Hindi
 * providers that carry movies. No chips is no narrowing, which the scope
 * means by an empty selection.
 */
export function providersForIntent(
  repositories: ProviderTreeRepository[],
  intent: ScopeIntent,
  isSelectable: (provider: ProviderTreeProvider) => boolean
): Set<string> {
  const matched = new Set<string>();
  if (isIntentEmpty(intent)) return matched;
  for (const repo of repositories) {
    for (const ext of repo.extensions) {
      for (const provider of ext.providers) {
        if (!isSelectable(provider)) continue;
        const lang = provider.lang ?? ext.language;
        const languageOk =
          intent.languages.size === 0 || (lang !== undefined && intent.languages.has(lang));
        const typeOk =
          intent.types.size === 0 ||
          (provider.supportedTypes ?? []).some((type) => intent.types.has(type));
        if (languageOk && typeOk) matched.add(provider.name);
      }
    }
  }
  return matched;
}

/**
 * The stored chips of whatever is driving the search: a profile, the draft,
 * or nothing for All sources.
 */
export function intentFromSnapshot(snapshot: {
  activeId?: string;
  profiles?: Array<{ id: string; languages?: string[]; contentTypes?: string[] }>;
  draft?: { languages?: string[]; contentTypes?: string[] };
}): ScopeIntent {
  // The draft's id is '' and falsy, so "no answer" is spelled out.
  if (snapshot.activeId === undefined || snapshot.activeId === 'all') return EMPTY_INTENT;
  const source =
    snapshot.activeId === ''
      ? snapshot.draft
      : snapshot.profiles?.find((profile) => profile.id === snapshot.activeId) ?? snapshot.draft;
  return {
    languages: new Set(source?.languages ?? []),
    types: new Set(source?.contentTypes ?? []),
  };
}

/** The ready-made setups quick setup offers beside the chips. */
export type BuiltInPreset = 'english' | 'hindi' | 'anime' | 'drama' | 'nsfw';

const PRESET_TYPES: Partial<Record<BuiltInPreset, string[]>> = {
  anime: ['Anime', 'AnimeMovie', 'OVA'],
  drama: ['AsianDrama'],
  nsfw: ['NSFW'],
};

/**
 * A preset is a set of chips, not a rule of its own.
 *
 * It used to match provider *names* as well ("anime" anywhere in the name), so
 * picking it selected providers no chip could explain. Built from the values
 * that exist here, so "English" covers `en` and `en-US` alike.
 */
export function presetIntent(preset: BuiltInPreset, available: Facets): ScopeIntent {
  if (preset === 'english' || preset === 'hindi') {
    const prefix = preset === 'english' ? 'en' : 'hi';
    return {
      languages: new Set(available.languages.filter((lang) => lang.toLowerCase().startsWith(prefix))),
      types: new Set(),
    };
  }
  const wanted = new Set(PRESET_TYPES[preset] ?? []);
  return { languages: new Set(), types: new Set(available.types.filter((type) => wanted.has(type))) };
}

/**
 * Which preset, if any, the unnamed selection *is*.
 *
 * Derived, not remembered: the picker used to mark a preset active on click,
 * and the reply from the save that followed marked the draft active instead,
 * so the pill went dark the moment it was pressed.
 */
export function matchingPreset(
  intent: ScopeIntent,
  presets: BuiltInPreset[],
  available: Facets
): BuiltInPreset | undefined {
  if (isIntentEmpty(intent)) return undefined;
  return presets.find((preset) => sameIntent(intent, presetIntent(preset, available)));
}
