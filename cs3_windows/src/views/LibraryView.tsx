import React, { useCallback, useEffect, useState } from 'react';
import { EmptyState } from '../components/EmptyState';
import { PlayedSourcePanel } from '../components/library/PlayedSourcePanel';
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
  X,
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
type LibraryMode = 'watching' | 'saved';

const BUCKETS: Array<{ status: WatchStatus; label: string }> = [
  { status: 'Watching', label: 'Watching' },
  { status: 'Completed', label: 'Completed' },
  { status: 'OnHold', label: 'On hold' },
  { status: 'PlanToWatch', label: 'Plan to watch' },
  { status: 'Dropped', label: 'Dropped' },
];

function formatWatched(progress: WatchProgress | undefined): string | null {
  if (!progress || progress.durationSeconds <= 0) return null;
  const percent = Math.round((progress.positionSeconds / progress.durationSeconds) * 100);
  const remaining = Math.max(0, progress.durationSeconds - progress.positionSeconds);
  const minutes = Math.round(remaining / 60);
  return `${percent}% · ${minutes} min left`;
}

export const LibraryView: React.FC<LibraryViewProps> = ({
  onSelectMedia,
  onSearch,
  onPlaySavedSource,
  onBrowse,
}) => {
  const [mode, setMode] = useState<LibraryMode>('watching');
  const [activeStatus, setActiveStatus] = useState<WatchStatus>('Watching');
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [progressByKey, setProgressByKey] = useState<Map<string, WatchProgress>>(new Map());
  const [counts, setCounts] = useState<Record<string, number>>({});
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
  const [sourcesModalEntry, setSourcesModalEntry] = useState<LibraryEntry | null>(null);

  const shownBookmarks = providerFilter
    ? bookmarks.filter((bookmark) => bookmark.origin.provider === providerFilter)
    : bookmarks;

  const refresh = useCallback(async () => {
    if (!window.cloudstream) {
      setLoading(false);
      return;
    }
    setLoading(true);

    const all = await window.cloudstream.getLibraryEntries();
    const tally: Record<string, number> = {};
    for (const entry of all) tally[entry.status] = (tally[entry.status] ?? 0) + 1;
    setCounts(tally);
    setEntries(all.filter((e) => e.status === activeStatus));

    // Continue-watching rows are already collapsed to one per title, which is
    // exactly the granularity a poster card needs.
    const resume = await window.cloudstream.getContinueWatching(200);
    setProgressByKey(new Map(resume.map((p) => [p.key, p])));
    setLoading(false);
  }, [activeStatus]);

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
      apiName: 'Library',
      type: entry.type ?? TvType.Movie,
      posterUrl: entry.posterUrl,
      year: entry.year,
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
      <div>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#fff' }}>Library</h2>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          Titles you have watched or saved, with where you left off
        </p>
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
      </div>

      {mode === 'saved' ? (
        <SavedPages
          bookmarks={shownBookmarks}
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

            return (
              <div key={entry.key} className="poster-card">
                <div className="poster-container" onClick={(e) => openEntry(entry, e)}>
                  {entry.posterUrl ? (
                    <img src={entry.posterUrl} alt={entry.title} loading="lazy" />
                  ) : (
                    <div className="poster-image--empty">{entry.title.slice(0, 1)}</div>
                  )}
                  {entry.type && <span className="poster-badge">{entry.type}</span>}
                  <div className="poster-overlay">
                    <button className="play-button-overlay">
                      <Play size={20} fill="#fff" />
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
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSourcesModalEntry(entry);
                        }}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.3rem',
                          fontSize: '0.68rem',
                          fontWeight: 600,
                          padding: '0.15rem 0.45rem',
                          borderRadius: '4px',
                          backgroundColor: 'rgba(59, 130, 246, 0.12)',
                          color: '#60a5fa',
                          border: '1px solid rgba(59, 130, 246, 0.25)',
                          cursor: 'pointer',
                        }}
                        title="View saved sources"
                      >
                        <Database size={10} />
                        <span>{entry.sources.length} sources stored</span>
                      </button>
                    </div>
                  )}

                  <div className="library-card__actions">
                    <select
                      value={entry.status}
                      onChange={(e) => changeStatus(entry, e.target.value as WatchStatus)}
                      aria-label={`Status for ${entry.title}`}
                      style={{
                        backgroundColor: 'var(--bg-input, #1b2130)',
                        color: '#f3f4f6',
                        border: '1px solid var(--border-color, rgba(255, 255, 255, 0.12))',
                        borderRadius: '6px',
                        padding: '0.25rem 0.4rem',
                        fontSize: '0.75rem',
                        cursor: 'pointer',
                        flex: 1,
                      }}
                    >
                      {BUCKETS.map(({ status, label }) => (
                        <option key={status} value={status} style={{ backgroundColor: '#161b26', color: '#f3f4f6' }}>
                          {label}
                        </option>
                      ))}
                    </select>

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

      {/* Stored Sources Inspection Modal */}
      {sourcesModalEntry && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1.5rem',
          }}
          onClick={() => setSourcesModalEntry(null)}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '640px',
              maxHeight: '85vh',
              backgroundColor: '#161b26',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--border-color)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.85)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '1.1rem 1.4rem',
                borderBottom: '1px solid var(--border-color)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <div
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '8px',
                    backgroundColor: 'rgba(59, 130, 246, 0.15)',
                    color: '#60a5fa',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Database size={16} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#fff' }}>
                    Stored Sources — {sourcesModalEntry.title}
                  </h3>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-subtle)' }}>
                    {sourcesModalEntry.sources?.length ?? 0} saved sources available
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => handleRefreshSources(sourcesModalEntry)}
                  disabled={refreshingKey === sourcesModalEntry.key}
                  title="Re-check enabled providers and discover newly available sources"
                >
                  <RotateCw size={13} className={refreshingKey === sourcesModalEntry.key ? 'animate-spin' : ''} />
                  <span>Refresh Sources</span>
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setSourcesModalEntry(null)}
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            <div style={{ padding: '1.25rem 1.4rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
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

              <h4 className="played-source__section-heading">Everything discovery found</h4>
              {!sourcesModalEntry.sources || sourcesModalEntry.sources.length === 0 ? (
                <div style={{ padding: '2rem 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                  No sources currently stored. Click "Refresh Sources" to search and save available streams.
                </div>
              ) : (
                sourcesModalEntry.sources.map((src, idx) => (
                  <div
                    key={src.id || idx}
                    style={{
                      padding: '0.75rem 0.9rem',
                      borderRadius: 'var(--radius-md)',
                      backgroundColor: 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid var(--border-color)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.35rem',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontWeight: 700, fontSize: '0.85rem', color: '#fff', wordBreak: 'break-all' }}>
                        {src.title || src.sourceName}
                      </span>
                      {src.quality && (
                        <span
                          style={{
                            padding: '0.1rem 0.4rem',
                            borderRadius: '4px',
                            backgroundColor: 'rgba(59, 130, 246, 0.15)',
                            color: '#60a5fa',
                            fontSize: '0.7rem',
                            fontWeight: 700,
                          }}
                        >
                          {src.quality}
                        </span>
                      )}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.74rem', color: 'var(--text-muted)', flexWrap: 'wrap' }}>
                      <span>Provider: <strong style={{ color: 'var(--text-primary)' }}>{src.providerName || src.indexerName || 'Direct'}</strong></span>
                      {src.videoCodec && <span>Codec: <strong style={{ color: 'var(--text-primary)' }}>{src.videoCodec}</strong></span>}
                      {src.seeders !== undefined && <span>Seeders: <strong style={{ color: '#34d399' }}>{src.seeders}</strong></span>}
                      <span>Status: <strong style={{ color: src.status === 'Available' ? '#34d399' : '#fb7185' }}>{src.status || 'Available'}</strong></span>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div
              style={{
                padding: '0.9rem 1.4rem',
                borderTop: '1px solid var(--border-color)',
                display: 'flex',
                justifyContent: 'flex-end',
                backgroundColor: 'rgba(0,0,0,0.2)',
              }}
            >
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => {
                  openEntry(sourcesModalEntry);
                  setSourcesModalEntry(null);
                }}
              >
                <ExternalLink size={13} />
                <span>Open Media Page</span>
              </button>
            </div>
          </div>
        </div>
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
  providers: string[];
  providerFilter: string | null;
  onProviderFilter: (provider: string | null) => void;
  onOpen: (bookmark: Bookmark) => void;
  onRemove: (bookmark: Bookmark) => void;
  onSearch?: (query: string) => void;
}> = ({ bookmarks, providers, providerFilter, onProviderFilter, onOpen, onRemove, onSearch }) => {
  if (bookmarks.length === 0 && !providerFilter) {
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

      {bookmarks.length === 0 ? (
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
