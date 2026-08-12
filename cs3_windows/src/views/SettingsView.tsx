import React, { useState } from 'react';
import { Download, HardDrive, ShieldCheck, RefreshCw, Zap } from 'lucide-react';

interface SettingsViewProps {
  onOpenBinarySetup?: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ onOpenBinarySetup }) => {
  const [downloadDir, setDownloadDir] = useState('%USERPROFILE%\\Downloads\\CloudStream');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const handleSelectDirectory = async () => {
    if (window.cloudstream) {
      const path = await window.cloudstream.selectDirectory();
      if (path) {
        setDownloadDir(path);
      }
    }
  };

  const handleImportBackup = async () => {
    if (window.cloudstream) {
      const selectedFile = await window.cloudstream.selectDirectory();
      if (selectedFile) {
        const success = await window.cloudstream.importBackup(selectedFile);
        setStatusMessage(success ? '✓ CS3 Android Backup Imported Successfully!' : 'Failed to import backup.');
      }
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem', maxWidth: '800px' }}>
      <div>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#fff' }}>Application Settings</h2>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          Configure download paths, downloader engines, and CS3 Android backup imports
        </p>
      </div>

      {statusMessage && (
        <div style={{
          background: 'rgba(59, 130, 246, 0.15)',
          border: '1px solid var(--accent-primary)',
          padding: '0.75rem 1rem',
          borderRadius: 'var(--radius-md)',
          color: '#fff',
          fontSize: '0.85rem'
        }}>
          {statusMessage}
        </div>
      )}

      {/* Downloader Engine 1-Click Setup Section */}
      <div style={{
        background: 'var(--bg-card)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--accent-primary)',
        padding: '1.25rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#fff' }}>
          <Zap size={18} style={{ color: 'var(--accent-light)' }} />
          <h3 style={{ fontSize: '1rem', fontWeight: 700 }}>1-Click Downloader Engine Setup</h3>
        </div>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
          Auto-configure portable <strong>aria2c</strong> (16-thread multi-connection stream downloader) and <strong>yt-dlp</strong> fallback engine automatically upon prompt confirmation.
        </p>
        <button onClick={onOpenBinarySetup} className="btn btn-primary" style={{ width: 'fit-content', marginTop: '0.25rem' }}>
          <Download size={16} />
          <span>⚡ 1-Click Auto Setup Engines</span>
        </button>
      </div>

      {/* Download Storage Settings */}
      <div style={{
        background: 'var(--bg-card)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-color)',
        padding: '1.25rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#fff' }}>
          <HardDrive size={18} style={{ color: 'var(--accent-light)' }} />
          <h3 style={{ fontSize: '1rem', fontWeight: 700 }}>Download Storage Location</h3>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <input
            type="text"
            readOnly
            value={downloadDir}
            style={{
              flex: 1,
              padding: '0.55rem 1rem',
              backgroundColor: 'var(--bg-input)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-md)',
              color: '#fff',
              fontSize: '0.85rem'
            }}
          />
          <button onClick={handleSelectDirectory} className="btn btn-secondary">
            Change Folder
          </button>
        </div>
      </div>

      {/* CS3 Android Backup Migration */}
      <div style={{
        background: 'var(--bg-card)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-color)',
        padding: '1.25rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#fff' }}>
          <RefreshCw size={18} style={{ color: 'var(--accent-light)' }} />
          <h3 style={{ fontSize: '1rem', fontWeight: 700 }}>Android CS3 Backup Migration (.txt)</h3>
        </div>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
          Import your CloudStream Android `.txt` backup file to restore watch history, bookmarks, and custom settings.
        </p>

        <button onClick={handleImportBackup} className="btn btn-secondary" style={{ width: 'fit-content' }}>
          Import CS3_Backup_File.txt
        </button>
      </div>
    </div>
  );
};
