/**
 * Selection and bulk actions for the Installed tree — the rules, without React.
 *
 * Two kinds of thing can be selected, because they are the two levels the
 * actions work at: an **extension** (`ext:<internalName>`) can be enabled,
 * disabled or uninstalled; a **provider** (`prov:<name>`) can be enabled or
 * disabled, and is never uninstalled on its own — it goes with its extension.
 *
 * The rules this file pins, each tested in `bulkSelection.test.mts`:
 *
 * - **Select all means what is shown.** "Select all matching" takes what the
 *   current search and filters leave. An extension is taken whole only when
 *   every provider it has is shown; otherwise just the shown providers are, so
 *   a language filter never quietly selects the other-language providers
 *   beside them.
 * - **A hidden selection is kept, and never acted on.** Narrowing the filter
 *   does not throw selections away, and the bar says how many it is holding
 *   back — but an action only reaches what is on screen.
 * - **No double action.** A provider whose extension is also selected is acted
 *   on through the extension: disabling both would leave the provider switched
 *   off in its own right after the extension came back.
 * - **Only what would change.** Enable counts only things that are off; Disable
 *   only things that are on. "Enable 12" for twelve things already enabled is a
 *   button that lies about what it will do.
 * - **Busy is not available.** An extension with a queued or running job
 *   (install, update, uninstall) is left out of every action and listed with
 *   the reason, so Uninstall and Enable cannot race on one archive.
 *
 * Also holds the tree filter the screen renders with, so what the tree shows
 * and what "visible" means here can never be two computations that drift.
 */
import type {
  ProviderTreeExtension,
  ProviderTreeProvider,
  ProviderTreeRepository,
} from '../../types/plugin';

/** The filter facets this module reads — the shape `useExtensionFilters` keeps. */
export interface TreeFilter {
  query: string;
  tags: Set<string>;
  languages: Set<string>;
  categories: Set<string>;
  status: string;
}

/** No search, no facets: the whole tree. */
export const NO_FILTER: TreeFilter = {
  query: '',
  tags: new Set(),
  languages: new Set(),
  categories: new Set(),
  status: 'all',
};

// --- matchers (shared with the catalogue views via useExtensionFilters) -----

/**
 * Tag matching is OR within the tag set, and AND across different facets.
 *
 * Selecting Movies and Anime means "either", because they are alternatives at
 * the same level. Selecting Anime *and* German means "both", because they are
 * different questions.
 */
export function matchesTags(itemTags: string[] | undefined, selected: Set<string>): boolean {
  if (selected.size === 0) return true;
  if (!itemTags || itemTags.length === 0) return false;
  return itemTags.some((tag) => selected.has(String(tag).toUpperCase()));
}

export function matchesLanguages(language: string | undefined, selected: Set<string>): boolean {
  if (selected.size === 0) return true;
  return !!language && selected.has(language.toLowerCase());
}

export function matchesQuery(query: string, ...fields: Array<string | undefined>): boolean {
  if (!query) return true;
  return fields.some((field) => field && field.toLowerCase().includes(query));
}

export function providerMatches(provider: ProviderTreeProvider, filters: TreeFilter): boolean {
  if (!matchesTags(provider.supportedTypes, filters.tags)) return false;
  if (!matchesLanguages(provider.lang, filters.languages)) return false;
  if (filters.status === 'enabled' && provider.effectivelyEnabled === false) return false;
  if (filters.status === 'disabled' && provider.effectivelyEnabled !== false) return false;
  return matchesQuery(filters.query, provider.name, provider.extensionName);
}

// --- the visible tree --------------------------------------------------------

export interface VisibleExtension {
  extension: ProviderTreeExtension;
  /** The providers the filters leave, in tree order. */
  providers: ProviderTreeProvider[];
}

export interface VisibleRepository {
  repository: ProviderTreeRepository;
  extensions: VisibleExtension[];
}

/** What the Installed tree shows for these filters. */
export function filterTree(tree: ProviderTreeRepository[], filters: TreeFilter): VisibleRepository[] {
  return tree
    .filter((repository) => {
      if (filters.categories.size > 0) {
        if (!repository.category || !filters.categories.has(repository.category)) return false;
      }
      if (filters.languages.size > 0) {
        const repoLang = (repository.language ?? '').toLowerCase();
        const matchesRepoLang = [...filters.languages].some((l) => repoLang.includes(l.toLowerCase()));
        const hasMatchingExt = repository.extensions.some(
          (ext) =>
            matchesLanguages(ext.language, filters.languages) ||
            ext.providers.some((p) => matchesLanguages(p.lang, filters.languages))
        );
        if (!matchesRepoLang && !hasMatchingExt) return false;
      }
      return true;
    })
    .map((repository) => ({
      repository,
      extensions: repository.extensions
        .map((extension) => ({
          extension,
          providers: extension.providers.filter((provider) => providerMatches(provider, filters)),
        }))
        .filter(
          ({ extension, providers }) =>
            providers.length > 0 || matchesQuery(filters.query, extension.name, extension.internalName)
        ),
    }))
    .filter(
      ({ repository, extensions }) =>
        extensions.length > 0 || matchesQuery(filters.query, repository.name, repository.url)
    );
}

// --- selection keys ----------------------------------------------------------

export type SelectionKey = string;
export const extKey = (internalName: string): SelectionKey => `ext:${internalName}`;
export const provKey = (name: string): SelectionKey => `prov:${name}`;

/** Every key the visible tree offers for selection. */
export function visibleKeys(visible: VisibleRepository[]): Set<SelectionKey> {
  const keys = new Set<SelectionKey>();
  for (const { extensions } of visible) {
    for (const { extension, providers } of extensions) {
      keys.add(extKey(extension.internalName));
      for (const provider of providers) keys.add(provKey(provider.name));
    }
  }
  return keys;
}

/**
 * "Select all matching": whole extensions where every provider is shown, the
 * shown providers where only some are.
 */
export function selectMatching(visible: VisibleRepository[]): Set<SelectionKey> {
  const keys = new Set<SelectionKey>();
  for (const { extensions } of visible) {
    for (const { extension, providers } of extensions) {
      if (providers.length === extension.providers.length) {
        keys.add(extKey(extension.internalName));
      } else {
        for (const provider of providers) keys.add(provKey(provider.name));
      }
    }
  }
  return keys;
}

/** Every installed extension, whatever the filters say. Labelled as such on screen. */
export function selectEverything(tree: ProviderTreeRepository[]): Set<SelectionKey> {
  const keys = new Set<SelectionKey>();
  for (const repository of tree) {
    for (const extension of repository.extensions) keys.add(extKey(extension.internalName));
  }
  return keys;
}

/**
 * Inverts what is shown: shown-and-unselected becomes selected, shown-and-
 * selected is dropped. Hidden selections are left exactly as they were.
 */
export function invertSelection(
  selection: Set<SelectionKey>,
  visible: VisibleRepository[]
): Set<SelectionKey> {
  const next = new Set(selection);
  for (const { extensions } of visible) {
    for (const { extension, providers } of extensions) {
      const ext = extKey(extension.internalName);
      const whole = providers.length === extension.providers.length;
      const extOn = selection.has(ext);
      const shownOn = providers.filter((p) => selection.has(provKey(p.name)));
      if (whole) {
        // An extension counts as selected if it or all its providers are.
        const selected = extOn || (providers.length > 0 && shownOn.length === providers.length);
        next.delete(ext);
        for (const provider of providers) next.delete(provKey(provider.name));
        if (!selected) next.add(ext);
      } else {
        for (const provider of providers) {
          const key = provKey(provider.name);
          if (selection.has(key) || extOn) next.delete(key);
          else next.add(key);
        }
        if (extOn) next.delete(ext);
      }
    }
  }
  return next;
}

/** The selection split into what is on screen and what the filters hide. */
export function splitSelection(
  selection: Set<SelectionKey>,
  visible: VisibleRepository[]
): { shown: Set<SelectionKey>; hidden: Set<SelectionKey> } {
  const keys = visibleKeys(visible);
  const shown = new Set<SelectionKey>();
  const hidden = new Set<SelectionKey>();
  for (const key of selection) (keys.has(key) ? shown : hidden).add(key);
  return { shown, hidden };
}

// --- the plan ----------------------------------------------------------------

export interface ExtensionRef {
  internalName: string;
  name: string;
  repositoryName?: string;
  /** Every provider it registers — what goes with it. */
  providers: string[];
}

export interface ProviderRef {
  name: string;
  extensionName?: string;
  repositoryName?: string;
}

export interface BulkPlan {
  /** Selected and on screen, after folding providers into selected extensions. */
  count: number;
  enable: { extensions: ExtensionRef[]; providers: ProviderRef[] };
  disable: { extensions: ExtensionRef[]; providers: ProviderRef[] };
  uninstall: ExtensionRef[];
  /** Providers selected without their extension: Uninstall cannot reach them. */
  notUninstallable: ProviderRef[];
  /** Left out of everything because a job holds them. */
  busy: Array<{ name: string; reason: string }>;
  /** Selected but hidden by the filters; never acted on. */
  hidden: number;
}

const refOf = (extension: ProviderTreeExtension, repository: ProviderTreeRepository): ExtensionRef => ({
  internalName: extension.internalName,
  name: extension.name,
  repositoryName: extension.repositoryName ?? repository.name,
  providers: extension.providers.map((provider) => provider.name),
});

/**
 * What each bulk action would do to the current selection.
 *
 * @param busyTargets extension internal names with a queued or running job,
 *   mapped to a few words saying what the job is.
 */
export function planBulk(
  selection: Set<SelectionKey>,
  visible: VisibleRepository[],
  busyTargets: Map<string, string>
): BulkPlan {
  const { shown, hidden } = splitSelection(selection, visible);
  const plan: BulkPlan = {
    count: 0,
    enable: { extensions: [], providers: [] },
    disable: { extensions: [], providers: [] },
    uninstall: [],
    notUninstallable: [],
    busy: [],
    hidden: hidden.size,
  };

  for (const { repository, extensions } of visible) {
    for (const { extension, providers } of extensions) {
      const extSelected = shown.has(extKey(extension.internalName));
      const pickedProviders = extSelected
        ? []
        : providers.filter((provider) => shown.has(provKey(provider.name)));
      if (!extSelected && pickedProviders.length === 0) continue;

      const busyReason = busyTargets.get(extension.internalName);
      if (busyReason) {
        plan.busy.push({ name: extension.name, reason: busyReason });
        plan.count += extSelected ? 1 : pickedProviders.length;
        continue;
      }

      if (extSelected) {
        plan.count += 1;
        const ref = refOf(extension, repository);
        plan.uninstall.push(ref);
        if (extension.enabled === false) plan.enable.extensions.push(ref);
        else plan.disable.extensions.push(ref);
        continue;
      }

      for (const provider of pickedProviders) {
        plan.count += 1;
        const ref: ProviderRef = {
          name: provider.name,
          extensionName: extension.name,
          repositoryName: provider.repositoryName ?? repository.name,
        };
        plan.notUninstallable.push(ref);
        if (provider.enabled === false) plan.enable.providers.push(ref);
        else plan.disable.providers.push(ref);
      }
    }
  }
  return plan;
}

/** How many things an enable or disable would change. */
export const changeCount = (part: BulkPlan['enable']) => part.extensions.length + part.providers.length;
