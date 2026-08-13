import React, { useCallback, useEffect, useState } from 'react';
import { Trash2, Star, Clock, Play, Library as LibraryIcon } from 'lucide-react';
import type { SearchResponse } from '../types/api';
import { TvType } from '../types/api';
import type { LibraryEntry, WatchProgress, WatchStatus } from '../../electron/cs3/libraryStore';

/**
 * The user's own library, built from what they actually watched.
 *
 * This view previously displayed two hardcoded titles with stock photography —
 * the same entries for every user, regardless of what they had ever opened.
 * Everything here now comes from recorded watch state.
 */

interface LibraryViewProps {
  onSelectMedia: (item: SearchResponse) => void;
}

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

export const LibraryView: React.FC<LibraryViewProps> = ({ onSelectMedia }) => {
  const [activeStatus, setActiveStatus] = useState<WatchStatus>('Watching');
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [progressByKey, setProgressByKey] = useState<Map<string, WatchProgress>>(new Map());
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

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
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '0.6rem',
            padding: '4rem 2rem',
            color: 'var(--text-muted)',
            textAlign: 'center',
          }}
        >
          <LibraryIcon size={30} />
          <p style={{ fontWeight: 600, color: '#e5e7eb' }}>Nothing in {activeStatus} yet</p>
          <span style={{ fontSize: '0.82rem', maxWidth: '46ch', lineHeight: 1.5 }}>
            Titles land here automatically as you watch them, and you can move any of them
            between buckets from the card.
          </span>
        </div>
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
    </div>
  );
};
