import React, { useState } from 'react';
import { Zap, Download, CheckCircle2, AlertCircle, RefreshCw, X } from 'lucide-react';

interface BinarySetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const BinarySetupModal: React.FC<BinarySetupModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [isInstalling, setIsInstalling] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isDone, setIsDone] = useState(false);

  if (!isOpen) return null;

  const handleStartSetup = async () => {
    setIsInstalling(true);
    setStatusMessage('Downloading & configuring portable aria2c engine...');

    if (window.cloudstream) {
      try {
        const res = await window.cloudstream.setupBinaries();
        if (res.success) {
          setIsDone(true);
          setStatusMessage('✓ 1-Click Downloader Engine Configured Successfully!');
          setTimeout(() => {
            onSuccess();
            onClose();
          }, 1500);
        } else {
          setStatusMessage(`Setup Notice: ${res.message} (HTTP stream downloader active)`);
        }
      } catch (e: any) {
        setStatusMessage(`Notice: ${e.message} (HTTP fallback stream active)`);
      }
    }
    setIsInstalling(false);
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.75)',
      backdropFilter: 'blur(6px)',
      zIndex: 10000,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '1.5rem'
    }}>
      <div style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--accent-primary)',
        borderRadius: 'var(--radius-lg)',
        maxWidth: '500px',
        width: '100%',
        padding: '1.75rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '1.25rem',
        boxShadow: '0 20px 50px rgba(0,0,0,0.8)'
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{
              width: '40px',
              height: '40px',
              borderRadius: 'var(--radius-md)',
              background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff'
            }}>
              <Zap size={22} />
            </div>
            <div>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#fff' }}>
                1-Click Downloader Setup
              </h3>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Auto-configure aria2c & yt-dlp transfer engines
              </span>
            </div>
          </div>

          <button onClick={onClose} className="btn btn-secondary btn-icon" style={{ height: '32px', width: '32px' }}>
            <X size={16} />
          </button>
        </div>

        {/* Info Content */}
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
          Auto-configure the portable <strong>aria2c engine</strong> (16-thread multi-connection transfer engine) and <strong>yt-dlp fallback extraction adapter</strong> in 1 click.
        </p>

        {/* Status Message */}
        {statusMessage && (
          <div style={{
            fontSize: '0.82rem',
            color: isDone ? 'var(--status-success)' : 'var(--accent-light)',
            background: 'var(--bg-input)',
            padding: '0.75rem 1rem',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-color)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.6rem'
          }}>
            {isInstalling ? <RefreshCw size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <CheckCircle2 size={16} />}
            <span>{statusMessage}</span>
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
          <button onClick={onClose} className="btn btn-secondary" style={{ flex: 1 }}>
            Use Built-in HTTP Downloader
          </button>

          <button
            onClick={handleStartSetup}
            disabled={isInstalling}
            className="btn btn-primary"
            style={{ flex: 1.2 }}
          >
            <Download size={16} />
            <span>{isInstalling ? 'Configuring...' : '1-Click Auto Setup'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
