import React, { useEffect, useState } from 'react';
import type { SearchResponse } from '../types/api';
import { Play, Sparkles, Film, Tv, History, Loader2 } from 'lucide-react';
import type { WatchProgress } from '../../electron/cs3/libraryStore';
import { TvType } from '../types/api';

interface HomeViewProps {
  onSelectMedia: (item: SearchResponse) => void;
}

export const HomeView: React.FC<HomeViewProps> = ({ onSelectMedia }) => {
  const [trendingMovies, setTrendingMovies] = useState<SearchResponse[]>([]);
  const [trendingAnime, setTrendingAnime] = useState<SearchResponse[]>([]);
  const [popularSeries, setPopularSeries] = useState<SearchResponse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [continueWatching, setContinueWatching] = useState<WatchProgress[]>([]);

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

    // Continue Watching is the row most likely to be used, and it comes from
    // local state, so it is loaded independently of the network fetches above
    // rather than waiting behind them.
    window.cloudstream?.getContinueWatching(12).then((rows) => {
      if (isMounted) setContinueWatching(rows);
    });

    fetchHomeContent();
    return () => { isMounted = false; };
  }, []);

  if (isLoading) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '350px',
          gap: '1.25rem',
          color: 'var(--text-muted)',
        }}
      >
        <div
          style={{
            width: '56px',
            height: '56px',
            borderRadius: '50%',
            background: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--accent-light)',
            boxShadow: '0 4px 16px rgba(59, 130, 246, 0.2)',
          }}
        >
          <Loader2 size={28} className="spin" />
        </div>
        <div style={{ textAlign: 'center' }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: '#fff', marginBottom: '0.4rem' }}>
            Fetching live media catalog...
          </h3>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-subtle)', margin: 0 }}>
            Loading trending movies, anime, and TV series
          </p>
        </div>
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

      {/* Continue watching — resumes without a search */}
      {continueWatching.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#fff' }}>
            <History size={18} style={{ color: 'var(--accent-light)' }} />
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Continue watching</h3>
          </div>

          <div className="poster-grid">
            {continueWatching.map((row) => {
              const percent = row.durationSeconds
                ? (row.positionSeconds / row.durationSeconds) * 100
                : 0;
              const minutesLeft = Math.round(
                Math.max(0, row.durationSeconds - row.positionSeconds) / 60
              );

              return (
                <div
                  key={`${row.key}-${row.season ?? ''}-${row.episode ?? ''}`}
                  className="poster-card"
                  onClick={() =>
                    onSelectMedia({
                      name: row.title,
                      url: row.mediaUrl,
                      apiName: 'Continue watching',
                      type: TvType.Movie,
                      posterUrl: row.posterUrl,
                    })
                  }
                >
                  <div className="poster-container">
                    {row.posterUrl ? (
                      <img src={row.posterUrl} alt="" loading="lazy" />
                    ) : (
                      <div className="poster-image poster-image--empty">
                        {row.title.slice(0, 1)}
                      </div>
                    )}
                    <div className="poster-overlay">
                      <button className="play-button-overlay">
                        <Play size={20} fill="#fff" />
                      </button>
                    </div>
                    <div className="poster-progress">
                      <div style={{ width: `${Math.min(100, percent)}%` }} />
                    </div>
                  </div>

                  <div className="poster-info">
                    <h4 className="poster-title">{row.title}</h4>
                    <div className="poster-meta">
                      <span>
                        {row.season != null && row.episode != null
                          ? `S${row.season}E${row.episode}`
                          : `${Math.round(percent)}% watched`}
                      </span>
                      <span style={{ color: 'var(--accent-light)', fontSize: '0.72rem' }}>
                        {minutesLeft} min left
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
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
