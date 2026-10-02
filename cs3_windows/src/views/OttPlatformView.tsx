import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTitleInteractions } from '../components/useTitleInteractions';
import { ChevronRight, Loader2, PlugZap, Search, SlidersHorizontal, Sparkles, X } from 'lucide-react';
import type { ProviderCatalog, ProviderCatalogPage, SearchResponse } from '../types/api';
import type { HomeCategoryState } from './homeCategoryState';
import { applyPage, itemsForRow, rowsFromCatalog, type CatalogueRow } from './ottRows';
import { describeError } from '../utils/errors';
import { CategoryGrid } from '../components/home/CategoryGrid';
import { PosterCard } from '../components/PosterCard';
import { EmptyState } from '../components/EmptyState';
import { FixProvidersModal } from '../components/FixProvidersModal';
import { useFlash } from '../utils/useFlash';
import { acknowledgeAdult, isAdultAcknowledged } from '../utils/adultNotice';

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
  /** Declared adult (NSFW) by its provider: badged, and warned before loading. */
  adult?: boolean;
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
  /** Leaves the page — the adult warning's "Go back". */
  onLeave: () => void;
}

/** One provider row opened as a full grid. */
export interface OttCategoryState extends HomeCategoryState {
  platformId: string;
  provider: string;
  section: { name: string; data: string; horizontalImages?: boolean };
  /** For a row split out of a multi-list answer: which list to page. */
  list?: string;
}

/**
 * Fires `onVisible` once, when the node comes within a screen of the viewport.
 *
 * A row fetches itself as it is scrolled to — no "Show this row" button to
 * press — while a catalogue of forty rows still costs only the ones somebody
 * actually scrolls past. Each fetch is a live scrape of someone's site, so the
 * margin is about a screen, not the whole page.
 */
const RowTrigger: React.FC<{ onVisible: () => void }> = ({ onVisible }) => {
  const node = useRef<HTMLDivElement>(null);
  const callback = useRef(onVisible);
  callback.current = onVisible;
  useEffect(() => {
    const element = node.current;
    if (!element) return;
    if (typeof IntersectionObserver === 'undefined') {
      callback.current();
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          callback.current();
        }
      },
      { rootMargin: '600px 0px' }
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return <div ref={node} aria-hidden className="ott-view__row-trigger" />;
};

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

/** How long a cached catalogue or row counts as fresh: inside it, nothing is re-fetched. */
const FRESH_MS = 10 * 60 * 1000;
/** How long the viewer stays on a page before stale rows are refreshed behind it. */
const DWELL_MS = 3000;

/**
 * The preload bridge, or nothing.
 *
 * `window.cloudstream` is optional in the renderer's types because the same
 * components render in contexts that have no preload — and a non-null
 * assertion here would turn that into a runtime `TypeError` inside a `.then`,
 * which surfaces as a blank page rather than as a missing bridge.
 */
const api = () => window.cloudstream;


export const OttPlatformView: React.FC<OttPlatformViewProps> = ({
  platform,
  onSelectMedia,
  onPlayDirectly,
  onScopedSearch,
  onOpenExtensions,
  onInventoryChanged,
  category,
  onCategoryChange,
  onLeave,
}) => {
  /*
   * An adult catalogue asks first, once per launch. Until it is answered the
   * page fetches nothing — not the catalogue, not the listings — so declining
   * contacts no adult site at all.
   */
  const [adultAccepted, setAdultAccepted] = useState(isAdultAcknowledged);
  const ageCheckPending = Boolean(platform.adult) && !adultAccepted;
  const [catalogs, setCatalogs] = useState<Array<ProviderCatalog & { fetchedAt?: number }>>([]);
  /** Providers that matched the platform but publish nothing to browse. */
  const [unbrowsable, setUnbrowsable] = useState<Array<{ provider: string; reason: string }>>([]);
  /**
   * Whose catalogue is on screen. One provider at a time, as Android's home
   * screen does: two providers' rows interleaved is a list neither meant, and
   * fetching every provider's rows at once is a burst of scrapes nobody asked for.
   */
  const [activeProvider, setActiveProvider] = useState<string | null>(null);
  /** The provider whose catalogue is being read right now, for the progress line. */
  const [pendingProvider, setPendingProvider] = useState<string | null>(null);
  const [sections, setSections] = useState<CatalogueRow[]>([]);
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

  /**
   * Fetches one page of a row and folds it in (`ottRows.applyPage`). Answered
   * from the main process's cache when there is one, so a page opened before
   * draws at once; `refresh` asks the provider and is `quiet` — it never blanks
   * or errors a row that is already showing something.
   */
  const loadRow = useCallback(
    async (row: CatalogueRow, page: number, refresh = false) => {
      const forPlatform = platformRef.current;
      const bridge = api();
      if (!bridge) return;
      let answer: ProviderCatalogPage | { error: string };
      try {
        const response = await bridge.getOttCatalogPage(row.provider, row.request, page, { refresh });
        answer =
          response.ok && response.page
            ? response.page
            : { error: response.error ?? 'That row could not be loaded.' };
      } catch (error) {
        answer = { error: describeError(error) };
      }
      if (platformRef.current !== forPlatform) return;
      setSections((current) => applyPage(current, row.key, page, answer, { quiet: refresh }));
    },
    []
  );

  /*
   * Rows fetch themselves when scrolled into view (`RowTrigger`), so there is
   * no "first N rows" effect beside it — two triggers for one row is the same
   * page scraped twice. `started` is the guard: an observer callback can land
   * after the state that would have told it the row was already asked for.
   */
  const started = useRef(new Set<string>());
  useEffect(() => {
    started.current = new Set();
  }, [platform.id]);

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
    setLoading(false);

    // Adult catalogue not yet confirmed this launch: fetch nothing.
    if (ageCheckPending) {
      return () => {
        cancelled = true;
      };
    }

    /*
     * Third-party listings are fetched at once, in parallel, and shown only
     * until a provider's own rows arrive. Waiting for the providers first left
     * the page blank for as long as the extension runtime took to load them —
     * minutes, behind the background warm-up.
     */
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

    if (platform.availability !== 'ready') {
      return () => {
        cancelled = true;
      };
    }

    /*
     * One provider at a time, each drawn the moment it answers. Serial because
     * the JVM loads providers serially anyway (§5), and asking for all of them
     * at once only queues the first one behind the rest. The first provider
     * with a catalogue opens; the others join the tabs as they land.
     */
    const providers = platform.providers;
    setLoading(providers.length > 0);
    void (async () => {
      for (const provider of providers) {
        if (cancelled) return;
        setPendingProvider(provider);
        let response: Awaited<ReturnType<NonNullable<ReturnType<typeof api>>['getOttProviderCatalog']>> | null =
          null;
        try {
          // Cached when this provider has been opened before — instant.
          response = (await api()?.getOttProviderCatalog(platform.id, provider)) ?? null;
        } catch {
          response = null;
        }
        if (cancelled) return;
        const catalog = response?.ok ? response.catalog : null;
        if (catalog?.hasMainPage && catalog.sections.length > 0) {
          setCatalogs((current) => [...current, catalog]);
          setSections((current) => [...current, ...rowsFromCatalog(catalog)]);
          setActiveProvider((current) => current ?? catalog.provider);
        } else {
          setUnbrowsable((current) => [
            ...current,
            {
              provider,
              reason:
                catalog?.unavailableReason ??
                response?.error ??
                'Publishes no catalogue — search it instead.',
            },
          ]);
        }
      }
      if (!cancelled) {
        setLoading(false);
        setPendingProvider(null);
      }
    })();

    return () => {
      cancelled = true;
    };
    // The provider list is compared by value: the platform object is rebuilt on
    // every inventory refresh, and identity would restart the whole load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platform.id, platform.availability, platform.providers.join('\u0000'), ageCheckPending]);

  const visibleSections = useMemo(
    () => sections.filter((row) => row.provider === activeProvider),
    [sections, activeProvider]
  );
  const providerHasItems = sections.some((row) => row.items.length > 0);

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

  const showAll = (section: CatalogueRow) =>
    onCategoryChange({
      platformId: platform.id,
      provider: section.provider,
      section: section.request,
      list: section.list,
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
    if (response.page.error) return { ok: false, error: response.page.error };
    // A row split out of a multi-list answer pages its own list, not all of them.
    return {
      ok: true,
      items: itemsForRow({ list: current.list }, response.page),
      hasNext: response.page.hasNext,
    };
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

  /** `retry` re-asks a row that failed; otherwise a row is fetched once. */
  const fetchRow = (section: CatalogueRow, retry = false) => {
    if (started.current.has(section.key) && !retry) return;
    started.current.add(section.key);
    setSections((current) =>
      current.map((row) =>
        row.key === section.key ? { ...row, loading: true, fetched: true, error: undefined } : row
      )
    );
    void loadRow(section, 1);
  };

  /*
   * Background refresh, once per visit and only after the viewer has stayed
   * `DWELL_MS`: rows older than `FRESH_MS` are re-asked quietly, one request
   * per provider answer (split rows share theirs), so what is on screen updates
   * in place and nothing flashes back to a spinner. Paging through services or
   * coming back from a title inside the fresh window fetches nothing at all.
   */
  const sectionsRef = useRef(sections);
  sectionsRef.current = sections;
  const catalogsRef = useRef(catalogs);
  catalogsRef.current = catalogs;
  useEffect(() => {
    if (!activeProvider || ageCheckPending) return;
    const timer = window.setTimeout(() => {
      const now = Date.now();
      const asked = new Set<string>();
      const stale = sectionsRef.current.filter((row) => {
        if (row.provider !== activeProvider || !row.fetchedAt || row.loading) return false;
        if (now - row.fetchedAt < FRESH_MS) return false;
        const request = row.parent ?? row.key;
        if (asked.has(request)) return false;
        asked.add(request);
        return true;
      });
      const forPlatform = platformRef.current;
      void (async () => {
        // The row list itself: a provider that adds or drops a row is picked
        // up, while rows that still exist keep what they are showing.
        const known = catalogsRef.current.find((c) => c.provider === activeProvider);
        if (known?.fetchedAt && now - known.fetchedAt >= FRESH_MS) {
          const response = await api()
            ?.getOttProviderCatalog(forPlatform, activeProvider, { refresh: true })
            .catch(() => null);
          const fresh = response?.ok ? response.catalog : null;
          if (platformRef.current === forPlatform && fresh?.hasMainPage && fresh.sections.length > 0) {
            const signature = (c: ProviderCatalog) => c.sections.map((s) => `${s.name}\u0000${s.data}`).join('\u0001');
            setCatalogs((current) => current.map((c) => (c.provider === activeProvider ? fresh : c)));
            if (signature(fresh) !== signature(known)) {
              const next = rowsFromCatalog(fresh);
              setSections((current) => {
                const mine = current.filter((row) => row.provider === activeProvider);
                const kept = next.flatMap((row) => {
                  const existing = mine.filter((m) => m.key === row.key || m.parent === row.key);
                  return existing.length > 0 ? existing : [row];
                });
                return [...current.filter((row) => row.provider !== activeProvider), ...kept];
              });
            }
          }
        }
        // One at a time — this is background work against someone's site.
        for (const row of stale) await loadRow(row, 1, true);
      })();
    }, DWELL_MS);
    return () => window.clearTimeout(timer);
  }, [activeProvider, ageCheckPending, loadRow]);

  /**
   * One provider row: a rail of its first page and "Show all", as on Home.
   * "Show all" opens the row as a grid that pages as it is scrolled — the
   * provider's own `getMainPage` paging, so the whole row is reachable.
   */
  const renderRow = (section: CatalogueRow, labelProvider: boolean) => (
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
        {/* Placeholders while the row's first page is on its way, so a row
            that is loading never reads as an empty one. */}
        {section.items.length === 0 &&
          !section.error &&
          (!section.fetched || section.loading) &&
          Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="ott-view__placeholder" aria-hidden />
          ))}
        {section.items.length === 0 && section.fetched && !section.loading && !section.error && (
          <p className="ott-view__row-empty">Nothing in this row right now.</p>
        )}
        {section.error && (
          <button type="button" className="ott-view__more" onClick={() => fetchRow(section, true)}>
            Try again
          </button>
        )}
      </div>
      {!section.fetched && <RowTrigger onVisible={() => fetchRow(section)} />}
    </section>
  );

  if (ageCheckPending) {
    return (
      <div className="ott-view">
        <div className="ott-view__age-gate" role="alertdialog" aria-labelledby="ott-age-title" aria-describedby="ott-age-body">
          <span className="ott-view__age-badge" aria-hidden>18+</span>
          <h2 id="ott-age-title">{platform.name} contains adult content</h2>
          <p id="ott-age-body">
            Its provider declares this catalogue as adult (18+) material, which may include explicit
            sexual content. Continue only if you are 18 or older and it is legal to view where you
            are. Nothing from it has been loaded yet.
          </p>
          <p className="ott-view__age-note">
            You will be asked again the next time CloudStream starts. Adult content can be turned off
            entirely in Settings.
          </p>
          <div className="ott-view__age-actions">
            <button type="button" className="btn btn-secondary" onClick={onLeave} autoFocus>
              Go back
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                acknowledgeAdult();
                setAdultAccepted(true);
              }}
            >
              I am 18 or older — show it
            </button>
          </div>
        </div>
      </div>
    );
  }

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
        <p className="ott-view__loading" role="status">
          <Loader2 size={14} className="spin" aria-hidden />
          {pendingProvider
            ? ` Reading ${pendingProvider}'s catalogue (${
                catalogs.length + unbrowsable.length + 1
              } of ${platform.providers.length})…`
            : ` Reading ${platform.name}'s catalogue…`}
          {catalogs.length === 0 &&
            ' The first time, an extension has to be loaded before it can answer.'}
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
        * What is on the service, until an installed provider's own rows have
        * something in them — so the page is never blank while extensions load.
        * A provider row is something this app can play and one of these is
        * only something that exists, so it is labelled, not blended.
        */}
      {!filtering && !providerHasItems && metaSections.length > 0 && (
        <div className="ott-view__meta">
          <div className="ott-view__meta-head">
            <Sparkles size={13} aria-hidden />
            <p>
              Popular on {platform.name} right now.{' '}
              {platform.availability !== 'ready'
                ? 'Nothing installed can play these yet — opening one searches every source you have.'
                : loading
                  ? 'Shown while the installed providers load their own catalogues; opening one searches every source you have.'
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
