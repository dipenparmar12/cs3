import React, { useEffect, useState } from 'react';
import { Download, HardDrive, RefreshCw, Zap, Code, Tv, CheckCircle2 } from 'lucide-react';
import { MediaComponentsCard } from '../components/MediaComponentsCard';
import { SourceSettings } from '../components/SourceSettings';

interface SettingsViewProps {
  hasBinaries?: boolean;
  onOpenBinarySetup?: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  hasBinaries = true,
  onOpenBinarySetup
}) => {
  const [downloadDir, setDownloadDir] = useState('%USERPROFILE%\\Downloads\\CloudStream');
  const [useLiveStreams, setUseLiveStreams] = useState(true);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    if (window.cloudstream) {
      window.cloudstream
        .getSetting('use_live_streaming_sources', 'true')
        .then((value) => setUseLiveStreams(value !== 'false'));
    }
  }, []);

  const handleToggleLiveStreams = async (enabled: boolean) => {
    setUseLiveStreams(enabled);
    if (window.cloudstream) {
      await window.cloudstream.setSetting('use_live_streaming_sources', enabled);
      setStatusMessage(enabled ? '✓ Dev Mode: Live Content Streaming Mode Enabled!' : '✓ Dev Mode: Demo Fallback Streaming Mode Active');
      setTimeout(() => setStatusMessage(null), 3000);
    }
  };

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
        setTimeout(() => setStatusMessage(null), 3000);
      }
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem', maxWidth: '800px' }}>
      <div>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#fff' }}>Application Settings</h2>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          Configure sources and ranking, download paths, downloader engines, and CS3 Android backup imports
        </p>
      </div>

      <MediaComponentsCard />

      {/* Sources first: it is the only section that determines whether the app
          can find anything at all, so it should not be buried below downloads. */}
      <SourceSettings />

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

      {/* Developer Options & Streaming Engine Toggle Section */}
      <div style={{
        background: 'var(--bg-card)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--accent-primary)',
        padding: '1.25rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#fff' }}>
          <Code size={18} style={{ color: 'var(--accent-light)' }} />
          <h3 style={{ fontSize: '1rem', fontWeight: 700 }}>Developer Options & Media Streaming Engine</h3>
        </div>

        <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
          Toggle between <strong>Live Actual Content Mode</strong> (scrapes and streams real 1080p/4K master streams and open-source movies live) and <strong>Demo Fallback Mode</strong> for offline development testing.
        </p>

        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'var(--bg-input)',
          padding: '0.75rem 1rem',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--border-color)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <Tv size={20} style={{ color: useLiveStreams ? 'var(--status-success)' : 'var(--text-subtle)' }} />
            <div>
              <div style={{ fontSize: '0.88rem', fontWeight: 600, color: '#fff' }}>
                {useLiveStreams ? 'Actual Content Streaming Mode (Live)' : 'Demo Content Streaming Mode (Demo)'}
              </div>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-subtle)' }}>
                {useLiveStreams ? 'Streams real 1080p/4K media & live master playlists' : 'Uses offline demo streams for testing'}
              </span>
            </div>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={useLiveStreams}
              onChange={(e) => handleToggleLiveStreams(e.target.checked)}
              style={{ width: '18px', height: '18px', accentColor: 'var(--accent-primary)', cursor: 'pointer' }}
            />
            <span style={{ fontSize: '0.82rem', fontWeight: 600, color: '#fff' }}>
              {useLiveStreams ? 'ON' : 'OFF'}
            </span>
          </label>
        </div>
      </div>

      {/* Downloader Engine Setup & Re-install Section */}
      <div style={{
        background: 'var(--bg-card)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-color)',
        padding: '1.25rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#fff' }}>
            <Zap size={18} style={{ color: 'var(--accent-light)' }} />
            <h3 style={{ fontSize: '1rem', fontWeight: 700 }}>Downloader Engine Configuration</h3>
          </div>

          {hasBinaries && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--status-success)', fontSize: '0.8rem', fontWeight: 600 }}>
              <CheckCircle2 size={16} />
              <span>Engines Configured & Ready</span>
            </div>
          )}
        </div>

        <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
          {hasBinaries
            ? 'The portable aria2c (16-thread multi-connection stream downloader) and yt-dlp engines are configured and active.'
            : 'Auto-configure portable aria2c and yt-dlp fallback engine automatically upon prompt confirmation.'}
        </p>

        <button onClick={onOpenBinarySetup} className={`btn ${hasBinaries ? 'btn-secondary' : 'btn-primary'}`} style={{ width: 'fit-content', marginTop: '0.25rem' }}>
          <Download size={16} />
          <span>{hasBinaries ? 'Reinstall / Update Downloader Engines' : '⚡ 1-Click Auto Setup Engines'}</span>
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
