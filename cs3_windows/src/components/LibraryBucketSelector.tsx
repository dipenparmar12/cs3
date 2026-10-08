import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bookmark, BookmarkCheck, Check, ChevronDown, ListChecks, ListPlus, Trash2 } from 'lucide-react';
import { isPlaceholderOrigin } from '../utils/originName';
import { BUCKET_LABELS, WatchStatus, type SearchResponse } from '../types/api';
import type { TorrentResult } from '../types/torrent';
import { torrentResultToStoredSource } from '../../electron/cs3/libraryStore';

interface LibraryBucketSelectorProps {
  item: SearchResponse;
  sources?: TorrentResult[];
  /**
   * What discovery is asked for on this title's behalf, when that is not its
   * page — the episode on screen. Sent with the add so its sources are saved.
   */
  sourceQuery?: { mediaUrl: string; season?: number; episode?: number };
  size?: 'sm' | 'md';
  onStatusChanged?: (newStatus: WatchStatus | null) => void;
  buttonClassName?: string;
  showLabel?: boolean;
  /**
   * The bucket, when the caller already knows it — `null` for "not in the
   * library", `undefined` for "ask".
   */
  known?: { key: string; status: WatchStatus } | null;
  /**
   * Ask only when the menu opens.
   *
   * For the button on every poster: asking on mount was one IPC round trip
   * per card, 834 of them on a real home screen, all to colour a button the
   * batched card states can colour on their own.
   */
  deferFetch?: boolean;
  /**
   * Open the dropdown automatically on mouse hover (used exclusively on detail page).
   */
  openOnHover?: boolean;
  /**
   * Button and menu visual variant. 'detail-action' strictly conforms to the
   * detail hero action buttons; 'poster' is a small round button that sits in
   * a poster's corner, so the control costs a card no height at all.
   */
  variant?: 'default' | 'detail-action' | 'poster' | 'icon';
}

const BUCKETS: Array<{ status: WatchStatus; label: string }> = [
  { status: WatchStatus.Watching, label: 'Watching' },
  { status: WatchStatus.Completed, label: 'Completed' },
  { status: WatchStatus.OnHold, label: 'On hold' },
  { status: WatchStatus.PlanToWatch, label: 'Plan to watch' },
  { status: WatchStatus.Dropped, label: 'Dropped' },
];

export const LibraryBucketSelector: React.FC<LibraryBucketSelectorProps> = ({
  item,
  sources,
  sourceQuery,
  size = 'md',
  onStatusChanged,
  buttonClassName,
  showLabel = true,
  known,
  deferFetch = false,
  openOnHover = false,
  variant = 'default',
}) => {
  const [open, setOpen] = useState(false);
  const [currentStatus, setCurrentStatus] = useState<WatchStatus | null>(known?.status ?? null);
  const [entryKey, setEntryKey] = useState<string | null>(known?.key ?? null);
  const [loading, setLoading] = useState(false);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseEnter = useCallback(() => {
    if (!openOnHover) return;
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    setOpen(true);
  }, [openOnHover]);

  const handleMouseLeave = useCallback(() => {
    if (!openOnHover) return;
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
    hoverTimeoutRef.current = setTimeout(() => {
      setOpen(false);
    }, 180);
  }, [openOnHover]);

  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
    };
  }, []);

  // What the caller knows wins whenever it changes; asking is the fallback.
  const knownStatus = known === undefined ? undefined : (known?.status ?? null);
  const knownKey = known === undefined ? undefined : (known?.key ?? null);
  useEffect(() => {
    if (knownStatus === undefined) return;
    setCurrentStatus(knownStatus);
    setEntryKey(knownKey ?? null);
  }, [knownStatus, knownKey]);

  const shouldFetch = known === undefined && (!deferFetch || open);
  useEffect(() => {
    if (!shouldFetch) return;
    let active = true;
    const fetchStatus = async () => {
      if (!window.cloudstream || !item || !item.url) return;
      const entry = await window.cloudstream.getLibraryEntryForUrl(item.url);
      if (active && entry) {
        setCurrentStatus(entry.status);
        setEntryKey(entry.key);
      } else if (active) {
        setCurrentStatus(null);
        setEntryKey(null);
      }
    };
    fetchStatus();
    return () => {
      active = false;
    };
  }, [item?.url, shouldFetch]);

  useEffect(() => {
    if (!open) return;
    const handleOutside = () => setOpen(false);
    document.addEventListener('click', handleOutside);
    return () => document.removeEventListener('click', handleOutside);
  }, [open]);

  const selectStatus = async (status: WatchStatus) => {
    if (!window.cloudstream) return;
    setLoading(true);
    try {
      const storedSources = sources?.length
        ? sources.map(torrentResultToStoredSource)
        : undefined;

      const updated = await window.cloudstream.upsertLibraryEntry({
        title: item.name,
        year: item.year,
        type: item.type,
        posterUrl: item.posterUrl,
        mediaUrl: item.url,
        status,
        sources: storedSources,
        sourceQuery: sourceQuery?.mediaUrl !== item.url ? sourceQuery : undefined,
        // Where it was found, kept with the entry: a library row that can only
        // say "Library" cannot be searched for again.
        metadata: !isPlaceholderOrigin(item.apiName) ? { provider: item.apiName } : undefined,
      });

      // Record library added history event
      await window.cloudstream.recordHistoryEvent?.({
        title: item.name,
        year: item.year,
        type: item.type,
        posterUrl: item.posterUrl,
        mediaUrl: item.url,
        action: 'library_added',
        status: 'Unchecked',
        sourcesDiscovered: storedSources,
        metadata: { bucket: status },
      });

      setCurrentStatus(status);
      setEntryKey(updated?.key ?? null);
      onStatusChanged?.(status);
    } finally {
      setLoading(false);
      setOpen(false);
    }
  };

  const removeEntry = async () => {
    if (!window.cloudstream || !entryKey) return;
    setLoading(true);
    try {
      await window.cloudstream.removeLibraryEntry(entryKey);
      await window.cloudstream.recordHistoryEvent?.({
        title: item.name,
        year: item.year,
        type: item.type,
        posterUrl: item.posterUrl,
        mediaUrl: item.url,
        action: 'library_removed',
        status: 'Unchecked',
      });
      setCurrentStatus(null);
      setEntryKey(null);
      onStatusChanged?.(null);
    } finally {
      setLoading(false);
      setOpen(false);
    }
  };

  const isDetailAction = variant === 'detail-action';
  const isPoster = variant === 'poster';
  // The detail hero's round icon button: same control, the hero's shape.
  const isIcon = variant === 'icon';
  // The poster corner uses the detail menu's look: one dropdown style for the
  // same five choices wherever they are offered.
  const menuLikeDetail = isDetailAction || isPoster || isIcon;

  return (
    <div
      className={isPoster ? `poster-bucket${currentStatus ? ' poster-bucket--on' : ''}${open ? ' poster-bucket--open' : ''}` : undefined}
      style={isPoster ? undefined : { position: 'relative', display: isDetailAction || isIcon ? 'inline-flex' : 'inline-block' }}
      onMouseEnter={openOnHover ? handleMouseEnter : undefined}
      onMouseLeave={openOnHover ? handleMouseLeave : undefined}
    >
      {isIcon ? (
        <button
          type="button"
          className={`detail-icon${currentStatus ? ' detail-icon--on' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            setOpen((v) => !v);
          }}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={currentStatus ? `In library: ${BUCKET_LABELS[currentStatus]}` : 'Add to library'}
          title={currentStatus ? `Library: ${BUCKET_LABELS[currentStatus]}` : 'Add to a library list'}
        >
          {currentStatus ? <ListChecks size={17} /> : <ListPlus size={17} />}
        </button>
      ) : isPoster ? (
        <button
          type="button"
          className="poster-bucket__button"
          onClick={(e) => {
            e.stopPropagation();
            setOpen((v) => !v);
          }}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={currentStatus ? `In library: ${BUCKET_LABELS[currentStatus]}` : 'Add to library'}
          title={currentStatus ? `Library: ${BUCKET_LABELS[currentStatus]}` : 'Add to library'}
        >
          {currentStatus ? <BookmarkCheck size={14} /> : <Bookmark size={14} />}
        </button>
      ) : isDetailAction ? (
        <button
          type="button"
          className={`detail-action${currentStatus ? ' detail-action--on' : ''}${buttonClassName ? ` ${buttonClassName}` : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            setOpen((v) => !v);
          }}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="Add to library bucket"
          title={currentStatus ? `Library: ${BUCKET_LABELS[currentStatus]}` : 'Add to library'}
        >
          <Bookmark size={15} />
          {showLabel && (
            <span>{currentStatus ? BUCKET_LABELS[currentStatus] : 'Add to library'}</span>
          )}
          <ChevronDown size={13} />
        </button>
      ) : (
        <button
          type="button"
          className={buttonClassName || `btn ${size === 'sm' ? 'btn-secondary' : 'btn-secondary'}`}
          style={{
            padding: size === 'sm' ? '0.25rem 0.5rem' : '0.45rem 0.85rem',
            fontSize: size === 'sm' ? '0.75rem' : '0.85rem',
            gap: '0.35rem',
            alignItems: 'center',
            borderColor: currentStatus ? 'var(--accent-primary)' : undefined,
            backgroundColor: currentStatus ? 'rgba(59, 130, 246, 0.15)' : undefined,
            color: currentStatus ? '#60a5fa' : undefined,
          }}
          onClick={(e) => {
            e.stopPropagation();
            setOpen((v) => !v);
          }}
          aria-label="Add to library bucket"
        >
          <Bookmark size={size === 'sm' ? 14 : 16} style={{ color: currentStatus ? '#60a5fa' : undefined }} />
          {showLabel && (
            <span>{currentStatus ? BUCKET_LABELS[currentStatus] : 'Add to Library'}</span>
          )}
          <ChevronDown size={size === 'sm' ? 12 : 14} />
        </button>
      )}

      {open && (
        menuLikeDetail ? (
          <div
            className={`detail-menu detail-menu--bucket${isPoster ? ' poster-bucket__menu' : ''}`}
            role="menu"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="detail-menu__header">Library Bucket</div>
            {BUCKETS.map((b) => {
              const isSelected = currentStatus === b.status;
              return (
                <button
                  key={b.status}
                  type="button"
                  role="menuitem"
                  className={`detail-menu__item${isSelected ? ' detail-menu__item--active' : ''}`}
                  onClick={() => selectStatus(b.status)}
                  disabled={loading}
                >
                  <span>{b.label}</span>
                  {isSelected && <Check size={14} className="detail-menu__check" />}
                </button>
              );
            })}

            {currentStatus && (
              <>
                <div className="detail-menu__divider" />
                <button
                  type="button"
                  role="menuitem"
                  className="detail-menu__item detail-menu__item--remove"
                  onClick={removeEntry}
                  disabled={loading}
                >
                  <Trash2 size={13} />
                  <span>Remove from library</span>
                </button>
              </>
            )}
          </div>
        ) : (
          <div
            style={{
              position: 'absolute',
              top: 'calc(100% + 4px)',
              left: 0,
              zIndex: 99999,
              minWidth: '160px',
              backgroundColor: '#161b26',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-md)',
              boxShadow: '0 10px 30px rgba(0,0,0,0.7)',
              padding: '0.35rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.2rem',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-subtle)', padding: '0.2rem 0.4rem', textTransform: 'uppercase' }}>
              Library Bucket
            </div>
            {BUCKETS.map((b) => {
              const isSelected = currentStatus === b.status;
              return (
                <button
                  key={b.status}
                  type="button"
                  onClick={() => selectStatus(b.status)}
                  disabled={loading}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0.4rem 0.6rem',
                    fontSize: '0.78rem',
                    color: isSelected ? '#60a5fa' : '#e5e7eb',
                    backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
                    border: 'none',
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <span>{b.label}</span>
                  {isSelected && <Check size={14} style={{ color: '#60a5fa' }} />}
                </button>
              );
            })}

            {currentStatus && (
              <>
                <div style={{ height: '1px', backgroundColor: 'var(--border-color)', margin: '0.2rem 0' }} />
                <button
                  type="button"
                  onClick={removeEntry}
                  disabled={loading}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    padding: '0.4rem 0.6rem',
                    fontSize: '0.75rem',
                    color: '#ef4444',
                    backgroundColor: 'transparent',
                    border: 'none',
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                  }}
                >
                  <Trash2 size={13} /> Remove from library
                </button>
              </>
            )}
          </div>
        )
      )}
    </div>
  );
};
