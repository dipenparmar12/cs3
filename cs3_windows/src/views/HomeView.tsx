import React, { useEffect, useState } from 'react';
import type { SearchResponse } from '../types/api';
import { Play, Sparkles, Film, Tv, History, Loader2 } from 'lucide-react';
import type { WatchProgress } from '../../electron/cs3/libraryStore';
import { TvType } from '../types/api';
import { PosterCard } from '../components/PosterCard';

interface HomeViewProps {
  onSelectMedia: (item: SearchResponse) => void;
  /** Quick-play from the card, bypassing the detail page. */
  onPlayDirectly?: (item: SearchResponse) => void;
}

export const HomeView: React.FC<HomeViewProps> = ({ onSelectMedia, onPlayDirectly }) => {
  const [trendingMovies, setTrendingMovies] = useState<SearchResponse[]>([]);
  const [trendingAnime, setTrendingAnime] = useState<SearchResponse[]>([]);
  const [popularSeries, setPopularSeries] = useState<SearchResponse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [continueWatching, setContinueWatching] = useState<WatchProgress[]>([]);

  const [availableProviders, setAvailableProviders] = useState<Array<{ name: string; pluginName: string }>>([]);
  const [selectedProvider, setSelectedProvider] = useState<string>('all');

  useEffect(() => {
    window.cloudstream?.getExtensionProviders().then((res) => {
      if (res?.ok && Array.isArray(res.providers)) {
        setAvailableProviders(res.providers.map((p) => ({ name: p.name, pluginName: p.pluginName })));
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    let isMounted = true;

    const fetchHomeContent = async () => {
      setIsLoading(true);
      if (window.cloudstream) {
        const [movies, anime, series] = await Promise.all([
          window.cloudstream.searchAll('Spider-Man'),
          window.cloudstream.searchAll('One Piece'),
          window.cloudstream.searchAll('Stranger Things')
        ]);

        const filterByProv = (items: SearchResponse[]) => {
          if (selectedProvider === 'all') return items;
          return items.filter((item) =>
            item && (
              item.apiName === selectedProvider ||
              (Array.isArray(item.alternates) && item.alternates.some((a) => a.apiName === selectedProvider))
            )
          );
        };

        if (isMounted) {
          setTrendingMovies(filterByProv(movies.results));
          setTrendingAnime(filterByProv(anime.results));
          setPopularSeries(filterByProv(series.results));
        }
      }
      setIsLoading(false);
    };

    window.cloudstream?.getContinueWatching(12).then((rows) => {
      if (isMounted) setContinueWatching(rows);
    });

    fetchHomeContent();
    return () => { isMounted = false; };
  }, [selectedProvider]);

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
          <PosterCard key={`${item.url}-${idx}`} item={item} onSelectMedia={onSelectMedia} onPlayDirectly={onPlayDirectly} />
        ))}
      </div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      {/* Active Provider Catalogue Selector Bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: 'var(--bg-card)',
        padding: '0.65rem 1.1rem',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-color)',
        flexWrap: 'wrap',
        gap: '0.75rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
          <Sparkles size={18} style={{ color: 'var(--accent-light)' }} />
          <div>
            <h3 style={{ fontSize: '0.92rem', fontWeight: 700, color: '#fff', margin: 0 }}>
              Live Extension Provider Catalogue
            </h3>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: 0 }}>
              Select an active extension provider to browse its live media catalog
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '0.76rem', color: 'var(--text-subtle)', fontWeight: 600 }}>Active Provider:</span>
          <select
            value={selectedProvider}
            onChange={(e) => setSelectedProvider(e.target.value)}
            style={{
              background: 'var(--bg-input)',
              border: '1px solid var(--border-color)',
              color: '#fff',
              padding: '0.35rem 0.75rem',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.78rem',
              outline: 'none',
              cursor: 'pointer'
            }}
          >
            <option value="all">🌟 All Active Extension Providers</option>
            {availableProviders.map((p) => (
              <option key={p.name} value={p.name}>
                🔌 {p.name} ({p.pluginName})
              </option>
            ))}
          </select>
        </div>
      </div>

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
                  onClick={(e) => {
                    (e.currentTarget as HTMLElement)?.blur();
                    (document.activeElement as HTMLElement)?.blur();
                    onSelectMedia({
                      name: row.title,
                      url: row.mediaUrl,
                      apiName: 'Continue watching',
                      type: TvType.Movie,
                      posterUrl: row.posterUrl,
                    });
                  }}
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
