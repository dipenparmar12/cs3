import React, { useCallback, useEffect, useState } from 'react';
import {
  History as HistoryIcon,
  Play,
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
  Code2,
  Terminal,
  Server,
  Layers,
  Sparkles,
} from 'lucide-react';
import type { SearchResponse } from '../types/api';
import { TvType } from '../types/api';
import type {
  HistoryEvent,
  HistoryFilter,
  HistoryStats,
  HistoryStatus,
} from '../types/history';
import { formatHistorySize, formatRuntime } from '../utils/format';

interface HistoryViewProps {
  onSelectMedia: (item: SearchResponse) => void;
  onPlayDirect?: (mediaItem: HistoryEvent) => void;
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

export const HistoryView: React.FC<HistoryViewProps> = ({ onSelectMedia, onPlayDirect }) => {
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
  const [refreshSuccessMessage, setRefreshSuccessMessage] = useState<{ id: string; text: string } | null>(null);
  const [copiedText, setCopiedText] = useState<'report' | 'json' | 'url' | null>(null);

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

  // Navigates to Metadata Details page (synopsis, cast, season picker)
  const openMetadataPage = (item: HistoryEvent, e?: React.MouseEvent) => {
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

  // Starts direct stream playback from history without navigating to metadata
  const handlePlayMedia = (item: HistoryEvent, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (onPlayDirect) {
      onPlayDirect(item);
    } else {
      openMetadataPage(item, e);
    }
  };

  // Re-checks enabled providers and updates sources
  const handleRefreshSource = async (item: HistoryEvent, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!window.cloudstream) return;
    setRefreshingSourceId(item.id);
    setRefreshSuccessMessage(null);
    try {
      const res = await window.cloudstream.refreshLibrarySources?.(
        item.mediaUrl,
        item.title,
        item.year,
        item.season,
        item.episode
      );
      if (res?.ok && res.sources) {
        const count = res.sources.length;
        const msg = count > 0 ? `Found ${count} stream source${count === 1 ? '' : 's'}` : 'No sources currently found';
        setRefreshSuccessMessage({ id: item.id, text: msg });

        if (count > 0) {
          const top = res.sources[0];
          // Record/update refreshed history event
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
              providerName: top.providerName || top.indexerName,
              sourceName: top.title,
              resolution: top.parsed?.resolution,
              quality: top.parsed?.resolution ? `${top.parsed.resolution}p` : undefined,
              directUrl: top.directUrl,
              videoCodec: top.parsed?.videoCodec,
              audioCodecs: top.parsed?.audioCodecs,
            },
            sourcesDiscovered: res.storedSources,
          });
        }
        await fetchHistory();
      }
    } finally {
      setRefreshingSourceId(null);
      setTimeout(() => setRefreshSuccessMessage(null), 4000);
    }
  };

  // Human-readable reproduction report (matching Download Metadata format)
  const copyReproductionReport = (item: HistoryEvent) => {
    const isSeries = item.season !== undefined || item.episode !== undefined;
    const itemText = isSeries
      ? item.season !== undefined
        ? `S${item.season} E${item.episode ?? 1}${item.episodeTitle ? ` — ${item.episodeTitle}` : ''}`
        : `Episode ${item.episode}`
      : 'Movie / Feature';

    const source = item.source;
    const lines = [
      `CloudStream Desktop — Media & Provider Diagnostics`,
      `Title:          ${item.title}${item.year ? ` (${item.year})` : ''}`,
      `Item:           ${itemText}`,
      `Provider:       ${source?.providerName || source?.indexerName || 'Extension / Built-in'}`,
      source?.sourceName ? `Source Title:   ${source.sourceName}` : null,
      `Action:         ${item.action}`,
      `Status:         ${item.status}`,
      `Quality:        ${source?.quality || (source?.resolution ? `${source.resolution}p` : 'Unknown')}`,
      source?.videoCodec ? `Video Codec:    ${source.videoCodec}` : null,
      source?.audioCodecs?.length ? `Audio Codecs:   ${source.audioCodecs.join(', ')}` : null,
      source?.sizeBytes ? `File Size:      ${formatHistorySize(source.sizeBytes)}` : null,
      source?.seeders !== undefined ? `Seeders:        ${source.seeders}` : null,
      item.durationSeconds ? `Watched / Dur:  ${formatRuntime(item.durationSeconds)}` : null,
      item.failureReason ? `Failure Reason: ${item.failureReason}` : null,
      source?.directUrl ? `Source Link:    ${source.directUrl}` : null,
      source?.magnet ? `Magnet Link:    ${source.magnet}` : null,
      `Media URL:      ${item.mediaUrl}`,
      source?.directHeaders && Object.keys(source.directHeaders).length > 0
        ? `Headers:        ${JSON.stringify(source.directHeaders)}`
        : null,
      item.diagnostics?.details ? `Diagnostics:    ${item.diagnostics.details}` : null,
      `Timestamp:      ${new Date(item.timestamp).toISOString()}`,
    ]
      .filter(Boolean)
      .join('\n');

    navigator.clipboard.writeText(lines);
    setCopiedText('report');
    setTimeout(() => setCopiedText(null), 2000);
  };

  const copyRawJson = (item: HistoryEvent) => {
    navigator.clipboard.writeText(JSON.stringify(item, null, 2));
    setCopiedText('json');
    setTimeout(() => setCopiedText(null), 2000);
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
              Revisit and replay past media streams directly, refresh fresh sources, or inspect raw provider diagnostic reports.
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
              placeholder="Search history by title, provider, quality, error, or release…"
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
            const isRefreshing = refreshingSourceId === item.id;
            const refreshMsg = refreshSuccessMessage?.id === item.id ? refreshSuccessMessage.text : null;

            return (
              <div
                key={item.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0.75rem 1rem',
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.1)' : 'var(--bg-card)',
                  border: '1px solid',
                  borderColor: isSelected ? 'var(--accent-primary)' : 'var(--border-color)',
                  gap: '1rem',
                  transition: 'all 0.15s ease',
                }}
              >
                {/* Left: Checkbox (if selectMode) + Poster + Title (links to Metadata) + Badges */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', minWidth: 0, flex: 1 }}>
                  {selectMode && (
                    <div onClick={(e) => toggleSelect(item.id, e)} style={{ color: isSelected ? '#60a5fa' : 'var(--text-subtle)', cursor: 'pointer' }}>
                      {isSelected ? <CheckSquare size={18} /> : <Square size={18} />}
                    </div>
                  )}

                  {/* Thumbnail / Poster (Clicks to Metadata) */}
                  <div
                    onClick={(e) => openMetadataPage(item, e)}
                    title="Click to view full media details & seasons"
                    style={{
                      width: '44px',
                      height: '62px',
                      borderRadius: '6px',
                      overflow: 'hidden',
                      backgroundColor: 'rgba(255, 255, 255, 0.05)',
                      flexShrink: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      cursor: 'pointer',
                      position: 'relative',
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
                      {/* Clickable Title that navigates to media metadata */}
                      <span
                        onClick={(e) => openMetadataPage(item, e)}
                        title="Click to view media metadata & episodes"
                        style={{
                          fontWeight: 700,
                          fontSize: '0.92rem',
                          color: '#fff',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          maxWidth: '350px',
                          cursor: 'pointer',
                          textDecoration: 'none',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = '#60a5fa')}
                        onMouseLeave={(e) => (e.currentTarget.style.color = '#fff')}
                      >
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

                    {/* Secondary row: Episode Title, Provider, Resolution, Failure Reason, or Refresh result */}
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

                      {refreshMsg && (
                        <span style={{ color: '#34d399', fontSize: '0.75rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                          <Sparkles size={12} />
                          <span>{refreshMsg}</span>
                        </span>
                      )}

                      {!refreshMsg && item.failureReason && (
                        <span style={{ color: '#fb7185', fontSize: '0.75rem', fontStyle: 'italic', maxWidth: '300px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          — {item.failureReason}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right: Timestamp & Explicit Action Buttons */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexShrink: 0 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.15rem', marginRight: '0.4rem' }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-subtle)' }}>
                      {formatRelativeTime(item.timestamp)}
                    </span>
                    {item.durationSeconds ? (
                      <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                        {formatRuntime(item.durationSeconds)}
                      </span>
                    ) : null}
                  </div>

                  {/* 1. Direct Play Button: Stream immediately without metadata page */}
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={(e) => handlePlayMedia(item, e)}
                    title="Play stream directly from history"
                    style={{ padding: '0.35rem 0.65rem', fontSize: '0.75rem', gap: '0.3rem' }}
                  >
                    <Play size={13} fill="currentColor" />
                    <span>Play</span>
                  </button>

                  {/* 2. Refresh Sources Button: Re-check providers directly from history */}
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={(e) => handleRefreshSource(item, e)}
                    disabled={isRefreshing}
                    title="Re-check enabled providers and discover fresh sources"
                    style={{ padding: '0.35rem 0.55rem', fontSize: '0.75rem', gap: '0.3rem' }}
                  >
                    <RotateCw size={13} className={isRefreshing ? 'animate-spin' : ''} />
                    <span>Refresh</span>
                  </button>

                  {/* 3. Provider Raw Info / Diagnostics Inspector Button */}
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      setInspectingItem(item);
                    }}
                    title="Inspect raw provider metadata, direct source links, and diagnostics"
                    style={{ padding: '0.35rem 0.55rem', fontSize: '0.75rem', gap: '0.3rem' }}
                  >
                    <Code2 size={13} />
                    <span>Inspect</span>
                  </button>

                  {/* 4. Delete Record Button */}
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={(e) => handleDeleteItem(item.id, e)}
                    title="Delete record"
                    style={{ padding: '0.35rem 0.45rem', color: 'var(--text-subtle)' }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            );
          })}
      </div>

      {/* Comprehensive Provider & Source Inspector Modal */}
      {inspectingItem && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            backgroundColor: 'rgba(0, 0, 0, 0.78)',
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
              maxWidth: '750px',
              maxHeight: '90vh',
              backgroundColor: '#141822',
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
                padding: '1.1rem 1.4rem',
                borderBottom: '1px solid var(--border-color)',
                backgroundColor: 'rgba(255, 255, 255, 0.02)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                <div
                  style={{
                    width: '34px',
                    height: '34px',
                    borderRadius: '8px',
                    backgroundColor: 'rgba(59, 130, 246, 0.15)',
                    color: '#60a5fa',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: '1px solid rgba(59, 130, 246, 0.25)',
                  }}
                >
                  <Terminal size={18} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: '#fff' }}>
                    Provider Raw Data & Source Diagnostics
                  </h3>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-subtle)' }}>
                    Detailed technical metadata for reproduction & inspection
                  </span>
                </div>
              </div>

              {/* Copy Report & Copy JSON Actions */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => copyReproductionReport(inspectingItem)}
                  title="Copy formatted reproduction text report (Markdown / plain text)"
                >
                  {copiedText === 'report' ? <Check size={13} style={{ color: '#34d399' }} /> : <Copy size={13} />}
                  <span>{copiedText === 'report' ? 'Report Copied' : 'Copy Report'}</span>
                </button>

                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => copyRawJson(inspectingItem)}
                  title="Copy full raw JSON object"
                >
                  {copiedText === 'json' ? <Check size={13} style={{ color: '#34d399' }} /> : <Code2 size={13} />}
                  <span>{copiedText === 'json' ? 'JSON Copied' : 'Raw JSON'}</span>
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
            <div style={{ padding: '1.4rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1.15rem' }}>
              {/* Media & Action Banner */}
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
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.25rem',
                        fontSize: '0.7rem',
                        fontWeight: 700,
                        padding: '0.12rem 0.45rem',
                        borderRadius: '10px',
                        backgroundColor: STATUS_CONFIG[inspectingItem.status]?.bg || 'rgba(255,255,255,0.05)',
                        color: STATUS_CONFIG[inspectingItem.status]?.text || '#fff',
                        border: `1px solid ${STATUS_CONFIG[inspectingItem.status]?.border || 'transparent'}`,
                      }}
                    >
                      {inspectingItem.status}
                    </span>
                  </div>

                  {inspectingItem.episodeTitle && (
                    <div style={{ fontSize: '0.82rem', color: '#a78bfa', fontWeight: 600 }}>
                      {inspectingItem.season !== undefined ? `Season ${inspectingItem.season}, Episode ${inspectingItem.episode ?? 1}: ` : ''}
                      "{inspectingItem.episodeTitle}"
                    </div>
                  )}

                  <div style={{ fontSize: '0.74rem', color: 'var(--text-subtle)', display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.2rem', flexWrap: 'wrap' }}>
                    <span>Action: <strong style={{ color: 'var(--text-primary)' }}>{inspectingItem.action}</strong></span>
                    <span>Timestamp: <strong style={{ color: 'var(--text-primary)' }}>{new Date(inspectingItem.timestamp).toLocaleString()}</strong></span>
                    {inspectingItem.durationSeconds ? (
                      <span>Duration: <strong style={{ color: 'var(--text-primary)' }}>{formatRuntime(inspectingItem.durationSeconds)}</strong></span>
                    ) : null}
                  </div>
                </div>
              </div>

              {/* Provider & Source Meta (The Raw Truth) */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.5rem', color: '#60a5fa', fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase' }}>
                  <Server size={14} />
                  <span>Provider & Source Origin</span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', backgroundColor: 'rgba(0, 0, 0, 0.25)', padding: '0.85rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', fontSize: '0.8rem' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                    <div>
                      <span style={{ color: 'var(--text-subtle)' }}>Provider Name:</span>{' '}
                      <strong style={{ color: '#fff' }}>{inspectingItem.source?.providerName || inspectingItem.source?.indexerName || 'Direct / Unknown'}</strong>
                    </div>
                    <div>
                      <span style={{ color: 'var(--text-subtle)' }}>Resolution / Quality:</span>{' '}
                      <span style={{ color: 'var(--text-primary)' }}>{inspectingItem.source?.quality || (inspectingItem.source?.resolution ? `${inspectingItem.source.resolution}p` : 'N/A')}</span>
                    </div>
                    <div>
                      <span style={{ color: 'var(--text-subtle)' }}>Video Codec:</span>{' '}
                      <span style={{ color: 'var(--text-primary)' }}>{inspectingItem.source?.videoCodec || 'N/A'}</span>
                    </div>
                    <div>
                      <span style={{ color: 'var(--text-subtle)' }}>Audio Codecs:</span>{' '}
                      <span style={{ color: 'var(--text-primary)' }}>{inspectingItem.source?.audioCodecs?.join(', ') || 'N/A'}</span>
                    </div>
                  </div>

                  {inspectingItem.source?.sourceName && (
                    <div style={{ paddingTop: '0.35rem', borderTop: '1px solid rgba(255, 255, 255, 0.05)' }}>
                      <span style={{ color: 'var(--text-subtle)' }}>Release Name:</span>{' '}
                      <span style={{ color: '#fff', wordBreak: 'break-all' }}>{inspectingItem.source.sourceName}</span>
                    </div>
                  )}

                  {inspectingItem.source?.directUrl && (
                    <div style={{ paddingTop: '0.35rem', borderTop: '1px solid rgba(255, 255, 255, 0.05)' }}>
                      <span style={{ color: 'var(--text-subtle)' }}>Direct Source Link:</span>
                      <div style={{ marginTop: '0.2rem', padding: '0.4rem 0.6rem', backgroundColor: 'rgba(0, 0, 0, 0.4)', borderRadius: '4px', wordBreak: 'break-all', fontSize: '0.74rem', color: '#93c5fd', fontFamily: 'monospace' }}>
                        {inspectingItem.source.directUrl}
                      </div>
                    </div>
                  )}

                  {inspectingItem.source?.magnet && (
                    <div style={{ paddingTop: '0.35rem', borderTop: '1px solid rgba(255, 255, 255, 0.05)' }}>
                      <span style={{ color: 'var(--text-subtle)' }}>Magnet URI:</span>
                      <div style={{ marginTop: '0.2rem', padding: '0.4rem 0.6rem', backgroundColor: 'rgba(0, 0, 0, 0.4)', borderRadius: '4px', wordBreak: 'break-all', fontSize: '0.74rem', color: '#fbcfe8', fontFamily: 'monospace' }}>
                        {inspectingItem.source.magnet}
                      </div>
                    </div>
                  )}

                  <div style={{ paddingTop: '0.35rem', borderTop: '1px solid rgba(255, 255, 255, 0.05)' }}>
                    <span style={{ color: 'var(--text-subtle)' }}>Media URL:</span>{' '}
                    <span style={{ color: 'var(--text-muted)', wordBreak: 'break-all', fontFamily: 'monospace', fontSize: '0.74rem' }}>{inspectingItem.mediaUrl}</span>
                  </div>

                  {inspectingItem.source?.directHeaders && Object.keys(inspectingItem.source.directHeaders).length > 0 && (
                    <div style={{ paddingTop: '0.35rem', borderTop: '1px solid rgba(255, 255, 255, 0.05)' }}>
                      <span style={{ color: 'var(--text-subtle)' }}>Request Headers:</span>
                      <pre style={{ margin: '0.25rem 0 0 0', padding: '0.4rem', backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: '4px', fontSize: '0.72rem', color: '#d1d5db', overflowX: 'auto' }}>
                        {JSON.stringify(inspectingItem.source.directHeaders, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              </div>

              {/* Failure Diagnostics (if failed) */}
              {inspectingItem.failureReason && (
                <div style={{ padding: '1rem', backgroundColor: 'rgba(244, 63, 94, 0.08)', borderRadius: 'var(--radius-md)', border: '1px solid rgba(244, 63, 94, 0.25)' }}>
                  <h5 style={{ margin: '0 0 0.4rem 0', fontSize: '0.8rem', fontWeight: 700, color: '#fb7185', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <AlertTriangle size={14} />
                    <span>Failure Diagnosis & Stack Trace</span>
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

              {/* Discovered Sources List */}
              {inspectingItem.sourcesDiscovered && inspectingItem.sourcesDiscovered.length > 0 && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.5rem', color: '#a78bfa', fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase' }}>
                    <Layers size={14} />
                    <span>Discovered Sources ({inspectingItem.sourcesDiscovered.length})</span>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', maxHeight: '180px', overflowY: 'auto' }}>
                    {inspectingItem.sourcesDiscovered.map((src, i) => (
                      <div
                        key={src.id || i}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '0.5rem 0.75rem',
                          backgroundColor: 'rgba(255, 255, 255, 0.02)',
                          borderRadius: '4px',
                          border: '1px solid rgba(255, 255, 255, 0.06)',
                          fontSize: '0.75rem',
                        }}
                      >
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem', minWidth: 0, flex: 1 }}>
                          <span style={{ color: '#fff', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {src.title || src.sourceName}
                          </span>
                          <span style={{ color: 'var(--text-subtle)' }}>
                            {src.providerName || src.indexerName} {src.quality ? `· ${src.quality}` : ''} {src.videoCodec ? `· ${src.videoCodec}` : ''}
                          </span>
                        </div>
                        {src.directUrl && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => {
                              navigator.clipboard.writeText(src.directUrl!);
                              setCopiedText('url');
                              setTimeout(() => setCopiedText(null), 1500);
                            }}
                            title="Copy link"
                            style={{ fontSize: '0.7rem', padding: '0.2rem 0.4rem' }}
                          >
                            <Copy size={11} />
                            <span>{copiedText === 'url' ? 'Copied' : 'Link'}</span>
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer with Direct Actions */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '1rem 1.4rem',
                borderTop: '1px solid var(--border-color)',
                backgroundColor: 'rgba(0,0,0,0.25)',
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

              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => openMetadataPage(inspectingItem)}
                  title="Navigate to full media synopsis & seasons page"
                >
                  <ExternalLink size={13} />
                  <span>Metadata Page</span>
                </button>

                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => handleRefreshSource(inspectingItem)}
                  disabled={refreshingSourceId === inspectingItem.id}
                  title="Re-query enabled providers for fresh links"
                >
                  <RotateCw size={13} className={refreshingSourceId === inspectingItem.id ? 'animate-spin' : ''} />
                  <span>Refresh Sources</span>
                </button>

                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => {
                    handlePlayMedia(inspectingItem);
                    setInspectingItem(null);
                  }}
                  title="Start streaming now"
                >
                  <Play size={13} fill="currentColor" />
                  <span>Play Media Now</span>
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
