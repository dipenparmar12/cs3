import React, { useEffect, useState } from 'react';
import { Bookmark, Check, ChevronDown, Trash2 } from 'lucide-react';
import { BUCKET_LABELS, WatchStatus, type SearchResponse } from '../types/api';
import type { TorrentResult } from '../types/torrent';
import { torrentResultToStoredSource } from '../../electron/cs3/libraryStore';

interface LibraryBucketSelectorProps {
  item: SearchResponse;
  sources?: TorrentResult[];
  size?: 'sm' | 'md';
  onStatusChanged?: (newStatus: WatchStatus | null) => void;
  buttonClassName?: string;
  showLabel?: boolean;
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
  size = 'md',
  onStatusChanged,
  buttonClassName,
  showLabel = true,
}) => {
  const [open, setOpen] = useState(false);
  const [currentStatus, setCurrentStatus] = useState<WatchStatus | null>(null);
  const [entryKey, setEntryKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
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
  }, [item?.url]);

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
      setEntryKey(updated.key);
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

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
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

      {open && (
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
      )}
    </div>
  );
};
