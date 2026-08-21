import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { SearchResponse } from '../types/api';
import { matchesTab, tabsFor } from '../utils/contentTypes';
import { Play, History, Loader2, RefreshCw, Sparkles, X, Trash2 } from 'lucide-react';
import type { WatchProgress } from '../../electron/cs3/libraryStore';
import type { DiscoverySection } from '../../electron/cs3/discovery';
import { TvType } from '../types/api';
import { PosterCard } from '../components/PosterCard';

/**
 * The home screen, built from what is actually popular.
 *
 * It used to run three hardcoded searches — `Spider-Man`, `One Piece`,
 * `Stranger Things` — against every installed extension provider, and label the
 * results "Trending". Two things were wrong with that and the second is worse
 * than the first. The obvious problem is that the front page never changed. The
 * real one is that a site scraper has no opinion about what is popular: asking
 * thirty providers for "Spider-Man" and calling the answer trending was a
 * category error, and it cost the slowest scraper's timeout on every launch.
 *
 * Discovery now comes from catalogue services that do know — and that need no
 * API key, which was the binding constraint. Sources are still resolved by the
 * providers, but only once the user opens something. That separation is what
 * lets this page be instant and current at the same time.
 */

interface HomeViewProps {
  onSelectMedia: (item: SearchResponse) => void;
  /** Quick-play from the card, bypassing the detail page. */
  onPlayDirectly?: (item: SearchResponse) => void;
  /**
   * Runs a search.
   *
   * Needed because not every catalogue item is addressable. AniList's trending
   * anime carry no IMDb id, so their cards are addressed by title and open
   * through search rather than straight into a detail page.
   */
  onSearch?: (query: string) => void;
}

export const HomeView: React.FC<HomeViewProps> = ({
  onSelectMedia,
  onPlayDirectly,
  onSearch,
}) => {
  const [sections, setSections] = useState<DiscoverySection[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [continueWatching, setContinueWatching] = useState<WatchProgress[]>([]);
  const [typeTab, setTypeTab] = useState<string>('all');
  const [confirmClear, setConfirmClear] = useState(false);

  const loadSections = useCallback(async () => {
    if (!window.cloudstream?.getDiscoverySections) {
      setLoading(false);
      return;
    }
    try {
      const response = await window.cloudstream.getDiscoverySections();
      if (response?.ok) {
        setSections(response.sections ?? []);
        setError(null);
      } else {
        setError(response?.error ?? 'Could not load the catalogue.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSections();
  }, [loadSections]);

  /**
   * Continue watching is local and lands first.
   *
   * Loaded separately rather than as another discovery section, because it
   * needs no network at all — putting it behind the same await would make the
   * one row that is instantly available wait for the ones that are not.
   */
  useEffect(() => {
    let mounted = true;
    window.cloudstream?.getContinueWatching(12).then((rows) => {
      if (mounted) setContinueWatching(rows);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await window.cloudstream?.refreshDiscovery?.();
    await loadSections();
    setRefreshing(false);
  }, [loadSections]);

  /** Opens a card, or searches for it when it has no addressable id. */
  const open = useCallback(
    (item: SearchResponse) => {
      if (item.url.startsWith('search://')) {
        onSearch?.(decodeURIComponent(item.url.slice('search://'.length)));
        return;
      }
      onSelectMedia(item);
    },
    [onSelectMedia, onSearch]
  );

  const allItems = useMemo(
    () => sections.flatMap((section) => section.items),
    [sections]
  );
  const typeTabs = useMemo(() => tabsFor(allItems), [allItems]);
  const activeTab = typeTabs.some((tab) => tab.id === typeTab) ? typeTab : 'all';

  const visibleSections = useMemo(
    () =>
      sections
        .map((section) => ({
          ...section,
          items: section.items.filter((item) => matchesTab(item, activeTab)),
        }))
        .filter((section) => section.items.length > 0),
    [sections, activeTab]
  );

  const hero = sections[0]?.items[0];
  const hasAnything = sections.length > 0 || continueWatching.length > 0;

  if (loading && !hasAnything) {
    return (
      <div className="home-loading">
        <Loader2 size={28} className="spin" />
        <h3>Loading what’s popular right now</h3>
        <p>Trending films and series, refreshed a few times a day.</p>
      </div>
    );
  }

  return (
    <div className="home">
      {/*
        The hero is the top of the first section rather than a separate fetch.

        It used to describe itself as "Featured Live Title" with a sentence
        about multi-provider community repositories — copy about the app's
        architecture, on the largest element of its front page.
      */}
      {hero && (
        <div
          className="home-hero"
          style={
            hero.posterUrl
              ? {
                  backgroundImage: `linear-gradient(90deg, rgba(10,10,12,0.96) 0%, rgba(10,10,12,0.55) 60%, rgba(10,10,12,0.25) 100%), url(${hero.posterUrl})`,
                }
              : undefined
          }
        >
          <div className="home-hero__body">
            <span className="home-hero__eyebrow">
              <Sparkles size={13} /> {sections[0].title}
            </span>
            <h2>{hero.name}</h2>
            {hero.year && <p className="home-hero__meta">{hero.year}</p>}
            <button className="btn btn-primary" onClick={() => open(hero)}>
              <Play size={16} fill="#fff" />
              <span>Watch now</span>
            </button>
          </div>
        </div>
      )}

      <div className="home-toolbar">
        {typeTabs.length > 1 && (
          <div className="type-tabs" role="tablist" aria-label="Filter by content type">
            <button
              role="tab"
              aria-selected={activeTab === 'all'}
              className={`type-tabs__tab${activeTab === 'all' ? ' type-tabs__tab--on' : ''}`}
              onClick={() => setTypeTab('all')}
            >
              All <span>{allItems.length}</span>
            </button>
            {typeTabs.map((tab) => (
              <button
                key={tab.id}
                role="tab"
                aria-selected={activeTab === tab.id}
                className={`type-tabs__tab${activeTab === tab.id ? ' type-tabs__tab--on' : ''}`}
                onClick={() => setTypeTab(tab.id)}
              >
                {tab.label} <span>{tab.count}</span>
              </button>
            ))}
          </div>
        )}

        <button
          className="home-refresh"
          onClick={() => void refresh()}
          disabled={refreshing}
          title="Fetch the catalogues again now"
        >
          <RefreshCw size={13} className={refreshing ? 'spin' : undefined} />
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error && sections.length === 0 && (
        <p className="home-error">
          {error} — showing nothing rather than something stale. The rest of the app is
          unaffected; search still works.
        </p>
      )}

      {/* Local, so it lands before anything from the network. */}
      {continueWatching.length > 0 && (
        <section className="home-row">
          <header>
            <History size={17} />
            <h3>Continue watching</h3>
            {/*
              Inline rather than a modal. A modal over the home screen to
              confirm tidying a row is a heavier interruption than the action
              deserves — and the sentence it needs to say is short enough to fit
              here, which is what makes the confirmation meaningful rather than
              a reflex "Are you sure?".
            */}
            {confirmClear ? (
              <span className="home-row__confirm">
                Clear the row? Your positions are kept — anything you open again
                resumes where you left off.
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    void window.cloudstream?.clearContinueWatching().then(() => {
                      setContinueWatching([]);
                      setConfirmClear(false);
                    });
                  }}
                >
                  Clear
                </button>
                <button type="button" className="btn btn-sm btn-secondary" onClick={() => setConfirmClear(false)}>
                  Keep
                </button>
              </span>
            ) : (
              <button
                type="button"
                className="home-row__action"
                onClick={() => setConfirmClear(true)}
                title="Clear Continue watching"
              >
                <Trash2 size={13} /> Clear all
              </button>
            )}
          </header>
          <div className="home-rail">
            {continueWatching.map((row) => {
              const percent = row.durationSeconds
                ? (row.positionSeconds / row.durationSeconds) * 100
                : 0;
              const minutesLeft = Math.round(
                Math.max(0, row.durationSeconds - row.positionSeconds) / 60
              );

              return (
                <div
                  key={`${row.key}-${row.season ?? ''}-${row.episode ?? ''}`}
                  className="poster-card"
                  onClick={(event) => {
                    (event.currentTarget as HTMLElement)?.blur();
                    (document.activeElement as HTMLElement)?.blur();
                    onSelectMedia({
                      name: row.title,
                      url: row.mediaUrl,
                      apiName: 'Continue watching',
                      type: TvType.Movie,
                      posterUrl: row.posterUrl,
                    });
                  }}
                >
                  <div className="poster-container">
                    {row.posterUrl ? (
                      <img src={row.posterUrl} alt="" loading="lazy" />
                    ) : (
                      <div className="poster-image poster-image--empty">
                        {row.title.slice(0, 1)}
                      </div>
                    )}
                    <div className="poster-overlay">
                      <button className="play-button-overlay">
                        <Play size={20} fill="#fff" />
                      </button>
                    </div>
                    {/*
                      Removes the title from this row and nothing else. The
                      position is kept, so opening it again still resumes — and
                      watching more of it brings the card back, which is what
                      someone who removed it by accident would expect.

                      `stopPropagation` because the whole card is a play target.
                    */}
                    <button
                      type="button"
                      className="poster-dismiss"
                      title="Remove from Continue watching (your position is kept)"
                      aria-label={`Remove ${row.title} from Continue watching`}
                      onClick={(event) => {
                        event.stopPropagation();
                        void window.cloudstream?.dismissContinueWatching(row.key);
                        setContinueWatching((rows) => rows.filter((r) => r.key !== row.key));
                      }}
                    >
                      <X size={13} />
                    </button>
                    <div className="poster-progress">
                      <div style={{ width: `${Math.min(100, percent)}%` }} />
                    </div>
                  </div>

                  <div className="poster-info">
                    <h4 className="poster-title">{row.title}</h4>
                    <div className="poster-meta">
                      <span>
                        {row.season != null && row.episode != null
                          ? `S${row.season}E${row.episode}`
                          : `${Math.round(percent)}% watched`}
                      </span>
                      <span className="poster-meta__accent">{minutesLeft} min left</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {visibleSections.map((section) => (
        <section className="home-row" key={section.id}>
          <header>
            <h3>{section.title}</h3>
            {section.subtitle && <span className="home-row__subtitle">{section.subtitle}</span>}
            {section.refreshing && <Loader2 size={12} className="spin" />}
          </header>
          {/*
            A rail rather than a grid. A grid of six rows each thirty items long
            is a wall; a rail keeps every section's first few items visible so
            the page can be scanned vertically before anything is scrolled
            horizontally.
          */}
          <div className="home-rail">
            {section.items.map((item, index) => (
              <PosterCard
                key={`${item.url}-${index}`}
                item={item}
                onSelectMedia={open}
                onPlayDirectly={item.url.startsWith('search://') ? undefined : onPlayDirectly}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
};
