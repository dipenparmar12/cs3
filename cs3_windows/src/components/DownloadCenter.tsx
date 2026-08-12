import React from 'react';
import type { DownloadTask } from '../types/download';
import { DownloadState } from '../types/download';
import { Play, Pause, Trash2, ArrowDown, Folder, Zap } from 'lucide-react';

interface DownloadCenterProps {
  tasks: DownloadTask[];
  hasBinaries?: boolean;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onRemove: (id: string) => void;
  onOpenBinarySetup?: () => void;
}

export const DownloadCenter: React.FC<DownloadCenterProps> = ({
  tasks,
  hasBinaries = true,
  onPause,
  onResume,
  onRemove,
  onOpenBinarySetup
}) => {
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Top Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#fff' }}>Download Manager</h2>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            High-speed multi-threaded downloads via aria2c daemon engine
          </p>
        </div>

        {/* Hide banner/button if binaries are already configured */}
        {!hasBinaries && onOpenBinarySetup && (
          <button onClick={onOpenBinarySetup} className="btn btn-secondary" style={{ borderColor: 'var(--accent-primary)' }}>
            <Zap size={16} style={{ color: 'var(--accent-light)' }} />
            <span>⚡ 1-Click Engine Setup</span>
          </button>
        )}
      </div>

      {/* Downloads List */}
      {tasks.length === 0 ? (
        <div style={{
          padding: '4rem 2rem',
          textAlign: 'center',
          background: 'var(--bg-card)',
          borderRadius: 'var(--radius-lg)',
          border: '1px dashed var(--border-color)',
          color: 'var(--text-muted)'
        }}>
          <ArrowDown size={40} style={{ margin: '0 auto 1rem', opacity: 0.5 }} />
          <h3 style={{ fontSize: '1rem', color: '#fff', marginBottom: '0.5rem' }}>No Active Downloads</h3>
          <p style={{ fontSize: '0.8rem' }}>Browse media titles and click "1-Click Download" to start high-speed stream downloads.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {tasks.map((task) => {
            const percent = task.totalBytes > 0
              ? Math.min(100, Math.floor((task.bytesDownloaded / task.totalBytes) * 100))
              : 0;

            const isDownloading = task.state === DownloadState.Downloading;

            return (
              <div
                key={task.id}
                style={{
                  background: 'var(--bg-card)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-color)',
                  padding: '1.25rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '1.25rem'
                }}
              >
                {/* Poster Thumbnail */}
                <div style={{
                  width: '48px',
                  height: '68px',
                  borderRadius: 'var(--radius-sm)',
                  overflow: 'hidden',
                  flexShrink: 0,
                  backgroundColor: 'var(--bg-input)'
                }}>
                  {task.posterUrl ? (
                    <img src={task.posterUrl} alt={task.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Folder size={20} style={{ color: 'var(--text-subtle)' }} />
                    </div>
                  )}
                </div>

                {/* Task Details & Progress */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <h4 style={{ fontSize: '0.92rem', fontWeight: 600, color: '#fff' }}>
                        {task.title} {task.episodeNumber ? `• Ep ${task.episodeNumber}` : ''}
                      </h4>
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-subtle)' }}>
                        Provider: {task.providerName || 'aria2c'}
                      </span>
                    </div>

                    <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--accent-light)' }}>
                      {isDownloading ? formatSpeed(task.downloadSpeed) : task.state}
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div style={{
                    height: '6px',
                    backgroundColor: 'var(--bg-input)',
                    borderRadius: '3px',
                    overflow: 'hidden',
                    width: '100%'
                  }}>
                    <div style={{
                      height: '100%',
                      width: `${percent}%`,
                      backgroundColor: task.state === DownloadState.Completed ? 'var(--status-success)' : 'var(--accent-primary)',
                      transition: 'width 0.3s ease'
                    }} />
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    <span>{formatSize(task.bytesDownloaded)} / {formatSize(task.totalBytes)} ({percent}%)</span>
                    <span>{task.etaSeconds > 0 ? `ETA: ${task.etaSeconds}s` : ''}</span>
                  </div>
                </div>

                {/* Control Action Buttons */}
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  {isDownloading ? (
                    <button onClick={() => onPause(task.id)} className="btn btn-secondary btn-icon" title="Pause Download">
                      <Pause size={16} />
                    </button>
                  ) : (
                    <button onClick={() => onResume(task.id)} className="btn btn-secondary btn-icon" title="Resume Download">
                      <Play size={16} />
                    </button>
                  )}
                  <button onClick={() => onRemove(task.id)} className="btn btn-secondary btn-icon" title="Cancel & Remove">
                    <Trash2 size={16} style={{ color: 'var(--status-error)' }} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
