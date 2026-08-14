import React, { useState } from 'react';
import {
  X, Play, Pause, RotateCw, Trash2, Check, Copy, Download, FolderOpen, ArrowUpRight,
} from 'lucide-react';
import type { DownloadTask } from '../../types/download';
import { DownloadState } from '../../types/download';

/**
 * The download summary shown over the player.
 *
 * Deliberately partial: it answers "is this downloading, and how fast", which is
 * what someone watching a film wants to know without leaving it. The whole queue,
 * completed items, retry history and file locations live on the Downloads
 * screen — and until `onOpenDownloads` existed, the only way to reach that was
 * to close the player, which ended the stream you were checking on.
 */

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
}) => {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  if (!open) return null;

  const activeTasks = tasks.filter((t) => t.state !== DownloadState.Completed);
  const displayTasks = activeTasks.length > 0 ? activeTasks : tasks;

  const formatSize = (bytes: number): string => {
    if (bytes <= 0) return '0 MB';
    const mb = bytes / (1024 * 1024);
    if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
    return `${mb.toFixed(0)} MB`;
  };

  const formatSpeed = (bytesPerSec: number): string => {
    if (bytesPerSec <= 0) return '0 KB/s';
    const mb = bytesPerSec / (1024 * 1024);
    if (mb >= 1) return `${mb.toFixed(1)} MB/s`;
    return `${(bytesPerSec / 1024).toFixed(0)} KB/s`;
  };

  const copyTaskMeta = (t: DownloadTask) => {
    const percent =
      t.totalBytes > 0 ? Math.min(100, Math.floor((t.bytesDownloaded / t.totalBytes) * 100)) : 0;
    const lines = [
      `CloudStream Desktop — Download Metadata`,
      `Title:       ${t.title}`,
      `Provider:    ${t.providerName || 'Built-in'}`,
      `Quality:     ${t.quality || t.resolution ? `${t.quality || t.resolution}p` : 'Unknown'}`,
      `State:       ${t.state}`,
      `Progress:    ${formatSize(t.bytesDownloaded)} / ${formatSize(t.totalBytes)} (${percent}%)`,
      `Speed:       ${formatSpeed(t.downloadSpeed)}`,
      `Retry Count: ${t.retryCount || 0}/4`,
      t.errorMessage ? `Last Status: ${t.errorMessage}` : null,
      `Source Link: ${t.link.url}`,
      `Target Path: ${t.targetFilePath}`,
    ]
      .filter(Boolean)
      .join('\n');

    void navigator.clipboard.writeText(lines);
    setCopiedId(t.id);
    setTimeout(() => setCopiedId(null), 2500);
  };

  return (
    <div
      className="player-panel player-download-panel episode-panel-overlay"
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        width: '360px',
        backgroundColor: 'rgba(12, 15, 23, 0.96)',
        backdropFilter: 'blur(12px)',
        zIndex: 60,
        display: 'flex',
        flexDirection: 'column',
        borderLeft: '1px solid rgba(255, 255, 255, 0.1)',
        boxShadow: '-8px 0 24px rgba(0, 0, 0, 0.6)',
        color: '#fff',
      }}
    >
      {/* Panel Header */}
      <div
        style={{
          padding: '1.2rem 1.25rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <Download size={20} style={{ color: 'var(--accent-light, #60a5fa)' }} />
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>
            Active Downloads ({activeTasks.length})
          </h3>
        </div>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close download panel"
          style={{ background: 'transparent', border: 'none', color: '#aaa', cursor: 'pointer' }}
        >
          <X size={20} />
        </button>
      </div>

      {/* Panel Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {displayTasks.length === 0 ? (
          <div
            style={{
              padding: '2rem 1rem',
              textAlign: 'center',
              color: 'var(--text-subtle, #888)',
              fontSize: '0.88rem',
            }}
          >
            No active downloads.
          </div>
        ) : (
          displayTasks.map((task) => {
            const percent =
              task.totalBytes > 0
                ? Math.min(100, Math.floor((task.bytesDownloaded / task.totalBytes) * 100))
                : 0;
            const isDownloading = task.state === DownloadState.Downloading;
            const isResumable =
              task.state === DownloadState.Paused || task.state === DownloadState.Failed;
            const isRefreshing =
              task.state === DownloadState.RefreshingSource || task.state === DownloadState.Retrying;

            return (
              <div
                key={task.id}
                style={{
                  backgroundColor: 'rgba(255, 255, 255, 0.05)',
                  borderRadius: '8px',
                  padding: '0.85rem',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.4rem',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                  <div style={{ overflow: 'hidden' }}>
                    <div
                      style={{
                        fontSize: '0.86rem',
                        fontWeight: 600,
                        color: '#fff',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                      title={task.title}
                    >
                      {task.title} {task.episodeNumber ? `• Ep ${task.episodeNumber}` : ''}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-subtle, #888)' }}>
                      {task.providerName || 'aria2c'} {task.resolution ? `• ${task.resolution}p` : ''}
                    </div>
                  </div>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--accent-light, #60a5fa)', flexShrink: 0 }}>
                    {isDownloading ? (
                      formatSpeed(task.downloadSpeed)
                    ) : isRefreshing ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                        <RotateCw size={12} className="spin" /> Retrying...
                      </span>
                    ) : (
                      task.state
                    )}
                  </div>
                </div>

                {/* Progress Bar */}
                <div
                  style={{
                    height: '5px',
                    backgroundColor: 'rgba(255, 255, 255, 0.1)',
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
                          ? 'var(--status-success, #10b981)'
                          : 'var(--accent-primary, #3b82f6)',
                      transition: 'width 0.3s ease',
                    }}
                  />
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--text-muted, #aaa)' }}>
                  <span>
                    {formatSize(task.bytesDownloaded)} / {formatSize(task.totalBytes)} ({percent}%)
                  </span>
                  <span>{task.etaSeconds > 0 ? `ETA: ${task.etaSeconds}s` : ''}</span>
                </div>

                {task.errorMessage && (
                  <div
                    style={{
                      fontSize: '0.72rem',
                      color: task.state === DownloadState.Failed ? '#f87171' : '#aaa',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                    title={task.errorMessage}
                  >
                    {task.errorMessage}
                  </div>
                )}

                {/* Controls */}
                <div style={{ display: 'flex', gap: '0.35rem', marginTop: '0.2rem', justifyContent: 'flex-end' }}>
                  <button
                    className="btn btn-secondary btn-icon"
                    onClick={() => copyTaskMeta(task)}
                    title="Copy Download Debug Metadata"
                    style={{ padding: '0.3rem 0.5rem', background: 'rgba(255, 255, 255, 0.08)', border: 'none', borderRadius: '4px', color: '#ccc', cursor: 'pointer' }}
                  >
                    {copiedId === task.id ? <Check size={13} style={{ color: '#10b981' }} /> : <Copy size={13} />}
                  </button>
                  {isDownloading && (
                    <button
                      className="btn btn-secondary btn-icon"
                      onClick={() => onPause(task.id)}
                      title="Pause Download"
                      style={{ padding: '0.3rem 0.5rem', background: 'rgba(255, 255, 255, 0.08)', border: 'none', borderRadius: '4px', color: '#ccc', cursor: 'pointer' }}
                    >
                      <Pause size={13} />
                    </button>
                  )}
                  {isResumable && (
                    <button
                      className="btn btn-secondary btn-icon"
                      onClick={() => onResume(task.id)}
                      title={task.state === DownloadState.Failed ? 'Retry Download' : 'Resume Download'}
                      style={{ padding: '0.3rem 0.5rem', background: 'rgba(255, 255, 255, 0.08)', border: 'none', borderRadius: '4px', color: '#ccc', cursor: 'pointer' }}
                    >
                      {task.state === DownloadState.Failed ? <RotateCw size={13} /> : <Play size={13} />}
                    </button>
                  )}
                  {onReveal && (
                    <button
                      className="btn btn-secondary btn-icon"
                      onClick={() => onReveal(task.targetFilePath)}
                      title="Show in Folder"
                      style={{ padding: '0.3rem 0.5rem', background: 'rgba(255, 255, 255, 0.08)', border: 'none', borderRadius: '4px', color: '#ccc', cursor: 'pointer' }}
                    >
                      <FolderOpen size={13} />
                    </button>
                  )}
                  <button
                    className="btn btn-secondary btn-icon"
                    onClick={() => onRemove(task.id)}
                    title="Cancel & Remove"
                    style={{ padding: '0.3rem 0.5rem', background: 'rgba(255, 255, 255, 0.08)', border: 'none', borderRadius: '4px', color: '#f87171', cursor: 'pointer' }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/*
        Anchored to the bottom rather than sitting in the list, so it stays
        reachable with a long queue and does not compete with the per-download
        controls above it.
      */}
      {onOpenDownloads && (
        <div
          style={{
            padding: '0.85rem 1rem',
            borderTop: '1px solid rgba(255, 255, 255, 0.1)',
          }}
        >
          <button
            onClick={onOpenDownloads}
            title="Show the full Downloads screen — playback keeps running"
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
              padding: '0.6rem 0.75rem',
              background: 'rgba(255, 255, 255, 0.08)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: '6px',
              color: '#fff',
              fontSize: '0.85rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Open Downloads
            <ArrowUpRight size={15} />
          </button>
          <p
            style={{
              margin: '0.5rem 0 0',
              fontSize: '0.72rem',
              color: 'var(--text-subtle, #888)',
              textAlign: 'center',
            }}
          >
            Playback keeps running while you are there.
          </p>
        </div>
      )}
    </div>
  );
};
