import React, { useState, useMemo } from 'react';
import { useFlash } from '../../utils/useFlash';
import {
  X, Play, Pause, RotateCw, Trash2, Check, Copy, Download, FolderOpen, ArrowUpRight,
  CheckCircle2,
} from 'lucide-react';
import type { DownloadTask } from '../../types/download';
import { DownloadState } from '../../types/download';
import { formatEtaDuration, formatPanelSize, formatTransferRate } from '../../utils/format';

/**
 * The download summary shown over the player.
 *
 * Leads with the current video, keeps active and failed downloads easy to act
 * on, and lets completed items stay quiet until hovered or focused.
 */

export type DownloadFilterTab = 'all' | 'downloading' | 'paused' | 'failed' | 'completed';

interface PlayerDownloadPanelProps {
  open: boolean;
  tasks: DownloadTask[];
  onClose: () => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onRemove: (id: string) => void;
  onReveal?: (filePath: string) => void;
  /** Leaves the player running and shows the full Downloads screen. */
  onOpenDownloads?: () => void;
  /**
   * The video on screen, and its download if one exists.
   */
  current?: DownloadTask | null;
  currentTitle?: string;
  currentDetail?: string;
  onDownloadCurrent?: () => void;
}

const isActiveState = (state: DownloadState): boolean =>
  state === DownloadState.Downloading ||
  state === DownloadState.Queued ||
  state === DownloadState.Retrying ||
  state === DownloadState.RefreshingSource;

function formatTaskSubtitle(task: DownloadTask): string {
  const parts: string[] = [];
  if (task.resolution) parts.push(`${task.resolution}p`);
  if (task.state === DownloadState.Completed) {
    if (task.totalBytes > 0) parts.push(formatPanelSize(task.totalBytes));
    else if (task.bytesDownloaded > 0) parts.push(formatPanelSize(task.bytesDownloaded));
  } else if (task.totalBytes > 0) {
    parts.push(`${formatPanelSize(task.bytesDownloaded)} of ${formatPanelSize(task.totalBytes)}`);
  } else if (task.bytesDownloaded > 0) {
    parts.push(formatPanelSize(task.bytesDownloaded));
  }
  if (task.providerName) parts.push(task.providerName);
  return parts.join(' · ');
}

export const PlayerDownloadPanel: React.FC<PlayerDownloadPanelProps> = ({
  open,
  tasks,
  onClose,
  onPause,
  onResume,
  onRemove,
  onReveal,
  onOpenDownloads,
  current,
  currentTitle,
  currentDetail,
  onDownloadCurrent,
}) => {
  const { message: copiedId, flash: setCopiedId } = useFlash<string>(2500);
  const [activeFilter, setActiveFilter] = useState<DownloadFilterTab>('all');

  const counts = useMemo(() => {
    let downloading = 0;
    let completed = 0;
    let paused = 0;
    let failed = 0;

    for (const t of tasks) {
      if (isActiveState(t.state)) downloading++;
      else if (t.state === DownloadState.Completed) completed++;
      else if (t.state === DownloadState.Paused) paused++;
      else if (t.state === DownloadState.Failed) failed++;
    }

    return {
      all: tasks.length,
      downloading,
      paused,
      failed,
      completed,
    };
  }, [tasks]);

  const filteredTasks = useMemo(() => {
    const list = tasks.filter((t) => {
      if (activeFilter === 'downloading') return isActiveState(t.state);
      if (activeFilter === 'paused') return t.state === DownloadState.Paused;
      if (activeFilter === 'failed') return t.state === DownloadState.Failed;
      if (activeFilter === 'completed') return t.state === DownloadState.Completed;
      return true;
    });

    // Recently queued or updated items stay near the top.
    list.sort((a, b) => (b.createdTime || 0) - (a.createdTime || 0));
    return list;
  }, [tasks, activeFilter]);

  const handlePauseAll = () => {
    for (const t of tasks) {
      if (isActiveState(t.state)) onPause(t.id);
    }
  };

  const handleResumeAll = () => {
    for (const t of tasks) {
      if (t.state === DownloadState.Paused || t.state === DownloadState.Failed) {
        onResume(t.id);
      }
    }
  };

  const handleClearCompleted = () => {
    for (const t of tasks) {
      if (t.state === DownloadState.Completed) onRemove(t.id);
    }
  };

  if (!open) return null;

  const copyTaskMeta = (t: DownloadTask) => {
    const percent =
      t.totalBytes > 0 ? Math.min(100, Math.floor((t.bytesDownloaded / t.totalBytes) * 100)) : 0;
    const lines = [
      `CloudStream Desktop — Download Details`,
      `Title:       ${t.title}`,
      `Provider:    ${t.providerName || 'Built-in'}`,
      `Quality:     ${t.resolution ? `${t.resolution}p` : t.quality || 'Unknown'}`,
      `State:       ${t.state}`,
      `Progress:    ${formatPanelSize(t.bytesDownloaded)} / ${formatPanelSize(t.totalBytes)} (${percent}%)`,
      `Speed:       ${formatTransferRate(t.downloadSpeed)}`,
      `Retry Count: ${t.retryCount || 0}/4`,
      t.errorMessage ? `Last Status: ${t.errorMessage}` : null,
      `Source Link: ${t.link.url}`,
      `Target Path: ${t.targetFilePath}`,
    ]
      .filter(Boolean)
      .join('\n');

    void navigator.clipboard.writeText(lines);
    setCopiedId(t.id);
  };

  const summaryFact =
    tasks.length === 0
      ? 'Nothing saved yet'
      : counts.downloading > 0
        ? `${counts.downloading} downloading · ${counts.completed} saved`
        : `${counts.completed} saved${counts.failed > 0 ? ` · ${counts.failed} failed` : ''}`;

  const filterTabs: Array<{ id: DownloadFilterTab; label: string; count: number }> = [
    { id: 'all', label: 'All', count: counts.all },
    { id: 'downloading', label: 'Active', count: counts.downloading },
    { id: 'paused', label: 'Paused', count: counts.paused },
    { id: 'failed', label: 'Failed', count: counts.failed },
    { id: 'completed', label: 'Done', count: counts.completed },
  ];

  const hasBulkActions =
    counts.downloading > 0 || counts.paused > 0 || counts.failed > 0 || counts.completed > 0;

  return (
    <aside
      className="player-panel player-download-panel episode-panel-overlay"
      aria-label="Downloads"
    >
      <header className="player-panel__head">
        <div>
          <h3>Downloads</h3>
          <div className="player-panel__facts">
            <span>{summaryFact}</span>
          </div>
        </div>
        <button
          type="button"
          className="icon-button"
          onClick={onClose}
          aria-label="Close download panel"
        >
          <X size={18} />
        </button>
      </header>

      {onDownloadCurrent && (
        <div className="player-dl-current">
          <div className="player-dl-current__text">
            <span className="player-dl-current__label">Current video</span>
            <span className="player-dl-current__title" title={currentTitle}>
              {currentTitle}
            </span>
            {currentDetail && <span className="player-dl-current__detail">{currentDetail}</span>}
          </div>
          {!current ? (
            <button type="button" className="btn btn-primary btn-sm" onClick={onDownloadCurrent}>
              <Download size={14} /> Download
            </button>
          ) : current.state === DownloadState.Completed ? (
            <span className="player-dl-current__state player-dl-current__state--done">
              <CheckCircle2 size={14} /> Saved
            </span>
          ) : (
            <div className="player-dl-current__progress">
              <span className="player-dl-current__state">
                {current.state === DownloadState.Downloading && current.totalBytes > 0
                  ? `${Math.min(100, Math.floor((current.bytesDownloaded / current.totalBytes) * 100))}%`
                  : current.state === DownloadState.Paused
                    ? 'Paused'
                    : current.state === DownloadState.Failed
                      ? 'Failed'
                      : 'Starting…'}
              </span>
              {current.state === DownloadState.Downloading ? (
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => onPause(current.id)}
                  aria-label="Pause this download"
                  title="Pause"
                >
                  <Pause size={14} />
                </button>
              ) : current.state === DownloadState.Paused || current.state === DownloadState.Failed ? (
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => onResume(current.id)}
                  aria-label="Resume this download"
                  title="Resume"
                >
                  <Play size={14} />
                </button>
              ) : null}
            </div>
          )}
        </div>
      )}

      {/* Filter pills */}
      <div className="player-dl-tabs" role="tablist" aria-label="Filter downloads">
        {filterTabs.map((tab) => {
          const isActive = activeFilter === tab.id;
          const showCount = tab.id === 'all' || tab.count > 0;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={`player-dl-tab${isActive ? ' player-dl-tab--active' : ''}`}
              onClick={() => setActiveFilter(tab.id)}
            >
              <span>{tab.label}</span>
              {showCount && (
                <span
                  className={`player-dl-tab__count${
                    tab.id === 'failed' && tab.count > 0 ? ' player-dl-tab__count--warn' : ''
                  }`}
                >
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Quiet bulk controls — only rendered when actionable */}
      {hasBulkActions && (
        <div className="player-dl-actions">
          {counts.downloading > 0 && (
            <button
              type="button"
              className="player-dl-action-btn"
              onClick={handlePauseAll}
              title="Pause active downloads"
            >
              <Pause size={12} /> Pause all
            </button>
          )}
          {(counts.paused > 0 || counts.failed > 0) && (
            <button
              type="button"
              className="player-dl-action-btn"
              onClick={handleResumeAll}
              title="Resume paused or retry failed downloads"
            >
              <Play size={12} /> Resume all
            </button>
          )}
          {counts.completed > 0 && (
            <button
              type="button"
              className="player-dl-action-btn"
              onClick={handleClearCompleted}
              title="Clear finished items from this list"
            >
              Clear finished
            </button>
          )}
        </div>
      )}

      {/* Download queue & saved items */}
      <div className="player-dl-list">
        {tasks.length === 0 ? (
          <div className="player-dl-empty">
            Downloads you start will appear here so you can watch offline.
          </div>
        ) : filteredTasks.length === 0 ? (
          <div className="player-dl-empty">
            {activeFilter === 'downloading'
              ? 'Nothing is downloading right now.'
              : activeFilter === 'completed'
                ? 'No finished downloads yet.'
                : activeFilter === 'paused'
                  ? 'No paused downloads.'
                  : activeFilter === 'failed'
                    ? 'No failed downloads.'
                    : 'No downloads match this filter.'}
            <div style={{ marginTop: '0.6rem' }}>
              <button
                type="button"
                className="player-dl-action-btn"
                onClick={() => setActiveFilter('all')}
              >
                Show all ({tasks.length})
              </button>
            </div>
          </div>
        ) : (
          filteredTasks.map((task) => {
            const percent =
              task.totalBytes > 0
                ? Math.min(100, Math.floor((task.bytesDownloaded / task.totalBytes) * 100))
                : 0;
            const isDownloading = task.state === DownloadState.Downloading;
            const isQueued = task.state === DownloadState.Queued;
            const isRefreshing =
              task.state === DownloadState.RefreshingSource || task.state === DownloadState.Retrying;
            const isPaused = task.state === DownloadState.Paused;
            const isFailed = task.state === DownloadState.Failed;
            const isCompleted = task.state === DownloadState.Completed;
            const showBar = !isCompleted && (isDownloading || isPaused || percent > 0);
            const subtitle = formatTaskSubtitle(task);
            const displayTitle = task.episodeNumber
              ? `${task.title} · Ep ${task.episodeNumber}`
              : task.title;

            return (
              <div
                key={task.id}
                className={`player-dl-card${
                  isFailed ? ' player-dl-card--failed' : isDownloading || isRefreshing ? ' player-dl-card--active' : ''
                }`}
              >
                <div className="player-dl-card__top">
                  <span className="player-dl-card__title" title={displayTitle}>
                    {displayTitle}
                  </span>

                  {isDownloading ? (
                    <span className="player-dl-card__status player-dl-card__status--active">
                      <span>
                        {task.totalBytes > 0 ? `${percent}%` : ''}
                        {task.downloadSpeed > 0
                          ? `${task.totalBytes > 0 ? ' · ' : ''}${formatTransferRate(task.downloadSpeed)}`
                          : ''}
                      </span>
                      <button
                        type="button"
                        className="player-dl-card__pill"
                        onClick={() => onPause(task.id)}
                        aria-label="Pause download"
                      >
                        <Pause size={11} /> Pause
                      </button>
                    </span>
                  ) : isRefreshing ? (
                    <span className="player-dl-card__status player-dl-card__status--active">
                      <RotateCw size={12} className="spin" /> Reconnecting…
                    </span>
                  ) : isQueued ? (
                    <span className="player-dl-card__status">Waiting</span>
                  ) : isPaused ? (
                    <button
                      type="button"
                      className="player-dl-card__pill"
                      onClick={() => onResume(task.id)}
                      aria-label="Resume download"
                    >
                      <Play size={11} /> Resume
                    </button>
                  ) : isFailed ? (
                    <button
                      type="button"
                      className="player-dl-card__pill player-dl-card__pill--retry"
                      onClick={() => onResume(task.id)}
                      aria-label="Retry download"
                    >
                      <RotateCw size={11} /> Retry
                    </button>
                  ) : null}
                </div>

                {showBar && (
                  <div className="player-dl-card__bar">
                    <div
                      className={`player-dl-card__fill${isPaused ? ' player-dl-card__fill--paused' : ''}`}
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                )}

                <div className="player-dl-card__bottom">
                  <span
                    className={`player-dl-card__meta${isFailed ? ' player-dl-card__meta--failed' : ''}`}
                    title={isFailed && task.errorMessage ? task.errorMessage : subtitle}
                  >
                    {isFailed
                      ? task.errorMessage || "Couldn't finish download"
                      : isDownloading && task.etaSeconds > 0
                        ? `${subtitle}${subtitle ? ' · ' : ''}${formatEtaDuration(task.etaSeconds)} left`
                        : isPaused
                          ? `${subtitle}${subtitle ? ' · ' : ''}Paused`
                          : subtitle || (isCompleted ? 'Saved' : '')}
                  </span>

                  <div className="player-dl-card__actions">
                    {onReveal && (
                      <button
                        type="button"
                        className="player-dl-card__btn"
                        onClick={() => onReveal(task.targetFilePath)}
                        title="Show file in folder"
                        aria-label="Show file in folder"
                      >
                        <FolderOpen size={13} />
                      </button>
                    )}
                    <button
                      type="button"
                      className="player-dl-card__btn"
                      onClick={() => copyTaskMeta(task)}
                      title="Copy technical details"
                      aria-label="Copy technical details"
                    >
                      {copiedId === task.id ? (
                        <Check size={13} style={{ color: '#10b981' }} />
                      ) : (
                        <Copy size={13} />
                      )}
                    </button>
                    <button
                      type="button"
                      className="player-dl-card__btn player-dl-card__btn--danger"
                      onClick={() => onRemove(task.id)}
                      title={isCompleted ? 'Remove from list' : 'Cancel & remove'}
                      aria-label={isCompleted ? 'Remove download from list' : 'Cancel and remove download'}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {onOpenDownloads && (
        <footer className="player-dl-footer">
          <span className="player-dl-footer__hint">Playback keeps running</span>
          <button
            type="button"
            className="player-dl-footer__link"
            onClick={onOpenDownloads}
            title="Show the full Downloads screen — playback keeps running"
          >
            Manage all downloads
            <ArrowUpRight size={14} />
          </button>
        </footer>
      )}
    </aside>
  );
};
