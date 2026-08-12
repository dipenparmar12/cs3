import React, { useState } from 'react';
import { TvType } from '../types/api';
import type { SearchResponse } from '../types/api';
import { Play, Plus, Star, Sparkles } from 'lucide-react';

interface HomeViewProps {
  onSelectMedia: (item: SearchResponse) => void;
}

export const HomeView: React.FC<HomeViewProps> = ({ onSelectMedia }) => {
  const [selectedType, setSelectedType] = useState<string>('All');

  const featuredHero: SearchResponse = {
    name: 'Cyberpunk: Edgerunners',
    url: 'https://example.com/anime/cyberpunk-edgerunners',
    apiName: 'CloudStream Builtin',
    type: TvType.Anime,
    posterUrl: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=1200&q=80',
    year: 2022,
    quality: '4K HDR'
  };

  const trendingItems: SearchResponse[] = [
    {
      name: 'Cyberpunk: Edgerunners',
      url: 'https://example.com/anime/cyberpunk-edgerunners',
      apiName: 'CloudStream Builtin',
      type: TvType.Anime,
      posterUrl: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=500&q=80',
      year: 2022,
      quality: '1080p'
    },
    {
      name: 'Attack on Titan',
      url: 'https://example.com/anime/attack-on-titan',
      apiName: 'CloudStream Builtin',
      type: TvType.Anime,
      posterUrl: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=500&q=80',
      year: 2021,
      quality: '4K'
    },
    {
      name: 'Interstellar',
      url: 'https://example.com/movie/interstellar',
      apiName: 'CloudStream Builtin',
      type: TvType.Movie,
      posterUrl: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=500&q=80',
      year: 2014,
      quality: '4K'
    },
    {
      name: 'Arcane: League of Legends',
      url: 'https://example.com/show/arcane',
      apiName: 'CloudStream Builtin',
      type: TvType.TvSeries,
      posterUrl: 'https://images.unsplash.com/photo-1563089145-599997674d42?w=500&q=80',
      year: 2021,
      quality: '1080p'
    }
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      {/* Hero Banner Component */}
      <div style={{
        position: 'relative',
        height: '340px',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
        border: '1px solid var(--border-color)',
        display: 'flex',
        alignItems: 'flex-end',
        padding: '2.5rem',
        background: `linear-gradient(to top, rgba(12, 15, 23, 0.95) 0%, rgba(12, 15, 23, 0.2) 60%, transparent 100%), url(${featuredHero.posterUrl}) center/cover no-repeat`
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxWidth: '600px', zIndex: 2 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span className="poster-quality">{featuredHero.quality}</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{featuredHero.year} • Anime Series</span>
          </div>

          <h2 style={{ fontSize: '2.2rem', fontWeight: 800, color: '#fff', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
            {featuredHero.name}
          </h2>

          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
            A street kid trying to survive in a technology and body modification-obsessed city of the future. Having everything to lose, he chooses to stay alive by becoming an edgerunner.
          </p>

          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
            <button onClick={() => onSelectMedia(featuredHero)} className="btn btn-primary">
              <Play size={18} />
              <span>Watch Now</span>
            </button>
            <button className="btn btn-secondary">
              <Plus size={18} />
              <span>Add to Watchlist</span>
            </button>
          </div>
        </div>
      </div>

      {/* Filter Chips */}
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        {['All', 'Movies', 'TV Series', 'Anime', 'Documentaries'].map((chip) => (
          <button
            key={chip}
            onClick={() => setSelectedType(chip)}
            className={`chip ${selectedType === chip ? 'active' : ''}`}
          >
            {chip}
          </button>
        ))}
      </div>

      {/* Media Grid Section */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem' }}>
          <Sparkles size={18} style={{ color: 'var(--accent-light)' }} />
          <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#fff' }}>Trending Media</h3>
        </div>

        <div className="poster-grid">
          {trendingItems.map((item, idx) => (
            <div key={idx} onClick={() => onSelectMedia(item)} className="poster-card">
              <div className="poster-image-container">
                <img src={item.posterUrl} alt={item.name} className="poster-image" />
                <span className="poster-badge">{item.type}</span>
                {item.quality && <span className="poster-quality">{item.quality}</span>}
              </div>
              <div className="poster-info">
                <h4 className="poster-title">{item.name}</h4>
                <div className="poster-meta">
                  <span>{item.year}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '2px', color: '#f59e0b' }}>
                    <Star size={12} fill="#f59e0b" />
                    <span>9.2</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
