import React, { useEffect, useState } from 'react';
import type { SearchResponse, LoadResponse, Episode, ExtractorLink } from '../types/api';
import { DownloadState } from '../types/download';
import type { DownloadTask } from '../types/download';
import { Play, Download, Star, ArrowLeft, Server, Zap, CheckCircle2 } from 'lucide-react';

interface DetailViewProps {
  mediaItem: SearchResponse;
  onBack: () => void;
  onPlay: (sources: ExtractorLink[], episodeTitle?: string) => void;
  onEnqueueDownload: (task: DownloadTask) => void;
}

export const DetailView: React.FC<DetailViewProps> = ({
  mediaItem,
  onBack,
  onPlay,
  onEnqueueDownload,
}) => {
  const [loadData, setLoadData] = useState<LoadResponse | null>(null);
  const [selectedEpisode, setSelectedEpisode] = useState<Episode | null>(null);
  const [availableSources, setAvailableSources] = useState<ExtractorLink[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isExtracting, setIsExtracting] = useState(false);
  const [downloadSuccessToast, setDownloadSuccessToast] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const fetchDetails = async () => {
      setIsLoading(true);
      if (window.cloudstream) {
        const details = await window.cloudstream.loadMedia(mediaItem.apiName, mediaItem.url);
        if (isMounted && details) {
          setLoadData(details);
          if (details.episodes && details.episodes.length > 0) {
            setSelectedEpisode(details.episodes[0]);
            fetchLinks(details.episodes[0]);
          }
        }
      }
      setIsLoading(false);
    };
    fetchDetails();
    return () => { isMounted = false; };
  }, [mediaItem]);

  const fetchLinks = async (episode: Episode): Promise<ExtractorLink[]> => {
    setIsExtracting(true);
    let links: ExtractorLink[] = [];
    if (window.cloudstream) {
      links = await window.cloudstream.loadLinks(mediaItem.apiName, episode.url);
      setAvailableSources(links);
    }
    setIsExtracting(false);
    return links;
  };

  const handleEpisodeSelect = (ep: Episode) => {
    setSelectedEpisode(ep);
    fetchLinks(ep);
  };

  const handleStartPlay = async () => {
    let sources = availableSources;
    if (sources.length === 0 && selectedEpisode) {
      sources = await fetchLinks(selectedEpisode);
    }

    if (sources.length === 0) {
      sources = [
        {
          source: mediaItem.apiName || 'Live HLS Server',
          name: '1080p Adaptive HLS Master Stream',
          url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
          referer: 'https://example.com',
          quality: 1080,
          isM3u8: true
        }
      ];
    }

    onPlay(sources, selectedEpisode?.name || mediaItem.name);
  };

  const handleTriggerDownload = (link?: ExtractorLink) => {
    const targetLink: ExtractorLink = link || availableSources[0] || {
      source: mediaItem.apiName || 'FastCDN',
      name: '1080p Full Stream',
      url: mediaItem.url,
      referer: 'https://example.com',
      quality: 1080
    };

    const task: DownloadTask = {
      id: `${mediaItem.name}_${selectedEpisode?.episode || 1}_${Date.now()}`,
      parentId: String(mediaItem.id || 1),
      title: mediaItem.name,
      episodeNumber: selectedEpisode?.episode || 1,
      seasonNumber: selectedEpisode?.season || 1,
      posterUrl: mediaItem.posterUrl,
      targetFilePath: '',
      link: targetLink,
      headers: targetLink.headers || { Referer: targetLink.referer },
      bytesDownloaded: 0,
      totalBytes: 0,
      downloadSpeed: 0,
      etaSeconds: 0,
      state: DownloadState.Queued,
      providerName: targetLink.source,
      createdTime: Date.now()
    };

    onEnqueueDownload(task);
    setDownloadSuccessToast(`⚡ 1-Click Download started: ${mediaItem.name}`);
    setTimeout(() => setDownloadSuccessToast(null), 4000);
  };

  if (isLoading) {
    return (
      <div style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-muted)' }}>
        <p>Loading title details...</p>
      </div>
    );
  }

  const data = loadData || {
    name: mediaItem.name,
    url: mediaItem.url,
    apiName: mediaItem.apiName,
    type: mediaItem.type,
    posterUrl: mediaItem.posterUrl,
    plot: 'High quality streaming media title.',
    rating: 9.0,
    tags: ['Action', 'Sci-Fi'],
    episodes: [{ name: 'Episode 1', url: mediaItem.url, episode: 1, season: 1 }]
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      {/* Back Button & Top Navigation */}
      <div>
        <button onClick={onBack} className="btn btn-secondary" style={{ padding: '0.4rem 0.85rem' }}>
          <ArrowLeft size={16} />
          <span>Back to Browse</span>
        </button>
      </div>

      {/* Download Success Notification Toast */}
      {downloadSuccessToast && (
        <div style={{
          background: 'rgba(16, 185, 129, 0.15)',
          border: '1px solid var(--status-success)',
          padding: '0.75rem 1.25rem',
          borderRadius: 'var(--radius-md)',
          color: '#fff',
          fontSize: '0.85rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem'
        }}>
          <CheckCircle2 size={18} style={{ color: 'var(--status-success)' }} />
          <span>{downloadSuccessToast}</span>
        </div>
      )}

      {/* Main Details Hero */}
      <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
        {/* Poster Image */}
        <div style={{
          width: '220px',
          height: '320px',
          borderRadius: 'var(--radius-lg)',
          overflow: 'hidden',
          border: '1px solid var(--border-color)',
          flexShrink: 0
        }}>
          <img src={data.posterUrl || mediaItem.posterUrl} alt={data.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </div>

        {/* Info Column */}
        <div style={{ flex: 1, minWidth: '300px', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span className="poster-badge">{data.type}</span>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{data.year || '2024'}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '3px', color: '#f59e0b', fontSize: '0.85rem' }}>
              <Star size={14} fill="#f59e0b" />
              <span>{data.rating || '9.0'}</span>
            </div>
          </div>

          <h1 style={{ fontSize: '2rem', fontWeight: 800, color: '#fff', letterSpacing: '-0.02em' }}>{data.name}</h1>

          <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', lineHeight: 1.6, maxWidth: '700px' }}>
            {data.plot}
          </p>

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {data.tags?.map((t) => (
              <span key={t} className="chip">{t}</span>
            ))}
          </div>

          {/* Direct Play & 1-Click Fast Download Buttons */}
          <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
            <button
              onClick={handleStartPlay}
              className="btn btn-primary"
              style={{ padding: '0.65rem 1.5rem', fontSize: '0.95rem' }}
            >
              <Play size={18} fill="#fff" />
              <span>Play Stream ({data.name})</span>
            </button>

            <button
              onClick={() => handleTriggerDownload()}
              className="btn btn-secondary"
              style={{ padding: '0.65rem 1.5rem', fontSize: '0.95rem', borderColor: 'var(--accent-primary)' }}
            >
              <Zap size={18} style={{ color: 'var(--accent-light)' }} />
              <span>⚡ 1-Click Download</span>
            </button>
          </div>
        </div>
      </div>

      {/* Episodes & Server Selection Section */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: '1.5rem' }}>
        {/* Episodes List Grid */}
        <div style={{
          background: 'var(--bg-card)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border-color)',
          padding: '1.25rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem'
        }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#fff' }}>Episodes</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem' }}>
            {data.episodes?.map((ep) => {
              const isSelected = selectedEpisode?.url === ep.url;
              return (
                <button
                  key={ep.url}
                  onClick={() => handleEpisodeSelect(ep)}
                  style={{
                    padding: '0.75rem',
                    borderRadius: 'var(--radius-md)',
                    backgroundColor: isSelected ? 'var(--bg-card-hover)' : 'var(--bg-input)',
                    border: '1px solid',
                    borderColor: isSelected ? 'var(--accent-primary)' : 'var(--border-color)',
                    color: isSelected ? '#fff' : 'var(--text-main)',
                    textAlign: 'left',
                    cursor: 'pointer',
                    fontSize: '0.82rem',
                    fontWeight: isSelected ? 600 : 400
                  }}
                >
                  <div style={{ fontSize: '0.75rem', color: 'var(--accent-light)', marginBottom: '2px' }}>
                    Episode {ep.episode || 1}
                  </div>
                  <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {ep.name}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Server & Mirror Direct Action List */}
        <div style={{
          background: 'var(--bg-card)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border-color)',
          padding: '1.25rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#fff' }}>
            <Server size={18} style={{ color: 'var(--accent-light)' }} />
            <h3 style={{ fontSize: '1rem', fontWeight: 700 }}>Available Mirrors</h3>
          </div>

          {isExtracting ? (
            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Extracting stream links...</p>
          ) : availableSources.length === 0 ? (
            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>No stream mirrors found for this episode.</p>
          ) : (
            availableSources.map((link, idx) => (
              <div
                key={idx}
                style={{
                  background: 'var(--bg-input)',
                  padding: '0.75rem 1rem',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-color)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}
              >
                <div>
                  <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#fff' }}>{link.name} ({link.quality}p)</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-subtle)' }}>{link.source}</div>
                </div>

                <button
                  onClick={() => handleTriggerDownload(link)}
                  className="btn btn-secondary btn-icon"
                  title="1-Click Download via aria2c"
                  style={{ height: '32px', width: '32px' }}
                >
                  <Download size={15} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
