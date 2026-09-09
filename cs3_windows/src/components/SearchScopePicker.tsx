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
import { SourceScopeDialog } from './search/SourceScopeDialog';
import {
  stateOf,
  type ChosenSource,
  type Facets,
  type FacetSelection,
  type Row,
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
  const [facets, setFacets] = useState<FacetSelection>(EMPTY_SELECTION);

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

  const persist = useCallback((nextProviders: Set<string>, nextIndexers: Set<string>) => {
    setProviders(nextProviders);
    setChosenIndexers(nextIndexers);
    void window.cloudstream?.setSearchScope({
      providers: [...nextProviders],
      indexers: [...nextIndexers],
    });
  }, []);

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
    };
  }, [repositories]);

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

  const toggleFacet = useCallback(
    (group: keyof FacetSelection, value: string) => {
      setFacets((current) => {
        const next: FacetSelection = {
          types: new Set(current.types),
          languages: new Set(current.languages),
          kinds: new Set(current.kinds),
        };
        const bucket = next[group] as Set<string>;
        if (bucket.has(value)) bucket.delete(value);
        else bucket.add(value);
        return next;
      });
    },
    []
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
    const out: Row[] = [];

    for (const repo of repositories) {
      const repoKey = `repo:${repo.id ?? repo.url ?? repo.name}`;
      const repoMatches = repo.name.toLowerCase().includes(needle);
      const repoMembers: string[] = [];
      const children: Row[] = [];

      for (const ext of repo.extensions) {
        const extKey = `${repoKey}/ext:${ext.id ?? ext.internalName}`;
        const active = ext.providers
          .filter(isSelectable)
          .filter((provider) => matchesFacets(provider, ext.language));
        const extMatches = repoMatches || ext.name.toLowerCase().includes(needle);
        repoMembers.push(...active.map((provider) => provider.name));

        if (active.length === 0) {
          // A facet that filtered everything out of this extension is not the
          // same as an extension that registered nothing, and saying "no
          // providers registered" for the first would be a lie about the data.
          if (facetsActive) continue;
          if (searching && !extMatches) continue;
          children.push({
            key: extKey,
            kind: 'ext',
            depth: 1,
            label: ext.name,
            members: [],
            isIndexer: false,
          });
          children.push({
            key: `${extKey}/note`,
            kind: 'note',
            depth: 2,
            label: ext.unavailableReason ?? 'No providers registered.',
            members: [],
            isIndexer: false,
          });
          continue;
        }

        // One archive, one provider, same name: two rows for one thing. This is
        // the "duplicate" in the source list, and it is a rendering artefact
        // rather than a registration bug — collapse it into a single row.
        if (active.length === 1 && normalise(active[0].name) === normalise(ext.name)) {
          if (searching && !extMatches && !active[0].name.toLowerCase().includes(needle)) continue;
          children.push({
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

        const matching =
          searching && !extMatches
            ? active.filter((provider) => provider.name.toLowerCase().includes(needle))
            : active;
        if (searching && !extMatches && matching.length === 0) continue;

        children.push({
          key: extKey,
          kind: 'ext',
          depth: 1,
          label: ext.name,
          members: active.map((provider) => provider.name),
          expanded: isOpen(extKey),
          isIndexer: false,
        });

        if (isOpen(extKey)) {
          for (const provider of matching) {
            children.push({
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

      if (children.length === 0) continue;

      out.push({
        key: repoKey,
        kind: 'repo',
        depth: 0,
        label: repo.name,
        members: repoMembers,
        expanded: isOpen(repoKey),
        title: repo.url || 'Sideloaded extension',
        isIndexer: false,
        icon: 'package',
      });
      if (isOpen(repoKey)) out.push(...children);
    }

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
      out.push({
        key: groupKey,
        kind: 'repo',
        depth: 0,
        label: 'Torrent sources',
        members: indexers.map((indexer) => indexer.id),
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
        <Filter size={14} />
        <span className="scope__label">{label}</span>
        <ChevronDown size={14} />
      </button>

      {open && (
        <SourceScopeDialog
          rows={rows}
          available={available}
          facets={facets}
          facetsActive={facetsActive}
          onToggleFacet={toggleFacet}
          onClearFacets={() => setFacets(EMPTY_SELECTION)}
          query={query}
          onQueryChange={setQuery}
          providers={providers}
          indexers={chosenIndexers}
          chosen={chosen}
          totalChosen={totalChosen}
          totalAvailable={totalAvailable}
          hasExtensions={universe.providers.length > 0}
          hasIndexers={indexers.length > 0}
          progress={progress}
          loading={loading}
          loaded={loaded}
          onToggleRow={toggleRow}
          onToggleCollapse={toggleCollapse}
          onDeselect={deselect}
          onSelectAll={() => persist(new Set(universe.providers), new Set(universe.indexers))}
          onReset={() => persist(new Set(), new Set())}
          onClose={close}
        />
      )}
    </div>
  );
};
