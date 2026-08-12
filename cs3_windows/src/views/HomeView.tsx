import React, { useEffect, useState } from 'react';
import type { SearchResponse } from '../types/api';
import { Play, Sparkles, Film, Tv } from 'lucide-react';

interface HomeViewProps {
  onSelectMedia: (item: SearchResponse) => void;
}

export const HomeView: React.FC<HomeViewProps> = ({ onSelectMedia }) => {
  const [trendingMovies, setTrendingMovies] = useState<SearchResponse[]>([]);
  const [trendingAnime, setTrendingAnime] = useState<SearchResponse[]>([]);
  const [popularSeries, setPopularSeries] = useState<SearchResponse[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const fetchHomeContent = async () => {
      setIsLoading(true);
      if (window.cloudstream) {
        // Fetch live search results for popular topics
        const [movies, anime, series] = await Promise.all([
          window.cloudstream.searchAll('Spider-Man'),
          window.cloudstream.searchAll('One Piece'),
          window.cloudstream.searchAll('Stranger Things')
        ]);

        if (isMounted) {
          if (movies.results.length > 0) setTrendingMovies(movies.results);
          if (anime.results.length > 0) setTrendingAnime(anime.results);
          if (series.results.length > 0) setPopularSeries(series.results);
        }
      }
      setIsLoading(false);
    };

    fetchHomeContent();
    return () => { isMounted = false; };
  }, []);

  if (isLoading) {
    return (
      <div style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-muted)' }}>
        <p>Fetching actual live media catalog...</p>
      </div>
    );
  }

  const renderSection = (title: string, icon: React.ReactNode, items: SearchResponse[]) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#fff' }}>
        {icon}
        <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>{title}</h3>
      </div>

      <div className="poster-grid">
        {items.map((item, idx) => (
          <div key={idx} className="poster-card" onClick={() => onSelectMedia(item)}>
            <div className="poster-container">
              <img src={item.posterUrl} alt={item.name} loading="lazy" />
              <span className="poster-badge">{item.type || 'Media'}</span>

              <div className="poster-overlay">
                <button className="play-button-overlay">
                  <Play size={20} fill="#fff" />
                </button>
              </div>
            </div>

            <div className="poster-info">
              <h4 className="poster-title">{item.name}</h4>
              <div className="poster-meta">
                <span>{item.year || 2024}</span>
                <span style={{ color: 'var(--accent-light)', fontSize: '0.72rem' }}>{item.apiName}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2.5rem' }}>
      {/* Featured Hero Banner */}
      {trendingMovies.length > 0 && (
        <div style={{
          position: 'relative',
          borderRadius: 'var(--radius-lg)',
          overflow: 'hidden',
          height: '280px',
          background: `linear-gradient(90deg, rgba(12,15,23,0.95) 0%, rgba(12,15,23,0.5) 100%), url(${trendingMovies[0].posterUrl}) center/cover`,
          display: 'flex',
          alignItems: 'center',
          padding: '2.5rem',
          border: '1px solid var(--border-color)'
        }}>
          <div style={{ maxWidth: '550px', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Sparkles size={16} style={{ color: 'var(--accent-light)' }} />
              <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--accent-light)', textTransform: 'uppercase' }}>
                Featured Live Title
              </span>
            </div>

            <h2 style={{ fontSize: '1.8rem', fontWeight: 800, color: '#fff' }}>{trendingMovies[0].name}</h2>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
              Actual live stream media content powered by multi-provider community repositories.
            </p>

            <button
              onClick={() => onSelectMedia(trendingMovies[0])}
              className="btn btn-primary"
              style={{ width: 'fit-content', padding: '0.65rem 1.4rem' }}
            >
              <Play size={16} fill="#fff" />
              <span>Watch Now</span>
            </button>
          </div>
        </div>
      )}

      {/* Media Sections */}
      {trendingMovies.length > 0 && renderSection('Trending Movies', <Film size={18} style={{ color: 'var(--accent-light)' }} />, trendingMovies)}
      {trendingAnime.length > 0 && renderSection('Popular Anime Series', <Sparkles size={18} style={{ color: 'var(--accent-light)' }} />, trendingAnime)}
      {popularSeries.length > 0 && renderSection('Top TV Series', <Tv size={18} style={{ color: 'var(--accent-light)' }} />, popularSeries)}
    </div>
  );
};
