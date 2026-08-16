import React, { useState, useMemo } from 'react';
import type { DownloadTask } from '../types/download';
import { DownloadState } from '../types/download';
import {
  Play,
  Pause,
  Trash2,
  ArrowDown,
  Folder,
  FolderOpen,
  RotateCw,
  Zap,
  ChevronDown,
  ChevronRight,
  Layers,
  Copy,
  Check,
  Search,
  X,
  CheckCircle2,
  PauseCircle,
  AlertCircle,
} from 'lucide-react';

interface DownloadCenterProps {
  tasks: DownloadTask[];
  hasBinaries?: boolean;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onRemove: (id: string) => void;
  onReveal?: (filePath?: string) => void;
  onOpenBinarySetup?: () => void;
  /**
   * Opens the title this download came from.
   *
   * The download list is often where someone re-encounters a title days later,
   * and from here the only things they could do were pause it or reveal a file.
   * `mediaUrl` was already recorded on the task and simply unused, so the way
   * back to episodes, other sources and playback existed and was not reachable.
   */
  onOpenTitle?: (task: DownloadTask) => void;
}

interface TaskGroup {
  key: string;
  title: string;
  seasonNumber?: number;
  posterUrl?: string;
  tasks: DownloadTask[];
  isBatch: boolean;
}

interface SingleTaskRowProps {
  task: DownloadTask;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onRemove: (id: string) => void;
  onReveal?: (filePath: string) => void;
  onOpenTitle?: (task: DownloadTask) => void;
  formatSpeed: (bytesPerSec: number) => string;
  formatSize: (bytes: number) => string;
  isEpisode?: boolean;
}

const SingleTaskRow: React.FC<SingleTaskRowProps> = ({
  task,
  onPause,
  onResume,
  onRemove,
  onReveal,
  onOpenTitle,
  formatSpeed,
  formatSize,
  isEpisode = false,
}) => {
  const [copiedMeta, setCopiedMeta] = useState(false);

  const percent =
    task.totalBytes > 0
      ? Math.min(100, Math.floor((task.bytesDownloaded / task.totalBytes) * 100))
      : 0;

  const isDownloading = task.state === DownloadState.Downloading;
  const isResumable =
    task.state === DownloadState.Paused || task.state === DownloadState.Failed;

  const handleCopyMeta = () => {
    const isEpisodeItem = task.episodeNumber !== undefined;
    const itemText = isEpisodeItem
      ? task.seasonNumber !== undefined
        ? `S${task.seasonNumber} E${task.episodeNumber}`
        : `Episode ${task.episodeNumber}`
      : 'Movie / Single';

    const lines = [
      `CloudStream Desktop — Download Metadata`,
      `Title:          ${task.title}`,
      `Item:           ${itemText}`,
      `Provider:       ${task.providerName || 'Extension / Built-in'}`,
      `Quality:        ${task.quality || task.resolution ? `${task.quality || task.resolution}p` : 'Unknown'}`,
      `State:          ${task.state}`,
      `Progress:       ${formatSize(task.bytesDownloaded)} / ${formatSize(task.totalBytes)} (${percent}%)`,
      `Speed:          ${formatSpeed(task.downloadSpeed)}`,
      `ETA:            ${task.etaSeconds > 0 ? `${task.etaSeconds}s` : 'N/A'}`,
      `Retry Count:    ${task.retryCount || 0}/4`,
      task.errorMessage ? `Last Status:    ${task.errorMessage}` : null,
      `Source Link:    ${task.link.url}`,
      `Target Path:    ${task.targetFilePath}`,
      task.mediaUrl ? `Media URL:      ${task.mediaUrl}` : null,
      task.headers && Object.keys(task.headers).length > 0
        ? `Headers:        ${JSON.stringify(task.headers)}`
        : null,
      `Timestamp:      ${new Date().toISOString()}`,
    ]
      .filter(Boolean)
      .join('\n');

    void navigator.clipboard.writeText(lines);
    setCopiedMeta(true);
    setTimeout(() => setCopiedMeta(false), 2500);
  };

  return (
    <div
      className={isEpisode ? 'download-item-card' : 'download-group-card'}
      style={
        !isEpisode
          ? {
              padding: '1.25rem',
              display: 'flex',
              alignItems: 'center',
              gap: '1.25rem',
            }
          : undefined
      }
    >
      {/* Poster Thumbnail for standalone items */}
      {!isEpisode && (
        <div
          style={{
            width: '48px',
            height: '68px',
            borderRadius: 'var(--radius-sm)',
            overflow: 'hidden',
            flexShrink: 0,
            backgroundColor: 'var(--bg-input)',
          }}
        >
          {task.posterUrl ? (
            <img
              src={task.posterUrl}
              alt={task.title}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <div
              style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Folder size={20} style={{ color: 'var(--text-subtle)' }} />
            </div>
          )}
        </div>
      )}

      {/* Details & Progress */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h4 style={{ fontSize: isEpisode ? '0.86rem' : '0.92rem', fontWeight: 600, color: '#fff', margin: 0 }}>
              {onOpenTitle && task.mediaUrl ? (
                <button
                  className="download-title"
                  onClick={() => onOpenTitle(task)}
                  title="Open this title"
                >
                  {isEpisode
                    ? task.episodeNumber
                      ? `Episode ${task.episodeNumber}`
                      : task.title
                    : `${task.title} ${task.episodeNumber ? `• Ep ${task.episodeNumber}` : ''}`}
                </button>
              ) : isEpisode ? (
                task.episodeNumber ? `Episode ${task.episodeNumber}` : task.title
              ) : (
                `${task.title} ${task.episodeNumber ? `• Ep ${task.episodeNumber}` : ''}`
              )}
            </h4>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-subtle)' }}>
              Provider: {task.providerName || 'aria2c'}
              {task.resolution ? ` • ${task.resolution}p` : ''}
            </span>
          </div>

          <div
            style={{
              fontSize: '0.78rem',
              fontWeight: 600,
              color: 'var(--accent-light)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
            }}
          >
            {(task.state === DownloadState.RefreshingSource ||
              task.state === DownloadState.Retrying) && (
              <RotateCw size={13} className="spin" style={{ color: 'var(--accent-light)' }} />
            )}
            {isDownloading
              ? formatSpeed(task.downloadSpeed)
              : task.state === DownloadState.RefreshingSource
              ? 'Refreshing Expired Link...'
              : task.state === DownloadState.Retrying
              ? 'Retrying...'
              : task.state}
          </div>
        </div>

        {/* Progress Bar */}
        <div
          style={{
            height: '6px',
            backgroundColor: 'var(--bg-input)',
            borderRadius: '3px',
            overflow: 'hidden',
            width: '100%',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${percent}%`,
              backgroundColor:
                task.state === DownloadState.Completed
                  ? 'var(--status-success)'
                  : 'var(--accent-primary)',
              transition: 'width 0.3s ease',
            }}
          />
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: '0.72rem',
            color: 'var(--text-muted)',
          }}
        >
          <span>
            {formatSize(task.bytesDownloaded)} / {formatSize(task.totalBytes)} ({percent}%)
          </span>
          <span>{task.etaSeconds > 0 ? `ETA: ${task.etaSeconds}s` : ''}</span>
        </div>

        {task.errorMessage && (
          <p
            style={{
              fontSize: '0.72rem',
              color:
                task.state === DownloadState.Failed ? 'var(--status-error)' : 'var(--text-muted)',
              margin: 0,
            }}
          >
            {task.errorMessage}
          </p>
        )}
      </div>

      {/* Control Action Buttons */}
      <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0 }}>
        <button
          onClick={handleCopyMeta}
          className="btn btn-secondary btn-icon"
          title="Copy Download Metadata & Debug Info"
        >
          {copiedMeta ? <Check size={15} style={{ color: 'var(--status-success)' }} /> : <Copy size={15} />}
        </button>
        {isDownloading && (
          <button
            onClick={() => onPause(task.id)}
            className="btn btn-secondary btn-icon"
            title="Pause Download"
          >
            <Pause size={15} />
          </button>
        )}
        {isResumable && (
          <button
            onClick={() => onResume(task.id)}
            className="btn btn-secondary btn-icon"
            title={task.state === DownloadState.Failed ? 'Retry Download' : 'Resume Download'}
          >
            {task.state === DownloadState.Failed ? <RotateCw size={15} /> : <Play size={15} />}
          </button>
        )}
        {onReveal && (
          <button
            onClick={() => onReveal(task.targetFilePath)}
            className="btn btn-secondary btn-icon"
            title="Show in Folder"
          >
            <FolderOpen size={15} />
          </button>
        )}
        <button
          onClick={() => onRemove(task.id)}
          className="btn btn-secondary btn-icon"
          title="Cancel & Remove"
        >
          <Trash2 size={15} style={{ color: 'var(--status-error)' }} />
        </button>
      </div>
    </div>
  );
};

export type DownloadFilterTab = 'all' | 'downloading' | 'completed' | 'paused' | 'failed';

export const DownloadCenter: React.FC<DownloadCenterProps> = ({
  tasks,
  hasBinaries = true,
  onPause,
  onResume,
  onRemove,
  onReveal,
  onOpenBinarySetup,
  onOpenTitle,
}) => {
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [activeFilter, setActiveFilter] = useState<DownloadFilterTab>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const toggleGroupCollapse = (groupKey: string) => {
    setCollapsedGroups((prev) => ({
      ...prev,
      [groupKey]: !prev[groupKey],
    }));
  };

  const formatSpeed = (bytesPerSec: number): string => {
    if (bytesPerSec <= 0) return '0 KB/s';
    const mb = bytesPerSec / (1024 * 1024);
    if (mb >= 1) return `${mb.toFixed(1)} MB/s`;
    return `${(bytesPerSec / 1024).toFixed(0)} KB/s`;
  };

  const formatSize = (bytes: number): string => {
    if (bytes <= 0) return 'Unknown';
    const mb = bytes / (1024 * 1024);
    if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
    return `${mb.toFixed(0)} MB`;
  };

  // Status counts for tabs
  const counts = useMemo(() => {
    let downloading = 0;
    let completed = 0;
    let paused = 0;
    let failed = 0;

    for (const t of tasks) {
      if (
        t.state === DownloadState.Downloading ||
        t.state === DownloadState.Queued ||
        t.state === DownloadState.Retrying ||
        t.state === DownloadState.RefreshingSource
      ) {
        downloading++;
      } else if (t.state === DownloadState.Completed) {
        completed++;
      } else if (t.state === DownloadState.Paused) {
        paused++;
      } else if (t.state === DownloadState.Failed) {
        failed++;
      }
    }

    return {
      all: tasks.length,
      downloading,
      completed,
      paused,
      failed,
    };
  }, [tasks]);

  // Aggregate download speed and progress stats
  const totalActiveSpeed = useMemo(() => {
    return tasks.reduce((sum, t) => sum + (t.downloadSpeed || 0), 0);
  }, [tasks]);

  const totalBytes = useMemo(() => {
    return tasks.reduce((sum, t) => sum + (t.totalBytes || 0), 0);
  }, [tasks]);

  const totalDownloaded = useMemo(() => {
    return tasks.reduce((sum, t) => sum + (t.bytesDownloaded || 0), 0);
  }, [tasks]);

  // Batch action handlers
  const handlePauseAll = () => {
    for (const t of tasks) {
      if (
        t.state === DownloadState.Downloading ||
        t.state === DownloadState.Queued ||
        t.state === DownloadState.Retrying ||
        t.state === DownloadState.RefreshingSource
      ) {
        onPause(t.id);
      }
    }
  };

  const handleResumeAll = () => {
    for (const t of tasks) {
      if (t.state === DownloadState.Paused || t.state === DownloadState.Failed) {
        onResume(t.id);
      }
    }
  };

  const handleRetryFailed = () => {
    for (const t of tasks) {
      if (t.state === DownloadState.Failed) {
        onResume(t.id);
      }
    }
  };

  const handleClearCompleted = () => {
    for (const t of tasks) {
      if (t.state === DownloadState.Completed) {
        onRemove(t.id);
      }
    }
  };

  // Filter tasks based on selected tab and search query
  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (activeFilter === 'downloading') {
        const isActive =
          t.state === DownloadState.Downloading ||
          t.state === DownloadState.Queued ||
          t.state === DownloadState.Retrying ||
          t.state === DownloadState.RefreshingSource;
        if (!isActive) return false;
      } else if (activeFilter === 'completed') {
        if (t.state !== DownloadState.Completed) return false;
      } else if (activeFilter === 'paused') {
        if (t.state !== DownloadState.Paused) return false;
      } else if (activeFilter === 'failed') {
        if (t.state !== DownloadState.Failed) return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchTitle = t.title?.toLowerCase().includes(q);
        const matchProvider = t.providerName?.toLowerCase().includes(q);
        const matchFile = t.targetFilePath?.toLowerCase().includes(q);
        if (!matchTitle && !matchProvider && !matchFile) return false;
      }

      return true;
    });
  }, [tasks, activeFilter, searchQuery]);

  // Group filtered tasks by series / session
  const groups: TaskGroup[] = useMemo(() => {
    const map = new Map<string, TaskGroup>();

    for (const task of filteredTasks) {
      const isEpisode = task.episodeNumber !== undefined || task.seasonNumber !== undefined;
      const groupKey = isEpisode
        ? `${task.parentId || task.title}-s${task.seasonNumber ?? 0}`
        : `single-${task.id}`;

      let group = map.get(groupKey);
      if (!group) {
        group = {
          key: groupKey,
          title: task.title,
          seasonNumber: task.seasonNumber,
          posterUrl: task.posterUrl,
          tasks: [],
          isBatch: isEpisode,
        };
        map.set(groupKey, group);
      }
      group.tasks.push(task);
    }

    for (const g of map.values()) {
      if (g.tasks.length > 1) {
        g.isBatch = true;
      }
    }

    return Array.from(map.values());
  }, [filteredTasks]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Top Header */}
      <div className="download-manager__header-row">
        <div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#fff', margin: 0 }}>
            Download Manager
          </h2>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
            High-speed multi-threaded downloads via aria2c daemon engine
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
          {onReveal && (
            <button
              onClick={() => onReveal()}
              className="btn btn-secondary"
              style={{ fontSize: '0.78rem' }}
              title="Open default downloads folder in Windows File Explorer"
            >
              <FolderOpen size={16} style={{ color: 'var(--accent-light)' }} />
              <span>Open Downloads Folder</span>
            </button>
          )}

          {!hasBinaries && onOpenBinarySetup && (
            <button
              onClick={onOpenBinarySetup}
              className="btn btn-secondary"
              style={{ borderColor: 'var(--accent-primary)' }}
            >
              <Zap size={16} style={{ color: 'var(--accent-light)' }} />
              <span>⚡ 1-Click Engine Setup</span>
            </button>
          )}
        </div>
      </div>

      {/* Filter Tabs & Management Toolbar */}
      {tasks.length > 0 && (
        <div className="download-manager__toolbar">
          {/* Filter Tabs */}
          <div className="download-tabs">
            <button
              type="button"
              className={`download-tab ${activeFilter === 'all' ? 'download-tab--active' : ''}`}
              onClick={() => setActiveFilter('all')}
            >
              <Layers size={14} />
              <span>All</span>
              <span className="download-tab__badge">{counts.all}</span>
            </button>

            <button
              type="button"
              className={`download-tab ${activeFilter === 'downloading' ? 'download-tab--active' : ''}`}
              onClick={() => setActiveFilter('downloading')}
            >
              <RotateCw
                size={14}
                className={counts.downloading > 0 ? 'spin' : ''}
                style={{ color: counts.downloading > 0 ? 'var(--accent-light)' : undefined }}
              />
              <span>Downloading</span>
              <span className="download-tab__badge">{counts.downloading}</span>
            </button>

            <button
              type="button"
              className={`download-tab ${activeFilter === 'completed' ? 'download-tab--active' : ''}`}
              onClick={() => setActiveFilter('completed')}
            >
              <CheckCircle2 size={14} style={{ color: counts.completed > 0 ? 'var(--status-success)' : undefined }} />
              <span>Completed</span>
              <span className="download-tab__badge">{counts.completed}</span>
            </button>

            <button
              type="button"
              className={`download-tab ${activeFilter === 'paused' ? 'download-tab--active' : ''}`}
              onClick={() => setActiveFilter('paused')}
            >
              <PauseCircle size={14} />
              <span>Paused</span>
              <span className="download-tab__badge">{counts.paused}</span>
            </button>

            <button
              type="button"
              className={`download-tab ${activeFilter === 'failed' ? 'download-tab--active' : ''}`}
              onClick={() => setActiveFilter('failed')}
            >
              <AlertCircle size={14} style={{ color: counts.failed > 0 ? 'var(--status-error)' : undefined }} />
              <span>Failed</span>
              <span
                className={`download-tab__badge ${counts.failed > 0 ? 'download-tab__badge--error' : ''}`}
              >
                {counts.failed}
              </span>
            </button>
          </div>

          {/* Search Filter & Quick Actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
            <div className="download-search-input">
              <Search size={14} style={{ color: 'var(--text-subtle)' }} />
              <input
                type="text"
                placeholder="Search downloads..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    display: 'flex',
                  }}
                  title="Clear search"
                >
                  <X size={13} />
                </button>
              )}
            </div>

            <div className="download-actions-row">
              {counts.downloading > 0 && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handlePauseAll}
                  style={{ fontSize: '0.76rem', padding: '0.35rem 0.65rem' }}
                  title="Pause all active downloads"
                >
                  <Pause size={13} />
                  <span>Pause All</span>
                </button>
              )}

              {(counts.paused > 0 || counts.failed > 0) && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleResumeAll}
                  style={{ fontSize: '0.76rem', padding: '0.35rem 0.65rem' }}
                  title="Resume all paused downloads"
                >
                  <Play size={13} />
                  <span>Resume All</span>
                </button>
              )}

              {counts.failed > 0 && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleRetryFailed}
                  style={{ fontSize: '0.76rem', padding: '0.35rem 0.65rem', borderColor: 'rgba(239, 68, 68, 0.4)' }}
                  title="Retry all failed downloads"
                >
                  <RotateCw size={13} style={{ color: 'var(--status-error)' }} />
                  <span>Retry Failed</span>
                </button>
              )}

              {counts.completed > 0 && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleClearCompleted}
                  style={{ fontSize: '0.76rem', padding: '0.35rem 0.65rem' }}
                  title="Clear finished downloads from list"
                >
                  <Trash2 size={13} />
                  <span>Clear Completed</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Aggregate Stats Bar */}
      {tasks.length > 0 && (
        <div className="download-stats-bar">
          <div className="download-stats-bar__item">
            <span style={{ fontWeight: 600, color: '#fff' }}>
              {counts.downloading > 0 ? (
                <span style={{ color: 'var(--accent-light)', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                  <RotateCw size={12} className="spin" /> Total Speed: {formatSpeed(totalActiveSpeed)}
                </span>
              ) : (
                'Queue Idle'
              )}
            </span>
            <span>•</span>
            <span>{counts.downloading} active</span>
            <span>•</span>
            <span>{counts.completed} completed</span>
            {counts.failed > 0 && (
              <>
                <span>•</span>
                <span style={{ color: 'var(--status-error)' }}>{counts.failed} failed</span>
              </>
            )}
          </div>
          <div className="download-stats-bar__item">
            <span>
              {formatSize(totalDownloaded)} {totalBytes > 0 ? `/ ${formatSize(totalBytes)}` : 'downloaded'}
            </span>
          </div>
        </div>
      )}

      {/* Downloads List */}
      {tasks.length === 0 ? (
        <div
          style={{
            padding: '4rem 2rem',
            textAlign: 'center',
            background: 'var(--bg-card)',
            borderRadius: 'var(--radius-lg)',
            border: '1px dashed var(--border-color)',
            color: 'var(--text-muted)',
          }}
        >
          <ArrowDown size={40} style={{ margin: '0 auto 1rem', opacity: 0.5 }} />
          <h3 style={{ fontSize: '1rem', color: '#fff', marginBottom: '0.5rem' }}>
            No Active Downloads
          </h3>
          <p style={{ fontSize: '0.8rem' }}>
            Browse media titles and click "1-Click Download" to start high-speed stream downloads.
          </p>
        </div>
      ) : filteredTasks.length === 0 ? (
        <div
          style={{
            padding: '3rem 2rem',
            textAlign: 'center',
            background: 'var(--bg-card)',
            borderRadius: 'var(--radius-lg)',
            border: '1px dashed var(--border-color)',
            color: 'var(--text-muted)',
          }}
        >
          <p style={{ fontSize: '0.9rem', color: '#fff', marginBottom: '0.4rem' }}>
            {searchQuery
              ? `No downloads match "${searchQuery}" in this filter.`
              : activeFilter === 'downloading'
              ? 'No active downloads in progress.'
              : activeFilter === 'completed'
              ? 'No completed downloads yet.'
              : activeFilter === 'paused'
              ? 'No paused downloads.'
              : activeFilter === 'failed'
              ? 'No failed downloads.'
              : 'No downloads found.'}
          </p>
          {(searchQuery || activeFilter !== 'all') && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setSearchQuery('');
                setActiveFilter('all');
              }}
              style={{ fontSize: '0.78rem', marginTop: '0.5rem' }}
            >
              Reset Filters
            </button>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {groups.map((group) => {
            // Render Series/Season Collapsible Container
            if (group.isBatch && group.tasks.length > 1) {
              const isCollapsed = Boolean(collapsedGroups[group.key]);
              const completedCount = group.tasks.filter(
                (t) => t.state === DownloadState.Completed
              ).length;
              const downloadingCount = group.tasks.filter(
                (t) => t.state === DownloadState.Downloading
              ).length;
              const pausedCount = group.tasks.filter(
                (t) => t.state === DownloadState.Paused
              ).length;
              const failedCount = group.tasks.filter(
                (t) => t.state === DownloadState.Failed
              ).length;
              const retryingCount = group.tasks.filter(
                (t) =>
                  t.state === DownloadState.RefreshingSource ||
                  t.state === DownloadState.Retrying
              ).length;

              const totalBytes = group.tasks.reduce((sum, t) => sum + (t.totalBytes || 0), 0);
              const bytesDownloaded = group.tasks.reduce(
                (sum, t) => sum + (t.bytesDownloaded || 0),
                0
              );
              const totalSpeed = group.tasks.reduce((sum, t) => sum + (t.downloadSpeed || 0), 0);
              const maxEta = Math.max(0, ...group.tasks.map((t) => t.etaSeconds || 0));

              const overallPercent =
                totalBytes > 0
                  ? Math.min(100, Math.floor((bytesDownloaded / totalBytes) * 100))
                  : Math.floor((completedCount / group.tasks.length) * 100);

              const isAllComplete = completedCount === group.tasks.length;
              const isAnyDownloading = downloadingCount > 0 || retryingCount > 0;
              const isResumableGroup = pausedCount > 0 || failedCount > 0;

              let statusText = `${completedCount} of ${group.tasks.length} Episodes Completed`;
              if (isAllComplete) {
                statusText = `All ${group.tasks.length} Episodes Completed`;
              } else if (isAnyDownloading) {
                statusText = `Downloading (${downloadingCount} active, ${completedCount}/${group.tasks.length} done)`;
              } else if (pausedCount > 0) {
                statusText = `Paused (${pausedCount} paused, ${completedCount}/${group.tasks.length} done)`;
              }

              return (
                <div key={group.key} className="download-group-card">
                  {/* Container Header Toggle */}
                  <div
                    className="download-group-header"
                    onClick={() => toggleGroupCollapse(group.key)}
                  >
                    <div className="download-group-toggle">
                      {isCollapsed ? <ChevronRight size={18} /> : <ChevronDown size={18} />}
                    </div>

                    {/* Poster Thumbnail */}
                    <div
                      style={{
                        width: '48px',
                        height: '68px',
                        borderRadius: 'var(--radius-sm)',
                        overflow: 'hidden',
                        flexShrink: 0,
                        backgroundColor: 'var(--bg-input)',
                      }}
                    >
                      {group.posterUrl ? (
                        <img
                          src={group.posterUrl}
                          alt={group.title}
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                      ) : (
                        <div
                          style={{
                            width: '100%',
                            height: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <Layers size={22} style={{ color: 'var(--accent-light)' }} />
                        </div>
                      )}
                    </div>

                    {/* Details & Aggregated Progress */}
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                          <h4 style={{ fontSize: '0.98rem', fontWeight: 700, color: '#fff', margin: 0 }}>
                            {group.title} {group.seasonNumber ? `• Season ${group.seasonNumber}` : ''}
                          </h4>
                          <span
                            className="chip"
                            style={{
                              fontSize: '0.7rem',
                              padding: '0.15rem 0.5rem',
                              background: 'rgba(59, 130, 246, 0.15)',
                              color: 'var(--accent-light)',
                            }}
                          >
                            {group.tasks.length} Episodes
                          </span>
                        </div>

                        <div
                          style={{
                            fontSize: '0.8rem',
                            fontWeight: 600,
                            color: isAllComplete
                              ? 'var(--status-success)'
                              : 'var(--accent-light)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.35rem',
                          }}
                        >
                          {retryingCount > 0 && <RotateCw size={14} className="spin" />}
                          {isAnyDownloading
                            ? formatSpeed(totalSpeed)
                            : isAllComplete
                            ? 'Completed'
                            : statusText}
                        </div>
                      </div>

                      {/* Progress Bar */}
                      <div
                        style={{
                          height: '7px',
                          backgroundColor: 'var(--bg-input)',
                          borderRadius: '4px',
                          overflow: 'hidden',
                          width: '100%',
                        }}
                      >
                        <div
                          style={{
                            height: '100%',
                            width: `${overallPercent}%`,
                            backgroundColor: isAllComplete
                              ? 'var(--status-success)'
                              : 'var(--accent-primary)',
                            transition: 'width 0.3s ease',
                          }}
                        />
                      </div>

                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          fontSize: '0.74rem',
                          color: 'var(--text-muted)',
                        }}
                      >
                        <span>
                          {formatSize(bytesDownloaded)} / {formatSize(totalBytes)} ({overallPercent}%) • {statusText}
                        </span>
                        <span>{maxEta > 0 && isAnyDownloading ? `ETA: ${maxEta}s` : ''}</span>
                      </div>
                    </div>

                    {/* Group Action Buttons */}
                    <div
                      style={{ display: 'flex', gap: '0.4rem' }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {isAnyDownloading && (
                        <button
                          type="button"
                          onClick={() =>
                            group.tasks.forEach(
                              (t) => t.state === DownloadState.Downloading && onPause(t.id)
                            )
                          }
                          className="btn btn-secondary btn-icon"
                          title="Pause All Episodes"
                        >
                          <Pause size={16} />
                        </button>
                      )}
                      {isResumableGroup && (
                        <button
                          type="button"
                          onClick={() =>
                            group.tasks.forEach(
                              (t) =>
                                (t.state === DownloadState.Paused ||
                                  t.state === DownloadState.Failed) &&
                                onResume(t.id)
                            )
                          }
                          className="btn btn-secondary btn-icon"
                          title="Resume All Episodes"
                        >
                          <Play size={16} />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => group.tasks.forEach((t) => onRemove(t.id))}
                        className="btn btn-secondary btn-icon"
                        title="Cancel & Remove Batch"
                      >
                        <Trash2 size={16} style={{ color: 'var(--status-error)' }} />
                      </button>
                    </div>
                  </div>

                  {/* Expandable Individual Episode Items */}
                  {!isCollapsed && (
                    <div className="download-group-body">
                      {group.tasks.map((task) => (
                        <SingleTaskRow
                          key={task.id}
                          task={task}
                          onPause={onPause}
                          onResume={onResume}
                          onRemove={onRemove}
                          onReveal={onReveal}
                          onOpenTitle={onOpenTitle}
                          formatSpeed={formatSpeed}
                          formatSize={formatSize}
                          isEpisode
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            }

            // Standalone single item card
            return (
              <SingleTaskRow
                key={group.tasks[0].id}
                task={group.tasks[0]}
                onPause={onPause}
                onResume={onResume}
                onRemove={onRemove}
                onReveal={onReveal}
                onOpenTitle={onOpenTitle}
                formatSpeed={formatSpeed}
                formatSize={formatSize}
              />
            );
          })}
        </div>
      )}
    </div>
  );
};

