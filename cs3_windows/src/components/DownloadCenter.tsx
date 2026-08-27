import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { EmptyState } from './EmptyState';
import { useFlash } from '../utils/useFlash';
import type { DownloadTask } from '../types/download';
import { DownloadState } from '../types/download';
import { DeleteDownloadDialog, type DeletePreference } from './DeleteDownloadDialog';
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
  ArrowUpDown,
} from 'lucide-react';
import { formatDownloadSize, formatTransferRate } from '../utils/format';
import { variantFromTask, variantLabel } from '../utils/downloadIdentity';

interface DownloadCenterProps {
  tasks: DownloadTask[];
  hasBinaries?: boolean;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onRemove: (id: string, deleteFile?: boolean) => void;
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
  /**
   * Plays a finished download in our own player.
   *
   * Until this existed, a completed film could only be handed to the OS
   * default player, which meant losing resume position, subtitle search, track
   * selection and the compatibility engine for a file already on disk.
   */
  onPlayFile?: (task: DownloadTask) => void;
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
  onPlayFile?: (task: DownloadTask) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onRemove: (id: string, deleteFile?: boolean) => void;
  onReveal?: (filePath: string) => void;
  onOpenTitle?: (task: DownloadTask) => void;
  isEpisode?: boolean;
}

const SingleTaskRow: React.FC<SingleTaskRowProps> = ({
  task,
  onPlayFile,
  onPause,
  onResume,
  onRemove,
  onReveal,
  onOpenTitle,
  isEpisode = false,
}) => {
  const { message: copiedMeta, flash: setCopiedMeta } = useFlash<boolean>(2500);

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
      `Progress:       ${formatDownloadSize(task.bytesDownloaded)} / ${formatDownloadSize(task.totalBytes)} (${percent}%)`,
      `Speed:          ${formatTransferRate(task.downloadSpeed)}`,
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
            {/*
              Which variant this row is, because the title no longer identifies
              it. Two releases of one film are two rows now, and without the
              resolution, source and provider on each they render identically —
              leaving the viewer to guess which of two 40%-complete transfers
              they are about to pause.
            */}
            <span style={{ fontSize: '0.72rem', color: 'var(--text-subtle)' }}>
              {variantLabel(variantFromTask(task)) || `Provider: ${task.providerName || 'aria2c'}`}
              {task.totalBytes > 0 ? ` • ${formatDownloadSize(task.totalBytes)}` : ''}
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
              ? formatTransferRate(task.downloadSpeed)
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
            {formatDownloadSize(task.bytesDownloaded)} / {formatDownloadSize(task.totalBytes)} ({percent}%)
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
        {onPlayFile && task.state === DownloadState.Completed && (
          <button
            onClick={() => onPlayFile(task)}
            className="btn btn-primary btn-icon"
            title="Play here"
          >
            <Play size={15} />
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

export type DownloadFilterTab = 'all' | 'downloading' | 'paused' | 'failed' | 'completed';
export type DownloadSortMode = 'recent' | 'oldest' | 'name' | 'size';

export const DownloadCenter: React.FC<DownloadCenterProps> = ({
  tasks,
  hasBinaries = true,
  onPause,
  onResume,
  onRemove,
  onReveal,
  onOpenBinarySetup,
  onOpenTitle,
  onPlayFile,
}) => {
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [activeFilter, setActiveFilter] = useState<DownloadFilterTab>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortMode, setSortMode] = useState<DownloadSortMode>('recent');

  const toggleGroupCollapse = (groupKey: string) => {
    setCollapsedGroups((prev) => ({
      ...prev,
      [groupKey]: !prev[groupKey],
    }));
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
      paused,
      failed,
      completed,
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

  /**
   * Every delete on this screen funnels through here.
   *
   * There are three affordances that remove something — a row, a batch header,
   * and "Clear Completed" — and asking in each of them would be three chances
   * for one to forget and silently destroy a file. The pending set is held here
   * and the dialog is rendered once.
   */
  const [pendingDelete, setPendingDelete] = useState<{
    ids: string[];
    title: string;
    hasFile: boolean;
  } | null>(null);
  const [deletePreference, setDeletePreference] = useState<DeletePreference>('ask');

  useEffect(() => {
    void window.cloudstream?.getDeleteDownloadPreference().then((response) => {
      if (response?.ok) setDeletePreference(response.preference);
    });
  }, []);

  const requestDelete = useCallback(
    (ids: string[], title: string) => {
      if (ids.length === 0) return;
      // Only a finished download has a file worth warning about, so the prompt
      // says which case this is rather than threatening something that is not there.
      const hasFile = tasks.some((t) => ids.includes(t.id) && t.state === DownloadState.Completed);

      if (deletePreference === 'list-only') {
        ids.forEach((id) => onRemove(id, false));
        return;
      }
      if (deletePreference === 'list-and-file') {
        ids.forEach((id) => onRemove(id, true));
        return;
      }
      setPendingDelete({ ids, title, hasFile });
    },
    [deletePreference, onRemove, tasks]
  );

  const confirmDelete = useCallback(
    (deleteFile: boolean, remember: boolean) => {
      const pending = pendingDelete;
      setPendingDelete(null);
      if (!pending) return;
      pending.ids.forEach((id) => onRemove(id, deleteFile));
      if (remember) {
        const preference: DeletePreference = deleteFile ? 'list-and-file' : 'list-only';
        setDeletePreference(preference);
        void window.cloudstream?.setDeleteDownloadPreference(preference);
      }
    },
    [pendingDelete, onRemove]
  );

  const handleClearCompleted = () => {
    requestDelete(
      tasks.filter((t) => t.state === DownloadState.Completed).map((t) => t.id),
      'the finished downloads'
    );
  };

  // Filter and sort tasks (recently downloaded items come 1st by default)
  const filteredTasks = useMemo(() => {
    const list = tasks.filter((t) => {
      if (activeFilter === 'downloading') {
        const isActive =
          t.state === DownloadState.Downloading ||
          t.state === DownloadState.Queued ||
          t.state === DownloadState.Retrying ||
          t.state === DownloadState.RefreshingSource;
        if (!isActive) return false;
      } else if (activeFilter === 'paused') {
        if (t.state !== DownloadState.Paused) return false;
      } else if (activeFilter === 'failed') {
        if (t.state !== DownloadState.Failed) return false;
      } else if (activeFilter === 'completed') {
        if (t.state !== DownloadState.Completed) return false;
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

    // Apply sorting: recent (newest first) by default
    list.sort((a, b) => {
      if (sortMode === 'recent') {
        return (b.createdTime || 0) - (a.createdTime || 0);
      }
      if (sortMode === 'oldest') {
        return (a.createdTime || 0) - (b.createdTime || 0);
      }
      if (sortMode === 'name') {
        return (a.title || '').localeCompare(b.title || '');
      }
      if (sortMode === 'size') {
        return (b.totalBytes || 0) - (a.totalBytes || 0);
      }
      return 0;
    });

    return list;
  }, [tasks, activeFilter, searchQuery, sortMode]);

  // Group filtered tasks by series / session and sort groups
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

    const groupList = Array.from(map.values());
    groupList.sort((a, b) => {
      if (sortMode === 'recent') {
        const aMax = Math.max(...a.tasks.map((t) => t.createdTime || 0));
        const bMax = Math.max(...b.tasks.map((t) => t.createdTime || 0));
        return bMax - aMax;
      }
      if (sortMode === 'oldest') {
        const aMin = Math.min(...a.tasks.map((t) => t.createdTime || 0));
        const bMin = Math.min(...b.tasks.map((t) => t.createdTime || 0));
        return aMin - bMin;
      }
      if (sortMode === 'name') {
        return a.title.localeCompare(b.title);
      }
      if (sortMode === 'size') {
        const aSize = a.tasks.reduce((sum, t) => sum + (t.totalBytes || 0), 0);
        const bSize = b.tasks.reduce((sum, t) => sum + (t.totalBytes || 0), 0);
        return bSize - aSize;
      }
      return 0;
    });

    return groupList;
  }, [filteredTasks, sortMode]);

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
              <span>Set up faster downloads</span>
            </button>
          )}
        </div>
      </div>

      {/* Filter Tabs & Management Toolbar */}
      {tasks.length > 0 && (
        <div className="download-manager__toolbar">
          {/* Filter Tabs in requested order: ALL, Downloading, Paused, Failed, Completed */}
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

            <button
              type="button"
              className={`download-tab ${activeFilter === 'completed' ? 'download-tab--active' : ''}`}
              onClick={() => setActiveFilter('completed')}
            >
              <CheckCircle2 size={14} style={{ color: counts.completed > 0 ? 'var(--status-success)' : undefined }} />
              <span>Completed</span>
              <span className="download-tab__badge">{counts.completed}</span>
            </button>
          </div>

          {/* Search Filter, Sort Order & Quick Actions */}
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

            {/* Sort Selector Dropdown */}
            <div className="download-sort-select" title="Sort download list">
              <ArrowUpDown size={13} style={{ color: 'var(--text-subtle)' }} />
              <select
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value as DownloadSortMode)}
                aria-label="Sort downloads"
              >
                <option value="recent">Recent First</option>
                <option value="oldest">Oldest First</option>
                <option value="name">Title (A-Z)</option>
                <option value="size">Size (Largest)</option>
              </select>
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
                  <RotateCw size={12} className="spin" /> Total Speed: {formatTransferRate(totalActiveSpeed)}
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
              {formatDownloadSize(totalDownloaded)} {totalBytes > 0 ? `/ ${formatDownloadSize(totalBytes)}` : 'downloaded'}
            </span>
          </div>
        </div>
      )}

      {/* Downloads List */}
      {tasks.length === 0 ? (
        <EmptyState
          icon={ArrowDown}
          title="No downloads yet"
          description={
            hasBinaries
              ? 'Press Download on any source and it appears here. Downloads keep going while you browse, and resume after a restart.'
              : 'Press Download on any source and it appears here. Installing the transfer components first makes downloads considerably faster.'
          }
          action={
            !hasBinaries && onOpenBinarySetup
              ? { label: 'Set up faster downloads', onClick: onOpenBinarySetup }
              : undefined
          }
        />
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
                            ? formatTransferRate(totalSpeed)
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
                          {formatDownloadSize(bytesDownloaded)} / {formatDownloadSize(totalBytes)} ({overallPercent}%) • {statusText}
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
                        onClick={() => requestDelete(group.tasks.map((t) => t.id), group.title)}
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
                          onRemove={(id) => requestDelete([id], group.title)}
                          onReveal={onReveal}
                          onPlayFile={onPlayFile}
                          onOpenTitle={onOpenTitle}
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
                onRemove={(id) => requestDelete([id], group.title)}
                onReveal={onReveal}
                onPlayFile={onPlayFile}
                onOpenTitle={onOpenTitle}
              />
            );
          })}
        </div>
      )}

      {pendingDelete && (
        <DeleteDownloadDialog
          title={pendingDelete.title}
          count={pendingDelete.ids.length}
          hasFile={pendingDelete.hasFile}
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
};

