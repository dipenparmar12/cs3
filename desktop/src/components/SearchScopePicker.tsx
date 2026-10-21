import React, {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ChevronDown, Filter } from 'lucide-react';
import type { ProviderTreeRepository, ProviderTreeProvider } from '../types/plugin';
import type { ProviderLoadProgress } from '../../electron/pluginManager';
import { useAdultMode } from '../utils/useAdultMode';
import {
  SourceScopeDialog,
  type PendingImpactConfirmation,
} from './search/SourceScopeDialog';
import {
  SourceProfileBar,
  type ProfileSummary,
  type BuiltInProfileDef,
} from './search/SourceProfileBar';
import { healthIndex, type ProviderHealth } from './search/providerHealth';
import {
  areAllFilteredSelected,
  calculateSelectionImpact,
  EMPTY_INTENT,
  excludeSection,
  getFilteredMembers,
  includeSection,
  intentFromSnapshot,
  isIntentEmpty,
  matchingPreset,
  presetIntent,
  providersForIntent,
  stateOf,
  toggleIntent,
  type BuiltInPreset,
  type ChosenSource,
  type Facets,
  type FacetSelection,
  type Row,
  type ScopeIntent,
} from './search/sourceScopeModel';

/**
 * Whether a provider can be offered as a search scope.
 *
 * `effectivelyEnabled`, not `enabled` — the two differ once a whole repository
 * or extension is switched off in the extensions screen, and only the former
 * matches what `PluginManager.enabledProviderNames` will actually query.
 *
 * Filtering on the provider's own switch alone would list a provider that the
 * main process is going to drop, so selecting it would search nothing and report
 * itself through `missingProviders`. That is the same class of failure as the
 * widen-back bug this picker was rewritten to fix, arriving from the other
 * direction: the menu must never offer a source the search cannot ask.
 */
function isSelectable(provider: ProviderTreeProvider): boolean {
  return provider.effectivelyEnabled !== false && provider.enabled !== false;
}

/**
 * "Search only these sources."
 *
 * The tree is the real one — repository → extension → provider, three levels,
 * with the torrent indexers as their own group — and each level's checkbox is a
 * bulk toggle over its descendants.
 *
 * Three things this has to survive that the previous version did not:
 *
 *  - **Hundreds of sources.** A vendored corpus runs to hundreds of extensions.
 *    Rows are flattened once and windowed, so the number rendered depends on the
 *    height of the menu and not on how much is installed, and typing filters a
 *    prebuilt list rather than rebuilding the tree per keystroke.
 *  - **The duplicate that was not one.** Most archives register exactly one
 *    provider named after the archive, which drew the same name twice, nested.
 *    That pair is collapsed into one selectable row. It was never a data
 *    duplication — deeper nesting than repository → extension → provider does
 *    not exist in the CloudStream model — but it read as one.
 *  - **Extensions that registered nothing.** The old code invented a provider
 *    named after the extension to fill the gap, and selecting that invented name
 *    scoped the search to a provider that has never existed. They are now shown
 *    as what they are, with the reason, and cannot be selected.
 *
 * The scope is stored in the main process rather than held here, because it has
 * to govern source discovery and refresh too — stages this component is long
 * gone by the time they run.
 */

interface IndexerNode {
  id: string;
  name: string;
}

interface SearchScopePickerProps {
  /** Bumped by the parent when extensions change, to force a refetch. */
  refreshKey?: number;
  /**
   * Fired when the menu closes having changed the scope, so the parent can
   * re-run the current query. Deliberately not per click: toggling six boxes is
   * one decision, and firing a search after each would spend six scrapes
   * answering questions the user was still in the middle of asking.
   */
  onScopeChange?: () => void;
}

const EMPTY_SELECTION: FacetSelection = {
  types: new Set(),
  languages: new Set(),
  kinds: new Set(),
};

/** Names differing only in case, spacing or punctuation are the same name. */
function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export const SearchScopePicker: React.FC<SearchScopePickerProps> = ({
  refreshKey = 0,
  onScopeChange,
}) => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [repositories, setRepositories] = useState<ProviderTreeRepository[]>([]);
  const [indexers, setIndexers] = useState<IndexerNode[]>([]);
  const [providers, setProviders] = useState<Set<string>>(new Set());
  const [chosenIndexers, setChosenIndexers] = useState<Set<string>>(new Set());

  const [progress, setProgress] = useState<ProviderLoadProgress | null>(null);

  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  /**
   * The Customize view's filters: which rows the list shows. Nothing else.
   * Ticking one used to rewrite the selection, so filtering the list by Hindi
   * to look at it replaced a hand-picked set with every Hindi provider.
   */
  const [facets, setFacets] = useState<FacetSelection>(EMPTY_SELECTION);
  /** Quick setup's chips, as stored with the profile or draft. */
  const [intent, setIntent] = useState<ScopeIntent>(EMPTY_INTENT);

  /** The scope as it was when the dialog opened, to detect a real change on close. */
  const openedWith = useRef<string>('');

  /**
   * @param ensureLoaded pay for the one-time load of every installed extension.
   */
  const load = useCallback(async (ensureLoaded: boolean) => {
    if (!window.cloudstream?.getSearchScopeOptions) return;
    setLoading(true);
    const response = await window.cloudstream.getSearchScopeOptions(ensureLoaded);
    setRepositories(response.repositories ?? []);
    setIndexers(response.indexers ?? []);
    setProviders(new Set(response.scope?.providers ?? []));
    setChosenIndexers(new Set(response.scope?.indexers ?? []));
    setProgress(response.progress ?? null);
    setLoading(false);
    setLoaded(true);
  }, []);

  /**
   * Populated at mount, not at first open.
   *
   * This is the fix for the picker that "was empty until you searched". It only
   * ever fetched when the menu opened, and that fetch loaded every installed
   * extension into the sidecar first — minutes of DEX translation on a
   * bootstrapped install. So the menu opened, showed a spinner or nothing, and
   * the user closed it. Running a search awaited the *same* load, which is why
   * searching appeared to be what fixed it.
   *
   * Mounting asks with `ensureLoaded: false`: an instant answer from whatever
   * is already registered. Opening asks with `true` and pays the cost with a
   * menu on screen to show progress in. Between them, the progress stream below
   * refreshes the tree as each archive lands, so the list fills in rather than
   * appearing all at once at the end.
   */
  useEffect(() => {
    void load(false);
  }, [load]);

  useEffect(() => {
    if (open) void load(true);
  }, [open, load]);

  useEffect(() => {
    if (refreshKey > 0) void load(false);
  }, [refreshKey, load]);

  /**
   * Follows the one-time provider load as it runs.
   *
   * Refetching per archive would mean a hundred and seventy tree rebuilds, so
   * the counter is taken from every event and the tree itself is refetched only
   * when the pass finishes or every tenth archive — often enough that the list
   * visibly grows, rarely enough to stay cheap.
   */
  useEffect(() => {
    const dispose = window.cloudstream?.onProviderLoadProgress?.((next) => {
      setProgress(next);
      if (!next.running || next.loaded % 10 === 0) void load(false);
    });
    return () => dispose?.();
  }, [load]);

  // Installs land while the menu may already be open, so the tree follows them.
  useEffect(() => {
    const dispose = window.cloudstream?.onBootstrapProgress?.((bootstrapProgress) => {
      if (bootstrapProgress.phase === 'done') void load(false);
    });
    return () => dispose?.();
  }, [load]);

  const signature = useCallback(
    () => `${[...providers].sort().join('|')}#${[...chosenIndexers].sort().join('|')}`,
    [providers, chosenIndexers]
  );

  const close = useCallback(() => {
    setOpen(false);
    if (signature() !== openedWith.current) onScopeChange?.();
  }, [signature, onScopeChange]);

  useEffect(() => {
    if (!open) return;
    openedWith.current = signature();
    // Intentionally captured once, at open: this is the "before" of the change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /**
   * Saved source sets, and which one is driving the search.
   *
   * Held here rather than inside `SourceProfileBar` for the same reason every
   * other list in this component is: the bar is presentation, and the selection
   * it switches between is the same selection the tree below it edits. Two
   * owners would let the pills and the checkboxes disagree about what is
   * scoped, which is the disagreement the whole scope model exists to prevent.
   */
  const adult = useAdultMode();
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [activeProfile, setActiveProfile] = useState<string>('all');
  const [draftCount, setDraftCount] = useState(0);

  const [pendingImpact, setPendingImpact] = useState<PendingImpactConfirmation | null>(null);
  const pendingCommitRef = useRef<(() => void) | null>(null);
  const [feedbackToast, setFeedbackToast] = useState<string | null>(null);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const triggerFeedback = useCallback((message: string) => {
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    setFeedbackToast(message);
    feedbackTimer.current = setTimeout(() => {
      setFeedbackToast(null);
    }, 3200);
  }, []);

  const handleDismissFeedback = useCallback(() => {
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    setFeedbackToast(null);
  }, []);

  const handleConfirmImpact = useCallback(() => {
    const commit = pendingCommitRef.current;
    pendingCommitRef.current = null;
    setPendingImpact(null);
    commit?.();
  }, []);

  const handleCancelImpact = useCallback(() => {
    pendingCommitRef.current = null;
    setPendingImpact(null);
  }, []);

  /**
   * Applies a profile answer to everything on screen.
   *
   * The main process is the authority on what the scope now is — it resolved
   * the profile, wrote it through to `SearchScopeStore`, and answered with the
   * result — so the tree is redrawn from that answer rather than from what the
   * click was expected to do.
   */
  const applyProfiles = useCallback(
    (snapshot: {
      ok?: boolean;
      profiles?: ProfileSummary[];
      activeId?: string;
      draft?: {
        providers?: string[];
        indexers?: string[];
        languages?: string[];
        contentTypes?: string[];
      };
    } | undefined) => {
      if (!snapshot?.ok) return;
      setProfiles(snapshot.profiles ?? []);
      setActiveProfile(snapshot.activeId ?? 'all');
      const draft = snapshot.draft ?? {};
      setDraftCount((draft.providers?.length ?? 0) + (draft.indexers?.length ?? 0));

      const active = (snapshot.profiles ?? []).find((p) => p.id === snapshot.activeId);
      const scoped =
        snapshot.activeId === 'all'
          ? { providers: [] as string[], indexers: [] as string[] }
          : active ?? { providers: draft.providers ?? [], indexers: draft.indexers ?? [] };
      setProviders(new Set(scoped.providers));
      setChosenIndexers(new Set(scoped.indexers));
      // The chips as they were stored. A selection made by hand has none, and
      // shows none: guessing them from its providers lit up chips nobody chose.
      setIntent(intentFromSnapshot(snapshot));
    },
    []
  );

  useEffect(() => {
    void window.cloudstream?.listSourceProfiles?.().then(applyProfiles);
  }, [applyProfiles]);

  /**
   * How well each provider has actually worked here.
   *
   * Fetched when the dialog opens rather than on mount: it is a whole
   * leaderboard, nothing on the collapsed trigger uses it, and the numbers move
   * slowly enough that a snapshot taken at open is as good as a live one.
   * Failing to load it is not an error — the rows simply carry no badge, which
   * is also what happens when the user has analytics switched off.
   */
  const [health, setHealth] = useState<Map<string, ProviderHealth>>(new Map());
  useEffect(() => {
    if (!open) return;
    void window.cloudstream?.getProviderLeaderboard?.().then((response) => {
      if (response?.ok) setHealth(healthIndex(response.scores ?? []));
    });
  }, [open]);

  /**
   * Saves a selection, with the chips that produced it.
   *
   * `nextIntent` defaults to none: every edit made source by source (a tick in
   * the tree, select filtered, invert) leaves a selection the chips no longer
   * describe, and keeping them would show "Hindi" over a hand-picked set.
   */
  const persist = useCallback(
    (nextProviders: Set<string>, nextIndexers: Set<string>, nextIntent: ScopeIntent = EMPTY_INTENT) => {
      setProviders(nextProviders);
      setChosenIndexers(nextIndexers);
      setIntent(nextIntent);
      // Goes through the profile layer, which decides whether this edits the
      // active profile or forks to the unnamed draft, then writes the effective
      // scope through to the store every search path already reads.
      void window.cloudstream
        ?.setSearchScope({
          providers: [...nextProviders],
          indexers: [...nextIndexers],
          languages: [...nextIntent.languages],
          contentTypes: [...nextIntent.types],
        })
        .then(() => window.cloudstream?.listSourceProfiles?.().then(applyProfiles));
    },
    [applyProfiles]
  );

  const applyWithImpactCheck = useCallback(
    (
      actionName: string,
      actionDescription: string,
      targetProviders: Set<string>,
      targetIndexers: Set<string>,
      commit: () => void,
      successMessage?: string
    ) => {
      const impact = calculateSelectionImpact(
        { providers, indexers: chosenIndexers },
        { providers: targetProviders, indexers: targetIndexers }
      );

      if (impact.isConsequential) {
        pendingCommitRef.current = () => {
          commit();
          if (successMessage) triggerFeedback(successMessage);
        };
        setPendingImpact({
          actionName,
          actionDescription,
          impact,
        });
      } else {
        commit();
        if (successMessage) triggerFeedback(successMessage);
      }
    },
    [providers, chosenIndexers, triggerFeedback]
  );

  /** Every selectable source, split by which dimension of the scope it lives in. */
  const universe = useMemo(() => {
    const providerNames: string[] = [];
    for (const repo of repositories) {
      for (const ext of repo.extensions) {
        for (const provider of ext.providers) {
          if (isSelectable(provider)) providerNames.push(provider.name);
        }
      }
    }
    return { providers: providerNames, indexers: indexers.map((i) => i.id) };
  }, [repositories, indexers]);

  /**
   * The facet values that actually exist, counted from what is installed.
   *
   * Counted rather than listed: a language nobody has an extension for must not
   * be offered, and a `TvType` that three extensions declare must not be
   * missing because it was not in someone's hard-coded list.
   */
  const available = useMemo<Facets>(() => {
    const types = new Map<string, number>();
    const languages = new Map<string, number>();
    for (const repo of repositories) {
      for (const ext of repo.extensions) {
        for (const provider of ext.providers) {
          if (!isSelectable(provider)) continue;
          for (const type of provider.supportedTypes ?? []) {
            if (type.toLowerCase() === 'nsfw' && !adult.allowed) continue;
            types.set(type, (types.get(type) ?? 0) + 1);
          }
          const lang = provider.lang ?? ext.language;
          if (lang) languages.set(lang, (languages.get(lang) ?? 0) + 1);
        }
      }
    }
    const byCount = (a: [string, number], b: [string, number]) =>
      b[1] - a[1] || a[0].localeCompare(b[0]);
    return {
      types: [...types.entries()].sort(byCount).map(([value]) => value),
      languages: [...languages.entries()].sort(byCount).map(([value]) => value),
      typeCounts: Object.fromEntries(types),
      languageCounts: Object.fromEntries(languages),
    };
  }, [repositories, adult.allowed]);

  /** The ready-made setups. NSFW only while adult content is allowed at all. */
  const presets = useMemo<BuiltInPreset[]>(
    () =>
      adult.allowed
        ? ['english', 'hindi', 'anime', 'drama', 'nsfw']
        : ['english', 'hindi', 'anime', 'drama'],
    [adult.allowed]
  );

  /**
   * Each preset is a set of chips (`presetIntent`), counted by the same rule
   * that resolves it, so the number on the card is the number it selects.
   */
  const builtInProfiles = useMemo<BuiltInProfileDef[]>(() => {
    const described: Record<BuiltInPreset, Pick<BuiltInProfileDef, 'name' | 'description' | 'icon'>> = {
      english: { name: 'English', description: 'Only sources in English.', icon: 'languages' },
      hindi: { name: 'Hindi', description: 'Only sources in Hindi.', icon: 'languages' },
      anime: {
        name: 'Anime',
        description: 'Only sources that carry anime series, films or OVAs.',
        icon: 'sparkles',
      },
      drama: { name: 'Asian Drama', description: 'Only sources that carry Asian drama.', icon: 'clapperboard' },
      nsfw: { name: 'NSFW (18+)', description: 'Only adult (18+) sources.', icon: 'shield' },
    };
    return [
      {
        id: 'all',
        name: 'All sources',
        description: 'Search every enabled extension and torrent source installed on your app.',
        icon: 'globe',
        count: universe.providers.length + universe.indexers.length,
      },
      ...presets.map((preset) => ({
        id: `builtin:${preset}`,
        ...described[preset],
        count: providersForIntent(repositories, presetIntent(preset, available), isSelectable).size,
      })),
    ];
  }, [repositories, universe, available, presets]);

  const facetsActive =
    facets.types.size > 0 || facets.languages.size > 0 || facets.kinds.size > 0;

  /**
   * OR within a facet, AND across facets.
   *
   * A provider matching *any* selected type and *any* selected language
   * survives; one matching a type but no selected language does not. The other
   * reading — AND everywhere — makes two selections in the same facet return
   * nothing, which users read as a broken filter rather than a strict one.
   */
  const matchesFacets = useCallback(
    (provider: ProviderTreeProvider, extensionLanguage?: string): boolean => {
      if (facets.kinds.size > 0 && !facets.kinds.has('extension')) return false;
      if (facets.types.size > 0) {
        const types = provider.supportedTypes ?? [];
        if (!types.some((type) => facets.types.has(type))) return false;
      }
      if (facets.languages.size > 0) {
        const lang = provider.lang ?? extensionLanguage;
        if (!lang || !facets.languages.has(lang)) return false;
      }
      return true;
    },
    [facets]
  );

  /** Indexers carry no language or content type, so only `kinds` can hide them. */
  const indexersVisible =
    (facets.kinds.size === 0 || facets.kinds.has('indexer')) &&
    facets.types.size === 0 &&
    facets.languages.size === 0;

  /** A Customize filter chip: shows or hides rows, and selects nothing. */
  const toggleFacet = useCallback((group: keyof FacetSelection, value: string) => {
    setFacets((current) => {
      const bucket = new Set(current[group] as Set<string>);
      if (bucket.has(value)) bucket.delete(value);
      else bucket.add(value);
      return { ...current, [group]: bucket };
    });
  }, []);

  /**
   * A quick-setup chip: searches the sources that match the chips now ticked.
   *
   * Only the pressed chip changes. A combination nothing installed matches is
   * refused with a reason rather than saved, because an empty selection means
   * "search everything", the opposite of what was asked.
   */
  const toggleIntentChip = useCallback(
    (group: 'languages' | 'types', value: string) => {
      const next = toggleIntent(intent, group, value);

      if (isIntentEmpty(next)) {
        persist(new Set(), chosenIndexers);
        if (activeProfile === '') {
          void window.cloudstream?.activateSourceProfile?.('all').then(applyProfiles);
        }
        return;
      }

      const target = providersForIntent(repositories, next, isSelectable);
      if (target.size === 0) {
        triggerFeedback('No installed source matches that combination.');
        return;
      }

      // Chips over a hand-picked selection start a new one; say so first when
      // it throws away more than a couple of picks.
      const handPicked = isIntentEmpty(intent) && providers.size > 0;
      if (handPicked) {
        applyWithImpactCheck(
          'Replace your hand-picked sources',
          `This replaces the ${providers.size} sources you picked in Customize sources with the ${target.size} that match.`,
          target,
          chosenIndexers,
          () => persist(target, chosenIndexers, next)
        );
        return;
      }
      persist(target, chosenIndexers, next);
    },
    [
      intent,
      providers,
      repositories,
      chosenIndexers,
      activeProfile,
      persist,
      applyProfiles,
      applyWithImpactCheck,
      triggerFeedback,
    ]
  );

  /**
   * The flattened row list.
   *
   * Rebuilt only when the data, the query or the collapse state changes —
   * never on selection, which is the interaction that happens most.
   */
  const rows = useMemo<Row[]>(() => {
    const needle = deferredQuery.trim().toLowerCase();
    const searching = needle.length > 0;
    // A search shows what it matched, so collapse state is suspended while one
    // is in force: hiding a match inside a collapsed group would read as "no
    // results" for something that is right there.
    const isOpen = (key: string) => searching || !collapsed.has(key);
    const activeRepos: { repoRow: Row; children: Row[] }[] = [];
    const unselectableRepos: { repoRow: Row; children: Row[] }[] = [];

    for (const repo of repositories) {
      const repoKey = `repo:${repo.id ?? repo.url ?? repo.name}`;
      const repoMatches = repo.name.toLowerCase().includes(needle);
      const repoMembers: string[] = [];
      const selectableChildren: Row[] = [];
      const unselectableChildren: Row[] = [];

      for (const ext of repo.extensions) {
        const extKey = `${repoKey}/ext:${ext.id ?? ext.internalName}`;
        const active = ext.providers
          .filter(isSelectable)
          .filter((provider) => matchesFacets(provider, ext.language));
        const extMatches = repoMatches || ext.name.toLowerCase().includes(needle);
        repoMembers.push(...active.map((provider) => provider.name));

        if (active.length === 0) {
          if (facetsActive) continue;
          if (searching && !extMatches) continue;
          unselectableChildren.push({
            key: extKey,
            kind: 'ext',
            depth: 1,
            label: ext.name,
            members: [],
            isIndexer: false,
          });
          unselectableChildren.push({
            key: `${extKey}/note`,
            kind: 'note',
            depth: 2,
            label: ext.unavailableReason ?? 'This add-on offers nothing to search.',
            members: [],
            isIndexer: false,
          });
          continue;
        }

        const matching =
          searching && !extMatches
            ? active.filter((provider) => provider.name.toLowerCase().includes(needle))
            : active;
        if (searching && !extMatches && matching.length === 0) continue;

        if (active.length === 1 && normalise(active[0].name) === normalise(ext.name)) {
          if (searching && !extMatches && !active[0].name.toLowerCase().includes(needle)) continue;
          repoMembers.push(active[0].name);
          selectableChildren.push({
            key: extKey,
            kind: 'leaf',
            depth: 1,
            label: ext.name,
            members: [active[0].name],
            lang: active[0].lang ?? ext.language,
            isIndexer: false,
          });
          continue;
        }

        const extMatchingMembers = matching.map((provider) => provider.name);
        repoMembers.push(...extMatchingMembers);

        selectableChildren.push({
          key: extKey,
          kind: 'ext',
          depth: 1,
          label: ext.name,
          members: extMatchingMembers,
          expanded: isOpen(extKey),
          isIndexer: false,
        });

        if (isOpen(extKey)) {
          for (const provider of matching) {
            selectableChildren.push({
              key: `${extKey}/p:${provider.id ?? provider.name}`,
              kind: 'leaf',
              depth: 2,
              label: provider.name,
              members: [provider.name],
              lang: provider.lang,
              isIndexer: false,
            });
          }
        }
      }

      const allChildren = [...selectableChildren, ...unselectableChildren];
      if (allChildren.length === 0) continue;

      const repoRow: Row = {
        key: repoKey,
        kind: 'repo',
        depth: 0,
        label: repo.name,
        members: repoMembers,
        expanded: isOpen(repoKey),
        title: repo.url || 'Sideloaded extension',
        isIndexer: false,
        icon: 'package',
      };

      if (repoMembers.length > 0) {
        activeRepos.push({ repoRow, children: allChildren });
      } else {
        unselectableRepos.push({ repoRow, children: allChildren });
      }
    }

    const out: Row[] = [];

    // 1. Active, selectable repositories first
    for (const { repoRow, children } of activeRepos) {
      out.push(repoRow);
      if (isOpen(repoRow.key)) out.push(...children);
    }

    // 2. Torrent sources group
    const matchingIndexers = !indexersVisible
      ? []
      : searching
        ? indexers.filter(
            (indexer) =>
              indexer.name.toLowerCase().includes(needle) || 'torrent sources'.includes(needle)
          )
        : indexers;

    if (matchingIndexers.length > 0) {
      const groupKey = 'group:indexers';
      const indexerMembers = matchingIndexers.map((indexer) => indexer.id);
      out.push({
        key: groupKey,
        kind: 'repo',
        depth: 0,
        label: 'Torrent sources',
        members: indexerMembers,
        expanded: isOpen(groupKey),
        title: 'Torrent indexers answer when finding something to play, not while searching titles — unless you scope the search to them',
        isIndexer: true,
        icon: 'radio',
      });
      if (isOpen(groupKey)) {
        for (const indexer of matchingIndexers) {
          out.push({
            key: `${groupKey}/${indexer.id}`,
            kind: 'leaf',
            depth: 1,
            label: indexer.name,
            members: [indexer.id],
            isIndexer: true,
          });
        }
      }
    }

    // 3. Unselectable/disabled repositories moved to the bottom with clear partition
    if (unselectableRepos.length > 0 && !searching) {
      out.push({
        key: 'divider:unselectable',
        kind: 'note',
        depth: 0,
        label: '— Unavailable or empty sources —',
        members: [],
        isIndexer: false,
      });
      for (const { repoRow, children } of unselectableRepos) {
        out.push(repoRow);
        if (isOpen(repoRow.key)) out.push(...children);
      }
    } else if (unselectableRepos.length > 0 && searching) {
      for (const { repoRow, children } of unselectableRepos) {
        out.push(repoRow);
        if (isOpen(repoRow.key)) out.push(...children);
      }
    }

    return out;
  }, [repositories, indexers, deferredQuery, collapsed, matchesFacets, facetsActive, indexersVisible]);

  const toggleRow = (row: Row) => {
    if (row.members.length === 0) return;
    const target = row.isIndexer ? chosenIndexers : providers;
    const next = new Set(target);
    const turnOn = stateOf(row.members, target) !== 'on';
    for (const member of row.members) {
      if (turnOn) next.add(member);
      else next.delete(member);
    }
    if (row.isIndexer) persist(providers, next);
    else persist(next, chosenIndexers);
  };

  const toggleCollapse = (key: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const totalChosen = providers.size + chosenIndexers.size;
  const totalAvailable = universe.providers.length + universe.indexers.length;

  const filteredMembers = useMemo(() => getFilteredMembers(rows), [rows]);
  const isFiltered = facetsActive || deferredQuery.trim().length > 0;
  const filteredCount = filteredMembers.providers.length + filteredMembers.indexers.length;
  const allFilteredSelected = useMemo(
    () => areAllFilteredSelected(filteredMembers, providers, chosenIndexers),
    [filteredMembers, providers, chosenIndexers]
  );

  const selectAllFiltered = useCallback(() => {
    const nextProviders = new Set(providers);
    const nextIndexers = new Set(chosenIndexers);
    for (const p of filteredMembers.providers) nextProviders.add(p);
    for (const i of filteredMembers.indexers) nextIndexers.add(i);
    applyWithImpactCheck(
      'Select filtered sources',
      `This will add ${filteredCount} filtered sources to your current selection.`,
      nextProviders,
      nextIndexers,
      () => persist(nextProviders, nextIndexers),
      `${filteredCount} filtered sources selected.`
    );
  }, [providers, chosenIndexers, filteredMembers, filteredCount, applyWithImpactCheck, persist]);

  const unselectAllFiltered = useCallback(() => {
    const nextProviders = new Set(providers);
    const nextIndexers = new Set(chosenIndexers);
    for (const p of filteredMembers.providers) nextProviders.delete(p);
    for (const i of filteredMembers.indexers) nextIndexers.delete(i);
    applyWithImpactCheck(
      'Unselect filtered sources',
      'This will remove matching filtered sources from your current selection.',
      nextProviders,
      nextIndexers,
      () => persist(nextProviders, nextIndexers),
      'Filtered sources unselected.'
    );
  }, [providers, chosenIndexers, filteredMembers, applyWithImpactCheck, persist]);

  const clearAllChosen = useCallback(() => {
    applyWithImpactCheck(
      'Clear all selected sources',
      `This will remove all ${totalChosen} selected sources from your current search scope.`,
      new Set(),
      new Set(),
      () => persist(new Set(), new Set()),
      `${totalChosen} source${totalChosen === 1 ? '' : 's'} cleared.`
    );
  }, [applyWithImpactCheck, totalChosen, persist]);

  /**
   * Flips every visible source (PRD-051 §31–32): the filtered ones when a
   * filter is on, otherwise everything. An empty selection here means "search
   * everything", so an invert that would empty it is not offered at all.
   */
  const invertTargets = isFiltered ? filteredMembers : universe;
  const invertedSelection = useMemo(() => {
    const nextProviders = new Set(providers);
    const nextIndexers = new Set(chosenIndexers);
    for (const p of invertTargets.providers) {
      if (nextProviders.has(p)) nextProviders.delete(p);
      else nextProviders.add(p);
    }
    for (const i of invertTargets.indexers) {
      if (nextIndexers.has(i)) nextIndexers.delete(i);
      else nextIndexers.add(i);
    }
    return { providers: nextProviders, indexers: nextIndexers };
  }, [providers, chosenIndexers, invertTargets]);
  const canInvert = invertedSelection.providers.size + invertedSelection.indexers.size > 0;
  const invertSelection = useCallback(() => {
    if (canInvert) {
      applyWithImpactCheck(
        'Invert source selection',
        'This will flip the selection of the displayed sources.',
        invertedSelection.providers,
        invertedSelection.indexers,
        () => persist(invertedSelection.providers, invertedSelection.indexers),
        'Selection inverted.'
      );
    }
  }, [canInvert, invertedSelection, applyWithImpactCheck, persist]);

  const handleIncludeSection = useCallback((row: Row) => {
    const next = includeSection(row, providers, chosenIndexers);
    applyWithImpactCheck(
      `Select all in “${row.label}”`,
      `This will select ${row.members.length} sources under “${row.label}”.`,
      next.providers,
      next.indexers,
      () => persist(next.providers, next.indexers),
      `Selected ${row.members.length} sources in “${row.label}”.`
    );
  }, [providers, chosenIndexers, applyWithImpactCheck, persist]);

  const handleExcludeSection = useCallback((row: Row) => {
    const next = excludeSection(row, providers, chosenIndexers);
    applyWithImpactCheck(
      `Unselect all in “${row.label}”`,
      `This will unselect ${row.members.length} sources under “${row.label}”.`,
      next.providers,
      next.indexers,
      () => persist(next.providers, next.indexers),
      `Unselected ${row.members.length} sources in “${row.label}”.`
    );
  }, [providers, chosenIndexers, applyWithImpactCheck, persist]);

  const handleExpandAll = useCallback(() => {
    setCollapsed(new Set());
  }, []);

  const handleCollapseAll = useCallback(() => {
    const allKeys = new Set<string>();
    for (const row of rows) {
      if (row.kind === 'repo' || row.kind === 'ext') {
        allKeys.add(row.key);
      }
    }
    setCollapsed(allKeys);
  }, [rows]);

  const handleSelectAllFacetGroup = useCallback((group: keyof FacetSelection) => {
    if (group === 'types') {
      setFacets((prev) => ({ ...prev, types: new Set(available.types) }));
    } else if (group === 'languages') {
      setFacets((prev) => ({ ...prev, languages: new Set(available.languages) }));
    } else if (group === 'kinds') {
      setFacets((prev) => ({ ...prev, kinds: new Set(['extension', 'indexer']) }));
    }
  }, [available]);

  const handleClearFacetGroup = useCallback((group: keyof FacetSelection) => {
    setFacets((prev) => ({ ...prev, [group]: new Set() }));
  }, []);

  const handleToggleAllTorrents = useCallback(() => {
    if (chosenIndexers.size > 0) {
      persist(providers, new Set());
    } else {
      persist(providers, new Set(universe.indexers));
    }
  }, [providers, chosenIndexers, universe.indexers, persist]);

  /**
   * What is scoped, as names rather than a number.
   *
   * Indexers are resolved through their roster because the scope stores ids
   * (`yts`, `nyaa`) and nobody scoped their search to `1337x-api`. A provider
   * that has since been uninstalled keeps its own name as the label rather than
   * disappearing from the strip: a selection nothing can serve has to stay
   * visible or it cannot be removed, and `missingProviders` would report it as
   * a mystery.
   */
  const chosen = useMemo<ChosenSource[]>(() => {
    const indexerNames = new Map(indexers.map((indexer) => [indexer.id, indexer.name]));
    return [
      ...[...providers].sort().map((name) => ({ id: name, label: name, isIndexer: false })),
      ...[...chosenIndexers]
        .sort()
        .map((id) => ({ id, label: indexerNames.get(id) ?? id, isIndexer: true })),
    ];
  }, [providers, chosenIndexers, indexers]);

  const deselect = useCallback(
    (source: ChosenSource) => {
      if (source.isIndexer) {
        const next = new Set(chosenIndexers);
        next.delete(source.id);
        persist(providers, next);
        return;
      }
      const next = new Set(providers);
      next.delete(source.id);
      persist(next, chosenIndexers);
    },
    [providers, chosenIndexers, persist]
  );

  const handleSelectAll = useCallback(() => {
    const allProviders = new Set(universe.providers);
    const allIndexers = new Set(universe.indexers);
    applyWithImpactCheck(
      'Select all sources',
      `This will add all ${totalAvailable} available sources to your current selection.`,
      allProviders,
      allIndexers,
      () => {
        setFacets(EMPTY_SELECTION);
        persist(allProviders, allIndexers);
      },
      `All ${totalAvailable} sources selected.`
    );
  }, [universe, totalAvailable, applyWithImpactCheck, persist]);

  const handleReset = useCallback(() => {
    applyWithImpactCheck(
      'Reset to All Sources',
      `This will remove your current selection (${totalChosen} sources) and search all installed sources.`,
      new Set(),
      new Set(),
      () => {
        setFacets(EMPTY_SELECTION);
        void window.cloudstream?.activateSourceProfile?.('all').then(applyProfiles);
      },
      'Selection reset to All Sources.'
    );
  }, [totalChosen, applyWithImpactCheck, applyProfiles]);

  /**
   * The preset the unnamed selection currently is, if any. Derived from the
   * stored chips on every render, so the pill stays lit after the save that
   * follows a click (it used to go dark the moment the reply came back).
   */
  const activePreset = activeProfile === '' ? matchingPreset(intent, presets, available) : undefined;

  const handleActivateProfile = useCallback(
    (id: string) => {
      // Only an unsaved selection someone built is worth a confirmation; a
      // preset can be picked again in one click.
      const hasUnsavedDraft = draftCount > 0 && activeProfile === '' && !activePreset;

      if (id === 'all') {
        if (hasUnsavedDraft) {
          applyWithImpactCheck(
            'Reset to All Sources',
            `This will discard your current unsaved selection (${draftCount} sources) and search all installed sources.`,
            new Set(),
            new Set(),
            () => {
              setFacets(EMPTY_SELECTION);
              void window.cloudstream?.activateSourceProfile?.('all').then(applyProfiles);
            },
            'Selection reset to All Sources.'
          );
        } else {
          setFacets(EMPTY_SELECTION);
          void window.cloudstream?.activateSourceProfile?.('all').then(applyProfiles);
          triggerFeedback('Reset to All Sources.');
        }
        return;
      }

      if (id === '') {
        void window.cloudstream?.activateSourceProfile?.('').then(applyProfiles);
        return;
      }

      if (id.startsWith('builtin:')) {
        const preset = id.slice('builtin:'.length) as BuiltInPreset;
        const nextIntent = presetIntent(preset, available);
        const target = providersForIntent(repositories, nextIntent, isSelectable);
        const name = builtInProfiles.find((b) => b.id === id)?.name ?? 'Built-in profile';
        if (target.size === 0) {
          triggerFeedback(`No installed source matches “${name}”.`);
          return;
        }
        /*
         * A preset is a starting point, not an edit to the profile on screen.
         * Saved while a named profile was active, it overwrote that profile
         * (`edit` writes into whatever is active), so it goes to the draft.
         */
        const apply = () => {
          const named = activeProfile !== '' && activeProfile !== 'all';
          const ready = named
            ? window.cloudstream?.activateSourceProfile?.('') ?? Promise.resolve(undefined)
            : Promise.resolve(undefined);
          void ready.then(() => persist(target, new Set(), nextIntent));
        };

        if (hasUnsavedDraft) {
          applyWithImpactCheck(
            `Switch to “${name}”`,
            `This will replace your current unsaved selection with ${name} (${target.size} sources).`,
            target,
            new Set(),
            apply,
            `Switched to “${name}”.`
          );
        } else {
          apply();
          triggerFeedback(`Switched to “${name}”.`);
        }
        return;
      }

      // A saved profile brings its own chips back with it (`applyProfiles`).
      const custom = profiles.find((p) => p.id === id);
      const targetProv = new Set(custom?.providers ?? []);
      const targetIdx = new Set(custom?.indexers ?? []);

      if (hasUnsavedDraft) {
        applyWithImpactCheck(
          `Switch to profile “${custom?.name ?? 'profile'}”`,
          `This will replace your current unsaved selection with “${custom?.name}”.`,
          targetProv,
          targetIdx,
          () => {
            void window.cloudstream?.activateSourceProfile?.(id).then(applyProfiles);
          },
          `Switched to profile “${custom?.name}”.`
        );
      } else {
        void window.cloudstream?.activateSourceProfile?.(id).then(applyProfiles);
        triggerFeedback(`Switched to profile “${custom?.name}”.`);
      }
    },
    [
      draftCount,
      activeProfile,
      activePreset,
      applyWithImpactCheck,
      applyProfiles,
      triggerFeedback,
      available,
      repositories,
      builtInProfiles,
      persist,
      profiles,
    ]
  );

  const label =
    totalChosen === 0
      ? 'All sources'
      : totalChosen === 1
        ? chosen[0]?.label ?? '1 source'
        : `${totalChosen} sources`;

  return (
    <div className="scope">
      <button
        className={`btn btn-secondary scope__trigger${totalChosen > 0 ? ' scope__trigger--active' : ''}`}
        onClick={() => (open ? close() : setOpen(true))}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={
          totalChosen === 0
            ? 'Searching every enabled source'
            : `Searching only ${totalChosen} selected source(s)`
        }
      >
        <Filter size={14} className="scope__icon" />
        <span className="scope__label">{label}</span>
        {totalChosen > 0 && (
          <span className="scope__count-badge" aria-hidden>
            {totalChosen}
          </span>
        )}
        <ChevronDown size={14} className="scope__chevron" />
      </button>

      {open && (
        <SourceScopeDialog
          rows={rows}
          available={available}
          intent={intent}
          onToggleIntent={toggleIntentChip}
          handPicked={isIntentEmpty(intent) && providers.size > 0}
          facets={facets}
          facetsActive={facetsActive}
          onToggleFacet={toggleFacet}
          onClearFacets={() => setFacets(EMPTY_SELECTION)}
          onSelectAllFacetGroup={handleSelectAllFacetGroup}
          onClearFacetGroup={handleClearFacetGroup}
          query={query}
          onQueryChange={setQuery}
          providers={providers}
          indexers={chosenIndexers}
          chosen={chosen}
          totalChosen={totalChosen}
          totalAvailable={totalAvailable}
          isFiltered={isFiltered}
          filteredCount={filteredCount}
          allFilteredSelected={allFilteredSelected}
          onSelectAllFiltered={selectAllFiltered}
          onUnselectAllFiltered={unselectAllFiltered}
          onClearAllChosen={clearAllChosen}
          onInvert={invertSelection}
          canInvert={canInvert}
          hasExtensions={universe.providers.length > 0}
          hasIndexers={indexers.length > 0}
          chosenTorrentCount={chosenIndexers.size}
          onToggleAllTorrents={handleToggleAllTorrents}
          progress={progress}
          loading={loading}
          loaded={loaded}
          onToggleRow={toggleRow}
          onToggleCollapse={toggleCollapse}
          onIncludeSection={handleIncludeSection}
          onExcludeSection={handleExcludeSection}
          onExpandAll={handleExpandAll}
          onCollapseAll={handleCollapseAll}
          onDeselect={deselect}
          onSelectAll={handleSelectAll}
          onReset={handleReset}
          onClose={close}
          healthFor={(provider) => health.get(provider)}
          pendingImpact={pendingImpact}
          onConfirmImpact={handleConfirmImpact}
          onCancelImpact={handleCancelImpact}
          feedbackToast={feedbackToast}
          onDismissFeedback={handleDismissFeedback}
          profileBar={
            <SourceProfileBar
              profiles={profiles}
              builtInProfiles={builtInProfiles}
              activeId={activePreset ? `builtin:${activePreset}` : activeProfile}
              hasDraft={draftCount > 0 && !activePreset}
              draftCount={draftCount}
              onActivate={handleActivateProfile}
              onCreate={(name) =>
                void window.cloudstream?.createSourceProfile?.(name).then(applyProfiles)
              }
              onRename={(id, name) =>
                void window.cloudstream?.renameSourceProfile?.(id, name).then(applyProfiles)
              }
              onDuplicate={(id) =>
                void window.cloudstream?.duplicateSourceProfile?.(id).then(applyProfiles)
              }
              onDelete={(id) =>
                void window.cloudstream?.deleteSourceProfile?.(id).then(applyProfiles)
              }
            />
          }
        />
      )}
    </div>
  );
};
