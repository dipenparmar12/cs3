import React, { useCallback, useEffect, useState } from 'react';
import {
  History as HistoryIcon,
  Trash2,
  Search,
  RotateCw,
  Info,
  CheckCircle2,
  XCircle,
  Clock,
  Download,
  AlertTriangle,
  Film,
  Eye,
  Filter,
  ArrowUpDown,
  CheckSquare,
  Square,
  ExternalLink,
  Copy,
  Check,
  X,
} from 'lucide-react';
import type { SearchResponse } from '../types/api';
import { TvType } from '../types/api';
import type {
  HistoryEvent,
  HistoryFilter,
  HistoryStats,
  HistoryStatus,
} from '../types/history';

interface HistoryViewProps {
  onSelectMedia: (item: SearchResponse) => void;
  onPlayDirect?: (mediaItem: SearchResponse) => void;
}

const STATUS_CONFIG: Record<
  HistoryStatus,
  { label: string; bg: string; text: string; border: string; icon: React.FC<{ size?: number }> }
> = {
  Played: {
    label: 'Played',
    bg: 'rgba(16, 185, 129, 0.12)',
    text: '#34d399',
    border: 'rgba(16, 185, 129, 0.3)',
    icon: CheckCircle2,
  },
  Failed: {
    label: 'Playback Failed',
    bg: 'rgba(244, 63, 94, 0.12)',
    text: '#fb7185',
    border: 'rgba(244, 63, 94, 0.3)',
    icon: XCircle,
  },
  Downloaded: {
    label: 'Downloaded',
    bg: 'rgba(59, 130, 246, 0.12)',
    text: '#60a5fa',
    border: 'rgba(59, 130, 246, 0.3)',
    icon: Download,
  },
  'Download Failed': {
    label: 'Download Failed',
    bg: 'rgba(249, 115, 22, 0.12)',
    text: '#fb923c',
    border: 'rgba(249, 115, 22, 0.3)',
    icon: AlertTriangle,
  },
  Attempted: {
    label: 'Attempted',
    bg: 'rgba(245, 158, 11, 0.12)',
    text: '#fbbf24',
    border: 'rgba(245, 158, 11, 0.3)',
    icon: Clock,
  },
  Unchecked: {
    label: 'Unchecked',
    bg: 'rgba(148, 163, 184, 0.1)',
    text: '#94a3b8',
    border: 'rgba(148, 163, 184, 0.25)',
    icon: Eye,
  },
  Unknown: {
    label: 'Unknown',
    bg: 'rgba(148, 163, 184, 0.1)',
    text: '#94a3b8',
    border: 'rgba(148, 163, 184, 0.25)',
    icon: Info,
  },
};

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  const date = new Date(timestamp);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDuration(seconds?: number): string | null {
  if (!seconds || seconds <= 0) return null;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hrs}h ${remMins}m`;
}

export const HistoryView: React.FC<HistoryViewProps> = ({ onSelectMedia, onPlayDirect: _onPlayDirect }) => {
  const [events, setEvents] = useState<HistoryEvent[]>([]);
  const [stats, setStats] = useState<HistoryStats>({
    total: 0,
    played: 0,
    failed: 0,
    downloaded: 0,
    attempted: 0,
    unchecked: 0,
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [activeStatus, setActiveStatus] = useState<HistoryStatus | 'All'>('All');
  const [mediaTypeFilter, setMediaTypeFilter] = useState<'all' | 'movie' | 'series' | 'anime'>('all');
  const [sortBy, setSortBy] = useState<'recent' | 'oldest' | 'played' | 'failed' | 'downloaded'>('recent');

  // Multi-selection
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Modal / Drawer Inspector
  const [inspectingItem, setInspectingItem] = useState<HistoryEvent | null>(null);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [refreshingSourceId, setRefreshingSourceId] = useState<string | null>(null);
  const [copiedDiag, setCopiedDiag] = useState(false);

  const fetchHistory = useCallback(async () => {
    if (!window.cloudstream) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const filter: HistoryFilter = {
        query: searchQuery.trim() || undefined,
        status: activeStatus,
        type: mediaTypeFilter,
        sortBy,
        limit: 100,
      };

      const [listRes, statsRes] = await Promise.all([
        window.cloudstream.listHistory?.(filter),
        window.cloudstream.getHistoryStats?.(),
      ]);

      if (listRes) {
        setEvents(listRes.items);
      }
      if (statsRes) {
        setStats(statsRes);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [searchQuery, activeStatus, mediaTypeFilter, sortBy]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const handleClearAll = async () => {
    if (!window.cloudstream) return;
    await window.cloudstream.clearHistory?.();
    setConfirmClearOpen(false);
    setSelectedIds(new Set());
    setSelectMode(false);
    fetchHistory();
  };

  const handleDeleteItem = async (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!window.cloudstream) return;
    await window.cloudstream.deleteHistoryItem?.(id);
    if (inspectingItem?.id === id) setInspectingItem(null);
    fetchHistory();
  };

  const handleDeleteSelected = async () => {
    if (!window.cloudstream || selectedIds.size === 0) return;
    await window.cloudstream.deleteHistoryItems?.([...selectedIds]);
    setSelectedIds(new Set());
    setSelectMode(false);
    fetchHistory();
  };

  const toggleSelect = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedIds.size === events.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(events.map((e) => e.id)));
    }
  };

  const openMedia = (item: HistoryEvent, e?: React.MouseEvent) => {
    e?.stopPropagation();
    onSelectMedia({
      name: item.title,
      url: item.mediaUrl,
      apiName: item.source?.providerName || 'History',
      type: (item.type as TvType) || TvType.Movie,
      posterUrl: item.posterUrl,
      year: item.year,
    });
  };

  const handleRefreshSource = async (item: HistoryEvent, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!window.cloudstream) return;
    setRefreshingSourceId(item.id);
    try {
      const res = await window.cloudstream.refreshLibrarySources?.(
        item.mediaUrl,
        item.title,
        item.year,
        item.season,
        item.episode
      );
      if (res?.ok && res.sources?.length) {
        // Record refreshed history event
        await window.cloudstream.recordHistoryEvent?.({
          title: item.title,
          year: item.year,
          type: item.type,
          posterUrl: item.posterUrl,
          mediaUrl: item.mediaUrl,
          season: item.season,
          episode: item.episode,
          action: 'source_selected',
          status: 'Attempted',
          source: {
            providerName: res.sources[0].providerName || res.sources[0].indexerName,
            sourceName: res.sources[0].title,
            resolution: res.sources[0].parsed?.resolution,
            quality: res.sources[0].parsed?.resolution ? `${res.sources[0].parsed.resolution}p` : undefined,
          },
          sourcesDiscovered: res.storedSources,
        });
        fetchHistory();
      }
    } finally {
      setRefreshingSourceId(null);
    }
  };

  const copyDiagnostics = (item: HistoryEvent) => {
    const text = JSON.stringify(
      {
        id: item.id,
        title: item.title,
        status: item.status,
        action: item.action,
        timestamp: new Date(item.timestamp).toISOString(),
        source: item.source,
        failureReason: item.failureReason,
        diagnostics: item.diagnostics,
      },
      null,
      2
    );
    navigator.clipboard.writeText(text);
    setCopiedDiag(true);
    setTimeout(() => setCopiedDiag(false), 2000);
  };

  const statusPills: Array<{ status: HistoryStatus | 'All'; label: string; count?: number }> = [
    { status: 'All', label: 'All Activity', count: stats.total },
    { status: 'Played', label: 'Played', count: stats.played },
    { status: 'Failed', label: 'Failed', count: stats.failed },
    { status: 'Downloaded', label: 'Downloaded', count: stats.downloaded },
    { status: 'Attempted', label: 'Attempted', count: stats.attempted },
    { status: 'Unchecked', label: 'Unchecked', count: stats.unchecked },
  ];

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        padding: '1.75rem 2rem',
        gap: '1.5rem',
        overflowY: 'auto',
      }}
    >
      {/* Header & Stats Banner */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.35rem' }}>
              <div
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '10px',
                  backgroundColor: 'rgba(59, 130, 246, 0.15)',
                  color: '#60a5fa',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: '1px solid rgba(59, 130, 246, 0.25)',
                }}
              >
                <HistoryIcon size={20} />
              </div>
              <h1 style={{ fontSize: '1.6rem', fontWeight: 800, color: '#fff', letterSpacing: '-0.02em', margin: 0 }}>
                Media History
              </h1>
            </div>
            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              Complete record of your playback, download attempts, providers, and stream status.
            </p>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setRefreshing(true);
                fetchHistory();
              }}
              disabled={loading || refreshing}
              title="Refresh history"
            >
              <RotateCw size={14} className={refreshing ? 'animate-spin' : ''} />
              <span>Refresh</span>
            </button>

            {events.length > 0 && (
              <>
                <button
                  type="button"
                  className={`btn btn-sm ${selectMode ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => {
                    setSelectMode((v) => !v);
                    setSelectedIds(new Set());
                  }}
                >
                  {selectMode ? 'Cancel Selection' : 'Select'}
                </button>

                {selectMode && (
                  <>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={selectAll}>
                      {selectedIds.size === events.length ? 'Deselect All' : 'Select All'}
                    </button>

                    {selectedIds.size > 0 && (
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        onClick={handleDeleteSelected}
                      >
                        <Trash2 size={14} />
                        <span>Delete ({selectedIds.size})</span>
                      </button>
                    )}
                  </>
                )}

                {!selectMode && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ color: '#fb7185', borderColor: 'rgba(244, 63, 94, 0.3)' }}
                    onClick={() => setConfirmClearOpen(true)}
                  >
                    <Trash2 size={14} />
                    <span>Clear All</span>
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Stats summary cards */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
            gap: '0.75rem',
          }}
        >
          <div
            style={{
              padding: '0.75rem 1rem',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
            }}
          >
            <div style={{ fontSize: '0.72rem', color: 'var(--text-subtle)', fontWeight: 600, textTransform: 'uppercase' }}>
              Total Records
            </div>
            <div style={{ fontSize: '1.35rem', fontWeight: 800, color: '#fff', marginTop: '0.2rem' }}>
              {stats.total}
            </div>
          </div>

          <div
            style={{
              padding: '0.75rem 1rem',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'var(--bg-card)',
              border: '1px solid rgba(16, 185, 129, 0.25)',
            }}
          >
            <div style={{ fontSize: '0.72rem', color: '#34d399', fontWeight: 600, textTransform: 'uppercase' }}>
              Played
            </div>
            <div style={{ fontSize: '1.35rem', fontWeight: 800, color: '#34d399', marginTop: '0.2rem' }}>
              {stats.played}
            </div>
          </div>

          <div
            style={{
              padding: '0.75rem 1rem',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'var(--bg-card)',
              border: '1px solid rgba(244, 63, 94, 0.25)',
            }}
          >
            <div style={{ fontSize: '0.72rem', color: '#fb7185', fontWeight: 600, textTransform: 'uppercase' }}>
              Failed
            </div>
            <div style={{ fontSize: '1.35rem', fontWeight: 800, color: '#fb7185', marginTop: '0.2rem' }}>
              {stats.failed}
            </div>
          </div>

          <div
            style={{
              padding: '0.75rem 1rem',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'var(--bg-card)',
              border: '1px solid rgba(59, 130, 246, 0.25)',
            }}
          >
            <div style={{ fontSize: '0.72rem', color: '#60a5fa', fontWeight: 600, textTransform: 'uppercase' }}>
              Downloaded
            </div>
            <div style={{ fontSize: '1.35rem', fontWeight: 800, color: '#60a5fa', marginTop: '0.2rem' }}>
              {stats.downloaded}
            </div>
          </div>

          <div
            style={{
              padding: '0.75rem 1rem',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
            }}
          >
            <div style={{ fontSize: '0.72rem', color: '#fbbf24', fontWeight: 600, textTransform: 'uppercase' }}>
              Attempted
            </div>
            <div style={{ fontSize: '1.35rem', fontWeight: 800, color: '#fbbf24', marginTop: '0.2rem' }}>
              {stats.attempted}
            </div>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '0.85rem',
          backgroundColor: 'var(--bg-card)',
          padding: '0.9rem 1.1rem',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border-color)',
        }}
      >
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Search Box */}
          <div style={{ position: 'relative', flex: 1, minWidth: '220px' }}>
            <Search
              size={16}
              style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-subtle)' }}
            />
            <input
              type="text"
              className="input"
              placeholder="Search history by title, provider, quality, error…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                paddingLeft: '2.2rem',
                fontSize: '0.85rem',
                backgroundColor: 'rgba(255, 255, 255, 0.04)',
              }}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                style={{
                  position: 'absolute',
                  right: '0.6rem',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-subtle)',
                  cursor: 'pointer',
                }}
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Media Type Dropdown */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <Filter size={14} style={{ color: 'var(--text-subtle)' }} />
            <select
              value={mediaTypeFilter}
              onChange={(e) => setMediaTypeFilter(e.target.value as any)}
              className="input"
              style={{ fontSize: '0.8rem', padding: '0.35rem 0.6rem', backgroundColor: 'rgba(255, 255, 255, 0.04)' }}
            >
              <option value="all">All Types</option>
              <option value="movie">Movies</option>
              <option value="series">Series</option>
              <option value="anime">Anime</option>
            </select>
          </div>

          {/* Sort Dropdown */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <ArrowUpDown size={14} style={{ color: 'var(--text-subtle)' }} />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="input"
              style={{ fontSize: '0.8rem', padding: '0.35rem 0.6rem', backgroundColor: 'rgba(255, 255, 255, 0.04)' }}
            >
              <option value="recent">Most Recent</option>
              <option value="oldest">Oldest First</option>
              <option value="played">Recently Played</option>
              <option value="failed">Recently Failed</option>
              <option value="downloaded">Recently Downloaded</option>
            </select>
          </div>
        </div>

        {/* Status Pills */}
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          {statusPills.map((pill) => {
            const isActive = activeStatus === pill.status;
            return (
              <button
                key={pill.status}
                type="button"
                onClick={() => setActiveStatus(pill.status)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  padding: '0.3rem 0.65rem',
                  borderRadius: '20px',
                  fontSize: '0.75rem',
                  fontWeight: isActive ? 700 : 500,
                  cursor: 'pointer',
                  border: '1px solid',
                  borderColor: isActive ? 'var(--accent-primary)' : 'rgba(255, 255, 255, 0.08)',
                  backgroundColor: isActive ? 'rgba(59, 130, 246, 0.2)' : 'rgba(255, 255, 255, 0.02)',
                  color: isActive ? '#fff' : 'var(--text-muted)',
                  transition: 'all 0.15s ease',
                }}
              >
                <span>{pill.label}</span>
                {pill.count !== undefined && (
                  <span
                    style={{
                      fontSize: '0.65rem',
                      padding: '0.05rem 0.35rem',
                      borderRadius: '10px',
                      backgroundColor: isActive ? 'var(--accent-primary)' : 'rgba(255, 255, 255, 0.08)',
                      color: '#fff',
                    }}
                  >
                    {pill.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* History List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', flex: 1 }}>
        {loading && (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '4rem 0', color: 'var(--text-subtle)' }}>
            <RotateCw size={24} className="animate-spin" />
            <span style={{ marginLeft: '0.75rem', fontSize: '0.9rem' }}>Loading media history…</span>
          </div>
        )}

        {!loading && events.length === 0 && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '5rem 1rem',
              backgroundColor: 'var(--bg-card)',
              borderRadius: 'var(--radius-lg)',
              border: '1px dashed var(--border-color)',
              textAlign: 'center',
              gap: '0.75rem',
            }}
          >
            <div
              style={{
                width: '48px',
                height: '48px',
                borderRadius: '50%',
                backgroundColor: 'rgba(255, 255, 255, 0.04)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--text-subtle)',
              }}
            >
              <HistoryIcon size={24} />
            </div>
            <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: '#fff' }}>
              No history found
            </h3>
            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)', maxWidth: '380px' }}>
              {searchQuery || activeStatus !== 'All' || mediaTypeFilter !== 'all'
                ? 'No media activity matches your active search and filter criteria.'
                : 'Your playback and download attempts will appear here as you discover and stream media.'}
            </p>
          </div>
        )}

        {!loading &&
          events.map((item) => {
            const statusConfig = STATUS_CONFIG[item.status] || STATUS_CONFIG.Unknown;
            const StatusIcon = statusConfig.icon;
            const isSelected = selectedIds.has(item.id);
            const isSeries = item.season !== undefined || item.episode !== undefined;
            const episodeLabel = isSeries
              ? `S${String(item.season ?? 1).padStart(2, '0')} E${String(item.episode ?? 1).padStart(2, '0')}`
              : null;

            return (
              <div
                key={item.id}
                onClick={() => (selectMode ? toggleSelect(item.id) : setInspectingItem(item))}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0.75rem 1rem',
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.1)' : 'var(--bg-card)',
                  border: '1px solid',
                  borderColor: isSelected ? 'var(--accent-primary)' : 'var(--border-color)',
                  cursor: 'pointer',
                  gap: '1rem',
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) e.currentTarget.style.backgroundColor = 'var(--bg-card-hover)';
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) e.currentTarget.style.backgroundColor = 'var(--bg-card)';
                }}
              >
                {/* Left: Checkbox (if selectMode) + Poster + Title + Badges */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', minWidth: 0, flex: 1 }}>
                  {selectMode && (
                    <div onClick={(e) => toggleSelect(item.id, e)} style={{ color: isSelected ? '#60a5fa' : 'var(--text-subtle)' }}>
                      {isSelected ? <CheckSquare size={18} /> : <Square size={18} />}
                    </div>
                  )}

                  {/* Thumbnail / Poster */}
                  <div
                    style={{
                      width: '42px',
                      height: '60px',
                      borderRadius: '6px',
                      overflow: 'hidden',
                      backgroundColor: 'rgba(255, 255, 255, 0.05)',
                      flexShrink: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                    }}
                  >
                    {item.posterUrl ? (
                      <img
                        src={item.posterUrl}
                        alt={item.title}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        onError={(e) => {
                          (e.currentTarget as HTMLElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      <Film size={20} style={{ color: 'var(--text-subtle)' }} />
                    )}
                  </div>

                  {/* Meta & Status */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, fontSize: '0.92rem', color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '350px' }}>
                        {item.title}
                      </span>

                      {item.year && (
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-subtle)' }}>
                          ({item.year})
                        </span>
                      )}

                      {episodeLabel && (
                        <span
                          style={{
                            fontSize: '0.7rem',
                            fontWeight: 700,
                            padding: '0.1rem 0.4rem',
                            borderRadius: '4px',
                            backgroundColor: 'rgba(139, 92, 246, 0.15)',
                            color: '#a78bfa',
                            border: '1px solid rgba(139, 92, 246, 0.3)',
                          }}
                        >
                          {episodeLabel}
                        </span>
                      )}

                      {/* Status Badge */}
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.25rem',
                          fontSize: '0.7rem',
                          fontWeight: 700,
                          padding: '0.15rem 0.5rem',
                          borderRadius: '12px',
                          backgroundColor: statusConfig.bg,
                          color: statusConfig.text,
                          border: `1px solid ${statusConfig.border}`,
                        }}
                      >
                        <StatusIcon size={12} />
                        <span>{statusConfig.label}</span>
                      </span>
                    </div>

                    {/* Secondary row: Episode Title, Provider, Resolution, Failure Reason */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.78rem', color: 'var(--text-muted)', flexWrap: 'wrap' }}>
                      {item.episodeTitle && (
                        <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                          "{item.episodeTitle}"
                        </span>
                      )}

                      {item.source?.providerName && (
                        <span style={{ color: 'var(--text-subtle)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                          <span style={{ color: '#94a3b8' }}>Provider:</span>
                          <strong style={{ color: 'var(--text-primary)' }}>{item.source.providerName}</strong>
                        </span>
                      )}

                      {item.source?.quality && (
                        <span
                          style={{
                            padding: '0.05rem 0.35rem',
                            borderRadius: '3px',
                            backgroundColor: 'rgba(255, 255, 255, 0.08)',
                            fontSize: '0.68rem',
                            fontWeight: 700,
                            color: '#fff',
                          }}
                        >
                          {item.source.quality}
                        </span>
                      )}

                      {item.failureReason && (
                        <span style={{ color: '#fb7185', fontSize: '0.75rem', fontStyle: 'italic', maxWidth: '300px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          — {item.failureReason}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right: Timestamp & Action Buttons */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.15rem', marginRight: '0.5rem' }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-subtle)' }}>
                      {formatRelativeTime(item.timestamp)}
                    </span>
                    {item.durationSeconds ? (
                      <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                        {formatDuration(item.durationSeconds)}
                      </span>
                    ) : null}
                  </div>

                  {/* Actions */}
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={(e) => openMedia(item, e)}
                    title="Open details"
                    style={{ padding: '0.35rem 0.6rem', fontSize: '0.75rem' }}
                  >
                    <ExternalLink size={13} />
                    <span>Details</span>
                  </button>

                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={(e) => handleRefreshSource(item, e)}
                    disabled={refreshingSourceId === item.id}
                    title="Refresh sources"
                    style={{ padding: '0.35rem 0.5rem' }}
                  >
                    <RotateCw size={13} className={refreshingSourceId === item.id ? 'animate-spin' : ''} />
                  </button>

                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={(e) => handleDeleteItem(item.id, e)}
                    title="Delete record"
                    style={{ padding: '0.35rem 0.5rem', color: 'var(--text-subtle)' }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            );
          })}
      </div>

      {/* Expandable Inspector Modal / Drawer */}
      {inspectingItem && (
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
          onClick={() => setInspectingItem(null)}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '680px',
              maxHeight: '90vh',
              backgroundColor: '#161b26',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--border-color)',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.85)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '1.25rem 1.5rem',
                borderBottom: '1px solid var(--border-color)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
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
                  <Info size={18} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: '#fff' }}>
                    Activity & Source Diagnostics
                  </h3>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-subtle)' }}>
                    ID: {inspectingItem.id}
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => copyDiagnostics(inspectingItem)}
                  title="Copy diagnostics JSON"
                >
                  {copiedDiag ? <Check size={14} style={{ color: '#34d399' }} /> : <Copy size={14} />}
                  <span>{copiedDiag ? 'Copied' : 'Copy JSON'}</span>
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setInspectingItem(null)}
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div style={{ padding: '1.5rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {/* Media Summary Box */}
              <div style={{ display: 'flex', gap: '1rem', backgroundColor: 'rgba(255, 255, 255, 0.03)', padding: '1rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
                {inspectingItem.posterUrl && (
                  <img
                    src={inspectingItem.posterUrl}
                    alt={inspectingItem.title}
                    style={{ width: '60px', height: '88px', objectFit: 'cover', borderRadius: '6px' }}
                  />
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <h4 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#fff' }}>
                      {inspectingItem.title}
                    </h4>
                    {inspectingItem.year && (
                      <span style={{ fontSize: '0.85rem', color: 'var(--text-subtle)' }}>
                        ({inspectingItem.year})
                      </span>
                    )}
                  </div>
                  {inspectingItem.originalTitle && inspectingItem.originalTitle !== inspectingItem.title && (
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      Original: {inspectingItem.originalTitle}
                    </div>
                  )}
                  {inspectingItem.episodeTitle && (
                    <div style={{ fontSize: '0.82rem', color: '#a78bfa', fontWeight: 600 }}>
                      {inspectingItem.season !== undefined ? `Season ${inspectingItem.season}, Episode ${inspectingItem.episode}: ` : ''}
                      "{inspectingItem.episodeTitle}"
                    </div>
                  )}
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-subtle)', marginTop: '0.25rem' }}>
                    Media URL: <span style={{ color: 'var(--text-muted)', wordBreak: 'break-all' }}>{inspectingItem.mediaUrl}</span>
                  </div>
                </div>
              </div>

              {/* Activity Section */}
              <div>
                <h5 style={{ margin: '0 0 0.5rem 0', fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase' }}>
                  Activity Record
                </h5>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem', fontSize: '0.8rem' }}>
                  <div style={{ padding: '0.6rem', backgroundColor: 'rgba(255, 255, 255, 0.02)', borderRadius: '6px' }}>
                    <span style={{ color: 'var(--text-subtle)' }}>Action:</span>{' '}
                    <strong style={{ color: '#fff' }}>{inspectingItem.action}</strong>
                  </div>
                  <div style={{ padding: '0.6rem', backgroundColor: 'rgba(255, 255, 255, 0.02)', borderRadius: '6px' }}>
                    <span style={{ color: 'var(--text-subtle)' }}>Status:</span>{' '}
                    <strong style={{ color: STATUS_CONFIG[inspectingItem.status]?.text || '#fff' }}>
                      {inspectingItem.status}
                    </strong>
                  </div>
                  <div style={{ padding: '0.6rem', backgroundColor: 'rgba(255, 255, 255, 0.02)', borderRadius: '6px' }}>
                    <span style={{ color: 'var(--text-subtle)' }}>Timestamp:</span>{' '}
                    <span style={{ color: 'var(--text-primary)' }}>
                      {new Date(inspectingItem.timestamp).toLocaleString()}
                    </span>
                  </div>
                  {inspectingItem.durationSeconds ? (
                    <div style={{ padding: '0.6rem', backgroundColor: 'rgba(255, 255, 255, 0.02)', borderRadius: '6px' }}>
                      <span style={{ color: 'var(--text-subtle)' }}>Duration / Watched:</span>{' '}
                      <span style={{ color: 'var(--text-primary)' }}>
                        {formatDuration(inspectingItem.durationSeconds)}
                      </span>
                    </div>
                  ) : null}
                </div>
              </div>

              {/* Source & Provider Section */}
              {inspectingItem.source && (
                <div>
                  <h5 style={{ margin: '0 0 0.5rem 0', fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase' }}>
                    Source Metadata
                  </h5>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem', fontSize: '0.8rem' }}>
                    <div style={{ padding: '0.6rem', backgroundColor: 'rgba(255, 255, 255, 0.02)', borderRadius: '6px' }}>
                      <span style={{ color: 'var(--text-subtle)' }}>Provider:</span>{' '}
                      <strong style={{ color: '#fff' }}>{inspectingItem.source.providerName || inspectingItem.source.indexerName || 'Unknown'}</strong>
                    </div>
                    <div style={{ padding: '0.6rem', backgroundColor: 'rgba(255, 255, 255, 0.02)', borderRadius: '6px' }}>
                      <span style={{ color: 'var(--text-subtle)' }}>Quality / Resolution:</span>{' '}
                      <span style={{ color: 'var(--text-primary)' }}>
                        {inspectingItem.source.quality || (inspectingItem.source.resolution ? `${inspectingItem.source.resolution}p` : 'Unknown')}
                      </span>
                    </div>
                    {inspectingItem.source.videoCodec && (
                      <div style={{ padding: '0.6rem', backgroundColor: 'rgba(255, 255, 255, 0.02)', borderRadius: '6px' }}>
                        <span style={{ color: 'var(--text-subtle)' }}>Video Codec:</span>{' '}
                        <span style={{ color: 'var(--text-primary)' }}>{inspectingItem.source.videoCodec}</span>
                      </div>
                    )}
                    {inspectingItem.source.sourceName && (
                      <div style={{ gridColumn: '1 / -1', padding: '0.6rem', backgroundColor: 'rgba(255, 255, 255, 0.02)', borderRadius: '6px' }}>
                        <span style={{ color: 'var(--text-subtle)' }}>Release Name:</span>{' '}
                        <span style={{ color: 'var(--text-primary)', wordBreak: 'break-all' }}>{inspectingItem.source.sourceName}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Diagnostics & Error Details */}
              {inspectingItem.failureReason && (
                <div style={{ padding: '1rem', backgroundColor: 'rgba(244, 63, 94, 0.08)', borderRadius: 'var(--radius-md)', border: '1px solid rgba(244, 63, 94, 0.25)' }}>
                  <h5 style={{ margin: '0 0 0.4rem 0', fontSize: '0.8rem', fontWeight: 700, color: '#fb7185', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <AlertTriangle size={14} />
                    <span>Failure Diagnosis</span>
                  </h5>
                  <p style={{ margin: 0, fontSize: '0.85rem', color: '#fff' }}>
                    {inspectingItem.failureReason}
                  </p>
                  {inspectingItem.diagnostics?.details && (
                    <pre style={{ margin: '0.5rem 0 0 0', padding: '0.5rem', backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: '4px', fontSize: '0.75rem', color: '#fca5a5', overflowX: 'auto', whiteSpace: 'pre-wrap' }}>
                      {inspectingItem.diagnostics.details}
                    </pre>
                  )}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '1rem 1.5rem',
                borderTop: '1px solid var(--border-color)',
                backgroundColor: 'rgba(0,0,0,0.2)',
              }}
            >
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ color: '#fb7185' }}
                onClick={() => handleDeleteItem(inspectingItem.id)}
              >
                <Trash2 size={14} />
                <span>Delete Record</span>
              </button>

              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => handleRefreshSource(inspectingItem)}
                  disabled={refreshingSourceId === inspectingItem.id}
                >
                  <RotateCw size={14} className={refreshingSourceId === inspectingItem.id ? 'animate-spin' : ''} />
                  <span>Refresh Sources</span>
                </button>

                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => {
                    openMedia(inspectingItem);
                    setInspectingItem(null);
                  }}
                >
                  <ExternalLink size={14} />
                  <span>Open Media Details</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Clear Modal */}
      {confirmClearOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 99999,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1.5rem',
          }}
          onClick={() => setConfirmClearOpen(false)}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '420px',
              backgroundColor: '#161b26',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--border-color)',
              padding: '1.5rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', color: '#fb7185' }}>
              <AlertTriangle size={24} />
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: '#fff' }}>
                Clear All Media History?
              </h3>
            </div>
            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              This will permanently erase your media activity logs. Your saved Library items, downloads, and cached sources will remain untouched.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', marginTop: '0.5rem' }}>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setConfirmClearOpen(false)}>
                Cancel
              </button>
              <button type="button" className="btn btn-danger btn-sm" onClick={handleClearAll}>
                Yes, Clear All History
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
