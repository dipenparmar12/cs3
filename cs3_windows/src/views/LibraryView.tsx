import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { ResumeTarget } from '../types/player';
import { providerFromAddress } from '../utils/originName';
import { useTitleInteractions } from '../components/useTitleInteractions';
import { badgeLabel, badgeTooltip, cardStateFor, primaryBadge } from '../utils/cardState';
import { EmptyState } from '../components/EmptyState';
import { PlayedSourcePanel } from '../components/library/PlayedSourcePanel';
import { SavedSourcesList } from '../components/library/SavedSourcesList';
import { SavedSearchesList } from '../components/library/SavedSearchesList';
import { ScreenSearch, ScreenSearchNoMatches } from '../components/ScreenSearch';
import { useScreenSearch } from '../utils/useScreenSearch';
import { Button, Dialog, DialogActions, Select } from '../components/ui';
import { matchesScreenQuery } from '../utils/screenSearch';
import type { PlayedSource } from '../types/library';
import type { TorrentResult } from '../types/torrent';
import {
  Trash2,
  Star,
  Clock,
  Play,
  Library as LibraryIcon,
  BookmarkCheck,
  Search,
  RotateCw,
  Database,
  ExternalLink,
} from 'lucide-react';
import type { SearchResponse } from '../types/api';
import { TvType } from '../types/api';
import type { LibraryEntry, WatchProgress, WatchStatus } from '../../electron/cs3/libraryStore';
import type { Bookmark } from '../../electron/cs3/bookmarkStore';

/**
 * The user's own library, built from what they actually watched.
 *
 * This view previously displayed two hardcoded titles with stock photography —
 * the same entries for every user, regardless of what they had ever opened.
 * Everything here now comes from recorded watch state.
 */

interface LibraryViewProps {
  onSelectMedia: (item: SearchResponse) => void;
  /** Plays a library title: its remembered episode, source and position. */
  onResume?: (target: ResumeTarget) => void;
  /**
   * Plays a source the library had saved as working.
   *
   * The panel resolves it — reusing the stored link or re-resolving a dead one —
   * and hands back a live source; playing it is App's job because that is where
   * the player lives.
   */
  onPlaySavedSource?: (source: TorrentResult, record: PlayedSource) => void;
  /** Re-runs the search a saved page was originally found by. */
  onSearch?: (query: string) => void;
  /**
   * Somewhere to go from an empty bucket.
   *
   * A library with nothing in it is the *first* screen a new user reaches here,
   * and reporting emptiness without offering the action that ends it leaves them
   * exactly where they were.
   */
  onBrowse?: () => void;
  /** Reopens a saved search on the search screen. */
  onOpenSavedSearch?: (id: string) => void;
}

/**
 * Two different questions, so two views.
 *
 * The buckets answer "what am I watching" and collapse every provider's copy of
 * a title into one entry — deliberately, since watch progress belongs to the
 * film and not to whoever served it. Saved pages answer "take me back to the
 * exact page I was on", which needs the opposite: the specific address, from
 * the specific provider. Neither can be expressed as a bucket of the other.
 */
type LibraryMode = 'watching' | 'saved' | 'searches';

const BUCKETS: Array<{ status: WatchStatus; label: string }> = [
  { status: 'Watching', label: 'Watching' },
  { status: 'Completed', label: 'Completed' },
  { status: 'OnHold', label: 'On hold' },
  { status: 'PlanToWatch', label: 'Plan to watch' },
  { status: 'Dropped', label: 'Dropped' },
];

/** What a shelf entry is found by: the names it goes by and what it is. */
const entryMatches = (entry: LibraryEntry, query: string) =>
  matchesScreenQuery(query, [
    entry.title,
    entry.originalTitle,
    entry.year,
    entry.type,
    entry.genres,
    BUCKETS.find((bucket) => bucket.status === entry.status)?.label,
  ]);

/** A saved page is also found by where it came from and what found it. */
const bookmarkMatches = (bookmark: Bookmark, query: string) =>
  matchesScreenQuery(query, [
    bookmark.title,
    bookmark.year,
    bookmark.type,
    bookmark.genres,
    bookmark.origin.provider,
    bookmark.origin.extensionName,
    bookmark.origin.repositoryName,
    bookmark.origin.searchQuery,
    bookmark.origin.imdbId,
  ]);

function formatWatched(progress: WatchProgress | undefined): string | null {
  if (!progress || progress.durationSeconds <= 0) return null;
  const percent = Math.round((progress.positionSeconds / progress.durationSeconds) * 100);
  const remaining = Math.max(0, progress.durationSeconds - progress.positionSeconds);
  const minutes = Math.round(remaining / 60);
  return `${percent}% · ${minutes} min left`;
}

export const LibraryView: React.FC<LibraryViewProps> = ({
  onSelectMedia,
  onResume,
  onSearch,
  onPlaySavedSource,
  onBrowse,
  onOpenSavedSearch,
}) => {
  /** Every entry in every bucket; the bucket and the find query narrow it on screen. */
  const [allEntries, setAllEntries] = useState<LibraryEntry[]>([]);
  const [query, setQuery] = useScreenSearch('library');
  const searching = query.trim() !== '';

  const [mode, setMode] = useState<LibraryMode>('watching');
  const [savedSearchCount, setSavedSearchCount] = useState(0);

  useEffect(() => {
    void window.cloudstream?.listSavedSearches?.().then((list) => setSavedSearchCount(list?.length ?? 0));
  }, []);
  const [activeStatus, setActiveStatus] = useState<WatchStatus>('Watching');
  const [savedSearchMatches, setSavedSearchMatches] = useState<number | undefined>(undefined);

  /** Entries the query leaves, across every bucket — what the bucket chips count. */
  const found = useMemo(
    () => (searching ? allEntries.filter((entry) => entryMatches(entry, query)) : allEntries),
    [allEntries, query, searching]
  );
  const entries = useMemo(
    () => found.filter((entry) => entry.status === activeStatus),
    [found, activeStatus]
  );
  const counts = useMemo(() => {
    const tally: Record<string, number> = {};
    for (const entry of found) tally[entry.status] = (tally[entry.status] ?? 0) + 1;
    return tally;
  }, [found]);

  /**
   * Card states for the whole shelf.
   *
   * Queried by each entry's first known provider URL — the aggregator answers
   * the title-keyed halves regardless, and the address-keyed ones for the row
   * that actually has one. Asked for every bucket at once, so neither
   * switching buckets nor typing in the find field asks again.
   */
  const { interactionFor } = useTitleInteractions(
    useMemo(
      () =>
        allEntries.map((entry) => ({
          url: entry.urls?.[0] ?? entry.key,
          name: entry.title,
          year: entry.year,
        })),
      [allEntries]
    )
  );
  const [progressByKey, setProgressByKey] = useState<Map<string, WatchProgress>>(new Map());
  const [loading, setLoading] = useState(true);

  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  /** Narrows saved pages to one provider — the "only this source" the brief asks for. */
  const [providerFilter, setProviderFilter] = useState<string | null>(null);
  const [bookmarkFacets, setBookmarkFacets] = useState<{ providers: string[] }>({ providers: [] });

  const refreshBookmarks = useCallback(async () => {
    const response = await window.cloudstream?.listBookmarks?.();
    if (!response?.ok) return;
    setBookmarks(response.bookmarks ?? []);
    setBookmarkFacets({ providers: response.facets?.providers ?? [] });
  }, []);

  useEffect(() => {
    void refreshBookmarks();
  }, [refreshBookmarks]);

  /**
   * Reopens a saved page at the exact address it was saved from.
   *
   * `apiName` carries the original provider rather than a placeholder, so the
   * detail page resolves through the same extension it did the first time —
   * which is the whole point of having saved the page rather than the title.
   */
  const openBookmark = (bookmark: Bookmark) => {
    (document.activeElement as HTMLElement)?.blur();
    onSelectMedia({
      name: bookmark.title,
      url: bookmark.mediaUrl,
      apiName: bookmark.origin.provider ?? 'Saved',
      type: (bookmark.type as TvType) ?? TvType.Movie,
      posterUrl: bookmark.posterUrl,
      year: bookmark.year,
    });
  };

  const removeBookmark = async (bookmark: Bookmark) => {
    await window.cloudstream?.removeBookmark?.(bookmark.mediaUrl);
    void refreshBookmarks();
  };

  const [refreshingKey, setRefreshingKey] = useState<string | null>(null);
  /*
   * Held by key and read from `entries`, so a Refresh inside the dialog shows
   * the refreshed list — holding the entry object kept the pre-refresh copy on
   * screen until the dialog was closed and reopened.
   */
  const [sourcesModalKey, setSourcesModalKey] = useState<string | null>(null);
  const sourcesModalEntry = allEntries.find((entry) => entry.key === sourcesModalKey) ?? null;
  const setSourcesModalEntry = (entry: LibraryEntry | null) => setSourcesModalKey(entry?.key ?? null);

  const shownBookmarks = bookmarks.filter(
    (bookmark) =>
      (!providerFilter || bookmark.origin.provider === providerFilter) &&
      (!searching || bookmarkMatches(bookmark, query))
  );

  const refresh = useCallback(async () => {
    if (!window.cloudstream) {
      setLoading(false);
      return;
    }
    setLoading(true);

    setAllEntries(await window.cloudstream.getLibraryEntries());

    // Continue-watching rows are already collapsed to one per title, which is
    // exactly the granularity a poster card needs.
    const resume = await window.cloudstream.getContinueWatching(200);
    setProgressByKey(new Map(resume.map((p) => [p.key, p])));
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleRefreshSources = async (entry: LibraryEntry, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!window.cloudstream || !entry.urls[0]) return;
    setRefreshingKey(entry.key);
    try {
      await window.cloudstream.refreshLibrarySources?.(
        entry.urls[0],
        entry.title,
        entry.year
      );
      await refresh();
    } finally {
      setRefreshingKey(null);
    }
  };

  const openEntry = (entry: LibraryEntry, e?: React.MouseEvent) => {
    if (e) (e.currentTarget as HTMLElement)?.blur();
    (document.activeElement as HTMLElement)?.blur();
    // Entries collapse every provider URL seen for a title. The first is the one
    // it was originally added from, which is the most likely to still resolve.
    const url = entry.urls[0];
    if (!url) return;
    onSelectMedia({
      name: entry.title,
      url,
      // The provider the address names; "Library" is where the viewer found it
      // today, not where it came from.
      apiName: providerFromAddress(url) ?? entry.metadata?.provider ?? 'Library',
      type: entry.type ?? TvType.Movie,
      posterUrl: entry.posterUrl,
      year: entry.year,
    });
  };

  /**
   * Play, not "open": the remembered episode, source and position, straight
   * into the player. The overlay button drew a Play icon and did nothing of
   * its own — the click fell through to the card and opened the page.
   */
  const playEntry = (entry: LibraryEntry, e?: React.MouseEvent) => {
    e?.stopPropagation();
    (document.activeElement as HTMLElement)?.blur();
    const url = entry.urls[0];
    if (!url) return;
    if (!onResume) {
      openEntry(entry);
      return;
    }
    onResume({
      title: entry.title,
      year: entry.year,
      mediaUrl: url,
      posterUrl: entry.posterUrl,
      key: entry.key,
      preferRecordedOrigin: true,
    });
  };

  const changeStatus = async (entry: LibraryEntry, status: WatchStatus) => {
    await window.cloudstream?.setLibraryStatus(entry.key, status);
    refresh();
  };

  const remove = async (entry: LibraryEntry) => {
    await window.cloudstream?.removeLibraryEntry(entry.key);
    refresh();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div className="screen-head">
        <div className="screen-head__titles">
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#fff' }}>Library</h2>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Titles you have watched or saved, with where you left off
          </p>
        </div>
        <ScreenSearch
          label={mode === 'searches' ? 'saved searches' : mode === 'saved' ? 'saved pages' : 'library'}
          value={query}
          onChange={setQuery}
          matches={
            mode === 'searches'
              ? savedSearchMatches
              : mode === 'saved'
                ? shownBookmarks.length
                : loading
                  ? undefined
                  : entries.length
          }
          hint={
            mode === 'searches'
              ? 'queries'
              : mode === 'saved'
                ? 'titles, years, genres and where each page came from'
                : 'titles, original titles, years, types and genres'
          }
        />
      </div>

      <div className="library-modes" role="tablist">
        <button
          role="tab"
          aria-selected={mode === 'watching'}
          className={`chip ${mode === 'watching' ? 'active' : ''}`}
          onClick={() => setMode('watching')}
        >
          <LibraryIcon size={13} /> Watching
        </button>
        <button
          role="tab"
          aria-selected={mode === 'saved'}
          className={`chip ${mode === 'saved' ? 'active' : ''}`}
          onClick={() => setMode('saved')}
        >
          <BookmarkCheck size={13} /> Saved pages{bookmarks.length ? ` (${bookmarks.length})` : ''}
        </button>
        <button
          role="tab"
          aria-selected={mode === 'searches'}
          className={`chip ${mode === 'searches' ? 'active' : ''}`}
          onClick={() => setMode('searches')}
        >
          <Search size={13} /> Saved searches{savedSearchCount ? ` (${savedSearchCount})` : ''}
        </button>
      </div>

      {mode === 'searches' ? (
        <SavedSearchesList
          onOpen={(id) => onOpenSavedSearch?.(id)}
          onCount={setSavedSearchCount}
          query={query}
          onMatches={setSavedSearchMatches}
          onClearQuery={() => setQuery('')}
        />
      ) : mode === 'saved' ? (
        <SavedPages
          bookmarks={shownBookmarks}
          query={searching ? query : ''}
          onClearQuery={() => setQuery('')}
          providers={bookmarkFacets.providers}
          providerFilter={providerFilter}
          onProviderFilter={setProviderFilter}
          onOpen={openBookmark}
          onRemove={removeBookmark}
          onSearch={onSearch}
        />
      ) : (
        <>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {BUCKETS.map(({ status, label }) => (
          <button
            key={status}
            onClick={() => setActiveStatus(status)}
            className={`chip ${activeStatus === status ? 'active' : ''}`}
          >
            {label}
            {counts[status] ? ` (${counts[status]})` : ''}
          </button>
        ))}
      </div>

      {loading ? (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading…</p>
      ) : searching && entries.length === 0 ? (
        <ScreenSearchNoMatches
          query={query}
          where={BUCKETS.find((bucket) => bucket.status === activeStatus)?.label ?? activeStatus}
          onClear={() => setQuery('')}
          elsewhere={BUCKETS.filter(({ status }) => counts[status]).map(({ status, label }) => ({
            label: `${label} (${counts[status]})`,
            onClick: () => setActiveStatus(status),
          }))}
        />
      ) : entries.length === 0 ? (
        <EmptyState
          icon={LibraryIcon}
          title={`Nothing in ${activeStatus} yet`}
          description="Titles land here automatically as you watch them, and you can move any of them between buckets from the card."
          action={onBrowse ? { label: 'Browse titles', onClick: onBrowse } : undefined}
        />
      ) : (
        <div className="poster-grid">
          {entries.map((entry) => {
            const progress = progressByKey.get(entry.key);
            const watched = formatWatched(progress);
            const percent =
              progress && progress.durationSeconds > 0
                ? (progress.positionSeconds / progress.durationSeconds) * 100
                : 0;

            /*
             * The same card language as every other grid in the app.
             *
             * This screen draws its own markup rather than `PosterCard` — the
             * rows carry a bucket selector, a rating and a stored-source
             * button that a search result does not — so the states are applied
             * by hand here. They come from the same record and the same rule,
             * which is what stops a title looking different on two screens.
             *
             * Addressed by the first provider URL the entry has seen, because
             * that is what `outcome` and source readiness are keyed on; the
             * watch and download halves are keyed on the title and answer for
             * any of them.
             */
            const interaction = interactionFor({ url: entry.urls?.[0] });
            const cardState = cardStateFor(interaction);
            const stateBadge = primaryBadge(cardState);

            return (
              <div
                key={entry.key}
                className={`poster-card${cardState.visited ? ' poster-card--visited' : ''}`}
              >
                <div className="poster-container" onClick={(e) => openEntry(entry, e)}>
                  {entry.posterUrl ? (
                    <img src={entry.posterUrl} alt={entry.title} loading="lazy" />
                  ) : (
                    <div className="poster-image--empty">{entry.title.slice(0, 1)}</div>
                  )}
                  {entry.type && <span className="poster-badge">{entry.type}</span>}
                  {stateBadge && (
                    <span
                      className={`poster-state poster-state--${stateBadge}`}
                      title={badgeTooltip(stateBadge, interaction)}
                    >
                      <span className="poster-state__label">{badgeLabel(stateBadge)}</span>
                    </span>
                  )}
                  <div className="poster-overlay">
                    <button
                      type="button"
                      className="play-button-overlay"
                      aria-label={`Play ${entry.title}`}
                      title={progressByKey.get(entry.key) ? 'Resume' : 'Play'}
                      onClick={(e) => playEntry(entry, e)}
                    >
                      <Play size={17} fill="#fff" />
                    </button>
                  </div>
                  {percent > 0 && (
                    <div className="poster-progress">
                      <div style={{ width: `${Math.min(100, percent)}%` }} />
                    </div>
                  )}
                </div>

                <div className="poster-info">
                  <h4 className="poster-title" title={entry.title} onClick={(e) => openEntry(entry, e)}>
                    {entry.title}
                  </h4>
                  <div className="poster-meta">
                    {entry.year && <span>{entry.year}</span>}
                    {entry.userRating != null && (
                      <span>
                        <Star size={11} /> {entry.userRating}
                      </span>
                    )}
                  </div>
                  {watched && (
                    <div className="poster-resume">
                      <Clock size={11} /> {watched}
                    </div>
                  )}

                  {entry.sources && entry.sources.length > 0 && (
                    <div style={{ marginTop: '0.2rem' }}>
                      <Button
                        size="compact"
                        variant="ambient"
                        icon={Database}
                        className="library-card__sources"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSourcesModalEntry(entry);
                        }}
                        title="View saved sources"
                      >
                        {entry.sources.length} saved sources
                      </Button>
                    </div>
                  )}

                  <div className="library-card__actions">
                    <Select
                      size="compact"
                      className="library-card__status"
                      value={entry.status}
                      onChange={(e) => changeStatus(entry, e.target.value as WatchStatus)}
                      aria-label={`Status for ${entry.title}`}
                      options={BUCKETS.map(({ status, label }) => ({ value: status, label }))}
                    />

                    <button
                      className="icon-button"
                      onClick={(e) => handleRefreshSources(entry, e)}
                      aria-label={`Refresh sources for ${entry.title}`}
                      title="Refresh sources from enabled providers"
                      disabled={refreshingKey === entry.key}
                      style={{ color: '#60a5fa' }}
                    >
                      <RotateCw size={13} className={refreshingKey === entry.key ? 'animate-spin' : ''} />
                    </button>

                    <button
                      className="icon-button"
                      onClick={() => remove(entry)}
                      aria-label={`Remove ${entry.title}`}
                      title="Remove from library"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
        </>
      )}

      {/* Stored sources for one title. */}
      {sourcesModalEntry && (
        <Dialog
          size="lg"
          icon={<Database size={18} />}
          title={`Saved sources — ${sourcesModalEntry.title}`}
          description={`${sourcesModalEntry.sources?.length ?? 0} kept with this title`}
          onClose={() => setSourcesModalEntry(null)}
          footer={
            <DialogActions
              start={
                <Button
                  size="compact"
                  icon={RotateCw}
                  loading={refreshingKey === sourcesModalEntry.key}
                  onClick={() => handleRefreshSources(sourcesModalEntry)}
                  title="Re-check enabled providers and discover newly available sources"
                >
                  {refreshingKey === sourcesModalEntry.key ? 'Refreshing…' : 'Refresh'}
                </Button>
              }
            >
              <Button onClick={() => setSourcesModalEntry(null)}>Close</Button>
              <Button
                variant="prominent"
                icon={ExternalLink}
                onClick={() => {
                  openEntry(sourcesModalEntry);
                  setSourcesModalEntry(null);
                }}
              >
                Open media page
              </Button>
            </DialogActions>
          }
        >
          {/* What actually played comes first: it is the answer to the
              question the list below can only guess at. */}
          <div className="played-source__section">
            <h4>The source that played</h4>
            <PlayedSourcePanel
              libraryKey={sourcesModalEntry.key}
              onPlay={(source, record) => {
                setSourcesModalEntry(null);
                onPlaySavedSource?.(source, record);
              }}
            />
          </div>

          <h4 className="played-source__section-heading">Everything found for it</h4>
          <SavedSourcesList
            entry={sourcesModalEntry}
            onPlay={(source, record) => {
              setSourcesModalEntry(null);
              onPlaySavedSource?.(source, record);
            }}
            onOpenPage={() => {
              openEntry(sourcesModalEntry);
              setSourcesModalEntry(null);
            }}
          />
        </Dialog>
      )}
    </div>
  );
};

/**
 * The saved pages list.
 *
 * A list rather than a poster grid: what distinguishes two saved pages is often
 * *where they came from* rather than their artwork — the same film saved from
 * two providers is two entries, and a grid of identical posters would make that
 * look like a bug. The origin chain is therefore on the row, not behind a hover.
 */
const SavedPages: React.FC<{
  bookmarks: Bookmark[];
  /** The find query already applied to `bookmarks`, or empty. */
  query: string;
  onClearQuery: () => void;
  providers: string[];
  providerFilter: string | null;
  onProviderFilter: (provider: string | null) => void;
  onOpen: (bookmark: Bookmark) => void;
  onRemove: (bookmark: Bookmark) => void;
  onSearch?: (query: string) => void;
}> = ({ bookmarks, query, onClearQuery, providers, providerFilter, onProviderFilter, onOpen, onRemove, onSearch }) => {
  if (bookmarks.length === 0 && !providerFilter && !query) {
    return (
      <div className="library-empty">
        <BookmarkCheck size={30} />
        <p>No saved pages yet</p>
        <span>
          Press <strong>Save</strong> on any title’s page and it will appear here — with the
          provider, extension and repository it came from, so you can reopen exactly that page
          without searching for it again.
        </span>
      </div>
    );
  }

  return (
    <>
      {providers.length > 1 && (
        <div className="saved-filters">
          <button
            className={`chip ${providerFilter === null ? 'active' : ''}`}
            onClick={() => onProviderFilter(null)}
          >
            All sources
          </button>
          {providers.map((provider) => (
            <button
              key={provider}
              className={`chip ${providerFilter === provider ? 'active' : ''}`}
              onClick={() => onProviderFilter(provider === providerFilter ? null : provider)}
            >
              {provider}
            </button>
          ))}
        </div>
      )}

      {bookmarks.length === 0 && query ? (
        <ScreenSearchNoMatches
          query={query}
          where={providerFilter ? `saved pages from ${providerFilter}` : 'saved pages'}
          onClear={onClearQuery}
        />
      ) : bookmarks.length === 0 ? (
        <p className="muted">Nothing saved from {providerFilter}.</p>
      ) : (
        <ul className="saved-list">
          {bookmarks.map((bookmark) => {
            const chain = [
              bookmark.origin.repositoryName,
              bookmark.origin.extensionName,
              bookmark.origin.provider,
            ].filter(Boolean) as string[];

            return (
              <li key={bookmark.id} className="saved-row">
                <button
                  className="saved-row__art"
                  onClick={() => onOpen(bookmark)}
                  aria-label={`Open ${bookmark.title}`}
                >
                  {bookmark.posterUrl ? (
                    <img src={bookmark.posterUrl} alt="" loading="lazy" />
                  ) : (
                    <span>{bookmark.title.slice(0, 1)}</span>
                  )}
                </button>

                <div className="saved-row__body">
                  <button className="saved-row__title" onClick={() => onOpen(bookmark)}>
                    {bookmark.title}
                    {bookmark.year ? <span className="muted"> ({bookmark.year})</span> : null}
                  </button>

                  <p className="saved-row__origin">
                    {chain.length > 0 ? chain.join(' ▸ ') : 'Origin not recorded'}
                    {bookmark.origin.metadataSource && ` · metadata: ${bookmark.origin.metadataSource}`}
                    {bookmark.origin.imdbId && ` · ${bookmark.origin.imdbId}`}
                  </p>

                  {bookmark.plot && <p className="saved-row__plot">{bookmark.plot}</p>}

                  {bookmark.genres && bookmark.genres.length > 0 && (
                    <div className="saved-row__tags">
                      {bookmark.genres.slice(0, 5).map((genre) => (
                        <span key={genre} className="badge badge--muted">
                          {genre}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="saved-row__actions">
                  <button
                    className="icon-button"
                    onClick={() => onOpen(bookmark)}
                    title="Open this page again"
                    aria-label={`Open ${bookmark.title}`}
                  >
                    <Play size={14} />
                  </button>
                  {onSearch && bookmark.origin.searchQuery && (
                    <button
                      className="icon-button"
                      onClick={() => onSearch(bookmark.origin.searchQuery!)}
                      title={`Search “${bookmark.origin.searchQuery}” again`}
                      aria-label="Run the original search again"
                    >
                      <Search size={14} />
                    </button>
                  )}
                  <button
                    className="icon-button"
                    onClick={() => onRemove(bookmark)}
                    title="Remove from saved pages"
                    aria-label={`Remove ${bookmark.title}`}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
};
