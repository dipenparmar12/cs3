import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTitleInteractions } from '../components/useTitleInteractions';
import { ChevronRight, Loader2, PlugZap, Search, SlidersHorizontal, Sparkles, X } from 'lucide-react';
import type { ProviderCatalog, ProviderCatalogSection, SearchResponse } from '../types/api';
import type { HomeCategoryState } from './homeCategoryState';
import { CategoryGrid } from '../components/home/CategoryGrid';
import { PosterCard } from '../components/PosterCard';
import { EmptyState } from '../components/EmptyState';
import { FixProvidersModal } from '../components/FixProvidersModal';
import { useFlash } from '../utils/useFlash';

/**
 * One OTT platform, as a destination.
 *
 * ## What this page is for
 *
 * The reported friction is search-and-backtrack: search a title, try provider
 * A, go back, try provider B, go back. That is a symptom of the app having no
 * notion of *where you are* — every search is global, so every result set is a
 * mixture and every failure is one row out of thirty.
 *
 * This page is the opposite arrangement. It is bound to a platform, everything
 * on it comes from the providers behind that platform, and its search box is
 * scoped to them. Nothing here can return a result the page cannot then play,
 * because there is nowhere else for a result to come from.
 *
 * ## Browse comes from the provider, not from a catalogue service
 *
 * The rows are the provider's own `getMainPage` — its editorial, the same rows
 * the Android app shows. That is a different source from the home screen, which
 * is Cinemeta and AniList and is addressed by IMDb id: a home-screen card has
 * to be *resolved* to a provider before it can play, and a card here is already
 * addressed as `cs3ext://provider/handle`. The binding is the whole point, and
 * it is why this page can promise something the home screen cannot.
 *
 * ## Three states, and none of them is a blank page
 *
 * `ready`, `disabled`, `missing` each get their own answer, because they need
 * different actions from the user: nothing, a switch, or an install. Collapsing them into "no content" is the failure
 * this component exists to avoid — a user who turned a provider off last week
 * being told the platform does not exist.
 */

export interface OttPlatformSummary {
  id: string;
  name: string;
  tagline: string;
  accent: string;
  availability: 'ready' | 'disabled' | 'missing';
  providers: string[];
  disabledProviders: string[];
  suggestedRepositories: string[];
}

interface OttPlatformViewProps {
  platform: OttPlatformSummary;
  onSelectMedia: (item: SearchResponse) => void;
  onPlayDirectly?: (item: SearchResponse) => void;
  /**
   * Runs a search bound to this platform's providers.
   *
   * The scope travels with the request rather than being written to the stored
   * search scope, so leaving this page does not leave the app filtered.
   */
  onScopedSearch: (query: string, providers: string[]) => void;
  /** Takes the user to the extensions screen, for the `disabled` state. */
  onOpenExtensions: () => void;
  /** Re-reads the platform list after an install, so the page can change state. */
  onInventoryChanged: () => void;
  /**
   * The row opened with "Show all", held by `App` for the reason home's is:
   * opening a title unmounts this page, and Back should land in the same grid.
   */
  category: OttCategoryState | null;
  onCategoryChange: (next: OttCategoryState | null) => void;
}

/** One provider row opened as a full grid. */
export interface OttCategoryState extends HomeCategoryState {
  platformId: string;
  provider: string;
  section: { name: string; data: string; horizontalImages?: boolean };
}

/** Lowercase words, punctuation folded away — "spider-man" finds "Spider Man". */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Every query word is the start of some word in the text. */
function matchesQuery(text: string, queryWords: string[]): boolean {
  if (queryWords.length === 0) return true;
  const haystack = words(text);
  return queryWords.every((q) => haystack.some((w) => w.startsWith(q)));
}

interface LoadedSection extends ProviderCatalogSection {
  /** `provider::name` — two providers routinely both publish "Trending". */
  key: string;
  provider: string;
  /** Asked for at least once, so switching back to a provider does not re-fetch. */
  fetched: boolean;
  items: SearchResponse[];
  page: number;
  hasNext: boolean;
  loading: boolean;
  error?: string;
}

/**
 * The preload bridge, or nothing.
 *
 * `window.cloudstream` is optional in the renderer's types because the same
 * components render in contexts that have no preload — and a non-null
 * assertion here would turn that into a runtime `TypeError` inside a `.then`,
 * which surfaces as a blank page rather than as a missing bridge.
 */
const api = () => window.cloudstream;

/** How many rows are fetched before the rest wait for a scroll. */
const INITIAL_ROWS = 4;

export const OttPlatformView: React.FC<OttPlatformViewProps> = ({
  platform,
  onSelectMedia,
  onPlayDirectly,
  onScopedSearch,
  onOpenExtensions,
  onInventoryChanged,
  category,
  onCategoryChange,
}) => {
  const [catalogs, setCatalogs] = useState<ProviderCatalog[]>([]);
  /** Providers that matched the platform but publish nothing to browse. */
  const [unbrowsable, setUnbrowsable] = useState<Array<{ provider: string; reason: string }>>([]);
  /**
   * Whose catalogue is on screen. One provider at a time, as Android's home
   * screen does: two providers' rows interleaved is a list neither meant, and
   * fetching every provider's rows at once is a burst of scrapes nobody asked for.
   */
  const [activeProvider, setActiveProvider] = useState<string | null>(null);
  const [sections, setSections] = useState<LoadedSection[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<
    Array<{ id: string; name: string; description: string; installed: boolean }>
  >([]);
  const [installing, setInstalling] = useState<string | null>(null);
  /**
   * What is on this service, when no installed provider can say.
   *
   * Kept apart from `sections` rather than merged into it, because the two make
   * different claims: a provider row is something this app can play, and one of
   * these is something that exists on the platform and may or may not be
   * findable. Merging them would make a grid of unplayable posters look
   * identical to a working catalogue.
   */
  const [metaSections, setMetaSections] = useState<
    Array<{ id: string; title: string; items: SearchResponse[] }>
  >([]);
  const [metaSupported, setMetaSupported] = useState(false);
  const [metaLoading, setMetaLoading] = useState(false);
  /** Providers the fix modal is open for, or null when it is closed. */
  const [fixing, setFixing] = useState<string[] | null>(null);
  const { message: notice, flash } = useFlash<string>(4000);

  /**
   * Guards every async write against a platform switch.
   *
   * Switching from Netflix to Hotstar while the first page is still loading is
   * an ordinary thing to do, and the reply that lands afterwards would
   * otherwise draw Netflix rows under the Hotstar heading — which reads as the
   * providers being confused rather than as us.
   */
  const platformRef = useRef(platform.id);
  useEffect(() => {
    platformRef.current = platform.id;
  }, [platform.id]);

  const loadRow = useCallback(
    async (section: LoadedSection, page: number) => {
      const forPlatform = platformRef.current;
      const bridge = api();
      if (!bridge) return;
      const response = await bridge.getOttCatalogPage(
        section.provider,
        { name: section.name, data: section.data, horizontalImages: section.horizontalImages },
        page
      );
      if (platformRef.current !== forPlatform) return;

      setSections((current) =>
        current.map((row) => {
          if (row.key !== section.key) return row;
          if (!response.ok || !response.page) {
            return { ...row, loading: false, error: response.error ?? 'That row could not be loaded.' };
          }
          return {
            ...row,
            loading: false,
            error: undefined,
            page: response.page.page,
            hasNext: response.page.hasNext,
            // Appended rather than replaced: paging a row is "more of this",
            // and replacing would make the second page look like the first
            // one vanished.
            items: page > 1 ? [...row.items, ...response.page.items] : response.page.items,
          };
        })
      );
    },
    []
  );

  /** Marks rows as loading and fetches their first page. */
  const startRows = useCallback(
    (rows: LoadedSection[]) => {
      if (rows.length === 0) return;
      const keys = new Set(rows.map((row) => row.key));
      setSections((current) =>
        current.map((row) => (keys.has(row.key) ? { ...row, loading: true, fetched: true } : row))
      );
      for (const row of rows) void loadRow(row, 1);
    },
    [loadRow]
  );

  // Switching provider fetches the first rows of that provider, once.
  useEffect(() => {
    if (!activeProvider) return;
    const pending = sections
      .filter((row) => row.provider === activeProvider)
      .slice(0, INITIAL_ROWS)
      .filter((row) => !row.fetched);
    startRows(pending);
    // `sections` is read, not depended on: re-running on every row update would
    // fire the same fetch again while it is in flight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProvider, startRows]);

  useEffect(() => {
    let cancelled = false;
    setCatalogs([]);
    setUnbrowsable([]);
    setActiveProvider(null);
    setSections([]);
    setQuery('');

    if (platform.availability === 'missing') {
      void api()?.getOttSuggestions(platform.id).then((response) => {
        if (!cancelled) setSuggestions(response.suggestions ?? []);
      });
      return () => {
        cancelled = true;
      };
    }

    setSuggestions([]);
    setMetaSections([]);

    /*
     * Third-party listings are a fallback, not the page. The providers' own
     * catalogues — NetflixM's rows, say — are what can actually play, so the
     * listings are fetched only when no installed provider publishes one.
     */
    const loadListings = () => {
      setMetaLoading(true);
      void api()
        ?.getOttMetadataCatalog(platform.id)
        .then((response) => {
          if (cancelled) return;
          setMetaLoading(false);
          setMetaSupported(Boolean(response?.supported));
          setMetaSections(response?.sections ?? []);
        })
        .catch(() => {
          if (!cancelled) setMetaLoading(false);
        });
    };

    if (platform.availability !== 'ready') {
      loadListings();
      return () => {
        cancelled = true;
      };
    }

    setLoading(true);
    void api()
      ?.getOttCatalogs(platform.id)
      .then((response) => {
        if (cancelled) return;
        setLoading(false);
        const found = response?.ok ? response.catalogs : [];
        setCatalogs(found);
        setUnbrowsable(response?.unavailable ?? []);
        if (found.length === 0) {
          loadListings();
          return;
        }
        setSections(
          found.flatMap((catalog) =>
            catalog.sections.map((section) => ({
              ...section,
              key: `${catalog.provider}::${section.name}`,
              provider: catalog.provider,
              fetched: false,
              items: [],
              page: 1,
              hasNext: false,
              loading: false,
            }))
          )
        );
        // Richest first, so the page opens on the fullest catalogue.
        setActiveProvider(found[0].provider);
      })
      .catch(() => {
        if (cancelled) return;
        setLoading(false);
        loadListings();
      });

    return () => {
      cancelled = true;
    };
  }, [platform.id, platform.availability]);

  const visibleSections = useMemo(
    () => sections.filter((row) => row.provider === activeProvider),
    [sections, activeProvider]
  );

  /*
   * Typing filters what is already on the page, instantly and with no network:
   * titles from every loaded row of every provider, and rows whose name
   * matches ("anime", "korean", "trending"). Enter still asks the providers
   * themselves, for what no loaded row holds.
   */
  const queryWords = useMemo(() => words(query), [query]);
  const filtering = queryWords.length > 0;

  const titleMatches = useMemo(() => {
    if (!filtering) return [];
    const seen = new Set<string>();
    const hits: Array<{ item: SearchResponse; provider: string; row: string }> = [];
    const pools: Array<{ provider: string; row: string; items: SearchResponse[] }> = [
      ...sections.map((s) => ({ provider: s.provider, row: s.name, items: s.items })),
      ...metaSections.map((s) => ({ provider: '', row: s.title, items: s.items })),
    ];
    for (const pool of pools) {
      for (const item of pool.items) {
        if (seen.has(item.url) || !matchesQuery(item.name, queryWords)) continue;
        seen.add(item.url);
        hits.push({ item, provider: pool.provider, row: pool.row });
      }
    }
    return hits;
  }, [filtering, queryWords, sections, metaSections]);

  /** Rows whose own name matches, from every provider, not only the open one. */
  const rowMatches = useMemo(
    () => (filtering ? sections.filter((row) => matchesQuery(row.name, queryWords)) : []),
    [filtering, queryWords, sections]
  );

  // A matching row nobody has opened yet is fetched, so it is not an empty rail.
  useEffect(() => {
    startRows(rowMatches.filter((row) => !row.fetched).slice(0, INITIAL_ROWS));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowMatches.map((row) => row.key).join('|'), startRows]);

  const showAll = (section: LoadedSection) =>
    onCategoryChange({
      platformId: platform.id,
      provider: section.provider,
      section: { name: section.name, data: section.data, horizontalImages: section.horizontalImages },
      id: `ott:${platform.id}:${section.key}`,
      title: section.name,
      subtitle: `${platform.name} · ${section.provider}`,
      items: section.items,
      skip: section.items.length,
      page: Math.max(1, section.page),
      done: section.fetched && !section.hasNext && section.items.length > 0,
      returnScroll: 0,
    });

  const loadCategoryPage = useCallback(async (current: OttCategoryState) => {
    const response = await api()?.getOttCatalogPage(
      current.provider,
      current.section,
      current.page + 1
    );
    if (!response?.ok || !response.page) {
      return { ok: false, error: response?.error ?? 'More titles could not be loaded.' };
    }
    return { ok: true, items: response.page.items, hasNext: response.page.hasNext };
  }, []);

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    onScopedSearch(trimmed, platform.providers);
  };

  const install = async (repositoryId: string) => {
    setInstalling(repositoryId);
    try {
      const bridge = api();
      if (!bridge) return;
      const result = await bridge.installOttSuggestion(platform.id, repositoryId);
      flash(
        result.ok
          ? `${result.installed} extension(s) installed. ${platform.name} is ready.`
          : result.message
      );
      if (result.ok) onInventoryChanged();
    } finally {
      setInstalling(null);
    }
  };

  const scopeCaption =
    platform.providers.length > 0
      ? `Searching ${platform.providers.join(', ')} only`
      : 'Nothing installed can be searched for this service yet';

  /**
   * Card states for both rails at once.
   *
   * A platform page draws the provider's own rows and the listings rows, and
   * the same film routinely appears in both — one call for the union keeps
   * them in the same state rather than resolving the two independently.
   */
  const { interactionFor } = useTitleInteractions(
    useMemo(
      () => [
        ...sections.flatMap((section) => section.items),
        ...metaSections.flatMap((section) => section.items),
      ],
      [sections, metaSections]
    )
  );

  const fetchRow = (section: LoadedSection) => {
    setSections((current) =>
      current.map((row) => (row.key === section.key ? { ...row, loading: true, fetched: true } : row))
    );
    void loadRow(section, 1);
  };

  /**
   * One provider row: a rail of its first page and "Show all", as on Home.
   * "Show all" opens the row as a grid that pages as it is scrolled — the
   * provider's own `getMainPage` paging, so the whole row is reachable.
   */
  const renderRow = (section: LoadedSection, labelProvider: boolean) => (
    <section className="home-row" key={section.key}>
      <header>
        <h3>
          {section.name}
          {labelProvider && <span className="ott-view__row-provider"> · {section.provider}</span>}
        </h3>
        {section.loading && <Loader2 size={12} className="spin" />}
        {section.error && <span className="ott-view__row-error">{section.error}</span>}
        {section.items.length > 0 && (
          <button type="button" className="home-row__more" onClick={() => showAll(section)}>
            Show all <ChevronRight size={14} aria-hidden />
          </button>
        )}
      </header>
      <div className="home-rail">
        {section.items.map((item, index) => (
          <PosterCard
            key={`${item.url}-${index}`}
            item={item}
            onSelectMedia={onSelectMedia}
            onPlayDirectly={onPlayDirectly}
            interaction={interactionFor(item)}
          />
        ))}
        {section.items.length > 0 && (
          <button
            type="button"
            className="home-rail__all"
            onClick={() => showAll(section)}
            aria-label={`Show all of ${section.name}`}
          >
            <span>Show all</span>
            <ChevronRight size={20} aria-hidden />
          </button>
        )}
        {/* An unfetched row is announced, so a rail below the fold does not
            read as an empty one. */}
        {!section.loading && section.items.length === 0 && !section.error && (
          <button type="button" className="ott-view__more" onClick={() => fetchRow(section)}>
            Show {section.name}
          </button>
        )}
      </div>
    </section>
  );

  if (category && category.platformId === platform.id) {
    return (
      <CategoryGrid<OttCategoryState>
        category={category}
        onChange={onCategoryChange}
        onBack={() => onCategoryChange(null)}
        onOpen={onSelectMedia}
        onPlayDirectly={onPlayDirectly}
        loadPage={loadCategoryPage}
        backLabel={platform.name}
      />
    );
  }

  return (
    <div className="ott-view">
      <header
        className="ott-view__header"
        style={{
          // The brand colour as a wash rather than a fill: enough to tell two
          // platform pages apart at a glance, not enough to fight the artwork
          // that is about to sit under it.
          background: `linear-gradient(135deg, ${platform.accent}33 0%, transparent 70%)`,
          borderLeft: `3px solid ${platform.accent}`,
        }}
      >
        <div>
          <h2>{platform.name}</h2>
          <p>{platform.tagline}</p>
        </div>
        {platform.availability !== 'missing' && (
          <form className="ott-view__search" onSubmit={submitSearch} role="search">
            <Search size={15} aria-hidden />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Filter ${platform.name} — Enter searches every provider`}
              aria-label={`Search ${platform.name}`}
            />
            {query && (
              <button type="button" onClick={() => setQuery('')} aria-label="Clear">
                <X size={14} />
              </button>
            )}
            <button type="submit" className="ott-view__search-go">
              Search
            </button>
          </form>
        )}
      </header>

      {platform.availability !== 'missing' && (
        <p className="ott-view__scope" title={scopeCaption}>
          <SlidersHorizontal size={12} aria-hidden /> {scopeCaption}
        </p>
      )}

      {notice && <div className="ott-view__notice">{notice}</div>}

      {/*
        The fix, not a pointer to where the fix lives.

        This offered only "Open Extensions", which is accurate and is PRD 43's
        F-1 exactly: a true statement with the work left to the reader. It is
        the harder version of that failure, too, because the sentence below
        names three possible switches and cannot say which — so the viewer
        arrived in Extensions knowing only that one of three things, somewhere
        in a tree, is off.

        `FixProvidersModal` plans each provider's whole cascade and turns the
        right switches. Extensions stays offered underneath for anyone who
        wants the tree itself.
      */}
      {platform.availability === 'disabled' && (
        <EmptyState
          icon={PlugZap}
          title={`${platform.name} is installed but switched off`}
          description={
            <>
              {platform.disabledProviders.join(', ')}{' '}
              {platform.disabledProviders.length === 1 ? 'is' : 'are'} turned off — either the
              provider itself, the extension that registered it, or the repository it came from.
              Turning any of those back on brings this page to life; nothing needs downloading
              again.
            </>
          }
          action={{ label: 'Turn it back on', onClick: () => setFixing(platform.disabledProviders) }}
          secondary={{ label: 'Open Extensions', onClick: onOpenExtensions }}
        />
      )}

      {fixing && (
        <FixProvidersModal
          providers={fixing}
          onClose={() => setFixing(null)}
          onFixed={() => {
            setFixing(null);
            // The platform's availability is computed in the main process from
            // what is enabled, so the page has to be told to re-read it — the
            // rows on screen were built from the old answer.
            onInventoryChanged?.();
          }}
        />
      )}

      {platform.availability === 'missing' && (
        <div className="ott-view__setup">
          <EmptyState
            icon={PlugZap}
            title={`Nothing installed serves ${platform.name} yet`}
            description={
              <>
                {platform.name} comes from a community extension, the same ones the Android app
                uses. Installing one of these adds it — and everything it registers stays under
                your control on the Extensions screen.
              </>
            }
          />
          <div className="ott-view__suggestions">
            {suggestions.map((suggestion) => (
              <article key={suggestion.id} className="ott-view__suggestion">
                <h4>{suggestion.name}</h4>
                <p>{suggestion.description}</p>
                <button
                  type="button"
                  disabled={installing !== null || suggestion.installed}
                  onClick={() => void install(suggestion.id)}
                >
                  {installing === suggestion.id ? (
                    <>
                      <Loader2 size={13} className="spin" /> Installing…
                    </>
                  ) : suggestion.installed ? (
                    'Already added'
                  ) : (
                    'Install'
                  )}
                </button>
              </article>
            ))}
          </div>
        </div>
      )}

      {loading && (
        <p className="ott-view__loading">
          <Loader2 size={14} className="spin" aria-hidden /> Reading {platform.name}'s catalogue…
        </p>
      )}

      {/*
        Whose catalogue is showing, and the others to switch to. Every provider
        that is this platform is offered — a NetMirror Netflix and CNC Verse's
        NetflixM are different libraries — with its row count so the fuller one
        is obvious before it is opened.
      */}
      {catalogs.length > 1 && (
        <div className="ott-view__providers" role="tablist" aria-label={`${platform.name} catalogues`}>
          {catalogs.map((entry) => (
            <button
              key={entry.provider}
              type="button"
              role="tab"
              aria-selected={entry.provider === activeProvider}
              className="ott-view__provider-tab"
              onClick={() => setActiveProvider(entry.provider)}
            >
              {entry.provider}
              <span className="ott-view__provider-count">{entry.sections.length} rows</span>
            </button>
          ))}
        </div>
      )}

      {catalogs.length === 1 && (
        <p className="ott-view__provider-single">Catalogue from {catalogs[0].provider}</p>
      )}

      {platform.availability === 'ready' &&
        !loading &&
        catalogs.length === 0 &&
        metaSections.length === 0 &&
        !metaLoading && (
          <EmptyState
            icon={Search}
            title={`${platform.name} has no catalogue to browse`}
            description={
              unbrowsable[0]?.reason ??
              'These providers only answer searches. Use the box above to find a title.'
            }
          />
        )}

      {/*
        * What is on the service, only when no installed provider publishes a
        * catalogue. A provider row is something this app can play and one of
        * these is only something that exists, so it is labelled, not blended.
        */}
      {catalogs.length === 0 && metaSections.length > 0 && (
        <div className="ott-view__meta">
          <div className="ott-view__meta-head">
            <Sparkles size={13} aria-hidden />
            <p>
              Popular on {platform.name} right now.{' '}
              {platform.availability !== 'ready'
                ? 'Nothing installed can play these yet — opening one searches every source you have.'
                : 'These come from a listings service, not from an installed extension: opening one searches every source you have for it.'}
            </p>
          </div>
          {metaSections.map((section) => (
            <section className="home-row" key={section.id}>
              <header>
                <h3>{section.title}</h3>
              </header>
              <div className="home-rail">
                {section.items.map((item, index) => (
                  <PosterCard
                    key={`${item.url}-${index}`}
                    item={item}
                    onSelectMedia={onSelectMedia}
                    onPlayDirectly={onPlayDirectly}
                    interaction={interactionFor(item)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {metaLoading && metaSections.length === 0 && metaSupported && (
        <p className="ott-view__loading">
          <Loader2 size={14} className="spin" aria-hidden /> Finding what is popular on{' '}
          {platform.name}…
        </p>
      )}

      {filtering && (
        <div className="ott-view__filter">
          <div className="ott-view__filter-head">
            <p>
              {titleMatches.length > 0
                ? `${titleMatches.length} title${titleMatches.length === 1 ? '' : 's'} on this page match “${query.trim()}”`
                : `Nothing loaded on this page matches “${query.trim()}”`}
              {rowMatches.length > 0 &&
                ` · ${rowMatches.length} row${rowMatches.length === 1 ? '' : 's'} named like it`}
            </p>
            {platform.providers.length > 0 && (
              <button
                type="button"
                className={titleMatches.length === 0 ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-secondary'}
                onClick={() => onScopedSearch(query.trim(), platform.providers)}
              >
                <Search size={12} aria-hidden /> Search all of {platform.name}
              </button>
            )}
          </div>
          {titleMatches.length > 0 && (
            <div className="poster-grid">
              {titleMatches.map(({ item }, index) => (
                <PosterCard
                  key={`${item.url}-${index}`}
                  item={item}
                  onSelectMedia={onSelectMedia}
                  onPlayDirectly={onPlayDirectly}
                  interaction={interactionFor(item)}
                />
              ))}
            </div>
          )}
          {rowMatches.map((section) => renderRow(section, catalogs.length > 1))}
        </div>
      )}

      {!filtering && visibleSections.map((section) => renderRow(section, false))}
    </div>
  );
};
