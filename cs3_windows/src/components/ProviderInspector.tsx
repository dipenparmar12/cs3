import React, { useState } from 'react';
import { Bug, X, Play } from 'lucide-react';
import type { ExtractorLink } from '../types/api';

interface ProviderInspectorProps {
  isOpen: boolean;
  onClose: () => void;
  providers: string[];
}

export const ProviderInspector: React.FC<ProviderInspectorProps> = ({
  isOpen,
  onClose,
  providers,
}) => {
  const [selectedProvider, setSelectedProvider] = useState(providers[0] || 'CloudStream Builtin');
  const [testUrl, setTestUrl] = useState('');
  const [extractedLinks, setExtractedLinks] = useState<ExtractorLink[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  if (!isOpen) return null;

  const handleTestExtract = async () => {
    if (!testUrl) return;
    setIsLoading(true);
    try {
      if (window.cloudstream) {
        // loadLinks is gone: sources now come from the indexer pipeline, which
        // returns torrent sources rather than direct extractor links.
        const response = await window.cloudstream.getSources({ mediaUrl: testUrl });
        setExtractedLinks(
          response.sources.map((source) => ({
            source: source.indexerName,
            name: source.title,
            url: source.magnet || source.torrentUrl || source.infoHash,
            referer: '',
            quality: source.parsed.resolution || 0,
          }))
        );
      }
    } catch (e) {
      console.error('Inspection failed:', e);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{
      position: 'fixed',
      bottom: 0,
      left: 0,
      right: 0,
      height: '420px',
      backgroundColor: '#0d111a',
      borderTop: '2px solid var(--accent-primary)',
      zIndex: 9000,
      display: 'flex',
      flexDirection: 'column',
      boxShadow: '0 -10px 30px rgba(0,0,0,0.8)'
    }}>
      {/* Header Bar */}
      <div style={{
        padding: '0.75rem 1.5rem',
        backgroundColor: 'var(--bg-sidebar)',
        borderBottom: '1px solid var(--border-color)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Bug size={18} style={{ color: 'var(--accent-light)' }} />
          <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#fff' }}>
            CloudStream Provider Inspector (F12)
          </h3>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <select
            value={selectedProvider}
            onChange={(e) => setSelectedProvider(e.target.value)}
            style={{
              backgroundColor: 'var(--bg-input)',
              border: '1px solid var(--border-color)',
              color: '#fff',
              padding: '0.35rem 0.75rem',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.8rem'
            }}
          >
            {providers.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>

          <button onClick={onClose} className="btn btn-secondary btn-icon" style={{ height: '30px', width: '30px' }}>
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Test Bar */}
      <div style={{
        padding: '0.75rem 1.5rem',
        borderBottom: '1px solid var(--border-color)',
        display: 'flex',
        gap: '0.75rem',
        alignItems: 'center'
      }}>
        <input
          type="text"
          placeholder="Paste video page URL to test extraction..."
          value={testUrl}
          onChange={(e) => setTestUrl(e.target.value)}
          style={{
            flex: 1,
            padding: '0.45rem 0.85rem',
            backgroundColor: 'var(--bg-input)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-sm)',
            color: '#fff',
            fontSize: '0.82rem'
          }}
        />
        <button onClick={handleTestExtract} className="btn btn-primary" style={{ padding: '0.45rem 1rem', fontSize: '0.82rem' }}>
          <Play size={14} />
          <span>{isLoading ? 'Extracting...' : 'Test Extractor'}</span>
        </button>
      </div>

      {/* Content Inspector Body */}
      <div style={{ flex: 1, padding: '1rem 1.5rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <h4 style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted)' }}>
          Extracted Links Payload ({extractedLinks.length})
        </h4>

        {extractedLinks.length === 0 ? (
          <p style={{ fontSize: '0.8rem', color: 'var(--text-subtle)' }}>
            Enter a video page URL above and click "Test Extractor" to inspect raw stream links and headers.
          </p>
        ) : (
          extractedLinks.map((link, idx) => (
            <div
              key={idx}
              style={{
                background: 'var(--bg-card)',
                padding: '0.85rem 1rem',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-color)',
                fontSize: '0.8rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.35rem'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--accent-light)', fontWeight: 600 }}>
                <span>{link.name} ({link.quality}p)</span>
                <span>{link.source}</span>
              </div>
              <code style={{ fontSize: '0.75rem', color: 'var(--text-main)', wordBreak: 'break-all' }}>
                {link.url}
              </code>
              {link.referer && (
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  Referer: {link.referer}
                </span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};
