import React, {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Filter,
  Globe,
  Loader2,
  Minus,
  Package,
  Radio,
  Search,
  X,
} from 'lucide-react';
import type { ProviderTreeRepository, ProviderTreeProvider } from '../types/plugin';
import type { ProviderLoadProgress } from '../../electron/pluginManager';

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

type CheckState = 'on' | 'off' | 'mixed';

/**
 * One rendered line.
 *
 * The tree is flattened to a uniform row list so the menu can render a window
 * of it. Check state is derived at paint time from `members` rather than stored
 * here, which keeps ticking a box from rebuilding the list.
 */
interface Row {
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

const ROW_HEIGHT = 28;
const VIEWPORT_HEIGHT = 300;
const OVERSCAN = 6;

/**
 * The facets a scope can be narrowed by, before anything is ticked.
 *
 * Derived from what is installed rather than hard-coded, for the same reason
 * the extensions screen's filters are: a fixed list of Movies/TV/Anime cannot
 * express "anime or series" and silently omits every other `TvType` the corpus
 * actually declares — `NSFW`, `Live`, `Documentary`, `AsianDrama`, `Cartoon`.
 * A facet with nothing behind it is not offered; one that exists cannot be
 * hidden.
 *
 * Semantics are **OR within a facet, AND across facets**, matching the
 * extensions screen. Anything else reads as broken.
 */
interface Facets {
  types: string[];
  languages: string[];
}

interface FacetSelection {
  types: Set<string>;
  languages: Set<string>;
  /** Hide extensions, or hide torrent indexers. Never both. */
  kinds: Set<'extension' | 'indexer'>;
}

const EMPTY_SELECTION: FacetSelection = {
  types: new Set(),
  languages: new Set(),
  kinds: new Set(),
};

/** Upstream's `TvType` names are PascalCase; the menu is not. */
function prettyType(value: string): string {
  return value.replace(/([a-z])([A-Z])/g, '$1 $2');
}

/** Names differing only in case, spacing or punctuation are the same name. */
function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function stateOf(members: string[], selected: Set<string>): CheckState {
  if (members.length === 0) return 'off';
  let on = 0;
  for (const member of members) if (selected.has(member)) on += 1;
  if (on === 0) return 'off';
  return on === members.length ? 'on' : 'mixed';
}

const Box: React.FC<{ state: CheckState }> = ({ state }) => (
  <span className={`scope__box scope__box--${state}`} aria-hidden>
    {state === 'on' && <Check size={11} strokeWidth={3} />}
    {state === 'mixed' && <Minus size={11} strokeWidth={3} />}
  </span>
);

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
  const [scrollTop, setScrollTop] = useState(0);

  const wrapper = useRef<HTMLDivElement | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  /** The scope as it was when the menu opened, to detect a real change on close. */
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

  useEffect(() => {
    if (!open) return;
    const onOutside = (event: PointerEvent) => {
      if (wrapper.current && !wrapper.current.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onOutside, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

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

  useEffect(() => {
    setScrollTop(0);
    if (scroller.current) scroller.current.scrollTop = 0;
  }, [deferredQuery]);

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

  const label =
    totalChosen === 0
      ? 'All sources'
      : totalChosen === 1
        ? [...providers, ...chosenIndexers][0]
        : `${totalChosen} sources`;

  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((scrollTop + VIEWPORT_HEIGHT) / ROW_HEIGHT) + OVERSCAN);
  const visible = rows.slice(first, last);

  return (
    <div className="scope" ref={wrapper}>
      <button
        className={`btn btn-secondary scope__trigger${totalChosen > 0 ? ' scope__trigger--active' : ''}`}
        onClick={() => (open ? close() : setOpen(true))}
        aria-expanded={open}
        aria-haspopup="true"
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
        <div className="scope__menu" role="group" aria-label="Search scope">
          <div className="scope__head">
            <span>Search scope</span>
            <span className="scope__head-count">
              {totalChosen === 0 ? 'global' : `${totalChosen} of ${totalAvailable}`}
            </span>
          </div>

          <div className="scope__search">
            <Search size={13} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search sources…"
              aria-label="Search sources"
              autoFocus
            />
            {query && (
              <button onClick={() => setQuery('')} title="Clear" aria-label="Clear source search">
                <X size={12} />
              </button>
            )}
          </div>

          {/*
            The default, stated as a row rather than only as an absence. An empty
            selection and a fully-ticked one search the same sources today, but
            they age differently: this one follows whatever is installed, while
            ticking everything pins the set as it is right now.
          */}
          <button
            className={`scope__row scope__row--all${totalChosen === 0 ? ' scope__row--current' : ''}`}
            onClick={() => persist(new Set(), new Set())}
          >
            <Box state={totalChosen === 0 ? 'on' : 'off'} />
            <Globe size={13} />
            <span className="scope__name">All sources</span>
            <span className="scope__count">{totalAvailable}</span>
          </button>

          {/*
            Facets, derived from what is installed.

            Placed above the tree rather than inside it because they narrow what
            the tree contains — a filter rendered as a row of the thing it
            filters reads as another selectable source.
          */}
          {(available.types.length > 0 ||
            available.languages.length > 0 ||
            indexers.length > 0) && (
            <div className="scope__facets">
              {indexers.length > 0 && universe.providers.length > 0 && (
                <div className="scope__facet-group" role="group" aria-label="Source kind">
                  <button
                    className={`scope__chip${facets.kinds.has('extension') ? ' scope__chip--on' : ''}`}
                    onClick={() => toggleFacet('kinds', 'extension')}
                    title="Show only extension providers"
                  >
                    <Package size={11} /> Extensions
                  </button>
                  <button
                    className={`scope__chip${facets.kinds.has('indexer') ? ' scope__chip--on' : ''}`}
                    onClick={() => toggleFacet('kinds', 'indexer')}
                    title="Show only torrent indexers"
                  >
                    <Radio size={11} /> Torrents
                  </button>
                </div>
              )}

              {available.types.length > 0 && (
                <div className="scope__facet-group" role="group" aria-label="Content type">
                  {available.types.map((type) => (
                    <button
                      key={type}
                      className={`scope__chip${facets.types.has(type) ? ' scope__chip--on' : ''}`}
                      onClick={() => toggleFacet('types', type)}
                    >
                      {prettyType(type)}
                    </button>
                  ))}
                </div>
              )}

              {available.languages.length > 1 && (
                <div className="scope__facet-group" role="group" aria-label="Language">
                  {available.languages.slice(0, 12).map((lang) => (
                    <button
                      key={lang}
                      className={`scope__chip${facets.languages.has(lang) ? ' scope__chip--on' : ''}`}
                      onClick={() => toggleFacet('languages', lang)}
                    >
                      {lang.toUpperCase()}
                    </button>
                  ))}
                </div>
              )}

              {facetsActive && (
                <button
                  className="scope__chip scope__chip--clear"
                  onClick={() => setFacets(EMPTY_SELECTION)}
                >
                  <X size={11} /> Clear filters
                </button>
              )}
            </div>
          )}

          {/*
            Progress, with a number in it.

            "Loading extensions…" for four minutes is indistinguishable from a
            hang, and that is precisely how long this can take on a bootstrapped
            install. Saying which archive and how many are left turns the same
            wait into something a user can judge.
          */}
          {progress?.running && (
            <div className="scope__loading scope__loading--quiet">
              <Loader2 size={12} className="spin" />
              <span>
                Loading extensions — {progress.loaded} of {progress.total}
                {progress.providers > 0 ? `, ${progress.providers} providers so far` : ''}
                {progress.current ? ` · ${progress.current}` : ''}
              </span>
            </div>
          )}

          {/* Only takes the panel over when there is nothing to show yet; a
              refresh over an existing tree is a quiet line, not a blank menu. */}
          {loading && !loaded && !progress?.running && (
            <div className="scope__loading">
              <Loader2 size={14} className="spin" /> Loading extensions…
            </div>
          )}
          {loading && loaded && !progress?.running && (
            <div className="scope__loading scope__loading--quiet">
              <Loader2 size={12} className="spin" /> Refreshing…
            </div>
          )}

          {!loading && rows.length === 0 && (
            <p className="scope__empty">
              {deferredQuery.trim()
                ? `Nothing matches "${deferredQuery.trim()}".`
                : facetsActive
                  ? 'No source matches these filters.'
                  : progress?.running
                    ? 'Loading the installed extensions…'
                    : 'No extension providers are installed. Add a repository in Extensions.'}
            </p>
          )}

          {rows.length > 0 && (
            <div
              className="scope__list"
              ref={scroller}
              style={{ height: Math.min(VIEWPORT_HEIGHT, rows.length * ROW_HEIGHT) }}
              onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
            >
              <div style={{ height: rows.length * ROW_HEIGHT, position: 'relative' }}>
                <div style={{ transform: `translateY(${first * ROW_HEIGHT}px)` }}>
                  {visible.map((row) => {
                    if (row.kind === 'note') {
                      return (
                        <p key={row.key} className="scope__note" style={{ height: ROW_HEIGHT }}>
                          {row.label}
                        </p>
                      );
                    }

                    const selected = row.isIndexer ? chosenIndexers : providers;
                    const state = stateOf(row.members, selected);
                    const collapsible = row.expanded !== undefined;

                    return (
                      <div
                        key={row.key}
                        className={`scope__row scope__row--${row.kind} scope__row--d${row.depth}`}
                        style={{ height: ROW_HEIGHT }}
                        title={row.title}
                      >
                        {collapsible ? (
                          <button
                            className="scope__twisty"
                            onClick={() => toggleCollapse(row.key)}
                            aria-label={row.expanded ? 'Collapse' : 'Expand'}
                            aria-expanded={row.expanded}
                          >
                            {row.expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                          </button>
                        ) : (
                          <span className="scope__twisty scope__twisty--empty" />
                        )}

                        <button
                          className="scope__pick"
                          onClick={() => toggleRow(row)}
                          disabled={row.members.length === 0}
                        >
                          <Box state={state} />
                          {row.icon === 'package' && <Package size={13} />}
                          {row.icon === 'radio' && <Radio size={13} />}
                          <span className="scope__name">{row.label}</span>
                          {row.lang && <span className="scope__lang">{row.lang.toUpperCase()}</span>}
                          {row.members.length > 1 && (
                            <span className="scope__count">{row.members.length}</span>
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          <div className="scope__foot">
            <button
              onClick={() =>
                persist(new Set(universe.providers), new Set(universe.indexers))
              }
              disabled={totalAvailable === 0}
            >
              Select all
            </button>
            <button onClick={() => persist(new Set(), new Set())} disabled={totalChosen === 0}>
              Reset to all sources
            </button>
          </div>

          <p className="scope__hint">
            {totalChosen === 0
              ? 'Searching every enabled provider, catalogue and indexer.'
              : 'Only the selected sources are searched. Catalogue metadata is not consulted while the scope is narrowed.'}
          </p>
        </div>
      )}
    </div>
  );
};
