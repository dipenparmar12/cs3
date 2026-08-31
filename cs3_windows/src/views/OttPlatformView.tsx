import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, PlugZap, Search, SlidersHorizontal, Sparkles, X } from 'lucide-react';
import type { ProviderCatalog, ProviderCatalogSection, SearchResponse } from '../types/api';
import { PosterCard } from '../components/PosterCard';
import { EmptyState } from '../components/EmptyState';
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
 * ## Four states, and none of them is a blank page
 *
 * `ready`, `disabled`, `aggregate`, `missing` each get their own answer,
 * because they need different actions from the user: nothing, a switch, an
 * explanation, or an install. Collapsing them into "no content" is the failure
 * this component exists to avoid — a user who turned a provider off last week
 * being told the platform does not exist.
 */

export interface OttPlatformSummary {
  id: string;
  name: string;
  tagline: string;
  accent: string;
  availability: 'ready' | 'disabled' | 'aggregate' | 'missing';
  providers: string[];
  disabledProviders: string[];
  carriedBy: string[];
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
}

interface LoadedSection extends ProviderCatalogSection {
  provider: string;
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
}) => {
  const [catalog, setCatalog] = useState<ProviderCatalog | null>(null);
  const [sections, setSections] = useState<LoadedSection[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<
    Array<{ id: string; name: string; description: string; installed: boolean }>
  >([]);
  const [installing, setInstalling] = useState<string | null>(null);
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
          if (row.name !== section.name) return row;
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

  useEffect(() => {
    let cancelled = false;
    setCatalog(null);
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
    if (platform.availability !== 'ready') return;

    setLoading(true);
    void api()?.getOttCatalog(platform.id).then((response) => {
      if (cancelled) return;
      setLoading(false);
      if (!response.ok || !response.catalog) return;

      setCatalog(response.catalog);
      const rows: LoadedSection[] = response.catalog.sections.map((section, index) => ({
        ...section,
        provider: response.catalog!.provider,
        items: [],
        page: 1,
        hasNext: false,
        loading: index < INITIAL_ROWS,
      }));
      setSections(rows);
      for (const row of rows.slice(0, INITIAL_ROWS)) void loadRow(row, 1);
    });

    return () => {
      cancelled = true;
    };
  }, [platform.id, platform.availability, loadRow]);

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
              placeholder={`Search ${platform.name}`}
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
          action={{ label: 'Open Extensions', onClick: onOpenExtensions }}
        />
      )}

      {platform.availability === 'aggregate' && (
        <EmptyState
          icon={Sparkles}
          title={`${platform.name} is covered by ${platform.carriedBy.join(' and ')}`}
          description={
            <>
              No extension publishes a provider named after {platform.name}, so there is no
              catalogue to browse here. {platform.carriedBy.join(' and ')} carries its titles,
              and the search box above asks it directly.
            </>
          }
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

      {platform.availability === 'ready' && !loading && sections.length === 0 && (
        <EmptyState
          icon={Search}
          title={`${platform.name} has no catalogue to browse`}
          description={
            catalog?.unavailableReason ??
            'This provider only answers searches. Use the box above to find a title.'
          }
        />
      )}

      {sections.map((section) => (
        <section className="home-row" key={`${section.provider}:${section.name}`}>
          <header>
            <h3>{section.name}</h3>
            {section.loading && <Loader2 size={12} className="spin" />}
            {section.error && <span className="ott-view__row-error">{section.error}</span>}
          </header>
          <div className="home-rail">
            {section.items.map((item, index) => (
              <PosterCard
                key={`${item.url}-${index}`}
                item={item}
                onSelectMedia={onSelectMedia}
                onPlayDirectly={onPlayDirectly}
              />
            ))}
            {/*
              Paging is a button rather than an infinite scroll. Each page is a
              live scrape of a third-party site, and a rail that fetches
              whenever it drifts past the edge of the viewport turns idle
              scrolling into sustained traffic against someone else's server.
            */}
            {section.hasNext && !section.loading && (
              <button
                type="button"
                className="ott-view__more"
                onClick={() => {
                  setSections((current) =>
                    current.map((row) =>
                      row.name === section.name ? { ...row, loading: true } : row
                    )
                  );
                  void loadRow(section, section.page + 1);
                }}
              >
                Load more
              </button>
            )}
            {/* An unfetched row is announced, so a rail below the fold does not
                read as an empty one. */}
            {!section.loading && section.items.length === 0 && !section.error && (
              <button
                type="button"
                className="ott-view__more"
                onClick={() => {
                  setSections((current) =>
                    current.map((row) =>
                      row.name === section.name ? { ...row, loading: true } : row
                    )
                  );
                  void loadRow(section, 1);
                }}
              >
                Show {section.name}
              </button>
            )}
          </div>
        </section>
      ))}
    </div>
  );
};
